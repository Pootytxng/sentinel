//! Drift Watch (Wave-2): notices readiness checks that WERE good and have since regressed — e.g. a
//! power plan reverted by Windows Update — and surfaces them as a quiet, honest heads-up. Honest-copy
//! rule: name WHAT drifted and WHEN we noticed; never speculate WHO beyond "outside Compy." Read-only;
//! the fix routes through the existing apply / deep-link flow, nothing new here.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Persisted across launches: which checks were last seen "good", and when each current drift was
/// first noticed (so the timestamp is stable — it isn't reset on every scan).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct DriftState {
    last_good: HashMap<String, bool>,
    noticed_at: HashMap<String, String>,
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
    std::fs::read_to_string(state_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(s: &DriftState) {
    if let Ok(json) = serde_json::to_string_pretty(s) {
        let _ = std::fs::create_dir_all(crate::compy_data_dir());
        let _ = std::fs::write(state_path(), json);
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
            }
            // Attention while the check was previously good = a regression (a drift).
            "attention" if state.last_good.get(id).copied().unwrap_or(false) => {
                let noticed = state
                    .noticed_at
                    .entry(id.clone())
                    .or_insert_with(|| now.to_string())
                    .clone();
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
