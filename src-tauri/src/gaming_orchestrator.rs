//! Gaming Mode (F1) imperative orchestration: capture -> write file -> apply
//! the core bundle -> restore from contract. Keeps `gaming_session.rs` pure.
//! The ONLY mutation it performs is through audited `actions.rs` `apply_*` /
//! `dispatch_rollback` functions plus the non-elevated power-plan helpers.
//!
//! Fail-safe ordering (the crash-safe invariant): the session file is written
//! BEFORE each mutation is recorded, and is deleted ONLY after a restore is
//! fully confirmed. A crash at any point therefore leaves a resolvable
//! contract on disk for startup recovery.

use serde::Deserialize;

use crate::actions::{
    self, apply_game_bar_disable, apply_game_mode, apply_pcie_aspm_off, apply_power_plan_switch_core,
    apply_usb_selective_suspend_off, restore_power_plan_unelevated, ApplyResult, RollbackAction,
    Snapshot,
};
use crate::gaming_session::{
    clear_session, load_session, needs_recovery, next_on_stop, resolve_restore_order, save_session,
    SessionChange, SessionFile, SessionStatus, SESSION_SCHEMA_VERSION,
};

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartOptions {
    #[serde(default)]
    pub(crate) advanced_usb: bool,
    #[serde(default)]
    pub(crate) advanced_pcie: bool,
}

fn push(changes: &mut Vec<SessionChange>, label: &str, r: ApplyResult) {
    changes.push(SessionChange {
        label: label.to_string(),
        rollback_action: r.rollback_action,
        snapshot: r.snapshot,
        elevated_restore: r.elevation_used,
    });
}

/// Start a session. Writes the (empty) contract first so the on-disk lock
/// exists before any mutation, then applies the core bundle, persisting after
/// each change. Advanced opt-in items (UAC) apply last. On any apply error,
/// the partial contract is already on disk; we transition to RestorePending,
/// undo what landed, and return the error.
pub(crate) fn start(opts: StartOptions) -> Result<SessionFile, String> {
    if load_session().is_some() {
        return Err("a Gaming Mode session already exists — recover it first".into());
    }
    let now = chrono::Utc::now();
    let mut file = SessionFile {
        schema_version: SESSION_SCHEMA_VERSION,
        session_id: format!("gm-{}", now.timestamp_millis()),
        status: SessionStatus::Active,
        started_at: now.to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        changes: vec![],
        started_monitoring: false,
    };
    save_session(&file)?; // lock exists before any mutation

    // Apply one item; on error, undo whatever landed and bail. Defined as a
    // closure-like macro so each step shares the same partial-undo path.
    macro_rules! apply_step {
        ($label:expr, $result:expr) => {{
            match $result {
                Ok(r) => {
                    push(&mut file.changes, $label, r);
                    save_session(&file)?;
                }
                Err(e) => {
                    file.status = SessionStatus::RestorePending;
                    let _ = save_session(&file);
                    let _ = restore(&mut file); // best-effort undo of partial state
                    return Err(format!("{}: {}", $label, e));
                }
            }
        }};
    }

    // Core (UAC-free). Power plan may skip (Ok(None)) with no error.
    match apply_power_plan_switch_core() {
        Ok(Some(r)) => {
            push(&mut file.changes, "Power plan → max performance", r);
            save_session(&file)?;
        }
        Ok(None) => {}
        Err(e) => {
            file.status = SessionStatus::RestorePending;
            let _ = save_session(&file);
            let _ = restore(&mut file);
            return Err(format!("Power plan: {}", e));
        }
    }
    apply_step!("Windows Game Mode on", apply_game_mode());
    apply_step!("Game Bar / DVR off", apply_game_bar_disable());

    // Advanced opt-in tier (each introduces the UAC prompt).
    if opts.advanced_usb {
        apply_step!(
            "USB selective suspend off (AC)",
            apply_usb_selective_suspend_off()
        );
    }
    if opts.advanced_pcie {
        apply_step!("PCIe ASPM off (AC)", apply_pcie_aspm_off());
    }

    Ok(file)
}

