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

/// One named line-IRQ receipt — "name the guilty device" (sprint item 5). Only devices VERIFIED
/// on a line interrupt (msi_active == Some(false)) are listed; an unknown state never accuses.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct LineIrqReceipt {
    pub name: String,
    /// The sharper case: the device advertises MSI capability yet runs on a line IRQ.
    pub advertises_msi: bool,
    /// True for GPU/NIC/NVMe-class devices — the ones where interrupt latency is felt.
    pub latency_sensitive: bool,
}

/// Pure: every device verified on a legacy line interrupt, latency-sensitive devices first
/// (then advertised-but-inactive, then name) so the list reads worst-first deterministically.
pub(crate) fn line_irq_receipts(devices: &[MsiDevice]) -> Vec<LineIrqReceipt> {
    let mut out: Vec<LineIrqReceipt> = devices
        .iter()
        .filter(|d| d.msi_active == Some(false))
        .map(|d| LineIrqReceipt {
            name: d.name.clone(),
            advertises_msi: d.msi_on,
            latency_sensitive: is_latency_sensitive(&d.name),
        })
        .collect();
    out.sort_by(|a, b| {
        (b.latency_sensitive, b.advertises_msi, &a.name).cmp(&(
            a.latency_sensitive,
            a.advertises_msi,
            &b.name,
        ))
    });
    out
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

/// Pure: deepen the general affinity advisory into a NAMED, still read-only suggestion. On a
/// multi-complex CPU, name the latency-sensitive devices (GPU / NIC / NVMe) whose interrupts are
/// worth keeping on the complex the game runs on — the actionable half of `affinity_advisory`.
/// `None` on a single-complex CPU (nothing to steer between) OR when no latency-sensitive device is
/// present, so we never suggest a tweak with no target. Compy NEVER writes interrupt affinity (a
/// manual, advanced step); this only points at where it could help, and is explicit the gain is small.
pub(crate) fn affinity_device_suggestion(topo: &CpuTopology, devices: &[MsiDevice]) -> Option<String> {
    if !affinity_is_meaningful(topo) {
        return None;
    }
    let mut sensitive: Vec<&str> =
        devices.iter().filter(|d| is_latency_sensitive(&d.name)).map(|d| d.name.as_str()).collect();
    sensitive.dedup();
    if sensitive.is_empty() {
        return None;
    }
    let names = sensitive.iter().take(3).copied().collect::<Vec<_>>().join(", ");
    Some(format!(
        "Advanced, optional: on this {}-complex CPU, keeping the interrupts for your latency-sensitive \
         devices ({names}) on the same complex your game runs on can trim cross-CCD hops. It's a MANUAL \
         step (the device's interrupt-affinity policy) — Compy only points it out, never writes it — and \
         the gain is small, so measure before/after.",
        topo.l3_complexes
    ))
}

/// Query one relationship class of `GetLogicalProcessorInformationEx` into a correctly-aligned,
/// zero-initialized buffer. Returns `(backing, byte_len)` where the first `byte_len` bytes hold the
/// API's records. The `u64` backing is 8-byte aligned (satisfying the record type's alignment) and
/// carries one full record of slack past `byte_len`, so a `&Rec` formed at the last record — whose
/// own `Size` may be smaller than `size_of::<Rec>()` — never reads past the allocation. Empty on any
/// failure — never panics.
#[cfg(target_os = "windows")]
fn query_logical_processor_info(
    rel: windows::Win32::System::SystemInformation::LOGICAL_PROCESSOR_RELATIONSHIP,
) -> (Vec<u64>, usize) {
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
        return (Vec::new(), 0);
    }
    // u64 backing → 8-byte alignment (== Rec's alignment on x64), trivially zero-initialized, with a
    // full Rec of slack past `len` for safe end-of-buffer reference formation.
    let words = ((len as usize) + size_of::<Rec>()).div_ceil(size_of::<u64>()) + 1;
    let mut backing: Vec<u64> = vec![0u64; words];
    // SAFETY: backing holds words*8 >= len bytes, aligned for Rec; the API writes `len` bytes of
    // valid record data on success.
    let ok = unsafe {
        GetLogicalProcessorInformationEx(rel, Some(backing.as_mut_ptr() as *mut Rec), &mut len)
    };
    if ok.is_err() {
        return (Vec::new(), 0);
    }
    (backing, len as usize)
}

/// Walk the variable-length records in a `GetLogicalProcessorInformationEx` buffer, invoking `f`
/// with each record. Each record carries its own `Size`, so we advance by that.
///
/// # Safety
/// `buf` must be a byte view of a buffer produced by `query_logical_processor_info` for the same
/// relationship class — i.e. aligned for `SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX` and carrying one
/// record of slack past its end (so forming `&Rec` at the final record stays in-bounds).
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

