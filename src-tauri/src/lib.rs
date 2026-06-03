use std::path::PathBuf;
use std::process::Command;

mod actions;
mod benchmark; // F6 PARKED + DARK: compiled, not registered. See benchmark.rs + the spec.
mod diagnostics;
mod export;
mod fps;
mod hardware;
mod history;
mod monitoring;
mod priorities;
mod readiness;
mod recommendations;
mod remote_rules;
mod sessions;
use actions::*;
use diagnostics::*;
use export::*;
use hardware::*;
use history::*;
use monitoring::*;
use priorities::*;
use readiness::*;
use recommendations::*;
use sessions::*;

/// Entry point for the elevated FPS-capture helper process
/// (`sentinel.exe --fps-capture`). See fps.rs for the full rationale.
pub fn run_fps_capture() {
    fps::run_capture();
}

use serde::Serialize;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;


pub(crate) fn current_power_plan_name() -> Option<String> {
    let output = Command::new("powercfg").args(["/getactivescheme"]).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Format: "Power Scheme GUID: <guid>  (Plan Name)"
    let start = stdout.find('(')? + 1;
    let end = stdout.rfind(')')?;
    Some(stdout[start..end].trim().to_string())
}

pub(crate) fn game_mode_enabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey("Software\\Microsoft\\GameBar")
        .and_then(|k| k.get_value::<u32, _>("AutoGameModeEnabled"))
        .map(|v| v == 1)
        .unwrap_or(false)
}

pub(crate) fn service_running(name: &str) -> bool {
    Command::new("sc")
        .args(["query", name])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("RUNNING"))
        .unwrap_or(false)
}

pub(crate) fn visual_effects_for_best_performance() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects")
        .and_then(|k| k.get_value::<u32, _>("VisualFXSetting"))
        .map(|v| v == 2)
        .unwrap_or(false)
}

// Memory Integrity (HVCI / hypervisor-enforced code integrity) is the
// gaming-relevant VBS scenario. Reading both the HVCI subkey and the parent
// VBS toggle covers the common configurations: some systems have VBS off but
// HVCI on, some have VBS on without HVCI explicitly toggled. We report
// "active" if either flag indicates protection is engaged, because the FPS
// cost path applies in both cases.
pub(crate) fn memory_integrity_or_vbs_active() -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let hvci_on = hklm
        .open_subkey(
            "SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity",
        )
        .and_then(|k| k.get_value::<u32, _>("Enabled"))
        .map(|v| v == 1)
        .unwrap_or(false);
    let vbs_on = hklm
        .open_subkey("SYSTEM\\CurrentControlSet\\Control\\DeviceGuard")
        .and_then(|k| k.get_value::<u32, _>("EnableVirtualizationBasedSecurity"))
        .map(|v| v == 1)
        .unwrap_or(false);
    hvci_on || vbs_on
}

pub(crate) fn reserved_storage_enabled() -> bool {
    // Win10/11 stashes the reserved-storage configuration here. BaseHardReserveSize
    // is the byte count currently set aside; > 0 = reserved storage is active.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("Software\\Microsoft\\ReserveManager")
        .and_then(|k| k.get_value::<u32, _>("BaseHardReserveSize"))
        .map(|v| v > 0)
        .unwrap_or(false)
}

pub(crate) fn fast_startup_state() -> Option<u32> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power")
        .and_then(|k| k.get_value::<u32, _>("HiberbootEnabled"))
        .ok()
}

pub(crate) fn game_bar_disabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let capture: Option<u32> = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR")
        .and_then(|k| k.get_value("AppCaptureEnabled"))
        .ok();
    let dvr: Option<u32> = hkcu
        .open_subkey("System\\GameConfigStore")
        .and_then(|k| k.get_value("GameDVR_Enabled"))
        .ok();
    capture == Some(0) && dvr == Some(0)
}

pub(crate) fn hags_state() -> Option<u32> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers")
        .and_then(|k| k.get_value::<u32, _>("HwSchMode"))
        .ok()
}

pub(crate) fn mouse_accel_disabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey("Control Panel\\Mouse") else {
        return false;
    };
    let speed: String = key.get_value("MouseSpeed").unwrap_or_default();
    // MouseSpeed = 0 means acceleration off; 1 or 2 means on.
    speed == "0"
}