/// Restore every captured change in reverse order, resolving from the stored
/// contract alone. Power plan uses the NON-elevated path; everything else uses
/// the audited `dispatch_rollback`. Idempotent (safe to re-run after a partial
/// failure). On any failure -> RestoreFailed, contract retained, returns Err
/// (NEVER reports success). Clears the file only after every restore confirms.
pub(crate) fn restore(file: &mut SessionFile) -> Result<(), String> {
    file.status = next_on_stop(file.status); // -> Ending
    save_session(file)?;
    let mut first_err: Option<String> = None;
    for change in resolve_restore_order(&file.changes) {
        let res = match (&change.rollback_action, &change.snapshot) {
            (RollbackAction::RestorePowerPlanFromSnapshot, Snapshot::PowerPlan { prior_guid }) => {
                restore_power_plan_unelevated(prior_guid)
            }
            // All other audited changes restore via the shared typed dispatcher.
            (action, snapshot) => actions::dispatch_rollback(action, snapshot),
        };
        if let Err(e) = res {
            first_err.get_or_insert(format!("{}: {}", change.label, e));
        }
    }
    if let Some(e) = first_err {
        file.status = SessionStatus::RestoreFailed;
        save_session(file)?;
        return Err(e);
    }
    clear_session()?; // only after every restore confirmed
    Ok(())
}

/// Startup probe: returns an orphaned session (if any) so the UI can PROMPT.
/// Does NOT restore — recovery is user-confirmed only.
pub(crate) fn detect_orphan() -> Option<SessionFile> {
    load_session().filter(|f| needs_recovery(f.status))
}

/// User-confirmed recovery -> restore from the stored contract. If the user
/// declines, the contract is LEFT in place (never silently cleared).
pub(crate) fn recover(confirm: bool) -> Result<(), String> {
    if !confirm {
        return Ok(());
    }
    let mut file = load_session().ok_or("no session to recover")?;
    restore(&mut file)
}

/// Normal end of a live session.
pub(crate) fn stop() -> Result<(), String> {
    let mut file = load_session().ok_or("no active Gaming Mode session")?;
    restore(&mut file)
}

// ─── §7 mutation-QA harness (dev-rig only) ───────────────────────────────────
// Drives the orchestrator DIRECTLY (bypasses the command-layer `gaming_mode_gate`; never flips it).
// Every test is `#[ignore]`d because it MUTATES the live system (power plan / Game Mode / Game Bar)
// and restores it — so it runs only on a real UAC-on dev rig, never in CI. Ground truth is read from
// the actual registry / powercfg and asserted, with evidence printed. Each test runs start→restore
// BEFORE asserting, so a failed assertion never leaves the rig mutated. Run (owner-present), serial:
//   cargo test --manifest-path src-tauri/Cargo.toml gaming_mode_qa -- --ignored --nocapture --test-threads=1
// Covers the non-reboot §7 matrix; PC-reboot-while-active + the final gate flip stay owner-driven.
#[cfg(test)]
mod gaming_mode_qa {
    use super::*;
    use crate::gaming_session::{clear_session, load_session, SessionStatus};

    /// (active power-plan GUID, Game Mode on?, Game Bar/DVR off?) — the live ground truth.
    fn snapshot() -> (Option<String>, bool, bool) {
        (
            crate::actions::current_power_plan_guid(),
            crate::game_mode_enabled(),
            crate::game_bar_disabled(),
        )
    }

    /// Refuse to run if a prior session is on disk — clean state is required so we never restore to
    /// a contaminated baseline. (If this fires, recover the orphan first.)
    fn require_clean() {
        assert!(
            load_session().is_none(),
            "a Gaming Mode session file already exists — recover/clear it before QA"
        );
    }

