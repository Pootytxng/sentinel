//! Diagnostics: the read-only "raw observations" surface behind the
//! Diagnostics tab. Assembles what the rec engine sees (hardware inventory +
//! system-state probes) into labelled sections for trust + debugging. It is a
//! pure consumer — it reads `crate::hardware` and the state probes, never
//! mutates Windows, owns no apply/rollback, and is not a second rec engine.
//! Boundary move only; no behavior change.

use serde::Serialize;

use crate::hardware::{collect_hardware, gpu_vendor_match};
use crate::{
    core_parking_label, core_parking_min_cores_ac, current_power_plan_name, fast_startup_state,
    hags_state, memory_integrity_or_vbs_active, reserved_storage_enabled, service_running,
};

// ─── Diagnostics ─────────────────────────────────────────────────────────
//
// The Diagnostics tab is "Compy's view of your PC, as raw observations."
// It exists for two reasons: (1) trust — the user can spot-check that
// Compy's view of their hardware and system state is correct, and (2)
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
        label: "Power source".into(),
        value: crate::hardware::detect_power_status(),
        note: Some("AC vs battery (live). On a laptop, gaming on battery throttles performance.".into()),
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
    power.push(DiagnosticEntry {
        label: "Core parking policy".into(),
        value: core_parking_label(core_parking_min_cores_ac()),
        note: Some(
            "Whether Windows may park CPU cores at low load (policy, not live per-core state). 'No parking' keeps all cores ready — common on gaming power plans.".into(),
        ),
    });
    power.push(DiagnosticEntry {
        label: "BIOS / firmware".into(),
        value: match &hw.bios_info {
            Some(b) if !b.version.is_empty() => {
                let mut v = b.version.clone();
                if !b.release_date.is_empty() {
                    v.push_str(&format!(" · released {}", b.release_date));
                }
                if let Some(d) = b.release_date_age_days {
                    v.push_str(&format!(
                        " · {} days old ({})",
                        d,
                        crate::hardware::bios_age_label(Some(d))
                    ));
                }
                v
            }
            _ => "Unknown".into(),
        },
        note: Some(
            "Firmware version + when it was published. Age is publication date, not proof it's out of date.".into(),
        ),
    });
    sections.push(DiagnosticSection {
        name: "Power & boot".into(),
        entries: power,
    });

    // ─── Security ────────────────────────────────────────────────────────
    sections.push(DiagnosticSection {
        name: "Security".into(),
        entries: vec![
            DiagnosticEntry {
                label: "Memory Integrity / VBS active".into(),
                value: yes_no(memory_integrity_or_vbs_active()),
                note: Some(
                    "Hypervisor-based kernel protection. Strong against certain malware classes, with measurable FPS cost in some games.".into(),
                ),
            },
            DiagnosticEntry {
                label: "Hypervisor running".into(),
                value: match &hw.virtualization {
                    Some(v) => yes_no(v.hypervisor_present),
                    None => "Unknown".into(),
                },
                note: Some(
                    "A hypervisor is active when VBS/Memory Integrity, Hyper-V, WSL2, Sandbox, or a VM is on. Small FPS cost in some games.".into(),
                ),
            },
            DiagnosticEntry {
                label: "CPU virtualization (SVM/VT-x) in firmware".into(),
                value: match hw.virtualization.as_ref().and_then(|v| v.cpu_virtualization_enabled) {
                    Some(true) => "Enabled".into(),
                    Some(false) => "Disabled".into(),
                    None => "Unknown".into(),
                },
                note: None,
            },
        ],
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

    // ─── Memory ──────────────────────────────────────────────────────────
    // XMP/EXPO honesty: we flag RAM running BELOW its rated speed (actionable — profile likely
    // off), but never claim a profile is "active" (a JEDEC kit also runs at rated, indistinguishable).
    let mut memory = Vec::<DiagnosticEntry>::new();
    if hw.memory_modules.is_empty() {
        memory.push(DiagnosticEntry {
            label: "Memory modules".into(),
            value: "Not detected".into(),
            note: Some("SMBIOS + WMI both returned no populated DIMM slots.".into()),
        });
    } else {
        for (i, m) in hw.memory_modules.iter().enumerate() {
            let gb = m.capacity_bytes / 1_073_741_824;
            let who = if m.manufacturer.is_empty() {
                format!("{} {}GB", m.type_name, gb)
            } else {
                format!("{} {}GB · {}", m.type_name, gb, m.manufacturer)
            };
            let (value, note) = match m.xmp_expo_status.as_str() {
                "running_below_rated" => (
                    format!("{} of {} MT/s — below rated speed", m.speed_mhz, m.rated_speed_mhz),
                    Some("Running slower than the kit is rated for — XMP/EXPO may be off. It's a BIOS memory profile, not something Compy changes.".to_string()),
                ),
                "running_at_rated" => (format!("{} MT/s (at rated speed)", m.speed_mhz), None),
                _ => (format!("{} MT/s", m.speed_mhz), None),
            };
            memory.push(DiagnosticEntry {
                label: format!("DIMM {}: {}", i + 1, who),
                value,
                note,
            });
        }
    }
    sections.push(DiagnosticSection {
        name: "Memory".into(),
        entries: memory,
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
    // SMART summary (OS rolled-up verdict; per-attribute SMART needs a vendor tool).
    for dh in &hw.disk_health {
        storage.push(DiagnosticEntry {
            label: format!("{} health", dh.friendly_name),
            value: dh.health.clone(),
            note: if dh.health == "Healthy" {
                None
            } else {
                Some("OS SMART summary (MSFT_PhysicalDisk). Detailed per-attribute SMART needs the drive vendor's tool.".into())
            },
        });
    }
    sections.push(DiagnosticSection {
        name: "Storage".into(),
        entries: storage,
    });

    // ─── Network ─────────────────────────────────────────────────────────
    // Detection-accuracy train: every row NAMES its evidence (the adapter), never a generic
    // "Ethernet detected". Virtual adapters (VPN TAP / Hyper-V / BT-PAN) are excluded from "wired".
    let mut network = Vec::<DiagnosticEntry>::new();
    let connected_wired = hw
        .network_adapters
        .iter()
        .find(|a| a.physical && a.medium == "wired" && a.connected);
    let wired_port = hw
        .network_adapters
        .iter()
        .find(|a| a.physical && a.medium == "wired");
    let wired_state = if hw.network_adapters.is_empty() {
        "Unknown — Windows didn't return adapter details".to_string()
    } else if let Some(a) = connected_wired {
        format!("Connected — {}", a.name)
    } else if let Some(a) = wired_port {
        format!("Port present, cable unplugged — {}", a.name)
    } else {
        "None — no physical Ethernet port (Wi-Fi / other only)".to_string()
    };
    network.push(DiagnosticEntry {
        label: "Wired Ethernet".into(),
        value: wired_state,
        note: Some(
            "Physical NIC + 802.3 medium + link state (virtual adapters excluded). Gates the Energy Efficient Ethernet rec.".into(),
        ),
    });
    // Adapter inventory — each row self-identifies, so a false positive (e.g. a VPN's TAP adapter)
    // is visible to the user AND to us via their Export.
    for a in &hw.network_adapters {
        let kind = if a.physical {
            match a.medium.as_str() {
                "wired" => "physical · wired",
                "wifi" => "physical · Wi-Fi",
                _ => "physical · other",
            }
        } else {
            "virtual / not a physical NIC"
        };
        network.push(DiagnosticEntry {
            label: format!("Adapter: {}", a.name),
            value: format!(
                "{} · {}",
                kind,
                if a.connected { "connected" } else { "not connected" }
            ),
            note: None,
        });
    }
    sections.push(DiagnosticSection {
        name: "Network".into(),
        entries: network,
    });

    // ─── Peripherals ─────────────────────────────────────────────────────
    sections.push(DiagnosticSection {
        name: "Peripherals".into(),
        entries: vec![DiagnosticEntry {
            label: "USB capability".into(),
            value: match &hw.usb {
                Some(u) => format!(
                    "Up to {} · {} host controller{}",
                    u.top_spec,
                    u.controller_count,
                    if u.controller_count == 1 { "" } else { "s" }
                ),
                None => "Unknown".into(),
            },
            note: Some(
                "The fastest USB the system supports. Per-port negotiated speed isn't reliably readable, so Compy doesn't claim it.".into(),
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

// ─── Diagnostics tests (audit M2) ─────────────────────────────────────────
//
// get_diagnostics assembles LIVE probes, so these pin the machine-independent
// invariants Export + the Diagnostics surface depend on: the fixed section
// set, rows that always exist, receipts that are never empty strings, and the
// serde shape (note skipped when None). Values themselves are rig-specific —
// asserting them would just re-test the probes.
#[cfg(test)]
mod diagnostics_tests {
    use super::*;

    #[test]
    fn yes_no_renders_plain_english() {
        assert_eq!(yes_no(true), "Yes");
        assert_eq!(yes_no(false), "No");
    }

    #[test]
    fn sections_are_the_fixed_set_in_order() {
        let names: Vec<String> = get_diagnostics().into_iter().map(|s| s.name).collect();
        assert_eq!(
            names,
            vec!["Power & boot", "Security", "Display", "Memory", "Storage", "Network", "Peripherals", "Background services"],
            "the section set/order is a UI + Export contract"
        );
    }

    #[test]
    fn every_entry_carries_a_nonempty_label_and_value() {
        // The graceful-degradation contract: a probe that can't read still yields an honest
        // string ("Unknown…", "Not detected", "Not configured") — never an empty receipt.
        for section in get_diagnostics() {
            assert!(!section.entries.is_empty(), "section '{}' must not be empty", section.name);
            for e in &section.entries {
                assert!(!e.label.trim().is_empty(), "empty label in '{}'", section.name);
                assert!(!e.value.trim().is_empty(), "empty value for '{}'", e.label);
                if let Some(n) = &e.note {
                    assert!(!n.trim().is_empty(), "a present note must not be blank: '{}'", e.label);
                }
            }
        }
    }

    #[test]
    fn fixed_rows_always_exist_regardless_of_rig() {
        let sections = get_diagnostics();
        let labels_of = |name: &str| -> Vec<String> {
            sections
                .iter()
                .find(|s| s.name == name)
                .map(|s| s.entries.iter().map(|e| e.label.clone()).collect())
                .unwrap_or_default()
        };
        let power = labels_of("Power & boot");
        assert!(power.iter().any(|l| l == "Active power plan"));
        assert!(power.iter().any(|l| l == "Power source"));
        assert!(power.iter().any(|l| l == "Fast Startup"));
        assert!(power.iter().any(|l| l.contains("HAGS")));
        assert!(power.iter().any(|l| l == "BIOS / firmware"));
        assert!(power.iter().any(|l| l == "Core parking policy"));
        assert!(labels_of("Security").iter().any(|l| l == "Hypervisor running"));
        assert!(labels_of("Storage").iter().any(|l| l == "Reserved Storage active"));
        // The Wired-Ethernet row exists even when Windows returns no adapters (honest "Unknown").
        assert!(labels_of("Network").iter().any(|l| l == "Wired Ethernet"));
        let services = labels_of("Background services");
        for svc in ["DiagTrack", "SysMain", "WSearch"] {
            assert!(services.iter().any(|l| l.contains(svc)), "missing service row {svc}");
        }
    }

    #[test]
    fn serde_shape_skips_absent_notes() {
        // Export + the TS surface read this shape; `note` must be ABSENT (not null) when None.
        let v = serde_json::to_value(get_diagnostics()).expect("serializes");
        let sections = v.as_array().expect("array of sections");
        assert!(!sections.is_empty());
        let mut saw_noteless = false;
        for s in sections {
            for e in s.get("entries").and_then(|x| x.as_array()).unwrap_or(&vec![]) {
                assert!(e.get("label").is_some() && e.get("value").is_some());
                if e.get("note").is_none() {
                    saw_noteless = true;
                } else {
                    assert!(!e["note"].is_null(), "a serialized note must be a string, never null");
                }
            }
        }
        assert!(saw_noteless, "at least one entry exercises the skip_serializing_if path");
    }
}