/// Build an aligned byte view of `(backing, byte_len)` and walk its records.
///
/// # Safety
/// `backing`/`byte_len` must be a pair returned by `query_logical_processor_info`.
#[cfg(target_os = "windows")]
unsafe fn for_each_lpi_record(
    buf: &(Vec<u64>, usize),
    f: impl FnMut(&windows::Win32::System::SystemInformation::SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX),
) {
    let (backing, byte_len) = buf;
    // The backing is Rec-aligned with a full record of slack; view exactly the populated bytes.
    let bytes = std::slice::from_raw_parts(backing.as_ptr() as *const u8, *byte_len);
    walk_lpi_records(bytes, f);
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
    // SAFETY: core_buf came from query_logical_processor_info (aligned, slacked).
    unsafe {
        for_each_lpi_record(&core_buf, |rec| {
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
        for_each_lpi_record(&cache_buf, |rec| {
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

/// A USB host controller and the distinct input devices it's hosting. The latency-relevant fact:
/// devices sharing one host controller share its bandwidth/interrupt servicing, so a chatty device
/// can add jitter to another's polling. We only *surface* it — never fear-monger; it's usually fine.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct UsbControllerLoad {
    pub controller_name: String,
    pub controller_id: String,
    /// Distinct input devices (HID/keyboard/mouse, deduped by VID&PID) on this controller, by name.
    pub input_devices: Vec<String>,
    /// Distinct STREAMING neighbors on this controller — USB audio / wireless headset dongles /
    /// webcams / capture devices (isochronous endpoints). These can genuinely add polling jitter.
    pub streaming_neighbors: Vec<String>,
    /// Whether a high-rate (1000Hz-class) input device — a mouse — is present on this controller.
    pub has_high_rate_input: bool,
}

impl UsbControllerLoad {
    /// Two or more input devices on one controller — the legacy "shared input" condition.
    pub fn is_shared(&self) -> bool {
        self.input_devices.len() >= 2
    }

    /// Two-tier severity. Amber **Attention** ONLY when a high-rate input shares the controller with
    /// a streaming neighbor (a real, actionable jitter risk). Quiet sharing (a mouse + keyboards/HID,
    /// or any sharing with no streaming neighbor) is **Info** — education, not alarm. `none` = solo.
    pub fn severity(&self) -> &'static str {
        let shared = self.input_devices.len() >= 2
            || (!self.input_devices.is_empty() && !self.streaming_neighbors.is_empty());
        if !shared {
            "none"
        } else if self.has_high_rate_input && !self.streaming_neighbors.is_empty() {
            "attention"
        } else {
            "info"
        }
    }
}

/// Jitter-relevant device kinds (ordered by how much a neighbor matters to a 1000Hz input).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum DeviceKind {
    Quiet,     // low-rate HID: keyboards, consumer/system-control, RGB, hubs
    HighRate,  // a mouse — the 1000Hz-class peripheral that actually cares about jitter
    Streaming, // USB audio / headset dongle / webcam / capture — isochronous, can flood the bus
}

/// Internal: a resolved device (input or streaming neighbor) awaiting controller attribution.
struct InputDevice {
    device_id: String,
    name: String,
    vid_pid: Option<String>,
    kind: DeviceKind,
}

/// Classify a device by PnP class (+ name hints) into the jitter-relevant kinds. `None` = irrelevant
/// to USB-input topology (skip it).
fn classify_device_kind(pnp_class: &str, name: &str) -> Option<DeviceKind> {
    let n = name.to_lowercase();
    let streaming_name =
        ["headset", "webcam", "capture", "microphone", " audio"].iter().any(|k| n.contains(k));
    match pnp_class {
        "MEDIA" | "AudioEndpoint" | "Camera" | "Image" => Some(DeviceKind::Streaming),
        _ if streaming_name => Some(DeviceKind::Streaming),
        "Mouse" => Some(DeviceKind::HighRate),
        "Keyboard" | "HIDClass" if n.contains("mouse") => Some(DeviceKind::HighRate),
        "Keyboard" | "HIDClass" => Some(DeviceKind::Quiet),
        _ => None,
    }
}

/// A physical peripheral exposes several HID collections (mouse, consumer-control, vendor-defined…)
/// all sharing one VID&PID. When deduping we prefer the collection with a meaningful name (e.g.
/// "HID-compliant mouse") over these generic/secondary-collection names.
fn is_generic_input_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with("usb input")
        || n == "hid-compliant device"
        || n.contains("vendor-defined")
        || n.contains("consumer control")
}

/// Pure: extract `VID_xxxx&PID_yyyy` (uppercased) from a device instance id so multiple nodes of
/// one physical device (its USB node + each HID collection) collapse to a single logical device.
pub(crate) fn parse_vid_pid(device_id: &str) -> Option<String> {
    fn hex_after(s: &str, key: &str) -> Option<String> {
        let start = s.find(key)? + key.len();
        let frag = s.get(start..start + 4)?;
        frag.chars().all(|c| c.is_ascii_hexdigit()).then(|| frag.to_uppercase())
    }
    let up = device_id.to_uppercase();
    Some(format!("VID_{}&PID_{}", hex_after(&up, "VID_")?, hex_after(&up, "PID_")?))
}

/// Pure: attribute input devices to their host controllers and dedup per controller by VID&PID,
/// preferring a descriptive name over a generic "USB Input Device". Returns controllers hosting at
/// least one input device, most-loaded first. This is the testable core of the USB topology map.
fn group_input_devices_by_controller(
    controllers: &HashMap<String, String>,
    edges: &HashMap<String, String>,
    inputs: &[InputDevice],
) -> Vec<UsbControllerLoad> {
    // controller id -> (vid_pid -> (chosen name, most-concerning kind))
    let mut by_ctrl: HashMap<String, HashMap<String, (String, DeviceKind)>> = HashMap::new();
    for dev in inputs {
        let Some(vid_pid) = &dev.vid_pid else { continue };
        let Some(ctrl) = edges.get(&dev.device_id) else { continue }; // not attributable → skip
        let slot = by_ctrl.entry(ctrl.clone()).or_default();
        slot.entry(vid_pid.clone())
            .and_modify(|(name, kind)| {
                // A composite device (e.g. a headset dongle = audio + HID) shares one VID&PID across
                // its collections; keep the most-concerning kind and the most descriptive name.
                if dev.kind > *kind {
                    *kind = dev.kind;
                }
                if is_generic_input_name(name) && !is_generic_input_name(&dev.name) {
                    *name = dev.name.clone();
                }
            })
            .or_insert_with(|| (dev.name.clone(), dev.kind));
    }
    let mut loads: Vec<UsbControllerLoad> = by_ctrl
        .into_iter()
        .map(|(ctrl, devs)| {
            let mut input_devices: Vec<String> = Vec::new();
            let mut streaming_neighbors: Vec<String> = Vec::new();
            let mut has_high_rate_input = false;
            for (name, kind) in devs.into_values() {
                match kind {
                    DeviceKind::Streaming => streaming_neighbors.push(name),
                    DeviceKind::HighRate => {
                        has_high_rate_input = true;
                        input_devices.push(name);
                    }
                    DeviceKind::Quiet => input_devices.push(name),
                }
            }
            input_devices.sort();
            streaming_neighbors.sort();
            UsbControllerLoad {
                controller_name: controllers.get(&ctrl).cloned().unwrap_or_else(|| ctrl.clone()),
                controller_id: ctrl,
                input_devices,
                streaming_neighbors,
                has_high_rate_input,
            }
        })
        // Only controllers actually hosting an input device are part of "USB input topology".
        .filter(|l| !l.input_devices.is_empty())
        .collect();
    // Attention controllers first, then by total device count, then name (stable).
    loads.sort_by(|a, b| {
        let sev = |l: &UsbControllerLoad| match l.severity() {
            "attention" => 0,
            "info" => 1,
            _ => 2,
        };
        sev(a)
            .cmp(&sev(b))
            .then_with(|| {
                (b.input_devices.len() + b.streaming_neighbors.len())
                    .cmp(&(a.input_devices.len() + a.streaming_neighbors.len()))
            })
            .then_with(|| a.controller_name.cmp(&b.controller_name))
    });
    loads
}

/// Pure: a severity-appropriate advisory. Prefers the actionable (attention) case — a high-rate
/// input sharing a controller with a streaming neighbor — otherwise gives the benign (info)
/// education. `None` when nothing is shared. INFO copy follows (a) what's observed / (b) why it's
/// harmless here / (c) the condition under which it WOULD matter.
pub(crate) fn shared_controller_advisory(loads: &[UsbControllerLoad]) -> Option<String> {
    if let Some(c) = loads.iter().find(|l| l.severity() == "attention") {
        let mouse = c
            .input_devices
            .iter()
            .find(|n| n.to_lowercase().contains("mouse"))
            .cloned()
            .unwrap_or_else(|| "Your high-rate input".into());
        let neighbor =
            c.streaming_neighbors.first().cloned().unwrap_or_else(|| "a streaming device".into());
        return Some(format!(
            "{mouse} shares a USB controller ({}) with {neighbor} — a constant-streaming device \
             (audio/video) that can add polling jitter at 1000Hz+. Move either to a port on a \
             different controller to remove the risk.",
            c.controller_name
        ));
    }
    if let Some(c) = loads.iter().find(|l| l.severity() == "info") {
        let neighbors = if c.has_high_rate_input {
            "low-traffic devices (keyboard-class)"
        } else {
            "other low-traffic input devices"
        };
        return Some(format!(
            "Your mouse shares this controller ({}) with {neighbors}. Harmless — they send a few \
             bytes per keypress, not a constant stream. Full isolation only matters if you're \
             chasing the last microsecond of 1000Hz+ consistency.",
            c.controller_name
        ));
    }
    None
}

/// Pure: conservative wireless-input match on a device NAME. Only well-known, unambiguous wireless
/// tokens — so a wired device is never mislabeled wireless (a false "you're on wireless" would be a
/// fabricated claim). "Receiver"/"dongle" denote a wireless USB receiver; the brand tokens are
/// vendor wireless techs (Logitech Lightspeed, Razer HyperSpeed).
fn is_wireless_input_name(name: &str) -> bool {
    let n = name.to_lowercase();
    ["wireless", "bluetooth", "lightspeed", "hyperspeed", "receiver", "dongle"]
        .iter()
        .any(|k| n.contains(k))
}

/// Pure: an honest wired-vs-wireless input advisory over the already-detected input-device names.
/// Fires ONLY when a name clearly indicates a wireless connection — name-based detection can't see
/// every wireless device, so a no-match returns `None` rather than asserting "you're wired" (we never
/// fabricate a connection we can't verify). Advisory only; the model is accurate (2.4 GHz gaming
/// receivers ≈ wired; Bluetooth is worse) and the detection caveat is stated in the copy.
pub(crate) fn wired_vs_wireless_advisory(loads: &[UsbControllerLoad]) -> Option<String> {
    let wireless = loads
        .iter()
        .flat_map(|l| l.input_devices.iter())
        .find(|n| is_wireless_input_name(n))?;
    Some(format!(
        "{wireless} looks like a wireless connection. A modern 2.4 GHz gaming receiver is competitive \
         with wired — about a millisecond more, and rock-steady; Bluetooth adds noticeably more lag and \
         jitter. For the lowest, most consistent input latency a wired connection is the safe pick, but \
         a good 2.4 GHz dongle is plenty for most play. (Read from the device name — if it's wrong, \
         trust your own setup over this.)"
    ))
}

/// Pure: the TIER half of the USB-port advisory. The honest, hardware-tailored note built on the
/// platform's top USB spec tier (`top_spec`, from the backend's `detect_usb_top_spec()` signal) — the
/// one USB-spec fact that IS readable in user-mode. We do NOT know which port a device sits on or its
/// negotiated speed (neither is readable), so this never claims "your mouse is on a slow port"; it
/// teaches what the tier does and doesn't mean for input latency.
///
/// `None` unless the tier is known AND at least one USB input device was detected (`loads` non-empty)
/// — with no tier or no peripheral there's nothing honest+relevant to say.
///
/// - **USB 2.0-capped:** input is genuinely fine (a 1000Hz mouse uses a sliver of 2.0 bandwidth → same
///   polling rate as on a USB 3 port). The one thing the lower ceiling affects is bandwidth-hungry
///   devices (USB audio/capture/webcam), not your mouse.
/// - **USB 3.x / USB4:** a myth-buster — a faster port does NOT raise a mouse's polling rate; the same
///   tiny reports flow on USB 2.0 or USB4, so don't hunt for "the fast port" for input. The bandwidth
///   helps storage/capture/audio, not your mouse.
///
/// This owns the **spec-tier** dimension only. It deliberately does NOT name a specific device or tell
/// you to move one — that's `shared_controller_advisory`'s job (the sharing dimension), so the two
/// never issue the same "move device X" instruction twice. Advisory only; Compy never moves a device or
/// changes a port. Read-only.
pub(crate) fn usb_tier_advisory(top_spec: Option<&str>, loads: &[UsbControllerLoad]) -> Option<String> {
    let tier = top_spec?;
    if loads.is_empty() {
        return None; // no USB input device detected → nothing peripheral-relevant to tailor
    }
    if tier == "USB 2.0" {
        return Some(
            "Your USB controllers top out at USB 2.0. For a mouse or keyboard that's genuinely fine — a \
             1000Hz mouse sends tiny reports and uses a sliver of USB 2.0's bandwidth, so its polling \
             rate is the same as it would be on a USB 3 port. The lower ceiling only matters for \
             bandwidth-hungry devices (USB audio interfaces, capture cards, webcams), not your input. \
             (Tier read from the controller names; which port a device actually uses isn't readable in \
             user-mode.)"
                .to_string(),
        );
    }
    Some(format!(
        "Your system supports up to {tier}. Worth knowing for input latency, but not worth chasing: a \
         faster USB port does NOT raise a mouse's polling rate — a 1000Hz mouse sends the same tiny \
         reports on a USB 2.0 or a {tier} port, so there's no need to hunt for \"the fast port\" for your \
         mouse or keyboard. The extra bandwidth helps storage, capture and audio devices, not input. \
         (Tier read from the controller names; per-port speed isn't readable in user-mode.)"
    ))
}

/// Live: build the USB-controller → input-device map (read-only WMI: `Win32_USBController`,
/// `Win32_USBControllerDevice`, `Win32_PnPEntity`). No elevation, no network. Empty on any error.
///
/// Polling-rate honesty (was TODO:777, resolved 2026-06-11): the on-demand mouse measurement
/// (`measure_mouse_polling`) already times REAL report intervals via raw input rather than
/// trusting an advertised rate — so the global case is measured, not assumed. Per-device HID
/// verification (opening each HID handle to time its own reports) remains a deliberate
/// non-goal for now: it adds a device-open I/O surface for marginal gain over the measured
/// global rate. Revisit only if a tester's topology makes per-device attribution matter.
pub(crate) fn read_usb_topology() -> Vec<UsbControllerLoad> {
    #[derive(serde::Deserialize)]
    #[serde(rename = "Win32_USBController")]
    #[serde(rename_all = "PascalCase")]
    struct Ctrl {
        device_id: Option<String>,
        name: Option<String>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename = "Win32_USBControllerDevice")]
    #[serde(rename_all = "PascalCase")]
    struct CtrlDev {
        antecedent: Option<String>,
        dependent: Option<String>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename = "Win32_PnPEntity")]
    #[serde(rename_all = "PascalCase")]
    struct Pnp {
        device_id: Option<String>,
        name: Option<String>,
        #[serde(rename = "PNPClass")]
        pnp_class: Option<String>,
    }

    let Ok(com) = wmi::COMLibrary::new() else { return Vec::new() };
    let Ok(conn) = wmi::WMIConnection::new(com) else { return Vec::new() };

    let mut controllers: HashMap<String, String> = HashMap::new();
    for c in conn.query::<Ctrl>().unwrap_or_default() {
        if let Some(id) = c.device_id {
            controllers.insert(id.to_uppercase(), c.name.unwrap_or_else(|| id.clone()));
        }
    }

    let mut edges: HashMap<String, String> = HashMap::new();
    for e in conn.query::<CtrlDev>().unwrap_or_default() {
        let (Some(ant), Some(dep)) = (e.antecedent, e.dependent) else { continue };
        let (Some(ctrl), Some(dev)) = (parse_dependent_device_id(&ant), parse_dependent_device_id(&dep))
        else {
            continue;
        };
        edges.insert(dev, ctrl);
    }

    let q = "SELECT DeviceID, Name, PNPClass FROM Win32_PnPEntity \
             WHERE PNPClass = 'HIDClass' OR PNPClass = 'Keyboard' OR PNPClass = 'Mouse' \
             OR PNPClass = 'MEDIA' OR PNPClass = 'AudioEndpoint' OR PNPClass = 'Camera' \
             OR PNPClass = 'Image'";
    let inputs: Vec<InputDevice> = conn
        .raw_query::<Pnp>(q)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| {
            let name = p.name.unwrap_or_default();
            let kind = classify_device_kind(p.pnp_class.as_deref()?, &name)?;
            let device_id = p.device_id?.to_uppercase();
            let vid_pid = parse_vid_pid(&device_id);
            let name = if name.is_empty() { device_id.clone() } else { name };
            Some(InputDevice { name, vid_pid, device_id, kind })
        })
        .collect();

    group_input_devices_by_controller(&controllers, &edges, &inputs)
}

