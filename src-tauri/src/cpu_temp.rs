//! CPU temperature via **interop** with a monitoring tool the user already runs.
//!
//! Compy installs NO kernel driver — that's the anti-cheat-safe / no-driver fundamental, and
//! real CPU die temp is only readable through ring-0 MSR access (every tool that shows it ships
//! its own driver; the common WinRing0 one is on Microsoft's vulnerable-driver blocklist and is
//! flagged by anti-cheat). So Compy never reads it directly — it only **displays** what a tool
//! the user already chose to install is publishing.
//!
//! Sources (all read-only interop, NO driver in Compy), tried in order by `read_cpu_temp_inner`:
//!   1. **HWiNFO** — its `Global\HWiNFO_SENS_SM2` shared-memory sensor block (most common with
//!      gamers), mapped read-only via `OpenFileMappingW`/`MapViewOfFile` (`read_hwinfo`, tried FIRST).
//!   2. **LibreHardwareMonitor / OpenHardwareMonitor** — their WMI namespaces (`read_ohm`).
//!
//! Each source exists only while that app is running. When NOTHING is publishing a value the CPU
//! temp is **unknown** — `read_cpu_temp` returns `None`, the honest "bring your own monitor" default;
//! Compy never fabricates a number.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
pub(crate) struct CpuTemp {
    pub temp_c: f64,
    /// The monitoring tool the reading came from — always shown, so the number is attributable.
    pub source: String,
    /// The sensor label, e.g. "CPU Package" or "Core (Tctl/Tdie)".
    pub label: String,
}

/// A fan reading from a user-installed monitor — same driver-free interop as CpuTemp. RPM > 0 means
/// the fan is spinning (on/working); we never fabricate one.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct FanSensor {
    /// Label as the monitor reports it, e.g. "CPU Fan", "Fan #2", "GPU Fan".
    pub label: String,
    /// Live speed in RPM.
    pub rpm: u32,
    /// The monitor the reading came from — always shown, so it's attributable.
    pub source: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct OhmSensor {
    name: String,
    value: f32,
    identifier: String,
}

/// Read CPU temp from a user-installed tool, if one is publishing. WMI runs on an MTA worker
/// thread (the COM-apartment fix); tries each known source and returns the first hit.
pub(crate) fn read_cpu_temp() -> Option<CpuTemp> {
    crate::hardware::on_wmi_thread(read_cpu_temp_inner)
}

fn read_cpu_temp_inner() -> Option<CpuTemp> {
    // HWiNFO (shared memory) first — most common with gamers; then the OHM/LHM WMI namespaces.
    if let Some(t) = read_hwinfo() {
        return Some(t);
    }
    for ns in ["LibreHardwareMonitor", "OpenHardwareMonitor"] {
        if let Some(t) = read_ohm(ns) {
            return Some(t);
        }
    }
    None
}

fn read_ohm(ns: &str) -> Option<CpuTemp> {
    let com = wmi::COMLibrary::new().ok()?;
    let conn = wmi::WMIConnection::with_namespace_path(&format!("root\\{ns}"), com).ok()?;
    let sensors: Vec<OhmSensor> = conn
        .raw_query(
            "SELECT Name, Value, Identifier FROM Sensor WHERE SensorType = 'Temperature'",
        )
        .ok()?;

    // CPU sensors only (their identifier looks like `/amdcpu/0/...` or `/intelcpu/0/...`), with a
    // sane-range guard so a bogus reading can't surface.
    let cpu: Vec<&OhmSensor> = sensors
        .iter()
        .filter(|s| {
            s.identifier.to_lowercase().contains("cpu")
                && s.value.is_finite()
                && s.value > 0.0
                && s.value < 150.0
        })
        .collect();
    if cpu.is_empty() {
        return None;
    }

    // Prefer a package / Tctl / Tdie sensor (the headline CPU temp); else the hottest CPU core.
    let pick = cpu
        .iter()
        .find(|s| {
            let n = s.name.to_lowercase();
            n.contains("package") || n.contains("tctl") || n.contains("tdie")
        })
        .copied()
        .or_else(|| cpu.iter().copied().max_by(|a, b| a.value.total_cmp(&b.value)))?;

    Some(CpuTemp {
        temp_c: pick.value as f64,
        source: ns.to_string(),
        label: pick.name.clone(),
    })
}

// ── Fan readout (same driver-free interop; no kernel driver) ──────────────────
/// Read every fan a user-installed monitor is publishing (HWiNFO shared memory, then LHM/OHM WMI).
/// Returns [] when nothing is publishing — the honest "bring your own monitor" default.
pub(crate) fn read_fans() -> Vec<FanSensor> {
    crate::hardware::on_wmi_thread(read_fans_inner)
}

fn read_fans_inner() -> Vec<FanSensor> {
    let hw = read_fans_hwinfo();
    if !hw.is_empty() {
        return hw;
    }
    for ns in ["LibreHardwareMonitor", "OpenHardwareMonitor"] {
        let f = read_fans_ohm(ns);
        if !f.is_empty() {
            return f;
        }
    }
    Vec::new()
}

