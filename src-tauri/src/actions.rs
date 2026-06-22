//! actions: the Windows-mutation boundary. Owns every change Compy makes to
//! the system AND the rollback/restoration mechanics — the typed action
//! allowlist (KnownService, AppliedAction, RollbackAction, Snapshot), the
//! apply_* functions, the rollback_*_typed functions, the rollback dispatch,
//! legacy-synthesis + history-only rollback resolution, and the shared
//! mutation primitives (run_elevated_powershell, powercfg/service/EEE helpers).
//!
//! Boundary: actions executes mutation + restoration. lib orchestrates (the
//! apply_recommendation / rollback_change commands call into here and own
//! history). recommendations decides what to show but never mutates. The state
//! probes stay in lib for now and are consumed here by name.
//! This is a pure boundary move — no behavior change.

use std::process::Command;

use serde::{Deserialize, Serialize};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE};
use winreg::RegKey;
use wmi::{COMLibrary, WMIConnection};

use crate::history::AppliedChange;
// State probes stay in lib (least-wrong place until a cleaner seam); some
// apply_* fns read them to snapshot prior state before mutating.
use crate::{fast_startup_state, hags_state, reserved_storage_enabled};

/// Build a `Command` that never flashes a console window. EVERY non-elevated CLI probe (powercfg,
/// sc, logman, powershell) MUST use this — without `CREATE_NO_WINDOW`, Windows briefly pops a
/// console per spawn, which on launch reads as the terminal rapidly flashing open and closed.
pub(crate) fn quiet_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut c = Command::new(program);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) enum KnownService {
    SysMain,
    DiagTrack,
    WSearch,
    NvTelemetryContainer,
}

impl KnownService {
    fn name(&self) -> &'static str {
        match self {
            KnownService::SysMain => "SysMain",
            KnownService::DiagTrack => "DiagTrack",
            KnownService::WSearch => "WSearch",
            KnownService::NvTelemetryContainer => "NvTelemetryContainer",
        }
    }
}

/// Allowlist of well-known, textbook-safe TELEMETRY scheduled tasks Compy may disable. Conservative
/// STARTER set (Microsoft-documented CEIP / Compatibility-Appraiser telemetry) — explicitly **NO
/// Defender, NO system policy, nothing that breaks functionality** (those stay on the hard blocklist).
/// The owner curates/expands this set before the feature is EVER armed (`bloat_removal_gate()`=false
/// until then), so nothing AI-guessed ships. Type-enforced: only these tasks are ever disable-able.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) enum KnownBloatTask {
    CompatibilityAppraiser,
    CeipConsolidator,
    CeipUsb,
}

impl KnownBloatTask {
    /// (TaskPath, TaskName) — fixed, Microsoft-documented telemetry-task identifiers. Both legitimately
    /// contain spaces + backslashes, so they go through `ps_safe_squoted` (single-quoted-literal guard).
    fn path_and_name(&self) -> (&'static str, &'static str) {
        match self {
            KnownBloatTask::CompatibilityAppraiser => (
                "\\Microsoft\\Windows\\Application Experience\\",
                "Microsoft Compatibility Appraiser",
            ),
            KnownBloatTask::CeipConsolidator => (
                "\\Microsoft\\Windows\\Customer Experience Improvement Program\\",
                "Consolidator",
            ),
            KnownBloatTask::CeipUsb => (
                "\\Microsoft\\Windows\\Customer Experience Improvement Program\\",
                "UsbCeip",
            ),
        }
    }

