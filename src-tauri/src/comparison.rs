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

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::sessions::SessionSummary;

/// Default session-to-session run-to-run variance (%); the 1% low is the primary signal. Owner-
/// tunable later; matches the benchmark engine's conservative 3% floor. `pub(crate)` so the
/// experiment engine (Intelligence Phase 3) references the ONE 3% floor rather than re-declaring it.
pub(crate) const DEFAULT_NOISE_FLOOR_PCT: f64 = 3.0;

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
    /// Trust-Ledger entry count at arm time — the confound watermark. If the ledger does not read
    /// EXACTLY this at finalize, it is not the ledger this baseline was measured against, and the
    /// delta can't be honestly attributed. Arming refuses outright when the count can't be read, so
    /// this number is always a real reading and never a fallback.
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

// #283 — ONE lock for both of this module's files, because every racy sequence here spans them:
// `report_tuning_crash` flips a flag on the armed baseline AND on the surfaced result, and
// `on_session_finalized` / `clear_tuning` decide whether to DELETE the armed file based on what they
// just read from it. Two locks could not make that decision atomic; one can.
//
// This covers the arm paths too even though `arm`/`arm_tuning` write unconditionally and so cannot
// lose an update on their own — an arm landing between another caller's read and its
// `remove_file(armed_path())` would be deleted by a decision made about a DIFFERENT arm, which is
// the same lost-write with an extra step.
//
// `arm_watermark` → `history::ledger_len_checked` → `load_history` is the one call out of a locked
// section, and it is safe: `load_history` takes no lock, and `history.rs` calls nothing in this
// module (or in drift/readiness), so there is no back edge and no cycle.
static COMPARISON_LOCK: Mutex<()> = Mutex::new(());

/// #283 — the read-then-act seams below are microseconds wide, so a test that merely races two
/// threads at them passes whether or not the lock is there. That is the "green that is not
/// evidence" shape, and it was caught here by falsifying: the first draft of these tests stayed
/// green with every acquisition removed.
///
/// So the seam is widened DELIBERATELY, and only when a test arms it. `#[cfg(test)]`, default off,
/// compiled out of production entirely. The widening does not create the race — it makes the race
/// that is already there land every run instead of once in a thousand.
#[cfg(test)]
static WIDEN_RACE_SEAM: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Called only from INSIDE a locked section, at the point between reading the armed store and
/// acting on what was read. With the lock this merely delays the other thread; without it, the
/// other thread's write lands squarely in the window and the assertion fires.
#[cfg(test)]
fn widen_race_seam() {
    if WIDEN_RACE_SEAM.load(std::sync::atomic::Ordering::Acquire) {
        std::thread::sleep(std::time::Duration::from_millis(60));
    }
}

#[cfg(not(test))]
#[inline(always)]
fn widen_race_seam() {}

fn armed_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("compy_comparison.json")
}
fn result_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("compy_comparison_result.json")
}

fn load_armed() -> Option<ArmedComparison> {
    load_armed_from(&armed_path())
}

/// Unchanged `Option` semantics, lifted to a path so they can be proven without the real data root:
/// missing and corrupt both mean `None` — "nothing is armed" — never an error.
fn load_armed_from(path: &std::path::Path) -> Option<ArmedComparison> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn save_armed_to(path: &std::path::Path, a: &ArmedComparison) -> Result<(), String> {
    let json = crate::atomic_write::serialize_pretty(a).map_err(|e| e.to_string())?;
    crate::atomic_write::write_atomic(path, json.as_bytes()).map_err(|e| e.to_string())
}

fn save_result_to(path: &std::path::Path, r: &ComparisonResult) -> Result<(), String> {
    let json = crate::atomic_write::serialize_pretty(r).map_err(|e| e.to_string())?;
    crate::atomic_write::write_atomic(path, json.as_bytes()).map_err(|e| e.to_string())
}

/// The watermark an arm is allowed to bank. An unreadable ledger REFUSES to arm rather than banking
/// a fabricated number — a count that was never really read cannot later prove the next session
/// measured the same machine. Every arm path in the app goes through here (both of this module's,
/// plus the experiment engine's) so none of them can quietly reintroduce a fallback.
pub(crate) fn arm_watermark() -> Result<usize, String> {
    crate::history::ledger_len_checked().map_err(|e| {
        format!("can't arm a before/after comparison — the change history is unreadable, so a later result could never be proven fair: {e}")
    })
}

