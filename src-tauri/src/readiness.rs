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
    "Readiness checks are advisory. Compy is checking configuration signals, not guaranteeing FPS.";

// GPU driver currency thresholds (days). Gaming drivers update ~monthly.
const DRIVER_FRESH_DAYS: i64 = 90;
const DRIVER_OLD_DAYS: i64 = 365;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ReadinessStatus {
    Ready,
    Attention,
    Unknown,
    /// Compy deliberately doesn't (or can't) judge this — it's the user's to
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
    /// For the "applied-changes" drift row ONLY: the exact rec titles that were applied via
    /// Compy and have since drifted off. Downstream advisory layers (priorities) read this to
    /// dedup a drifted rec OUT of "safe tweaks not applied" — a drifted setting is
    /// applied-then-reverted, NOT never-applied, and listing it as both is contradictory.
    /// Empty on every other check.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    drifted_titles: Vec<String>,
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
    /// Check ids the user has explicitly dismissed (informed "I've judged this, stop alerting me").
    /// Dismissed checks are excluded from `attention_count` so they never hold the amber/ring/score —
    /// the UI tucks them into a quiet "Dismissed" section the user can revisit + restore.
    dismissed_ids: Vec<String>,
    /// Drift Watch: checks that WERE good and have since regressed (outside Compy). Surfaced as a
    /// quiet heads-up; the underlying check still counts normally, this just adds the "it drifted"
    /// framing.
    drifts: Vec<crate::drift::Drift>,
}

impl GameReadiness {
    /// Apply user dismissals: drop dismissed checks from the actionable `attention_count` (they keep
    /// their real status for the Dismissed section, but stop counting as an alert).
    fn apply_dismissals(&mut self, dismissed: Vec<String>) {
        let set: std::collections::HashSet<&str> = dismissed.iter().map(|s| s.as_str()).collect();
        self.attention_count = self
            .checks
            .iter()
            .filter(|c| c.status == ReadinessStatus::Attention && !set.contains(c.id))
            .count();
        self.dismissed_ids = dismissed;
    }
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
        drifted_titles: Vec::new(),
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
    // AMD FreeSync (VRR) state from the GPU poller: Some(true)=on, Some(false)=supported-but-off,
    // None=undetermined (non-AMD, unsupported/unavailable, or not yet read) → honest advisory.
    freesync: Option<bool>,
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

    // Memory speed — RAM running below its rated speed (EXPO/XMP likely off). Read-only advisory:
    // it's a BIOS profile Compy can't flip, so we name it and point to BIOS (no action_uri). Never
    // claims a profile is "active" — only flags the provable below-rated case.
    {
        let below = hw
            .memory_modules
            .iter()
            .find(|m| m.xmp_expo_status == "running_below_rated" && m.rated_speed_mhz > 0);
        let any_known = hw.memory_modules.iter().any(|m| {
            m.xmp_expo_status == "running_below_rated" || m.xmp_expo_status == "running_at_rated"
        });
        checks.push(match (below, any_known) {
            (Some(m), _) => check(
                "memory-speed",
                "Memory speed",
                ReadinessStatus::Attention,
                "Your RAM is running below its rated speed — enabling EXPO/XMP in BIOS unlocks the \
                 speed the kit is sold at. It's a BIOS memory profile, not something Compy changes.",
                Some(format!("{} of {} MT/s", m.speed_mhz, m.rated_speed_mhz)),
            ),
            (None, true) => check(
                "memory-speed",
                "Memory speed",
                ReadinessStatus::Ready,
                "RAM is running at its rated speed.",
                None,
            ),
            (None, false) => check(
                "memory-speed",
                "Memory speed",
                ReadinessStatus::Unknown,
                "Couldn't compare configured vs rated memory speed on this system.",
                None,
            ),
        });
    }

    // Memory channels — a single populated stick runs single-channel, a real bandwidth loss for
    // gaming that a matching second stick fixes. EXCEPTION: a single SOLDERED LPDDR module (laptops /
    // mini-PCs) physically can't take a second stick, so the advice would be an impossible dead-end —
    // treat that as Ready, not Attention (flags must carry an actionable fix, never a dead-end). The
    // SMBIOS parser skips empty slots, so memory_modules.len() is the count of POPULATED sticks.
    {
        let populated = hw.memory_modules.len();
        let one = hw.memory_modules.first();
        let soldered_lpddr = one
            .map(|m| m.type_name.to_uppercase().starts_with("LPDDR"))
            .unwrap_or(false);
        checks.push(match (populated, soldered_lpddr) {
            (1, false) => check(
                "memory-channels",
                "Memory channels",
                ReadinessStatus::Attention,
                "You have a single RAM stick — adding a matching second stick enables dual-channel \
                 memory, a real bandwidth gain for gaming. It's a hardware add, not a BIOS setting.",
                one.map(|m| format!("1 module ({})", m.type_name)),
            ),
            (1, true) => check(
                "memory-channels",
                "Memory channels",
                ReadinessStatus::Ready,
                "Memory is a single soldered module, so dual-channel isn't an upgrade option on this \
                 design.",
                one.map(|m| format!("1 soldered module ({})", m.type_name)),
            ),
            (0, _) => check(
                "memory-channels",
                "Memory channels",
                ReadinessStatus::Unknown,
                "Couldn't read the installed memory modules on this system.",
                None,
            ),
            (n, _) => check(
                "memory-channels",
                "Memory channels",
                ReadinessStatus::Ready,
                "Running in dual-channel (or wider) — multiple memory modules are populated.",
                Some(format!("{n} modules")),
            ),
        });
    }

