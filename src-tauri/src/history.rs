//! Trust Ledger: the persisted record of every change Compy has applied,
//! and the apply / rollback / list commands that read and write it.
//!
//! Rollback is resolved from these persisted records alone — via
//! `actions::resolve_rollback` — never from the live recommendation catalog, so
//! a change stays undoable even after its rule is deprecated or removed. This
//! module owns the change records, their on-disk history, and the recomputed
//! Trust Ledger view. It delegates every Windows mutation and rollback
//! resolution to `actions`, and recomputes "still active" from the crate-root
//! state probes; it owns no mutation primitives, condition logic, or detection.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::actions::*;
use crate::compy_data_dir;
use crate::{
    current_power_plan_name, eee_disabled_on_any_eligible_adapter, fast_startup_state,
    game_bar_disabled, game_mode_enabled, hags_state, mouse_accel_disabled,
    nagle_disabled_on_any_nic, pcie_aspm_off_on_ac, reserved_storage_enabled, service_running,
    usb_selective_suspend_off_on_ac, visual_effects_for_best_performance,
};

// Serialized so concurrent apply/rollback calls can't interleave reads and
// writes of history.json.
static HISTORY_LOCK: Mutex<()> = Mutex::new(());

/// The rec_ids `apply_recommendation` can one-click apply (anything else is
/// advisory-only). Single backend source of truth — `export` and `priorities`
/// reuse it. MUST stay in sync with the dispatch match in `apply_recommendation`
/// below (and the frontend's APPLIABLE_REC_IDS).
pub(crate) const APPLIABLE_REC_IDS: &[&str] = &[
    "game-mode",
    "visual-effects",
    "sysmain-disable",
    "nvidia-telemetry",
    "power-ultimate",
    "nagle-disable",
    "hags-enable",
    "mouse-accel-off",
    "game-bar-disable",
    "diagtrack-disable",
    "windows-search-disable",
    "fast-startup-off",
    "reserved-storage-off",
    "usb-selective-suspend-off",
    "pcie-aspm-off",
    "eee-disable",
];

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct AppliedChange {
    pub(crate) id: String,
    pub(crate) rec_id: String,
    pub(crate) rec_title: String,
    pub(crate) applied_at: String,
    pub(crate) snapshot: serde_json::Value, // legacy entries: untyped; new entries: typed Snapshot serialized
    pub(crate) status: String, // "applied" | "rolled_back"

    // Additive per ARCHITECTURE_LOCKS Tier 1: rollback contract captured at
    // apply time so rollback survives rule deprecation, catalog changes, CDN
    // outages, and app version mismatches. Optional for compat with old
    // history.json entries written before these fields existed.
    #[serde(default)]
    pub(crate) applied_action: Option<AppliedAction>,
    #[serde(default)]
    pub(crate) rollback_action: Option<RollbackAction>,
    #[serde(default)]
    pub(crate) app_version_at_apply: Option<String>,
    #[serde(default)]
    pub(crate) ruleset_version_at_apply: Option<String>,
    #[serde(default)]
    pub(crate) elevation_used: Option<bool>,
}

// AppliedChange + a freshly-computed `is_still_active` flag. We never persist
// this flag (state changes outside Compy can revert what we applied), so it
// has to be recomputed every time history is read.
#[derive(Serialize)]
pub(crate) struct AppliedChangeView {
    id: String,
    rec_id: String,
    rec_title: String,
    applied_at: String,
    snapshot: serde_json::Value,
    status: String,
    is_still_active: bool,
    applied_action: Option<AppliedAction>,
    rollback_action: Option<RollbackAction>,
    app_version_at_apply: Option<String>,
    ruleset_version_at_apply: Option<String>,
    elevation_used: Option<bool>,
    // Read-only, computed-at-read enrichment (never persisted): a human-readable description of the
    // state a rollback restores, for the Fix surface trust-switch. Derived only from the captured
    // typed snapshot; None → the UI shows the generic "your previous setting".
    restores_label: Option<String>,
}

impl AppliedChangeView {
    /// The change id — what `rollback_change` takes. The benchmark trial runner needs it to undo
    /// the tweak it applied for measurement.
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
}

