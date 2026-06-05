//! Moments 4/4b — cross-session comparison engine. The measured-efficacy loop at SESSION
//! granularity: arm a fix from the debrief, play again, and the next same-game session is compared
//! honestly against the armed baseline → Improved / No measurable change / Regressed, with the
//! delta judged against a noise floor (never claim a win inside the noise; a null result is the
//! instrument working).
//!
//! On "align with the benchmark engine" (spec): `benchmark_verdict` works on in-trial frame-time
//! WINDOWS, but sessions only retain AGGREGATES (avg FPS, 1% low) — so this compares session
//! aggregates vs a noise floor, reusing the same verdict vocabulary + never-credit-inside-noise
//! philosophy rather than the window bootstrap. Read-only beyond its own small JSON state.

use serde::{Deserialize, Serialize};

use crate::sessions::SessionSummary;

/// Default session-to-session run-to-run variance (%); the 1% low is the primary signal. Owner-
/// tunable later; matches the benchmark engine's conservative 3% floor.
const DEFAULT_NOISE_FLOOR_PCT: f64 = 3.0;

/// Owner-tunable: an armed baseline older than this (days) at finalize is too stale to compare
/// fairly — drivers/games/Windows move on, so we discard rather than attribute a misleading delta.
const ARM_MAX_AGE_DAYS: i64 = 14;

/// A comparison armed from a debrief: the baseline session's metrics + the fix being applied.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct ArmedComparison {
    pub rec_id: String,
    pub rec_title: String,
    pub game: String,
    pub baseline_avg_fps: f64,
    pub baseline_low1_fps: f64,
    pub armed_at: String,
    /// Trust-Ledger entry count at arm time — the confound watermark. If the ledger has advanced by
    /// finalize, another change landed between sessions and the delta can't be honestly attributed.
    #[serde(default)]
    pub ledger_watermark: usize,
}

/// The computed result, surfaced in the next same-game debrief (replaces the insight box).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct ComparisonResult {
    pub rec_id: String,
    pub rec_title: String,
    pub game: String,
    pub baseline_avg_fps: f64,
    pub baseline_low1_fps: f64,
    pub after_avg_fps: f64,
    pub after_low1_fps: f64,
    pub delta_avg_pct: f64,
    pub delta_low1_pct: f64,
    pub noise_floor_pct: f64,
    /// "improved" | "no-change" | "regressed".
    pub verdict: String,
    pub at: String,
}

fn armed_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("compy_comparison.json")
}
fn result_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("compy_comparison_result.json")
}

