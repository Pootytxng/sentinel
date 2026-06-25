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
use std::sync::Mutex;

use crate::actions::{
    self, apply_game_bar_disable, apply_game_mode, apply_pcie_aspm_off, apply_power_plan_switch_core,
    apply_usb_selective_suspend_off, restore_power_plan_unelevated, ApplyResult, RollbackAction,
    Snapshot,
};
use crate::gaming_session::{
    clear_session, load_session, needs_recovery, next_on_stop, resolve_restore_order, save_session,
    SessionChange, SessionFile, SessionStatus, SESSION_SCHEMA_VERSION,
};

/// In-memory marker of the session id THIS process started. Lets us tell an
/// in-run remount (tab switch → resume the live session) apart from an on-disk
/// `Active` session left behind by a prior run that died — reboot or crash
/// (→ offer recovery, never silently resume as "on"). A fresh process starts at
/// `None`, so any `Active` session found on disk is correctly an orphan to recover.
static LIVE_SESSION: Mutex<Option<String>> = Mutex::new(None);

fn set_live_session(id: &str) {
    if let Ok(mut g) = LIVE_SESSION.lock() {
        *g = Some(id.to_string());
    }
}

fn clear_live_session() {
    if let Ok(mut g) = LIVE_SESSION.lock() {
        *g = None;
    }
}

/// Pure: a disk session is "live this run" only when its id matches the id THIS
/// process recorded at start. Either side absent → not live (→ recover).
fn same_session(disk: Option<&str>, live: Option<&str>) -> bool {
    matches!((disk, live), (Some(d), Some(l)) if d == l)
}

