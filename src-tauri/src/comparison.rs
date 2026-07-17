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

/// What an armed baseline is measuring. A `Fix` is a Compy-applied rec (one-shot: resolves on the
/// next same-game session, then disarms). A `Tuning` baseline is a user change made in a VENDOR tool
/// (e.g. "I undervolted in Adrenalin") — there is NO Compy apply and nothing in the ledger; it
/// PERSISTS so stability shows over time (honest-measurement law), and the user clears it on re-tune.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ComparisonKind {
    #[default]
    Fix,
    Tuning,
}

/// A comparison armed from a debrief: the baseline session's metrics + the change being measured.
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
    /// Fix (default — back-compat with pre-tuning armed files) vs Tuning.
    #[serde(default)]
    pub kind: ComparisonKind,
    /// Baseline peak GPU temp (°C) — only meaningful for a tuning baseline (the whole point of an
    /// undervolt is the temp drop). None for fix comparisons / pre-tuning files.
    #[serde(default)]
    pub baseline_peak_temp_c: Option<u32>,
    /// Tuning self-check: the debrief asks once "did it crash/hang/artifact?"; a yes is the
    /// honest "too aggressive" signal. Persists on the baseline so the verdict stays reversible.
    #[serde(default)]
    pub crash_reported: bool,
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
    /// "improved" | "no-change" | "regressed" | "confounded" | "expired" — judged on the 1% low.
    pub verdict: String,
    pub at: String,
    /// Fix vs Tuning (back-compat default Fix). Lets the UI render the tuning temp/stability readout.
    #[serde(default)]
    pub kind: ComparisonKind,
    /// Thermal before/after (tuning only) — the undervolt payoff. None for fix comparisons.
    #[serde(default)]
    pub baseline_peak_temp_c: Option<u32>,
    #[serde(default)]
    pub after_peak_temp_c: Option<u32>,
    /// after − baseline (°C). Negative = cooler. None when either temp is missing.
    #[serde(default)]
    pub delta_temp_c: Option<i32>,
    /// Carried from the armed baseline so the surfaced verdict reflects a reported crash.
    #[serde(default)]
    pub crash_reported: bool,
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
        kind: ComparisonKind::Fix,
        baseline_peak_temp_c: None,
        crash_reported: false,
    })
}

/// Arm a TUNING baseline: the user changed something in a vendor tool (no Compy apply, no ledger
/// entry) and wants to measure whether it held up. Reuses the same noise-floor + confound-watermark
/// machinery; the baseline carries its peak temp so the thermal payoff can be measured.
pub(crate) fn arm_tuning(
    guide_id: String,
    label: String,
    game: String,
    baseline_avg_fps: f64,
    baseline_low1_fps: f64,
    baseline_peak_temp_c: Option<u32>,
) -> Result<(), String> {
    save_armed(&ArmedComparison {
        rec_id: guide_id,
        rec_title: label,
        game,
        baseline_avg_fps,
        baseline_low1_fps,
        armed_at: chrono::Utc::now().to_rfc3339(),
        ledger_watermark: crate::history::ledger_len(),
        kind: ComparisonKind::Tuning,
        baseline_peak_temp_c,
        crash_reported: false,
    })
}

/// Record the debrief's crash/hang/artifact self-check for the armed tuning baseline (honest-
/// measurement law). Sets the flag on the baseline AND any already-surfaced result so the verdict
/// flips to "too aggressive" without waiting for another session. No-op unless a tuning baseline is
/// armed. Never fabricates a crash — only the user's explicit "yes" lands here.
pub(crate) fn report_tuning_crash() -> Result<(), String> {
    let Some(mut a) = load_armed() else { return Ok(()) };
    if a.kind != ComparisonKind::Tuning {
        return Ok(());
    }
    a.crash_reported = true;
    save_armed(&a)?;
    if let Some(mut r) = latest_result() {
        if r.kind == ComparisonKind::Tuning {
            r.crash_reported = true;
            let _ = save_result(&r);
        }
    }
    Ok(())
}