fn read_fans_ohm(ns: &str) -> Vec<FanSensor> {
    let Ok(com) = wmi::COMLibrary::new() else {
        return Vec::new();
    };
    let Ok(conn) = wmi::WMIConnection::with_namespace_path(&format!("root\\{ns}"), com) else {
        return Vec::new();
    };
    let sensors: Vec<OhmSensor> = conn
        .raw_query("SELECT Name, Value, Identifier FROM Sensor WHERE SensorType = 'Fan'")
        .unwrap_or_default();
    sensors
        .iter()
        .filter(|s| s.value.is_finite() && (0.0..20000.0).contains(&s.value))
        .map(|s| FanSensor {
            label: s.name.clone(),
            rpm: s.value.round() as u32,
            source: ns.to_string(),
        })
        .collect()
}

const HWI_SENSOR_TYPE_FAN: u32 = 3;

fn read_fans_hwinfo() -> Vec<FanSensor> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Memory::{
        MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_READ,
    };
    for name in ["Global\\HWiNFO_SENS_SM2", "HWiNFO_SENS_SM2"] {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let Ok(handle) = OpenFileMappingW(FILE_MAP_READ.0, false, PCWSTR(wide.as_ptr())) else {
                continue;
            };
            let view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
            let fans = if view.Value.is_null() {
                Vec::new()
            } else {
                let len = mapped_region_size(view.Value as *const u8);
                let f = parse_hwinfo_fans(view.Value as *const u8, len);
                let _ = UnmapViewOfFile(view);
                f
            };
            let _ = CloseHandle(handle);
            if !fans.is_empty() {
                return fans;
            }
        }
    }
    Vec::new()
}

/// Actual byte size of a mapped view, via `VirtualQuery`. `MapViewOfFile(..,0)` maps to the end of
/// the section but never tells us how big that is; a hostile process can publish a tiny
/// `HWiNFO_SENS_SM2` section with a header claiming a huge `num_reading`, so the mapped size — NOT
/// the header's self-reported counts — is the authority for every bounds check. Returns 0 on failure
/// (⇒ callers fail soft). The OS page-rounds a mapped view and zero-fills the tail, so reads within
/// this size can never fault or leak another process's memory.
unsafe fn mapped_region_size(base: *const u8) -> usize {
    use windows::Win32::System::Memory::{VirtualQuery, MEMORY_BASIC_INFORMATION};
    let mut mbi = MEMORY_BASIC_INFORMATION::default();
    let n = VirtualQuery(
        Some(base as *const core::ffi::c_void),
        &mut mbi,
        std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
    );
    if n == 0 {
        0
    } else {
        mbi.RegionSize
    }
}

/// Validate the HWiNFO header against the ACTUAL mapped `len` and return the reading layout
/// `(offset, size_elem, num)` only when EVERY element read is provably in-bounds. `None` (fail-soft)
/// on any mismatch. Shared by the temp + fan parsers so the untrusted-input bounds contract lives in
/// exactly one place. `off + num*size_elem <= len` is checked with overflow-safe arithmetic so a
/// crafted header can't wrap a huge span into a small in-range value; because `size_elem >=
/// size_of::<HwiReading>()`, that single check bounds the last element's full read.
unsafe fn hwinfo_reading_layout(base: *const u8, len: usize) -> Option<(usize, usize, usize)> {
    if len < std::mem::size_of::<HwiHeader>() {
        return None;
    }
    let sig4 = std::slice::from_raw_parts(base, 4);
    let sig_u32 = u32::from_le_bytes([sig4[0], sig4[1], sig4[2], sig4[3]]);
    if sig4 != b"SiWH" && sig4 != b"HWiS" && sig_u32 != 0x5369_5748 {
        return None;
    }
    let h: HwiHeader = std::ptr::read_unaligned(base as *const HwiHeader);
    let off = h.offset_reading as usize;
    let size_elem = h.size_reading_elem as usize;
    let num = h.num_reading as usize;
    if size_elem < std::mem::size_of::<HwiReading>()
        || off < std::mem::size_of::<HwiHeader>()
        || num == 0
        || num > 100_000
    {
        return None;
    }
    let end = num.checked_mul(size_elem).and_then(|span| off.checked_add(span))?;
    if end > len {
        return None;
    }
    Some((off, size_elem, num))
}