/// Measured HID (mouse) polling rate, from the intervals between real input reports — the design's
/// "verify the polling rate, don't trust the advertised number." A 1000Hz mouse should land near
/// 1000Hz with tight jitter; a busy/oversubscribed USB controller can drag the *effective* rate down.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub(crate) struct PollingRate {
    pub reports: usize,
    pub median_hz: f64,
    pub min_interval_ms: f64,
    pub max_interval_ms: f64,
    /// Sample standard deviation of the report intervals — the empirical jitter.
    pub jitter_ms: f64,
}

/// Pure: reduce a series of report timestamps (ms, monotonic) to a polling-rate summary. Needs ≥2
/// timestamps (≥1 interval); `None` otherwise so the live capture degrades without inventing a rate.
pub(crate) fn summarize_polling(timestamps_ms: &[f64]) -> Option<PollingRate> {
    let mut intervals: Vec<f64> =
        timestamps_ms.windows(2).map(|w| w[1] - w[0]).filter(|d| *d > 0.0).collect();
    if intervals.is_empty() {
        return None;
    }
    intervals.sort_by(|a, b| a.total_cmp(b));
    let n = intervals.len();
    let median = if n.is_multiple_of(2) {
        (intervals[n / 2 - 1] + intervals[n / 2]) / 2.0
    } else {
        intervals[n / 2]
    };
    let mean = intervals.iter().sum::<f64>() / n as f64;
    let jitter = if n > 1 {
        (intervals.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1) as f64).sqrt()
    } else {
        0.0
    };
    Some(PollingRate {
        reports: timestamps_ms.len(),
        median_hz: if median > 0.0 { 1000.0 / median } else { 0.0 },
        min_interval_ms: intervals[0],
        max_interval_ms: intervals[n - 1],
        jitter_ms: jitter,
    })
}

/// Pure: an honest line about a measured mouse polling rate vs a claimed rate (if known).
pub(crate) fn polling_note(p: &PollingRate, claimed_hz: Option<u32>) -> String {
    let mut note = format!(
        "Measured ≈ {:.0} Hz effective ({} reports, interval {:.2}–{:.2}ms, jitter ±{:.2}ms). ",
        p.median_hz, p.reports, p.min_interval_ms, p.max_interval_ms, p.jitter_ms
    );
    match claimed_hz {
        Some(c) if p.median_hz < (c as f64) * 0.85 => note.push_str(&format!(
            "That's noticeably below the advertised {c} Hz — the effective rate is what reaches the \
             game, and it can sag on a busy/shared USB controller. Worth checking.",
        )),
        Some(c) => note.push_str(&format!("In line with the advertised {c} Hz.")),
        None => note.push_str(
            "This is the effective rate Windows actually delivered — measured from real reports, not \
             the box number.",
        ),
    }
    note
}

