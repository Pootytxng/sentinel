//! Recommendations: the rule data model (Recommendation, Provenance, RuleSpec,
//! Condition, RulesFile) and the resolution engine that decides WHAT to show
//! and WHY — condition evaluation, current-state assembly, hardware gating, and
//! the full build_recommendations catalog. It DECIDES only: it reads
//! crate::hardware and the system-state probes (left in lib), but owns no
//! Windows mutation, no rollback snapshots, and no Trust Ledger persistence.
//! Boundary move; no behavior change.

use serde::{Deserialize, Serialize};

use crate::hardware::{collect_hardware, gpu_vendor_match, HardwareInfo};
use crate::remote_rules::{load_rules, RulesSource};
use crate::{
    current_power_plan_name, eee_disabled_on_any_eligible_adapter, fast_startup_state,
    game_bar_disabled, game_mode_enabled, hags_state, memory_integrity_or_vbs_active,
    mouse_accel_disabled, nagle_disabled_on_any_nic, pcie_aspm_off_on_ac, reserved_storage_enabled,
    service_running, usb_selective_suspend_off_on_ac, visual_effects_for_best_performance,
};

// Provenance is the honesty tier for each rec's *impact* claim. The UI surfaces
// this as a pill on every rec card so the user can tell at a glance whether
// the claim is something Compy measured itself ("Verified"), something
// industry/community benchmarks have measured ("Measured signal"), or
// something Compy believes follows from Windows internals but has not
// itself measured ("Expected impact"). See PRD §2.5.
//
// Right now nothing is "Verified" — Compy has not run its own benchmarks.
// That is the honest answer. "Verified" is reserved for recs whose claim is a
// direct measurement Compy *itself* performed (e.g., reading current vs
// max display Hz is a direct fact; saying "lower latency" because we changed
// a registry value would be Expected). When the synthetic benchmark suite
// ships, recs whose impact is reproduced under that suite can graduate to
// "Verified."
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Provenance {
    /// Compy directly observes the fact this rec claims (e.g., current
    /// vs max refresh rate, free disk space, driver age in days). The claim
    /// is the measurement.
    Verified,
    /// Third-party benchmarks or wide community consensus has measured this
    /// impact. Compy is citing established results, not inventing them.
    MeasuredSignal,
    /// Logical from Windows internals but not benchmarked. Honest "we
    /// believe this but have not measured it ourselves."
    ExpectedImpact,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct Recommendation {
    id: String,
    title: String,
    category: String,
    severity: String,
    description: String,
    impact: String,
    downside: Option<String>,
    applies_to: String,
    currently_applied: bool,
    provenance: Provenance,
}

// ─── Step B: Rules JSON schema + loader ──────────────────────────────────
//
// The eventual remote rules.json at the CDN follows this exact schema. The
// embedded baseline ships with the binary so Compy always has a known-good
// starting rule set, even with no network access. See docs/ARCHITECTURE_LOCKS
// Tier 2 for the schema-versioning contract.

const RULES_SCHEMA_VERSION: u32 = 1;
const BASELINE_RULES_JSON: &[u8] = include_bytes!("../resources/baseline-rules-v1.json");

#[derive(Deserialize)]
pub(crate) struct RulesFile {
    schema_version: u32,
    #[serde(default)]
    #[allow(dead_code)]
    rules_version: String,
    #[serde(default)]
    #[allow(dead_code)]
    comment: String,
    pub(crate) rules: Vec<RuleSpec>,
}

#[derive(Deserialize, Clone)]
pub(crate) struct RuleSpec {
    id: String,
    title: String,
    category: String,
    severity: String,
    description: String,
    impact: String,
    provenance: Provenance,
    #[serde(default)]
    downside: Option<String>,
    #[serde(default)]
    applies_to_template: Option<String>,
    #[serde(default)]
    conditions: Vec<Condition>,
    #[serde(default)]
    #[allow(dead_code)]
    apply_kind: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    apply_params: Option<serde_json::Value>,
    #[serde(default)]
    state_kind: Option<String>,
    #[serde(default)]
    state_params: Option<serde_json::Value>,
}

// Hardware predicates that gate whether a rule fires. Extensible via additive
// changes; each variant maps to a Rust evaluator in condition_matches().
#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Condition {
    GpuVendor { vendor: String },
    RamGbAtLeast { min_gb: u32 },
    FastStoragePresent,
    AllHdd,
    HasModernDiscreteGpu,
    DisplayUnderdriven { min_gap_hz: u32 },
    OldGpuDriverDays { min_days: i64 },
    StorageBelowFreePercent { mount_prefix: String, percent: f64 },
    HasActiveWiredEthernet,
    MemoryIntegrityOrVbsActive,
    DisplayHdrCapable,
}