    #[test]
    #[ignore = "mutates the live system; dev-rig QA only"]
    fn qa1_normal_cycle_restores_exact_prior_state() {
        require_clean();
        let before = snapshot();
        eprintln!(
            "[QA1] before   : plan={:?} game_mode_on={} game_bar_off={}",
            before.0, before.1, before.2
        );

        let started = start(StartOptions::default());
        let applied = snapshot();
        eprintln!(
            "[QA1] applied  : plan={:?} game_mode_on={} game_bar_off={} (changes={})",
            applied.0,
            applied.1,
            applied.2,
            started.as_ref().map(|f| f.changes.len()).unwrap_or(0)
        );

        // ALWAYS restore before asserting, so a failed assert can't leave the rig mutated.
        let stop_res = stop();
        let after = snapshot();
        eprintln!(
            "[QA1] restored : plan={:?} game_mode_on={} game_bar_off={}",
            after.0, after.1, after.2
        );

        started.expect("start() should succeed on a UAC-free core bundle");
        // The core bundle's job: Game Mode ON + Game Bar/DVR OFF while active.
        assert!(applied.1, "Game Mode should be ON after start");
        assert!(applied.2, "Game Bar/DVR should be OFF after start");
        stop_res.expect("stop()/restore should succeed");
        // Exact prior state restored, contract cleared.
        assert!(load_session().is_none(), "session file must be cleared after a confirmed restore");
        assert_eq!(after.0, before.0, "power plan not restored to the EXACT prior GUID");
        assert_eq!(after.1, before.1, "Game Mode not restored to its prior value");
        assert_eq!(after.2, before.2, "Game Bar/DVR not restored to its prior value");

        let _ = clear_session(); // belt-and-suspenders
    }

    #[test]
    #[ignore = "mutates the live system; dev-rig QA only"]
    fn qa2_crash_then_orphan_recovery_restores() {
        require_clean();
        let before = snapshot();
        eprintln!("[QA2] before   : plan={:?} game_mode_on={} game_bar_off={}", before.0, before.1, before.2);

        // Simulate a CRASH: start, then DON'T call stop() — the session file is left Active on disk,
        // exactly as a killed process would leave it.
        start(StartOptions::default()).expect("start() should succeed");
        assert!(
            matches!(detect_orphan().map(|f| f.status), Some(SessionStatus::Active)),
            "an Active session left on disk must be detected as an orphan to recover"
        );

        // Startup recovery (user-confirmed) restores from the on-disk contract.
        let recovered = recover(true);
        let after = snapshot();
        eprintln!("[QA2] recovered: plan={:?} game_mode_on={} game_bar_off={}", after.0, after.1, after.2);

        recovered.expect("recover(true) should restore from the orphaned contract");
        assert!(load_session().is_none(), "contract must be cleared after recovery");
        assert_eq!(after, before, "crash-recovery must restore the EXACT prior state");

        let _ = clear_session();
    }

    #[test]
    #[ignore = "mutates the live system; dev-rig QA only"]
    fn qa5_uac_cancel_during_start_leaves_no_partial_state() {
        require_clean();
        let before = snapshot();
        eprintln!("[QA5] before: plan={:?} game_mode_on={} game_bar_off={}", before.0, before.1, before.2);

        // Force elevation to FAIL (simulates the user cancelling the UAC prompt) while requesting the
        // elevated advanced tier. The UAC-free core applies first; the elevated USB step is refused,
        // so start() must undo the partial core and surface an error — never a partial Active state.
        let res = {
            let _force = crate::actions::ForceElevationError::begin();
            start(StartOptions { advanced_usb: true, advanced_pcie: false })
        };
        let after = snapshot();
        eprintln!("[QA5] after : plan={:?} game_mode_on={} game_bar_off={} err={}", after.0, after.1, after.2, res.is_err());

        assert!(res.is_err(), "a cancelled elevation during start must surface as an error");
        assert!(load_session().is_none(), "no contract should remain after a cancelled start (partial undone + cleared)");
        assert_eq!(after, before, "a cancelled start must leave NO partial mutation — exact prior state");
        let _ = clear_session();
    }