/// Live: measure the mouse's effective polling rate by observing real input reports for `duration_ms`
/// via the **Raw Input** API (a passive observer — it does NOT block or alter your actual mouse input,
/// and it's how mouse-rate checkers work). Read-only, no elevation, no network. Requires the user to
/// be moving the mouse during the window. `None` if no reports arrive or the window/registration fails.
#[cfg(target_os = "windows")]
pub(crate) fn measure_mouse_polling(duration_ms: u32) -> Option<PollingRate> {
    use std::mem::{size_of, zeroed};
    use winapi::um::libloaderapi::GetModuleHandleW;
    use winapi::um::winuser::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, KillTimer,
        RegisterClassW, RegisterRawInputDevices, SetTimer, TranslateMessage, UnregisterClassW, MSG,
        RAWINPUTDEVICE, RIDEV_INPUTSINK, RIDEV_REMOVE, WM_INPUT, WM_TIMER, WNDCLASSW,
    };

    // Unique class name per call so concurrent probes never collide on RegisterClassW.
    use std::sync::atomic::{AtomicUsize, Ordering};
    static PROBE_SEQ: AtomicUsize = AtomicUsize::new(0);
    let seq = PROBE_SEQ.fetch_add(1, Ordering::Relaxed);
    let class_name: Vec<u16> = format!("CompyHidPollProbe{seq}\0").encode_utf16().collect();
    let freq = qpc_frequency() as f64;
    let mut timestamps: Vec<f64> = Vec::new();

    // SAFETY: a self-contained Win32 window + Raw Input session, all on this thread. Every handle is
    // released before returning; failures bail out early after cleaning up what was created.
    unsafe {
        let hinstance = GetModuleHandleW(std::ptr::null());
        let mut wc: WNDCLASSW = zeroed();
        wc.lpfnWndProc = Some(DefWindowProcW); // default proc handles WM_INPUT cleanup on dispatch
        wc.hInstance = hinstance;
        wc.lpszClassName = class_name.as_ptr();
        if RegisterClassW(&wc) == 0 {
            return None;
        }
        // A normal top-level window we never show — RIDEV_INPUTSINK delivers input even unfocused.
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hinstance,
            std::ptr::null_mut(),
        );
        if hwnd.is_null() {
            UnregisterClassW(class_name.as_ptr(), hinstance);
            return None;
        }

        let mut rid: RAWINPUTDEVICE = zeroed();
        rid.usUsagePage = 0x01; // generic desktop
        rid.usUsage = 0x02; // mouse
        rid.dwFlags = RIDEV_INPUTSINK;
        rid.hwndTarget = hwnd;
        if RegisterRawInputDevices(&rid, 1, size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            DestroyWindow(hwnd);
            UnregisterClassW(class_name.as_ptr(), hinstance);
            return None;
        }

        // A one-shot timer ends the capture; GetMessageW blocks (no busy-spin) and wakes per report.
        // If the timer can't be created we MUST bail — otherwise, with no mouse movement, GetMessageW
        // would block forever (no WM_TIMER ever arrives).
        if SetTimer(hwnd, 1, duration_ms, None) == 0 {
            rid.dwFlags = RIDEV_REMOVE;
            rid.hwndTarget = std::ptr::null_mut();
            let _ = RegisterRawInputDevices(&rid, 1, size_of::<RAWINPUTDEVICE>() as u32);
            DestroyWindow(hwnd);
            UnregisterClassW(class_name.as_ptr(), hinstance);
            return None;
        }
        // Wall-clock backstop: even if the timer message were somehow missed, never run past this.
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(duration_ms as u64 + 500);
        let mut msg: MSG = zeroed();
        loop {
            let ret = GetMessageW(&mut msg, hwnd, 0, 0);
            if ret <= 0 {
                break; // 0 = WM_QUIT, -1 = error
            }
            match msg.message {
                WM_TIMER => break,
                // We registered mouse-only, so every WM_INPUT is a mouse report — timestamp it.
                WM_INPUT => {
                    let t = qpc_now();
                    if t > 0 {
                        timestamps.push(t as f64 * 1000.0 / freq);
                    }
                }
                _ => {}
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg); // routes WM_INPUT to DefWindowProc, which frees the raw data
            if std::time::Instant::now() >= deadline {
                break; // defense-in-depth vs a stuck timer while reports keep arriving
            }
        }

        // Cleanup: stop the timer, deregister raw input, destroy the window + class.
        KillTimer(hwnd, 1);
        rid.dwFlags = RIDEV_REMOVE;
        rid.hwndTarget = std::ptr::null_mut();
        let _ = RegisterRawInputDevices(&rid, 1, size_of::<RAWINPUTDEVICE>() as u32);
        DestroyWindow(hwnd);
        UnregisterClassW(class_name.as_ptr(), hinstance);
    }

    summarize_polling(&timestamps)
}

// ── Stage 3: Correlate ─────────────────────────────────────────────────────────────────────────
// Align the latency-event timeline (DPC/ISR, from the Stage 1-2 capture) against the frame-time
// stream (real game frames) → "your stutter at T was caused by driver X." Pure timeline logic here;
// it consumes whatever the capture + frame streams produce, so it's testable and built ahead of them.

/// A latency event from the capture: a DPC/ISR with the driver (module) that ran it (Stage-2
/// attribution) and how long it held the CPU.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct LatencyEvent {
    /// When it fired, on the same monotonic clock as the frame stream.
    pub timestamp_ms: f64,
    pub duration_us: f64,
    pub driver: String,
}

/// A problem frame from the frame-time stream — a stutter (e.g. a 1%/0.1%-low frame).
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub(crate) struct FrameSpike {
    /// When the frame was presented, same clock as `LatencyEvent`.
    pub timestamp_ms: f64,
    /// The (long) frame time that made it a stutter.
    pub frame_ms: f64,
}

/// The verdict for one stutter: the latency event that best explains it, if any.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct StutterCause {
    pub frame_timestamp_ms: f64,
    pub frame_ms: f64,
    pub culprit_driver: Option<String>,
    pub culprit_duration_us: Option<f64>,
    /// How long before the frame's present the culprit fired (ms).
    pub lag_ms: Option<f64>,
}

impl StutterCause {
    pub fn is_attributed(&self) -> bool {
        self.culprit_driver.is_some()
    }
}

/// Pure: for each stutter, the "culprit" is the longest-duration latency event that fired during the
/// bad frame or within `window_ms` before its present — a long DPC right before a frame is the
/// classic cause. A stutter with no event in that window is left **unattributed** (honest: we don't
/// invent a cause). `window_ms` is the lead-in tolerance beyond the frame's own duration.
pub(crate) fn correlate_stutters(
    spikes: &[FrameSpike],
    events: &[LatencyEvent],
    window_ms: f64,
) -> Vec<StutterCause> {
    spikes
        .iter()
        .map(|s| {
            let lo = s.timestamp_ms - s.frame_ms - window_ms;
            let hi = s.timestamp_ms;
            let culprit = events
                .iter()
                .filter(|e| e.timestamp_ms >= lo && e.timestamp_ms <= hi)
                .max_by(|a, b| a.duration_us.total_cmp(&b.duration_us));
            match culprit {
                Some(e) => StutterCause {
                    frame_timestamp_ms: s.timestamp_ms,
                    frame_ms: s.frame_ms,
                    culprit_driver: Some(e.driver.clone()),
                    culprit_duration_us: Some(e.duration_us),
                    lag_ms: Some(s.timestamp_ms - e.timestamp_ms),
                },
                None => StutterCause {
                    frame_timestamp_ms: s.timestamp_ms,
                    frame_ms: s.frame_ms,
                    culprit_driver: None,
                    culprit_duration_us: None,
                    lag_ms: None,
                },
            }
        })
        .collect()
}

/// Pure: the headline — which driver is implicated in the most stutters, and how many. `None` if
/// nothing was attributed. This is the "name the guilty driver" payoff in one line.
pub(crate) fn top_stutter_culprit(causes: &[StutterCause]) -> Option<(String, usize)> {
    let mut tally: HashMap<&str, usize> = HashMap::new();
    for c in causes {
        if let Some(d) = &c.culprit_driver {
            *tally.entry(d.as_str()).or_insert(0) += 1;
        }
    }
    tally.into_iter().max_by_key(|(_, n)| *n).map(|(d, n)| (d.to_string(), n))
}