    /// Map an id to the type-enforced allowlist — rejects everything off-list (Defender/policy/etc.
    /// can never be passed).
    pub(crate) fn from_id(id: &str) -> Option<KnownBloatTask> {
        match id {
            "compatibility-appraiser" => Some(KnownBloatTask::CompatibilityAppraiser),
            "ceip-consolidator" => Some(KnownBloatTask::CeipConsolidator),
            "ceip-usb" => Some(KnownBloatTask::CeipUsb),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum AppliedAction {
    DisableKnownService { service: KnownService },
    EnableGameMode,
    DisableMouseAcceleration,
    DisableGameBarAndDvr,
    SetVisualEffectsBestPerformance,
    EnableHardwareGpuScheduling,
    SetUltimatePerformancePlan,
    DisableNagleOnActiveNics,
    DisableFastStartup,
    DisableReservedStorage,
    DisableUsbSelectiveSuspendOnAc,
    DisablePcieAspmOnAc,
    DisableEnergyEfficientEthernet,
    // ── Leftovers v2 restore (R2-5, BUILT DARK — gate off, no IPC; ships only after its own
    // live UAC QA + owner sign-off). Each restores a Windows STOCK default; the snapshot holds
    // the rotted value, so even the restore is reversible ("you can get your rot back").
    RestoreMemoryCompressionDefault,
    RestoreMmcssDefaults,
    RestorePrioritySeparationDefault,
    // Leftovers v2 dark wave 2 (2026-06-11): MPO / core-parking / TCP autotuning. All
    // integer-or-fixed-command — no external string enters an elevated command. (Pagefile +
    // bcdedit + Defender deliberately NOT here — see the spec / Review Queue.)
    RestoreMpoDefault,
    RestoreCoreParkingDefault,
    RestoreTcpAutotuningDefault,
    // The origin-story resolver (option (a), Cowork call 2026-06-11): re-enable Windows-managed
    // paging. Reboot required to take effect — stated, never silent.
    RestorePagefileAutomatic,
    // OS-debloat (BUILT DARK): disable a well-known telemetry scheduled task. Reversible via
    // EnableScheduledTask. ONLY the curated KnownBloatTask set (no Defender / policy).
    DisableScheduledTask { task: KnownBloatTask },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
// The shared `Restore*` prefix is semantic, not redundant — these variants ARE
// the restore (rollback) action set. Renaming them would churn the serde tags +
// dispatch match + the persisted Trust Ledger contract for zero benefit.
#[allow(clippy::enum_variant_names)]
pub(crate) enum RollbackAction {
    RestoreServiceFromSnapshot { service: KnownService },
    RestoreGameModeFromSnapshot,
    RestoreMouseAccelFromSnapshot,
    RestoreGameBarFromSnapshot,
    RestoreVisualEffectsFromSnapshot,
    RestoreHwSchModeFromSnapshot,
    RestorePowerPlanFromSnapshot,
    RestoreNagleNicsFromSnapshot,
    RestoreFastStartupFromSnapshot,
    RestoreReservedStorageFromSnapshot,
    // USB SS + PCIe ASPM share this variant. The Snapshot::PowerPlanSetting
    // carries the subgroup + setting GUIDs plus the prior AC/DC values, so
    // a single typed rollback handler covers both rec ids.
    RestorePowerPlanSettingFromSnapshot,
    RestoreEnergyEfficientEthernetFromSnapshot,
    // Leftovers v2 (dark): undo a restore — put the user's pre-restore (rotted) value back.
    RestoreMemoryCompressionFromSnapshot,
    RestoreMmcssFromSnapshot,
    RestorePrioritySeparationFromSnapshot,
    // Dark wave 2.
    RestoreMpoFromSnapshot,
    RestoreCoreParkingFromSnapshot,
    RestoreTcpAutotuningFromSnapshot,
    RestorePagefileFromSnapshot,
    EnableScheduledTask { task: KnownBloatTask },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Snapshot {
    Service {
        prior_state: String,
        prior_start_mode: String,
    },
    GameMode {
        prior_enabled: Option<u32>,
        // AllowAutoGameMode — the master "allow" Windows reconciles AutoGameModeEnabled against on
        // login. Captured so rollback restores the exact pair. `#[serde(default)]` keeps pre-fix
        // typed ledger entries (which lacked this field) deserializable, so a change applied before
        // this fix stays undoable — rollback-first integrity (ARCHITECTURE_LOCKS §3).
        #[serde(default)]
        prior_allow: Option<u32>,
    },
    MouseAccel {
        prior_speed: String,
        prior_threshold1: String,
        prior_threshold2: String,
    },
    GameBar {
        prior_capture: Option<u32>,
        prior_enabled: Option<u32>,
    },
    VisualEffects {
        vfx_setting_prior: Option<u32>,
        user_prefs_mask_prior: Option<Vec<u8>>,
    },
    HwSchMode {
        prior: Option<u32>,
    },
    PowerPlan {
        prior_guid: String,
    },
    NagleNics {
        interfaces: Vec<NagleInterfaceSnapshot>,
    },
    FastStartup {
        prior_hiberboot: Option<u32>,
    },
    ReservedStorage {
        prior_enabled: bool,
    },
    // Generic power-plan setting snapshot — used by USB Selective Suspend
    // and PCIe ASPM (both follow the same powercfg /setacvalueindex shape).
    // Snapshots both AC and DC values plus the active plan GUID for context.
    PowerPlanSetting {
        plan_guid: String,
        subgroup_guid: String,
        setting_guid: String,
        prior_ac_value: u32,
        prior_dc_value: u32,
    },
    // Per-adapter Energy Efficient Ethernet property. Each adapter has a
    // potentially different vendor-named property (EEE / Green Ethernet /
    // Advanced EEE / etc.) — snapshot stores the resolved name per adapter.
    EeeNicProperty {
        adapters: Vec<EeeNicSnapshot>,
    },
    // ── Leftovers v2 (dark) — the pre-restore (rotted) values, so a restore is undoable. ──
    // None for a registry value means "was absent" (rollback deletes it); the memory-compression
    // apply REFUSES when its prior is unreadable, so its None never reaches a rollback blind.
    MemoryCompression {
        prior_enabled: Option<bool>,
    },
    Mmcss {
        prior_system_responsiveness: Option<u32>,
        prior_network_throttling: Option<u32>,
    },
    PrioritySeparation {
        prior_value: Option<u32>,
    },
    // Dark wave 2 — all integer priors (None = the value was absent → rollback removes it).
    Mpo {
        prior_overlay_test_mode: Option<u32>,
    },
    CoreParking {
        prior_ac_pct: Option<u32>,
        prior_dc_pct: Option<u32>,
    },
    TcpAutotuning {
        prior_disabled: bool,
    },
    // Pagefile, option (a): ONLY the validated single-entry layout is ever snapshotted —
    // one ASCII drive letter + two u32 sizes. Exotic/multi-pagefile layouts are REFUSED at
    // apply time, so this snapshot is always reconstructible into a provably
    // metacharacter-free PagingFiles entry (the no-string-into-elevated invariant).
    PagefileManual {
        prior_drive_letter: char,
        prior_initial_mb: u32,
        prior_maximum_mb: u32,
    },
    // Prior scheduled-task state ("Ready" | "Disabled" | "Running" | "Unknown"), so rollback re-enables
    // only a task that was actually enabled before.
    ScheduledTask {
        prior_state: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct NagleInterfaceSnapshot {
    pub(crate) interface: String,
    pub(crate) prior_ack: Option<u32>,
    pub(crate) prior_nodelay: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct EeeNicSnapshot {
    pub(crate) adapter_name: String,
    pub(crate) property_display_name: String,
    pub(crate) prior_value: String,
}

// What an apply_* function produces. Carries the full rollback contract
// independent of the live recommendation catalog.
pub(crate) struct ApplyResult {
    pub(crate) applied_action: AppliedAction,
    pub(crate) rollback_action: RollbackAction,
    pub(crate) snapshot: Snapshot,
    pub(crate) elevation_used: bool,
}

/// A short, human-readable description of the state a rollback restores — derived ONLY from the
/// typed `Snapshot` we actually captured at apply time. Never probes live state, never turns a bare
/// GUID into a name. Returns `None` when no clean label is derivable (legacy/untyped entries, a
/// power plan captured as only a GUID, or multi-target snapshots) → the UI then shows the generic
/// "your previous setting". Read-only enrichment for the Fix surface (spec 2026-06-05-fix-surface §5).
pub(crate) fn restores_label_from_snapshot(snapshot: &serde_json::Value) -> Option<String> {
    let snap: Snapshot = serde_json::from_value(snapshot.clone()).ok()?;
    label_for_snapshot(&snap)
}

fn label_for_snapshot(snap: &Snapshot) -> Option<String> {
    // Registry booleans captured as 0/1.
    let on_off = |v: Option<u32>| match v {
        Some(0) => Some("Off".to_string()),
        Some(1) => Some("On".to_string()),
        _ => None,
    };
    match snap {
        Snapshot::Service {
            prior_state,
            prior_start_mode,
        } => {
            let mode = prior_start_mode.trim();
            let state = prior_state.trim();
            if mode.eq_ignore_ascii_case("Disabled") {
                Some("Disabled".to_string())
            } else if state.eq_ignore_ascii_case("Running") {
                Some("Running".to_string())
            } else if mode.eq_ignore_ascii_case("Auto") || mode.eq_ignore_ascii_case("Automatic") {
                Some("Automatic start".to_string())
            } else if mode.eq_ignore_ascii_case("Manual") {
                Some("Manual start".to_string())
            } else {
                None
            }
        }
        // Rollback (re-enable) restores the task to its prior state.
        Snapshot::ScheduledTask { prior_state } => match prior_state.trim() {
            "Ready" => Some("Enabled".to_string()),
            "Running" => Some("Running".to_string()),
            "Disabled" => Some("Disabled".to_string()),
            _ => None,
        },
        Snapshot::GameMode { prior_enabled, .. } => on_off(*prior_enabled),
        Snapshot::GameBar { prior_enabled, .. } => on_off(*prior_enabled),
        Snapshot::MouseAccel { prior_speed, .. } => match prior_speed.trim() {
            "1" => Some("On".to_string()),
            "0" => Some("Off".to_string()),
            _ => None,
        },
        // HAGS uses 2 = on, 1 = off (not 0/1).
        Snapshot::HwSchMode { prior } => match prior {
            Some(2) => Some("On".to_string()),
            Some(1) => Some("Off".to_string()),
            _ => None,
        },
        // VisualFXSetting registry semantics: 0 = Windows default, 1 = best appearance,
        // 2 = best performance, 3 = custom.
        Snapshot::VisualEffects {
            vfx_setting_prior, ..
        } => match vfx_setting_prior {
            Some(0) => Some("Windows default".to_string()),
            Some(1) => Some("Best appearance".to_string()),
            Some(2) => Some("Best performance".to_string()),
            Some(3) => Some("Custom".to_string()),
            _ => None,
        },
        Snapshot::FastStartup { prior_hiberboot } => on_off(*prior_hiberboot),
        Snapshot::ReservedStorage { prior_enabled } => {
            Some(if *prior_enabled { "On" } else { "Off" }.to_string())
        }
        // A bare GUID is NOT a name — never dress it up (spec §5). No name captured → generic.
        Snapshot::PowerPlan { .. } => None,
        // Power-plan setting indices and per-NIC vendor properties have no single clean label.
        Snapshot::PowerPlanSetting { .. }
        | Snapshot::NagleNics { .. }
        | Snapshot::EeeNicProperty { .. } => None,
        // Leftovers v2 (dark): the pre-restore value, plainly named for the ledger card.
        Snapshot::MemoryCompression { prior_enabled } => {
            prior_enabled.map(|on| if on { "On" } else { "Off" }.to_string())
        }
        Snapshot::Mmcss {
            prior_system_responsiveness,
            prior_network_throttling,
        } => match (prior_system_responsiveness, prior_network_throttling) {
            (None, None) => Some("Windows defaults (values absent)".to_string()),
            (sr, nti) => Some(format!(
                "SystemResponsiveness {} · NetworkThrottlingIndex {}",
                sr.map_or("absent".to_string(), |v| v.to_string()),
                nti.map_or("absent".to_string(), |v| v.to_string()),
            )),
        },
        Snapshot::PrioritySeparation { prior_value } => {
            prior_value.map(|v| format!("{v} (0x{v:X})"))
        }
        // Dark wave 2 — the pre-restore (rotted) value, named for the ledger card.
        Snapshot::Mpo { prior_overlay_test_mode } => {
            prior_overlay_test_mode.map(|v| format!("OverlayTestMode {v}"))
        }
        Snapshot::CoreParking { prior_ac_pct, .. } => {
            prior_ac_pct.map(|v| format!("min unparked {v}%"))
        }
        Snapshot::TcpAutotuning { prior_disabled } => {
            Some(if *prior_disabled { "disabled" } else { "normal" }.to_string())
        }
        Snapshot::PagefileManual { prior_drive_letter, prior_initial_mb, prior_maximum_mb } => {
            Some(format!(
                "Fixed {prior_initial_mb}–{prior_maximum_mb} MB on {prior_drive_letter}:"
            ))
        }
    }
}

// Windows Game Mode lives in a PAIR of HKCU DWORDs under this key. The Settings toggle writes
// BOTH; AllowAutoGameMode is the master the Game Bar service reconciles AutoGameModeEnabled
// against on login, so writing only AutoGameModeEnabled gets reverted to 0 on the next reboot
// (root cause of the "never stays on / re-apply loop" bug — owner export showed 5× applies).
// Detect (lib::game_mode_enabled), apply, and rollback all reference these constants so the read
// and write paths can never silently drift apart.
pub(crate) const GAMEBAR_KEY: &str = "Software\\Microsoft\\GameBar";
pub(crate) const GAME_MODE_ENABLED_VALUE: &str = "AutoGameModeEnabled";
pub(crate) const GAME_MODE_ALLOW_VALUE: &str = "AllowAutoGameMode";

pub(crate) fn apply_game_mode() -> Result<ApplyResult, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(GAMEBAR_KEY)
        .map_err(|e| e.to_string())?;
    let prior_enabled: Option<u32> = key.get_value(GAME_MODE_ENABLED_VALUE).ok();
    let prior_allow: Option<u32> = key.get_value(GAME_MODE_ALLOW_VALUE).ok();
    // Mirror the Settings UI: set the whole pair so Windows has nothing to reconcile away.
    key.set_value(GAME_MODE_ALLOW_VALUE, &1u32)
        .map_err(|e| e.to_string())?;
    key.set_value(GAME_MODE_ENABLED_VALUE, &1u32)
        .map_err(|e| e.to_string())?;
    Ok(ApplyResult {
        applied_action: AppliedAction::EnableGameMode,
        rollback_action: RollbackAction::RestoreGameModeFromSnapshot,
        snapshot: Snapshot::GameMode {
            prior_enabled,
            prior_allow,
        },
        elevation_used: false,
    })
}

pub(crate) fn rollback_game_mode_typed(
    prior_enabled: Option<u32>,
    prior_allow: Option<u32>,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(GAMEBAR_KEY, KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    // Some(v) => restore the exact prior value; None => the value didn't exist at apply time
    // (or is a pre-fix legacy entry that never captured it) => delete to restore the default.
    let restore = |name: &str, prior: Option<u32>| -> Result<(), String> {
        match prior {
            Some(v) => key.set_value(name, &v).map_err(|e| e.to_string()),
            None => {
                let _ = key.delete_value(name);
                Ok(())
            }
        }
    };
    restore(GAME_MODE_ENABLED_VALUE, prior_enabled)?;
    restore(GAME_MODE_ALLOW_VALUE, prior_allow)?;
    Ok(())
}

// Documented "Best Performance" value for HKCU\Control Panel\Desktop\UserPreferencesMask
const BEST_PERF_USER_PREFS_MASK: [u8; 8] = [0x90, 0x12, 0x03, 0x80, 0x10, 0x00, 0x00, 0x00];

pub(crate) fn apply_visual_effects() -> Result<ApplyResult, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let (vfx_key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects")
        .map_err(|e| e.to_string())?;
    let vfx_setting_prior: Option<u32> = vfx_key.get_value("VisualFXSetting").ok();
    vfx_key
        .set_value("VisualFXSetting", &2u32)
        .map_err(|e| e.to_string())?;

    let (desktop_key, _) = hkcu
        .create_subkey("Control Panel\\Desktop")
        .map_err(|e| e.to_string())?;
    let user_prefs_mask_prior: Option<Vec<u8>> = desktop_key
        .get_raw_value("UserPreferencesMask")
        .ok()
        .map(|v| v.bytes);
    desktop_key
        .set_raw_value(
            "UserPreferencesMask",
            &winreg::RegValue {
                bytes: BEST_PERF_USER_PREFS_MASK.to_vec(),
                vtype: winreg::enums::RegType::REG_BINARY,
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(ApplyResult {
        applied_action: AppliedAction::SetVisualEffectsBestPerformance,
        rollback_action: RollbackAction::RestoreVisualEffectsFromSnapshot,
        snapshot: Snapshot::VisualEffects {
            vfx_setting_prior,
            user_prefs_mask_prior,
        },
        elevation_used: false,
    })
}

// ─── Admin-elevation helper ──────────────────────────────────────────────
// Triggers a Windows UAC prompt; the elevated child runs `program args...`,
// the calling Compy process stays at standard user. We use this pattern
// rather than running Compy itself elevated, which would force a UAC
// prompt on every launch.

// ─── §4 one-elevation batching: the deferral sink (spec 2026-06-06-beta-feedback-3 §4) ───
// Thread-local on purpose: arming it can only affect the ONE thread that armed it (the batch
// orchestrator's command thread). While armed, `run_elevated_powershell` CAPTURES the command
// instead of elevating. This is safe ONLY because every batchable apply_* performs reads before
// its single elevated call and no mutation after it — deferring therefore causes no partial
// mutation. The rollback path never runs under an armed sink (the orchestrator is the only
// arm-er and it never rolls back).
thread_local! {
    static ELEVATION_SINK: std::cell::RefCell<Option<Vec<String>>> =
        const { std::cell::RefCell::new(None) };
}

// Test-only: forces `run_elevated_powershell` to return the UAC-decline error WITHOUT spawning a
// real elevation prompt, so the orchestrator's elevation-failure (UAC cancel) arm is deterministically
// testable. Never compiled into the shipped binary.
#[cfg(test)]
thread_local! {
    static FORCE_ELEVATION_ERROR: std::cell::RefCell<bool> = const { std::cell::RefCell::new(false) };
}

/// RAII guard that makes elevation fail on this thread for the guard's lifetime (test-only).
#[cfg(test)]
pub(crate) struct ForceElevationError;

#[cfg(test)]
impl ForceElevationError {
    pub(crate) fn begin() -> Self {
        FORCE_ELEVATION_ERROR.with(|f| *f.borrow_mut() = true);
        ForceElevationError
    }
}

#[cfg(test)]
impl Drop for ForceElevationError {
    fn drop(&mut self) {
        FORCE_ELEVATION_ERROR.with(|f| *f.borrow_mut() = false);
    }
}

/// RAII guard for the deferral sink — the sink is disarmed when this drops (including on panic,
/// so a poisoned command thread can never leak an armed sink into later invocations).
pub(crate) struct ElevationDeferral {
    _private: (),
}

impl ElevationDeferral {
    /// Arm the sink on this thread. Refuses to nest — a batch inside a batch is a logic error.
    pub(crate) fn begin() -> Result<Self, String> {
        ELEVATION_SINK.with(|s| {
            let mut slot = s.borrow_mut();
            if slot.is_some() {
                return Err("an elevation batch is already active on this thread".to_string());
            }
            *slot = Some(Vec::new());
            Ok(ElevationDeferral { _private: () })
        })
    }

    /// How many elevated commands have been captured so far (the orchestrator reads this after
    /// each apply to attribute captured commands to the rec that produced them).
    pub(crate) fn deferred_count(&self) -> usize {
        ELEVATION_SINK.with(|s| s.borrow().as_ref().map(|v| v.len()).unwrap_or(0))
    }

    /// Take every captured command and disarm the sink (consumes the guard).
    pub(crate) fn take_deferred(self) -> Vec<String> {
        ELEVATION_SINK.with(|s| s.borrow_mut().take().unwrap_or_default())
    }
}

impl Drop for ElevationDeferral {
    fn drop(&mut self) {
        ELEVATION_SINK.with(|s| *s.borrow_mut() = None);
    }
}

/// Compose the ONE inline elevated `-Command` for a batch: per rec, `try { <its cmds> ;
/// receipt 'id:ok' } catch { receipt 'id:fail' }` appended to a result FILE — per-item failure
/// isolation inside a single elevation. `$ErrorActionPreference='Stop'` promotes errors to
/// terminating so a failed step lands in `catch` (a per-cmd `-ErrorAction SilentlyContinue`,
/// where an apply deliberately tolerates a step, still overrides — same semantics as today's
/// per-item elevation). Rec ids pass `ps_safe` (allowlist shape) and the result path is
/// single-quote-escaped; the captured commands themselves come from the audited apply_* builders
/// unchanged. No `exit` may appear at this layer — the only exit-using elevated command
/// (power-ultimate) is rejected by the orchestrator before composition.
pub(crate) fn compose_batch_script(
    items: &[(String, Vec<String>)],
    result_path: &str,
) -> Result<String, String> {
    if items.is_empty() {
        return Err("nothing to compose".to_string());
    }
    let mut script = String::from("$ErrorActionPreference='Stop'; ");
    script.push_str(&format!("$rf='{}'; ", result_path.replace('\'', "''")));
    for (rec_id, cmds) in items {
        ps_safe(rec_id)?; // alphanumeric/._- only — safe inside the receipt literals below
        if cmds.is_empty() {
            return Err(format!("rec '{}' deferred no commands", rec_id));
        }
        let joined = cmds
            .iter()
            .map(|c| c.trim().trim_end_matches(';').trim_end())
            .collect::<Vec<_>>()
            .join("; ");
        script.push_str(&format!(
            "try {{ {joined}; Add-Content -LiteralPath $rf -Value '{rec_id}:ok' }} catch {{ Add-Content -LiteralPath $rf -Value '{rec_id}:fail' }}; "
        ));
    }
    Ok(script)
}

/// Parse the batch result file: one `<rec_id>:ok` / `<rec_id>:fail` line per rec. Unknown or
/// malformed lines are ignored (the orchestrator treats a MISSING receipt as not-applied — the
/// fail-safe direction: we only ever ledger a receipt that explicitly says ok).
pub(crate) fn parse_batch_receipts(text: &str) -> std::collections::HashMap<String, bool> {
    let mut receipts = std::collections::HashMap::new();
    for line in text.lines() {
        if let Some((id, status)) = line.trim().rsplit_once(':') {
            match status {
                "ok" => {
                    receipts.insert(id.to_string(), true);
                }
                "fail" => {
                    receipts.insert(id.to_string(), false);
                }
                _ => {}
            }
        }
    }
    receipts
}

/// The one message allowed to say the user declined. Reused by the test seam so the simulated
/// decline and the real one can never drift apart.
pub(crate) const ELEVATION_DECLINED_MSG: &str =
    "You didn't approve the elevation prompt — nothing was changed.";

/// Honest attribution for a `runas` outcome (pure — unit-tested with synthetic results). THE TRUST
/// RULE (tester-found, 2026-06-10): the app must NEVER tell a user they cancelled when they didn't.
/// A real UAC decline surfaces from ShellExecuteEx as os error 1223 (ERROR_CANCELLED) — a LAUNCH
/// error, not an exit code — and that is the ONLY outcome allowed to mention declining. A non-zero
/// EXIT CODE means the user APPROVED elevation and the elevated command itself failed (the previous
/// code mapped exactly that case to "Did you cancel the UAC prompt?" — backwards, and the decline
/// path never said "cancelled" at all).
pub(crate) fn elevation_outcome(
    result: std::io::Result<std::process::ExitStatus>,
) -> Result<(), String> {
    const ERROR_CANCELLED: i32 = 1223; // ShellExecuteEx: the user dismissed the UAC prompt
    match result {
        Err(e) if e.raw_os_error() == Some(ERROR_CANCELLED) => Err(ELEVATION_DECLINED_MSG.into()),
        Err(e) => Err(format!("could not launch elevated process: {}", e)),
        Ok(s) if !s.success() => Err(format!(
            "You approved the elevation, but the operation itself failed (exit code {}) — the prompt was fine; the command hit an error.",
            s.code().map(|c| c.to_string()).unwrap_or_else(|| "?".into())
        )),
        Ok(_) => Ok(()),
    }
}

pub(crate) fn run_elevated_powershell(command: &str) -> Result<(), String> {
    // §4 batching: an armed sink on THIS thread captures instead of elevating (see above).
    let deferred = ELEVATION_SINK.with(|s| {
        if let Some(sink) = s.borrow_mut().as_mut() {
            sink.push(command.to_string());
            true
        } else {
            false
        }
    });
    if deferred {
        return Ok(());
    }
    // Test-only seam: deterministically simulate a UAC DECLINE without spawning runas (which would
    // pop a real Secure-Desktop prompt). Returns the same constant as a real decline so the
    // simulated and real paths can't drift. `#[cfg(test)]` removes it from the shipped binary.
    #[cfg(test)]
    if FORCE_ELEVATION_ERROR.with(|f| *f.borrow()) {
        return Err(ELEVATION_DECLINED_MSG.to_string());
    }
    // Wave 0 — silence the elevated console: route the command through a WINDOWLESS compy.exe
    // self-helper instead of elevating powershell.exe directly. An elevated launch is recreated by
    // the UAC broker (AppInfo) with its OWN window settings, so SW_HIDE can't stop a console-subsystem
    // app (powershell.exe) from briefly flashing a console. compy.exe is windows-subsystem in release
    // (no console EVER) and runs powershell via quiet_command (CREATE_NO_WINDOW) — so no console
    // exists to flash. The helper exits with powershell's exit code, so elevation_outcome's attribution
    // is preserved EXACTLY: a real UAC decline is still a LAUNCH error 1223 (the user dismissing the
    // compy.exe prompt), a non-zero exit is still "approved but the operation failed", 0 is success.
    // The command is hex-encoded into ONE argv (no temp file → no TOCTOU / cleanup); it was already
    // validated by validate_command before reaching here. UAC consent stays OS-controlled + visible
    // (the prompt now names compy.exe — consistent with how the FPS helper already elevates).
    let exe = std::env::current_exe().map_err(|e| format!("cannot find own exe: {e}"))?;
    let encoded = to_hex(command.as_bytes());
    // The frozen catalog never approaches this, but never silently truncate a command line (Windows
    // caps it ~32k chars) — fail loud instead.
    if encoded.len() > 30_000 {
        return Err("elevated command is too long to dispatch".to_string());
    }
    elevation_outcome(
        runas::Command::new(exe)
            .args(&["--run-elevated", &encoded])
            .show(false)
            .status(),
    )
}

/// Hex-encode bytes so an elevated command can ride as a single, quoting-safe argv to the
/// `--run-elevated` helper (Wave 0). Pure; round-trips with `from_hex`. Lowercase, fixed 2 chars/byte.
pub(crate) fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap_or('0'));
        s.push(char::from_digit((b & 0x0f) as u32, 16).unwrap_or('0'));
    }
    s
}

/// Decode `to_hex`. Returns None on odd length or any non-hex digit — the helper then fails safe
/// (exits non-zero → "approved, but the operation failed"), never running garbage.
pub(crate) fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(s.len() / 2);
    let mut i = 0;
    while i < b.len() {
        let hi = (b[i] as char).to_digit(16)?;
        let lo = (b[i + 1] as char).to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
        i += 2;
    }
    Some(out)
}

/// Defense-in-depth against elevated-command injection. Any value interpolated into a
/// `run_elevated_powershell` command string must pass this first. Today every such token comes from
/// the curated catalog (Windows service names, power-plan/subgroup/setting GUIDs, fixed state words)
/// and is inherently safe; this guarantees it stays safe even if a future caller routes external or
/// dynamic input (e.g. signed remote rules) through the same path. The whitelist
/// (`[A-Za-z0-9_.-]`) admits every legitimate token and rejects every shell metacharacter
/// (`; | & $ \` ( ) { } < > " '` space, newline, …) that could break out of the intended command.
pub(crate) fn ps_safe(token: &str) -> Result<(), String> {
    if !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    {
        Ok(())
    } else {
        Err(format!(
            "refusing to build an elevated command with an unsafe token: {token:?}"
        ))
    }
}

/// Like `ps_safe`, but for tokens placed INSIDE a SINGLE-QUOTED PowerShell literal (`'...'`) —
/// scheduled-task names/paths legitimately contain spaces and backslashes. Admits `[A-Za-z0-9_.-]`
/// PLUS space and backslash, and FORBIDS the single quote itself (so the token can't terminate its
/// own quoting → no breakout) and every expansion/metacharacter (`"` `$` `` ` `` `;` `|` `&` `<` `>`
/// `(` `)` `{` `}` `*` `?` `/` newline …). MUST only ever be interpolated inside `'...'`. Today's
/// only callers pass FIXED, compile-time `KnownBloatTask` constants — never user/remote input.
pub(crate) fn ps_safe_squoted(token: &str) -> Result<(), String> {
    if !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-' | ' ' | '\\'))
    {
        Ok(())
    } else {
        Err(format!(
            "refusing to build an elevated command with an unsafe single-quoted token: {token:?}"
        ))
    }
}

#[cfg(test)]
mod ps_injection_tests {
    use super::ps_safe;

    #[test]
    fn accepts_every_real_catalog_token() {
        // Service names, the fixed state/startup words, and power-plan GUIDs — every token we
        // actually interpolate into an elevated command.
        for t in [
            "SysMain",
            "DiagTrack",
            "Automatic",
            "Manual",
            "Disabled",
            "Enabled",
            "2a737441-1930-4402-8d77-b2bebba308a3",
            "48e6b7a6-50f5-4782-a5d4-53bb8f07e226",
        ] {
            assert!(ps_safe(t).is_ok(), "should accept legitimate token {t:?}");
        }
    }

    #[test]
    fn rejects_injection_attempts() {
        for t in [
            "",
            "Svc; Stop-Computer",
            "a && shutdown /s /t 0",
            "$(Remove-Item C:\\)",
            "a`whoami`",
            "a | Out-File x",
            "a\nStart-Process calc",
            "Name -Force; calc",
            "\"quoted\"",
            "has space",
        ] {
            assert!(ps_safe(t).is_err(), "should reject unsafe token {t:?}");
        }
    }
}

#[cfg(test)]
mod batch_elevation_tests {
    use super::{
        compose_batch_script, from_hex, parse_batch_receipts, run_elevated_powershell, to_hex,
        ElevationDeferral,
    };

    #[test]
    fn hex_round_trips_and_rejects_malformed() {
        // Round-trips arbitrary command bytes (spaces, quotes, $, newlines, unicode) so the
        // --run-elevated argv survives intact regardless of the command's contents.
        for s in [
            "",
            "powercfg /setactive 12345678-90ab-cdef-1234-567890abcdef",
            "try { Set-ItemProperty 'X' -Value 0 } catch { 'fail' }; $x = \"q\"\n\t end",
            "üñîçødé ⚡",
        ] {
            let enc = to_hex(s.as_bytes());
            assert!(enc.len().is_multiple_of(2) && enc.chars().all(|c| c.is_ascii_hexdigit()));
            assert_eq!(from_hex(&enc).as_deref(), Some(s.as_bytes()));
        }
        // Malformed encodings fail safe (None) — never panic, never half-decode.
        assert_eq!(from_hex("abc"), None); // odd length
        assert_eq!(from_hex("zz"), None); // non-hex digit
        assert_eq!(from_hex("6x"), None); // one bad nibble
    }

    #[test]
    fn sink_captures_instead_of_elevating_and_disarms_on_take() {
        let guard = ElevationDeferral::begin().expect("arm");
        // With the sink armed this CAPTURES — it must not launch anything (no UAC in tests).
        run_elevated_powershell("Get-Date | Out-Null").expect("captured, not run");
        run_elevated_powershell("Get-Item X").expect("captured, not run");
        assert_eq!(guard.deferred_count(), 2);
        let cmds = guard.take_deferred();
        assert_eq!(cmds, vec!["Get-Date | Out-Null".to_string(), "Get-Item X".to_string()]);
        // Disarmed after take: a fresh guard arms cleanly (would Err if a sink leaked).
        let fresh = ElevationDeferral::begin().expect("sink must be disarmed after take");
        assert_eq!(fresh.deferred_count(), 0);
    }

    #[test]
    fn sink_disarms_on_drop_and_refuses_to_nest() {
        {
            let _guard = ElevationDeferral::begin().expect("arm");
            assert!(ElevationDeferral::begin().is_err(), "nesting must be refused");
        }
        // Dropped (not taken) → still disarmed.
        let fresh = ElevationDeferral::begin().expect("sink must be disarmed after drop");
        drop(fresh);
    }

    #[test]
    fn compose_builds_per_rec_try_catch_with_receipts() {
        let items = vec![
            ("fast-startup-off".to_string(), vec!["cmdA1; ".to_string()]),
            ("hags-enable".to_string(), vec!["cmdB1".to_string(), "cmdB2;".to_string()]),
        ];
        let s = compose_batch_script(&items, r"C:\Users\o'brien\receipts.txt").expect("compose");
        assert!(s.starts_with("$ErrorActionPreference='Stop'; "), "errors must terminate into catch");
        assert!(s.contains(r"$rf='C:\Users\o''brien\receipts.txt'"), "path single-quote-escaped");
        assert!(s.contains("try { cmdA1; Add-Content -LiteralPath $rf -Value 'fast-startup-off:ok' }"));
        assert!(s.contains("catch { Add-Content -LiteralPath $rf -Value 'fast-startup-off:fail' }"));
        assert!(s.contains("try { cmdB1; cmdB2; Add-Content -LiteralPath $rf -Value 'hags-enable:ok' }"));
        assert!(!s.contains("exit"), "no exit may ever appear in a composed batch");
    }

    #[test]
    fn compose_rejects_unsafe_ids_and_empty_input() {
        // A rec id is embedded in receipt literals — anything outside the ps_safe allowlist is refused.
        let bad = vec![("a'; calc; '".to_string(), vec!["x".to_string()])];
        assert!(compose_batch_script(&bad, "rf").is_err());
        assert!(compose_batch_script(&[], "rf").is_err());
        let empty_cmds = vec![("fast-startup-off".to_string(), Vec::new())];
        assert!(compose_batch_script(&empty_cmds, "rf").is_err());
    }

    #[test]
    fn parse_receipts_maps_ok_fail_and_ignores_garbage() {
        let r = parse_batch_receipts("fast-startup-off:ok\nhags-enable:fail\n\nnot a receipt\nx:maybe\n");
        assert_eq!(r.get("fast-startup-off"), Some(&true));
        assert_eq!(r.get("hags-enable"), Some(&false));
        assert_eq!(r.len(), 2);
    }

    /// THE failure-isolation regression at the PowerShell level, proven against a REAL
    /// (non-elevated) powershell.exe: one rec's command fails → its receipt says fail, every
    /// other rec still runs and receipts ok. This is exactly the script the elevated batch runs —
    /// elevation changes the token, not the semantics.
    #[test]
    fn real_powershell_batch_isolates_a_failing_item() {
        let dir = std::env::temp_dir().join(format!("compy-batch-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let rf = dir.join("receipts.txt");
        let _ = std::fs::remove_file(&rf);
        let items = vec![
            ("alpha-ok".to_string(), vec!["Get-Date | Out-Null".to_string()]),
            (
                "bravo-fail".to_string(),
                vec![r"Get-Item -LiteralPath 'C:\__compy_no_such_path__\x' | Out-Null".to_string()],
            ),
            ("charlie-ok".to_string(), vec!["$null = 1".to_string()]),
        ];
        let script = compose_batch_script(&items, rf.to_string_lossy().as_ref()).expect("compose");
        let status = super::quiet_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .expect("powershell runs");
        assert!(status.success(), "the batch script itself must exit 0 (failures are caught per item)");
        let text = std::fs::read_to_string(&rf).expect("receipt file written");
        let receipts = parse_batch_receipts(&text);
        assert_eq!(receipts.get("alpha-ok"), Some(&true));
        assert_eq!(receipts.get("bravo-fail"), Some(&false), "the failing item must receipt fail");
        assert_eq!(receipts.get("charlie-ok"), Some(&true), "items after a failure still run");
        let _ = std::fs::remove_file(&rf);
        let _ = std::fs::remove_dir(&dir);
    }
}

#[cfg(test)]
mod elevation_attribution_tests {
    use super::{elevation_outcome, ELEVATION_DECLINED_MSG};
    use std::os::windows::process::ExitStatusExt;
    use std::process::ExitStatus;

    // THE TRUST RULE (tester-found): never tell a user they cancelled when they didn't.

    #[test]
    fn a_real_uac_decline_is_the_only_outcome_that_says_declined() {
        // ShellExecuteEx decline = launch error ERROR_CANCELLED (1223).
        let err = elevation_outcome(Err(std::io::Error::from_raw_os_error(1223)))
            .expect_err("decline is an error");
        assert_eq!(err, ELEVATION_DECLINED_MSG);
        assert!(err.contains("didn't approve"));
    }

    #[test]
    fn an_approved_elevation_whose_command_fails_never_mentions_cancelling() {
        // Non-zero EXIT CODE = the user approved, the elevated command itself failed — the exact
        // case the old message blamed on the user ("Did you cancel the UAC prompt?").
        let err = elevation_outcome(Ok(ExitStatus::from_raw(1))).expect_err("failure is an error");
        assert!(err.contains("You approved the elevation"), "got: {err}");
        assert!(err.contains("exit code 1"), "got: {err}");
        let lower = err.to_lowercase();
        assert!(!lower.contains("cancel"), "must never blame the user: {err}");
        assert!(!lower.contains("didn't approve"), "must never blame the user: {err}");
    }

    #[test]
    fn success_and_other_launch_failures_map_honestly() {
        assert!(elevation_outcome(Ok(ExitStatus::from_raw(0))).is_ok());
        let err = elevation_outcome(Err(std::io::Error::from_raw_os_error(2)))
            .expect_err("launch failure is an error");
        assert!(err.contains("could not launch elevated process"), "got: {err}");
        assert!(!err.to_lowercase().contains("cancel"), "got: {err}");
    }
}

#[cfg(test)]
mod eee_resolution_tests {
    use super::*;

    fn prop(name: &str, current: &str, valid: &[&str]) -> EeeProperty {
        EeeProperty {
            adapter_name: "Ethernet".into(),
            display_name: name.into(),
            current_value: current.into(),
            valid_values: valid.iter().map(|v| v.to_string()).collect(),
        }
    }

    #[test]
    fn parses_four_field_lines_and_skips_malformed() {
        let out = "Ethernet|Energy Efficient Ethernet|Enabled|Enabled~Disabled\n\
                   Ethernet 2|EEE|On|On~Off\n\
                   garbage line\n\
                   old|three|fields\n";
        let props = parse_eee_property_lines(out);
        assert_eq!(props.len(), 2);
        assert_eq!(props[0].valid_values, vec!["Enabled".to_string(), "Disabled".to_string()]);
        assert_eq!(props[1].current_value, "On");
    }

    #[test]
    fn picks_the_drivers_own_disabled_token_never_assumes_english_disabled() {
        // The tester-found failure: drivers whose vocabulary is Off/0 rejected the literal
        // 'Disabled' write, which then read as a false UAC cancel.
        assert_eq!(pick_disabled_value(&["Enabled".into(), "Disabled".into()]), Some("Disabled".into()));
        assert_eq!(pick_disabled_value(&["On".into(), "Off".into()]), Some("Off".into()));
        assert_eq!(pick_disabled_value(&["1".into(), "0".into()]), Some("0".into()));
        // A vocabulary we don't recognize (e.g. localized) → None: gate, don't guess.
        assert_eq!(pick_disabled_value(&["Aktiviert".into(), "Deaktiviert".into()]), None);
        // Driver reported nothing → legacy fallback to the literal attempt.
        assert_eq!(eee_disable_value_for(&prop("EEE", "Enabled", &[])), Some("Disabled".into()));
    }

    #[test]
    fn resolution_classifies_honestly() {
        assert_eq!(resolve_eee_from(vec![]), EeeResolution::NoEligibleAdapter);
        // Properties exist but none has a recognized off-token → gate as no-switch.
        assert_eq!(
            resolve_eee_from(vec![prop("EEE", "Ein", &["Ein", "Aus"])]),
            EeeResolution::NoDisableSwitch
        );
        // Mixed: keep only the safely-flippable ones.
        let r = resolve_eee_from(vec![
            prop("EEE", "Ein", &["Ein", "Aus"]),
            prop("Green Ethernet", "On", &["On", "Off"]),
        ]);
        match r {
            EeeResolution::Ready(props) => {
                assert_eq!(props.len(), 1);
                assert_eq!(props[0].display_name, "Green Ethernet");
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn detection_reads_the_drivers_vocabulary_not_just_english() {
        // The "EEE state reads wrong" half of the tester report.
        assert!(eee_value_is_disabled(&prop("EEE", "Off", &["On", "Off"])));
        assert!(eee_value_is_disabled(&prop("EEE", "Disabled", &["Enabled", "Disabled"])));
        assert!(eee_value_is_disabled(&prop("EEE", "0", &["1", "0"])));
        assert!(!eee_value_is_disabled(&prop("EEE", "On", &["On", "Off"])));
        assert!(!eee_value_is_disabled(&prop("EEE", "Enabled", &["Enabled", "Disabled"])));
    }

    // PIN — Intel I226-V (tester's NIC, Export 2026-06-10). Intel's igc driver exposes the switch
    // as DisplayName "Energy-Efficient Ethernet" / keyword *EEE with an On/OFF vocabulary. The old
    // pipeline wrote the literal 'Disabled' (rejected) and detection did contains("disab") — which
    // can NEVER read "Off" as disabled, producing the tester's "applied · no longer active (changed
    // outside Compy)" false drift. The new pipeline must apply with the driver's own token AND keep
    // reading it as active.
    #[test]
    fn i226v_on_off_vocabulary_applies_and_stays_active() {
        let i226v_before = prop("Energy-Efficient Ethernet", "On", &["On", "Off"]);
        // Resolves as flippable, with the driver's own token — never the literal 'Disabled'.
        match resolve_eee_from(vec![i226v_before.clone()]) {
            EeeResolution::Ready(props) => assert_eq!(props.len(), 1),
            other => panic!("I226-V must resolve Ready, got {other:?}"),
        }
        assert_eq!(eee_disable_value_for(&i226v_before), Some("Off".into()));
        // After the write, the read-back is "Off" — the comparator reads it as DISABLED (active
        // rec), where the old contains("disab") read it as drifted.
        let i226v_after = prop("Energy-Efficient Ethernet", "Off", &["On", "Off"]);
        assert!(eee_value_is_disabled(&i226v_after));
        assert!(!"Off".to_lowercase().contains("disab"), "the old detection could never pass this");
    }

    // PIN — the AMD dev rig's real Realtek inventory (live probe 2026-06-10): three flippable
    // switches (Disabled/Enabled vocab) resolve; the "EEE Max Support Speed" enum — a speed list,
    // not a switch — has no disable token and is excluded rather than guessed at.
    #[test]
    fn realtek_inventory_resolves_switches_and_excludes_the_speed_enum() {
        let r = resolve_eee_from(vec![
            prop("Energy-Efficient Ethernet", "Enabled", &["Disabled", "Enabled"]),
            prop("Advanced EEE", "Enabled", &["Disabled", "Enabled"]),
            prop("Green Ethernet", "Enabled", &["Disabled", "Enabled"]),
            prop(
                "EEE Max Support Speed",
                "1.0 Gbps Full Duplex",
                &["10 Mbps Full Duplex", "1.0 Gbps Full Duplex"],
            ),
        ]);
        match r {
            EeeResolution::Ready(props) => {
                assert_eq!(props.len(), 3, "the speed enum must be excluded");
                assert!(props.iter().all(|p| eee_disable_value_for(p) == Some("Disabled".into())));
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn apply_script_writes_picked_values_and_exits_deterministically() {
        let targets = vec![
            (prop("EEE", "On", &["On", "Off"]), "Off".to_string()),
            (prop("Energy Efficient Ethernet", "Enabled", &["Enabled", "Disabled"]), "Disabled".to_string()),
        ];
        let ps = build_eee_apply_script(&targets);
        assert!(ps.contains("-DisplayValue 'Off'"), "uses the driver's own token");
        assert!(ps.contains("-DisplayValue 'Disabled'"));
        assert!(ps.ends_with("$null = 0"), "deterministic exit 0 — a skipped pair must never masquerade as an elevation failure");
        assert!(!ps.contains("exit"), "never exit — eee-disable is §4-batchable");
        // Quote-escaping for adapter names with apostrophes.
        let quoted = build_eee_apply_script(&[(
            EeeProperty {
                adapter_name: "Bob's NIC".into(),
                display_name: "EEE".into(),
                current_value: "On".into(),
                valid_values: vec!["On".into(), "Off".into()],
            },
            "Off".into(),
        )]);
        assert!(quoted.contains("'Bob''s NIC'"));
    }
}

#[cfg(test)]
mod nagle_target_tests {
    use super::select_nagle_targets;

    #[test]
    fn targets_physical_excludes_virtual() {
        // Tester case: a Wi-Fi rig with a VPN TAP adapter. Both have IPs; only the physical Wi-Fi
        // NIC should get the Nagle write — never the VPN's virtual interface.
        let with_ip = vec!["{WIFI-GUID}".to_string(), "{TAP-VPN-GUID}".to_string()];
        let physical = vec!["{WIFI-GUID}".to_string()];
        assert_eq!(select_nagle_targets(&with_ip, &physical), vec!["{WIFI-GUID}".to_string()]);
    }

    #[test]
    fn falls_back_to_all_when_physical_unknown_never_inert() {
        // If we can't identify the physical set (WMI down / GUID mismatch), apply to all with-IP so
        // the rec is never silently a no-op.
        let with_ip = vec!["{A}".to_string(), "{B}".to_string()];
        assert_eq!(select_nagle_targets(&with_ip, &[]), with_ip);
        // Registry key casing vs WMI casing: the with-IP side is upper-cased before compare, and the
        // original registry key name is preserved in the result (we write to that exact key).
        let with_ip_lower = vec!["{a}".to_string(), "{b}".to_string()];
        let physical_upper = vec!["{A}".to_string()];
        assert_eq!(select_nagle_targets(&with_ip_lower, &physical_upper), vec!["{a}".to_string()]);
    }
}

// ─── Service state snapshot via WMI ──────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename = "Win32_Service")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32Service {
    state: Option<String>,
    start_mode: Option<String>,
}

pub(crate) fn service_info(name: &str) -> Option<(String, String)> {
    // WMI must run on a clean MTA thread; the Tauri command/UI thread is STA
    // (see hardware::on_wmi_thread). Own the name so the closure is 'static.
    let name = name.to_string();
    crate::hardware::on_wmi_thread(move || {
        let com = COMLibrary::new().ok()?;
        let wmi_conn = WMIConnection::new(com).ok()?;
        let query = format!("SELECT * FROM Win32_Service WHERE Name='{}'", name);
        let results: Vec<Win32Service> = wmi_conn.raw_query(&query).ok()?;
        let svc = results.into_iter().next()?;
        Some((
            svc.state.unwrap_or_else(|| "Unknown".into()),
            svc.start_mode.unwrap_or_else(|| "Unknown".into()),
        ))
    })
}

pub(crate) fn ps_service_startup_for_mode(mode: &str) -> &'static str {
    match mode {
        "Auto" | "Automatic" => "Automatic",
        "Manual" => "Manual",
        "Disabled" => "Disabled",
        _ => "Automatic",
    }
}

// Generic "disable a Windows service" — used for SysMain, NVIDIA telemetry,
// and any future service-shaped rec. Snapshots prior state + start mode so
// rollback returns the service to exactly where it was.
pub(crate) fn apply_service_disable(service: KnownService) -> Result<ApplyResult, String> {
    ps_safe(service.name())?;
    let (prior_state, prior_start_mode) =
        service_info(service.name()).unwrap_or_else(|| ("Running".into(), "Auto".into()));
    let cmd = format!(
        "Set-Service -Name {0} -StartupType Disabled; Stop-Service -Name {0} -Force -ErrorAction SilentlyContinue",
        service.name()
    );
    run_elevated_powershell(&cmd)?;
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableKnownService {
            service: service.clone(),
        },
        rollback_action: RollbackAction::RestoreServiceFromSnapshot { service },
        snapshot: Snapshot::Service {
            prior_state,
            prior_start_mode,
        },
        elevation_used: true,
    })
}

pub(crate) fn rollback_service_disable_typed(
    service: &KnownService,
    prior_state: &str,
    prior_start_mode: &str,
) -> Result<(), String> {
    ps_safe(service.name())?;
    let startup = ps_service_startup_for_mode(prior_start_mode);
    ps_safe(startup)?;
    let mut cmd = format!("Set-Service -Name {} -StartupType {}", service.name(), startup);
    if prior_state == "Running" {
        cmd.push_str(&format!("; Start-Service -Name {}", service.name()));
    }
    run_elevated_powershell(&cmd)?;
    Ok(())
}

// ─── OS-debloat: telemetry scheduled-task disable (BUILT DARK) ────────────
//
// GATE — DARK (false) until this feature's own UAC QA + explicit owner sign-off (the owner greenlit
// adding the gated mutation 2026-06-22, LOCKED-rule-6; the ARMING + the curated KnownBloatTask list
// both ride that sign-off). Mirrors gaming_mode_gate / restore_gate / service_suspend.
pub(crate) fn bloat_removal_gate() -> bool {
    false
}

/// Read a scheduled task's current state (non-elevated): "Ready" | "Disabled" | "Running" | "Unknown".
/// Identifiers are FIXED enum constants, guarded by ps_safe_squoted and interpolated only inside '...'.
pub(crate) fn scheduled_task_state(task: &KnownBloatTask) -> String {
    let (path, name) = task.path_and_name();
    if ps_safe_squoted(path).is_err() || ps_safe_squoted(name).is_err() {
        return "Unknown".into();
    }
    match quiet_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("(Get-ScheduledTask -TaskPath '{}' -TaskName '{}').State", path, name),
        ])
        .output()
    {
        Ok(o) => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { "Unknown".into() } else { s }
        }
        Err(_) => "Unknown".into(),
    }
}

/// Disable a curated telemetry scheduled task (elevated). Snapshots prior state first so rollback
/// re-enables only what was enabled. Reads → ONE elevated command → return (batchable / exit-free).
pub(crate) fn apply_disable_scheduled_task(task: KnownBloatTask) -> Result<ApplyResult, String> {
    let (path, name) = task.path_and_name();
    ps_safe_squoted(path)?;
    ps_safe_squoted(name)?;
    let prior_state = scheduled_task_state(&task);
    run_elevated_powershell(&format!(
        "Disable-ScheduledTask -TaskPath '{}' -TaskName '{}' | Out-Null",
        path, name
    ))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableScheduledTask { task: task.clone() },
        rollback_action: RollbackAction::EnableScheduledTask { task },
        snapshot: Snapshot::ScheduledTask { prior_state },
        elevation_used: true,
    })
}

/// Re-enable a disabled telemetry task — only if it was enabled (Ready/Running) at snapshot time.
/// Fail-safe: a task that was already disabled stays disabled and issues NO elevated command.
pub(crate) fn rollback_enable_scheduled_task_typed(
    task: &KnownBloatTask,
    prior_state: &str,
) -> Result<(), String> {
    let (path, name) = task.path_and_name();
    ps_safe_squoted(path)?;
    ps_safe_squoted(name)?;
    // Rollback-first fidelity: re-enable UNLESS we KNOW it was Disabled. An "Unknown" prior (the
    // snapshot read failed) is treated as "was enabled" → restored to the stock/enabled state, the
    // conservative direction (matches apply_service_disable defaulting to the active state). Only a
    // confirmed-Disabled prior stays disabled — and that path issues no elevated command.
    if prior_state != "Disabled" {
        run_elevated_powershell(&format!(
            "Enable-ScheduledTask -TaskPath '{}' -TaskName '{}' | Out-Null",
            path, name
        ))?;
    }
    Ok(())
}

#[cfg(test)]
mod bloat_task_tests {
    use super::*;

    #[test]
    fn gate_is_dark() {
        assert!(!bloat_removal_gate(), "bloat-task removal must ship DARK");
    }

    #[test]
    fn from_id_enforces_allowlist_and_rejects_offlist() {
        assert!(KnownBloatTask::from_id("compatibility-appraiser").is_some());
        assert!(KnownBloatTask::from_id("ceip-usb").is_some());
        assert!(KnownBloatTask::from_id("defender-scan").is_none());
        assert!(KnownBloatTask::from_id("").is_none());
    }

    #[test]
    fn every_task_identifier_is_squote_safe() {
        for t in [
            KnownBloatTask::CompatibilityAppraiser,
            KnownBloatTask::CeipConsolidator,
            KnownBloatTask::CeipUsb,
        ] {
            let (p, n) = t.path_and_name();
            assert!(ps_safe_squoted(p).is_ok(), "path must be squote-safe: {p:?}");
            assert!(ps_safe_squoted(n).is_ok(), "name must be squote-safe: {n:?}");
        }
    }

    #[test]
    fn ps_safe_squoted_allows_task_chars_rejects_breakout() {
        assert!(ps_safe_squoted("Microsoft Compatibility Appraiser").is_ok());
        assert!(ps_safe_squoted("\\Microsoft\\Windows\\Application Experience\\").is_ok());
        for bad in [
            "a'b", "a$b", "a`b", "a;b", "a|b", "a&b", "a<b", "a>b", "a(b", "a)b", "a\"b", "a\nb", "a/b", "",
        ] {
            assert!(ps_safe_squoted(bad).is_err(), "must reject breakout token {bad:?}");
        }
    }

    #[test]
    fn contract_round_trips() {
        let a = AppliedAction::DisableScheduledTask { task: KnownBloatTask::CompatibilityAppraiser };
        let back: AppliedAction = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        assert!(matches!(back, AppliedAction::DisableScheduledTask { .. }));
        let r = RollbackAction::EnableScheduledTask { task: KnownBloatTask::CeipUsb };
        let back2: RollbackAction = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert!(matches!(back2, RollbackAction::EnableScheduledTask { .. }));
    }

    #[test]
    fn rollback_is_noop_when_prior_disabled() {
        assert!(rollback_enable_scheduled_task_typed(&KnownBloatTask::CeipUsb, "Disabled").is_ok());
    }

    // Live QA (manual; #[ignore], UAC-on rig) — proves exact disable→enable restore.
    #[test]
    #[ignore = "manual: real scheduled-task mutation on a UAC-on rig"]
    fn qa_disable_then_enable_restores_exact_state() {
        let t = KnownBloatTask::CompatibilityAppraiser;
        let prior = scheduled_task_state(&t);
        let result = apply_disable_scheduled_task(t.clone()).expect("disable applies");
        assert_eq!(scheduled_task_state(&t), "Disabled", "disable should stop the task");
        if let Snapshot::ScheduledTask { prior_state } = &result.snapshot {
            rollback_enable_scheduled_task_typed(&t, prior_state).expect("enable rolls back");
        }
        assert_eq!(scheduled_task_state(&t), prior, "rollback must restore the EXACT prior state");
    }
}

// ─── Power plan: Ultimate Performance ────────────────────────────────────

pub(crate) fn current_power_plan_guid() -> Option<String> {
    let output = quiet_command("powercfg").args(["/getactivescheme"]).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Format: "Power Scheme GUID: <36-char-guid>  (Plan Name)"
    for line in stdout.lines() {
        if let Some(idx) = line.find("GUID:") {
            let after = line[idx + 5..].trim_start();
            let guid = after.split_whitespace().next()?.trim();
            if guid.len() == 36 {
                return Some(guid.to_string());
            }
        }
    }
    None
}

pub(crate) fn apply_power_ultimate() -> Result<ApplyResult, String> {
    let prior_guid = current_power_plan_guid().unwrap_or_default();
    let ps = "$ult = powercfg /list | Select-String 'Ultimate Performance' | Select-Object -First 1; \
              if ($ult -match 'GUID: ([0-9a-f-]{36})') { powercfg /setactive $matches[1]; exit 0 } \
              $dup = powercfg /duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>&1; \
              if ($dup -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { powercfg /setactive $matches[1]; exit 0 } \
              exit 1";
    run_elevated_powershell(ps)?;
    Ok(ApplyResult {
        applied_action: AppliedAction::SetUltimatePerformancePlan,
        rollback_action: RollbackAction::RestorePowerPlanFromSnapshot,
        snapshot: Snapshot::PowerPlan { prior_guid },
        elevation_used: true,
    })
}

pub(crate) fn rollback_power_ultimate_typed(prior_guid: &str) -> Result<(), String> {
    if prior_guid.len() != 36 {
        return Err("no valid prior plan GUID in snapshot".into());
    }
    ps_safe(prior_guid)?; // GUID is hex+hyphens — reject anything that isn't
    run_elevated_powershell(&format!("powercfg /setactive {}", prior_guid))?;
    Ok(())
}

// ─── Reserved Storage off (PowerShell cmdlet, admin) ─────────────────────

pub(crate) fn apply_reserved_storage_off() -> Result<ApplyResult, String> {
    let prior_enabled = reserved_storage_enabled();
    run_elevated_powershell("Set-WindowsReservedStorageState -State Disabled")?;
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableReservedStorage,
        rollback_action: RollbackAction::RestoreReservedStorageFromSnapshot,
        snapshot: Snapshot::ReservedStorage { prior_enabled },
        elevation_used: true,
    })
}

pub(crate) fn rollback_reserved_storage_off_typed(prior_enabled: bool) -> Result<(), String> {
    let state = if prior_enabled { "Enabled" } else { "Disabled" };
    ps_safe(state)?;
    run_elevated_powershell(&format!("Set-WindowsReservedStorageState -State {}", state))?;
    Ok(())
}

// ─── Power-plan setting subgroups (USB Selective Suspend, PCIe ASPM) ─────
//
// Both follow the same powercfg /setacvalueindex shape: a subgroup GUID,
// a setting GUID, and a new value (0 = the "off" position for both
// USB Selective Suspend and PCIe Link State Power Management).
//
// Snapshot captures the prior AC AND DC values plus the active plan GUID
// so rollback is bit-exact and stays consistent even if the user later
// switches power plans. Per the cross-LLM review, we never mutate the
// DC (battery) value on apply — laptop battery behavior stays alone.

pub(crate) const PWR_SUBGROUP_USB: &str = "2a737441-1930-4402-8d77-b2bebba308a3";
pub(crate) const PWR_SETTING_USB_SELECTIVE_SUSPEND: &str = "48e6b7a6-50f5-4782-a5d4-53bb8f07e226";
pub(crate) const PWR_SUBGROUP_PCIE: &str = "501a4d13-42af-4429-9fd1-a8218c268e20";
pub(crate) const PWR_SETTING_PCIE_ASPM: &str = "ee12f906-d277-404b-b6da-e5fa1a576df5";

// Returns (ac_value, dc_value) by parsing `powercfg /query SCHEME_CURRENT
// <subgroup> <setting>`. Returns None if the call fails or output can't
// be parsed.
pub(crate) fn query_power_setting_ac_dc(subgroup: &str, setting: &str) -> Option<(u32, u32)> {
    let output = quiet_command("powercfg")
        .args(["/query", "SCHEME_CURRENT", subgroup, setting])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ac_value: Option<u32> = None;
    let mut dc_value: Option<u32> = None;
    for line in stdout.lines() {
        let lower = line.to_lowercase();
        if lower.contains("current ac power setting index:") {
            if let Some(tok) = line.split_whitespace().last() {
                let stripped = tok.trim_start_matches("0x");
                ac_value = u32::from_str_radix(stripped, 16).ok();
            }
        } else if lower.contains("current dc power setting index:") {
            if let Some(tok) = line.split_whitespace().last() {
                let stripped = tok.trim_start_matches("0x");
                dc_value = u32::from_str_radix(stripped, 16).ok();
            }
        }
    }
    Some((ac_value?, dc_value.unwrap_or(0)))
}

pub(crate) fn apply_power_setting_off_on_ac(subgroup: &str, setting: &str) -> Result<ApplyResult, String> {
    // Snapshot first — both AC and DC current values.
    let (prior_ac_value, prior_dc_value) =
        query_power_setting_ac_dc(subgroup, setting).unwrap_or((1, 1));
    // Capture the EXACT plan this is applied to. Refuse to apply if we can't —
    // a change whose target plan we don't know is a change we can't honestly
    // roll back, and rollback-first beats applying-anyway.
    let plan_guid = current_power_plan_guid().ok_or_else(|| {
        "could not determine the active power plan; refusing to apply a change that could not be rolled back".to_string()
    })?;

    // Apply AC = 0 only. DC stays untouched (laptop battery behavior preserved).
    ps_safe(subgroup)?;
    ps_safe(setting)?;
    let cmd = format!(
        "powercfg /setacvalueindex SCHEME_CURRENT {} {} 0; powercfg /setactive SCHEME_CURRENT",
        subgroup, setting
    );
    run_elevated_powershell(&cmd)?;

    let applied_action = if setting == PWR_SETTING_USB_SELECTIVE_SUSPEND {
        AppliedAction::DisableUsbSelectiveSuspendOnAc
    } else {
        AppliedAction::DisablePcieAspmOnAc
    };

    Ok(ApplyResult {
        applied_action,
        rollback_action: RollbackAction::RestorePowerPlanSettingFromSnapshot,
        snapshot: Snapshot::PowerPlanSetting {
            plan_guid,
            subgroup_guid: subgroup.to_string(),
            setting_guid: setting.to_string(),
            prior_ac_value,
            prior_dc_value,
        },
        elevation_used: true,
    })
}

pub(crate) fn apply_usb_selective_suspend_off() -> Result<ApplyResult, String> {
    apply_power_setting_off_on_ac(PWR_SUBGROUP_USB, PWR_SETTING_USB_SELECTIVE_SUSPEND)
}

pub(crate) fn apply_pcie_aspm_off() -> Result<ApplyResult, String> {
    apply_power_setting_off_on_ac(PWR_SUBGROUP_PCIE, PWR_SETTING_PCIE_ASPM)
}

// ─── Non-elevated power-plan switch/restore for Gaming Mode (session core) ─
//
// `powercfg /setactive <existing-guid>` does NOT require admin for an already-
// installed scheme — so the Gaming Mode CORE tier stays UAC-free. We NEVER
// create/duplicate a plan here (that needs elevation): if no high-perf plan
// exists, we skip with no error. Rollback-first: if we can't capture a valid
// prior plan GUID, we don't switch at all (a change we can't restore is a
// change we don't make).

/// PURE. Pick the best existing high-perf plan GUID from `powercfg /list`
/// stdout: Ultimate Performance > High performance > None.
pub(crate) fn select_best_existing_high_perf_plan(list_stdout: &str) -> Option<String> {
    let mut high: Option<String> = None;
    for line in list_stdout.lines() {
        let lower = line.to_lowercase();
        let guid = line.find("GUID:").and_then(|i| {
            line[i + 5..]
                .split_whitespace()
                .next()
                .map(|g| g.trim().to_string())
        });
        let Some(g) = guid.filter(|g| g.len() == 36) else {
            continue;
        };
        if lower.contains("ultimate performance") {
            return Some(g); // best — return immediately
        }
        if lower.contains("high performance") && high.is_none() {
            high = Some(g);
        }
    }
    high
}

fn list_power_plans_stdout() -> Option<String> {
    let out = quiet_command("powercfg").args(["/list"]).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// NON-ELEVATED `powercfg /setactive`. A non-zero exit (which is what happens
/// if the OS unexpectedly requires elevation) surfaces as Err — we never
/// silently elevate.
fn powercfg_setactive_unelevated(guid: &str) -> Result<(), String> {
    let out = quiet_command("powercfg")
        .args(["/setactive", guid])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "powercfg /setactive failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// CORE (UAC-free) power-plan switch. Switches to the best existing high-perf
/// plan, capturing the prior GUID for an exact restore. Returns Ok(None) — a
/// clean skip, no error — when there's no valid prior plan to restore to, no
/// existing high-perf plan to switch to, or we're already on it.
pub(crate) fn apply_power_plan_switch_core() -> Result<Option<ApplyResult>, String> {
    let prior_guid = current_power_plan_guid().unwrap_or_default();
    if prior_guid.trim().len() != 36 {
        return Ok(None); // can't capture a restorable prior plan -> don't switch
    }
    let list = list_power_plans_stdout().ok_or("powercfg /list failed")?;
    let Some(target) = select_best_existing_high_perf_plan(&list) else {
        return Ok(None); // no existing high-perf plan -> skip, stay UAC-free
    };
    if target.eq_ignore_ascii_case(prior_guid.trim()) {
        return Ok(None); // already active -> nothing to change or restore
    }
    powercfg_setactive_unelevated(&target)?;
    Ok(Some(ApplyResult {
        applied_action: AppliedAction::SetUltimatePerformancePlan,
        rollback_action: RollbackAction::RestorePowerPlanFromSnapshot,
        snapshot: Snapshot::PowerPlan { prior_guid },
        elevation_used: false,
    }))
}

/// NON-ELEVATED restore of the prior plan. Fails loudly if the plan vanished;
/// never silently elevates, never falls back to SCHEME_CURRENT.
pub(crate) fn restore_power_plan_unelevated(prior_guid: &str) -> Result<(), String> {
    let g = prior_guid.trim();
    if g.len() != 36 {
        return Err("no valid prior plan GUID in snapshot".into());
    }
    if !power_plan_exists(g) {
        return Err(format!("prior power plan {} no longer exists", g));
    }
    powercfg_setactive_unelevated(g)
}

#[cfg(test)]
mod gaming_power_tests {
    use super::select_best_existing_high_perf_plan;

    #[test]
    fn selects_ultimate_over_high_performance() {
        let list = "Existing Power Schemes (* Active)\n\
Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n\
Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)\n\
Power Scheme GUID: e9a42b02-d5df-448d-aa00-03f14749eb61  (Ultimate Performance)\n";
        assert_eq!(
            select_best_existing_high_perf_plan(list).as_deref(),
            Some("e9a42b02-d5df-448d-aa00-03f14749eb61")
        );
    }

    #[test]
    fn falls_back_to_high_performance() {
        let list = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n\
Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)\n";
        assert_eq!(
            select_best_existing_high_perf_plan(list).as_deref(),
            Some("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c")
        );
    }

    #[test]
    fn none_when_only_balanced() {
        let list = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n";
        assert_eq!(select_best_existing_high_perf_plan(list), None);
    }
}

/// True if `guid` is a currently-installed power scheme. Read-only `powercfg
/// /list`, no elevation — so we can fail safe before ever prompting for UAC.
fn power_plan_exists(guid: &str) -> bool {
    let g = guid.trim();
    if g.is_empty() {
        return false;
    }
    quiet_command("powercfg")
        .args(["/list"])
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains(&g.to_lowercase())
        })
        .unwrap_or(false)
}

/// Pure: build the powercfg restore command for one power-plan setting,
/// targeting the EXACT stored plan GUID (never SCHEME_CURRENT, which may be a
/// different plan at rollback time). `reactivate` re-commits the change live
/// only when that plan is the active one — restoring a non-active plan writes
/// its saved value without yanking the user onto it.
fn build_power_setting_restore_cmd(
    plan_guid: &str,
    subgroup_guid: &str,
    setting_guid: &str,
    prior_ac_value: u32,
    prior_dc_value: u32,
    reactivate: bool,
) -> String {
    let mut cmd = format!(
        "powercfg /setacvalueindex {0} {1} {2} {3}; \
         powercfg /setdcvalueindex {0} {1} {2} {4}",
        plan_guid, subgroup_guid, setting_guid, prior_ac_value, prior_dc_value
    );
    if reactivate {
        cmd.push_str(&format!("; powercfg /setactive {}", plan_guid));
    }
    cmd
}

pub(crate) fn rollback_power_plan_setting_typed(
    plan_guid: &str,
    subgroup_guid: &str,
    setting_guid: &str,
    prior_ac_value: u32,
    prior_dc_value: u32,
) -> Result<(), String> {
    // Restore AC/DC to the EXACT plan this was applied to. If that plan no
    // longer exists (deleted, or never captured), fail safe with a clear
    // message — we will NOT silently restore the value onto whatever plan
    // happens to be active now (e.g. after the user switched plans, or rolled
    // back Ultimate Performance first). Restoring to the wrong plan would make
    // the snapshot a quiet lie.
    if !power_plan_exists(plan_guid) {
        return Err(format!(
            "cannot roll this back: the power plan it was applied to ({}) no longer exists. \
             Compy will not restore the value to a different plan — reselect or recreate that \
             plan and try again.",
            if plan_guid.trim().is_empty() {
                "unknown".to_string()
            } else {
                plan_guid.to_string()
            }
        ));
    }
    // Only re-activate (commit live) if the restored plan is the active one.
    let reactivate = current_power_plan_guid()
        .map(|g| g.eq_ignore_ascii_case(plan_guid.trim()))
        .unwrap_or(false);
    let cmd = build_power_setting_restore_cmd(
        plan_guid,
        subgroup_guid,
        setting_guid,
        prior_ac_value,
        prior_dc_value,
        reactivate,
    );
    run_elevated_powershell(&cmd)?;
    Ok(())
}

// ─── Energy Efficient Ethernet off (active wired NIC, vendor naming) ─────
//
// EEE shows up under many vendor-driver display names: "Energy Efficient
// Ethernet" (standard), "Energy-Efficient Ethernet", "Green Ethernet"
// (Realtek), "Advanced EEE" (some Realtek), "EEE" (Intel/Killer), etc.
// We use a regex match on the property display name to handle this without
// hardcoding the per-vendor list.
//
// Eligibility filter (per cross-LLM review):
//   - Status -eq 'Up'                      (link is actually up)
//   - PhysicalMediaType -eq '802.3'        (wired Ethernet, not Wi-Fi)
//   - Property must actually exist          (Get-NetAdapterAdvancedProperty)
// Wi-Fi, Bluetooth, virtual adapters, and adapters where no EEE-shaped
// property exists are all excluded automatically.

/// One EEE-shaped advanced property on an Up wired adapter, with the driver's accepted values so
/// the apply can pick the REAL "disabled" token instead of assuming the literal "Disabled" (drivers
/// vary: "Off", "Disable", localized strings — the tester-found apply failure, 2026-06-10).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct EeeProperty {
    pub adapter_name: String,
    pub display_name: String,
    pub current_value: String,
    /// `ValidDisplayValues` from the driver; empty when the driver doesn't report them.
    pub valid_values: Vec<String>,
}

// Vendor-name coverage: display names AND registry keywords (the INF-standardized `*EEE` plus the
// common vendor keywords) — either match qualifies. Extend from real tester adapter inventories
// (Export → network adapter section), never by guessing.
const EEE_DISPLAY_NAME_PATTERN: &str =
    "Energy[- ]?Efficient[- ]?Ethernet|Green Ethernet|Advanced EEE|^EEE$|EEE PHY|802\\.3az";
const EEE_REGISTRY_KEYWORD_PATTERN: &str =
    "^\\*?EEE$|EEELink|GigaEEE|EnergyEfficientEthernet|AdvancedEEE";

/// How EEE resolves on this rig — drives honest gating (never offer an apply that can only fail).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum EeeResolution {
    /// No Up, wired adapter exposes an EEE-shaped property at all.
    NoEligibleAdapter,
    /// EEE-shaped properties exist, but none offers a value Compy recognizes as "disabled" —
    /// we will not guess at a driver's vocabulary.
    NoDisableSwitch,
    /// Properties Compy can safely flip (every entry has a pickable disabled value).
    Ready(Vec<EeeProperty>),
}

