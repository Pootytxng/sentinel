//! Latency module (the edge) — **PARKED + DARK**.
//!
//! Design: `docs/superpowers/specs/2026-06-03-latency-module-design.md`.
//!
//! Phase-1 first increment: a **read-only** MSI-mode (Message-Signaled Interrupts) checker.
//! No mutation, no elevation, no network. `mod latency;` only — **not registered** in
//! `lib.rs`'s `invoke_handler`. Any *fix* this surfaces is advisory and would go through the
//! existing typed apply/rollback path, never a new mutation primitive.
#![allow(dead_code)] // parked/dark: wired by HQ when the latency surface lands.

use std::collections::HashMap;

use serde::Serialize;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

/// A PCI device that exposes the MSI setting, with both the *advertised* config and (when it can be
/// correlated) the *actually-active* interrupt mode. The owner's catch: `MSISupported=1` only means
/// MSI is permitted — a device can advertise it and still fall back to a legacy line IRQ. So we keep
/// the advertised flag but verify against the real allocated IRQ.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct MsiDevice {
    pub name: String,
    /// Advertised MSI support (`MSISupported=1`). NOT proof MSI is in use — see `msi_active`.
    pub msi_on: bool,
    /// Full PCI instance path (`PCI\VEN_...\...`), uppercased, for correlating with allocated IRQs.
    pub instance_id: String,
    /// Whether MSI is ACTUALLY active, from the allocated IRQ (MSI vectors show as 0x8000_0000+,
    /// i.e. negative as i32). `None` when no IRQ allocation was found → active state undetermined.
    pub msi_active: Option<bool>,
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
            let instance_id = format!(r"PCI\{vendev}\{inst}").to_uppercase();
            out.push(MsiDevice { name, msi_on: msi == 1, instance_id, msi_active: None });
        }
    }
    out
}

/// An MSI interrupt vector is reported as a value in the 0x8000_0000+ range — Device Manager shows
/// it as a *negative* IRQ. A legacy line IRQ is a small positive number. This is the real "is MSI
/// active" signal, distinct from the advertised `MSISupported` flag.
pub(crate) fn irq_is_msi(irq: u32) -> bool {
    irq >= 0x8000_0000
}

/// Pure: pull the IRQ number out of a `Win32_PnPAllocatedResource.Antecedent` ref string, e.g.
/// `\\HOST\root\cimv2:Win32_IRQResource.IRQNumber=4294967267`. `None` if it isn't an IRQ resource.
pub(crate) fn parse_irq_number(antecedent: &str) -> Option<u32> {
    if !antecedent.contains("Win32_IRQResource") {
        return None;
    }
    let rhs = antecedent.rsplit("IRQNumber=").next()?;
    rhs.trim().trim_matches('"').parse::<u32>().ok()
}

