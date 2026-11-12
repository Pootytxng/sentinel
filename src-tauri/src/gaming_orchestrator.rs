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
    clear_session, load_session, needs_recovery, next_on_stop, quarantine_session,
    read_session_slot, resolve_restore_order, save_session, SessionChange, SessionFile, SessionSlot,
    SessionStatus, SESSION_SCHEMA_VERSION,
};

/// In-memory marker of the session id THIS process started. Lets us tell an
/// in-run remount (tab switch → resume the live session) apart from an on-disk
/// `Active` session left behind by a prior run that died — reboot or crash
/// (→ offer recovery, never silently resume as "on"). A fresh process starts at
/// `None`, so any `Active` session found on disk is correctly an orphan to recover.
static LIVE_SESSION: Mutex<Option<String>> = Mutex::new(None);

/// Process-wide serialization of the session operations (start / stop / recover).
/// A second concurrent command — a double-click, or a startup recover racing a manual
/// stop — errors loudly instead of interleaving two restores over the same on-disk
/// contract + receipts files (reviewer major, 2026-07-08). `try_lock`: never blocks
/// the IPC thread; a poisoned lock (a prior panic mid-operation) is taken over rather
/// than refused forever — refusing would strand the user's only restore path.
static SESSION_OP: Mutex<()> = Mutex::new(());

/// Also taken (still only by `try_lock`) by a Trial start and the benchmark's apply across their
/// check of the session contract and their record/apply (CR-gm-spans-trial review r1), so a session
/// can't start between that check and the Trial's record, and neither starts while a session starts.
/// Contention answers "try again"; nothing ever waits on it.
///
/// CR-gm-stop-busy: stop and recover do NOT take it. A plain change, a Trial start or the
/// benchmark's apply holds it through its Windows permission prompt (minutes, if the user leaves the
/// prompt open), and a stop refused for that whole time with "still finishing" was false. They take
/// [`RESTORE_OP`] instead, which start also takes, so start, stop and recover still never interleave
/// over the contract and receipts files. Every holder of this gate checked its setting against the
/// session contract on disk first and was refused if a session step holds it (a USB or PCIe power
/// setting counts as held while the session holds the power plan, review r1 opus MUST-FIX), so a stop
/// or recovery running beside one restores only settings that holder doesn't touch; and while a stop
/// or recovery is putting changes back, a touchable change is refused outright ([`RestoreMark`]).
pub(crate) fn session_op_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    match SESSION_OP.try_lock() {
        Ok(g) => Ok(g),
        Err(std::sync::TryLockError::Poisoned(p)) => Ok(p.into_inner()),
        Err(std::sync::TryLockError::WouldBlock) => Err(
            "Compy is still finishing another change or a Gaming Mode start (if a Windows permission \
             prompt is open, answer or cancel it) — give it a second and try again"
                .to_string(),
        ),
    }
}

/// CR-gm-stop-busy: serializes the three session operations that write the contract and receipts
/// files, start, stop and recover, without [`SESSION_OP`], which plain changes also hold. Taken only
/// by `try_lock` (never waits; a poisoned lock is taken over, as above: refusing would strand the
/// user's only restore path). Start takes it after `SESSION_OP`; stop and recover take only this.
static RESTORE_OP: Mutex<()> = Mutex::new(());

fn restore_op_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    match RESTORE_OP.try_lock() {
        Ok(g) => Ok(g),
        Err(std::sync::TryLockError::Poisoned(p)) => Ok(p.into_inner()),
        Err(std::sync::TryLockError::WouldBlock) => Err(
            "Gaming Mode is still finishing a start, stop or recovery (if a Windows permission prompt is \
             open, answer or cancel it) — give it a second and try again"
                .to_string(),
        ),
    }
}

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
    /// Optional allowlisted services to SUSPEND for this session. ARMED 2026-06-25 (gate on; picker in
    /// GamingMode.tsx). Empty when the user selects none (serde default) → session unchanged; selected
    /// names are re-enforced against the `KnownService` allowlist before any suspend.
    #[serde(default)]
    pub(crate) suspend_services: Vec<String>,
}

/// PURE: the allowlisted services to suspend this session. Empty when the gate is closed (`gate_open`
/// false) OR the user selected none — so the gaming session is unchanged — or when a requested name
/// isn't on the `KnownService` allowlist (off-list / critical services can never reach the primitive).
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

// ─── CR-gm-spans-trial — Gaming Mode and a Trial never hold the same setting ───────────
// A session snapshots each setting it changes and puts that snapshot back on stop. If a Trial (or
// the benchmark's tweak trial) holds the same setting, the session's snapshot is the Trial's applied
// state, so a stop after the Trial's restore would put the Trial's change back. So a session skips
// every step whose setting an open Trial or the benchmark holds (the Trial already has it in the
// session's direction), and a Trial won't start on a setting a session's contract holds.

const LABEL_POWER: &str = "Power plan → max performance";
const LABEL_GAME_MODE: &str = "Windows Game Mode on";
const LABEL_GAME_BAR: &str = "Game Bar / DVR off";
const LABEL_USB: &str = "USB selective suspend off (AC)";
const LABEL_PCIE: &str = "PCIe ASPM off (AC)";
/// The ledger rec id of the setting each core and advanced step touches.
const REC_POWER: &str = "power-ultimate";
const REC_GAME_MODE: &str = "game-mode";
const REC_GAME_BAR: &str = "game-bar-disable";
const REC_USB: &str = "usb-selective-suspend-off";
const REC_PCIE: &str = "pcie-aspm-off";

/// The ledger rec id of the setting each service suspend touches.
fn service_rec(svc: &actions::KnownService) -> &'static str {
    match svc {
        actions::KnownService::SysMain => "sysmain-disable",
        actions::KnownService::DiagTrack => "diagtrack-disable",
        actions::KnownService::WSearch => "windows-search-disable",
        actions::KnownService::NvTelemetryContainer => "nvidia-telemetry",
    }
}

fn suspend_label(svc: &actions::KnownService) -> String {
    format!("Suspend {} for this session", svc.name())
}

/// PURE: the ledger rec id of the setting a session change touches, by its label.
fn rec_of_label(label: &str) -> Option<&'static str> {
    match label {
        LABEL_POWER => Some(REC_POWER),
        LABEL_GAME_MODE => Some(REC_GAME_MODE),
        LABEL_GAME_BAR => Some(REC_GAME_BAR),
        LABEL_USB => Some(REC_USB),
        LABEL_PCIE => Some(REC_PCIE),
        _ => actions::KnownService::ALL
            .iter()
            .find(|s| suspend_label(s) == label)
            .map(service_rec),
    }
}

/// The settings an open Trial or the benchmark's tweak trial holds right now. An unreadable Trial
/// store refuses the start: it could hold the running Trial.
fn held_by_trials() -> Result<Vec<String>, String> {
    let mut held = crate::experiment::open_trial_rec_ids().map_err(|e| trial_store_start_refusal(&e))?;
    if let Some((id, _)) = crate::benchmark_trial::held_now() {
        held.push(id);
    }
    Ok(held)
}

/// PURE (CR-fix-needs-trial-store review r1, sonnet SHOULD-FIX 1): the Gaming Mode start's refusal
/// for an unreadable Trial store. `why` is the store's own refusal, which already names the file, says
/// nothing was changed and gives the way out, so it is used whole after one short reason, never
/// wrapped in parentheses inside another sentence.
fn trial_store_start_refusal(why: &str) -> String {
    format!("Gaming Mode didn't start, because a running Trial could be testing a setting it changes. {why}")
}

/// PURE: whether a session may change the setting `rec` (no open Trial or benchmark holds it).
fn step_free(held: &[String], rec: &str) -> bool {
    !held.iter().any(|h| h == rec)
}

/// PURE (CR-gm-skipped-line): the labels of the steps a start with `opts` would have run but leaves
/// alone because their setting is `held`, in the start's own step order. Mirrors `start`'s `free`
/// checks: the core steps always, USB/PCIe only when opted in, a service only when selected.
fn left_alone_labels(held: &[String], opts: &StartOptions, gate_open: bool) -> Vec<String> {
    let mut out: Vec<String> = [
        (REC_POWER, LABEL_POWER, true),
        (REC_GAME_MODE, LABEL_GAME_MODE, true),
        (REC_GAME_BAR, LABEL_GAME_BAR, true),
        (REC_USB, LABEL_USB, opts.advanced_usb),
        (REC_PCIE, LABEL_PCIE, opts.advanced_pcie),
    ]
    .into_iter()
    .filter(|(rec, _, asked)| *asked && !step_free(held, rec))
    .map(|(_, label, _)| label.to_string())
    .collect();
    for svc in services_to_suspend(opts, gate_open) {
        if !step_free(held, service_rec(&svc)) {
            out.push(suspend_label(&svc));
        }
    }
    out
}

/// PURE: the refusal for a Trial (or the benchmark) on `rec_id` while a Gaming Mode session's
/// contract holds it. `contract` is the session file's changes when one is on disk.
fn session_hold_refusal(rec_id: &str, contract: Option<&[SessionChange]>) -> Option<String> {
    let contract = contract?;
    if contract.iter().any(|c| rec_of_label(&c.label) == Some(rec_id)) {
        return Some(
            "Gaming Mode is on and holds this setting for its session, and puts it back when it stops. \
             Stop Gaming Mode first. Nothing was changed."
                .to_string(),
        );
    }
    // CR-gm-stop-busy review r1 (opus MUST-FIX): USB selective suspend and PCIe link power are
    // settings OF the active power plan. While a session holds the plan, the active plan is the
    // session's, so a change to either would be written to (and its undo recorded against) the
    // session's plan, and a stop switching back to the user's plan in the middle of it would leave the
    // user's own plan changed with no record. Held with the plan.
    let plan_held = contract.iter().any(|c| rec_of_label(&c.label) == Some(REC_POWER));
    (plan_held && (rec_id == REC_USB || rec_id == REC_PCIE)).then(|| {
        "Gaming Mode is on and has switched your power plan for its session, and this setting belongs \
         to the power plan. Stop Gaming Mode first, then change it. Nothing was changed."
            .to_string()
    })
}

/// CR-gm-spans-trial: whether a Gaming Mode contract on disk holds `rec_id`. A contract that is on
/// disk but can't be read refuses too (it could hold it).
pub(crate) fn session_holds_refusal(rec_id: &str) -> Option<String> {
    let window = RestoreWindow::open();
    let read = match crate::gaming_session::pending_contract_files() {
        Ok(found) if found.is_empty() => None,
        Ok(found) => match load_session() {
            Some(file) => file_hold_refusal(rec_id, &file, live_session_id().as_deref()),
            // CR-gm-stop-busy review r1 (sonnet SHOULD-FIX 2): a stop that just finished removes the
            // file between the listing and the read; list again before calling it unreadable.
            None => match crate::gaming_session::pending_contract_files() {
                Ok(again) if again.is_empty() => None,
                // Review r2 (opus nit 3): name what is there now.
                Ok(again) => Some(unreadable_session_refusal(&again, &crate::gaming_session::session_data_dir())),
                Err(_) => Some(unreadable_session_refusal(&found, &crate::gaming_session::session_data_dir())),
            },
        },
        Err(e) => Some(format!("Compy couldn't check Gaming Mode's session ({e}). Nothing was changed.")),
    };
    // Checked AFTER the read (review r1, sonnet SHOULD-FIX 1): a stop that began before the read may
    // be rewriting the contract under it, so while one runs (or ran during the read) nothing here
    // goes ahead.
    if window.touched() {
        return Some(RESTORE_IN_FLIGHT_REFUSAL.to_string());
    }
    read
}

/// CR-gm-stop-busy review r1: the refusal for a Gaming Mode-touchable setting while a stop or
/// recovery is putting a session's changes back. Its contract is being rewritten, so a read of it
/// can fail for a moment, and the plain-change rule "a record this Compy can't read is not refused"
/// would let a change land on a setting the restore is about to write.
const RESTORE_IN_FLIGHT_REFUSAL: &str =
    "Gaming Mode is putting its changes back right now (if a Windows permission prompt is open, answer \
     or cancel it). Try again when it has finished. Nothing was changed.";

