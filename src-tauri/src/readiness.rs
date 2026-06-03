//! Game Readiness (F2): a READ-ONLY, advisory surface that answers "is my PC
//! configured sensibly before I play?" It only composes existing detection —
//! hardware, the active power plan, monitoring capability, and the Trust Ledger.
//! It mutates nothing, applies/rolls back nothing, and starts nothing on its own.
//!
//! The status→reason logic lives in the pure `evaluate_readiness` so it can be
//! unit-tested with synthetic inputs (no real detection, no Windows calls); the
//! `get_game_readiness` command just gathers the live inputs and calls it.

use std::sync::atomic::Ordering;

use serde::Serialize;

use crate::current_power_plan_name;
use crate::hardware::{get_hardware_info, HardwareInfo};
use crate::history::{applied_changes_summary, AppliedChangesSummary};
use crate::monitoring::{fps_active, uac_disabled};

const ADVISORY: &str =
    "Readiness checks are advisory. Sentinel is checking configuration signals, not guaranteeing FPS.";

// GPU driver currency thresholds (days). Gaming drivers update ~monthly.
const DRIVER_FRESH_DAYS: i64 = 90;
const DRIVER_OLD_DAYS: i64 = 365;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ReadinessStatus {
    Ready,
    Attention,
    Unknown,
    /// Sentinel deliberately doesn't (or can't) judge this — it's the user's to
    /// verify (e.g. VRR has no Windows API exposing its on/off state). Distinct
    /// from `Unknown` (which means a detection genuinely failed). An advisory is
    /// never a problem and never blocks a clean readiness state.
    Advisory,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct ReadinessCheck {
    id: &'static str,
    label: &'static str,
    status: ReadinessStatus,
    detail: String,
    /// Optional short current value to show alongside the row (e.g. "144 Hz").
    value: Option<String>,
    /// Optional allowlisted deep-link the UI offers as an action button (e.g. the
    /// Windows VRR setting). Only fixed `ms-settings:` targets, never user data.
    #[serde(skip_serializing_if = "Option::is_none")]
    action_uri: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    action_label: Option<&'static str>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct GameReadiness {
    checks: Vec<ReadinessCheck>,
    // Transparent counts instead of a magic score (inputs are often incomplete).
    ready_count: usize,
    attention_count: usize,
    unknown_count: usize,
    advisory_count: usize,
    advisory: &'static str,
}

fn check(
    id: &'static str,
    label: &'static str,
    status: ReadinessStatus,
    detail: impl Into<String>,
    value: Option<String>,
) -> ReadinessCheck {
    ReadinessCheck {
        id,
        label,
        status,
        detail: detail.into(),
        value,
        action_uri: None,
        action_label: None,
    }
}

/// Pure evaluation: maps already-detected inputs to advisory readiness rows.
/// No system access — fully unit-testable.
pub(crate) fn evaluate_readiness(
    hw: &HardwareInfo,
    power_plan: Option<&str>,
    fps_uac_required: bool,
    fps_running: bool,
    hist: &AppliedChangesSummary,
) -> GameReadiness {
    let mut checks = Vec::new();

    // 1. Monitor refresh rate — current vs max supported (at current resolution).
    checks.push(match hw.display.as_ref() {
        None => check(
            "monitor-refresh",
            "Monitor refresh rate",
            ReadinessStatus::Unknown,
            "No display information was detected.",
            None,
        ),
        Some(d) if d.max_refresh_rate_hz == 0 => check(
            "monitor-refresh",
            "Monitor refresh rate",
            ReadinessStatus::Unknown,
            "Couldn't read the display's supported refresh rates.",
            None,
        ),
        Some(d) if d.current_refresh_rate_hz >= d.max_refresh_rate_hz => check(
            "monitor-refresh",
            "Monitor refresh rate",
            ReadinessStatus::Ready,
            format!("Running at the maximum supported {} Hz.", d.max_refresh_rate_hz),
            Some(format!("{} Hz", d.current_refresh_rate_hz)),
        ),
        Some(d) => check(
            "monitor-refresh",
            "Monitor refresh rate",
            ReadinessStatus::Attention,
            format!(
                "Running at {} Hz but the display supports {} Hz. Set the higher rate in Windows \
                 Display settings → Advanced display.",
                d.current_refresh_rate_hz, d.max_refresh_rate_hz
            ),
            Some(format!("{} / {} Hz", d.current_refresh_rate_hz, d.max_refresh_rate_hz)),
        ),
    });

    // 2. Game install drive — where the user's game libraries (Steam/Epic)
    //    actually live, and whether those drives are fast (NVMe/SSD) or slow
    //    (HDD). Falls back to an honest overall storage posture when no library
    //    is found or a drive's type can't be read — never fabricates a verdict.
    {
        let gs = &hw.game_storage;
        let mut drives: Vec<String> =
            gs.libraries.iter().map(|l| format!("{}:", l.drive)).collect();
        drives.sort();
        drives.dedup();
        let phys_fast = |d: &crate::hardware::PhysicalDiskInfo| {
            let b = d.bus_type.to_uppercase();
            let m = d.media_type.to_uppercase();
            b.contains("NVME") || m.contains("SSD") || m == "SCM"
        };
        let phys_has_fast = hw.physical_disks.iter().any(phys_fast);
        let phys_all_fast = !hw.physical_disks.is_empty() && hw.physical_disks.iter().all(phys_fast);

        let c = if gs.libraries.is_empty() {
            // No launcher library detected — fall back to overall storage posture.
            if hw.physical_disks.is_empty() {
                if hw.disks.is_empty() {
                    check(
                        "install-drive",
                        "Game install drive",
                        ReadinessStatus::Unknown,
                        "No drives were detected, so drive speed can't be assessed.",
                        None,
                    )
                } else {
                    check(
                        "install-drive",
                        "Game install drive",
                        ReadinessStatus::Unknown,
                        "No Steam/Epic game library was detected, and drive types couldn't be \
                         read. Keep games on your fastest (SSD/NVMe) drive.",
                        Some("No library detected".into()),
                    )
                }
            } else if phys_has_fast {
                check(
                    "install-drive",
                    "Game install drive",
                    ReadinessStatus::Unknown,
                    "No Steam/Epic game library was detected. You have fast storage available — \
                     keep games on your SSD/NVMe.",
                    Some("No library detected".into()),
                )
            } else {
                check(
                    "install-drive",
                    "Game install drive",
                    ReadinessStatus::Attention,
                    "Only HDD storage was detected. Games load and stream textures much slower on \
                     an HDD than on an SSD/NVMe drive.",
                    Some("HDD only".into()),
                )
            }
        } else if gs.any_slow {
            let slow: Vec<String> = gs
                .libraries
                .iter()
                .filter(|l| l.media_type == "HDD")
                .map(|l| format!("{}:", l.drive))
                .collect();
            check(
                "install-drive",
                "Game install drive",
                ReadinessStatus::Attention,
                format!(
                    "A game library is on an HDD ({}). Games load and stream textures much slower \
                     from an HDD — move them to your SSD/NVMe.",
                    slow.join(", ")
                ),
                Some(format!("HDD: {}", slow.join(", "))),
            )
        } else if gs.any_fast && gs.libraries.iter().all(|l| l.media_type != "Unknown") {
            check(
                "install-drive",
                "Game install drive",
                ReadinessStatus::Ready,
                format!("Your game library is on fast storage ({}).", drives.join(", ")),
                Some(format!("Fast · {}", drives.join(", "))),
            )
        } else if phys_all_fast {
            // Per-library drive type was unreadable, but every physical disk is
            // fast — so the games are necessarily on fast storage.
            check(
                "install-drive",
                "Game install drive",
                ReadinessStatus::Ready,
                format!(
                    "Your game library is on drive {} — and all your storage is NVMe/SSD, so your \
                     games are on fast storage.",
                    drives.join(", ")
                ),
                Some(format!("Fast · {}", drives.join(", "))),
            )
        } else {
            check(
                "install-drive",
                "Game install drive",
                ReadinessStatus::Unknown,
                format!(
                    "Found a game library on {} but couldn't read that drive's type. Keep games \
                     on your SSD/NVMe.",
                    drives.join(", ")
                ),
                Some(drives.join(", ")),
            )
        };
        checks.push(c);
    }

    // 3. GPU driver age — use the discrete GPU (largest VRAM).
    {
        let primary = hw.gpus.iter().max_by_key(|g| g.vram_bytes);
        let c = match primary {
            None => check(
                "gpu-driver-age",
                "GPU driver age",
                ReadinessStatus::Unknown,
                "No GPU was detected.",
                None,
            ),
            Some(g) => match g.driver_age_days {
                None => check(
                    "gpu-driver-age",
                    "GPU driver age",
                    ReadinessStatus::Unknown,
                    format!("Couldn't read a driver date for {}.", g.name),
                    (!g.driver_version.is_empty()).then(|| g.driver_version.clone()),
                ),
                Some(age) if age <= DRIVER_FRESH_DAYS => check(
                    "gpu-driver-age",
                    "GPU driver age",
                    ReadinessStatus::Ready,
                    format!("{} driver is current ({} days old).", g.name, age),
                    Some(format!("{} days", age)),
                ),
                Some(age) if age <= DRIVER_OLD_DAYS => check(
                    "gpu-driver-age",
                    "GPU driver age",
                    ReadinessStatus::Attention,
                    format!(
                        "{} driver is {} days old — consider updating for game fixes and performance.",
                        g.name, age
                    ),
                    Some(format!("{} days", age)),
                ),
                Some(age) => check(
                    "gpu-driver-age",
                    "GPU driver age",
                    ReadinessStatus::Attention,
                    format!(
                        "{} driver is over a year old ({} days). Updating is recommended.",
                        g.name, age
                    ),
                    Some(format!("{} days", age)),
                ),
            },
        };
        checks.push(c);
    }

    // 4. Variable refresh rate — no public Windows API exposes VRR on/off, so this
    //    is an explicit ADVISORY the user verifies, NOT a failed detection. Where
    //    the display is clearly high-refresh, say it's almost certainly VRR-capable
    //    (an honest inference from the detected max refresh), and offer a deep-link
    //    to the Windows VRR setting so the row is actionable, not a dead end.
    {
        let vrr_detail = match hw.display.as_ref() {
            Some(d) if d.max_refresh_rate_hz >= 100 => format!(
                "Your {} Hz display almost certainly supports VRR (G-SYNC/FreeSync). Windows \
                 doesn't expose whether it's currently on — verify it's enabled in your GPU \
                 control panel. It smooths frame pacing and removes tearing.",
                d.max_refresh_rate_hz
            ),
            _ => "If your monitor + GPU support VRR (G-SYNC/FreeSync), enabling it smooths frame \
                  pacing and removes tearing. Windows doesn't expose its on/off state, so verify \
                  it in your GPU control panel."
                .to_string(),
        };
        checks.push(ReadinessCheck {
            id: "vrr",
            label: "Variable refresh rate (G-SYNC / FreeSync)",
            status: ReadinessStatus::Advisory,
            detail: vrr_detail,
            value: Some("Verify in GPU panel".into()),
            action_uri: Some("ms-settings:display-advancedgraphics"),
            action_label: Some("Open VRR settings"),
        });
    }

    // 5. HDR / Auto HDR — gated on an HDR-capable display; advisory.
    checks.push(match hw.display.as_ref() {
        None => check(
            "hdr",
            "HDR / Auto HDR",
            ReadinessStatus::Unknown,
            "No display information was detected.",
            None,
        ),
        Some(d) if d.hdr_capable => check(
            "hdr",
            "HDR / Auto HDR",
            ReadinessStatus::Attention,
            "An HDR-capable display was detected. For competitive play, verify HDR/Auto HDR suits \
             you — HDR can add latency or brightness variance on some setups. Advisory only.",
            Some("HDR-capable".into()),
        ),
        Some(_) => check(
            "hdr",
            "HDR / Auto HDR",
            ReadinessStatus::Ready,
            "No HDR-capable display detected — no HDR configuration needed.",
            None,
        ),
    });

    // 6. Power profile — show the active plan; never switch it automatically.
    checks.push(match power_plan {
        None => check(
            "power-profile",
            "Power profile",
            ReadinessStatus::Unknown,
            "Couldn't read the active Windows power plan.",
            None,
        ),
        Some(p) => {
            let lp = p.to_lowercase();
            if lp.contains("ultimate") || lp.contains("high performance") {
                check(
                    "power-profile",
                    "Power profile",
                    ReadinessStatus::Ready,
                    format!("Active plan \"{}\" is performance-oriented.", p),
                    Some(p.to_string()),
                )
            } else {
                check(
                    "power-profile",
                    "Power profile",
                    ReadinessStatus::Attention,
                    format!(
                        "Active plan \"{}\". A performance plan (High performance / Ultimate \
                         Performance) can reduce latency. Sentinel won't switch it for you.",
                        p
                    ),
                    Some(p.to_string()),
                )
            }
        }
    });

    // 7. FPS monitoring readiness — a capability check; never auto-starts.
    {
        let detail = if fps_running {
            "FPS & frametime monitoring is running.".to_string()
        } else if fps_uac_required {
            "FPS & frametime capture is supported (ETW, no kernel driver). Starting it asks for \
             Administrator approval once."
                .to_string()
        } else {
            "FPS & frametime capture is supported (ETW, no kernel driver).".to_string()
        };
        checks.push(check(
            "fps-monitoring",
            "FPS monitoring readiness",
            ReadinessStatus::Ready,
            detail,
            Some(if fps_running { "Running".into() } else { "Ready".into() }),
        ));
    }

    // 8. Applied Sentinel changes — count active + flag external reverts.
    {
        let c = if hist.externally_reverted > 0 {
            check(
                "applied-changes",
                "Applied Sentinel changes",
                ReadinessStatus::Attention,
                format!(
                    "{} setting(s) you turned on with Sentinel are currently off — changed \
                     outside Sentinel (by Windows, another app, or you). Not an error: turn them \
                     back on in Optimize, or roll them back in the Ledger — either one clears this.",
                    hist.externally_reverted
                ),
                Some(format!(
                    "{} on / {} drifted",
                    hist.active, hist.externally_reverted
                )),
            )
        } else if hist.total == 0 {
            check(
                "applied-changes",
                "Applied Sentinel changes",
                ReadinessStatus::Ready,
                "No Sentinel changes applied yet — nothing to track.",
                Some("0".into()),
            )
        } else {
            check(
                "applied-changes",
                "Applied Sentinel changes",
                ReadinessStatus::Ready,
                format!(
                    "{} setting(s) active and reversible from the Trust Ledger.",
                    hist.active
                ),
                Some(format!("{} active", hist.active)),
            )
        };
        checks.push(c);
    }

    let ready_count = checks.iter().filter(|c| c.status == ReadinessStatus::Ready).count();
    let attention_count = checks
        .iter()
        .filter(|c| c.status == ReadinessStatus::Attention)
        .count();
    let unknown_count = checks
        .iter()
        .filter(|c| c.status == ReadinessStatus::Unknown)
        .count();
    let advisory_count = checks
        .iter()
        .filter(|c| c.status == ReadinessStatus::Advisory)
        .count();

    GameReadiness {
        checks,
        ready_count,
        attention_count,
        unknown_count,
        advisory_count,
        advisory: ADVISORY,
    }
}

#[tauri::command]
pub(crate) fn get_game_readiness() -> GameReadiness {
    let hw = get_hardware_info();
    let power_plan = current_power_plan_name();
    let fps_uac_required = !uac_disabled();
    let fps_running = fps_active().load(Ordering::Acquire);
    let hist = applied_changes_summary();
    evaluate_readiness(&hw, power_plan.as_deref(), fps_uac_required, fps_running, &hist)
}

#[cfg(test)]
mod readiness_tests {
    use super::*;
    use crate::hardware::{DisplayInfo, GpuInfo, PhysicalDiskInfo};

    fn find<'a>(r: &'a GameReadiness, id: &str) -> &'a ReadinessCheck {
        r.checks.iter().find(|c| c.id == id).expect("check present")
    }

    fn hw_with(
        display: Option<DisplayInfo>,
        gpus: Vec<GpuInfo>,
        disks: Vec<PhysicalDiskInfo>,
    ) -> HardwareInfo {
        HardwareInfo {
            display,
            gpus,
            physical_disks: disks,
            ..Default::default()
        }
    }

    #[test]
    fn install_drive_no_library_no_disk_types_is_unknown() {
        use crate::hardware::DiskInfo;
        let hw = HardwareInfo {
            physical_disks: vec![],
            disks: vec![DiskInfo {
                mount_point: "C:\\".into(),
                total_bytes: 999_000_000_000,
                available_bytes: 200_000_000_000,
                file_system: "NTFS".into(),
            }],
            ..Default::default()
        };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default());
        let c = find(&r, "install-drive");
        // No game library detected and drive types unreadable → honest Unknown.
        assert_eq!(c.status, ReadinessStatus::Unknown);
        assert!(c.detail.to_lowercase().contains("no steam/epic game library"));
    }

    #[test]
    fn install_drive_library_on_ssd_is_ready() {
        use crate::hardware::{GameLibrary, GameStorage};
        let hw = HardwareInfo {
            game_storage: GameStorage {
                libraries: vec![GameLibrary {
                    launcher: "Steam".into(),
                    drive: "C".into(),
                    media_type: "SSD".into(),
                    bus_type: "NVMe".into(),
                }],
                any_fast: true,
                any_slow: false,
            },
            ..Default::default()
        };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default());
        let c = find(&r, "install-drive");
        assert_eq!(c.status, ReadinessStatus::Ready);
        assert!(c.detail.to_lowercase().contains("fast storage"));
    }

    #[test]
    fn install_drive_library_on_hdd_is_attention() {
        use crate::hardware::{GameLibrary, GameStorage};
        let hw = HardwareInfo {
            game_storage: GameStorage {
                libraries: vec![GameLibrary {
                    launcher: "Steam".into(),
                    drive: "D".into(),
                    media_type: "HDD".into(),
                    bus_type: "SATA".into(),
                }],
                any_fast: false,
                any_slow: true,
            },
            ..Default::default()
        };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default());
        let c = find(&r, "install-drive");
        assert_eq!(c.status, ReadinessStatus::Attention);
        assert!(c.detail.contains("HDD"));
    }

    #[test]
    fn install_drive_unknown_media_all_disks_fast_is_ready() {
        use crate::hardware::{GameLibrary, GameStorage, PhysicalDiskInfo};
        let hw = HardwareInfo {
            game_storage: GameStorage {
                libraries: vec![GameLibrary {
                    launcher: "Steam".into(),
                    drive: "C".into(),
                    media_type: "Unknown".into(),
                    bus_type: String::new(),
                }],
                any_fast: false,
                any_slow: false,
            },
            physical_disks: vec![PhysicalDiskInfo {
                media_type: "SSD".into(),
                bus_type: "NVMe".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default());
        let c = find(&r, "install-drive");
        assert_eq!(c.status, ReadinessStatus::Ready);
        assert!(c.detail.to_lowercase().contains("all your storage"));
    }

    #[test]
    fn optimal_setup_marks_core_checks_ready() {
        let hw = hw_with(
            Some(DisplayInfo {
                current_refresh_rate_hz: 144,
                max_refresh_rate_hz: 144,
                hdr_capable: false,
                ..Default::default()
            }),
            vec![GpuInfo {
                name: "Test GPU".into(),
                vram_bytes: 16u64 << 30,
                driver_age_days: Some(10),
                ..Default::default()
            }],
            vec![PhysicalDiskInfo {
                bus_type: "NVMe".into(),
                media_type: "SSD".into(),
                ..Default::default()
            }],
        );
        let r = evaluate_readiness(
            &hw,
            Some("Ultimate Performance"),
            false,
            false,
            &AppliedChangesSummary::default(),
        );
        assert_eq!(find(&r, "monitor-refresh").status, ReadinessStatus::Ready);
        assert_eq!(find(&r, "gpu-driver-age").status, ReadinessStatus::Ready);
        assert_eq!(find(&r, "power-profile").status, ReadinessStatus::Ready);
        assert_eq!(find(&r, "hdr").status, ReadinessStatus::Ready);
    }

    #[test]
    fn suboptimal_setup_flags_attention() {
        let hw = hw_with(
            Some(DisplayInfo {
                current_refresh_rate_hz: 60,
                max_refresh_rate_hz: 144,
                hdr_capable: true,
                ..Default::default()
            }),
            vec![GpuInfo {
                name: "Test GPU".into(),
                vram_bytes: 8u64 << 30,
                driver_age_days: Some(500),
                ..Default::default()
            }],
            vec![PhysicalDiskInfo {
                bus_type: "SATA".into(),
                media_type: "HDD".into(),
                ..Default::default()
            }],
        );
        let r = evaluate_readiness(&hw, Some("Balanced"), true, false, &AppliedChangesSummary::default());
        assert_eq!(find(&r, "monitor-refresh").status, ReadinessStatus::Attention);
        assert_eq!(find(&r, "gpu-driver-age").status, ReadinessStatus::Attention);
        assert_eq!(find(&r, "power-profile").status, ReadinessStatus::Attention);
        assert_eq!(find(&r, "hdr").status, ReadinessStatus::Attention);
        assert_eq!(find(&r, "install-drive").status, ReadinessStatus::Attention);
    }

    #[test]
    fn missing_data_is_unknown_not_fabricated() {
        let hw = hw_with(None, vec![], vec![]);
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default());
        assert_eq!(find(&r, "monitor-refresh").status, ReadinessStatus::Unknown);
        assert_eq!(find(&r, "gpu-driver-age").status, ReadinessStatus::Unknown);
        assert_eq!(find(&r, "power-profile").status, ReadinessStatus::Unknown);
        assert_eq!(find(&r, "install-drive").status, ReadinessStatus::Unknown);
        // VRR is always Advisory (no API exposes its state) — never a grey Unknown.
        assert_eq!(find(&r, "vrr").status, ReadinessStatus::Advisory);
    }

    #[test]
    fn vrr_is_advisory_with_action_not_unknown() {
        let hw = hw_with(None, vec![], vec![]);
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default());
        let c = find(&r, "vrr");
        assert_eq!(c.status, ReadinessStatus::Advisory);
        assert!(c.action_uri.is_some(), "VRR advisory should offer an action link");
        // Advisory must not be counted as a problem.
        assert_eq!(r.attention_count, 0);
        assert!(r.advisory_count >= 1);
    }

    #[test]
    fn externally_reverted_change_raises_attention() {
        let hw = hw_with(None, vec![], vec![]);
        let hist = AppliedChangesSummary {
            total: 3,
            active: 2,
            rolled_back: 0,
            externally_reverted: 1,
        };
        let r = evaluate_readiness(&hw, None, false, false, &hist);
        assert_eq!(find(&r, "applied-changes").status, ReadinessStatus::Attention);
    }

    #[test]
    fn status_counts_cover_every_check() {
        let hw = hw_with(None, vec![], vec![]);
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default());
        assert_eq!(
            r.ready_count + r.attention_count + r.unknown_count + r.advisory_count,
            r.checks.len()
        );
        assert_eq!(r.checks.len(), 8);
    }
}
