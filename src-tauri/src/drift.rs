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
    /// f1-follow (additive): one entry per watched setting that was noticed off and then read ready again:
    /// when it was noticed off, when Compy next read it ready, and the last time it had been read ready
    /// before it went off. Kept so the Paramedic can still say "it went off, and it was back on by X"
    /// after the notice itself is gone. Pruned after `CLEARED_KEEP_DAYS`; an older file has none, and an
    /// older app reading a newer file ignores it.
    #[serde(default)]
    cleared: HashMap<String, ClearedDrift>,
    /// f1-follow (additive): the titles of the applied changes noticed off while a notice stands (the
    /// applied-changes row only), so the name survives the setting coming back on. Moved into the
    /// `cleared` entry when it is read ready again; dropped with the notice otherwise. These are the titles
    /// the UI passed when the change was applied, so a startup-entry change can carry a typed entry name.
    #[serde(default)]
    noticed_titles: HashMap<String, Vec<KeptTitle>>,
    /// f1-follow (additive): how many scans read the check off while its notice has stood (a notice that was
    /// already standing when this was first kept counts the earlier reading too). A notice that ends having
    /// been read off only once, or for under `MIN_NOTICE_MINUTES`, was a blip and leaves no cleared record.
    #[serde(default)]
    attention_reads: HashMap<String, u32>,
}

/// How long a cleared record is kept.
pub(crate) const CLEARED_KEEP_DAYS: i64 = 30;
/// Most titles kept for one setting.
const KEPT_TITLES: usize = 8;
/// A notice must have stood this long, across at least `MIN_NOTICE_READS` scans, before its end is kept. Scans
/// are not periodic (app start, the health check, after an apply), so this is measured from the first reading
/// and a second reading may come minutes or days later; a blip that one scan reads and the next does not is
/// dropped.
pub(crate) const MIN_NOTICE_MINUTES: i64 = 5;
pub(crate) const MIN_NOTICE_READS: u32 = 2;

/// A title of an applied change, and when Compy first read it as off under the notice.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct KeptTitle {
    pub title: String,
    pub at: String,
}

/// Folds the titles one scan read into the ones already kept for a standing notice: no blanks, no repeats,
/// in the order first seen (each with the scan that first saw it), at most `KEPT_TITLES`.
fn merge_titles(kept: &mut Vec<KeptTitle>, read: &[String], now: &str) {
    for t in read {
        let t = t.trim();
        if !t.is_empty() && kept.len() < KEPT_TITLES && !kept.iter().any(|k| k.title == t) {
            kept.push(KeptTitle { title: t.to_string(), at: now.to_string() });
        }
    }
}

/// True when a notice that ends now stood long enough, over enough scans, to be a real change and not a blip.
/// A stamp that cannot be read as a time is not a reason to drop the record.
fn notice_held(noticed: &str, reads: u32, now: &str) -> bool {
    if reads < MIN_NOTICE_READS {
        return false;
    }
    match (chrono::DateTime::parse_from_rfc3339(noticed), chrono::DateTime::parse_from_rfc3339(now)) {
        (Ok(a), Ok(b)) => b.signed_duration_since(a) >= chrono::Duration::minutes(MIN_NOTICE_MINUTES),
        _ => true,
    }
}

/// A setting noticed off that later read ready again: times, and the titles of the applied changes that had been off.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct ClearedDrift {
    pub noticed_at: String,
    /// The first scan that read the check ready again: "back on by" this time, not "turned on at" it.
    pub cleared_at: String,
    /// The last ready scan before it went off (the earlier bound), when one was recorded.
    #[serde(default)]
    pub last_ready_at: Option<String>,
    /// The titles of the applied changes that had been off AND read On when the check was next read ready
    /// (Compy's own catalog titles; a startup-entry change can carry the entry's typed name), each with when
    /// Compy first read it off. Empty for a record made before this was kept, or when none read On.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub titles: Vec<KeptTitle>,
    /// The check read ready again AND (for the applied-changes row) at least one noticed change read On. False:
    /// the row reads ready without any of them being on (it was rolled back, kept as set outside Compy, or its
    /// ledger is empty), so Compy says the notice ended and never that the setting was back on.
    #[serde(default)]
    pub back_on: bool,
}

