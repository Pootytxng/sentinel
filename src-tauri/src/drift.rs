//! Drift Watch (Wave-2): notices readiness checks that WERE good and have since regressed — e.g. a
//! power plan reverted by Windows Update — and surfaces them as a quiet, honest heads-up. Honest-copy
//! rule: name WHAT drifted and WHEN we noticed; NEVER speculate WHO — not even "outside Compy." A
//! regression can be self-inflicted (rolling back the Ultimate power plan in the Trust Ledger drops
//! the "power-profile" check back to Attention), and drift has no vantage point to tell that from a
//! Windows Update revert, so any WHO-claim is sometimes false. Read-only; the fix routes through the
//! existing apply / deep-link flow, nothing new here.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Persisted across launches: which checks were last seen "good", and when each current drift was
/// first noticed (so the timestamp is stable — it isn't reset on every scan).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub(crate) struct DriftState {
    last_good: HashMap<String, bool>,
    noticed_at: HashMap<String, String>,
    /// Intelligence Phase 2 (additive): the label each active drift carried when noticed, so the
    /// timeline can name it without re-running checks. Cleared when the drift clears.
    #[serde(default)]
    labels: HashMap<String, String>,
    /// Intelligence Phase 2 (additive): when each check was last seen "ready" — the honest earlier
    /// bound of a regression window ("was ready at X, noticed regressed at Y"). Updated on every
    /// ready scan; state files from before this field simply have no earlier bound.
    #[serde(default)]
    last_ready_seen: HashMap<String, String>,
    /// n1-drift (additive): the check's own short value (e.g. "144 Hz") at its last ready scan, so
    /// a drift can say what Compy last recorded. A ready scan that carried no value removes it
    /// (never stale); a state file from before this field simply has none, and the UI says so.
    #[serde(default)]
    last_ready_value: HashMap<String, String>,
}

#[cfg(test)]
impl DriftState {
    /// True when any part of this state still mentions the check (tests only).
    pub(crate) fn has_record_for(&self, id: &str) -> bool {
        self.last_good.contains_key(id)
            || self.noticed_at.contains_key(id)
            || self.labels.contains_key(id)
            || self.last_ready_seen.contains_key(id)
            || self.last_ready_value.contains_key(id)
    }
}

/// What one scan read for a check beyond its status (n1-drift): its short current value, and, for
/// the applied-changes row only, the titles of the changes now off. Side input to `detect_seen`.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Seen {
    pub value: Option<String>,
    pub titles: Vec<String>,
    /// When each of `titles` was applied, from the ledger's own per-change stamp (same order).
    pub applied_at: Vec<String>,
}

/// Checks that reach Attention by time passing alone, with nothing on the PC changing (a driver
/// getting older): never a drift. `detect_seen` skips them and drops any record an earlier build
/// kept for them, so an old notice does not linger.
const TIME_ONLY_CHECKS: &[&str] = &["gpu-driver-age"];

/// One scan's observation of a check: `(id, label, status, detail)`.
pub(crate) type Observation = (String, String, String, String);
/// What each scan read beyond status, keyed by check id (see [`Seen`]).
pub(crate) type SeenMap = HashMap<String, Seen>;

/// A surfaced regression: a check that was good and now needs attention.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Drift {
    pub id: String,
    pub label: String,
    pub detail: String,
    pub noticed_at: String,
    /// CR-1102-left owner call (delegated 2026-11-10): the check that drifted now reads unknown. The
    /// notice stays (it was last seen changed) and says Compy can't read the check now; `detail` is
    /// then the unknown check's own detail, never the old regression's.
    pub unreadable_now: bool,
    /// n1-drift: what the check reads now as a short value; None when it can't be read now or the
    /// check has no short value. Never inferred from `detail`.
    pub value_now: Option<String>,
    /// n1-drift: when the check was last seen ready (None for a state file from before that stamp).
    pub last_ready_at: Option<String>,
    /// n1-drift: the short value it had at that last ready scan (None when not recorded).
    pub last_ready_value: Option<String>,
    /// n1-drift: the applied changes now off, by title (the applied-changes row only; empty else).
    pub titles: Vec<String>,
    /// n1-drift: when each of `titles` was applied, from the ledger's own per-change stamp (same
    /// order). Never `last_ready_at`, which is a scan time for the whole row.
    pub applied_at: Vec<String>,
}

// #283 — serialized so two concurrent readiness scans can't interleave load → detect → save.
// `get_game_readiness` is a plain `#[tauri::command]`, so two overlapping scans run on two pool
// threads; without this the later save writes state folded from a stale read, and a `noticed_at`
// stamp — which the whole point of this module is to keep STABLE — can be reset or dropped.
//
// `detect` is pure, and nothing inside the locked section acquires another store's lock or calls
// out of this module at all, so this adds no ordering constraint anywhere. Callers hold no lock when
// they reach here. `scripts/store-lock-order-guard.test.mjs` is what keeps that true.
static DRIFT_LOCK: Mutex<()> = Mutex::new(());