/// Pure: a plain-English verdict for one correlated stutter.
pub(crate) fn stutter_verdict(c: &StutterCause) -> String {
    match (&c.culprit_driver, c.culprit_duration_us, c.lag_ms) {
        (Some(driver), Some(us), Some(lag)) => format!(
            "Your {:.1}ms frame at {:.0}ms lines up with a {:.0}µs event in {} ({:.1}ms earlier).",
            c.frame_ms, c.frame_timestamp_ms, us, driver, lag
        ),
        _ => format!(
            "Your {:.1}ms frame at {:.0}ms has no latency event nearby — not attributed (likely GPU/CPU-bound, not a driver hitch).",
            c.frame_ms, c.frame_timestamp_ms
        ),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics report assembly — the read-only snapshot the Diagnostics/Latency
// tab consumes. All reads here are passive: no elevation, no network, no mutation.
// Time-windowed measurements (wake granularity, mouse polling) are separate
// on-demand commands so the snapshot load stays instant.
// ─────────────────────────────────────────────────────────────────────────────

/// Composite read-only latency snapshot (MSI verified state, timer resolution,
/// CPU/CCD topology, USB controller sharing) with each section's honest advisory
/// baked in as a ready-to-show string.
#[derive(Serialize, Clone, Debug, Default)]
pub(crate) struct LatencyReport {
    pub msi_devices: Vec<MsiDevice>,
    pub msi: MsiSummary,
    pub msi_active: MsiActiveSummary,
    pub msi_advisory: Option<String>,
    /// Named per-device receipts for everything verified on a line IRQ (worst-first).
    pub line_irq_receipts: Vec<LineIrqReceipt>,
    pub timer: Option<TimerResolution>,
    /// `timer.current_ms()` precomputed for the UI (the method isn't serialized).
    pub timer_current_ms: Option<f64>,
    pub cpu: Option<CpuTopology>,
    pub cpu_affinity_advisory: Option<String>,
    /// Named, read-only interrupt-affinity SUGGESTION (multi-complex CPU + latency-sensitive devices
    /// present); None otherwise. Compy never writes affinity — this only points where it could help.
    pub affinity_suggestion: Option<String>,
    pub usb: Vec<UsbControllerLoad>,
    pub usb_advisory: Option<String>,
    /// Honest wired-vs-wireless input note — present ONLY when an input-device name clearly indicates
    /// a wireless connection (else None; we never assert "wired" we can't verify).
    pub peripheral_link_advisory: Option<String>,
    /// Platform top USB spec tier (`"USB4"`/`"USB 3.2"`/…/`"USB 2.0"`) from the backend's shared
    /// `detect_usb_top_spec()` signal, or None when unreadable. Capability tier only — never per-device
    /// speed or which port a device uses (neither is readable in user-mode).
    pub usb_top_spec: Option<String>,
    /// The TIER half of the USB-port advisory: an honest, hardware-tailored note about what the top
    /// USB spec tier does (and doesn't) mean for input latency. None when the tier is unknown or no
    /// USB input device was detected.
    pub usb_tier_advisory: Option<String>,
}

/// Gather the fast read-only latency diagnostics. Each underlying reader degrades
/// gracefully (empty/None) rather than inventing data, so a partial environment
/// still yields an honest partial report.
///
/// Runs on a dedicated MTA worker thread: `read_verified_msi_devices` and
/// `read_usb_topology` open WMI (`COMLibrary::new` → `CoInitializeEx(MULTITHREADED)`),
/// which fails with `RPC_E_CHANGED_MODE` on the WebView2 **STA** thread that Tauri
/// sync commands run on — the exact trap `hardware.rs` solves the same way. The
/// non-WMI reads (timer FFI, CPU topology, registry MSI) run fine there too.
pub(crate) fn gather_latency_report() -> LatencyReport {
    crate::hardware::on_wmi_thread(gather_latency_report_inner)
}

fn gather_latency_report_inner() -> LatencyReport {
    let msi_devices = read_verified_msi_devices();
    let msi = summarize_msi(&msi_devices);
    let msi_active = summarize_msi_active(&msi_devices);
    let msi_advisory = msi_active_advisory(&msi_devices);
    let line_irq = line_irq_receipts(&msi_devices);
    let timer = read_timer_resolution();
    let timer_current_ms = timer.as_ref().map(|t| t.current_ms());
    let cpu = read_cpu_topology();
    let cpu_affinity_advisory = cpu.as_ref().map(affinity_advisory);
    let affinity_suggestion =
        cpu.as_ref().and_then(|t| affinity_device_suggestion(t, &msi_devices));
    let usb = read_usb_topology();
    let usb_advisory = shared_controller_advisory(&usb);
    let peripheral_link_advisory = wired_vs_wireless_advisory(&usb);
    let usb_top_spec = crate::hardware::detect_usb_top_spec();
    let usb_tier_advisory = usb_tier_advisory(usb_top_spec.as_deref(), &usb);
    LatencyReport {
        msi_devices,
        msi,
        msi_active,
        msi_advisory,
        line_irq_receipts: line_irq,
        timer,
        timer_current_ms,
        cpu,
        cpu_affinity_advisory,
        affinity_suggestion,
        usb,
        usb_advisory,
        peripheral_link_advisory,
        usb_top_spec,
        usb_tier_advisory,
    }
}

/// On-demand wake-granularity measurement (samples real `Sleep(1)` deltas) + its honest note.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct WakeMeasurement {
    pub granularity: SleepGranularity,
    pub note: String,
}

/// Measure scheduler wake granularity (~200 samples) paired with the timer-resolution note.
/// `None` if no samples could be taken.
pub(crate) fn measure_wake() -> Option<WakeMeasurement> {
    let timer = read_timer_resolution();
    // 128 samples is plenty for a stable median/jitter while bounding how long this
    // sync command holds the thread (Sleep(1) ≈ wake-granularity per sample).
    let granularity = measure_sleep_granularity(128)?;
    let note = sleep_granularity_note(&granularity, timer.as_ref());
    Some(WakeMeasurement { granularity, note })
}

/// On-demand HID polling-rate measurement (passive Raw Input over a capture window) + its note.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct MouseMeasurement {
    pub polling: PollingRate,
    pub note: String,
}

/// Measure mouse report rate over `duration_ms` of passive Raw Input (no injection). `None` if too
/// few reports were captured (e.g. the mouse wasn't moved during the window).
pub(crate) fn measure_mouse(duration_ms: u32) -> Option<MouseMeasurement> {
    let polling = measure_mouse_polling(duration_ms)?;
    let note = polling_note(&polling, None);
    Some(MouseMeasurement { polling, note })
}

// ── Stage 1-2: Capture core (processing) ─────────────────────────────────────────────────────────
// The elevated ETW kernel session (DPC/ISR + image-load via ferrisetw, fps.rs-helper pattern) is the
// data SOURCE: it produces raw `DpcSample`s + the trace's `LoadedModule` ranges. The logic below is
// the dual-session PROCESSING — pure + testable, no elevation:
//   • always-on-light → `tally_drivers`: per-driver counts + max/total durations, integer-only work.
//   • spike-triggered-heavy → `collect_spikes`: attributed `LatencyEvent`s for stutter-class samples,
//     which feed the Stage-3 Correlate engine directly.
// The elevated session that emits the samples slots onto HQ's helper as the integration step (it
// needs admin + the shared entry point); this core is built + verified ahead of it.

/// Authored dual-session tunables (the "capture spec"). Defaults chosen here, documented.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub(crate) struct CaptureConfig {
    /// A DPC/ISR at or above this is "stutter-class" → recorded in heavy detail. 500µs default
    /// (a 0.5ms+ interrupt routine is a real frame-time risk even at high refresh).
    pub spike_threshold_us: f64,
    /// Upper bound on heavy-detail events retained for correlation (the ring-buffer size).
    pub heavy_ring_capacity: usize,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self { spike_threshold_us: 500.0, heavy_ring_capacity: 4096 }
    }
}

/// A raw DPC/ISR sample, as the ETW callback hands it over (before attribution).
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub(crate) struct DpcSample {
    pub timestamp_ms: f64,
    pub duration_us: f64,
    /// Return address of the routine that ran — resolved to a module via image-load ranges.
    pub return_address: u64,
}

/// A loaded driver/module image range, from the trace's image-load events. Name only (no symbols).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct LoadedModule {
    pub name: String,
    pub base: u64,
    pub size: u64,
}

/// Per-driver tally — the always-on-light output.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct DriverLatencyStat {
    pub driver: String,
    pub count: usize,
    pub max_us: f64,
    pub total_us: f64,
}

/// Pure: resolve a return address to its owning module (address in `[base, base+size)`). The design's
/// "builder's gift" — image-load events give the module NAME, so we skip the symbol-server rabbit hole.
pub(crate) fn attribute_module(return_address: u64, modules: &[LoadedModule]) -> Option<String> {
    modules
        .iter()
        .find(|m| return_address >= m.base && return_address < m.base.saturating_add(m.size))
        .map(|m| m.name.clone())
}

/// Pure: the spike trigger — is this sample stutter-class (worth heavy detail)?
pub(crate) fn is_spike(sample: &DpcSample, cfg: &CaptureConfig) -> bool {
    sample.duration_us >= cfg.spike_threshold_us
}