/// PURE: parse enumeration output lines `adapter|displayName|currentValue|valid~values~list`.
/// Malformed lines are skipped (defensive — PS output is process output, not a trusted file).
pub(crate) fn parse_eee_property_lines(stdout: &str) -> Vec<EeeProperty> {
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            if parts.len() != 4 {
                return None;
            }
            Some(EeeProperty {
                adapter_name: parts[0].trim().to_string(),
                display_name: parts[1].trim().to_string(),
                current_value: parts[2].trim().to_string(),
                valid_values: parts[3]
                    .split('~')
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
                    .collect(),
            })
        })
        .collect()
}

/// PURE: the driver's "disabled" token, by preference order, case-insensitive. None = the driver's
/// vocabulary has nothing Compy recognizes as off — honesty says gate, not guess.
pub(crate) fn pick_disabled_value(valid_values: &[String]) -> Option<String> {
    for pref in ["disabled", "disable", "off", "0"] {
        if let Some(v) = valid_values.iter().find(|v| v.trim().eq_ignore_ascii_case(pref)) {
            return Some(v.trim().to_string());
        }
    }
    None
}

/// PURE: the value the apply would write for this property. Empty valid-values (driver didn't
/// report them) falls back to the literal "Disabled" — the long-standing behavior for drivers
/// that don't enumerate; a NON-empty list without a recognized token returns None (we KNOW
/// "Disabled" isn't accepted — that write is the tester-found false-cancel failure).
pub(crate) fn eee_disable_value_for(p: &EeeProperty) -> Option<String> {
    if p.valid_values.is_empty() {
        return Some("Disabled".to_string());
    }
    pick_disabled_value(&p.valid_values)
}