/// Whether the current on-disk session was started by THIS process run (vs a
/// prior run that died). Drives the resume-vs-recover decision in the UI: a live
/// session resumes; an orphan from a dead run is offered for recovery instead.
pub(crate) fn session_is_live_this_run() -> bool {
    let live = LIVE_SESSION.lock().ok().and_then(|g| g.clone());
    same_session(
        load_session().map(|f| f.session_id).as_deref(),
        live.as_deref(),
    )
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartOptions {
    #[serde(default)]
    pub(crate) advanced_usb: bool,
    #[serde(default)]
    pub(crate) advanced_pcie: bool,
    /// Optional allowlisted services to SUSPEND for this session (BUILT DARK — gated by
    /// `service_suspend_gate()`). Absent / empty for every current caller (serde default), so the
    /// gaming session is unchanged until both the gate is armed AND a picker surfaces these.
    #[serde(default)]
    pub(crate) suspend_services: Vec<String>,
}

/// PURE: the allowlisted services to suspend this session. Empty when the feature is gated off (dark)
/// — so the gaming session is byte-identical to before — or when a requested name isn't on the
/// `KnownService` allowlist (off-list / critical services can never reach the suspend primitive).
/// DEDUPLICATED: the result is bounded to the allowlist size (≤4) regardless of input length, so a
/// compromised webview can't flood UAC / repeated elevations with a giant or duplicate-laden list.
fn services_to_suspend(opts: &StartOptions, gate_open: bool) -> Vec<actions::KnownService> {
    if !gate_open {
        return vec![];
    }
    let mut out: Vec<actions::KnownService> = vec![];
    for name in &opts.suspend_services {
        if let Some(svc) = actions::KnownService::from_name(name) {
            if !out.contains(&svc) {
                out.push(svc);
            }
        }
    }
    out
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
    set_live_session(&file.session_id); // mark this run as the live owner

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
                    // Best-effort undo of partial state. If the undo ITSELF fails, the session is
                    // left RestoreFailed + orphan-recoverable — say so rather than implying a clean
                    // failure. Honesty doctrine: never mislead about whether the system was left
                    // changed. (A core step refusing mid-bundle is now reachable via the unreadable-
                    // prior fail-safe, not just UAC-cancel.)
                    let mut msg = format!("{}: {}", $label, e);
                    if let Err(undo_err) = restore(&mut file) {
                        msg.push_str(&format!(
                            " — and undoing the partial session also failed ({undo_err}); \
                             your system may still be changed. Recover it from the prompt next launch."
                        ));
                    }
                    return Err(msg);
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

    // Session service-suspend (BUILT DARK — gated by service_suspend_gate()). When the gate is closed
    // `services_to_suspend` returns empty, so this loop never runs and the session is byte-identical to
    // before. Each suspend rides the SAME session contract (Snapshot::Service + ResumeServiceFromSnapshot),
    // so resume happens automatically on stop / restore / crash-recovery — no new restore path. Only
    // allowlisted services reach the primitive (the picker is an arming-time follow-up).
    for svc in services_to_suspend(&opts, actions::service_suspend_gate()) {
        let label = format!("Suspend {} for this session", svc.name());
        apply_step!(&label, actions::apply_service_suspend(svc));
    }

    Ok(file)
}

/// Restore every captured change in reverse order, resolving from the stored
/// contract alone. Power plan uses the NON-elevated path; everything else uses
/// the audited `dispatch_rollback`. Idempotent (safe to re-run after a partial
/// failure). On any failure -> RestoreFailed, contract retained, returns Err
/// (NEVER reports success). Clears the file only after every restore confirms.
pub(crate) fn restore(file: &mut SessionFile) -> Result<(), String> {
    clear_live_session(); // this session is ending/recovering — no longer resumable
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

#[cfg(test)]
mod live_session_tests {
    use super::same_session;

    // The resume-vs-recover decision: a disk session is "live this run" ONLY when
    // its id matches the id THIS process recorded at start.
    #[test]
    fn live_only_when_this_run_owns_the_disk_session() {
        // Same id, same run: a tab-switch remount → resume.
        assert!(same_session(Some("gm-1"), Some("gm-1")));
        // Fresh process (reboot/crash): no in-memory owner → orphan, offer recovery.
        assert!(!same_session(Some("gm-1"), None));
        // Stale id mismatch (shouldn't happen, but never resume someone else's).
        assert!(!same_session(Some("gm-1"), Some("gm-2")));
        // No disk session at all.
        assert!(!same_session(None, Some("gm-1")));
        assert!(!same_session(None, None));
    }
}

#[cfg(test)]
mod service_suspend_integration_tests {
    use super::*;
    use crate::actions::{KnownService, RollbackAction, Snapshot};
    use crate::gaming_session::{
        parse_session_json, resolve_restore_order, SessionChange, SessionFile, SessionStatus,
        SESSION_SCHEMA_VERSION,
    };

    #[test]
    fn gate_closed_suspends_nothing_even_when_requested() {
        let opts = StartOptions {
            suspend_services: vec!["WSearch".into(), "SysMain".into()],
            ..Default::default()
        };
        // DARK: gate closed → empty → the gaming session stays byte-identical to before.
        assert!(services_to_suspend(&opts, false).is_empty());
    }

    #[test]
    fn gate_open_maps_allowlisted_and_drops_offlist() {
        let opts = StartOptions {
            suspend_services: vec![
                "WSearch".into(),     // allowlisted
                "lsass".into(),       // critical → dropped
                "NotAService".into(), // unknown → dropped
                "SysMain".into(),     // allowlisted
                "WSearch".into(),     // duplicate → deduped (bounds UAC/elevation count)
            ],
            ..Default::default()
        };
        // Order preserved; only allowlisted survive (critical/unknown never reach the primitive); the
        // duplicate is collapsed so the result is bounded to the allowlist size regardless of input.
        assert_eq!(
            services_to_suspend(&opts, true),
            vec![KnownService::WSearch, KnownService::SysMain]
        );
    }

    #[test]
    fn giant_or_duplicate_list_is_bounded_to_the_allowlist_size() {
        // A compromised webview sending a flood can't drive a flood of elevations: dedup + allowlist
        // cap the result at the 4 known services no matter how long the input is.
        let opts = StartOptions {
            suspend_services: vec!["WSearch".to_string(); 10_000],
            ..Default::default()
        };
        assert_eq!(services_to_suspend(&opts, true), vec![KnownService::WSearch]);
    }

    #[test]
    fn start_options_deserializes_camel_case_and_defaults_empty() {
        let with: StartOptions = serde_json::from_str(r#"{"suspendServices":["WSearch"]}"#).unwrap();
        assert_eq!(with.suspend_services, vec!["WSearch".to_string()]);
        // Every existing caller omits the field → serde default empty → no behavior change.
        let without: StartOptions = serde_json::from_str("{}").unwrap();
        assert!(without.suspend_services.is_empty());
        assert!(!without.advanced_usb && !without.advanced_pcie);
    }

    #[test]
    fn service_change_round_trips_through_session_file_no_schema_bump() {
        // A suspend rides the EXISTING SessionFile shape (no SESSION_SCHEMA_VERSION change): the
        // Service snapshot + ResumeServiceFromSnapshot already serialize (shipped with the primitive).
        let file = SessionFile {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: "gm-svc".into(),
            status: SessionStatus::Active,
            started_at: "2026-06-22T00:00:00Z".into(),
            app_version: "0.1.0".into(),
            changes: vec![
                SessionChange {
                    label: "Windows Game Mode on".into(),
                    rollback_action: RollbackAction::RestoreGameModeFromSnapshot,
                    snapshot: Snapshot::GameMode { prior_enabled: None, prior_allow: None },
                    elevated_restore: false,
                },
                SessionChange {
                    label: "Suspend WSearch for this session".into(),
                    rollback_action: RollbackAction::ResumeServiceFromSnapshot {
                        service: KnownService::WSearch,
                    },
                    snapshot: Snapshot::Service {
                        prior_state: "Running".into(),
                        prior_start_mode: "Manual".into(),
                    },
                    elevated_restore: true,
                },
            ],
            started_monitoring: false,
        };
        let json = serde_json::to_string(&file).unwrap();
        let back = parse_session_json(&json).expect("round-trips at the current schema");
        assert_eq!(back.changes.len(), 2);
        // Restore runs in reverse → the service resume happens BEFORE the game-mode restore.
        let order: Vec<String> = resolve_restore_order(&back.changes)
            .iter()
            .map(|c| c.label.clone())
            .collect();
        assert_eq!(order[0], "Suspend WSearch for this session");
        assert!(matches!(
            back.changes[1].rollback_action,
            RollbackAction::ResumeServiceFromSnapshot { .. }
        ));
    }
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
            start(StartOptions { advanced_usb: true, advanced_pcie: false, ..Default::default() })
        };
        let after = snapshot();
        eprintln!("[QA5] after : plan={:?} game_mode_on={} game_bar_off={} err={}", after.0, after.1, after.2, res.is_err());

        assert!(res.is_err(), "a cancelled elevation during start must surface as an error");
        assert!(load_session().is_none(), "no contract should remain after a cancelled start (partial undone + cleared)");
        assert_eq!(after, before, "a cancelled start must leave NO partial mutation — exact prior state");
        let _ = clear_session();
    }

    #[test]
    #[ignore = "mutates the live core bundle (game mode HKCU); dev-rig QA only"]
    fn qa9_in_session_service_suspend_failure_undoes_partial() {
        use crate::actions::{ForceElevationError, ForceServiceSuspendGate};
        require_clean();
        let before = snapshot();
        eprintln!("[QA9] before: plan={:?} game_mode_on={} game_bar_off={}", before.0, before.1, before.2);

        // Open the service-suspend gate (test seam) so the in-session suspend step is REACHED, and force
        // its elevation to fail (as a UAC cancel would). The UAC-free core applies, then the elevated
        // service step is refused → start() must undo the partial core and surface an error, never a
        // partial Active state. (The SUCCESS path — a real suspend+resume in-session — needs genuine
        // elevation via the built compy.exe and is an owner-present arming-time QA, not cargo-test.)
        let res = {
            let _gate = ForceServiceSuspendGate::begin();
            let _force = ForceElevationError::begin();
            start(StartOptions { suspend_services: vec!["WSearch".into()], ..Default::default() })
        };
        let after = snapshot();
        eprintln!("[QA9] after : plan={:?} game_mode_on={} game_bar_off={} err={}", after.0, after.1, after.2, res.is_err());

        assert!(res.is_err(), "a failed in-session service suspend must surface as an error");
        assert!(load_session().is_none(), "the partial core must be undone + the contract cleared");
        assert_eq!(after, before, "a failed service step must leave NO partial mutation — exact prior state");
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

    #[test]
    #[ignore = "mutates the active power plan; dev-rig QA only"]
    fn qa8_external_plan_change_restore_targets_stored_guid() {
        use crate::actions::{RollbackAction, Snapshot};
        use crate::gaming_session::{save_session, SessionChange, SessionFile, SESSION_SCHEMA_VERSION};
        require_clean();

        let before = crate::actions::current_power_plan_guid().expect("need an active power plan");
        // Universal Windows plans (present on every install); externally switch to one that differs.
        const BALANCED: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
        const HIGHPERF: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
        let external = if before.eq_ignore_ascii_case(BALANCED) { HIGHPERF } else { BALANCED };

        // Compy's stored contract: the prior plan was `before` (the real current active).
        let mut file = SessionFile {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: "qa8".into(),
            status: SessionStatus::Active,
            started_at: chrono::Utc::now().to_rfc3339(),
            app_version: "qa".into(),
            changes: vec![SessionChange {
                label: "Power plan".into(),
                rollback_action: RollbackAction::RestorePowerPlanFromSnapshot,
                snapshot: Snapshot::PowerPlan { prior_guid: before.clone() },
                elevated_restore: false,
            }],
            started_monitoring: false,
        };
        save_session(&file).expect("save fixture");

        // Someone changes the active plan OUTSIDE Compy, mid-session (non-elevated setactive).
        let _ = std::process::Command::new("powercfg").args(["/setactive", external]).output();
        let mid = crate::actions::current_power_plan_guid();

        // Restore must target the STORED prior GUID, not the externally-changed current.
        let res = restore(&mut file);
        let after = crate::actions::current_power_plan_guid();
        eprintln!("[QA8] before={} external={} mid={:?} restore={:?} after={:?}", before, external, mid, res, after);

        // Cleanup FIRST (owner away): guarantee the rig is back on its original plan regardless of asserts.
        let _ = std::process::Command::new("powercfg").args(["/setactive", &before]).output();
        let _ = clear_session();

        res.expect("restore should succeed (the stored plan exists)");
        assert_eq!(
            after.as_deref().map(str::to_ascii_lowercase),
            Some(before.to_ascii_lowercase()),
            "restore must target the STORED prior GUID, not the external change"
        );
    }

    // ── Service-suspend QA arms (Phase-B BUILT-DARK; gate stays false) ───────────────────────────
    // These prove the session SERVICE-SUSPEND contract rides the identical crash-safe restore path as
    // the core bundle, WITHOUT flipping service_suspend_gate (driven via the #[cfg(test)] seam).

    #[test]
    #[ignore = "writes a session fixture; dev-rig QA only (NO elevation, NO real service mutation)"]
    fn qa_svc_orphan_recovery_resolves_service_change_and_clears() {
        use crate::actions::{KnownService, RollbackAction, Snapshot};
        use crate::gaming_session::{save_session, SessionChange, SessionFile, SESSION_SCHEMA_VERSION};
        require_clean();

        // A contract left Active on disk by a "crashed" run, carrying a SUSPENDED service whose prior
        // was NOT running. detect_orphan() must flag it; recover(true) must resolve the Service change
        // via the typed dispatcher (resume is a no-op for a non-running prior → ZERO elevation, ZERO
        // real mutation) and CLEAR the contract — proving a service rides the SAME orphan→recover→clear
        // flow as the core bundle. (The running-prior real-resume path is the elevated arm below + the
        // primitive actions::…::qa_suspend_then_resume_restores_exact_state.)
        let file = SessionFile {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: "qa-svc-orphan".into(),
            status: SessionStatus::Active,
            started_at: chrono::Utc::now().to_rfc3339(),
            app_version: "qa".into(),
            changes: vec![SessionChange {
                label: "Suspend WSearch for this session".into(),
                rollback_action: RollbackAction::ResumeServiceFromSnapshot {
                    service: KnownService::WSearch,
                },
                snapshot: Snapshot::Service {
                    prior_state: "Stopped".into(),
                    prior_start_mode: "Manual".into(),
                },
                elevated_restore: true,
            }],
            started_monitoring: false,
        };
        save_session(&file).expect("save fixture");

        let orphan = detect_orphan().map(|f| f.status);
        let recovered = recover(true);
        eprintln!("[QA-SVC-ORPHAN] orphan={orphan:?} recover={recovered:?}");

        assert!(
            matches!(orphan, Some(SessionStatus::Active)),
            "an Active service-suspend session must be detected as a recoverable orphan"
        );
        recovered.expect("recover(true) must resolve a Service change (no-op resume for non-running prior)");
        assert!(
            load_session().is_none(),
            "the contract must be CLEARED after a confirmed service recovery"
        );
        let _ = clear_session();
    }

    #[test]
    #[ignore = "REAL service suspend in a live session + crash-recovery; OWNER-PRESENT UAC run only"]
    fn qa_svc_session_crash_recovery_resumes_exact_state() {
        use crate::actions::{service_info, ForceServiceSuspendGate, KnownService};
        require_clean();
        let svc = KnownService::WSearch;
        let (before_state, _) = service_info(svc.name()).expect("read prior WSearch state");
        eprintln!("[QA-SVC-CRASH] before: WSearch={before_state}");

        // Open the gate via the test seam (the real gate stays false) so the session actually suspends
        // the service. Stop-Service is ELEVATED → a REAL UAC prompt. Then simulate a CRASH: start, never
        // stop — the Active contract (carrying the Service change) is left on disk like a killed process.
        let started = {
            let _gate = ForceServiceSuspendGate::begin();
            start(StartOptions { suspend_services: vec!["WSearch".into()], ..Default::default() })
        };
        let suspended = service_info(svc.name()).map(|s| s.0);
        eprintln!("[QA-SVC-CRASH] suspended: WSearch={suspended:?} started_ok={}", started.is_ok());

        // Crash-recovery: detect the orphan, recover (Start-Service if it was running → REAL UAC). recover
        // resumes the service BEFORE the asserts, so a confirmed recovery leaves the rig restored.
        let orphan = detect_orphan().map(|f| f.status);
        let recovered = recover(true);
        let after = service_info(svc.name()).map(|s| s.0);
        let _ = clear_session(); // belt-and-suspenders: never leave a fixture behind

        eprintln!("[QA-SVC-CRASH] orphan={orphan:?} recover={recovered:?} after={after:?}");
        started.expect("start() should suspend the service (gate seam open)");
        assert!(
            matches!(orphan, Some(SessionStatus::Active)),
            "the suspended-service session must be a recoverable orphan after a crash"
        );
        recovered.expect("recover(true) should resume the service from the orphaned contract");
        assert_eq!(
            after.as_deref(),
            Some(before_state.as_str()),
            "crash-recovery must restore WSearch to its EXACT prior state"
        );
        assert!(load_session().is_none(), "contract must be cleared after a confirmed recovery");
    }
}