    #[test]
    #[ignore = "writes a session fixture; dev-rig QA only"]
    fn qa7_missing_power_plan_at_restore_fails_loudly() {
        use crate::actions::{RollbackAction, Snapshot};
        use crate::gaming_session::{save_session, SessionChange, SessionFile, SESSION_SCHEMA_VERSION};
        require_clean();

        // A contract whose stored prior plan no longer exists (a valid-shaped GUID that isn't real).
        // restore_power_plan_unelevated checks existence BEFORE switching, so nothing is mutated — it
        // must fail loudly and RETAIN the contract, never report a false success.
        let bogus = "00000000-0000-0000-0000-000000000000";
        let mut file = SessionFile {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: "qa7".into(),
            status: SessionStatus::Active,
            started_at: chrono::Utc::now().to_rfc3339(),
            app_version: "qa".into(),
            changes: vec![SessionChange {
                label: "Power plan (missing prior)".into(),
                rollback_action: RollbackAction::RestorePowerPlanFromSnapshot,
                snapshot: Snapshot::PowerPlan { prior_guid: bogus.into() },
                elevated_restore: false,
            }],
            started_monitoring: false,
        };
        save_session(&file).expect("save fixture");

        let res = restore(&mut file);
        eprintln!("[QA7] restore result: {:?}", res);
        assert!(res.is_err(), "restore must FAIL LOUDLY when the prior plan is gone — never a false success");
        assert!(
            res.as_ref().unwrap_err().contains("no longer exists"),
            "the error should clearly name the missing plan"
        );
        assert_eq!(file.status, SessionStatus::RestoreFailed, "status must be RestoreFailed");
        assert!(load_session().is_some(), "the contract must be RETAINED after a failed restore");
        let _ = clear_session();
    }

    #[test]
    #[ignore = "writes a session fixture; dev-rig QA only"]
    fn qa6_uac_cancel_during_restore_fails_loudly_and_retains() {
        use crate::actions::{ForceElevationError, RollbackAction, Snapshot};
        use crate::gaming_session::{save_session, SessionChange, SessionFile, SESSION_SCHEMA_VERSION};
        require_clean();

        // A contract with an ELEVATED change (USB selective suspend restores via an elevated powercfg).
        // ForceElevationError refuses the elevation BEFORE any mutation, so nothing changes on the rig —
        // this proves only the RestoreFailed / retained / never-false-success path on a cancelled restore.
        let mut file = SessionFile {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: "qa6".into(),
            status: SessionStatus::Active,
            started_at: chrono::Utc::now().to_rfc3339(),
            app_version: "qa".into(),
            changes: vec![SessionChange {
                label: "USB selective suspend (AC)".into(),
                rollback_action: RollbackAction::RestorePowerPlanSettingFromSnapshot,
                snapshot: Snapshot::PowerPlanSetting {
                    plan_guid: "db9dd473-74ff-4582-ba26-39eaf4cdac4a".into(),
                    subgroup_guid: "2a737441-1930-4402-8d77-b2bebba308a3".into(),
                    setting_guid: "48e6b7a6-50f5-4782-a5d4-53bb8f07e226".into(),
                    prior_ac_value: 1,
                    prior_dc_value: 1,
                },
                elevated_restore: true,
            }],
            started_monitoring: false,
        };
        save_session(&file).expect("save fixture");

        let res = {
            let _force = ForceElevationError::begin();
            restore(&mut file)
        };
        eprintln!("[QA6] restore result: {:?}", res);
        assert!(res.is_err(), "a cancelled elevation during restore must FAIL — never a false success");
        assert_eq!(file.status, SessionStatus::RestoreFailed, "status must be RestoreFailed");
        assert!(load_session().is_some(), "the contract must be RETAINED for a later retry");
        let _ = clear_session();
    }
}