pub(crate) fn load_baseline_rules_embedded() -> RulesFile {
    let file: RulesFile = serde_json::from_slice(BASELINE_RULES_JSON)
        .expect("baseline rules JSON must be valid at compile time");
    assert_eq!(
        file.schema_version, RULES_SCHEMA_VERSION,
        "baseline rules schema_version mismatch: file says {}, binary expects {}",
        file.schema_version, RULES_SCHEMA_VERSION
    );
    file
}



#[tauri::command]
pub(crate) fn get_rules_source() -> &'static str {
    match load_rules().1 {
        RulesSource::Embedded => "embedded",
        RulesSource::Cached => "cached",
        RulesSource::Remote => "remote",
    }
}

pub(crate) fn condition_matches(cond: &Condition, hw: &HardwareInfo) -> bool {
    match cond {
        Condition::GpuVendor { vendor } => gpu_vendor_match(hw, &vendor.to_uppercase()).is_some(),
        Condition::RamGbAtLeast { min_gb } => {
            let ram_gb = hw.ram_total_bytes as f64 / 1024.0_f64.powi(3);
            ram_gb >= *min_gb as f64
        }
        Condition::FastStoragePresent => hw
            .physical_disks
            .iter()
            .any(|d| d.bus_type == "NVMe" || d.media_type == "SSD"),
        Condition::AllHdd => {
            !hw.physical_disks.is_empty()
                && hw.physical_disks.iter().all(|d| d.media_type == "HDD")
        }
        Condition::HasModernDiscreteGpu => hw.gpus.iter().any(|g| {
            let u = g.name.to_uppercase();
            u.contains("RTX")
                || u.contains("GTX 16")
                || u.contains("RX 5")
                || u.contains("RX 6")
                || u.contains("RX 7")
                || u.contains("RX 9")
                || u.contains("ARC ")
                || u.contains("ARC A")
                || u.contains("ARC B")
        }),
        Condition::DisplayUnderdriven { min_gap_hz } => hw
            .display
            .as_ref()
            .map(|d| d.max_refresh_rate_hz.saturating_sub(d.current_refresh_rate_hz) >= *min_gap_hz)
            .unwrap_or(false),
        Condition::OldGpuDriverDays { min_days } => hw
            .gpus
            .iter()
            .filter_map(|g| g.driver_age_days)
            .any(|d| d >= *min_days),
        Condition::StorageBelowFreePercent { mount_prefix, percent } => {
            hw.disks.iter().any(|d| {
                if !d.mount_point.starts_with(mount_prefix) || d.total_bytes == 0 {
                    return false;
                }
                let pct = (d.available_bytes as f64 / d.total_bytes as f64) * 100.0;
                pct < *percent
            })
        }
        Condition::HasActiveWiredEthernet => hw.has_active_wired_ethernet,
        Condition::MemoryIntegrityOrVbsActive => memory_integrity_or_vbs_active(),
        Condition::DisplayHdrCapable => hw
            .display
            .as_ref()
            .map(|d| d.hdr_capable)
            .unwrap_or(false),
    }
}

// String-keyed state-check dispatcher. Each kind names an existing Rust
// function; new kinds require a code release. Params allow parameterizing
// shared shapes (e.g. "service-not-running" takes a service name).
pub(crate) fn check_state_kind(kind: &str, params: &Option<serde_json::Value>, _hw: &HardwareInfo) -> bool {
    match kind {
        "game-mode-enabled" => game_mode_enabled(),
        "visual-effects-best-perf" => visual_effects_for_best_performance(),
        "service-not-running" => params
            .as_ref()
            .and_then(|p| p.get("service"))
            .and_then(|s| s.as_str())
            .map(|name| !service_running(name))
            .unwrap_or(false),
        "power-plan-ultimate" => current_power_plan_name()
            .map(|p| p.to_lowercase().contains("ultimate"))
            .unwrap_or(false),
        "nagle-disabled-any-nic" => nagle_disabled_on_any_nic(),
        "hags-on" => hags_state() == Some(2),
        "mouse-accel-disabled" => mouse_accel_disabled(),
        "game-bar-disabled" => game_bar_disabled(),
        "fast-startup-disabled" => fast_startup_state() == Some(0),
        "reserved-storage-disabled" => !reserved_storage_enabled(),
        "usb-selective-suspend-off-on-ac" => usb_selective_suspend_off_on_ac(),
        "pcie-aspm-off-on-ac" => pcie_aspm_off_on_ac(),
        "eee-disabled-on-eligible-adapters" => eee_disabled_on_any_eligible_adapter(),
        _ => false,
    }
}