fn load_armed() -> Option<ArmedComparison> {
    std::fs::read_to_string(armed_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn save_armed(a: &ArmedComparison) -> Result<(), String> {
    std::fs::create_dir_all(crate::compy_data_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(a).map_err(|e| e.to_string())?;
    std::fs::write(armed_path(), json).map_err(|e| e.to_string())
}

fn save_result(r: &ComparisonResult) -> Result<(), String> {
    std::fs::create_dir_all(crate::compy_data_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(r).map_err(|e| e.to_string())?;
    std::fs::write(result_path(), json).map_err(|e| e.to_string())
}

/// Arm a comparison: record the just-debriefed session as the baseline + the fix being applied.
pub(crate) fn arm(
    rec_id: String,
    rec_title: String,
    game: String,
    baseline_avg_fps: f64,
    baseline_low1_fps: f64,
) -> Result<(), String> {
    save_armed(&ArmedComparison {
        rec_id,
        rec_title,
        game,
        baseline_avg_fps,
        baseline_low1_fps,
        armed_at: chrono::Utc::now().to_rfc3339(),
        ledger_watermark: crate::history::ledger_len(),
    })
}

/// Currently-armed comparison, if any — lets the UI confirm before an arm overwrites another.
pub(crate) fn armed() -> Option<ArmedComparison> {
    load_armed()
}

/// Pure verdict from the 1%-low %-delta vs the noise floor — the honest core (no credit inside noise).
pub(crate) fn classify(delta_low1_pct: f64, noise_floor_pct: f64) -> &'static str {
    if delta_low1_pct.abs() <= noise_floor_pct {
        "no-change"
    } else if delta_low1_pct > 0.0 {
        "improved"
    } else {
        "regressed"
    }
}

/// Pure verdict WITH the honesty guards layered over `classify`. Expiry + confound take precedence
/// over the measured delta — no credit when the comparison isn't fair. `ledger_now` and `now` are
/// injected (not read from disk/clock) so this is unit-testable.
pub(crate) fn classify_with_guards(
    armed: &ArmedComparison,
    delta_low1_pct: f64,
    noise_floor_pct: f64,
    ledger_now: usize,
    now: chrono::DateTime<chrono::Utc>,
) -> &'static str {
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&armed.armed_at) {
        if (now - t.with_timezone(&chrono::Utc)).num_days() > ARM_MAX_AGE_DAYS {
            return "expired"; // baseline too old to compare fairly
        }
    }
    if ledger_now > armed.ledger_watermark {
        return "confounded"; // another change landed between sessions
    }
    classify(delta_low1_pct, noise_floor_pct)
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Called after a session finalizes. If a comparison is armed for THIS game, compute + store the
/// result and disarm. A different game leaves the arming intact for its own next session.
pub(crate) fn on_session_finalized(s: &SessionSummary) {
    let Some(armed) = load_armed() else {
        return;
    };
    if s.process_name.is_empty() || armed.game != s.process_name {
        return;
    }
    let pct = |after: f64, base: f64| if base > 0.0 { (after - base) / base * 100.0 } else { 0.0 };
    let delta_low1 = pct(s.low1_fps_est, armed.baseline_low1_fps);
    let nf = DEFAULT_NOISE_FLOOR_PCT;
    // Borrow `armed` for the verdict BEFORE moving its fields into the result struct below.
    let verdict = classify_with_guards(
        &armed,
        delta_low1,
        nf,
        crate::history::ledger_len(),
        chrono::Utc::now(),
    )
    .to_string();
    let result = ComparisonResult {
        rec_id: armed.rec_id,
        rec_title: armed.rec_title,
        game: armed.game,
        baseline_avg_fps: armed.baseline_avg_fps,
        baseline_low1_fps: armed.baseline_low1_fps,
        after_avg_fps: s.avg_fps,
        after_low1_fps: s.low1_fps_est,
        delta_avg_pct: round1(pct(s.avg_fps, armed.baseline_avg_fps)),
        delta_low1_pct: round1(delta_low1),
        noise_floor_pct: nf,
        verdict,
        at: chrono::Utc::now().to_rfc3339(),
    };
    let _ = save_result(&result);
    let _ = std::fs::remove_file(armed_path()); // disarm — the comparison happened
}

pub(crate) fn latest_result() -> Option<ComparisonResult> {
    std::fs::read_to_string(result_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

/// Dismiss the surfaced result (e.g. after the user has seen / acted on it).
pub(crate) fn clear_result() {
    let _ = std::fs::remove_file(result_path());
}

#[cfg(test)]
mod comparison_tests {
    use super::*;

    #[test]
    fn classify_never_claims_a_win_inside_the_noise() {
        assert_eq!(classify(2.0, 3.0), "no-change");
        assert_eq!(classify(-2.5, 3.0), "no-change");
        assert_eq!(classify(3.0, 3.0), "no-change"); // boundary inclusive
        assert_eq!(classify(8.0, 3.0), "improved");
        assert_eq!(classify(-8.0, 3.0), "regressed");
    }

    fn armed_fixture(armed_at: String, watermark: usize) -> ArmedComparison {
        ArmedComparison {
            rec_id: "power-plan".into(),
            rec_title: "Power plan".into(),
            game: "game.exe".into(),
            baseline_avg_fps: 120.0,
            baseline_low1_fps: 80.0,
            armed_at,
            ledger_watermark: watermark,
        }
    }

    #[test]
    fn confound_guard_flags_a_ledger_advance() {
        let now = chrono::Utc::now();
        let armed = armed_fixture(now.to_rfc3339(), 5);
        // Ledger unchanged since arming → the measured verdict stands.
        assert_eq!(classify_with_guards(&armed, 8.0, 3.0, 5, now), "improved");
        // Another change landed between sessions (ledger advanced) → confounded, no credit.
        assert_eq!(classify_with_guards(&armed, 8.0, 3.0, 6, now), "confounded");
    }

    #[test]
    fn arm_expiry_discards_a_stale_baseline() {
        let now = chrono::Utc::now();
        let stale = armed_fixture((now - chrono::Duration::days(ARM_MAX_AGE_DAYS + 1)).to_rfc3339(), 5);
        // A clear improvement with an unchanged ledger is STILL discarded when the baseline's too old.
        assert_eq!(classify_with_guards(&stale, 8.0, 3.0, 5, now), "expired");
        let fresh = armed_fixture((now - chrono::Duration::days(ARM_MAX_AGE_DAYS - 1)).to_rfc3339(), 5);
        assert_eq!(classify_with_guards(&fresh, 8.0, 3.0, 5, now), "improved");
    }

    #[test]
    fn expiry_takes_precedence_over_confound() {
        let now = chrono::Utc::now();
        let stale = armed_fixture((now - chrono::Duration::days(ARM_MAX_AGE_DAYS + 5)).to_rfc3339(), 5);
        assert_eq!(classify_with_guards(&stale, 8.0, 3.0, 99, now), "expired");
    }
}