/// PURE: is this property currently in its disabled state? Honest comparator — matches the
/// driver's own disabled token when known, plus the universal disabled-ish spellings; never
/// assumes the English "Disabled" is the only truth (the tester-found misread).
pub(crate) fn eee_value_is_disabled(p: &EeeProperty) -> bool {
    let cur = p.current_value.trim();
    if cur.to_lowercase().contains("disab") || cur.eq_ignore_ascii_case("off") || cur == "0" {
        return true;
    }
    eee_disable_value_for(p)
        .map(|v| cur.eq_ignore_ascii_case(&v))
        .unwrap_or(false)
}

/// PURE: classify a set of enumerated properties (split from the live probe for tests).
pub(crate) fn resolve_eee_from(props: Vec<EeeProperty>) -> EeeResolution {
    if props.is_empty() {
        return EeeResolution::NoEligibleAdapter;
    }
    let ready: Vec<EeeProperty> = props
        .into_iter()
        .filter(|p| eee_disable_value_for(p).is_some())
        .collect();
    if ready.is_empty() {
        EeeResolution::NoDisableSwitch
    } else {
        EeeResolution::Ready(ready)
    }
}

/// Live enumeration + classification. Eligibility filter unchanged from the cross-LLM review
/// (Status Up · PhysicalMediaType 802.3 · property exists); matching is broadened to display-name
/// OR registry-keyword, and the driver's ValidDisplayValues ride along for honest value picking.
pub(crate) fn resolve_eee() -> EeeResolution {
    let ps = format!(
        r#"
$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {{
    $_.Status -eq 'Up' -and $_.PhysicalMediaType -eq '802.3'
}}
foreach ($a in $adapters) {{
    $props = Get-NetAdapterAdvancedProperty -Name $a.Name -ErrorAction SilentlyContinue |
        Where-Object {{ $_.DisplayName -match '{names}' -or ($_.RegistryKeyword -and $_.RegistryKeyword -match '{keywords}') }}
    foreach ($p in $props) {{
        $valid = @($p.ValidDisplayValues) -join '~'
        Write-Output ($a.Name + '|' + $p.DisplayName + '|' + $p.DisplayValue + '|' + $valid)
    }}
}}
"#,
        names = EEE_DISPLAY_NAME_PATTERN,
        keywords = EEE_REGISTRY_KEYWORD_PATTERN,
    );
    let output = quiet_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .output();
    let stdout = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => return EeeResolution::NoEligibleAdapter,
    };
    resolve_eee_from(parse_eee_property_lines(&stdout))
}