// Minimal {variable} substitution for the applies_to_template field. Keep the
// variable list small and well-known — this is content, not a templating DSL.
pub(crate) fn template_substitute(template: &str, hw: &HardwareInfo) -> String {
    let mut out = template.to_string();
    out = out.replace("{os_name}", &hw.os_name);
    out = out.replace("{os_version}", &hw.os_version);
    out = out.replace("{cpu_brand}", &hw.cpu_brand);
    let ram_gb = hw.ram_total_bytes as f64 / 1024.0_f64.powi(3);
    out = out.replace("{ram_gb_round}", &format!("{:.0}", ram_gb));
    out
}

pub(crate) fn evaluate_rule_spec(spec: &RuleSpec, hw: &HardwareInfo) -> Option<Recommendation> {
    for cond in &spec.conditions {
        if !condition_matches(cond, hw) {
            return None;
        }
    }

    let applies_to = spec
        .applies_to_template
        .as_ref()
        .map(|t| template_substitute(t, hw))
        .unwrap_or_default();

    let currently_applied = spec
        .state_kind
        .as_ref()
        .map(|kind| check_state_kind(kind, &spec.state_params, hw))
        .unwrap_or(false);

    Some(Recommendation {
        id: spec.id.clone(),
        title: spec.title.clone(),
        category: spec.category.clone(),
        severity: spec.severity.clone(),
        description: spec.description.clone(),
        impact: spec.impact.clone(),
        downside: spec.downside.clone(),
        applies_to,
        currently_applied,
        provenance: spec.provenance,
    })
}