/// Drops cleared records older than `CLEARED_KEEP_DAYS` as of `now`. A stamp that cannot be read as a
/// time is kept (a record is never dropped on a guess).
fn prune_cleared(cleared: &mut HashMap<String, ClearedDrift>, now: &str) {
    let Ok(now) = chrono::DateTime::parse_from_rfc3339(now) else { return };
    cleared.retain(|_, c| match chrono::DateTime::parse_from_rfc3339(&c.cleared_at) {
        Ok(at) => now.signed_duration_since(at) <= chrono::Duration::days(CLEARED_KEEP_DAYS),
        Err(_) => true,
    });
}

#[cfg(test)]
impl DriftState {
    /// True when any part of this state still mentions the check (tests only).
    pub(crate) fn has_record_for(&self, id: &str) -> bool {
        self.cleared.contains_key(id)
            || self.last_good.contains_key(id)
            || self.noticed_at.contains_key(id)
            || self.noticed_titles.contains_key(id)
            || self.attention_reads.contains_key(id)
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
    /// The applied-changes row only: the titles of the changes whose live check reads On now. Used when the
    /// notice ends, to keep only the titles that really came back on.
    pub on_titles: Vec<String>,
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
    prune_cleared(&mut state.cleared, now);
    let mut drifts = Vec::new();
    for (id, label, status, detail) in checks {
        if TIME_ONLY_CHECKS.contains(&id.as_str()) {
            state.cleared.remove(id);
            state.last_good.remove(id);
            state.noticed_at.remove(id);
            state.noticed_titles.remove(id);
            state.attention_reads.remove(id);
            state.labels.remove(id);
            state.last_ready_seen.remove(id);
            state.last_ready_value.remove(id);
            continue;
        }
        let read = seen.get(id).cloned().unwrap_or_default();
        match status.as_str() {
            "ready" => {
                state.last_good.insert(id.clone(), true);
                // The notice ends here, but the fact that it ended is kept (one entry per check).
                let noticed_titles = state.noticed_titles.remove(id).unwrap_or_default();
                let reads = state.attention_reads.remove(id).unwrap_or(0);
                if let Some(noticed) = state.noticed_at.remove(id) {
                    // A blip (read off by one scan, or for minutes) leaves nothing. For the applied-changes row,
                    // "ready" is also reached by a rollback, by keeping what was set outside Compy, or with an empty
                    // ledger: only the noticed titles that read On now were turned back on.
                    if notice_held(&noticed, reads, now) {
                        let toggle = id == "applied-changes";
                        let titles: Vec<KeptTitle> = if toggle {
                            noticed_titles.into_iter().filter(|k| read.on_titles.iter().any(|o| o.trim() == k.title)).collect()
                        } else {
                            Vec::new()
                        };
                        let back_on = !toggle || !titles.is_empty();
                        state.cleared.insert(
                            id.clone(),
                            ClearedDrift { noticed_at: noticed, cleared_at: now.to_string(), last_ready_at: state.last_ready_seen.get(id).cloned(), titles, back_on },
                        );
                    }
                }
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
                let standing = state.noticed_at.contains_key(id);
                let noticed = state
                    .noticed_at
                    .entry(id.clone())
                    .or_insert_with(|| now.to_string())
                    .clone();
                // A notice already standing was read off at least once before this scan.
                let reads = state.attention_reads.entry(id.clone()).or_insert(u32::from(standing));
                *reads = reads.saturating_add(1);
                state.labels.insert(id.clone(), label.clone());
                if !read.titles.is_empty() {
                    merge_titles(state.noticed_titles.entry(id.clone()).or_default(), &read.titles, now);
                }
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

/// What the Paramedic reads of one watched setting: a notice that still stands (`cleared_at` None) or one
/// that was noticed off and later read ready again (`cleared_at` Some).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DriftRecord {
    pub id: String,
    pub last_ready_at: Option<String>,
    pub noticed_at: String,
    pub cleared_at: Option<String>,
    /// The titles of the applied changes that had been off and read On when the check was next read ready, for a
    /// cleared record only (a standing notice is named from the live drift). Empty when none was kept.
    pub titles: Vec<KeptTitle>,
    /// A cleared record only: the setting read On again (see `ClearedDrift::back_on`). A standing notice: true.
    pub back_on: bool,
}

/// Pure mapping: every standing notice, then every cleared one (sorted by id within each).
fn records_from(s: &DriftState) -> Vec<DriftRecord> {
    let mut v: Vec<DriftRecord> = notices_from(s)
        .into_iter()
        .map(|n| DriftRecord { id: n.id, last_ready_at: n.last_ready_at, noticed_at: n.noticed_at, cleared_at: None, titles: Vec::new(), back_on: true })
        .collect();
    let mut c: Vec<DriftRecord> = s
        .cleared
        .iter()
        .map(|(id, c)| DriftRecord {
            id: id.clone(),
            last_ready_at: c.last_ready_at.clone(),
            noticed_at: c.noticed_at.clone(),
            cleared_at: Some(c.cleared_at.clone()),
            titles: c.titles.clone(),
            back_on: c.back_on,
        })
        .collect();
    c.sort_by(|a, b| a.id.cmp(&b.id));
    v.extend(c);
    v
}

/// PC Paramedic: the standing drift notices and the cleared records from a state file, READ-ONLY and
/// strict. An absent file is no records; one that is there and cannot be read or parsed is an error, not
/// "nothing drifted".
pub(crate) fn read_records_readonly_from(path: &std::path::Path) -> Result<Vec<DriftRecord>, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    serde_json::from_str::<DriftState>(&raw).map(|s| records_from(&s)).map_err(|e| e.to_string())
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
                ..Seen::default()
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

    // ---- f1-follow: a setting that went off and came back keeps one dated record ----------------

    const NOV10: &str = "2026-11-10T10:00:00Z";
    const NOV19: &str = "2026-11-19T20:00:00Z";
    const NOV19B: &str = "2026-11-19T21:00:00Z";
    const NOV21: &str = "2026-11-21T18:10:00Z";

    /// Ready at NOV10, then read off by two scans an hour apart (a notice that is real).
    fn off_for_an_hour(id: &str) -> DriftState {
        let (_d, s) = detect(&[obs(id, "ready")], &DriftState::default(), NOV10);
        let (_d, s) = detect(&[obs(id, "attention")], &s, NOV19);
        let (_d, s) = detect(&[obs(id, "attention")], &s, NOV19B);
        s
    }

    #[test]
    fn a_ready_scan_after_a_notice_keeps_when_it_went_off_and_when_it_was_back() {
        let s1 = off_for_an_hour("visual-effects");
        let (d2, s2) = detect(&[obs("visual-effects", "ready")], &s1, NOV21);
        assert!(d2.is_empty() && s2.noticed_at.is_empty(), "the notice itself still ends");
        let c = s2.cleared.get("visual-effects").expect("the clear is kept");
        assert_eq!((c.noticed_at.as_str(), c.cleared_at.as_str()), (NOV19, NOV21));
        assert_eq!(c.last_ready_at.as_deref(), Some(NOV10), "the earlier bound is the ready scan before it went off");
        assert!(c.back_on, "a check that is not a toggle of applied changes reads back on when it reads ready");
        // A ready scan with no notice before it records nothing.
        let (_d, s3) = detect(&[obs("visual-effects", "ready")], &s2, "2026-11-22T10:00:00Z");
        assert_eq!(s3.cleared.get("visual-effects"), s2.cleared.get("visual-effects"), "a later ready scan changes nothing");
        let (_d, fresh) = detect(&[obs("other", "ready")], &DriftState::default(), NOV21);
        assert!(fresh.cleared.is_empty());
    }

    #[test]
    fn one_entry_per_setting_a_second_clear_replaces_the_first() {
        let day = |d: u32, h: u32| format!("2026-11-{d:02}T{h:02}:00:00Z");
        let (_d, s) = detect(&[obs("vrr", "ready")], &DriftState::default(), &day(1, 0));
        let (_d, s) = detect(&[obs("vrr", "attention")], &s, &day(2, 0));
        let (_d, s) = detect(&[obs("vrr", "attention")], &s, &day(2, 1));
        let (_d, s) = detect(&[obs("vrr", "ready")], &s, &day(3, 0));
        let (_d, s) = detect(&[obs("vrr", "attention")], &s, &day(4, 0));
        let (_d, s) = detect(&[obs("vrr", "attention")], &s, &day(4, 1));
        let (_d, s) = detect(&[obs("vrr", "ready")], &s, &day(5, 0));
        assert_eq!(s.cleared.len(), 1);
        assert_eq!(s.cleared["vrr"].noticed_at, day(4, 0));
        assert_eq!(s.cleared["vrr"].cleared_at, day(5, 0));
    }

    /// A reading that one scan makes and the next does not is a blip: it writes no record. So is a notice read
    /// twice inside `MIN_NOTICE_MINUTES`.
    #[test]
    fn a_one_reading_blip_or_a_few_minutes_writes_no_record() {
        let (_d, s) = detect(&[obs("vrr", "ready")], &DriftState::default(), NOV10);
        let (_d, s) = detect(&[obs("vrr", "attention")], &s, NOV19);
        let (_d, s) = detect(&[obs("vrr", "ready")], &s, NOV19B);
        assert!(s.cleared.is_empty() && s.attention_reads.is_empty() && s.noticed_titles.is_empty());
        // Two readings two minutes apart.
        let (_d, s) = detect(&[obs("vrr", "attention")], &s, "2026-11-20T10:00:00Z");
        let (_d, s) = detect(&[obs("vrr", "attention")], &s, "2026-11-20T10:02:00Z");
        let (_d, s) = detect(&[obs("vrr", "ready")], &s, "2026-11-20T10:03:00Z");
        assert!(s.cleared.is_empty(), "under five minutes is a blip however many scans saw it");
    }

    /// The owner's applied-changes count flapped 13 <-> 14 on Nov 11: each time a scan read it off once and the
    /// next read it on. None of it is a record of the setting having been off.
    #[test]
    fn the_owners_flapping_on_count_on_nov_11_writes_nothing() {
        let day = |h: u32, m: u32| format!("2026-11-11T{h:02}:{m:02}:00Z");
        let (_d, mut s) = detect(&[obs("applied-changes", "ready")], &DriftState::default(), &day(8, 0));
        for (h, m) in [(9, 40), (10, 30), (11, 20), (13, 5)] {
            let off = Seen { titles: vec!["Trim Windows visual effects".into()], ..Seen::default() };
            let on = Seen { on_titles: vec!["Trim Windows visual effects".into()], ..Seen::default() };
            let mut m1 = HashMap::new();
            m1.insert("applied-changes".to_string(), off);
            let (d, s1) = detect_seen(&[obs("applied-changes", "attention")], &m1, &s, &day(h, m));
            assert_eq!(d.len(), 1, "the card may still show it while it is off");
            let mut m2 = HashMap::new();
            m2.insert("applied-changes".to_string(), on);
            let (_d, s2) = detect_seen(&[obs("applied-changes", "ready")], &m2, &s1, &day(h, m + 1));
            s = s2;
        }
        assert!(s.cleared.is_empty() && s.noticed_titles.is_empty() && s.attention_reads.is_empty(), "no record, no title, no read count left behind");
        assert!(records_from(&s).is_empty());
    }

    fn titled(titles: &[&str]) -> HashMap<String, Seen> {
        let mut m = HashMap::new();
        m.insert("applied-changes".to_string(), Seen { titles: titles.iter().map(|t| t.to_string()).collect(), ..Seen::default() });
        m
    }

    fn on(titles: &[&str]) -> HashMap<String, Seen> {
        let mut m = HashMap::new();
        m.insert("applied-changes".to_string(), Seen { on_titles: titles.iter().map(|t| t.to_string()).collect(), ..Seen::default() });
        m
    }

    fn applied_off(titles: &[&str]) -> DriftState {
        let (_d, s) = detect(&[obs("applied-changes", "ready")], &DriftState::default(), NOV10);
        let (_d, s) = detect_seen(&[obs("applied-changes", "attention")], &titled(titles), &s, NOV19);
        let (_d, s) = detect_seen(&[obs("applied-changes", "attention")], &titled(titles), &s, NOV19B);
        s
    }

    fn kept(titles: &[KeptTitle]) -> Vec<String> {
        titles.iter().map(|k| k.title.clone()).collect()
    }

    #[test]
    fn the_titles_off_when_noticed_are_kept_through_the_clear_and_nowhere_else() {
        let (_d, s) = detect(&[obs("applied-changes", "ready")], &DriftState::default(), NOV10);
        let (d1, s) = detect_seen(&[obs("applied-changes", "attention")], &titled(&["Trim Windows visual effects"]), &s, NOV19);
        assert_eq!(d1[0].titles, vec!["Trim Windows visual effects".to_string()]);
        assert_eq!(kept(&s.noticed_titles["applied-changes"]), vec!["Trim Windows visual effects".to_string()]);
        // A later scan that names another one, and one that names the first again: each kept once, in order seen.
        let (_d, s) = detect_seen(&[obs("applied-changes", "attention")], &titled(&["Enable Windows Game Mode", "Trim Windows visual effects", "  "]), &s, NOV19B);
        assert_eq!(kept(&s.noticed_titles["applied-changes"]), vec!["Trim Windows visual effects".to_string(), "Enable Windows Game Mode".to_string()]);
        // A scan that could not read the titles keeps what was there.
        let (_d, s) = detect(&[obs("applied-changes", "attention")], &s, "2026-11-20T11:00:00Z");
        assert_eq!(s.noticed_titles["applied-changes"].len(), 2);
        // Read ready again with both On: the titles move into the cleared entry and out of the standing record.
        let (_d, s) = detect_seen(&[obs("applied-changes", "ready")], &on(&["Enable Windows Game Mode", "Trim Windows visual effects"]), &s, NOV21);
        assert!(s.noticed_titles.is_empty() && s.attention_reads.is_empty());
        let c = &s.cleared["applied-changes"];
        assert!(c.back_on);
        assert_eq!(kept(&c.titles), vec!["Trim Windows visual effects".to_string(), "Enable Windows Game Mode".to_string()]);
        let r = records_from(&s);
        assert_eq!((r[0].cleared_at.as_deref(), r[0].titles.len(), r[0].back_on), (Some(NOV21), 2, true));
        // Nothing standing is left behind, and the file carries the title.
        assert!(s.labels.is_empty() && s.noticed_at.is_empty());
        assert!(serde_json::to_string(&s).unwrap().contains("Trim Windows visual effects"));
        // A check whose notice never named a title keeps none, and an old record has none to load.
        let n = off_for_an_hour("vrr");
        let (_d, n) = detect(&[obs("vrr", "ready")], &n, NOV21);
        assert!(n.cleared["vrr"].titles.is_empty());
        assert!(!serde_json::to_string(&n.cleared["vrr"]).unwrap().contains("titles"), "an empty list is not written");
        let old: ClearedDrift = serde_json::from_str(r#"{"noticed_at":"a","cleared_at":"b"}"#).unwrap();
        assert!(old.titles.is_empty() && old.last_ready_at.is_none());
        // Never more than KEPT_TITLES.
        let many: Vec<String> = (0..20).map(|i| format!("Change {i}")).collect();
        let mut held = Vec::new();
        merge_titles(&mut held, &many, NOV19);
        assert_eq!(held.len(), KEPT_TITLES);
    }

    /// "Ready" is not "back on": an undo, a change kept as set outside Compy, and an empty ledger all read ready
    /// too. Only the noticed titles that read On now are kept, and none means no "back on" record.
    #[test]
    fn ready_is_not_back_on_undo_keep_outside_and_an_empty_ledger_keep_no_title() {
        // Undone, kept as set outside Compy, or an empty ledger: the ready scan reads none of them On.
        for scenario in ["undone", "kept outside", "empty ledger"] {
            let s = applied_off(&["Trim Windows visual effects"]);
            let (_d, s) = detect_seen(&[obs("applied-changes", "ready")], &on(&[]), &s, NOV21);
            let c = s.cleared.get("applied-changes").unwrap_or_else(|| panic!("{scenario}: the notice did end"));
            assert!(!c.back_on, "{scenario}: never recorded as back on");
            assert!(c.titles.is_empty(), "{scenario}: no title kept");
            let r = records_from(&s);
            assert_eq!((r[0].back_on, r[0].titles.len()), (false, 0), "{scenario}");
        }
        // A back on, B undone: only A is kept.
        let s = applied_off(&["Enable Windows Game Mode", "Trim Windows visual effects"]);
        let (_d, s) = detect_seen(&[obs("applied-changes", "ready")], &on(&["Trim Windows visual effects"]), &s, NOV21);
        let c = &s.cleared["applied-changes"];
        assert!(c.back_on);
        assert_eq!(kept(&c.titles), vec!["Trim Windows visual effects".to_string()]);
    }

    /// Each title carries when Compy first read it off, so two changes noticed on different scans are not given one time.
    #[test]
    fn each_title_keeps_its_own_noticed_time() {
        let s = applied_off(&["Enable Windows Game Mode"]);
        let (_d, s) = detect_seen(&[obs("applied-changes", "attention")], &titled(&["Enable Windows Game Mode", "Trim Windows visual effects"]), &s, "2026-11-20T09:00:00Z");
        let (_d, s) = detect_seen(&[obs("applied-changes", "ready")], &on(&["Enable Windows Game Mode", "Trim Windows visual effects"]), &s, NOV21);
        let t = &s.cleared["applied-changes"].titles;
        assert_eq!((t[0].title.as_str(), t[0].at.as_str()), ("Enable Windows Game Mode", NOV19));
        assert_eq!((t[1].title.as_str(), t[1].at.as_str()), ("Trim Windows visual effects", "2026-11-20T09:00:00Z"));
    }

    #[test]
    fn a_record_older_than_thirty_days_is_pruned_and_one_inside_is_kept() {
        let rec = |n: &str, c: &str| ClearedDrift { noticed_at: n.into(), cleared_at: c.into(), last_ready_at: None, titles: Vec::new(), back_on: true };
        let mut s = DriftState::default();
        s.cleared.insert("old".into(), rec("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"));
        s.cleared.insert("inside".into(), rec("2026-10-20T00:00:00Z", "2026-10-22T00:00:00Z"));
        // 2026-11-02 is 31 days after the first and 11 after the second.
        let (_d, after) = detect(&[obs("x", "ready")], &s, "2026-11-02T00:00:01Z");
        assert!(!after.cleared.contains_key("old"), "31 days old: pruned");
        assert!(after.cleared.contains_key("inside"));
        // A stamp that is not a time is kept, never dropped on a guess.
        let mut odd = DriftState::default();
        odd.cleared.insert("odd".into(), rec("T1", "T2"));
        let (_d, after) = detect(&[obs("x", "ready")], &odd, "2026-11-02T00:00:01Z");
        assert!(after.cleared.contains_key("odd"));
    }

    #[test]
    fn an_old_file_without_the_field_loads_and_a_newer_file_loads_in_an_older_shape() {
        let old = r#"{"last_good":{"vrr":true},"noticed_at":{},"labels":{}}"#;
        let s: DriftState = serde_json::from_str(old).expect("an older drift.json still loads");
        assert!(s.cleared.is_empty() && s.attention_reads.is_empty());
        // The record round-trips, and an entry written without its optional earlier bound still loads.
        let s1 = off_for_an_hour("vrr");
        let (_d, s2) = detect(&[obs("vrr", "ready")], &s1, "2026-11-22T00:00:00Z");
        let json = serde_json::to_string(&s2).unwrap();
        assert!(json.contains("\"cleared\""));
        let back: DriftState = serde_json::from_str(&json).unwrap();
        assert_eq!(back.cleared, s2.cleared);
        let bare = r#"{"last_good":{},"noticed_at":{},"cleared":{"vrr":{"noticed_at":"a","cleared_at":"b"}}}"#;
        assert_eq!(serde_json::from_str::<DriftState>(bare).unwrap().cleared["vrr"].last_ready_at, None);
        // The older app's struct has no `cleared` and no `deny_unknown_fields`: it ignores the key.
        #[derive(serde::Deserialize)]
        struct OlderShape {
            last_good: HashMap<String, bool>,
        }
        let older: OlderShape = serde_json::from_str(&json).expect("an older shape ignores the new key");
        assert_eq!(older.last_good.len(), s2.last_good.len());
    }

    #[test]
    fn the_paramedic_reads_standing_notices_and_cleared_records_and_an_unreadable_file_is_an_error() {
        let (_d, s0) = detect(&[obs("a", "ready"), obs("b", "ready")], &DriftState::default(), NOV10);
        let (_d, s1) = detect(&[obs("a", "attention"), obs("b", "attention")], &s0, NOV19);
        let (_d, s1) = detect(&[obs("a", "attention"), obs("b", "attention")], &s1, NOV19B);
        let (_d, s2) = detect(&[obs("a", "ready"), obs("b", "attention")], &s1, NOV21);
        let recs = records_from(&s2);
        assert_eq!(recs.len(), 2);
        assert!(recs.iter().any(|r| r.id == "b" && r.cleared_at.is_none()));
        assert!(recs.iter().any(|r| r.id == "a" && r.cleared_at.as_deref() == Some(NOV21)));
        let dir = std::env::temp_dir().join(format!("compy-drift-records-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_records_readonly_from(&dir.join("absent.json")), Ok(Vec::new()));
        std::fs::write(dir.join("bad.json"), "{\"last_good\": {").unwrap();
        assert!(read_records_readonly_from(&dir.join("bad.json")).is_err());
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
