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

/// The ONE dispatch from rec id to its audited apply_* — `apply_recommendation` and the §4 batch
/// orchestrator both go through here, so there is no second copy of the match to drift.
fn dispatch_apply(rec_id: &str) -> Result<ApplyResult, String> {
    match rec_id {
        "game-mode" => apply_game_mode(),
        "visual-effects" => apply_visual_effects(),
        "sysmain-disable" => apply_service_disable(KnownService::SysMain),
        "nvidia-telemetry" => apply_service_disable(KnownService::NvTelemetryContainer),
        "power-ultimate" => apply_power_ultimate(),
        "nagle-disable" => apply_nagle_disable(),
        "hags-enable" => apply_hags_enable(),
        "mouse-accel-off" => apply_mouse_accel_off(),
        "game-bar-disable" => apply_game_bar_disable(),
        "diagtrack-disable" => apply_service_disable(KnownService::DiagTrack),
        "windows-search-disable" => apply_service_disable(KnownService::WSearch),
        "fast-startup-off" => apply_fast_startup_off(),
        "reserved-storage-off" => apply_reserved_storage_off(),
        "usb-selective-suspend-off" => apply_usb_selective_suspend_off(),
        "pcie-aspm-off" => apply_pcie_aspm_off(),
        "eee-disable" => apply_eee_disable(),
        other => Err(format!("'{}' is not yet supported for one-click apply", other)),
    }
}

/// Display-title cap for ledger receipts. Titles come from our own catalog (all < 100 chars);
/// the cap is defense-in-depth at the webview trust boundary — a compromised UI must not be able
/// to bloat history.json with megabyte "titles" through the apply commands.
const MAX_REC_TITLE_LEN: usize = 200;

/// Build the full-contract ledger receipt for a completed apply. Shared by the single apply and
/// the batch (identical receipt either way — rollback granularity is per item, unchanged).
fn build_applied_change(
    rec_id: &str,
    rec_title: &str,
    result: ApplyResult,
) -> Result<AppliedChange, String> {
    let snapshot_json = serde_json::to_value(&result.snapshot)
        .map_err(|e| format!("snapshot serialize: {}", e))?;
    Ok(AppliedChange {
        id: format!("{}-{}", rec_id, Utc::now().timestamp_millis()),
        rec_id: rec_id.to_string(),
        rec_title: rec_title.chars().take(MAX_REC_TITLE_LEN).collect(),
        applied_at: Utc::now().to_rfc3339(),
        snapshot: snapshot_json,
        status: "applied".into(),
        applied_action: Some(result.applied_action),
        rollback_action: Some(result.rollback_action),
        app_version_at_apply: Some(env!("CARGO_PKG_VERSION").to_string()),
        ruleset_version_at_apply: Some("1.0.0-baseline".to_string()),
        elevation_used: Some(result.elevation_used),
    })
}

#[tauri::command]
pub(crate) fn apply_recommendation(rec_id: String, rec_title: String) -> Result<AppliedChangeView, String> {
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    let result = dispatch_apply(&rec_id)?;
    let change = build_applied_change(&rec_id, &rec_title, result)?;
    let mut history = load_history();
    history.push(change.clone());
    save_history(&history)?;
    Ok(into_view(change))
}

// ─── §4 one-elevation batch apply (spec 2026-06-06-beta-feedback-3 §4) ──────────────────
// Orchestration ONLY — reuses the audited dispatch_apply / run_elevated_powershell / receipt
// primitives; it introduces no new mutation primitive. One UAC prompt for the whole batch; one
// ledger receipt PER item (rollback granularity unchanged); per-item failure isolation.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchApplyItem {
    pub rec_id: String,
    pub rec_title: String,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct BatchItemOutcome {
    rec_id: String,
    rec_title: String,
    status: String, // "applied" | "skipped"
    reason: Option<String>,
}

#[derive(Serialize, Debug)]
pub(crate) struct BatchApplyReport {
    items: Vec<BatchItemOutcome>,
    applied: usize,
    skipped: usize,
    /// 0 or 1 — the whole point of the batch. Surfaced so the UI/QA can assert it honestly.
    elevation_prompts: usize,
}

fn outcome_applied(rec_id: &str, rec_title: &str) -> BatchItemOutcome {
    BatchItemOutcome {
        rec_id: rec_id.to_string(),
        rec_title: rec_title.to_string(),
        status: "applied".into(),
        reason: None,
    }
}