pub(crate) fn nagle_disabled_on_any_nic() -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(interfaces) =
        hklm.open_subkey("SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces")
    else {
        return false;
    };
    for adapter_name in interfaces.enum_keys().filter_map(|r| r.ok()) {
        let Ok(adapter) = interfaces.open_subkey(&adapter_name) else {
            continue;
        };
        if adapter.get_value::<u32, _>("TcpAckFrequency").ok() == Some(1)
            && adapter.get_value::<u32, _>("TCPNoDelay").ok() == Some(1)
        {
            return true;
        }
    }
    false
}





pub(crate) fn sentinel_data_dir() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Temp".into());
    PathBuf::from(app_data).join("Sentinel")
}


// State-detection helpers consumed by check_state_kind / check_change_active.

pub(crate) fn usb_selective_suspend_off_on_ac() -> bool {
    query_power_setting_ac_dc(PWR_SUBGROUP_USB, PWR_SETTING_USB_SELECTIVE_SUSPEND)
        .map(|(ac, _)| ac == 0)
        .unwrap_or(false)
}

pub(crate) fn pcie_aspm_off_on_ac() -> bool {
    query_power_setting_ac_dc(PWR_SUBGROUP_PCIE, PWR_SETTING_PCIE_ASPM)
        .map(|(ac, _)| ac == 0)
        .unwrap_or(false)
}

pub(crate) fn eee_disabled_on_any_eligible_adapter() -> bool {
    let entries = enumerate_eee_eligible_adapters();
    if entries.is_empty() {
        return false;
    }
    // ON (in the recommended sense — EEE off) iff EVERY eligible adapter
    // is Disabled. If any eligible adapter still has EEE enabled, the rec
    // is NOT in the recommended state.
    entries
        .iter()
        .all(|e| e.prior_value.to_lowercase().contains("disab"))
}


// ─── Startup apps (HKCU Run) ─────────────────────────────────────────────
//
// Windows tracks auto-start entries in HKCU\...\Run and HKLM\...\Run.
// Task Manager's "Disabled" state is a separate registry blob under
// StartupApproved\Run — first byte = 0x02 (enabled) or 0x03 (disabled),
// followed by an 8-byte timestamp (which we always zero out).
//
// V1 is HKCU-only. HKLM (system-wide) entries are visible but need admin
// to toggle — we'll add that when we re-use the UAC elevation pattern.

#[derive(Serialize, Clone)]
pub(crate) struct StartupEntry {
    name: String,
    command: String,
    enabled: bool,
}

#[tauri::command]
fn get_startup_entries() -> Vec<StartupEntry> {
    startup_entries()
}