/// Acquire, recovering from poison and CLEARING it. Same reasoning as `comparison::lock_comparison`
/// — see there for why recovery is safe rather than merely convenient. Recovering without clearing
/// (what this did before PR #395's review) leaves the lock permanently poisoned for anyone who ever
/// decides to propagate instead.
fn lock_drift() -> crate::race_seam::StoreGuard {
    // #398 — see `comparison::lock_comparison`. Recorded before the block, so a re-entrant or
    // undeclared nesting panics by name rather than hanging. No-op in a release build.
    crate::race_seam::hold_lock(crate::race_seam::StoreLock::Drift, || {
        DRIFT_LOCK.lock().unwrap_or_else(|poisoned| {
            DRIFT_LOCK.clear_poison();
            poisoned.into_inner()
        })
    })
}

fn state_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("drift.json")
}

fn load_state() -> DriftState {
    load_state_from(&state_path())
}

/// Unchanged policy, lifted to a path so it can be proven without the real data root: missing or
/// corrupt both mean "no prior state", never an error.
fn load_state_from(path: &std::path::Path) -> DriftState {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Deliberately best-effort and returning nothing, unchanged: drift is a convenience, and a failed
/// save must never surface as an error to the user. What DID change is that a failure now leaves the
/// previous state file whole instead of a truncated one.
///
/// The directory is still created only AFTER serialization succeeds, exactly as before — a state
/// that cannot be serialized must not leave a folder behind as its only trace.
fn save_state_to(path: &std::path::Path, s: &DriftState) {
    if let Ok(json) = crate::atomic_write::serialize_pretty(s) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = crate::atomic_write::write_atomic(path, json.as_bytes());
    }
}

/// Pure core: fold current check observations `(id, label, status, detail)` into the prior state,
/// returning the active drifts + updated state. Ready → records/keeps `last_good` and clears any
/// drift; Attention while previously good → a regression, stamping `noticed_at` once (stable).
#[cfg(test)]
fn detect(
    checks: &[(String, String, String, String)],
    prior: &DriftState,
    now: &str,
) -> (Vec<Drift>, DriftState) {
    detect_seen(checks, &HashMap::new(), prior, now)
}

/// `detect` plus what each scan read beyond status (`seen`, keyed by check id; absent = nothing read).
pub(crate) fn detect_seen(
    checks: &[(String, String, String, String)],
    seen: &HashMap<String, Seen>,
    prior: &DriftState,
    now: &str,
) -> (Vec<Drift>, DriftState) {
    let mut state = prior.clone();
    let mut drifts = Vec::new();
    for (id, label, status, detail) in checks {
        if TIME_ONLY_CHECKS.contains(&id.as_str()) {
            state.last_good.remove(id);
            state.noticed_at.remove(id);
            state.labels.remove(id);
            state.last_ready_seen.remove(id);
            state.last_ready_value.remove(id);
            continue;
        }
        let read = seen.get(id).cloned().unwrap_or_default();
        match status.as_str() {
            "ready" => {
                state.last_good.insert(id.clone(), true);
                state.noticed_at.remove(id);
                state.labels.remove(id);
                state.last_ready_seen.insert(id.clone(), now.to_string());
                match read.value {
                    Some(v) => {
                        state.last_ready_value.insert(id.clone(), v);
                    }
                    None => {
                        state.last_ready_value.remove(id);
                    }
                }
            }
            // Attention while the check was previously good = a regression (a drift).
            "attention" if state.last_good.get(id).copied().unwrap_or(false) => {
                let noticed = state
                    .noticed_at
                    .entry(id.clone())
                    .or_insert_with(|| now.to_string())
                    .clone();
                state.labels.insert(id.clone(), label.clone());
                drifts.push(Drift {
                    id: id.clone(),
                    label: label.clone(),
                    detail: detail.clone(),
                    noticed_at: noticed,
                    unreadable_now: false,
                    value_now: read.value.clone(),
                    last_ready_at: state.last_ready_seen.get(id).cloned(),
                    last_ready_value: state.last_ready_value.get(id).cloned(),
                    titles: read.titles.clone(),
                    applied_at: read.applied_at.clone(),
                });
            }
            // An active drift whose check now reads unknown: still a notice (last seen changed), with
            // its first stamp and label, said as unreadable now. Nothing in the state changes, so a
            // later ready still clears it and a later attention keeps the original stamp.
            "unknown" if state.noticed_at.contains_key(id) => {
                drifts.push(Drift {
                    id: id.clone(),
                    label: state.labels.get(id).cloned().unwrap_or_else(|| label.clone()),
                    detail: detail.clone(),
                    noticed_at: state.noticed_at[id].clone(),
                    unreadable_now: true,
                    // Couldn't read it now: no current value is claimed, and no titles.
                    value_now: None,
                    last_ready_at: state.last_ready_seen.get(id).cloned(),
                    last_ready_value: state.last_ready_value.get(id).cloned(),
                    titles: Vec::new(),
                    applied_at: Vec::new(),
                });
            }
            // advisory / unknown with no active drift / attention-that-was-never-good → not a regression.
            _ => {}
        }
    }
    (drifts, state)
}