/// Set by stop and recover (only) around their restore, so the checks above can tell a contract being
/// rewritten from one this Compy can't read. Thread-local in tests, so one test's stop can never
/// colour another test's read.
/// Review r2 (sonnet SHOULD-FIX): the count goes up on every begin and every end, so a check that
/// samples it before and after its read also sees a whole stop that began and ended (a RestoreFailed
/// one included) between the two samples. Odd = a stop or recovery is in flight. The production arm is
/// an atomic (a stop and a change run on different threads); the test arm is per thread, so the
/// production arm itself is not exercised by a test.
#[cfg(not(test))]
static RESTORE_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
#[cfg(test)]
thread_local! {
    static RESTORE_GEN_T: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

fn bump_restore_gen() {
    #[cfg(not(test))]
    RESTORE_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    #[cfg(test)]
    RESTORE_GEN_T.with(|c| c.set(c.get() + 1));
}

fn restore_gen() -> u64 {
    #[cfg(not(test))]
    {
        RESTORE_GEN.load(std::sync::atomic::Ordering::SeqCst)
    }
    #[cfg(test)]
    {
        RESTORE_GEN_T.with(|c| c.get())
    }
}

/// Sampled before a check's read; [`RestoreWindow::touched`] after it says whether a stop or
/// recovery was in flight at either point, or ran in between.
struct RestoreWindow(u64);

impl RestoreWindow {
    fn open() -> Self {
        RestoreWindow(restore_gen())
    }
    fn touched(&self) -> bool {
        self.0 % 2 == 1 || restore_gen() != self.0
    }
}

/// Marks a stop or recovery in flight until dropped (every return path, panics included).
struct RestoreMark;

impl RestoreMark {
    fn begin() -> Self {
        bump_restore_gen(); // even -> odd
        RestoreMark
    }
}

impl Drop for RestoreMark {
    fn drop(&mut self) {
        bump_restore_gen(); // odd -> even
    }
}

/// CR-gm-spans-followups (d): the refusal for a plain UI apply or undo of any of `rec_ids` while a
/// Gaming Mode session this Compy can put back holds it. That session's stop writes its own snapshot
/// back, so a newer apply would read "applied" over a setting put back off, and an undo would be put
/// back on. The caller keeps the returned gate ([`session_op_guard`], try_lock only) from this check
/// through its ledger write, so a session can't start in between. Review r1 (opus SHOULD-FIX 1): the
/// gate is taken only when a session step touches one of `rec_ids` (`None` otherwise), so a change
/// Gaming Mode never touches neither waits on nor blocks a Gaming Mode start or stop.
pub(crate) fn plain_change_gate<'a>(
    rec_ids: impl Iterator<Item = &'a str>,
) -> Result<Option<std::sync::MutexGuard<'static, ()>>, String> {
    let rec_ids: Vec<&str> = rec_ids.filter_map(session_rec_of).collect();
    if rec_ids.is_empty() {
        return Ok(None); // no session step touches these settings: nothing to hold or read
    }
    let gate = session_op_guard()?;
    let window = RestoreWindow::open();
    let refusal = plain_change_refusal(&rec_ids);
    // CR-gm-stop-busy review r1/r2 (sonnet SHOULD-FIX): around the read, as in session_holds_refusal.
    if window.touched() {
        return Err(RESTORE_IN_FLIGHT_REFUSAL.to_string());
    }
    match refusal {
        Some(refusal) => Err(refusal),
        None => Ok(Some(gate)),
    }
}

/// The read behind [`plain_change_gate`], for settings a session step touches.
fn plain_change_refusal(rec_ids: &[&str]) -> Option<String> {
    let listing = crate::gaming_session::pending_contract_files();
    let file = match &listing {
        Ok(found) if !found.is_empty() => load_session(),
        _ => None,
    };
    plain_hold_refusal(rec_ids, listing.as_deref(), file.as_ref(), live_session_id().as_deref())
}

/// PURE half of [`plain_change_refusal`]. `listing` is the Gaming Mode record files on disk; `file`
/// the readable session. A record this Compy can't read is not refused here: this Compy's stop and
/// recovery read only a readable session, so nothing here would write over the change (a Trial start
/// still refuses it, `session_holds_refusal`). A folder that can't be listed refuses: a readable
/// session in it could hold the setting.
fn plain_hold_refusal(
    rec_ids: &[&str],
    listing: Result<&[String], &String>,
    file: Option<&SessionFile>,
    live: Option<&str>,
) -> Option<String> {
    match listing {
        Err(e) => Some(format!("Compy couldn't check Gaming Mode's session ({e}). Nothing was changed.")),
        Ok([]) => None,
        Ok(_) => rec_ids.iter().find_map(|r| file_hold_refusal(r, file?, live)),
    }
}

/// The session id this process started, if any.
fn live_session_id() -> Option<String> {
    LIVE_SESSION.lock().ok().and_then(|g| g.clone())
}

/// PURE (review r1, opus SHOULD-FIX 3): the refusal for `rec_id` against a readable session `file`,
/// worded by the session's state. "Stop Gaming Mode" is only the way out for a session running in
/// this Compy; one left over from an earlier run, or one that didn't finish putting its changes
/// back, is finished from the recovery panel.
fn file_hold_refusal(rec_id: &str, file: &SessionFile, live: Option<&str>) -> Option<String> {
    let running_here =
        matches!(file.status, SessionStatus::Active) && same_session(Some(&file.session_id), live);
    let refusal = session_hold_refusal(rec_id, Some(&file.changes))?;
    Some(if running_here {
        refusal
    } else if refusal.contains("belongs to the power plan") {
        // CR-gm-stop-busy review r2 (opus nit 2): keep the plan reason for a leftover session.
        "A Gaming Mode session that didn't finish putting its changes back still holds your power plan, \
         and this setting belongs to the power plan. Finish that session first in Gaming Mode (\"Finish \
         the last Gaming Mode session\"). Nothing was changed."
            .to_string()
    } else {
        "A Gaming Mode session that didn't finish putting its changes back holds this setting, and \
         puts it back when it's finished. Finish it first in Gaming Mode (\"Finish the last Gaming \
         Mode session\"). Nothing was changed."
            .to_string()
    })
}

/// PURE: whether any Gaming Mode session step of this version touches the setting `rec_id`.
#[cfg(test)]
fn session_can_touch(rec_id: &str) -> bool {
    session_rec_of(rec_id).is_some()
}

/// PURE: the session setting a ledger rec id changes, when a session step of this version touches it:
/// a catalog rec, or (CR-gm-service-suspend-rows) a `service-suspend:<Name>` row, which suspends the
/// same allowlisted service a session's suspend step does.
fn session_rec_of(rec_id: &str) -> Option<&'static str> {
    if let Some(name) = rec_id.strip_prefix("service-suspend:") {
        return actions::KnownService::from_name(name).map(|s| service_rec(&s));
    }
    [REC_POWER, REC_GAME_MODE, REC_GAME_BAR, REC_USB, REC_PCIE]
        .into_iter()
        .chain(actions::KnownService::ALL.iter().map(service_rec))
        .find(|r| *r == rec_id)
}

/// PURE (CR-gm-spans-followups a): the refusal when a Gaming Mode record is on disk but this Compy
/// can't read it (a set-aside `gaming-session.orphaned*` file, a leftover temp file, or a contract
/// from another version). "Recover or end Gaming Mode" can't clear these — recovery reads only a
/// readable session — so name the file(s) and the folder and say what the user can do.
fn unreadable_session_refusal(found: &[String], dir: &std::path::Path) -> String {
    let (what, it) = if found.len() == 1 { ("file", "that file") } else { ("files", "those files") };
    format!(
        "Compy can't read a Gaming Mode record ({what} {} in {}), and it could hold this setting. \
         This Compy can't put back what it holds. If a newer Compy wrote it, end Gaming Mode there. \
         Otherwise check this setting reads how you want it, then move {it} out of that folder (move, \
         don't delete: another Compy version may read it). Nothing was changed.",
        found.join(", "),
        dir.display()
    )
}

fn push(changes: &mut Vec<SessionChange>, label: &str, r: ApplyResult) {
    changes.push(SessionChange {
        label: label.to_string(),
        rollback_action: r.rollback_action,
        snapshot: r.snapshot,
        elevated_restore: r.elevation_used,
    });
}

// ─── T6 — the advanced tier rides ONE elevation ──────────────────────────
// Before T6, session start fired one UAC prompt per selected advanced item (USB + PCIe + each
// service ≤4 → the owner-caught 5–6 prompts). The tier now reuses the audited §4 batching
// machinery the Fix batch ships on (`ElevationDeferral` sink → `compose_batch_script` →
// `parse_batch_receipts`) while preserving the session's no-partial contract exactly: ANY
// failure still aborts + restores the whole session. The restore side batches the same way
// since T6b (see `restore_elevated_run` below).

/// One advanced-tier change staged for the single elevation.
struct ElevatedItem {
    /// Receipt id inside the composed batch script (must be `ps_safe`-shaped — compose refuses otherwise).
    id: &'static str,
    /// The user-facing session-change label — byte-identical to the pre-T6 per-item labels.
    label: String,
    /// The audited `apply_*` — runs with the deferral sink armed, so it performs its reads +
    /// snapshot and PARKS its one elevated command instead of prompting.
    apply: Box<dyn FnOnce() -> Result<ApplyResult, String>>,
}

/// The post-elevation decision, PURE so every arm is CI-pinnable without a real UAC prompt.
#[derive(Debug)]
enum TierDecision {
    /// Every staged item wrote an explicit `ok` receipt — mutations confirmed, contract stands.
    Confirmed,
    /// The elevated process verifiably never executed (UAC decline / launch failure) — the
    /// staged changes are dropped from the contract: their mutations never happened, and
    /// restoring them would fire one elevated no-op rollback prompt PER item on exactly the
    /// path where the user just declined elevation.
    DropStaged(String),
    /// The process ran (or the outcome is unknown, or an item lacks an `ok` receipt) — staged
    /// changes STAY in the contract and the whole session aborts + restores (no-partial;
    /// rollback to a captured prior is a value-level no-op for anything that never changed).
    KeepStagedAbort(String),
}

/// Map the one elevation's outcome + the per-item receipts to the tier decision.
/// `items` = (receipt id, user-facing label) per staged item.
fn resolve_tier_elevation(
    elevation: Result<(), String>,
    receipts_text: &str,
    items: &[(String, String)],
) -> TierDecision {
    match elevation {
        Err(e) if actions::elevation_error_nothing_ran(&e) => {
            TierDecision::DropStaged(format!("Advanced options: {e}"))
        }
        Err(e) => TierDecision::KeepStagedAbort(format!("Advanced options: {e}")),
        Ok(()) => {
            // Fail-safe receipt semantics (same as the Fix batch): only an explicit `ok` counts;
            // `fail` and MISSING are both treated as not-applied.
            let receipts = actions::parse_batch_receipts(receipts_text);
            let failed: Vec<&str> = items
                .iter()
                .filter(|(id, _)| receipts.get(id.as_str()) != Some(&true))
                .map(|(_, label)| label.as_str())
                .collect();
            if failed.is_empty() {
                TierDecision::Confirmed
            } else {
                TierDecision::KeepStagedAbort(format!(
                    "the elevated step didn't finish for: {} — Gaming Mode was not started",
                    failed.join(", ")
                ))
            }
        }
    }
}

