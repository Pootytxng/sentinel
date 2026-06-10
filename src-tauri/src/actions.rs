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
    let status = runas::Command::new("powershell.exe")
        .args(&[
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            command,
        ])
        .status()
        .map_err(|e| format!("could not launch elevated process: {}", e))?;
    if !status.success() {
        return Err(format!(
            "Elevated step did not complete (exit code {}). Did you cancel the UAC prompt?",
            status.code().map(|c| c.to_string()).unwrap_or_else(|| "?".into())
        ));
    }
    Ok(())
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
    use super::{compose_batch_script, parse_batch_receipts, run_elevated_powershell, ElevationDeferral};

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

pub(crate) fn enumerate_eee_eligible_adapters() -> Vec<EeeNicSnapshot> {
    let ps = r#"
$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
    $_.Status -eq 'Up' -and $_.PhysicalMediaType -eq '802.3'
}
foreach ($a in $adapters) {
    $props = Get-NetAdapterAdvancedProperty -Name $a.Name -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -match 'Energy[- ]?Efficient[- ]?Ethernet|Green Ethernet|Advanced EEE|^EEE$|EEE PHY' }
    foreach ($p in $props) {
        Write-Output ($a.Name + '|' + $p.DisplayName + '|' + $p.DisplayValue)
    }
}
"#;
    let output = quiet_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", ps])
        .output();
    let stdout = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => return Vec::new(),
    };
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            if parts.len() != 3 {
                return None;
            }
            Some(EeeNicSnapshot {
                adapter_name: parts[0].trim().to_string(),
                property_display_name: parts[1].trim().to_string(),
                prior_value: parts[2].trim().to_string(),
            })
        })
        .collect()
}

pub(crate) fn apply_eee_disable() -> Result<ApplyResult, String> {
    let adapters = enumerate_eee_eligible_adapters();
    if adapters.is_empty() {
        return Err(
            "No active wired Ethernet adapter with an Energy Efficient Ethernet property was found. Compy only modifies adapters where the property already exists."
                .into(),
        );
    }

    // Build the apply script — set every eligible (adapter, property) pair
    // to "Disabled". -NoRestart keeps the link up across the change so we
    // don't bounce the user's connection.
    let mut ps = String::new();
    for a in &adapters {
        ps.push_str(&format!(
            "Set-NetAdapterAdvancedProperty -Name '{}' -DisplayName '{}' -DisplayValue 'Disabled' -NoRestart -ErrorAction SilentlyContinue; ",
            a.adapter_name.replace('\'', "''"),
            a.property_display_name.replace('\'', "''"),
        ));
    }
    run_elevated_powershell(&ps)?;

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
    run_elevated_powershell(&ps)?;
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