/// Load → detect → persist. Returns the active drifts for the UI.
pub(crate) fn detect_and_persist(
    checks: &[(String, String, String, String)],
    seen: &HashMap<String, Seen>,
) -> Vec<Drift> {
    // Best-effort like everything else in this module: a poisoned lock means some other thread
    // panicked mid-update, and drift is a convenience that must never become an error the user has
    // to answer. Recovering the guard keeps the sequence serialized rather than silently
    // un-serializing it, which is the failure this lock exists to prevent.
    detect_and_persist_at(&state_path(), checks, seen, &chrono::Utc::now().to_rfc3339())
}

/// The whole read-modify-write, lifted to a path so the #283 lock can be PROVEN against a scratch
/// file instead of the real data root — and so the test exercises the same critical section the
/// caller does, rather than a lookalike.
fn detect_and_persist_at(
    path: &std::path::Path,
    checks: &[(String, String, String, String)],
    seen: &HashMap<String, Seen>,
    now: &str,
) -> Vec<Drift> {
    let _lock = lock_drift();
    let prior = load_state_from(path);
    crate::race_seam::hold(); // no-op in a release build; see race_seam
    let (drifts, new_state) = detect_seen(checks, seen, &prior, now);
    save_state_to(path, &new_state);
    drifts
}

/// A persisted drift notice for the intelligence timeline. Same honest-copy rule as the module:
/// WHAT drifted and WHEN it was noticed — never WHO changed it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DriftNotice {
    pub id: String,
    pub label: String,
    /// When the check was last seen ready — the earlier bound of the regression window.
    /// `None` for state persisted before that stamp existed (never guessed).
    pub last_ready_at: Option<String>,
    pub noticed_at: String,
}

/// Pure mapping from persisted state → notices, sorted by id (HashMap order is not stable).
/// Labels were captured at notice time; a pre-label state file falls back to the check id.
fn notices_from(s: &DriftState) -> Vec<DriftNotice> {
    let mut v: Vec<DriftNotice> = s
        .noticed_at
        .iter()
        .map(|(id, at)| DriftNotice {
            id: id.clone(),
            label: s.labels.get(id).cloned().unwrap_or_else(|| id.replace('-', " ")),
            last_ready_at: s.last_ready_seen.get(id).cloned(),
            noticed_at: at.clone(),
        })
        .collect();
    v.sort_by(|a, b| a.id.cmp(&b.id));
    v
}

/// Read-only accessor for the intelligence timeline: the currently-active drift notices from
/// disk state alone. Never runs checks (a timeline fetch must not probe the machine).
pub(crate) fn active_drift_notices() -> Vec<DriftNotice> {
    notices_from(&load_state())
}

/// PC Paramedic: the active drift notices from a state file, READ-ONLY and strict. An absent file is no
/// notices; one that is there and cannot be read or parsed is an error, not "nothing drifted".
pub(crate) fn read_notices_readonly_from(path: &std::path::Path) -> Result<Vec<DriftNotice>, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    serde_json::from_str::<DriftState>(&raw).map(|s| notices_from(&s)).map_err(|e| e.to_string())
}

/// Runs `f` with every writer of drift.json held off: the clear's delete (D6). Takes this
/// module's one lock and nothing else; `f` must not take another store's lock.
pub(crate) fn with_store_locked<R>(f: impl FnOnce() -> R) -> R {
    let _lock = lock_drift();
    f()
}

/// #281 — drift's best-effort save still swallows every failure and still returns nothing. Explicit
/// temp paths only; nothing reads the real data root.
#[cfg(test)]
mod drift_persistence_tests {
    use super::*;

    fn scratch(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "compy-drift-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn state(id: &str) -> DriftState {
        let mut s = DriftState::default();
        s.last_good.insert(id.into(), true);
        s.noticed_at.insert(id.into(), "T0".into());
        s
    }

    #[test]
    fn missing_and_corrupt_both_read_as_no_prior_state_never_an_error() {
        let dir = scratch("empty");
        assert!(load_state_from(&dir.join("absent.json")).last_good.is_empty());

        let p = dir.join("drift.json");
        std::fs::write(&p, "{\"last_good\": {\"power-pro").unwrap();
        assert!(
            load_state_from(&p).last_good.is_empty(),
            "a truncated drift file must read as no prior state"
        );
    }

    #[test]
    fn state_round_trips_and_replaces_the_previous_file_whole() {
        let p = scratch("round").join("drift.json");
        save_state_to(&p, &state("power-profile-and-a-much-longer-id"));
        save_state_to(&p, &state("gpu"));
        let got = load_state_from(&p);
        assert_eq!(got.last_good.len(), 1);
        assert_eq!(got.last_good.get("gpu"), Some(&true));
    }

    #[test]
    fn save_swallows_a_failure_returning_nothing_and_leaving_the_previous_state() {
        // Drift is a convenience: an unwritable state file must never become an error the user has
        // to answer. What this lane changes is only that the previous file survives intact.
        let p = scratch("failed").join("drift.json");
        save_state_to(&p, &state("keep-me"));

        // `save_state_to` returns nothing, so the proof is behavioural: with the write interrupted,
        // the call is silent AND the previous state is still readable.
        crate::atomic_write::force_next_failure(crate::atomic_write::FailPoint::BeforeRename);
        save_state_to(&p, &state("clobber"));
        assert_eq!(
            load_state_from(&p).last_good.get("keep-me"),
            Some(&true),
            "the interrupted save reached the file — it is not going through the atomic path"
        );
        assert!(!load_state_from(&p).last_good.contains_key("clobber"));
    }