fn outcome_skipped(rec_id: &str, rec_title: &str, reason: String) -> BatchItemOutcome {
    BatchItemOutcome {
        rec_id: rec_id.to_string(),
        rec_title: rec_title.to_string(),
        status: "skipped".into(),
        reason: Some(reason),
    }
}

/// Pure receipt → outcome mapping (fail-safe direction: ONLY an explicit `ok` receipt earns a
/// ledger entry; `fail` and MISSING are both not-applied). Split out so the failure-isolation
/// contract is unit-testable without elevation.
fn resolve_receipt(receipts: &std::collections::HashMap<String, bool>, rec_id: &str) -> Result<(), String> {
    match receipts.get(rec_id) {
        Some(true) => Ok(()),
        Some(false) => Err(
            "The elevated step failed for this item — it was skipped and nothing was changed for it."
                .to_string(),
        ),
        None => Err(
            "No completion receipt was written for this item — treating it as not applied (nothing is recorded that didn't verifiably happen)."
                .to_string(),
        ),
    }
}

#[tauri::command]
pub(crate) fn apply_recommendations_batch(items: Vec<BatchApplyItem>) -> Result<BatchApplyReport, String> {
    // ── Validation — BEFORE the lock and before any mutation. The whole batch is refused (not
    // partially run) on a malformed request: it indicates a caller bug, not a per-item condition.
    if items.is_empty() {
        return Err("nothing to apply".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for it in &items {
        if !APPLIABLE_REC_IDS.contains(&it.rec_id.as_str()) {
            return Err(format!("'{}' is not appliable", it.rec_id));
        }
        // The one exit-using elevated command would abort sibling items mid-script — and it's
        // moderate-tier, outside the safe batch by design. Hard boundary, not a skip.
        if it.rec_id == "power-ultimate" {
            return Err("'power-ultimate' cannot ride a batch — apply it individually".to_string());
        }
        if !seen.insert(it.rec_id.clone()) {
            return Err(format!("duplicate rec '{}' in batch", it.rec_id));
        }
    }

    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    let mut history = load_history();
    let mut outcomes: Vec<BatchItemOutcome> = Vec::new();
    let mut applied = 0usize;

    struct Deferred {
        rec_id: String,
        rec_title: String,
        result: ApplyResult,
        cmds: std::ops::Range<usize>,
    }
    let mut staged: Vec<Deferred> = Vec::new();

    // ── Phase 1 — every apply runs with the deferral sink armed. Non-elevated recs mutate
    // (HKCU) and receipt immediately, exactly like a single apply. Elevated recs perform their
    // READS and park their one PS command (no partial mutation — see the sink's safety note).
    let all_cmds: Vec<String> = {
        let guard = ElevationDeferral::begin()?;
        let mut cursor = 0usize;
        for it in &items {
            match dispatch_apply(&it.rec_id) {
                Err(e) => outcomes.push(outcome_skipped(&it.rec_id, &it.rec_title, e)),
                Ok(result) => {
                    let now = guard.deferred_count();
                    if now == cursor {
                        // No elevated step → the mutation already happened → honest receipt now.
                        let change = build_applied_change(&it.rec_id, &it.rec_title, result)?;
                        history.push(change);
                        applied += 1;
                        outcomes.push(outcome_applied(&it.rec_id, &it.rec_title));
                    } else {
                        staged.push(Deferred {
                            rec_id: it.rec_id.clone(),
                            rec_title: it.rec_title.clone(),
                            result,
                            cmds: cursor..now,
                        });
                        cursor = now;
                    }
                }
            }
        }
        guard.take_deferred()
    };
    // Persist phase-1 receipts before the elevation step — a cancelled UAC must never cost the
    // non-elevated items their ledger entries.
    if applied > 0 {
        save_history(&history)?;
    }

    // ── Phase 2 — ONE elevation for every deferred command, receipts to a result FILE (data,
    // not code: reading it never executes anything), then a ledger receipt per confirmed item.
    let mut elevation_prompts = 0usize;
    if !staged.is_empty() {
        let receipts_path = compy_data_dir().join(format!(
            "elevation-batch-{}.receipts",
            Utc::now().timestamp_millis()
        ));
        std::fs::create_dir_all(compy_data_dir()).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&receipts_path);
        // Checked (never indexed) command attribution: by construction every staged range lies
        // inside all_cmds, but a panic HERE would poison HISTORY_LOCK for the whole session — so
        // an impossible mismatch aborts the batch BEFORE elevation instead.
        let mut script_items: Vec<(String, Vec<String>)> = Vec::with_capacity(staged.len());
        for d in &staged {
            let cmds = all_cmds.get(d.cmds.clone()).ok_or_else(|| {
                "internal error: deferred-command attribution mismatch — the elevated batch was aborted before anything ran".to_string()
            })?;
            script_items.push((d.rec_id.clone(), cmds.to_vec()));
        }
        let script = compose_batch_script(&script_items, &receipts_path.to_string_lossy())?;
        elevation_prompts = 1;
        match run_elevated_powershell(&script) {
            Err(e) => {
                // UAC declined or the elevated process failed to run: NOTHING elevated was
                // applied. Honest per-item skip; the phase-1 items stand on their own receipts.
                for d in staged {
                    outcomes.push(outcome_skipped(
                        &d.rec_id,
                        &d.rec_title,
                        format!("Elevation did not complete — nothing was changed for this item. ({e})"),
                    ));
                }
            }
            Ok(()) => {
                let text = std::fs::read_to_string(&receipts_path).unwrap_or_default();
                let receipts = parse_batch_receipts(&text);
                for d in staged {
                    match resolve_receipt(&receipts, &d.rec_id) {
                        Ok(()) => {
                            let change = build_applied_change(&d.rec_id, &d.rec_title, d.result)?;
                            history.push(change);
                            applied += 1;
                            outcomes.push(outcome_applied(&d.rec_id, &d.rec_title));
                        }
                        Err(reason) => {
                            outcomes.push(outcome_skipped(&d.rec_id, &d.rec_title, reason))
                        }
                    }
                }
                save_history(&history)?;
            }
        }
        let _ = std::fs::remove_file(&receipts_path);
    }

    let skipped = outcomes.iter().filter(|o| o.status == "skipped").count();
    Ok(BatchApplyReport {
        items: outcomes,
        applied,
        skipped,
        elevation_prompts,
    })
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
mod batch_apply_tests {
    use super::*;

    fn item(rec_id: &str) -> BatchApplyItem {
        BatchApplyItem {
            rec_id: rec_id.into(),
            rec_title: format!("title for {rec_id}"),
        }
    }

    // Validation refuses the WHOLE batch before any lock/mutation — these run the real command
    // function safely because every rejection path returns before phase 1.
    #[test]
    fn batch_refuses_empty_unknown_duplicate_and_power_ultimate() {
        assert!(apply_recommendations_batch(vec![]).is_err(), "empty");
        assert!(
            apply_recommendations_batch(vec![item("not-a-real-rec")]).is_err(),
            "unknown id must refuse the batch"
        );
        assert!(
            apply_recommendations_batch(vec![item("fast-startup-off"), item("fast-startup-off")])
                .is_err(),
            "duplicate ids must refuse the batch"
        );
        let err = apply_recommendations_batch(vec![item("hags-enable"), item("power-ultimate")])
            .expect_err("power-ultimate is the exit-using elevated command — never batchable");
        assert!(err.contains("power-ultimate"));
    }

    // Pins the webview-side arg shape: the frontend sends camelCase items; a drift here would
    // fail silently at runtime (Tauri arg deserialization), so the contract is a test.
    #[test]
    fn batch_item_deserializes_from_the_frontend_camel_case_shape() {
        let it: BatchApplyItem =
            serde_json::from_str(r#"{"recId":"fast-startup-off","recTitle":"Disable Fast Startup"}"#)
                .expect("camelCase arg shape");
        assert_eq!(it.rec_id, "fast-startup-off");
        assert_eq!(it.rec_title, "Disable Fast Startup");
    }

    // The fail-safe receipt contract: ONLY an explicit ok earns a ledger entry; an explicit fail
    // and a MISSING receipt are both not-applied. (The PS-level isolation proof lives in
    // actions::batch_elevation_tests::real_powershell_batch_isolates_a_failing_item.)
    #[test]
    fn receipt_resolution_is_fail_safe() {
        let mut receipts = std::collections::HashMap::new();
        receipts.insert("alpha".to_string(), true);
        receipts.insert("bravo".to_string(), false);
        assert!(resolve_receipt(&receipts, "alpha").is_ok());
        let failed = resolve_receipt(&receipts, "bravo").expect_err("explicit fail");
        assert!(failed.contains("skipped"));
        let missing = resolve_receipt(&receipts, "charlie").expect_err("missing receipt");
        assert!(missing.contains("not applied"));
    }

    // The UAC-cancel / elevation-failure arm, proven deterministically (no real prompt): with
    // elevation forced to fail, EVERY deferred (elevated) item is skipped with the honest "did not
    // complete" reason and NOTHING is ledgered for them. Uses two elevated recs so phase 1 mutates
    // nothing (they only read + defer), keeping this test side-effect-free on the real system.
    #[test]
    fn elevation_failure_skips_every_deferred_item_honestly() {
        let _force = ForceElevationError::begin();
        let before = load_history();
        let before_ids: std::collections::HashSet<String> =
            before.iter().map(|c| c.id.clone()).collect();
        let report = apply_recommendations_batch(vec![
            item("fast-startup-off"),
            item("hags-enable"),
        ])
        .expect("a failed elevation is per-item skips, never a batch-level error");
        assert_eq!(report.elevation_prompts, 1, "one elevation was attempted");
        assert_eq!(report.applied, 0, "nothing applied when elevation fails");
        assert_eq!(report.skipped, 2, "both deferred items skipped");
        for o in &report.items {
            assert_eq!(o.status, "skipped");
            assert!(
                o.reason.as_deref().unwrap_or("").contains("Elevation did not complete"),
                "honest cancel reason"
            );
        }
        // Fail-safe: no NEW ledger entry for either elevated item.
        let after = load_history();
        let new_count = after.iter().filter(|c| !before_ids.contains(&c.id)).count();
        assert_eq!(new_count, 0, "a cancelled elevation must ledger nothing");
    }

    // The shared receipt builder writes the FULL rollback contract — batch receipts are
    // byte-equivalent in shape to single-apply receipts (rollback granularity unchanged).
    #[test]
    fn batch_receipts_carry_the_full_rollback_contract() {
        let result = ApplyResult {
            applied_action: AppliedAction::DisableFastStartup,
            rollback_action: RollbackAction::RestoreFastStartupFromSnapshot,
            snapshot: Snapshot::FastStartup {
                prior_hiberboot: Some(1),
            },
            elevation_used: true,
        };
        let c = build_applied_change("fast-startup-off", "Disable Fast Startup", result)
            .expect("build");
        assert_eq!(c.rec_id, "fast-startup-off");
        assert_eq!(c.status, "applied");
        assert!(c.applied_action.is_some());
        assert!(c.rollback_action.is_some());
        assert_eq!(c.elevation_used, Some(true));
        assert_eq!(
            c.snapshot.get("kind").and_then(|k| k.as_str()),
            Some("fast-startup"),
            "typed snapshot serialized with its tag"
        );
    }

    // Defense-in-depth at the webview boundary: a receipt title is capped so a compromised UI
    // can't bloat history.json through the apply commands. Real catalog titles are untouched.
    #[test]
    fn receipt_titles_are_capped_but_real_titles_untouched() {
        let result = || ApplyResult {
            applied_action: AppliedAction::DisableFastStartup,
            rollback_action: RollbackAction::RestoreFastStartupFromSnapshot,
            snapshot: Snapshot::FastStartup { prior_hiberboot: Some(1) },
            elevation_used: true,
        };
        let real = "Disable Fast Startup";
        let c = build_applied_change("fast-startup-off", real, result()).expect("build");
        assert_eq!(c.rec_title, real, "a real catalog title passes through unchanged");
        let huge = "x".repeat(1_000_000);
        let c = build_applied_change("fast-startup-off", &huge, result()).expect("build");
        assert_eq!(c.rec_title.chars().count(), MAX_REC_TITLE_LEN, "a hostile title is capped");
    }
}

// §4 ELEVATION QA harness (owner-present, REAL UAC — never runs in the normal suite).
// Run explicitly, one test at a time, with a human at the Secure Desktop:
//   cargo test --manifest-path src-tauri/Cargo.toml manual_qa_batch -- --ignored --nocapture --test-threads=1
//   cargo test --manifest-path src-tauri/Cargo.toml manual_qa_uac_cancel -- --ignored --nocapture --test-threads=1
// These intentionally drive the PRODUCTION batch path end to end: real elevation, real registry
// writes (idempotent values), real %APPDATA%\Compy\history.json receipts. The dev build's Trust
// Ledger shows the entries live. Items chosen are safe-tier + guaranteed-idempotent writes.
#[cfg(test)]
mod manual_elevation_qa {
    use super::*;

    fn qa_item(rec_id: &str, rec_title: &str) -> BatchApplyItem {
        BatchApplyItem {
            rec_id: rec_id.into(),
            rec_title: rec_title.into(),
        }
    }

    /// Step 1 + 2 of the QA loop. TWO UAC prompts, click YES on both:
    /// prompt #1 = the whole batch (the one-elevation claim), prompt #2 = the single rollback.
    #[test]
    #[ignore = "manual §4 elevation QA — real UAC; click YES twice"]
    fn manual_qa_batch_one_prompt_receipts_and_per_item_rollback() {
        let before = load_history().len();
        let report = apply_recommendations_batch(vec![
            qa_item("fast-startup-off", "QA · Disable Fast Startup"),
            qa_item("hags-enable", "QA · Enable HAGS"),
        ])
        .expect("the batch must run (did the first UAC prompt get a YES?)");
        println!("BATCH REPORT: {report:?}");
        assert_eq!(report.elevation_prompts, 1, "ONE UAC prompt for the whole batch");
        assert_eq!(report.applied, 2, "both elevated items applied");
        assert_eq!(report.skipped, 0, "nothing skipped");

        // One full-contract receipt PER item.
        let after = load_history();
        assert_eq!(after.len(), before + 2, "exactly one ledger receipt per item");
        for rec in ["fast-startup-off", "hags-enable"] {
            let c = after
                .iter()
                .rev()
                .find(|c| c.rec_id == rec && c.rec_title.starts_with("QA · "))
                .expect("QA receipt present");
            assert_eq!(c.status, "applied");
            assert!(c.applied_action.is_some() && c.rollback_action.is_some());
            assert_eq!(c.elevation_used, Some(true));
        }

        // Per-item rollback granularity: roll back ONE (HAGS) — second UAC prompt, click YES.
        let hags_id = after
            .iter()
            .rev()
            .find(|c| c.rec_id == "hags-enable" && c.status == "applied")
            .expect("hags QA entry")
            .id
            .clone();
        rollback_change(hags_id.clone())
            .expect("rollback must run (did the second UAC prompt get a YES?)");
        let post = load_history();
        let hags = post.iter().find(|c| c.id == hags_id).expect("hags entry");
        assert_eq!(hags.status, "rolled_back", "the rolled-back item flips");
        let fast = post
            .iter()
            .rev()
            .find(|c| c.rec_id == "fast-startup-off" && c.rec_title.starts_with("QA · "))
            .expect("fast-startup QA entry");
        assert_eq!(fast.status, "applied", "the sibling STAYS applied");
        assert_eq!(crate::hags_state(), Some(2), "exact prior state restored");
        assert_eq!(crate::fast_startup_state(), Some(0), "sibling state intact");
        println!("STEP 1+2 PASS: one prompt, per-item receipts, per-item rollback.");
    }

    /// Step 3 of the QA loop. ONE UAC prompt — click NO (cancel).
    #[test]
    #[ignore = "manual §4 elevation QA — real UAC; click NO (cancel)"]
    fn manual_qa_uac_cancel_is_honest_per_item() {
        let before = load_history().len();
        let report = apply_recommendations_batch(vec![
            qa_item("game-bar-disable", "QA · Game Bar off"), // non-elevated (HKCU)
            qa_item("fast-startup-off", "QA · Fast Startup"), // elevated — CANCEL its prompt
        ])
        .expect("a cancelled elevation is a per-item skip, never a batch error");
        println!("CANCEL REPORT: {report:?}");
        assert_eq!(report.elevation_prompts, 1);
        assert_eq!(report.applied, 1, "the non-elevated item still applied");
        assert_eq!(report.skipped, 1, "the elevated item skipped");
        let skipped = report
            .items
            .iter()
            .find(|i| i.status == "skipped")
            .expect("one skipped item");
        assert_eq!(skipped.rec_id, "fast-startup-off");
        let reason = skipped.reason.as_deref().unwrap_or("");
        assert!(
            reason.contains("Elevation did not complete"),
            "honest reason, got: {reason}"
        );
        let after = load_history();
        assert_eq!(after.len(), before + 1, "ONLY the non-elevated receipt landed");
        assert_eq!(
            crate::fast_startup_state(),
            Some(0),
            "cancelled item: nothing was changed (state from the earlier applies stands)"
        );
        println!("STEP 3 PASS: cancel = honest per-item skip; non-elevated item ledgered.");
    }
}

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