/// Parse fan readings (reading_type == Fan) from the mapped HWiNFO block. `len` = mapped size (the
/// bounds authority — see hwinfo_reading_layout). Validated, fail-soft.
unsafe fn parse_hwinfo_fans(base: *const u8, len: usize) -> Vec<FanSensor> {
    let Some((off, size_elem, num)) = hwinfo_reading_layout(base, len) else {
        return Vec::new();
    };
    let mut fans = Vec::new();
    for i in 0..num {
        let e: HwiReading =
            std::ptr::read_unaligned(base.add(off + i * size_elem) as *const HwiReading);
        if e.reading_type != HWI_SENSOR_TYPE_FAN {
            continue;
        }
        let label_bytes = e.label_orig;
        let label = cstr(&label_bytes);
        let v = e.value;
        if !v.is_finite() || !(0.0..20000.0).contains(&v) {
            continue;
        }
        fans.push(FanSensor {
            label,
            rpm: v.round() as u32,
            source: "HWiNFO".into(),
        });
    }
    fans
}

// ── HWiNFO shared-memory reader ──────────────────────────────────────────────
// HWiNFO publishes its sensors in a memory-mapped file when "Shared Memory Support" is enabled
// (Settings → Shared Memory Support; off by default, 12-h limit in the free build). We read it
// READ-ONLY — no driver of our own; HWiNFO's driver is the user's choice. Layout is the public,
// stable HWiNFO SDK format; the "SiWH" signature + element size are validated and any mismatch
// fails soft to None, so a format change can never surface garbage.

#[repr(C, packed)]
struct HwiHeader {
    signature: u32,
    version: u32,
    revision: u32,
    poll_time: i64,
    offset_sensor: u32,
    size_sensor_elem: u32,
    num_sensor: u32,
    offset_reading: u32,
    size_reading_elem: u32,
    num_reading: u32,
}

#[repr(C, packed)]
struct HwiReading {
    reading_type: u32,
    sensor_index: u32,
    reading_id: u32,
    label_orig: [u8; 128],
    label_user: [u8; 128],
    unit: [u8; 16],
    value: f64,
    value_min: f64,
    value_max: f64,
    value_avg: f64,
}

const HWI_SENSOR_TYPE_TEMP: u32 = 1;

fn read_hwinfo() -> Option<CpuTemp> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Memory::{
        MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_READ,
    };

    // "Global\..." when HWiNFO runs elevated, the bare name otherwise.
    for name in ["Global\\HWiNFO_SENS_SM2", "HWiNFO_SENS_SM2"] {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let Ok(handle) = OpenFileMappingW(FILE_MAP_READ.0, false, PCWSTR(wide.as_ptr())) else {
                continue;
            };
            let view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
            let result = if view.Value.is_null() {
                None
            } else {
                let len = mapped_region_size(view.Value as *const u8);
                let r = parse_hwinfo(view.Value as *const u8, len);
                let _ = UnmapViewOfFile(view);
                r
            };
            let _ = CloseHandle(handle);
            if result.is_some() {
                return result;
            }
        }
    }
    None
}

/// Parse the mapped HWiNFO block for the best CPU temperature reading. `len` = mapped size (the
/// bounds authority — see hwinfo_reading_layout). Validated + fail-soft. The signature is the DWORD
/// 'SiWH' (0x53695748); in memory its little-endian bytes read as "HWiS" — hwinfo_reading_layout
/// accepts either byte order AND the raw DWORD so an endianness quirk can't make us silently miss it.
unsafe fn parse_hwinfo(base: *const u8, len: usize) -> Option<CpuTemp> {
    let (off, size_elem, num) = hwinfo_reading_layout(base, len)?;
    let mut best: Option<(f64, String)> = None;
    let mut best_is_pkg = false;
    for i in 0..num {
        let e: HwiReading =
            std::ptr::read_unaligned(base.add(off + i * size_elem) as *const HwiReading);
        if e.reading_type != HWI_SENSOR_TYPE_TEMP {
            continue;
        }
        let label_bytes = e.label_orig; // copy out of the packed struct before borrowing
        let label = cstr(&label_bytes);
        let l = label.to_lowercase();
        // CPU temps: AMD's headline is "CPU (Tctl/Tdie)", Intel's "CPU Package"; also accept
        // Tctl/Tdie/CCD labels — but never a GPU sensor.
        if l.contains("gpu") || !(l.contains("cpu") || l.contains("tctl") || l.contains("tdie")) {
            continue;
        }
        let v = e.value;
        if !v.is_finite() || v <= 0.0 || v >= 150.0 {
            continue;
        }
        let is_pkg = l.contains("package") || l.contains("tctl") || l.contains("tdie");
        let take = match &best {
            None => true,
            Some((bv, _)) => (is_pkg && !best_is_pkg) || (is_pkg == best_is_pkg && v > *bv),
        };
        if take {
            best = Some((v, label));
            best_is_pkg = is_pkg;
        }
    }
    best.map(|(temp_c, label)| CpuTemp { temp_c, source: "HWiNFO".into(), label })
}