pub(crate) fn build_recommendations(hw: &HardwareInfo) -> Vec<Recommendation> {
    let mut recs: Vec<Recommendation> = Vec::new();

    // ── Step B: rules loaded from the embedded baseline JSON ──────────
    // Currently empty in commit B; first rec (game-mode) migrates over in C.
    // Per ARCHITECTURE_LOCKS §1.3 — cold-start contract is to always be
    // usable. `load_rules()` returns the embedded baseline if no validated
    // remote / cached rules are available. Remote fetch is currently hard-
    // disabled (see `remote_fetch_enabled()`).
    let (baseline, _source) = load_rules();
    for spec in &baseline.rules {
        if let Some(rec) = evaluate_rule_spec(spec, hw) {
            recs.push(rec);
        }
    }

    let active_plan = current_power_plan_name().unwrap_or_default();
    let on_ultimate = active_plan.to_lowercase().contains("ultimate");

    // ─── Universal Windows tweaks ────────────────────────────────────────
    recs.push(Recommendation {
        id: "power-ultimate".into(),
        title: "Switch to the Ultimate Performance power plan".into(),
        category: "Power".into(),
        severity: "moderate".into(),
        description:
            "Windows ships with a hidden 'Ultimate Performance' power plan that keeps your CPU at peak responsiveness instead of letting it nap between workloads. Better for gaming. The honest tradeoff: this permanently switches your daily power profile, so the higher power draw is in effect even when you're not gaming. A future Compy release will offer a Gaming Mode that automatically switches to high-performance only while a game is running, so your daily profile stays alone — this rec is the manual interim option.".into(),
        impact: "Lower input latency · steadier frame times (when gaming)".into(),
        downside: Some("Permanently mutates your daily power profile until you roll back. Higher idle power draw (~5–10 W on most desktops). A smarter game-aware switch is planned.".into()),
        applies_to: if active_plan.is_empty() {
            "Windows desktop".into()
        } else {
            format!("Currently on '{}'", active_plan)
        },
        currently_applied: on_ultimate,
        provenance: Provenance::MeasuredSignal,
    });

    // game-mode is now defined in src-tauri/resources/baseline-rules-v1.json
    // and emitted by the load_baseline_rules() pass earlier in this fn.
    // This is the first rec to live as data rather than code -- proof that
    // the schema, conditions, applies_to_template, and state_kind dispatch
    // can fully reconstruct the runtime Recommendation.

    // startup-debloat rec was replaced by the dedicated "Startup apps" UI
    // section, which lets the user toggle individual entries directly.

    // visual-effects, mouse-accel-off, game-bar-disable, diagtrack-disable,
    // windows-search-disable: all migrated to baseline-rules-v1.json.

    // reserved-storage-off is a SPACE tweak, not a performance tweak. Per the
    // cross-LLM review (see commit 5221756 doc updates), this should only fire
    // when reclaiming ~7-10 GB actually matters -- i.e. when C: free space is
    // already getting tight. On systems with plenty of free space, suggesting
    // it pollutes the catalog with noise that erodes user trust.
    let c_drive_free_pct = hw.disks.iter().find_map(|d| {
        if d.mount_point.starts_with("C:") && d.total_bytes > 0 {
            Some((d.available_bytes as f64 / d.total_bytes as f64) * 100.0)
        } else {
            None
        }
    });
    if c_drive_free_pct.map(|pct| pct < 25.0).unwrap_or(false) {
        recs.push(Recommendation {
            id: "reserved-storage-off".into(),
            title: "Disable Windows Reserved Storage (reclaim ~7–10 GB on C:)".into(),
            category: "Storage".into(),
            severity: "safe".into(),
            description:
                "Windows sets aside ~7–10 GB of your C: drive as a working area for major updates. Your C: drive is getting tight on free space, so reclaiming this is an immediate, visible space win. Only shown when C: is under ~25% free.".into(),
            impact: "Reclaim ~7–10 GB on C: · no functional impact for most users".into(),
            downside: Some("If C: gets very full during a feature update, Windows may fail to install it cleanly until you free space manually.".into()),
            applies_to: format!(
                "C: at {:.0}% free — reserved storage is worth reclaiming",
                c_drive_free_pct.unwrap_or(0.0)
            ),
            currently_applied: !reserved_storage_enabled(),
            provenance: Provenance::MeasuredSignal,
        });
    }

    recs.push(Recommendation {
        id: "fast-startup-off".into(),
        title: "Disable Fast Startup".into(),
        category: "Power".into(),
        severity: "safe".into(),
        description:
            "Fast Startup makes 'Shut down' actually hibernate the Windows kernel session instead of fully shutting down. It saves a few seconds at boot but causes drivers to keep stale state between sessions, breaks dual-boot setups, and is one of the most common silent causes of post-update weirdness ('Windows Update applied but I'm still seeing the bug').".into(),
        impact: "Clean shutdowns · drivers reload fresh each boot · fixes a category of 'why is X behaving weird' issues".into(),
        downside: Some("Cold boot will take a few extra seconds (typically 3-8 s on NVMe).".into()),
        applies_to: match fast_startup_state() {
            Some(1) => "Currently enabled (default on most installs)".into(),
            Some(0) => "Currently disabled".into(),
            _ => "Not yet configured".into(),
        },
        currently_applied: fast_startup_state() == Some(0),
        provenance: Provenance::ExpectedImpact,
    });

    // ─── GPU vendor-specific ─────────────────────────────────────────────
    if let Some(name) = gpu_vendor_match(hw, "NVIDIA") {
        let telemetry_running = service_running("NvTelemetryContainer");
        recs.push(Recommendation {
            id: "nvidia-telemetry".into(),
            title: "Disable NVIDIA Container telemetry services".into(),
            category: "GPU".into(),
            severity: "safe".into(),
            description:
                "NVIDIA's driver bundle ships several background services that exist mainly to send usage data and check for GeForce Experience updates. They consume RAM and CPU constantly. Disabling them does not affect game performance or driver functionality.".into(),
            impact: "Free ~150–250 MB RAM · less background CPU".into(),
            downside: Some("GeForce Experience won't auto-update; you can still update manually.".into()),
            applies_to: name.clone(),
            currently_applied: !telemetry_running,
            provenance: Provenance::ExpectedImpact,
        });

        recs.push(Recommendation {
            id: "nvidia-low-latency".into(),
            title: "Set NVIDIA 'Low Latency Mode' to Ultra (per-game)".into(),
            category: "GPU".into(),
            severity: "safe".into(),
            description:
                "Forces the driver to pre-render fewer frames, which shaves a frame or two of input latency. Ideal for competitive shooters; less useful for slower-paced games.".into(),
            impact: "Lower input lag in fast-paced games".into(),
            downside: Some("Can slightly reduce maximum FPS in GPU-bound titles.".into()),
            applies_to: "NVIDIA GPU + latency profile".into(),
            currently_applied: false,
            provenance: Provenance::MeasuredSignal,
        });
    }

    if let Some(name) = gpu_vendor_match(hw, "AMD").or_else(|| gpu_vendor_match(hw, "RADEON")) {
        recs.push(Recommendation {
            id: "amd-uxp".into(),
            title: "Opt out of the AMD User Experience Program".into(),
            category: "GPU".into(),
            severity: "safe".into(),
            description:
                "AMD's Adrenalin software opts you in by default to a telemetry program that sends usage data. Turning it off has no performance impact.".into(),
            impact: "Less background network traffic · privacy".into(),
            downside: None,
            applies_to: name,
            currently_applied: false,
            provenance: Provenance::ExpectedImpact,
        });
    }

    if gpu_vendor_match(hw, "INTEL").is_some()
        && hw.gpus.iter().any(|g| !g.name.to_uppercase().contains("INTEL"))
    {
        // Has Intel + a discrete card → very likely a laptop or hybrid setup
        recs.push(Recommendation {
            id: "gpu-prefer-discrete".into(),
            title: "Force games to use your discrete GPU".into(),
            category: "GPU".into(),
            severity: "safe".into(),
            description:
                "Your PC has both an Intel iGPU and a discrete GPU. Windows sometimes routes games to the iGPU by mistake, tanking performance. Pin individual games to the discrete card in Settings → Display → Graphics.".into(),
            impact: "Massive FPS gain if a game is mis-routed".into(),
            downside: Some("Slightly higher battery drain on laptops.".into()),
            applies_to: "Hybrid GPU setup detected".into(),
            currently_applied: false,
            provenance: Provenance::ExpectedImpact,
        });
    }

    // ─── Storage-conditional ─────────────────────────────────────────────
    for disk in &hw.disks {
        if disk.total_bytes == 0 {
            continue;
        }
        let pct_free = (disk.available_bytes as f64 / disk.total_bytes as f64) * 100.0;
        if pct_free < 15.0 && disk.mount_point.starts_with("C:") {
            recs.push(Recommendation {
                id: "storage-c-low".into(),
                title: "Free up space on C:".into(),
                category: "Storage".into(),
                severity: "safe".into(),
                description:
                    "Your system drive is nearly full. Below ~15% free, Windows starts to thrash, paging gets sluggish, and updates can fail. Disk Cleanup + uninstalling unused games is the easiest win.".into(),
                impact: "Restores normal disk performance · prevents update failures".into(),
                downside: None,
                applies_to: format!("{} ({:.0}% free)", disk.mount_point, pct_free),
                currently_applied: false,
                provenance: Provenance::Verified,
            });
            break;
        }
    }

    // ─── RAM + storage-conditional ───────────────────────────────────────
    let ram_gb = hw.ram_total_bytes as f64 / 1024.0_f64.powi(3);
    let has_nvme = hw.physical_disks.iter().any(|d| d.bus_type == "NVMe");
    let has_ssd = hw.physical_disks.iter().any(|d| d.media_type == "SSD");
    let only_hdd = !hw.physical_disks.is_empty()
        && hw.physical_disks.iter().all(|d| d.media_type == "HDD");

    // SysMain is GOOD on HDDs (it pre-caches apps to speed up launches). Only
    // recommend disabling when fast storage is present, where the benefit is
    // marginal and the disk thrashing complaint applies.
    if ram_gb >= 16.0 && (has_nvme || has_ssd) {
        let storage_kind = if has_nvme { "NVMe" } else { "SSD" };
        recs.push(Recommendation {
            id: "sysmain-disable".into(),
            title: "Disable SysMain (Superfetch)".into(),
            category: "Windows".into(),
            severity: "moderate".into(),
            description:
                "SysMain preloads frequently-used apps into RAM to make them launch faster. With 16 GB+ of RAM and fast storage this benefit is small, and on NVMe systems SysMain often causes mysterious disk thrashing instead.".into(),
            impact: "Lower idle disk activity · ~100–200 MB RAM back".into(),
            downside: Some("App launches will be a tiny bit slower (usually unnoticeable on fast storage).".into()),
            applies_to: format!("{:.0} GB RAM · {} storage detected", ram_gb, storage_kind),
            currently_applied: !service_running("SysMain"),
            provenance: Provenance::ExpectedImpact,
        });
    }

    // Hardware-accelerated GPU Scheduling: modern GPUs only, requires reboot.
    {
        let state = hags_state();
        let has_modern_gpu = hw.gpus.iter().any(|g| {
            let u = g.name.to_uppercase();
            u.contains("RTX")
                || u.contains("GTX 16")
                || u.contains("RX 5")
                || u.contains("RX 6")
                || u.contains("RX 7")
                || u.contains("RX 9")
                || u.contains("ARC ")
                || u.contains("ARC A")
                || u.contains("ARC B")
        });
        if has_modern_gpu {
            recs.push(Recommendation {
                id: "hags-enable".into(),
                title: "Enable Hardware-accelerated GPU Scheduling".into(),
                category: "GPU".into(),
                severity: "safe".into(),
                description:
                    "Lets the GPU manage its own memory and command queue directly instead of routing through the Windows display driver. On supported hardware this reduces input latency and frees up CPU cycles, especially in modern games. Requires a reboot to take effect.".into(),
                impact: "Lower input latency · CPU cycles freed up for game logic".into(),
                downside: Some("Reboot required. Very occasionally a specific driver/game combo regresses with HAGS on — easy to roll back if it doesn't feel right.".into()),
                applies_to: match state {
                    Some(0) => "Currently: Auto (driver chooses)".into(),
                    Some(1) => "Currently: Off".into(),
                    Some(2) => "Currently: On".into(),
                    _ => "Modern GPU detected — HAGS not yet configured".into(),
                },
                currently_applied: state == Some(2),
                provenance: Provenance::MeasuredSignal,
            });
        }
    }

    // Monitor refresh rate — the classic "your 144 Hz monitor is at 60 Hz" hidden value.
    if let Some(display) = &hw.display {
        let gap = display
            .max_refresh_rate_hz
            .saturating_sub(display.current_refresh_rate_hz);
        if gap >= 24 && display.max_refresh_rate_hz > 0 {
            recs.push(Recommendation {
                id: "monitor-max-refresh".into(),
                title: "Bump your display to its maximum refresh rate".into(),
                category: "Display".into(),
                severity: "safe".into(),
                description:
                    "Your display supports a much higher refresh rate than it's currently running at. Higher refresh = noticeably smoother motion and lower input lag, at zero hardware cost. Change in Settings → System → Display → Advanced display → Choose a refresh rate.".into(),
                impact: "Smoother motion · lower input lag · feels dramatically faster".into(),
                downside: Some("Slightly higher idle power draw.".into()),
                applies_to: format!(
                    "{}×{} at {} Hz, supports {} Hz",
                    display.width,
                    display.height,
                    display.current_refresh_rate_hz,
                    display.max_refresh_rate_hz
                ),
                currently_applied: false,
                provenance: Provenance::Verified,
            });
        }
    }

    // GPU driver freshness — flag when ANY adapter's driver is meaningfully stale.
    let oldest_driver_days = hw
        .gpus
        .iter()
        .filter_map(|g| g.driver_age_days)
        .max();
    if let Some(days) = oldest_driver_days {
        if days >= 90 {
            let vendor = if gpu_vendor_match(hw, "NVIDIA").is_some() {
                "NVIDIA"
            } else if gpu_vendor_match(hw, "AMD").is_some() || gpu_vendor_match(hw, "RADEON").is_some() {
                "AMD"
            } else if gpu_vendor_match(hw, "INTEL").is_some() {
                "Intel"
            } else {
                "GPU"
            };
            let months = days / 30;
            recs.push(Recommendation {
                id: "gpu-driver-update".into(),
                title: "Update your graphics driver".into(),
                category: "GPU".into(),
                severity: "safe".into(),
                description:
                    "Your installed graphics driver is several months old. Driver updates routinely include game-specific performance improvements, bug fixes for newly-released titles, and security patches. Update through GeForce Experience / NVIDIA App, AMD Adrenalin, or Intel Graphics Command Center.".into(),
                impact: "Better game performance · fewer crashes · latest features (DLSS, FSR, frame-gen)".into(),
                downside: Some("New drivers occasionally introduce regressions — keep the previous installer in case you need to roll back.".into()),
                applies_to: format!("{} driver is ~{} months old", vendor, months),
                currently_applied: false,
                provenance: Provenance::Verified,
            });
        }
    }

    // HDD-only advisory: the single biggest performance win is hardware, not a tweak.
    if only_hdd {
        recs.push(Recommendation {
            id: "ssd-upgrade-advisory".into(),
            title: "Upgrade your system drive to an SSD".into(),
            category: "Storage".into(),
            severity: "moderate".into(),
            description:
                "Every physical drive Compy detected is a spinning hard drive. Windows on an HDD is the single biggest performance handicap on a modern PC — game load times, app launches, and Windows itself will be dramatically faster on an SSD or NVMe drive. Typical cost: $40–100 for 500 GB.".into(),
            impact: "Multi-second → sub-second boot · 5–10× faster app launches".into(),
            downside: Some("Requires a hardware purchase and either a Windows reinstall or a drive clone.".into()),
            applies_to: "Spinning HDDs only — no SSDs detected".into(),
            currently_applied: false,
            provenance: Provenance::MeasuredSignal,
        });
    }

    // ─── Network ─────────────────────────────────────────────────────────
    // nagle-disable migrated to baseline-rules-v1.json.

    recs
}