/// Apply the advanced (elevated) tier under ONE UAC prompt. Phase 1: every item runs with the
/// elevation-deferral sink armed — it reads + snapshots and parks its elevated command (no
/// mutation). Phase 2: the parked commands run under a single elevation with per-item file
/// receipts. The crash-safe invariant holds: every staged change is in the on-disk contract
/// BEFORE the elevation runs (startup recovery of a change whose mutation never happened
/// restores it to its own captured prior — a no-op by value).
///
/// Contract with the caller: `Ok(())` → every elevated change is confirmed, recorded and saved.
/// `Err(msg)` → `file` (memory and disk) holds exactly the changes whose mutations MAY have
/// occurred — staged entries dropped when the elevated process verifiably never ran, kept
/// otherwise — and the caller aborts + restores the whole session (no-partial, unchanged).
fn apply_elevated_tier(file: &mut SessionFile, items: Vec<ElevatedItem>) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    struct Staged {
        id: &'static str,
        label: String,
        result: ApplyResult,
        cmds: std::ops::Range<usize>,
    }
    let mut staged: Vec<Staged> = Vec::new();
    // Phase 1 — sink armed. An apply error here aborts with NOTHING elevated mutated (parked
    // commands never ran) and nothing staged into the contract — the caller then restores the
    // UAC-free core only. Same no-partial outcome as the pre-T6 sequential path, minus its
    // prompts-then-restore-prompts churn.
    let all_cmds: Vec<String> = {
        let guard = actions::ElevationDeferral::begin()?;
        let mut cursor = 0usize;
        for item in items {
            let r = (item.apply)().map_err(|e| format!("{}: {}", item.label, e))?;
            let now = guard.deferred_count();
            if now == cursor {
                // An apply that deferred NO elevated command already mutated unelevated — it does
                // not belong in the elevated tier (it belongs in the UAC-free core). Record the
                // mutation FIRST (fail-safe over-record: the caller's abort-restore then undoes
                // it), then refuse loudly. Silently continuing would let an immediate mutation
                // interleave with the staged block and break "restore == reverse of true apply
                // order". Unreachable for the three shipped tier items — their only mutation IS
                // their one elevated command.
                push(&mut file.changes, &item.label, r);
                let _ = save_session(file);
                return Err(format!(
                    "{}: applied without an elevated step — it cannot ride the elevated tier",
                    item.label
                ));
            }
            staged.push(Staged {
                id: item.id,
                label: item.label,
                result: r,
                cmds: cursor..now,
            });
            cursor = now;
        }
        guard.take_deferred()
    };
    if staged.is_empty() {
        return Ok(());
    }

    // Checked (never indexed) command attribution — by construction every range lies inside
    // all_cmds, but an impossible mismatch aborts BEFORE anything is recorded or elevated.
    let mut script_items: Vec<(String, Vec<String>)> = Vec::with_capacity(staged.len());
    for s in &staged {
        let cmds = all_cmds.get(s.cmds.clone()).ok_or_else(|| {
            "internal error: deferred-command attribution mismatch — the elevated batch was aborted before anything ran".to_string()
        })?;
        script_items.push((s.id.to_string(), cmds.to_vec()));
    }
    // Session-scoped receipts, beside the contract (DATA out, never input in — §4 precedent).
    // The session id is always internally generated ("gm-<millis>"), but shape-guard it anyway
    // before it enters a filename, so a future caller feeding a disk-loaded SessionFile in here
    // can never open a path-traversal.
    actions::ps_safe(&file.session_id)?;
    let receipts_path = crate::gaming_session::session_data_dir()
        .join(format!("gaming-elevation-{}.receipts", file.session_id));
    if let Some(dir) = receipts_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(&receipts_path);
    let script = actions::compose_batch_script(&script_items, &receipts_path.to_string_lossy())?;

    // Crash-safe fail-safe ordering: the contract carries every staged change BEFORE the one
    // elevation runs. Dying mid-elevation leaves an over-complete contract; recovery restores
    // each change to its captured prior — a no-op for anything the batch never reached.
    let id_labels: Vec<(String, String)> = staged
        .iter()
        .map(|s| (s.id.to_string(), s.label.clone()))
        .collect();
    let staged_from = file.changes.len();
    for s in staged {
        file.changes.push(SessionChange {
            label: s.label,
            rollback_action: s.result.rollback_action,
            snapshot: s.result.snapshot,
            elevated_restore: s.result.elevation_used,
        });
    }
    if let Err(e) = save_session(file) {
        // The elevation has NOT run yet — the staged mutations verifiably never happened. Drop
        // them (mirroring the DropStaged arm) so the caller's abort-restore undoes the recorded
        // core only, instead of firing an elevated no-op rollback prompt per phantom entry.
        file.changes.truncate(staged_from);
        return Err(e);
    }

    // Phase 2 — the ONE elevation.
    let elevation = actions::run_elevated_powershell(&script);
    let receipts_text = if elevation.is_ok() {
        std::fs::read_to_string(&receipts_path).unwrap_or_default()
    } else {
        String::new()
    };
    let _ = std::fs::remove_file(&receipts_path);
    match resolve_tier_elevation(elevation, &receipts_text, &id_labels) {
        TierDecision::Confirmed => Ok(()),
        TierDecision::DropStaged(msg) => {
            file.changes.truncate(staged_from);
            save_session(file)?;
            Err(msg)
        }
        TierDecision::KeepStagedAbort(msg) => Err(msg),
    }
}

/// Start a session. Writes the (empty) contract first so the on-disk lock
/// exists before any mutation, then applies the core bundle, persisting after
/// each change. Advanced opt-in items (UAC) apply last. On any apply error,
/// the partial contract is already on disk; we transition to RestorePending,
/// undo what landed, and return the error.
pub(crate) fn start(opts: StartOptions) -> Result<SessionFile, String> {
    let _op = session_op_guard()?; // held across the whole start (incl. its abort-restore)
    let _restore = restore_op_guard()?; // CR-gm-stop-busy: and the stop/recover gate, same span
    // #130 on the start side (codebase review 2026-11-02): only the restore asked for a proven
    // canonical data root, so under a redirected, split or unknown root a start wrote its contract
    // where a normal launch can't see it and changed Windows, and its own undo then failed on the
    // same check, leaving the session RestoreFailed. Refuse before any contract write or apply.
    let _root = crate::data_root::mutation_root()?;
    // Slot-aware guard (rollback-first): a LOADED contract blocks start (recover it first). A file we
    // can't PARSE (corrupt / version-skewed schema) may still hold a real, unrestored rollback
    // contract — quarantine it aside so a schema-compatible build can recover it, never let the
    // save_session below overwrite (orphan) it. Only a genuinely empty slot starts fresh silently.
    match read_session_slot() {
        SessionSlot::Loaded => {
            return Err("a Gaming Mode session already exists — recover it first".into());
        }
        SessionSlot::Unreadable => {
            // Preserve the untrusted contract; proceed ONLY once the slot is actually free. The file
            // exists here (that's what Unreadable means), so a None return = the rename failed (a
            // Windows AV/indexer file lock, or the 999 orphan-slots exhausted) and the unreadable
            // contract is STILL on disk — the save_session below would overwrite (orphan) it, silently
            // destroying a possibly-live rollback contract. Refuse rather than clobber (rollback-first).
            if quarantine_session().is_none() {
                return Err("a Gaming Mode session file exists but is unreadable and couldn't be \
                            safely moved aside — refusing to start so it isn't overwritten. Try again, \
                            or recover it from %APPDATA%\\Compy.".into());
            }
        }
        SessionSlot::Empty => {}
    }
    // CR-gm-spans-trial: read before the contract exists or anything changes.
    let held = held_by_trials()?;
    let free = |rec: &str| step_free(&held, rec);
    // Read once: the left-alone line and the suspend tier below see the same gate.
    let suspend_gate = actions::service_suspend_gate();
    let now = chrono::Utc::now();
    let mut file = SessionFile {
        schema_version: SESSION_SCHEMA_VERSION,
        session_id: format!("gm-{}", now.timestamp_millis()),
        status: SessionStatus::Active,
        started_at: now.to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        changes: vec![],
        started_monitoring: false,
        // CR-gm-skipped-line: named for the pane, so a skipped step is said, not silently missing.
        left_alone: left_alone_labels(&held, &opts, suspend_gate),
    };
    save_session(&file)?; // lock exists before any mutation
    set_live_session(&file.session_id); // mark this run as the live owner

    // Shared honest partial-undo path: transition to RestorePending, best-effort persist that
    // status, then undo whatever the in-memory contract holds. If the undo ITSELF fails, the
    // session is left RestoreFailed + orphan-recoverable — say so rather than implying a clean
    // failure (honesty doctrine: never mislead about whether the system was left changed). (A core
    // step refusing mid-bundle is reachable via the unreadable-prior fail-safe, not just UAC-cancel.)
    macro_rules! undo_and_report {
        ($msg:expr) => {{
            let mut msg = $msg;
            file.status = SessionStatus::RestorePending;
            let _ = save_session(&file);
            // No RestoreMark here (CR-gm-stop-busy): start still holds SESSION_OP, so every gated
            // change and Trial start is refused before it reads.
            if let Err(undo_err) = restore(&mut file) {
                msg.push_str(&format!(
                    " — and undoing the partial session also failed ({undo_err}); \
                     your system may still be changed. Recover it from the prompt next launch."
                ));
            }
            return Err(msg);
        }};
    }

    // Apply one item; on error — OR on a receipt-persist failure AFTER the mutation landed — undo
    // whatever landed and bail through the shared honest path. Persisting the receipt is NOT a bare
    // `?`: a mutation that succeeded but whose receipt couldn't be saved must be rolled back now,
    // while the in-memory contract still holds it — never returned as a bare error that leaves the
    // change applied and unrecorded (an unrecorded change has no rollback record → it would orphan).
    macro_rules! apply_step {
        ($label:expr, $result:expr) => {{
            match $result {
                Ok(r) => {
                    push(&mut file.changes, $label, r);
                    if let Err(save_err) = save_session(&file) {
                        undo_and_report!(format!(
                            "{}: the change was applied but recording it failed ({save_err})",
                            $label
                        ));
                    }
                }
                Err(e) => {
                    undo_and_report!(format!("{}: {}", $label, e));
                }
            }
        }};
    }

    // Core (UAC-free). Power plan may skip (Ok(None)) with no error. CR-gm-spans-trial: a step whose
    // setting a Trial or the benchmark holds is skipped (never snapshotted, so never put back on stop).
    let power = if free(REC_POWER) { apply_power_plan_switch_core() } else { Ok(None) };
    match power {
        Ok(Some(r)) => {
            push(&mut file.changes, LABEL_POWER, r);
            if let Err(save_err) = save_session(&file) {
                undo_and_report!(format!(
                    "{LABEL_POWER}: the change was applied but recording it failed ({save_err})"
                ));
            }
        }
        Ok(None) => {}
        Err(e) => {
            undo_and_report!(format!("Power plan: {}", e));
        }
    }
    if free(REC_GAME_MODE) {
        apply_step!(LABEL_GAME_MODE, apply_game_mode());
    }
    if free(REC_GAME_BAR) {
        apply_step!(LABEL_GAME_BAR, apply_game_bar_disable());
    }

    // Advanced opt-in tier — ONE UAC prompt for everything selected (T6; was one prompt PER item).
    // Items keep their exact pre-T6 order and labels, so the contract, restore order and QA copy
    // are unchanged. Session service-suspend rides the same batch (ARMED 2026-06-25 —
    // service_suspend_gate() true; picker in GamingMode.tsx): with nothing selected
    // `services_to_suspend` returns empty → no tier item → the session is unchanged. Each suspend
    // keeps the SAME session contract (Snapshot::Service + ResumeServiceFromSnapshot), so resume
    // happens automatically on stop / restore / crash-recovery — no new restore path. Only
    // allowlisted services reach the primitive.
    let mut tier: Vec<ElevatedItem> = Vec::new();
    if opts.advanced_usb && free(REC_USB) {
        tier.push(ElevatedItem {
            id: "adv-usb",
            label: LABEL_USB.into(),
            apply: Box::new(apply_usb_selective_suspend_off),
        });
    }
    if opts.advanced_pcie && free(REC_PCIE) {
        tier.push(ElevatedItem {
            id: "adv-pcie",
            label: LABEL_PCIE.into(),
            apply: Box::new(apply_pcie_aspm_off),
        });
    }
    for svc in services_to_suspend(&opts, suspend_gate) {
        if !free(service_rec(&svc)) {
            continue;
        }
        tier.push(ElevatedItem {
            id: svc.name(),
            label: suspend_label(&svc),
            apply: Box::new(move || actions::apply_service_suspend(svc)),
        });
    }
    if let Err(e) = apply_elevated_tier(&mut file, tier) {
        // Same honest partial-undo path as apply_step! — restore whatever the contract holds and
        // report undo failure plainly.
        undo_and_report!(e);
    }

    Ok(file)
}

