//! Latency module (the edge) — **PARKED + DARK**.
//!
//! Design: `docs/superpowers/specs/2026-06-03-latency-module-design.md`.
//!
//! Phase-1 first increment: a **read-only** MSI-mode (Message-Signaled Interrupts) checker.
//! No mutation, no elevation, no network. `mod latency;` only — **not registered** in
//! `lib.rs`'s `invoke_handler`. Any *fix* this surfaces is advisory and would go through the
//! existing typed apply/rollback path, never a new mutation primitive.
#![allow(dead_code)] // parked/dark: wired by HQ when the latency surface lands.

use serde::Serialize;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

/// A PCI device that exposes the MSI setting, and whether MSI is enabled.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct MsiDevice {
    pub name: String,
    /// true = Message-Signaled Interrupts (generally lower latency); false = legacy line IRQ.
    pub msi_on: bool,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct MsiSummary {
    pub total: usize,
    pub msi_on: usize,
    pub msi_off: usize,
}

/// Pure: summarize a set of devices (testable without touching the registry).
pub(crate) fn summarize_msi(devices: &[MsiDevice]) -> MsiSummary {
    let on = devices.iter().filter(|d| d.msi_on).count();
    MsiSummary { total: devices.len(), msi_on: on, msi_off: devices.len() - on }
}

/// Clean a raw registry device description into a friendly name. `DeviceDesc` is often
/// `@oem12.inf,%nvidia_dev%;NVIDIA GeForce RTX 3070` — keep the readable tail.
fn clean_name(raw: &str) -> String {
    raw.rsplit(';').next().unwrap_or(raw).trim().to_string()
}

/// Live: walk `HKLM\…\Enum\PCI` and report each device that exposes the MSI setting.
/// Read-only; degrades to an empty list on any access error — never panics.
pub(crate) fn read_msi_devices() -> Vec<MsiDevice> {
    let mut out = Vec::new();
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(pci) = hklm.open_subkey(r"SYSTEM\CurrentControlSet\Enum\PCI") else {
        return out;
    };
    for vendev in pci.enum_keys().flatten() {
        let Ok(vk) = pci.open_subkey(&vendev) else { continue };
        for inst in vk.enum_keys().flatten() {
            let Ok(ik) = vk.open_subkey(&inst) else { continue };
            let msi = ik
                .open_subkey(r"Device Parameters\Interrupt Management\MessageSignaledInterruptProperties")
                .ok()
                .and_then(|k| k.get_value::<u32, _>("MSISupported").ok());
            let Some(msi) = msi else { continue }; // only devices exposing the setting
            let name = ik
                .get_value::<String, _>("FriendlyName")
                .or_else(|_| ik.get_value::<String, _>("DeviceDesc"))
                .map(|s| clean_name(&s))
                .unwrap_or_else(|_| vendev.clone());
            out.push(MsiDevice { name, msi_on: msi == 1 });
        }
    }
    out
}

/// Convenience the eventual (dark) command would call.
pub(crate) fn msi_report() -> MsiSummary {
    summarize_msi(&read_msi_devices())
}

fn is_latency_sensitive(name: &str) -> bool {
    let n = name.to_lowercase();
    ["geforce", "radeon", "nvidia", "ethernet", "gbe", "network", "wi-fi", "wifi", "nvme", "wireless"]
        .iter()
        .any(|k| n.contains(k))
}

/// Pure: an actionable advisory from the MSI scan — which devices are on legacy line interrupts,
/// prioritizing latency-sensitive ones (GPU/NIC/NVMe). Advisory only; flipping MSI would go through
/// the existing apply/rollback path, never auto-applied.
pub(crate) fn msi_advisory(devices: &[MsiDevice]) -> Option<String> {
    let legacy: Vec<&str> = devices.iter().filter(|d| !d.msi_on).map(|d| d.name.as_str()).collect();
    if legacy.is_empty() {
        return None;
    }
    let sensitive: Vec<&str> = legacy.iter().copied().filter(|n| is_latency_sensitive(n)).collect();
    let highlight = if sensitive.is_empty() { &legacy } else { &sensitive };
    let names = highlight.iter().take(3).copied().collect::<Vec<_>>().join(", ");
    Some(format!(
        "{} device(s) on legacy line interrupts (e.g. {}). MSI usually lowers interrupt latency — advisory, reversible.",
        legacy.len(),
        names
    ))
}