/// Pure: pull the device instance id out of a `Dependent` ref string, e.g.
/// `...:Win32_PnPEntity.DeviceID="PCI\\VEN_1022&...\\4&35EC6657&0&0043"`. WMI doubles the
/// backslashes inside the path; we collapse them and uppercase so it matches the registry walk.
pub(crate) fn parse_dependent_device_id(dependent: &str) -> Option<String> {
    let after = dependent.split("DeviceID=").nth(1)?;
    let inner = after.trim().trim_start_matches('"');
    let inner = inner.split('"').next().unwrap_or(inner);
    Some(inner.replace(r"\\", r"\").to_uppercase())
}

/// Live: map each device instance id → whether it currently holds an MSI IRQ. Reads
/// `Win32_PnPAllocatedResource` (read-only WMI). A device counts as MSI-active if *any* of its
/// allocated IRQ vectors is in the MSI range. Degrades to an empty map on any error — never panics.
pub(crate) fn read_active_msi_map() -> HashMap<String, bool> {
    #[derive(serde::Deserialize)]
    #[serde(rename = "Win32_PnPAllocatedResource")]
    #[serde(rename_all = "PascalCase")]
    struct Alloc {
        antecedent: Option<String>,
        dependent: Option<String>,
    }
    let mut map: HashMap<String, bool> = HashMap::new();
    let Ok(com) = wmi::COMLibrary::new() else { return map };
    let Ok(conn) = wmi::WMIConnection::new(com) else { return map };
    let rows: Vec<Alloc> = conn.query().unwrap_or_default();
    for row in rows {
        let (Some(ant), Some(dep)) = (row.antecedent, row.dependent) else { continue };
        let Some(irq) = parse_irq_number(&ant) else { continue }; // only IRQ allocations
        let Some(dev) = parse_dependent_device_id(&dep) else { continue };
        let is_msi = irq_is_msi(irq);
        // OR across a device's vectors: one MSI vector means MSI is active for it.
        map.entry(dev).and_modify(|v| *v |= is_msi).or_insert(is_msi);
    }
    map
}

/// Pure: stamp the real active-MSI state onto devices by matching instance ids.
pub(crate) fn annotate_msi_active(devices: &mut [MsiDevice], active: &HashMap<String, bool>) {
    for d in devices.iter_mut() {
        d.msi_active = active.get(&d.instance_id).copied();
    }
}

/// Live convenience: advertised scan + real active-IRQ verification, fully correlated.
pub(crate) fn read_verified_msi_devices() -> Vec<MsiDevice> {
    let mut devices = read_msi_devices();
    let active = read_active_msi_map();
    annotate_msi_active(&mut devices, &active);
    devices
}

/// Counts that separate advertised support from *verified-active* state.
#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct MsiActiveSummary {
    pub active_on: usize,
    pub active_off: usize,
    /// Active state could not be determined (no IRQ allocation correlated).
    pub unknown: usize,
    /// The honesty case: devices that advertise MSI support but are actually on a line IRQ.
    pub advertised_but_inactive: usize,
}

/// Pure: summarize verified active-MSI state across devices.
pub(crate) fn summarize_msi_active(devices: &[MsiDevice]) -> MsiActiveSummary {
    let mut s = MsiActiveSummary::default();
    for d in devices {
        match d.msi_active {
            Some(true) => s.active_on += 1,
            Some(false) => {
                s.active_off += 1;
                if d.msi_on {
                    s.advertised_but_inactive += 1;
                }
            }
            None => s.unknown += 1,
        }
    }
    s
}

/// Pure: an advisory built on the *verified* (not advertised) state — the fix for the owner's catch.
/// Highlights latency-sensitive devices actually running on line interrupts, and calls out the
/// advertised-but-inactive divergence explicitly. `None` when nothing is verifiably on a line IRQ.
pub(crate) fn msi_active_advisory(devices: &[MsiDevice]) -> Option<String> {
    let verified_off: Vec<&MsiDevice> = devices.iter().filter(|d| d.msi_active == Some(false)).collect();
    if verified_off.is_empty() {
        return None;
    }
    let sensitive: Vec<&str> = verified_off
        .iter()
        .filter(|d| is_latency_sensitive(&d.name))
        .map(|d| d.name.as_str())
        .collect();
    let highlight: Vec<&str> =
        if sensitive.is_empty() { verified_off.iter().map(|d| d.name.as_str()).collect() } else { sensitive };
    let names = highlight.iter().take(3).copied().collect::<Vec<_>>().join(", ");
    let advertised_gap = verified_off.iter().filter(|d| d.msi_on).count();
    let mut msg = format!(
        "{} device(s) VERIFIED on legacy line interrupts (e.g. {}) — confirmed from the allocated IRQ, not just the advertised setting. ",
        verified_off.len(),
        names
    );
    if advertised_gap > 0 {
        msg.push_str(&format!(
            "{advertised_gap} of them advertise MSI support but aren't actually using it. "
        ));
    }
    msg.push_str("Switching to MSI usually lowers interrupt latency — advisory, reversible.");
    Some(msg)
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

/// CPU core/cache topology — enough to decide whether interrupt-affinity tweaks are meaningful.
/// On AMD Zen each CCD has its own L3, so the count of distinct L3 caches ≈ the CCD count: a single
/// L3 = single-CCD (no cross-CCD latency to manage), 2+ = multi-CCD (affinity can matter).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CpuTopology {
    pub logical_processors: usize,
    pub physical_cores: usize,
    /// Distinct L3 cache complexes — the CCD-count proxy on AMD; 1 on monolithic Intel dies.
    pub l3_complexes: usize,
}

impl CpuTopology {
    /// Multi-CCD/multi-L3 → cross-complex interrupt placement can matter.
    pub fn is_multi_complex(&self) -> bool {
        self.l3_complexes >= 2
    }
}

/// Pure: interrupt-affinity pinning only buys anything when there are 2+ cache complexes to steer
/// interrupts between. Refusing it on a single-CCD part is itself a credibility feature.
pub(crate) fn affinity_is_meaningful(topo: &CpuTopology) -> bool {
    topo.is_multi_complex()
}

/// Pure: an honest line about whether interrupt-affinity tuning is worth offering on this CPU.
pub(crate) fn affinity_advisory(topo: &CpuTopology) -> String {
    if affinity_is_meaningful(topo) {
        format!(
            "{} cache complexes (≈CCDs) across {} cores — pinning latency-sensitive interrupts to \
             one complex can cut cross-CCD hops. Advisory, reversible, measured before/after.",
            topo.l3_complexes, topo.physical_cores
        )
    } else {
        format!(
            "Single cache complex ({} cores) — interrupt-affinity pinning has nothing to steer \
             between here, so it's not offered. (No cross-CCD latency to avoid on this CPU.)",
            topo.physical_cores
        )
    }
}

/// Query one relationship class of `GetLogicalProcessorInformationEx` into a properly-aligned
/// buffer. Returns the raw bytes + the populated length. Empty on any failure — never panics.
#[cfg(target_os = "windows")]
fn query_logical_processor_info(
    rel: windows::Win32::System::SystemInformation::LOGICAL_PROCESSOR_RELATIONSHIP,
) -> Vec<u8> {
    use std::mem::size_of;
    use windows::Win32::System::SystemInformation::{
        GetLogicalProcessorInformationEx, SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
    };
    type Rec = SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX;

    let mut len: u32 = 0;
    // First call: probe the required size (returns ERROR_INSUFFICIENT_BUFFER, sets len).
    // SAFETY: a None buffer with len=0 only writes the required length to `len`.
    unsafe {
        let _ = GetLogicalProcessorInformationEx(rel, None, &mut len);
    }
    if len == 0 {
        return Vec::new();
    }
    // Allocate as Rec to guarantee the struct's alignment, then view the bytes.
    let cap = (len as usize).div_ceil(size_of::<Rec>()).max(1);
    let mut backing: Vec<Rec> = Vec::with_capacity(cap);
    // SAFETY: buffer has room for `len` bytes (cap * size_of::<Rec>() >= len) and the API writes
    // exactly `len` bytes of valid record data on success.
    let ok = unsafe { GetLogicalProcessorInformationEx(rel, Some(backing.as_mut_ptr()), &mut len) };
    if ok.is_err() {
        return Vec::new();
    }
    let byte_len = len as usize;
    // SAFETY: the API populated `byte_len` initialized bytes starting at the buffer base.
    let bytes = unsafe { std::slice::from_raw_parts(backing.as_ptr() as *const u8, byte_len) };
    bytes.to_vec()
}

/// Walk the variable-length records in a `GetLogicalProcessorInformationEx` buffer, invoking `f`
/// with each record. Each record carries its own `Size`, so we advance by that.
///
/// # Safety
/// `buf` must contain valid `SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX` records as produced by the
/// API, and be aligned for that type (it is — it came from a `Vec<Rec>` backing).
#[cfg(target_os = "windows")]
unsafe fn walk_lpi_records(
    buf: &[u8],
    mut f: impl FnMut(&windows::Win32::System::SystemInformation::SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX),
) {
    use windows::Win32::System::SystemInformation::SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX as Rec;
    let mut off = 0usize;
    // Header = Relationship (u32) + Size (u32) = 8 bytes minimum.
    while off + 8 <= buf.len() {
        let rec = &*(buf.as_ptr().add(off) as *const Rec);
        let size = rec.Size as usize;
        if size == 0 || off + size > buf.len() {
            break;
        }
        f(rec);
        off += size;
    }
}

/// Live: read CPU core/cache topology via `GetLogicalProcessorInformationEx` (read-only, no
/// elevation, no network). `None` if the API yields nothing (e.g. a non-Windows sandbox).
#[cfg(target_os = "windows")]
pub(crate) fn read_cpu_topology() -> Option<CpuTopology> {
    use windows::Win32::System::SystemInformation::{RelationCache, RelationProcessorCore};

    // Physical cores + logical processors: one record per physical core; popcount the affinity
    // masks for logical-processor (SMT thread) count across all processor groups.
    let core_buf = query_logical_processor_info(RelationProcessorCore);
    let mut physical_cores = 0usize;
    let mut logical_processors = 0usize;
    // SAFETY: buffer came from query_logical_processor_info, which fills it from the API.
    unsafe {
        walk_lpi_records(&core_buf, |rec| {
            physical_cores += 1;
            let p = &rec.Anonymous.Processor;
            let masks = std::slice::from_raw_parts(p.GroupMask.as_ptr(), p.GroupCount as usize);
            for m in masks {
                logical_processors += m.Mask.count_ones() as usize;
            }
        });
    }

    // L3 complexes: count cache records whose Level == 3.
    let cache_buf = query_logical_processor_info(RelationCache);
    let mut l3_complexes = 0usize;
    // SAFETY: as above.
    unsafe {
        walk_lpi_records(&cache_buf, |rec| {
            if rec.Anonymous.Cache.Level == 3 {
                l3_complexes += 1;
            }
        });
    }

    if physical_cores == 0 {
        return None;
    }
    Some(CpuTopology { logical_processors, physical_cores, l3_complexes })
}

#[cfg(test)]
mod latency_tests {
    use super::*;

    fn dev(name: &str, on: bool) -> MsiDevice {
        MsiDevice { name: name.into(), msi_on: on, instance_id: String::new(), msi_active: None }
    }

    fn dev_full(name: &str, on: bool, id: &str, active: Option<bool>) -> MsiDevice {
        MsiDevice { name: name.into(), msi_on: on, instance_id: id.to_uppercase(), msi_active: active }
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
    fn irq_msi_threshold() {
        assert!(!irq_is_msi(16)); // a normal line IRQ
        assert!(!irq_is_msi(0x7FFF_FFFF));
        assert!(irq_is_msi(0x8000_0000));
        assert!(irq_is_msi(4_294_967_267)); // 0xFFFF_FFE3 — a real MSI vector seen live
    }

    #[test]
    fn parse_irq_number_from_antecedent() {
        let a = r"\\HOST\root\cimv2:Win32_IRQResource.IRQNumber=4294967267";
        assert_eq!(parse_irq_number(a), Some(4_294_967_267));
        // A non-IRQ resource (e.g. memory) must be ignored.
        assert_eq!(parse_irq_number(r"\\HOST\root\cimv2:Win32_DeviceMemoryAddress.StartingAddress=0"), None);
    }

    #[test]
    fn parse_device_id_collapses_backslashes_and_uppercases() {
        // As the wmi crate hands it back: doubled backslashes, quoted.
        let d = "\\\\HOST\\root\\cimv2:Win32_PnPEntity.DeviceID=\"PCI\\\\VEN_1022&DEV_15B8&SUBSYS_7E491462&REV_00\\\\4&35EC6657&0&0043\"";
        assert_eq!(
            parse_dependent_device_id(d).as_deref(),
            Some(r"PCI\VEN_1022&DEV_15B8&SUBSYS_7E491462&REV_00\4&35EC6657&0&0043")
        );
    }

    #[test]
    fn annotate_marks_active_from_map() {
        let mut devs = [
            dev_full("AMD Radeon RX 9070 XT", true, r"PCI\VEN_1002&DEV_7550\X", None),
            dev_full("Realtek GbE", true, r"PCI\VEN_10EC&DEV_8168\Y", None),
            dev_full("Some Bridge", false, r"PCI\VEN_1022&DEV_1234\Z", None),
        ];
        let mut map = HashMap::new();
        map.insert(r"PCI\VEN_1002&DEV_7550\X".to_uppercase(), true); // GPU on MSI
        map.insert(r"PCI\VEN_10EC&DEV_8168\Y".to_uppercase(), false); // NIC advertises MSI but on line IRQ
        // bridge absent → stays None
        annotate_msi_active(&mut devs, &map);
        assert_eq!(devs[0].msi_active, Some(true));
        assert_eq!(devs[1].msi_active, Some(false));
        assert_eq!(devs[2].msi_active, None);
    }

    #[test]
    fn summarize_active_counts_and_flags_advertised_gap() {
        let devs = [
            dev_full("GPU", true, "A", Some(true)),
            dev_full("NIC", true, "B", Some(false)), // advertised MSI but inactive → the honesty case
            dev_full("Audio", false, "C", Some(false)),
            dev_full("Bridge", true, "D", None),
        ];
        let s = summarize_msi_active(&devs);
        assert_eq!(s.active_on, 1);
        assert_eq!(s.active_off, 2);
        assert_eq!(s.unknown, 1);
        assert_eq!(s.advertised_but_inactive, 1); // only the NIC (advertised + inactive)
    }

    #[test]
    fn active_advisory_uses_verified_state_not_advertised() {
        // GPU advertises MSI but is actually on a line IRQ; NIC genuinely on MSI.
        let devs = [
            dev_full("AMD Radeon RX 9070 XT", true, "A", Some(false)),
            dev_full("Realtek Gaming GbE", true, "B", Some(true)),
            dev_full("Audio", false, "C", None), // unknown → not asserted
        ];
        let a = msi_active_advisory(&devs).expect("advisory present");
        assert!(a.contains("VERIFIED"));
        assert!(a.contains("Radeon")); // the verified-off latency-sensitive device
        assert!(a.contains("advertise MSI support but aren't actually using it"));
        assert!(!a.contains("Realtek")); // it's actually on MSI — must not be flagged
    }

    #[test]
    fn active_advisory_none_when_none_verified_off() {
        let devs = [dev_full("GPU", true, "A", Some(true)), dev_full("NIC", true, "B", None)];
        assert!(msi_active_advisory(&devs).is_none());
    }

    #[test]
    fn verified_scan_is_internally_consistent() {
        // Real machine → devices with correlated active state; sandbox → empty. Never panics, and
        // the active buckets must always partition the device set.
        let devs = read_verified_msi_devices();
        let s = summarize_msi_active(&devs);
        assert_eq!(s.active_on + s.active_off + s.unknown, devs.len());
        assert!(s.advertised_but_inactive <= s.active_off);
    }

    fn topo(cores: usize, lps: usize, l3: usize) -> CpuTopology {
        CpuTopology { physical_cores: cores, logical_processors: lps, l3_complexes: l3 }
    }

    #[test]
    fn affinity_meaningful_only_on_multi_complex() {
        assert!(!affinity_is_meaningful(&topo(8, 16, 1))); // single-CCD 8-core X3D
        assert!(affinity_is_meaningful(&topo(16, 32, 2))); // dual-CCD
        assert!(!topo(8, 16, 1).is_multi_complex());
        assert!(topo(16, 32, 2).is_multi_complex());
    }

    #[test]
    fn affinity_advisory_refuses_on_single_complex() {
        let single = affinity_advisory(&topo(8, 16, 1));
        assert!(single.contains("not offered"));
        assert!(single.contains("Single cache complex"));
        let multi = affinity_advisory(&topo(16, 32, 2));
        assert!(multi.contains("2 cache complexes"));
        assert!(multi.contains("reversible"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cpu_topology_reads_or_degrades() {
        // Real machine → Some with sane invariants; sandbox → None. Never panics.
        if let Some(t) = read_cpu_topology() {
            eprintln!("LIVE topology = {:?} multi_complex={}", t, t.is_multi_complex());
            assert!(t.physical_cores >= 1);
            assert!(t.logical_processors >= t.physical_cores); // SMT ≥ cores
            assert!(t.l3_complexes >= 1);
        }
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