/// PURE: build the apply script from (property, picked-disabled-value) pairs. The trailing
/// `$null = 0` makes the script's exit code deterministic-success: a per-pair SilentlyContinue
/// failure must never bleed into the host exit code and masquerade as an elevation problem (the
/// false-cancel chain) — detection recomputes the real state afterwards and stays honest. NEVER
/// `exit` here: eee-disable is safe-tier batchable and the §4 composition rule bans it.
pub(crate) fn build_eee_apply_script(targets: &[(EeeProperty, String)]) -> String {
    let mut ps = String::new();
    for (p, value) in targets {
        ps.push_str(&format!(
            "Set-NetAdapterAdvancedProperty -Name '{}' -DisplayName '{}' -DisplayValue '{}' -NoRestart -ErrorAction SilentlyContinue; ",
            p.adapter_name.replace('\'', "''"),
            p.display_name.replace('\'', "''"),
            value.replace('\'', "''"),
        ));
    }
    ps.push_str("$null = 0");
    ps
}

pub(crate) fn apply_eee_disable() -> Result<ApplyResult, String> {
    let props = match resolve_eee() {
        EeeResolution::NoEligibleAdapter => {
            return Err(
                "No active wired Ethernet adapter exposes an Energy-Efficient-Ethernet property — nothing to change on this rig."
                    .into(),
            )
        }
        EeeResolution::NoDisableSwitch => {
            return Err(
                "This adapter's driver exposes EEE, but not a 'Disabled'-style value Compy recognizes — left untouched rather than guessing at the driver's vocabulary."
                    .into(),
            )
        }
        EeeResolution::Ready(props) => props,
    };

    // Pair each property with ITS driver's disabled token (Ready guarantees one exists), and
    // snapshot prior state BEFORE the mutation — same 3-field snapshot shape as ever.
    let targets: Vec<(EeeProperty, String)> = props
        .into_iter()
        .filter_map(|p| eee_disable_value_for(&p).map(|v| (p, v)))
        .collect();
    let adapters: Vec<EeeNicSnapshot> = targets
        .iter()
        .map(|(p, _)| EeeNicSnapshot {
            adapter_name: p.adapter_name.clone(),
            property_display_name: p.display_name.clone(),
            prior_value: p.current_value.clone(),
        })
        .collect();

    let ps = build_eee_apply_script(&targets);
    run_elevated_powershell(&ps)
        .map_err(|e| format!("Couldn't change Energy Efficient Ethernet — {}", e))?;

    Ok(ApplyResult {
        applied_action: AppliedAction::DisableEnergyEfficientEthernet,
        rollback_action: RollbackAction::RestoreEnergyEfficientEthernetFromSnapshot,
        snapshot: Snapshot::EeeNicProperty { adapters },
        elevation_used: true,
    })
}

pub(crate) fn rollback_eee_disable_typed(adapters: &[EeeNicSnapshot]) -> Result<(), String> {
    if adapters.is_empty() {
        return Err("snapshot had no EEE adapters to roll back".into());
    }
    let mut ps = String::new();
    for a in adapters {
        ps.push_str(&format!(
            "Set-NetAdapterAdvancedProperty -Name '{}' -DisplayName '{}' -DisplayValue '{}' -NoRestart -ErrorAction SilentlyContinue; ",
            a.adapter_name.replace('\'', "''"),
            a.property_display_name.replace('\'', "''"),
            a.prior_value.replace('\'', "''"),
        ));
    }
    // Same deterministic-exit-0 tail as the apply: a silently-skipped pair must never read as an
    // elevation failure (restored values come from the snapshot = the driver's own prior strings).
    ps.push_str("$null = 0");
    run_elevated_powershell(&ps)
        .map_err(|e| format!("Couldn't restore Energy Efficient Ethernet — {}", e))?;
    Ok(())
}


// ─── Fast Startup off (HKLM, admin) ──────────────────────────────────────

pub(crate) fn apply_fast_startup_off() -> Result<ApplyResult, String> {
    let prior_hiberboot = fast_startup_state();
    run_elevated_powershell(
        "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -Value 0 -Type DWord",
    )?;
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableFastStartup,
        rollback_action: RollbackAction::RestoreFastStartupFromSnapshot,
        snapshot: Snapshot::FastStartup { prior_hiberboot },
        elevation_used: true,
    })
}

pub(crate) fn rollback_fast_startup_off_typed(prior_hiberboot: Option<u32>) -> Result<(), String> {
    let cmd = match prior_hiberboot {
        Some(v) => format!(
            "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -Value {} -Type DWord",
            v
        ),
        None => "Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -ErrorAction SilentlyContinue".to_string(),
    };
    run_elevated_powershell(&cmd)?;
    Ok(())
}

// ─── Game Bar / Game DVR off (HKCU, no admin) ────────────────────────────

pub(crate) fn apply_game_bar_disable() -> Result<ApplyResult, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (gd, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR")
        .map_err(|e| e.to_string())?;
    let prior_capture: Option<u32> = gd.get_value("AppCaptureEnabled").ok();
    gd.set_value("AppCaptureEnabled", &0u32)
        .map_err(|e| e.to_string())?;

    let (gcs, _) = hkcu
        .create_subkey("System\\GameConfigStore")
        .map_err(|e| e.to_string())?;
    let prior_enabled: Option<u32> = gcs.get_value("GameDVR_Enabled").ok();
    gcs.set_value("GameDVR_Enabled", &0u32)
        .map_err(|e| e.to_string())?;

    Ok(ApplyResult {
        applied_action: AppliedAction::DisableGameBarAndDvr,
        rollback_action: RollbackAction::RestoreGameBarFromSnapshot,
        snapshot: Snapshot::GameBar {
            prior_capture,
            prior_enabled,
        },
        elevation_used: false,
    })
}

pub(crate) fn rollback_game_bar_disable_typed(
    prior_capture: Option<u32>,
    prior_enabled: Option<u32>,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let gd = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR",
            KEY_SET_VALUE | KEY_READ,
        )
        .map_err(|e| e.to_string())?;
    match prior_capture {
        Some(v) => gd
            .set_value("AppCaptureEnabled", &v)
            .map_err(|e| e.to_string())?,
        None => {
            let _ = gd.delete_value("AppCaptureEnabled");
        }
    }

    let gcs = hkcu
        .open_subkey_with_flags("System\\GameConfigStore", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    match prior_enabled {
        Some(v) => gcs
            .set_value("GameDVR_Enabled", &v)
            .map_err(|e| e.to_string())?,
        None => {
            let _ = gcs.delete_value("GameDVR_Enabled");
        }
    }
    Ok(())
}

// ─── HAGS (HKLM, admin) ──────────────────────────────────────────────────

pub(crate) fn apply_hags_enable() -> Result<ApplyResult, String> {
    let prior = hags_state();
    run_elevated_powershell(
        "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Value 2 -Type DWord",
    )?;
    Ok(ApplyResult {
        applied_action: AppliedAction::EnableHardwareGpuScheduling,
        rollback_action: RollbackAction::RestoreHwSchModeFromSnapshot,
        snapshot: Snapshot::HwSchMode { prior },
        elevation_used: true,
    })
}

pub(crate) fn rollback_hags_enable_typed(prior: Option<u32>) -> Result<(), String> {
    let cmd = match prior {
        Some(v) => format!(
            "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Value {} -Type DWord",
            v
        ),
        None => "Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -ErrorAction SilentlyContinue".to_string(),
    };
    run_elevated_powershell(&cmd)?;
    Ok(())
}

// ─── Leftovers v2 restore resolvers (R2-5 — BUILT DARK) ──────────────────
//
// DARK on two independent layers: leftovers::restore_gate() returns false AND no Tauri command
// exposes these (zero webview reachability). They ride the same audited contract as every apply:
// snapshot BEFORE mutation, ONE elevated PS per restore (no partial mutation), fail-loud rollback,
// and the snapshot holds the user's rotted value so the restore itself is reversible.
// Script builders are PURE so their content is unit-testable without elevation. All interpolated
// values are u32 integers, plus ONE sanctioned non-integer: the app-derived, single-quote-escaped
// result-file path in the memcompress combined script (the §4 batch-receipts precedent — data out,
// never input in).
//
// Deliberately ABSENT: a Defender-policy resolver. Writing HKLM\...\Policies is the absolute
// security-settings rail — even a restore-to-stock goes through the owner, never autonomous code.

fn mmcss_path() -> &'static str {
    "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile"
}
fn priority_control_path() -> &'static str {
    "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl"
}

fn set_or_remove_dword(path: &str, name: &str, value: Option<u32>) -> String {
    match value {
        Some(v) => format!("Set-ItemProperty -Path '{path}' -Name '{name}' -Value {v} -Type DWord"),
        None => format!(
            "Remove-ItemProperty -Path '{path}' -Name '{name}' -ErrorAction SilentlyContinue"
        ),
    }
}