fn check_change_active(c: &AppliedChange) -> bool {
    match c.rec_id.as_str() {
        "game-mode" => game_mode_enabled(),
        "visual-effects" => visual_effects_for_best_performance(),
        "sysmain-disable" => !service_running("SysMain"),
        "nvidia-telemetry" => !service_running("NvTelemetryContainer"),
        "power-ultimate" => current_power_plan_name()
            .map(|p| p.to_lowercase().contains("ultimate"))
            .unwrap_or(false),
        "nagle-disable" => nagle_disabled_on_any_nic(),
        "hags-enable" => hags_state() == Some(2),
        "mouse-accel-off" => mouse_accel_disabled(),
        "game-bar-disable" => game_bar_disabled(),
        "diagtrack-disable" => !service_running("DiagTrack"),
        "windows-search-disable" => !service_running("WSearch"),
        "fast-startup-off" => fast_startup_state() == Some(0),
        "reserved-storage-off" => !reserved_storage_enabled(),
        "usb-selective-suspend-off" => usb_selective_suspend_off_on_ac(),
        "pcie-aspm-off" => pcie_aspm_off_on_ac(),
        "eee-disable" => eee_disabled_on_any_eligible_adapter(),
        _ => true, // unknown rec → assume still active rather than hide rollback
    }
}

fn into_view(c: AppliedChange) -> AppliedChangeView {
    let is_still_active = if c.status == "applied" {
        check_change_active(&c)
    } else {
        false
    };
    let restores_label = restores_label_from_snapshot(&c.snapshot);
    AppliedChangeView {
        id: c.id,
        rec_id: c.rec_id,
        rec_title: c.rec_title,
        applied_at: c.applied_at,
        snapshot: c.snapshot,
        status: c.status,
        is_still_active,
        applied_action: c.applied_action,
        rollback_action: c.rollback_action,
        app_version_at_apply: c.app_version_at_apply,
        ruleset_version_at_apply: c.ruleset_version_at_apply,
        elevation_used: c.elevation_used,
        restores_label,
    }
}

fn history_path() -> PathBuf {
    compy_data_dir().join("history.json")
}

// load/save are split into path-parameterized cores so the JSON round-trip and
// the corrupt-file-fails-safe behavior are unit-testable without touching the
// real %APPDATA% history file. The no-arg wrappers preserve prior behavior.
fn load_history() -> Vec<AppliedChange> {
    load_history_from(&history_path())
}