/// Disarm a tuning baseline (the user reset/re-tuned). Only touches tuning state — a pending fix
/// comparison is left intact.
pub(crate) fn clear_tuning() {
    if matches!(load_armed(), Some(a) if a.kind == ComparisonKind::Tuning) {
        let _ = std::fs::remove_file(armed_path());
    }
    if matches!(latest_result(), Some(r) if r.kind == ComparisonKind::Tuning) {
        let _ = std::fs::remove_file(result_path());
    }
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

/// after − baseline (°C); negative = cooler. None when either peak temp is missing.
pub(crate) fn temp_delta(baseline: Option<u32>, after: Option<u32>) -> Option<i32> {
    match (baseline, after) {
        (Some(b), Some(a)) => Some(a as i32 - b as i32),
        _ => None,
    }
}

/// A fix comparison is one-shot → disarm after the next session. A tuning baseline PERSISTS so
/// stability shows across the qualifying window; the user clears it on re-tune (honest-measurement law).
pub(crate) fn should_disarm(kind: ComparisonKind) -> bool {
    matches!(kind, ComparisonKind::Fix)
}

/// Pure: build the stored result for `armed` from finalized session `s`. `ledger_now`/`now` injected
/// so it's unit-testable without disk or the clock. Identical math/verdict to the shipped fix loop,
/// plus the tuning thermal deltas + the carried crash flag.
pub(crate) fn build_result(
    armed: &ArmedComparison,
    s: &SessionSummary,
    nf: f64,
    ledger_now: usize,
    now: chrono::DateTime<chrono::Utc>,
) -> ComparisonResult {
    let pct = |after: f64, base: f64| if base > 0.0 { (after - base) / base * 100.0 } else { 0.0 };
    let delta_low1 = pct(s.low1_fps_est, armed.baseline_low1_fps);
    let verdict = classify_with_guards(armed, delta_low1, nf, ledger_now, now).to_string();
    ComparisonResult {
        rec_id: armed.rec_id.clone(),
        rec_title: armed.rec_title.clone(),
        game: armed.game.clone(),
        baseline_avg_fps: armed.baseline_avg_fps,
        baseline_low1_fps: armed.baseline_low1_fps,
        after_avg_fps: s.avg_fps,
        after_low1_fps: s.low1_fps_est,
        delta_avg_pct: round1(pct(s.avg_fps, armed.baseline_avg_fps)),
        delta_low1_pct: round1(delta_low1),
        noise_floor_pct: nf,
        verdict,
        at: now.to_rfc3339(),
        kind: armed.kind,
        baseline_peak_temp_c: armed.baseline_peak_temp_c,
        after_peak_temp_c: s.peak_gpu_temp_c,
        delta_temp_c: temp_delta(armed.baseline_peak_temp_c, s.peak_gpu_temp_c),
        crash_reported: armed.crash_reported,
    }
}

/// Called after a session finalizes. If a comparison is armed for THIS game, compute + store the
/// result. A fix comparison then disarms; a tuning baseline stays armed (keeps measuring). A
/// different game leaves the arming intact for its own next session.
pub(crate) fn on_session_finalized(s: &SessionSummary) {
    let Some(armed) = load_armed() else {
        return;
    };
    if s.process_name.is_empty() || armed.game != s.process_name {
        return;
    }
    let result = build_result(
        &armed,
        s,
        DEFAULT_NOISE_FLOOR_PCT,
        crate::history::ledger_len(),
        chrono::Utc::now(),
    );
    let _ = save_result(&result);
    if should_disarm(armed.kind) {
        let _ = std::fs::remove_file(armed_path()); // the one-shot fix comparison happened
    }
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
            kind: ComparisonKind::Fix,
            baseline_peak_temp_c: None,
            crash_reported: false,
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

    // ── Tuning baseline (spec 2026-06-08) ──────────────────────────────────────────────

    fn session_fixture(low1: f64, peak_temp: Option<u32>) -> SessionSummary {
        SessionSummary {
            started_at: "t".into(),
            duration_secs: 3600,
            process_name: "game.exe".into(),
            samples: 100,
            avg_fps: 140.0,
            avg_frametime_ms: 7.1,
            low1_fps_est: low1,
            peak_gpu_temp_c: peak_temp,
            peak_gpu_usage_pct: Some(98),
            peak_ram_used_bytes: None,
            ram_total_bytes: None,
            compy_changes_active: 0,
            hw_fingerprint: None,
            gaming_mode_active: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
            fps_series: Vec::new(),
        }
    }

    fn tuning_fixture(peak_temp: Option<u32>) -> ArmedComparison {
        ArmedComparison {
            rec_id: "amd-gpu-undervolt".into(),
            rec_title: "Undervolt (Adrenalin)".into(),
            game: "game.exe".into(),
            baseline_avg_fps: 138.0,
            baseline_low1_fps: 80.0,
            armed_at: chrono::Utc::now().to_rfc3339(),
            ledger_watermark: 0,
            kind: ComparisonKind::Tuning,
            baseline_peak_temp_c: peak_temp,
            crash_reported: false,
        }
    }

    #[test]
    fn temp_delta_is_signed_or_none() {
        assert_eq!(temp_delta(Some(84), Some(71)), Some(-13)); // cooler
        assert_eq!(temp_delta(Some(70), Some(73)), Some(3)); // warmer
        assert_eq!(temp_delta(None, Some(71)), None);
        assert_eq!(temp_delta(Some(84), None), None);
    }

    #[test]
    fn only_fix_comparisons_disarm() {
        assert!(should_disarm(ComparisonKind::Fix));
        assert!(!should_disarm(ComparisonKind::Tuning)); // tuning persists across the window
    }

    #[test]
    fn build_result_carries_tuning_thermals_and_fps_verdict() {
        let now = chrono::Utc::now();
        let armed = tuning_fixture(Some(84));
        // 1% low held inside the noise floor; peak temp dropped 84 → 71.
        let r = build_result(&armed, &session_fixture(81.0, Some(71)), 3.0, 0, now);
        assert_eq!(r.kind, ComparisonKind::Tuning);
        assert_eq!(r.baseline_peak_temp_c, Some(84));
        assert_eq!(r.after_peak_temp_c, Some(71));
        assert_eq!(r.delta_temp_c, Some(-13));
        assert_eq!(r.verdict, "no-change"); // FPS judged on the existing noise floor — held, no win
        assert!(!r.crash_reported);
    }

    #[test]
    fn build_result_flags_an_fps_regression_past_the_floor() {
        let now = chrono::Utc::now();
        let armed = tuning_fixture(Some(84));
        // 1% low 80 → 70 = −12.5%, well past the 3% floor → "too aggressive" signal upstream.
        let r = build_result(&armed, &session_fixture(70.0, Some(72)), 3.0, 0, now);
        assert_eq!(r.verdict, "regressed");
        assert_eq!(r.delta_temp_c, Some(-12));
    }

    #[test]
    fn build_result_carries_a_reported_crash() {
        let now = chrono::Utc::now();
        let mut armed = tuning_fixture(Some(84));
        armed.crash_reported = true;
        let r = build_result(&armed, &session_fixture(81.0, Some(71)), 3.0, 0, now);
        assert!(r.crash_reported, "a reported crash rides into the result");
    }

    #[test]
    fn pre_tuning_armed_files_deserialize_with_defaults() {
        // A fix-era armed file (no kind/temp/crash fields) must still parse — back-compat.
        let legacy = r#"{
            "rec_id":"power-plan","rec_title":"Power plan","game":"g.exe",
            "baseline_avg_fps":120.0,"baseline_low1_fps":80.0,
            "armed_at":"2026-06-01T00:00:00Z","ledger_watermark":3
        }"#;
        let a: ArmedComparison = serde_json::from_str(legacy).unwrap();
        assert_eq!(a.kind, ComparisonKind::Fix); // default
        assert_eq!(a.baseline_peak_temp_c, None);
        assert!(!a.crash_reported);
    }
}
