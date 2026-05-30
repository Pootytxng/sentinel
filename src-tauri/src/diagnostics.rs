//! Diagnostics: the read-only "raw observations" surface behind the
//! Diagnostics tab. Assembles what the rec engine sees (hardware inventory +
//! system-state probes) into labelled sections for trust + debugging. It is a
//! pure consumer — it reads `crate::hardware` and the state probes, never
//! mutates Windows, owns no apply/rollback, and is not a second rec engine.
//! Boundary move only; no behavior change.

use serde::Serialize;

use crate::hardware::{collect_hardware, gpu_vendor_match};
use crate::{
    current_power_plan_name, fast_startup_state, hags_state, memory_integrity_or_vbs_active,
    reserved_storage_enabled, service_running,
};

// ─── Diagnostics ─────────────────────────────────────────────────────────
//
// The Diagnostics tab is "Sentinel's view of your PC, as raw observations."
// It exists for two reasons: (1) trust — the user can spot-check that
// Sentinel's view of their hardware and system state is correct, and (2)
// debug aid — if a rec doesn't fire as expected, the user can see which
// underlying observation drove that decision. No new detection runs here;
// every value comes from helpers that already exist for the rec engine.

#[derive(Serialize)]
pub(crate) struct DiagnosticEntry {
    label: String,
    value: String,
    /// Optional explanatory note shown beneath the value. Used to surface
    /// the meaning of a state (e.g., "Hardware-accelerated GPU Scheduling
    /// is auto-decided by the driver") rather than just an opaque number.
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct DiagnosticSection {
    name: String,
    entries: Vec<DiagnosticEntry>,
}

pub(crate) fn yes_no(b: bool) -> String {
    if b { "Yes".into() } else { "No".into() }
}

#[tauri::command]
pub(crate) fn get_diagnostics() -> Vec<DiagnosticSection> {
    let hw = collect_hardware();
    let mut sections: Vec<DiagnosticSection> = Vec::new();

    // ─── Power & boot ────────────────────────────────────────────────────
    let mut power = Vec::<DiagnosticEntry>::new();
    let plan = current_power_plan_name().unwrap_or_else(|| "Unknown".into());
    power.push(DiagnosticEntry {
        label: "Active power plan".into(),
        value: plan,
        note: None,
    });
    power.push(DiagnosticEntry {
        label: "Fast Startup".into(),
        value: match fast_startup_state() {
            Some(1) => "On".into(),
            Some(0) => "Off".into(),
            _ => "Not configured".into(),
        },
        note: Some(
            "Hibernates the Windows kernel on shutdown. On is the default."
                .into(),
        ),
    });
    power.push(DiagnosticEntry {
        label: "Hardware-accelerated GPU Scheduling (HAGS)".into(),
        value: match hags_state() {
            Some(0) => "Auto (driver chooses)".into(),
            Some(1) => "Off".into(),
            Some(2) => "On".into(),
            _ => "Not configured".into(),
        },
        note: None,
    });
    sections.push(DiagnosticSection {
        name: "Power & boot".into(),
        entries: power,
    });

    // ─── Security ────────────────────────────────────────────────────────
    sections.push(DiagnosticSection {
        name: "Security".into(),
        entries: vec![DiagnosticEntry {
            label: "Memory Integrity / VBS active".into(),
            value: yes_no(memory_integrity_or_vbs_active()),
            note: Some(
                "Hypervisor-based kernel protection. Strong against certain malware classes, with measurable FPS cost in some games.".into(),
            ),
        }],
    });

    // ─── Display ─────────────────────────────────────────────────────────
    let mut display = Vec::<DiagnosticEntry>::new();
    if let Some(d) = &hw.display {
        display.push(DiagnosticEntry {
            label: "Resolution".into(),
            value: format!("{}×{}", d.width, d.height),
            note: None,
        });
        display.push(DiagnosticEntry {
            label: "Current refresh rate".into(),
            value: format!("{} Hz", d.current_refresh_rate_hz),
            note: None,
        });
        display.push(DiagnosticEntry {
            label: "Max refresh rate at current resolution".into(),
            value: format!("{} Hz", d.max_refresh_rate_hz),
            note: if d.max_refresh_rate_hz > d.current_refresh_rate_hz {
                Some(format!(
                    "Display supports {} Hz higher than currently set.",
                    d.max_refresh_rate_hz - d.current_refresh_rate_hz
                ))
            } else {
                None
            },
        });
        display.push(DiagnosticEntry {
            label: "HDR-capable display attached".into(),
            value: yes_no(d.hdr_capable),
            note: Some(
                "Detected via DXGI: BitsPerColor ≥ 10 and MaxLuminance ≥ 400 nits on any output.".into(),
            ),
        });
    } else {
        display.push(DiagnosticEntry {
            label: "Display".into(),
            value: "Not detected".into(),
            note: Some(
                "GDI EnumDisplaySettings returned no usable mode. This is unusual.".into(),
            ),
        });
    }
    sections.push(DiagnosticSection {
        name: "Display".into(),
        entries: display,
    });

    // ─── Storage ─────────────────────────────────────────────────────────
    let mut storage = Vec::<DiagnosticEntry>::new();
    storage.push(DiagnosticEntry {
        label: "Reserved Storage active".into(),
        value: yes_no(reserved_storage_enabled()),
        note: Some(
            "Windows holds back ~7–10 GB on C: as a Windows Update working area when active.".into(),
        ),
    });
    for d in &hw.disks {
        if d.total_bytes == 0 {
            continue;
        }
        let pct = (d.available_bytes as f64 / d.total_bytes as f64) * 100.0;
        storage.push(DiagnosticEntry {
            label: format!("{} free space", d.mount_point),
            value: format!(
                "{:.1}% free ({} of {} bytes)",
                pct, d.available_bytes, d.total_bytes
            ),
            note: None,
        });
    }
    sections.push(DiagnosticSection {
        name: "Storage".into(),
        entries: storage,
    });

    // ─── Network ─────────────────────────────────────────────────────────
    sections.push(DiagnosticSection {
        name: "Network".into(),
        entries: vec![DiagnosticEntry {
            label: "Active wired Ethernet detected".into(),
            value: yes_no(hw.has_active_wired_ethernet),
            note: Some(
                "Required for the Energy Efficient Ethernet (EEE) recommendation to fire.".into(),
            ),
        }],
    });

    // ─── Background services ─────────────────────────────────────────────
    let mut services = Vec::<DiagnosticEntry>::new();
    for (label, name) in &[
        ("DiagTrack (Connected User Experiences and Telemetry)", "DiagTrack"),
        ("SysMain (Superfetch)", "SysMain"),
        ("WSearch (Windows Search indexer)", "WSearch"),
    ] {
        services.push(DiagnosticEntry {
            label: (*label).into(),
            value: if service_running(name) { "Running".into() } else { "Stopped / Disabled".into() },
            note: None,
        });
    }
    if gpu_vendor_match(&hw, "NVIDIA").is_some() {
        services.push(DiagnosticEntry {
            label: "NvTelemetryContainer (NVIDIA telemetry)".into(),
            value: if service_running("NvTelemetryContainer") {
                "Running".into()
            } else {
                "Stopped / Disabled".into()
            },
            note: None,
        });
    }
    sections.push(DiagnosticSection {
        name: "Background services".into(),
        entries: services,
    });

    sections
}

// ─── Apply / Rollback ────────────────────────────────────────────────────
//
// See docs/ARCHITECTURE_LOCKS §2 for the typed-allowlist contract:
//   AppliedAction   = what was done at apply time (typed enum, allowlist)
//   RollbackAction  = how to undo using the stored Snapshot (separate enum
//                     so future apply-path refactors can change AppliedAction
//                     variants without breaking rollback of historical entries)
//   Snapshot        = prior machine state, also typed
//
// Remote rules can only select among these variants. Unknown variants reject
// at parse time. Privileged behavior never decodes free-form strings.