fn load_history_from(path: &Path) -> Vec<AppliedChange> {
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_history(h: &[AppliedChange]) -> Result<(), String> {
    std::fs::create_dir_all(compy_data_dir()).map_err(|e| e.to_string())?;
    save_history_to(&history_path(), h)
}

fn save_history_to(path: &Path, h: &[AppliedChange]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(h).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn apply_recommendation(rec_id: String, rec_title: String) -> Result<AppliedChangeView, String> {
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    let result: ApplyResult = match rec_id.as_str() {
        "game-mode" => apply_game_mode()?,
        "visual-effects" => apply_visual_effects()?,
        "sysmain-disable" => apply_service_disable(KnownService::SysMain)?,
        "nvidia-telemetry" => apply_service_disable(KnownService::NvTelemetryContainer)?,
        "power-ultimate" => apply_power_ultimate()?,
        "nagle-disable" => apply_nagle_disable()?,
        "hags-enable" => apply_hags_enable()?,
        "mouse-accel-off" => apply_mouse_accel_off()?,
        "game-bar-disable" => apply_game_bar_disable()?,
        "diagtrack-disable" => apply_service_disable(KnownService::DiagTrack)?,
        "windows-search-disable" => apply_service_disable(KnownService::WSearch)?,
        "fast-startup-off" => apply_fast_startup_off()?,
        "reserved-storage-off" => apply_reserved_storage_off()?,
        "usb-selective-suspend-off" => apply_usb_selective_suspend_off()?,
        "pcie-aspm-off" => apply_pcie_aspm_off()?,
        "eee-disable" => apply_eee_disable()?,
        other => return Err(format!("'{}' is not yet supported for one-click apply", other)),
    };
    let snapshot_json = serde_json::to_value(&result.snapshot)
        .map_err(|e| format!("snapshot serialize: {}", e))?;
    let change = AppliedChange {
        id: format!("{}-{}", rec_id, Utc::now().timestamp_millis()),
        rec_id,
        rec_title,
        applied_at: Utc::now().to_rfc3339(),
        snapshot: snapshot_json,
        status: "applied".into(),
        applied_action: Some(result.applied_action),
        rollback_action: Some(result.rollback_action),
        app_version_at_apply: Some(env!("CARGO_PKG_VERSION").to_string()),
        ruleset_version_at_apply: Some("1.0.0-baseline".to_string()),
        elevation_used: Some(result.elevation_used),
    };
    let mut history = load_history();
    history.push(change.clone());
    save_history(&history)?;
    Ok(into_view(change))
}

#[tauri::command]
pub(crate) fn rollback_change(change_id: String) -> Result<(), String> {
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    let mut history = load_history();
    let idx = history
        .iter()
        .position(|c| c.id == change_id)
        .ok_or_else(|| format!("change '{}' not found in history", change_id))?;
    let change = history[idx].clone();
    if change.status == "rolled_back" {
        return Err("change has already been rolled back".into());
    }

    let (action, snapshot) = resolve_rollback(&change)?;

    dispatch_rollback(&action, &snapshot)?;

    history[idx].status = "rolled_back".into();
    save_history(&history)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_applied_changes() -> Vec<AppliedChangeView> {
    load_history().into_iter().map(into_view).collect()
}

/// Total Trust-Ledger entry count (append-only, so monotonic). Used as a confound watermark by the
/// cross-session comparison engine: if the ledger advanced between arming and the next session,
/// another change landed and the delta can't be honestly attributed.
pub(crate) fn ledger_len() -> usize {
    load_history().len()
}

/// Read-only roll-up of the Trust Ledger for surfaces that need counts rather
/// than the full view (e.g. Game Readiness). `active` = applied AND still active;
/// `externally_reverted` = applied but the live system no longer matches (changed
/// outside Compy). Computed from local history alone, like everything else here.
#[derive(serde::Serialize, Clone, Debug, Default)]
pub(crate) struct AppliedChangesSummary {
    pub(crate) total: usize,
    pub(crate) active: usize,
    pub(crate) rolled_back: usize,
    pub(crate) externally_reverted: usize,
}

pub(crate) fn applied_changes_summary() -> AppliedChangesSummary {
    summarize_history(&load_history())
}

// Collapse history to the LATEST entry per rec_id, then summarize current state.
// Readiness reflects each setting's CURRENT effective state — not every historical
// apply/rollback — so re-applying OR rolling back a setting actually resolves it.
//
// Previously this counted every entry: applying one setting several times, or an
// old "applied" entry later superseded by a rollback of the same setting, lingered
// forever as an unclearable "externally reverted" count. That trapped the user
// below a clean readiness state with no way out (the append-only ledger never lets
// you edit those old records). The full per-entry history still lives in the Trust
// Ledger for audit; readiness just stops being held hostage by it.
fn summarize_history(history: &[AppliedChange]) -> AppliedChangesSummary {
    let mut latest: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (i, c) in history.iter().enumerate() {
        latest.insert(c.rec_id.as_str(), i); // later entries overwrite earlier → newest wins
    }
    let mut s = AppliedChangesSummary::default();
    for &i in latest.values() {
        let c = &history[i];
        s.total += 1;
        if c.status == "rolled_back" {
            s.rolled_back += 1;
        } else if check_change_active(c) {
            s.active += 1;
        } else {
            s.externally_reverted += 1;
        }
    }
    s
}

// ─── Trust Ledger tests ──────────────────────────────────────────────────
//
// History-owned behavior: the recomputed ledger view and the on-disk round
// trip. The typed apply/rollback contract itself is pinned by `safety_tests`
// in lib.rs; here we prove the records persist honestly and fail safe.
#[cfg(test)]
mod history_tests {
    use super::*;
    use serde_json::json;

    fn record(rec_id: &str, status: &str) -> AppliedChange {
        AppliedChange {
            id: format!("{rec_id}-1"),
            rec_id: rec_id.into(),
            rec_title: "title".into(),
            applied_at: "2026-01-01T00:00:00Z".into(),
            snapshot: json!({ "prior": 1 }),
            status: status.into(),
            applied_action: None,
            rollback_action: None,
            app_version_at_apply: None,
            ruleset_version_at_apply: None,
            elevation_used: None,
        }
    }

    #[test]
    fn into_view_copies_fields_and_keeps_unknown_rec_active() {
        // An applied change for a rec we no longer recognize must still render as
        // active — we never hide a rollback behind an unknown rec_id.
        let c = record("a-rec-we-do-not-track", "applied");
        let v = into_view(c.clone());
        assert_eq!(v.id, c.id);
        assert_eq!(v.rec_id, c.rec_id);
        assert_eq!(v.status, "applied");
        assert!(v.is_still_active, "unknown rec must default to still-active");
    }

    #[test]
    fn rolled_back_change_renders_inactive() {
        // Once rolled back, the ledger reports it inactive without consulting the
        // live system — honest history regardless of current machine state.
        let v = into_view(record("game-mode", "rolled_back"));
        assert!(!v.is_still_active);
    }

    #[test]
    fn summary_collapses_multiple_applies_of_one_rec() {
        // The same setting applied twice is ONE setting — not two "active" counts.
        // Unknown rec_id → check_change_active defaults to active.
        let history = vec![record("unknown-x", "applied"), record("unknown-x", "applied")];
        let s = summarize_history(&history);
        assert_eq!(s.total, 1);
        assert_eq!(s.active, 1);
        assert_eq!(s.externally_reverted, 0);
    }

    #[test]
    fn summary_latest_rollback_supersedes_old_applies() {
        // THE loop fix: an old "applied" entry superseded by a later rollback of
        // the same setting must NOT count as "externally reverted" — the setting's
        // latest intent is rolled_back. So re-applying or rolling back always
        // resolves the readiness item, and a clean state is always reachable.
        let history = vec![
            record("unknown-x", "applied"),
            record("unknown-x", "applied"),
            record("unknown-x", "rolled_back"),
        ];
        let s = summarize_history(&history);
        assert_eq!(s.total, 1);
        assert_eq!(s.rolled_back, 1);
        assert_eq!(s.active, 0);
        assert_eq!(s.externally_reverted, 0);
    }

    #[test]
    fn save_then_load_roundtrips_through_disk() {
        let dir =
            std::env::temp_dir().join(format!("compy-hist-roundtrip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        let records = vec![
            record("game-mode", "applied"),
            record("hags-enable", "rolled_back"),
        ];
        save_history_to(&path, &records).unwrap();
        let back = load_history_from(&path);
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].rec_id, "game-mode");
        assert_eq!(back[1].status, "rolled_back");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_history_file_loads_empty() {
        let path = std::env::temp_dir().join("compy-hist-definitely-absent-9z.json");
        let _ = std::fs::remove_file(&path);
        assert!(load_history_from(&path).is_empty());
    }

    #[test]
    fn corrupt_history_file_fails_safe_to_empty() {
        // Garbage on disk must never panic or fabricate entries — it loads as if
        // there were no history, so the app stays usable and nothing is "undone"
        // against a phantom record.
        let path =
            std::env::temp_dir().join(format!("compy-hist-corrupt-{}.json", std::process::id()));
        std::fs::write(&path, b"{ this is not valid json ]]]").unwrap();
        assert!(
            load_history_from(&path).is_empty(),
            "corrupt history must load as empty, not panic"
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn legacy_entry_without_typed_contract_loads_with_none_fields() {
        // Old history.json entries predate the typed apply/rollback contract.
        // They must still load (serde default -> None) or an upgrade would brick
        // existing users' history and strip their ability to roll back.
        let legacy = json!([{
            "id": "game-mode-1",
            "rec_id": "game-mode",
            "rec_title": "Enable Game Mode",
            "applied_at": "2025-01-01T00:00:00Z",
            "snapshot": { "prior": 1 },
            "status": "applied"
        }]);
        let path =
            std::env::temp_dir().join(format!("compy-hist-legacy-{}.json", std::process::id()));
        std::fs::write(&path, serde_json::to_string(&legacy).unwrap()).unwrap();
        let loaded = load_history_from(&path);
        assert_eq!(loaded.len(), 1);
        assert!(loaded[0].applied_action.is_none());
        assert!(loaded[0].rollback_action.is_none());
        assert!(loaded[0].app_version_at_apply.is_none());
        std::fs::remove_file(&path).ok();
    }
}