/// Restore every captured change in reverse order, resolving from the stored
/// contract alone. Power plan uses the NON-elevated path; everything else uses
/// the audited `dispatch_rollback`. Idempotent (safe to re-run after a partial
/// failure). On any failure -> RestoreFailed, contract retained, returns Err
/// (NEVER reports success). Clears the file only after every restore confirms.
///
/// T6b: contiguous elevated changes ride ONE elevation (`restore_elevated_run`)
/// instead of one UAC prompt each. Mutation order stays exactly reverse-apply
/// order: runs execute in sequence and a batch preserves its run's internal
/// order inside the one script. "One prompt for the whole restore" is a property
/// of the contract shape `start()` produces (the elevated tier applies LAST →
/// restores FIRST as one contiguous block) — an interleaved disk-edited contract
/// legitimately yields one prompt PER elevated run, order and fail-loud semantics
/// intact.
pub(crate) fn restore(file: &mut SessionFile) -> Result<(), String> {
    clear_live_session(); // this session is ending/recovering — no longer resumable
    file.status = next_on_stop(file.status); // -> Ending
    save_session(file)?;
    let mut first_err: Option<String> = None;
    let ordered = resolve_restore_order(&file.changes);
    let mut idx = 0usize;
    while idx < ordered.len() {
        let run_end = contiguous_run_end(&ordered, idx);
        if ordered[idx].elevated_restore {
            restore_elevated_run(&ordered[idx..run_end], &file.session_id, &mut first_err);
        } else {
            for change in &ordered[idx..run_end] {
                record_restore_err(&mut first_err, &change.label, restore_one_change(change));
            }
        }
        idx = run_end;
    }
    if let Some(e) = first_err {
        file.status = SessionStatus::RestoreFailed;
        save_session(file)?;
        return Err(e);
    }
    clear_session()?; // only after every restore confirmed
    Ok(())
}

/// PURE: the end (exclusive) of the contiguous run sharing `changes[start]`'s
/// `elevated_restore` flag. Runs PARTITION the restore order without reordering
/// it — the property that keeps "restore == reverse of true apply order" exact
/// under batching (an elevated change never jumps over an unelevated one).
/// An out-of-range `start` returns `start` (an empty run) — this helper sits on the
/// rollback boundary and must never be able to panic (reviewer minor, 2026-07-08).
fn contiguous_run_end(changes: &[SessionChange], start: usize) -> usize {
    let Some(first) = changes.get(start) else {
        return start;
    };
    let flag = first.elevated_restore;
    start
        + changes[start..]
            .iter()
            .take_while(|c| c.elevated_restore == flag)
            .count()
}

/// Restore ONE change from its stored contract — the single dispatch point BOTH the
/// inline (unelevated) path and the batch's phase 1 go through, so a change restores
/// through exactly the same code regardless of how its `elevated_restore` flag routes
/// it (a mislabeled power-plan change still takes the NON-elevated path, defers
/// nothing, and simply confirms inline). Everything else = audited `dispatch_rollback`.
fn restore_one_change(change: &SessionChange) -> Result<(), String> {
    // #130 — restoring a staged session change is a Windows mutation like any other, so it needs
    // the same proof of a canonical data root. Taken BEFORE the match, so both arms are covered and
    // not just the ones that reach the shared dispatcher.
    let root = crate::data_root::mutation_root()?;
    match (&change.rollback_action, &change.snapshot) {
        (RollbackAction::RestorePowerPlanFromSnapshot, Snapshot::PowerPlan { prior_guid }) => {
            restore_power_plan_unelevated(prior_guid)
        }
        // All other audited changes restore via the shared typed dispatcher.
        (action, snapshot) => actions::dispatch_rollback(&root, action, snapshot),
    }
}

/// Collect-and-continue error semantics (unchanged from the pre-T6b loop): every change
/// is attempted; the FIRST failure becomes the reported error.
fn record_restore_err(first_err: &mut Option<String>, label: &str, res: Result<(), String>) {
    if let Err(e) = res {
        first_err.get_or_insert(format!("{label}: {e}"));
    }
}

// ─── T6b — the restore side rides ONE elevation too ─────────────────────────
// Before T6b, restore fired one UAC prompt per elevated change (stop / "Restore now"
// after a session with USB + PCIe + service suspends = the owner-counted multiple
// prompts, flagged at T6 as out-of-scope). Same audited §4 machinery as the apply
// tier: `ElevationDeferral` sink → `compose_batch_script` → per-item file receipts.
// Restore-time conservatism throughout (the mirror of apply-time refusal): any
// infrastructure failure BEFORE the elevation falls back to the pre-T6b per-item
// path — a restore must stay maximally possible — while a failure OF the one
// elevation is final for this attempt (never followed by per-item re-prompts on
// exactly the path where the user just declined); the contract is retained and a
// later retry is idempotent.

/// Per-change outcome of the one restore elevation, PURE so every arm is CI-pinnable
/// without a real UAC prompt. `items` = (receipt id, user-facing label) per staged
/// change. Fail-safe polarity: only an explicit `ok` receipt under a SUCCESSFUL
/// elevation counts as restored — a declined/failed elevation or a `fail`/missing
/// receipt keeps the change failed (→ RestoreFailed, contract retained, retry later).
fn resolve_restore_batch(
    elevation: Result<(), String>,
    receipts_text: &str,
    items: &[(String, String)],
) -> Vec<(String, Result<(), String>)> {
    match elevation {
        Err(e) => items
            .iter()
            .map(|(_, label)| (label.clone(), Err(e.clone())))
            .collect(),
        Ok(()) => {
            let receipts = actions::parse_batch_receipts(receipts_text);
            items
                .iter()
                .map(|(id, label)| {
                    let res = if receipts.get(id.as_str()) == Some(&true) {
                        Ok(())
                    } else {
                        Err("the elevated restore step didn't finish".to_string())
                    };
                    (label.clone(), res)
                })
                .collect()
        }
    }
}

/// Restore a contiguous run of elevated changes under ONE UAC prompt. Phase 1: each
/// rollback runs with the deferral sink armed — its reads happen, its elevated
/// command parks (no mutation). Phase 2: the parked commands run in run order under
/// a single elevation with per-item receipts. Failures land in `first_err` per change
/// (the same collect-and-continue semantics as the inline path); the caller's
/// RestoreFailed / retain / never-false-success contract is unchanged.
fn restore_elevated_run(
    run: &[SessionChange],
    session_id: &str,
    first_err: &mut Option<String>,
) {
    // Phase 1 — sink armed: reads + parking only, no elevated mutation.
    struct Staged<'a> {
        change: &'a SessionChange,
        cmds: std::ops::Range<usize>,
    }
    // Restore-time conservatism, in two scopes (reviewer major, 2026-07-08): BEFORE
    // phase 1 has dispatched anything, an unusable sink degrades the WHOLE run to the
    // pre-T6b per-item path. AFTER phase 1, infrastructure failures (unsafe session id,
    // receipts dir failure, compose refusal, attribution mismatch) re-dispatch ONLY the
    // STAGED changes — an item that already completed inline during phase 1 (a rollback
    // that mutated without deferring, reachable only from a mislabeled/disk-edited
    // contract) must not execute twice, and read-time failures are already recorded.
    // Staged items' parked commands never ran, so re-dispatching them is safe.
    let staged_fallback = |staged: &[Staged], first_err: &mut Option<String>| {
        for s in staged {
            record_restore_err(first_err, &s.change.label, restore_one_change(s.change));
        }
    };
    let mut staged: Vec<Staged> = Vec::new();
    let all_cmds: Vec<String> = {
        let guard = match actions::ElevationDeferral::begin() {
            Ok(g) => g,
            Err(_) => {
                // Nothing has been dispatched yet — the whole run takes the per-item path.
                for change in run {
                    record_restore_err(first_err, &change.label, restore_one_change(change));
                }
                return;
            }
        };
        let mut cursor = 0usize;
        for change in run {
            let res = restore_one_change(change);
            let now = guard.deferred_count();
            match res {
                // Ok + parked command(s) → staged for the one elevation.
                Ok(()) if now > cursor => staged.push(Staged { change, cmds: cursor..now }),
                // Ok + nothing parked → the rollback completed without needing elevation
                // (e.g. a suspended service whose prior state was already Stopped) —
                // confirmed inline, nothing to stage.
                Ok(()) => {}
                // A rollback that refused during its reads fails this change alone; any
                // commands it parked before refusing are DISCARDED below (they never ran —
                // running a refused rollback's parked tail would mutate on a path the
                // rollback itself abandoned).
                Err(e) => record_restore_err(first_err, &change.label, Err(e)),
            }
            cursor = now;
        }
        guard.take_deferred()
    };
    if staged.is_empty() {
        return; // nothing needed elevation (all inline no-ops or read-time failures)
    }

    // Checked (never indexed) command attribution — same invariant as the apply tier.
    let mut script_items: Vec<(String, Vec<String>)> = Vec::with_capacity(staged.len());
    let mut id_labels: Vec<(String, String)> = Vec::with_capacity(staged.len());
    for (i, s) in staged.iter().enumerate() {
        let Some(cmds) = all_cmds.get(s.cmds.clone()) else {
            // Impossible by construction — abort to the per-item path before anything runs.
            return staged_fallback(&staged, first_err);
        };
        let id = format!("r{i}"); // ps_safe-shaped by construction
        script_items.push((id.clone(), cmds.to_vec()));
        id_labels.push((id, s.change.label.clone()));
    }

    // Session-scoped receipts, beside the contract (DATA out, never input in — §4
    // precedent). The id is internally generated ("gm-<millis>"), but shape-guard it
    // before it enters a filename so a disk-loaded contract can never open a traversal.
    if actions::ps_safe(session_id).is_err() {
        return staged_fallback(&staged, first_err);
    }
    let receipts_path = crate::gaming_session::session_data_dir()
        .join(format!("gaming-restore-{session_id}.receipts"));
    if let Some(dir) = receipts_path.parent() {
        if std::fs::create_dir_all(dir).is_err() {
            return staged_fallback(&staged, first_err);
        }
    }
    let _ = std::fs::remove_file(&receipts_path);
    let script =
        match actions::compose_batch_script(&script_items, &receipts_path.to_string_lossy()) {
            Ok(s) => s,
            Err(_) => return staged_fallback(&staged, first_err),
        };

    // Phase 2 — the ONE elevation. Its outcome is final for this attempt: no per-item
    // fallback past this point (a decline must never be followed by more prompts).
    let elevation = actions::run_elevated_powershell(&script);
    let receipts_text = if elevation.is_ok() {
        std::fs::read_to_string(&receipts_path).unwrap_or_default()
    } else {
        String::new()
    };
    let _ = std::fs::remove_file(&receipts_path);
    for (label, res) in resolve_restore_batch(elevation, &receipts_text, &id_labels) {
        record_restore_err(first_err, &label, res);
    }
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
    // CR-gm-stop-busy: not SESSION_OP, which a change waiting on its Windows prompt holds.
    let _op = restore_op_guard()?;
    let mut file = load_session().ok_or("no session to recover")?;
    let _mark = RestoreMark::begin(); // after the read, before any rewrite of the contract
    restore(&mut file)
}