#[tauri::command]
pub(crate) fn get_recommendations() -> Vec<Recommendation> {
    let hw = collect_hardware();
    build_recommendations(&hw)
}

// ─── Recommendation condition + catalog tests ────────────────────────────
//
// Cover the rec engine's pure decision logic: hardware-gating conditions and
// catalog integrity. These do NOT exercise apply/rollback mutation (that's the
// actions+rollback step). condition_matches is pure over a HardwareInfo, so we
// build fixtures and assert which gates fire. build_recommendations reads the
// real system's state probes for `currently_applied`, but ID-uniqueness holds
// regardless of which recs apply.
#[cfg(test)]
mod rec_tests {
    use super::*;
    use crate::hardware::{DiskInfo, DisplayInfo, GpuInfo, HardwareInfo, PhysicalDiskInfo};

    fn pdisk(media: &str, bus: &str) -> PhysicalDiskInfo {
        PhysicalDiskInfo {
            media_type: media.into(),
            bus_type: bus.into(),
            ..Default::default()
        }
    }
    fn gpu(name: &str) -> GpuInfo {
        GpuInfo {
            name: name.into(),
            ..Default::default()
        }
    }

    #[test]
    fn all_hdd_gates_windows_search_indexer() {
        let mut h = HardwareInfo {
            physical_disks: vec![pdisk("HDD", "SATA"), pdisk("HDD", "SATA")],
            ..Default::default()
        };
        assert!(condition_matches(&Condition::AllHdd, &h), "all spinning -> gate fires");
        h.physical_disks.push(pdisk("SSD", "NVMe"));
        assert!(
            !condition_matches(&Condition::AllHdd, &h),
            "any SSD present -> not all-HDD"
        );
        assert!(
            !condition_matches(&Condition::AllHdd, &HardwareInfo::default()),
            "no disks detected -> false (never gate on empty)"
        );
    }