    #[test]
    fn a_serialization_failure_is_silent_and_touches_neither_target_nor_temp() {
        let dir = scratch("serialize-failed");
        let p = dir.join("drift.json");
        save_state_to(&p, &state("keep-me"));
        crate::atomic_write::force_next_serialization_failure();
        save_state_to(&p, &state("clobber"));
        assert_eq!(load_state_from(&p).last_good.get("keep-me"), Some(&true));
        assert!(!load_state_from(&p).last_good.contains_key("clobber"));
        assert!(
            std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")),
            "serialization reached the atomic writer"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_share_lock_is_silent_and_preserves_the_old_drift_state() {
        let p = scratch("locked").join("drift.json");
        save_state_to(&p, &state("keep-me"));
        let held = crate::atomic_write::hold_without_share(&p);
        save_state_to(&p, &state("clobber"));
        drop(held);
        assert_eq!(load_state_from(&p).last_good.get("keep-me"), Some(&true));
        assert!(!load_state_from(&p).last_good.contains_key("clobber"));
    }

    #[test]
    fn saving_into_an_unwritable_location_is_silent_and_leaves_no_file() {
        // A path whose parent is an existing FILE cannot be created or written; the call must still
        // return `()` without panicking.
        let dir = scratch("blocked");
        let blocker = dir.join("not-a-dir");
        std::fs::write(&blocker, "x").unwrap();
        save_state_to(&blocker.join("drift.json"), &state("anything"));
        assert!(blocker.is_file(), "the blocking file was replaced");
    }
}

#[cfg(test)]
mod drift_tests {
    use super::*;

    fn obs(id: &str, status: &str) -> (String, String, String, String) {
        (id.into(), format!("{id} label"), status.into(), "detail".into())
    }

    #[test]
    fn flags_regression_from_good_to_attention_with_stable_timestamp() {
        // Ready first → establishes last_good, no drift.
        let (d0, s0) = detect(&[obs("power-profile", "ready")], &DriftState::default(), "T0");
        assert!(d0.is_empty());
        // Regresses to Attention → a drift, noticed at T1.
        let (d1, s1) = detect(&[obs("power-profile", "attention")], &s0, "T1");
        assert_eq!(d1.len(), 1);
        assert_eq!(d1[0].noticed_at, "T1");
        // Still drifting on a later scan → SAME noticed_at (stable, not reset to T2).
        let (d2, _s2) = detect(&[obs("power-profile", "attention")], &s1, "T2");
        assert_eq!(d2[0].noticed_at, "T1");
    }

    #[test]
    fn never_was_good_is_not_a_drift() {
        // Attention from the start (never Ready) → a standing issue, not a regression.
        let (d, _s) = detect(&[obs("hdr", "attention")], &DriftState::default(), "T0");
        assert!(d.is_empty());
    }

    #[test]
    fn returning_to_ready_clears_the_drift() {
        let (_d0, s0) = detect(&[obs("power-profile", "ready")], &DriftState::default(), "T0");
        let (d1, s1) = detect(&[obs("power-profile", "attention")], &s0, "T1");
        assert_eq!(d1.len(), 1);
        let (d2, _s2) = detect(&[obs("power-profile", "ready")], &s1, "T2");
        assert!(d2.is_empty(), "back to Ready clears the drift");
    }

    #[test]
    fn multiple_checks_regress_at_once_emit_multiple_drifts() {
        // Two checks established good first.
        let (_d0, s0) = detect(
            &[obs("power-profile", "ready"), obs("vrr", "ready")],
            &DriftState::default(),
            "T0",
        );
        // Both regress on the same scan → two drifts, both stamped now.
        let (d1, _s1) = detect(
            &[obs("power-profile", "attention"), obs("vrr", "attention")],
            &s0,
            "T1",
        );
        assert_eq!(d1.len(), 2);
        let ids: std::collections::HashSet<&str> = d1.iter().map(|d| d.id.as_str()).collect();
        assert!(ids.contains("power-profile"));
        assert!(ids.contains("vrr"));
        assert!(d1.iter().all(|d| d.noticed_at == "T1"));
    }

    #[test]
    fn noticed_at_is_stable_when_feeding_returned_state_back_in() {
        // Establish good, then regress at T1.
        let (_d0, s0) = detect(&[obs("power-profile", "ready")], &DriftState::default(), "T0");
        let (d1, s1) = detect(&[obs("power-profile", "attention")], &s0, "T1");
        assert_eq!(d1[0].noticed_at, "T1");
        // Feed the FIRST call's returned state as prior to the second; still Attention → SAME stamp.
        let (d2, s2) = detect(&[obs("power-profile", "attention")], &s1, "T2");
        assert_eq!(d2[0].noticed_at, "T1", "idempotent timestamp across detect calls");
        // And once more, again feeding state forward — still T1.
        let (d3, _s3) = detect(&[obs("power-profile", "attention")], &s2, "T3");
        assert_eq!(d3[0].noticed_at, "T1");
    }

    #[test]
    fn re_regression_after_clearing_gets_a_fresh_timestamp() {
        // good → attention (T1) → ready clears (T2) → attention again (T3) → NEW stamp, not T1.
        let (_d0, s0) = detect(&[obs("power-profile", "ready")], &DriftState::default(), "T0");
        let (d1, s1) = detect(&[obs("power-profile", "attention")], &s0, "T1");
        assert_eq!(d1[0].noticed_at, "T1");
        let (d2, s2) = detect(&[obs("power-profile", "ready")], &s1, "T2");
        assert!(d2.is_empty(), "ready clears");
        let (d3, _s3) = detect(&[obs("power-profile", "attention")], &s2, "T3");
        assert_eq!(d3.len(), 1);
        assert_eq!(
            d3[0].noticed_at, "T3",
            "clearing removed the old noticed_at; the new regression stamps fresh"
        );
    }

    #[test]
    fn unknown_status_does_not_drift_and_leaves_state_unchanged() {
        // Was good first.
        let (_d0, s0) = detect(&[obs("power-profile", "ready")], &DriftState::default(), "T0");
        // An unrecognized status (neither ready nor attention) → no drift, no panic.
        let (d1, s1) = detect(&[obs("power-profile", "advisory")], &s0, "T1");
        assert!(d1.is_empty(), "advisory/unknown is never a drift");
        // FINDING: an unknown status is a pure no-op for that id — last_good is NOT touched, so
        // last_good stays true and noticed_at is unchanged from the prior state.
        assert_eq!(s1.last_good.get("power-profile").copied(), Some(true));
        assert!(s1.noticed_at.is_empty());
        // A subsequent attention scan therefore still drifts (good was never cleared).
        let (d2, _s2) = detect(&[obs("power-profile", "attention")], &s1, "T2");
        assert_eq!(d2.len(), 1);
        assert_eq!(d2[0].noticed_at, "T2");
    }

    #[test]
    fn unknown_status_clears_nothing_so_an_active_drift_persists_silently() {
        // FINDING: while a drift is active, an unknown status does NOT clear it from state, but the
        // drift is also not re-emitted on that scan (only "attention" pushes a Drift). It only
        // reappears when the next "attention" scan arrives — with its ORIGINAL noticed_at intact.
        let (_d0, s0) = detect(&[obs("power-profile", "ready")], &DriftState::default(), "T0");
        let (d1, s1) = detect(&[obs("power-profile", "attention")], &s0, "T1");
        assert_eq!(d1[0].noticed_at, "T1");
        let (d2, s2) = detect(&[obs("power-profile", "advisory")], &s1, "T2");
        assert!(d2.is_empty(), "unknown status emits no drift this scan");
        assert_eq!(
            s2.noticed_at.get("power-profile").map(String::as_str),
            Some("T1"),
            "but the noticed_at was preserved, not cleared"
        );
        let (d3, _s3) = detect(&[obs("power-profile", "attention")], &s2, "T3");
        assert_eq!(d3[0].noticed_at, "T1", "original stamp survives the unknown-status gap");
    }

    #[test]
    fn an_active_drift_whose_check_now_reads_unknown_stays_said_as_unreadable_now() {
        // CR-1102-left owner call (delegated 2026-11-10): keep the notice, worded "last seen changed;
        // Compy can't read it now". Before, the unknown scan emitted nothing and the notice vanished.
        let (_d0, s0) = detect(&[obs("power-profile", "ready")], &DriftState::default(), "T0");
        let (d1, s1) = detect(&[obs("power-profile", "attention")], &s0, "T1");
        assert!(!d1[0].unreadable_now);
        let (d2, s2) = detect(&[obs("power-profile", "unknown")], &s1, "T2");
        assert_eq!(d2.len(), 1, "the notice stays while the check can't be read");
        assert!(d2[0].unreadable_now);
        assert_eq!(d2[0].noticed_at, "T1", "with the stamp of when it was noticed");
        assert_eq!(s2.noticed_at, s1.noticed_at, "the unknown scan changes no state");
        assert_eq!(s2.last_good, s1.last_good);
        // A later ready clears it; a later attention keeps the original stamp and reads normally.
        let (d3, _) = detect(&[obs("power-profile", "ready")], &s2, "T3");
        assert!(d3.is_empty());
        let (d4, _) = detect(&[obs("power-profile", "attention")], &s2, "T4");
        assert_eq!((d4[0].noticed_at.as_str(), d4[0].unreadable_now), ("T1", false));
        // An unknown check that never drifted is still no notice.
        let (d5, _) = detect(&[obs("power-profile", "unknown")], &s0, "T5");
        assert!(d5.is_empty());
    }

    #[test]
    fn empty_checks_yield_no_drifts_and_clean_state() {
        let (d, s) = detect(&[], &DriftState::default(), "T0");
        assert!(d.is_empty());
        assert!(s.last_good.is_empty());
        assert!(s.noticed_at.is_empty());
    }

    #[test]
    fn empty_checks_preserve_prior_state_verbatim() {
        // With a populated prior, an empty scan returns no drifts but carries prior state forward.
        let (_d0, s0) = detect(&[obs("power-profile", "ready")], &DriftState::default(), "T0");
        let (_d1, s1) = detect(&[obs("power-profile", "attention")], &s0, "T1");
        let (d2, s2) = detect(&[], &s1, "T2");
        assert!(d2.is_empty(), "no checks → no drifts");
        assert_eq!(s2.last_good.get("power-profile").copied(), Some(true));
        assert_eq!(s2.noticed_at.get("power-profile").map(String::as_str), Some("T1"));
    }

    #[test]
    fn notices_carry_label_and_ready_bound_and_clear_on_ready() {
        // ready at T0 → last_ready_seen stamped; no notices yet.
        let (_d0, s0) = detect(&[obs("power-profile", "ready")], &DriftState::default(), "T0");
        assert!(notices_from(&s0).is_empty());
        // attention at T1 → one notice with the captured label and the T0 ready bound.
        let (_d1, s1) = detect(&[obs("power-profile", "attention")], &s0, "T1");
        let n = notices_from(&s1);
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].id, "power-profile");
        assert_eq!(n[0].label, "power-profile label");
        assert_eq!(n[0].last_ready_at.as_deref(), Some("T0"));
        assert_eq!(n[0].noticed_at, "T1");
        // back to ready at T2 → notice gone, label cleared, ready bound refreshed.
        let (_d2, s2) = detect(&[obs("power-profile", "ready")], &s1, "T2");
        assert!(notices_from(&s2).is_empty());
        assert!(s2.labels.is_empty());
        assert_eq!(s2.last_ready_seen.get("power-profile").map(String::as_str), Some("T2"));
    }