fn cstr(buf: &[u8]) -> String {
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

// ── Sensor-source status: what the user can DO when nothing is publishing (Q9c) ──────────────────
//
// With no monitor running, the CPU-temp row used to render one sentence telling the user to go run
// one. That is a dead end, and it breaks the name-it-AND-fix-it-inline law. Compy can observe enough
// read-only to make it an OFFER instead: installed but not running (start it) · running but not
// publishing (HWiNFO's "Shared Memory Support" is off — by far the most common cause, and the free
// version resets it roughly every 12 hours) · not installed at all (link the download).
//
// Boundaries this respects, deliberately:
//   - READ-ONLY observation: process image names, fixed install roots, HKLM `App Paths` (writable by
//     admins only), and whether the shared-memory section opens. No registry WRITE, no service, no
//     Windows state change — this module stays outside the mutation boundary by construction.
//   - COMPY NEVER ELEVATES FOR THIS. Starting the app is handed to the shell (`explorer.exe <path>`,
//     the idiom history.rs/export.rs already use). If the app's OWN manifest wants admin, Windows
//     shows HWiNFO's prompt — Compy asks for no privilege it doesn't already hold, and runs no
//     elevated command of its own.
//   - The UI passes a catalog ID, never a path. Every launchable path is resolved HERE from fixed
//     roots, and its file name must be one this module names.
//   - Copy lives in the frontend i18n; this is DATA ONLY. Both locales then describe one observed
//     state, and neither can drift into a claim the backend never made.

/// One supported sensor app, as Compy can honestly observe it from user mode.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct SensorAppStatus {
    /// Closed-catalog id the UI keys its copy and actions off: `"hwinfo"` | `"lhm"`.
    pub id: String,
    /// A process of this app is running right now.
    pub running: bool,
    /// It is publishing readings Compy can read right now. `running && !publishing` is the
    /// actionable case — HWiNFO with Shared Memory Support switched off.
    pub publishing: bool,
    /// An executable was resolved on disk, so `launch_sensor_app` has something to start.
    pub launchable: bool,
    /// Present on this PC at all (running, publishing, or found on disk).
    pub installed: bool,
}

/// The read-only picture behind the CPU-temp offer.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct SensorSourceReport {
    pub apps: Vec<SensorAppStatus>,
    /// How many processes the scan actually saw. `0` means the scan did not run, so `running:
    /// false` means UNKNOWN, not "no" — the UI must not claim "not installed" off a scan that never
    /// happened. Same coverage-honesty contract as `overlay_tools::OverlayScan::scanned`.
    pub scanned: usize,
}

/// One catalog entry. Everything here is a compile-time constant: no path, name or key in this
/// struct can come from the webview, the ledger or a file.
struct SensorAppSpec {
    id: &'static str,
    /// Exact process image names, matched case-insensitively (never a substring).
    processes: &'static [&'static str],
    /// The ONLY executable file names this module will ever start.
    executables: &'static [&'static str],
    /// `(environment root, path under it)` — fixed default install locations.
    install_paths: &'static [(&'static str, &'static str)],
    /// `HKLM\...\App Paths\<name>` entries, for a non-default install directory. HKLM is
    /// admin-writable only, and the resolved path is still name-checked against `executables`.
    app_paths: &'static [&'static str],
}

const SENSOR_APPS: &[SensorAppSpec] = &[
    SensorAppSpec {
        id: "hwinfo",
        processes: &["HWiNFO64.EXE", "HWiNFO32.EXE", "HWiNFO.EXE"],
        executables: &["HWiNFO64.EXE", "HWiNFO32.EXE", "HWiNFO.EXE"],
        install_paths: &[
            ("ProgramFiles", "HWiNFO64\\HWiNFO64.EXE"),
            ("ProgramW6432", "HWiNFO64\\HWiNFO64.EXE"),
            ("ProgramFiles(x86)", "HWiNFO64\\HWiNFO64.EXE"),
            ("ProgramFiles(x86)", "HWiNFO32\\HWiNFO32.EXE"),
        ],
        app_paths: &["HWiNFO64.EXE", "HWiNFO32.EXE"],
    },
    SensorAppSpec {
        id: "lhm",
        processes: &["LibreHardwareMonitor.exe", "OpenHardwareMonitor.exe"],
        executables: &["LibreHardwareMonitor.exe", "OpenHardwareMonitor.exe"],
        // LibreHardwareMonitor ships as a portable zip far more often than as an installer, so the
        // fixed roots below are a best effort: when it isn't found the offer degrades to the
        // download link, never to a wrong claim.
        install_paths: &[
            ("ProgramFiles", "LibreHardwareMonitor\\LibreHardwareMonitor.exe"),
            ("ProgramW6432", "LibreHardwareMonitor\\LibreHardwareMonitor.exe"),
            ("ProgramFiles(x86)", "LibreHardwareMonitor\\LibreHardwareMonitor.exe"),
            // data-root-allow: a third-party app's own install root, not a Compy data path.
            ("LOCALAPPDATA", "Programs\\LibreHardwareMonitor\\LibreHardwareMonitor.exe"),
            ("ProgramFiles", "OpenHardwareMonitor\\OpenHardwareMonitor.exe"),
        ],
        app_paths: &["LibreHardwareMonitor.exe"],
    },
];

