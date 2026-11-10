//! Diagnostics: the read-only "raw observations" surface behind the
//! Diagnostics tab. Assembles what the rec engine sees (hardware inventory +
//! system-state probes) into labelled sections for trust + debugging. It is a
//! pure consumer — it reads `crate::hardware` and the state probes, never
//! mutates Windows, owns no apply/rollback, and is not a second rec engine.
//! Boundary move only; no behavior change.

use serde::Serialize;

use crate::hardware::collect_hardware;
use crate::{
    core_parking_label, core_parking_min_cores_ac, current_power_plan_name, fast_startup_state,
    hags_state, memory_integrity_or_vbs_active, reserved_storage_enabled,
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

/// The live VBS row: whether virtualization-based security is actually running
/// (`Win32_DeviceGuard`), which the configured switches above it can't say. Read-only; an
/// unreadable probe reads "Unknown".
pub(crate) fn vbs_running_entry(
    virt: Option<&crate::hardware::VirtualizationInfo>,
) -> DiagnosticEntry {
    let state = virt.map(|v| v.vbs_state).unwrap_or_default();
    DiagnosticEntry {
        label: "VBS running now".into(),
        value: crate::hardware::vbs_state_label(state).into(),
        note: Some(
            "Read from Windows Device Guard. Compy only reads this; turning VBS on or off is your call in Windows Security.".into(),
        ),
    }
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
                // The registry switches: what is configured, not whether it is running (next row).
                label: "Memory Integrity / VBS turned on".into(),
                value: yes_no(memory_integrity_or_vbs_active()),
                note: Some(
                    "Hypervisor-based kernel protection. Strong against certain malware classes, with measurable FPS cost in some games.".into(),
                ),
            },
            vbs_running_entry(hw.virtualization.as_ref()),
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
    // Wired link rate — the negotiated speed of the active wired NIC (read-only, zero-outbound). A
    // ≤100 Mbps link on a gigabit-era port usually means an older cable or switch port; harmless for
    // gaming (games need very little bandwidth), worth a check only if faster transfers were expected.
    if let Some(bps) = crate::hardware::active_wired_link_speed(&hw.network_adapters) {
        let low = bps <= 100_000_000;
        network.push(DiagnosticEntry {
            label: "Wired link speed".into(),
            value: crate::hardware::format_link_rate(bps),
            note: Some(if low {
                "Negotiated link rate. Most modern Ethernet links at gigabit (1000 Mbps) — a wired link \
                 this low usually means an older cable or switch port. It's still fine for gaming; worth \
                 a check only if you expected faster file transfers."
                    .into()
            } else {
                "Negotiated link rate of the active wired connection.".into()
            }),
        });
    }
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

    // ─── Background services (read-only inventory + startup drift, A4) ────
    // A categorised inventory of the gaming-relevant services Compy recognises,
    // plus an honest coverage count, plus read-only startup-DRIFT findings: a
    // curated, closed catalog of services whose stock startup is unambiguous
    // (e.g. Windows Audio) that "disable services for FPS" scripts turn off.
    // Both are informational — the inventory never says "turn a service off"
    // (that owner-curated advisory layer is a separate, gated feature), and
    // drift only points out a change someone already made, with no enable
    // action wired and full origin-uncertainty honesty.
    let report = crate::services::collect_service_report();
    let inv = report.inventory;
    let mut svc_entries = vec![DiagnosticEntry {
        label: "Service inventory".into(),
        value: format!("{} recognised of {} total", inv.recognized, inv.total),
        note: Some(
            "The gaming-relevant services Compy recognises are grouped below. The rest are \
             mostly core Windows services Compy doesn't flag. This is an inventory, not advice \
             — Compy never tells you to turn a service off."
                .into(),
        ),
    }];
    if report.drift.is_empty() {
        // "Nothing found" is first-class — but only claim it when the enumeration actually ran
        // (total > 0). A failed WMI read (total == 0) must NOT read as "all clear".
        if inv.total > 0 {
            svc_entries.push(DiagnosticEntry {
                label: "Startup drift".into(),
                value: "None — the services Compy checks are at their stock startup".into(),
                note: Some(
                    "Compy checks a short list of services whose stock startup is well-known (e.g. \
                     Windows Audio). None of them have been switched off on this PC."
                        .into(),
                ),
            });
        }
    } else {
        for f in &report.drift {
            svc_entries.push(DiagnosticEntry {
                label: f.label.clone(),
                value: format!("{} (stock: {})", f.current, f.stock),
                note: Some(format!(
                    "{} {} This matches {}. {}",
                    f.cost, f.verdict, f.matched_tweak, f.restore_note
                )),
            });
        }
    }
    sections.push(DiagnosticSection { name: "Background services".into(), entries: svc_entries });
    // A by-hand recovery guide appears ONLY when there is real drift to undo: the exact,
    // plain-English Services-console steps to switch the affected services back on. Reference
    // data — Compy performs none of it (no mutation), and the intro carries origin-uncertainty.
    if let Some(guide) = &report.recovery {
        let mut steps = vec![DiagnosticEntry {
            label: "Restore by hand".into(),
            value: guide.intro.clone(),
            note: None,
        }];
        for (i, step) in guide.steps.iter().enumerate() {
            steps.push(DiagnosticEntry {
                label: format!("Step {}", i + 1),
                value: step.clone(),
                note: None,
            });
        }
        sections.push(DiagnosticSection {
            name: "Background services · How to restore".into(),
            entries: steps,
        });
    }
    for group in inv.groups {
        sections.push(DiagnosticSection {
            name: format!("Services · {}", group.category),
            entries: group
                .rows
                .into_iter()
                .map(|r| DiagnosticEntry {
                    label: r.label,
                    value: r.value,
                    note: r.note,
                })
                .collect(),
        });
    }

    // ─── On-screen overlays (read-only, A4) ──────────────────────────────
    // Compy draws its own in-game overlay; this lists third-party overlay/OSD
    // tools running so a double-overlay isn't a mystery. Informational only —
    // never a performance claim, never "close it". Only the tools whose running
    // process reliably means an OSD is drawn are detected (honest coverage).
    let overlay = crate::overlay_tools::collect_overlay_scan();
    if overlay.scanned > 0 {
        let entries = if overlay.findings.is_empty() {
            vec![DiagnosticEntry {
                label: "Overlay tools".into(),
                value: "None of the overlay tools Compy recognises are running".into(),
                note: Some(
                    "Compy checks for a few well-known on-screen-display tools (e.g. RivaTuner / MSI \
                     Afterburner). None of them are running, so nothing should overlap Compy's overlay."
                        .into(),
                ),
            }]
        } else {
            overlay
                .findings
                .into_iter()
                .map(|f| DiagnosticEntry { label: f.label, value: f.value, note: Some(f.note) })
                .collect()
        };
        sections.push(DiagnosticSection { name: "On-screen overlays".into(), entries });
    }

    // ─── Shared Machine Model (Roadmap Phase 2, #385) ─────────────────
    //
    // ONE bounded section, rendered from the SAME value `get_machine_model` returns. It is built
    // here and rendered by a pure function of that value, so this surface can never become a
    // second implementation of the same truth (MACHINE_MODEL.md §8).
    sections.push(machine_model_section(&crate::machine_model::build()));

    sections
}