// Plain helper (no #[tauri::command]) so other modules (priorities) can read
// startup entries without referencing the command fn.
pub(crate) fn startup_entries() -> Vec<StartupEntry> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run_key) = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run") else {
        return Vec::new();
    };
    let approval = hkcu
        .open_subkey(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
        )
        .ok();

    let mut entries = Vec::new();
    for value_result in run_key.enum_values() {
        let Ok((name, _)) = value_result else { continue };
        let command: String = run_key.get_value(&name).unwrap_or_default();
        let enabled = approval
            .as_ref()
            .and_then(|k| k.get_raw_value(&name).ok())
            .map(|v| v.bytes.first().copied() != Some(0x03))
            .unwrap_or(true); // default enabled if no approval entry exists
        entries.push(StartupEntry {
            name,
            command,
            enabled,
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    entries
}

#[tauri::command]
fn set_startup_entry_enabled(name: String, enabled: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run")
        .map_err(|e| e.to_string())?;
    let first_byte = if enabled { 0x02u8 } else { 0x03u8 };
    let bytes = vec![first_byte, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    key.set_raw_value(
        &name,
        &winreg::RegValue {
            bytes,
            vtype: winreg::enums::RegType::REG_BINARY,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be the first plugin. A second launch focuses the
        // existing main window instead of opening another process — so only one
        // main process ever mutates history.json (no cross-process race). The
        // elevated --fps-capture helper returns from main.rs before this builder,
        // so it never registers here and is unaffected.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_hardware_info,
            get_recommendations,
            get_diagnostics,
            get_gpu_sensors,
            get_cpu_sensors,
            start_fps_capture,
            stop_fps_capture,
            get_fps_status,
            show_overlay,
            hide_overlay,
            overlay_visible,
            apply_recommendation,
            rollback_change,
            get_applied_changes,
            get_startup_entries,
            set_startup_entry_enabled,
            get_rules_source,
            get_game_readiness,
            get_session_summaries,
            export_report,
            open_export_folder,
            get_priorities,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


// ─── Apply / rollback safety-contract tests ──────────────────────────────
//
// These PIN the existing safety model before any module movement (revised
// plan: tests first). They prove the contract is real — that Sentinel can undo
// what it did from LOCAL HISTORY ALONE — without mutating Windows. The actual
// mutation (dispatch_apply / dispatch_rollback running powercfg/registry edits)
// is covered by the manual release-gate QA checklist, not unit tests; here we
// prove the typed allowlist, snapshot fidelity, and history-only resolution.
#[cfg(test)]
mod safety_tests {
    use super::*;
    use serde_json::json;

    fn roundtrips<T>(v: &T) -> bool
    where
        T: serde::Serialize + for<'de> serde::Deserialize<'de>,
    {
        let j = serde_json::to_value(v).unwrap();
        let back: T = serde_json::from_value(j.clone()).unwrap();
        j == serde_json::to_value(&back).unwrap()
    }

    fn change_with(
        rollback_action: Option<RollbackAction>,
        snapshot: serde_json::Value,
        rec_id: &str,
    ) -> AppliedChange {
        AppliedChange {
            id: "id-1".into(),
            rec_id: rec_id.into(),
            rec_title: "title".into(),
            applied_at: "2026-01-01T00:00:00Z".into(),
            snapshot,
            status: "applied".into(),
            applied_action: None,
            rollback_action,
            app_version_at_apply: None,
            ruleset_version_at_apply: None,
            elevation_used: None,
        }
    }

    #[test]
    fn snapshot_variants_roundtrip() {
        assert!(roundtrips(&Snapshot::GameMode { prior_enabled: Some(1) }));
        assert!(roundtrips(&Snapshot::Service {
            prior_state: "Running".into(),
            prior_start_mode: "Automatic".into()
        }));
        assert!(roundtrips(&Snapshot::PowerPlan { prior_guid: "g".into() }));
        assert!(roundtrips(&Snapshot::NagleNics {
            interfaces: vec![NagleInterfaceSnapshot {
                interface: "if".into(),
                prior_ack: None,
                prior_nodelay: Some(1)
            }]
        }));
        assert!(roundtrips(&Snapshot::EeeNicProperty {
            adapters: vec![EeeNicSnapshot {
                adapter_name: "Ethernet".into(),
                property_display_name: "Energy Efficient Ethernet".into(),
                prior_value: "Enabled".into()
            }]
        }));
    }

    #[test]
    fn applied_and_rollback_action_roundtrip() {
        assert!(roundtrips(&AppliedAction::DisableKnownService {
            service: KnownService::SysMain
        }));
        assert!(roundtrips(&AppliedAction::DisableUsbSelectiveSuspendOnAc));
        assert!(roundtrips(&RollbackAction::RestoreServiceFromSnapshot {
            service: KnownService::WSearch
        }));
        assert!(roundtrips(&RollbackAction::RestorePowerPlanSettingFromSnapshot));
    }

    #[test]
    fn typed_allowlist_rejects_unknown_actions() {
        // The typed allowlist (deny_unknown_fields + tagged enum) stops a
        // hostile/garbled history entry from selecting an arbitrary action.
        assert!(serde_json::from_value::<AppliedAction>(json!({"kind": "format-c-drive"})).is_err());
        assert!(serde_json::from_value::<RollbackAction>(json!({"kind": "rm-rf-system32"})).is_err());
    }

    #[test]
    fn known_service_roundtrip_and_rejects_unknown() {
        assert!(roundtrips(&KnownService::NvTelemetryContainer));
        assert_eq!(
            serde_json::from_value::<KnownService>(json!("SysMain")).unwrap(),
            KnownService::SysMain
        );
        assert!(serde_json::from_value::<KnownService>(json!("EvilService")).is_err());
    }

    #[test]
    fn applied_change_stores_full_contract() {
        let change = AppliedChange {
            id: "game-mode-123".into(),
            rec_id: "game-mode".into(),
            rec_title: "Enable Game Mode".into(),
            applied_at: "2026-01-01T00:00:00Z".into(),
            snapshot: serde_json::to_value(&Snapshot::GameMode { prior_enabled: Some(0) }).unwrap(),
            status: "applied".into(),
            applied_action: Some(AppliedAction::EnableGameMode),
            rollback_action: Some(RollbackAction::RestoreGameModeFromSnapshot),
            app_version_at_apply: Some("0.1.0".into()),
            ruleset_version_at_apply: Some("1.0.0-baseline".into()),
            elevation_used: Some(true),
        };
        let back: AppliedChange =
            serde_json::from_value(serde_json::to_value(&change).unwrap()).unwrap();
        assert!(back.applied_action.is_some());
        assert!(back.rollback_action.is_some());
        assert_eq!(back.app_version_at_apply.as_deref(), Some("0.1.0"));
        assert_eq!(back.ruleset_version_at_apply.as_deref(), Some("1.0.0-baseline"));
        assert_eq!(back.elevation_used, Some(true));
        assert!(!back.snapshot.is_null());
    }

    #[test]
    fn legacy_history_without_new_fields_still_deserializes() {
        // Old history.json entries lacked the typed-contract fields. They must
        // still load (serde default -> None), or upgrades would brick history.
        let legacy = json!({
            "id": "game-mode-1",
            "rec_id": "game-mode",
            "rec_title": "Enable Game Mode",
            "applied_at": "2025-01-01T00:00:00Z",
            "snapshot": {"prior": 1},
            "status": "applied"
        });
        let c: AppliedChange = serde_json::from_value(legacy).unwrap();
        assert!(c.applied_action.is_none());
        assert!(c.rollback_action.is_none());
        assert!(c.app_version_at_apply.is_none());
    }

    #[test]
    fn rollback_resolves_from_history_alone_even_for_removed_rec() {
        // Typed contract stored at apply time; rec_id is NOT in the live
        // catalog. Rollback must still resolve — proving independence from the
        // live recommendation set (ARCHITECTURE_LOCKS §1.5).
        let snap = serde_json::to_value(&Snapshot::GameMode { prior_enabled: Some(0) }).unwrap();
        let change = change_with(
            Some(RollbackAction::RestoreGameModeFromSnapshot),
            snap,
            "a-rec-that-no-longer-exists",
        );
        let (action, snapshot) = resolve_rollback(&change).expect("resolve from history alone");
        assert!(matches!(action, RollbackAction::RestoreGameModeFromSnapshot));
        assert!(matches!(snapshot, Snapshot::GameMode { prior_enabled: Some(0) }));
    }

    #[test]
    fn rollback_synthesizes_from_legacy_snapshot() {
        // No typed contract (old entry) -> synthesize from rec_id + legacy JSON.
        let change = change_with(None, json!({"prior": 1}), "game-mode");
        let (action, snapshot) = resolve_rollback(&change).expect("legacy synthesis");
        assert!(matches!(action, RollbackAction::RestoreGameModeFromSnapshot));
        assert!(matches!(snapshot, Snapshot::GameMode { prior_enabled: Some(1) }));
    }

    #[test]
    fn registry_snapshot_distinguishes_missing_from_existing() {
        // missing-vs-existing is the difference between "delete on rollback" and
        // "restore to X". It must survive serialization.
        let missing = serde_json::to_value(&Snapshot::HwSchMode { prior: None }).unwrap();
        let existing = serde_json::to_value(&Snapshot::HwSchMode { prior: Some(0) }).unwrap();
        assert_ne!(missing, existing);
        assert!(matches!(
            serde_json::from_value::<Snapshot>(missing).unwrap(),
            Snapshot::HwSchMode { prior: None }
        ));
        assert!(matches!(
            serde_json::from_value::<Snapshot>(existing).unwrap(),
            Snapshot::HwSchMode { prior: Some(0) }
        ));
    }

    #[test]
    fn power_setting_snapshot_preserves_ac_dc_and_guids() {
        let s = Snapshot::PowerPlanSetting {
            plan_guid: "PLAN".into(),
            subgroup_guid: "SUB".into(),
            setting_guid: "SET".into(),
            prior_ac_value: 1,
            prior_dc_value: 2,
        };
        let back: Snapshot = serde_json::from_value(serde_json::to_value(&s).unwrap()).unwrap();
        match back {
            Snapshot::PowerPlanSetting {
                plan_guid,
                subgroup_guid,
                setting_guid,
                prior_ac_value,
                prior_dc_value,
            } => {
                assert_eq!(plan_guid, "PLAN");
                assert_eq!(subgroup_guid, "SUB");
                assert_eq!(setting_guid, "SET");
                assert_eq!(prior_ac_value, 1);
                assert_eq!(prior_dc_value, 2);
            }
            _ => panic!("variant changed on round-trip"),
        }
    }
}