fn spec_for_id(id: &str) -> Option<&'static SensorAppSpec> {
    SENSOR_APPS.iter().find(|a| a.id == id)
}

/// Pure: is one catalog app among the running process image names? Exact, case-insensitive match —
/// a substring match would count an unrelated helper process and fabricate a state.
fn app_is_running(spec: &SensorAppSpec, process_names: &[String]) -> bool {
    process_names
        .iter()
        .any(|p| spec.processes.iter().any(|w| w.eq_ignore_ascii_case(p.trim())))
}

/// Pure: may this resolved path be started? Only when its file name is one the catalog names. The
/// registry value is admin-written, but a path is still a path — this name check is what makes "we
/// only ever start these executables" true rather than merely intended.
fn is_allowed_executable(spec: &SensorAppSpec, path: &std::path::Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    spec.executables.iter().any(|e| e.eq_ignore_ascii_case(name))
}

/// Resolve an executable for this app: the fixed install roots first, then `App Paths`. Returns only
/// a path that exists AND passes `is_allowed_executable`. Read-only.
fn resolve_executable(spec: &SensorAppSpec) -> Option<std::path::PathBuf> {
    for (root, rel) in spec.install_paths {
        let Some(base) = std::env::var_os(root) else {
            continue;
        };
        let path = std::path::Path::new(&base).join(rel);
        if path.is_file() && is_allowed_executable(spec, &path) {
            return Some(path);
        }
    }
    for name in spec.app_paths {
        let Some(path) = app_paths_lookup(name) else {
            continue;
        };
        if path.is_file() && is_allowed_executable(spec, &path) {
            return Some(path);
        }
    }
    None
}

/// Read `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<exe>`'s default value — the
/// documented place an installer records where it put its executable. READ ONLY.
fn app_paths_lookup(exe: &str) -> Option<std::path::PathBuf> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    let key = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(
            format!("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{exe}"),
            KEY_READ,
        )
        .ok()?;
    let raw: String = key.get_value("").ok()?;
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }
    Some(std::path::PathBuf::from(trimmed))
}

/// Is HWiNFO's shared-memory sensor block open right now? Cheap (a handle open — no parse, no WMI),
/// and it is exactly the signal that separates "HWiNFO is running" from "HWiNFO is running with
/// Shared Memory Support ON" — the difference the user needs named.
fn hwinfo_shared_memory_open() -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Memory::{OpenFileMappingW, FILE_MAP_READ};
    for name in ["Global\\HWiNFO_SENS_SM2", "HWiNFO_SENS_SM2"] {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            if let Ok(handle) = OpenFileMappingW(FILE_MAP_READ.0, false, PCWSTR(wide.as_ptr())) {
                let _ = CloseHandle(handle);
                return true;
            }
        }
    }
    false
}

/// Is a LibreHardware/OpenHardware WMI namespace answering with sensors? Only ever called when the
/// process is running — the WMI round-trip is the expensive probe here, and Compy's standing bar is
/// to be the least resource-hungry app on the PC.
fn lhm_publishing() -> bool {
    crate::hardware::on_wmi_thread(|| {
        for ns in ["LibreHardwareMonitor", "OpenHardwareMonitor"] {
            let Ok(com) = wmi::COMLibrary::new() else {
                continue;
            };
            let Ok(conn) = wmi::WMIConnection::with_namespace_path(&format!("root\\{ns}"), com)
            else {
                continue;
            };
            let sensors: Vec<OhmSensor> = conn
                .raw_query(
                    "SELECT Name, Value, Identifier FROM Sensor WHERE SensorType = 'Temperature'",
                )
                .unwrap_or_default();
            if !sensors.is_empty() {
                return true;
            }
        }
        false
    })
}

