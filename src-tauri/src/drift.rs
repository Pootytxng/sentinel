//! Drift Watch (Wave-2): notices readiness checks that WERE good and have since regressed — e.g. a
//! power plan reverted by Windows Update — and surfaces them as a quiet, honest heads-up. Honest-copy
//! rule: name WHAT drifted and WHEN we noticed; NEVER speculate WHO — not even "outside Compy." A
//! regression can be self-inflicted (rolling back the Ultimate power plan in the Trust Ledger drops
//! the "power-profile" check back to Attention), and drift has no vantage point to tell that from a
//! Windows Update revert, so any WHO-claim is sometimes false. Read-only; the fix routes through the
//! existing apply / deep-link flow, nothing new here.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Persisted across launches: which checks were last seen "good", and when each current drift was
/// first noticed (so the timestamp is stable — it isn't reset on every scan).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct DriftState {
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
}

/// A surfaced regression: a check that was good and now needs attention.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Drift {
    pub id: String,
    pub label: String,
    pub detail: String,
    pub noticed_at: String,
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

fn save_state(s: &DriftState) {
    save_state_to(&state_path(), s);
}

/// Deliberately best-effort and returning nothing, unchanged: drift is a convenience, and a failed
/// save must never surface as an error to the user. What DID change is that a failure now leaves the
/// previous state file whole instead of a truncated one.
///
/// The directory is still created only AFTER serialization succeeds, exactly as before — a state
/// that cannot be serialized must not leave a folder behind as its only trace.
fn save_state_to(path: &std::path::Path, s: &DriftState) {
    if let Ok(json) = serde_json::to_string_pretty(s) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = crate::atomic_write::write_atomic(path, json.as_bytes());
    }
}

/// Pure core: fold current check observations `(id, label, status, detail)` into the prior state,
/// returning the active drifts + updated state. Ready → records/keeps `last_good` and clears any
/// drift; Attention while previously good → a regression, stamping `noticed_at` once (stable).
fn detect(
    checks: &[(String, String, String, String)],
    prior: &DriftState,
    now: &str,
) -> (Vec<Drift>, DriftState) {
    let mut state = prior.clone();
    let mut drifts = Vec::new();
    for (id, label, status, detail) in checks {
        match status.as_str() {
            "ready" => {
                state.last_good.insert(id.clone(), true);
                state.noticed_at.remove(id);
                state.labels.remove(id);
                state.last_ready_seen.insert(id.clone(), now.to_string());
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
                });
            }
            // advisory / unknown / attention-that-was-never-good → not a regression.
            _ => {}
        }
    }
    (drifts, state)
}

/// Load → detect → persist. Returns the active drifts for the UI.
pub(crate) fn detect_and_persist(checks: &[(String, String, String, String)]) -> Vec<Drift> {
    let now = chrono::Utc::now().to_rfc3339();
    let (drifts, new_state) = detect(checks, &load_state(), &now);
    save_state(&new_state);
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
}