    #[test]
    fn notices_from_pre_phase2_state_fall_back_honestly() {
        // A drift.json written before labels/last_ready_seen existed: noticed_at only.
        let mut s = DriftState::default();
        s.noticed_at.insert("power-profile".into(), "T1".into());
        let n = notices_from(&s);
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].label, "power profile", "label falls back to the id, dashes spaced");
        assert_eq!(n[0].last_ready_at, None, "no earlier bound is ever invented");
        assert_eq!(n[0].noticed_at, "T1");
    }

    #[test]
    fn notices_are_sorted_by_id_for_determinism() {
        let (_d0, s0) = detect(
            &[obs("vrr", "ready"), obs("power-profile", "ready")],
            &DriftState::default(),
            "T0",
        );
        let (_d1, s1) = detect(
            &[obs("vrr", "attention"), obs("power-profile", "attention")],
            &s0,
            "T1",
        );
        let ids: Vec<String> = notices_from(&s1).into_iter().map(|n| n.id).collect();
        assert_eq!(ids, vec!["power-profile", "vrr"]);
    }

    #[test]
    fn drift_carries_label_and_detail_from_the_observation() {
        // Establish good with a distinct label/detail, then regress.
        let good = ("vrr".to_string(), "VRR enabled".to_string(), "ready".to_string(), "ok".to_string());
        let (_d0, s0) = detect(&[good], &DriftState::default(), "T0");
        let bad = (
            "vrr".to_string(),
            "VRR enabled".to_string(),
            "attention".to_string(),
            "FreeSync turned off".to_string(),
        );
        let (d1, _s1) = detect(&[bad], &s0, "T1");
        assert_eq!(d1.len(), 1);
        assert_eq!(d1[0].id, "vrr");
        assert_eq!(d1[0].label, "VRR enabled");
        assert_eq!(d1[0].detail, "FreeSync turned off");
        assert_eq!(d1[0].noticed_at, "T1");
    }

    fn obs_val(id: &str, status: &str, value: Option<&str>) -> (
        (String, String, String, String),
        HashMap<String, Seen>,
    ) {
        let mut seen = HashMap::new();
        seen.insert(id.to_string(), Seen { value: value.map(String::from), ..Seen::default() });
        (obs(id, status), seen)
    }

    /// n1-drift: every check id that has an Attention state carries what it reads now, what it
    /// last recorded and when, in the payload. One row per drift-capable kind.
    #[test]
    fn every_drift_capable_kind_carries_now_before_and_when() {
        // The value shapes readiness.rs really produces (pinned against `evaluate_readiness` by
        // `readiness::drift_values_match_what_each_kind_really_produces`). memory-speed and
        // drive-health have no value when Ready, so their "before" is genuinely unknown.
        let fast = "Fast \u{b7} C:";
        let kinds: [(&str, Option<&str>, &str); 7] = [
            ("monitor-refresh", Some("144 Hz"), "60 / 144 Hz"),
            ("memory-speed", None, "4800 of 6000 MT/s"),
            ("memory-channels", Some("2 modules on 2 channels"), "2 modules on 1 channel"),
            ("drive-health", None, "CT1000: Warning"),
            ("install-drive", Some(fast), "HDD: D"),
            ("vrr", Some("FreeSync: on"), "FreeSync: off"),
            ("power-profile", Some("Balanced"), "Power saver"),
        ];
        for (id, before, now) in kinds {
            let (good, seen_good) = obs_val(id, "ready", before);
            let (_d0, s0) = detect_seen(&[good], &seen_good, &DriftState::default(), "T0");
            let (bad, seen_bad) = obs_val(id, "attention", Some(now));
            let (d1, _s1) = detect_seen(&[bad], &seen_bad, &s0, "T1");
            assert_eq!(d1.len(), 1, "{id}");
            assert_eq!(d1[0].value_now.as_deref(), Some(now), "{id}: now");
            assert_eq!(d1[0].last_ready_value.as_deref(), before, "{id}: before");
            assert_eq!(d1[0].last_ready_at.as_deref(), Some("T0"), "{id}: when");
            assert_eq!(d1[0].noticed_at, "T1", "{id}: noticed");
            assert!(!d1[0].unreadable_now && d1[0].titles.is_empty(), "{id}");
        }
    }

    /// The applied-changes drift names the changes now off, from the side input only.
    #[test]
    fn applied_changes_drift_carries_the_titles_now_off() {
        let (good, _) = obs_val("applied-changes", "ready", Some("2 active"));
        let (_d0, s0) = detect(&[good], &DriftState::default(), "T0");
        let mut seen = HashMap::new();
        seen.insert(
            "applied-changes".to_string(),
            Seen {
                value: Some("1 on / 1 drifted".into()),
                titles: vec!["Enable Windows Game Mode".into()],
                applied_at: vec!["2026-11-01T10:00:00Z".into()],
            },
        );
        let (d1, _s1) = detect_seen(&[obs("applied-changes", "attention")], &seen, &s0, "T1");
        assert_eq!(d1[0].titles, vec!["Enable Windows Game Mode".to_string()]);
        // The change's own ledger stamp travels beside its title; the row's last-ready scan time is a
        // different thing and is never what a surface says "you turned it on" with.
        assert_eq!(d1[0].applied_at, vec!["2026-11-01T10:00:00Z".to_string()]);
        assert_eq!(d1[0].last_ready_at.as_deref(), Some("T0"));
    }

    /// B2: a driver getting older reaches Attention with nothing changed, so it is never a drift:
    /// ready -> advisory -> attention yields no drift and no record, and a notice an earlier build
    /// kept for it is dropped on the next scan.
    #[test]
    fn an_ageing_driver_is_never_a_drift_and_an_old_record_is_dropped() {
        let (good, sg) = obs_val("gpu-driver-age", "ready", Some("100 days"));
        let (d0, s0) = detect_seen(&[good], &sg, &DriftState::default(), "T0");
        assert!(d0.is_empty());
        assert!(!s0.last_good.contains_key("gpu-driver-age"), "never recorded as good");
        let (adv, sa) = obs_val("gpu-driver-age", "advisory", Some("200 days"));
        let (_d1, s1) = detect_seen(&[adv], &sa, &s0, "T1");
        let (old, so) = obs_val("gpu-driver-age", "attention", Some("400 days"));
        let (d2, s2) = detect_seen(&[old], &so, &s1, "T2");
        assert!(d2.is_empty(), "an ageing driver is not a setting that changed");
        assert!(s2.noticed_at.is_empty() && notices_from(&s2).is_empty());
        // A state an earlier build wrote, with a live notice for it, is cleaned.
        let mut legacy = DriftState::default();
        legacy.last_good.insert("gpu-driver-age".into(), true);
        legacy.noticed_at.insert("gpu-driver-age".into(), "T0".into());
        legacy.labels.insert("gpu-driver-age".into(), "GPU driver over a year old".into());
        let (d3, s3) = detect_seen(&[obs("gpu-driver-age", "attention")], &HashMap::new(), &legacy, "T3");
        assert!(d3.is_empty() && notices_from(&s3).is_empty() && s3.last_good.is_empty());
    }

    /// Unknown before: a state file from before `last_ready_value` (and before the ready stamp)
    /// has neither, and the payload says None for each, never a guess; the file still loads.
    #[test]
    fn a_state_from_before_the_new_field_loads_and_reports_unknown_before() {
        let old = r#"{"last_good":{"power-profile":true},"noticed_at":{},"labels":{}}"#;
        let s: DriftState = serde_json::from_str(old).expect("older drift.json must still load");
        assert!(s.last_ready_value.is_empty() && s.last_ready_seen.is_empty());
        let (bad, seen) = obs_val("power-profile", "attention", Some("Power saver"));
        let (d, _) = detect_seen(&[bad], &seen, &s, "T1");
        assert_eq!(d[0].value_now.as_deref(), Some("Power saver"));
        assert_eq!(d[0].last_ready_value, None);
        assert_eq!(d[0].last_ready_at, None);
    }

    /// A later ready scan with no value removes the old one: "last recorded" is never stale.
    #[test]
    fn a_ready_scan_without_a_value_clears_the_recorded_value() {
        let (good, seen) = obs_val("vrr", "ready", Some("FreeSync: on"));
        let (_d0, s0) = detect_seen(&[good], &seen, &DriftState::default(), "T0");
        assert_eq!(s0.last_ready_value.get("vrr").map(String::as_str), Some("FreeSync: on"));
        let (_d1, s1) = detect(&[obs("vrr", "ready")], &s0, "T1");
        assert!(!s1.last_ready_value.contains_key("vrr"));
        let (d2, _) = detect(&[obs("vrr", "attention")], &s1, "T2");
        assert_eq!((d2[0].last_ready_value.clone(), d2[0].last_ready_at.clone()), (None, Some("T1".into())));
    }

    /// Couldn't read it now: the notice keeps its before and when, claims no current value.
    #[test]
    fn an_unreadable_drift_claims_no_current_value_but_keeps_before_and_when() {
        let (good, seen) = obs_val("power-profile", "ready", Some("Balanced"));
        let (_d0, s0) = detect_seen(&[good], &seen, &DriftState::default(), "T0");
        let (bad, seen_bad) = obs_val("power-profile", "attention", Some("Power saver"));
        let (_d1, s1) = detect_seen(&[bad], &seen_bad, &s0, "T1");
        let (d2, _) = detect_seen(&[obs("power-profile", "unknown")], &HashMap::new(), &s1, "T2");
        assert!(d2[0].unreadable_now);
        assert_eq!(d2[0].value_now, None);
        assert_eq!(d2[0].last_ready_value.as_deref(), Some("Balanced"));
        assert_eq!(d2[0].last_ready_at.as_deref(), Some("T0"));
        assert_eq!(d2[0].noticed_at, "T1");
    }
}

