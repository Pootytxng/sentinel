//! CPU temperature via **interop** with a monitoring tool the user already runs.
//!
//! Sentinel installs NO kernel driver — that's the anti-cheat-safe / no-driver fundamental, and
//! real CPU die temp is only readable through ring-0 MSR access (every tool that shows it ships
//! its own driver; the common WinRing0 one is on Microsoft's vulnerable-driver blocklist and is
//! flagged by anti-cheat). So Sentinel never reads it directly — it only **displays** what a tool
//! the user already chose to install is publishing.
//!
//! Sources (read-only, no driver in Sentinel): the LibreHardwareMonitor / OpenHardwareMonitor WMI
//! namespaces (present only while that app is running). Returns `None` when nothing is publishing —
//! the honest "bring your own monitor" default; never a fabricated number.
//!
//! (HWiNFO exposes a shared-memory block instead of WMI; wiring that is a documented follow-up that
//! needs a live HWiNFO to validate the struct layout, so it's intentionally not shipped unverified.)

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
pub(crate) struct CpuTemp {
    pub temp_c: f64,
    /// The monitoring tool the reading came from — always shown, so the number is attributable.
    pub source: String,
    /// The sensor label, e.g. "CPU Package" or "Core (Tctl/Tdie)".
    pub label: String,
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
                let r = parse_hwinfo(view.Value as *const u8);
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

/// Parse the mapped HWiNFO block for the best CPU temperature reading. Validated + fail-soft.
unsafe fn parse_hwinfo(base: *const u8) -> Option<CpuTemp> {
    if std::slice::from_raw_parts(base, 4) != b"SiWH" {
        return None;
    }
    let h: HwiHeader = std::ptr::read_unaligned(base as *const HwiHeader);
    let off = h.offset_reading as usize;
    let size_elem = h.size_reading_elem as usize;
    let num = h.num_reading as usize;
    // Layout sanity: element size must match our struct; count must be plausible.
    if size_elem != std::mem::size_of::<HwiReading>() || num == 0 || num > 100_000 {
        return None;
    }
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
        if !l.contains("cpu") {
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