/// Pure: the always-on-light view — per-driver counts + max/total durations, worst (max) first.
/// Samples whose address matches no known module tally under "(unknown)".
pub(crate) fn tally_drivers(samples: &[DpcSample], modules: &[LoadedModule]) -> Vec<DriverLatencyStat> {
    let mut by: HashMap<String, DriverLatencyStat> = HashMap::new();
    for s in samples {
        let driver = attribute_module(s.return_address, modules).unwrap_or_else(|| "(unknown)".into());
        let e = by
            .entry(driver.clone())
            .or_insert(DriverLatencyStat { driver, count: 0, max_us: 0.0, total_us: 0.0 });
        e.count += 1;
        e.total_us += s.duration_us;
        if s.duration_us > e.max_us {
            e.max_us = s.duration_us;
        }
    }
    let mut out: Vec<DriverLatencyStat> = by.into_values().collect();
    out.sort_by(|a, b| b.max_us.total_cmp(&a.max_us).then(b.total_us.total_cmp(&a.total_us)));
    out
}

/// Pure: bridge a sample into a `LatencyEvent` for the Stage-3 Correlate engine.
pub(crate) fn sample_to_latency_event(sample: &DpcSample, modules: &[LoadedModule]) -> LatencyEvent {
    LatencyEvent {
        timestamp_ms: sample.timestamp_ms,
        duration_us: sample.duration_us,
        driver: attribute_module(sample.return_address, modules).unwrap_or_else(|| "(unknown)".into()),
    }
}

