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