    // Memory capacity — 16 GB is the comfortable floor for modern gaming; under it, heavier titles can
    // stutter or hitch while streaming textures (more so with a browser/Discord open). Read-only
    // advisory from the already-detected total — no probe. ram_total is the OS-VISIBLE total (a few %
    // under the marketed amount due to reserved / integrated-GPU memory), so round to the whole GB the
    // user recognizes (15.8 -> 16) and band generously — never nitpick a rounding edge.
    {
        const GIB: u64 = 1024 * 1024 * 1024;
        checks.push(if hw.ram_total_bytes == 0 {
            check(
                "memory-capacity",
                "Memory capacity",
                ReadinessStatus::Unknown,
                "Couldn't read how much RAM is installed.",
                None,
            )
        } else {
            let gb = (hw.ram_total_bytes + GIB / 2) / GIB; // nearest whole GB
            if gb >= 16 {
                check(
                    "memory-capacity",
                    "Memory capacity",
                    ReadinessStatus::Ready,
                    "16 GB or more — comfortable for modern gaming.",
                    Some(format!("{gb} GB")),
                )
            } else {
                check(
                    "memory-capacity",
                    "Memory capacity",
                    ReadinessStatus::Advisory,
                    "16 GB is the comfortable floor for modern gaming — under it, heavier titles can \
                     stutter or hitch while streaming textures (more so with a browser or Discord \
                     open). Adding RAM is the fix if you feel it.",
                    Some(format!("{gb} GB")),
                )
            }
        });
    }

    // CPU cores — 6 physical cores is the comfortable floor for modern gaming (owner-set, 2026-06-22);
    // under it a CPU-heavy title (sims, open-world, heavy streaming) can bottleneck the GPU. Read-only
    // advisory from the already-detected physical-core count — no probe. Unreadable (0) -> Unknown.
    {
        let cores = hw.cpu_cores_physical;
        checks.push(if cores == 0 {
            check(
                "cpu-cores",
                "CPU cores",
                ReadinessStatus::Unknown,
                "Couldn't read the CPU's physical-core count.",
                None,
            )
        } else if cores >= 6 {
            check(
                "cpu-cores",
                "CPU cores",
                ReadinessStatus::Ready,
                "6 or more physical cores — comfortable for modern gaming.",
                Some(format!("{cores} cores")),
            )
        } else {
            check(
                "cpu-cores",
                "CPU cores",
                ReadinessStatus::Advisory,
                "Modern games increasingly want 6+ physical cores — fewer can bottleneck the GPU in \
                 CPU-heavy titles (sims, big open worlds, or while streaming). A CPU upgrade is the \
                 fix if you feel it; many games still run fine.",
                Some(format!("{cores} cores")),
            )
        });
    }

    // GPU VRAM — 6 GB is the comfortable floor for modern gaming (more matters above 1080p); under it,
    // games force texture downgrades or stutter while streaming them in. Read-only advisory from the
    // discrete GPU (largest VRAM, same pick as the driver-age check). No discrete GPU / unreadable ->
    // Unknown (never guess a verdict for an integrated part we can't size honestly).
    {
        const GIB: u64 = 1024 * 1024 * 1024;
        let vram = hw.gpus.iter().map(|g| g.vram_bytes).max().unwrap_or(0);
        checks.push(if vram == 0 {
            check(
                "gpu-vram",
                "GPU memory",
                ReadinessStatus::Unknown,
                "Couldn't read the GPU's video memory.",
                None,
            )
        } else {
            let gb = (vram + GIB / 2) / GIB; // nearest whole GB
            if gb >= 6 {
                check(
                    "gpu-vram",
                    "GPU memory",
                    ReadinessStatus::Ready,
                    "6 GB or more of video memory — comfortable for modern gaming.",
                    Some(format!("{gb} GB VRAM")),
                )
            } else {
                check(
                    "gpu-vram",
                    "GPU memory",
                    ReadinessStatus::Advisory,
                    "6 GB of video memory is the comfortable floor for modern gaming (more matters \
                     above 1080p) — under it, games can force texture downgrades or stutter streaming \
                     them in. A GPU upgrade is the fix if you feel it.",
                    Some(format!("{gb} GB VRAM")),
                )
            }
        });
    }

    // Drive health — the OS SMART summary. A Warning/Unhealthy verdict is a back-up-now safety signal;
    // healthy drives read Ready. Per-attribute SMART isn't user-mode readable, so this is the summary.
    {
        let bad = hw
            .disk_health
            .iter()
            .find(|d| d.health == "Warning" || d.health == "Unhealthy");
        let any_healthy = hw.disk_health.iter().any(|d| d.health == "Healthy");
        checks.push(match (bad, any_healthy) {
            (Some(d), _) => check(
                "drive-health",
                "Drive health",
                ReadinessStatus::Attention,
                "A drive is reporting a SMART health warning. Back up important data and check the \
                 drive with its vendor's tool — this can precede a failure.",
                Some(format!("{}: {}", d.friendly_name, d.health)),
            ),
            (None, true) => check(
                "drive-health",
                "Drive health",
                ReadinessStatus::Ready,
                "All detected drives report a healthy SMART status.",
                None,
            ),
            (None, false) => check(
                "drive-health",
                "Drive health",
                ReadinessStatus::Unknown,
                "Drive SMART health couldn't be read (the Storage namespace may be blocked).",
                None,
            ),
        });
    }

