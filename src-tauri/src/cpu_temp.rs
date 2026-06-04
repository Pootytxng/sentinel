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
    // Signature is the DWORD 'SiWH' (0x53695748); in memory its little-endian bytes read as
    // "HWiS". Accept either byte order AND the raw DWORD so an endianness quirk can't make us
    // silently miss it.
    let sig4 = std::slice::from_raw_parts(base, 4);
    let sig_u32 = u32::from_le_bytes([sig4[0], sig4[1], sig4[2], sig4[3]]);
    if sig4 != b"SiWH" && sig4 != b"HWiS" && sig_u32 != 0x5369_5748 {
        return None;
    }
    let h: HwiHeader = std::ptr::read_unaligned(base as *const HwiHeader);
    let off = h.offset_reading as usize;
    let size_elem = h.size_reading_elem as usize;
    let num = h.num_reading as usize;
    // Layout sanity: the element must be at least our known layout (a newer HWiNFO may append
    // trailing fields, which don't move the ones we read); offset + count must be plausible.
    if size_elem < std::mem::size_of::<HwiReading>()
        || off < std::mem::size_of::<HwiHeader>()
        || num == 0
        || num > 100_000
    {
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

    #[test]
    fn parses_cpu_temp_prefers_tctl_excludes_gpu() {
        let buf = block(&[
            (1, "GPU Temperature", 70.0),    // excluded (gpu)
            (1, "CPU Core 0", 48.0),         // a CPU temp, but not the headline
            (1, "CPU (Tctl/Tdie)", 55.0),    // preferred (tctl)
            (3, "CPU Fan", 1200.0),          // not a temp (type 3)
        ]);
        let t = unsafe { parse_hwinfo(buf.as_ptr()) }.expect("CPU temp parsed");
        assert_eq!(t.temp_c, 55.0);
        assert_eq!(t.source, "HWiNFO");
        assert!(t.label.contains("Tctl"));
    }

    #[test]
    fn rejects_wrong_signature() {
        let mut buf = block(&[(1, "CPU (Tctl/Tdie)", 55.0)]);
        buf[0] = b'X'; // corrupt the signature
        assert!(unsafe { parse_hwinfo(buf.as_ptr()) }.is_none());
    }

    #[test]
    fn none_when_no_cpu_temp_present() {
        let buf = block(&[(1, "GPU Temperature", 70.0), (1, "Motherboard", 35.0)]);
        assert!(unsafe { parse_hwinfo(buf.as_ptr()) }.is_none());
    }
}