/// #283 — LOST UPDATE. `detect_and_persist` folds observations into the PRIOR state, so two
/// overlapping readiness scans that both read the same prior each write a state missing the other's
/// fold. The visible cost is this module's whole point: a `noticed_at` stamp that is supposed to be
/// STABLE gets reset, so the user is told a drift was noticed just now when it was noticed hours ago.
///
/// FALSIFIED BEFORE TRUSTED — each test below individually, not the module as a whole. With
/// `DRIFT_LOCK` removed from `detect_and_persist_at`, the fold test ends with as few as 1 of the 12
/// ids recorded instead of all 12, and the stamp test loses the notice entirely.
#[cfg(test)]
mod drift_race_tests {
    use super::*;

    fn scratch(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "compy-drift-race-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Each writer folds in a DIFFERENT check id. Serialized, the final state names all of them,
    /// because every fold started from the previous writer's result.
    #[test]
    fn concurrent_scans_do_not_drop_each_others_folded_state() {
        let dir = scratch("fold");
        let path = dir.join("drift.json");
        const WRITERS: usize = 12;

        std::thread::scope(|scope| {
            for i in 0..WRITERS {
                let path = path.clone();
                scope.spawn(move || {
                    let checks = vec![(
                        format!("check-{i}"),
                        format!("Check {i}"),
                        "ready".to_string(),
                        String::new(),
                    )];
                    detect_and_persist_at(&path, &checks, &HashMap::new(), "T0");
                });
            }
        });

        let state = load_state_from(&path);
        for i in 0..WRITERS {
            assert!(
                state.last_good.contains_key(&format!("check-{i}")),
                "check-{i}'s fold was lost: {} of {WRITERS} survived",
                state.last_good.len()
            );
        }
    }

    /// The stability guarantee itself: once a drift is noticed, a concurrent scan of an UNRELATED
    /// check must not save state folded from a read it took before that notice landed.
    ///
    /// PR #395's review caught the first version of this test passing 5/5 with `DRIFT_LOCK` deleted,
    /// and it was right — but the cause was structural, not narrow timing. That version stamped
    /// `noticed_at` BEFORE starting any thread, so every racing writer read a state that already
    /// contained the stamp and wrote it straight back. No interleaving could lose it, lock or no
    /// lock. The notice is now one of the two racers, which is the situation the module actually
    /// promises to survive, and the seam makes the losing interleaving land every run.
    #[test]
    fn an_unrelated_scan_cannot_land_on_top_of_a_notice_it_read_past() {
        let dir = scratch("stamp");
        let path = dir.join("drift.json");

        // "was good" only — the regression that stamps `noticed_at` happens INSIDE the race.
        let good =
            vec![("vrr".to_string(), "VRR".to_string(), "ready".to_string(), String::new())];
        detect_and_persist_at(&path, &good, &HashMap::new(), "T0");
        assert!(load_state_from(&path).noticed_at.is_empty(), "nothing is noticed yet");

        let _seam = crate::race_seam::Widened::arm();
        std::thread::scope(|scope| {
            let p = path.clone();
            scope.spawn(move || {
                let bad = vec![(
                    "vrr".to_string(),
                    "VRR".to_string(),
                    "attention".to_string(),
                    "off".to_string(),
                )];
                detect_and_persist_at(&p, &bad, &HashMap::new(), "T1");
            });
            // Comfortably inside the seam the first scan is sitting in, and comfortably after it
            // entered: the second scan's READ is guaranteed to predate the first scan's WRITE.
            std::thread::sleep(std::time::Duration::from_millis(20));
            let p = path.clone();
            scope.spawn(move || {
                let other = vec![(
                    "other".to_string(),
                    "Other".to_string(),
                    "ready".to_string(),
                    String::new(),
                )];
                detect_and_persist_at(&p, &other, &HashMap::new(), "T9");
            });
        });

        assert_eq!(
            load_state_from(&path).noticed_at.get("vrr").map(String::as_str),
            Some("T1"),
            "an unrelated concurrent scan erased a drift notice by saving state folded from a read \
             it took before that notice landed — the one thing this module promises never happens"
        );
    }
}