/// System timer resolution, as Windows reports it (100-ns units).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TimerResolution {
    pub coarsest_100ns: u32,
    pub finest_100ns: u32,
    pub current_100ns: u32,
}

impl TimerResolution {
    pub fn current_ms(&self) -> f64 {
        self.current_100ns as f64 / 10_000.0
    }
}

#[allow(non_snake_case)]
extern "system" {
    fn NtQueryTimerResolution(min: *mut u32, max: *mut u32, current: *mut u32) -> i32;
}

/// Read the system timer resolution (read-only). Note: recent Windows applies requested timer
/// resolution **per-process**, so the old global "force 0.5ms" registry hack no longer behaves the
/// way the forums insist — surfacing this honestly out-credibles the tweak guides. None on failure.
pub(crate) fn read_timer_resolution() -> Option<TimerResolution> {
    let (mut min, mut max, mut cur) = (0u32, 0u32, 0u32);
    // SAFETY: ntdll is always present; the call only writes the three out-params.
    let status = unsafe { NtQueryTimerResolution(&mut min, &mut max, &mut cur) };
    if status != 0 {
        return None;
    }
    Some(TimerResolution { coarsest_100ns: min, finest_100ns: max, current_100ns: cur })
}

/// Empirically-measured scheduler wake granularity, from sampling real `Sleep(1)` durations.
///
/// The design's "MeasureSleep" instrument: instead of blindly *forcing* 0.5ms (the cargo-cult
/// tweak), we **measure** what the machine actually delivers. The hardware-rounded sweet spot is
/// frequently ~0.51ms, not a clean 0.50 — and a wrong forced value can *degrade* timing. The
/// median here ≈ the effective wake granularity a `Sleep`/timer-driven loop sees; `jitter_ms`
/// (sample stdev) is the run-to-run spread that actually matters for stutter.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub(crate) struct SleepGranularity {
    pub samples: usize,
    pub min_ms: f64,
    pub median_ms: f64,
    pub max_ms: f64,
    /// Sample standard deviation of the per-sleep deltas — the empirical jitter.
    pub jitter_ms: f64,
}

/// Pure: reduce a set of measured `Sleep(1)` deltas (ms) to a granularity summary. `None` on empty
/// input so the live reader can degrade without inventing numbers. Testable without sleeping.
pub(crate) fn summarize_sleep_samples(deltas_ms: &[f64]) -> Option<SleepGranularity> {
    if deltas_ms.is_empty() {
        return None;
    }
    let mut sorted = deltas_ms.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let n = sorted.len();
    let median =
        if n.is_multiple_of(2) { (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0 } else { sorted[n / 2] };
    let mean = sorted.iter().sum::<f64>() / n as f64;
    let jitter = if n > 1 {
        let var = sorted.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1) as f64;
        var.sqrt()
    } else {
        0.0
    };
    Some(SleepGranularity {
        samples: n,
        min_ms: sorted[0],
        median_ms: median,
        max_ms: sorted[n - 1],
        jitter_ms: jitter,
    })
}

/// QPC frequency (ticks/sec) for converting `Sleep` deltas to milliseconds. Mirrors `fps.rs`:
/// falls back to the common 10 MHz QPC rate if the query somehow fails.
fn qpc_frequency() -> i64 {
    use windows::Win32::System::Performance::QueryPerformanceFrequency;
    let mut f = 0i64;
    // SAFETY: writes a single i64 the API fully initializes.
    unsafe {
        let _ = QueryPerformanceFrequency(&mut f);
    }
    if f == 0 {
        10_000_000
    } else {
        f
    }
}

fn qpc_now() -> i64 {
    use windows::Win32::System::Performance::QueryPerformanceCounter;
    let mut t = 0i64;
    // SAFETY: writes a single i64 the API fully initializes.
    unsafe {
        let _ = QueryPerformanceCounter(&mut t);
    }
    t
}

