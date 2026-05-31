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
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct ReadinessCheck {
    id: &'static str,
    label: &'static str,
    status: ReadinessStatus,
    detail: String,
    /// Optional short current value to show alongside the row (e.g. "144 Hz").
    value: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct GameReadiness {
    checks: Vec<ReadinessCheck>,
    // Transparent counts instead of a magic score (inputs are often incomplete).
    ready_count: usize,
    attention_count: usize,
    unknown_count: usize,
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

    // 2. Game install drive — no per-game path detection yet, so report the
    //    storage situation honestly rather than guess where a game lives.
    {
        let has_fast = hw.physical_disks.iter().any(|d| {
            let b = d.bus_type.to_uppercase();
            let m = d.media_type.to_uppercase();
            b.contains("NVME") || m.contains("SSD") || m == "SCM"
        });
        let c = if hw.physical_disks.is_empty() {
            // Fallback: MSFT_PhysicalDisk returned nothing. If Windows still reports
            // logical volumes, acknowledge them (drive type unavailable) rather than
            // claiming no storage exists; otherwise truly unknown.
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
                    "Drive type couldn't be read (physical-disk info unavailable), but Windows \
                     reports drives present. Keep games on your fastest drive.",
                    Some(format!("{} volume(s) detected", hw.disks.len())),
                )
            }
        } else if has_fast {
            check(
                "install-drive",
                "Game install drive",
                ReadinessStatus::Unknown,
                "You have fast storage (NVMe/SSD) available — keep games on it. Sentinel doesn't \
                 yet detect which drive a specific game is installed on.",
                Some("Fast drive available".into()),
            )
        } else {
            check(
                "install-drive",
                "Game install drive",
                ReadinessStatus::Attention,
                "Only HDD storage was detected. Games load and stream textures noticeably slower \
                 on an HDD than on an SSD/NVMe drive.",
                Some("HDD only".into()),
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

    // 4. Variable refresh rate — Sentinel has no VRR detection (no kernel access);
    //    advisory only, never a failure.
    checks.push(check(
        "vrr",
        "Variable refresh rate (G-SYNC / FreeSync)",
        ReadinessStatus::Unknown,
        "Sentinel can't read VRR state. If your monitor and GPU support G-SYNC/FreeSync, enabling \
         it in your GPU control panel smooths frame pacing. Advisory only.",
        None,
    ));

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
                    "{} change(s) Sentinel applied are no longer active — something outside \
                     Sentinel changed them. Review the Trust Ledger; rollbacks remain available.",
                    hist.externally_reverted
                ),
                Some(format!(
                    "{} active / {} reverted",
                    hist.active, hist.externally_reverted
                )),
            )
        } else if hist.total == 0 {
            check(
                "applied-changes",
                "Applied Sentinel changes",
                ReadinessStatus::Ready,
                "No Sentinel changes have been applied yet.",
                Some("0".into()),
            )
        } else {
            check(
                "applied-changes",
                "Applied Sentinel changes",
                ReadinessStatus::Ready,
                format!(
                    "{} Sentinel change(s) active; all reversible from the Trust Ledger.",
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

    GameReadiness {
        checks,
        ready_count,
        attention_count,
        unknown_count,
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
    fn install_drive_falls_back_to_logical_disks_when_physical_empty() {
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
        // No physical-disk info, but logical volumes exist → still Unknown (can't
        // assess SSD-vs-HDD) yet acknowledges the drives rather than "no drives".
        assert_eq!(c.status, ReadinessStatus::Unknown);
        assert!(c.detail.to_lowercase().contains("drives present"));
        assert!(c.value.as_deref().unwrap_or("").contains("volume"));
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
        assert_eq!(find(&r, "vrr").status, ReadinessStatus::Unknown);
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
            r.ready_count + r.attention_count + r.unknown_count,
            r.checks.len()
        );
        assert_eq!(r.checks.len(), 8);
    }
}