/// Arm a comparison: record the just-debriefed session as the baseline + the fix being applied.
pub(crate) fn arm(
    rec_id: String,
    rec_title: String,
    game: String,
    baseline_avg_fps: f64,
    baseline_low1_fps: f64,
) -> Result<(), String> {
    std::fs::create_dir_all(crate::compy_data_dir()).map_err(|e| e.to_string())?;
    arm_at(
        &armed_path(),
        ArmedComparison {
            rec_id,
            rec_title,
            game,
            baseline_avg_fps,
            baseline_low1_fps,
            armed_at: chrono::Utc::now().to_rfc3339(),
            ledger_watermark: arm_watermark()?,
            kind: ComparisonKind::Fix,
            baseline_peak_temp_c: None,
            crash_reported: false,
        },
    )
}

/// The armed-store write, lifted to a path and holding the same lock every other armed-store
/// sequence holds. `arm` cannot lose an update on its own — it writes unconditionally — but it must
/// take the lock anyway so that `clear_tuning_at` and `on_session_finalized_at` cannot delete an arm
/// that landed after they read. Lifted so #283's lock is proven against a scratch file.
fn arm_at(path: &std::path::Path, a: ArmedComparison) -> Result<(), String> {
    let _lock = COMPARISON_LOCK
        .lock()
        .map_err(|_| "comparison lock poisoned".to_string())?;
    save_armed_to(path, &a)
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
    std::fs::create_dir_all(crate::compy_data_dir()).map_err(|e| e.to_string())?;
    arm_at(
        &armed_path(),
        ArmedComparison {
            rec_id: guide_id,
            rec_title: label,
            game,
            baseline_avg_fps,
            baseline_low1_fps,
            armed_at: chrono::Utc::now().to_rfc3339(),
            ledger_watermark: arm_watermark()?,
            kind: ComparisonKind::Tuning,
            baseline_peak_temp_c,
            crash_reported: false,
        },
    )
}

/// Record the debrief's crash/hang/artifact self-check for the armed tuning baseline (honest-
/// measurement law). Sets the flag on the baseline AND any already-surfaced result so the verdict
/// flips to "too aggressive" without waiting for another session. No-op unless a tuning baseline is
/// armed. Never fabricates a crash — only the user's explicit "yes" lands here.
pub(crate) fn report_tuning_crash() -> Result<(), String> {
    std::fs::create_dir_all(crate::compy_data_dir()).map_err(|e| e.to_string())?;
    report_tuning_crash_at(&armed_path(), &result_path())
}

/// Both paths, because this sequence spans both files: the flag must land on the armed baseline and
/// on the surfaced result as ONE atomic step, or a reader between the two writes sees a crash
/// reported on one and not the other. Lifted to paths so #283's lock is proven against scratch
/// files rather than the real data root.
fn report_tuning_crash_at(
    armed: &std::path::Path,
    result: &std::path::Path,
) -> Result<(), String> {
    let _lock = COMPARISON_LOCK
        .lock()
        .map_err(|_| "comparison lock poisoned".to_string())?;
    let Some(mut a) = load_armed_from(armed) else { return Ok(()) };
    if a.kind != ComparisonKind::Tuning {
        return Ok(());
    }
    widen_race_seam(); // compiled out of production; see WIDEN_RACE_SEAM
    a.crash_reported = true;
    save_armed_to(armed, &a)?;
    if let Some(mut r) = latest_result_from(result) {
        if r.kind == ComparisonKind::Tuning {
            r.crash_reported = true;
            let _ = save_result_to(result, &r);
        }
    }
    Ok(())
}

/// Disarm a tuning baseline (the user reset/re-tuned). Only touches tuning state — a pending fix
/// comparison is left intact.
pub(crate) fn clear_tuning() {
    clear_tuning_at(&armed_path(), &result_path());
}