/// Live: measure the real wake granularity by timing `samples` back-to-back `Sleep(1)` calls with
/// QPC. **Read-only** — it only sleeps and reads a counter (no mutation, no elevation, no network).
/// `samples` is clamped to a sane range so the call stays sub-second. `None` if QPC is unusable.
pub(crate) fn measure_sleep_granularity(samples: usize) -> Option<SleepGranularity> {
    use windows::Win32::System::Threading::Sleep;
    let n = samples.clamp(20, 1000);
    let freq = qpc_frequency() as f64;
    let mut deltas = Vec::with_capacity(n);
    for _ in 0..n {
        let start = qpc_now();
        // SAFETY: Sleep just yields the thread for the requested milliseconds.
        unsafe { Sleep(1) };
        let end = qpc_now();
        let ticks = (end - start) as f64;
        if ticks > 0.0 {
            deltas.push(ticks * 1000.0 / freq);
        }
    }
    summarize_sleep_samples(&deltas)
}

/// Pure: an honest, plain-English note about the measured wake granularity — the "measure, don't
/// blind-force 0.5ms" stance. The teaching moment is the **divergence** between the OS-reported
/// system-wide resolution and what *this* process actually experiences: since Win10 2004 timer
/// resolution is per-process, so a global "1ms" figure does NOT mean an idle/occluded process
/// receives it. We classify the reading rather than asserting a fixed "0.51ms" that may be wrong.
pub(crate) fn sleep_granularity_note(g: &SleepGranularity, timer: Option<&TimerResolution>) -> String {
    let mut note = format!(
        "Measured wake granularity ≈ {:.2}ms (jitter ±{:.2}ms over {} samples). ",
        g.median_ms, g.jitter_ms, g.samples
    );
    match timer {
        // A global high-res request is in effect AND this process is actually getting it
        // (measured ≈ reported, within scheduling slack).
        Some(t) if g.median_ms <= (t.current_ms() * 3.0).max(2.0) => {
            note.push_str(&format!(
                "This process IS receiving the high-resolution timer (OS-reported {:.2}ms). The \
                 lowest-jitter value is the one your hardware rounds to — often ~0.51ms, not a clean \
                 0.50 — measured here rather than blindly forced. ",
                t.current_ms()
            ));
        }
        // The classic Win11 trap: the OS reports a fine resolution (another app raised it), but
        // THIS process still sleeps at the coarse default tick — per-process resolution in action.
        Some(t) => {
            note.push_str(&format!(
                "Windows reports {:.2}ms system-wide, but this idle process still gets ~{:.1}ms — \
                 because since Win10 2004 timer resolution is PER-PROCESS, so a global figure does \
                 not mean your game receives it (on Win11 a minimized/occluded window even loses it). \
                 A foreground app that requests a high-res timer would see closer to {:.2}ms. ",
                t.current_ms(),
                g.median_ms,
                t.current_ms()
            ));
        }
        None => {
            note.push_str("OS timer resolution unavailable; this is the raw measured value only. ");
        }
    }
    note.push_str(
        "Timer resolution governs scheduling granularity, not interrupt/DPC latency — confusing the \
         two is blaming the alarm clock for traffic.",
    );
    note
}

#[cfg(test)]
mod latency_tests {
    use super::*;

    fn dev(name: &str, on: bool) -> MsiDevice {
        MsiDevice { name: name.into(), msi_on: on }
    }

    #[test]
    fn summarize_counts_on_and_off() {
        let s = summarize_msi(&[dev("GPU", true), dev("NIC", false), dev("NVMe", true)]);
        assert_eq!(s.total, 3);
        assert_eq!(s.msi_on, 2);
        assert_eq!(s.msi_off, 1);
    }

    #[test]
    fn summarize_empty_is_zero() {
        assert_eq!(summarize_msi(&[]), MsiSummary::default());
    }

    #[test]
    fn clean_name_keeps_readable_tail() {
        assert_eq!(clean_name("@oem12.inf,%dev%;NVIDIA GeForce RTX 3070"), "NVIDIA GeForce RTX 3070");
        assert_eq!(clean_name("Realtek PCIe GbE Family Controller"), "Realtek PCIe GbE Family Controller");
    }

    #[test]
    fn reader_never_panics() {
        // Real machine → devices; any sandbox → empty. Must never panic.
        let _ = read_msi_devices();
    }

    #[test]
    fn advisory_none_when_all_msi_on() {
        assert!(msi_advisory(&[dev("GPU", true), dev("NIC", true)]).is_none());
    }