pub(crate) fn mmcss_restore_script() -> String {
    // Windows stock: SystemResponsiveness 20 · NetworkThrottlingIndex 10.
    format!(
        "{}; {}",
        set_or_remove_dword(mmcss_path(), "SystemResponsiveness", Some(20)),
        set_or_remove_dword(mmcss_path(), "NetworkThrottlingIndex", Some(10)),
    )
}
pub(crate) fn mmcss_rollback_script(sr: Option<u32>, nti: Option<u32>) -> String {
    format!(
        "{}; {}",
        set_or_remove_dword(mmcss_path(), "SystemResponsiveness", sr),
        set_or_remove_dword(mmcss_path(), "NetworkThrottlingIndex", nti),
    )
}
pub(crate) fn priority_separation_restore_script() -> String {
    set_or_remove_dword(priority_control_path(), "Win32PrioritySeparation", Some(2))
}
pub(crate) fn priority_separation_rollback_script(prior: Option<u32>) -> String {
    set_or_remove_dword(priority_control_path(), "Win32PrioritySeparation", prior)
}

/// Read both MMCSS priors directly (HKLM reads need no elevation). Err = the KEY itself was
/// unreadable — the apply refuses rather than mutating what it couldn't snapshot. An absent
/// value is a legitimate prior (rollback deletes it).
fn read_mmcss_priors() -> Result<(Option<u32>, Option<u32>), String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile";
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((None, None)),
        Err(e) => Err(format!("cannot snapshot MMCSS values: {e}")),
        Ok(k) => Ok((
            k.get_value::<u32, _>("SystemResponsiveness").ok(),
            k.get_value::<u32, _>("NetworkThrottlingIndex").ok(),
        )),
    }
}

fn read_priority_separation_prior() -> Result<Option<u32>, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SYSTEM\CurrentControlSet\Control\PriorityControl") {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot snapshot Win32PrioritySeparation: {e}")),
        Ok(k) => Ok(k.get_value::<u32, _>("Win32PrioritySeparation").ok()),
    }
}

/// Restore memory compression to the Windows default (ON). Takes the prior explicitly so the
/// refusal contract is unit-testable: an UNREADABLE prior refuses BEFORE any elevation — never
/// mutate what couldn't be snapshotted (rollback-first integrity).
pub(crate) fn restore_memory_compression_with(prior: Option<bool>) -> Result<ApplyResult, String> {
    let Some(prior_enabled) = prior else {
        return Err(
            "Memory compression state could not be read — refusing to restore what can't be snapshotted."
                .to_string(),
        );
    };
    run_elevated_powershell("Enable-MMAgent -MemoryCompression")?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreMemoryCompressionDefault,
        rollback_action: RollbackAction::RestoreMemoryCompressionFromSnapshot,
        snapshot: Snapshot::MemoryCompression { prior_enabled: Some(prior_enabled) },
        elevation_used: true,
    })
}

/// Combined elevated script for the admin-only-prior case (Get-MMAgent needs admin, ca01347):
/// capture the prior INSIDE the one elevated context — `$ErrorActionPreference='Stop'` makes the
/// order binding (prior is written to the result file BEFORE Enable-MMAgent can run; any earlier
/// failure aborts before the mutation). The result path is app-derived + single-quote-escaped
/// (the §4 compose_batch_script precedent); the file is DATA out, never input in. Exit-free.
pub(crate) fn memcompress_combined_restore_script(result_path: &str) -> String {
    format!(
        "$ErrorActionPreference='Stop'; $rf='{}'; $p=(Get-MMAgent).MemoryCompression; Add-Content -LiteralPath $rf -Value \"prior:$p\"; Enable-MMAgent -MemoryCompression; Add-Content -LiteralPath $rf -Value 'done:ok'",
        result_path.replace('\'', "''")
    )
}

/// Fail-safe parse of the combined script's result file: a snapshot is accepted ONLY when the
/// prior parsed AND the mutation confirmed (`done:ok`) — the §4 "only an explicit ok earns a
/// ledger entry" direction. Anything else refuses with an honest, state-naming message.
pub(crate) fn parse_memcompress_restore_result(text: &str) -> Result<bool, String> {
    let mut prior: Option<bool> = None;
    let mut done = false;
    for line in text.lines() {
        match line.trim() {
            "prior:True" => prior = Some(true),
            "prior:False" => prior = Some(false),
            "done:ok" => done = true,
            _ => {}
        }
    }
    match (prior, done) {
        (Some(p), true) => Ok(p),
        (Some(_), false) => Err(
            "The elevated step captured the prior state but did not confirm the change — nothing was recorded. Re-run the check to see the current state."
                .to_string(),
        ),
        (None, _) => Err(
            "The elevated step did not report the prior state — nothing was recorded (a change is never recorded without its undo). Re-run the check to see the current state."
                .to_string(),
        ),
    }
}

/// The admin-only-prior arm: ONE elevated invocation that snapshots then mutates (see the script
/// builder above). Receipt-worthy only on a confirmed prior + confirmed mutation.
fn restore_memory_compression_elevated_read() -> Result<ApplyResult, String> {
    let dir = crate::compy_data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("memcompress-restore-{millis}.result"));
    let _ = std::fs::remove_file(&path);
    let run = run_elevated_powershell(&memcompress_combined_restore_script(&path.to_string_lossy()));
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let _ = std::fs::remove_file(&path);
    // A decline or elevated failure propagates first (EAP=Stop means nothing mutated without the
    // prior already banked); then the fail-safe parse decides whether a snapshot was earned.
    run?;
    let prior = parse_memcompress_restore_result(&text)?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreMemoryCompressionDefault,
        rollback_action: RollbackAction::RestoreMemoryCompressionFromSnapshot,
        snapshot: Snapshot::MemoryCompression { prior_enabled: Some(prior) },
        elevation_used: true,
    })
}

pub(crate) fn restore_memory_compression() -> Result<ApplyResult, String> {
    // Readable prior (elevated context / future probe): the plain snapshot-then-mutate path.
    // Unreadable (Get-MMAgent is admin-only for a normal user — the field case, ca01347): the
    // prior is taken INSIDE the one elevated context instead of refusing outright.
    match crate::leftovers::read_memory_compression() {
        Some(prior) => restore_memory_compression_with(Some(prior)),
        None => restore_memory_compression_elevated_read(),
    }
}

pub(crate) fn rollback_memory_compression_typed(prior_enabled: Option<bool>) -> Result<(), String> {
    match prior_enabled {
        Some(true) => run_elevated_powershell("Enable-MMAgent -MemoryCompression"),
        Some(false) => run_elevated_powershell("Disable-MMAgent -MemoryCompression"),
        // Unreachable for entries this code writes (the apply refuses a None prior) — but a
        // hand-edited/corrupt entry must fail LOUD, never guess a security-of-state direction.
        None => Err("This entry has no recorded prior state — cannot roll back blind.".to_string()),
    }
}

pub(crate) fn restore_mmcss_defaults() -> Result<ApplyResult, String> {
    let (sr, nti) = read_mmcss_priors()?; // refuses on an unreadable key
    run_elevated_powershell(&mmcss_restore_script())?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreMmcssDefaults,
        rollback_action: RollbackAction::RestoreMmcssFromSnapshot,
        snapshot: Snapshot::Mmcss {
            prior_system_responsiveness: sr,
            prior_network_throttling: nti,
        },
        elevation_used: true,
    })
}

pub(crate) fn rollback_mmcss_typed(sr: Option<u32>, nti: Option<u32>) -> Result<(), String> {
    run_elevated_powershell(&mmcss_rollback_script(sr, nti))
}

pub(crate) fn restore_priority_separation() -> Result<ApplyResult, String> {
    let prior = read_priority_separation_prior()?; // refuses on an unreadable key
    run_elevated_powershell(&priority_separation_restore_script())?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestorePrioritySeparationDefault,
        rollback_action: RollbackAction::RestorePrioritySeparationFromSnapshot,
        snapshot: Snapshot::PrioritySeparation { prior_value: prior },
        elevation_used: true,
    })
}

pub(crate) fn rollback_priority_separation_typed(prior: Option<u32>) -> Result<(), String> {
    run_elevated_powershell(&priority_separation_rollback_script(prior))
}

// ─── Leftovers v2 dark wave 2 (2026-06-11) — MPO / core-parking / TCP autotuning ─────────
// Same dark contract as R2-5: gated off + no IPC, snapshot-before-mutate, ONE elevated PS per
// restore, fail-loud rollback, pure script builders. Every interpolated value is a u32 (or a
// fixed literal command); no external string ever enters an elevated command (the integer-only
// hard line — which is why pagefile, whose rollback needs the user's REG_MULTI_SZ path string,
// is NOT here; see the Review Queue).

const DWM_PATH: &str = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm";
// Power-plan SUBGROUP + SETTING GUIDs for processor core-parking minimum. FIXED CONSTANTS (mine,
// like every registry-path literal here) — never external data.
pub(crate) const SUB_PROCESSOR_GUID: &str = "54533251-82be-4824-96c1-47b60b740d00";
pub(crate) const CPMINCORES_GUID: &str = "0cc5b647-c1df-4637-891a-dec35c318583";

// Read priors directly (registry/powercfg/netsh reads need no elevation). Err = the SOURCE was
// unreadable → the restore refuses BEFORE elevation (never mutate what couldn't be snapshotted).

fn read_mpo_prior() -> Result<Option<u32>, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Microsoft\Windows\Dwm") {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot snapshot OverlayTestMode: {e}")),
        Ok(k) => Ok(k.get_value::<u32, _>("OverlayTestMode").ok()),
    }
}

/// Parse `powercfg /q SCHEME_CURRENT SUB_PROCESSOR CPMINCORES` for the AC + DC index values.
/// Locale-tolerant: keys off the hex "0x.." token on the AC/DC index lines, not localized words.
fn read_core_parking_priors() -> Result<(Option<u32>, Option<u32>), String> {
    let out = quiet_command("powercfg")
        .args(["/q", "SCHEME_CURRENT", "SUB_PROCESSOR", "CPMINCORES"])
        .output()
        .map_err(|e| format!("cannot read core parking: {e}"))?;
    if !out.status.success() {
        return Err("powercfg core-parking query failed".to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let hex_on = |needle: &str| -> Option<u32> {
        text.lines()
            .find(|l| l.contains(needle))
            .and_then(|l| l.rsplit("0x").next())
            .and_then(|h| u32::from_str_radix(h.trim(), 16).ok())
    };
    // At least the AC index must parse, or we don't have a snapshot to reverse against.
    let ac = hex_on("AC Power Setting Index");
    let dc = hex_on("DC Power Setting Index");
    if ac.is_none() {
        return Err("could not parse the core-parking AC index — refusing to restore blind".to_string());
    }
    Ok((ac, dc))
}

fn read_tcp_autotuning_disabled() -> Result<bool, String> {
    let out = quiet_command("netsh")
        .args(["int", "tcp", "show", "global"])
        .output()
        .map_err(|e| format!("cannot read TCP global: {e}"))?;
    if !out.status.success() {
        return Err("netsh TCP query failed".to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
    match text.lines().find(|l| l.contains("auto-tuning") || l.contains("autotuning")) {
        Some(l) if l.contains("disabled") => Ok(true),
        Some(l) if l.contains("normal") || l.contains("experimental") || l.contains("restricted") => {
            Ok(false)
        }
        // Non-English output or unexpected shape: refuse rather than guess a state to reverse to.
        _ => Err("could not read the TCP auto-tuning level — refusing to restore blind".to_string()),
    }
}

// Pure script builders (unit-tested without elevation; integers only).
pub(crate) fn mpo_rollback_script(prior: Option<u32>) -> String {
    set_or_remove_dword(DWM_PATH, "OverlayTestMode", prior)
}
pub(crate) fn core_parking_script(ac_pct: u32, dc_pct: u32) -> String {
    // ONE elevated PS invocation runs all three statements. SCHEME_CURRENT (not an explicit GUID)
    // is the standard powercfg idiom for a SETTING-index write — the 070c3c9 stored-GUID contract
    // concerns whole-plan SWITCHING (force-activating a plan), not a per-setting index on the
    // already-active plan, so there's no plan-switch to drift here.
    format!(
        "powercfg -setacvalueindex SCHEME_CURRENT {SUB_PROCESSOR_GUID} {CPMINCORES_GUID} {ac_pct}; \
         powercfg -setdcvalueindex SCHEME_CURRENT {SUB_PROCESSOR_GUID} {CPMINCORES_GUID} {dc_pct}; \
         powercfg -setactive SCHEME_CURRENT"
    )
}
pub(crate) fn tcp_autotuning_script(disabled: bool) -> &'static str {
    if disabled {
        "netsh int tcp set global autotuninglevel=disabled"
    } else {
        "netsh int tcp set global autotuninglevel=normal"
    }
}

// ── MPO: restore default-on by removing OverlayTestMode ──
pub(crate) fn restore_mpo_default() -> Result<ApplyResult, String> {
    let prior = read_mpo_prior()?;
    run_elevated_powershell(&set_or_remove_dword(DWM_PATH, "OverlayTestMode", None))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreMpoDefault,
        rollback_action: RollbackAction::RestoreMpoFromSnapshot,
        snapshot: Snapshot::Mpo { prior_overlay_test_mode: prior },
        elevation_used: true,
    })
}
pub(crate) fn rollback_mpo_typed(prior: Option<u32>) -> Result<(), String> {
    run_elevated_powershell(&mpo_rollback_script(prior))
}

// ── Core parking: re-allow parking (min unparked → 0% AC+DC) so the override is lifted ──
pub(crate) fn restore_core_parking_default() -> Result<ApplyResult, String> {
    let (ac, dc) = read_core_parking_priors()?;
    run_elevated_powershell(&core_parking_script(0, 0))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreCoreParkingDefault,
        rollback_action: RollbackAction::RestoreCoreParkingFromSnapshot,
        snapshot: Snapshot::CoreParking { prior_ac_pct: ac, prior_dc_pct: dc },
        elevation_used: true,
    })
}
pub(crate) fn rollback_core_parking_typed(ac: Option<u32>, dc: Option<u32>) -> Result<(), String> {
    match (ac, dc) {
        // DC may legitimately be absent on a desktop with no battery profile — restore AC, mirror to DC.
        (Some(a), dc) => run_elevated_powershell(&core_parking_script(a, dc.unwrap_or(a))),
        (None, _) => {
            Err("This entry has no recorded prior core-parking value — cannot roll back blind.".to_string())
        }
    }
}

// ── Pagefile (the origin-story resolver — option (a), Cowork call 2026-06-11) ──
// Restore-forward = ONE fixed command re-enabling Windows-managed paging. Rollback must put the
// user's exact rotted PagingFiles entry back, and that value is a PATH STRING — so option (a)
// restricts the resolver to the validated common case: exactly one entry shaped
// `<Letter>:\pagefile.sys <init> <max>`. Anything else (multi-pagefile, ?:-form, disabled, odd
// paths) is REFUSED honestly at apply time — "unusual layout — left as-is" — and no snapshot is
// taken, so rollback can ALWAYS rebuild the entry from one validated ASCII letter + two u32s:
// provably metacharacter-free. REBOOT REQUIRED to take effect (both directions) — the detector's
// restore_note says so up front; no script here ever touches Restart-Computer (test-pinned).

pub(crate) const PAGEFILE_RESTORE_SCRIPT: &str = "$cs = Get-CimInstance Win32_ComputerSystem; $cs | Set-CimInstance -Property @{AutomaticManagedPagefile=$true}";
const MEMORY_MGMT_PATH: &str =
    "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management";

/// Pure, validation-gated parse of the PagingFiles REG_MULTI_SZ. Ok ONLY for the single
/// fixed-size entry option (a) covers; every other layout refuses with the honest message.
pub(crate) fn parse_manual_pagefile_entry(entries: &[String]) -> Result<(char, u32, u32), String> {
    const REFUSE: &str =
        "This PC's pagefile layout is unusual — left as-is (no automatic restore is offered for it).";
    if entries.len() != 1 {
        return Err(REFUSE.to_string()); // zero (disabled) or multi-pagefile setups
    }
    let mut parts = entries[0].split_whitespace();
    let (Some(path), Some(init), Some(max), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(REFUSE.to_string());
    };
    let mut chars = path.chars();
    let letter = match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => c.to_ascii_uppercase(),
        _ => return Err(REFUSE.to_string()),
    };
    if !chars.as_str().eq_ignore_ascii_case(":\\pagefile.sys") {
        return Err(REFUSE.to_string());
    }
    let (Ok(init_mb), Ok(max_mb)) = (init.parse::<u32>(), max.parse::<u32>()) else {
        return Err(REFUSE.to_string());
    };
    if init_mb == 0 || max_mb == 0 {
        return Err(REFUSE.to_string()); // "0 0" = system-managed-size form, not the fixed rot
    }
    Ok((letter, init_mb, max_mb))
}

/// Pure rollback-script builder. Inputs were validated at apply time; re-validated here anyway so
/// a hand-edited ledger entry fails LOUD instead of building a command from garbage.
pub(crate) fn pagefile_rollback_script(letter: char, init_mb: u32, max_mb: u32) -> Result<String, String> {
    if !letter.is_ascii_alphabetic() || init_mb == 0 || max_mb == 0 {
        return Err(
            "This entry's recorded pagefile layout is invalid — cannot roll back blind.".to_string(),
        );
    }
    let letter = letter.to_ascii_uppercase();
    // Every character is from the validated set: one ASCII letter, the fixed literal path, digits.
    let entry = format!("{letter}:\\pagefile.sys {init_mb} {max_mb}");
    Ok(format!(
        "$cs = Get-CimInstance Win32_ComputerSystem; $cs | Set-CimInstance -Property @{{AutomaticManagedPagefile=$false}}; \
         Set-ItemProperty -Path '{MEMORY_MGMT_PATH}' -Name 'PagingFiles' -Value @('{entry}') -Type MultiString"
    ))
}

fn read_pagingfiles() -> Result<Vec<String>, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    match RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management")
    {
        Err(e) => Err(format!("cannot snapshot the pagefile configuration: {e}")),
        Ok(k) => match k.get_value::<Vec<String>, _>("PagingFiles") {
            Ok(v) => Ok(v),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()), // → parse refuses
            Err(e) => Err(format!("cannot snapshot the pagefile configuration: {e}")),
        },
    }
}