    // Network connection — wired Ethernet is the steadiest path for online gaming (lower, more
    // consistent latency than Wi-Fi). DERIVED from the already-collected adapter inventory — never a
    // probe of its own (no WMI call here). Wi-Fi is an Advisory, not a problem: plenty of games run
    // fine on it and a cable isn't always feasible (laptop across the house). Offline/undetermined
    // stays Unknown — honest, never a scare.
    checks.push(match crate::hardware::network_connection_kind(&hw.network_adapters) {
        "wired" => check(
            "network-connection",
            "Network connection",
            ReadinessStatus::Ready,
            "Wired Ethernet — the steadiest connection for online gaming (lower, more consistent \
             latency than Wi-Fi).",
            Some("Wired Ethernet".into()),
        ),
        "wifi" => {
            // Measured link (band/signal/rate) when netsh gave readable values; else nothing. The
            // channel is shown only on 2.4 GHz (where overlap matters; 5/6 GHz channels are wide and
            // non-overlapping, so the number adds nothing there).
            let measured: Option<String> = hw
                .wifi_link
                .as_ref()
                .map(|w| {
                    let mut parts: Vec<String> = Vec::new();
                    if let Some(b) = &w.band {
                        match w.channel {
                            Some(ch) if b.contains("2.4") => parts.push(format!("{b} · ch {ch}")),
                            _ => parts.push(b.clone()),
                        }
                    }
                    if let Some(s) = w.signal_pct {
                        parts.push(format!("{s}% signal"));
                    }
                    if let Some(r) = w.rx_mbps {
                        parts.push(format!("{r} Mbps"));
                    }
                    parts.join(" · ")
                })
                .filter(|s| !s.is_empty());
            let on_wifi = match &measured {
                Some(m) => format!("You're on Wi-Fi ({m})."),
                None => "You're on Wi-Fi.".to_string(),
            };
            // Port-aware nudge: if this rig actually HAS a wired Ethernet port, name it — plugging in is
            // the concrete win. Only fall back to the hedged "if you can run a cable" when there's no
            // port (a laptop / Wi-Fi-only rig where a cable may not be feasible). Wi-Fi stays Advisory.
            let wired_clause = if hw.has_wired_ethernet_port {
                "This PC has a wired Ethernet port — plugging it in gives lower, more consistent latency \
                 for online gaming."
            } else {
                "A wired Ethernet connection gives lower, more consistent latency for online gaming — \
                 worth a cable if you can run one."
            };
            // 2.4 GHz overlap advisory: only channels 1/6/11 are non-overlapping. A router parked on any
            // other 2.4 GHz channel co-channel-interferes with neighbors — a real, common gaming gotcha.
            let interference = hw.wifi_link.as_ref().and_then(|w| {
                match (w.band.as_deref(), w.channel) {
                    (Some(b), Some(ch)) if b.contains("2.4") && !matches!(ch, 1 | 6 | 11) => Some(
                        format!(
                            " On 2.4 GHz channel {ch}, only channels 1, 6, and 11 don't overlap — if \
                             Wi-Fi feels congested, switching your router to 1/6/11 (or to 5 GHz) helps."
                        ),
                    ),
                    _ => None,
                }
            });
            let detail = format!(
                "{on_wifi} {wired_clause}{} (Wi-Fi is fine for plenty of games.)",
                interference.as_deref().unwrap_or("")
            );
            let chip = match hw.wifi_link.as_ref().and_then(|w| w.band.clone()) {
                Some(b) => format!("Wi-Fi · {b}"),
                None => "Wi-Fi".to_string(),
            };
            check(
                "network-connection",
                "Network connection",
                ReadinessStatus::Advisory,
                detail,
                Some(chip),
            )
        }
        "other" => check(
            "network-connection",
            "Network connection",
            ReadinessStatus::Ready,
            "A network connection is active.",
            None,
        ),
        _ => check(
            "network-connection",
            "Network connection",
            ReadinessStatus::Unknown,
            "Couldn't determine an active physical network connection.",
            None,
        ),
    });