    #[test]
    fn advisory_flags_legacy_and_prioritizes_sensitive() {
        let devs = [
            dev("High Definition Audio Bus", false),
            dev("Realtek Gaming GbE Family", false),
            dev("AMD Radeon RX 9070 XT", false),
        ];
        let a = msi_advisory(&devs).expect("advisory present");
        assert!(a.contains("3 device"));
        // a latency-sensitive device (NIC/GPU) is named ahead of the audio bus
        assert!(a.contains("Radeon") || a.contains("GbE"));
        assert!(!a.contains("Audio"));
    }

    #[test]
    fn timer_resolution_reads_or_degrades() {
        // Real machine → Some (finest ≤ current ≤ coarsest); sandbox → None. Never panics.
        if let Some(t) = read_timer_resolution() {
            assert!(t.finest_100ns <= t.coarsest_100ns);
            assert!(t.current_ms() > 0.0);
        }
    }

    #[test]
    fn summarize_sleep_empty_is_none() {
        assert!(summarize_sleep_samples(&[]).is_none());
    }

    #[test]
    fn summarize_sleep_odd_median_and_extents() {
        let g = summarize_sleep_samples(&[0.50, 2.0, 0.51]).expect("samples present");
        assert_eq!(g.samples, 3);
        assert_eq!(g.min_ms, 0.50);
        assert_eq!(g.max_ms, 2.0);
        assert_eq!(g.median_ms, 0.51); // sorted middle, not insertion order
        assert!(g.jitter_ms > 0.0);
    }

    #[test]
    fn summarize_sleep_even_median_averages_middle_pair() {
        let g = summarize_sleep_samples(&[1.0, 2.0, 3.0, 4.0]).expect("samples present");
        assert_eq!(g.median_ms, 2.5);
    }

    #[test]
    fn summarize_sleep_single_sample_zero_jitter() {
        let g = summarize_sleep_samples(&[0.51]).expect("one sample");
        assert_eq!(g.jitter_ms, 0.0);
        assert_eq!(g.median_ms, 0.51);
    }

    #[test]
    fn sleep_note_high_res_in_effect_names_sweet_spot() {
        // OS reports 0.50ms AND this process measured ~0.51ms → high-res actually in effect.
        let g = SleepGranularity { samples: 100, min_ms: 0.49, median_ms: 0.51, max_ms: 1.2, jitter_ms: 0.08 };
        let timer = TimerResolution { coarsest_100ns: 156250, finest_100ns: 5000, current_100ns: 5000 };
        let note = sleep_granularity_note(&g, Some(&timer));
        assert!(note.contains("0.51")); // measured median surfaced
        assert!(note.contains("0.50")); // names the cargo-cult value it warns against
        assert!(note.contains("not interrupt/DPC latency")); // the honesty correction
    }

    #[test]
    fn sleep_note_flags_per_process_divergence() {
        // The real live reading: OS reports 1.00ms, but this idle process still gets ~16ms.
        let g = SleepGranularity { samples: 200, min_ms: 13.1, median_ms: 16.0, max_ms: 17.1, jitter_ms: 0.42 };
        let timer = TimerResolution { coarsest_100ns: 156250, finest_100ns: 5000, current_100ns: 10000 };
        let note = sleep_granularity_note(&g, Some(&timer));
        assert!(note.contains("PER-PROCESS")); // explains the divergence
        assert!(note.contains("16.0")); // measured value surfaced
        assert!(!note.contains("0.51")); // must NOT assert the sweet spot when it doesn't apply
        assert!(note.contains("not interrupt/DPC latency"));
    }

    #[test]
    fn sleep_note_handles_missing_timer() {
        let g = SleepGranularity { samples: 50, min_ms: 0.5, median_ms: 0.6, max_ms: 1.0, jitter_ms: 0.1 };
        let note = sleep_granularity_note(&g, None);
        assert!(note.contains("unavailable"));
        assert!(note.contains("not interrupt/DPC latency"));
    }

    #[test]
    fn measure_sleep_reads_or_degrades() {
        // Real machine → Some plausible granularity; sandbox without QPC → None. Never panics.
        if let Some(g) = measure_sleep_granularity(30) {
            assert!(g.samples >= 20); // clamped floor
            assert!(g.min_ms >= 0.0 && g.median_ms >= 0.0);
            assert!(g.max_ms >= g.min_ms);
        }
    }
}