    #[test]
    fn fast_storage_present_gates_sysmain() {
        let nvme = HardwareInfo {
            physical_disks: vec![pdisk("Unknown", "NVMe")],
            ..Default::default()
        };
        assert!(condition_matches(&Condition::FastStoragePresent, &nvme));
        let ssd = HardwareInfo {
            physical_disks: vec![pdisk("SSD", "SATA")],
            ..Default::default()
        };
        assert!(condition_matches(&Condition::FastStoragePresent, &ssd));
        let hdd = HardwareInfo {
            physical_disks: vec![pdisk("HDD", "SATA")],
            ..Default::default()
        };
        assert!(!condition_matches(&Condition::FastStoragePresent, &hdd));
    }

    #[test]
    fn ram_threshold_gating() {
        let mut h = HardwareInfo {
            ram_total_bytes: 16 * 1024 * 1024 * 1024,
            ..Default::default()
        };
        assert!(condition_matches(&Condition::RamGbAtLeast { min_gb: 16 }, &h));
        h.ram_total_bytes = 8 * 1024 * 1024 * 1024;
        assert!(!condition_matches(&Condition::RamGbAtLeast { min_gb: 16 }, &h));
    }

    #[test]
    fn modern_discrete_gpu_gates_hags() {
        let amd = HardwareInfo {
            gpus: vec![gpu("AMD Radeon RX 9070 XT")],
            ..Default::default()
        };
        assert!(condition_matches(&Condition::HasModernDiscreteGpu, &amd));
        let nv = HardwareInfo {
            gpus: vec![gpu("NVIDIA GeForce RTX 4080")],
            ..Default::default()
        };
        assert!(condition_matches(&Condition::HasModernDiscreteGpu, &nv));
        let old = HardwareInfo {
            gpus: vec![gpu("Intel HD Graphics 4000")],
            ..Default::default()
        };
        assert!(!condition_matches(&Condition::HasModernDiscreteGpu, &old));
    }