/// Normal end of a live session.
pub(crate) fn stop() -> Result<(), String> {
    let _op = restore_op_guard()?; // CR-gm-stop-busy, as in recover
    let mut file = load_session().ok_or("no active Gaming Mode session")?;
    let _mark = RestoreMark::begin(); // after the read, before any rewrite of the contract
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
mod start_root_tests {
    // Codebase review 2026-11-02 (#130 on the start side): a start under a redirected, split or
    // unknown data root wrote its contract where a normal launch can't see it and changed Windows.
    // The test build issues the root unconditionally (data_root.rs), so this pins the order in the
    // source: the root is proven before the slot is touched or the contract is written. Tokens are
    // built by concat! so this test's own lines don't match the scan.
    #[test]
    fn a_start_proves_the_data_root_before_it_touches_the_session_slot() {
        let src = include_str!("gaming_orchestrator.rs");
        let start = src.find(concat!("pub(crate) fn ", "start(opts: StartOptions)")).expect("start fn");
        let body = &src[start..];
        let root = body.find(concat!("data_root::", "mutation_root()?")).expect("start must prove the root");
        let quarantine = body.find(concat!("quarantine_", "session()")).expect("start may set a bad slot aside");
        let save = body.find(concat!("save_", "session(&file)?")).expect("start writes its contract");
        assert!(root < quarantine && root < save, "the data root must be proven first");
    }
}

#[cfg(test)]
mod spans_trial_tests {
    // CR-gm-spans-trial: a session snapshots each setting it changes and puts it back on stop, so it
    // must never hold a setting a Trial (or the benchmark) holds, in either order.
    use super::*;
    use crate::actions::{KnownService, RollbackAction, Snapshot};

    fn change(label: &str) -> SessionChange {
        SessionChange {
            label: label.into(),
            rollback_action: RollbackAction::RestorePowerPlanFromSnapshot,
            snapshot: Snapshot::PowerPlan { prior_guid: "x".into() },
            elevated_restore: false,
        }
    }

    fn session_file(id: &str, status: SessionStatus, changes: Vec<SessionChange>) -> SessionFile {
        SessionFile {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: id.into(),
            status,
            started_at: "2026-11-11T00:00:00Z".into(),
            app_version: "0.9.26".into(),
            changes,
            started_monitoring: false,
            left_alone: Vec::new(),
        }
    }

    #[test]
    fn every_session_step_names_the_ledger_setting_it_touches() {
        // The labels stay byte-identical to the ones the webview pins (gaming-mode.test.ts).
        assert_eq!(LABEL_POWER, "Power plan \u{2192} max performance");
        assert_eq!(LABEL_GAME_MODE, "Windows Game Mode on");
        assert_eq!(LABEL_GAME_BAR, "Game Bar / DVR off");
        assert_eq!(LABEL_USB, "USB selective suspend off (AC)");
        assert_eq!(LABEL_PCIE, "PCIe ASPM off (AC)");
        assert_eq!(suspend_label(&KnownService::WSearch), "Suspend WSearch for this session");
        for (label, rec) in [
            (LABEL_POWER, "power-ultimate"),
            (LABEL_GAME_MODE, "game-mode"),
            (LABEL_GAME_BAR, "game-bar-disable"),
            (LABEL_USB, "usb-selective-suspend-off"),
            (LABEL_PCIE, "pcie-aspm-off"),
            ("Suspend SysMain for this session", "sysmain-disable"),
            ("Suspend DiagTrack for this session", "diagtrack-disable"),
            ("Suspend WSearch for this session", "windows-search-disable"),
            ("Suspend NvTelemetryContainer for this session", "nvidia-telemetry"),
        ] {
            assert_eq!(rec_of_label(label), Some(rec), "{label}");
            assert!(crate::history::APPLIABLE_REC_IDS.contains(&rec), "{rec} is a ledger setting");
        }
        assert_eq!(rec_of_label("Suspend nothing for this session"), None);
        assert_eq!(rec_of_label("Windows Game Mode on legacy"), None, "exact labels only");
    }

    #[test]
    fn every_allowlisted_service_suspend_names_its_ledger_setting() {
        // CR-gm-spans-followups (e): rec_of_label iterates KnownService::ALL, so ALL must list every
        // variant. The match has no wildcard: a new variant fails to compile here until it is listed.
        let mut listed = 0;
        for svc in KnownService::ALL.iter() {
            match svc {
                KnownService::SysMain
                | KnownService::DiagTrack
                | KnownService::WSearch
                | KnownService::NvTelemetryContainer => listed += 1,
            }
            assert_eq!(KnownService::from_name(svc.name()).as_ref(), Some(svc), "{}", svc.name());
            assert_eq!(rec_of_label(&suspend_label(svc)), Some(service_rec(svc)), "{}", svc.name());
        }
        assert_eq!(listed, 4);
        for name in ["SysMain", "DiagTrack", "WSearch", "NvTelemetryContainer"] {
            let svc = KnownService::from_name(name).expect("allowlisted");
            assert!(KnownService::ALL.contains(&svc), "{name} is in ALL");
        }
    }

    #[test]
    fn a_plain_apply_or_undo_is_refused_only_for_a_setting_a_readable_session_holds() {
        // CR-gm-spans-followups (d).
        let file = session_file("gm-1", SessionStatus::Active, vec![change(LABEL_POWER), change(LABEL_GAME_MODE)]);
        let live = Some("gm-1");
        let found = vec!["gaming-session.json".to_string()];
        let held = plain_hold_refusal(&["game-mode"], Ok(&found), Some(&file), live).expect("the session holds it");
        assert!(held.contains("Stop Gaming Mode first") && held.contains("Nothing was changed"), "{held}");
        // A batch naming it is refused whole.
        assert!(plain_hold_refusal(&["hags-enable", "power-ultimate"], Ok(&found), Some(&file), live).is_some());
        assert_eq!(plain_hold_refusal(&["game-bar-disable"], Ok(&found), Some(&file), live), None, "not held");
        assert_eq!(plain_hold_refusal(&["game-mode"], Ok(&[]), None, None), None, "no session");
        // A record this Compy can't read can't be put back by it, so it doesn't refuse a plain change.
        let orphan = vec!["gaming-session.orphaned-1.json".to_string()];
        assert_eq!(plain_hold_refusal(&["game-mode"], Ok(&orphan), None, None), None);
        let err = "access denied".to_string();
        let refused = plain_hold_refusal(&["game-mode"], Err(&err), None, None).expect("can't list: refused");
        assert!(refused.contains("access denied") && refused.contains("Nothing was changed"), "{refused}");
        // Only the settings a session step touches are read, or take Gaming Mode's gate, at all.
        for rec in [REC_POWER, REC_GAME_MODE, REC_GAME_BAR, REC_USB, REC_PCIE, "sysmain-disable", "nvidia-telemetry"] {
            assert!(session_can_touch(rec), "{rec}");
        }
        assert!(!session_can_touch("hags-enable") && !session_can_touch("visual-effects"));
        let ungated = plain_change_gate(["hags-enable"].into_iter()).expect("never refused");
        assert!(ungated.is_none(), "an untouched setting takes no gate");
        let src = include_str!("gaming_orchestrator.rs");
        let body = src.split_once("pub(crate) fn plain_change_gate<").and_then(|(_, r)| r.split_once("\n}\n")).expect("fn").0;
        let filter = body.find("filter_map(session_rec_of)").expect("filters first");
        let gate = body.find("let gate = session_op_guard()?;").expect("then the gate");
        let read = body.find("plain_change_refusal(").expect("then the read");
        assert!(filter < gate && gate < read && body.contains("None => Ok(Some(gate))"), "filter, gate, read, gate returned held");
    }

    #[test]
    fn a_session_suspend_row_names_the_service_a_session_suspends() {
        // CR-gm-service-suspend-rows: `suspend_known_service` records `service-suspend:<Name>` rows
        // with the suspend a session uses; the touch check didn't know that id, so neither the row's
        // undo nor the command itself was refused while a session held the service.
        for svc in KnownService::ALL.iter() {
            let id = format!("service-suspend:{}", svc.name());
            assert_eq!(session_rec_of(&id), Some(service_rec(svc)), "{id}");
            assert!(session_can_touch(&id));
        }
        assert_eq!(session_rec_of("service-suspend:Spooler"), None, "off the allowlist: nothing a session touches");
        assert_eq!(session_rec_of("service-suspend:sysmain"), None, "exact names only, as from_name");
        assert_eq!(session_rec_of(REC_GAME_MODE), Some(REC_GAME_MODE));
        assert_eq!(session_rec_of("hags-enable"), None);
        // A session suspending SysMain holds a SysMain suspend row's setting.
        let suspend = SessionChange { label: suspend_label(&KnownService::SysMain), ..change(LABEL_POWER) };
        let file = session_file("gm-1", SessionStatus::Active, vec![suspend]);
        let found = vec!["gaming-session.json".to_string()];
        let mapped: Vec<&str> = ["service-suspend:SysMain"].into_iter().filter_map(session_rec_of).collect();
        let held = plain_hold_refusal(&mapped, Ok(&found), Some(&file), Some("gm-1")).expect("held");
        assert!(held.contains("Stop Gaming Mode first"), "{held}");
        // The webview's suspend command is experiment's: it takes the gate, held, before history's
        // audited suspend (which takes the ledger lock), and it gates the id history records.
        let lib = include_str!("lib.rs");
        let handler = lib.split_once("generate_handler![").map(|(_, r)| r).expect("handler list");
        assert!(handler.contains("experiment::suspend_known_service,") && !handler.contains("history::suspend_known_service,"));
        let src = include_str!("experiment.rs");
        let body = src.split_once("pub(crate) fn suspend_known_service(").and_then(|(_, r)| r.split_once("\n}\n")).expect("fn").0;
        let gate = body.find("let _gm = crate::gaming_orchestrator::plain_change_gate(").expect("gated");
        let audited = body.find(concat!("crate::history::", "suspend_known_service(service_name)")).expect("history's suspend");
        assert!(body.contains("crate::history::suspend_rec_id(") && gate < audited, "gate (on history's own id), then the suspend");
        assert_eq!(crate::history::suspend_rec_id(&KnownService::SysMain), "service-suspend:SysMain");
    }

    #[test]
    fn a_session_not_running_in_this_compy_is_finished_from_the_recovery_panel() {
        // Review r1 (opus SHOULD-FIX 3): "Stop Gaming Mode" is only the way out for a session running here.
        let changes = vec![change(LABEL_GAME_MODE)];
        let running = session_file("gm-1", SessionStatus::Active, changes.clone());
        let stop = file_hold_refusal("game-mode", &running, Some("gm-1")).expect("held");
        assert!(stop.contains("Stop Gaming Mode first"), "{stop}");
        for (file, live) in [
            (running.clone(), None),                                                        // an earlier run's
            (running.clone(), Some("gm-2")),                                                // another session id
            (session_file("gm-1", SessionStatus::RestoreFailed, changes.clone()), Some("gm-1")), // didn't finish
            (session_file("gm-1", SessionStatus::RestorePending, changes.clone()), Some("gm-1")),
        ] {
            let words = file_hold_refusal("game-mode", &file, live).expect("still held");
            assert!(words.contains("Finish the last Gaming Mode session") && !words.contains("Stop Gaming Mode"), "{words}");
            assert!(words.ends_with("Nothing was changed."), "{words}");
        }
        assert_eq!(file_hold_refusal("hags-enable", &running, None), None, "a setting it doesn't hold");
    }

    #[test]
    fn a_trial_wont_start_on_a_setting_the_session_holds() {
        let contract = [change(LABEL_POWER), change(LABEL_GAME_MODE)];
        let refused = session_hold_refusal("game-mode", Some(&contract)).expect("held by the session");
        assert!(refused.contains("Stop Gaming Mode first") && refused.contains("Nothing was changed"), "{refused}");
        assert!(session_hold_refusal("power-ultimate", Some(&contract)).is_some());
        assert_eq!(session_hold_refusal("hags-enable", Some(&contract)), None, "a setting it doesn't hold");
        assert_eq!(session_hold_refusal("game-mode", None), None, "no session");
    }

    #[test]
    fn a_session_names_the_steps_it_left_alone_for_a_trial() {
        // CR-gm-skipped-line: the steps a Trial or the benchmark holds are named, not silently missing.
        let held = vec!["game-mode".to_string(), "sysmain-disable".to_string(), "usb-selective-suspend-off".to_string()];
        let core_only = StartOptions::default();
        assert_eq!(left_alone_labels(&held, &core_only, true), vec![LABEL_GAME_MODE.to_string()], "USB not asked: not named");
        let all = StartOptions {
            advanced_usb: true,
            advanced_pcie: true,
            suspend_services: vec!["SysMain".into(), "WSearch".into()],
        };
        assert_eq!(
            left_alone_labels(&held, &all, true),
            vec![LABEL_GAME_MODE.to_string(), LABEL_USB.to_string(), "Suspend SysMain for this session".to_string()],
        );
        assert_eq!(left_alone_labels(&held, &all, false), vec![LABEL_GAME_MODE.to_string(), LABEL_USB.to_string()], "suspend gate shut: no service step");
        assert!(left_alone_labels(&[], &all, true).is_empty(), "nothing held: nothing left alone");
        // Additive on disk: an older file loads with none, and none isn't written.
        let file = session_file("gm-1", SessionStatus::Active, vec![]);
        let json = serde_json::to_value(&file).unwrap();
        assert!(json.get("left_alone").is_none(), "{json}");
        let back: SessionFile = serde_json::from_value(json).unwrap();
        assert!(back.left_alone.is_empty());
        let named = SessionFile { left_alone: vec![LABEL_GAME_MODE.into()], ..file };
        let json = serde_json::to_value(&named).unwrap();
        assert_eq!(json["left_alone"], serde_json::json!([LABEL_GAME_MODE]));
        // And the start records them on the contract before anything changes.
        let src = include_str!("gaming_orchestrator.rs");
        let body = src.split_once("pub(crate) fn start(").and_then(|(_, r)| r.split_once("\n}\n")).expect("start").0;
        let rec = body.find(concat!("left_alone: left_alone_labels(", "&held, &opts, suspend_gate)")).expect("recorded");
        let save = body.find(concat!("save_session(&file)?; ", "// lock exists before any mutation")).expect("first save");
        assert!(rec < save);
    }

    // CR-fix-needs-trial-store review r1 (sonnet SHOULD-FIX 1): the start's refusal carries the store's
    // own words once, whole, after one reason, not nested in parentheses inside its own sentence.
    #[test]
    fn a_start_refused_for_an_unreadable_trial_store_says_it_once() {
        let dir = std::env::temp_dir().join(format!("compy-gm-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("experiments.json");
        std::fs::create_dir_all(&path).unwrap(); // a directory at the store's path: unreadable
        let why = crate::experiment::load_store_checked_from(&path).expect_err("unreadable");
        let words = trial_store_start_refusal(&why);
        assert!(words.starts_with("Gaming Mode didn't start, because a running Trial"), "{words}");
        assert_eq!(words.matches("couldn't read its Trial records").count(), 1, "{words}");
        assert!(words.contains("experiments.json") && words.contains("move that file"), "{words}");
        assert!(words.ends_with(&why), "the store's words are kept whole");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_step_is_free_only_when_nothing_holds_its_setting() {
        let held = vec!["game-mode".to_string(), "sysmain-disable".to_string()];
        assert!(!step_free(&held, REC_GAME_MODE), "a Trial holds it: skipped");
        assert!(!step_free(&held, service_rec(&KnownService::SysMain)));
        assert!(step_free(&held, REC_POWER) && step_free(&held, REC_GAME_BAR) && step_free(&held, REC_USB));
        assert!(step_free(&[], REC_GAME_MODE), "nothing held: every step runs as before");
    }

    // CR-gm-stop-busy review r1 (opus MUST-FIX): USB selective suspend and PCIe link power belong to
    // the active power plan, so while a session holds the plan they are held with it: a change written
    // to the session's plan (and its undo recorded against it) would land on the user's own plan when a
    // stop switches back mid-prompt, with no record. A session that doesn't hold the plan holds neither.
    #[test]
    fn a_power_plan_setting_is_held_while_the_session_holds_the_plan() {
        let with_plan = vec![change(LABEL_POWER)];
        for rec in [REC_USB, REC_PCIE] {
            let words = session_hold_refusal(rec, Some(&with_plan)).expect("held with the plan");
            assert!(words.contains("power plan") && words.contains("Nothing was changed"), "{words}");
        }
        assert_eq!(session_hold_refusal(REC_GAME_BAR, Some(&with_plan)), None, "not a setting of the plan");
        let without_plan = vec![change(LABEL_GAME_MODE)];
        assert_eq!(session_hold_refusal(REC_USB, Some(&without_plan)), None, "no plan held: free");
        assert_eq!(session_hold_refusal(REC_PCIE, None), None, "no session");
        assert!(session_hold_refusal(REC_POWER, Some(&with_plan)).expect("the plan itself").contains("holds this setting"));
    }

    // CR-gm-stop-busy review r1 (sonnet SHOULD-FIX 1): a stop no longer keeps changes out by holding
    // SESSION_OP, and its contract can read as unreadable for a moment while it is rewritten. While a
    // stop or recovery is in flight, a Gaming Mode-touchable change is refused with words that say so,
    // even where the unreadable-record rule would let it through; a setting no step touches is not.
    #[test]
    fn a_change_is_refused_while_a_stop_is_putting_changes_back() {
        let dir = std::env::temp_dir().join(format!("compy-gm-inflight-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let _redirect = crate::gaming_session::SessionDirOverride::begin(&dir);
        std::fs::write(dir.join("gaming-session.json"), "{}").unwrap(); // reads as unreadable
        // SESSION_OP is process-wide; another test may hold it for a moment ("still finishing").
        let gate = |recs: &[&'static str]| {
            for _ in 0..200 {
                match plain_change_gate(recs.iter().copied()) {
                    Err(e) if e.contains("still finishing") => std::thread::sleep(std::time::Duration::from_millis(5)),
                    other => return other.map(|g| g.is_some()),
                }
            }
            panic!("SESSION_OP stayed held");
        };
        assert_eq!(gate(&[REC_GAME_MODE]), Ok(true), "no stop running: the unreadable-record rule lets it through");
        {
            let _mark = RestoreMark::begin();
            let err = gate(&[REC_GAME_MODE]).expect_err("refused while a stop runs");
            assert!(err.contains("putting its changes back") && err.contains("Nothing was changed"), "{err}");
            let words = session_holds_refusal(REC_GAME_MODE).expect("a Trial start is refused too");
            assert!(words.contains("putting its changes back"), "{words}");
            assert_eq!(gate(&["hags-enable"]), Ok(false), "a setting no step touches is never held up");
        }
        assert_eq!(gate(&[REC_GAME_MODE]), Ok(true), "the mark is gone once the stop returns");
        // Review r2 (sonnet SHOULD-FIX): a whole stop that began and ended between a check's two
        // samples (a RestoreFailed one too) is still seen.
        let window = RestoreWindow::open();
        assert!(!window.touched(), "nothing ran");
        drop(RestoreMark::begin());
        assert!(window.touched(), "a stop ran between the samples");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_session_check_reads_the_contract_on_disk_and_refuses_one_it_cant_read() {
        // Review r1 (opus SHOULD-FIX 3): the fail-closed arms, on a scratch session folder.
        let dir = std::env::temp_dir().join(format!("compy-gm-spans-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let _redirect = crate::gaming_session::SessionDirOverride::begin(&dir);
        assert_eq!(session_holds_refusal(REC_GAME_MODE), None, "no session");
        assert_eq!(plain_change_refusal(&[REC_GAME_MODE]), None, "no session: a plain change runs");
        std::fs::write(dir.join("gaming-session.json"), "{}").unwrap();
        assert!(session_holds_refusal(REC_GAME_MODE).expect("unreadable").contains("can't read"));
        // CR-gm-spans-followups (d): an unreadable record can't be put back by this Compy.
        assert_eq!(plain_change_refusal(&[REC_GAME_MODE]), None);
        let file = SessionFile {
            schema_version: crate::gaming_session::SESSION_SCHEMA_VERSION,
            session_id: "gm-1".into(),
            status: crate::gaming_session::SessionStatus::Active,
            started_at: "2026-11-11T00:00:00Z".into(),
            app_version: "0.9.26".into(),
            changes: vec![change(LABEL_POWER), change(LABEL_GAME_MODE)],
            started_monitoring: false,
            left_alone: Vec::new(),
        };
        crate::gaming_session::save_session(&file).unwrap();
        // Not started by this test process, so it reads as a session to finish (review r1, opus 3).
        assert!(session_holds_refusal(REC_GAME_MODE).expect("held").contains("holds this setting"));
        assert_eq!(session_holds_refusal("hags-enable"), None, "a setting the session doesn't hold");
        let held = plain_change_refusal(&["hags-enable", REC_GAME_MODE]).expect("a batch naming it");
        assert!(held.contains("holds this setting"), "{held}");
        assert_eq!(plain_change_refusal(&[REC_GAME_BAR]), None, "touchable but not held");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_set_aside_record_alone_refuses_naming_the_file_its_folder_and_a_way_out() {
        // CR-gm-spans-followups (a): a quarantined orphan used to say "Recover or end Gaming Mode
        // first", which the user can't do (recovery reads only a readable gaming-session.json).
        let dir = std::env::temp_dir().join(format!("compy-gm-orphan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let _redirect = crate::gaming_session::SessionDirOverride::begin(&dir);
        std::fs::write(dir.join("gaming-session.orphaned.json"), "{}").unwrap();
        let words = session_holds_refusal(REC_GAME_MODE).expect("an unreadable record still refuses");
        assert!(words.contains("can't read"), "{words}");
        assert!(words.contains("gaming-session.orphaned.json"), "names the file: {words}");
        assert!(words.contains(&dir.display().to_string()), "names the folder: {words}");
        assert!(words.contains("move that file out of that folder"), "a way out: {words}");
        assert!(!words.contains("Recover or end Gaming Mode first"), "{words}");
        assert!(words.ends_with("Nothing was changed."), "{words}");
        // CR-gm-spans-followups (d), review r1 (opus 2): a set-aside record alone doesn't refuse a plain change.
        assert_eq!(plain_change_refusal(&[REC_GAME_MODE]), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_unreadable_refusal_lists_every_file_it_found() {
        let dir = std::path::Path::new(r"C:\Users\x\AppData\Roaming\Compy");
        let found = vec!["gaming-session.json.tmp".to_string(), "gaming-session.orphaned-1.json".to_string()];
        let words = unreadable_session_refusal(&found, dir);
        assert!(words.contains("files gaming-session.json.tmp, gaming-session.orphaned-1.json in C:\\Users\\x"), "{words}");
        assert!(words.contains("move those files out"), "{words}");
        // Review r1 SHOULD-FIX: a future-schema or temp record may hold a restore another version can
        // do, so the way out moves it aside and never says delete or keep-a-copy-in-place.
        assert!(words.contains("move, don't delete"), "{words}");
        assert!(!words.contains("keep a copy"), "{words}");
        let one = unreadable_session_refusal(&["gaming-session.json".to_string()], dir);
        assert!(one.contains("If a newer Compy wrote it, end Gaming Mode there"), "{one}");
    }

    #[test]
    fn a_session_skips_every_step_a_trial_holds_before_it_writes_its_contract() {
        let src = include_str!("gaming_orchestrator.rs");
        let start = src.find(concat!("pub(crate) fn ", "start(opts: StartOptions)")).expect("start fn");
        let body = &src[start..];
        let body = &body[..body.find("\n}\n").expect("end")];
        let held = body.find(concat!("held_by_", "trials()?")).expect("the holds are read");
        let save = body.find(concat!("save_", "session(&file)?")).expect("contract");
        assert!(held < save, "read before the contract exists");
        // Each apply sits behind its own `free(` check, a few lines before it at most.
        // Review r2 (opus): each apply's nearest guard is its OWN setting's, so a removed or swapped
        // guard fails here.
        for (apply, guard) in [
            (concat!("apply_power_plan_", "switch_core()"), "free(REC_POWER)"),
            (concat!("apply_game_", "mode())"), "free(REC_GAME_MODE)"),
            (concat!("apply_game_bar_", "disable())"), "free(REC_GAME_BAR)"),
            (concat!("Box::new(apply_usb_", "selective_suspend_off)"), "free(REC_USB)"),
            (concat!("Box::new(apply_pcie_", "aspm_off)"), "free(REC_PCIE)"),
            (concat!("actions::apply_service_", "suspend(svc)"), "free(service_rec(&svc))"),
        ] {
            let at = body.find(apply).unwrap_or_else(|| panic!("{apply}"));
            let gate = body[..at].rfind("free(").unwrap_or_else(|| panic!("{apply} unguarded"));
            assert!(body[gate..].starts_with(guard), "{apply}: guarded by {guard}");
            assert!(body[gate..at].lines().count() <= 8, "{apply}: guarded right before it");
        }
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
            left_alone: Vec::new(),
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

#[cfg(test)]
mod elevation_batch_tests {
    use super::*;
    use crate::actions::{
        elevation_dispatch_count, reset_elevation_dispatch_count, AppliedAction,
        ForceElevationError, KnownService, ELEVATION_DECLINED_MSG,
    };
    use crate::gaming_session::{load_session, SessionDirOverride, SESSION_SCHEMA_VERSION};

    /// A synthetic tier item: parks one marker command in the armed sink and returns a fixture
    /// ApplyResult — zero system reads, zero mutation, CI-safe on any Windows box.
    fn synthetic(id: &'static str) -> ElevatedItem {
        ElevatedItem {
            id,
            label: format!("Synthetic {id}"),
            apply: Box::new(move || {
                actions::run_elevated_powershell(&format!("Write-Output {id}"))?;
                Ok(ApplyResult {
                    applied_action: AppliedAction::SuspendKnownService {
                        service: KnownService::WSearch,
                    },
                    rollback_action: RollbackAction::ResumeServiceFromSnapshot {
                        service: KnownService::WSearch,
                    },
                    snapshot: Snapshot::Service {
                        prior_state: "Stopped".into(),
                        prior_start_mode: "Manual".into(),
                    },
                    elevation_used: true,
                })
            }),
        }
    }

    fn fixture_file(id: &str) -> SessionFile {
        SessionFile {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: id.into(),
            status: SessionStatus::Active,
            started_at: "2026-07-07T00:00:00Z".into(),
            app_version: "test".into(),
            changes: vec![],
            started_monitoring: false,
            left_alone: Vec::new(),
        }
    }

    /// A private per-test session dir (the SessionDirOverride target) — the REAL save/load path
    /// runs against it, so no test can ever touch a live session on the rig.
    fn temp_session_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("compy-t6-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).expect("temp session dir");
        d
    }

    // THE T6 PIN: a full advanced tier (4 items) rides EXACTLY ONE elevation, counted at the
    // dispatch layer in run_elevated_powershell (the forced decline stands in for the real
    // prompt; sink-captured calls are deliberately not counted).
    #[test]
    fn a_full_tier_dispatches_exactly_one_elevation() {
        let dir = temp_session_dir("one-dispatch");
        let _redirect = SessionDirOverride::begin(&dir);
        let mut file = fixture_file("gm-t6-one");
        save_session(&file).expect("fixture save");

        reset_elevation_dispatch_count();
        let res = {
            let _decline = ForceElevationError::begin();
            apply_elevated_tier(
                &mut file,
                vec![synthetic("a"), synthetic("b"), synthetic("c"), synthetic("d")],
            )
        };
        assert_eq!(
            elevation_dispatch_count(),
            1,
            "4 advanced items must ride ONE elevation dispatch — the T6 contract"
        );
        assert!(res.is_err(), "the forced decline must surface as an error");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Decline: staged changes were recorded pre-elevation (crash safety) and must be DROPPED —
    // in memory AND on disk — when the elevated process verifiably never ran, so the abort's
    // restore never fires an elevated no-op rollback (one more UAC prompt per item) on exactly
    // the path where the user just declined. Pre-existing core changes must survive the drop.
    #[test]
    fn a_decline_drops_staged_changes_but_keeps_core() {
        let dir = temp_session_dir("decline-drop");
        let _redirect = SessionDirOverride::begin(&dir);
        let mut file = fixture_file("gm-t6-decline");
        file.changes.push(SessionChange {
            label: "Windows Game Mode on".into(),
            rollback_action: RollbackAction::RestoreGameModeFromSnapshot,
            snapshot: Snapshot::GameMode { prior_enabled: None, prior_allow: None },
            elevated_restore: false,
        });
        save_session(&file).expect("fixture save");

        let res = {
            let _decline = ForceElevationError::begin();
            // Real production receipt ids — also proves they survive compose's ps_safe check.
            apply_elevated_tier(&mut file, vec![synthetic("adv-usb"), synthetic("adv-pcie")])
        };
        let err = res.expect_err("a declined elevation must abort the tier");
        assert!(err.contains(ELEVATION_DECLINED_MSG), "honest decline attribution: {err}");
        assert_eq!(file.changes.len(), 1, "staged dropped; core survives");
        assert_eq!(file.changes[0].label, "Windows Game Mode on");
        let on_disk = load_session().expect("contract still on disk");
        assert_eq!(on_disk.changes.len(), 1, "the drop must be persisted");
        assert_eq!(on_disk.changes[0].label, "Windows Game Mode on");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // A tier item that mutates WITHOUT deferring an elevated command doesn't belong in the tier:
    // the mutation is recorded (so the caller's abort-restore undoes it) and the tier refuses
    // loudly — never a silently mis-ordered contract. (Reviewer catch, 2026-07-07.)
    #[test]
    fn an_immediate_mutation_item_is_recorded_then_refused() {
        let dir = temp_session_dir("immediate-refuse");
        let _redirect = SessionDirOverride::begin(&dir);
        let mut file = fixture_file("gm-t6-immediate");
        save_session(&file).expect("fixture save");

        let no_defer = ElevatedItem {
            id: "adv-usb",
            label: "Synthetic immediate".into(),
            apply: Box::new(|| {
                // Deliberately parks NOTHING in the sink — models an apply that mutated directly.
                Ok(ApplyResult {
                    applied_action: AppliedAction::SuspendKnownService {
                        service: KnownService::WSearch,
                    },
                    rollback_action: RollbackAction::ResumeServiceFromSnapshot {
                        service: KnownService::WSearch,
                    },
                    snapshot: Snapshot::Service {
                        prior_state: "Stopped".into(),
                        prior_start_mode: "Manual".into(),
                    },
                    elevation_used: false,
                })
            }),
        };
        let err = apply_elevated_tier(&mut file, vec![no_defer, synthetic("adv-pcie")])
            .expect_err("an immediate-mutation item must be refused");
        assert!(err.contains("cannot ride the elevated tier"), "got: {err}");
        assert_eq!(file.changes.len(), 1, "the mutation must be RECORDED for the abort-restore");
        assert_eq!(file.changes[0].label, "Synthetic immediate");
        let on_disk = load_session().expect("contract on disk");
        assert_eq!(on_disk.changes.len(), 1, "the record must be persisted");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_empty_tier_is_a_zero_dispatch_noop() {
        let dir = temp_session_dir("empty");
        let _redirect = SessionDirOverride::begin(&dir);
        let mut file = fixture_file("gm-t6-empty");
        reset_elevation_dispatch_count();
        apply_elevated_tier(&mut file, vec![]).expect("an empty tier is Ok");
        assert_eq!(elevation_dispatch_count(), 0, "no advanced picks → zero prompts");
        assert!(file.changes.is_empty());
        assert!(load_session().is_none(), "an empty tier must not even write the contract");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // The pure post-elevation decision — every arm pinned (no elevation needed).
    #[test]
    fn tier_decision_arms_are_pinned() {
        let items = vec![
            ("adv-usb".to_string(), "USB selective suspend off (AC)".to_string()),
            ("adv-pcie".to_string(), "PCIe ASPM off (AC)".to_string()),
        ];
        // UAC decline (launch-level) → DropStaged, honest attribution.
        match resolve_tier_elevation(Err(ELEVATION_DECLINED_MSG.into()), "", &items) {
            TierDecision::DropStaged(m) => assert!(m.contains(ELEVATION_DECLINED_MSG)),
            other => panic!("a decline must drop staged, got {other:?}"),
        }
        // The process RAN and failed → conservative: keep staged, abort + restore everything.
        let ran_failed = "You approved the elevation, but the operation itself failed (exit code 1) — the prompt was fine; the command hit an error.";
        match resolve_tier_elevation(Err(ran_failed.into()), "", &items) {
            TierDecision::KeepStagedAbort(m) => assert!(m.contains("Advanced options")),
            other => panic!("ran-and-failed must keep staged, got {other:?}"),
        }
        // Every receipt ok → Confirmed.
        match resolve_tier_elevation(Ok(()), "adv-usb:ok\nadv-pcie:ok\n", &items) {
            TierDecision::Confirmed => {}
            other => panic!("all-ok must confirm, got {other:?}"),
        }
        // A `fail` receipt → whole-session abort NAMING the failed item (no-partial).
        match resolve_tier_elevation(Ok(()), "adv-usb:ok\nadv-pcie:fail\n", &items) {
            TierDecision::KeepStagedAbort(m) => {
                assert!(m.contains("PCIe ASPM off (AC)"), "must name the failed item: {m}");
                assert!(
                    !m.contains("USB selective suspend"),
                    "must not blame the ok item: {m}"
                );
            }
            other => panic!("a failed receipt must abort, got {other:?}"),
        }
        // A MISSING receipt = not applied (fail-safe direction) → abort too.
        match resolve_tier_elevation(Ok(()), "adv-usb:ok\n", &items) {
            TierDecision::KeepStagedAbort(m) => assert!(m.contains("PCIe ASPM off (AC)")),
            other => panic!("a missing receipt must abort, got {other:?}"),
        }
    }

    // THE T6b PIN: a contract with THREE elevated changes restores through EXACTLY ONE
    // elevation dispatch (the forced decline stands in for the real prompt; sink-captured
    // calls are deliberately not counted). The decline also proves the fail-loud contract:
    // RestoreFailed + retained on disk, honest decline attribution, never a false success.
    #[test]
    fn a_full_elevated_restore_dispatches_exactly_one_elevation() {
        let dir = temp_session_dir("restore-one-dispatch");
        let _redirect = SessionDirOverride::begin(&dir);
        let mut file = fixture_file("gm-t6b-restore");
        for svc in [KnownService::WSearch, KnownService::SysMain, KnownService::DiagTrack] {
            file.changes.push(SessionChange {
                label: format!("Suspend {} for this session", svc.name()),
                rollback_action: RollbackAction::ResumeServiceFromSnapshot { service: svc },
                snapshot: Snapshot::Service {
                    prior_state: "Running".into(),
                    prior_start_mode: "Manual".into(),
                },
                elevated_restore: true,
            });
        }
        save_session(&file).expect("fixture save");

        reset_elevation_dispatch_count();
        let res = {
            let _decline = ForceElevationError::begin();
            restore(&mut file)
        };
        assert_eq!(
            elevation_dispatch_count(),
            1,
            "3 elevated restores must ride ONE elevation dispatch — the T6b contract"
        );
        let err = res.expect_err("a declined elevation during restore must fail loudly");
        assert!(err.contains(ELEVATION_DECLINED_MSG), "honest decline attribution: {err}");
        assert_eq!(file.status, SessionStatus::RestoreFailed, "status must be RestoreFailed");
        assert!(load_session().is_some(), "the contract must be RETAINED for a later retry");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // A change whose rollback needs NO elevated command (service already Stopped at snapshot
    // time) confirms inline: zero dispatches, contract cleared — batching must not turn a
    // no-op restore into a prompt.
    #[test]
    fn a_noop_elevated_restore_dispatches_nothing_and_clears() {
        let dir = temp_session_dir("restore-noop");
        let _redirect = SessionDirOverride::begin(&dir);
        let mut file = fixture_file("gm-t6b-noop");
        file.changes.push(SessionChange {
            label: "Suspend WSearch for this session".into(),
            rollback_action: RollbackAction::ResumeServiceFromSnapshot {
                service: KnownService::WSearch,
            },
            snapshot: Snapshot::Service {
                prior_state: "Stopped".into(), // was not running → resume is a no-op
                prior_start_mode: "Manual".into(),
            },
            elevated_restore: true,
        });
        save_session(&file).expect("fixture save");

        reset_elevation_dispatch_count();
        let res = restore(&mut file);
        assert_eq!(elevation_dispatch_count(), 0, "a no-op restore must not prompt");
        res.expect("a no-op restore succeeds");
        assert!(load_session().is_none(), "contract cleared after every restore confirmed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // The pure restore-batch decision — every arm pinned (no elevation needed). Fail-safe
    // polarity: only an explicit `ok` receipt under a successful elevation counts as restored.
    #[test]
    fn restore_batch_arms_are_pinned() {
        let items = vec![
            ("r0".to_string(), "USB selective suspend off (AC)".to_string()),
            ("r1".to_string(), "PCIe ASPM off (AC)".to_string()),
        ];
        // Declined (or failed) elevation → EVERY staged change fails with the honest message.
        let declined = resolve_restore_batch(Err(ELEVATION_DECLINED_MSG.into()), "", &items);
        assert_eq!(declined.len(), 2);
        assert!(declined
            .iter()
            .all(|(_, r)| r.as_ref().is_err_and(|e| e == ELEVATION_DECLINED_MSG)));
        // Every receipt ok → every change restored.
        let ok = resolve_restore_batch(Ok(()), "r0:ok\nr1:ok\n", &items);
        assert!(ok.iter().all(|(_, r)| r.is_ok()));
        // A `fail` receipt fails ONLY its own change (collect-and-continue, per item).
        let mixed = resolve_restore_batch(Ok(()), "r0:ok\nr1:fail\n", &items);
        assert!(mixed[0].1.is_ok());
        assert!(mixed[1].1.is_err(), "a fail receipt must fail its change");
        assert_eq!(mixed[1].0, "PCIe ASPM off (AC)", "the failure must carry its label");
        // A MISSING receipt = not restored (fail-safe direction).
        let missing = resolve_restore_batch(Ok(()), "r0:ok\n", &items);
        assert!(missing[0].1.is_ok());
        assert!(missing[1].1.is_err(), "a missing receipt must fail its change");
    }

    // Runs PARTITION the restore order without reordering it — an elevated change never
    // jumps over an unelevated one, so "restore == reverse of true apply order" holds
    // exactly under batching.
    #[test]
    fn contiguous_runs_partition_without_reordering() {
        let stub = |elevated: bool| SessionChange {
            label: (if elevated { "E" } else { "U" }).into(),
            rollback_action: RollbackAction::RestoreGameModeFromSnapshot,
            snapshot: Snapshot::GameMode { prior_enabled: None, prior_allow: None },
            elevated_restore: elevated,
        };
        let changes = vec![stub(true), stub(true), stub(false), stub(true)];
        assert_eq!(contiguous_run_end(&changes, 0), 2, "leading elevated run of 2");
        assert_eq!(contiguous_run_end(&changes, 2), 3, "single unelevated run");
        assert_eq!(contiguous_run_end(&changes, 3), 4, "trailing elevated run");
        // Partitioning covers the slice exactly, in order.
        let single = vec![stub(false)];
        assert_eq!(contiguous_run_end(&single, 0), 1);
        // Out-of-range start = empty run, never a panic (rollback boundary).
        assert_eq!(contiguous_run_end(&changes, 4), 4);
        assert_eq!(contiguous_run_end(&[], 0), 0);
    }

    // Post-phase-1 infrastructure failure (here: a session id the ps_safe filename guard
    // refuses) falls back to the pre-T6b PER-ITEM path for the STAGED changes — restore
    // stays possible: one dispatch per staged item instead of one batch, still fail-loud
    // under the forced decline.
    #[test]
    fn infra_failure_falls_back_to_per_item_restore() {
        let dir = temp_session_dir("restore-fallback");
        let _redirect = SessionDirOverride::begin(&dir);
        let mut file = fixture_file("gm bad id"); // space → ps_safe refuses the receipts filename
        for svc in [KnownService::WSearch, KnownService::SysMain] {
            file.changes.push(SessionChange {
                label: format!("Suspend {} for this session", svc.name()),
                rollback_action: RollbackAction::ResumeServiceFromSnapshot { service: svc },
                snapshot: Snapshot::Service {
                    prior_state: "Running".into(),
                    prior_start_mode: "Manual".into(),
                },
                elevated_restore: true,
            });
        }
        save_session(&file).expect("fixture save");

        reset_elevation_dispatch_count();
        let res = {
            let _decline = ForceElevationError::begin();
            restore(&mut file)
        };
        assert_eq!(
            elevation_dispatch_count(),
            2,
            "per-item fallback: one dispatch per STAGED change, not one batch"
        );
        assert!(res.is_err(), "declined per-item restores must still fail loudly");
        assert_eq!(file.status, SessionStatus::RestoreFailed);
        assert!(load_session().is_some(), "contract retained for retry");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // The session-op lock: a second concurrent command is refused loudly instead of
    // interleaving two restores over the same contract/receipts files. (try_lock on the
    // same thread returns WouldBlock — safe to pin without threads.)
    #[test]
    fn concurrent_session_command_is_refused_loudly() {
        // A private session dir first (review of CR-gm-stop-busy's old-code proof): if a gate ever
        // stops refusing, stop/recover/start below must read an empty temp dir, never the rig's.
        let dir = temp_session_dir("stop-busy");
        let _redirect = SessionDirOverride::begin(&dir);
        // CR-gm-stop-busy: start, stop and recover serialize on RESTORE_OP (start takes it after
        // SESSION_OP, so a start can't run beside a stop either).
        let held = RESTORE_OP.try_lock().expect("test acquires the restore lock");
        let err = stop().expect_err("a concurrent session command must be refused");
        assert!(err.contains("still finishing"), "got: {err}");
        let err = recover(true).expect_err("recover must be serialized too");
        assert!(err.contains("still finishing"), "got: {err}");
        assert!(recover(false).is_ok(), "declining recovery takes no lock — always safe");
        drop(held);
        // Start is pinned by source order, not called: a test that calls start() would change Windows
        // the day either gate stopped refusing. It takes SESSION_OP (the start race), then RESTORE_OP
        // (start vs stop/recover), both before its data-root check and anything it writes.
        let src = include_str!("gaming_orchestrator.rs");
        let body = src.split_once("pub(crate) fn start(opts: StartOptions)").and_then(|(_, r)| r.split_once("\n}\n")).expect("fn").0;
        let op = body.find("let _op = session_op_guard()?;").expect("start takes SESSION_OP");
        let restore = body.find("let _restore = restore_op_guard()?;").expect("start takes RESTORE_OP");
        let root = body.find("mutation_root()").expect("then the data root");
        assert!(op < restore && restore < root, "SESSION_OP, then RESTORE_OP, then the data root");
        for f in ["pub(crate) fn stop()", "pub(crate) fn recover(confirm: bool)"] {
            let b = src.split_once(f).and_then(|(_, r)| r.split_once("\n}\n")).expect("fn").0;
            assert!(b.contains("restore_op_guard()?") && !b.contains("session_op_guard()"), "{f}: RESTORE_OP only");
        }

        // CR-gm-stop-busy, in the same test so the two statics are never contended between tests:
        // a plain change, a Trial start or the benchmark's apply holds SESSION_OP through its
        // Windows prompt; Stop Gaming Mode and Recover must not be refused for that. With SESSION_OP
        // held, stop and recover get past the gate and answer from the (empty) session dir.
        let held = SESSION_OP.try_lock().expect("test acquires the session gate, as a waiting change does");
        let err = stop().expect_err("no session in the temp dir");
        assert!(!err.contains("still finishing"), "stop was refused by a change's gate: {err}");
        assert!(err.contains("no active Gaming Mode session"), "got: {err}");
        let err = recover(true).expect_err("no session in the temp dir");
        assert!(!err.contains("still finishing"), "recover was refused by a change's gate: {err}");
        assert!(err.contains("no session to recover"), "got: {err}");
        // A Gaming Mode start is still kept out while a change holds the gate (the start race, pinned
        // by the source order above), and that refusal says what may be holding it.
        let err = session_op_guard().expect_err("the gate is held");
        assert!(err.contains("Windows permission prompt") && err.contains("still finishing"), "got: {err}");
        drop(held);
        let _ = std::fs::remove_dir_all(&dir);
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
    #[ignore = "REAL advanced-tier mutation + ONE UAC prompt at start; owner-present dev-rig QA only"]
    fn qa10_advanced_tier_batches_to_one_prompt_and_restores_exact_state() {
        use crate::actions::{
            elevation_dispatch_count, reset_elevation_dispatch_count, ForceDirectElevation,
        };
        require_clean();
        let before = snapshot();
        eprintln!(
            "[QA10] before  : plan={:?} game_mode_on={} game_bar_off={}",
            before.0, before.1, before.2
        );

        // Direct-elevation seam so the elevated BATCH actually runs under cargo test (the Wave-0
        // self-helper would re-launch the test binary). Expect exactly ONE UAC prompt here — that
        // single prompt IS the thing under test (T6; was one per item).
        reset_elevation_dispatch_count();
        let started = {
            let _direct = ForceDirectElevation::begin();
            start(StartOptions { advanced_usb: true, advanced_pcie: true, ..Default::default() })
        };
        let dispatches = elevation_dispatch_count();
        let applied = snapshot();
        eprintln!(
            "[QA10] applied : dispatches={dispatches} plan={:?} game_mode_on={} game_bar_off={} (changes={})",
            applied.0,
            applied.1,
            applied.2,
            started.as_ref().map(|f| f.changes.len()).unwrap_or(0)
        );

        // ALWAYS restore before asserting, so a failed assert can't leave the rig mutated.
        // T6b: the restore side batches too — expect exactly ONE more prompt here.
        reset_elevation_dispatch_count();
        let stop_res = {
            let _direct = ForceDirectElevation::begin();
            stop()
        };
        let restore_dispatches = elevation_dispatch_count();
        let after = snapshot();
        eprintln!(
            "[QA10] restored: dispatches={restore_dispatches} plan={:?} game_mode_on={} game_bar_off={}",
            after.0, after.1, after.2
        );

        let file = started.expect("start() with the advanced tier should succeed");
        assert_eq!(dispatches, 1, "the WHOLE session start must ride ONE elevation");
        assert_eq!(
            restore_dispatches, 1,
            "the WHOLE restore must ride ONE elevation — the T6b contract"
        );
        assert!(file.changes.iter().any(|c| c.label == "USB selective suspend off (AC)"));
        assert!(file.changes.iter().any(|c| c.label == "PCIe ASPM off (AC)"));
        stop_res.expect("stop()/restore should succeed");
        assert!(load_session().is_none(), "contract cleared after a confirmed restore");
        assert_eq!(after, before, "exact prior state must be restored");
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
            left_alone: Vec::new(),
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
            left_alone: Vec::new(),
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
            left_alone: Vec::new(),
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
            left_alone: Vec::new(),
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