/// Takes the entries explicitly so the refusal contract is unit-testable: exotic layouts and
/// unreadable state refuse BEFORE any elevation (never mutate what can't be exactly reversed).
pub(crate) fn restore_pagefile_automatic_with(entries: Vec<String>) -> Result<ApplyResult, String> {
    let (letter, init_mb, max_mb) = parse_manual_pagefile_entry(&entries)?;
    run_elevated_powershell(PAGEFILE_RESTORE_SCRIPT)?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestorePagefileAutomatic,
        rollback_action: RollbackAction::RestorePagefileFromSnapshot,
        snapshot: Snapshot::PagefileManual {
            prior_drive_letter: letter,
            prior_initial_mb: init_mb,
            prior_maximum_mb: max_mb,
        },
        elevation_used: true,
    })
}

pub(crate) fn restore_pagefile_automatic() -> Result<ApplyResult, String> {
    restore_pagefile_automatic_with(read_pagingfiles()?)
}

pub(crate) fn rollback_pagefile_typed(letter: char, init_mb: u32, max_mb: u32) -> Result<(), String> {
    run_elevated_powershell(&pagefile_rollback_script(letter, init_mb, max_mb)?)
}

// ── TCP receive-window auto-tuning: restore "normal" ──
pub(crate) fn restore_tcp_autotuning_default() -> Result<ApplyResult, String> {
    let prior_disabled = read_tcp_autotuning_disabled()?;
    run_elevated_powershell(tcp_autotuning_script(false))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreTcpAutotuningDefault,
        rollback_action: RollbackAction::RestoreTcpAutotuningFromSnapshot,
        snapshot: Snapshot::TcpAutotuning { prior_disabled },
        elevation_used: true,
    })
}
pub(crate) fn rollback_tcp_autotuning_typed(prior_disabled: bool) -> Result<(), String> {
    run_elevated_powershell(tcp_autotuning_script(prior_disabled))
}

// ─── Mouse acceleration off (HKCU, no admin) ─────────────────────────────

pub(crate) fn apply_mouse_accel_off() -> Result<ApplyResult, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Control Panel\\Mouse")
        .map_err(|e| e.to_string())?;

    // All three values are REG_SZ strings, not DWORDs. Windows is weird.
    let prior_speed: String = key.get_value("MouseSpeed").unwrap_or_default();
    let prior_threshold1: String = key.get_value("MouseThreshold1").unwrap_or_default();
    let prior_threshold2: String = key.get_value("MouseThreshold2").unwrap_or_default();

    let zero = "0".to_string();
    key.set_value("MouseSpeed", &zero).map_err(|e| e.to_string())?;
    key.set_value("MouseThreshold1", &zero).map_err(|e| e.to_string())?;
    key.set_value("MouseThreshold2", &zero).map_err(|e| e.to_string())?;

    Ok(ApplyResult {
        applied_action: AppliedAction::DisableMouseAcceleration,
        rollback_action: RollbackAction::RestoreMouseAccelFromSnapshot,
        snapshot: Snapshot::MouseAccel {
            prior_speed,
            prior_threshold1,
            prior_threshold2,
        },
        elevation_used: false,
    })
}

pub(crate) fn rollback_mouse_accel_off_typed(
    prior_speed: &str,
    prior_threshold1: &str,
    prior_threshold2: &str,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags("Control Panel\\Mouse", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;

    let restore = |reg_name: &str, prior: &str| -> Result<(), String> {
        if prior.is_empty() {
            let _ = key.delete_value(reg_name);
            Ok(())
        } else {
            key.set_value(reg_name, &prior.to_string())
                .map_err(|e| e.to_string())
        }
    };

    restore("MouseSpeed", prior_speed)?;
    restore("MouseThreshold1", prior_threshold1)?;
    restore("MouseThreshold2", prior_threshold2)?;
    Ok(())
}

// ─── Nagle disable across active NICs ────────────────────────────────────

// Pure target selector (testable): of the with-IP Tcpip interfaces, target the PHYSICAL ones only —
// but if we can't identify any physical among them (WMI unavailable / GUID mismatch), fall back to ALL
// with-IP so the rec is never silently inert. Detection/eligibility train (addendum): per-interface
// network tweaks target the active physical interface, never VPN/Hyper-V/virtual adapters.
pub(crate) fn select_nagle_targets(with_ip_guids: &[String], physical_guids_upper: &[String]) -> Vec<String> {
    let phys: Vec<String> = with_ip_guids
        .iter()
        .filter(|g| physical_guids_upper.contains(&g.to_uppercase()))
        .cloned()
        .collect();
    if phys.is_empty() {
        with_ip_guids.to_vec()
    } else {
        phys
    }
}

pub(crate) fn apply_nagle_disable() -> Result<ApplyResult, String> {
    // Snapshot (no admin): capture prior values on every Tcpip interface that has an IP...
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let interfaces = hklm
        .open_subkey("SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces")
        .map_err(|e| e.to_string())?;
    let mut with_ip: Vec<NagleInterfaceSnapshot> = Vec::new();
    for adapter_name in interfaces.enum_keys().filter_map(|r| r.ok()) {
        let Ok(adapter) = interfaces.open_subkey(&adapter_name) else {
            continue;
        };
        let has_ip = adapter.get_value::<String, _>("DhcpIPAddress").is_ok()
            || adapter.get_value::<String, _>("IPAddress").is_ok();
        if !has_ip {
            continue;
        }
        with_ip.push(NagleInterfaceSnapshot {
            interface: adapter_name,
            prior_ack: adapter.get_value("TcpAckFrequency").ok(),
            prior_nodelay: adapter.get_value("TCPNoDelay").ok(),
        });
    }

    // ...then narrow to the PHYSICAL interfaces (Wi-Fi or wired), excluding VPN/virtual adapters.
    let with_ip_guids: Vec<String> = with_ip.iter().map(|s| s.interface.clone()).collect();
    let physical = crate::hardware::physical_nic_guids(); // UPPER, braced; empty → fall back to all
    let targets: std::collections::HashSet<String> = select_nagle_targets(&with_ip_guids, &physical)
        .into_iter()
        .map(|g| g.to_uppercase())
        .collect();
    // The snapshot now covers EXACTLY what we write, so rollback is exact.
    let nic_snapshots: Vec<NagleInterfaceSnapshot> = with_ip
        .into_iter()
        .filter(|s| targets.contains(&s.interface.to_uppercase()))
        .collect();

    // Write to exactly those interfaces, by explicit path (mirrors the rollback script).
    let mut ps = String::new();
    for s in &nic_snapshots {
        let path = format!(
            "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{}",
            s.interface
        );
        ps.push_str(&format!("Set-ItemProperty -Path '{path}' -Name 'TcpAckFrequency' -Value 1 -Type DWord; "));
        ps.push_str(&format!("Set-ItemProperty -Path '{path}' -Name 'TCPNoDelay' -Value 1 -Type DWord; "));
    }
    if !ps.is_empty() {
        run_elevated_powershell(&ps)?;
    }
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableNagleOnActiveNics,
        rollback_action: RollbackAction::RestoreNagleNicsFromSnapshot,
        snapshot: Snapshot::NagleNics {
            interfaces: nic_snapshots,
        },
        elevation_used: true,
    })
}

pub(crate) fn rollback_nagle_disable_typed(
    interfaces: &[NagleInterfaceSnapshot],
) -> Result<(), String> {
    if interfaces.is_empty() {
        return Err("no interfaces recorded in snapshot".into());
    }
    let mut ps = String::new();
    for entry in interfaces {
        if entry.interface.is_empty() {
            continue;
        }
        let path = format!(
            "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{}",
            entry.interface
        );
        match entry.prior_ack {
            Some(v) => ps.push_str(&format!(
                "Set-ItemProperty -Path '{}' -Name 'TcpAckFrequency' -Value {} -Type DWord; ",
                path, v
            )),
            None => ps.push_str(&format!(
                "Remove-ItemProperty -Path '{}' -Name 'TcpAckFrequency' -ErrorAction SilentlyContinue; ",
                path
            )),
        }
        match entry.prior_nodelay {
            Some(v) => ps.push_str(&format!(
                "Set-ItemProperty -Path '{}' -Name 'TCPNoDelay' -Value {} -Type DWord; ",
                path, v
            )),
            None => ps.push_str(&format!(
                "Remove-ItemProperty -Path '{}' -Name 'TCPNoDelay' -ErrorAction SilentlyContinue; ",
                path
            )),
        }
    }
    if ps.is_empty() {
        return Err("snapshot had interfaces but none usable for rollback".into());
    }
    run_elevated_powershell(&ps)?;
    Ok(())
}

pub(crate) fn rollback_visual_effects_typed(
    vfx_setting_prior: Option<u32>,
    user_prefs_mask_prior: Option<&[u8]>,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let vfx_key = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects",
            KEY_SET_VALUE | KEY_READ,
        )
        .map_err(|e| e.to_string())?;
    match vfx_setting_prior {
        Some(v) => vfx_key
            .set_value("VisualFXSetting", &v)
            .map_err(|e| e.to_string())?,
        None => {
            let _ = vfx_key.delete_value("VisualFXSetting");
        }
    }

    let desktop_key = hkcu
        .open_subkey_with_flags("Control Panel\\Desktop", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    match user_prefs_mask_prior {
        Some(bytes) => {
            desktop_key
                .set_raw_value(
                    "UserPreferencesMask",
                    &winreg::RegValue {
                        bytes: bytes.to_vec(),
                        vtype: winreg::enums::RegType::REG_BINARY,
                    },
                )
                .map_err(|e| e.to_string())?;
        }
        None => {
            let _ = desktop_key.delete_value("UserPreferencesMask");
        }
    }
    Ok(())
}

// Dispatches a RollbackAction against its corresponding Snapshot. The match
// is exhaustive on the (action, snapshot) pair — a mismatch is a contract
// violation and returns Err rather than performing the wrong rollback.
pub(crate) fn dispatch_rollback(action: &RollbackAction, snapshot: &Snapshot) -> Result<(), String> {
    use RollbackAction as R;
    use Snapshot as S;
    match (action, snapshot) {
        (
            R::RestoreServiceFromSnapshot { service },
            S::Service { prior_state, prior_start_mode },
        ) => rollback_service_disable_typed(service, prior_state, prior_start_mode),
        (
            R::RestoreGameModeFromSnapshot,
            S::GameMode {
                prior_enabled,
                prior_allow,
            },
        ) => rollback_game_mode_typed(*prior_enabled, *prior_allow),
        (
            R::RestoreVisualEffectsFromSnapshot,
            S::VisualEffects {
                vfx_setting_prior,
                user_prefs_mask_prior,
            },
        ) => rollback_visual_effects_typed(
            *vfx_setting_prior,
            user_prefs_mask_prior.as_deref(),
        ),
        (
            R::RestoreMouseAccelFromSnapshot,
            S::MouseAccel {
                prior_speed,
                prior_threshold1,
                prior_threshold2,
            },
        ) => rollback_mouse_accel_off_typed(prior_speed, prior_threshold1, prior_threshold2),
        (
            R::RestoreGameBarFromSnapshot,
            S::GameBar {
                prior_capture,
                prior_enabled,
            },
        ) => rollback_game_bar_disable_typed(*prior_capture, *prior_enabled),
        (R::RestoreHwSchModeFromSnapshot, S::HwSchMode { prior }) => {
            rollback_hags_enable_typed(*prior)
        }
        (R::RestorePowerPlanFromSnapshot, S::PowerPlan { prior_guid }) => {
            rollback_power_ultimate_typed(prior_guid)
        }
        (R::RestoreNagleNicsFromSnapshot, S::NagleNics { interfaces }) => {
            rollback_nagle_disable_typed(interfaces)
        }
        (R::RestoreFastStartupFromSnapshot, S::FastStartup { prior_hiberboot }) => {
            rollback_fast_startup_off_typed(*prior_hiberboot)
        }
        (R::RestoreReservedStorageFromSnapshot, S::ReservedStorage { prior_enabled }) => {
            rollback_reserved_storage_off_typed(*prior_enabled)
        }
        (
            R::RestorePowerPlanSettingFromSnapshot,
            S::PowerPlanSetting {
                plan_guid,
                subgroup_guid,
                setting_guid,
                prior_ac_value,
                prior_dc_value,
            },
        ) => rollback_power_plan_setting_typed(
            plan_guid,
            subgroup_guid,
            setting_guid,
            *prior_ac_value,
            *prior_dc_value,
        ),
        (R::RestoreEnergyEfficientEthernetFromSnapshot, S::EeeNicProperty { adapters }) => {
            rollback_eee_disable_typed(adapters)
        }
        // Leftovers v2 (dark) — undoing a restore puts the recorded rotted value back exactly.
        (R::RestoreMemoryCompressionFromSnapshot, S::MemoryCompression { prior_enabled }) => {
            rollback_memory_compression_typed(*prior_enabled)
        }
        (
            R::RestoreMmcssFromSnapshot,
            S::Mmcss { prior_system_responsiveness, prior_network_throttling },
        ) => rollback_mmcss_typed(*prior_system_responsiveness, *prior_network_throttling),
        (R::RestorePrioritySeparationFromSnapshot, S::PrioritySeparation { prior_value }) => {
            rollback_priority_separation_typed(*prior_value)
        }
        (R::RestoreMpoFromSnapshot, S::Mpo { prior_overlay_test_mode }) => {
            rollback_mpo_typed(*prior_overlay_test_mode)
        }
        (R::RestoreCoreParkingFromSnapshot, S::CoreParking { prior_ac_pct, prior_dc_pct }) => {
            rollback_core_parking_typed(*prior_ac_pct, *prior_dc_pct)
        }
        (R::RestoreTcpAutotuningFromSnapshot, S::TcpAutotuning { prior_disabled }) => {
            rollback_tcp_autotuning_typed(*prior_disabled)
        }
        (
            R::RestorePagefileFromSnapshot,
            S::PagefileManual { prior_drive_letter, prior_initial_mb, prior_maximum_mb },
        ) => rollback_pagefile_typed(*prior_drive_letter, *prior_initial_mb, *prior_maximum_mb),
        (R::EnableScheduledTask { task }, S::ScheduledTask { prior_state }) => {
            rollback_enable_scheduled_task_typed(task, prior_state)
        }
        _ => Err(format!(
            "rollback action/snapshot mismatch: action={:?}, snapshot kind differs",
            action
        )),
    }
}

// Build a typed (RollbackAction, Snapshot) pair from a legacy AppliedChange
// (one written by a Compy version before the typed-action refactor). The
// legacy snapshot was a free-form serde_json::Value whose shape was determined
// by the rec_id; we reconstruct the typed form using the same per-rec_id
// knowledge.
/// Resolve the rollback contract for an AppliedChange using ONLY the stored
/// history — never the live recommendation catalog (ARCHITECTURE_LOCKS §1.5).
/// Prefers the typed contract captured at apply time; falls back to
/// synthesizing one from rec_id + legacy snapshot JSON for entries written by
/// older Compy versions. This is the core of "Compy can undo what it did
/// from local history alone" — extracted so it's unit-testable without
/// mutating Windows.
pub(crate) fn resolve_rollback(change: &AppliedChange) -> Result<(RollbackAction, Snapshot), String> {
    if let Some(ra) = change.rollback_action.clone() {
        let snap: Snapshot = serde_json::from_value(change.snapshot.clone())
            .map_err(|e| format!("snapshot deserialize: {}", e))?;
        Ok((ra, snap))
    } else {
        synthesize_legacy_rollback(&change.rec_id, &change.snapshot).ok_or_else(|| {
            format!(
                "legacy AppliedChange for rec_id '{}' has no typed rollback contract and no legacy synthesizer matched",
                change.rec_id
            )
        })
    }
}

