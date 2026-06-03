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