/// Pure: the spike-triggered-heavy view — attributed `LatencyEvent`s for stutter-class samples,
/// worst-first and bounded to the ring capacity. This is the bridge that feeds `correlate_stutters`.
pub(crate) fn collect_spikes(
    samples: &[DpcSample],
    modules: &[LoadedModule],
    cfg: &CaptureConfig,
) -> Vec<LatencyEvent> {
    let mut spikes: Vec<LatencyEvent> = samples
        .iter()
        .filter(|s| is_spike(s, cfg))
        .map(|s| sample_to_latency_event(s, modules))
        .collect();
    spikes.sort_by(|a, b| b.duration_us.total_cmp(&a.duration_us));
    spikes.truncate(cfg.heavy_ring_capacity);
    spikes
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

    // ── "Name the guilty device" receipts (sprint item 5) ─────────────────────────────────────

    #[test]
    fn line_irq_receipts_name_only_verified_offenders_worst_first() {
        let devices = vec![
            dev_full("USB Host Controller", false, "a", Some(false)), // not sensitive, no MSI claim
            dev_full("Intel Ethernet I226-V", true, "b", Some(false)), // sensitive + advertises = worst
            dev_full("NVIDIA GeForce RTX 3060 Ti", false, "c", Some(false)), // sensitive
            dev_full("Audio Device", true, "d", Some(true)),          // active on MSI — innocent
            dev_full("Mystery Device", true, "e", None),              // UNKNOWN — never accused
        ];
        let r = line_irq_receipts(&devices);
        assert_eq!(r.len(), 3, "only verified line-IRQ devices are named");
        assert_eq!(r[0].name, "Intel Ethernet I226-V", "sensitive + advertised-but-inactive first");
        assert!(r[0].advertises_msi && r[0].latency_sensitive);
        assert_eq!(r[1].name, "NVIDIA GeForce RTX 3060 Ti");
        assert_eq!(r[2].name, "USB Host Controller");
        assert!(!r.iter().any(|x| x.name == "Mystery Device"), "unknown state is not an accusation");
    }

    #[test]
    fn line_irq_receipts_empty_when_everything_is_clean_or_unknown() {
        let devices = vec![dev_full("GPU", true, "a", Some(true)), dev("NIC", true)];
        assert!(line_irq_receipts(&devices).is_empty());
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

    #[test]
    fn affinity_device_suggestion_names_sensitive_devices_only_on_multi_complex() {
        let devs = [
            dev("AMD Radeon RX 9070 XT", true),
            dev("Realtek Gaming GbE", true),
            dev("High Definition Audio Bus", true),
        ];
        // Multi-complex + latency-sensitive devices → a NAMED suggestion that's explicit it's manual/read-only.
        let s = affinity_device_suggestion(&topo(16, 32, 2), &devs).expect("multi-complex suggestion");
        assert!(s.contains("Radeon") || s.contains("GbE"), "names a latency-sensitive device");
        assert!(s.contains("never writes it"), "honest: Compy does not write affinity");
        assert!(s.contains("gain is small"), "honest: sets the expectation low");
        assert!(!s.contains("Audio"), "non-latency-sensitive devices are not named");
        // Single-complex → None (nothing to steer between — matches the credibility gate).
        assert!(affinity_device_suggestion(&topo(8, 16, 1), &devs).is_none());
        // Multi-complex but no latency-sensitive device → None (never suggest a tweak with no target).
        assert!(affinity_device_suggestion(&topo(16, 32, 2), &[dev("USB Audio Bus", true)]).is_none());
        assert!(affinity_device_suggestion(&topo(16, 32, 2), &[]).is_none());
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

    fn idev(id: &str, name: &str, kind: DeviceKind) -> InputDevice {
        let id = id.to_uppercase();
        InputDevice { vid_pid: parse_vid_pid(&id), name: name.into(), device_id: id, kind }
    }

    #[test]
    fn vid_pid_extracts_and_uppercases() {
        assert_eq!(parse_vid_pid(r"HID\VID_1532&PID_00b8&MI_00\A&1").as_deref(), Some("VID_1532&PID_00B8"));
        assert_eq!(parse_vid_pid(r"USB\VID_046d&PID_c33a\X").as_deref(), Some("VID_046D&PID_C33A"));
        assert_eq!(parse_vid_pid(r"USB\ROOT_HUB30\5&1723FB54&0&0"), None); // a hub, no VID/PID
    }

    #[test]
    fn classify_separates_streaming_from_quiet() {
        assert_eq!(classify_device_kind("Mouse", "HID-compliant mouse"), Some(DeviceKind::HighRate));
        assert_eq!(classify_device_kind("Keyboard", "HID Keyboard Device"), Some(DeviceKind::Quiet));
        assert_eq!(classify_device_kind("HIDClass", "System Control"), Some(DeviceKind::Quiet));
        assert_eq!(classify_device_kind("MEDIA", "USB Audio"), Some(DeviceKind::Streaming));
        // A wireless-headset dongle's HID collection still classifies as streaming via name.
        assert_eq!(classify_device_kind("HIDClass", "Arctis 7 Headset"), Some(DeviceKind::Streaming));
        assert_eq!(classify_device_kind("Image", "Logitech Webcam"), Some(DeviceKind::Streaming));
        assert_eq!(classify_device_kind("Net", "Ethernet"), None);
    }

    #[test]
    fn group_dedups_by_vidpid_attributes_and_prefers_specific_name() {
        let controllers = HashMap::from([
            ("PCIA".to_string(), "AMD USB 3.10".to_string()),
            ("PCIB".to_string(), "ASMedia USB 3.20".to_string()),
        ]);
        let edges = HashMap::from([
            (r"USB\VID_1532&PID_00B8&MI_00\X".to_uppercase(), "PCIA".to_string()),
            (r"HID\VID_1532&PID_00B8&MI_00\Y".to_uppercase(), "PCIA".to_string()),
            (r"HID\VID_046D&PID_C33A\Z".to_uppercase(), "PCIA".to_string()),
            (r"HID\VID_AAAA&PID_BBBB\W".to_uppercase(), "PCIB".to_string()),
        ]);
        let inputs = [
            idev(r"USB\VID_1532&PID_00B8&MI_00\X", "USB Input Device", DeviceKind::Quiet), // generic node
            idev(r"HID\VID_1532&PID_00B8&MI_00\Y", "HID-compliant mouse", DeviceKind::HighRate), // same device
            idev(r"HID\VID_046D&PID_C33A\Z", "HID Keyboard Device", DeviceKind::Quiet),
            idev(r"HID\VID_AAAA&PID_BBBB\W", "Lonely Pad", DeviceKind::Quiet),
        ];
        let loads = group_input_devices_by_controller(&controllers, &edges, &inputs);
        assert_eq!(loads.len(), 2);
        // Most-loaded first.
        assert_eq!(loads[0].controller_id, "PCIA");
        assert_eq!(loads[0].input_devices.len(), 2); // mouse + keyboard, mouse deduped to one
        assert!(loads[0].is_shared());
        assert!(loads[0].has_high_rate_input); // the mouse collection wins the per-VID&PID max-kind
        assert!(loads[0].streaming_neighbors.is_empty());
        assert_eq!(loads[0].severity(), "info"); // high-rate + only quiet neighbors → Info, not amber
        assert!(loads[0].input_devices.contains(&"HID-compliant mouse".to_string())); // specific wins
        assert!(!loads[0].input_devices.contains(&"USB Input Device".to_string()));
        // The single-device controller is not shared.
        assert_eq!(loads[1].controller_id, "PCIB");
        assert!(!loads[1].is_shared());
        assert_eq!(loads[1].severity(), "none");
    }

    #[test]
    fn advisory_is_info_for_quiet_sharing_and_attention_for_streaming() {
        // Mouse + keyboard (quiet) → benign INFO copy, no alarm language.
        let quiet = vec![UsbControllerLoad {
            controller_name: "AMD USB 3.10".into(),
            controller_id: "PCIA".into(),
            input_devices: vec!["HID-compliant mouse".into(), "HID Keyboard Device".into()],
            streaming_neighbors: vec![],
            has_high_rate_input: true,
        }];
        assert_eq!(quiet[0].severity(), "info");
        let a = shared_controller_advisory(&quiet).expect("advisory present");
        assert!(a.contains("Harmless"));
        assert!(a.contains("AMD USB 3.10"));

        // Mouse + streaming audio dongle → actionable ATTENTION copy that names both + the fix.
        let streaming = vec![UsbControllerLoad {
            controller_name: "AMD USB 3.10".into(),
            controller_id: "PCIA".into(),
            input_devices: vec!["HID-compliant mouse".into()],
            streaming_neighbors: vec!["Arctis 7 Headset".into()],
            has_high_rate_input: true,
        }];
        assert_eq!(streaming[0].severity(), "attention");
        let b = shared_controller_advisory(&streaming).expect("advisory present");
        assert!(b.contains("Move either"));
        assert!(b.contains("Arctis 7 Headset"));

        // Solo controller → nothing to say.
        let solo = vec![UsbControllerLoad {
            controller_name: "Solo".into(),
            controller_id: "PCIB".into(),
            input_devices: vec!["Lonely Pad".into()],
            streaming_neighbors: vec![],
            has_high_rate_input: false,
        }];
        assert!(shared_controller_advisory(&solo).is_none());
    }

    #[test]
    fn wired_vs_wireless_fires_only_on_a_clear_wireless_name() {
        let ctrl = |inputs: Vec<&str>| {
            vec![UsbControllerLoad {
                controller_name: "USB 3.10".into(),
                controller_id: "PCIA".into(),
                input_devices: inputs.into_iter().map(String::from).collect(),
                streaming_neighbors: vec![],
                has_high_rate_input: true,
            }]
        };
        // Clear wireless indicators → advisory naming the device + the honest model.
        let a = wired_vs_wireless_advisory(&ctrl(vec!["Logitech USB Receiver"])).expect("wireless");
        assert!(a.contains("Logitech USB Receiver") && a.contains("2.4 GHz"));
        assert!(wired_vs_wireless_advisory(&ctrl(vec!["G Pro Wireless"])).is_some());
        assert!(wired_vs_wireless_advisory(&ctrl(vec!["Razer HyperSpeed Mouse"])).is_some());
        assert!(wired_vs_wireless_advisory(&ctrl(vec!["Bluetooth Keyboard"])).is_some());
        // No clear indicator → None (never asserts "wired" we can't verify).
        assert!(wired_vs_wireless_advisory(&ctrl(vec!["HID-compliant mouse"])).is_none());
        assert!(wired_vs_wireless_advisory(&ctrl(vec!["Razer Viper", "HID Keyboard Device"])).is_none());
        assert!(wired_vs_wireless_advisory(&[]).is_none());
    }

    #[test]
    fn usb_tier_advisory_is_honest_and_tailored() {
        let load = |inputs: Vec<&str>, streaming: Vec<&str>, hr: bool| {
            vec![UsbControllerLoad {
                controller_name: "Host".into(),
                controller_id: "PCIA".into(),
                input_devices: inputs.into_iter().map(String::from).collect(),
                streaming_neighbors: streaming.into_iter().map(String::from).collect(),
                has_high_rate_input: hr,
            }]
        };
        let mouse = load(vec!["HID-compliant mouse"], vec![], true);

        // Unknown tier → never fabricate a tier claim.
        assert!(usb_tier_advisory(None, &mouse).is_none());

        // Tier known but no USB input device detected → nothing peripheral-relevant to say.
        assert!(usb_tier_advisory(Some("USB4"), &[]).is_none());

        // USB 3.x / USB4 → the myth-buster (a faster port doesn't raise polling rate), names the tier.
        let u4 = usb_tier_advisory(Some("USB4"), &mouse).expect("tier note");
        assert!(u4.contains("USB4"));
        assert!(u4.contains("does NOT raise a mouse's polling rate"));
        assert!(u4.contains("isn't readable in user-mode"));
        let u32 = usb_tier_advisory(Some("USB 3.2"), &mouse).expect("tier note");
        assert!(u32.contains("USB 3.2") && u32.contains("polling rate"));

        // USB 2.0 → "fine for input" + the tier-level caveat (bandwidth-hungry devices, not input).
        let two = usb_tier_advisory(Some("USB 2.0"), &mouse).expect("tier note");
        assert!(two.contains("top out at USB 2.0"));
        assert!(two.contains("genuinely fine"));
        assert!(two.contains("USB audio interface")); // generic device examples
        assert!(two.contains("isn't readable in user-mode"));

        // The tier advisory owns the TIER dimension only: it must NEVER name a specific device or
        // re-issue a "move device X" instruction — that's shared_controller_advisory's job (no dup).
        let two_shared =
            usb_tier_advisory(Some("USB 2.0"), &load(vec!["HID-compliant mouse"], vec!["Arctis Headset"], true))
                .expect("tier note");
        assert!(!two_shared.contains("Arctis Headset"));
        assert!(!two_shared.to_lowercase().contains("give it its own"));
    }

    #[test]
    fn wireless_name_match_is_conservative() {
        assert!(is_wireless_input_name("Logitech G305 LIGHTSPEED"));
        assert!(is_wireless_input_name("USB Receiver"));
        assert!(is_wireless_input_name("Bluetooth Low Energy Mouse"));
        // Wired devices must never match (a false "wireless" claim is the failure to avoid).
        assert!(!is_wireless_input_name("Razer DeathAdder V3"));
        assert!(!is_wireless_input_name("HID-compliant mouse"));
        assert!(!is_wireless_input_name("Corsair K70 Keyboard"));
    }

    #[test]
    fn usb_topology_reads_without_panic() {
        // Real machine → controllers with input devices; sandbox → empty. Must never panic, and
        // every reported device list is non-empty (we only include controllers hosting inputs).
        let loads = read_usb_topology();
        eprintln!("LIVE usb topology = {} controller(s) hosting input devices", loads.len());
        for l in &loads {
            eprintln!("  {} [shared={}]: {:?}", l.controller_name, l.is_shared(), l.input_devices);
            assert!(!l.input_devices.is_empty());
        }
    }

    #[test]
    fn polling_summary_needs_two_timestamps() {
        assert!(summarize_polling(&[]).is_none());
        assert!(summarize_polling(&[5.0]).is_none());
    }

    #[test]
    fn polling_summary_computes_rate_and_extents() {
        // 1ms intervals → 1000 Hz.
        let p = summarize_polling(&[0.0, 1.0, 2.0, 3.0]).expect("rate");
        assert_eq!(p.reports, 4);
        assert!((p.median_hz - 1000.0).abs() < 0.001);
        assert!((p.min_interval_ms - 1.0).abs() < 0.001);
        assert!((p.max_interval_ms - 1.0).abs() < 0.001);
        assert_eq!(p.jitter_ms, 0.0);
        // 0.125ms intervals → 8000 Hz.
        let fast = summarize_polling(&[0.0, 0.125, 0.25]).expect("rate");
        assert!((fast.median_hz - 8000.0).abs() < 0.001);
    }

    #[test]
    fn polling_note_flags_underperformance_vs_claim() {
        let slow = PollingRate { reports: 500, median_hz: 600.0, min_interval_ms: 1.0, max_interval_ms: 3.0, jitter_ms: 0.4 };
        let n = polling_note(&slow, Some(1000));
        assert!(n.contains("below the advertised 1000"));
        let ok = PollingRate { reports: 900, median_hz: 980.0, min_interval_ms: 0.9, max_interval_ms: 1.2, jitter_ms: 0.05 };
        assert!(polling_note(&ok, Some(1000)).contains("In line with the advertised 1000"));
        assert!(polling_note(&ok, None).contains("effective rate Windows actually delivered"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn mouse_polling_capture_never_panics() {
        // Short window with (likely) no movement → None, but the full Win32/Raw-Input path must run
        // cleanly and tear down without panic. (Some only if the mouse happens to move during it.)
        let _ = measure_mouse_polling(120);
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "interactive: run with --ignored --nocapture and MOVE THE MOUSE during the window"]
    fn zz_live_mouse_polling() {
        eprintln!("\n>>> MOVE YOUR MOUSE CONTINUOUSLY for 6 seconds — starting now...");
        let p = measure_mouse_polling(6000);
        match p {
            Some(p) => eprintln!(">>> LIVE polling = {:?}\n>>> {}", p, polling_note(&p, None)),
            None => eprintln!(">>> LIVE polling = no reports (did the mouse move?)"),
        }
    }

    fn ev(t: f64, us: f64, drv: &str) -> LatencyEvent {
        LatencyEvent { timestamp_ms: t, duration_us: us, driver: drv.into() }
    }

    fn modules() -> Vec<LoadedModule> {
        vec![
            LoadedModule { name: "rtwlane.sys".into(), base: 0x1000, size: 0x1000 }, // [0x1000,0x2000)
            LoadedModule { name: "nvlddmkm.sys".into(), base: 0x5000, size: 0x2000 }, // [0x5000,0x7000)
        ]
    }

    fn dpc(t: f64, us: f64, addr: u64) -> DpcSample {
        DpcSample { timestamp_ms: t, duration_us: us, return_address: addr }
    }

    #[test]
    fn attribute_maps_address_to_module_with_exclusive_end() {
        let m = modules();
        assert_eq!(attribute_module(0x1000, &m).as_deref(), Some("rtwlane.sys")); // base inclusive
        assert_eq!(attribute_module(0x1FFF, &m).as_deref(), Some("rtwlane.sys"));
        assert_eq!(attribute_module(0x2000, &m), None); // base+size exclusive
        assert_eq!(attribute_module(0x6000, &m).as_deref(), Some("nvlddmkm.sys"));
        assert_eq!(attribute_module(0x9999, &m), None); // no module
    }

    #[test]
    fn spike_trigger_respects_threshold() {
        let cfg = CaptureConfig::default(); // 500µs
        assert!(!is_spike(&dpc(0.0, 499.0, 0x1000), &cfg));
        assert!(is_spike(&dpc(0.0, 500.0, 0x1000), &cfg)); // boundary is stutter-class
        assert!(is_spike(&dpc(0.0, 900.0, 0x1000), &cfg));
    }

    #[test]
    fn tally_aggregates_per_driver_worst_first_with_unknown_bucket() {
        let m = modules();
        let samples = [
            dpc(0.0, 200.0, 0x1100), // rtwlane
            dpc(1.0, 900.0, 0x1100), // rtwlane (max 900, total 1100, count 2)
            dpc(2.0, 600.0, 0x6000), // nvlddmkm (max 600)
            dpc(3.0, 50.0, 0xDEAD),  // unattributed
        ];
        let stats = tally_drivers(&samples, &m);
        assert_eq!(stats.len(), 3);
        assert_eq!(stats[0].driver, "rtwlane.sys"); // worst max first
        assert_eq!(stats[0].count, 2);
        assert_eq!(stats[0].max_us, 900.0);
        assert_eq!(stats[0].total_us, 1100.0);
        assert!(stats.iter().any(|s| s.driver == "(unknown)" && s.count == 1));
    }

    #[test]
    fn collect_spikes_filters_attributes_sorts_and_bounds() {
        let m = modules();
        let samples = [
            dpc(10.0, 300.0, 0x1100), // below threshold → dropped
            dpc(11.0, 700.0, 0x1100), // rtwlane
            dpc(12.0, 1500.0, 0x6000), // nvlddmkm (biggest)
        ];
        let cfg = CaptureConfig { spike_threshold_us: 500.0, heavy_ring_capacity: 10 };
        let spikes = collect_spikes(&samples, &m, &cfg);
        assert_eq!(spikes.len(), 2); // the 300µs one filtered out
        assert_eq!(spikes[0].driver, "nvlddmkm.sys"); // worst first
        assert_eq!(spikes[0].duration_us, 1500.0);
        // capacity bound
        let tiny = CaptureConfig { spike_threshold_us: 500.0, heavy_ring_capacity: 1 };
        assert_eq!(collect_spikes(&samples, &m, &tiny).len(), 1);
    }

    #[test]
    fn end_to_end_capture_to_correlate_names_the_culprit() {
        // The full pure pipeline: raw DPC samples + modules → spikes → correlate with a frame stutter
        // → headline culprit. Proves Stage 1-2 feeds Stage 3 cleanly.
        let m = modules();
        let samples = [
            dpc(96.0, 880.0, 0x1100),  // rtwlane, 880µs, just before the frame
            dpc(50.0, 120.0, 0x6000),  // small, far away
        ];
        let cfg = CaptureConfig::default();
        let events = collect_spikes(&samples, &m, &cfg); // → LatencyEvents
        let spikes = [FrameSpike { timestamp_ms: 100.0, frame_ms: 20.0 }];
        let causes = correlate_stutters(&spikes, &events, 6.0);
        let (driver, count) = top_stutter_culprit(&causes).expect("a culprit");
        assert_eq!(driver, "rtwlane.sys");
        assert_eq!(count, 1);
    }

    #[test]
    fn correlate_attributes_stutter_to_nearby_long_event() {
        // A 20ms frame presented at t=100; a 900µs NIC DPC fired at t=95 (within the frame+window).
        let spikes = [FrameSpike { timestamp_ms: 100.0, frame_ms: 20.0 }];
        let events = [ev(95.0, 900.0, "rtwlane.sys"), ev(40.0, 1200.0, "nvlddmkm.sys")];
        let causes = correlate_stutters(&spikes, &events, 5.0);
        assert_eq!(causes.len(), 1);
        assert!(causes[0].is_attributed());
        assert_eq!(causes[0].culprit_driver.as_deref(), Some("rtwlane.sys")); // the far event is out of window
        assert_eq!(causes[0].lag_ms, Some(5.0));
    }

    #[test]
    fn correlate_picks_longest_event_in_window() {
        let spikes = [FrameSpike { timestamp_ms: 200.0, frame_ms: 10.0 }];
        let events = [ev(195.0, 300.0, "short.sys"), ev(193.0, 1500.0, "long.sys")];
        let causes = correlate_stutters(&spikes, &events, 8.0);
        assert_eq!(causes[0].culprit_driver.as_deref(), Some("long.sys"));
        assert_eq!(causes[0].culprit_duration_us, Some(1500.0));
    }

    #[test]
    fn correlate_leaves_unexplained_stutter_unattributed() {
        // No event anywhere near the frame → honestly not attributed.
        let spikes = [FrameSpike { timestamp_ms: 500.0, frame_ms: 12.0 }];
        let events = [ev(50.0, 800.0, "far.sys")];
        let causes = correlate_stutters(&spikes, &events, 5.0);
        assert!(!causes[0].is_attributed());
        assert!(stutter_verdict(&causes[0]).contains("not attributed"));
    }

    #[test]
    fn top_culprit_finds_the_worst_offender() {
        let spikes = [
            FrameSpike { timestamp_ms: 100.0, frame_ms: 18.0 },
            FrameSpike { timestamp_ms: 200.0, frame_ms: 18.0 },
            FrameSpike { timestamp_ms: 300.0, frame_ms: 18.0 },
        ];
        let events = [
            ev(96.0, 900.0, "rtwlane.sys"),
            ev(196.0, 950.0, "rtwlane.sys"),
            ev(296.0, 400.0, "audio.sys"),
        ];
        let causes = correlate_stutters(&spikes, &events, 6.0);
        let (driver, count) = top_stutter_culprit(&causes).expect("a culprit");
        assert_eq!(driver, "rtwlane.sys");
        assert_eq!(count, 2);
    }

    #[test]
    fn top_culprit_none_when_nothing_attributed() {
        let spikes = [FrameSpike { timestamp_ms: 100.0, frame_ms: 18.0 }];
        let causes = correlate_stutters(&spikes, &[], 6.0);
        assert!(top_stutter_culprit(&causes).is_none());
    }

    #[test]
    fn stutter_verdict_names_driver_and_timing() {
        let spikes = [FrameSpike { timestamp_ms: 100.0, frame_ms: 22.0 }];
        let events = [ev(96.0, 880.0, "rtwlane.sys")];
        let v = stutter_verdict(&correlate_stutters(&spikes, &events, 6.0)[0]);
        assert!(v.contains("rtwlane.sys"));
        assert!(v.contains("880µs"));
        assert!(v.contains("22.0ms"));
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