/// Render the Machine Model as one diagnostics section. PURE in `m`: it reads nothing else, so
/// every value below traces to the model the command returns.
pub(crate) fn machine_model_section(
    m: &crate::machine_model::MachineModel,
) -> DiagnosticSection {
    use crate::machine_model::Freshness;

    let mut entries = Vec::<DiagnosticEntry>::new();

    // Freshness in plain English, so a reader can tell a live read from a remembered one.
    let freshness_note = |f: Freshness| -> &'static str {
        match f {
            Freshness::Stamped => "Compy recorded when it observed this.",
            Freshness::LiveAtBuild => "Read just now; the producer records no timestamp of its own.",
            Freshness::UnstampedCache => "Read once this session and remembered since. Not proof of a re-read just now.",
            Freshness::UndatedHistorical => "Compy recorded this, but the record carries no date, so it cannot be placed in time.",
            Freshness::NotApplicable => "No value, so no freshness.",
        }
    };
    // A field that does not apply must never render as "Unknown": that reads to a user as evidence
    // Compy failed to gather, when in fact there is nothing there to gather (#385 review).
    let show = |f: &crate::machine_model::Fact<String>| -> (String, Option<String>) {
        match (
            f.value.as_ref(),
            f.unknown_reason.as_ref(),
            f.not_applicable_reason.as_ref(),
        ) {
            (Some(v), _, _) => (
                v.clone(),
                Some(format!("{} · {}", f.source, freshness_note(f.freshness))),
            ),
            (None, Some(why), _) => ("Unknown".into(), Some(why.clone())),
            (None, None, Some(why)) => ("Not applicable".into(), Some(why.clone())),
            (None, None, None) => ("Unknown".into(), None),
        }
    };

    // 1. What machine is this?
    for (label, fact) in [
        ("Processor", &m.identity.cpu),
        ("Graphics", &m.identity.gpu),
        ("Graphics driver", &m.identity.gpu_driver),
        ("Display", &m.identity.display),
        ("Windows", &m.identity.windows),
        ("Rig identity", &m.identity.rig_hash),
    ] {
        let (value, note) = show(fact);
        entries.push(DiagnosticEntry { label: label.into(), value, note });
    }
    let (ram_value, ram_note) = match m.identity.ram_gb.value {
        Some(gb) => (
            format!("{gb} GB"),
            Some(format!(
                "{} · {}",
                m.identity.ram_gb.source,
                freshness_note(m.identity.ram_gb.freshness)
            )),
        ),
        None => ("Unknown".into(), m.identity.ram_gb.unknown_reason.clone()),
    };
    entries.push(DiagnosticEntry { label: "Memory".into(), value: ram_value, note: ram_note });

    // "No disagreements" is only a finding when a comparison actually RAN. With no stamped
    // snapshot and no acknowledged baseline nothing is compared, and the model returns the same
    // empty list it returns when everything agreed. Rendering both as "No" turned an absence of
    // comparative evidence into a passing result on exactly the machines least able to afford it —
    // fresh ones (#385 review). The compared list is read first, and it also supplies the field
    // names, so the agreement note can no longer claim more than the comparison covered.
    let compared_labels: Vec<&'static str> = [
        ("gpu", "GPU"),
        ("gpu_driver", "driver"),
        ("display", "display"),
        ("ram_gb", "memory"),
        ("rig_hash", "the rig hash"),
    ]
    .into_iter()
    .filter(|(id, _)| m.identity.compared_fields.iter().any(|c| c.field == *id))
    .map(|(_, label)| label)
    .collect();
    let compared_phrase = match compared_labels.split_last() {
        None => String::new(),
        Some((last, [])) => (*last).to_string(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
    };
    entries.push(DiagnosticEntry {
        label: "Identity producers disagree".into(),
        value: if m.identity.compared_fields.is_empty() {
            "Not compared".into()
        } else if m.identity.disagreements.is_empty() {
            "No".into()
        } else {
            m.identity
                .disagreements
                .iter()
                .map(|d| format!("{}: {} vs {}", d.field, d.left.value, d.right.value))
                .collect::<Vec<_>>()
                .join(" · ")
        },
        note: Some(if m.identity.compared_fields.is_empty() {
            "Nothing was compared. Compy holds no stamped identity snapshot and no acknowledged hardware baseline to check today's reading against, so no second producer exists to agree or disagree with it. That is an absence of comparative evidence, not agreement.".into()
        } else if m.identity.disagreements.is_empty() {
            format!(
                "The identity fields Compy actually compared — {compared_phrase} — agree. CPU and Windows build are not compared, and neither is any field whose second reading was missing, so this is not a claim that every producer of rig identity agrees."
            )
        } else {
            format!(
                "{} A difference is not proof that either reading is wrong.",
                m.identity.canonical_rule
            )
        }),
    });

    // 2. What recently changed?
    entries.push(DiagnosticEntry {
        label: "Recorded changes".into(),
        value: format!(
            "{} events in this view · {} identity snapshots",
            m.chronology.total_events, m.chronology.identity_snapshots
        ),
        note: Some(format!("{} {}", m.chronology.coverage_note, match m.chronology.entries.first() {
            // A non-empty view can still be missing a whole producer (an unreadable ledger), so the
            // reason rides along whenever the model names one (#446).
            Some(e) => format!(
                "Most recent in this view: {} ({}). {}{}",
                e.summary,
                e.observed_at,
                m.chronology.causation_note,
                m.chronology.unknown_reason.as_deref().map(|r| format!(" {r}")).unwrap_or_default()
            ),
            None => m
                .chronology
                .unknown_reason
                .clone()
                .unwrap_or_else(|| m.chronology.causation_note.to_string()),
        })),
    });
    if let Some(from) = m.chronology.recorded_from.as_ref() {
        entries.push(DiagnosticEntry {
            label: "Earliest dated record".into(),
            value: from.clone(),
            note: Some(format!(
                "The earliest DATED evidence in this view, from {}. Undated records cannot be placed in time, so this is not a claim that nothing earlier is retained — still less that nothing changed before it.{}",
                m.chronology.recorded_from_source.unwrap_or("an unnamed source"),
                match m.chronology.identity_history_from.as_deref() {
                    Some(id_from) if Some(id_from) != m.chronology.recorded_from.as_deref() =>
                        format!(" Identity recording specifically starts later, at {id_from}."),
                    _ => String::new(),
                }
            )),
        });
    }

    // 3. What did Compy change?
    let c = &m.compy_changes;
    // An unreadable ledger has no counts to show: every zero would be a claim nothing supports
    // (#446). A readable one separates "read as off" from "could not be checked", because only
    // the first is evidence the setting is no longer in effect — and neither says WHO changed it
    // (#392).
    entries.push(DiagnosticEntry {
        label: "Changes Compy applied".into(),
        value: match c.ledger_unreadable {
            Some(_) => "Unreadable".into(),
            None => format!(
                // Every count on this line is per CHANGE (one per rec_id, #453 review); the ledger
                // row count is named as such so the two units never share a word.
                "{} recorded ({} ledger {}) · {} active on this PC · {} rolled back · {} no longer in effect · {} could not be checked",
                c.active_now + c.in_effect_unknown + c.applied_but_not_in_effect + c.rolled_back,
                c.total_recorded,
                if c.total_recorded == 1 { "entry" } else { "entries" },
                c.active_now,
                c.rolled_back,
                c.applied_but_not_in_effect,
                c.in_effect_unknown
            ),
        },
        note: Some(match c.ledger_unreadable.as_deref() {
            Some(reason) => format!("{reason} {}", c.ledger_note),
            None => c.ledger_note.into(),
        }),
    });
    entries.push(DiagnosticEntry {
        label: "In effect, other or unknown PC".into(),
        value: format!(
            "{} recorded on another PC · {} unattributed",
            c.in_effect_other_rig, c.in_effect_rig_unknown
        ),
        note: Some(format!(
            "{} of the {} changes active on this PC are stamped for this PC. The live check reads the setting on this machine, so all {} are active here; the rig stamp only says where Compy recorded applying it. An unattributed change is one whose record predates rig stamping — that is a missing stamp, not evidence it was applied somewhere else.",
            c.active_now - c.in_effect_other_rig - c.in_effect_rig_unknown,
            c.active_now,
            c.active_now
        )),
    });
    // Rig attribution is a fact about each recorded apply, so this line counts ledger ENTRIES, and
    // says so: Game Mode applied eight times is eight entries here and one change above (453-f1).
    entries.push(DiagnosticEntry {
        label: "Ledger entries by PC".into(),
        value: format!(
            "{} on this PC · {} elsewhere · {} unknown",
            c.on_this_rig, c.not_on_this_rig, c.rig_unknown
        ),
        note: Some("Counted per ledger entry, not per change: a change applied more than once has one entry for each apply. Entries written before rig stamping existed stay unknown rather than being assumed to be this machine.".into()),
    });

    // 4. What evidence can we trust right now?
    entries.push(DiagnosticEntry {
        label: "Evidence not available".into(),
        value: if m.evidence.unknowns.is_empty() {
            "None".into()
        } else {
            format!("{} facts", m.evidence.unknowns.len())
        },
        note: m
            .evidence
            .unknowns
            .iter()
            .take(4)
            .map(|u| format!("{}: {}", u.field, u.reason))
            .reduce(|a, b| format!("{a} — {b}")),
    });
    entries.push(DiagnosticEntry {
        label: "Model built".into(),
        value: m.built_at.clone(),
        note: Some(format!(
            "Schema v{}. This is when the model was composed, not when any fact in it was observed.",
            m.schema_version
        )),
    });

    DiagnosticSection { name: "Machine Model".into(), entries }
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

    // CR-vbs-running: the row says running / turned on but not running / off from the live
    // Device Guard state, and Unknown when the probe could not read it.
    #[test]
    fn vbs_running_row_reads_the_live_state_and_unknown_when_unread() {
        use crate::hardware::{VbsState, VirtualizationInfo};
        let row = |s: VbsState| {
            let v = VirtualizationInfo { vbs_state: s, ..Default::default() };
            vbs_running_entry(Some(&v)).value
        };
        assert_eq!(row(VbsState::Running), "Running");
        assert_eq!(row(VbsState::EnabledNotRunning), "Turned on, not running");
        assert_eq!(row(VbsState::Off), "Off");
        assert_eq!(row(VbsState::Unknown), "Unknown");
        assert_eq!(vbs_running_entry(None).value, "Unknown");
        assert_eq!(vbs_running_entry(None).label, "VBS running now");
    }

    #[test]
    fn sections_are_the_fixed_set_in_order() {
        let names: Vec<String> = get_diagnostics().into_iter().map(|s| s.name).collect();
        // The fixed prefix is a machine-independent UI + Export contract, always
        // in this order. The trailing "Services · …" inventory groups are
        // rig-dependent (which categories appear depends on the live services),
        // so they are NOT part of the fixed set — but every section past the
        // prefix MUST be one.
        let fixed = [
            "Power & boot",
            "Security",
            "Display",
            "Memory",
            "Storage",
            "Network",
            "Peripherals",
            "Background services",
        ];
        // "Machine Model" is a fixed SUFFIX, not part of the rig-dependent middle: it is pushed
        // unconditionally, so a build where it is absent or merely optional is a build where a
        // consumer cannot rely on it being there. Asserted separately from the prefix so the
        // existing eight keep their exact contract order (#385).
        assert!(
            names.len() > fixed.len(),
            "expected at least the fixed set plus the Machine Model summary, got {names:?}"
        );
        assert_eq!(&names[..fixed.len()], &fixed, "the fixed section set/order is a UI + Export contract");
        assert_eq!(
            names.last().map(String::as_str),
            Some("Machine Model"),
            "the Machine Model summary is always the LAST section, so a reader reaches it from a known place"
        );
        // The middle is rig-dependent + condition-gated: the per-category "Services · …" inventory
        // groups (which appear depends on the live services), plus the drift-only recovery guide and
        // the (scan-gated) overlay-tools advisory. Every section between the prefix and the Machine
        // Model suffix must be one of these.
        for extra in &names[fixed.len()..names.len() - 1] {
            assert!(
                extra.starts_with("Services · ")
                    || extra == "Background services · How to restore"
                    || extra == "On-screen overlays",
                "unexpected section after the fixed set: {extra}"
            );
        }
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
        assert!(labels_of("Security").iter().any(|l| l == "VBS running now"));
        assert!(labels_of("Storage").iter().any(|l| l == "Reserved Storage active"));
        // The Wired-Ethernet row exists even when Windows returns no adapters (honest "Unknown").
        assert!(labels_of("Network").iter().any(|l| l == "Wired Ethernet"));
        // The service inventory always carries its summary row (even if WMI
        // returns nothing). The categorised per-service rows live in
        // "Services · …" groups and are rig-dependent, so they aren't asserted
        // here — see `service_inventory_summary_matches_listed_rows`.
        assert!(labels_of("Background services").iter().any(|l| l == "Service inventory"));
    }

    #[test]
    fn service_inventory_summary_matches_listed_rows() {
        // Machine-independent invariant: every recognised service becomes exactly
        // one row in exactly one "Services · …" group, so the summary's
        // "recognised" count must equal the total rows across those groups.
        let sections = get_diagnostics();
        let listed: usize = sections
            .iter()
            .filter(|s| s.name.starts_with("Services · "))
            .map(|s| s.entries.len())
            .sum();
        let summary = sections
            .iter()
            .find(|s| s.name == "Background services")
            .and_then(|s| s.entries.iter().find(|e| e.label == "Service inventory"))
            .map(|e| e.value.clone())
            .expect("summary row present");
        // value format: "<recognised> recognised of <total> total"
        let recognised: usize = summary
            .split_whitespace()
            .next()
            .and_then(|n| n.parse().ok())
            .expect("recognised count parses");
        assert_eq!(recognised, listed, "summary 'recognised' must equal listed service rows ({summary})");
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