    // Policy-based QoS traffic shaping — rare on home rigs, but a policy can deprioritize/throttle
    // game traffic. Surfaced ONLY when one actually exists (no clutter when clean): named, as-found,
    // never a fabricated problem. Read-only registry read upstream.
    if !hw.qos_policies.is_empty() {
        let n = hw.qos_policies.len();
        let names = hw.qos_policies.join(", ");
        checks.push(check(
            "network-qos",
            "Network QoS policy",
            ReadinessStatus::Advisory,
            format!(
                "Windows QoS traffic-priority {} active ({names}). These shape which apps get network \
                 priority — listed as-found, not a problem on their own. If online play feels \
                 inconsistent, they're worth a look.",
                if n == 1 { "policy is" } else { "policies are" }
            ),
            Some(format!("{n} QoS {}", if n == 1 { "policy" } else { "policies" })),
        ));
    }

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
                    ReadinessStatus::Advisory,
                    format!(
                        "{} driver is {} days old — still fine. Worth updating around a new game's \
                         launch for day-one fixes, but nothing's broken here; updating mid-cycle \
                         rarely moves measured FPS.",
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

    // 4. Variable refresh rate. On AMD we read the real FreeSync state via ADLX (the poller fills
    //    `freesync`): ON → a verified Ready row; supported-but-off → an actionable advisory. When we
    //    can't read it (non-AMD, unsupported/unavailable, or no reading yet) we fall back to the
    //    honest Phase-1 advisory — an inference from the detected max refresh, never a fabricated
    //    on/off — with a deep-link to the Windows VRR setting so the row is actionable.
    {
        let vrr = match freesync {
            Some(true) => ReadinessCheck {
                id: "vrr",
                label: "Variable refresh rate (G-SYNC / FreeSync)",
                status: ReadinessStatus::Ready,
                detail: "FreeSync is ON — your AMD GPU reports adaptive sync enabled on a connected \
                         display. Frame pacing is smoothed and tearing removed."
                    .to_string(),
                value: Some("FreeSync: on".into()),
                action_uri: Some("ms-settings:display-advancedgraphics"),
                action_label: Some("Open VRR settings"),
                drifted_titles: Vec::new(),
            },
            Some(false) => ReadinessCheck {
                id: "vrr",
                label: "Variable refresh rate (G-SYNC / FreeSync)",
                // Gains-based: a verified supported-but-OFF VRR is a MODEST, clearly-perceptible win
                // (smoother pacing + no tearing across the whole refresh range) — above negligible,
                // so it earns Attention, with the magnitude stated so the user can gauge it.
                status: ReadinessStatus::Attention,
                detail: "Your display supports FreeSync but it's currently OFF. Turning it on is a \
                         modest, clearly-noticeable win — it smooths frame pacing and removes tearing \
                         across your whole refresh range. One toggle in your GPU control panel."
                    .to_string(),
                value: Some("FreeSync: off".into()),
                action_uri: Some("ms-settings:display-advancedgraphics"),
                action_label: Some("Turn on VRR"),
                drifted_titles: Vec::new(),
            },
            None => {
                let detail = match hw.display.as_ref() {
                    Some(d) if d.max_refresh_rate_hz >= 100 => format!(
                        "Your {} Hz display almost certainly supports VRR (G-SYNC/FreeSync). Windows \
                         doesn't expose whether it's currently on — verify it's enabled in your GPU \
                         control panel. It smooths frame pacing and removes tearing.",
                        d.max_refresh_rate_hz
                    ),
                    _ => "If your monitor + GPU support VRR (G-SYNC/FreeSync), enabling it smooths \
                          frame pacing and removes tearing. Windows doesn't expose its on/off state, \
                          so verify it in your GPU control panel."
                        .to_string(),
                };
                ReadinessCheck {
                    id: "vrr",
                    label: "Variable refresh rate (G-SYNC / FreeSync)",
                    status: ReadinessStatus::Advisory,
                    detail,
                    value: Some("Verify in GPU panel".into()),
                    action_uri: Some("ms-settings:display-advancedgraphics"),
                    action_label: Some("Open VRR settings"),
                    drifted_titles: Vec::new(),
                }
            }
        };
        checks.push(vrr);
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
            ReadinessStatus::Advisory,
            "Your display is HDR-capable. Nothing to fix — HDR is a preference, not a performance \
             setting. It only matters competitively if you notice it adding latency or brightness \
             variance; otherwise enable it for richer color in games that support it.",
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
                         Performance) can reduce latency. Compy won't switch it for you.",
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

    // 8. Applied Compy changes — count active + flag external reverts. The drifted settings are
    // named (flags-name-it law: no vague "N setting(s)", no dead-end room references). Post the
    // 2026-07-10 ground-flip the undo home is the Lab (owner: "the Lab is the one undo home");
    // the backend can't read the runtime rail flag, so it names "the Lab" — correct under the
    // shipped default rail, never the retired standalone "Optimize"/"Tune" tabs that no longer exist.
    {
        let c = if hist.externally_reverted > 0 {
            let detail = if hist.externally_reverted == 1 {
                let name = hist
                    .drifted_titles
                    .first()
                    .map(String::as_str)
                    .unwrap_or("A setting");
                format!(
                    "“{name}” — you turned it on with Compy and it's currently off, changed \
                     outside Compy (by Windows, another app, or you). Not an error: turn it \
                     back on or roll it back in the Lab — either one clears this."
                )
            } else {
                let mut names = hist.drifted_titles.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
                if hist.drifted_titles.len() > 3 {
                    names.push_str(&format!(" and {} more", hist.drifted_titles.len() - 3));
                }
                format!(
                    "{} settings you turned on with Compy are currently off ({names}) — changed \
                     outside Compy (by Windows, another app, or you). Not an error: turn them \
                     back on or roll them back in the Lab — either one clears this.",
                    hist.externally_reverted
                )
            };
            let mut ac = check(
                "applied-changes",
                "Applied Compy changes",
                ReadinessStatus::Attention,
                detail,
                Some(format!(
                    "{} on / {} drifted",
                    hist.active, hist.externally_reverted
                )),
            );
            // Structured so the priorities layer can dedup these out of "not applied".
            ac.drifted_titles = hist.drifted_titles.clone();
            ac
        } else if hist.total == 0 {
            check(
                "applied-changes",
                "Applied Compy changes",
                ReadinessStatus::Ready,
                "No Compy changes applied yet — nothing to track.",
                Some("0".into()),
            )
        } else {
            check(
                "applied-changes",
                "Applied Compy changes",
                ReadinessStatus::Ready,
                format!(
                    "{} active and reversible from the Trust Ledger.",
                    if hist.active == 1 { "1 setting".to_string() } else { format!("{} settings", hist.active) }
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
        dismissed_ids: Vec::new(),
        drifts: Vec::new(), // filled by the wrapper (drift detection needs persisted state)
    }
}

/// Map a readiness status to its kebab string — the form Drift Watch's pure core keys on.
fn status_str(s: ReadinessStatus) -> &'static str {
    match s {
        ReadinessStatus::Ready => "ready",
        ReadinessStatus::Attention => "attention",
        ReadinessStatus::Unknown => "unknown",
        ReadinessStatus::Advisory => "advisory",
    }
}

// ── Dismissals: a tiny persisted set of check ids the user has chosen to silence ──────────────
fn dismissals_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("readiness_dismissals.json")
}

fn load_dismissals() -> Vec<String> {
    std::fs::read_to_string(dismissals_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_dismissals(ids: &[String]) -> Result<(), String> {
    // User-framed errors (match export.rs's house pattern) — never a raw OS string to the UI.
    std::fs::create_dir_all(crate::compy_data_dir())
        .map_err(|e| format!("could not create the Compy data folder: {e}"))?;
    let json = serde_json::to_string_pretty(ids)
        .map_err(|e| format!("could not save your dismissed-checks setting: {e}"))?;
    std::fs::write(dismissals_path(), json)
        .map_err(|e| format!("could not save your dismissed-checks setting: {e}"))
}

/// Dismiss a readiness check by id (idempotent) — the user has judged it and wants it silenced.
#[tauri::command]
pub(crate) fn dismiss_readiness_check(id: String) -> Result<(), String> {
    let mut ids = load_dismissals();
    if !ids.contains(&id) {
        ids.push(id);
        save_dismissals(&ids)?;
    }
    Ok(())
}

/// Restore a previously-dismissed check so it alerts again.
#[tauri::command]
pub(crate) fn restore_readiness_check(id: String) -> Result<(), String> {
    let mut ids = load_dismissals();
    ids.retain(|x| x != &id);
    save_dismissals(&ids)
}

#[tauri::command]
pub(crate) fn get_game_readiness() -> GameReadiness {
    let hw = get_hardware_info();
    let power_plan = current_power_plan_name();
    let fps_uac_required = !uac_disabled();
    let fps_running = fps_active().load(Ordering::Acquire);
    let hist = applied_changes_summary();
    // Ensure the AMD poller is running (lazy-start), then read its cached FreeSync state. Non-AMD
    // systems leave this None → the VRR row stays the honest advisory.
    crate::monitoring::ensure_amd_poller_started();
    let freesync = crate::monitoring::amd_freesync_cache().lock().ok().and_then(|c| *c);
    let mut r = evaluate_readiness(
        &hw,
        power_plan.as_deref(),
        fps_uac_required,
        fps_running,
        &hist,
        freesync,
    );
    r.apply_dismissals(load_dismissals());
    // Drift Watch: observe the non-dismissed checks; a previously-good check now needing attention
    // is a regression (outside Compy) worth a quiet heads-up.
    let dismissed: std::collections::HashSet<&str> =
        r.dismissed_ids.iter().map(String::as_str).collect();
    let observations: Vec<(String, String, String, String)> = r
        .checks
        .iter()
        .filter(|c| !dismissed.contains(c.id))
        .map(|c| {
            (c.id.to_string(), c.label.to_string(), status_str(c.status).to_string(), c.detail.clone())
        })
        .collect();
    r.drifts = crate::drift::detect_and_persist(&observations);
    r
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
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
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
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
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
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
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
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
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
            None,
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
        let r = evaluate_readiness(&hw, Some("Balanced"), true, false, &AppliedChangesSummary::default(), None);
        assert_eq!(find(&r, "monitor-refresh").status, ReadinessStatus::Attention);
        assert_eq!(find(&r, "gpu-driver-age").status, ReadinessStatus::Attention); // 500d > 1yr
        assert_eq!(find(&r, "power-profile").status, ReadinessStatus::Attention);
        assert_eq!(find(&r, "install-drive").status, ReadinessStatus::Attention);
        // Severity redesign: HDR-capable is a preference, not a fix — INFO/Advisory, never amber.
        assert_eq!(find(&r, "hdr").status, ReadinessStatus::Advisory);
    }

    #[test]
    fn mid_age_driver_is_advisory_not_amber() {
        // A driver older than "fresh" but well under a year is INFO, not an alarm.
        let hw = hw_with(
            None,
            vec![GpuInfo {
                name: "Test GPU".into(),
                vram_bytes: 8u64 << 30,
                driver_age_days: Some((DRIVER_FRESH_DAYS + DRIVER_OLD_DAYS) / 2),
                ..Default::default()
            }],
            vec![],
        );
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        assert_eq!(find(&r, "gpu-driver-age").status, ReadinessStatus::Advisory);
    }

    #[test]
    fn missing_data_is_unknown_not_fabricated() {
        let hw = hw_with(None, vec![], vec![]);
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
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
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        let c = find(&r, "vrr");
        assert_eq!(c.status, ReadinessStatus::Advisory);
        assert!(c.action_uri.is_some(), "VRR advisory should offer an action link");
        // Advisory must not be counted as a problem.
        assert_eq!(r.attention_count, 0);
        assert!(r.advisory_count >= 1);
    }

    #[test]
    fn vrr_supported_but_off_is_attention_modest_gain() {
        // A verified supported-but-OFF VRR is a modest, perceptible win → Attention (gains-based),
        // distinct from the undetermined case which stays Advisory.
        let hw = hw_with(
            Some(DisplayInfo {
                current_refresh_rate_hz: 144,
                max_refresh_rate_hz: 144,
                ..Default::default()
            }),
            vec![],
            vec![],
        );
        let r =
            evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), Some(false));
        let c = find(&r, "vrr");
        assert_eq!(c.status, ReadinessStatus::Attention);
        assert!(c.action_uri.is_some());
    }

    #[test]
    fn dismissing_a_check_drops_it_from_attention_count() {
        let hw = hw_with(
            Some(DisplayInfo {
                current_refresh_rate_hz: 60,
                max_refresh_rate_hz: 144,
                ..Default::default()
            }),
            vec![],
            vec![],
        );
        let mut r =
            evaluate_readiness(&hw, Some("Balanced"), false, false, &AppliedChangesSummary::default(), None);
        let before = r.attention_count;
        assert!(before >= 1, "monitor-refresh below max should be Attention");
        r.apply_dismissals(vec!["monitor-refresh".to_string()]);
        assert_eq!(r.attention_count, before - 1);
        assert!(r.dismissed_ids.contains(&"monitor-refresh".to_string()));
    }

    #[test]
    fn freesync_on_makes_vrr_ready() {
        let hw = hw_with(None, vec![], vec![]);
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), Some(true));
        let c = find(&r, "vrr");
        assert_eq!(c.status, ReadinessStatus::Ready);
        assert_eq!(c.value.as_deref(), Some("FreeSync: on"));
    }

    #[test]
    fn externally_reverted_change_raises_attention() {
        let hw = hw_with(None, vec![], vec![]);
        let hist = AppliedChangesSummary {
            total: 3,
            active: 2,
            rolled_back: 0,
            externally_reverted: 1,
            drifted_titles: vec!["Enable Windows Game Mode".into()],
        };
        let r = evaluate_readiness(&hw, None, false, false, &hist, None);
        let c = find(&r, "applied-changes");
        assert_eq!(c.status, ReadinessStatus::Attention);
        // flags-name-it law: the drifted setting is NAMED; no vague "setting(s)", no dead-end
        // room references. bug→guard (drift audit 2026-07-13): post the ground-flip the undo home
        // is the Lab — the string must point THERE, never the retired standalone "Optimize"/"Tune"
        // tabs (the room-labels-vs-nav-ids law: a retired label in user-facing copy is a defect).
        assert!(c.detail.contains("Enable Windows Game Mode"), "detail names the drifted setting: {}", c.detail);
        assert!(!c.detail.contains("setting(s)"), "no vague count: {}", c.detail);
        assert!(!c.detail.contains("Tune"), "no stale room name: {}", c.detail);
        assert!(c.detail.contains("the Lab"), "points at the real undo home (the Lab): {}", c.detail);
        assert!(!c.detail.contains("in Optimize"), "no retired standalone-Optimize-tab dead-end: {}", c.detail);
        // Structured drift titles are exposed so the priorities layer can dedup the drifted rec
        // out of "safe tweaks not applied" (owner-caught double-listing, 2026-07-08).
        assert_eq!(c.drifted_titles, vec!["Enable Windows Game Mode".to_string()]);
    }

    #[test]
    fn status_counts_cover_every_check() {
        let hw = hw_with(None, vec![], vec![]);
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        assert_eq!(
            r.ready_count + r.attention_count + r.unknown_count + r.advisory_count,
            r.checks.len()
        );
        // +7 detection-layer advisory checks (memory-speed, memory-channels, memory-capacity,
        // cpu-cores, gpu-vram, drive-health, network-connection).
        assert_eq!(r.checks.len(), 15);
    }

    #[test]
    fn memory_speed_below_rated_is_attention_pointing_to_bios() {
        use crate::hardware::MemoryModuleInfo;
        let hw = HardwareInfo {
            memory_modules: vec![MemoryModuleInfo {
                capacity_bytes: 16 << 30,
                speed_mhz: 4800,
                rated_speed_mhz: 6000,
                type_name: "DDR5".into(),
                manufacturer: "G.Skill".into(),
                xmp_expo_status: "running_below_rated".into(),
            }],
            ..Default::default()
        };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        let c = find(&r, "memory-speed");
        assert_eq!(c.status, ReadinessStatus::Attention);
        let d = c.detail.to_uppercase();
        assert!(d.contains("EXPO") || d.contains("XMP"));
        assert!(d.contains("BIOS"), "must point to BIOS, not imply Compy changes it");
    }

    #[test]
    fn memory_speed_at_rated_is_ready_and_makes_no_profile_claim() {
        use crate::hardware::MemoryModuleInfo;
        let hw = HardwareInfo {
            memory_modules: vec![MemoryModuleInfo {
                capacity_bytes: 16 << 30,
                speed_mhz: 6000,
                rated_speed_mhz: 6000,
                type_name: "DDR5".into(),
                manufacturer: "G.Skill".into(),
                xmp_expo_status: "running_at_rated".into(),
            }],
            ..Default::default()
        };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        let c = find(&r, "memory-speed");
        assert_eq!(c.status, ReadinessStatus::Ready);
        assert!(!c.detail.to_uppercase().contains("ENABLE"), "no fix prompt when already at rated");
    }

    fn mem(type_name: &str) -> crate::hardware::MemoryModuleInfo {
        crate::hardware::MemoryModuleInfo {
            capacity_bytes: 16 << 30,
            speed_mhz: 6000,
            rated_speed_mhz: 6000,
            type_name: type_name.into(),
            manufacturer: "Kit".into(),
            xmp_expo_status: "running_at_rated".into(),
        }
    }

    #[test]
    fn memory_channels_single_dimm_is_attention_to_add_a_stick() {
        let hw = HardwareInfo { memory_modules: vec![mem("DDR5")], ..Default::default() };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        let c = find(&r, "memory-channels");
        assert_eq!(c.status, ReadinessStatus::Attention);
        assert!(c.detail.to_lowercase().contains("dual-channel"));
    }

    #[test]
    fn memory_channels_single_soldered_lpddr_is_ready_not_a_dead_end() {
        // Soldered LPDDR can't take a second stick — advising one would be an impossible dead-end.
        let hw = HardwareInfo { memory_modules: vec![mem("LPDDR5")], ..Default::default() };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        let c = find(&r, "memory-channels");
        assert_eq!(c.status, ReadinessStatus::Ready);
        assert!(c.detail.to_lowercase().contains("soldered"));
    }

    #[test]
    fn memory_channels_two_modules_is_ready_dual_channel() {
        let hw = HardwareInfo { memory_modules: vec![mem("DDR5"), mem("DDR5")], ..Default::default() };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        assert_eq!(find(&r, "memory-channels").status, ReadinessStatus::Ready);
    }

    #[test]
    fn memory_channels_no_modules_is_unknown_never_a_scare() {
        let hw = HardwareInfo { memory_modules: vec![], ..Default::default() };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        assert_eq!(find(&r, "memory-channels").status, ReadinessStatus::Unknown);
    }

    fn nic(physical: bool, medium: &str, connected: bool) -> crate::hardware::NetAdapterInfo {
        crate::hardware::NetAdapterInfo { name: "NIC".into(), physical, medium: medium.into(), connected, link_speed_bps: None }
    }

    #[test]
    fn network_connection_wired_is_ready_steadiest() {
        let hw = HardwareInfo { network_adapters: vec![nic(true, "wired", true)], ..Default::default() };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        let c = find(&r, "network-connection");
        assert_eq!(c.status, ReadinessStatus::Ready);
        assert!(c.detail.to_lowercase().contains("wired ethernet"));
    }

    #[test]
    fn network_connection_wifi_is_advisory_not_a_problem() {
        // Advisory keeps the readiness clean (Wi-Fi is fine) while surfacing the wired-is-steadier tip.
        let hw = HardwareInfo { network_adapters: vec![nic(true, "wifi", true)], ..Default::default() };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        let c = find(&r, "network-connection");
        assert_eq!(c.status, ReadinessStatus::Advisory);
        assert!(c.detail.to_lowercase().contains("wi-fi"));
    }

    #[test]
    fn network_connection_offline_is_unknown_never_a_scare() {
        let hw = HardwareInfo { network_adapters: vec![], ..Default::default() };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        assert_eq!(find(&r, "network-connection").status, ReadinessStatus::Unknown);
    }

    #[test]
    fn network_connection_wifi_enriches_detail_with_measured_link_when_present() {
        // When the netsh probe gave us a link, the Wi-Fi row names band/signal/rate (still Advisory).
        let hw = HardwareInfo {
            network_adapters: vec![nic(true, "wifi", true)],
            wifi_link: Some(crate::hardware::WifiLink {
                band: Some("5 GHz".into()),
                signal_pct: Some(86),
                rx_mbps: Some(867),
                radio_type: Some("802.11ax".into()),
                channel: Some(36),
            }),
            ..Default::default()
        };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        let c = find(&r, "network-connection");
        assert_eq!(c.status, ReadinessStatus::Advisory);
        assert!(c.detail.contains("5 GHz") && c.detail.contains("86% signal") && c.detail.contains("867 Mbps"));
        assert_eq!(c.value.as_deref(), Some("Wi-Fi · 5 GHz")); // band-aware chip
    }

    #[test]
    fn network_connection_wifi_names_the_wired_port_when_one_exists() {
        // On Wi-Fi but the rig HAS an Ethernet port → name it (plug in), not the hedged "if you can
        // run a cable" (which is only for port-less laptops / Wi-Fi-only rigs).
        let with_port = HardwareInfo {
            network_adapters: vec![nic(true, "wifi", true)],
            has_wired_ethernet_port: true,
            ..Default::default()
        };
        let r = evaluate_readiness(&with_port, None, false, false, &AppliedChangesSummary::default(), None);
        let c = find(&r, "network-connection");
        assert_eq!(c.status, ReadinessStatus::Advisory); // still advisory, not a problem
        assert!(c.detail.contains("wired Ethernet port") && c.detail.contains("plugging it in"));
        assert!(!c.detail.contains("if you can run one"), "no hedged copy when the port exists");

        // A port-less rig keeps the hedged copy (a cable may not be feasible).
        let no_port =
            HardwareInfo { network_adapters: vec![nic(true, "wifi", true)], ..Default::default() };
        let r2 = evaluate_readiness(&no_port, None, false, false, &AppliedChangesSummary::default(), None);
        let c2 = find(&r2, "network-connection");
        assert!(c2.detail.contains("worth a cable if you can run one"));
    }

    #[test]
    fn network_connection_wifi_warns_only_on_overlapping_2_4ghz_channel() {
        let link = |band: &str, ch: u32| {
            Some(crate::hardware::WifiLink {
                band: Some(band.into()),
                signal_pct: Some(70),
                rx_mbps: Some(144),
                radio_type: Some("802.11n".into()),
                channel: Some(ch),
            })
        };
        let eval = |wifi_link| {
            let hw = HardwareInfo {
                network_adapters: vec![nic(true, "wifi", true)],
                wifi_link,
                ..Default::default()
            };
            let r =
                evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
            find(&r, "network-connection").detail.clone()
        };

        // 2.4 GHz on an overlapping channel → channel shown + the 1/6/11 advisory.
        let bad = eval(link("2.4 GHz", 3));
        assert!(bad.contains("ch 3") && bad.contains("1, 6, and 11"));
        // 2.4 GHz on a non-overlapping channel (6) → no advisory.
        assert!(!eval(link("2.4 GHz", 6)).contains("don't overlap"));
        // 5 GHz → never the 2.4 advisory, and the channel number isn't shown (overlap doesn't apply).
        let ghz5 = eval(link("5 GHz", 149));
        assert!(!ghz5.contains("don't overlap") && !ghz5.contains("ch 149"));
    }

    #[test]
    fn qos_policy_advisory_only_appears_when_policies_present() {
        // Clean rig (no policies) → no QoS row at all (no clutter).
        let none = evaluate_readiness(
            &HardwareInfo::default(),
            None,
            false,
            false,
            &AppliedChangesSummary::default(),
            None,
        );
        assert!(!none.checks.iter().any(|c| c.id == "network-qos"), "no QoS row on a clean rig");

        // Policies present → one Advisory row that NAMES them as-found.
        let hw = HardwareInfo {
            qos_policies: vec!["GameThrottle".into(), "BulkDownload".into()],
            ..Default::default()
        };
        let r =
            evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        let c = r.checks.iter().find(|c| c.id == "network-qos").expect("QoS advisory present");
        assert_eq!(c.status, ReadinessStatus::Advisory);
        assert!(c.detail.contains("GameThrottle") && c.detail.contains("BulkDownload"));
    }

    fn with_ram(bytes: u64) -> GameReadiness {
        let hw = HardwareInfo { ram_total_bytes: bytes, ..Default::default() };
        evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None)
    }

    #[test]
    fn memory_capacity_16gb_plus_is_ready() {
        const GIB: u64 = 1024 * 1024 * 1024;
        assert_eq!(find(&with_ram(32 * GIB), "memory-capacity").status, ReadinessStatus::Ready);
        assert_eq!(find(&with_ram(16 * GIB), "memory-capacity").status, ReadinessStatus::Ready);
        // OS-visible 16GB rig reads a touch under (reserved memory) — rounds to 16, stays Ready.
        assert_eq!(
            find(&with_ram(16 * GIB - 200 * 1024 * 1024), "memory-capacity").status,
            ReadinessStatus::Ready,
        );
    }

    #[test]
    fn memory_capacity_under_16gb_is_advisory_not_a_problem() {
        const GIB: u64 = 1024 * 1024 * 1024;
        let r = with_ram(8 * GIB);
        let c = find(&r, "memory-capacity");
        assert_eq!(c.status, ReadinessStatus::Advisory);
        assert!(c.detail.contains("16 GB"));
    }

    #[test]
    fn memory_capacity_unreadable_is_unknown() {
        assert_eq!(find(&with_ram(0), "memory-capacity").status, ReadinessStatus::Unknown);
    }

    fn with_cores(n: usize) -> GameReadiness {
        let hw = HardwareInfo { cpu_cores_physical: n, ..Default::default() };
        evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None)
    }

    #[test]
    fn cpu_cores_six_plus_ready_under_six_advisory_zero_unknown() {
        assert_eq!(find(&with_cores(8), "cpu-cores").status, ReadinessStatus::Ready);
        assert_eq!(find(&with_cores(6), "cpu-cores").status, ReadinessStatus::Ready);
        assert_eq!(find(&with_cores(4), "cpu-cores").status, ReadinessStatus::Advisory);
        assert_eq!(find(&with_cores(0), "cpu-cores").status, ReadinessStatus::Unknown);
    }

    fn with_vram(bytes: u64) -> GameReadiness {
        let hw = HardwareInfo {
            gpus: vec![crate::hardware::GpuInfo { vram_bytes: bytes, ..Default::default() }],
            ..Default::default()
        };
        evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None)
    }

    #[test]
    fn gpu_vram_six_gb_floor_ready_above_advisory_below() {
        const GIB: u64 = 1024 * 1024 * 1024;
        assert_eq!(find(&with_vram(16 * GIB), "gpu-vram").status, ReadinessStatus::Ready);
        assert_eq!(find(&with_vram(6 * GIB), "gpu-vram").status, ReadinessStatus::Ready);
        assert_eq!(find(&with_vram(4 * GIB), "gpu-vram").status, ReadinessStatus::Advisory);
    }

    #[test]
    fn gpu_vram_no_gpu_is_unknown() {
        let hw = HardwareInfo { gpus: vec![], ..Default::default() };
        let r = evaluate_readiness(&hw, None, false, false, &AppliedChangesSummary::default(), None);
        assert_eq!(find(&r, "gpu-vram").status, ReadinessStatus::Unknown);
    }

    #[test]
    fn drive_health_warning_is_attention_healthy_is_ready() {
        use crate::hardware::DiskHealth;
        let bad = HardwareInfo {
            disk_health: vec![DiskHealth {
                friendly_name: "CT1000".into(),
                health: "Warning".into(),
            }],
            ..Default::default()
        };
        let rb = evaluate_readiness(&bad, None, false, false, &AppliedChangesSummary::default(), None);
        assert_eq!(find(&rb, "drive-health").status, ReadinessStatus::Attention);

        let good = HardwareInfo {
            disk_health: vec![DiskHealth {
                friendly_name: "CT1000".into(),
                health: "Healthy".into(),
            }],
            ..Default::default()
        };
        let rg = evaluate_readiness(&good, None, false, false, &AppliedChangesSummary::default(), None);
        assert_eq!(find(&rg, "drive-health").status, ReadinessStatus::Ready);
    }
}
