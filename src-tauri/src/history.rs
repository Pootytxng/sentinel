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
use crate::data_root::MutationRoot;
use crate::{
    eee_disabled_on_any_eligible_adapter, fast_startup_state_checked,
    game_bar_disabled, game_mode_enabled, hags_state_checked, mouse_accel_disabled,
    nagle_disabled_on_any_nic, pcie_aspm_off_on_ac_checked, reserved_storage_enabled_checked,
    service_running_checked, startup_approval_value, usb_selective_suspend_off_on_ac_checked,
    visual_effects_for_best_performance,
};

// Serialized so concurrent apply/rollback calls can't interleave reads and
// writes of history.json.
//
// #398: the EIGHT acquisitions below all go through `lock_history`, which records the acquisition
// with `race_seam::try_hold_lock` — a `#[cfg(test)]`-only thread-local record, an empty
// `#[inline(always)]` no-op in release — and then takes the mutex. The poison policy is unchanged
// and is still this module's own: every site propagates (`map_err(|_| "history lock poisoned")?`),
// this module recovers from poison nowhere.
//
// One helper rather than eight open-coded pairs of lines, for two reasons. It is what makes the
// record impossible to forget at a ninth site — `experiment` had three acquisitions and zero
// records precisely because nothing tied the record to the `.lock()`. And it gives the recorder's
// own tests a production entry point to this lock that performs no data-root I/O, which is what
// lets `race_seam::production_nesting_tests` falsify the `Experiment -> History` nesting without
// touching the real `%APPDATA%\Compy` ledger.
//
// `StoreGuard` drops its mutex guard before its acquisition record, so the lock is never held
// unrecorded. On the `?` early return where the lock was never taken, nothing is left on the stack.
//
// This lock is the OUTER half of one declared nesting: `History -> SupportEvidence`, because
// `load_history` / `save_history` report a damaged or unwritable ledger through
// `support_evidence::record`, which takes that module's own store lock, and these sections hold the
// ledger lock across those calls. See `race_seam::ALLOWED_NESTING`.
static HISTORY_LOCK: Mutex<()> = Mutex::new(());

/// The only way this crate takes `HISTORY_LOCK`. Records first, then blocks.
///
/// `pub(crate)` so `race_seam`'s production-nesting tests can enter the real lock the real way
/// instead of reimplementing these two lines — a lookalike would pass while the shipping path was
/// broken, which is the exact failure mode #395's review caught elsewhere.
pub(crate) fn lock_history() -> Result<crate::race_seam::StoreGuard, String> {
    crate::race_seam::try_hold_lock(crate::race_seam::StoreLock::History, || {
        HISTORY_LOCK.lock().map_err(|_| "history lock poisoned".to_string())
    })
}

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
    /// Leftovers v2 (R2-5, armed 2026-07-16): "leftover_adopted" marks a restore-to-stock receipt. Additive +
    /// optional — every pre-existing ledger entry deserializes with None.
    #[serde(default)]
    pub(crate) provenance: Option<String>,
    /// A5 rig tagging: the hardware this change was applied ON (same compact identity sessions
    /// carry — hardware::HwFingerprint). Stamped at apply time in build_applied_change, so every
    /// receipt path (single, batch, suspend, debloat, leftovers) records where it happened.
    /// Additive + optional — legacy entries deserialize with None and stay honestly "rig unknown".
    /// Local-only; never leaves the machine.
    #[serde(default)]
    pub(crate) hw_fingerprint: Option<crate::hardware::HwFingerprint>,
    /// Intelligence Phase 2: WHEN the rollback happened, stamped at rollback time (same UTC
    /// RFC3339 clock as applied_at). Additive + optional — entries rolled back before this
    /// field existed stay None forever and must NEVER be retro-dated: the intelligence
    /// timeline emits a dated rollback event only when this stamp genuinely exists.
    #[serde(default)]
    pub(crate) rolled_back_at: Option<String>,
    /// P5-outcomes-f1: the Trial that justified this apply, when it came from the Trial bench's
    /// outcome switch (Recommended vs Maximum FPS). Checked against the experiment store before
    /// the apply runs. Additive + optional: every older entry, and every apply made anywhere else,
    /// loads as None.
    #[serde(default)]
    pub(crate) justified_by_experiment: Option<TrialLink>,
    /// P5-outcomes-f1: the Trial that justified undoing this entry through the outcome switch,
    /// stamped with `rolled_back_at`. Additive + optional, None for every other undo.
    #[serde(default)]
    pub(crate) rollback_justified_by_experiment: Option<TrialLink>,
    /// CR-unconfirmed-remedy: the user's record that this change was later replaced by a state Compy
    /// did not set ([`ChangedOutside`]). Schema-versioned additive metadata: every older entry loads
    /// as None, and an unmarked row is written exactly as before (no key at all). It never touches the
    /// rollback contract above: status, snapshot and the typed actions stay as they were applied.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient_changed_outside")]
    pub(crate) changed_outside: Option<ChangedOutside>,
    /// CR-ultimate-identity: the power scheme Compy found active right after its Ultimate apply (on a
    /// localized Windows the apply duplicates Ultimate under a new GUID with a localized name). A
    /// schema-versioned additive read-back record, not part of the rollback contract: every older entry
    /// loads as None, and a row without it is written exactly as before (no key at all).
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient_applied_plan")]
    pub(crate) applied_plan: Option<AppliedPlan>,
    /// CR-core-parking-plan-gone: on a row closed by an undo that had nothing left to restore (the
    /// power plan the change was made on no longer exists), why nothing was written. Additive: every
    /// older row, and every undo that restored a value, has no key at all.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient_nothing_restored")]
    pub(crate) nothing_restored: Option<NothingRestored>,
}

/// A `nothing_restored` this build can't parse loads as None, never as a ledger that fails to load.
fn lenient_nothing_restored<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<NothingRestored>, D::Error> {
    let raw = Option::<serde_json::Value>::deserialize(d)?;
    Ok(raw.and_then(|v| serde_json::from_value(v).ok()))
}

/// An `applied_plan` this build can't parse loads as None, never as a ledger that fails to load.
fn lenient_applied_plan<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<AppliedPlan>, D::Error> {
    let raw = Option::<serde_json::Value>::deserialize(d)?;
    Ok(raw.and_then(|v| serde_json::from_value(v).ok()))
}

/// The [`AppliedPlan`] schema this build writes and reads.
pub(crate) const APPLIED_PLAN_SCHEMA: u32 = 1;

/// CR-ultimate-identity: which scheme Compy's Ultimate apply left active, read back right after the
/// apply returned (snapshot → apply → verify → receipt). Never a guess: written only when the read
/// gave a GUID that differs from the plan Compy saved before switching.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct AppliedPlan {
    pub(crate) schema: u32,
    /// Lower-case GUID.
    pub(crate) guid: String,
}

impl AppliedPlan {
    /// The GUID, when this build can act on the record.
    pub(crate) fn usable(&self) -> Option<&str> {
        (self.schema == APPLIED_PLAN_SCHEMA && crate::scheme_guid_of(&self.guid).as_deref() == Some(self.guid.as_str()))
            .then_some(self.guid.as_str())
    }
}

/// The GUID of the Ultimate plan Compy activated for this row, when it was recorded and usable.
pub(crate) fn compys_plan_guid(c: &AppliedChange) -> Option<&str> {
    c.applied_plan.as_ref().and_then(AppliedPlan::usable)
}

/// CR-ultimate-identity: the receipt's read-back of the scheme Compy activated. Only for the Ultimate
/// apply, only after it returned (the caller hands in its result), and only when `read_active` gives a
/// GUID that is not the plan Compy saved before switching (an unchanged or unread plan records nothing).
fn activated_plan_from(result: &ApplyResult, read_active: impl FnOnce() -> Option<String>) -> Option<AppliedPlan> {
    let Snapshot::PowerPlan { prior_guid } = &result.snapshot else { return None };
    if !matches!(result.applied_action, AppliedAction::SetUltimatePerformancePlan) {
        return None;
    }
    let guid = crate::scheme_guid_of(&read_active()?)?;
    (!guid.eq_ignore_ascii_case(prior_guid.trim())).then_some(AppliedPlan { schema: APPLIED_PLAN_SCHEMA, guid })
}

/// The GUID read after the apply is recorded only when that plan is Ultimate by class (stock GUID or
/// its words), or by provenance (review r2): it was not in `powercfg /list` read just before the
/// apply, so the apply's own `/duplicatescheme` made it. A plan another program switched to that
/// already existed is never stamped as Compy's; an unread list or plan records nothing.
fn is_ultimate_plan(guid: &str, read_plan: impl FnOnce() -> Option<ObservedPlan>, plans_before: Option<&[String]>) -> bool {
    let by_class = read_plan().is_some_and(|o| o.guid.eq_ignore_ascii_case(guid) && o.class == crate::PowerPlanClass::Ultimate);
    let made_by_the_apply = plans_before.is_some_and(|before| !before.iter().any(|b| b.eq_ignore_ascii_case(guid)));
    by_class || made_by_the_apply
}

/// How long one receipt read of `powercfg` may take before it counts as unread (review r2: the
/// receipt reads run under the ledger lock, so a hung `powercfg` must not hold every apply and undo).
const RECEIPT_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// `read` on its own thread, bounded by [`RECEIPT_READ_TIMEOUT`]; None when it takes longer (the
/// thread is left to finish on its own) or panics. Read-only reads only.
fn bounded_read<T: Send + 'static>(read: impl FnOnce() -> Option<T> + Send + 'static) -> Option<T> {
    bounded_read_within(RECEIPT_READ_TIMEOUT, read)
}

/// [`bounded_read`] with the bound passed in, so a test can use a short one (CR-ultimate-followups e).
fn bounded_read_within<T: Send + 'static>(
    limit: std::time::Duration,
    read: impl FnOnce() -> Option<T> + Send + 'static,
) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("receipt-read".into())
        .spawn(move || {
            let _ = tx.send(read());
        })
        .ok()?;
    rx.recv_timeout(limit).ok().flatten()
}

/// The schemes `powercfg /list` shows right now, read before Compy's Ultimate apply (bounded).
fn plans_before_ultimate_apply(rec_id: &str) -> Option<Vec<String>> {
    (rec_id == "power-ultimate").then(|| bounded_read(crate::power_plan_guids)).flatten()
}

/// Whether the live plan `seen` is Compy's Ultimate plan for row `c`: the stock Ultimate scheme or a
/// plan whose words read as Ultimate (its class), or the very GUID Compy activated for this row.
pub(crate) fn is_compys_ultimate(c: &AppliedChange, seen: &ObservedPlan) -> bool {
    seen.class == crate::PowerPlanClass::Ultimate || compys_plan_guid(c).is_some_and(|g| seen.guid.eq_ignore_ascii_case(g))
}

/// A `changed_outside` this build can't parse loads as None (the row then blocks a Trial as it did
/// before it was recorded), never as a ledger that fails to load.
fn lenient_changed_outside<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<ChangedOutside>, D::Error> {
    let raw = Option::<serde_json::Value>::deserialize(d)?;
    Ok(raw.and_then(|v| serde_json::from_value(v).ok()))
}

/// The [`ChangedOutside`] schema this build writes and reads.
pub(crate) const CHANGED_OUTSIDE_SCHEMA: u32 = 1;

/// CR-unconfirmed-remedy: a ledger-only event. The user saw that a change Compy applied no longer
/// reads as in effect, and that what IS in effect is something Compy never set (for a power plan: a
/// scheme that is neither Compy's Ultimate plan nor the plan Compy saved before switching), and chose
/// to keep it. Writing this changes nothing on Windows. The row keeps `status: "applied"`, its
/// snapshot and its typed rollback, so its undo still works and the setting can be applied again
/// through the normal apply path (a new row). What changes is only how a Trial counts it: the row
/// stops blocking a Trial start, and a Trial instead checks that the recorded `observed` state is
/// still the live one (`experiment::unverified_others_live`).
///
/// No `deny_unknown_fields` here on purpose: this is not privileged data (nothing is applied or
/// restored from it), and a shape a later build writes must never make this build fail to load the
/// whole ledger. A schema this build doesn't know, or an observed kind it can't read, is treated as
/// no record at all, so the row keeps blocking a Trial exactly as before ([`ChangedOutside::usable`]).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct ChangedOutside {
    pub(crate) schema: u32,
    /// When the user recorded it (UTC RFC 3339, the ledger's clock).
    pub(crate) recorded_at: String,
    /// What Compy read on the machine at that moment.
    pub(crate) observed: ObservedState,
    /// CR-outside-followups (d): when each earlier record that this one replaced was made, oldest
    /// first. Each was a move in time like this one (a session from before it can't say which plan it
    /// ran on), so the checks that pair sessions "with nothing moved between" keep counting them after
    /// a newer record replaces them. Additive: absent on records made before this field, and in the
    /// file only when not empty. A value this build can't read makes the whole record unreadable
    /// (`lenient_changed_outside`), and the row then blocks a Trial as an unrecorded one does.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) earlier_recorded_at: Vec<String>,
}

/// The live state Compy read when a change was recorded as changed outside Compy.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum ObservedState {
    /// The active power scheme: its GUID (lower-case) and the name Windows printed for it.
    PowerPlan { guid: String, name: String },
    /// A kind a later build wrote. Never usable here. A save by this build writes it back as
    /// `{"kind":"unknown"}`, dropping the later build's detail; that fails safe (the row blocks a
    /// Trial again until the user records it anew).
    #[serde(other)]
    Unknown,
}

impl ChangedOutside {
    /// The record, when this build can act on it.
    pub(crate) fn usable(&self) -> Option<&ObservedState> {
        (self.schema == CHANGED_OUTSIDE_SCHEMA && !matches!(self.observed, ObservedState::Unknown)).then_some(&self.observed)
    }
}

/// P5-outcomes-f1: which Trial an outcome-switch apply or undo was based on, as the Trust Ledger
/// records it. Copied from the experiment record at write time, so the row still says which Trial
/// it was if `experiments.json` is later lost.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct TrialLink {
    pub(crate) experiment_id: String,
    /// The outcome that Trial was judged under: "recommended" or "max-fps" (the experiment store's
    /// own spelling). A plain string so this module names no experiment type.
    pub(crate) outcome: String,
    /// When that Trial concluded. None if its record had no stamp.
    #[serde(default)]
    pub(crate) concluded_at: Option<String>,
}

// AppliedChange + a freshly-computed `is_still_active` flag. We never persist
// this flag (state changes outside Compy can revert what we applied), so it
// has to be recomputed every time history is read.
#[derive(Serialize)]
/// The Machine Model (`machine_model.rs`) reads the marked fields so it can present applied-change
/// truth without re-deriving `is_still_active` / `on_this_rig`, which would create a second, drifting
/// answer to the same question. Visibility only — no field here changes meaning, and this stays the
/// canonical producer.
pub(crate) struct AppliedChangeView {
    pub(crate) id: String,
    pub(crate) rec_id: String,
    pub(crate) rec_title: String,
    pub(crate) applied_at: String,
    snapshot: serde_json::Value,
    pub(crate) status: String,
    pub(crate) is_still_active: bool,
    // What the live re-check established, so a consumer can tell a read that came back OFF from a
    // probe that read nothing or a rec with no probe (#392). None when the row is not in the
    // applied state, so nothing was checked. `is_still_active` is `legacy_active()` of this.
    pub(crate) active_check: Option<ActiveCheck>,
    applied_action: Option<AppliedAction>,
    pub(crate) rollback_action: Option<RollbackAction>,
    app_version_at_apply: Option<String>,
    ruleset_version_at_apply: Option<String>,
    elevation_used: Option<bool>,
    // Read-only, computed-at-read enrichment (never persisted): a human-readable description of the
    // state a rollback restores, for the Fix surface trust-switch. Derived only from the captured
    // typed snapshot; None → the UI shows the generic "your previous setting".
    pub(crate) restores_label: Option<String>,
    // The "after" half of the before/after pair: the state Compy's change set things TO, derived
    // from the typed AppliedAction. Read-only, computed-at-read, never persisted. None for legacy
    // entries with no captured action → the UI shows just the prior ("before").
    applied_label: Option<String>,
    // A5 measured-payoff linkage — the honest per-tweak payoff meter. Read-only, computed-at-read,
    // never persisted. Names the KIND of gain a tweak targets (e.g. "Input latency", "Background
    // CPU & RAM"), NOT a fabricated FPS/latency number (honest-measurement law). Derived only from
    // the typed AppliedAction; None for legacy entries and for restore-to-stock leftovers (undoing
    // a bad past tweak is not a forward gain) → the UI shows no meter rather than an invented one.
    payoff_label: Option<String>,
    // A5 rig tagging: the stamped apply-time fingerprint, passed through for the UI's
    // "last seen working on <hardware>" tag. None for legacy entries.
    hw_fingerprint: Option<crate::hardware::HwFingerprint>,
    // Read-only, computed-at-read (never persisted): does the stamped rig match TODAY's rig?
    // Compared on the stable identity fields only (gpu · ram_gb · display) — deliberately
    // driver-INsensitive, unlike the session hash: a driver update must not make your own
    // ledger read "different hardware". None = legacy entry with no stamp (honest unknown).
    pub(crate) on_this_rig: Option<bool>,
    // CR-unconfirmed-remedy: the user's "changed outside Compy" record, passed through as stored.
    // Omitted when None, so every other row keeps its existing wire shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) changed_outside: Option<ChangedOutside>,
    // CR-outside-followups (b), computed at read, never persisted: for a row with a usable record,
    // whether the live read still shows the recorded state (the rule Game Readiness keeps it by).
    // Omitted when the row has no usable record or the read is not part of the pass.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) changed_outside_holds: Option<bool>,
    // CR-core-parking-plan-gone pass-through: why an undo had nothing to restore. Omitted when None.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) nothing_restored: Option<NothingRestored>,
    // Pass-through of the persisted rollback stamp. None = still applied, or rolled back
    // before the stamp existed — the UI must render that as "date unknown", never a guess.
    pub(crate) rolled_back_at: Option<String>,
    // P5-outcomes-f1 pass-through: the Trial behind an outcome-switch apply / undo. Omitted when
    // None, so every row that isn't from the outcome switch keeps its existing wire shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    justified_by_experiment: Option<TrialLink>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rollback_justified_by_experiment: Option<TrialLink>,
    // CR-footer-reversible, computed at read, never persisted: whether this row's stored history
    // resolves to an undo (`resolve_rollback`, the same resolution `commit_rollback` runs first). A
    // row with no typed contract that no legacy synthesizer matches, or a snapshot that no longer
    // parses, reads false: its undo would fail before anything runs (every UI undo reaches
    // `commit_rollback`, whose first step is that resolution; pinned by
    // `a_row_with_no_rollback_contract_fails_before_anything_runs`). `resolve_rollback` is a serde
    // parse plus a pure match: no I/O, no Windows read, no log.
    pub(crate) undo_contract: bool,
}

impl AppliedChangeView {
    /// The change id — what `rollback_change` takes. The benchmark trial runner needs it to undo
    /// the tweak it applied for measurement.
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
}

/// What the live re-check of an applied change actually established (#392). A bare bool folded
/// three different answers together: the setting reads off, the probe read nothing, and Compy has
/// no probe for this rec at all. Only `Off` is evidence that the change is no longer in effect.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ActiveCheck {
    On,
    Off,
    /// The probe ran and could not read the machine.
    Unreadable,
    /// No live probe exists for this rec id.
    Unrecognised,
}

impl ActiveCheck {
    fn from_read(read: Option<bool>) -> Self {
        match read {
            Some(true) => ActiveCheck::On,
            Some(false) => ActiveCheck::Off,
            None => ActiveCheck::Unreadable,
        }
    }

    /// The legacy `is_still_active` bool. Only a successful read that came back OFF is "not
    /// active": an unreadable or unprobed change stays active so its rollback is never hidden and
    /// it is never counted as reverted outside Compy on no evidence.
    pub(crate) fn legacy_active(self) -> bool {
        self != ActiveCheck::Off
    }
}

/// The live re-check of one ledger row (#620). Three kinds of row carry what to read in their typed
/// action, not in a catalog rec id: a startup-app toggle (which way Compy flipped it), a bloat-task
/// disable and a session service suspend (which task or service). Each reads only when its typed
/// action agrees with its rec id, and is `Unrecognised` otherwise. A power-ultimate row that recorded
/// the plan Compy activated reads that plan (CR-ultimate-followups a); every other row is
/// [`probe_rec_target`]. Read-only, and takes no lock.
pub(crate) fn check_row_state(c: &AppliedChange, reads: &LiveReads) -> ActiveCheck {
    // CR-ultimate-followups (a): an Ultimate row reads On on the plan Compy activated for it, not only
    // on a plan whose words read as Ultimate, so Compy's own copy with a localized name isn't "off".
    // A row without that record reads by class, as before.
    if c.rec_id == "power-ultimate" && compys_plan_guid(c).is_some() {
        return ActiveCheck::from_read(reads.scheme().map(|seen| is_compys_ultimate(c, &seen)));
    }
    check_change_state(&c.rec_id, c.applied_action.as_ref(), reads)
}

/// [`check_row_state`] from a rec id and its typed action, without a ledger row. The rollback-first
/// commit (#616) also reads an undone change back through this, because by then its receipt was
/// never saved. Read-only, and takes no lock.
fn check_change_state(rec_id: &str, action: Option<&AppliedAction>, reads: &LiveReads) -> ActiveCheck {
    if let Some(name) = rec_id.strip_prefix("startup-entry:") {
        return startup_row_check(name, action, startup_approval_value);
    }
    if let Some(id) = rec_id.strip_prefix("bloat-task:") {
        return task_row_check(id, action, |task| reads.task_disabled(task));
    }
    if let Some(svc) = rec_id.strip_prefix("service-suspend:") {
        return service_row_check(svc, action, |s| service_running_checked(s.name()));
    }
    probe_rec_target_with(rec_id, reads)
}

/// One pass's shared live reads (#620): every task row of a History, Health or Machine Model pass
/// reads one [`known_task_listing`], so that pass costs one PowerShell spawn on the UI thread instead
/// of one per row. It lives only as long as the pass that made it; nothing is cached across passes, so
/// no read can outlive a change applied or rolled back after it.
pub(crate) struct LiveReads {
    list_tasks: fn() -> Option<String>,
    tasks: std::cell::OnceCell<Option<String>>,
    /// The four service-disable recs' start types, read in one WMI query the first time a row of the
    /// pass asks (CR-service-batch, 2026-11-04): a catalog build or a Trial pass used to open one WMI
    /// connection per service, ~100-500 ms each, in series.
    list_services: fn() -> Option<ServiceListing>,
    services: std::cell::OnceCell<Option<ServiceListing>>,
    /// The active power scheme, read once per pass the first time a row asks (CR-kept-plan-read-once):
    /// the power-ultimate row's probe and the "kept outside Compy" check share it, so a History or
    /// readiness pass spawns one `powercfg`, not two.
    read_scheme: fn() -> Option<ObservedPlan>,
    scheme: std::cell::OnceCell<Option<ObservedPlan>>,
    /// This rig's fingerprint, taken once per pass the first time a stamped row asks. Every row's
    /// "is this my rig" test compares against the same print, so a pass of N stamped rows runs
    /// `current_fingerprint` (a hardware-snapshot clone plus live RAM and disk refresh) once, not N
    /// times. Nothing is cached across passes.
    fingerprint: std::cell::OnceCell<crate::hardware::HwFingerprint>,
}

/// One row per service a [`disable_service_listing`] read returned: (name, state, start mode), as
/// WMI `Win32_Service` spells them. A service that does not exist has no row.
pub(crate) type ServiceListing = Vec<(String, String, String)>;

/// The services the four service-disable recs change (`sysmain-disable`, `nvidia-telemetry`,
/// `diagtrack-disable`, `windows-search-disable`). Fixed literals, so the batched query is never built
/// from outside input.
pub(crate) const DISABLE_REC_SERVICES: [&str; 4] = ["SysMain", "NvTelemetryContainer", "DiagTrack", "WSearch"];

impl Default for LiveReads {
    fn default() -> Self {
        LiveReads::with_listings(known_task_listing, disable_service_listing)
    }
}

impl LiveReads {
    /// A pass whose task rows read `list_tasks`, called at most once. Production is
    /// [`LiveReads::default`]; tests pass a counting fake.
    #[cfg(test)]
    pub(crate) fn with_task_listing(list_tasks: fn() -> Option<String>) -> Self {
        LiveReads::with_listings(list_tasks, disable_service_listing)
    }

    /// A pass whose task rows read `list_tasks` and whose service-disable rows read `list_services`,
    /// each called at most once. Tests pass counting fakes.
    pub(crate) fn with_listings(list_tasks: fn() -> Option<String>, list_services: fn() -> Option<ServiceListing>) -> Self {
        LiveReads {
            list_tasks,
            tasks: std::cell::OnceCell::new(),
            list_services,
            services: std::cell::OnceCell::new(),
            read_scheme: crate::current_power_scheme,
            scheme: std::cell::OnceCell::new(),
            fingerprint: std::cell::OnceCell::new(),
        }
    }

    /// This rig's fingerprint for this pass, read at most once.
    fn rig_now(&self) -> &crate::hardware::HwFingerprint {
        self.fingerprint.get_or_init(crate::hardware::current_fingerprint)
    }

    /// The same pass with its active-scheme read replaced. Tests pass a counting fake.
    #[cfg(test)]
    pub(crate) fn with_scheme_read(self, read_scheme: fn() -> Option<ObservedPlan>) -> Self {
        LiveReads { read_scheme, ..self }
    }

    /// The active power scheme for this pass, read at most once.
    pub(crate) fn scheme(&self) -> Option<ObservedPlan> {
        self.scheme.get_or_init(self.read_scheme).clone()
    }

    fn task_disabled(&self, task: &KnownBloatTask) -> Option<bool> {
        let listing = self.tasks.get_or_init(self.list_tasks).as_deref()?;
        task_disabled_in_known_listing(listing, task)
    }

    /// Whether `name`'s start type reads Disabled, through [`disabled_service_check`]. One of
    /// [`DISABLE_REC_SERVICES`] reads from the pass's one batched listing; any other name (a remote
    /// rule's `service-not-running` param) keeps its own single read, as before, through the read-only
    /// probe module and never through `actions` (`src/experiment-record-first-guard.test.ts`).
    pub(crate) fn service_disabled(&self, name: &str) -> ActiveCheck {
        if !DISABLE_REC_SERVICES.iter().any(|s| s.eq_ignore_ascii_case(name)) {
            return disabled_service_check(crate::hardware::service_state_and_start_mode(name));
        }
        let listing = self.services.get_or_init(self.list_services).as_ref();
        disabled_service_check(service_in_listing(listing, name))
    }
}

/// Pure: `name`'s (state, start mode) in a batched listing. A failed listing (`None`) and a service
/// with no row both give `None`, which [`disabled_service_check`] reads as `Unreadable`, exactly as a
/// single read did. WMI matches `Name` without regard to case, so this does too.
fn service_in_listing(listing: Option<&ServiceListing>, name: &str) -> Option<(String, String)> {
    listing?
        .iter()
        .find(|(n, _, _)| n.eq_ignore_ascii_case(name))
        .map(|(_, state, mode)| (state.clone(), mode.clone()))
}

/// The one batched WQL query: only the three columns we read, only the [`DISABLE_REC_SERVICES`].
fn disable_service_query() -> String {
    let filter = DISABLE_REC_SERVICES.iter().map(|s| format!("Name='{s}'")).collect::<Vec<_>>().join(" OR ");
    format!("SELECT Name,State,StartMode FROM Win32_Service WHERE {filter}")
}

#[derive(serde::Deserialize)]
#[serde(rename = "Win32_Service")]
#[serde(rename_all = "PascalCase")]
struct Win32ServiceRow {
    name: Option<String>,
    state: Option<String>,
    start_mode: Option<String>,
}

/// Read-only: one WMI query for the [`DISABLE_REC_SERVICES`], selecting only `Name`, `State` and
/// `StartMode`, on a clean MTA thread (the UI thread is STA). `None` when WMI can't be read; a
/// missing service simply has no row. A failed query is remembered for the whole pass, so all four
/// recs read `Unreadable` together rather than some succeeding on a retry; the next pass reads again.
pub(crate) fn disable_service_listing() -> Option<ServiceListing> {
    crate::hardware::on_wmi_thread(|| {
        let com = wmi::COMLibrary::new().ok()?;
        let conn = wmi::WMIConnection::new(com).ok()?;
        let rows: Vec<Win32ServiceRow> = conn.raw_query(disable_service_query()).ok()?;
        Some(
            rows.into_iter()
                .filter_map(|r| {
                    Some((
                        r.name?,
                        r.state.unwrap_or_else(|| "Unknown".into()),
                        r.start_mode.unwrap_or_else(|| "Unknown".into()),
                    ))
                })
                .collect(),
        )
    })
}

/// Pure: a bloat-task row's live re-check. `disabled` reads whether the task is disabled now, which
/// is Compy's change in place; it is asked only about the task the rec id names.
fn task_row_check(
    id: &str,
    action: Option<&AppliedAction>,
    disabled: impl FnOnce(&KnownBloatTask) -> Option<bool>,
) -> ActiveCheck {
    match action {
        Some(AppliedAction::DisableScheduledTask { task }) if KnownBloatTask::from_id(id).as_ref() == Some(task) => {
            ActiveCheck::from_read(disabled(task))
        }
        _ => ActiveCheck::Unrecognised,
    }
}

/// Pure: a session service-suspend row's live re-check. `running` reads whether the service runs
/// now; a stopped service is Compy's suspend in place. Asked only about the service the rec id names.
fn service_row_check(
    svc: &str,
    action: Option<&AppliedAction>,
    running: impl FnOnce(&KnownService) -> Option<bool>,
) -> ActiveCheck {
    match action {
        Some(AppliedAction::SuspendKnownService { service }) if KnownService::from_name(svc).as_ref() == Some(service) => {
            ActiveCheck::from_read(running(service).map(|r| !r))
        }
        _ => ActiveCheck::Unrecognised,
    }
}

/// Pure: a startup-app row's live re-check. The rec id `startup-entry:<name>` doesn't say which way
/// Compy flipped the entry; the typed action does, so a row without one, or whose name disagrees with
/// its rec id, is `Unrecognised`. `read` is the registry read: an absent value is Windows' default,
/// enabled; a value [`startup_approval_enabled`] can't interpret, or a failed read, is `Unreadable`.
/// `On` when the entry is in the state Compy set, `Off` when it isn't.
fn startup_row_check(
    name: &str,
    action: Option<&AppliedAction>,
    read: impl FnOnce(&str) -> std::io::Result<Option<winreg::RegValue>>,
) -> ActiveCheck {
    let Some(AppliedAction::SetStartupEntryEnabled { name: typed, enabled }) = action else {
        return ActiveCheck::Unrecognised;
    };
    if typed != name {
        return ActiveCheck::Unrecognised;
    }
    let now_enabled = match read(name) {
        Ok(None) => Some(true),
        Ok(Some(value)) => startup_approval_enabled(&value),
        Err(_) => None,
    };
    ActiveCheck::from_read(now_enabled.map(|on| on == *enabled))
}

/// Read-only: the live re-check of the setting `rec_id` names, through its newest applied row in
/// `changes` (the ledger's own re-check, so a startup-app toggle reads the direction Compy set), or
/// [`probe_rec_target`] when none is applied. Reads the ledger it is given, so it takes no lock.
/// `reads` is the caller's pass: a Trial start or conclude that reads every other setting shares one,
/// so the whole read-back costs one task listing (#686-followup).
pub(crate) fn probe_applied_setting(changes: &[AppliedChange], rec_id: &str, reads: &LiveReads) -> ActiveCheck {
    changes
        .iter()
        .rev()
        .find(|c| c.rec_id == rec_id && c.status == "applied")
        .map_or_else(|| probe_rec_target_with(rec_id, reads), |c| check_row_state(c, reads))
}

/// Read-only: does the live machine read as being in `rec_id`'s TARGET state right now? The same
/// probe the ledger's live re-check uses, exposed so a Trial can read the setting before its apply
/// (§4.1, verify current state) and after its keep/restore (§4.10, verify final state) without a
/// ledger row. Never mutates; `Unrecognised` for any rec with no probe.
pub(crate) fn probe_rec_target(rec_id: &str) -> ActiveCheck {
    probe_rec_target_with(rec_id, &LiveReads::default())
}

/// [`probe_rec_target`] inside a caller's pass: the four service-disable recs read the pass's one
/// batched `Win32_Service` listing (CR-service-batch), so a pass that reads all four opens one WMI
/// connection, not four. Read-only.
pub(crate) fn probe_rec_target_with(rec_id: &str, reads: &LiveReads) -> ActiveCheck {
    let read = ActiveCheck::from_read;
    // A service disable's target state is its START TYPE, not whether it happens to be running
    // (CR-stopped-service, 2026-11-04): the apply sets Disabled and stops it; a Manual service that is
    // merely idle used to read On, as if Compy had made the change. The start types come from one WMI
    // query per pass through `reads` (CR-service-batch, 2026-11-04).
    let disabled = |svc: &str| reads.service_disabled(svc);
    // The registry readers without a checked variant (game mode, visual effects, mouse, game bar,
    // Nagle, EEE) treat an absent key as the Windows default, which IS their "off" answer, so they
    // stay plain reads here.
    match rec_id {
        "game-mode" => read(Some(game_mode_enabled())),
        "visual-effects" => read(Some(visual_effects_for_best_performance())),
        "sysmain-disable" => disabled("SysMain"),
        "nvidia-telemetry" => disabled("NvTelemetryContainer"),
        // The plan's class comes from its GUID, so a localized plan name cannot hide it; a copy of
        // Ultimate (a new GUID) still reads by its English words, as before (CR-localized-reads).
        // CR-kept-plan-read-once: the pass's one scheme read (the same GUID-then-words class).
        "power-ultimate" => read(reads.scheme().map(|seen| seen.class == crate::PowerPlanClass::Ultimate)),
        "nagle-disable" => read(Some(nagle_disabled_on_any_nic())),
        "hags-enable" => read(hags_state_checked().ok().map(|v| v == Some(2))),
        "mouse-accel-off" => read(Some(mouse_accel_disabled())),
        "game-bar-disable" => read(Some(game_bar_disabled())),
        "diagtrack-disable" => disabled("DiagTrack"),
        "windows-search-disable" => disabled("WSearch"),
        "fast-startup-off" => read(fast_startup_state_checked().ok().map(|v| v == Some(0))),
        "reserved-storage-off" => read(reserved_storage_enabled_checked().ok().map(|on| !on)),
        "usb-selective-suspend-off" => read(usb_selective_suspend_off_on_ac_checked()),
        "pcie-aspm-off" => read(pcie_aspm_off_on_ac_checked()),
        "eee-disable" => read(Some(eee_disabled_on_any_eligible_adapter())),
        _ => ActiveCheck::Unrecognised,
    }
}

/// Pure seam for the four service-disable recs (CR-stopped-service): the change is in effect when the
/// service's START TYPE reads `Disabled` — the state the apply sets and the rollback puts back — never
/// merely when the service is stopped (a Manual-start service that is idle is not Compy's change). The
/// start mode comes from WMI `Win32_Service.StartMode` ("Boot" / "System" / "Auto" / "Manual" /
/// "Disabled"), enumerated words that Windows does not localize. No row (the service does not exist, or
/// WMI could not be read) is `Unreadable`: a service that is not there is not "in the target state", and
/// the UI says it could not be read rather than crediting Compy. `sc query` used to read a missing
/// service as "not running", and so as On.
pub(crate) fn disabled_service_check(info: Option<(String, String)>) -> ActiveCheck {
    match info {
        Some((_state, mode)) => ActiveCheck::from_read(Some(mode == "Disabled")),
        None => ActiveCheck::Unreadable,
    }
}

/// Read-only enrichment (computed-at-read, never persisted): the "after" state Compy's change set
/// things TO — the second half of the Trust-Ledger before/after pair (`restores_label` is the
/// "before"). Derived ONLY from the typed `AppliedAction`, so it can't drift from what was actually
/// applied; `None` for a legacy entry with no captured action → the UI shows just the prior. The
/// match is exhaustive on purpose: a new catalog action won't compile until its after-label is set,
/// so the ledger can never silently mislabel a change.
fn applied_label_from_action(action: &Option<AppliedAction>) -> Option<String> {
    use AppliedAction::*;
    let label = match action.as_ref()? {
        EnableGameMode | EnableHardwareGpuScheduling => "On",
        DisableMouseAcceleration | DisableGameBarAndDvr | DisableFastStartup
        | DisableReservedStorage => "Off",
        DisableUsbSelectiveSuspendOnAc | DisablePcieAspmOnAc => "Off (on AC)",
        SetVisualEffectsBestPerformance => "Best performance",
        SetUltimatePerformancePlan => "Ultimate performance",
        SuspendKnownService { .. } => "Stopped",
        // The startup toggle runs both ways, so the after-label follows the flag we captured.
        SetStartupEntryEnabled { enabled, .. } => {
            if *enabled {
                "Starts with Windows"
            } else {
                "Won't start with Windows"
            }
        }
        DisableKnownService { .. } | DisableNagleOnActiveNics
        | DisableEnergyEfficientEthernet | DisableScheduledTask { .. } => "Disabled",
        // Honest wording: the app is removed for THIS USER, not wiped from the machine.
        RemovePreloadApp { .. } => "Removed for this user",
        // Leftovers v2 restores all return a setting to its Windows stock default.
        RestoreMemoryCompressionDefault | RestoreMmcssDefaults | RestorePrioritySeparationDefault
        | RestoreMpoDefault | RestoreCoreParkingDefault | RestoreTcpAutotuningDefault
        | RestorePagefileAutomatic => "Windows default",
    };
    Some(label.to_string())
}

/// A5 measured-payoff linkage — read-only enrichment (computed-at-read, never persisted): the honest
/// per-tweak payoff meter. Names the KIND of measurable gain a change targets so the ledger can show
/// "what did this buy me?" WITHOUT ever fabricating an FPS or millisecond figure (honest-measurement
/// law: never claim an unmeasured number). Derived ONLY from the typed `AppliedAction` so it can't
/// drift from what was actually applied. `None` for a legacy entry with no captured action, and for
/// every restore-to-stock leftover (undoing a rotted past tweak is not a forward gain to advertise) →
/// the UI shows no meter rather than an invented one. The match is exhaustive on purpose: a new
/// catalog action won't compile until its payoff category is set, so the meter can never silently
/// mislabel or omit a change.
fn payoff_label_from_action(action: &Option<AppliedAction>) -> Option<&'static str> {
    use AppliedAction::*;
    let label = match action.as_ref()? {
        // Input path — these trim the click-to-photon chain (accel curve, GPU scheduling).
        DisableMouseAcceleration | EnableHardwareGpuScheduling => "Input latency",
        // Network path — lower per-packet delay / jitter on the wire.
        DisableNagleOnActiveNics | DisableEnergyEfficientEthernet => "Network responsiveness",
        // Reclaim background CPU/RAM from services + telemetry tasks so games keep more of the rig.
        DisableKnownService { .. } | SuspendKnownService { .. } | DisableScheduledTask { .. } => {
            "Background CPU & RAM"
        }
        // The startup toggle runs both ways. Switching an autostart entry OFF is the same honest
        // kind of gain as silencing a service: one fewer program racing your session at sign-in.
        // Switching one back ON is the user putting a program back — that is not a forward gain, so
        // the meter stays hidden rather than advertising a payoff that does not exist.
        SetStartupEntryEnabled { enabled, .. } => {
            if *enabled {
                return None;
            }
            "Background CPU & RAM"
        }
        // Compositor / overlay / desktop-effect load off the frame path.
        SetVisualEffectsBestPerformance => "UI smoothness",
        EnableGameMode | DisableGameBarAndDvr => "Fewer background interrupts",
        // Power / thermal delivery headroom (clocks not parked/throttled on AC).
        SetUltimatePerformancePlan | DisableUsbSelectiveSuspendOnAc | DisablePcieAspmOnAc => {
            "Power & thermal headroom"
        }
        // Disk headroom reclaimed on the boot volume. A removed preload app is the same honest
        // kind: space (and any background refresh it did) back — never a fabricated FPS figure.
        DisableReservedStorage | RemovePreloadApp { .. } => "Disk headroom",
        // Not a frame/latency gain — a reliability one: a clean cold boot each time.
        DisableFastStartup => "Clean-boot reliability",
        // Restore-to-stock leftovers carry NO forward payoff claim (undoing a bad past tweak is not
        // a measured gain) — the meter stays hidden rather than inventing one.
        RestoreMemoryCompressionDefault | RestoreMmcssDefaults | RestorePrioritySeparationDefault
        | RestoreMpoDefault | RestoreCoreParkingDefault | RestoreTcpAutotuningDefault
        | RestorePagefileAutomatic => return None,
    };
    Some(label)
}

/// A5 rig tagging: does a stamped fingerprint identify TODAY's rig? Stable identity fields only
/// (gpu · ram_gb · display) — deliberately driver-INsensitive, unlike the session hash: a driver
/// update is still your rig, and must not hide your own ledger under a "this rig only" filter.
fn same_rig(stamp: &crate::hardware::HwFingerprint, now: &crate::hardware::HwFingerprint) -> bool {
    stamp.gpu == now.gpu && stamp.ram_gb == now.ram_gb && stamp.display == now.display
}

fn into_view(c: AppliedChange) -> AppliedChangeView {
    into_view_with(c, &LiveReads::default())
}

/// [`into_view`] inside a pass that shares its [`LiveReads`] across rows.
fn into_view_with(c: AppliedChange, reads: &LiveReads) -> AppliedChangeView {
    let active_check = (c.status == "applied").then(|| check_row_state(&c, reads));
    let is_still_active = active_check.is_some_and(ActiveCheck::legacy_active);
    let restores_label = restores_label_from_snapshot(&c.snapshot);
    let applied_label = applied_label_from_action(&c.applied_action);
    let payoff_label = payoff_label_from_action(&c.applied_action).map(str::to_string);
    // None = legacy unstamped entry → the UI says "rig unknown", never guesses.
    let on_this_rig = c
        .hw_fingerprint
        .as_ref()
        .map(|f| same_rig(f, reads.rig_now()));
    let undo_contract = resolve_rollback(&c).is_ok();
    AppliedChangeView {
        id: c.id,
        rec_id: c.rec_id,
        rec_title: c.rec_title,
        applied_at: c.applied_at,
        snapshot: c.snapshot,
        status: c.status,
        is_still_active,
        active_check,
        applied_action: c.applied_action,
        rollback_action: c.rollback_action,
        app_version_at_apply: c.app_version_at_apply,
        ruleset_version_at_apply: c.ruleset_version_at_apply,
        elevation_used: c.elevation_used,
        restores_label,
        applied_label,
        payoff_label,
        hw_fingerprint: c.hw_fingerprint,
        on_this_rig,
        rolled_back_at: c.rolled_back_at,
        justified_by_experiment: c.justified_by_experiment,
        rollback_justified_by_experiment: c.rollback_justified_by_experiment,
        changed_outside: c.changed_outside,
        changed_outside_holds: None,
        nothing_restored: c.nothing_restored,
        undo_contract,
    }
}

/// The ledger VIEW projection over rows a caller has ALREADY LOADED.
///
/// Exists so a consumer that must derive SEVERAL projections from ONE ledger snapshot cannot be
/// forced into a second `load_history()` to get the view — the shape that let `machine_model::build`
/// compose one model from two ledger states, an apply or rollback landing between the reads (#385
/// review 5135765472, blocker 2).
///
/// This is not a second implementation of the projection: it delegates to `into_view`, which stays
/// the single place a row becomes a view, so `check_change_active` / `same_rig` / the label
/// derivations keep exactly one definition. Callers that own their rows should keep using
/// `get_applied_changes`; this borrows so the raw rows survive for the caller's other projections.
pub(crate) fn applied_change_views(history: &[AppliedChange]) -> Vec<AppliedChangeView> {
    let reads = LiveReads::default();
    let mut views: Vec<AppliedChangeView> = history.iter().cloned().map(|c| into_view_with(c, &reads)).collect();
    // CR-outside-followups (b): whether each recorded row's state still holds. One active-plan read
    // for the pass, and only when an applied row with a usable record reads off: the only case a
    // surface uses it for (review r2: this view is read on the UI thread, so no read otherwise).
    let recorded_off = |c: &AppliedChange, v: &AppliedChangeView| {
        c.status == "applied"
            && v.active_check == Some(ActiveCheck::Off)
            && c.changed_outside.as_ref().and_then(ChangedOutside::usable).is_some()
    };
    if history.iter().zip(&views).any(|(c, v)| recorded_off(c, v)) {
        let observed = kept_outside_observed(history, &reads);
        for (c, v) in history.iter().zip(views.iter_mut()) {
            // Review r2 (opus): no read taken (Gaming Mode on, or the plan unreadable) is unknown,
            // never a measured "doesn't hold": the field stays None.
            if recorded_off(c, v) {
                v.changed_outside_holds = observed.as_ref().map(|o| recorded_and_holding(c, Some(o)));
            }
        }
    }
    views
}

/// Test-only constructor for a ledger VIEW with the computed-at-read fields set directly, so a
/// consumer's tests can exercise active / rolled-back / other-rig rows without a real ledger, a
/// real registry, or a real rig. Never compiled into the shipped binary.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn test_view(
    id: &str,
    rec_id: &str,
    rec_title: &str,
    applied_at: &str,
    status: &str,
    is_still_active: bool,
    on_this_rig: Option<bool>,
    rolled_back_at: Option<String>,
    reversible: bool,
) -> AppliedChangeView {
    AppliedChangeView {
        id: id.into(),
        rec_id: rec_id.into(),
        rec_title: rec_title.into(),
        applied_at: applied_at.into(),
        snapshot: serde_json::Value::Null,
        status: status.into(),
        is_still_active,
        active_check: (status == "applied").then_some(if is_still_active {
            ActiveCheck::On
        } else {
            ActiveCheck::Off
        }),
        applied_action: None,
        rollback_action: reversible.then_some(RollbackAction::RestoreGameModeFromSnapshot),
        app_version_at_apply: None,
        ruleset_version_at_apply: None,
        elevation_used: None,
        restores_label: None,
        applied_label: None,
        payoff_label: None,
        hw_fingerprint: None,
        on_this_rig,
        rolled_back_at,
        justified_by_experiment: None,
        rollback_justified_by_experiment: None,
        changed_outside: None,
        changed_outside_holds: None,
        nothing_restored: None,
        undo_contract: reversible,
    }
}

fn history_path() -> PathBuf {
    compy_data_dir().join("history.json")
}

/// The ledger under a VERIFIED-canonical root (#130). Mutation paths resolve their ledger through
/// the capability token, never through `compy_data_dir()`, so a load and the save that follows it
/// can never end up pointed at two different roots.
fn ledger_path_for(root: &MutationRoot) -> PathBuf {
    root.path().join("history.json")
}

/// Load the ledger a mutation is about to write. Same fail-loud behavior as `load_history`, but
/// read from the capability root — see `ledger_path_for`.
fn load_history_for(root: &MutationRoot) -> Result<Vec<AppliedChange>, String> {
    // The one load that may RESTORE a missing or damaged ledger from its backup copy: it holds the
    // capability, so the write lands only under a root Compy has proven is the machine's own.
    let loaded = load_history_core(&ledger_path_for(root), true);
    if let Err(e) = &loaded {
        crate::support_evidence::record(
            crate::support_evidence::EventKind::Ledger,
            "ledger_load",
            "unreadable",
            crate::support_evidence::Outcome::Failed,
            e,
        );
    }
    loaded
}

// load/save are split into path-parameterized cores so the JSON round-trip and
// the corrupt-file-fails-safe behavior are unit-testable without touching the
// real %APPDATA% history file. The no-arg wrappers preserve prior behavior.
// pub(crate): intelligence.rs reads the persisted structs (read-only) for the timeline —
// the view types drop fields (provenance) the engine needs as evidence.
pub(crate) fn load_history() -> Result<Vec<AppliedChange>, String> {
    let loaded = load_history_from(&history_path());
    // Support evidence (spec §12): a ledger that will not load is the single most important thing
    // support can be told, because it blocks every apply and every rollback until it is resolved.
    // Recorded HERE in the wrapper, not in the path-parameterized core, so the corrupt-ledger unit
    // tests stay hermetic — they exercise the core and never write into %APPDATA%.
    if let Err(e) = &loaded {
        crate::support_evidence::record(
            crate::support_evidence::EventKind::Ledger,
            "ledger_load",
            "unreadable",
            crate::support_evidence::Outcome::Failed,
            e,
        );
    }
    loaded
}

fn load_history_from(path: &Path) -> Result<Vec<AppliedChange>, String> {
    // The READ side: it never writes a restored ledger (only `load_history_for`, which holds the
    // capability, does). With the main file missing or damaged it still shows the backup's rows.
    load_history_core(path, false)
}

/// The one load. `may_restore` is true only for the capability-holding mutation load: it alone
/// writes the backup copy back as the main file. A main file that parses always wins and nothing
/// below touches it; the backup is consulted only when the main file is missing or does not parse.
fn load_history_core(path: &Path, may_restore: bool) -> Result<Vec<AppliedChange>, String> {
    if !path.exists() {
        // A backup copy beside a missing ledger is NOT a first run: the file was deleted or lost.
        if backup_path(path).exists() {
            return recover_from_backup(path, may_restore, RestoreReason::Missing, None);
        }
        return Ok(Vec::new()); // first run — genuinely no history
    }
    // A READ that fails is not damage (codebase review 2026-11-02). A sharing violation, a
    // permissions glitch or an IO error says nothing about the bytes on disk, and setting a valid
    // ledger aside on one stranded every rollback contract in it: the next load finds no file and
    // reads as a first run. Fail loud and leave the file exactly where it is; the next load reads it
    // again. Only bytes that were read and do not parse (non-UTF-8 included) are set aside.
    let bytes = std::fs::read(path).map_err(|e| {
        format!(
            "The Trust Ledger could not be read right now (read: {e}). It was left exactly as it \
             is, and Compy will not record changes until it can read it again."
        )
    })?;
    match serde_json::from_slice(&bytes) {
        Ok(h) => Ok(h),
        Err(e) => {
            // H1 fix (audit 2026-06-11): an unreadable EXISTING ledger must never be silently
            // treated as empty — under the old code the next save would overwrite the
            // recoverable file and permanently erase every rollback contract. Set the damaged
            // file aside byte-for-byte (best effort) and fail LOUD. Every save sits behind a
            // successful load, so the recoverable bytes can never be clobbered either way.
            // A second set-aside never destroys the first (review 2026-11-02): the earlier one is
            // kept beside it first, and when that fails the damaged file stays where it is.
            let corrupt = path.with_extension("json.corrupt");
            // `None`: the earlier one couldn't be moved. `Some(moved)`: free to set aside, with
            // where the earlier one went, so a set-aside that then fails puts it back and the
            // marker (`ledger_was_quarantined`, #618's bound) never reads as "nothing set aside".
            let cleared = if corrupt.exists() { keep_earlier_set_aside(path, &corrupt).map(Some) } else { Some(None) };
            let preserved = cleared.is_some_and(|moved| {
                let set_aside = std::fs::rename(path, &corrupt).is_ok();
                if let (false, Some(earlier)) = (set_aside, moved) {
                    let _ = std::fs::rename(earlier, &corrupt);
                }
                set_aside
            });
            let damaged = format!(
                "The Trust Ledger could not be read (parse: {e}). {}",
                if preserved {
                    "The damaged file was set aside as history.json.corrupt — nothing was \
                     overwritten, and Compy will not record changes over it."
                } else {
                    "The damaged file was left in place — Compy will not record changes over it."
                }
            );
            // Only a damaged file that was really set aside can be replaced; one left in place
            // fails loud exactly as before and the backup is not consulted.
            if preserved {
                recover_from_backup(path, may_restore, RestoreReason::Damaged, Some(damaged))
            } else {
                Err(damaged)
            }
        }
    }
}

/// Moves an earlier set-aside ledger to `history.json.corrupt.<its last write, unix seconds>` (or the
/// first free `-<n>` after it), so a second set-aside can't replace its bytes. The newest set-aside
/// stays `history.json.corrupt`, the marker `ledger_was_quarantined` and #618's time bound read.
/// Where it went, or `None` when it could not be moved: the caller then leaves the newly damaged
/// file in place.
fn keep_earlier_set_aside(ledger: &Path, corrupt: &Path) -> Option<std::path::PathBuf> {
    let secs = std::fs::symlink_metadata(corrupt)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    (0..100u32)
        .map(|n| match n {
            0 => ledger.with_extension(format!("json.corrupt.{secs}")),
            n => ledger.with_extension(format!("json.corrupt.{secs}-{n}")),
        })
        .find(|older| std::fs::symlink_metadata(older).is_err())
        .filter(|older| std::fs::rename(corrupt, older).is_ok())
}

// ---- The backup copy (reliability slice: the undo history survives one deleted or damaged file) ----
//
// Rules, in one place:
// * WRITE: after a save of the main file has fully succeeded, the SAME serialised bytes are written to
//   `history.json.bak` (temp in the same directory, synced, read back, renamed over the old copy). A
//   save that fails never reaches this step, so a failed save never replaces a good backup. A backup
//   that cannot be refreshed does not fail the save (the main file is already durable); it is reported.
// * RESTORE: only when the main file is missing or does not parse, and only from a backup that parses.
//   A main file that parses always wins; the backup never overwrites it. The damaged main file keeps
//   its existing set-aside name. Nothing is ever deleted.
// * Both bad: exactly today's corrupt-ledger result (fail loud once, bytes set aside, then fresh).
// * No main and no backup: a genuine first run, unchanged.
// * A future "clear history" command must remove `history.json.bak` and `history.json.restored` in the
//   same step, or the cleared rows come back on the next load. No such command exists today.

/// `history.json.bak`, beside the ledger.
fn backup_path(ledger: &Path) -> PathBuf {
    ledger.with_extension("json.bak")
}

/// `history.json.restored`: left behind by a restore so the health surface can say it happened.
fn restored_marker_path(ledger: &Path) -> PathBuf {
    ledger.with_extension("json.restored")
}

#[derive(Clone, Copy)]
enum RestoreReason {
    Missing,
    Damaged,
}

impl RestoreReason {
    fn word(self) -> &'static str {
        match self {
            RestoreReason::Missing => "missing",
            RestoreReason::Damaged => "damaged",
        }
    }
}

enum BackupRead {
    Absent,
    /// The backup exists but could not be READ (not a statement about its bytes): never touched.
    Unreadable(String),
    /// The backup was read and does not parse as a ledger.
    Damaged(String),
    Good(Vec<u8>, Vec<AppliedChange>),
}

fn read_backup(ledger: &Path) -> BackupRead {
    match std::fs::read(backup_path(ledger)) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => BackupRead::Absent,
        Err(e) => BackupRead::Unreadable(e.to_string()),
        Ok(bytes) => match serde_json::from_slice::<Vec<AppliedChange>>(&bytes) {
            Ok(entries) => BackupRead::Good(bytes, entries),
            Err(e) => BackupRead::Damaged(e.to_string()),
        },
    }
}

/// Create `file`, write `bytes`, flush them to the disk.
fn write_new_synced(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = std::fs::File::create(file)?;
    std::io::Write::write_all(&mut f, bytes)?;
    f.sync_all()
}

/// Write `bytes` to `tmp` (synced), optionally read them back, then rename over `dest`. On any
/// failure the temp file is removed and `dest` is exactly as it was.
fn write_beside_and_swap(dest: &Path, tmp: &Path, bytes: &[u8], verify: bool) -> Result<(), String> {
    let done = (|| -> std::io::Result<()> {
        write_new_synced(tmp, bytes)?;
        if verify && std::fs::read(tmp)? != bytes {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "the copy read back different"));
        }
        std::fs::rename(tmp, dest)
    })();
    if done.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    done.map_err(|e| e.to_string())
}

/// Refresh `history.json.bak` from the bytes the main file was just saved with. Called only after the
/// main write has fully succeeded. The bytes must parse as a ledger before they can replace a backup.
fn write_backup_copy(ledger: &Path, json: &[u8]) -> Result<(), String> {
    serde_json::from_slice::<Vec<AppliedChange>>(json)
        .map_err(|e| format!("the saved ledger did not read back as a ledger ({e})"))?;
    write_beside_and_swap(&backup_path(ledger), &ledger.with_extension("json.bak.tmp"), json, true)
}

/// Set a damaged backup aside under a name that never replaces an earlier one. Best effort.
fn set_backup_aside(ledger: &Path) {
    let bak = backup_path(ledger);
    let aside = (0..100u32)
        .map(|n| match n {
            0 => ledger.with_extension("json.bak.corrupt"),
            n => ledger.with_extension(format!("json.bak.corrupt.{n}")),
        })
        .find(|p| std::fs::symlink_metadata(p).is_err());
    if let Some(aside) = aside {
        let _ = std::fs::rename(bak, aside);
    }
}

/// The backup as the lost ledger itself (the main file is missing and the backup does not parse):
/// the same set-aside as a damaged main file, so `ledger_was_quarantined` and its time bound see it.
fn set_backup_aside_as_corrupt_ledger(ledger: &Path) -> bool {
    let corrupt = ledger.with_extension("json.corrupt");
    let cleared = if corrupt.exists() { keep_earlier_set_aside(ledger, &corrupt).map(Some) } else { Some(None) };
    cleared.is_some_and(|moved| {
        let set_aside = std::fs::rename(backup_path(ledger), &corrupt).is_ok();
        if let (false, Some(earlier)) = (set_aside, moved) {
            let _ = std::fs::rename(earlier, &corrupt);
        }
        set_aside
    })
}

/// The main file is missing, or was just set aside as damaged (`damaged` carries that error text).
fn recover_from_backup(
    path: &Path,
    may_restore: bool,
    reason: RestoreReason,
    damaged: Option<String>,
) -> Result<Vec<AppliedChange>, String> {
    match (read_backup(path), damaged) {
        (BackupRead::Good(bytes, entries), damaged) => {
            if may_restore {
                restore_main_from(path, &bytes, entries, reason) // records its own evidence on success
            } else {
                // A view (the capability-holding load writes it back). Evidence only at the moment the
                // damaged file was just set aside, never once per UI poll of a missing file.
                if damaged.is_some() {
                    record_restore_evidence("view", reason);
                }
                Ok(entries)
            }
        }
        // Raced with a removal of the backup: the answer is whatever the main file's situation was.
        (BackupRead::Absent, None) => Ok(Vec::new()),
        (BackupRead::Absent, Some(damaged)) => Err(damaged),
        (BackupRead::Unreadable(e), None) => Err(format!(
            "The Trust Ledger is missing and its backup copy could not be read right now (read: {e}). \
             Nothing was changed, and Compy will not record changes until it can read it again."
        )),
        (BackupRead::Unreadable(e), Some(damaged)) => {
            Err(format!("{damaged} Its backup copy could not be read right now either (read: {e}); it was left where it is."))
        }
        // Main missing and the only copy is damaged: that copy is the lost ledger. Fail loud once.
        (BackupRead::Damaged(e), None) => {
            let preserved = set_backup_aside_as_corrupt_ledger(path);
            Err(format!(
                "The Trust Ledger could not be read (parse: {e}). {}",
                if preserved {
                    "Its only copy was set aside as history.json.corrupt - nothing was overwritten, and \
                     Compy will not record changes over it."
                } else {
                    "Its only copy was left in place - Compy will not record changes over it."
                }
            ))
        }
        // Both bad: today's corrupt-ledger result. The damaged backup is kept aside, never overwritten.
        (BackupRead::Damaged(_), Some(damaged)) => {
            set_backup_aside(path);
            Err(damaged)
        }
    }
}

/// Write the backup's bytes back as the main file. The marker goes first (a restore nobody can see
/// is a silent one, so one that cannot be marked is refused). The main file is put in place without
/// ever replacing a file that is already there: if one appeared since the load, it wins.
fn restore_main_from(
    path: &Path,
    bytes: &[u8],
    entries: Vec<AppliedChange>,
    reason: RestoreReason,
) -> Result<Vec<AppliedChange>, String> {
    let refuse = |what: &str, e: &dyn std::fmt::Display| {
        format!(
            "The Trust Ledger's backup copy is good but could not be restored ({what}: {e}). It was left \
             where it is, and Compy will not record changes until the ledger can be restored."
        )
    };
    // The marker this call writes is undone on every exit that is not a successful placement: one this
    // call created is removed, one that was already there is put back byte for byte.
    let marker = restored_marker_path(path);
    let marker_before = std::fs::read(&marker).ok();
    let marked = !entries.is_empty();
    if marked {
        let saved = backup_saved_at(path).map(|t| format!(" {t}")).unwrap_or_default();
        let note = format!("{} {}{saved}\n", Utc::now().to_rfc3339(), reason.word());
        write_beside_and_swap(&marker, &path.with_extension("json.restored.tmp"), note.as_bytes(), false)
            .map_err(|e| refuse("marker", &e))?;
    }
    let undo_marker = || {
        if !marked {
            return;
        }
        match &marker_before {
            None => {
                let _ = std::fs::remove_file(&marker);
            }
            Some(old) => {
                let _ = write_beside_and_swap(&marker, &path.with_extension("json.restored.tmp"), old, false);
            }
        }
    };
    let tmp = path.with_extension("json.restore.tmp");
    // A leftover from a crash between the link and its removal can share a file with the main file
    // (or with a set-aside copy of it): drop the NAME first so writing never truncates that file.
    let _ = std::fs::remove_file(&tmp);
    if let Err(e) = write_new_synced(&tmp, bytes) {
        undo_marker();
        return Err(refuse("write", &e));
    }
    let placed = match std::fs::hard_link(&tmp, path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(_) if path.exists() => Ok(false),
        // A volume without hard links: rename, after the same "nothing there" check.
        Err(_) => std::fs::rename(&tmp, path).map(|()| true),
    };
    let _ = std::fs::remove_file(&tmp);
    match placed {
        Ok(true) => {
            record_restore_evidence("restored", reason);
            Ok(entries)
        }
        // A ledger was put there first (a concurrent save): theirs wins, read it as it is.
        Ok(false) => {
            undo_marker();
            load_history_core(path, true)
        }
        Err(e) => {
            undo_marker();
            Err(refuse("place", &e))
        }
    }
}

/// One support-evidence entry for a restore: only the reason word, never a path or a row.
fn record_restore_evidence(code: &str, reason: RestoreReason) {
    crate::support_evidence::record(
        crate::support_evidence::EventKind::Ledger,
        "ledger_restore",
        code,
        crate::support_evidence::Outcome::Ok,
        reason.word(),
    );
}

/// When the backup copy was last written (UTC, whole seconds), if the file system says.
fn backup_saved_at(ledger: &Path) -> Option<String> {
    let modified = std::fs::metadata(backup_path(ledger)).and_then(|m| m.modified()).ok()?;
    Some(chrono::DateTime::<Utc>::from(modified).to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// What the health surface should say about a restore, if one happened (or is pending).
fn restored_note_at(path: &Path) -> Option<String> {
    const TAIL: &str = "Changes made after that copy was saved may not be listed; if something you changed is not here, use Find leftovers.";
    if let Ok(marker) = std::fs::read_to_string(restored_marker_path(path)) {
        let mut words = marker.split_whitespace().skip(1);
        let why = match words.next() {
            Some("damaged") => "damaged",
            Some("missing") => "missing",
            _ => "missing or damaged",
        };
        let saved = words.next().map(|t| format!(" saved {t}")).unwrap_or_default();
        return Some(format!(
            "Compy restored your change history from its backup copy{saved} (the main file was {why}). {TAIL}"
        ));
    }
    // Pending: the rows on screen are the backup's and nothing has been written back. Whether that ever
    // happens depends on the data root (a redirected or conflicted root never restores), so no promise.
    (!path.exists() && backup_path(path).exists()).then(|| {
        let saved = backup_saved_at(path).map(|t| format!(" saved {t}")).unwrap_or_default();
        format!(
            "Compy is showing your change history from its backup copy{saved} because the main file is \
             missing or damaged; it has not been written back yet. {TAIL}"
        )
    })
}

/// Persist the ledger. Takes the `MutationRoot` capability rather than a path: a receipt may only
/// ever be written under a root Compy has PROVEN is the machine's own (#130). Under a redirected
/// root no token exists, so this function is unreachable — that is the fix, expressed as a type
/// instead of as a check someone has to remember to write.
fn save_history(root: &MutationRoot, h: &[AppliedChange]) -> Result<(), String> {
    let saved = std::fs::create_dir_all(root.path())
        .map_err(|e| e.to_string())
        .and_then(|()| save_history_to_reporting(&ledger_path_for(root), h));
    // The write side of the same story: a receipt that cannot be persisted is the failure that
    // strands a real machine change with no rollback contract. Support needs to see it happened.
    if let Err(e) = &saved {
        crate::support_evidence::record(
            crate::support_evidence::EventKind::Ledger,
            "ledger_save",
            "unwritable",
            crate::support_evidence::Outcome::Failed,
            e,
        );
    }
    // The main file is durable; a backup copy that could not be refreshed is reported, never fatal.
    // Once per process: a backup that stays unwritable fails on every save (twice per mutation), and
    // the support record is a 400-entry ring that other evidence would be pushed out of.
    static BACKUP_REPORTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if let Ok(Some(why)) = &saved {
        if claim_once(&BACKUP_REPORTED) {
            crate::support_evidence::record(
                crate::support_evidence::EventKind::Ledger,
                "ledger_backup",
                "not_refreshed",
                crate::support_evidence::Outcome::Failed,
                why,
            );
        }
    }
    saved.map(|_| ())
}

/// True exactly once per flag (the first caller claims it).
fn claim_once(flag: &std::sync::atomic::AtomicBool) -> bool {
    !flag.swap(true, std::sync::atomic::Ordering::Relaxed)
}

/// The path-parameterized save without the backup report (the production caller is `save_history`,
/// which reports through support evidence); the unit tests drive it directly in temp directories.
#[cfg(test)]
fn save_history_to(path: &Path, h: &[AppliedChange]) -> Result<(), String> {
    save_history_to_reporting(path, h).map(|_| ())
}

/// `Ok(None)`: the main file and its backup copy are both written. `Ok(Some(why))`: the main file is
/// durable but the backup copy could not be refreshed (the previous backup is untouched).
fn save_history_to_reporting(path: &Path, h: &[AppliedChange]) -> Result<Option<String>, String> {
    let json = serde_json::to_string_pretty(h).map_err(|e| e.to_string())?;
    // Crash-safe (H1): write the full new ledger BESIDE the live one, then atomically swap it
    // in (same-volume rename; std maps to MoveFileEx + REPLACE_EXISTING on Windows). A crash
    // mid-write can only ever leave a stale-but-valid history.json plus an ignorable .tmp —
    // never a torn ledger.
    // The new bytes reach the disk BEFORE the swap (codebase review 2026-11-02): without the flush,
    // a power cut or a crash just after the rename could leave history.json pointing at bytes that
    // were never written, which the next load sets aside as damage, receipts and all.
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("write: {e}"))?;
    std::io::Write::write_all(&mut file, json.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("write: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|e| format!("swap: {e}"))?;
    // Only now, with the main file fully in place, refresh the backup copy from the SAME bytes.
    Ok(write_backup_copy(path, json.as_bytes()).err())
}

/// Prove the ledger is WRITABLE before mutating the machine (H1, write side).
///
/// The existing H1 guard loads the ledger before dispatch, so an unreadable/corrupt ledger blocks
/// the change. But a *readable* ledger can still fail to *write* at receipt time (data dir went
/// read-only, volume full, ACL change) — and if the mutation already ran, that orphans it: a real
/// system change we could never record and therefore never roll back, exactly the "never mutate
/// what can't be recorded" invariant inverted. `save_history` is atomic (temp-write + same-volume
/// rename), so re-saving the CURRENT, unchanged ledger is a content-identical no-op that exercises
/// the very write+rename path the post-mutation receipt will use. If it fails we refuse BEFORE any
/// elevation, so nothing is changed. (Not a TOCTOU guarantee — the volume could still fill in the
/// millisecond between canary and receipt — but it converts the common, deterministic un-writable
/// cases from "silent orphaned mutation" into "clean pre-mutation refusal.")
fn ensure_ledger_writable(root: &MutationRoot, history: &[AppliedChange]) -> Result<(), String> {
    save_history(root, history).map_err(|e| {
        format!(
            "refusing to apply: the change ledger isn't writable right now, so this change \
             couldn't be recorded — and an unrecorded change can't be rolled back. Nothing on \
             your system was changed. ({e})"
        )
    })
}

/// The opening move of EVERY mutation, in the one order that is safe, so no gateway can do two of
/// the three and skip the third:
///
/// 1. **#130** — prove the data root is the machine own verified-canonical root, and take the
///    `MutationRoot` capability. A redirected, conflicted or unavailable root refuses right here,
///    before anything on the machine is touched, and explains itself in plain English.
/// 2. **H1 read side** — load the ledger. A change that cannot be recorded must not happen.
/// 3. **H1 write side** — prove the ledger is writable with a content-identical canary save, so a
///    readable-but-unwritable ledger cannot let the mutation land and then orphan its receipt.
///
/// Returning the token alongside the history is what makes the rest of the gateway honest: the
/// receipt it later saves goes to the SAME root it just read.
fn begin_mutation() -> Result<(MutationRoot, Vec<AppliedChange>), String> {
    let root = crate::data_root::mutation_root()?;
    let history = load_history_for(&root)?;
    ensure_ledger_writable(&root, &history)?;
    Ok((root, history))
}

/// Every rec id Compy can ACTUALLY one-click apply, mapped to its audited `apply_*`. This is the
/// SINGLE source of truth for "is there a real apply for this id": `dispatch_apply` runs the mapped
/// fn, and `is_appliable` asks only whether the mapping exists (never running it). Any id not mapped
/// falls to the caller's "not supported" error. All arms are non-capturing closures so they coerce to
/// one `fn` pointer type — that lets `is_appliable` be a pure lookup with no second copy of the list.
#[allow(clippy::redundant_closure)] // uniform closures keep every arm the same fn-pointer type
fn apply_fn_for(rec_id: &str) -> Option<fn() -> Result<ApplyResult, String>> {
    let f: fn() -> Result<ApplyResult, String> = match rec_id {
        "game-mode" => || apply_game_mode(),
        "visual-effects" => || apply_visual_effects(),
        "sysmain-disable" => || apply_service_disable(KnownService::SysMain),
        "nvidia-telemetry" => || apply_service_disable(KnownService::NvTelemetryContainer),
        "power-ultimate" => || apply_power_ultimate(),
        "nagle-disable" => || apply_nagle_disable(),
        "hags-enable" => || apply_hags_enable(),
        "mouse-accel-off" => || apply_mouse_accel_off(),
        "game-bar-disable" => || apply_game_bar_disable(),
        "diagtrack-disable" => || apply_service_disable(KnownService::DiagTrack),
        "windows-search-disable" => || apply_service_disable(KnownService::WSearch),
        "fast-startup-off" => || apply_fast_startup_off(),
        "reserved-storage-off" => || apply_reserved_storage_off(),
        "usb-selective-suspend-off" => || apply_usb_selective_suspend_off(),
        "pcie-aspm-off" => || apply_pcie_aspm_off(),
        "eee-disable" => || apply_eee_disable(),
        _ => return None,
    };
    Some(f)
}

/// The ONE dispatch from rec id to its audited apply_* — `apply_recommendation` and the §4 batch
/// orchestrator both go through here, so there is no second copy of the match to drift.
fn dispatch_apply(_root: &MutationRoot, rec_id: &str) -> Result<ApplyResult, String> {
    match apply_fn_for(rec_id) {
        Some(f) => f(),
        None => Err(format!("'{}' is not yet supported for one-click apply", rec_id)),
    }
}

/// True iff Compy has a real one-click apply for this rec id (`dispatch_apply` would run an `apply_*`,
/// not its fallback). Read-only — it NEVER runs the apply, just checks the mapping. Shares `apply_fn_for`
/// with `dispatch_apply` as the single source of truth, so the experiment simulator
/// (`experiment::build_sim_context`) can flag advisory-only recs as not-testable and never invite a
/// Start that would dead-end at the apply boundary.
pub(crate) fn is_appliable(rec_id: &str) -> bool {
    apply_fn_for(rec_id).is_some()
}

/// Display-title cap for ledger receipts. Titles come from our own catalog (all < 100 chars);
/// the cap is defense-in-depth at the webview trust boundary — a compromised UI must not be able
/// to bloat history.json with megabyte "titles" through the apply commands.
const MAX_REC_TITLE_LEN: usize = 200;

/// Build the full-contract ledger receipt for a completed apply. Shared by the single apply and
/// the batch (identical receipt either way — rollback granularity is per item, unchanged).
///
/// CR-ultimate-identity (review r2): `plans_before` is the scheme list read before an Ultimate apply
/// (provenance); the post-apply reads are bounded and run only for the Ultimate apply.
fn build_applied_change(
    rec_id: &str,
    rec_title: &str,
    result: ApplyResult,
    plans_before: Option<&[String]>,
) -> Result<AppliedChange, String> {
    // Review r3 (sonnet): ONE bounded read of the active scheme serves both questions, and it reads
    // the GUID with `scheme_guid_of`, which ignores the label Windows prints in the user's language
    // (as `actions::current_power_plan_guid` now does too). Taken only when asked, which
    // is only for the Ultimate apply.
    let seen: std::cell::OnceCell<Option<ObservedPlan>> = std::cell::OnceCell::new();
    let read = || seen.get_or_init(|| bounded_read(crate::current_power_scheme)).clone();
    build_applied_change_with(rec_id, rec_title, result, || read().map(|o| o.guid), |g| is_ultimate_plan(g, read, plans_before))
}

/// [`build_applied_change`] with the read of the active scheme handed in (CR-ultimate-identity).
fn build_applied_change_with(
    rec_id: &str,
    rec_title: &str,
    result: ApplyResult,
    read_active_plan: impl FnOnce() -> Option<String>,
    is_ultimate: impl FnOnce(&str) -> bool,
) -> Result<AppliedChange, String> {
    let snapshot_json = serde_json::to_value(&result.snapshot)
        .map_err(|e| format!("snapshot serialize: {}", e))?;
    // CR-ultimate-identity: the verify read of the scheme the apply activated (read-only powercfg).
    let applied_plan = activated_plan_from(&result, read_active_plan).filter(|p| is_ultimate(&p.guid));
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
        provenance: None,
        // A5 rig tagging — every receipt path funnels through here, so every new entry
        // records the hardware it was applied on. Local-only.
        hw_fingerprint: Some(crate::hardware::current_fingerprint()),
        rolled_back_at: None,
        justified_by_experiment: None,
        rollback_justified_by_experiment: None,
        changed_outside: None,
        applied_plan,
        nothing_restored: None,
    })
}

/// A change Windows already has, waiting for its receipt: what the receipt will say, plus the
/// `ApplyResult` its audited `apply_*` returned, which carries the typed undo for it.
struct Made {
    rec_id: String,
    rec_title: String,
    provenance: Option<&'static str>,
    /// P5-outcomes-f1: the Trial an outcome-switch apply cites (None everywhere else).
    justified_by: Option<TrialLink>,
    /// CR-ultimate-identity: the schemes listed just before an Ultimate apply (None everywhere else).
    plans_before: Option<Vec<String>>,
    result: ApplyResult,
}

impl Made {
    fn new(rec_id: &str, rec_title: &str, result: ApplyResult) -> Self {
        Made {
            rec_id: rec_id.to_string(),
            rec_title: rec_title.to_string(),
            provenance: None,
            justified_by: None,
            plans_before: None,
            result,
        }
    }
}

/// What undoing a change needs from the machine. Production passes `actions::dispatch_rollback`
/// (the one mutation boundary) and the ledger's own live re-check ([`check_change_state`], given
/// the rec id and the typed action the apply returned, so a startup-app, bloat-task or
/// service-suspend undo is read back as precisely as its ledger row would be); the guard tests pass
/// fakes, so they never touch Windows.
struct UndoEffects<'a> {
    rollback: &'a dyn Fn(&RollbackAction, &Snapshot) -> Result<(), String>,
    /// The rec id and the typed action the row carries (`None` for a legacy row without one).
    probe: &'a dyn Fn(&str, Option<&AppliedAction>) -> ActiveCheck,
}

/// [`UndoEffects`] for the user's undo ([`commit_rollback`]): production passes
/// `actions::dispatch_rollback_outcome`, which also says when there was nothing left to restore
/// (CR-core-parking-plan-gone).
struct RollbackEffects<'a> {
    rollback: &'a dyn Fn(&RollbackAction, &Snapshot) -> Result<UndoDone, String>,
    probe: &'a dyn Fn(&str, Option<&AppliedAction>) -> ActiveCheck,
}

/// Rollback-first receipt commit (#616), the ONLY way an apply gateway records what it did.
///
/// Every change in `made` is already on Windows. Their receipts are built, appended to `history`, and
/// the ledger is saved once. If a receipt can't be built or the save fails, none of these changes may
/// stay on the machine without an undo record. So each one is undone at once through the typed
/// rollback its own apply produced (newest first), `history` is put back as it was, and the `Err` says
/// for each change whether the undo ran and what a live read of the setting shows now. Before this, a
/// failed save left the change applied with no undo in Test → Applied & history, behind an error that
/// read as though nothing had happened.
fn commit_receipts(
    history: &mut Vec<AppliedChange>,
    made: Vec<Made>,
    save: &dyn Fn(&[AppliedChange]) -> Result<(), String>,
    effects: &UndoEffects,
) -> Result<Vec<AppliedChange>, String> {
    let build = |m: Made| -> Result<AppliedChange, String> {
        let mut change = build_applied_change(&m.rec_id, &m.rec_title, m.result, m.plans_before.as_deref())?;
        change.provenance = m.provenance.map(str::to_string);
        change.justified_by_experiment = m.justified_by;
        Ok(change)
    };
    commit_receipts_with(history, made, &build, save, effects)
}

/// [`commit_receipts`] with the receipt builder passed in, so a test can make a build fail part
/// way through a list. Production builds only through [`commit_receipts`].
fn commit_receipts_with(
    history: &mut Vec<AppliedChange>,
    made: Vec<Made>,
    build: &dyn Fn(Made) -> Result<AppliedChange, String>,
    save: &dyn Fn(&[AppliedChange]) -> Result<(), String>,
    effects: &UndoEffects,
) -> Result<Vec<AppliedChange>, String> {
    // Copy each undo BEFORE the receipt builder consumes its result. Once a receipt fails, this copy
    // is the only record of how to reverse what Windows now has.
    let undos: Vec<Undo> = made
        .iter()
        .map(|m| Undo {
            rec_id: m.rec_id.clone(),
            title: m.rec_title.chars().take(MAX_REC_TITLE_LEN).collect(),
            applied: m.result.applied_action.clone(),
            action: m.result.rollback_action.clone(),
            snapshot: m.result.snapshot.clone(),
        })
        .collect();
    let before = history.len();
    let committed = made
        .into_iter()
        .map(build)
        .collect::<Result<Vec<_>, String>>()
        .and_then(|changes| {
            history.extend(changes.iter().cloned());
            save(history).map(|()| changes)
        });
    committed.map_err(|why| {
        history.truncate(before);
        undo_unrecorded(&undos, &why, effects)
    })
}

/// One change's typed undo, copied out of its `ApplyResult` before the receipt builder consumes it.
struct Undo {
    rec_id: String,
    title: String,
    /// What the apply did, so the live read after the undo knows which way to read.
    applied: AppliedAction,
    action: RollbackAction,
    snapshot: Snapshot,
}

/// Undo every change whose receipt failed, newest first, and describe what happened to each. `why`
/// is the build or save error that made the undo necessary. Each undo runs even when an earlier one
/// failed, because every change left in place is one the user can't undo from Compy.
fn undo_unrecorded(undos: &[Undo], why: &str, effects: &UndoEffects) -> String {
    let mut outcomes: Vec<String> = undos
        .iter()
        .rev()
        .map(|u| {
            let undone = (effects.rollback)(&u.action, &u.snapshot);
            let outcome = undo_outcome(&undone, (effects.probe)(&u.rec_id, Some(&u.applied)));
            if undos.len() == 1 {
                outcome
            } else {
                format!("{}: {outcome}", u.title)
            }
        })
        .collect();
    outcomes.reverse();
    let head = if undos.len() == 1 {
        format!(
            "Compy made this change but couldn't save its undo record ({why}), so it tried to \
             undo the change straight away."
        )
    } else {
        format!(
            "Compy made {} changes but couldn't save their undo records ({why}), so it tried to \
             undo each one straight away.",
            undos.len()
        )
    };
    format!("{head} {}", outcomes.join(" "))
}

/// PURE: one change's undo outcome in plain English: did the typed rollback run, and what does a
/// live read of the setting say now. Only a read that comes back OFF confirms the change is gone. A
/// failed undo is stated plainly, because the change then stays on the machine with no undo record.
fn undo_outcome(undone: &Result<(), String>, read: ActiveCheck) -> String {
    const NOT_LISTED: &str =
        "It isn't listed in Test → Applied & history, so Compy can't undo it later";
    match (undone, read) {
        (Ok(()), ActiveCheck::Off) => {
            "Undone: a live read confirms the change is no longer in effect.".to_string()
        }
        (Ok(()), ActiveCheck::On) => format!(
            "The undo ran, but a live read still shows the setting as changed (it may have been set \
             this way before Compy touched it). {NOT_LISTED}; check the setting in Windows."
        ),
        (Ok(()), ActiveCheck::Unreadable) => {
            "The undo ran, but Compy couldn't read the setting back to confirm it.".to_string()
        }
        (Ok(()), ActiveCheck::Unrecognised) => "The undo ran. Compy has no live read for this \
             setting, so it can't confirm the result beyond that."
            .to_string(),
        (Err(e), ActiveCheck::Off) => format!(
            "The undo reported an error ({e}), but a live read shows the change is not in effect. \
             {NOT_LISTED}; check the setting in Windows."
        ),
        (Err(e), ActiveCheck::On) => format!(
            "Undo failed ({e}): a live read shows the change is still in effect. {NOT_LISTED}; set \
             it back in Windows."
        ),
        (Err(e), ActiveCheck::Unreadable) => format!(
            "Undo failed ({e}): treat the change as still in effect, because Compy couldn't read the \
             setting back to check. {NOT_LISTED}; set it back in Windows."
        ),
        (Err(e), ActiveCheck::Unrecognised) => format!(
            "Undo failed ({e}): treat the change as still in effect, because Compy has no live read \
             for this setting. {NOT_LISTED}; set it back in Windows."
        ),
    }
}

/// [`commit_receipts`] against the real machine: the ledger save under the proven root, the typed
/// rollback through `actions::dispatch_rollback`, and the ledger's live re-check. Adds no mutation
/// primitive; the undo is the same dispatch `rollback_change` uses.
fn record_receipts(
    root: &MutationRoot,
    history: &mut Vec<AppliedChange>,
    made: Vec<Made>,
) -> Result<Vec<AppliedChange>, String> {
    let save = |h: &[AppliedChange]| save_history(root, h);
    let undo_failed = std::cell::Cell::new(false);
    let rollback = |a: &RollbackAction, s: &Snapshot| {
        dispatch_rollback(root, a, s).inspect_err(|_| undo_failed.set(true))
    };
    let probe = |rec_id: &str, applied: Option<&AppliedAction>| {
        check_change_state(rec_id, applied, &LiveReads::default())
    };
    let effects = UndoEffects { rollback: &rollback, probe: &probe };
    commit_receipts(history, made, &save, &effects).inspect_err(|e| {
        // A change that had to be undone because it couldn't be recorded, and above all one whose
        // undo failed (it is still on the machine with no undo record), is a case support must be
        // able to find.
        crate::support_evidence::record(
            crate::support_evidence::EventKind::Ledger,
            "receipt_commit",
            if undo_failed.get() { "undo_failed_unrecorded" } else { "undone_unrecorded" },
            crate::support_evidence::Outcome::Failed,
            e,
        );
    })
}

/// The one-change form of [`record_receipts`], used by every single-apply gateway.
fn record_receipt(
    root: &MutationRoot,
    history: &mut Vec<AppliedChange>,
    made: Made,
) -> Result<AppliedChangeView, String> {
    record_receipts(root, history, vec![made])?
        .pop()
        .map(into_view)
        .ok_or_else(|| "internal error: the change was recorded but its receipt was not returned".to_string())
}

/// Leftovers v2 (R2-5) — ARMED 2026-07-16: restore one leftover to its Windows default.
/// The registered Tauri command from the arming commit until s23 (previously double-dark: unregistered AND
/// gate-refused), flipped only after the owner-present live-UAC QA harness passed all three
/// loops (`manual_restore_qa` — W32PS/MPO/memcompress). Mirrors apply_recommendation exactly:
/// lock → load BEFORE mutate (H1) → one resolver → receipt with provenance "leftover_adopted" →
/// atomic save. Undo rides the standard typed rollback path like any other ledger entry.
/// CR-core-parking-held-with-plan: the webview's command is `experiment::restore_leftover`, which
/// takes Gaming Mode's gate before this (core parking writes the ACTIVE plan); this module never
/// calls into the Gaming Mode orchestrator (store-lock-order guard).
pub(crate) fn restore_leftover(
    detector_id: &str,
    display_title: &str,
) -> Result<AppliedChangeView, String> {
    // The production gate. Test builds also consult the owner-present QA bypass seam
    // (leftovers::QaRestoreGateBypass — thread-local RAII, mirrors actions::ForceElevationError)
    // so the live UAC QA can drive this path; `#[cfg(test)]` compiles the seam out of every
    // shipped binary, where this is exactly the bare restore_gate() refusal.
    #[cfg(not(test))]
    let gate_open = crate::leftovers::restore_gate();
    #[cfg(test)]
    let gate_open = crate::leftovers::restore_gate() || crate::leftovers::qa_restore_gate_bypassed();
    if !gate_open {
        return Err("Leftovers restore is not enabled in this build.".to_string());
    }
    let _lock = lock_history()?;
    let (root, mut history) = begin_mutation()?;
    let result = match detector_id {
        "memory-compression-off" => crate::actions::restore_memory_compression(),
        "mmcss-tampering" => crate::actions::restore_mmcss_defaults(),
        "win32-priority-separation" => crate::actions::restore_priority_separation(),
        // Wave 2 (2026-06-11; armed 2026-07-16). bcdedit + Defender have NO resolver — permanent
        // by policy (boot-config risk class / security-settings owner territory), not "not yet";
        // tripwire-tested in permanently_excluded_detectors_have_no_resolver_even_armed.
        "pagefile-fixed" => crate::actions::restore_pagefile_automatic(),
        "mpo-disabled" => crate::actions::restore_mpo_default(),
        "core-parking-forced" => crate::actions::restore_core_parking_default(),
        "tcp-autotuning-off" => crate::actions::restore_tcp_autotuning_default(),
        other => Err(format!("no restore resolver exists for '{other}' yet")),
    }?;
    let made = Made {
        provenance: Some("leftover_adopted"),
        ..Made::new(detector_id, display_title, result)
    };
    record_receipt(&root, &mut history, made)
}

/// Support evidence (spec §12) for the mutation boundary. Only FAILURES are recorded: a
/// successful apply or rollback already has a far better record — its Trust Ledger receipt, with
/// the typed rollback contract and snapshot. Duplicating successes here would spend the bounded
/// 400-record ceiling re-stating what `history.json` says properly, and push the actual failures
/// out of the window. A decline is separated from a failure by the ONE canonical message allowed
/// to claim the user declined (`actions::ELEVATION_DECLINED_MSG`, itself test-pinned), so support
/// is never told a user cancelled when they didn't — the same trust rule `elevation_outcome`
/// exists to protect.
fn record_operation_failure(operation: &str, code: &str, err: &str) {
    let outcome = if err == crate::actions::ELEVATION_DECLINED_MSG {
        crate::support_evidence::Outcome::Refused
    } else {
        crate::support_evidence::Outcome::Failed
    };
    crate::support_evidence::record(
        crate::support_evidence::EventKind::Operation,
        operation,
        code,
        outcome,
        err,
    );
}

/// The audited apply. The UI's `apply_recommendation` command is `experiment::apply_recommendation`,
/// which refuses a setting a running Trial holds and then calls this under the Trial store gate
/// (CR-rp-same-setting-row); the Trial lifecycle inside that gate calls this directly.
pub(crate) fn apply_recommendation(rec_id: String, rec_title: String) -> Result<AppliedChangeView, String> {
    apply_reported(&rec_id, &rec_title, None)
}

/// P5-outcomes-f1: [`apply_recommendation`] for the Trial bench's outcome switch, recording the
/// Trial that justified it. Same audited apply and receipt; the only difference is the link on the
/// row. The caller (`experiment::apply_outcome_choice`) has already checked the Trial against its
/// own store, so this module never reads the experiment store.
pub(crate) fn apply_recommendation_citing(
    rec_id: &str,
    rec_title: &str,
    link: TrialLink,
) -> Result<AppliedChangeView, String> {
    apply_reported(rec_id, rec_title, Some(link))
}

fn apply_reported(rec_id: &str, rec_title: &str, link: Option<TrialLink>) -> Result<AppliedChangeView, String> {
    let applied = apply_recommendation_inner(rec_id, rec_title, link);
    if let Err(e) = &applied {
        record_operation_failure(&format!("apply:{rec_id}"), "apply_failed", e);
    }
    applied
}

fn apply_recommendation_inner(
    rec_id: &str,
    rec_title: &str,
    justified_by: Option<TrialLink>,
) -> Result<AppliedChangeView, String> {
    let _lock = lock_history()?;
    // Load BEFORE dispatching (H1): if the ledger can't record a receipt, the change must not
    // happen at all — never mutate what can't be written down. Same audited dispatch + receipt
    // as before; only the refusal moved ahead of the mutation.
    // ...and prove the root and the ledger together (#130 + the H1 write side): a readable-but-
    // unwritable ledger, or a redirected root, would let the mutation succeed and then orphan or
    // misfile its receipt. Refuse before elevation.
    let (root, mut history) = begin_mutation()?;
    // CR-ultimate-identity: read-only, bounded, and only for the Ultimate apply.
    let plans_before = plans_before_ultimate_apply(rec_id);
    let result = dispatch_apply(&root, rec_id)?;
    // Rollback-first (#616): a receipt that can't be saved undoes the change it describes.
    record_receipt(&root, &mut history, Made { justified_by, plans_before, ..Made::new(rec_id, rec_title, result) })
}

/// Session-scoped service SUSPEND (Services module, BUILT DARK). Gated by `service_suspend_gate()` —
/// refuses until the feature's own UAC QA + owner sign-off (it's a NEW mutating capability the owner
/// greenlit on 2026-06-22, LOCKED-rule-6, but the ARMING still rides QA). Reuses the audited
/// apply/record machinery: the typed snapshot lands in the ledger, so RESUME goes through the normal
/// `rollback_change` → `dispatch_rollback` path (the new `ResumeServiceFromSnapshot` arm). The
/// `KnownService` allowlist + `from_name` mean only the four safe services are ever suspendable.
///
/// The command the webview reaches is `experiment::suspend_known_service`, which refuses a service a
/// Gaming Mode session holds and then calls this (CR-gm-service-suspend-rows).
pub(crate) fn suspend_known_service(service_name: String) -> Result<AppliedChangeView, String> {
    if !crate::actions::service_suspend_gate() {
        return Err("Session service-suspend isn't enabled in this build.".to_string());
    }
    let service = crate::actions::KnownService::from_name(&service_name)
        .ok_or_else(|| format!("'{}' isn't a Compy-suspendable service.", service_name))?;
    let rec_id = suspend_rec_id(&service);
    let _lock = lock_history()?;
    let (root, mut history) = begin_mutation()?;
    let result = crate::actions::apply_service_suspend(service)?;
    let made = Made::new(
        &rec_id,
        &format!("Suspend {} for this session", service_name),
        result,
    );
    record_receipt(&root, &mut history, made)
}

/// The ledger rec id of a session-suspend row (the command's gate checks the same id).
pub(crate) fn suspend_rec_id(service: &crate::actions::KnownService) -> String {
    format!("service-suspend:{}", service.name())
}

/// Startup-entry toggle — the audited replacement for the raw registry write that used to live in
/// `lib.rs`. Deliberately UNGATED: this is a live, shipped control (Check / Fix / Optimize all call
/// it), so gating it dark would remove a working feature. What changes is that it now produces a
/// receipt like every other mutation — typed snapshot of the exact prior value, ledger entry, and
/// rollback through the normal `rollback_change` → `dispatch_rollback` path.
///
/// No allowlist here, unlike its siblings, and that is deliberate: the startup list is per-machine
/// and user-owned, so there is no curated set to check against. The safety comes from the snapshot,
/// not from an enum — and `apply_startup_entry_enabled` refuses outright when the prior value
/// cannot be read.
#[tauri::command]
pub(crate) fn set_startup_entry_enabled(
    name: String,
    enabled: bool,
) -> Result<AppliedChangeView, String> {
    let _lock = lock_history()?;
    let (root, mut history) = begin_mutation()?;
    let result = crate::actions::apply_startup_entry_enabled(&name, enabled)?;
    let made = Made::new(
        &format!("startup-entry:{}", name),
        &format!(
            "{} startup entry: {}",
            if enabled { "Enable" } else { "Disable" },
            name
        ),
        result,
    );
    record_receipt(&root, &mut history, made)
}

/// OS-debloat: disable a curated telemetry scheduled task (BUILT DARK). Gated by `bloat_removal_gate()`
/// — refuses until the feature's own UAC QA + owner sign-off (the gated mutation the owner greenlit
/// 2026-06-22, LOCKED-rule-6). Reuses the audited apply/record path: the typed snapshot lands in the
/// ledger, so RE-ENABLE flows through the normal `rollback_change` → `dispatch_rollback` path (the new
/// `EnableScheduledTask` arm). `KnownBloatTask::from_id` enforces the allowlist (off-list → refused).
#[tauri::command]
pub(crate) fn disable_known_bloat_task(task_id: String) -> Result<AppliedChangeView, String> {
    if !crate::actions::bloat_removal_gate() {
        return Err("Bloat-task removal isn't enabled in this build.".to_string());
    }
    let task = crate::actions::KnownBloatTask::from_id(&task_id)
        .ok_or_else(|| format!("'{}' isn't a Compy-removable telemetry task.", task_id))?;
    let _lock = lock_history()?;
    let (root, mut history) = begin_mutation()?;
    let result = crate::actions::apply_disable_scheduled_task(task)?;
    let made = Made::new(
        &format!("bloat-task:{}", task_id),
        &format!("Disable telemetry task ({})", task_id),
        result,
    );
    record_receipt(&root, &mut history, made)
}

/// Phase-B preload-app removal (BUILT DARK 2026-07-06). Gated by `preload_removal_gate()` — refuses
/// until the feature's own live QA (remove→reinstall round trip, Store links verified) + the owner's
/// curated-list + arming sign-off (the owner's 2026-07-06 nod covered BUILDING it, LOCKED-rule-6).
/// Reuses the audited apply/record path: the typed snapshot lands in the ledger, so the restore flows
/// through the normal `rollback_change` → `dispatch_rollback` path (the `ReinstallPreloadApp` arm).
/// `KnownPreloadApp::from_id` enforces the allowlist (off-list → refused before anything runs).
#[tauri::command]
pub(crate) fn remove_known_preload_app(app_id: String) -> Result<AppliedChangeView, String> {
    if !crate::actions::preload_removal_gate() {
        return Err("Preinstalled-app removal isn't enabled in this build.".to_string());
    }
    let app = crate::actions::KnownPreloadApp::from_id(&app_id)
        .ok_or_else(|| format!("'{}' isn't a Compy-removable preinstalled app.", app_id))?;
    let _lock = lock_history()?;
    let (root, mut history) = begin_mutation()?;
    let result = crate::actions::apply_remove_preload_app(app)?;
    let made = Made::new(
        &format!("preload-app:{}", app_id),
        &format!("Remove preinstalled app ({})", app_id),
        result,
    );
    record_receipt(&root, &mut history, made)
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

/// PURE: what the batch's one elevated step did for one staged item. Only an error that proves the
/// elevated process never ran (UAC declined, launch failed) means nothing changed. Any other error
/// means the script ran and failed part-way, so items that wrote an ok receipt before it stopped are
/// on Windows and still get their ledger receipt (#616); the rest must not claim nothing changed.
fn elevated_item_outcome(
    run: &Result<(), String>,
    receipts: &std::collections::HashMap<String, bool>,
    rec_id: &str,
) -> Result<(), String> {
    match run {
        Err(e) if elevation_error_nothing_ran(e) => Err(format!(
            "Elevation did not complete — nothing was changed for this item. ({e})"
        )),
        Err(e) => resolve_receipt(receipts, rec_id).map_err(|reason| {
            format!(
                "{reason} The admin step also stopped with an error ({e}), so Compy can't be sure \
                 it changed nothing: check this setting in Windows."
            )
        }),
        Ok(()) => resolve_receipt(receipts, rec_id),
    }
}

/// PURE: the `Err` the batch returns when the receipts for its admin step can't be committed (so
/// those changes were undone). `admin_outcomes` are the admin step's per-item outcomes. The items it
/// didn't confirm aren't in that commit, and the report that would have carried their warnings
/// ("can't be sure it changed nothing: check this setting in Windows") is dropped with the `Err`,
/// so their reasons go in the error text instead.
fn admin_commit_error(e: String, recorded_before_admin: bool, admin_outcomes: &[BatchItemOutcome]) -> String {
    let mut text = e;
    if recorded_before_admin {
        text.push_str(" The changes made before the admin step are recorded as normal.");
    }
    let skipped: Vec<String> = admin_outcomes
        .iter()
        .filter(|o| o.status == "skipped")
        .map(|o| format!("{}: {}", o.rec_title, o.reason.as_deref().unwrap_or("skipped.")))
        .collect();
    if !skipped.is_empty() {
        text.push_str(&format!(" Not applied by the admin step: {}", skipped.join(" ")));
    }
    text
}

/// The audited one-elevation batch. The UI's command of the same name is
/// `experiment::apply_recommendations_batch`, which refuses the batch when it names a setting a
/// running Trial holds (CR-rp-same-setting-row).
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

    let _lock = lock_history()?;
    // H1: refuse the whole batch before phase 1 if the ledger can't record receipts — readable
    // (load) AND writable (canary), so a readable-but-unwritable ledger can't let phase-1 mutations
    // (HKCU, immediate) succeed and then orphan their receipts.
    let (root, mut history) = begin_mutation()?;
    let mut outcomes: Vec<BatchItemOutcome> = Vec::new();
    let mut applied = 0usize;

    struct Deferred {
        rec_id: String,
        rec_title: String,
        result: ApplyResult,
        cmds: std::ops::Range<usize>,
    }
    let mut staged: Vec<Deferred> = Vec::new();
    // Changes phase 1 made at once. Their receipts are committed after the deferral sink closes, so
    // an undo that needs elevation (#616) can never be parked in this batch's elevated script.
    let mut made_now: Vec<Made> = Vec::new();

    // ── Phase 1 — every apply runs with the deferral sink armed. Non-elevated recs mutate
    // (HKCU) and are receipted right after this block, exactly like a single apply. Elevated recs
    // perform their READS and park their one PS command (no partial mutation — see the sink's
    // safety note).
    let all_cmds: Vec<String> = {
        let guard = ElevationDeferral::begin()?;
        let mut cursor = 0usize;
        for it in &items {
            match dispatch_apply(&root, &it.rec_id) {
                Err(e) => outcomes.push(outcome_skipped(&it.rec_id, &it.rec_title, e)),
                Ok(result) => {
                    let now = guard.deferred_count();
                    if now == cursor {
                        // No elevated step → the mutation already happened → honest receipt below.
                        made_now.push(Made::new(&it.rec_id, &it.rec_title, result));
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
    // non-elevated items their ledger entries. If they can't be recorded they are undone (#616) and
    // the batch stops before its elevated step, so nothing else is changed.
    if !made_now.is_empty() {
        record_receipts(&root, &mut history, made_now).map_err(|e| {
            if staged.is_empty() {
                e
            } else {
                format!("{e} The rest of the batch was stopped before its admin step, so nothing else was changed.")
            }
        })?;
    }
    let recorded_before_admin = applied > 0;

    // ── Phase 2 — ONE elevation for every deferred command, receipts to a result FILE (data,
    // not code: reading it never executes anything), then a ledger receipt per confirmed item.
    let mut elevation_prompts = 0usize;
    if !staged.is_empty() {
        let receipts_path = root.path().join(format!(
            "elevation-batch-{}.receipts",
            Utc::now().timestamp_millis()
        ));
        std::fs::create_dir_all(root.path()).map_err(|e| e.to_string())?;
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
        // A declined UAC ran nothing, so every item is skipped and the phase-1 items stand on their
        // own receipts. Any other error means the script ran and stopped part-way: the result file
        // is still the only evidence of which items finished, so it is read either way (#616).
        let run = run_elevated_powershell(&script);
        let text = std::fs::read_to_string(&receipts_path).unwrap_or_default();
        // Read once, so remove it now: a receipt commit that fails below returns early.
        let _ = std::fs::remove_file(&receipts_path);
        let receipts = parse_batch_receipts(&text);
        let mut made_elevated: Vec<Made> = Vec::new();
        let first_admin_outcome = outcomes.len();
        for d in staged {
            match elevated_item_outcome(&run, &receipts, &d.rec_id) {
                Ok(()) => {
                    made_elevated.push(Made::new(&d.rec_id, &d.rec_title, d.result));
                    applied += 1;
                    outcomes.push(outcome_applied(&d.rec_id, &d.rec_title));
                }
                Err(reason) => outcomes.push(outcome_skipped(&d.rec_id, &d.rec_title, reason)),
            }
        }
        if !made_elevated.is_empty() {
            record_receipts(&root, &mut history, made_elevated).map_err(|e| {
                admin_commit_error(e, recorded_before_admin, &outcomes[first_admin_outcome..])
            })?;
        }
    }

    let skipped = outcomes.iter().filter(|o| o.status == "skipped").count();
    Ok(BatchApplyReport {
        items: outcomes,
        applied,
        skipped,
        elevation_prompts,
    })
}

/// The audited undo. The UI's `rollback_change` command is `experiment::rollback_change`, which
/// refuses a setting a Gaming Mode session holds and then calls this (CR-gm-spans-followups d); the
/// Trial and benchmark restores call this directly.
pub(crate) fn rollback_change(change_id: String) -> Result<(), String> {
    rollback_reported(&change_id, None)
}

/// CR-gm-spans-followups (d): the setting ledger row `change_id` changed, read without the ledger
/// lock (a row's rec id never changes). `None` when no row has that id (the undo then says so). A
/// ledger that can't be read is an error: the undo would refuse it too (H1).
///
/// CR-range3-nits (b): a READ only. `load_history` sets a damaged file aside (a rename), and this
/// runs without the ledger lock, so a locked writer could set the damaged file aside and save a new
/// ledger between this read and this rename, and the rename would then move the NEW ledger aside.
/// So nothing is renamed here: a damaged or unreadable ledger is an error (the undo stops before
/// anything runs) and is set aside by the next locked load. The lock isn't taken instead because an
/// apply holds it through its Windows permission prompt, and this answers the UI's undo.
pub(crate) fn rec_id_of_change(change_id: &str) -> Result<Option<String>, String> {
    Ok(read_history_unlocked(&history_path())?.into_iter().find(|c| c.id == change_id).map(|c| c.rec_id))
}

/// What the first look shows of one change Compy made: its title and when. Strings as the ledger holds them.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LedgerStamp {
    pub title: String,
    pub applied_at: String,
    pub rolled_back_at: Option<String>,
    /// "applied" | "rolled_back".
    pub status: String,
}

/// Compy's own changes, titles and dates only, from a read that never moves, writes or reports anything
/// (`read_history_unlocked`: no lock, no set-aside of a damaged ledger, no restore from the backup copy).
/// A ledger that can't be read is an error, never an empty list. The path is the data root's, taken without
/// the legacy-folder migration `compy_data_dir` can run.
pub(crate) fn read_ledger_stamps() -> Result<Vec<LedgerStamp>, String> {
    read_ledger_stamps_for(crate::data_root::decision())
}

/// The ledger for a data-root decision. A root that could not be settled has no ledger path to read: that
/// is an error, never "no changes".
fn read_ledger_stamps_for(root: &crate::data_root::DataRootDecision) -> Result<Vec<LedgerStamp>, String> {
    if matches!(root, crate::data_root::DataRootDecision::Unavailable { .. }) {
        return Err("Compy's data folder is not available".to_string());
    }
    read_ledger_stamps_at(&root.effective_root().join("history.json"))
}

pub(crate) fn read_ledger_stamps_at(path: &Path) -> Result<Vec<LedgerStamp>, String> {
    Ok(read_history_unlocked(path)?
        .into_iter()
        .map(|c| LedgerStamp { title: c.rec_title, applied_at: c.applied_at, rolled_back_at: c.rolled_back_at, status: c.status })
        .collect())
}

/// PURE-ish read of the ledger at `path` that never moves, writes or reports anything. Absent is an
/// empty ledger; a file that can't be read or doesn't parse is an error naming which.
fn read_history_unlocked(path: &Path) -> Result<Vec<AppliedChange>, String> {
    if !path.exists() {
        // A backup copy beside a missing ledger is not "no history": read it (a view; nothing is
        // written or moved here).
        return match read_backup(path) {
            BackupRead::Absent => Ok(Vec::new()),
            BackupRead::Good(_, entries) => Ok(entries),
            BackupRead::Unreadable(e) => Err(format!(
                "The Trust Ledger is missing and its backup copy could not be read right now (read: {e}). Nothing was changed."
            )),
            BackupRead::Damaged(e) => Err(format!(
                "The Trust Ledger is missing and its backup copy could not be read (parse: {e}). Nothing was changed."
            )),
        };
    }
    let bytes = std::fs::read(path)
        .map_err(|e| format!("The Trust Ledger could not be read right now (read: {e}). Nothing was changed."))?;
    serde_json::from_slice(&bytes)
        .map_err(|e| format!("The Trust Ledger could not be read (parse: {e}). Nothing was changed."))
}

/// What an outcome-switch undo cites: given the ledger row's rec id, the checked Trial link, or why
/// that Trial can't justify undoing this change (then nothing is undone).
pub(crate) type CiteTrial<'a> = &'a dyn Fn(&str) -> Result<TrialLink, String>;

/// P5-outcomes-f1: [`rollback_change`] for the Trial bench's outcome switch. `cite` is checked
/// against the row's change before the undo runs, and its link is saved on the row with
/// `rolled_back_at`. Same audited undo; `cite` reads the experiment store without a lock.
pub(crate) fn rollback_change_citing(change_id: &str, cite: CiteTrial) -> Result<(), String> {
    rollback_reported(change_id, Some(cite))
}

fn rollback_reported(change_id: &str, cite: Option<CiteTrial>) -> Result<(), String> {
    // A rollback that will not complete is the worst thing that can happen in a rollback-first
    // product, and it is the one report support must be able to act on. An undo that DID reach
    // Windows but couldn't be saved to the ledger (#631) is a different case with its own code, so
    // support never reads it as a change still on the machine. The change id is a local uuid, not
    // user data.
    match rollback_change_inner(change_id, cite) {
        Ok(()) => Ok(()),
        Err(RollbackError::Failed(e)) => {
            record_operation_failure(&format!("rollback:{change_id}"), "rollback_failed", &e);
            Err(e)
        }
        Err(RollbackError::Unrecorded(e)) => {
            record_operation_failure(&format!("rollback:{change_id}"), "rollback_unrecorded", &e);
            Err(e)
        }
    }
}

/// Why a user's rollback did not finish cleanly (#631).
#[derive(Debug, PartialEq, Eq)]
enum RollbackError {
    /// The undo did not run, or did not finish: treat the change as still in effect.
    Failed(String),
    /// The undo ran on Windows, but the ledger couldn't be saved to say so. Never a failed undo.
    Unrecorded(String),
}

impl From<String> for RollbackError {
    fn from(e: String) -> Self {
        RollbackError::Failed(e)
    }
}

/// The fixed lead of every [`RollbackError::Unrecorded`] message. The frontend can key on it to
/// tell an unrecorded undo from a failed one, so it is test-pinned.
/// `src/data/rollback-error.ts` mirrors it, and its test pins the two equal.
pub(crate) const ROLLBACK_UNRECORDED_LEAD: &str =
    "The undo ran on Windows, but Compy couldn't save that to its history";

/// Whether a `rollback_change` error is the unrecorded case (the undo ran, only the history save
/// failed) rather than a failed undo.
pub(crate) fn is_unrecorded_rollback(err: &str) -> bool {
    err.starts_with(ROLLBACK_UNRECORDED_LEAD)
}

fn rollback_change_inner(change_id: &str, cite: Option<CiteTrial>) -> Result<(), RollbackError> {
    let _lock = lock_history()?;
    // #130: prove the root before anything else — a rollback dispatched against a redirected
    // ledger would undo a change the receipt in front of us does not actually describe.
    let root = crate::data_root::mutation_root()?;
    // H1: a corrupt ledger refuses the rollback loudly (the file is preserved for recovery)
    // rather than reporting "change not found" against a silently-empty list.
    let mut history = load_history_for(&root)?;
    let idx = history
        .iter()
        .position(|c| c.id == change_id)
        .ok_or_else(|| format!("change '{}' not found in history", change_id))?;
    if history[idx].status == "rolled_back" {
        // NOTE: experiment::restore_already_reverted matches this exact literal to tell an
        // already-off change from a genuine restore failure — keep the two in sync (guard-tested).
        return Err(RollbackError::Failed("change has already been rolled back".into()));
    }
    // P5-outcomes-f1: a cited Trial must fit this row's change. Checked before the undo runs.
    let justified_by = cite.map(|cite| cite(&history[idx].rec_id)).transpose()?;

    let save = |h: &[AppliedChange]| save_history(&root, h);
    let rollback = |a: &RollbackAction, s: &Snapshot| dispatch_rollback_outcome(&root, a, s);
    let probe = |rec_id: &str, applied: Option<&AppliedAction>| {
        check_change_state(rec_id, applied, &LiveReads::default())
    };
    commit_rollback(&mut history, idx, justified_by, &save, &RollbackEffects { rollback: &rollback, probe: &probe })
}

/// The user's rollback of ledger row `idx`, after the lookup: resolve its typed rollback, run it,
/// mark the row rolled back and save the ledger. Production passes the real save, dispatch and
/// live read; the guard tests pass fakes, so they never touch Windows.
///
/// If the save fails after the undo ran (#631), the undo is NOT re-applied: Windows is already back
/// the way it was, which is what the user asked for. The row is put back as it was in memory, the
/// setting is read live, and the error says the undo ran but couldn't be saved, never that it
/// failed.
fn commit_rollback(
    history: &mut [AppliedChange],
    idx: usize,
    justified_by: Option<TrialLink>,
    save: &dyn Fn(&[AppliedChange]) -> Result<(), String>,
    effects: &RollbackEffects,
) -> Result<(), RollbackError> {
    let change = history[idx].clone();
    let (action, snapshot) = resolve_rollback(&change)?;
    let done = (effects.rollback)(&action, &snapshot)?;

    history[idx].status = "rolled_back".into();
    // CR-core-parking-plan-gone: an undo with nothing left to restore closes the row the same way,
    // and its receipt says why nothing was written.
    let nothing_ran = matches!(done, UndoDone::NothingToRestore(_));
    history[idx].nothing_restored = match done {
        UndoDone::Restored => None,
        UndoDone::NothingToRestore(why) => Some(why),
    };
    // Honest rollback dating (Intelligence Phase 2): stamped at the moment the rollback
    // actually dispatched. Only entries rolled back from this stamp onward carry a date.
    history[idx].rolled_back_at = Some(Utc::now().to_rfc3339());
    history[idx].rollback_justified_by_experiment = justified_by;
    save(history).map_err(|why| {
        if nothing_ran {
            // CR-core-parking-hidden-plan: nothing ran on Windows, so never "the undo ran". The row
            // stays as it was and the undo can simply be tried again.
            history[idx] = change;
            return RollbackError::Failed(nothing_to_restore_unsaved_message(&why));
        }
        let read = (effects.probe)(&change.rec_id, change.applied_action.as_ref());
        history[idx] = change;
        RollbackError::Unrecorded(rollback_unrecorded_message(&why, read))
    })
}

/// PURE (CR-core-parking-hidden-plan): an undo found nothing left to restore, so nothing ran on
/// Windows, but the ledger couldn't be saved to close the row.
fn nothing_to_restore_unsaved_message(why: &str) -> String {
    format!(
        "Compy found nothing left to restore for this change and ran nothing on Windows, but it couldn't \
         save that to its history ({why}), so the change still shows as applied. Nothing was changed; \
         try again in a moment."
    )
}

/// PURE: what to tell the user when their undo ran on Windows but the ledger couldn't record it.
/// `read` is a live read of the setting after the undo. It always leads with
/// [`ROLLBACK_UNRECORDED_LEAD`], so it can never read as a failed undo.
fn rollback_unrecorded_message(why: &str, read: ActiveCheck) -> String {
    let tail = match read {
        ActiveCheck::Off => "A live read confirms the change is no longer in effect.",
        ActiveCheck::On => {
            "But a live read still shows the setting as changed (it may have been set this way \
             before Compy touched it), so check the setting in Windows."
        }
        ActiveCheck::Unreadable => "Compy couldn't read the setting back to confirm the result.",
        ActiveCheck::Unrecognised => {
            "Compy has no live read for this setting, so it can't confirm the result beyond that."
        }
    };
    format!(
        "{ROLLBACK_UNRECORDED_LEAD} ({why}), so Test → Applied & history may still list this \
         change as applied. {tail}"
    )
}

#[tauri::command]
pub(crate) fn get_applied_changes() -> Vec<AppliedChangeView> {
    // Read-only VIEW. The signature stays infallible (export + the benchmark trial runner
    // consume it), so a corrupt ledger degrades to an empty view here — but never to data
    // loss: load_history has already set the damaged file aside untouched, and every
    // MUTATING command (apply / batch / rollback) refuses loudly instead of saving over it.
    // The empty view is never left to speak for itself: `get_ledger_health` is the companion read
    // that tells the surface whether this list is the whole story, so "nothing is active" can only
    // render when that is a fact.
    applied_change_views(&load_history().unwrap_or_default())
}

/// Whether the LATEST Trust-Ledger entry for `rec_id` is an active apply (status "applied", not
/// rolled back). Keeps the Game Mode keeper rollback-bound: it only re-asserts a state the user
/// actually applied via Compy (so the snapshot/undo exists in local history), never one the
/// (untrusted) webview merely asked for. A corrupt/empty/absent ledger reads false — fail-safe:
/// no re-assert without a resolvable rollback.
pub(crate) fn rec_is_active(rec_id: &str) -> bool {
    load_history()
        .unwrap_or_default()
        .iter()
        .rev()
        .find(|c| c.rec_id == rec_id)
        .map(|c| c.status == "applied")
        .unwrap_or(false)
}

/// Total Trust-Ledger entry count — the confound watermark for the cross-session comparison engine.
/// The ledger is append-only in code, so the SAME ledger can only ever read the same count or more;
/// any other reading means it is not the same ledger, and the delta can't be honestly attributed.
///
/// Returns `Err` rather than a number, deliberately, and there is no `unwrap_or_default` sibling:
/// a collapsed read here is not a missing count, it is a FABRICATED one. `load_history_from`
/// quarantines a corrupt ledger to `history.json.corrupt`, after which every load returns empty
/// forever — so the collapsed value (0) sits BELOW any armed watermark while real changes are free
/// to land into the fresh ledger. The comparison engine's callers must decide what to do with that
/// (refuse to arm; refuse to attribute), and they can only decide it if they can see it.
pub(crate) fn ledger_len_checked() -> Result<usize, String> {
    load_history().map(|h| h.len())
}

/// A before/after comparison's two confound marks over one read of the ledger: its entry count, and
/// how many of its rows are not rolled back. Recorded status only, never a live probe. Pure, so the
/// undo half can't silently become a second entry count (review round 2, 2026-11-02).
pub(crate) fn ledger_marks_of(h: &[AppliedChange]) -> (usize, usize) {
    (h.len(), h.iter().filter(|c| c.status != "rolled_back").count())
}

/// Whether the newest not-rolled-back row of `rec_id` reads Off on this machine now (review round 2,
/// 2026-11-02): an armed before/after's own fix undone outside Compy (Windows Update putting a setting
/// back) changes no recorded status, so the marks above can't see it. `Some(true)` only for a read that
/// came back Off; `None` when there is no such row or the ledger can't be read. Read-only, takes no
/// lock, and may run a live probe, so a caller holding a store lock must not call it.
pub(crate) fn newest_applied_reads_off(rec_id: &str) -> Option<bool> {
    let h = load_history().ok()?;
    let row = newest_applied_row(&h, rec_id)?;
    Some(check_row_state(row, &LiveReads::default()) == ActiveCheck::Off)
}

/// The newest row of `rec_id` that isn't rolled back: the apply a live check of that change reads.
fn newest_applied_row<'a>(h: &'a [AppliedChange], rec_id: &str) -> Option<&'a AppliedChange> {
    h.iter().rev().find(|c| c.rec_id == rec_id && c.status != "rolled_back")
}

/// Whether a damaged Trust Ledger was ever set aside as `history.json.corrupt`.
///
/// The DURABLE half of "is this the whole ledger?". `load_history_from` quarantines a ledger it
/// cannot parse and then fails loud — but only that once. After the rename the real path is simply
/// gone, so every later load succeeds with an empty vec, indistinguishable from a first run,
/// forever. A caller that turns ledger silence into a CLAIM ("Compy changed nothing between these
/// sessions") would keep fabricating that claim off the fresh, empty file; the marker on disk is
/// the only evidence left that the silence is a LOSS and not a fresh start.
///
/// Pair it with the `Err` from a load, which covers the transient half (locked file, IO error,
/// permissions). Callers that merely DISPLAY history need neither — an empty view is honest.
/// Best-effort and read-only: an unreadable directory reads `false`, the same answer every caller
/// had before this existed.
pub(crate) fn ledger_was_quarantined() -> bool {
    history_path().with_extension("json.corrupt").exists()
}

/// How far a set-aside Trust Ledger reached (#618): the moment `history.json.corrupt` was last written.
///
/// `Ok(None)`: nothing was ever set aside. `Ok(Some(t))`: every change the lost ledger recorded was
/// applied or undone at or before `t`. `Err`: a marker may exist, but its time can't be read, so
/// callers must treat the whole ledger as in doubt. Unknown stays unknown.
///
/// This is the file's modified time, not the time of the rename. A rename keeps the modified time,
/// so `t` is when the lost ledger was last WRITTEN, which is at or before the rename. That is the
/// bound a "did anything move since X?" check needs. Every row the lost file held was saved at or
/// before `t`. Nothing can move between that last write and the rename, because every apply and
/// every rollback loads the ledger BEFORE it touches Windows (`begin_mutation`,
/// `rollback_change_inner`), and the first load of a damaged file is the one that sets it aside and
/// refuses, or, when a good `history.json.bak` exists, restores the backup's rows (a reader shows them
/// and the next mutation load writes them back); either way every move after the rename is recorded
/// in the ledger that is now live.
///
/// Which way it can be wrong: a marker touched later than the lost ledger's last write (a backup or
/// scanner rewriting it) moves the edge later, toward refusing more sessions, the safe side. The one
/// direction no read here can see is a marker back-dated by something outside Compy (see
/// `experiment::ledger_for_one_change_checks`). A marker that isn't a plain file (a directory, a
/// link) has no trustworthy time and is unknown, never "nothing set aside" (#618 review).
///
/// Read-only: one metadata read. It does not write, and it never takes a time from the clock.
pub(crate) fn ledger_set_aside_through() -> Result<Option<chrono::DateTime<Utc>>, String> {
    set_aside_through_at(&history_path())
}

fn set_aside_through_at(path: &Path) -> Result<Option<chrono::DateTime<Utc>>, String> {
    match std::fs::symlink_metadata(path.with_extension("json.corrupt")) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("the set-aside change history can't be checked ({e})")),
        Ok(meta) if !meta.is_file() => Err("the set-aside change history isn't a plain file, so its time can't be trusted".into()),
        Ok(meta) => meta
            .modified()
            .map(|t| Some(chrono::DateTime::<Utc>::from(t)))
            .map_err(|e| format!("the set-aside change history has no readable time ({e})")),
    }
}

/// How much later than a set-aside ledger's last write a session must begin to count as covered by
/// the fresh one (#618). A file's modified time is stamped from a coarser clock than a session start
/// (about 16 ms on NTFS, 2 s on FAT), so a session begun just before that write could otherwise read
/// as just after it.
pub(crate) const SET_ASIDE_TIME_SLACK: chrono::TimeDelta = chrono::TimeDelta::seconds(2);

/// What the Trust Ledger can say about Compy's moves since a session began (#618). The set-aside
/// marker is permanent, so a plain "was it ever set aside?" refused every Trial on that PC forever;
/// the loss has an edge in time instead ([`ledger_set_aside_through`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LedgerCoverage {
    /// Nothing was ever set aside: the ledger is the whole history.
    Whole,
    /// A damaged ledger was set aside, last written at the time held here, and the session began
    /// more than [`SET_ASIDE_TIME_SLACK`] after it: the fresh ledger holds every Compy move since the
    /// session began. Its counts are NOT totals: changes the lost ledger recorded may still be in
    /// place, so they compare only with counts made since the same set-aside.
    SinceSetAside(chrono::DateTime<Utc>),
    /// The session began at or before the lost ledger's last write: moves it needs may be lost.
    Lost,
    /// A marker exists but its time can't be read, or the session's start can't be. Unknown stays
    /// unknown: nothing that needs coverage passes on it.
    Unknown,
}

/// Pure (#618): [`LedgerCoverage`] for a session that began at `began` (RFC 3339), from
/// [`ledger_set_aside_through`]'s answer. Instants are compared, never text.
pub(crate) fn ledger_coverage(
    set_aside_through: Result<Option<chrono::DateTime<Utc>>, String>,
    began: Option<&str>,
) -> LedgerCoverage {
    let through = match set_aside_through {
        Ok(None) => return LedgerCoverage::Whole,
        Ok(Some(t)) => t,
        Err(_) => return LedgerCoverage::Unknown,
    };
    let Some(edge) = through.checked_add_signed(SET_ASIDE_TIME_SLACK) else {
        return LedgerCoverage::Unknown;
    };
    match began.and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok()) {
        Some(began) if began.with_timezone(&Utc) > edge => LedgerCoverage::SinceSetAside(through),
        Some(_) => LedgerCoverage::Lost,
        None => LedgerCoverage::Unknown,
    }
}

/// What Compy can honestly say about its OWN record right now — the read side of the question
/// `intelligence::LedgerHealth` already answers for the "What changed?" engine.
///
/// `get_applied_changes` degrades a broken ledger to an empty view. That is honest as a LIST and a
/// lie as an ANSWER: the Trust Ledger surface renders "Nothing is active on this PC" — an
/// affirmative claim about the machine — at the exact moment every apply and every rollback is
/// refusing loudly. This is what the surface needs in order to say *"Compy can't tell you what it
/// did"* instead. It resolves the follow-up recorded at `get_applied_changes`.
///
/// Read-only and additive: no mutation, no elevation, no network.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct LedgerHealthView {
    /// True only when the ledger loads AND no damaged predecessor was ever set aside. When this is
    /// false the entry list is not evidence of anything — least of all of a quiet machine.
    pub complete: bool,
    /// The load failure verbatim. Already user-readable prose that names what happened to the
    /// damaged file, so the surface can show it rather than invent its own account.
    ///
    /// `None` while the loss is purely historical: a quarantined ledger loads clean-and-empty
    /// forever after, so `complete: false` with no error is the durable shape, not a contradiction.
    pub error: Option<String>,
    /// `history.json.corrupt` sits beside the ledger — the original bytes are still on disk, which
    /// is the difference between "your record is gone" and "your record is set aside, unopened".
    pub quarantined: bool,
    /// Set when the change history was (or is about to be) restored from `history.json.bak` because the
    /// main file was missing or damaged: the sentence the surface can show. `None` otherwise. Does not
    /// by itself make the ledger incomplete: the restored rows are the backup's.
    pub restored: Option<String>,
}

fn ledger_health_at(path: &Path) -> LedgerHealthView {
    // Load FIRST. A load that fails performs the quarantine rename as part of failing, so reading
    // the marker afterwards catches the damage discovered on THIS call as well as an older one;
    // reading it first would miss a fresh quarantine by one run.
    let error = load_history_from(path).err();
    let quarantined = path.with_extension("json.corrupt").exists();
    LedgerHealthView { complete: error.is_none() && !quarantined, error, quarantined, restored: restored_note_at(path) }
}

#[tauri::command]
pub(crate) fn get_ledger_health() -> LedgerHealthView {
    // The path-parameterized core deliberately, NOT the `load_history` wrapper: the wrapper records
    // a support-evidence event on every failure, and support evidence is a 400-slot ring that drops
    // its oldest on append. A probe the UI re-runs on every refresh would push 400 identical
    // "ledger unreadable" records through it and erase the diagnostic history support actually
    // needs. The failure is already recorded once per tick by `get_applied_changes`'s own load —
    // the load whose result the user is looking at.
    ledger_health_at(&history_path())
}

/// The Explorer argument that shows the user their own record. `/select,` reveals the quarantined
/// file *highlighted inside its folder* rather than opening it — the bytes are damaged JSON, so
/// launching them would hand the user a text editor full of noise; showing them the file proves it
/// still exists, which is the whole point of quarantine over deletion.
///
/// Falls back to the folder itself when nothing was quarantined, because the transient failure
/// shape (locked file, IO error) leaves the ledger where it always was.
fn ledger_reveal_arg(path: &Path) -> std::ffi::OsString {
    let quarantined = path.with_extension("json.corrupt");
    if quarantined.exists() {
        let mut arg = std::ffi::OsString::from("/select,");
        arg.push(quarantined.as_os_str());
        return arg;
    }
    path.parent().unwrap_or(path).as_os_str().to_os_string()
}

/// Show the user the ledger folder — the inline action for the "Compy can't tell you what it did"
/// disclosure. [[flags-name-it-and-fix-it-inline]]: naming a path the user must then hunt for by
/// hand is exactly the dead-end that rule forbids.
///
/// Read-only: reveals a folder, spawns no shell, elevates nothing, mutates no Windows state. Same
/// `explorer` idiom as `export::open_export_folder`.
#[tauri::command]
pub(crate) fn reveal_ledger_folder() -> Result<(), String> {
    let path = history_path();
    if let Some(dir) = path.parent() {
        // A first run that never wrote a ledger still has a folder to show.
        std::fs::create_dir_all(dir).map_err(|e| format!("could not open the Compy folder: {e}"))?;
    }
    std::process::Command::new("explorer")
        .arg(ledger_reveal_arg(&path))
        .spawn()
        .map_err(|e| format!("could not open the folder: {e}"))?;
    Ok(())
}

/// Read-only roll-up of the Trust Ledger for surfaces that need counts rather
/// than the full view (e.g. Game Readiness, a session's start count). `active` / `cant_confirm` are
/// per change by the shared rule; `total` / `rolled_back` / `externally_reverted` are the newest row
/// per rec_id by position (`externally_reverted` = the live system reads it off: changed outside
/// Compy). Computed from local history alone, like everything else here.
#[derive(serde::Serialize, Clone, Debug, Default)]
pub(crate) struct AppliedChangesSummary {
    pub(crate) total: usize,
    /// Changes whose newest live apply reads On ([`live_change_groups`]).
    pub(crate) active: usize,
    /// Changes still applied whose live check could not read the machine or has no probe: neither
    /// on nor off on the evidence. Never part of `active` (453-f1).
    pub(crate) cant_confirm: usize,
    /// The rec ids behind `active`, sorted: what a Trial start names as "other changes on".
    pub(crate) active_recs: Vec<String>,
    /// The count builds before 453-f1 recorded on a session (newest row per rec_id by position, not
    /// rolled back, and not read as off — can't-confirm included). Kept only so a session an older
    /// Compy recorded is compared like with like, never shown as "active".
    pub(crate) legacy_active: usize,
    pub(crate) rolled_back: usize,
    pub(crate) externally_reverted: usize,
    /// The drifted settings BY NAME (rec titles, sorted for stable output) so surfaces can say
    /// WHICH setting drifted instead of a vague "N setting(s)" (flags-name-it law).
    pub(crate) drifted_titles: Vec<String>,
    /// CR-outside-followups (b): changes that read off because the user chose to keep what was set
    /// outside Compy (a usable "changed outside Compy" record whose state the live read still
    /// shows). Never part of `externally_reverted`: Game Readiness does not flag them. Only the
    /// readiness roll-up ([`applied_changes_summary_checked`]) reads the live state for this; every
    /// other summary leaves it 0 and counts those rows as before.
    pub(crate) kept_outside: usize,
    /// Their titles, sorted, so the priorities layer still dedups them out of "not applied".
    pub(crate) kept_outside_titles: Vec<String>,
    /// CR-kept-outside-nits (d): one of them is the power-plan change, so the plan active now is the
    /// one the user chose to keep (its record holds against the live read); the power-profile row
    /// then doesn't flag it. That row prints the name from its own plan read, a moment apart from
    /// this one: a switch in between can pair the words with the other plan until the next refresh
    /// (review: accepted, the wording stays true of the record).
    pub(crate) kept_outside_plan: bool,
}

/// The roll-up of one ledger read, or why it can't be trusted, in words (#669). Two losses count:
/// the read itself failed (an AV lock, a half-written file), or the ledger was set aside as
/// `history.json.corrupt` earlier — `load_history` fails loud only once on a damaged ledger and
/// every later load returns a fresh, EMPTY ledger that would roll up as "0 changes"; the marker on
/// disk is the only evidence that the silence is a loss (`set_aside` = [`ledger_was_quarantined`],
/// as `experiment::ledger_for_one_change_checks` and `intelligence::gather` read it). Adds no
/// write of its own and no retry; the one load it is handed may have set a damaged ledger aside.
/// Its one production caller is [`applied_changes_summary_checked`] (Game Readiness), so it rolls
/// up through [`summarize_for_readiness`]: with no usable "changed outside Compy" record that is
/// [`summarize_history`] exactly, and no power-plan read is taken.
pub(crate) fn checked_summary(
    loaded: Result<Vec<AppliedChange>, String>,
    set_aside: bool,
) -> Result<AppliedChangesSummary, String> {
    let history = loaded?;
    if set_aside {
        return Err("Compy's change history was damaged earlier and set aside, so part of it is missing".into());
    }
    Ok(summarize_for_readiness(&history))
}

/// The change counts a session records when it begins (453-f1), all from one ledger read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SessionChangeCounts {
    /// Changes whose live check reads On. `None` when every live change is can't-confirm: with
    /// nothing confirmed either way the count is unknown, never 0 (#669, unknown-never-0).
    pub(crate) active: Option<usize>,
    /// Changes still applied that Compy can't confirm (unreadable, or no live check).
    pub(crate) cant_confirm: usize,
    /// [`AppliedChangesSummary::legacy_active`], for comparing with a session an older Compy recorded.
    pub(crate) legacy_active: usize,
}

impl AppliedChangesSummary {
    pub(crate) fn session_counts(&self) -> SessionChangeCounts {
        SessionChangeCounts {
            active: (self.active > 0 || self.cant_confirm == 0).then_some(self.active),
            cant_confirm: self.cant_confirm,
            legacy_active: self.legacy_active,
        }
    }
}

/// The change counts a session records when it begins (#669, #618), from one ledger read.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SessionStartCounts {
    /// The counts over the whole history. `None` when the read failed, or when a ledger was set
    /// aside earlier: the fresh ledger's counts are then not totals, so they are never recorded as
    /// the session's count (every Debrief, Monitor and Trial line reads that back as a total).
    pub(crate) whole: Option<SessionChangeCounts>,
    /// #618: after a set-aside, the fresh ledger's counts and the set-aside time they are counted
    /// since. Complete for every Compy move after that time, never a total: compared only with
    /// counts made since the same set-aside.
    pub(crate) since_set_aside: Option<(SessionChangeCounts, chrono::DateTime<Utc>)>,
}

/// The change counts a session records when it begins at `began`, from one ledger load and then
/// one read of the set-aside marker, in that order (#618 review P2): a set-aside the load caused, or
/// one a background reader made before it, is on disk by the time the marker is read. A failed load,
/// a session begun at or before a set-aside, and an unreadable time all record nothing (#669; never
/// claim unmeasured). The reads come in as closures so a test can stage a set-aside DURING the load.
/// Adds no write of its own and no retry.
pub(crate) fn session_start_counts(
    load: impl FnOnce() -> Result<Vec<AppliedChange>, String>,
    set_aside_through: impl FnOnce() -> Result<Option<chrono::DateTime<Utc>>, String>,
    began: &str,
) -> SessionStartCounts {
    let loaded = load();
    let coverage = ledger_coverage(set_aside_through(), Some(began));
    let Ok(history) = loaded else {
        return SessionStartCounts::default();
    };
    let counts = summarize_history(&history).session_counts();
    match coverage {
        LedgerCoverage::Whole => SessionStartCounts { whole: Some(counts), since_set_aside: None },
        LedgerCoverage::SinceSetAside(at) => SessionStartCounts { whole: None, since_set_aside: Some((counts, at)) },
        LedgerCoverage::Lost | LedgerCoverage::Unknown => SessionStartCounts::default(),
    }
}

/// The Trust Ledger roll-up that keeps a failed read or a set-aside ledger as the error it is,
/// never summarized as zeros, for a surface that must show "can't read" rather than "0"
/// (Game Readiness, #669). Adds no write of its own.
pub(crate) fn applied_changes_summary_checked() -> Result<AppliedChangesSummary, String> {
    checked_summary(load_history(), ledger_was_quarantined())
}

/// CR-outside-followups (b): [`summarize_history`] for Game Readiness, where a change the user
/// recorded as changed outside Compy, and whose recorded state the live read still shows, counts as
/// `kept_outside`, not drifted. One active-plan read, only when some applied row carries a usable
/// record, and none while a Gaming Mode contract is on disk (the plan may then be Compy's); an
/// unreadable plan keeps nothing (the row is flagged as before). Counts nothing else differently.
fn summarize_for_readiness(history: &[AppliedChange]) -> AppliedChangesSummary {
    let reads = LiveReads::default();
    let checks: Vec<Option<ActiveCheck>> = history
        .iter()
        .map(|c| (c.status != "rolled_back").then(|| check_row_state(c, &reads)))
        .collect();
    let observed = kept_outside_observed(history, &reads);
    summarize_checked(history, &checks, |c| recorded_and_holding(c, observed.as_ref()))
}

/// The one active-plan read a "kept outside Compy" decision is made against: taken only when an
/// applied row carries a usable record, and never while a Gaming Mode contract is on disk (the
/// active plan may then be one Compy set). None = no read (nothing is kept on it). The read is the
/// pass's own (CR-kept-plan-read-once): the power-ultimate row's probe already took it.
fn kept_outside_observed(history: &[AppliedChange], reads: &LiveReads) -> Option<ObservedPlan> {
    kept_outside_observed_with(history, || gaming_mode_may_hold_plan().is_some(), || reads.scheme())
}

/// [`kept_outside_observed`] with its two reads handed in, so a test can count them. Pure.
fn kept_outside_observed_with(
    history: &[AppliedChange],
    gaming_mode_may_hold: impl Fn() -> bool,
    read_plan: impl FnOnce() -> Option<ObservedPlan>,
) -> Option<ObservedPlan> {
    let recorded = history
        .iter()
        .any(|c| c.status == "applied" && c.changed_outside.as_ref().and_then(ChangedOutside::usable).is_some());
    if !recorded || gaming_mode_may_hold() {
        return None;
    }
    let seen = read_plan();
    // CR-kept-outside-nits (a): asked again after the read, as `record_changed_outside` does; a
    // session that started meanwhile may have set the plan, so nothing is kept on that read.
    if gaming_mode_may_hold() {
        return None;
    }
    seen
}

/// Read-only: every ledger entry's id, in on-disk (apply) order. Used by the aggregate-stack A/B
/// trial (§2a) to diff which changes a batch apply created — after − before — so its rollback guard
/// undoes EXACTLY those entries and nothing pre-existing. Introduces no mutation; the rollback
/// itself still goes through the audited `rollback_change` boundary.
///
/// Returns the load ERROR rather than swallowing it (rust-tauri-reviewer, §2a): an unreadable ledger
/// must NOT read as "empty" here — `load_history` quarantines a corrupt `history.json` (rename →
/// `.corrupt`) as a read side effect, and a caller that took `[]` and then applied would orphan the
/// user's real prior ledger and mutate against a blank one. The trial propagates this Err and refuses
/// to apply (see `start_stack_trial`), so a corrupt ledger can never chain into an un-tracked mutation.
pub(crate) fn all_change_ids() -> Result<Vec<String>, String> {
    Ok(load_history()?.into_iter().map(|c| c.id).collect())
}

/// One ledger row as the active-change rule reads it: which change it is, its status and time, and
/// what its live check read (`None` when the row is not in the applied state, so nothing was read).
pub(crate) struct LiveRow<'a> {
    pub(crate) rec_id: &'a str,
    pub(crate) status: &'a str,
    pub(crate) applied_at: &'a str,
    pub(crate) check: Option<ActiveCheck>,
}

/// THE rule for which changes are on or can't be confirmed (#453; 453-f1 made it the only one). One
/// group per change (`rec_id`), in first-seen order, represented by the index of its newest apply
/// whose live check reads On, Unreadable or Unrecognised — the apply an undo targets. A change is
/// ACTIVE when that row reads On; Unreadable/Unrecognised is "can't confirm", counted apart. A newer
/// rollback does not hide an older apply that is still applied. "Newest" is by `applied_at` at
/// millisecond precision, truncated (all `Date.parse` keeps on the TS side); a tie or an
/// unparseable time keeps the first seen. Health (`machine_model.rs`), the session count
/// ([`summarize_history`]) and `src/data/live-changes.ts` `liveChangeGroups` (Optimize, History)
/// all count through this rule, pinned by `src/test/fixtures/live-changes-parity.json`.
pub(crate) fn live_change_groups(rows: &[LiveRow<'_>]) -> Vec<usize> {
    fn time(c: &LiveRow<'_>) -> Option<i64> {
        chrono::DateTime::parse_from_rfc3339(c.applied_at).ok().map(|t| t.timestamp_millis())
    }
    let mut order: Vec<&str> = Vec::new();
    let mut by_rec: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (i, c) in rows.iter().enumerate() {
        let live = c.status == "applied"
            && matches!(c.check, Some(ActiveCheck::On | ActiveCheck::Unreadable | ActiveCheck::Unrecognised));
        if !live {
            continue;
        }
        match by_rec.get(c.rec_id).copied() {
            None => {
                order.push(c.rec_id);
                by_rec.insert(c.rec_id, i);
            }
            Some(prev) => {
                // TS: `time(c) > time(prev)` with an unparseable time as -Infinity.
                let newer = match (time(c), time(&rows[prev])) {
                    (Some(a), Some(b)) => a > b,
                    (Some(_), None) => true,
                    _ => false,
                };
                if newer {
                    by_rec.insert(c.rec_id, i);
                }
            }
        }
    }
    order.into_iter().map(|r| by_rec[r]).collect()
}

/// The roll-up of the ledger with each row's live check read now. `active` / `cant_confirm` are the
/// shared per-change rule ([`live_change_groups`]), so a session's recorded count, the Debrief, the
/// Monitor line and the Trial guards agree with Health, Optimize and History (453-f1).
pub(crate) fn summarize_history(history: &[AppliedChange]) -> AppliedChangesSummary {
    let reads = LiveReads::default();
    let checks: Vec<Option<ActiveCheck>> = history
        .iter()
        .map(|c| (c.status != "rolled_back").then(|| check_row_state(c, &reads)))
        .collect();
    summarize_checked(history, &checks, |_| false)
}

/// [`summarize_history`] with the live checks already read, one per row (`None` for a rolled-back
/// row), where a newest row that reads off and for which `kept_outside` says yes counts as kept
/// outside Compy instead of drifted (`|_| false` keeps nothing: the session/Trial roll-up). Pure, so
/// the shared parity fixture can drive it.
fn summarize_checked(
    history: &[AppliedChange],
    checks: &[Option<ActiveCheck>],
    kept_outside: impl Fn(&AppliedChange) -> bool,
) -> AppliedChangesSummary {
    let mut s = AppliedChangesSummary::default();

    // What is on: one count per change, the shared rule.
    let rows: Vec<LiveRow<'_>> = history
        .iter()
        .zip(checks)
        .map(|(c, check)| LiveRow {
            rec_id: &c.rec_id,
            status: &c.status,
            applied_at: &c.applied_at,
            check: *check,
        })
        .collect();
    let groups = live_change_groups(&rows);
    let live_recs: std::collections::HashSet<&str> = groups.iter().map(|&i| history[i].rec_id.as_str()).collect();
    s.active_recs = groups
        .iter()
        .filter(|&&i| checks[i] == Some(ActiveCheck::On))
        .map(|&i| history[i].rec_id.clone())
        .collect();
    s.active_recs.sort();
    s.active = s.active_recs.len();
    s.cant_confirm = groups.len() - s.active;

    // Drift, for Game Readiness: the LATEST entry per rec_id by position decides, so re-applying OR
    // rolling back a setting always clears its "changed outside Compy" flag (counting every entry
    // trapped the user below a clean readiness state: the append-only ledger never lets you edit old
    // records). A change the shared rule counts as on or can't-confirm is never also drifted or
    // rolled back here: one change has one state (453-f1 review).
    let mut latest: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (i, c) in history.iter().enumerate() {
        latest.insert(c.rec_id.as_str(), i); // later entries overwrite earlier → newest wins
    }
    for &i in latest.values() {
        let c = &history[i];
        s.total += 1;
        if c.status != "rolled_back" && checks[i].is_none_or(ActiveCheck::legacy_active) {
            s.legacy_active += 1;
        }
        if live_recs.contains(c.rec_id.as_str()) {
            continue;
        }
        if c.status == "rolled_back" {
            s.rolled_back += 1;
        } else if checks[i] == Some(ActiveCheck::Off) {
            if kept_outside(c) {
                s.kept_outside += 1;
                s.kept_outside_titles.push(c.rec_title.clone());
                s.kept_outside_plan |= c.rec_id == "power-ultimate";
            } else {
                s.externally_reverted += 1;
                s.drifted_titles.push(c.rec_title.clone());
            }
        }
    }
    s.drifted_titles.sort(); // HashMap order is random — keep the named list stable
    s.kept_outside_titles.sort();
    s
}

// ─── CR-unconfirmed-remedy: "changed outside Compy" ─────────────────────
//
// A ledger-only transition: nothing below runs a command, writes the registry or dispatches an
// apply or rollback. The one live read (the active power scheme) is taken by the caller and handed
// in, so the rules are pure and the tests drive them with no machine at all.

/// The active power scheme as one read saw it ([`crate::current_power_scheme`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ObservedPlan {
    /// Lower-case GUID.
    pub(crate) guid: String,
    /// The name Windows printed, in whatever language it prints it.
    pub(crate) name: String,
    pub(crate) class: crate::PowerPlanClass,
}

/// The schemes Windows ships under fixed GUIDs that are not Ultimate: Balanced, High performance and
/// Power saver. A copy Compy's Ultimate apply makes always gets a new GUID, so it is never one of these.
const STOCK_NON_ULTIMATE_SCHEMES: [&str; 3] = [
    "381b4222-f694-41f0-9685-ff5bb260df2e",
    "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
    "a1841308-3541-4fab-bc81-f71556f20b4a",
];

/// The refusal for a row applied before Compy recorded which plan its Ultimate apply activated, when
/// the active plan is not a stock Windows scheme (CR-ultimate-identity, review r2).
pub(crate) const LEGACY_ULTIMATE_REFUSAL: &str = "Compy made this change before it kept a record of which plan it \
    switched to, so it can't tell whether the active plan is a copy of Ultimate Performance it made. Undo the \
    change instead, or switch to a standard Windows plan (Balanced, High performance or Power saver) first";

/// Review r3 (opus SHOULD-FIX 1): the active plan is a copy Compy's Ultimate apply made for ANY row of
/// the ledger (applied or undone: an undo leaves the copy in the plan list), so no row may record it
/// as set outside Compy. Copies no row stamped can't be known: rows from before Compy recorded them,
/// and rows whose list or post-apply read timed out (review r4); those rows' own records need a stock
/// scheme ([`changed_outside_refusal`]), but a stamped row could still record such a copy if the user
/// switched back to it in Windows (a residual, kept as a known gap).
pub(crate) const COMPYS_OTHER_COPY_REFUSAL: &str =
    "the active power plan is a copy of Ultimate Performance Compy made for one of its changes";

fn is_any_compy_copy(history: &[AppliedChange], seen: &ObservedPlan) -> bool {
    history.iter().filter_map(compys_plan_guid).any(|g| g.eq_ignore_ascii_case(&seen.guid))
}

/// Why `c` can't be recorded as changed outside Compy given the live read `observed`, or Ok. Only
/// a power-plan change qualifies: a plan is the one setting whose live state can be "something else
/// entirely" and be read as exactly which something. Refused: a row not applied, one already
/// recorded, one with no typed power-plan snapshot, an unreadable plan (unknown stays a refusal), a
/// plan that reads as Ultimate (Compy's change may well be in effect), and the plan Compy saved
/// before its change (that is an undo done outside Compy; Compy's own undo fits it).
pub(crate) fn changed_outside_refusal(c: &AppliedChange, observed: Option<&ObservedPlan>) -> Result<(), String> {
    if c.status != "applied" {
        return Err("this change isn't applied".into());
    }
    if recorded_and_holding(c, observed) {
        return Err("this change is already recorded as changed outside Compy".into());
    }
    let prior = match (&c.applied_action, serde_json::from_value::<Snapshot>(c.snapshot.clone())) {
        (Some(AppliedAction::SetUltimatePerformancePlan), Ok(Snapshot::PowerPlan { prior_guid })) => prior_guid,
        _ => return Err("Compy can only record a power plan change this way".into()),
    };
    let Some(seen) = observed else {
        return Err("Compy can't read which power plan is active right now".into());
    };
    if seen.guid.len() != 36 || is_compys_ultimate(c, seen) {
        return Err("the active power plan may still be the one Compy set".into());
    }
    if seen.guid.eq_ignore_ascii_case(prior.trim()) {
        return Err("the active power plan is the one you had before Compy's change, so undo it instead".into());
    }
    // CR-ultimate-identity (review r2): a row applied before Compy recorded the GUID its apply
    // activated can't tell its own localized copy of Ultimate (a new GUID, a name in the user's
    // language) from the user's plan. Only a stock Windows scheme, which no copy can be, is known
    // not to be it; anything else stays a refusal (the undo remains the user's other choice). A
    // record made earlier is kept as it is; this only refuses a new one.
    if compys_plan_guid(c).is_none() && !STOCK_NON_ULTIMATE_SCHEMES.iter().any(|g| seen.guid.eq_ignore_ascii_case(g)) {
        return Err(LEGACY_ULTIMATE_REFUSAL.into());
    }
    Ok(())
}

/// Records every applied, unrecorded row of `rec_id` as changed outside Compy, all or none, then
/// saves. Every one of those rows must qualify ([`changed_outside_refusal`]); otherwise nothing is
/// written. On a failed save the rows are put back as they were in memory. Returns how many rows
/// were recorded. `save` is the only effect.
pub(crate) fn commit_changed_outside(
    history: &mut [AppliedChange],
    rec_id: &str,
    observed: Option<&ObservedPlan>,
    now: &str,
    save: &dyn Fn(&[AppliedChange]) -> Result<(), String>,
) -> Result<usize, String> {
    let rows: Vec<usize> = (0..history.len())
        .filter(|&i| history[i].rec_id == rec_id && history[i].status == "applied" && !recorded_and_holding(&history[i], observed))
        .collect();
    if rows.is_empty() {
        return Err("Compy has no applied change of this setting left to record".into());
    }
    for &i in &rows {
        changed_outside_refusal(&history[i], observed)?;
    }
    let Some(seen) = observed else {
        return Err("Compy can't read which power plan is active right now".into());
    };
    if is_any_compy_copy(history, seen) {
        return Err(COMPYS_OTHER_COPY_REFUSAL.into());
    }
    // A row recorded earlier for a plan no longer active (or in a shape this build can't act on) is
    // recorded anew: the newer record replaces it, and its time counts as a move like the first did.
    // The replaced record's own time, and any it had kept, stay on the row as earlier moves
    // (CR-outside-followups (d)): a session pair straddling only the earlier record is not "nothing
    // moved".
    let mark = |was: Option<&ChangedOutside>| ChangedOutside {
        schema: CHANGED_OUTSIDE_SCHEMA,
        recorded_at: now.to_string(),
        observed: ObservedState::PowerPlan { guid: seen.guid.clone(), name: seen.name.clone() },
        earlier_recorded_at: was
            .map(|w| w.earlier_recorded_at.iter().cloned().chain([w.recorded_at.clone()]).collect())
            .unwrap_or_default(),
    };
    let before: Vec<Option<ChangedOutside>> = rows.iter().map(|&i| history[i].changed_outside.clone()).collect();
    for (&i, was) in rows.iter().zip(&before) {
        history[i].changed_outside = Some(mark(was.as_ref()));
    }
    save(history).inspect_err(|_| {
        for (&i, was) in rows.iter().zip(&before) {
            history[i].changed_outside = was.clone();
        }
    })?;
    Ok(rows.len())
}

/// Whether `c` already carries a record this build can act on whose state the live read `observed`
/// still shows. Such a row has nothing left to record; any other applied row may be recorded.
fn recorded_and_holding(c: &AppliedChange, observed: Option<&ObservedPlan>) -> bool {
    c.changed_outside.as_ref().and_then(ChangedOutside::usable).is_some_and(|s| outside_state_holds(s, observed))
}

/// The state a Trial must find in place of `rec_id`, when every applied row of it carries a usable
/// "changed outside Compy" record of that one state; None otherwise (no applied row, a row not
/// recorded, or records that disagree), and the rec is then checked as before.
pub(crate) fn recorded_outside_state<'a>(changes: &'a [AppliedChange], rec_id: &str) -> Option<&'a ObservedState> {
    let mut applied = changes.iter().filter(|c| c.rec_id == rec_id && c.status == "applied").peekable();
    applied.peek()?;
    let mut found: Option<&ObservedState> = None;
    for c in applied {
        let state = c.changed_outside.as_ref()?.usable()?;
        match found {
            // Review r2: one state is one plan GUID, the rule `outside_state_holds` reads; a name
            // Windows printed differently at two records is the same plan.
            Some(f) if !same_state(f, state) => return None,
            _ => found = Some(state),
        }
    }
    found
}

fn same_state(a: &ObservedState, b: &ObservedState) -> bool {
    match (a, b) {
        (ObservedState::PowerPlan { guid: x, .. }, ObservedState::PowerPlan { guid: y, .. }) => x.eq_ignore_ascii_case(y),
        _ => false,
    }
}

/// Does the live read `now` still show the recorded state? An unreadable read never does.
pub(crate) fn outside_state_holds(recorded: &ObservedState, now: Option<&ObservedPlan>) -> bool {
    match (recorded, now) {
        (ObservedState::PowerPlan { guid, .. }, Some(now)) => guid.eq_ignore_ascii_case(&now.guid),
        _ => false,
    }
}

/// One setting the user can record as changed outside Compy, for the Trial refusal's second choice.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct ChangedOutsideOffer {
    pub(crate) rec_id: String,
    pub(crate) rec_title: String,
    /// The name of the plan Windows has active now.
    pub(crate) observed_name: String,
    /// How many applied rows of this setting the record covers.
    pub(crate) rows: usize,
}

/// Pure: the settings whose every applied, unrecorded row qualifies under one live read.
pub(crate) fn changed_outside_offers_from(history: &[AppliedChange], observed: Option<&ObservedPlan>) -> Vec<ChangedOutsideOffer> {
    let Some(seen) = observed else { return Vec::new() };
    if is_any_compy_copy(history, seen) {
        return Vec::new();
    }
    let open = |c: &&AppliedChange| c.status == "applied" && !recorded_and_holding(c, Some(seen));
    let mut recs: Vec<&str> = Vec::new();
    for c in history.iter().filter(open) {
        if !recs.contains(&c.rec_id.as_str()) {
            recs.push(&c.rec_id);
        }
    }
    recs.into_iter()
        .filter_map(|rec| {
            let rows: Vec<&AppliedChange> = history.iter().filter(open).filter(|c| c.rec_id == rec).collect();
            rows.iter().all(|c| changed_outside_refusal(c, Some(seen)).is_ok()).then(|| ChangedOutsideOffer {
                rec_id: rec.to_string(),
                rec_title: rows[rows.len() - 1].rec_title.clone(),
                observed_name: seen.name.clone(),
                rows: rows.len(),
            })
        })
        .collect()
}

/// Read-only: what the user could record as changed outside Compy right now. One plan read.
#[tauri::command]
pub(crate) async fn changed_outside_offers() -> Result<Vec<ChangedOutsideOffer>, String> {
    // The plan read (a powercfg spawn) runs on the blocking pool, never the UI thread.
    tauri::async_runtime::spawn_blocking(read_changed_outside_offers)
        .await
        .map_err(|e| format!("Compy couldn't read the active power plan ({e})"))?
}

/// The work [`changed_outside_offers`] runs on the blocking pool.
fn read_changed_outside_offers() -> Result<Vec<ChangedOutsideOffer>, String> {
    if gaming_mode_may_hold_plan().is_some() {
        return Ok(Vec::new());
    }
    let history = load_history()?;
    Ok(changed_outside_offers_from(&history, crate::current_power_scheme().as_ref()))
}

/// Review r1: Gaming Mode switches the power plan itself and records that only in its own session
/// contract, never in the ledger. While any session contract is on disk (or the folder can't be
/// read), the active plan may be one Compy set, so nothing is offered or recorded as outside Compy.
fn gaming_mode_may_hold_plan() -> Option<String> {
    match crate::gaming_session::has_pending_contract() {
        Ok(false) => None,
        Ok(true) => Some(
            "Gaming Mode has temporary changes in place, so the active power plan may be one Compy set; \
             try again after Gaming Mode has ended"
                .into(),
        ),
        Err(e) => Some(e),
    }
}

/// CR-unconfirmed-remedy: record `rec_id`'s applied rows as changed outside Compy. A ledger write
/// only, under the ledger lock and the verified data root like every other write; nothing on
/// Windows changes. Reads the active plan once, BEFORE taking the ledger lock (review r1: a powercfg
/// that hangs must not hold every apply and undo), and records what it read; every Trial then checks
/// that recorded plan against a fresh read, so a plan switched in between is caught there.
#[tauri::command]
pub(crate) fn record_changed_outside(rec_id: String) -> Result<usize, String> {
    if let Some(why) = gaming_mode_may_hold_plan() {
        return Err(why);
    }
    let observed = crate::current_power_scheme();
    // Review r2: Gaming Mode may have started between the check above and the read; ask again.
    if let Some(why) = gaming_mode_may_hold_plan() {
        return Err(why);
    }
    let _lock = lock_history()?;
    let root = crate::data_root::mutation_root()?;
    let mut history = load_history_for(&root)?;
    let now = Utc::now().to_rfc3339();
    commit_changed_outside(&mut history, &rec_id, observed.as_ref(), &now, &|h| save_history(&root, h))
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
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        let _force = ForceElevationError::begin();
        let before = load_history().expect("test ledger readable");
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
        let after = load_history().expect("test ledger readable");
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
        let c = build_applied_change("fast-startup-off", "Disable Fast Startup", result, None)
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
        let c = build_applied_change("fast-startup-off", real, result(), None).expect("build");
        assert_eq!(c.rec_title, real, "a real catalog title passes through unchanged");
        let huge = "x".repeat(1_000_000);
        let c = build_applied_change("fast-startup-off", &huge, result(), None).expect("build");
        assert_eq!(c.rec_title.chars().count(), MAX_REC_TITLE_LEN, "a hostile title is capped");
    }
}

// #616 guards: a change whose receipt can't be saved is undone at once through the typed rollback
// its own apply produced, and the error says what happened to it. Every effect is a fake, so nothing
// here touches Windows or the real ledger.
#[cfg(test)]
mod receipt_commit_tests {
    use super::*;
    use std::cell::RefCell;

    fn fast_startup() -> ApplyResult {
        ApplyResult {
            applied_action: AppliedAction::DisableFastStartup,
            rollback_action: RollbackAction::RestoreFastStartupFromSnapshot,
            snapshot: Snapshot::FastStartup { prior_hiberboot: Some(1) },
            elevation_used: true,
        }
    }

    fn game_mode() -> ApplyResult {
        ApplyResult {
            applied_action: AppliedAction::EnableGameMode,
            rollback_action: RollbackAction::RestoreGameModeFromSnapshot,
            snapshot: Snapshot::GameMode { prior_enabled: Some(0), prior_allow: Some(1) },
            elevation_used: false,
        }
    }

    fn contract(action: &RollbackAction, snapshot: &Snapshot) -> (serde_json::Value, serde_json::Value) {
        (
            serde_json::to_value(action).expect("rollback action serializes"),
            serde_json::to_value(snapshot).expect("snapshot serializes"),
        )
    }

    /// Everything the effects saw, in order.
    #[derive(Default)]
    struct Seen {
        saves: RefCell<Vec<usize>>,
        rollbacks: RefCell<Vec<(serde_json::Value, serde_json::Value)>>,
        probes: RefCell<Vec<String>>,
    }

    fn commit(
        history: &mut Vec<AppliedChange>,
        made: Vec<Made>,
        saved: Result<(), String>,
        undo: impl Fn(&RollbackAction) -> Result<(), String>,
        read: ActiveCheck,
        seen: &Seen,
    ) -> Result<Vec<AppliedChange>, String> {
        let save = |h: &[AppliedChange]| {
            seen.saves.borrow_mut().push(h.len());
            saved.clone()
        };
        let rollback = |a: &RollbackAction, s: &Snapshot| {
            seen.rollbacks.borrow_mut().push(contract(a, s));
            undo(a)
        };
        let probe = |rec_id: &str, _: Option<&AppliedAction>| {
            seen.probes.borrow_mut().push(rec_id.to_string());
            read
        };
        commit_receipts(history, made, &save, &UndoEffects { rollback: &rollback, probe: &probe })
    }

    fn earlier() -> AppliedChange {
        build_applied_change("game-mode-on", "An earlier change", game_mode(), None).expect("build")
    }

    #[test]
    fn a_failed_save_undoes_the_change_with_its_own_typed_rollback() {
        let mut history = vec![earlier()];
        let earlier_id = history[0].id.clone();
        let seen = Seen::default();
        let err = commit(
            &mut history,
            vec![Made::new("fast-startup-off", "Disable Fast Startup", fast_startup())],
            Err("disk full".into()),
            |_| Ok(()),
            ActiveCheck::Off,
            &seen,
        )
        .err().expect("a change with no saved receipt must never read as applied");

        assert_eq!(*seen.saves.borrow(), vec![2], "the save was attempted with the new receipt in it");
        let expected = fast_startup();
        assert_eq!(
            *seen.rollbacks.borrow(),
            vec![contract(&expected.rollback_action, &expected.snapshot)],
            "the undo ran exactly once, with the dispatch's own typed rollback and snapshot"
        );
        assert_eq!(*seen.probes.borrow(), vec!["fast-startup-off"], "the live read targets this change");
        assert_eq!(history.len(), 1, "the unsaved receipt is taken back out of the ledger");
        assert_eq!(history[0].id, earlier_id, "earlier receipts are untouched");
        for phrase in ["disk full", "couldn't save its undo record", "Undone: a live read confirms"] {
            assert!(err.contains(phrase), "error must say {phrase:?}: {err}");
        }
    }

    #[test]
    fn a_failed_undo_is_loud_and_says_the_change_is_still_in_effect() {
        for read in [ActiveCheck::On, ActiveCheck::Unreadable, ActiveCheck::Unrecognised] {
            let mut history = Vec::new();
            let seen = Seen::default();
            let err = commit(
                &mut history,
                vec![Made::new("fast-startup-off", "Disable Fast Startup", fast_startup())],
                Err("disk full".into()),
                |_| Err("the admin prompt was declined".into()),
                read,
                &seen,
            )
            .err().expect("failed save");
            assert_eq!(seen.rollbacks.borrow().len(), 1, "the undo was attempted");
            assert!(history.is_empty());
            for phrase in [
                "disk full",
                "Undo failed (the admin prompt was declined)",
                "still in effect",
                "isn't listed in Test → Applied & history",
                "set it back in Windows",
            ] {
                assert!(err.contains(phrase), "{read:?}: error must say {phrase:?}: {err}");
            }
            assert!(!err.contains("Undone"), "{read:?}: a failed undo must never read as undone: {err}");
        }
    }

    #[test]
    fn every_undo_and_live_read_combination_has_its_own_honest_outcome() {
        let reads = [ActiveCheck::On, ActiveCheck::Off, ActiveCheck::Unreadable, ActiveCheck::Unrecognised];
        let mut all = std::collections::HashSet::new();
        for undone in [Ok(()), Err("boom".to_string())] {
            for read in reads {
                let text = undo_outcome(&undone, read);
                assert!(all.insert(text.clone()), "{undone:?}/{read:?} must not share another case's text");
                let confirmed = undone.is_ok() && read == ActiveCheck::Off;
                assert_eq!(
                    text.contains("no longer in effect"),
                    confirmed,
                    "{undone:?}/{read:?}: only an undo a live read confirms may say the change is gone: {text}"
                );
                if undone.is_err() {
                    assert!(text.contains("(boom)"), "{read:?}: the undo error is named: {text}");
                    assert!(text.contains("isn't listed"), "{read:?}: says it can't be undone later: {text}");
                }
                if undone.is_err() && read != ActiveCheck::Off {
                    assert!(text.starts_with("Undo failed"), "{read:?}: a failed undo leads loud: {text}");
                    assert!(text.contains("set it back in Windows"), "{read:?}: {text}");
                }
                if read == ActiveCheck::On {
                    assert!(text.contains("isn't listed"), "{undone:?}: a change still live is unlisted: {text}");
                }
            }
        }
    }

    #[test]
    fn a_saved_receipt_runs_no_undo_and_keeps_its_provenance() {
        let mut history = vec![earlier()];
        let seen = Seen::default();
        let made = Made {
            provenance: Some("leftover_adopted"),
            ..Made::new("fast-startup-off", "Disable Fast Startup", fast_startup())
        };
        let saved = commit(&mut history, vec![made], Ok(()), |_| Ok(()), ActiveCheck::Off, &seen)
            .expect("a saved receipt is success");

        assert!(seen.rollbacks.borrow().is_empty(), "nothing is undone when the receipt saves");
        assert!(seen.probes.borrow().is_empty(), "the happy path does no extra live read");
        assert_eq!(*seen.saves.borrow(), vec![2], "one save, with the new receipt in it");
        assert_eq!(saved.len(), 1);
        assert_eq!(history.len(), 2);
        let c = &history[1];
        assert_eq!(c.id, saved[0].id, "the returned receipt is the one in the ledger");
        assert_eq!(c.rec_id, "fast-startup-off");
        assert_eq!(c.status, "applied");
        assert_eq!(c.provenance.as_deref(), Some("leftover_adopted"));
        let expected = fast_startup();
        assert_eq!(
            serde_json::to_value(&c.rollback_action).expect("serializes"),
            serde_json::to_value(Some(&expected.rollback_action)).expect("serializes"),
            "the receipt carries the typed rollback"
        );
    }

    #[test]
    fn a_failed_batch_save_undoes_every_change_newest_first_even_past_a_failed_undo() {
        let mut history = vec![earlier()];
        let earlier_id = history[0].id.clone();
        let seen = Seen::default();
        let err = commit(
            &mut history,
            vec![
                Made::new("fast-startup-off", "Disable Fast Startup", fast_startup()),
                Made::new("game-mode-on", "Turn on Game Mode", game_mode()),
            ],
            Err("access denied".into()),
            // The newest change's undo fails; the older one must still be undone after it.
            |a| match a {
                RollbackAction::RestoreGameModeFromSnapshot => Err("key locked".into()),
                _ => Ok(()),
            },
            ActiveCheck::Unreadable,
            &seen,
        )
        .err().expect("failed save");

        let (fs, gm) = (fast_startup(), game_mode());
        assert_eq!(
            *seen.rollbacks.borrow(),
            vec![
                contract(&gm.rollback_action, &gm.snapshot),
                contract(&fs.rollback_action, &fs.snapshot),
            ],
            "both are undone, newest first, each with its own contract"
        );
        assert_eq!(*seen.probes.borrow(), vec!["game-mode-on", "fast-startup-off"]);
        assert_eq!(history.len(), 1, "neither unsaved receipt stays in the ledger");
        assert_eq!(history[0].id, earlier_id);
        assert!(err.contains("made 2 changes") && err.contains("access denied"), "{err}");
        let fs_at = err.find("Disable Fast Startup: The undo ran").expect("names the first change's outcome");
        let gm_at = err.find("Turn on Game Mode: Undo failed (key locked)").expect("names the failed undo");
        assert!(fs_at < gm_at, "outcomes read in the order the changes were made: {err}");
    }

    // Reviewer W1: an admin step that starts and then stops with an error has already run the items
    // before the failure. Those wrote an ok receipt and must be recorded, never reported as unchanged.
    #[test]
    fn an_admin_step_that_stops_part_way_still_records_what_it_finished() {
        let mut receipts = std::collections::HashMap::new();
        receipts.insert("done".to_string(), true);
        receipts.insert("broke".to_string(), false);
        let declined: Result<(), String> = Err(ELEVATION_DECLINED_MSG.to_string());
        let stopped: Result<(), String> = Err(elevation_outcome(Ok(exit_status(1))).expect_err("exit 1"));
        assert!(!elevation_error_nothing_ran(stopped.as_ref().expect_err("stopped")), "the script ran");

        for id in ["done", "broke", "missing"] {
            let skip = elevated_item_outcome(&declined, &receipts, id).expect_err("a declined UAC ran nothing");
            assert!(skip.contains("nothing was changed"), "{id}: {skip}");
        }
        assert!(elevated_item_outcome(&stopped, &receipts, "done").is_ok(), "a finished item is recorded");
        for id in ["broke", "missing"] {
            let skip = elevated_item_outcome(&stopped, &receipts, id).expect_err("no ok receipt");
            assert!(skip.contains("can't be sure it changed nothing"), "{id}: {skip}");
            assert!(skip.contains("check this setting in Windows"), "{id}: {skip}");
        }
        let ran: Result<(), String> = Ok(());
        assert!(elevated_item_outcome(&ran, &receipts, "done").is_ok());
        assert_eq!(
            elevated_item_outcome(&ran, &receipts, "missing"),
            resolve_receipt(&receipts, "missing"),
            "a clean run keeps the existing receipt rules"
        );
    }

    /// [`commit_rollback`] on row `idx` with faked effects.
    fn roll_back(
        history: &mut [AppliedChange],
        idx: usize,
        saved: Result<(), String>,
        undo: Result<(), String>,
        read: ActiveCheck,
        seen: &Seen,
    ) -> Result<(), RollbackError> {
        roll_back_citing(history, idx, None, saved, undo, read, seen)
    }

    /// [`roll_back`] with the Trial an outcome-switch undo cites.
    fn roll_back_citing(
        history: &mut [AppliedChange],
        idx: usize,
        link: Option<TrialLink>,
        saved: Result<(), String>,
        undo: Result<(), String>,
        read: ActiveCheck,
        seen: &Seen,
    ) -> Result<(), RollbackError> {
        let save = |h: &[AppliedChange]| {
            seen.saves.borrow_mut().push(h.len());
            saved.clone()
        };
        let rollback = |a: &RollbackAction, s: &Snapshot| {
            seen.rollbacks.borrow_mut().push(contract(a, s));
            undo.clone().map(|()| UndoDone::Restored)
        };
        let probe = |rec_id: &str, _: Option<&AppliedAction>| {
            seen.probes.borrow_mut().push(rec_id.to_string());
            read
        };
        commit_rollback(history, idx, link, &save, &RollbackEffects { rollback: &rollback, probe: &probe })
    }

    // ── CR-core-parking-plan-gone: an undo whose power plan no longer exists ──

    const PLAN_A: &str = "6c1e3f42-0d2b-4a77-9e1f-3b7a7f6e1c10";

    fn applied_core_parking(plan: Option<&str>) -> AppliedChange {
        let result = ApplyResult {
            applied_action: AppliedAction::RestoreCoreParkingDefault,
            rollback_action: RollbackAction::RestoreCoreParkingFromSnapshot,
            snapshot: Snapshot::CoreParking { prior_ac_pct: Some(40), prior_dc_pct: Some(30), plan_guid: plan.map(str::to_string) },
            elevation_used: true,
        };
        build_applied_change("core-parking-forced", "Re-allow core parking", result, None).expect("build")
    }

    /// The user's undo of `row` through the production dispatch (`dispatch_rollback_outcome_with`),
    /// with the powercfg reads faked; `ran` collects every script that would have run elevated.
    fn undo_core_parking(
        history: &mut [AppliedChange],
        listed: Option<bool>,
        ran: &std::cell::RefCell<Vec<String>>,
        saves: &std::cell::Cell<usize>,
    ) -> Result<(), RollbackError> {
        // The direct query agrees with the list unless a test says otherwise.
        undo_core_parking_queried(history, listed, listed, ran, saves, Ok(()))
    }

    /// [`undo_core_parking`] with the direct plan query (CR-core-parking-hidden-plan) and the
    /// ledger save's result faked too.
    fn undo_core_parking_queried(
        history: &mut [AppliedChange],
        listed: Option<bool>,
        queried: Option<bool>,
        ran: &std::cell::RefCell<Vec<String>>,
        saves: &std::cell::Cell<usize>,
        saved: Result<(), String>,
    ) -> Result<(), RollbackError> {
        // Another plan is active unless a test says otherwise (CR-active-plan-unread: `None` is an
        // unread active plan, never "not active").
        undo_core_parking_read(history, listed, queried, Some(OTHER_PLAN), ran, saves, saved)
    }

    const OTHER_PLAN: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";

    /// [`undo_core_parking_queried`] with the active-plan read faked too (`None` = unread).
    fn undo_core_parking_read(
        history: &mut [AppliedChange],
        listed: Option<bool>,
        queried: Option<bool>,
        active: Option<&str>,
        ran: &std::cell::RefCell<Vec<String>>,
        saves: &std::cell::Cell<usize>,
        saved: Result<(), String>,
    ) -> Result<(), RollbackError> {
        let save = |_: &[AppliedChange]| {
            saves.set(saves.get() + 1);
            saved.clone()
        };
        let plan_listed = |_: &str| listed;
        let plan_queried = |_: &str| queried;
        let active_plan = || active.map(str::to_string);
        let run_elevated = |script: &str| {
            ran.borrow_mut().push(script.to_string());
            Ok(())
        };
        let fx = CoreParkingEffects {
            plan_listed: &plan_listed,
            plan_queried: &plan_queried,
            active_plan: &active_plan,
            run_elevated: &run_elevated,
        };
        let rollback = |a: &RollbackAction, s: &Snapshot| {
            dispatch_rollback_outcome_with(&crate::data_root::test_mutation_root(), a, s, &fx)
        };
        let probe = |_: &str, _: Option<&AppliedAction>| ActiveCheck::Unrecognised;
        commit_rollback(history, 0, None, &save, &RollbackEffects { rollback: &rollback, probe: &probe })
    }

    #[test]
    fn a_core_parking_undo_whose_plan_is_gone_closes_the_row_with_a_receipt_and_runs_nothing() {
        let mut history = vec![applied_core_parking(Some(&PLAN_A.to_uppercase()))];
        let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
        undo_core_parking(&mut history, Some(false), &ran, &saves).expect("a gone plan closes, never fails for good");
        assert!(ran.borrow().is_empty(), "nothing may run elevated against a plan that isn't there");
        assert_eq!(saves.get(), 1, "the closed row is saved");
        assert_eq!(history[0].status, "rolled_back");
        assert!(history[0].rolled_back_at.is_some());
        assert_eq!(history[0].nothing_restored, Some(NothingRestored::plan_gone(PLAN_A.to_string())));
        // The receipt survives a save and load, and reaches the view the History row reads.
        let json = serde_json::to_string(&history).expect("save");
        let back: Vec<AppliedChange> = serde_json::from_str(&json).expect("load");
        let view = serde_json::to_value(into_view(back[0].clone())).expect("view");
        assert_eq!(view["nothing_restored"]["reason"], "plan-gone");
        assert_eq!(view["nothing_restored"]["plan_guid"], PLAN_A);
    }

    #[test]
    fn a_core_parking_undo_whose_plan_exists_restores_onto_that_plan_and_records_no_note() {
        let mut history = vec![applied_core_parking(Some(PLAN_A))];
        let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
        undo_core_parking(&mut history, Some(true), &ran, &saves).expect("undo");
        assert_eq!(ran.borrow().len(), 1);
        assert!(ran.borrow()[0].contains(PLAN_A) && ran.borrow()[0].contains(" 40"), "{:?}", ran.borrow());
        assert_eq!(history[0].status, "rolled_back");
        assert_eq!(history[0].nothing_restored, None);
        let json = serde_json::to_string(&history).expect("save");
        assert!(!json.contains("nothing_restored"), "a normal undo writes no new key: {json}");
    }

    #[test]
    fn a_core_parking_undo_that_cant_read_the_plan_list_changes_nothing_and_says_so() {
        let mut history = vec![applied_core_parking(Some(PLAN_A))];
        let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
        let err = undo_core_parking(&mut history, None, &ran, &saves).expect_err("an unread list is not a gone plan");
        let RollbackError::Failed(msg) = err else { panic!("a failed undo") };
        assert!(msg.contains("couldn't read") && msg.contains("Nothing was changed"), "{msg}");
        assert!(ran.borrow().is_empty());
        assert_eq!(saves.get(), 0);
        assert_eq!(history[0].status, "applied", "the row stays open");
        assert_eq!(history[0].nothing_restored, None);
    }

    #[test]
    fn a_core_parking_row_from_before_the_plan_was_recorded_undoes_as_before() {
        let mut history = vec![applied_core_parking(None)];
        let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
        // Never asks for the plan list: a legacy row restores onto the current plan, as it always did.
        undo_core_parking(&mut history, None, &ran, &saves).expect("legacy undo");
        assert_eq!(ran.borrow().len(), 1);
        assert_eq!(history[0].nothing_restored, None);
    }

    #[test]
    fn an_active_plan_the_list_leaves_out_is_not_gone() {
        // Sonnet r1 nit: `powercfg /list` can omit a hidden scheme; the active one is there.
        let step = core_parking_undo_step(
            Some(40),
            Some(30),
            Some(PLAN_A),
            &|_| Some(false),
            &|_| panic!("an active plan is never queried"),
            &|| Some(PLAN_A.to_uppercase()),
        );
        let Ok(CoreParkingUndo::Run(script)) = step else { panic!("{step:?}") };
        assert!(script.contains(PLAN_A) && script.contains("-setactive"), "restored and re-committed live: {script}");
    }

    #[test]
    fn a_hidden_plan_the_list_omits_but_windows_still_has_is_restored_onto_and_not_closed_as_gone() {
        // CR-core-parking-hidden-plan: not listed, not active, but a direct query finds it.
        let mut history = vec![applied_core_parking(Some(PLAN_A))];
        let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
        undo_core_parking_queried(&mut history, Some(false), Some(true), &ran, &saves, Ok(())).expect("undo");
        assert_eq!(ran.borrow().len(), 1, "the value goes back onto the hidden plan");
        assert!(ran.borrow()[0].contains(PLAN_A) && ran.borrow()[0].contains(" 40"), "{:?}", ran.borrow());
        assert!(!ran.borrow()[0].contains("-setactive"), "a plan that isn't active is never switched to");
        assert_eq!(history[0].status, "rolled_back");
        assert_eq!(history[0].nothing_restored, None, "a restored row carries no nothing-restored receipt");
    }

    #[test]
    fn a_plan_the_list_omits_and_the_query_refuses_closes_as_gone_with_its_receipt() {
        let mut history = vec![applied_core_parking(Some(PLAN_A))];
        let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
        undo_core_parking_queried(&mut history, Some(false), Some(false), &ran, &saves, Ok(())).expect("closes");
        assert!(ran.borrow().is_empty());
        assert_eq!(history[0].status, "rolled_back");
        assert_eq!(history[0].nothing_restored, Some(NothingRestored::plan_gone(PLAN_A.to_string())));
    }

    #[test]
    fn a_plan_query_that_cant_be_read_changes_nothing_and_leaves_the_row_open() {
        let mut history = vec![applied_core_parking(Some(PLAN_A))];
        let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
        let err = undo_core_parking_queried(&mut history, Some(false), None, &ran, &saves, Ok(()))
            .expect_err("an unread query is not a gone plan");
        let RollbackError::Failed(msg) = err else { panic!("a failed undo") };
        assert!(msg.contains("couldn't confirm") && msg.contains("Nothing was changed"), "{msg}");
        assert!(ran.borrow().is_empty());
        assert_eq!(saves.get(), 0);
        assert_eq!(history[0].status, "applied");
        assert_eq!(history[0].nothing_restored, None);
    }

    #[test]
    fn an_unread_active_plan_is_not_another_plan_and_the_undo_stops_with_nothing_changed() {
        // CR-active-plan-unread: list omits the plan, the active plan is unread, the direct query
        // would find it. Before, the unread read counted as "not active" and the undo ran.
        let step = core_parking_undo_step(Some(40), Some(30), Some(PLAN_A), &|_| Some(false), &|_| Some(true), &|| None);
        let Err(msg) = step else { panic!("an unread active plan must not run anything: {step:?}") };
        assert!(msg.contains("couldn't read which power plan") && msg.contains("Nothing was changed"), "{msg}");
    }

    #[test]
    fn a_listed_plan_with_an_unread_active_plan_runs_nothing_and_leaves_the_row_open() {
        // CR-active-plan-unread: whether the plan is the live one decides the re-commit (`-setactive`),
        // so an unread active plan stops the whole undo, through the production dispatch.
        for (listed, queried) in [(Some(true), Some(true)), (Some(false), Some(true)), (Some(false), Some(false))] {
            let mut history = vec![applied_core_parking(Some(PLAN_A))];
            let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
            let err = undo_core_parking_read(&mut history, listed, queried, None, &ran, &saves, Ok(()))
                .expect_err("an unread active plan is not a known plan state");
            let RollbackError::Failed(msg) = err else { panic!("a failed undo") };
            assert!(msg.contains("couldn't read which power plan"), "{listed:?} {queried:?}: {msg}");
            assert!(ran.borrow().is_empty(), "{listed:?} {queried:?}: nothing runs elevated");
            assert_eq!(saves.get(), 0);
            assert_eq!(history[0].status, "applied", "the row stays open");
            assert_eq!(history[0].nothing_restored, None, "never closed as gone on an unread read");
        }
    }

    #[test]
    fn a_gone_plan_whose_close_cant_be_saved_never_says_the_undo_ran() {
        let mut history = vec![applied_core_parking(Some(PLAN_A))];
        let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
        let err = undo_core_parking_queried(&mut history, Some(false), Some(false), &ran, &saves, Err("disk full".into()))
            .expect_err("the save failed");
        let RollbackError::Failed(msg) = err else { panic!("nothing ran, so this is not an unrecorded undo: {err:?}") };
        assert!(!is_unrecorded_rollback(&msg) && !msg.contains("The undo ran"), "{msg}");
        assert!(msg.contains("ran nothing on Windows") && msg.contains("disk full"), "{msg}");
        assert!(ran.borrow().is_empty());
        assert_eq!(history[0].status, "applied", "the row is put back as it was");
        assert_eq!(history[0].nothing_restored, None);
        assert!(history[0].rolled_back_at.is_none());
    }

    #[test]
    fn a_restored_undo_whose_save_fails_still_says_the_undo_ran() {
        let mut history = vec![applied_core_parking(Some(PLAN_A))];
        let (ran, saves) = (std::cell::RefCell::new(Vec::new()), std::cell::Cell::new(0));
        let err = undo_core_parking_queried(&mut history, Some(true), Some(true), &ran, &saves, Err("disk full".into()))
            .expect_err("the save failed");
        let RollbackError::Unrecorded(msg) = err else { panic!("{err:?}") };
        assert!(is_unrecorded_rollback(&msg), "{msg}");
        assert_eq!(ran.borrow().len(), 1);
    }

    #[test]
    fn the_plan_query_read_calls_a_plan_gone_only_when_it_fails_exactly_as_the_nil_plan_does() {
        // The words this PC's powercfg prints for a scheme that doesn't exist (measured s35).
        const GONE: &str = "The power scheme, subgroup or setting specified does not exist.";
        let read = |code: Option<i32>, text: &str| PowercfgRead { code, text: text.to_string() };
        let nil = read(Some(1), GONE);
        assert_eq!(plan_query_read(&read(Some(0), "Power Scheme GUID: ..."), &nil, true), Some(true));
        assert_eq!(plan_query_read(&read(Some(1), GONE), &nil, true), Some(false), "refused exactly as the nil plan");
        // s35 opus r1 MUST-FIX: exit 1 is powercfg's catch-all; anything but the same refusal is unread.
        assert_eq!(plan_query_read(&read(Some(1), "Access is denied."), &nil, true), None, "other words");
        assert_eq!(plan_query_read(&read(Some(1), ""), &read(Some(1), ""), true), None, "no words");
        assert_eq!(plan_query_read(&read(Some(1), GONE), &read(Some(0), ""), true), None, "the nil control didn't refuse");
        assert_eq!(plan_query_read(&read(Some(1), GONE), &nil, false), None, "the power service didn't answer");
        assert_eq!(plan_query_read(&read(None, ""), &nil, true), None, "killed: no exit code");
        assert_eq!(plan_query_read(&read(Some(-1), GONE), &nil, true), None);
    }

    #[test]
    fn the_plan_list_read_tells_a_missing_plan_from_an_unreadable_list() {
        let list = "Existing Power Schemes (* Active)\n-----------------------------------\n\
                    Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n\
                    Power Scheme GUID: 6C1E3F42-0D2B-4A77-9E1F-3B7A7F6E1C10  (Synez)\n";
        let read = |print: &str, guid: &str| plan_listed_in(crate::plan_guids_of(print), guid);
        assert_eq!(read(list, PLAN_A), Some(true), "GUIDs compare case-insensitively");
        assert_eq!(read(list, "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"), Some(false));
        assert_eq!(read("", PLAN_A), None, "an empty print is unreadable, never 'gone'");
        assert_eq!(read("Access is denied.\n", PLAN_A), None);
        // A substring of a listed GUID is not that plan (power_plan_exists matched substrings).
        assert_eq!(read(list, "6c1e3f42-0d2b-4a77-9e1f-3b7a7f6e1c1"), Some(false));
    }

    #[test]
    fn an_unknown_nothing_restored_shape_loads_as_none_not_a_failed_ledger() {
        let raw = r#"[{"id":"cp-1","rec_id":"core-parking-forced","rec_title":"x","applied_at":"2026-11-13T09:00:00Z",
            "snapshot":{},"status":"rolled_back","nothing_restored":42}]"#;
        let rows: Vec<AppliedChange> = serde_json::from_str(raw).expect("loads");
        assert_eq!(rows[0].nothing_restored, None);
    }

    fn applied_fast_startup() -> AppliedChange {
        build_applied_change("fast-startup-off", "Disable Fast Startup", fast_startup(), None).expect("build")
    }

    #[test]
    fn undoing_an_older_apply_of_a_change_restores_that_rows_own_snapshot() {
        // P6-restore undoes every in-window apply of one change, newest first. The second apply
        // snapshotted the already-changed setting (0), so only the older row's undo gets back to
        // how it was before (1). Both rows must be accepted, each restoring from its own snapshot.
        let mut older = applied_fast_startup();
        older.id = "fast-startup-off-1".into();
        let mut newer = build_applied_change(
            "fast-startup-off",
            "Disable Fast Startup",
            ApplyResult { snapshot: Snapshot::FastStartup { prior_hiberboot: Some(0) }, ..fast_startup() },
            None,
        )
        .expect("build");
        newer.id = "fast-startup-off-2".into();
        let mut history = vec![older, newer];
        let seen = Seen::default();
        roll_back(&mut history, 1, Ok(()), Ok(()), ActiveCheck::Off, &seen).expect("the newest apply undoes");
        roll_back(&mut history, 0, Ok(()), Ok(()), ActiveCheck::Off, &seen).expect("the older apply is accepted too");
        let undo = RollbackAction::RestoreFastStartupFromSnapshot;
        assert_eq!(
            *seen.rollbacks.borrow(),
            vec![
                contract(&undo, &Snapshot::FastStartup { prior_hiberboot: Some(0) }),
                contract(&undo, &Snapshot::FastStartup { prior_hiberboot: Some(1) }),
            ],
            "each undo must restore its own row's snapshot, the older one last"
        );
        assert!(history.iter().all(|c| c.status == "rolled_back"));
    }

    // ── P5-outcomes-f1: the Trial behind an outcome-switch apply or undo ──

    fn trial(id: &str, outcome: &str) -> TrialLink {
        TrialLink {
            experiment_id: id.into(),
            outcome: outcome.into(),
            concluded_at: Some("2026-10-24T20:00:00+00:00".into()),
        }
    }

    #[test]
    fn an_older_ledger_without_trial_links_still_loads() {
        // A row as every Compy before P5-outcomes-f1 wrote it: no trial-link keys at all.
        let raw = r#"[{"id":"fast-startup-off-1","rec_id":"fast-startup-off","rec_title":"Disable Fast Startup",
            "applied_at":"2026-10-01T09:00:00+00:00","snapshot":{},"status":"rolled_back",
            "rolled_back_at":"2026-10-02T09:00:00+00:00"}]"#;
        let rows: Vec<AppliedChange> = serde_json::from_str(raw).expect("an older ledger loads");
        assert_eq!(rows[0].justified_by_experiment, None);
        assert_eq!(rows[0].rollback_justified_by_experiment, None);
        let view = serde_json::to_value(into_view(rows[0].clone())).expect("view");
        assert_eq!(view["justified_by_experiment"], serde_json::Value::Null);
        assert_eq!(view["rollback_justified_by_experiment"], serde_json::Value::Null);
    }

    #[test]
    fn a_trial_link_round_trips_through_the_ledger_and_reaches_the_view() {
        let mut row = applied_fast_startup();
        row.justified_by_experiment = Some(trial("exp:max", "max-fps"));
        row.rollback_justified_by_experiment = Some(trial("exp:rec", "recommended"));
        let json = serde_json::to_string(&vec![row.clone()]).expect("save");
        assert!(json.contains("\"outcome\":\"max-fps\""), "{json}");
        let back: Vec<AppliedChange> = serde_json::from_str(&json).expect("load");
        assert_eq!(back[0].justified_by_experiment, row.justified_by_experiment);
        assert_eq!(back[0].rollback_justified_by_experiment, row.rollback_justified_by_experiment);
        let view = serde_json::to_value(into_view(back[0].clone())).expect("view");
        assert_eq!(view["justified_by_experiment"]["experiment_id"], "exp:max");
        assert_eq!(view["rollback_justified_by_experiment"]["outcome"], "recommended");
    }

    #[test]
    fn an_apply_from_the_outcome_switch_records_its_trial_and_others_record_none() {
        let mut history = vec![earlier()];
        let seen = Seen::default();
        let link = trial("exp:max", "max-fps");
        let made = vec![
            Made { justified_by: Some(link.clone()), ..Made::new("fast-startup-off", "Disable Fast Startup", fast_startup()) },
            Made::new("game-mode-on", "Turn on Game Mode", game_mode()),
        ];
        let rows = commit(&mut history, made, Ok(()), |_| Ok(()), ActiveCheck::On, &seen).expect("committed");
        assert_eq!(rows[0].justified_by_experiment, Some(link.clone()));
        assert_eq!(rows[1].justified_by_experiment, None, "a plain apply cites no Trial");
        assert_eq!(history[1].justified_by_experiment, Some(link), "and it is what the ledger saved");
        assert_eq!(history[0].justified_by_experiment, None);
    }

    #[test]
    fn an_undo_from_the_outcome_switch_records_its_trial_and_an_unsaved_one_records_nothing() {
        let link = trial("exp:rec", "recommended");
        let mut history = vec![earlier(), applied_fast_startup()];
        let seen = Seen::default();
        roll_back_citing(&mut history, 1, Some(link.clone()), Ok(()), Ok(()), ActiveCheck::Off, &seen)
            .expect("rolled back");
        assert_eq!(history[1].status, "rolled_back");
        assert_eq!(history[1].rollback_justified_by_experiment, Some(link.clone()));
        assert_eq!(history[1].justified_by_experiment, None, "the apply side is untouched");

        let mut history = vec![earlier(), applied_fast_startup()];
        let seen = Seen::default();
        let _ = roll_back_citing(&mut history, 1, Some(link), Err("disk full".into()), Ok(()), ActiveCheck::Off, &seen);
        assert_eq!(history[1].rollback_justified_by_experiment, None, "a failed save leaves the row as it was");
    }

    // #631: the undo reached Windows and only the ledger save failed. That must never read as a
    // failed undo or a change that is still on, and the undo must not be re-applied.
    #[test]
    fn an_undo_that_ran_but_could_not_be_saved_never_reads_as_a_failed_undo() {
        let mut texts = std::collections::HashSet::new();
        for read in [ActiveCheck::Off, ActiveCheck::On, ActiveCheck::Unreadable, ActiveCheck::Unrecognised] {
            let mut history = vec![earlier(), applied_fast_startup()];
            let row = history[1].clone();
            let seen = Seen::default();
            let err = roll_back(&mut history, 1, Err("disk full".into()), Ok(()), read, &seen)
                .expect_err("an unsaved rollback is not a clean success");
            let RollbackError::Unrecorded(text) = err else {
                panic!("{read:?}: an undo that ran must be Unrecorded, not Failed: {err:?}");
            };

            let expected = fast_startup();
            assert_eq!(
                *seen.rollbacks.borrow(),
                vec![contract(&expected.rollback_action, &expected.snapshot)],
                "{read:?}: the undo ran exactly once and was never re-applied"
            );
            assert_eq!(*seen.saves.borrow(), vec![2], "{read:?}: one save was attempted");
            assert_eq!(*seen.probes.borrow(), vec!["fast-startup-off"], "{read:?}: the setting is read live");
            assert_eq!(history[1].status, "applied", "{read:?}: the in-memory row is put back");
            assert_eq!(history[1].rolled_back_at, None, "{read:?}");
            assert_eq!(history[1].id, row.id, "{read:?}");

            assert!(text.starts_with(ROLLBACK_UNRECORDED_LEAD), "{read:?}: {text}");
            for phrase in ["(disk full)", "may still list this change as applied"] {
                assert!(text.contains(phrase), "{read:?}: must say {phrase:?}: {text}");
            }
            for wrong in ["Undo failed", "undo failed", "still in effect", "still on", "Couldn't undo"] {
                assert!(!text.contains(wrong), "{read:?}: must never say {wrong:?}: {text}");
            }
            assert_eq!(
                text.contains("no longer in effect"),
                read == ActiveCheck::Off,
                "{read:?}: only a live read of OFF confirms the change is gone: {text}"
            );
            assert!(texts.insert(text), "{read:?}: every live read has its own text");
        }
    }

    #[test]
    fn the_unrecorded_rollback_lead_is_pinned_for_the_frontend() {
        assert_eq!(
            ROLLBACK_UNRECORDED_LEAD,
            "The undo ran on Windows, but Compy couldn't save that to its history"
        );
    }

    #[test]
    fn a_failed_undo_stays_a_failed_rollback_and_saves_nothing() {
        let mut history = vec![applied_fast_startup()];
        let row = history[0].clone();
        let seen = Seen::default();
        let err = roll_back(&mut history, 0, Ok(()), Err("key locked".into()), ActiveCheck::On, &seen)
            .expect_err("a failed undo is a failure");
        assert_eq!(err, RollbackError::Failed("key locked".into()));
        assert!(seen.saves.borrow().is_empty(), "nothing is saved for an undo that didn't run");
        assert!(seen.probes.borrow().is_empty());
        assert_eq!(history[0].status, row.status);
        assert_eq!(history[0].rolled_back_at, None);
    }

    #[test]
    fn a_saved_rollback_marks_the_row_rolled_back_with_its_date() {
        let mut history = vec![earlier(), applied_fast_startup()];
        let seen = Seen::default();
        roll_back(&mut history, 1, Ok(()), Ok(()), ActiveCheck::Off, &seen).expect("a clean rollback");
        assert_eq!(seen.rollbacks.borrow().len(), 1);
        assert_eq!(*seen.saves.borrow(), vec![2]);
        assert!(seen.probes.borrow().is_empty(), "the happy path does no extra live read");
        assert_eq!(history[1].status, "rolled_back");
        assert!(history[1].rolled_back_at.is_some());
        assert_eq!(history[0].status, "applied", "other rows are untouched");
    }

    #[test]
    fn a_row_with_no_rollback_contract_fails_before_anything_runs() {
        let mut history = vec![applied_fast_startup()];
        history[0].rollback_action = None;
        history[0].rec_id = "no-such-rec".into();
        let seen = Seen::default();
        let err = roll_back(&mut history, 0, Ok(()), Ok(()), ActiveCheck::Off, &seen).expect_err("no contract");
        assert!(matches!(err, RollbackError::Failed(_)), "{err:?}");
        assert!(seen.rollbacks.borrow().is_empty() && seen.saves.borrow().is_empty());
    }

    // CR-footer-reversible: the view says whether a row's undo resolves, by the same resolution the
    // undo runs first, so the footer can't count a row as undoable whose undo fails before it starts.
    // Rolled-back rows, so the view takes no live read.
    #[test]
    fn the_view_says_whether_a_rows_undo_resolves() {
        let mut typed = applied_fast_startup();
        typed.status = "rolled_back".into();
        assert!(resolve_rollback(&typed).is_ok());
        assert!(into_view(typed.clone()).undo_contract);

        let mut none = typed.clone();
        none.rollback_action = None;
        none.rec_id = "no-such-rec".into();
        assert!(!into_view(none).undo_contract, "no contract, no synthesizer");

        let mut garbled = typed;
        garbled.snapshot = serde_json::json!({ "kind": "not-a-snapshot-kind" });
        assert!(!into_view(garbled).undo_contract, "a snapshot that no longer parses");

        let json = serde_json::to_value(into_view(applied_fast_startup_rolled_back())).unwrap();
        assert_eq!(json["undo_contract"], serde_json::Value::Bool(true), "on the wire: {json}");
    }

    fn applied_fast_startup_rolled_back() -> AppliedChange {
        let mut c = applied_fast_startup();
        c.status = "rolled_back".into();
        c
    }

    // #616 review: when the admin step's receipts can't be committed, the warnings for the items it
    // didn't confirm must still reach the user, in the error text.
    #[test]
    fn a_failed_admin_commit_keeps_the_skipped_items_warnings() {
        let warn = "No completion receipt was written for this item. The admin step also stopped with \
                    an error (exit 1), so Compy can't be sure it changed nothing: check this setting in Windows.";
        let outcomes = vec![
            outcome_applied("fast-startup-off", "Disable Fast Startup"),
            outcome_skipped("hags-enable", "Turn on HAGS", warn.to_string()),
            outcome_skipped("pcie-aspm-off", "PCIe power saving off", "The elevated step failed.".to_string()),
        ];
        for before in [false, true] {
            let text = admin_commit_error("Compy made this change but couldn't save it.".into(), before, &outcomes);
            assert!(text.starts_with("Compy made this change but couldn't save it."), "{text}");
            assert_eq!(text.contains("recorded as normal"), before, "{text}");
            assert!(text.contains(&format!("Turn on HAGS: {warn}")), "{text}");
            assert!(text.contains("PCIe power saving off: The elevated step failed."), "{text}");
            assert!(!text.contains("Disable Fast Startup"), "an applied item is not a skip: {text}");
        }
        let none = admin_commit_error("e".into(), false, &outcomes[..1]);
        assert_eq!(none, "e", "no skips, nothing added");
        assert!(
            callers_of("admin_commit_error").contains(&"apply_recommendations_batch".to_string()),
            "the batch builds its admin-commit error through admin_commit_error"
        );
    }

    // #616 review: a receipt that can't be BUILT part way through a list is its own branch, distinct
    // from a failed save. Every change in the list is already on Windows, so all of them are undone,
    // including the ones whose receipts did build, and nothing is saved.
    #[test]
    fn a_receipt_build_that_fails_part_way_undoes_every_change_and_saves_nothing() {
        let mut history = vec![earlier()];
        let earlier_id = history[0].id.clone();
        let seen = Seen::default();
        let built = RefCell::new(Vec::new());
        let build = |m: Made| {
            built.borrow_mut().push(m.rec_id.clone());
            if m.rec_id == "game-mode-on" {
                return Err("snapshot serialize: boom".to_string());
            }
            build_applied_change(&m.rec_id, &m.rec_title, m.result, None)
        };
        let save = |h: &[AppliedChange]| {
            seen.saves.borrow_mut().push(h.len());
            Ok(())
        };
        let rollback = |a: &RollbackAction, s: &Snapshot| {
            seen.rollbacks.borrow_mut().push(contract(a, s));
            Ok(())
        };
        let probe = |rec_id: &str, _: Option<&AppliedAction>| {
            seen.probes.borrow_mut().push(rec_id.to_string());
            ActiveCheck::Off
        };
        let err = commit_receipts_with(
            &mut history,
            vec![
                Made::new("fast-startup-off", "Disable Fast Startup", fast_startup()),
                Made::new("game-mode-on", "Turn on Game Mode", game_mode()),
                Made::new("fast-startup-off", "Disable Fast Startup again", fast_startup()),
            ],
            &build,
            &save,
            &UndoEffects { rollback: &rollback, probe: &probe },
        )
        .err()
        .expect("a list whose receipt didn't build must not read as applied");

        assert_eq!(*built.borrow(), vec!["fast-startup-off", "game-mode-on"], "building stops at the failure");
        assert!(seen.saves.borrow().is_empty(), "nothing is saved when a receipt fails to build");
        let (fs, gm) = (fast_startup(), game_mode());
        assert_eq!(
            *seen.rollbacks.borrow(),
            vec![
                contract(&fs.rollback_action, &fs.snapshot),
                contract(&gm.rollback_action, &gm.snapshot),
                contract(&fs.rollback_action, &fs.snapshot),
            ],
            "all three changes are undone, newest first, built or not"
        );
        assert_eq!(*seen.probes.borrow(), vec!["fast-startup-off", "game-mode-on", "fast-startup-off"]);
        assert_eq!(history.len(), 1, "the ledger is left exactly as it was");
        assert_eq!(history[0].id, earlier_id);
        for phrase in ["made 3 changes", "snapshot serialize: boom", "Turn on Game Mode: Undone"] {
            assert!(err.contains(phrase), "error must say {phrase:?}: {err}");
        }
    }

    fn exit_status(code: u32) -> std::process::ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(code)
    }

    fn production() -> &'static str {
        let src = include_str!("history.rs");
        &src[..src.find("\n#[cfg(test)]\nmod ").expect("test modules follow production code")]
    }

    /// Top-level fn enclosing each production-code call to `callee`, skipping comment lines.
    fn callers_of(callee: &str) -> Vec<String> {
        let production = production();
        let mut current = String::new();
        let mut callers = Vec::new();
        for line in production.lines() {
            // A new top-level item starts at column 0; blank lines and closers do not.
            if !line.is_empty() && !line.starts_with(char::is_whitespace) && !line.starts_with(['}', ')', '#', '/']) {
                current = line
                    .split_once("fn ")
                    .and_then(|(_, rest)| rest.split(['(', '<']).next())
                    .unwrap_or("<not a fn>")
                    .to_string();
            }
            if !line.trim_start().starts_with("//") && line.contains(&format!("{callee}(")) {
                callers.push(current.clone());
            }
        }
        callers
    }

    // The class guard: a new apply gateway that builds or saves its own receipt would bring the
    // orphaned-change bug back, so only the rollback-first commit may build receipts, and only it,
    // the writable canary and the rollback path may save the ledger.
    #[test]
    fn every_apply_gateway_records_through_the_rollback_first_commit() {
        let build: std::collections::BTreeSet<String> = callers_of("build_applied_change").into_iter().collect();
        assert_eq!(
            build,
            ["build_applied_change", "commit_receipts"].map(String::from).into(),
            "only commit_receipts may build a receipt"
        );
        let save: std::collections::BTreeSet<String> = callers_of("save_history").into_iter().collect();
        // CR-unconfirmed-remedy: `record_changed_outside` saves a ledger-only record and applies
        // nothing (its pure core `commit_changed_outside` takes no apply or rollback effect at all).
        assert_eq!(
            save,
            ["ensure_ledger_writable", "record_changed_outside", "record_receipts", "rollback_change_inner", "save_history"]
                .map(String::from)
                .into(),
            "an apply gateway must never save the ledger itself"
        );
        let recording: std::collections::BTreeSet<String> = callers_of("record_receipt")
            .into_iter()
            .chain(callers_of("record_receipts"))
            .collect();
        for gateway in [
            "apply_recommendation_inner",
            "restore_leftover",
            "suspend_known_service",
            "set_startup_entry_enabled",
            "disable_known_bloat_task",
            "remove_known_preload_app",
            "apply_recommendations_batch",
        ] {
            assert!(recording.contains(gateway), "{gateway} must record through record_receipt(s)");
        }
        // CR-core-parking-plan-gone: `dispatch_rollback_outcome` is the same boundary (it delegates
        // to `dispatch_rollback` and also says when nothing was left to restore), so both count.
        let undoing: std::collections::BTreeSet<String> = callers_of("dispatch_rollback")
            .into_iter()
            .chain(callers_of("dispatch_rollback_outcome"))
            // CR-core-parking-hidden-plan: the `_with` form (effects passed in, so tests can fake
            // powercfg) is the same boundary; no history.rs production code may call it directly.
            .chain(callers_of("dispatch_rollback_outcome_with"))
            .collect();
        assert_eq!(
            undoing,
            ["record_receipts", "rollback_change_inner"].map(String::from).into(),
            "production undoes a change only through the user's rollback and the receipt commit"
        );
        // #631: the user's rollback saves only through its testable core, which takes the save as
        // an effect, and only that core can say an undo ran but wasn't recorded.
        let core: std::collections::BTreeSet<String> = callers_of("commit_rollback").into_iter().collect();
        assert_eq!(core, ["commit_rollback", "rollback_change_inner"].map(String::from).into());
        let rollback = production()
            .split_once("fn rollback_change_inner(")
            .and_then(|(_, rest)| rest.split_once("\n}\n"))
            .map(|(body, _)| body)
            .expect("the rollback gateway exists");
        assert_eq!(rollback.matches("save_history(").count(), 1, "one save, handed to the core");
        assert!(rollback.contains("let save = |h: &[AppliedChange]| save_history(&root, h);"));
        let unrecorded: std::collections::BTreeSet<String> =
            callers_of("RollbackError::Unrecorded").into_iter().collect();
        // `rollback_reported` is the one reporting wrapper behind `rollback_change` and the outcome
        // switch's `rollback_change_citing` (P5-outcomes-f1).
        assert_eq!(unrecorded, ["commit_rollback", "rollback_reported"].map(String::from).into());

        // The batch closes its deferral sink before any receipt commit, so an undo that needs admin
        // runs instead of being parked in the batch script, and it reads the result file whatever
        // the admin step returned.
        let batch = production()
            .split_once("fn apply_recommendations_batch(")
            .and_then(|(_, rest)| rest.split_once("\n}\n"))
            .map(|(body, _)| body)
            .expect("the batch gateway exists");
        let closed = batch.find(".take_deferred()").expect("the batch closes its deferral sink");
        let first_commit = batch.find("record_receipts(").expect("the batch commits receipts");
        assert!(closed < first_commit, "no receipt commit may run while the deferral sink is armed");
        assert!(
            batch.contains("elevated_item_outcome(&run,"),
            "every admin-step result, error included, goes through elevated_item_outcome"
        );
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
        crate::data_root::require_ignored_only_run();
        let before = load_history().expect("ledger readable").len();
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
        let after = load_history().expect("ledger readable");
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
        let post = load_history().expect("ledger readable");
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
        crate::data_root::require_ignored_only_run();
        let before = load_history().expect("ledger readable").len();
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
        let after = load_history().expect("ledger readable");
        assert_eq!(after.len(), before + 1, "ONLY the non-elevated receipt landed");
        assert_eq!(
            crate::fast_startup_state(),
            Some(0),
            "cancelled item: nothing was changed (state from the earlier applies stands)"
        );
        println!("STEP 3 PASS: cancel = honest per-item skip; non-elevated item ledgered.");
    }
}

// Leftovers v2 RESTORE QA harness (owner-present, REAL UAC — never runs in the normal suite).
// Mirrors manual_elevation_qa. Run one test at a time with a human at the Secure Desktop:
//   cargo test --manifest-path src-tauri/Cargo.toml manual_restore_qa_w32ps -- --ignored --nocapture --test-threads=1
//   cargo test --manifest-path src-tauri/Cargo.toml manual_restore_qa_mpo -- --ignored --nocapture --test-threads=1
//   cargo test --manifest-path src-tauri/Cargo.toml manual_restore_qa_memcompress -- --ignored --nocapture --test-threads=1
// These drive the restore path through the #[cfg(test)] QA gate-bypass seam
// (leftovers::QaRestoreGateBypass) so the harness works regardless of production gate state;
// none of this exists in a shipped binary. ALL THREE LOOPS PASSED owner-present 2026-07-16
// (the arming precondition — restore_gate() flipped true that day). Fixture writes are the
// documented benign QA set ONLY (W32PS 0x26 ↔ stock 2; OverlayTestMode 5 ↔ delete; memcompress
// Disable↔Enable-MMAgent — owner-sanctioned + passed 2026-07-16), each loop asserts the rig
// STARTS clean before writing anything, and each loop ends back at Windows stock. Receipts are
// real %APPDATA%\Compy\history.json entries, "QA · "-tagged (cleanup offered after the QA pass).
#[cfg(test)]
mod manual_restore_qa {
    use super::*;
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    const W32PS_SEED: &str = "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 38 -Type DWord";
    const W32PS_CLEANUP: &str = "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 2 -Type DWord";
    const MPO_SEED: &str = "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -Value 5 -Type DWord";
    const MPO_CLEANUP: &str = "Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -ErrorAction SilentlyContinue";

    fn read_w32ps() -> Option<u32> {
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SYSTEM\CurrentControlSet\Control\PriorityControl")
            .ok()?
            .get_value("Win32PrioritySeparation")
            .ok()
    }

    fn read_overlay_test_mode() -> Option<u32> {
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows\Dwm")
            .ok()?
            .get_value("OverlayTestMode")
            .ok()
    }

    /// Live detection through the real probe + evaluator path, read via the SERIALIZED report
    /// shape (the report's fields are module-private by design).
    fn flagged_ids() -> Vec<String> {
        serde_json::to_value(crate::leftovers::get_leftovers())
            .expect("report serializes")
            .get("findings")
            .and_then(|f| f.as_array())
            .map(|fs| {
                fs.iter()
                    .filter_map(|f| f.get("id").and_then(|i| i.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Receipt assertions shared by both loops: provenance, full typed contract, exact snapshot.
    fn assert_receipt(c: &AppliedChange, kind: &str) {
        assert_eq!(c.status, "applied");
        assert_eq!(c.provenance.as_deref(), Some("leftover_adopted"), "provenance");
        assert_eq!(c.elevation_used, Some(true));
        assert!(c.applied_action.is_some() && c.rollback_action.is_some(), "full contract");
        assert_eq!(c.snapshot.get("kind").and_then(|k| k.as_str()), Some(kind), "typed snapshot");
    }

    /// W32PS QA loop — FOUR UAC prompts, click YES on all four (each announced before it fires):
    /// seed 0x26 → detector flags it → restore (receipt snapshot prior=38) → rollback puts 0x26
    /// back EXACTLY → cleanup to Windows stock 2.
    #[test]
    #[ignore = "manual leftovers-restore QA — real UAC; click YES on all 4 prompts"]
    fn manual_restore_qa_w32ps_full_loop() {
        crate::data_root::require_ignored_only_run();
        let _qa = crate::leftovers::QaRestoreGateBypass::begin();
        // Run elevated commands under cargo test (Wave-0 seam) — without this the self-helper
        // relaunches the TEST binary elevated, which exits 101 (caught live 2026-07-16).
        let _direct = crate::actions::ForceDirectElevation::begin();
        let original = read_w32ps();
        assert!(
            original.is_none() || original == Some(2),
            "rig must START clean (read {original:?}) — aborting before any write"
        );
        let before_len = load_history().expect("ledger readable").len();

        println!("\nUAC PROMPT 1/4 — SEED the rotted fixture (Win32PrioritySeparation = 0x26). Click YES.");
        run_elevated_powershell(W32PS_SEED).expect("seed write (did the prompt get a YES?)");
        assert_eq!(read_w32ps(), Some(0x26), "fixture seeded");

        let ids = flagged_ids();
        assert!(
            ids.iter().any(|i| i == "win32-priority-separation"),
            "get_leftovers flags the seeded fixture, got: {ids:?}"
        );
        println!("DETECTED: get_leftovers flags win32-priority-separation.");

        println!("\nUAC PROMPT 2/4 — RESTORE to Windows stock (2). Click YES.");
        let view = restore_leftover("win32-priority-separation", "QA · Past tweak restore")
            .expect("restore runs (did the prompt get a YES?)");
        assert_eq!(read_w32ps(), Some(2), "restored to stock 2");

        let after = load_history().expect("ledger readable");
        assert_eq!(after.len(), before_len + 1, "exactly one receipt");
        let receipt = after.iter().find(|c| c.id == view.id).expect("receipt present");
        assert_receipt(receipt, "priority-separation");
        assert_eq!(
            receipt.snapshot.get("prior_value").and_then(|v| v.as_u64()),
            Some(38),
            "snapshot holds the EXACT rotted value (0x26 = 38)"
        );
        assert!(
            !flagged_ids().iter().any(|i| i == "win32-priority-separation"),
            "the restored state reads clean"
        );
        println!("RECEIPT OK: provenance leftover_adopted · snapshot prior_value=38 · detector quiet.");

        println!("\nUAC PROMPT 3/4 — ROLLBACK (the rotted 0x26 must come back EXACTLY). Click YES.");
        rollback_change(view.id.clone()).expect("rollback runs (did the prompt get a YES?)");
        assert_eq!(read_w32ps(), Some(0x26), "rollback restored the rotted value EXACTLY");
        let post = load_history().expect("ledger readable");
        assert_eq!(
            post.iter().find(|c| c.id == view.id).expect("entry").status,
            "rolled_back"
        );

        println!("\nUAC PROMPT 4/4 — CLEANUP to Windows stock (2). Click YES.");
        run_elevated_powershell(W32PS_CLEANUP).expect("cleanup write (did the prompt get a YES?)");
        assert_eq!(read_w32ps(), Some(2), "left at Windows stock 2");
        println!(
            "W32PS LOOP PASS: seed 0x26 → flagged → restore (receipt prior=38) → rollback 0x26 exact → stock 2. Rig started at {original:?}."
        );
    }

    /// MPO QA loop — FOUR UAC prompts, click YES on all four: seed OverlayTestMode=5 → detector
    /// flags it → restore DELETES the value (receipt snapshot prior=5) → rollback sets 5 back
    /// EXACTLY → cleanup deletes (stock = value absent).
    #[test]
    #[ignore = "manual leftovers-restore QA — real UAC; click YES on all 4 prompts"]
    fn manual_restore_qa_mpo_full_loop() {
        crate::data_root::require_ignored_only_run();
        let _qa = crate::leftovers::QaRestoreGateBypass::begin();
        let _direct = crate::actions::ForceDirectElevation::begin(); // Wave-0 seam (see w32ps loop)
        let original = read_overlay_test_mode();
        assert!(
            original.is_none(),
            "rig must START clean / value absent (read {original:?}) — aborting before any write"
        );
        let before_len = load_history().expect("ledger readable").len();

        println!("\nUAC PROMPT 1/4 — SEED the rotted fixture (OverlayTestMode = 5). Click YES.");
        run_elevated_powershell(MPO_SEED).expect("seed write (did the prompt get a YES?)");
        assert_eq!(read_overlay_test_mode(), Some(5), "fixture seeded");

        let ids = flagged_ids();
        assert!(
            ids.iter().any(|i| i == "mpo-disabled"),
            "get_leftovers flags the seeded fixture, got: {ids:?}"
        );
        println!("DETECTED: get_leftovers flags mpo-disabled.");

        println!("\nUAC PROMPT 2/4 — RESTORE the Windows default (delete the value). Click YES.");
        let view = restore_leftover("mpo-disabled", "QA · Past tweak restore")
            .expect("restore runs (did the prompt get a YES?)");
        assert_eq!(read_overlay_test_mode(), None, "value deleted — MPO back to default");

        let after = load_history().expect("ledger readable");
        assert_eq!(after.len(), before_len + 1, "exactly one receipt");
        let receipt = after.iter().find(|c| c.id == view.id).expect("receipt present");
        assert_receipt(receipt, "mpo");
        assert_eq!(
            receipt.snapshot.get("prior_overlay_test_mode").and_then(|v| v.as_u64()),
            Some(5),
            "snapshot holds the EXACT rotted value (5)"
        );
        assert!(
            !flagged_ids().iter().any(|i| i == "mpo-disabled"),
            "the restored state reads clean"
        );
        println!("RECEIPT OK: provenance leftover_adopted · snapshot prior=5 · detector quiet.");

        println!("\nUAC PROMPT 3/4 — ROLLBACK (OverlayTestMode=5 must come back EXACTLY). Click YES.");
        rollback_change(view.id.clone()).expect("rollback runs (did the prompt get a YES?)");
        assert_eq!(read_overlay_test_mode(), Some(5), "rollback restored the rotted value EXACTLY");
        let post = load_history().expect("ledger readable");
        assert_eq!(
            post.iter().find(|c| c.id == view.id).expect("entry").status,
            "rolled_back"
        );

        println!("\nUAC PROMPT 4/4 — CLEANUP (delete the value — Windows stock). Click YES.");
        run_elevated_powershell(MPO_CLEANUP).expect("cleanup write (did the prompt get a YES?)");
        assert_eq!(read_overlay_test_mode(), None, "left at Windows stock (value absent)");
        println!(
            "MPO LOOP PASS: seed 5 → flagged → restore-delete (receipt prior=5) → rollback 5 exact → absent."
        );
    }

    /// Memcompress full loop — SIX UAC prompts (the prior is admin-only, so state verification
    /// also rides elevated read-backs). ⚠ FIXTURE NOT YET OWNER-SANCTIONED: this loop toggles
    /// real memory compression (seed = Disable-MMAgent, cleanup = Enable-MMAgent, the Windows
    /// default). Do NOT run until the owner sanctions that pair. The 2026-06-12 elevated-prior-
    /// read redesign replaced the old always-refuse arm this harness previously pinned.
    #[test]
    #[ignore = "manual leftovers-restore QA — real UAC ×6; OWNER FIXTURE SANCTION REQUIRED (toggles memory compression)"]
    fn manual_restore_qa_memcompress_full_loop() {
        crate::data_root::require_ignored_only_run();
        let (state, needs_admin) = crate::leftovers::read_memory_compression_probe();
        assert!(
            state.is_none() && needs_admin,
            "this loop exercises the admin-only-prior arm — run it from a normal (non-elevated) shell (probe read {state:?})"
        );
        let _qa = crate::leftovers::QaRestoreGateBypass::begin();
        let _direct = crate::actions::ForceDirectElevation::begin(); // Wave-0 seam (see w32ps loop)
        let before_len = load_history().expect("ledger readable").len();

        // Elevated read-back helper: the only way to verify ground truth when the read is
        // admin-only. Result file is data out, same pattern as the resolver itself.
        let read_back = |label: &str| -> bool {
            let path = crate::compy_data_dir().join(format!("qa-memcompress-{label}.result"));
            let _ = std::fs::remove_file(&path);
            let script = format!(
                "$rf='{}'; Add-Content -LiteralPath $rf -Value \"state:$((Get-MMAgent).MemoryCompression)\"",
                path.to_string_lossy().replace('\'', "''")
            );
            run_elevated_powershell(&script).expect("read-back (did the prompt get a YES?)");
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let _ = std::fs::remove_file(&path);
            match text.trim() {
                "state:True" => true,
                "state:False" => false,
                other => panic!("unparseable read-back: {other:?}"),
            }
        };

        println!("\nUAC PROMPT 1/6 — SEED the rotted fixture (Disable-MMAgent). Click YES.");
        run_elevated_powershell("if ((Get-MMAgent).MemoryCompression) { Disable-MMAgent -MemoryCompression }")
            .expect("seed (did the prompt get a YES?)");

        // Detection stays HONEST about the admin-only read: the detector must report
        // "needs admin", never a finding it can't see.
        let report = serde_json::to_value(crate::leftovers::get_leftovers()).expect("serializes");
        let unavailable: Vec<&str> = report
            .get("unavailable")
            .and_then(|u| u.as_array())
            .map(|us| us.iter().filter_map(|u| u.get("id").and_then(|i| i.as_str())).collect())
            .unwrap_or_default();
        assert!(
            unavailable.contains(&"memory-compression-off"),
            "non-elevated detection honestly reports needs-admin, got unavailable: {unavailable:?}"
        );
        println!("DETECTION HONEST: memory-compression-off reports needs-admin (not a guessed finding).");

        println!("\nUAC PROMPT 2/6 — RESTORE (one elevation banks prior THEN enables). Click YES.");
        let view = restore_leftover("memory-compression-off", "QA · Past tweak restore")
            .expect("restore runs (did the prompt get a YES?)");
        let after = load_history().expect("ledger readable");
        assert_eq!(after.len(), before_len + 1, "exactly one receipt");
        let receipt = after.iter().find(|c| c.id == view.id).expect("receipt present");
        assert_receipt(receipt, "memory-compression");
        assert_eq!(
            receipt.snapshot.get("prior_enabled").and_then(|v| v.as_bool()),
            Some(false),
            "snapshot banked the rotted prior (compression OFF) from INSIDE the elevation"
        );

        println!("\nUAC PROMPT 3/6 — READ-BACK: compression should now be ON. Click YES.");
        assert!(read_back("post-restore"), "restore enabled memory compression");

        println!("\nUAC PROMPT 4/6 — ROLLBACK (the rotted OFF must come back). Click YES.");
        rollback_change(view.id.clone()).expect("rollback runs (did the prompt get a YES?)");
        let post = load_history().expect("ledger readable");
        assert_eq!(post.iter().find(|c| c.id == view.id).expect("entry").status, "rolled_back");

        println!("\nUAC PROMPT 5/6 — READ-BACK: compression should be OFF again. Click YES.");
        assert!(!read_back("post-rollback"), "rollback restored the rotted OFF exactly");

        println!("\nUAC PROMPT 6/6 — CLEANUP to Windows stock (Enable-MMAgent). Click YES.");
        run_elevated_powershell("if (-not (Get-MMAgent).MemoryCompression) { Enable-MMAgent -MemoryCompression }")
            .expect("cleanup (did the prompt get a YES?)");
        println!(
            "MEMCOMPRESS LOOP PASS: seed OFF → needs-admin honest → restore (receipt prior=false, banked in-elevation) → ON → rollback → OFF → stock ON."
        );
    }
}

// ─── Leftovers v2 restore — armed-path tests + the adversarial rollback audit (R2-5) ────────
#[cfg(test)]
mod leftover_restore_tests {
    use super::*;

    #[test]
    fn armed_gate_admits_and_a_declined_elevation_writes_nothing() {
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        // ARMED world (2026-07-16): the gate admits the call, the resolver reads the prior
        // (W32PS — non-elevated HKLM read, succeeds on any rig) and reaches the elevation seam;
        // a forced decline there must leave ZERO receipt. No real prompt, no mutation.
        let _force = ForceElevationError::begin();
        let before = load_history().expect("test ledger readable").len();
        let err = restore_leftover("win32-priority-separation", "armed decline test")
            .err()
            .expect("forced elevation decline");
        assert_eq!(err, ELEVATION_DECLINED_MSG, "admitted by the gate, refused at elevation: {err}");
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "a declined restore must never write a receipt");
    }

    #[test]
    fn production_gate_ships_armed_and_unknown_ids_still_refuse_loud() {
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        // The arming contract: restore_gate() ships true (flipped 2026-07-16 after the
        // owner-present live-UAC QA passed all three loops), and an unknown leftover id still
        // refuses loudly BEFORE any elevation — the typed-allowlist rule survives arming.
        // ForceElevationError stays armed as a belt-and-suspenders guard: if resolver dispatch
        // ever ran before the id check, this test declines instead of prompting.
        assert!(crate::leftovers::restore_gate(), "the production gate ships ARMED");
        let _force = ForceElevationError::begin();
        let before = load_history().expect("test ledger readable").len();
        let err = restore_leftover("totally-unknown-id", "unknown id test")
            .err()
            .expect("unknown ids must refuse");
        assert!(err.contains("no restore resolver exists"), "loud allowlist refusal: {err}");
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "an unknown-id refusal must never write a receipt");
    }

    /// #665 — a refused gateway call still runs `begin_mutation`'s write-ahead canary (production
    /// order, unchanged), and in a test build that canary must land in this process's own test
    /// root. Before #665 it re-saved the user's real `%APPDATA%\Compy\history.json` while the
    /// receipt-count assertions above stayed green, because a content-identical save adds nothing.
    #[test]
    fn a_refused_gateway_call_writes_its_canary_only_into_the_test_root() {
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        let _force = ForceElevationError::begin();
        let before = load_history().expect("test ledger readable").len();
        let err = restore_leftover("totally-unknown-id", "#665 canary-root guard")
            .err()
            .expect("unknown ids must refuse");
        assert!(err.contains("no restore resolver exists"), "loud allowlist refusal: {err}");

        let ledger = history_path();
        assert!(ledger.exists(), "the canary must still run before the refusal: {ledger:?}");
        assert!(
            ledger.starts_with(std::env::temp_dir()),
            "the canary rewrote a ledger outside the temp dir: {ledger:?}"
        );
        let owner = ledger
            .parent()
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        assert!(
            owner.starts_with(&format!("{}-", std::process::id())),
            "the canary rewrote a ledger this process does not own: {ledger:?}"
        );
        assert_eq!(load_history().expect("readable").len(), before, "a refusal writes no receipt");
    }

    // ── Memcompress elevated-prior-read (2026-06-12, dark) — the adversarial set ──────────────

    #[test]
    fn memcompress_combined_script_banks_the_prior_before_mutating() {
        let s = memcompress_combined_restore_script(r"C:\Users\o'brien\AppData\res.result");
        // Order is the contract: EAP=Stop first, prior read + bank BEFORE the mutation, the
        // confirmation marker LAST — so a failure at any step can never leave a mutation that
        // precedes its snapshot.
        let idx = |needle: &str| s.find(needle).unwrap_or_else(|| panic!("missing {needle}: {s}"));
        assert!(s.starts_with("$ErrorActionPreference='Stop';"));
        assert!(idx("Get-MMAgent") < idx("prior:$p"), "prior read precedes its banking");
        assert!(idx("prior:$p") < idx("Enable-MMAgent"), "snapshot banks BEFORE the mutation");
        assert!(idx("Enable-MMAgent") < idx("done:ok"), "confirmation is the last act");
        assert!(!s.to_lowercase().contains("exit"), "exit-free: {s}");
        assert!(s.contains("o''brien"), "result path is single-quote-escaped");
    }

    #[test]
    fn memcompress_result_parse_is_fail_safe() {
        assert_eq!(parse_memcompress_restore_result("prior:False\ndone:ok"), Ok(false));
        assert_eq!(parse_memcompress_restore_result("prior:True\r\ndone:ok"), Ok(true));
        // Prior banked but the mutation never confirmed → no snapshot is earned.
        let e = parse_memcompress_restore_result("prior:False").expect_err("unconfirmed");
        assert!(e.contains("did not confirm") && e.contains("nothing was recorded"), "{e}");
        // No prior at all (empty / tampered / done-only) → refuse, never guess a direction.
        for text in ["", "done:ok", "prior:Garbage\ndone:ok"] {
            let e = parse_memcompress_restore_result(text).expect_err("must refuse");
            assert!(e.contains("nothing was recorded"), "{text:?}: {e}");
        }
    }

    #[test]
    fn memcompress_unreadable_prior_now_rides_one_elevation_and_a_decline_writes_nothing() {
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        // The redesign: an admin-only prior no longer refuses outright — it takes the prior
        // INSIDE one elevated context. Deterministically: with elevation forced to decline and
        // the QA seam open, the resolver reaches the elevation seam (decline) regardless of which
        // arm ran (readable prior → plain path; unreadable → combined path) and ledgers nothing.
        let before = load_history().expect("readable").len();
        {
            let _qa = crate::leftovers::QaRestoreGateBypass::begin();
            let _force = ForceElevationError::begin();
            let err = restore_leftover("memory-compression-off", "QA seam test")
                .err()
                .expect("forced decline");
            assert_eq!(err, ELEVATION_DECLINED_MSG, "{err}");
        }
        assert_eq!(load_history().expect("readable").len(), before, "decline ledgers nothing");
    }

    #[test]
    fn unreadable_prior_refuses_before_elevation_is_even_attempted() {
        // Adversarial: rollback-first integrity means never mutating what couldn't be
        // snapshotted. With elevation forced to error, a Some(prior) reaches the elevation
        // seam (declined), while a None prior must fail EARLIER with the snapshot refusal.
        let _force = ForceElevationError::begin();
        let declined = restore_memory_compression_with(Some(false))
            .err()
            .expect("forced elevation error");
        assert_eq!(declined, ELEVATION_DECLINED_MSG, "reached elevation: {declined}");
        let refused = restore_memory_compression_with(None).err().expect("must refuse");
        assert!(
            refused.contains("can't be snapshotted"),
            "refusal precedes elevation: {refused}"
        );
    }

    #[test]
    fn rollback_scripts_restore_exact_priors_including_absent_value_deletion() {
        // The rotted value comes back EXACTLY: present priors are Set, absent priors are
        // Remove — and no script ever contains 'exit' (the §4 batchability invariant).
        let s = mmcss_rollback_script(Some(1), None);
        assert!(s.contains("'SystemResponsiveness' -Value 1"));
        assert!(s.contains("Remove-ItemProperty") && s.contains("'NetworkThrottlingIndex'"));
        let s2 = priority_separation_rollback_script(Some(38));
        assert!(s2.contains("'Win32PrioritySeparation' -Value 38"));
        let s3 = priority_separation_rollback_script(None);
        assert!(s3.contains("Remove-ItemProperty"));
        for script in [mmcss_restore_script(), priority_separation_restore_script(), s, s2, s3] {
            assert!(!script.to_lowercase().contains("exit"), "exit-free: {script}");
        }
        // The restore scripts write the documented stock values, nothing else.
        assert!(mmcss_restore_script().contains("'SystemResponsiveness' -Value 20"));
        assert!(mmcss_restore_script().contains("'NetworkThrottlingIndex' -Value 10"));
        assert!(priority_separation_restore_script().contains("-Value 2"));
    }

    #[test]
    fn blind_rollback_fails_loud_and_mismatched_pairs_are_contract_violations() {
        // A hand-edited entry with no prior must never guess a direction.
        let err = rollback_memory_compression_typed(None).expect_err("loud");
        assert!(err.contains("cannot roll back blind"));
        // The (action, snapshot) pair contract holds for the new variants too.
        let mismatch = dispatch_rollback(
            &crate::data_root::test_mutation_root(),
            &RollbackAction::RestoreMemoryCompressionFromSnapshot,
            &Snapshot::PrioritySeparation { prior_value: Some(2) },
        );
        assert!(mismatch.is_err(), "mismatched pair must be a contract violation");
    }

    #[test]
    fn wave2_restore_scripts_are_integer_only_and_exit_free() {
        // Wave 2 adversarial: every elevated command is fixed-literal or integer-interpolated —
        // no external string, and exit-free (§4-batchable invariant).
        let scripts = [
            mpo_rollback_script(Some(5)),
            mpo_rollback_script(None),
            core_parking_script(0, 0),
            core_parking_script(100, 100),
            tcp_autotuning_script(true).to_string(),
            tcp_autotuning_script(false).to_string(),
        ];
        for s in &scripts {
            assert!(!s.to_lowercase().contains("exit"), "exit-free: {s}");
            // The only non-literal tokens are digits, the fixed GUIDs, and SCHEME_CURRENT — assert
            // no stray quoting that would indicate an interpolated free-form string slipped in.
            assert!(!s.contains("''"), "no PS string-escaping artifacts (= no external string): {s}");
        }
        // MPO restores default by DELETING the value; rollback with a prior SETS it back exactly.
        assert!(mpo_rollback_script(Some(5)).contains("OverlayTestMode' -Value 5"));
        assert!(mpo_rollback_script(None).contains("Remove-ItemProperty"));
        // Core-parking touches AC + DC + re-activates; restore re-allows parking (0%).
        let cp = core_parking_script(0, 0);
        assert!(cp.contains("setacvalueindex") && cp.contains("setdcvalueindex") && cp.contains("setactive"));
        assert!(cp.contains(SUB_PROCESSOR_GUID) && cp.contains(CPMINCORES_GUID));
        // TCP is fixed both ways.
        assert_eq!(tcp_autotuning_script(false), "netsh int tcp set global autotuninglevel=normal");
        assert_eq!(tcp_autotuning_script(true), "netsh int tcp set global autotuninglevel=disabled");
    }

    #[test]
    fn wave2_blind_rollback_fails_loud_and_pairs_are_contract_checked() {
        // Core-parking with no recorded AC prior must fail loud, never guess.
        assert!(rollback_core_parking_typed(None, Some(50), None).is_err());
        // A desktop with no DC profile mirrors AC — not an error.
        assert!(core_parking_script(75, 75).contains("75"));
        // Mismatched (action, snapshot) pairs are contract violations for every wave-2 variant.
        for (a, s) in [
            (
                RollbackAction::RestoreMpoFromSnapshot,
                Snapshot::TcpAutotuning { prior_disabled: true },
            ),
            (
                RollbackAction::RestoreCoreParkingFromSnapshot,
                Snapshot::Mpo { prior_overlay_test_mode: Some(5) },
            ),
            (
                RollbackAction::RestoreTcpAutotuningFromSnapshot,
                Snapshot::CoreParking { prior_ac_pct: Some(0), prior_dc_pct: Some(0), plan_guid: None },
            ),
        ] {
            assert!(dispatch_rollback(&crate::data_root::test_mutation_root(), &a, &s).is_err(), "mismatched pair must be rejected");
        }
    }

    #[test]
    fn wave2_armed_detectors_reach_elevation_and_a_decline_writes_nothing() {
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        // ARMED world: every wave-2 resolver is admitted by the gate and refuses WITHOUT mutating.
        //
        // bug->guard (CI, 2026-08-01). This used to assert all three reach the elevation seam, on
        // the stated premise that their prior reads "succeed on any rig". They do not. A clean
        // Windows VM has no meaningful processor power configuration, so `core-parking-forced`
        // cannot parse its AC index and refuses BEFORE elevation with "refusing to restore blind" —
        // the fail-safe idiom working exactly as designed. The PRODUCT was right; the TEST asserted
        // a property of one desk. It passed here forever and failed on every clean machine, and
        // nobody saw it for 22 days because CI had spent its minutes and gone silent.
        //
        // Rewritten to the idiom this file already uses for rig-state-dependent restores (see
        // pagefile_armed_pair_contract_and_snapshot_roundtrip_hold): name every honest outcome, pin
        // the invariant that holds across all of them, and keep the admission proof by requiring at
        // least one resolver to actually reach the seam.
        let _force = ForceElevationError::begin();
        let before = load_history().expect("test ledger readable").len();
        let mut reached_elevation = 0;
        for id in ["mpo-disabled", "core-parking-forced", "tcp-autotuning-off"] {
            let err = restore_leftover(id, "armed decline test")
                .err()
                .expect("declined or honestly refused — never a silent success");
            if err == ELEVATION_DECLINED_MSG {
                reached_elevation += 1;
            } else {
                assert!(
                    err.contains("refusing to restore blind"),
                    "{id}: the decline or an honest pre-elevation refusal, nothing else: {err}"
                );
            }
        }
        // Admission is still proven. A world where NONE of the three reaches the seam would mean the
        // gate stopped admitting them — which is the defect this test was written to catch, and the
        // thing the rewrite must not quietly give up.
        assert!(
            reached_elevation > 0,
            "no wave-2 resolver reached the elevation seam — the gate is no longer admitting them"
        );
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "declined wave-2 restores must never write receipts");
    }

    #[test]
    fn permanently_excluded_detectors_have_no_resolver_even_armed() {
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        // The two by-design exclusions (bcdedit timer flags — boot-config risk class; Defender
        // policy — security-settings owner territory) must stay restore-less FOREVER: even with
        // the gate armed and elevation theoretically available, dispatch refuses loudly before
        // any elevation is reachable. If someone ever wires a resolver for these ids, this test
        // is the tripwire that forces a deliberate owner decision.
        let _force = ForceElevationError::begin();
        let before = load_history().expect("test ledger readable").len();
        for id in ["bcdedit-timer-flags", "defender-policy-off"] {
            let err = restore_leftover(id, "excluded id test")
                .err()
                .expect("excluded ids must refuse");
            assert!(
                err.contains("no restore resolver exists"),
                "{id}: must refuse at dispatch, never reach elevation: {err}"
            );
        }
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "excluded-id refusals must never write receipts");
    }

    // ── Pagefile resolver (option (a)) — the adversarial set ──────────────────────────────────

    #[test]
    fn pagefile_parser_accepts_only_the_validated_single_fixed_entry() {
        let ok = parse_manual_pagefile_entry(&["C:\\pagefile.sys 30000 30000".into()])
            .expect("the origin-story layout parses");
        assert_eq!(ok, ('C', 30000, 30000));
        // Case-insensitive path, letter normalized upper.
        assert_eq!(
            parse_manual_pagefile_entry(&["d:\\PAGEFILE.SYS 8192 16384".into()]).expect("ok"),
            ('D', 8192, 16384)
        );
        // Every exotic layout REFUSES with the honest left-as-is message — never a guess:
        let refusals: Vec<Vec<String>> = vec![
            vec![],                                                  // disabled — no entry
            vec!["C:\\pagefile.sys 1 1".into(), "D:\\pagefile.sys 1 1".into()], // multi-pagefile
            vec!["?:\\pagefile.sys 30000 30000".into()],             // ?: auto-form
            vec!["C:\\pagefile.sys 0 0".into()],                     // system-managed-size form
            vec!["C:\\pagefile.sys 30000".into()],                   // missing max
            vec!["C:\\pagefile.sys 30000 30000 extra".into()],       // trailing junk
            vec!["C:\\other.sys 30000 30000".into()],                // not pagefile.sys
            vec!["C:\\pagefile.sys 3e4 30000".into()],               // non-integer size
        ];
        for entries in refusals {
            let err = parse_manual_pagefile_entry(&entries).expect_err("must refuse");
            assert!(err.contains("unusual") && err.contains("left as-is"), "{entries:?}: {err}");
        }
    }

    #[test]
    fn pagefile_exotic_layout_refuses_before_elevation_and_takes_no_snapshot() {
        // With elevation forced to error: a VALID layout reaches the elevation seam (declined),
        // an exotic one fails EARLIER with the layout refusal — no mutation path was entered.
        let _force = ForceElevationError::begin();
        let declined = restore_pagefile_automatic_with(vec!["C:\\pagefile.sys 30000 30000".into()])
            .err()
            .expect("forced elevation error");
        assert_eq!(declined, ELEVATION_DECLINED_MSG);
        let refused = restore_pagefile_automatic_with(vec![]).err().expect("refuses");
        assert!(refused.contains("left as-is"), "refusal precedes elevation: {refused}");
    }

    #[test]
    fn pagefile_rollback_rebuilds_a_provably_clean_entry_and_fails_loud_on_garbage() {
        let s = pagefile_rollback_script('C', 30000, 30000).expect("builds");
        // The rebuilt entry is exactly letter + fixed literal + digits — nothing else.
        assert!(s.contains("@('C:\\pagefile.sys 30000 30000')"), "exact entry: {s}");
        assert!(s.contains("AutomaticManagedPagefile=$false"), "manual mode precedes the entry");
        assert!(s.contains("-Type MultiString"));
        // No silent reboot, ever — in either direction; and exit-free.
        for script in [s.as_str(), PAGEFILE_RESTORE_SCRIPT] {
            assert!(!script.to_lowercase().contains("restart-computer"), "no silent reboot: {script}");
            assert!(!script.to_lowercase().contains("exit"), "exit-free: {script}");
        }
        // A hand-edited snapshot with garbage fails LOUD at script-build time.
        assert!(pagefile_rollback_script(';', 30000, 30000).is_err(), "non-letter refused");
        assert!(pagefile_rollback_script('C', 0, 30000).is_err(), "zero size refused");
    }

    #[test]
    fn pagefile_armed_pair_contract_and_snapshot_roundtrip_hold() {
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        // ARMED world, rig-state-dependent by design — three honest outcomes, all mutation-free:
        // an unreadable prior refuses with "cannot snapshot" BEFORE elevation (the fail-safe
        // idiom); a non-single-fixed-entry layout refuses with the honest left-as-is message
        // BEFORE elevation; the validated layout reaches the elevation seam and the forced
        // decline stops it. Whichever this rig hits, the pinned invariant is the same:
        // NO receipt without a mutation.
        let _force = ForceElevationError::begin();
        let before = load_history().expect("test ledger readable").len();
        let err = restore_leftover("pagefile-fixed", "armed decline test")
            .err()
            .expect("declined or honestly refused");
        assert!(
            err == ELEVATION_DECLINED_MSG
                || err.contains("left as-is")
                || err.contains("cannot snapshot"),
            "the decline or one of the two honest refusals: {err}"
        );
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "no receipt without a mutation");
        // Pair contract: the new variant rejects mismatches.
        assert!(dispatch_rollback(
            &crate::data_root::test_mutation_root(),
            &RollbackAction::RestorePagefileFromSnapshot,
            &Snapshot::Mpo { prior_overlay_test_mode: None },
        )
        .is_err());
        // The char-carrying snapshot round-trips through serde (ledger durability).
        let snap = Snapshot::PagefileManual {
            prior_drive_letter: 'C',
            prior_initial_mb: 30000,
            prior_maximum_mb: 30000,
        };
        let back: Snapshot =
            serde_json::from_value(serde_json::to_value(&snap).expect("ser")).expect("de");
        match back {
            Snapshot::PagefileManual { prior_drive_letter, prior_initial_mb, prior_maximum_mb } => {
                assert_eq!((prior_drive_letter, prior_initial_mb, prior_maximum_mb), ('C', 30000, 30000));
            }
            _ => panic!("wrong variant after round-trip"),
        }
    }

    #[test]
    fn provenance_is_additive_and_old_ledgers_still_deserialize() {
        // New variants + provenance round-trip; entries WITHOUT provenance load as None.
        let json = serde_json::json!([{
            "id": "memory-compression-off-1",
            "rec_id": "memory-compression-off",
            "rec_title": "Restore memory compression",
            "applied_at": "2026-06-11T00:00:00Z",
            "snapshot": { "kind": "memory-compression", "prior_enabled": false },
            "status": "applied",
            "rollback_action": { "kind": "restore-memory-compression-from-snapshot" },
            "provenance": "leftover_adopted"
        }]);
        let parsed: Vec<AppliedChange> = serde_json::from_value(json).expect("parses");
        assert_eq!(parsed[0].provenance.as_deref(), Some("leftover_adopted"));
        let legacy = serde_json::json!([{
            "id": "x", "rec_id": "game-mode", "rec_title": "t",
            "applied_at": "2026-01-01T00:00:00Z", "snapshot": {"prior": 1}, "status": "applied"
        }]);
        let parsed: Vec<AppliedChange> = serde_json::from_value(legacy).expect("old shape parses");
        assert_eq!(parsed[0].provenance, None, "pre-v2 ledgers are untouched by the new field");
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
            provenance: None,
            hw_fingerprint: None,
            rolled_back_at: None,
            justified_by_experiment: None,
            rollback_justified_by_experiment: None,
            changed_outside: None,
            applied_plan: None,
            nothing_restored: None,
        }
    }

    /// A ledger row stamped with a rig fingerprint. `record` deliberately leaves `hw_fingerprint`
    /// unset, which is the honest legacy shape — but it also means every row built from it computes
    /// `on_this_rig = None`, so a projection guard fed only `record` rows compares None with None and
    /// cannot see that field drift at all. Rows built here carry a real Some(_) instead.
    fn record_on_rig(
        rec_id: &str,
        status: &str,
        rig: crate::hardware::HwFingerprint,
    ) -> AppliedChange {
        AppliedChange { hw_fingerprint: Some(rig), ..record(rec_id, status) }
    }

    /// A fingerprint that is NOT this machine, whichever machine runs the suite. `same_rig` compares
    /// gpu / ram_gb / display, so all three are displaced from the live values. Derived from the real
    /// rig rather than hard-coded, because a hard-coded "other" rig would collide with the live one on
    /// a bare box whose hardware fields all read empty — and would then silently assert Some(true).
    fn a_rig_that_is_not_this_one() -> crate::hardware::HwFingerprint {
        let now = crate::hardware::current_fingerprint();
        crate::hardware::HwFingerprint {
            hash: format!("{}-elsewhere", now.hash),
            gpu: format!("{} (some other machine)", now.gpu),
            gpu_driver: now.gpu_driver,
            ram_gb: now.ram_gb.wrapping_add(7),
            display: format!("{}-elsewhere", now.display),
        }
    }

    #[test]
    fn rig_tagging_stamps_new_receipts_and_stays_backcompat() {
        // A5 rig tagging: build_applied_change (the ONE receipt funnel) stamps the apply-time
        // fingerprint; a legacy ledger JSON without the field still deserializes (None) and its
        // view reports on_this_rig = None — honest "rig unknown", never a guess.
        let result = ApplyResult {
            applied_action: AppliedAction::DisableFastStartup,
            rollback_action: RollbackAction::RestoreFastStartupFromSnapshot,
            snapshot: Snapshot::FastStartup { prior_hiberboot: Some(1) },
            elevation_used: false,
        };
        let c = build_applied_change("fast-startup-off", "t", result, None).expect("build");
        let f = c.hw_fingerprint.as_ref().expect("new receipts must carry the rig stamp");
        assert!(!f.hash.is_empty(), "stamp carries the digest");
        // Stamped-on-THIS-rig entries read as this rig in the view.
        let v = into_view(c);
        assert_eq!(v.on_this_rig, Some(true), "freshly stamped on this rig → true");

        // Back-compat: pre-tagging JSON (no hw_fingerprint key) deserializes to None.
        let legacy = serde_json::json!({
            "id": "x-1", "rec_id": "game-mode", "rec_title": "t",
            "applied_at": "2026-01-01T00:00:00Z", "snapshot": { "prior": 1 },
            "status": "rolled_back"
        });
        let parsed: AppliedChange = serde_json::from_value(legacy).expect("legacy parses");
        assert!(parsed.hw_fingerprint.is_none());
        assert_eq!(into_view(parsed).on_this_rig, None, "legacy → honest unknown");
    }

    #[test]
    fn same_rig_ignores_driver_but_not_hardware() {
        // The ledger comparison is driver-INsensitive (a driver update is still your rig) but
        // flips on real hardware identity (gpu / ram / display).
        let base = crate::hardware::HwFingerprint {
            hash: "aa".into(),
            gpu: "Radeon RX 9070 XT".into(),
            gpu_driver: "25.5.1".into(),
            ram_gb: 32,
            display: "2560x1440@250".into(),
        };
        let driver_bump =
            crate::hardware::HwFingerprint { gpu_driver: "25.6.0".into(), ..base.clone() };
        assert!(same_rig(&base, &driver_bump), "driver bump is still this rig");
        let new_gpu =
            crate::hardware::HwFingerprint { gpu: "GeForce RTX 5080".into(), ..base.clone() };
        assert!(!same_rig(&base, &new_gpu), "different GPU is a different rig");
        let new_ram = crate::hardware::HwFingerprint { ram_gb: 64, ..base.clone() };
        assert!(!same_rig(&base, &new_ram), "different RAM is a different rig");
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

    /// The slice projection added for #385 review 5135765472 blocker 2 exists so a consumer can
    /// derive the VIEW from rows it has ALREADY loaded instead of forcing a second `load_history`.
    /// It is only safe to use for that if it is the SAME projection — not a re-implementation that
    /// can drift from `into_view` and quietly give the Machine Model a different set of computed
    /// fields than the ledger's own command gives every other consumer.
    ///
    /// Every computed-at-read field is compared row for row, and the row set is built so each one can
    /// actually diverge: `on_this_rig` in particular needs stamped rows, because an unstamped row
    /// projects to None whatever the projection does (#385 follow-up to review 5135765472).
    #[test]
    fn the_slice_projection_is_the_same_projection_row_for_row() {
        let rows = vec![
            record("game-mode", "applied"),
            record("a-rec-we-do-not-track", "applied"),
            record("visual-effects", "rolled_back"),
            // The three rows above are unstamped, so `on_this_rig` is None on BOTH sides of every
            // comparison below and a projection that hard-coded the field would still pass. These two
            // carry a real Some(true) / Some(false), which is what makes that field falsifiable here.
            record_on_rig("power-plan", "applied", crate::hardware::current_fingerprint()),
            record_on_rig("startup-app", "applied", a_rig_that_is_not_this_one()),
            // Every row above leaves restores_label / applied_label / payoff_label vacuously None on
            // BOTH sides: `record`'s snapshot does not deserialize to a Snapshot, and its
            // applied_action is None, which short-circuits both label derivations. That is the same
            // structural gap this test just closed for on_this_rig, left open in three more fields.
            // This row deserializes, so those three carry real values (PR #403 review).
            AppliedChange {
                snapshot: serde_json::to_value(Snapshot::FastStartup { prior_hiberboot: Some(1) })
                    .expect("the snapshot fixture must serialize"),
                applied_action: Some(AppliedAction::DisableFastStartup),
                rollback_action: Some(RollbackAction::RestoreFastStartupFromSnapshot),
                ..record_on_rig("fast-startup-off", "applied", crate::hardware::current_fingerprint())
            },
        ];

        let views = applied_change_views(&rows);

        assert_eq!(views.len(), rows.len(), "the projection is 1:1 — it drops and invents nothing");

        for (view, row) in views.iter().zip(rows.iter()) {
            let expected = into_view(row.clone());
            assert_eq!(view.id, expected.id, "row order must be preserved");
            assert_eq!(view.rec_id, expected.rec_id);
            assert_eq!(view.status, expected.status);
            assert_eq!(
                view.is_still_active, expected.is_still_active,
                "the computed-at-read fields must come from into_view, not a second definition"
            );
            assert_eq!(view.restores_label, expected.restores_label);
            assert_eq!(view.applied_label, expected.applied_label);
            assert_eq!(view.payoff_label, expected.payoff_label);
            assert_eq!(view.on_this_rig, expected.on_this_rig);
            // The named asserts above cover the computed-at-read fields, and each names the field it
            // broke. They say nothing about the ten fields `into_view` merely carries across --
            // rec_title, applied_at, snapshot, applied_action, rollback_action, the two version
            // stamps, elevation_used, hw_fingerprint, rolled_back_at — so a reimplementation that
            // dropped `rollback_action` (the Fix surface's rollback affordance) or `hw_fingerprint`
            // (what on_this_rig is DERIVED from) passed this guard. Measured, not assumed: mutating
            // each of the ten inside applied_change_views left the test at 1 passed / 0 failed
            // (PR #403 review). This catch-all closes all ten and every field added after today.
            // It compares the serialized form because AppliedChangeView derives Serialize alone, and
            // this lane may not add a derive to a production struct. It runs LAST so a computed field
            // still fails by name above.
            assert_eq!(
                serde_json::to_value(view).expect("the projection must serialize"),
                serde_json::to_value(&expected).expect("the reference must serialize"),
                "every field must come from into_view, including the ones it only carries across"
            );
        }

        // The fixture is load-bearing: if a later edit drops the stamped rows, the loop above goes
        // back to comparing None with None and silently stops guarding `on_this_rig`. This canary
        // fails if that coverage is ever lost — and it is derived from `into_view` over the rows
        // DIRECTLY, never from `views`, for two reasons. Reading the projection's own output would
        // let it answer a question about itself; and it would make a real collapse in the projection
        // (every row to one value) fail HERE, wearing a fixture-authoring message, instead of at the
        // precise per-field assert above. Independent source + last position keeps each failure
        // saying what actually broke (PR #403 review).
        let reference: Vec<AppliedChangeView> = rows.iter().cloned().map(into_view).collect();
        let rig_values: Vec<Option<bool>> = reference.iter().map(|v| v.on_this_rig).collect();
        assert!(rig_values.contains(&Some(true)), "the fixture must exercise an on-this-rig row");
        assert!(rig_values.contains(&Some(false)), "the fixture must exercise an other-rig row");
        assert!(rig_values.contains(&None), "and the legacy unstamped row stays covered too");
        // Same argument, three more fields: a label that is None for every row is compared
        // None-to-None and guards nothing, which is exactly how they stood before this row landed.
        assert!(
            reference.iter().any(|v| v.restores_label.is_some()),
            "the fixture must exercise a row whose snapshot yields a restores label"
        );
        assert!(
            reference.iter().any(|v| v.applied_label.is_some()),
            "the fixture must exercise a row whose action yields an applied label"
        );
        assert!(
            reference.iter().any(|v| v.payoff_label.is_some()),
            "the fixture must exercise a row whose action yields a payoff label"
        );
        // What this test does NOT guard, deliberately: the FIELD SEMANTICS of `same_rig`. Both sides
        // of the loop above reach it through `into_view`, so narrowing `same_rig` to any non-empty
        // subset of {gpu, ram_gb, display} moves both sides together and stays green — measured, not
        // assumed. No fixture row can change that; it is what comparing two paths through one
        // function means. That subset is pinned by `same_rig_ignores_driver_but_not_hardware`
        // below, which calls `same_rig` directly. Keep the two tests together (PR #403 review).
    }

    /// Borrowing must leave the caller's rows intact: the whole point is that `build()` keeps the
    /// raw rows for its timeline/chronology projection AFTER taking the view from the same snapshot.
    #[test]
    fn the_slice_projection_leaves_the_callers_rows_usable() {
        let rows = vec![record("game-mode", "applied"), record("visual-effects", "applied")];
        let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();

        let views = applied_change_views(&rows);

        assert_eq!(views.len(), 2);
        let still_there: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
        assert_eq!(still_there, ids, "the rows the caller still needs must survive the projection");
    }

    /// #392: only a read that came back OFF may say "no longer in effect". An unrecognised rec or
    /// an unreadable probe is carried as its own answer, and the legacy bool keeps it active so it
    /// is never counted as reverted outside Compy on no evidence.
    #[test]
    fn active_check_separates_off_from_unread_and_unprobed() {
        let v = into_view(record("a-rec-we-do-not-track", "applied"));
        assert_eq!(v.active_check, Some(ActiveCheck::Unrecognised), "no probe exists, so nothing was read");
        assert!(v.is_still_active, "an unprobed change keeps its rollback reachable");

        assert!(ActiveCheck::On.legacy_active());
        assert!(!ActiveCheck::Off.legacy_active(), "a successful OFF read is the only 'not active'");
        assert!(ActiveCheck::Unreadable.legacy_active());
        assert!(ActiveCheck::Unrecognised.legacy_active());

        let rolled = into_view(record("game-mode", "rolled_back"));
        assert_eq!(rolled.active_check, None, "a rolled-back row is not live-checked");
        assert!(!rolled.is_still_active);

        let s = summarize_history(&[record("a-rec-we-do-not-track", "applied")]);
        assert_eq!(s.externally_reverted, 0, "an unprobed change is not a revert");
    }

    #[test]
    fn rolled_back_change_renders_inactive() {
        // Once rolled back, the ledger reports it inactive without consulting the
        // live system — honest history regardless of current machine state.
        let v = into_view(record("game-mode", "rolled_back"));
        assert!(!v.is_still_active);
    }

    #[test]
    fn applied_label_describes_the_after_state_per_action() {
        // The "after" half of the before/after pair, derived from the typed AppliedAction.
        assert_eq!(applied_label_from_action(&Some(AppliedAction::EnableGameMode)).as_deref(), Some("On"));
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::SetUltimatePerformancePlan)).as_deref(),
            Some("Ultimate performance")
        );
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::SetVisualEffectsBestPerformance)).as_deref(),
            Some("Best performance")
        );
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::SuspendKnownService { service: KnownService::WSearch })).as_deref(),
            Some("Stopped")
        );
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::DisableUsbSelectiveSuspendOnAc)).as_deref(),
            Some("Off (on AC)")
        );
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::RestoreMpoDefault)).as_deref(),
            Some("Windows default")
        );
    }

    #[test]
    fn applied_label_is_none_for_legacy_entries_without_a_captured_action() {
        // A pre-typed-contract ledger entry (applied_action: None) → no "after" half; the UI shows
        // just the prior. into_view must surface that None straight through.
        assert_eq!(applied_label_from_action(&None), None);
        let v = into_view(record("game-mode", "applied"));
        assert_eq!(v.applied_label, None, "legacy entry has no after-label");
    }

    // A5 measured-payoff linkage: the honest per-tweak payoff meter. It names the KIND of gain a
    // tweak targets (input latency, background CPU/RAM, load stutter, network responsiveness, power/
    // thermal headroom) — never a fabricated FPS number, per the honest-measurement law.
    #[test]
    fn payoff_label_names_the_honest_gain_category_per_action() {
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::DisableMouseAcceleration)),
            Some("Input latency")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::EnableHardwareGpuScheduling)),
            Some("Input latency")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::DisableNagleOnActiveNics)),
            Some("Network responsiveness")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::DisableKnownService {
                service: KnownService::SysMain
            })),
            Some("Background CPU & RAM")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::SuspendKnownService {
                service: KnownService::WSearch
            })),
            Some("Background CPU & RAM")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::SetVisualEffectsBestPerformance)),
            Some("UI smoothness")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::SetUltimatePerformancePlan)),
            Some("Power & thermal headroom")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::DisableFastStartup)),
            Some("Clean-boot reliability")
        );
    }

    // Honesty law: the payoff meter must NEVER surface a fabricated numeric FPS/latency figure —
    // every category is a plain word-label, no digits.
    #[test]
    fn payoff_labels_are_categories_never_fabricated_numbers() {
        use AppliedAction::*;
        for a in [
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
            DisableKnownService { service: KnownService::DiagTrack },
            SuspendKnownService { service: KnownService::SysMain },
            DisableScheduledTask { task: KnownBloatTask::CompatibilityAppraiser },
        ] {
            let label = payoff_label_from_action(&Some(a)).expect("catalog action has a payoff");
            assert!(
                !label.chars().any(|c| c.is_ascii_digit()),
                "payoff label must be a category, never a fabricated number: {label:?}"
            );
        }
    }

    // Restore-to-stock leftovers (Leftovers v2) carry no forward payoff claim — undoing a bad past
    // tweak isn't a measured gain, so it stays None (the UI shows no meter rather than an invented one).
    #[test]
    fn payoff_label_is_none_for_restores_and_legacy_entries() {
        assert_eq!(payoff_label_from_action(&None), None, "legacy entry: no payoff");
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::RestoreMpoDefault)),
            None,
            "restore-to-stock has no forward payoff claim"
        );
        let v = into_view(record("game-mode", "applied"));
        assert_eq!(v.payoff_label, None, "legacy entry surfaces None through into_view");
    }

    #[test]
    fn summary_collapses_multiple_applies_of_one_rec() {
        // The same setting applied twice is ONE setting — not two counts. An unknown rec_id has no
        // probe, so it is one change Compy can't confirm: not active, and not a revert (453-f1).
        let history = vec![record("unknown-x", "applied"), record("unknown-x", "applied")];
        let s = summarize_history(&history);
        assert_eq!(s.total, 1);
        assert_eq!(s.active, 0);
        assert_eq!(s.cant_confirm, 1);
        assert_eq!(s.externally_reverted, 0);
    }

    fn utc(at: &str) -> chrono::DateTime<Utc> {
        chrono::DateTime::parse_from_rfc3339(at).unwrap().with_timezone(&Utc)
    }
    const SET_ASIDE_AT: &str = "2026-09-01T10:00:00.123456789+00:00";

    // #669: the count a session records when it begins comes from ONE ledger read, and a read that
    // fails at that moment records NO count — never the 0 the zero-collapsing summary would give it
    // (a Trial started on such a baseline would read "0 then, 0 now" on a stock rig and pass).
    // #618: after a set-aside, a session begun past its edge records the fresh ledger's counts as
    // counts SINCE that set-aside, never as its total.
    #[test]
    fn a_session_start_records_no_count_when_the_ledger_read_failed() {
        let never = || Ok(None);
        let later = "2026-09-02T10:00:00+00:00";
        let start = |r: Result<Vec<AppliedChange>, String>| session_start_counts(move || r, never, later);
        assert_eq!(start(Err("sharing violation".into())), SessionStartCounts::default());
        assert_eq!(start(Ok(Vec::new())).whole.map(|c| c.active), Some(Some(0)));
        let history = vec![record("unknown-x", "applied"), record("unknown-y", "rolled_back")];
        // 453-f1: a ledger whose only live change can't be confirmed has counts, but its active
        // count is unknown — nothing was confirmed either way, so it is never recorded as 0.
        let counts = start(Ok(history.clone())).whole.expect("a readable ledger has counts");
        assert_eq!((counts.active, counts.cant_confirm, counts.legacy_active), (None, 1, 1));

        // A ledger set aside as history.json.corrupt loads EMPTY from then on (or with only the rows
        // added since): its count is LOST as a total, never 0 (rust-tauri-reviewer on #669).
        let aside = || Ok(Some(utc(SET_ASIDE_AT)));
        let after = session_start_counts(|| Ok(history.clone()), aside, later);
        assert_eq!(after.whole, None, "a fresh ledger's count is never recorded as the session's total");
        let (since, at) = after.since_set_aside.expect("a session begun after the set-aside counts since it");
        assert_eq!((since.active, since.cant_confirm, at), (None, 1, utc(SET_ASIDE_AT)));
        // Begun at the set-aside, or inside the slack, it may be missing moves: nothing at all.
        for began in [SET_ASIDE_AT, "2026-09-01T10:00:02.123456789+00:00", "2026-08-01T00:00:00Z"] {
            assert_eq!(session_start_counts(|| Ok(Vec::new()), aside, began), SessionStartCounts::default(), "{began}");
        }
        // A marker whose time can't be read records nothing, however late the session began.
        let unread = || Err("access denied".to_string());
        assert_eq!(session_start_counts(|| Ok(Vec::new()), unread, later), SessionStartCounts::default());
    }

    // #618 review (P2): the marker is read AFTER the load. A set-aside that lands during the load (this
    // load, or a background reader's just before it) is seen, so the fresh empty ledger it leaves is
    // never recorded as a whole history of "0 changes".
    #[test]
    fn a_session_start_sees_a_set_aside_that_lands_during_its_load() {
        use std::cell::Cell;
        let marker: Cell<Option<chrono::DateTime<Utc>>> = Cell::new(None);
        let load = || {
            marker.set(Some(utc(SET_ASIDE_AT)));
            Ok(Vec::new())
        };
        let counts = session_start_counts(load, || Ok(marker.get()), SET_ASIDE_AT);
        assert_eq!(counts, SessionStartCounts::default(), "a set-aside during the load is never a whole 0");
    }

    // #618: the set-aside marker is permanent, so the loss needs an edge in time. Only a session that
    // began after the lost ledger's last write (plus the file-clock slack) is covered; unknown on
    // either side is unknown.
    #[test]
    fn ledger_coverage_has_an_edge_in_time_and_unknown_stays_unknown() {
        let through = || Ok(Some(utc(SET_ASIDE_AT)));
        assert_eq!(ledger_coverage(Ok(None), None), LedgerCoverage::Whole, "nothing set aside: no time consulted");
        // At, before, or within the slack: lost. The same instant in another offset is the same instant.
        for began in [
            SET_ASIDE_AT,
            "2026-09-01T12:00:00.123456789+02:00",
            "2026-09-01T09:00:00Z",
            "2026-09-01T10:00:02.123456789+00:00",
        ] {
            assert_eq!(ledger_coverage(through(), Some(began)), LedgerCoverage::Lost, "{began}");
        }
        // Strictly past the slack, to the nanosecond: covered since the set-aside time.
        assert_eq!(
            ledger_coverage(through(), Some("2026-09-01T10:00:02.123456790+00:00")),
            LedgerCoverage::SinceSetAside(utc(SET_ASIDE_AT))
        );
        // Unknown: an unreadable marker time, a time too late to add the slack to, a missing or
        // garbled start.
        assert_eq!(ledger_coverage(Err("denied".into()), Some("2099-01-01T00:00:00Z")), LedgerCoverage::Unknown);
        assert_eq!(ledger_coverage(Ok(Some(chrono::DateTime::<Utc>::MAX_UTC)), Some("2099-01-01T00:00:00Z")), LedgerCoverage::Unknown);
        for began in [None, Some("not a time"), Some("")] {
            assert_eq!(ledger_coverage(through(), began), LedgerCoverage::Unknown, "{began:?}");
        }
    }

    // CR-range3-nits (b): the undo's unlocked rec-id lookup reads only. A damaged ledger is an error
    // and stays exactly where it is (no `.corrupt` rename outside the lock); absent is empty.
    #[test]
    fn the_unlocked_rec_id_read_never_sets_a_damaged_ledger_aside() {
        let dir = std::env::temp_dir().join(format!("compy-hist-unlocked-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        assert_eq!(read_history_unlocked(&path).map(|v| v.len()), Ok(0), "absent is empty");
        std::fs::write(&path, b"{ damage").unwrap();
        let err = read_history_unlocked(&path).map(|v| v.len()).expect_err("damaged is an error");
        assert!(err.contains("could not be read (parse") && err.contains("Nothing was changed"), "{err}");
        assert_eq!(std::fs::read(&path).unwrap(), b"{ damage", "left in place, byte for byte");
        assert!(!path.with_extension("json.corrupt").exists(), "nothing set aside without the lock");
        std::fs::write(&path, b"[]").unwrap();
        assert_eq!(read_history_unlocked(&path).map(|v| v.len()), Ok(0));
        let src = include_str!("history.rs");
        let body = src.split_once("pub(crate) fn rec_id_of_change(").and_then(|(_, r)| r.split_once("\n}\n")).expect("fn").0;
        assert!(body.contains("read_history_unlocked(") && !body.contains("load_history("), "the lookup reads only");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_aside_time_is_the_lost_ledgers_last_write_carried_through_the_rename() {
        // #618: the Trial's one-change checks bound a set-aside ledger by this time, so it must be
        // the lost file's own last write (every row it held is at or before it), read from disk and
        // never from the clock. With no marker it is None. If the marker can't be read it is unknown.
        let dir = std::env::temp_dir().join(format!("compy-hist-set-aside-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        assert_eq!(set_aside_through_at(&path), Ok(None), "nothing set aside reads as None");

        // Back-date the damaged ledger's last write, so a reading taken from the clock could never pass.
        let written = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
        std::fs::write(&path, b"{ not json ]]]").unwrap();
        std::fs::File::options().write(true).open(&path).unwrap().set_modified(written).unwrap();
        assert!(load_history_from(&path).is_err(), "the first load sets it aside");
        assert!(load_history_from(&path).unwrap().is_empty(), "the fresh ledger starts empty");
        assert_eq!(
            set_aside_through_at(&path),
            Ok(Some(chrono::DateTime::<Utc>::from(written))),
            "the rename carries the lost file's last write, never the moment it was read"
        );

        // A second set-aside replaces the marker, and its later write moves the edge forward: every
        // row either lost ledger held is still at or before it.
        let later = written + std::time::Duration::from_secs(3_600);
        std::fs::write(&path, b"[ torn").unwrap();
        std::fs::File::options().write(true).open(&path).unwrap().set_modified(later).unwrap();
        assert!(load_history_from(&path).is_err(), "the second damaged ledger is set aside too");
        assert_eq!(set_aside_through_at(&path), Ok(Some(chrono::DateTime::<Utc>::from(later))));
        std::fs::remove_dir_all(&dir).ok();

        // A path the OS can't look up at all is unknown, never "nothing was set aside".
        assert!(set_aside_through_at(Path::new("bad\0dir/history.json")).is_err());

        // A marker that isn't a plain file has no trustworthy time: unknown, never "nothing set
        // aside" (#618 review: a dangling link read through `metadata` was NotFound, i.e. Whole).
        let odd = std::env::temp_dir().join(format!("compy-hist-set-aside-dir-{}", std::process::id()));
        std::fs::create_dir_all(odd.join("history.json.corrupt")).unwrap();
        let why = set_aside_through_at(&odd.join("history.json")).unwrap_err();
        assert!(why.contains("isn't a plain file"), "{why}");
        assert_eq!(ledger_coverage(set_aside_through_at(&odd.join("history.json")), Some("2099-01-01T00:00:00Z")), LedgerCoverage::Unknown);
        std::fs::remove_dir_all(&odd).ok();
    }

    // #669: the checked summary a surface reads instead of the zero-collapsing one keeps a failed
    // read AND a set-aside ledger as errors — Game Readiness shows "can't read", never "0".
    #[test]
    fn the_fix_probe_reads_the_newest_apply_and_never_a_rolled_back_one() {
        let mut first = record("power-plan", "applied");
        first.id = "c1".into();
        let mut second = record("power-plan", "applied");
        second.id = "c2".into();
        let h = vec![first, record("game-mode", "applied"), second];
        assert_eq!(newest_applied_row(&h, "power-plan").map(|c| c.id.as_str()), Some("c2"));
        let undone = vec![record("power-plan", "rolled_back")];
        assert!(newest_applied_row(&undone, "power-plan").is_none(), "an undo Compy recorded is the marks' to see");
        assert!(newest_applied_row(&h, "hags").is_none());
    }

    #[test]
    fn the_confound_marks_count_entries_and_rows_not_rolled_back() {
        let h = vec![record("a", "applied"), record("b", "rolled_back"), record("a", "applied")];
        assert_eq!(ledger_marks_of(&h), (3, 2));
        let mut undone = h.clone();
        undone[2].status = "rolled_back".into();
        assert_eq!(ledger_marks_of(&undone), (3, 1), "an undo moves the second mark, never the first");
    }

    #[test]
    fn a_checked_summary_never_summarizes_a_lost_ledger_as_zeros() {
        assert!(checked_summary(Err("sharing violation".into()), false).is_err());
        assert!(checked_summary(Ok(Vec::new()), true).is_err());
        assert_eq!(checked_summary(Ok(Vec::new()), false).map(|s| s.active), Ok(0));
        let history = vec![record("unknown-x", "applied"), record("unknown-y", "rolled_back")];
        assert_eq!(checked_summary(Ok(history), false).map(|s| (s.active, s.cant_confirm)), Ok((0, 1)));
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
        assert_eq!(s.active, 0);
        assert_eq!(s.externally_reverted, 0);
        // 453-f1: the two older applies are still applied and have no probe, so the change is
        // can't-confirm by the shared rule, and so not also "rolled back".
        assert_eq!((s.cant_confirm, s.rolled_back), (1, 0));
        // With every apply undone it is rolled back, and still never a revert.
        let undone = summarize_history(&[record("unknown-x", "rolled_back"), record("unknown-x", "rolled_back")]);
        assert_eq!((undone.rolled_back, undone.cant_confirm, undone.externally_reverted), (1, 0, 0));
    }

    // #668 / 453-f1: the Trial start's counts come from the rows it already loaded, through the
    // shared rule: one per change, the newest live apply decides, a later undo of the only apply
    // clears it. `active_recs` names the changes behind `active`.
    #[test]
    fn a_trial_start_counts_and_names_active_changes_by_the_shared_rule() {
        let rows = [
            record("alpha", "applied"),
            record("alpha", "rolled_back"), // a second apply, undone: the first is still applied
            record("beta", "applied"),
            record("beta", "applied"), // re-applied: still one setting
            record("gamma", "rolled_back"),
        ];
        let on = Some(ActiveCheck::On);
        let s = summarize_checked(&rows, &[on, None, on, on, None], |_| false);
        assert_eq!(s.active, 2);
        assert_eq!(s.active_recs, ["alpha", "beta"]);
        assert_eq!(summarize_checked(&[], &[], |_| false).active, 0);
    }

    fn parity_check(v: &serde_json::Value) -> Option<ActiveCheck> {
        match v.as_str() {
            Some("on") => Some(ActiveCheck::On),
            Some("off") => Some(ActiveCheck::Off),
            Some("unreadable") => Some(ActiveCheck::Unreadable),
            Some("unrecognised") => Some(ActiveCheck::Unrecognised),
            _ => None,
        }
    }

    // 453-f1: the count a session records (and the Debrief, the Monitor line and the Trial guards
    // read back) is the same per-change count Health, Optimize and History show, on the same shared
    // fixture. The old session rule took the newest row by position, counted can't-confirm as active
    // and let a newer rollback hide an older apply that still reads on: 11 here, not 10.
    #[test]
    fn the_session_count_is_the_shared_per_change_count() {
        let fx: serde_json::Value =
            serde_json::from_str(include_str!("../../src/test/fixtures/live-changes-parity.json"))
                .expect("parity fixture parses");
        let rows = fx["rows"].as_array().expect("rows");
        let s = |r: &serde_json::Value, k: &str| r[k].as_str().expect(k).to_string();
        let history: Vec<AppliedChange> = rows
            .iter()
            .map(|r| AppliedChange {
                id: s(r, "id"),
                rec_title: s(r, "rec_title"),
                applied_at: s(r, "applied_at"),
                ..record(&s(r, "rec_id"), &s(r, "status"))
            })
            .collect();
        let checks: Vec<Option<ActiveCheck>> = rows.iter().map(|r| parity_check(&r["active_check"])).collect();
        let summary = summarize_checked(&history, &checks, |_| false);
        let want = |k: &str| fx["expected"][k].as_u64().expect("expected count") as usize;
        assert_eq!(summary.active, want("active"), "the session count is the shared active count");
        assert_eq!(summary.cant_confirm, want("cantConfirm"), "can't-confirm is counted apart, the shared count");
        // 453-f1 review: `late-rec` is active (its newest apply by time reads on) while the row last
        // in the file reads off. One change has one state: active, never also "changed outside
        // Compy". The only drifted change is the one Health calls no longer in effect.
        assert!(summary.active_recs.iter().any(|r| r == "late-rec"));
        assert_eq!(summary.drifted_titles, ["Disable Windows Search indexer"]);
        assert_eq!(summary.externally_reverted, want("notInEffect"));
        assert_eq!(summary.rolled_back, want("rolledBack"), "rb-rec is active, so not also rolled back");
    }

    // 453-f1: the newest apply decides, by time, not by where the row sits in the file; and a newer
    // rollback leaves an older apply that still reads on counted.
    #[test]
    fn the_session_count_reads_the_newest_apply_by_time_and_ignores_a_newer_rollback() {
        let at = |rec: &str, status: &str, when: &str| AppliedChange { applied_at: when.into(), ..record(rec, status) };
        let history = vec![
            at("a", "applied", "2026-09-08T10:00:00Z"),
            at("a", "applied", "2026-09-01T10:00:00Z"), // last in the file, older, reads off
            at("b", "applied", "2026-09-01T10:00:00Z"),
            at("b", "rolled_back", "2026-09-02T10:00:00Z"),
            at("c", "applied", "2026-09-01T10:00:00Z"), // reads nothing: can't confirm
        ];
        let on = Some(ActiveCheck::On);
        let checks = [on, Some(ActiveCheck::Off), on, None, Some(ActiveCheck::Unreadable)];
        let s = summarize_checked(&history, &checks, |_| false);
        assert_eq!((s.active, s.cant_confirm), (2, 1));
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
        let back = load_history_from(&path).expect("round-trip load");
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].rec_id, "game-mode");
        assert_eq!(back[1].status, "rolled_back");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_history_file_loads_empty() {
        let path = std::env::temp_dir().join("compy-hist-definitely-absent-9z.json");
        let _ = std::fs::remove_file(&path);
        assert!(load_history_from(&path).expect("missing file is a clean first run").is_empty());
    }

    #[test]
    fn corrupt_history_is_preserved_and_fails_loud_never_silently_empty() {
        // H1 (audit 2026-06-11): garbage on disk must never panic, fabricate entries, OR load
        // as silently empty (the old behavior — a later save would then overwrite the
        // recoverable file and permanently erase every rollback contract). It errors loudly
        // and the original bytes are set aside untouched.
        let dir =
            std::env::temp_dir().join(format!("compy-hist-corrupt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        let garbage: &[u8] = b"{ this is not valid json ]]]";
        std::fs::write(&path, garbage).unwrap();
        let err = load_history_from(&path)
            .err()
            .expect("a corrupt EXISTING ledger must error");
        assert!(err.contains("could not be read"), "loud, plain-English error: {err}");
        let corrupt = path.with_extension("json.corrupt");
        assert_eq!(
            std::fs::read(&corrupt).unwrap(),
            garbage,
            "the recoverable bytes are preserved EXACTLY, where no save will touch them"
        );
        assert!(!path.exists(), "the damaged live file was set aside");
        std::fs::remove_dir_all(&dir).ok();
    }

    // Codebase review 2026-11-02: a read that fails (a sharing violation, a permissions glitch) says
    // nothing about the bytes, and setting a VALID ledger aside on one stranded every rollback contract
    // in it, since the next load found no file and read as a first run. A directory at the ledger's
    // path is a read that fails on every platform.
    #[test]
    fn a_ledger_that_cant_be_read_right_now_is_never_set_aside() {
        let dir = std::env::temp_dir().join(format!("compy-hist-unreadable-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let path = dir.join("history.json");
        std::fs::create_dir_all(&path).unwrap();
        let err = load_history_from(&path).err().expect("an unreadable ledger fails loud");
        assert!(err.contains("could not be read right now"), "{err}");
        assert!(path.is_dir(), "left exactly where it was");
        assert!(!path.with_extension("json.corrupt").exists(), "never set aside on a read error");
        std::fs::remove_dir_all(&dir).ok();
    }

    // Same review: a second set-aside replaced the first one's bytes. The newest stays the marker
    // `ledger_was_quarantined` and #618 read; the earlier one is kept beside it.
    #[test]
    fn a_second_set_aside_keeps_the_first_ones_bytes() {
        let dir = std::env::temp_dir().join(format!("compy-hist-second-aside-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        std::fs::write(&path, b"{ first ]]").unwrap();
        assert!(load_history_from(&path).is_err());
        std::fs::write(&path, b"[ second").unwrap();
        assert!(load_history_from(&path).is_err());
        assert_eq!(std::fs::read(path.with_extension("json.corrupt")).unwrap(), b"[ second", "the newest is the marker");
        let kept: Vec<Vec<u8>> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with("history.json.corrupt."))
            .map(|e| std::fs::read(e.path()).unwrap())
            .collect();
        assert_eq!(kept, vec![b"{ first ]]".to_vec()], "the first set-aside's bytes survive beside it");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_quarantined_ledger_reads_empty_forever_and_leaves_only_a_marker() {
        // The trap that makes `ledger_was_quarantined` necessary. The loud error above fires
        // exactly ONCE: the rename removes the live path, so every load after it is a clean
        // Ok(vec![]) — byte-identical to a genuine first run. Nothing in the returned value can
        // tell a caller that entries were lost, which is why a caller that turns ledger silence
        // into a CLAIM has to consult the marker on disk instead of the load result.
        let dir =
            std::env::temp_dir().join(format!("compy-hist-quarantine-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        std::fs::write(&path, b"{ not json ]]]").unwrap();
        assert!(load_history_from(&path).is_err(), "the first load fails loud");

        let after = load_history_from(&path).expect("every load after it succeeds");
        assert!(
            after.is_empty(),
            "…and reads empty, indistinguishable from a first run"
        );

        // The marker name is derived independently by the rename and by `ledger_was_quarantined`.
        // If those two ever disagree the completeness signal goes false-negative in silence, so
        // pin the literal name rather than re-deriving it the same way twice.
        let marker = path.with_extension("json.corrupt");
        assert!(marker.exists(), "the marker is the only surviving evidence");
        assert_eq!(
            marker.file_name().and_then(|n| n.to_str()),
            Some("history.json.corrupt"),
            "the exact name ledger_was_quarantined looks for"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ledger_health_reads_complete_for_a_ledger_that_loads() {
        let dir = std::env::temp_dir().join(format!("compy-hist-health-ok-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        save_history_to(&path, &[record("game-mode", "applied")]).unwrap();

        let h = ledger_health_at(&path);
        assert!(h.complete, "a ledger that loads is the whole ledger");
        assert_eq!(h.error, None);
        assert!(!h.quarantined);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ledger_health_on_a_genuine_first_run_is_complete_not_a_warning() {
        // The false-alarm guard, and the reason `complete` keys off the load rather than off row
        // count. An absent ledger is a first run: an empty Trust Ledger there is the TRUTH, and a
        // disclosure that fired on every fresh install would be its own honesty defect — it would
        // train the user to dismiss the one banner that matters.
        let dir =
            std::env::temp_dir().join(format!("compy-hist-health-firstrun-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let h = ledger_health_at(&dir.join("history.json"));
        assert!(h.complete, "no file yet is a first run, not a loss");
        assert_eq!(h.error, None);
        assert!(!h.quarantined);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ledger_health_carries_the_load_failure_verbatim_for_the_surface_to_show() {
        // The transient half. The error is the one `load_history_from` already wrote in
        // plain English — the surface shows it rather than inventing its own account of the damage.
        let dir =
            std::env::temp_dir().join(format!("compy-hist-health-damaged-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        std::fs::write(&path, b"{ not json ]]]").unwrap();

        let h = ledger_health_at(&path);
        assert!(!h.complete, "an unreadable ledger is not a quiet machine");
        let err = h.error.expect("the failure reaches the caller, not just the log");
        assert!(err.contains("could not be read"), "plain-English prose: {err}");
        assert!(
            h.quarantined,
            "the read that failed quarantined the bytes on the way out — health must see the \
             marker the SAME call, not one run later"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ledger_health_stays_incomplete_after_the_load_starts_succeeding_again() {
        // THE case this type exists for, and the one a `complete = load.is_ok()` implementation
        // gets wrong. The loud error fires exactly once; from the next load onward a quarantined
        // ledger is a clean, empty, permanently-plausible Ok. If completeness followed the load
        // result, the disclosure would vanish on the second read and the Trust Ledger would go
        // back to claiming "nothing is active on this PC" forever — over lost rollback contracts.
        let dir =
            std::env::temp_dir().join(format!("compy-hist-health-durable-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        std::fs::write(&path, b"{ not json ]]]").unwrap();
        assert!(!ledger_health_at(&path).complete, "the damaged read");

        let h = ledger_health_at(&path);
        assert!(
            load_history_from(&path).expect("loads clean now").is_empty(),
            "precondition: the ledger reads as an ordinary first run again"
        );
        assert!(!h.complete, "…but the loss is durable, so the disclosure is too");
        assert_eq!(
            h.error, None,
            "no error to show — `complete: false` with no error IS the durable shape"
        );
        assert!(h.quarantined, "the preserved bytes are the only surviving evidence");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reveal_points_at_the_preserved_bytes_only_when_they_exist() {
        // The disclosure's inline action. `/select,` is what turns "your record was set aside" from
        // a claim into something the user can SEE — but pointed at a path that isn't there,
        // Explorer opens Documents instead, which reads as Compy losing the file it just promised
        // it kept. So the flag is earned by the marker, never assumed from the failure.
        let dir =
            std::env::temp_dir().join(format!("compy-hist-reveal-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");

        let folder_only = ledger_reveal_arg(&path);
        assert_eq!(
            folder_only,
            dir.as_os_str(),
            "nothing was quarantined — the honest target is the folder, with no /select, flag \
             aimed at a file that does not exist"
        );

        std::fs::write(path.with_extension("json.corrupt"), b"{ not json ]]]").unwrap();
        let selected = ledger_reveal_arg(&path);
        let expected = {
            let mut s = std::ffi::OsString::from("/select,");
            s.push(path.with_extension("json.corrupt").as_os_str());
            s
        };
        assert_eq!(
            selected, expected,
            "the marker exists, so reveal highlights the preserved bytes themselves"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn torn_write_never_loses_the_ledger() {
        // The H1 scenario end to end: a valid ledger, then a torn/truncated overwrite (what a
        // crash mid-write left under the OLD in-place fs::write) → the load refuses and
        // preserves; it never returns empty for a later save to overwrite.
        let dir = std::env::temp_dir().join(format!("compy-hist-torn-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        save_history_to(&path, &[record("game-mode", "applied")]).unwrap();
        let full = std::fs::read_to_string(&path).unwrap();
        // This pins the case with NO backup copy (a ledger from before backups existed, or both
        // files lost): the torn ledger surfaces. With a backup it is restored instead, which
        // `ledger_backup_tests` proves at every cut offset.
        std::fs::remove_file(backup_path(&path)).unwrap();
        std::fs::write(&path, &full[..full.len() / 2]).unwrap(); // torn mid-token
        assert!(
            load_history_from(&path).is_err(),
            "a torn ledger must surface, never silently empty"
        );
        assert!(
            path.with_extension("json.corrupt").exists(),
            "the torn bytes are preserved for recovery"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_is_an_atomic_swap_leaving_no_tmp() {
        // The other half of H1: saves go to a temp file then rename over the live ledger, so
        // a crash mid-write can only leave stale-but-valid data — and a successful save
        // leaves no .tmp residue.
        let dir = std::env::temp_dir().join(format!("compy-hist-atomic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        save_history_to(&path, &[record("game-mode", "applied")]).unwrap();
        save_history_to(
            &path,
            &[record("game-mode", "applied"), record("hags-enable", "applied")],
        )
        .unwrap();
        assert_eq!(
            load_history_from(&path).expect("swap result valid").len(),
            2,
            "the second save atomically replaced the first"
        );
        assert!(
            !path.with_extension("json.tmp").exists(),
            "no tmp residue after a successful swap"
        );
        std::fs::remove_dir_all(&dir).ok();
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
        let loaded = load_history_from(&path).expect("legacy ledger loads");
        assert_eq!(loaded.len(), 1);
        assert!(loaded[0].applied_action.is_none());
        assert!(loaded[0].rollback_action.is_none());
        assert!(loaded[0].app_version_at_apply.is_none());
        std::fs::remove_file(&path).ok();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Property/fuzz coverage for Trust Ledger persistence (blueprint §11, Q4).
//
// history.json is a user-writable file in %APPDATA% that the rollback path trusts completely:
// "rollback resolves from local history ALONE" (LOCKED rule 3). So every byte sequence that can
// exist at that path is a reachable input, and the invariants below are claims about the whole
// input space rather than about a list of cases someone happened to think of.
//
// Deterministic by construction — fixed seeds, no clock, no thread of randomness. A failure prints
// the seed and the offending input so it replays by hand.
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod ledger_fuzz_tests {
    use super::*;
    use crate::fuzz_support::{hostile_string, Rng, SEEDS};
    use serde_json::json;

    fn fuzz_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("compy-ledger-fuzz-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    /// Wipe the ledger AND any set-aside/temp copy, so no case can ever assert on the previous
    /// iteration's residue.
    fn clear(dir: &std::path::Path) {
        for name in [
            "history.json",
            "history.json.corrupt",
            "history.json.tmp",
            "history.json.bak",
            "history.json.bak.tmp",
            "history.json.restored",
        ] {
            std::fs::remove_file(dir.join(name)).ok();
        }
    }

    /// An `AppliedChange` whose every string field is hostile. Persistence is deliberately
    /// content-agnostic: refusing a bad *value* is the allowlist's job at apply time (proved in
    /// `actions.rs::ipc_input_fuzz_tests`), not the ledger's. What the ledger owes us is that
    /// whatever went in comes back out unchanged.
    fn fuzz_change(rng: &mut Rng) -> AppliedChange {
        let rec_id = if rng.flag() {
            (*rng.pick(APPLIABLE_REC_IDS)).to_string()
        } else {
            hostile_string(rng, 2)
        };
        let prior = rng.next_u64();
        let note = hostile_string(rng, 2);
        let hw = if rng.flag() {
            let hash = hostile_string(rng, 1);
            let gpu = hostile_string(rng, 1);
            let gpu_driver = hostile_string(rng, 1);
            let ram_gb = rng.next_u64() as u32;
            let display = hostile_string(rng, 1);
            Some(crate::hardware::HwFingerprint { hash, gpu, gpu_driver, ram_gb, display })
        } else {
            None
        };
        AppliedChange {
            id: hostile_string(rng, 2),
            rec_id,
            rec_title: hostile_string(rng, 2),
            applied_at: hostile_string(rng, 2),
            snapshot: json!({ "prior": prior, "note": note }),
            status: if rng.flag() { "applied".into() } else { "rolled_back".into() },
            applied_action: None,
            rollback_action: None,
            app_version_at_apply: if rng.flag() { Some(hostile_string(rng, 1)) } else { None },
            ruleset_version_at_apply: if rng.flag() { Some(hostile_string(rng, 1)) } else { None },
            elevation_used: if rng.flag() { Some(rng.flag()) } else { None },
            provenance: if rng.flag() { Some(hostile_string(rng, 1)) } else { None },
            hw_fingerprint: hw,
            rolled_back_at: if rng.flag() { Some(hostile_string(rng, 1)) } else { None },
            justified_by_experiment: None,
            rollback_justified_by_experiment: None,
            changed_outside: None,
            applied_plan: None,
            nothing_restored: None,
        }
    }

    /// The H1 invariant, stated over the whole input space: an EXISTING ledger either loads because
    /// it genuinely is a valid ledger, or it fails loud with its bytes preserved somewhere. It is
    /// never silently reported as "no history" — that would let the next save overwrite a
    /// recoverable file and erase every rollback contract on the machine.
    #[test]
    fn arbitrary_ledger_bytes_never_panic_and_are_never_silently_read_as_empty() {
        let dir = fuzz_dir("bytes");
        let path = dir.join("history.json");
        let corrupt = path.with_extension("json.corrupt");
        for seed in SEEDS {
            let mut rng = Rng::seeded(seed);
            for case in 0..40 {
                clear(&dir);
                let text = hostile_string(&mut rng, 6);
                std::fs::write(&path, &text).expect("write case");

                match load_history_from(&path) {
                    Ok(loaded) => {
                        // Acceptance must be exactly serde's acceptance — in particular an EMPTY
                        // result may only come from bytes that genuinely are an empty ledger.
                        let reparsed: Vec<AppliedChange> = serde_json::from_str(&text)
                            .unwrap_or_else(|e| {
                                panic!("seed {seed} case {case}: load accepted bytes serde rejects ({e}): {text:?}")
                            });
                        assert_eq!(
                            reparsed.len(),
                            loaded.len(),
                            "seed {seed} case {case}: loaded a different ledger than the bytes hold: {text:?}"
                        );
                    }
                    Err(_) => {
                        // Fail-loud path: the damaged bytes must still exist, unchanged, either set
                        // aside as .corrupt or left exactly where they were.
                        let survivor = if corrupt.exists() { &corrupt } else { &path };
                        let kept = std::fs::read_to_string(survivor).unwrap_or_else(|e| {
                            panic!("seed {seed} case {case}: unreadable ledger was destroyed ({e}): {text:?}")
                        });
                        assert_eq!(
                            kept, text,
                            "seed {seed} case {case}: damaged ledger bytes must be preserved byte-for-byte"
                        );
                    }
                }
            }
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The round-trip contract: anything the ledger stored, it returns unchanged — including string
    /// fields carrying quotes, backslashes, NULs, bidi controls, and multi-byte characters. Proved
    /// through the REAL atomic save (`.json.tmp` write + same-volume rename) and the real load, not
    /// through serde in isolation.
    #[test]
    fn hostile_ledger_content_round_trips_through_the_real_save_and_load_path() {
        let dir = fuzz_dir("roundtrip");
        let path = dir.join("history.json");
        for seed in SEEDS {
            clear(&dir);
            let mut rng = Rng::seeded(seed);
            let n = 1 + rng.below(6);
            let ledger: Vec<AppliedChange> = (0..n).map(|_| fuzz_change(&mut rng)).collect();

            save_history_to(&path, &ledger).expect("save the generated ledger");
            let back = load_history_from(&path).expect("load what we just saved");

            // AppliedChange derives no PartialEq, so compare the serialized forms — which is also
            // the exact property that matters on disk.
            assert_eq!(
                serde_json::to_string(&back).unwrap(),
                serde_json::to_string(&ledger).unwrap(),
                "seed {seed}: the ledger did not survive its own save/load path"
            );
            assert!(
                !path.with_extension("json.tmp").exists(),
                "seed {seed}: no tmp residue after a successful swap"
            );
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Torn-write property: EVERY strict prefix of a valid ledger is refused. The atomic save makes
    /// a torn ledger unreachable in normal operation; this proves that if one ever appears anyway
    /// (a foreign tool killed mid-write, a full volume, a filesystem that lies about rename
    /// atomicity), it is refused rather than silently read as fewer changes than were applied —
    /// which would strand real machine mutations with no rollback contract.
    #[test]
    fn every_truncated_prefix_of_a_valid_ledger_is_refused() {
        let dir = fuzz_dir("torn");
        let path = dir.join("history.json");
        let corrupt = path.with_extension("json.corrupt");
        let mut rng = Rng::seeded(SEEDS[0]);
        let ledger = vec![fuzz_change(&mut rng), fuzz_change(&mut rng)];
        let full = serde_json::to_string_pretty(&ledger).expect("serialize");
        let chars: Vec<char> = full.chars().collect();

        for cut in 0..chars.len() {
            clear(&dir);
            let prefix: String = chars[..cut].iter().collect();
            std::fs::write(&path, &prefix).expect("write prefix");
            assert!(
                load_history_from(&path).is_err(),
                "a ledger truncated at char {cut} of {} must never load",
                chars.len()
            );
            let survivor = if corrupt.exists() { &corrupt } else { &path };
            assert_eq!(
                std::fs::read_to_string(survivor).expect("torn ledger still readable"),
                prefix,
                "torn ledger bytes must be preserved (cut {cut})"
            );
        }

        // Control: the untruncated ledger DOES load, so the property above is about truncation and
        // not about the generator producing something unloadable in the first place.
        clear(&dir);
        std::fs::write(&path, &full).expect("write full");
        assert_eq!(
            load_history_from(&path).expect("the complete ledger loads").len(),
            2
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}

// The backup copy (reliability slice): the undo history survives one deleted or damaged file. Every
// test works in its own temp directory and never touches %APPDATA%\Compy.
#[cfg(test)]
mod ledger_backup_tests {
    use super::*;

    fn dir_for(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("compy-ledger-bak-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    /// Tests that restore (and so write support evidence) take turns, so one can count its own entries.
    /// (The crate's existing test-files turn; a lock of its own would be a new process-wide lock.)
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        crate::data_root::shared_root_files()
    }

    fn row(n: usize, title: &str) -> AppliedChange {
        serde_json::from_value(serde_json::json!({
            "id": format!("row-{n}"), "rec_id": "game-mode", "rec_title": title,
            "applied_at": "2026-11-01T09:00:00+00:00", "snapshot": { "prior": n }, "status": "applied"
        }))
        .expect("a ledger row")
    }

    fn rows(n: usize) -> Vec<AppliedChange> {
        (0..n).map(|i| row(i, &format!("title \"{i}\" \u{00e9}\u{4e2d}"))).collect()
    }

    fn ids(h: &[AppliedChange]) -> Vec<String> {
        h.iter().map(|c| c.id.clone()).collect()
    }

    fn saved(tag: &str, n: usize) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = dir_for(tag);
        let path = dir.join("history.json");
        save_history_to(&path, &rows(n)).expect("save");
        (dir, path)
    }

    fn parses(path: &Path) -> bool {
        std::fs::read(path).is_ok_and(|b| serde_json::from_slice::<Vec<AppliedChange>>(&b).is_ok())
    }

    #[test]
    fn a_save_writes_the_same_bytes_to_the_backup_and_main_is_what_it_always_was() {
        let (dir, path) = saved("golden", 3);
        // Golden: the main file is byte-for-byte what the save has always written.
        let expected = serde_json::to_string_pretty(&rows(3)).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), expected.as_bytes(), "main bytes unchanged by the backup");
        assert_eq!(std::fs::read(backup_path(&path)).unwrap(), expected.as_bytes(), "backup = the same bytes");
        for residue in ["json.tmp", "json.bak.tmp", "json.restore.tmp", "json.restored", "json.corrupt"] {
            assert!(!path.with_extension(residue).exists(), "no {residue} after a clean save");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hostile_content_leaves_main_and_backup_identical_and_valid() {
        use crate::fuzz_support::{hostile_string, Rng, SEEDS};
        let dir = dir_for("hostile");
        let path = dir.join("history.json");
        for seed in SEEDS {
            let mut rng = Rng::seeded(seed);
            let ledger: Vec<AppliedChange> = (0..3).map(|i| row(i, &hostile_string(&mut rng, 2))).collect();
            save_history_to(&path, &ledger).expect("save");
            assert_eq!(std::fs::read(&path).unwrap(), std::fs::read(backup_path(&path)).unwrap(), "seed {seed}");
            assert!(parses(&backup_path(&path)), "seed {seed}");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_deleted_main_file_is_restored_with_every_row_and_says_so() {
        let _serial = serial();
        let (dir, path) = saved("deleted", 3);
        let bak_bytes = std::fs::read(backup_path(&path)).unwrap();
        std::fs::remove_file(&path).unwrap();

        // A reader shows the backup's rows and writes nothing: no first run, no restore, no marker.
        let view = load_history_from(&path).expect("a view of the backup");
        assert_eq!(ids(&view), ids(&rows(3)));
        assert!(!path.exists() && !restored_marker_path(&path).exists(), "a read writes nothing");
        let pending = ledger_health_at(&path);
        assert!(pending.complete && pending.error.is_none());
        assert!(pending.restored.expect("pending note").contains("backup copy"));

        // The mutation load (it holds the capability) writes it back and leaves the marker.
        let back = load_history_core(&path, true).expect("restore");
        assert_eq!(ids(&back), ids(&rows(3)), "every row is back");
        assert_eq!(std::fs::read(&path).unwrap(), bak_bytes, "main = the backup's bytes");
        assert_eq!(std::fs::read(backup_path(&path)).unwrap(), bak_bytes, "the backup is untouched");
        let health = ledger_health_at(&path);
        let note = health.restored.expect("a restore is visible");
        assert!(note.contains("restored your change history from its backup copy") && note.contains("missing"), "{note}");
        assert!(health.complete, "a restore is not a loss");
        assert!(!path.with_extension("json.restore.tmp").exists());
        // And it stays stable: the next load is an ordinary load of the restored main file.
        assert_eq!(ids(&load_history_core(&path, true).unwrap()), ids(&rows(3)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_main_file_cut_at_every_byte_offset_never_loads_as_an_empty_healthy_ledger() {
        let _serial = serial();
        let (dir, path) = saved("cut", 2);
        let full = std::fs::read(&path).unwrap();
        let corrupt = path.with_extension("json.corrupt");
        for cut in 0..full.len() {
            for f in [&path, &corrupt, &path.with_extension("json.restored")] {
                std::fs::remove_file(f).ok();
            }
            save_history_to(&path, &rows(2)).unwrap(); // main and backup both good again
            std::fs::write(&path, &full[..cut]).unwrap();
            let back = load_history_core(&path, true).unwrap_or_else(|e| panic!("cut {cut}: {e}"));
            assert_eq!(ids(&back), ids(&rows(2)), "cut {cut}: every row, never empty");
            assert_eq!(std::fs::read(&corrupt).unwrap(), &full[..cut], "cut {cut}: the damaged bytes are kept");
            assert_eq!(std::fs::read(&path).unwrap(), full, "cut {cut}: main is whole again");
            assert!(ledger_health_at(&path).restored.is_some(), "cut {cut}: visible");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_read_of_a_cut_main_file_shows_the_backups_rows_at_every_offset() {
        let _serial = serial();
        let (dir, path) = saved("cut-read", 2);
        let full = std::fs::read(&path).unwrap();
        for cut in 0..full.len() {
            std::fs::remove_file(path.with_extension("json.corrupt")).ok();
            std::fs::write(&path, &full[..cut]).unwrap();
            let seen = load_history_from(&path).unwrap_or_else(|e| panic!("cut {cut}: {e}"));
            assert_eq!(ids(&seen), ids(&rows(2)), "cut {cut}");
            assert!(!path.exists(), "cut {cut}: the reader sets the damage aside and writes no ledger");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_main_file_of_the_wrong_shape_is_damage_too() {
        let _serial = serial();
        for (i, body) in ["{\"schema\":9}", "null", "5", "\"x\"", "[{\"id\":1}]"].into_iter().enumerate() {
            let (dir, path) = saved(&format!("shape{i}"), 2);
            std::fs::write(&path, body).unwrap();
            assert_eq!(ids(&load_history_core(&path, true).unwrap()), ids(&rows(2)), "{body}");
            assert_eq!(std::fs::read_to_string(path.with_extension("json.corrupt")).unwrap(), body);
            std::fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn a_readable_main_file_always_wins_and_the_backup_is_never_used_over_it() {
        let (dir, path) = saved("wins", 1);
        // A backup with MORE rows than the main file: still never used while the main file parses.
        let bigger = serde_json::to_string_pretty(&rows(3)).unwrap();
        std::fs::write(backup_path(&path), &bigger).unwrap();
        let main_before = std::fs::read(&path).unwrap();
        assert_eq!(ids(&load_history_core(&path, true).unwrap()), ids(&rows(1)));
        assert_eq!(std::fs::read(&path).unwrap(), main_before, "main untouched");
        assert_eq!(std::fs::read_to_string(backup_path(&path)).unwrap(), bigger, "backup untouched at load");
        assert!(!restored_marker_path(&path).exists() && ledger_health_at(&path).restored.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_damaged_backup_never_masks_a_good_main_and_the_next_save_repairs_it() {
        let (dir, path) = saved("badbak", 2);
        std::fs::write(backup_path(&path), b"{ not a ledger").unwrap();
        assert_eq!(ids(&load_history_core(&path, true).unwrap()), ids(&rows(2)));
        assert!(ledger_health_at(&path).restored.is_none(), "no signal for a bad backup");
        assert!(!path.with_extension("json.corrupt").exists());
        save_history_to(&path, &rows(3)).unwrap();
        assert!(parses(&backup_path(&path)));
        assert_eq!(std::fs::read(&path).unwrap(), std::fs::read(backup_path(&path)).unwrap());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn both_files_bad_is_todays_corrupt_ledger_result() {
        let (dir, path) = saved("both", 2);
        let (main_bad, bak_bad): (&[u8], &[u8]) = (b"{ main is garbage ]]]", b"{ so is the backup");
        std::fs::write(&path, main_bad).unwrap();
        std::fs::write(backup_path(&path), bak_bad).unwrap();
        let err = load_history_core(&path, true).err().expect("fails loud");
        assert!(err.contains("could not be read") && err.contains("history.json.corrupt"), "{err}");
        assert_eq!(std::fs::read(path.with_extension("json.corrupt")).unwrap(), main_bad);
        assert_eq!(std::fs::read(path.with_extension("json.bak.corrupt")).unwrap(), bak_bad, "kept, not deleted");
        assert!(!restored_marker_path(&path).exists());
        // As today: after the one loud failure the ledger starts fresh and the marker says why.
        assert!(load_history_core(&path, true).unwrap().is_empty());
        assert!(ledger_was_quarantined_at(&path));
        std::fs::remove_dir_all(&dir).ok();
    }

    fn ledger_was_quarantined_at(path: &Path) -> bool {
        path.with_extension("json.corrupt").exists()
    }

    #[test]
    fn a_missing_main_with_only_a_damaged_backup_fails_closed_once_and_keeps_the_bytes() {
        let dir = dir_for("onlybad");
        let path = dir.join("history.json");
        std::fs::write(backup_path(&path), b"{ the only copy, damaged").unwrap();
        let err = load_history_core(&path, true).err().expect("never a silent first run");
        assert!(err.contains("could not be read"), "{err}");
        assert_eq!(std::fs::read(path.with_extension("json.corrupt")).unwrap(), b"{ the only copy, damaged");
        assert!(set_aside_through_at(&path).unwrap().is_some(), "the marker the health surface reads");
        assert!(load_history_core(&path, true).unwrap().is_empty(), "then fresh, exactly like a damaged main file");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_genuine_first_run_is_unchanged() {
        let dir = dir_for("first");
        let path = dir.join("history.json");
        assert!(load_history_core(&path, true).unwrap().is_empty());
        assert!(load_history_from(&path).unwrap().is_empty());
        assert!(read_history_unlocked(&path).unwrap().is_empty());
        let health = ledger_health_at(&path);
        assert!(health.complete && health.error.is_none() && !health.quarantined && health.restored.is_none());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "a first run writes nothing");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_read_error_never_restores_and_never_touches_the_backup() {
        let (dir, path) = saved("readerr", 2);
        let bak_bytes = std::fs::read(backup_path(&path)).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap(); // a read of this path fails on every platform
        let err = load_history_core(&path, true).err().expect("a read error fails loud");
        assert!(err.contains("could not be read right now"), "{err}");
        assert!(path.is_dir(), "left where it was");
        assert_eq!(std::fs::read(backup_path(&path)).unwrap(), bak_bytes);
        assert!(!restored_marker_path(&path).exists() && !path.with_extension("json.corrupt").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_failed_main_save_leaves_the_previous_backup_and_main_intact() {
        let (dir, path) = saved("failsave", 2);
        let main_before = std::fs::read(&path).unwrap();
        let bak_before = std::fs::read(backup_path(&path)).unwrap();
        std::fs::create_dir(path.with_extension("json.tmp")).unwrap(); // the main write cannot start
        assert!(save_history_to(&path, &rows(5)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), main_before);
        assert_eq!(std::fs::read(backup_path(&path)).unwrap(), bak_before, "a failed save never replaces a good backup");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_backup_that_cannot_be_refreshed_does_not_fail_the_save_and_keeps_the_old_copy() {
        let (dir, path) = saved("bakfail", 2);
        let bak_before = std::fs::read(backup_path(&path)).unwrap();
        std::fs::create_dir(path.with_extension("json.bak.tmp")).unwrap(); // the backup write cannot start
        let why = save_history_to_reporting(&path, &rows(4)).expect("the main file is saved").expect("and it is reported");
        assert!(!why.is_empty());
        assert_eq!(ids(&load_history_core(&path, true).unwrap()), ids(&rows(4)), "main has the new rows");
        assert_eq!(std::fs::read(backup_path(&path)).unwrap(), bak_before, "the old backup is intact");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_restore_that_cannot_be_marked_is_refused_and_changes_nothing() {
        let (dir, path) = saved("nomark", 2);
        let bak_bytes = std::fs::read(backup_path(&path)).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(path.with_extension("json.restored.tmp")).unwrap();
        let err = load_history_core(&path, true).err().expect("a silent restore is refused");
        assert!(err.contains("could not be restored"), "{err}");
        assert!(!path.exists(), "no main file was written");
        assert_eq!(std::fs::read(backup_path(&path)).unwrap(), bak_bytes);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_restore_never_replaces_a_ledger_that_appeared_first() {
        let (dir, path) = saved("race", 3);
        let bak_bytes = std::fs::read(backup_path(&path)).unwrap();
        // The main file (one row) is there by the time the restore writes: it wins, untouched.
        let newer = serde_json::to_string_pretty(&rows(1)).unwrap();
        std::fs::write(&path, &newer).unwrap();
        let got = restore_main_from(&path, &bak_bytes, rows(3), RestoreReason::Missing).unwrap();
        assert_eq!(ids(&got), ids(&rows(1)));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), newer);
        assert!(!path.with_extension("json.restore.tmp").exists());
        assert!(!restored_marker_path(&path).exists(), "no restore happened, so no marker");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_unlocked_undo_lookup_does_not_read_a_missing_ledger_as_a_first_run() {
        let (dir, path) = saved("lookup", 2);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(ids(&read_history_unlocked(&path).unwrap()), ids(&rows(2)));
        assert!(!path.exists(), "a pure read");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Every file in `dir` by name and bytes (and every sub-directory by name), so "nothing changed" is the
    /// whole listing being equal, not one file.
    fn listing(dir: &Path) -> Vec<(String, Option<Vec<u8>>)> {
        let mut v: Vec<(String, Option<Vec<u8>>)> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| {
                let e = e.unwrap();
                let bytes = e.path().is_file().then(|| std::fs::read(e.path()).unwrap());
                (e.file_name().to_string_lossy().into_owned(), bytes)
            })
            .collect();
        v.sort();
        v
    }

    // The first look's read of Compy's own changes: titles and dates, and nothing written, moved, restored or
    // set aside, whatever state the ledger is in.
    #[test]
    fn the_first_look_ledger_read_changes_nothing_on_disk() {
        // A good ledger with its backup beside it.
        let (dir, path) = saved("stamps-good", 3);
        assert!(backup_path(&path).exists());
        let before = listing(&dir);
        let got = read_ledger_stamps_at(&path).unwrap();
        assert_eq!(got.iter().map(|s| s.title.clone()).collect::<Vec<_>>(), rows(3).into_iter().map(|c| c.rec_title).collect::<Vec<_>>());
        assert!(got.iter().all(|s| !s.applied_at.is_empty() && !s.status.is_empty()));
        assert_eq!(listing(&dir), before, "a good ledger");
        // A damaged ledger with a good backup beside it: an error (never an empty list), and no `.corrupt`
        // file, no restore, no marker.
        std::fs::write(&path, b"{ damage").unwrap();
        let before = listing(&dir);
        assert!(read_ledger_stamps_at(&path).is_err());
        assert_eq!(listing(&dir), before, "a damaged ledger with a backup present");
        assert_eq!(std::fs::read(&path).unwrap(), b"{ damage");
        // A missing ledger with its backup beside it: the backup's rows are shown and nothing is restored.
        std::fs::remove_file(&path).unwrap();
        let before = listing(&dir);
        assert_eq!(read_ledger_stamps_at(&path).unwrap().len(), 3);
        assert_eq!(listing(&dir), before, "a missing ledger with a backup present");
        assert!(!path.exists());
        // A damaged backup beside a missing ledger is an error, and still nothing changes.
        std::fs::write(backup_path(&path), b"{ damage").unwrap();
        let before = listing(&dir);
        assert!(read_ledger_stamps_at(&path).is_err());
        assert_eq!(listing(&dir), before, "a damaged backup");
        std::fs::remove_dir_all(&dir).ok();
        // No ledger and no backup: an empty list, and no file is created.
        let dir = dir_for("stamps-none");
        let path = dir.join("history.json");
        assert!(read_ledger_stamps_at(&path).unwrap().is_empty());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "a first run writes nothing");
        // A directory in the ledger's place cannot be read: an error, left where it was.
        std::fs::create_dir(&path).unwrap();
        let before = listing(&dir);
        assert!(read_ledger_stamps_at(&path).is_err());
        assert_eq!(listing(&dir), before);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_first_look_ledger_read_is_the_unlocked_read_and_never_a_load() {
        let src = include_str!("history.rs");
        let body = src.split_once("pub(crate) fn read_ledger_stamps_at(").and_then(|(_, r)| r.split_once("\n}\n")).expect("fn").0;
        assert!(body.contains("read_history_unlocked(") && !body.contains("load_history") && !body.contains("save_"), "{body}");
        let live = src.split_once("fn read_ledger_stamps_for(").and_then(|(_, r)| r.split_once("\n}\n")).expect("fn").0;
        assert!(live.contains("read_ledger_stamps_at(") && !live.contains("compy_data_dir"), "{live}");
        let entry = src.split_once("pub(crate) fn read_ledger_stamps(").and_then(|(_, r)| r.split_once("\n}\n")).expect("fn").0;
        assert!(entry.contains("read_ledger_stamps_for(") && !entry.contains("compy_data_dir"), "{entry}");
    }

    #[test]
    fn a_data_root_that_could_not_be_settled_is_an_unreadable_ledger_never_an_empty_one() {
        use crate::data_root::DataRootDecision;
        let dir = std::env::temp_dir().join(format!("compy-ledger-root-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let before: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        let err = read_ledger_stamps_for(&DataRootDecision::Unavailable { reason: "no appdata".into() });
        assert!(err.is_err(), "{err:?}");
        // A root with no ledger yet is an empty ledger (nothing was ever applied), as before.
        let ok = read_ledger_stamps_for(&DataRootDecision::Canonical { root: dir.clone() });
        assert_eq!(ok.map(|v| v.len()), Ok(0));
        let after: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(before, after, "the read wrote something");
        let _ = std::fs::remove_dir_all(&dir);
    }

    const GUID: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";

    fn plan_row(status: &str) -> AppliedChange {
        serde_json::from_value(serde_json::json!({
            "id": "ph-ult", "rec_id": "power-ultimate", "rec_title": "Ultimate Performance",
            "applied_at": "2026-11-13T09:01:00+00:00", "status": status,
            "snapshot": { "kind": "power-plan", "prior_guid": GUID },
            "applied_action": { "kind": "set-ultimate-performance-plan" },
            "rollback_action": { "kind": "restore-power-plan-from-snapshot" }
        }))
        .expect("a power-plan row")
    }

    fn evidence_events() -> Vec<crate::support_evidence::SupportEvent> {
        crate::support_evidence::read_events_from(&crate::compy_data_dir().join("support").join("evidence.jsonl")).0
    }

    #[test]
    fn a_backup_that_lagged_several_saves_restores_that_older_ledger_and_says_when_it_was_saved() {
        let _serial = serial();
        let (dir, path) = saved("lag", 2);
        std::fs::create_dir(path.with_extension("json.bak.tmp")).unwrap(); // the backup can no longer refresh
        for n in 3..=5 {
            assert!(save_history_to_reporting(&path, &rows(n)).expect("main saved").is_some(), "save {n} reports it");
        }
        assert_eq!(ids(&load_history_core(&path, true).unwrap()), ids(&rows(5)));
        std::fs::remove_file(&path).unwrap();
        let back = load_history_core(&path, true).unwrap();
        assert_eq!(ids(&back), ids(&rows(2)), "the backup is the ledger as of its last good refresh");
        let marker = std::fs::read_to_string(restored_marker_path(&path)).unwrap();
        assert_eq!(marker.split_whitespace().count(), 3, "time, reason and the backup's own time: {marker:?}");
        let note = ledger_health_at(&path).restored.expect("visible");
        assert!(note.contains("backup copy saved 20") && note.contains("Changes made after that copy was saved"), "{note}");
        assert!(!note.contains("last moments"), "{note}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_row_undone_after_the_backup_lagged_comes_back_applied_and_undoing_it_writes_only_the_prior_value() {
        let _serial = serial();
        let dir = dir_for("resurrected");
        let path = dir.join("history.json");
        save_history_to(&path, &[plan_row("applied")]).unwrap();
        std::fs::create_dir(path.with_extension("json.bak.tmp")).unwrap(); // freeze the backup
        save_history_to(&path, &[plan_row("rolled_back")]).unwrap();
        std::fs::remove_file(&path).unwrap();

        let mut back = load_history_core(&path, true).unwrap();
        assert_eq!(back[0].status, "applied", "the stale backup shows the undone change as applied again");

        // Undoing it again dispatches only the typed rollback with the snapshot's prior value; the
        // fakes would record an apply, a second plan or any other write.
        let dispatched = std::cell::RefCell::new(Vec::new());
        let save = |_: &[AppliedChange]| Ok(());
        let rollback = |a: &RollbackAction, s: &Snapshot| {
            let prior = match s {
                Snapshot::PowerPlan { prior_guid } => prior_guid.clone(),
                _ => "other snapshot".to_string(),
            };
            dispatched.borrow_mut().push((matches!(a, RollbackAction::RestorePowerPlanFromSnapshot), prior));
            Ok(UndoDone::Restored)
        };
        let probe = |_: &str, _: Option<&AppliedAction>| ActiveCheck::Off;
        commit_rollback(&mut back, 0, None, &save, &RollbackEffects { rollback: &rollback, probe: &probe }).expect("undo");
        assert_eq!(*dispatched.borrow(), vec![(true, GUID.to_string())], "one rollback, the prior value only");
        assert_eq!(back[0].status, "rolled_back");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_backup_older_than_a_good_main_is_never_used_whatever_order_two_writers_finished_in() {
        let (dir, path) = saved("order", 3);
        // Writer 1 finished its main write last-but-one and its backup write last: the backup is older.
        std::fs::write(backup_path(&path), serde_json::to_string_pretty(&rows(1)).unwrap()).unwrap();
        let main_before = std::fs::read(&path).unwrap();
        assert_eq!(ids(&load_history_core(&path, true).unwrap()), ids(&rows(3)), "main wins");
        assert_eq!(std::fs::read(&path).unwrap(), main_before);
        assert!(!restored_marker_path(&path).exists() && ledger_health_at(&path).restored.is_none());
        save_history_to(&path, &rows(3)).unwrap(); // the next save brings the backup level again
        assert_eq!(std::fs::read(&path).unwrap(), std::fs::read(backup_path(&path)).unwrap());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn under_a_root_that_cannot_mutate_nothing_is_restored_and_the_note_promises_nothing() {
        // No capability exists for a halted root, so the only load that writes a restore cannot run.
        for decision in [
            crate::data_root::DataRootDecision::Unavailable { reason: "APPDATA is not set".into() },
            crate::data_root::DataRootDecision::Conflict {
                canonical: std::path::PathBuf::from("C:/x"),
                canonical_receipts: Some(2),
                foreign: vec![],
            },
        ] {
            assert!(crate::data_root::mutation_root_from(&decision).is_err(), "{decision:?}");
        }
        let (dir, path) = saved("halted", 2);
        std::fs::remove_file(&path).unwrap();
        let listing = |d: &Path| {
            let mut v: Vec<_> = std::fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name()).collect();
            v.sort();
            v
        };
        let before = listing(&dir);
        assert_eq!(ids(&load_history_from(&path).unwrap()), ids(&rows(2)), "a reader still shows the rows");
        assert_eq!(ids(&read_history_unlocked(&path).unwrap()), ids(&rows(2)));
        assert_eq!(listing(&dir), before, "and writes nothing");
        let note = ledger_health_at(&path).restored.expect("pending note");
        assert!(note.contains("has not been written back yet") && !note.contains("next time"), "{note}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_restore_that_does_not_happen_leaves_no_marker_and_keeps_a_genuine_one_as_it_was() {
        let (dir, path) = saved("nomarker", 3);
        let bak_bytes = std::fs::read(backup_path(&path)).unwrap();
        // A ledger is already there: the restore stands down and leaves no marker behind.
        restore_main_from(&path, &bak_bytes, rows(3), RestoreReason::Missing).unwrap();
        assert!(!restored_marker_path(&path).exists(), "no marker without a restore");
        // A marker from an earlier genuine restore is put back byte for byte.
        let genuine = b"2026-01-01T00:00:00+00:00 damaged 2025-12-31T00:00:00Z\n";
        std::fs::write(restored_marker_path(&path), genuine).unwrap();
        restore_main_from(&path, &bak_bytes, rows(3), RestoreReason::Missing).unwrap();
        assert_eq!(std::fs::read(restored_marker_path(&path)).unwrap(), genuine);
        // A write that fails (a directory in the way) also undoes the marker it created.
        std::fs::remove_file(restored_marker_path(&path)).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(path.with_extension("json.restore.tmp")).unwrap();
        assert!(restore_main_from(&path, &bak_bytes, rows(3), RestoreReason::Missing).is_err());
        assert!(!restored_marker_path(&path).exists() && !path.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_restore_and_a_damage_view_each_leave_one_evidence_entry_with_no_path_or_row_content() {
        let _serial = serial();
        // The ledger_restore entries written since `before` (the ring may have trimmed its front).
        let since = |before: &[crate::support_evidence::SupportEvent]| {
            let after = evidence_events();
            let start = before.last().and_then(|b| after.iter().rposition(|e| e == b)).map_or(0, |p| p + 1);
            after[start..].iter().filter(|e| e.operation == "ledger_restore").cloned().collect::<Vec<_>>()
        };
        let (dir, path) = saved("evidence", 2);

        // A deleted main file read by the UI (a view): no entry per poll.
        std::fs::remove_file(&path).unwrap();
        let before = evidence_events();
        load_history_from(&path).unwrap();
        load_history_from(&path).unwrap();
        assert!(since(&before).is_empty(), "a view of a missing file records nothing");

        // The restore itself: exactly one entry.
        let before = evidence_events();
        load_history_core(&path, true).unwrap();
        let restored = since(&before);
        assert_eq!(restored.len(), 1, "{restored:?}");
        assert_eq!((restored[0].code.as_str(), restored[0].detail.as_str()), ("restored", "missing"));

        // A damaged file just set aside and shown by a reader: one entry, at that moment only.
        std::fs::write(&path, b"{ damaged").unwrap();
        let before = evidence_events();
        load_history_from(&path).unwrap();
        load_history_from(&path).unwrap();
        let viewed = since(&before);
        assert_eq!(viewed.len(), 1, "{viewed:?}");
        assert_eq!((viewed[0].code.as_str(), viewed[0].detail.as_str()), ("view", "damaged"));
        for e in restored.iter().chain(&viewed) {
            assert!(e.detail.chars().all(char::is_alphabetic), "only the reason word: {e:?}");
            assert!(!e.code.contains(['\\', '/']) && !format!("{e:?}").contains("row-"), "{e:?}");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_stale_restore_temp_that_shares_a_file_with_the_ledger_is_never_truncated() {
        let (dir, path) = saved("stale-tmp", 3);
        let bak_bytes = std::fs::read(backup_path(&path)).unwrap();
        // A crash after the link and before its removal left `.restore.tmp` as a second name for the
        // set-aside copy of a damaged ledger.
        let corrupt = path.with_extension("json.corrupt");
        std::fs::write(&corrupt, b"{ damaged bytes worth keeping").unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::hard_link(&corrupt, path.with_extension("json.restore.tmp")).unwrap();
        restore_main_from(&path, &bak_bytes, rows(3), RestoreReason::Damaged).unwrap();
        assert_eq!(std::fs::read(&corrupt).unwrap(), b"{ damaged bytes worth keeping", "the set-aside is intact");
        assert_eq!(std::fs::read(&path).unwrap(), bak_bytes);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_damaged_main_with_a_good_backup_is_still_an_error_for_the_unlocked_undo_lookup_and_nothing_moves() {
        let (dir, path) = saved("lookup-damaged", 2);
        std::fs::write(&path, b"{ damaged").unwrap();
        assert!(read_history_unlocked(&path).is_err());
        assert!(path.exists() && !path.with_extension("json.corrupt").exists(), "a read renames nothing");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_backup_failure_report_is_claimed_once() {
        let flag = std::sync::atomic::AtomicBool::new(false);
        assert!(claim_once(&flag));
        assert!(!claim_once(&flag) && !claim_once(&flag));
    }

    #[test]
    fn saves_in_quick_succession_leave_main_and_backup_both_valid_and_equal() {
        let dir = dir_for("quick");
        let path = dir.join("history.json");
        for n in 0..25 {
            save_history_to(&path, &rows(n)).unwrap();
            assert_eq!(std::fs::read(&path).unwrap(), std::fs::read(backup_path(&path)).unwrap(), "after save {n}");
        }
        // Two writers behind the production lock (every ledger writer holds it).
        let threads: Vec<_> = (0..2)
            .map(|t| {
                let path = path.clone();
                std::thread::spawn(move || {
                    for n in 0..15 {
                        let _guard = lock_history().expect("lock");
                        save_history_to(&path, &rows(t * 20 + n)).expect("save");
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert!(parses(&path) && parses(&backup_path(&path)));
        assert_eq!(std::fs::read(&path).unwrap(), std::fs::read(backup_path(&path)).unwrap());
        std::fs::remove_dir_all(&dir).ok();
    }
}

// #620: the ledger's live re-check reads three kinds of row through their typed action. Every read
// here is injected or KEY_READ-only on a value name no machine has, so nothing writes.
#[cfg(test)]
mod row_probe_tests {
    use super::*;

    fn row(rec_id: &str, status: &str, action: Option<AppliedAction>) -> AppliedChange {
        let mut c: AppliedChange = serde_json::from_value(serde_json::json!({
            "id": rec_id, "rec_id": rec_id, "rec_title": "t",
            "applied_at": "2026-10-21T09:00:00+00:00", "snapshot": {}, "status": status
        }))
        .expect("a ledger row");
        c.applied_action = action;
        c
    }

    fn toggle(name: &str, enabled: bool) -> Option<AppliedAction> {
        Some(AppliedAction::SetStartupEntryEnabled { name: name.into(), enabled })
    }

    fn approval(flag: u8) -> std::io::Result<Option<winreg::RegValue>> {
        Ok(Some(winreg::RegValue {
            bytes: vec![flag, 0, 0, 0, 0xAB, 0xCD, 0xEF, 0x12, 0, 0, 0, 0],
            vtype: winreg::enums::RegType::REG_BINARY,
        }))
    }

    fn unreadable() -> std::io::Result<Option<winreg::RegValue>> {
        Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
    }

    #[test]
    fn a_startup_row_reads_on_off_and_unreadable_in_both_directions() {
        use ActiveCheck::*;
        for (enabled, in_place, set_back) in [(false, 0x03, 0x02), (true, 0x02, 0x03)] {
            let action = toggle("App", enabled);
            assert_eq!(startup_row_check("App", action.as_ref(), |_| approval(in_place)), On, "enabled={enabled}");
            assert_eq!(startup_row_check("App", action.as_ref(), |_| approval(set_back)), Off, "enabled={enabled}");
            assert_eq!(startup_row_check("App", action.as_ref(), |_| unreadable()), Unreadable, "enabled={enabled}");
            assert_eq!(startup_row_check("App", action.as_ref(), |_| approval(0x07)), Unreadable, "unknown byte");
            let dword = winreg::RegValue { bytes: vec![0x02, 0, 0, 0], vtype: winreg::enums::RegType::REG_DWORD };
            assert_eq!(startup_row_check("App", action.as_ref(), |_| Ok(Some(dword))), Unreadable, "unknown type");
        }
    }

    #[test]
    fn a_startup_entry_whose_value_is_gone_reads_as_windows_default_enabled() {
        let gone = |_: &str| Ok(None);
        assert_eq!(startup_row_check("App", toggle("App", false).as_ref(), gone), ActiveCheck::Off, "a disable is set back");
        assert_eq!(startup_row_check("App", toggle("App", true).as_ref(), gone), ActiveCheck::On, "an enable is in place");
        // The real read, KEY_READ only, of a value name no machine has.
        let rec = "startup-entry:compy-620-row-probe-absent-entry";
        let name = &rec["startup-entry:".len()..];
        let reads = LiveReads::default();
        assert_eq!(check_row_state(&row(rec, "applied", toggle(name, true)), &reads), ActiveCheck::On);
        assert_eq!(check_row_state(&row(rec, "applied", toggle(name, false)), &reads), ActiveCheck::Off);
    }

    #[test]
    fn a_row_without_a_matching_typed_action_is_unrecognised_and_reads_nothing() {
        let never = |_: &str| -> std::io::Result<Option<winreg::RegValue>> { panic!("must not read") };
        assert_eq!(startup_row_check("App", None, never), ActiveCheck::Unrecognised, "no typed action");
        assert_eq!(startup_row_check("App", toggle("Other", true).as_ref(), never), ActiveCheck::Unrecognised, "name disagrees");
        let other = Some(AppliedAction::DisableGameBarAndDvr);
        assert_eq!(startup_row_check("App", other.as_ref(), never), ActiveCheck::Unrecognised, "another action");
        // The task and service rows read only the task or service their rec id names.
        let task = |t| Some(AppliedAction::DisableScheduledTask { task: t });
        for c in [
            row("bloat-task:ceip-usb", "applied", None),
            row("bloat-task:ceip-usb", "applied", task(KnownBloatTask::CompatibilityAppraiser)),
            row("bloat-task:not-a-task", "applied", task(KnownBloatTask::CeipUsb)),
            row("service-suspend:WSearch", "applied", None),
            row("service-suspend:WSearch", "applied", Some(AppliedAction::SuspendKnownService { service: KnownService::SysMain })),
            row("service-suspend:WSearch", "applied", Some(AppliedAction::DisableKnownService { service: KnownService::WSearch })),
        ] {
            assert_eq!(check_row_state(&c, &LiveReads::default()), ActiveCheck::Unrecognised, "{} {:?}", c.rec_id, c.applied_action);
        }
    }

    #[test]
    fn a_task_or_service_row_reads_on_off_and_unreadable_through_its_own_read() {
        use ActiveCheck::*;
        let task = Some(AppliedAction::DisableScheduledTask { task: KnownBloatTask::CeipUsb });
        for (disabled, want) in [(Some(true), On), (Some(false), Off), (None, Unreadable)] {
            assert_eq!(task_row_check("ceip-usb", task.as_ref(), |_| disabled), want, "disabled={disabled:?}");
        }
        // A suspend is in place while the service is NOT running.
        let svc = Some(AppliedAction::SuspendKnownService { service: KnownService::WSearch });
        for (running, want) in [(Some(false), On), (Some(true), Off), (None, Unreadable)] {
            assert_eq!(service_row_check("WSearch", svc.as_ref(), |_| running), want, "running={running:?}");
        }
        assert_eq!(task_row_check("ceip-usb", None, |_| panic!("must not read")), Unrecognised);
        assert_eq!(service_row_check("SysMain", svc.as_ref(), |_| panic!("must not read")), Unrecognised);
    }

    // CR-stopped-service (2026-11-04): a service DISABLE is in effect when the start type is Disabled.
    // A Manual-start service that happens to be stopped is not Compy's change (the old read, "not
    // running", said On for it); a service WMI has no row for is unreadable, never On.
    #[test]
    fn a_service_disable_reads_the_start_type_not_the_running_state() {
        use ActiveCheck::*;
        let info = |state: &str, mode: &str| Some((state.to_string(), mode.to_string()));
        assert_eq!(disabled_service_check(info("Stopped", "Disabled")), On);
        assert_eq!(disabled_service_check(info("Running", "Disabled")), On, "disabled, not yet stopped: the start type is the change");
        assert_eq!(disabled_service_check(info("Stopped", "Manual")), Off, "idle is not disabled");
        assert_eq!(disabled_service_check(info("Stopped", "Auto")), Off);
        assert_eq!(disabled_service_check(info("Running", "Auto")), Off);
        assert_eq!(disabled_service_check(info("Stopped", "Unknown")), Off, "an unknown start mode is not shown to be Disabled");
        assert_eq!(disabled_service_check(None), Unreadable, "no row: not there, or WMI unread");
    }

    // #620 review: each task row spawned its own PowerShell on the UI thread, so a ledger with four
    // task rows froze History for four spawns. A pass now lists the tasks once for all of them.
    #[test]
    fn a_pass_lists_the_tasks_once_however_many_task_rows_it_reads() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static LISTINGS: AtomicUsize = AtomicUsize::new(0);
        fn listing() -> Option<String> {
            LISTINGS.fetch_add(1, Ordering::SeqCst);
            Some(concat!(
                "\\Microsoft\\Windows\\Customer Experience Improvement Program\\\tUsbCeip\tDisabled\n",
                "\\Microsoft\\Windows\\Customer Experience Improvement Program\\\tConsolidator\tReady\n",
            ).to_string())
        }
        let reads = LiveReads::with_task_listing(listing);
        let task = |t| Some(AppliedAction::DisableScheduledTask { task: t });
        let rows = [
            row("bloat-task:ceip-usb", "applied", task(KnownBloatTask::CeipUsb)),
            row("bloat-task:ceip-usb", "applied", task(KnownBloatTask::CeipUsb)),
            row("bloat-task:ceip-consolidator", "applied", task(KnownBloatTask::CeipConsolidator)),
            row("bloat-task:compatibility-appraiser", "applied", task(KnownBloatTask::CompatibilityAppraiser)),
        ];
        let checks: Vec<ActiveCheck> = rows.iter().map(|c| check_row_state(c, &reads)).collect();
        use ActiveCheck::*;
        assert_eq!(checks, [On, On, Off, Unreadable], "the appraiser is not in the listing, so it reads unknown");
        assert_eq!(LISTINGS.load(Ordering::SeqCst), 1, "one listing for the whole pass");
    }

    #[test]
    fn a_setting_reads_through_its_newest_applied_row() {
        let rec = "startup-entry:compy-620-newest-row-absent-entry";
        let name = &rec["startup-entry:".len()..];
        let changes = [
            row(rec, "applied", toggle(name, false)),
            row(rec, "applied", toggle(name, true)),
            row(rec, "rolled_back", toggle(name, false)),
        ];
        let reads = LiveReads::default();
        assert_eq!(probe_applied_setting(&changes, rec, &reads), ActiveCheck::On, "the newest applied row is the enable");
        assert_eq!(probe_applied_setting(&changes[..1], rec, &reads), ActiveCheck::Off);
        assert_eq!(probe_applied_setting(&changes[2..], rec, &reads), ActiveCheck::Unrecognised, "no applied row: the rec id alone");
    }

    // CR-service-batch: each service-disable read opened its own WMI connection (~100-500 ms), so a
    // pass that read all four paid it four times in series. A pass now reads one batched listing.
    #[test]
    fn a_pass_reads_the_service_listing_once_for_all_four_service_recs() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static SERVICE_LISTINGS: AtomicUsize = AtomicUsize::new(0);
        fn no_tasks() -> Option<String> {
            None
        }
        fn services() -> Option<ServiceListing> {
            SERVICE_LISTINGS.fetch_add(1, Ordering::SeqCst);
            let r = |n: &str, s: &str, m: &str| (n.to_string(), s.to_string(), m.to_string());
            Some(vec![
                r("SysMain", "Stopped", "Disabled"),
                r("DiagTrack", "Stopped", "Manual"),
                r("WSearch", "Running", "Auto"),
            ])
        }
        let reads = LiveReads::with_listings(no_tasks, services);
        let recs = ["sysmain-disable", "nvidia-telemetry", "diagtrack-disable", "windows-search-disable", "sysmain-disable"];
        let checks: Vec<ActiveCheck> = recs.iter().map(|r| probe_rec_target_with(r, &reads)).collect();
        use ActiveCheck::*;
        assert_eq!(checks, [On, Unreadable, Off, Off, On], "no NvTelemetryContainer row reads unknown; idle Manual is not Disabled");
        assert_eq!(SERVICE_LISTINGS.load(Ordering::SeqCst), 1, "one WMI read for the whole pass");
    }

    #[test]
    fn a_failed_service_listing_reads_every_service_rec_unknown() {
        fn no_tasks() -> Option<String> {
            None
        }
        fn failed() -> Option<ServiceListing> {
            None
        }
        let reads = LiveReads::with_listings(no_tasks, failed);
        for name in DISABLE_REC_SERVICES {
            assert_eq!(reads.service_disabled(name), ActiveCheck::Unreadable, "{name}: a failed read is never On");
        }
    }

    #[test]
    fn a_service_row_matches_its_name_without_regard_to_case() {
        let listing: ServiceListing = vec![("sysmain".into(), "Stopped".into(), "Disabled".into())];
        assert_eq!(service_in_listing(Some(&listing), "SysMain"), Some(("Stopped".into(), "Disabled".into())));
        assert_eq!(service_in_listing(Some(&listing), "WSearch"), None, "no row: not there");
        assert_eq!(service_in_listing(None, "SysMain"), None, "a failed listing");
    }

    #[test]
    fn a_service_outside_the_four_never_touches_the_batched_listing() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static TOUCHED: AtomicUsize = AtomicUsize::new(0);
        fn no_tasks() -> Option<String> {
            None
        }
        fn services() -> Option<ServiceListing> {
            TOUCHED.fetch_add(1, Ordering::SeqCst);
            Some(vec![("compy-not-a-service".into(), "Stopped".into(), "Disabled".into())])
        }
        let reads = LiveReads::with_listings(no_tasks, services);
        // A remote rule's own service name keeps its single read; the fake listing would say Disabled.
        assert_ne!(reads.service_disabled("compy-not-a-service"), ActiveCheck::On);
        assert_eq!(TOUCHED.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn the_batched_query_names_exactly_the_four_services_and_three_columns() {
        assert_eq!(
            disable_service_query(),
            "SELECT Name,State,StartMode FROM Win32_Service WHERE Name='SysMain' OR \
             Name='NvTelemetryContainer' OR Name='DiagTrack' OR Name='WSearch'"
        );
    }

    #[test]
    fn every_service_disable_rec_reads_through_the_batched_listing() {
        // Drift guard: if a probe arm's service name leaves DISABLE_REC_SERVICES, that rec silently
        // falls back to its own WMI query and this listing is never asked.
        use std::sync::atomic::{AtomicUsize, Ordering};
        static ASKED: AtomicUsize = AtomicUsize::new(0);
        fn no_tasks() -> Option<String> {
            None
        }
        fn services() -> Option<ServiceListing> {
            ASKED.fetch_add(1, Ordering::SeqCst);
            Some(Vec::new())
        }
        for rec in ["sysmain-disable", "nvidia-telemetry", "diagtrack-disable", "windows-search-disable"] {
            let before = ASKED.load(Ordering::SeqCst);
            let reads = LiveReads::with_listings(no_tasks, services);
            assert_eq!(probe_rec_target_with(rec, &reads), ActiveCheck::Unreadable, "{rec}");
            assert_eq!(ASKED.load(Ordering::SeqCst), before + 1, "{rec} skipped the batched listing");
        }
    }
}

// CR-unconfirmed-remedy: recording a Compy change as changed outside Compy. Fixtures only, shaped
// like the owner's two Ultimate rows (2026-11-10); never the real ledger.
#[cfg(test)]
mod changed_outside_tests {
    use super::*;
    use std::cell::Cell;

    const BALANCED: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
    const SYNEZ: &str = "22222222-2222-2222-2222-222222222222";

    /// A ledger as builds before this change wrote it: no `changed_outside` key anywhere.
    fn old_format_ledger() -> String {
        let row = |id: &str, at: &str| {
            format!(
                r#"{{"id":"{id}","rec_id":"power-ultimate","rec_title":"Switch to the Ultimate Performance power plan","applied_at":"{at}","snapshot":{{"kind":"power-plan","prior_guid":"{BALANCED}"}},"status":"applied","applied_action":{{"kind":"set-ultimate-performance-plan"}},"rollback_action":{{"kind":"restore-power-plan-from-snapshot"}},"app_version_at_apply":"0.9.0","ruleset_version_at_apply":null,"elevation_used":true}}"#
            )
        };
        format!(
            "[{},{}]",
            row("power-ultimate-1780492081786", "2026-06-03T13:08:01.786+00:00"),
            row("power-ultimate-1790398692377", "2026-09-26T03:11:32.377+00:00")
        )
    }

    /// The plan Compy's Ultimate apply activated for the rows below (CR-ultimate-identity).
    const COPY: &str = "3a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

    /// Rows applied after CR-ultimate-identity, which record the plan Compy activated; the rules for
    /// recording such rows are what these tests pin. Rows from before it: `legacy_rows`.
    fn rows() -> Vec<AppliedChange> {
        let mut rows = legacy_rows();
        for c in &mut rows {
            c.applied_plan = Some(AppliedPlan { schema: APPLIED_PLAN_SCHEMA, guid: COPY.into() });
        }
        rows
    }

    fn legacy_rows() -> Vec<AppliedChange> {
        serde_json::from_str(&old_format_ledger()).expect("an old-format ledger parses")
    }

    fn plan(guid: &str, name: &str, class: crate::PowerPlanClass) -> ObservedPlan {
        ObservedPlan { guid: guid.into(), name: name.into(), class }
    }

    fn synez() -> ObservedPlan {
        plan(SYNEZ, "Synez Power Plan", crate::PowerPlanClass::Other)
    }

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("compy-hist-outside-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("history.json")
    }

    #[test]
    fn an_old_format_ledger_loads_unchanged_and_an_unmarked_row_is_written_without_the_key() {
        let path = scratch("old");
        std::fs::write(&path, old_format_ledger()).unwrap();
        let loaded = load_history_from(&path).expect("old ledger loads");
        assert_eq!(loaded.len(), 2);
        assert!(loaded.iter().all(|c| c.changed_outside.is_none() && c.status == "applied"));
        save_history_to(&path, &loaded).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("changed_outside"), "an unmarked row keeps its old shape");
        assert!(text.contains(BALANCED) && text.contains("restore-power-plan-from-snapshot"));
    }

    #[test]
    fn the_synez_shaped_rows_qualify_and_record_with_one_save_and_nothing_else() {
        let mut history = rows();
        let offers = changed_outside_offers_from(&history, Some(&synez()));
        assert_eq!(offers.len(), 1);
        assert_eq!((offers[0].rec_id.as_str(), offers[0].rows, offers[0].observed_name.as_str()), ("power-ultimate", 2, "Synez Power Plan"));

        let before = serde_json::to_value(&history).unwrap();
        let saves = Cell::new(0);
        let n = commit_changed_outside(&mut history, "power-ultimate", Some(&synez()), "2026-11-10T20:00:00+00:00", &|_| {
            saves.set(saves.get() + 1);
            Ok(())
        })
        .expect("records");
        assert_eq!((n, saves.get()), (2, 1), "one ledger save is the only effect");
        for (c, was) in history.iter().zip(before.as_array().unwrap()) {
            // The rollback contract is untouched: status, snapshot, typed actions as applied.
            assert_eq!(c.status, "applied");
            assert_eq!(c.snapshot, was["snapshot"]);
            assert_eq!(serde_json::to_value(&c.rollback_action).unwrap(), was["rollback_action"]);
            assert_eq!(serde_json::to_value(&c.applied_action).unwrap(), was["applied_action"]);
            let mark = c.changed_outside.as_ref().unwrap();
            assert_eq!(mark.recorded_at, "2026-11-10T20:00:00+00:00");
            assert_eq!(mark.observed, ObservedState::PowerPlan { guid: SYNEZ.into(), name: "Synez Power Plan".into() });
        }
        assert!(resolve_rollback(&history[1]).is_ok(), "the undo still resolves from the row");
        assert!(changed_outside_offers_from(&history, Some(&synez())).is_empty(), "nothing left to offer");
    }

    #[test]
    fn readiness_counts_a_recorded_row_still_holding_as_kept_not_drifted_and_nothing_else_moves() {
        // CR-outside-followups (b). Both rows read off (Synez is active, not Ultimate).
        let off = Some(ActiveCheck::Off);
        let mut history = rows();
        let unrecorded = summarize_checked(&history, &[off, off], |_| false);
        assert_eq!((unrecorded.externally_reverted, unrecorded.kept_outside), (1, 0));
        commit_changed_outside(&mut history, "power-ultimate", Some(&synez()), "2026-11-10T20:00:00+00:00", &|_| Ok(()))
            .expect("records");
        let holds = |c: &AppliedChange| recorded_and_holding(c, Some(&synez()));
        let kept = summarize_checked(&history, &[off, off], holds);
        assert_eq!((kept.externally_reverted, kept.kept_outside), (0, 1));
        assert!(kept.drifted_titles.is_empty());
        assert_eq!(kept.kept_outside_titles, ["Switch to the Ultimate Performance power plan"]);
        assert!(kept.kept_outside_plan, "CR-kept-outside-nits (d): the kept one is the plan");
        assert!(!unrecorded.kept_outside_plan);
        // Every count a Trial or a session reads is the same either way.
        let plain = summarize_checked(&history, &[off, off], |_| false);
        assert_eq!(
            (plain.active, plain.cant_confirm, plain.legacy_active, &plain.active_recs, plain.total, plain.rolled_back),
            (kept.active, kept.cant_confirm, kept.legacy_active, &kept.active_recs, kept.total, kept.rolled_back)
        );
        assert_eq!((plain.externally_reverted, plain.kept_outside), (1, 0), "only readiness reads the live plan");
        // The plan switched again (Balanced now): the record no longer holds, so it is a drift again.
        let balanced = plan(BALANCED, "Balanced", crate::PowerPlanClass::Balanced);
        let moved = summarize_checked(&history, &[off, off], |c| recorded_and_holding(c, Some(&balanced)));
        assert_eq!((moved.externally_reverted, moved.kept_outside), (1, 0));
        // An unreadable plan keeps nothing.
        let unread = summarize_checked(&history, &[off, off], |c| recorded_and_holding(c, None));
        assert_eq!((unread.externally_reverted, unread.kept_outside), (1, 0));
    }

    #[test]
    fn the_kept_outside_plan_read_happens_only_with_a_record_and_never_under_gaming_mode() {
        let reads = Cell::new(0);
        let read = || {
            reads.set(reads.get() + 1);
            Some(synez())
        };
        // No record: no plan read at all.
        assert_eq!(kept_outside_observed_with(&rows(), || false, read), None);
        assert_eq!(reads.get(), 0);
        let mut history = rows();
        commit_changed_outside(&mut history, "power-ultimate", Some(&synez()), "2026-11-10T20:00:00+00:00", &|_| Ok(()))
            .expect("records");
        // A Gaming Mode contract on disk: the plan may be Compy's, so nothing is read or kept.
        assert_eq!(kept_outside_observed_with(&history, || true, read), None);
        assert_eq!(reads.get(), 0);
        // Otherwise one read.
        assert_eq!(kept_outside_observed_with(&history, || false, read), Some(synez()));
        assert_eq!(reads.get(), 1);
        // And Game Readiness's roll-up is the one that uses it; nothing else does.
        let src = include_str!("history.rs");
        let body = src.split_once("pub(crate) fn checked_summary(").map(|(_, r)| r).expect("fn");
        let body = &body[..body.find("\n}\n").expect("end")];
        assert!(body.contains("summarize_for_readiness"), "{body}");
        let summarize = src.split_once("pub(crate) fn summarize_history(").map(|(_, r)| r).expect("fn");
        let summarize = &summarize[..summarize.find("\n}\n").expect("end")];
        assert!(!summarize.contains("kept_outside_observed"), "the session/Trial roll-up reads no plan");
    }

    #[test]
    fn an_unreadable_plan_compys_own_plan_and_the_saved_prior_plan_are_all_refused() {
        let ultimate_copy = plan("db9dd473-74ff-4582-ba26-39eaf4cdac4a", "Ultimate Performance", crate::PowerPlanClass::Ultimate);
        let stock_ultimate = plan("e9a42b02-d5df-448d-aa00-03f14749eb61", "", crate::PowerPlanClass::Ultimate);
        let prior = plan(BALANCED, "Balanced", crate::PowerPlanClass::Balanced);
        for (observed, says) in [
            (None, "can't read"),
            (Some(&ultimate_copy), "may still be the one Compy set"),
            (Some(&stock_ultimate), "may still be the one Compy set"),
            (Some(&prior), "undo it instead"),
        ] {
            let mut history = rows();
            let saves = Cell::new(0);
            let why = commit_changed_outside(&mut history, "power-ultimate", observed, "2026-11-10T20:00:00+00:00", &|_| {
                saves.set(saves.get() + 1);
                Ok(())
            })
            .unwrap_err();
            assert!(why.contains(says), "{why}");
            assert_eq!(saves.get(), 0, "nothing written");
            assert!(history.iter().all(|c| c.changed_outside.is_none()));
            assert!(changed_outside_offers_from(&history, observed).is_empty());
        }
    }

    #[test]
    fn only_a_power_plan_change_qualifies() {
        let mut history = rows();
        history[0].rec_id = "game-mode".into();
        history[0].applied_action = Some(AppliedAction::EnableGameMode);
        assert!(changed_outside_refusal(&history[0], Some(&synez())).is_err());
        let offers = changed_outside_offers_from(&history, Some(&synez()));
        assert_eq!(offers.iter().map(|o| o.rec_id.as_str()).collect::<Vec<_>>(), ["power-ultimate"]);
    }

    #[test]
    fn the_record_survives_a_reload_and_a_failed_save_leaves_nothing_recorded() {
        let path = scratch("reload");
        let mut history = rows();
        commit_changed_outside(&mut history, "power-ultimate", Some(&synez()), "2026-11-10T20:00:00+00:00", &|h| save_history_to(&path, h))
            .unwrap();
        let back = load_history_from(&path).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(recorded_outside_state(&back, "power-ultimate"), back[0].changed_outside.as_ref().unwrap().usable());
        assert!(outside_state_holds(recorded_outside_state(&back, "power-ultimate").unwrap(), Some(&synez())));

        let mut fresh = rows();
        let err = commit_changed_outside(&mut fresh, "power-ultimate", Some(&synez()), "2026-11-10T20:00:00+00:00", &|_| Err("disk full".into()));
        assert_eq!(err.unwrap_err(), "disk full");
        assert!(fresh.iter().all(|c| c.changed_outside.is_none()), "put back in memory");
    }

    #[test]
    fn a_record_this_build_cant_read_loads_as_none_and_never_fails_the_ledger() {
        let mut v: serde_json::Value = serde_json::from_str(&old_format_ledger()).unwrap();
        v[0]["changed_outside"] = serde_json::json!({ "schema": 1, "recorded_at": 5 });
        v[1]["changed_outside"] = serde_json::json!({
            "schema": 2, "recorded_at": "2026-11-10T20:00:00Z", "observed": { "kind": "power-plan", "guid": SYNEZ, "name": "x" }
        });
        let path = scratch("lenient");
        std::fs::write(&path, v.to_string()).unwrap();
        let loaded = load_history_from(&path).expect("the ledger still loads");
        assert!(loaded[0].changed_outside.is_none(), "malformed reads as no record");
        assert!(loaded[1].changed_outside.as_ref().unwrap().usable().is_none(), "a later schema is not acted on");
        assert_eq!(recorded_outside_state(&loaded, "power-ultimate"), None, "so the rows keep blocking a Trial");

        let unknown: ChangedOutside = serde_json::from_value(serde_json::json!({
            "schema": 1, "recorded_at": "2026-11-10T20:00:00Z", "observed": { "kind": "something-new" }
        }))
        .unwrap();
        assert!(unknown.usable().is_none());
    }

    #[test]
    fn a_rec_with_one_row_unrecorded_or_records_that_disagree_has_no_recorded_state() {
        let mut history = rows();
        let mark = |guid: &str| ChangedOutside {
            schema: CHANGED_OUTSIDE_SCHEMA,
            recorded_at: "2026-11-10T20:00:00+00:00".into(),
            observed: ObservedState::PowerPlan { guid: guid.into(), name: "p".into() },
            earlier_recorded_at: vec![],
        };
        history[0].changed_outside = Some(mark(SYNEZ));
        assert_eq!(recorded_outside_state(&history, "power-ultimate"), None, "one row still unrecorded");
        history[1].changed_outside = Some(mark("33333333-3333-3333-3333-333333333333"));
        assert_eq!(recorded_outside_state(&history, "power-ultimate"), None, "two different states");
        history[1].changed_outside = Some(mark(SYNEZ));
        assert!(recorded_outside_state(&history, "power-ultimate").is_some());
        assert!(!outside_state_holds(recorded_outside_state(&history, "power-ultimate").unwrap(), None), "unreadable never holds");
        assert_eq!(recorded_outside_state(&history, "game-mode"), None);
    }

    #[test]
    fn a_record_whose_plan_is_no_longer_active_can_be_recorded_anew_but_a_holding_one_cannot() {
        let mut history = rows();
        let ok = |_: &[AppliedChange]| Ok(());
        commit_changed_outside(&mut history, "power-ultimate", Some(&synez()), "2026-11-10T20:00:00+00:00", &ok).unwrap();
        assert!(commit_changed_outside(&mut history, "power-ultimate", Some(&synez()), "2026-11-10T20:01:00+00:00", &ok).is_err());
        let other = plan("33333333-3333-3333-3333-333333333333", "Other Plan", crate::PowerPlanClass::Other);
        assert_eq!(changed_outside_offers_from(&history, Some(&other)).len(), 1, "the user switched plans again");
        commit_changed_outside(&mut history, "power-ultimate", Some(&other), "2026-11-10T21:00:00+00:00", &ok).unwrap();
        let state = recorded_outside_state(&history, "power-ultimate").unwrap();
        assert!(outside_state_holds(state, Some(&other)) && !outside_state_holds(state, Some(&synez())));
        assert_eq!(history[0].changed_outside.as_ref().unwrap().recorded_at, "2026-11-10T21:00:00+00:00");
        // A record in a shape this build can't act on is offered again, never stuck.
        history[1].changed_outside.as_mut().unwrap().schema = 2;
        assert_eq!(changed_outside_offers_from(&history, Some(&other))[0].rows, 1);
        // A re-record whose save fails puts back each row's previous record exactly.
        let before: Vec<Option<ChangedOutside>> = history.iter().map(|c| c.changed_outside.clone()).collect();
        let third = plan("44444444-4444-4444-4444-444444444444", "Third", crate::PowerPlanClass::Other);
        assert!(commit_changed_outside(&mut history, "power-ultimate", Some(&third), "2026-11-10T22:00:00+00:00", &|_| Err("x".into())).is_err());
        assert_eq!(history.iter().map(|c| c.changed_outside.clone()).collect::<Vec<_>>(), before);
        // The same plan printed under another name at another record is still one state.
        history[1].changed_outside = Some(ChangedOutside {
            schema: CHANGED_OUTSIDE_SCHEMA,
            recorded_at: "2026-11-10T21:30:00+00:00".into(),
            observed: ObservedState::PowerPlan { guid: other.guid.to_uppercase(), name: "Renamed".into() },
            earlier_recorded_at: vec![],
        });
        assert!(recorded_outside_state(&history, "power-ultimate").is_some());
    }

    // CR-outside-followups (d): a newer record replaces the older one but keeps its time as a move.
    #[test]
    fn a_record_made_anew_keeps_every_earlier_records_time() {
        let mut history = rows();
        let ok = |_: &[AppliedChange]| Ok(());
        commit_changed_outside(&mut history, "power-ultimate", Some(&synez()), "2026-11-10T20:00:00+00:00", &ok).unwrap();
        assert!(history[0].changed_outside.as_ref().unwrap().earlier_recorded_at.is_empty(), "a first record has none");
        let other = plan("33333333-3333-3333-3333-333333333333", "Other Plan", crate::PowerPlanClass::Other);
        commit_changed_outside(&mut history, "power-ultimate", Some(&other), "2026-11-10T21:00:00+00:00", &ok).unwrap();
        let third = plan("44444444-4444-4444-4444-444444444444", "Third", crate::PowerPlanClass::Other);
        commit_changed_outside(&mut history, "power-ultimate", Some(&third), "2026-11-10T22:00:00+00:00", &ok).unwrap();
        for c in &history {
            let m = c.changed_outside.as_ref().unwrap();
            assert_eq!(m.recorded_at, "2026-11-10T22:00:00+00:00");
            assert_eq!(m.earlier_recorded_at, ["2026-11-10T20:00:00+00:00", "2026-11-10T21:00:00+00:00"]);
        }
        let rows = crate::experiment::ledger_rows(&history);
        let moves: Vec<&str> = rows[0].moved_at().collect();
        for at in ["2026-11-10T20:00:00+00:00", "2026-11-10T21:00:00+00:00", "2026-11-10T22:00:00+00:00"] {
            assert!(moves.contains(&at), "{at} is a move: {moves:?}");
        }
        // A save that fails puts the earlier times back as they were too.
        let before: Vec<Option<ChangedOutside>> = history.iter().map(|c| c.changed_outside.clone()).collect();
        assert!(commit_changed_outside(&mut history, "power-ultimate", Some(&other), "2026-11-10T23:00:00+00:00", &|_| Err("x".into())).is_err());
        assert_eq!(history.iter().map(|c| c.changed_outside.clone()).collect::<Vec<_>>(), before);
    }

    #[test]
    fn a_record_without_earlier_times_keeps_its_old_shape_on_disk() {
        let old = serde_json::json!({
            "schema": 1, "recorded_at": "2026-11-10T20:00:00+00:00",
            "observed": { "kind": "power-plan", "guid": SYNEZ, "name": "Synez Power Plan" }
        });
        let m: ChangedOutside = serde_json::from_value(old.clone()).unwrap();
        assert!(m.earlier_recorded_at.is_empty() && m.usable().is_some());
        assert_eq!(serde_json::to_value(&m).unwrap(), old, "no new key on a record replaced nothing");
        let mut bad = old;
        bad["earlier_recorded_at"] = serde_json::json!("not a list");
        assert!(serde_json::from_value::<ChangedOutside>(bad).is_err(), "unreadable -> no record, which blocks a Trial");
    }

    #[test]
    fn nothing_is_offered_or_recorded_while_a_gaming_mode_contract_is_on_disk() {
        let dir = std::env::temp_dir().join(format!("compy-hist-outside-gm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let _redirect = crate::gaming_session::SessionDirOverride::begin(&dir);
        assert_eq!(gaming_mode_may_hold_plan(), None);
        std::fs::write(dir.join("gaming-session.json"), "{}").unwrap();
        assert!(gaming_mode_may_hold_plan().unwrap().contains("Gaming Mode"));
        // Both commands ask first, before any read of the ledger or the plan. (Checked on the source,
        // so this test never reaches the real ledger.)
        let src = include_str!("history.rs");
        for (cmd, first_read) in [
            ("fn read_changed_outside_offers()", "load_history()"),
            ("pub(crate) fn record_changed_outside(", "crate::current_power_scheme()"),
        ] {
            let body = &src[src.find(cmd).unwrap()..];
            let ask = body.find("gaming_mode_may_hold_plan()").unwrap();
            assert!(ask < body.find(first_read).unwrap() && ask < body.find("\n}").unwrap(), "{cmd}");
        }
    }

    #[test]
    fn the_active_scheme_read_keeps_its_guid_and_name() {
        let seen = crate::power_scheme_of(&format!("Power Scheme GUID: {SYNEZ}  (Synez Power Plan)\r\n")).unwrap();
        assert_eq!(seen, synez());
        assert!(crate::power_scheme_of("no plan here").is_none());
    }

    #[test]
    fn a_pass_reads_the_active_plan_once_for_the_ultimate_row_and_the_kept_outside_check() {
        // CR-kept-plan-read-once: the power-ultimate probe and the kept-outside decision share the
        // pass's one scheme read (each History poll used to spawn a second powercfg).
        use std::sync::atomic::{AtomicUsize, Ordering};
        static READS: AtomicUsize = AtomicUsize::new(0);
        fn fake() -> Option<ObservedPlan> {
            READS.fetch_add(1, Ordering::SeqCst);
            Some(ObservedPlan { guid: SYNEZ.into(), name: "Synez Power Plan".into(), class: crate::PowerPlanClass::Other })
        }
        let reads = LiveReads::default().with_scheme_read(fake);
        let mut history = legacy_rows();
        for c in &mut history {
            c.changed_outside = Some(ChangedOutside {
                schema: CHANGED_OUTSIDE_SCHEMA,
                recorded_at: "2026-11-11T03:00:00+00:00".into(),
                observed: ObservedState::PowerPlan { guid: SYNEZ.into(), name: "Synez Power Plan".into() },
                earlier_recorded_at: vec![],
            });
        }
        assert_eq!(probe_rec_target_with("power-ultimate", &reads), ActiveCheck::Off);
        assert_eq!(probe_rec_target_with("power-ultimate", &reads), ActiveCheck::Off);
        assert_eq!(kept_outside_observed_with(&history, || false, || reads.scheme()), Some(synez()));
        assert_eq!(READS.load(Ordering::SeqCst), 1, "one powercfg for the whole pass");
        // Both production passes hand their own reads to the kept-outside check.
        let src = include_str!("history.rs");
        for f in ["pub(crate) fn applied_change_views(", "fn summarize_for_readiness("] {
            let body = src.split_once(f).map(|(_, r)| r).expect(f);
            let body = &body[..body.find("\n}\n").expect("end")];
            assert!(body.contains("kept_outside_observed(history, &reads)"), "{f}");
        }
    }

    #[test]
    fn the_kept_outside_read_is_dropped_if_gaming_mode_started_while_it_was_taken() {
        // CR-kept-outside-nits (a): Gaming Mode is asked again after the plan read, as
        // record_changed_outside does; a session that started in between keeps nothing.
        let mut history = legacy_rows();
        history[0].changed_outside = Some(ChangedOutside {
            schema: CHANGED_OUTSIDE_SCHEMA,
            recorded_at: "2026-11-11T03:00:00+00:00".into(),
            observed: ObservedState::PowerPlan { guid: SYNEZ.into(), name: "Synez Power Plan".into() },
            earlier_recorded_at: vec![],
        });
        let asks = std::cell::Cell::new(0);
        let gaming_after_first_ask = || {
            asks.set(asks.get() + 1);
            asks.get() > 1
        };
        assert_eq!(kept_outside_observed_with(&history, gaming_after_first_ask, || Some(synez())), None);
        assert_eq!(asks.get(), 2, "asked before and after the read");
    }

    #[test]
    fn the_owners_rows_recorded_before_the_fix_stay_recorded_but_a_new_record_for_them_is_refused() {
        // CR-ultimate-identity, review r2: rows from before Compy recorded the plan its apply activated
        // can't tell Compy's own localized copy of Ultimate from the user's plan, so a NEW record for
        // them needs a stock Windows scheme; a record made earlier is kept as it is.
        let mut history = legacy_rows();
        assert!(changed_outside_offers_from(&history, Some(&synez())).is_empty(), "no offer on Synez now");
        let refused = commit_changed_outside(&mut history, "power-ultimate", Some(&synez()), "2026-11-11T20:00:00+00:00", &|_| {
            panic!("nothing is saved")
        })
        .expect_err("refused");
        assert_eq!(refused, LEGACY_ULTIMATE_REFUSAL);
        assert!(history.iter().all(|c| c.changed_outside.is_none()));
        // High performance is a stock scheme no copy can be: recordable (the prior here is Balanced).
        let high = plan("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", "High performance", crate::PowerPlanClass::HighPerformance);
        assert_eq!(changed_outside_refusal(&history[0], Some(&high)), Ok(()));
        // The owner's ledger: both rows were recorded with Synez before this change. They load as they
        // are, read as kept outside while Synez is active, and a Trial still finds that recorded state.
        for c in &mut history {
            c.changed_outside = Some(ChangedOutside {
                schema: CHANGED_OUTSIDE_SCHEMA,
                recorded_at: "2026-11-11T03:00:00+00:00".into(),
                observed: ObservedState::PowerPlan { guid: SYNEZ.into(), name: "Synez Power Plan".into() },
                earlier_recorded_at: vec![],
            });
        }
        let back: Vec<AppliedChange> = serde_json::from_value(serde_json::to_value(&history).unwrap()).unwrap();
        assert!(back.iter().all(|c| recorded_and_holding(c, Some(&synez())) && c.applied_plan.is_none()));
        assert_eq!(
            recorded_outside_state(&back, "power-ultimate"),
            Some(&ObservedState::PowerPlan { guid: SYNEZ.into(), name: "Synez Power Plan".into() })
        );
        let off = Some(ActiveCheck::Off);
        let kept = summarize_checked(&back, &[off, off], |c| recorded_and_holding(c, Some(&synez())));
        assert_eq!((kept.externally_reverted, kept.kept_outside), (0, 1));
    }
}

// CR-ultimate-identity: on a localized Windows the Ultimate apply duplicates the template under a new
// GUID with a localized name; the row records that GUID so the "changed outside Compy" refusal treats
// it as Compy's plan. Old ledgers load unchanged.
#[cfg(test)]
mod ultimate_identity_tests {
    use super::*;

    const PRIOR: &str = "22222222-2222-2222-2222-222222222222";
    const COPY: &str = "3a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

    fn row(applied_plan: Option<serde_json::Value>) -> AppliedChange {
        let mut v = serde_json::json!({
            "id": "power-ultimate-1", "rec_id": "power-ultimate", "rec_title": "Switch to the Ultimate Performance power plan",
            "applied_at": "2026-11-11T04:00:00+00:00", "status": "applied",
            "snapshot": { "kind": "power-plan", "prior_guid": PRIOR },
            "applied_action": { "kind": "set-ultimate-performance-plan" },
            "rollback_action": { "kind": "restore-power-plan-from-snapshot" }
        });
        if let Some(p) = applied_plan {
            v["applied_plan"] = p;
        }
        serde_json::from_value(v).expect("row")
    }

    fn seen(guid: &str, class: crate::PowerPlanClass) -> ObservedPlan {
        ObservedPlan { guid: guid.into(), name: "卓越性能".into(), class }
    }

    fn result(prior: &str) -> ApplyResult {
        ApplyResult {
            applied_action: AppliedAction::SetUltimatePerformancePlan,
            rollback_action: RollbackAction::RestorePowerPlanFromSnapshot,
            snapshot: Snapshot::PowerPlan { prior_guid: prior.into() },
            elevation_used: true,
        }
    }

    #[test]
    fn the_receipt_records_the_scheme_the_apply_left_active_and_nothing_else() {
        let got = activated_plan_from(&result(PRIOR), || Some(format!("Power Scheme GUID: {}  (卓越性能)", COPY.to_uppercase())));
        assert_eq!(got, Some(AppliedPlan { schema: APPLIED_PLAN_SCHEMA, guid: COPY.into() }));
        // Unread, or still the plan Compy saved: nothing is recorded (never a guess).
        assert_eq!(activated_plan_from(&result(PRIOR), || None), None);
        assert_eq!(activated_plan_from(&result(PRIOR), || Some(format!("GUID: {PRIOR}"))), None);
        // Any other apply records nothing and takes no read.
        let other = ApplyResult { snapshot: Snapshot::ReservedStorage { prior_enabled: true }, ..result(PRIOR) };
        assert_eq!(activated_plan_from(&other, || panic!("no read for another apply")), None);
    }

    #[test]
    fn an_old_ledger_row_loads_unchanged_and_saves_without_the_field() {
        let old = row(None);
        assert!(old.applied_plan.is_none());
        let saved = serde_json::to_value(&old).unwrap();
        assert!(saved.get("applied_plan").is_none(), "a row without it is written as before");
        // A shape this build can't read loads as None, never a failed ledger.
        assert!(row(Some(serde_json::json!("garbage"))).applied_plan.is_none());
        assert!(compys_plan_guid(&row(Some(serde_json::json!({ "schema": 2, "guid": COPY })))).is_none());
        assert!(compys_plan_guid(&row(Some(serde_json::json!({ "schema": 1, "guid": "not-a-guid" })))).is_none());
        let new = row(Some(serde_json::json!({ "schema": 1, "guid": COPY })));
        assert_eq!(compys_plan_guid(&new), Some(COPY));
        let back: AppliedChange = serde_json::from_value(serde_json::to_value(&new).unwrap()).unwrap();
        assert_eq!(back.applied_plan, new.applied_plan);
    }

    #[test]
    fn the_rows_live_check_reads_compys_stamped_localized_copy_as_on() {
        // CR-ultimate-followups (a): the row's live check read by class only, so Compy's own copy with
        // a localized name ("卓越性能", class Other) read "off" on the very row that activated it.
        fn copy_active() -> Option<ObservedPlan> {
            Some(seen(COPY, crate::PowerPlanClass::Other))
        }
        fn users_plan() -> Option<ObservedPlan> {
            Some(seen("44444444-4444-4444-4444-444444444444", crate::PowerPlanClass::Other))
        }
        fn stock_ultimate() -> Option<ObservedPlan> {
            Some(seen("e9a42b02-d5df-448d-aa00-03f14749eb61", crate::PowerPlanClass::Ultimate))
        }
        fn unread() -> Option<ObservedPlan> {
            None
        }
        let reads = |f: fn() -> Option<ObservedPlan>| LiveReads::default().with_scheme_read(f);
        let stamped = row(Some(serde_json::json!({ "schema": 1, "guid": COPY })));
        assert_eq!(check_row_state(&stamped, &reads(copy_active)), ActiveCheck::On);
        assert_eq!(check_row_state(&stamped, &reads(stock_ultimate)), ActiveCheck::On, "an Ultimate plan by class still reads On");
        assert_eq!(check_row_state(&stamped, &reads(users_plan)), ActiveCheck::Off);
        assert_eq!(check_row_state(&stamped, &reads(unread)), ActiveCheck::Unreadable, "unread is never Off");
        // A row without the record reads by class, exactly as before.
        let old = row(None);
        assert_eq!(check_row_state(&old, &reads(copy_active)), ActiveCheck::Off);
        assert_eq!(check_row_state(&old, &reads(stock_ultimate)), ActiveCheck::On);
        assert_eq!(check_row_state(&old, &reads(unread)), ActiveCheck::Unreadable);
    }

    #[test]
    fn compys_own_localized_copy_reads_as_its_plan_and_is_never_recordable_as_set_outside() {
        let new = row(Some(serde_json::json!({ "schema": 1, "guid": COPY })));
        let copy = seen(COPY, crate::PowerPlanClass::Other);
        assert!(is_compys_ultimate(&new, &copy), "the GUID Compy activated is its Ultimate plan");
        assert!(changed_outside_refusal(&new, Some(&copy)).is_err(), "Compy's own plan recorded as external");
        // The user's own plan is still recordable on such a row: the recorded GUID decides.
        let users = seen("44444444-4444-4444-4444-444444444444", crate::PowerPlanClass::Other);
        assert!(!is_compys_ultimate(&new, &users));
        assert_eq!(changed_outside_refusal(&new, Some(&users)), Ok(()));
    }

    #[test]
    fn a_row_from_before_the_fix_is_recordable_only_on_a_stock_windows_scheme() {
        // Review r2 MUST-FIX (opus): a settings comparison read UNKNOWN on a real PC and answered "not
        // a copy" for every plan. Nothing is guessed now: only a scheme no copy can be qualifies.
        let old = row(None);
        let localized_copy = seen(COPY, crate::PowerPlanClass::Other);
        assert_eq!(changed_outside_refusal(&old, Some(&localized_copy)), Err(LEGACY_ULTIMATE_REFUSAL.to_string()));
        let users = seen("44444444-4444-4444-4444-444444444444", crate::PowerPlanClass::Other);
        assert_eq!(changed_outside_refusal(&old, Some(&users)), Err(LEGACY_ULTIMATE_REFUSAL.to_string()), "unknown refuses");
        for stock in STOCK_NON_ULTIMATE_SCHEMES {
            assert_eq!(changed_outside_refusal(&old, Some(&seen(&stock.to_uppercase(), crate::PowerPlanClass::Other))), Ok(()), "{stock}");
        }
        assert!(changed_outside_refusal(&old, Some(&seen(PRIOR, crate::PowerPlanClass::Other))).is_err(), "the prior: undo instead");
    }

    #[test]
    fn a_plan_is_stamped_as_compys_only_by_its_class_or_because_the_apply_made_it() {
        let listed = vec![PRIOR.to_string(), "381b4222-f694-41f0-9685-ff5bb260df2e".to_string()];
        let unread = || None;
        // Not listed before the apply: the apply's own duplicate (any language, any name).
        assert!(is_ultimate_plan(COPY, unread, Some(&listed)), "made by the apply");
        assert!(is_ultimate_plan(COPY, || Some(seen(COPY, crate::PowerPlanClass::Ultimate)), None), "Ultimate by class");
        // A plan that existed before the apply (another program switched to it) is never stamped.
        let other = "44444444-4444-4444-4444-444444444444";
        let with_other = vec![PRIOR.to_string(), other.to_uppercase()];
        assert!(!is_ultimate_plan(other, || Some(seen(other, crate::PowerPlanClass::Other)), Some(&with_other)));
        assert!(!is_ultimate_plan(COPY, unread, None), "an unread list and plan stamp nothing");
        // The list read before the apply runs only for the Ultimate apply.
        assert_eq!(plans_before_ultimate_apply("game-mode"), None);
        // `powercfg /list` output, labels in any language: one GUID per scheme line.
        let list = format!(
            "现有电源使用方案 (* Active)\r\n-----------------------------------\r\n电源方案 GUID: {PRIOR}  (Synez)\r\n\
             电源方案 GUID: {}  (卓越性能) *\r\n",
            COPY.to_uppercase()
        );
        assert_eq!(crate::plan_guids_of(&list), Some(vec![PRIOR.to_string(), COPY.to_string()]));
        assert_eq!(crate::plan_guids_of("no schemes"), None, "unread, never an empty list");
    }

    #[test]
    fn the_receipt_stamps_the_copy_the_apply_made_end_to_end_on_localized_output() {
        // Review r3 (sonnet SHOULD-FIX): the provenance path wired through the receipt builder, on a
        // localized `/getactivescheme` (German labels have no "GUID:"; the read ignores the label).
        let active = format!("GUID des Energieschemas {}  (Ultimative Leistung)\r\n", COPY.to_uppercase());
        let read = || crate::power_scheme_of(&active);
        assert_eq!(read().map(|o| o.guid), Some(COPY.to_string()));
        let listed = vec![PRIOR.to_string()];
        let stamped = build_applied_change_with("power-ultimate", "Ultimate", result(PRIOR), || read().map(|o| o.guid), |g| {
            is_ultimate_plan(g, read, Some(&listed))
        })
        .unwrap();
        assert_eq!(compys_plan_guid(&stamped), Some(COPY), "made by the apply: stamped");
        let already = vec![PRIOR.to_string(), COPY.to_string()];
        let not = build_applied_change_with("power-ultimate", "Ultimate", result(PRIOR), || read().map(|o| o.guid), |g| {
            is_ultimate_plan(g, read, Some(&already))
        })
        .unwrap();
        assert_eq!(not.applied_plan, None, "a plan that was there before, not Ultimate by class: not stamped");
        // And the single apply path reads the list before it dispatches (source pin).
        let src = include_str!("history.rs");
        let body = src.split_once("fn apply_recommendation_inner(").map(|(_, r)| r).expect("inner");
        // Review r4 (opus): bounded to the function, so the hand-off check can fail.
        let body = &body[..body.find("\n}\n").expect("end of fn")];
        let (list, apply) = (body.find("plans_before_ultimate_apply(rec_id)").expect("list"), body.find("dispatch_apply(&root, rec_id)").expect("apply"));
        assert!(list < apply && body[apply..].contains("plans_before, ..Made::new("), "read before, handed to the receipt");
        let commit = src.split_once("fn commit_receipts(").map(|(_, r)| r).expect("commit");
        assert!(commit[..commit.find("\n}\n").unwrap()].contains("m.plans_before.as_deref()"), "the builder gets the list");
    }

    #[test]
    fn a_copy_compy_made_for_another_row_is_never_recorded_as_set_outside() {
        // Review r3 (opus SHOULD-FIX 1): apply A (copy C1), undo A, apply B (copy C2), the user picks C1.
        let mut a = row(Some(serde_json::json!({ "schema": 1, "guid": COPY })));
        a.status = "rolled_back".into();
        let c2 = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
        let mut b = row(Some(serde_json::json!({ "schema": 1, "guid": c2 })));
        b.id = "power-ultimate-2".into();
        let mut history = vec![a, b];
        let c1 = seen(COPY, crate::PowerPlanClass::Other);
        assert_eq!(changed_outside_refusal(&history[1], Some(&c1)), Ok(()), "row B alone can't tell");
        assert!(changed_outside_offers_from(&history, Some(&c1)).is_empty(), "no offer");
        let refused = commit_changed_outside(&mut history, "power-ultimate", Some(&c1), "2026-11-11T20:00:00+00:00", &|_| panic!("no save"));
        assert_eq!(refused, Err(COMPYS_OTHER_COPY_REFUSAL.to_string()));
        // The user's own plan is still recordable.
        let users = seen("44444444-4444-4444-4444-444444444444", crate::PowerPlanClass::Other);
        assert_eq!(changed_outside_offers_from(&history, Some(&users)).len(), 1);
    }

    #[test]
    fn a_receipt_read_that_hangs_counts_as_unread() {
        // Review r2 (sonnet): the receipt reads run under the ledger lock, so they are bounded.
        assert_eq!(bounded_read(|| Some(7)), Some(7));
        assert_eq!(bounded_read::<u8>(|| None), None);
        // CR-ultimate-followups (e): the hang is injected against a short bound (was a 7 s sleep).
        let limit = std::time::Duration::from_millis(100);
        let started = std::time::Instant::now();
        assert_eq!(
            bounded_read_within(limit, move || {
                // Two minutes against a 100 ms bound: the margin below can't be eaten by a loaded PC.
                std::thread::sleep(limit * 1200);
                Some(1)
            }),
            None
        );
        assert!(started.elapsed() < limit * 600, "returned at the bound, not when the read finished");
        // And the production read uses the 5 s receipt bound.
        let body = include_str!("history.rs").split_once("fn bounded_read<T").map(|(_, r)| r).expect("fn");
        let body = body.split_once("\n}\n").map(|(b, _)| b).expect("body");
        assert!(body.contains("bounded_read_within(RECEIPT_READ_TIMEOUT, read)"), "{body}");
        assert_eq!(RECEIPT_READ_TIMEOUT, std::time::Duration::from_secs(5));
    }

    #[test]
    fn the_receipt_of_an_ultimate_apply_carries_the_scheme_it_activated() {
        let got = build_applied_change_with("power-ultimate", "Ultimate", result(PRIOR), || Some(COPY.to_uppercase()), |g| g == COPY).unwrap();
        assert_eq!(compys_plan_guid(&got), Some(COPY));
        let not = build_applied_change_with("power-ultimate", "Ultimate", result(PRIOR), || Some(COPY.into()), |_| false).unwrap();
        assert_eq!(not.applied_plan, None, "a plan that isn't Ultimate is never stamped");
        // The rollback contract is the apply's own, untouched.
        assert!(matches!(got.rollback_action, Some(RollbackAction::RestorePowerPlanFromSnapshot)));
        assert_eq!(got.snapshot, serde_json::json!({ "kind": "power-plan", "prior_guid": PRIOR }));
    }
}