/// Path-parameterized for the same reason as [`report_tuning_crash_at`]. This one is a
/// check-then-act, not a load-modify-save: without the lock an `arm` landing between the `matches!`
/// and the `remove_file` is deleted by a decision made about a DIFFERENT arm.
fn clear_tuning_at(armed: &std::path::Path, result: &std::path::Path) {
    // Best-effort, returning nothing, unchanged: recover a poisoned guard rather than skip the
    // lock, so a panic elsewhere cannot quietly un-serialize this check-then-delete.
    let _lock = COMPARISON_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let tuning_armed = matches!(load_armed_from(armed), Some(a) if a.kind == ComparisonKind::Tuning);
    widen_race_seam(); // compiled out of production; see WIDEN_RACE_SEAM
    if tuning_armed {
        let _ = std::fs::remove_file(armed);
    }
    if matches!(latest_result_from(result), Some(r) if r.kind == ComparisonKind::Tuning) {
        let _ = std::fs::remove_file(result);
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
/// injected (not read from disk/clock) so this is unit-testable. `ledger_now` is `None` when the
/// ledger could not be read at all.
pub(crate) fn classify_with_guards(
    armed: &ArmedComparison,
    delta_low1_pct: f64,
    noise_floor_pct: f64,
    ledger_now: Option<usize>,
    now: chrono::DateTime<chrono::Utc>,
) -> &'static str {
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&armed.armed_at) {
        if (now - t.with_timezone(&chrono::Utc)).num_days() > ARM_MAX_AGE_DAYS {
            return "expired"; // baseline too old to compare fairly
        }
    }
    // The watermark's contract is "the SAME ledger", so the test is equality, not growth. A `>` test
    // only caught the ledger GROWING, and the reading that actually happens in the field is the
    // opposite: `load_history_from` quarantines a corrupt ledger to `history.json.corrupt`, after
    // which every load returns empty forever. That reads BELOW the watermark, so `>` called it
    // "nothing landed" and credited the delta — while real changes were landing into the fresh
    // ledger, unseen. `None` (unreadable) is the same refusal for the same reason: no reading at all
    // can prove the comparison was fair.
    if ledger_now != Some(armed.ledger_watermark) {
        return "confounded"; // not the ledger this baseline was measured against
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
    ledger_now: Option<usize>,
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
    on_session_finalized_at(&armed_path(), &result_path(), s);
}

/// Path-parameterized for the same reason as [`report_tuning_crash_at`]. The disarm at the end
/// deletes the armed file based on what was read at the top, so the read and the delete have to be
/// one step: an arm landing in between would otherwise be disarmed by a session it never measured.
fn on_session_finalized_at(
    armed_path_: &std::path::Path,
    result_path_: &std::path::Path,
    s: &SessionSummary,
) {
    // Same best-effort shape as the rest of this path (`let _ = save_result(..)`): a finalize must
    // not fail because another thread panicked.
    let _lock = COMPARISON_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let Some(armed) = load_armed_from(armed_path_) else {
        return;
    };
    widen_race_seam(); // compiled out of production; see WIDEN_RACE_SEAM
    if s.process_name.is_empty() || armed.game != s.process_name {
        return;
    }
    let result = build_result(
        &armed,
        s,
        DEFAULT_NOISE_FLOOR_PCT,
        // `.ok()` here is the honest direction, not a collapse: an unreadable ledger becomes `None`,
        // which the guard above refuses to attribute. It is never silently treated as a count.
        //
        // #283: this is the ONE call out of a locked section in this module. It is safe because
        // `load_history` takes no lock and `history.rs` calls nothing here, so there is no back edge
        // and the lock graph stays acyclic.
        crate::history::ledger_len_checked().ok(),
        chrono::Utc::now(),
    );
    let _ = save_result_to(result_path_, &result);
    if should_disarm(armed.kind) {
        let _ = std::fs::remove_file(armed_path_); // the one-shot fix comparison happened
    }
}

pub(crate) fn latest_result() -> Option<ComparisonResult> {
    latest_result_from(&result_path())
}

/// Same `Option` semantics as [`load_armed_from`], lifted to a path for the same reason.
fn latest_result_from(path: &std::path::Path) -> Option<ComparisonResult> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

/// Dismiss the surfaced result (e.g. after the user has seen / acted on it).
pub(crate) fn clear_result() {
    clear_result_at(&result_path());
}

/// Clearing DELETES; it does not write, so it never goes through the atomic helper — a "consistency"
/// sweep that turned this into a write of empty bytes would leave a file that parses as nothing but
/// still exists. Lifted to a path so that stays provable.
fn clear_result_at(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
}

/// #281 — the armed store's `Option` semantics and `clear_result` are UNCHANGED by the
/// atomic-write lane. Explicit temp paths only; nothing reads the real data root.
#[cfg(test)]
mod comparison_persistence_tests {
    use super::*;

    fn scratch(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "compy-cmp-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn armed(at: &str) -> ArmedComparison {
        ArmedComparison {
            rec_id: "r".into(),
            rec_title: "t".into(),
            game: "g".into(),
            baseline_avg_fps: 100.0,
            baseline_low1_fps: 80.0,
            armed_at: at.into(),
            ledger_watermark: 3,
            kind: ComparisonKind::Tuning,
            baseline_peak_temp_c: Some(71),
            crash_reported: false,
        }
    }

    #[test]
    fn missing_and_corrupt_both_read_as_none_never_an_error() {
        let dir = scratch("none");
        assert!(load_armed_from(&dir.join("absent.json")).is_none());

        let p = dir.join("compy_comparison.json");
        std::fs::write(&p, "{\"rec_id\": \"r\", \"baseline_avg").unwrap();
        assert!(
            load_armed_from(&p).is_none(),
            "a truncated arm was read as an armed comparison"
        );
    }

    #[test]
    fn an_armed_comparison_round_trips_and_replaces_the_previous_one_whole() {
        let p = scratch("round").join("compy_comparison.json");
        save_armed_to(&p, &armed("first-and-much-longer-than-the-second")).expect("first");
        save_armed_to(&p, &armed("second")).expect("second");
        let got = load_armed_from(&p).expect("armed");
        assert_eq!(got.armed_at, "second");
        assert_eq!(got.ledger_watermark, 3, "the watermark did not survive");
        assert_eq!(got.kind, ComparisonKind::Tuning);
        assert_eq!(got.baseline_peak_temp_c, Some(71));
    }

    #[test]
    fn a_failed_save_leaves_the_previous_arm_armed() {
        // The dangerous outcome this lane removes: a half-written arm that loads as `None` looks
        // exactly like "nothing was ever armed", so the baseline is silently lost.
        let p = scratch("failed").join("compy_comparison.json");
        save_armed_to(&p, &armed("keep-me")).expect("first");
        crate::atomic_write::force_next_failure(crate::atomic_write::FailPoint::BeforeRename);
        assert!(
            save_armed_to(&p, &armed("clobber")).is_err(),
            "the save did not go through the atomic write path"
        );
        assert_eq!(load_armed_from(&p).expect("still armed").armed_at, "keep-me");
    }

    fn result(verdict: &str) -> ComparisonResult {
        ComparisonResult {
            rec_id: "r".into(),
            rec_title: "t".into(),
            game: "g".into(),
            baseline_avg_fps: 100.0,
            baseline_low1_fps: 80.0,
            after_avg_fps: 104.0,
            after_low1_fps: 88.0,
            delta_avg_pct: 4.0,
            delta_low1_pct: 10.0,
            noise_floor_pct: DEFAULT_NOISE_FLOOR_PCT,
            verdict: verdict.into(),
            at: "2026-08-31T00:00:00Z".into(),
            kind: ComparisonKind::Fix,
            baseline_peak_temp_c: None,
            after_peak_temp_c: None,
            delta_temp_c: None,
            crash_reported: false,
        }
    }

    #[test]
    fn a_result_round_trips_and_a_corrupt_one_surfaces_nothing() {
        let p = scratch("result").join("compy_comparison_result.json");
        save_result_to(&p, &result("improved")).expect("save");
        assert_eq!(latest_result_from(&p).expect("result").verdict, "improved");
        assert_eq!(latest_result_from(&p).unwrap().noise_floor_pct, 3.0);

        std::fs::write(&p, "{\"verdict\": \"impro").unwrap();
        assert!(
            latest_result_from(&p).is_none(),
            "a truncated result was surfaced to the user"
        );
    }

    #[test]
    fn a_failed_result_save_leaves_the_previous_verdict_readable() {
        // The armed store and the result store are two separate call sites; this pins the second,
        // so converting only one of them back to `std::fs::write` still turns a test red.
        let p = scratch("result-failed").join("compy_comparison_result.json");
        save_result_to(&p, &result("improved")).expect("first");
        crate::atomic_write::force_next_failure(crate::atomic_write::FailPoint::BeforeRename);
        assert!(
            save_result_to(&p, &result("regressed")).is_err(),
            "the save did not go through the atomic write path"
        );
        assert_eq!(latest_result_from(&p).expect("result").verdict, "improved");
    }

    #[test]
    fn serialization_failures_preserve_both_comparison_stores_without_a_temp() {
        let dir = scratch("serialize-failed");
        let armed_path = dir.join("compy_comparison.json");
        save_armed_to(&armed_path, &armed("keep-arm")).expect("first arm");
        crate::atomic_write::force_next_serialization_failure();
        let err = save_armed_to(&armed_path, &armed("clobber"))
            .expect_err("armed serialization failure must surface");
        assert!(err.contains("injected serialization failure"), "got: {err}");
        assert_eq!(load_armed_from(&armed_path).unwrap().armed_at, "keep-arm");

        let result_path = dir.join("compy_comparison_result.json");
        save_result_to(&result_path, &result("improved")).expect("first result");
        crate::atomic_write::force_next_serialization_failure();
        let err = save_result_to(&result_path, &result("regressed"))
            .expect_err("result serialization failure must surface");
        assert!(err.contains("injected serialization failure"), "got: {err}");
        assert_eq!(latest_result_from(&result_path).unwrap().verdict, "improved");
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
    fn windows_share_locks_surface_both_comparison_errors_and_preserve_old_values() {
        let dir = scratch("locked");
        let armed_path = dir.join("compy_comparison.json");
        save_armed_to(&armed_path, &armed("keep-arm")).expect("first arm");
        let held = crate::atomic_write::hold_without_share(&armed_path);
        assert!(save_armed_to(&armed_path, &armed("clobber")).is_err());
        drop(held);
        assert_eq!(load_armed_from(&armed_path).unwrap().armed_at, "keep-arm");

        let result_path = dir.join("compy_comparison_result.json");
        save_result_to(&result_path, &result("improved")).expect("first result");
        let held = crate::atomic_write::hold_without_share(&result_path);
        assert!(save_result_to(&result_path, &result("regressed")).is_err());
        drop(held);
        assert_eq!(latest_result_from(&result_path).unwrap().verdict, "improved");
    }

    #[test]
    fn clearing_removes_the_result_and_stays_harmless_when_it_is_already_gone() {
        // Clearing deletes; it does not write. Pinned so a later "consistency" sweep cannot convert
        // it into a write of empty bytes, which would leave a file that parses as nothing but still
        // exists — and `latest_result` would go on being asked to parse it forever.
        let p = scratch("clear").join("compy_comparison_result.json");
        save_result_to(&p, &result("no-change")).expect("save");
        clear_result_at(&p);
        assert!(!p.exists(), "the result file survived clearing");
        clear_result_at(&p);
        assert!(!p.exists(), "clearing an absent result must stay harmless");
    }
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
        assert_eq!(classify_with_guards(&armed, 8.0, 3.0, Some(5), now), "improved");
        // Another change landed between sessions (ledger advanced) → confounded, no credit.
        assert_eq!(classify_with_guards(&armed, 8.0, 3.0, Some(6), now), "confounded");
    }

    #[test]
    fn a_ledger_that_is_not_the_armed_one_can_never_read_as_unchanged() {
        // The watermark's contract is "the SAME ledger", not "a ledger that hasn't grown". The
        // Trust Ledger is append-only in code, so any difference at all means a different ledger —
        // and the difference that actually happens in the field is DOWNWARD: `load_history_from`
        // quarantines a corrupt ledger to `history.json.corrupt`, after which every load returns an
        // empty vec forever, indistinguishable from first run. A `>` test read that as "nothing
        // landed" and credited the delta to the armed change, which is the precise false
        // attribution the watermark exists to prevent (Q9 acceptance: "before/after attribution
        // never credits one change when several changed").
        let now = chrono::Utc::now();
        let armed = armed_fixture(now.to_rfc3339(), 3);
        assert_eq!(classify_with_guards(&armed, 8.0, 3.0, Some(0), now), "confounded");
        // And an outright unreadable ledger is the strictest case of the same thing: no reading at
        // all can prove the comparison was fair, so no credit is given.
        assert_eq!(classify_with_guards(&armed, 8.0, 3.0, None, now), "confounded");
    }

    #[test]
    fn arm_expiry_discards_a_stale_baseline() {
        let now = chrono::Utc::now();
        let stale = armed_fixture((now - chrono::Duration::days(ARM_MAX_AGE_DAYS + 1)).to_rfc3339(), 5);
        // A clear improvement with an unchanged ledger is STILL discarded when the baseline's too old.
        assert_eq!(classify_with_guards(&stale, 8.0, 3.0, Some(5), now), "expired");
        let fresh = armed_fixture((now - chrono::Duration::days(ARM_MAX_AGE_DAYS - 1)).to_rfc3339(), 5);
        assert_eq!(classify_with_guards(&fresh, 8.0, 3.0, Some(5), now), "improved");
    }

    #[test]
    fn expiry_takes_precedence_over_confound() {
        let now = chrono::Utc::now();
        let stale = armed_fixture((now - chrono::Duration::days(ARM_MAX_AGE_DAYS + 5)).to_rfc3339(), 5);
        assert_eq!(classify_with_guards(&stale, 8.0, 3.0, Some(99), now), "expired");
        // …and over an unreadable ledger too — the oldest defect wins, so the message names the
        // reason the user can act on (re-measure a fresh baseline).
        assert_eq!(classify_with_guards(&stale, 8.0, 3.0, None, now), "expired");
    }

    // ── Tuning baseline (spec 2026-06-08) ──────────────────────────────────────────────

    pub(super) fn session_fixture(low1: f64, peak_temp: Option<u32>) -> SessionSummary {
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
            capture_capabilities: None,
            game_state: None,
            peak_cpu_temp_c: None,
            peak_gpu_hotspot_temp_c: None,
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
        let r = build_result(&armed, &session_fixture(81.0, Some(71)), 3.0, Some(0), now);
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
        let r = build_result(&armed, &session_fixture(70.0, Some(72)), 3.0, Some(0), now);
        assert_eq!(r.verdict, "regressed");
        assert_eq!(r.delta_temp_c, Some(-12));
    }

    #[test]
    fn build_result_carries_a_reported_crash() {
        let now = chrono::Utc::now();
        let mut armed = tuning_fixture(Some(84));
        armed.crash_reported = true;
        let r = build_result(&armed, &session_fixture(81.0, Some(71)), 3.0, Some(0), now);
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

/// #283 — LOST UPDATE / TOCTOU. Every racy sequence in this module reads the armed store and then
/// acts on what it read — deleting it, or writing a modified copy of it back. An arm that lands in
/// between is destroyed by a decision made about a DIFFERENT arm. These tests call the shipping
/// `*_at` critical sections, not lookalikes.
///
/// All three assert the SAME user-visible harm, because it is the one #283 describes: the user armed
/// a comparison and it silently vanished.
///
/// FALSIFIED BEFORE TRUSTED. With the `COMPARISON_LOCK` acquisitions removed, all three fail. They
/// are deterministic rather than probabilistic: each arms `WIDEN_RACE_SEAM`, which holds the seam
/// open for 60ms from inside the critical section, so the interleaving lands every run instead of
/// once in a thousand. The widening does not create the defect — removing only the lock, with the
/// widening left in place, is what turns these red.
#[cfg(test)]
mod comparison_race_tests {
    use super::*;
    use std::sync::atomic::Ordering;

    /// Arms the deliberate seam for one test and disarms it on the way out even if the test panics,
    /// so a failure can never leave another test's timing altered.
    /// The flag is process-global and the harness runs these three in parallel, so they take turns:
    /// without the gate, one test's `drop` could disarm the seam while another is still inside it,
    /// and that test would then pass for the wrong reason — with or without the lock.
    static SEAM_GATE: Mutex<()> = Mutex::new(());

    struct WidenedSeam(#[allow(dead_code)] std::sync::MutexGuard<'static, ()>);
    impl WidenedSeam {
        fn arm() -> Self {
            let gate = SEAM_GATE.lock().unwrap_or_else(|p| p.into_inner());
            WIDEN_RACE_SEAM.store(true, Ordering::Release);
            WidenedSeam(gate)
        }
    }
    impl Drop for WidenedSeam {
        fn drop(&mut self) {
            WIDEN_RACE_SEAM.store(false, Ordering::Release);
        }
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::AtomicUsize;
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "compy-cmp-race-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn armed_of(kind: ComparisonKind, tag: &str) -> ArmedComparison {
        ArmedComparison {
            rec_id: tag.to_string(),
            rec_title: tag.to_string(),
            game: "game.exe".to_string(),
            baseline_avg_fps: 100.0,
            baseline_low1_fps: 80.0,
            armed_at: "2026-09-07T00:00:00Z".to_string(),
            ledger_watermark: 0,
            kind,
            baseline_peak_temp_c: None,
            crash_reported: false,
        }
    }

    /// Runs `first` (which will sit in the widened seam) and, 20ms later, arms a Fix baseline, then
    /// returns whatever arm is left on disk. 20ms is comfortably inside the 60ms seam and
    /// comfortably after `first` has entered it.
    fn arm_lands_mid_seam(
        armed: &std::path::Path,
        first: impl FnOnce() + Send,
    ) -> Option<ArmedComparison> {
        let _seam = WidenedSeam::arm();
        std::thread::scope(|scope| {
            scope.spawn(first);
            std::thread::sleep(std::time::Duration::from_millis(20));
            let a = armed.to_path_buf();
            scope.spawn(move || {
                arm_at(&a, armed_of(ComparisonKind::Fix, "landed-during")).unwrap();
            });
        });
        load_armed_from(armed)
    }

    fn assert_survived(left: Option<ArmedComparison>, who: &str) {
        let left = left.unwrap_or_else(|| {
            panic!("the user's Fix arm was destroyed by a concurrent {who}: nothing is armed")
        });
        assert_eq!(
            left.rec_id, "landed-during",
            "the user's Fix arm was overwritten by a concurrent {who} acting on state it had \
             already read"
        );
    }

    /// `clear_tuning` is documented: "Only touches tuning state — a pending fix comparison is left
    /// intact." Serialized, the arm either happens before the clear (which then sees a Fix and
    /// leaves it) or after it. Unserialized, the clear removes an arm that did not exist when it
    /// decided a removal was allowed.
    #[test]
    fn clear_tuning_never_deletes_a_fix_arm_that_landed_during_the_check() {
        let dir = scratch("clear");
        let (armed, result) = (
            dir.join("compy_comparison.json"),
            dir.join("compy_comparison_result.json"),
        );
        arm_at(&armed, armed_of(ComparisonKind::Tuning, "tuning")).unwrap();

        let (a, r) = (armed.clone(), result.clone());
        let left = arm_lands_mid_seam(&armed, move || clear_tuning_at(&a, &r));
        assert_survived(left, "clear_tuning");
    }

    /// A finalize disarms the one-shot Fix comparison it just measured. An arm landing after that
    /// read must not be disarmed by a session that never measured it.
    #[test]
    fn a_finalize_never_disarms_an_arm_that_landed_after_it_read() {
        let dir = scratch("finalize");
        let (armed, result) = (
            dir.join("compy_comparison.json"),
            dir.join("compy_comparison_result.json"),
        );
        arm_at(&armed, armed_of(ComparisonKind::Fix, "measured")).unwrap();

        let (a, r) = (armed.clone(), result.clone());
        let left = arm_lands_mid_seam(&armed, move || {
            on_session_finalized_at(&a, &r, &super::comparison_tests::session_fixture(80.0, None))
        });
        assert_survived(left, "session finalize");
    }

    /// `report_tuning_crash` is a load-modify-save on the armed store — the classic lost update. An
    /// arm landing between its read and its write is overwritten by a stale copy carrying the flag.
    #[test]
    fn a_crash_report_never_writes_a_stale_arm_over_a_newer_one() {
        let dir = scratch("crash");
        let (armed, result) = (
            dir.join("compy_comparison.json"),
            dir.join("compy_comparison_result.json"),
        );
        arm_at(&armed, armed_of(ComparisonKind::Tuning, "tuning")).unwrap();

        let (a, r) = (armed.clone(), result.clone());
        let left = arm_lands_mid_seam(&armed, move || {
            report_tuning_crash_at(&a, &r).unwrap();
        });
        assert_survived(left, "crash report");
    }
}