/// Pure report builder — the probes are injected, so every state combination is unit-testable
/// without owning a PC in that state. `publishing` is told whether the app is running, so a probe
/// may decline to pay for itself when the app is down.
fn build_sensor_source_report<P, L>(
    process_names: &[String],
    publishing: P,
    launchable: L,
) -> SensorSourceReport
where
    P: Fn(&'static SensorAppSpec, bool) -> bool,
    L: Fn(&'static SensorAppSpec) -> bool,
{
    let apps = SENSOR_APPS
        .iter()
        .map(|spec| {
            let running = app_is_running(spec, process_names);
            let is_publishing = publishing(spec, running);
            let can_launch = launchable(spec);
            SensorAppStatus {
                id: spec.id.to_string(),
                running,
                publishing: is_publishing,
                launchable: can_launch,
                // Publishing proves presence even if the process scan missed the image name (it can
                // run under another account), so it counts toward "installed" too.
                installed: running || is_publishing || can_launch,
            }
        })
        .collect();
    SensorSourceReport {
        apps,
        scanned: process_names.len(),
    }
}

/// Enumerate running process image names (read-only). Empty on failure, so the surface degrades to
/// "we don't know" rather than to a false claim.
fn running_process_names() -> Vec<String> {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    sys.processes()
        .values()
        .map(|p| p.name().to_string_lossy().into_owned())
        .collect()
}

/// The live read-only sensor-source scan behind the CPU-temp offer.
pub(crate) fn read_sensor_sources() -> SensorSourceReport {
    build_sensor_source_report(
        &running_process_names(),
        |spec, running| match spec.id {
            // Cheap handle open, asked unconditionally: the section is the ground truth for
            // "temperatures are actually readable right now".
            "hwinfo" => hwinfo_shared_memory_open(),
            // Expensive WMI round-trip — only worth paying for when the app is actually up.
            "lhm" => running && lhm_publishing(),
            _ => false,
        },
        |spec| resolve_executable(spec).is_some(),
    )
}

/// Start a catalog sensor app on the user's behalf. `id` is a catalog key, NEVER a path: the
/// executable is resolved here, from fixed roots, and name-checked before the shell sees it.
///
/// Compy elevates nothing. The path is handed to `explorer.exe` — the shell then honours the target's
/// OWN manifest, so HWiNFO's admin prompt is HWiNFO's, raised at the user's own click. `Ok(())` means
/// the shell accepted the request, not that the app is up; the caller re-reads the report to find
/// that out, which is what keeps the failure path honest.
pub(crate) fn launch_sensor_app(id: &str) -> Result<(), String> {
    let spec = spec_for_id(id).ok_or_else(|| format!("unknown sensor app: {id}"))?;
    let path = resolve_executable(spec)
        .ok_or_else(|| format!("no installed executable found for {}", spec.id))?;
    if !is_allowed_executable(spec, &path) {
        return Err(format!("refusing to start {}", path.display()));
    }
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not start {}: {e}", path.display()))
}

#[cfg(test)]
mod hwinfo_tests {
    use super::*;

    fn u32b(buf: &mut Vec<u8>, v: u32) {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    fn f64b(buf: &mut Vec<u8>, v: f64) {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    fn strb(buf: &mut Vec<u8>, s: &str, len: usize) {
        let mut b = s.as_bytes().to_vec();
        b.resize(len, 0);
        buf.extend_from_slice(&b);
    }
    fn reading(buf: &mut Vec<u8>, rtype: u32, label: &str, value: f64) {
        u32b(buf, rtype); // reading_type
        u32b(buf, 0); // sensor_index
        u32b(buf, 0); // reading_id
        strb(buf, label, 128); // label_orig
        strb(buf, "", 128); // label_user
        strb(buf, "C", 16); // unit
        f64b(buf, value); // value
        f64b(buf, value); // min
        f64b(buf, value); // max
        f64b(buf, value); // avg
    }
    /// Build a minimal HWiNFO shared block: header + the given temperature readings.
    fn block(readings: &[(u32, &str, f64)]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"HWiS"); // signature (LE of 0x53695748)
        u32b(&mut buf, 1); // version
        u32b(&mut buf, 0); // revision
        buf.extend_from_slice(&0u64.to_le_bytes()); // poll_time
        u32b(&mut buf, 0); // offset_sensor
        u32b(&mut buf, 0); // size_sensor_elem
        u32b(&mut buf, 0); // num_sensor
        u32b(&mut buf, std::mem::size_of::<HwiHeader>() as u32); // offset_reading
        u32b(&mut buf, std::mem::size_of::<HwiReading>() as u32); // size_reading_elem
        u32b(&mut buf, readings.len() as u32); // num_reading
        assert_eq!(buf.len(), std::mem::size_of::<HwiHeader>());
        for &(rt, label, v) in readings {
            reading(&mut buf, rt, label, v);
        }
        buf
    }

    /// Overwrite the header's num_reading field (last u32 of the header) in a built block.
    fn set_num_reading(buf: &mut [u8], num: u32) {
        let at = std::mem::size_of::<HwiHeader>() - 4;
        buf[at..at + 4].copy_from_slice(&num.to_le_bytes());
    }
    /// Overwrite the header's offset_reading field.
    fn set_offset_reading(buf: &mut [u8], off: u32) {
        let at = std::mem::size_of::<HwiHeader>() - 12; // offset_reading, size_reading_elem, num_reading
        buf[at..at + 4].copy_from_slice(&off.to_le_bytes());
    }
    /// Overwrite the header's size_reading_elem field.
    fn set_size_reading_elem(buf: &mut [u8], size: u32) {
        let at = std::mem::size_of::<HwiHeader>() - 8;
        buf[at..at + 4].copy_from_slice(&size.to_le_bytes());
    }

    #[test]
    fn parses_cpu_temp_prefers_tctl_excludes_gpu() {
        let buf = block(&[
            (1, "GPU Temperature", 70.0),    // excluded (gpu)
            (1, "CPU Core 0", 48.0),         // a CPU temp, but not the headline
            (1, "CPU (Tctl/Tdie)", 55.0),    // preferred (tctl)
            (3, "CPU Fan", 1200.0),          // not a temp (type 3)
        ]);
        let t = unsafe { parse_hwinfo(buf.as_ptr(), buf.len()) }.expect("CPU temp parsed");
        assert_eq!(t.temp_c, 55.0);
        assert_eq!(t.source, "HWiNFO");
        assert!(t.label.contains("Tctl"));
    }

    #[test]
    fn rejects_wrong_signature() {
        let mut buf = block(&[(1, "CPU (Tctl/Tdie)", 55.0)]);
        buf[0] = b'X'; // corrupt the signature
        assert!(unsafe { parse_hwinfo(buf.as_ptr(), buf.len()) }.is_none());
    }

    #[test]
    fn none_when_no_cpu_temp_present() {
        let buf = block(&[(1, "GPU Temperature", 70.0), (1, "Motherboard", 35.0)]);
        assert!(unsafe { parse_hwinfo(buf.as_ptr(), buf.len()) }.is_none());
    }

    #[test]
    fn parses_fans_excludes_temps_keeps_stopped() {
        let buf = block(&[
            (1, "CPU (Tctl/Tdie)", 55.0), // temperature — must NOT appear as a fan
            (3, "CPU Fan", 1200.0),
            (3, "Fan #2", 900.0),
            (3, "Fan #3", 0.0), // a stopped fan is still reported honestly (0 RPM)
        ]);
        let fans = unsafe { parse_hwinfo_fans(buf.as_ptr(), buf.len()) };
        assert_eq!(fans.len(), 3);
        assert_eq!(fans[0].label, "CPU Fan");
        assert_eq!(fans[0].rpm, 1200);
        assert_eq!(fans[0].source, "HWiNFO");
        assert!(fans.iter().all(|f| !f.label.contains("Tctl")));
    }

    // ── Untrusted-input bounds guards (the OOB-read DoS a hostile HWiNFO_SENS_SM2 could trigger) ──

    #[test]
    fn rejects_num_reading_larger_than_mapped_view() {
        // Header claims 100 readings but the mapped block only holds 1 → the old code read 99
        // elements past the end of the section (access violation / info leak). Must fail soft.
        let mut buf = block(&[(1, "CPU (Tctl/Tdie)", 55.0)]);
        set_num_reading(&mut buf, 100);
        assert!(unsafe { parse_hwinfo(buf.as_ptr(), buf.len()) }.is_none());
        assert!(unsafe { parse_hwinfo_fans(buf.as_ptr(), buf.len()) }.is_empty());
    }

    #[test]
    fn rejects_offset_reading_past_mapped_view() {
        // A crafted offset that points beyond the mapping → no element is in-bounds.
        let mut buf = block(&[(1, "CPU (Tctl/Tdie)", 55.0)]);
        let past_end = buf.len() as u32 + 4096;
        set_offset_reading(&mut buf, past_end);
        assert!(unsafe { parse_hwinfo(buf.as_ptr(), buf.len()) }.is_none());
    }

    #[test]
    fn rejects_len_smaller_than_header() {
        // A truncated section (e.g. a hostile 8-byte mapping) can't even hold the header.
        let buf = block(&[(1, "CPU (Tctl/Tdie)", 55.0)]);
        assert!(unsafe { parse_hwinfo(buf.as_ptr(), 8) }.is_none());
    }

    #[test]
    fn rejects_oversized_stride_past_mapped_view() {
        // A huge size_reading_elem passes the "at least our layout" floor but makes even one element
        // read past the mapping. off + num*size_elem > len must reject it (overflow-safe).
        let mut buf = block(&[(1, "CPU (Tctl/Tdie)", 55.0)]);
        set_num_reading(&mut buf, 10);
        set_size_reading_elem(&mut buf, 1_000_000); // 10 * 1_000_000 ≫ buf.len()
        assert!(unsafe { parse_hwinfo(buf.as_ptr(), buf.len()) }.is_none());
        assert!(unsafe { parse_hwinfo_fans(buf.as_ptr(), buf.len()) }.is_empty());
    }
}
#[cfg(test)]
mod sensor_source_tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn app<'a>(r: &'a SensorSourceReport, id: &str) -> &'a SensorAppStatus {
        r.apps.iter().find(|a| a.id == id).expect("catalog app present")
    }

    /// Probe stubs, so every state below is reachable without owning a PC in that state.
    fn report(running: &[&str], publishing: &[&str], launchable: &[&str]) -> SensorSourceReport {
        let publishing: Vec<String> = names(publishing);
        let launchable: Vec<String> = names(launchable);
        build_sensor_source_report(
            &names(running),
            |spec, _running| publishing.iter().any(|p| p == spec.id),
            |spec| launchable.iter().any(|l| l == spec.id),
        )
    }

    #[test]
    fn running_match_is_exact_and_case_insensitive() {
        let hwinfo = spec_for_id("hwinfo").expect("hwinfo in catalog");
        assert!(app_is_running(hwinfo, &names(&["HWiNFO64.EXE"])));
        assert!(app_is_running(hwinfo, &names(&["hwinfo64.exe"])));
        // Substring/prefix matches would fabricate a state out of an unrelated process.
        assert!(!app_is_running(hwinfo, &names(&["HWiNFO64_helper.exe"])));
        assert!(!app_is_running(hwinfo, &names(&["notHWiNFO64.EXE"])));
        assert!(!app_is_running(hwinfo, &names(&["chrome.exe", "steam.exe"])));
    }

    #[test]
    fn only_catalog_executables_may_ever_be_started() {
        let hwinfo = spec_for_id("hwinfo").expect("hwinfo in catalog");
        assert!(is_allowed_executable(
            hwinfo,
            std::path::Path::new("C:\\Program Files\\HWiNFO64\\HWiNFO64.EXE")
        ));
        // A registry value is admin-written, but the name check is what makes the promise true: a
        // planted `App Paths` entry pointing anywhere else must not become something Compy starts.
        for hostile in [
            "C:\\Windows\\System32\\cmd.exe",
            "C:\\Users\\Public\\payload.exe",
            "C:\\Program Files\\HWiNFO64\\HWiNFO64.EXE.bat",
        ] {
            assert!(
                !is_allowed_executable(hwinfo, std::path::Path::new(hostile)),
                "{hostile} must never be launchable"
            );
        }
    }

    #[test]
    fn every_resolvable_path_lands_on_an_allowlisted_executable() {
        // The resolver may only ever produce a name `is_allowed_executable` accepts. Pinning it on
        // the CATALOG (rather than on one resolved path) means a future entry with a typo'd or
        // foreign file name fails here instead of silently never resolving on a user's PC.
        for spec in SENSOR_APPS {
            for (root, rel) in spec.install_paths {
                let path = std::path::Path::new("C:\\root").join(rel);
                assert!(
                    is_allowed_executable(spec, &path),
                    "{}: install path under {root} ends in a file name the catalog won't start: {rel}",
                    spec.id
                );
            }
            for exe in spec.app_paths {
                let path = std::path::Path::new("C:\\root").join(exe);
                assert!(
                    is_allowed_executable(spec, &path),
                    "{}: App Paths key {exe} is not an executable the catalog will start",
                    spec.id
                );
            }
        }
    }

    #[test]
    fn nothing_installed_reports_no_offer_to_start() {
        let r = report(&["chrome.exe"], &[], &[]);
        for id in ["hwinfo", "lhm"] {
            let a = app(&r, id);
            assert!(!a.running && !a.publishing && !a.launchable && !a.installed);
        }
        assert_eq!(r.scanned, 1);
    }

    #[test]
    fn installed_but_not_running_is_launchable() {
        let r = report(&["chrome.exe"], &[], &["hwinfo"]);
        let a = app(&r, "hwinfo");
        assert!(a.installed && a.launchable);
        assert!(!a.running, "not running is the whole point of this state");
        assert!(!a.publishing);
    }

    #[test]
    fn running_without_shared_memory_is_its_own_state() {
        // HWiNFO up, section closed: the "Shared Memory Support is off" case. It must be
        // distinguishable from not-installed, or the UI can only repeat "go install something".
        let r = report(&["HWiNFO64.EXE"], &[], &["hwinfo"]);
        let a = app(&r, "hwinfo");
        assert!(a.running && a.installed);
        assert!(!a.publishing);
    }

    #[test]
    fn publishing_counts_as_installed_even_if_the_scan_missed_the_process() {
        // HWiNFO elevated under another account can be absent from an unprivileged process scan
        // while its section is plainly readable. Presence must follow the evidence.
        let r = report(&[], &["hwinfo"], &[]);
        let a = app(&r, "hwinfo");
        assert!(a.publishing && a.installed);
        assert!(!a.running);
    }

    #[test]
    fn an_empty_scan_is_recorded_so_the_ui_can_stay_silent() {
        // scanned == 0 means the enumeration failed. `running: false` is then UNKNOWN, and the
        // surface must not turn it into "not installed".
        let r = report(&[], &[], &[]);
        assert_eq!(r.scanned, 0);
        assert!(r.apps.iter().all(|a| !a.installed));
    }

    #[test]
    fn launch_refuses_an_id_outside_the_catalog() {
        // The webview passes an ID, never a path — an unknown one must die here, not resolve to
        // anything on disk.
        for id in ["", "cmd", "hwinfo64.exe", "C:\\Windows\\System32\\cmd.exe", "../hwinfo"] {
            assert!(spec_for_id(id).is_none(), "{id} must not resolve to a catalog app");
            assert!(launch_sensor_app(id).is_err(), "{id} must be refused");
        }
    }

    #[test]
    fn catalog_ids_are_unique_and_stable() {
        // The frontend keys its copy and its buttons off these ids; a duplicate or a rename that
        // isn't mirrored in i18n would silently strip the offer of its action.
        let ids: Vec<&str> = SENSOR_APPS.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["hwinfo", "lhm"]);
    }
}