    #[test]
    fn active_wired_ethernet_gates_eee() {
        let mut h = HardwareInfo {
            has_active_wired_ethernet: true,
            ..Default::default()
        };
        assert!(condition_matches(&Condition::HasActiveWiredEthernet, &h));
        h.has_active_wired_ethernet = false;
        assert!(!condition_matches(&Condition::HasActiveWiredEthernet, &h));
    }

    #[test]
    fn gpu_vendor_match_condition() {
        let h = HardwareInfo {
            gpus: vec![gpu("AMD Radeon RX 9070 XT")],
            ..Default::default()
        };
        assert!(condition_matches(
            &Condition::GpuVendor { vendor: "amd".into() },
            &h
        ));
        assert!(!condition_matches(
            &Condition::GpuVendor { vendor: "nvidia".into() },
            &h
        ));
    }

    #[test]
    fn display_underdriven_and_hdr() {
        let mut h = HardwareInfo {
            display: Some(DisplayInfo {
                width: 2560,
                height: 1440,
                current_refresh_rate_hz: 60,
                max_refresh_rate_hz: 144,
                hdr_capable: true,
            }),
            ..Default::default()
        };
        assert!(condition_matches(
            &Condition::DisplayUnderdriven { min_gap_hz: 24 },
            &h
        ));
        assert!(condition_matches(&Condition::DisplayHdrCapable, &h));
        // At max already -> not underdriven.
        h.display.as_mut().unwrap().current_refresh_rate_hz = 144;
        assert!(!condition_matches(
            &Condition::DisplayUnderdriven { min_gap_hz: 24 },
            &h
        ));
    }