pub(crate) fn synthesize_legacy_rollback(
    rec_id: &str,
    snapshot: &serde_json::Value,
) -> Option<(RollbackAction, Snapshot)> {
    match rec_id {
        "game-mode" => {
            let prior_enabled = snapshot
                .get("prior")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            // Legacy entries predate the pair fix and never captured AllowAutoGameMode.
            Some((
                RollbackAction::RestoreGameModeFromSnapshot,
                Snapshot::GameMode {
                    prior_enabled,
                    prior_allow: None,
                },
            ))
        }
        "visual-effects" => {
            let vfx_setting_prior = snapshot
                .get("vfx_setting_prior")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let user_prefs_mask_prior = snapshot
                .get("user_prefs_mask_prior")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|n| n.as_u64().map(|v| v as u8))
                        .collect::<Vec<u8>>()
                });
            Some((
                RollbackAction::RestoreVisualEffectsFromSnapshot,
                Snapshot::VisualEffects {
                    vfx_setting_prior,
                    user_prefs_mask_prior,
                },
            ))
        }
        "sysmain-disable" | "diagtrack-disable" | "windows-search-disable"
        | "nvidia-telemetry" => {
            let service = match rec_id {
                "sysmain-disable" => KnownService::SysMain,
                "diagtrack-disable" => KnownService::DiagTrack,
                "windows-search-disable" => KnownService::WSearch,
                "nvidia-telemetry" => KnownService::NvTelemetryContainer,
                _ => return None,
            };
            let prior_state = snapshot
                .get("prior_state")
                .and_then(|v| v.as_str())
                .unwrap_or("Running")
                .to_string();
            let prior_start_mode = snapshot
                .get("prior_start_mode")
                .and_then(|v| v.as_str())
                .unwrap_or("Automatic")
                .to_string();
            Some((
                RollbackAction::RestoreServiceFromSnapshot {
                    service: service.clone(),
                },
                Snapshot::Service {
                    prior_state,
                    prior_start_mode,
                },
            ))
        }
        "power-ultimate" => {
            let prior_guid = snapshot
                .get("prior_plan_guid")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some((
                RollbackAction::RestorePowerPlanFromSnapshot,
                Snapshot::PowerPlan { prior_guid },
            ))
        }
        "nagle-disable" => {
            let interfaces = snapshot
                .get("interfaces")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|entry| {
                            let iface = entry.get("interface").and_then(|v| v.as_str())?;
                            Some(NagleInterfaceSnapshot {
                                interface: iface.to_string(),
                                prior_ack: entry
                                    .get("prior_ack")
                                    .and_then(|v| v.as_u64())
                                    .map(|v| v as u32),
                                prior_nodelay: entry
                                    .get("prior_nodelay")
                                    .and_then(|v| v.as_u64())
                                    .map(|v| v as u32),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some((
                RollbackAction::RestoreNagleNicsFromSnapshot,
                Snapshot::NagleNics { interfaces },
            ))
        }
        "hags-enable" => {
            let prior = snapshot
                .get("prior_hwschmode")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            Some((
                RollbackAction::RestoreHwSchModeFromSnapshot,
                Snapshot::HwSchMode { prior },
            ))
        }
        "mouse-accel-off" => {
            let prior_speed = snapshot
                .get("prior_speed")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let prior_threshold1 = snapshot
                .get("prior_threshold1")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let prior_threshold2 = snapshot
                .get("prior_threshold2")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some((
                RollbackAction::RestoreMouseAccelFromSnapshot,
                Snapshot::MouseAccel {
                    prior_speed,
                    prior_threshold1,
                    prior_threshold2,
                },
            ))
        }
        "game-bar-disable" => {
            let prior_capture = snapshot
                .get("prior_capture")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let prior_enabled = snapshot
                .get("prior_enabled")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            Some((
                RollbackAction::RestoreGameBarFromSnapshot,
                Snapshot::GameBar {
                    prior_capture,
                    prior_enabled,
                },
            ))
        }
        "fast-startup-off" => {
            let prior_hiberboot = snapshot
                .get("prior_hiberboot")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            Some((
                RollbackAction::RestoreFastStartupFromSnapshot,
                Snapshot::FastStartup { prior_hiberboot },
            ))
        }
        "reserved-storage-off" => {
            let prior_enabled = snapshot
                .get("prior_enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            Some((
                RollbackAction::RestoreReservedStorageFromSnapshot,
                Snapshot::ReservedStorage { prior_enabled },
            ))
        }
        _ => None,
    }
}


// ─── Rollback resolution / legacy synthesis tests ────────────────────────
//
// Release-gate QA: lock the PURE half of the rollback contract that the module
// extraction touched — the rec_id -> (RollbackAction, Snapshot) mapping used to
// undo changes from local history alone. These never mutate Windows; the actual
// powercfg/registry restore is covered by the manual smoke pass.
#[cfg(test)]
mod rollback_tests {
    use super::*;
    use serde_json::json;

    // Every rec_id that existed before the typed-action refactor must still
    // synthesize a rollback from a legacy (untyped) snapshot, mapped to the
    // correct action+snapshot variant pair — otherwise an upgrade would silently
    // strip rollback from changes already sitting in users' history.json. Each
    // pair asserted here is one dispatch_rollback handles (1:1 with its arms).
    #[test]
    fn synthesize_legacy_maps_each_rec_to_correct_rollback() {
        use RollbackAction as R;
        use Snapshot as S;

        let (a, s) = synthesize_legacy_rollback("game-mode", &json!({"prior": 1})).unwrap();
        assert!(matches!(a, R::RestoreGameModeFromSnapshot) && matches!(s, S::GameMode { .. }));

        let (a, s) =
            synthesize_legacy_rollback("visual-effects", &json!({"vfx_setting_prior": 1})).unwrap();
        assert!(
            matches!(a, R::RestoreVisualEffectsFromSnapshot) && matches!(s, S::VisualEffects { .. })
        );

        for svc in [
            "sysmain-disable",
            "diagtrack-disable",
            "windows-search-disable",
            "nvidia-telemetry",
        ] {
            let (a, s) = synthesize_legacy_rollback(
                svc,
                &json!({"prior_state": "Running", "prior_start_mode": "Automatic"}),
            )
            .unwrap();
            assert!(
                matches!(a, R::RestoreServiceFromSnapshot { .. }) && matches!(s, S::Service { .. }),
                "service rec {svc}"
            );
        }

        let (a, s) =
            synthesize_legacy_rollback("power-ultimate", &json!({"prior_plan_guid": "G"})).unwrap();
        assert!(matches!(a, R::RestorePowerPlanFromSnapshot) && matches!(s, S::PowerPlan { .. }));

        let (a, s) =
            synthesize_legacy_rollback("nagle-disable", &json!({"interfaces": []})).unwrap();
        assert!(matches!(a, R::RestoreNagleNicsFromSnapshot) && matches!(s, S::NagleNics { .. }));

        let (a, s) =
            synthesize_legacy_rollback("hags-enable", &json!({"prior_hwschmode": 0})).unwrap();
        assert!(matches!(a, R::RestoreHwSchModeFromSnapshot) && matches!(s, S::HwSchMode { .. }));

        let (a, s) =
            synthesize_legacy_rollback("mouse-accel-off", &json!({"prior_speed": "10"})).unwrap();
        assert!(matches!(a, R::RestoreMouseAccelFromSnapshot) && matches!(s, S::MouseAccel { .. }));

        let (a, s) = synthesize_legacy_rollback(
            "game-bar-disable",
            &json!({"prior_capture": 1, "prior_enabled": 1}),
        )
        .unwrap();
        assert!(matches!(a, R::RestoreGameBarFromSnapshot) && matches!(s, S::GameBar { .. }));

        let (a, s) =
            synthesize_legacy_rollback("fast-startup-off", &json!({"prior_hiberboot": 1})).unwrap();
        assert!(
            matches!(a, R::RestoreFastStartupFromSnapshot) && matches!(s, S::FastStartup { .. })
        );

        let (a, s) =
            synthesize_legacy_rollback("reserved-storage-off", &json!({"prior_enabled": true}))
                .unwrap();
        assert!(
            matches!(a, R::RestoreReservedStorageFromSnapshot)
                && matches!(s, S::ReservedStorage { .. })
        );
    }

    // The three power/NIC recs added WITH the typed contract have no legacy
    // synthesizer (no pre-typed history entry can exist for them); an unknown
    // rec_id likewise yields None. resolve_rollback then returns a clean error
    // instead of guessing and restoring the wrong thing.
    #[test]
    fn synthesize_legacy_returns_none_for_post_typed_and_unknown_recs() {
        for rec in [
            "usb-selective-suspend-off",
            "pcie-aspm-off",
            "eee-disable",
            "totally-unknown-rec",
        ] {
            assert!(
                synthesize_legacy_rollback(rec, &json!({})).is_none(),
                "expected None for {rec}"
            );
        }
    }

    fn typed_change(action: RollbackAction, snapshot: serde_json::Value) -> AppliedChange {
        AppliedChange {
            id: "id".into(),
            rec_id: "any".into(),
            rec_title: "t".into(),
            applied_at: "2026-01-01T00:00:00Z".into(),
            snapshot,
            status: "applied".into(),
            applied_action: None,
            rollback_action: Some(action),
            app_version_at_apply: None,
            ruleset_version_at_apply: None,
            elevation_used: None,
            provenance: None,
        }
    }

    // A typed entry whose stored snapshot JSON doesn't match its action (corrupt
    // or tampered history) must fail safe: resolve_rollback returns Err, never
    // panics and never silently falls through to a different action/snapshot.
    #[test]
    fn resolve_rollback_rejects_garbled_typed_snapshot() {
        let change = typed_change(
            RollbackAction::RestoreGameModeFromSnapshot,
            json!({"not": "a snapshot"}),
        );
        assert!(
            resolve_rollback(&change).is_err(),
            "garbled typed snapshot must not resolve"
        );
    }

    // ── Power-plan rollback fidelity (restore the EXACT plan, never SCHEME_CURRENT) ──

    #[test]
    fn power_setting_snapshot_carries_plan_guid() {
        // The plan GUID the setting was applied to must survive in the snapshot —
        // it is what rollback targets.
        let s = Snapshot::PowerPlanSetting {
            plan_guid: "PLAN-GUID-123".into(),
            subgroup_guid: "SUB".into(),
            setting_guid: "SET".into(),
            prior_ac_value: 1,
            prior_dc_value: 1,
        };
        let back: Snapshot = serde_json::from_value(serde_json::to_value(&s).unwrap()).unwrap();
        match back {
            Snapshot::PowerPlanSetting { plan_guid, .. } => assert_eq!(plan_guid, "PLAN-GUID-123"),
            _ => panic!("variant changed on round-trip"),
        }
    }

    #[test]
    fn power_setting_restore_targets_stored_plan_never_scheme_current() {
        let cmd = build_power_setting_restore_cmd("PLAN-GUID-123", "SUB", "SET", 5, 7, true);
        assert!(cmd.contains("PLAN-GUID-123"), "must target the stored plan GUID");
        assert!(
            !cmd.contains("SCHEME_CURRENT"),
            "must never fall back to SCHEME_CURRENT"
        );
        assert!(cmd.contains("setacvalueindex") && cmd.contains(" 5"));
        assert!(cmd.contains("setdcvalueindex") && cmd.contains(" 7"));
        assert!(
            cmd.contains("setactive PLAN-GUID-123"),
            "the active plan should be re-committed"
        );

        // Restoring a NON-active plan must not switch the user onto it.
        let cmd2 = build_power_setting_restore_cmd("PLAN-GUID-123", "SUB", "SET", 5, 7, false);
        assert!(
            !cmd2.contains("setactive"),
            "must not switch active plan when restoring a non-active plan"
        );
        assert!(!cmd2.contains("SCHEME_CURRENT"));
    }

    #[test]
    fn rollback_power_setting_fails_safe_when_plan_missing() {
        // A bogus/deleted plan GUID must produce a clean error, NOT a silent
        // restore onto whatever plan is current. The all-zeros GUID is never a
        // real scheme, so this resolves to Err before any elevation is attempted.
        let bogus = "00000000-0000-0000-0000-000000000000";
        let result = rollback_power_plan_setting_typed(bogus, "SUB", "SET", 1, 1);
        assert!(result.is_err(), "missing plan GUID must fail safe");
        let msg = result.unwrap_err().to_lowercase();
        assert!(
            msg.contains("no longer exists") || msg.contains("plan"),
            "error should explain the missing plan: {msg}"
        );
    }

    #[test]
    fn power_plan_exists_rejects_empty_and_bogus() {
        assert!(!power_plan_exists(""), "empty GUID is not a plan");
        assert!(!power_plan_exists("   "), "whitespace GUID is not a plan");
        assert!(
            !power_plan_exists("00000000-0000-0000-0000-000000000000"),
            "all-zeros GUID is not a real plan"
        );
    }
}

#[cfg(test)]
mod restores_label_tests {
    use super::*;
    use serde_json::json;

    // Round-trip through serde_json::Value so the test exercises the real read-time path
    // (deserialize the persisted snapshot → label), exactly as `into_view` does.
    fn label(snap: &Snapshot) -> Option<String> {
        let v = serde_json::to_value(snap).expect("snapshot serializes");
        restores_label_from_snapshot(&v)
    }

    #[test]
    fn service_running_disabled_manual_and_unknown() {
        assert_eq!(
            label(&Snapshot::Service {
                prior_state: "Running".into(),
                prior_start_mode: "Auto".into()
            }),
            Some("Running".to_string())
        );
        assert_eq!(
            label(&Snapshot::Service {
                prior_state: "Stopped".into(),
                prior_start_mode: "Disabled".into()
            }),
            Some("Disabled".to_string())
        );
        assert_eq!(
            label(&Snapshot::Service {
                prior_state: "Stopped".into(),
                prior_start_mode: "Manual".into()
            }),
            Some("Manual start".to_string())
        );
        // Default/unknown capture → no clean label → generic fallback.
        assert_eq!(
            label(&Snapshot::Service {
                prior_state: "Unknown".into(),
                prior_start_mode: "Unknown".into()
            }),
            None
        );
    }

    #[test]
    fn boolean_registry_values_on_off() {
        assert_eq!(label(&Snapshot::GameMode { prior_enabled: Some(1), prior_allow: Some(1) }), Some("On".into()));
        assert_eq!(label(&Snapshot::GameMode { prior_enabled: Some(0), prior_allow: Some(0) }), Some("Off".into()));
        assert_eq!(label(&Snapshot::GameMode { prior_enabled: None, prior_allow: None }), None);
        assert_eq!(
            label(&Snapshot::FastStartup { prior_hiberboot: Some(1) }),
            Some("On".into())
        );
        assert_eq!(label(&Snapshot::ReservedStorage { prior_enabled: true }), Some("On".into()));
        assert_eq!(
            label(&Snapshot::ReservedStorage { prior_enabled: false }),
            Some("Off".into())
        );
        assert_eq!(
            label(&Snapshot::GameBar { prior_capture: Some(0), prior_enabled: Some(1) }),
            Some("On".into())
        );
        assert_eq!(
            label(&Snapshot::MouseAccel {
                prior_speed: "1".into(),
                prior_threshold1: "6".into(),
                prior_threshold2: "10".into()
            }),
            Some("On".into())
        );
    }

    #[test]
    fn hags_uses_two_for_on() {
        assert_eq!(label(&Snapshot::HwSchMode { prior: Some(2) }), Some("On".into()));
        assert_eq!(label(&Snapshot::HwSchMode { prior: Some(1) }), Some("Off".into()));
        assert_eq!(label(&Snapshot::HwSchMode { prior: None }), None);
    }

    #[test]
    fn visual_effects_named_modes() {
        assert_eq!(
            label(&Snapshot::VisualEffects {
                vfx_setting_prior: Some(1),
                user_prefs_mask_prior: None
            }),
            Some("Best appearance".into())
        );
        assert_eq!(
            label(&Snapshot::VisualEffects {
                vfx_setting_prior: Some(2),
                user_prefs_mask_prior: None
            }),
            Some("Best performance".into())
        );
        assert_eq!(
            label(&Snapshot::VisualEffects {
                vfx_setting_prior: None,
                user_prefs_mask_prior: None
            }),
            None
        );
    }

    #[test]
    fn power_plan_bare_guid_is_never_named() {
        // The snapshot holds only a GUID — must NOT be dressed up as a plan name (spec §5).
        assert_eq!(
            label(&Snapshot::PowerPlan {
                prior_guid: "381b4222-f694-41f0-9685-ff5bb260df2e".into()
            }),
            None
        );
    }

    #[test]
    fn multi_target_and_setting_snapshots_are_generic() {
        assert_eq!(
            label(&Snapshot::PowerPlanSetting {
                plan_guid: "g".into(),
                subgroup_guid: "s".into(),
                setting_guid: "x".into(),
                prior_ac_value: 1,
                prior_dc_value: 1,
            }),
            None
        );
        assert_eq!(label(&Snapshot::NagleNics { interfaces: vec![] }), None);
        assert_eq!(label(&Snapshot::EeeNicProperty { adapters: vec![] }), None);
    }

    #[test]
    fn legacy_or_untyped_snapshot_falls_back_to_none() {
        // Old entries / unexpected shapes can't deserialize into Snapshot → None (generic UI).
        assert_eq!(restores_label_from_snapshot(&json!({"foo": "bar"})), None);
        assert_eq!(restores_label_from_snapshot(&json!("legacy string")), None);
        assert_eq!(restores_label_from_snapshot(&json!(null)), None);
    }

    // ── Game Mode persistence fix (2026-06-08): apply + detect must agree on the value PAIR ──

    // A typed GameMode snapshot written BEFORE this fix carried only `prior_enabled`. It must still
    // deserialize (prior_allow -> None via #[serde(default)]) so a pre-fix apply stays undoable —
    // rollback-first integrity (ARCHITECTURE_LOCKS §3).
    #[test]
    fn pre_fix_typed_game_mode_snapshot_still_deserializes() {
        let pre_fix = json!({"kind": "game-mode", "prior_enabled": 0});
        let snap: Snapshot =
            serde_json::from_value(pre_fix).expect("pre-fix snapshot must deserialize");
        assert!(matches!(
            snap,
            Snapshot::GameMode { prior_enabled: Some(0), prior_allow: None }
        ));
    }

    // Read-after-write regression for the "never stays on" bug: a freshly applied Game Mode MUST be
    // reported as enabled by the detection probe. The old apply wrote only AutoGameModeEnabled,
    // which Windows reset on reboot and which a pair-aware detector reads as not-fully-on — that
    // mismatch re-offered the rec and bloated the ledger (owner export: 5× applies). This locks
    // apply and detect to the same pair. Touches real HKCU; captures + restores the exact prior
    // state so it leaves the machine as it found it (restore runs BEFORE any assertion).
    #[test]
    fn game_mode_apply_reads_back_as_enabled() {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let read = |name: &str| -> Option<u32> {
            hkcu.open_subkey(GAMEBAR_KEY).and_then(|k| k.get_value(name)).ok()
        };
        let prior_enabled = read(GAME_MODE_ENABLED_VALUE);
        let prior_allow = read(GAME_MODE_ALLOW_VALUE);

        let result = apply_game_mode().expect("apply_game_mode");
        let reads_enabled = crate::game_mode_enabled();
        let snapshot_ok = matches!(
            result.snapshot,
            Snapshot::GameMode { prior_enabled: pe, prior_allow: pa }
                if pe == prior_enabled && pa == prior_allow
        );
        rollback_game_mode_typed(prior_enabled, prior_allow).expect("restore prior state");

        assert!(reads_enabled, "detection must read ON immediately after apply (both values set)");
        assert!(snapshot_ok, "apply must snapshot the exact prior pair for rollback");
    }
}