    #[test]
    fn storage_below_free_percent_gating() {
        let mut h = HardwareInfo {
            disks: vec![DiskInfo {
                mount_point: "C:".into(),
                total_bytes: 1000,
                available_bytes: 100, // 10% free
                file_system: "NTFS".into(),
            }],
            ..Default::default()
        };
        assert!(condition_matches(
            &Condition::StorageBelowFreePercent {
                mount_prefix: "C:".into(),
                percent: 25.0
            },
            &h
        ));
        h.disks[0].available_bytes = 500; // 50% free
        assert!(!condition_matches(
            &Condition::StorageBelowFreePercent {
                mount_prefix: "C:".into(),
                percent: 25.0
            },
            &h
        ));
    }

    #[test]
    fn embedded_catalog_ids_unique_and_metadata_sane() {
        let file = load_baseline_rules_embedded();
        assert!(!file.rules.is_empty(), "baseline catalog must not be empty");
        let mut seen = std::collections::HashSet::new();
        for r in &file.rules {
            assert!(seen.insert(&r.id), "duplicate rule id in baseline: {}", r.id);
            assert!(!r.id.trim().is_empty(), "empty rule id");
            assert!(!r.title.trim().is_empty(), "empty title for {}", r.id);
            assert!(!r.category.trim().is_empty(), "empty category for {}", r.id);
            assert!(!r.severity.trim().is_empty(), "empty severity for {}", r.id);
            assert!(!r.impact.trim().is_empty(), "empty impact for {}", r.id);
        }
    }

    #[test]
    fn build_recommendations_produces_unique_ids() {
        // Rich fixture so many gates fire; build_recommendations also reads the
        // real machine's state probes for currently_applied — IDs must be
        // unique across JSON + code recs regardless.
        let h = HardwareInfo {
            ram_total_bytes: 32 * 1024 * 1024 * 1024,
            gpus: vec![gpu("AMD Radeon RX 9070 XT")],
            physical_disks: vec![pdisk("SSD", "NVMe")],
            has_active_wired_ethernet: true,
            ..Default::default()
        };
        let recs = build_recommendations(&h);
        let mut seen = std::collections::HashSet::new();
        for r in &recs {
            assert!(seen.insert(r.id.clone()), "duplicate rec id: {}", r.id);
        }
    }
}
