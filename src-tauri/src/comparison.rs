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

/// Measurement item 8: what an armed Fix/Tuning comparison is judged on. Never the fixed 3%: this
/// game's measured as-is band at the baseline session (`noise_floor::measure_game_noise`, the one
/// source Trials and "what changed?" judge on: same rig, driver, Windows build, change counts and cap
/// state, at least `noise_floor::MIN_UNCHANGED_SESSIONS` sessions), or nothing, and then no verdict.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ArmNoise {
    /// The band measured for the baseline session; the after-session read the same cap state.
    Measured(crate::noise_floor::GameNoise),
    /// No band for this comparison ([`UNMEASURED_NOISE`] or [`UNMEASURED_CAP`]): the result shows the
    /// numbers and calls nothing better or worse.
    Unmeasured(&'static str),
}

/// The game's noise between as-is sessions isn't measured for this baseline (too few such sessions,
/// the baseline session not found, its cap state unreadable, or a change history that can't be read).
pub(crate) const UNMEASURED_NOISE: &str = "noise-unmeasured";
/// The after-session's frame-cap state differs from the baseline's, or can't be read.
pub(crate) const UNMEASURED_CAP: &str = "frame-cap-changed";
/// The baseline and after-session aren't comparable, or share no recorded conditions
/// (`comparability::derive`, the check a Trial refuses on): a band measured in one context doesn't
/// judge a session played in another.
pub(crate) const UNMEASURED_CONDITIONS: &str = "not-comparable";

/// Owner-tunable: an armed baseline older than this (days) at finalize is too stale to compare
/// fairly — drivers/games/Windows move on, so we discard rather than attribute a misleading delta.
/// Real play reads its as-is sessions by the same age (`realplay`).
pub(crate) const ARM_MAX_AGE_DAYS: i64 = 14;

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
    /// Ledger rows not rolled back at arm time (codebase review 2026-11-02). An undo changes a row's
    /// status and leaves the entry count alone, so the count alone credited a delta measured after a
    /// change, the fix itself included, was undone. Read from the recorded status, never a live
    /// probe, so a setting Windows reverted on its own doesn't read as an undo. `None` on an arm
    /// written before this existed: that arm keeps the count-only check.
    #[serde(default)]
    pub ledger_active: Option<usize>,
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
    /// The 1% low band the verdict used (a rise; a fall is judged at `noise_floor::fall_pct` of it).
    /// 0 when the verdict is "unmeasured" (item 8: no band for this comparison, see `unmeasured`).
    pub noise_floor_pct: f64,
    /// "improved" | "no-change" | "regressed" | "confounded" | "expired" | "unmeasured" (item 8: no
    /// measured band, see `unmeasured`) — judged on the 1% low.
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
    /// Item 8: this game's measured as-is band the verdict was judged on. Additive: `None` on an
    /// older result (judged on the fixed 3%) and when no band was measured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_noise: Option<crate::noise_floor::GameNoise>,
    /// Item 8: why no band judged this comparison ([`UNMEASURED_NOISE`] / [`UNMEASURED_CAP`]); set
    /// exactly when the verdict is "unmeasured".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unmeasured: Option<String>,
    /// Item 8 (opus r1): the fall that matches the band (`noise_floor::fall_pct`), the one a
    /// "regressed" is judged on, so every surface reads the same number. Set with `game_noise`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub noise_fall_pct: Option<f64>,
    /// CR-debrief-assumed-label: the read-only label for a better/worse judged on the old fixed band
    /// ([`assumed_band_for`]), attached by the read command with this game's noise as measured now.
    /// Never stored: always `None` on disk, never read from it.
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub assumed_band: Option<crate::experiment::AssumedBandLabel>,
}

/// CR-debrief-assumed-label, PURE: the label for a stored result whose better/worse was judged on the
/// old fixed band (no `game_noise`: written before Compy measured each game's noise), with
/// `measured_now` as the game's noise today (`None` = still not measured). A "no change", a result
/// judged on a measured band, and every other verdict get none. The result itself is never rewritten.
pub(crate) fn assumed_band_for(
    r: &ComparisonResult,
    measured_now: Option<&crate::noise_floor::GameNoise>,
) -> Option<crate::experiment::AssumedBandLabel> {
    let claimed = matches!(r.verdict.as_str(), "improved" | "regressed");
    if !claimed || r.game_noise.is_some() || !(r.noise_floor_pct.is_finite() && r.noise_floor_pct > 0.0) {
        return None;
    }
    Some(crate::experiment::AssumedBandLabel {
        assumed_pct: r.noise_floor_pct,
        measured_low1_pct: measured_now.map(|n| n.low1_band_pct),
        measured_sessions: measured_now.map(|n| n.sessions),
        claimed_change: true,
        judged: true,
    })
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
// LOCK ORDER, corrected by PR #395's independent review. An earlier draft of this comment claimed
// the one call out of a locked section was `arm_watermark` and that it acquired nothing. Both halves
// were wrong. `arm_watermark` is evaluated by `arm`/`arm_tuning` BEFORE `arm_at` is called, so it is
// not inside the lock at all. The call that IS inside the lock is `on_session_finalized_at`'s
// `history::ledger_len_checked`, and it is not lock-free: on the corrupt-ledger branch `load_history`
// calls `support_evidence::record`, which takes that module's own store lock.
//
// So this module establishes a real lock ORDER — COMPARISON_LOCK ⊃ SUPPORT_EVIDENCE_LOCK — rather
// than "no nested lock". There is no cycle: neither `history.rs` nor `support_evidence.rs` calls
// into comparison/drift/readiness, so the edge has no back edge. That claim is the whole basis of
// the acyclicity argument, so it is MECHANIZED rather than asserted —
// `scripts/store-lock-order-guard.test.mjs` fails if either module ever gains such a call, or if a
// store module reaches out to somewhere this order has not been re-derived against.
//
// The cost is stated rather than hidden: on a machine whose Trust Ledger is corrupt, every session
// finalize does a support-evidence read+write while holding this lock, which is that much longer
// that `arm` and `clear_tuning` wait.
static COMPARISON_LOCK: Mutex<()> = Mutex::new(());

/// Acquire, recovering from poison and CLEARING it.
///
/// PR #395's review: poisoning is sticky for the life of the process, and nothing in this crate ever
/// calls `clear_poison`. A SPLIT policy — some callers propagating `Err`, some recovering — is
/// therefore not a policy at all: one panic anywhere under this lock would make `arm` fail for the
/// rest of the session while `clear_tuning` kept working, and the user would see "arming a
/// comparison stopped working until I restarted" with nothing pointing at the cause.
///
/// Uniform recovery is safe here for a reason specific to this design, not as a general rule: the
/// guarded value is `()`, not shared data, and every write goes through `atomic_write`, so a thread
/// that panicked mid-section can only have left the PREVIOUS complete FILE plus an orphan temp. The
/// recovering thread does its own fresh `load_armed_from` and inherits nothing from the dead one.
///
/// The scope of that sentence is exact, and PR #395's second review was right to press on it: it is
/// per-FILE, and this lock spans TWO. `report_tuning_crash_at` writes the armed baseline then the
/// surfaced result; `on_session_finalized_at` writes the result then deletes the arm. A panic
/// BETWEEN either pair leaves them disagreeing, and `clear_poison` unblocks the lock without
/// reconciling that — it makes the store usable again, which is not the same as making it correct.
///
/// That window is latent rather than live: no `unwrap`, `expect`, indexing or overflow-prone
/// arithmetic sits in either gap today, so nothing currently panics there. Rather than build a
/// reconciler for a failure that cannot happen, the window is made TESTABLE —
/// `crate::race_seam::panic_at` sits in both gaps and
/// `a_panic_between_the_two_writes_splits_the_pair_and_leaves_the_store_usable` pins exactly what
/// survives. If a future change adds a panic surface there, that test is where the argument
/// restarts.
fn lock_comparison() -> crate::race_seam::StoreGuard {
    // #398: the acquisition is RECORDED before the block. `on_session_finalized_at` calls out of
    // this section into `history`, and a path from there back into any `lock_comparison` caller is a
    // self-deadlock — `std::sync::Mutex` is not reentrant. The recorder turns that into a named
    // panic instead of a silent hang, and unlike the text scanner it does not care how the call was
    // spelled. Compiled out entirely in a release build.
    crate::race_seam::hold_lock(crate::race_seam::StoreLock::Comparison, || {
        COMPARISON_LOCK.lock().unwrap_or_else(|poisoned| {
            COMPARISON_LOCK.clear_poison();
            poisoned.into_inner()
        })
    })
}

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

/// The ledger's two confound marks from ONE read: its entry count (the watermark) and how many of
/// its rows are not rolled back (see [`ArmedComparison::ledger_active`]). One read, so a change
/// landing between two reads can't split them; recorded status only, so nothing probes the machine.
fn ledger_marks() -> Result<(usize, usize), String> {
    crate::history::load_history().map(|h| crate::history::ledger_marks_of(&h))
}

/// Both marks for an arm, with [`arm_watermark`]'s refusal when the history can't be read.
fn arm_marks() -> Result<(usize, usize), String> {
    ledger_marks().map_err(|e| {
        format!("can't arm a before/after comparison — the change history is unreadable, so a later result could never be proven fair: {e}")
    })
}

/// A baseline is a measured session: a real average and a real 1% low (codebase review 2026-11-02).
/// A zero or missing reading compared as a 0% change, so "no change" was claimed from nothing.
fn require_baseline_reading(avg_fps: f64, low1_fps: f64) -> Result<(), String> {
    if avg_fps.is_finite() && avg_fps > 0.0 && low1_fps.is_finite() && low1_fps > 0.0 {
        Ok(())
    } else {
        Err("can't arm a before/after comparison — the session it would compare against has no frame-rate reading".into())
    }
}

/// Arm a comparison: record the just-debriefed session as the baseline + the fix being applied.
pub(crate) fn arm(
    rec_id: String,
    rec_title: String,
    game: String,
    baseline_avg_fps: f64,
    baseline_low1_fps: f64,
) -> Result<(), String> {
    require_baseline_reading(baseline_avg_fps, baseline_low1_fps)?;
    std::fs::create_dir_all(crate::compy_data_dir()).map_err(|e| e.to_string())?;
    let (watermark, active) = arm_marks()?;
    arm_at(
        &armed_path(),
        ArmedComparison {
            rec_id,
            rec_title,
            game,
            baseline_avg_fps,
            baseline_low1_fps,
            armed_at: chrono::Utc::now().to_rfc3339(),
            ledger_watermark: watermark,
            ledger_active: Some(active),
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
    let _lock = lock_comparison();
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
    require_baseline_reading(baseline_avg_fps, baseline_low1_fps)?;
    std::fs::create_dir_all(crate::compy_data_dir()).map_err(|e| e.to_string())?;
    let (watermark, active) = arm_marks()?;
    arm_at(
        &armed_path(),
        ArmedComparison {
            rec_id: guide_id,
            rec_title: label,
            game,
            baseline_avg_fps,
            baseline_low1_fps,
            armed_at: chrono::Utc::now().to_rfc3339(),
            ledger_watermark: watermark,
            ledger_active: Some(active),
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
    let _lock = lock_comparison();
    let Some(mut a) = load_armed_from(armed) else { return Ok(()) };
    if a.kind != ComparisonKind::Tuning {
        return Ok(());
    }
    crate::race_seam::hold(); // no-op in a release build; see race_seam
    a.crash_reported = true;
    save_armed_to(armed, &a)?;
    // Two files, one lock acquisition. A panic here leaves the baseline flagged and the surfaced
    // result not — see race_seam's panic-seam note and the test that pins it.
    crate::race_seam::panic_at(crate::race_seam::AFTER_ARMED_WRITE);
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
    let _lock = lock_comparison();
    let tuning_armed = matches!(load_armed_from(armed), Some(a) if a.kind == ComparisonKind::Tuning);
    crate::race_seam::hold(); // no-op in a release build; see race_seam
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

/// Item 8, pure: an armed comparison's verdict on this game's measured band. `band_pct` is the
/// measured rise a change must beat; a fall is judged at the matching fall (`noise_floor::fall_pct`),
/// the way Trials judge a measured band, so the band is the same log distance both ways.
pub(crate) fn classify_measured(delta_low1_pct: f64, band_pct: f64) -> &'static str {
    if delta_low1_pct > band_pct {
        "improved"
    } else if delta_low1_pct < -crate::noise_floor::fall_pct(band_pct) {
        "regressed"
    } else {
        "no-change"
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
    unfair(armed, ledger_now, now).unwrap_or_else(|| classify(delta_low1_pct, noise_floor_pct))
}

/// The fairness guards alone: `Some("expired")` or `Some("confounded")`, else `None` (the delta may be
/// judged).
fn unfair(armed: &ArmedComparison, ledger_now: Option<usize>, now: chrono::DateTime<chrono::Utc>) -> Option<&'static str> {
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&armed.armed_at) {
        if (now - t.with_timezone(&chrono::Utc)).num_days() > ARM_MAX_AGE_DAYS {
            return Some("expired"); // baseline too old to compare fairly
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
        return Some("confounded"); // not the ledger this baseline was measured against
    }
    None
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
    noise: &ArmNoise,
    ledger_now: Option<usize>,
    active_now: Option<usize>,
    now: chrono::DateTime<chrono::Utc>,
) -> ComparisonResult {
    let pct = |after: f64, base: f64| if base > 0.0 { (after - base) / base * 100.0 } else { 0.0 };
    let delta_low1 = pct(s.low1_fps_est, armed.baseline_low1_fps);
    let (band, game_noise) = match noise {
        ArmNoise::Measured(n) => (Some(n.low1_band_pct), Some(n.clone())),
        ArmNoise::Unmeasured(_) => (None, None),
    };
    // Item 8: judged on the measured band; with none, no verdict (never the fixed 3%). The fairness
    // guards still come first.
    let mut verdict = unfair(armed, ledger_now, now)
        .unwrap_or_else(|| band.map_or("unmeasured", |b| classify_measured(delta_low1, b)))
        .to_string();
    // The other half of the confound watermark (see `ledger_active`): an undo since the arm, the
    // fix's own included, leaves the entry count equal and is caught here. Expiry still wins.
    if verdict != "expired" && armed.ledger_active.is_some_and(|a| active_now != Some(a)) {
        verdict = "confounded".into();
    }
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
        noise_floor_pct: band.unwrap_or(0.0),
        unmeasured: match noise {
            ArmNoise::Unmeasured(why) if verdict == "unmeasured" => Some((*why).to_string()),
            _ => None,
        },
        noise_fall_pct: band.map(crate::noise_floor::fall_pct),
        assumed_band: None,
        game_noise,
        verdict,
        at: now.to_rfc3339(),
        kind: armed.kind,
        baseline_peak_temp_c: armed.baseline_peak_temp_c,
        after_peak_temp_c: s.peak_gpu_temp_c,
        delta_temp_c: temp_delta(armed.baseline_peak_temp_c, s.peak_gpu_temp_c),
        crash_reported: armed.crash_reported,
    }
}

/// The fix itself read Off before this settle (`on_session_finalized`), for the arm it was read for:
/// the session measured the machine without it. Expiry still wins.
fn confound_if_fix_was_off(result: &mut ComparisonResult, armed: &ArmedComparison, fix_off: Option<(String, bool)>) {
    if result.verdict != "expired" && fix_off.is_some_and(|(rec, off)| off && rec == armed.rec_id) {
        result.verdict = "confounded".into();
        // Item 8 (opus r1): `unmeasured` is set exactly when the verdict is "unmeasured".
        result.unmeasured = None;
    }
}

/// Called after a session finalizes. If a comparison is armed for THIS game, compute + store the
/// result. A fix comparison then disarms; a tuning baseline stays armed (keeps measuring). A
/// different game leaves the arming intact for its own next session. Returns the kind of the
/// comparison this session settled (a result was written), or `None` when it settled nothing; the
/// session-end toast reads it (P7-notify).
pub(crate) fn on_session_finalized(s: &SessionSummary) -> Option<ComparisonKind> {
    // The armed fix's own state on the machine, read BEFORE the lock: a live probe never runs under
    // it (review round 2, 2026-11-02). The marks see an undo Compy recorded; this sees the fix put back
    // outside Compy, which left the session measuring a fix that wasn't on.
    // Only for a session that could settle it: the probe can spawn PowerShell, and the settle below
    // drops every other session before using it (slice 6 review).
    let could_settle = s.samples >= crate::experiment::MIN_TREATMENT_SAMPLES && crate::experiment::has_frame_reading(s);
    let fix_off = load_armed()
        .filter(|a| a.kind == ComparisonKind::Fix && could_settle && !s.process_name.is_empty())
        .filter(|a| a.game.eq_ignore_ascii_case(&s.process_name))
        .map(|a| {
            let off = crate::history::newest_applied_reads_off(&a.rec_id) == Some(true);
            (a.rec_id, off)
        });
    // Item 8: the band this settle is judged on, measured BEFORE the lock (it reads the session store
    // and the change history; nothing under COMPARISON_LOCK reaches them), for the arm it was measured
    // for. Only for a session that could settle it, like the probe above.
    let noise = load_armed()
        .filter(|a| could_settle && !s.process_name.is_empty() && a.game.eq_ignore_ascii_case(&s.process_name))
        .map(|a| {
            let sessions = crate::sessions::get_session_summaries();
            let n = arm_noise_from(&a, &sessions, s, |b| crate::experiment::measured_noise_at(&sessions, b));
            (a.armed_at, n)
        });
    on_session_finalized_at(&armed_path(), &result_path(), s, fix_off, noise)
}

/// Item 8, pure: the session an armed comparison's baseline was read from: the newest session of its
/// game that started before the arm and carries exactly the armed readings (both arm paths copy them
/// from that session's summary). `None` when no stored session matches; nothing is guessed.
pub(crate) fn arm_baseline_session<'s>(a: &ArmedComparison, sessions: &'s [SessionSummary]) -> Option<&'s SessionSummary> {
    let armed_at = chrono::DateTime::parse_from_rfc3339(&a.armed_at).ok()?;
    let same = |x: f64, y: f64| (x - y).abs() <= 1e-9 * y.abs().max(1.0);
    sessions
        .iter()
        .filter(|s| s.process_name.eq_ignore_ascii_case(&a.game))
        .filter(|s| same(s.avg_fps, a.baseline_avg_fps) && same(s.low1_fps_est, a.baseline_low1_fps))
        .filter_map(|s| Some((chrono::DateTime::parse_from_rfc3339(&s.started_at).ok()?, s)))
        .filter(|(at, _)| *at < armed_at)
        .max_by_key(|(at, _)| *at)
        .map(|(_, s)| s)
}

/// Opus r2 (item 8), pure: the same comparability check a Trial refuses on (a GPU, game or rig change,
/// or no shared conditions at all), between an arm's baseline session and a later one. The one rule
/// the armed comparison and the tuning measurement's later sessions both judge on.
pub(crate) fn arm_conditions_comparable(baseline: &SessionSummary, after: &SessionSummary) -> bool {
    conditions_comparable(&crate::comparability::derive(baseline, after).verdict)
}

/// [`arm_conditions_comparable`]'s rule on an already-derived verdict.
fn conditions_comparable(verdict: &crate::comparability::Comparability) -> bool {
    !matches!(
        verdict,
        crate::comparability::Comparability::NotComparable | crate::comparability::Comparability::Unknown
    )
}

/// CR-tuning-comparability: whether one session after a tuning arm can be judged against its baseline.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct PostComparability {
    /// The session's recorded start (its id).
    pub started_at: String,
    /// [`arm_conditions_comparable`] against the arm's baseline session, and the same Windows power
    /// plan held through both (`experiment::plan_mismatch`, s41).
    pub comparable: bool,
    /// CR-tuning-frames-unread-reason: not comparable only because the two sessions share no
    /// recorded conditions (`Comparability::Unknown`), so no GPU, driver or build is the reason.
    pub conditions_unknown: bool,
}

/// CR-tuning-comparability, PURE: every session of the arm's game that started at or after the arm,
/// with whether it can be judged against the arm's baseline session ([`arm_baseline_session`]). No
/// baseline session stored: an empty list, so no later session is judged (nothing is guessed).
pub(crate) fn post_comparability(a: &ArmedComparison, sessions: &[SessionSummary]) -> Vec<PostComparability> {
    let Some(baseline) = arm_baseline_session(a, sessions) else {
        return Vec::new();
    };
    let Ok(armed_at) = chrono::DateTime::parse_from_rfc3339(&a.armed_at) else {
        return Vec::new();
    };
    sessions
        .iter()
        .filter(|s| s.process_name.eq_ignore_ascii_case(&a.game))
        .filter(|s| chrono::DateTime::parse_from_rfc3339(&s.started_at).is_ok_and(|at| at >= armed_at))
        .map(|s| {
            // Sonnet NIT: one derive per session for both fields.
            let verdict = crate::comparability::derive(baseline, s).verdict;
            // s41 opus SHOULD-FIX (CR-plan-compare-rest): the plan rule the first session after the arm
            // is judged on (`arm_noise_from`) holds for every later one too.
            let same_plan = crate::experiment::plan_mismatch(baseline, s, false).is_none();
            PostComparability {
                started_at: s.started_at.clone(),
                comparable: conditions_comparable(&verdict) && same_plan,
                conditions_unknown: matches!(verdict, crate::comparability::Comparability::Unknown),
            }
        })
        .collect()
}

/// Item 8, pure: what the comparison of `after` against the arm `a` is judged on. `measure` is this
/// game's measured as-is noise up to a session (`experiment::measured_noise_at` in the app, the one
/// source). No baseline session, no measured band, or a different/unreadable cap state on the
/// after-session: unmeasured, and the result calls nothing better or worse.
pub(crate) fn arm_noise_from(
    a: &ArmedComparison,
    sessions: &[SessionSummary],
    after: &SessionSummary,
    measure: impl FnOnce(&SessionSummary) -> Option<crate::noise_floor::GameNoise>,
) -> ArmNoise {
    let Some(baseline) = arm_baseline_session(a, sessions) else {
        return ArmNoise::Unmeasured(UNMEASURED_NOISE);
    };
    if !arm_conditions_comparable(baseline, after) {
        return ArmNoise::Unmeasured(UNMEASURED_CONDITIONS);
    }
    // CR-plan-compare-rest: the same power-plan rule a Trial confounds on (`experiment::plan_mismatch`):
    // another plan, a plan switched during either session, or a plan that couldn't be read calls
    // nothing better or worse. An armed Fix of the plan itself moves it between the two by design.
    let plan_fix = a.kind == ComparisonKind::Fix && a.rec_id == crate::experiment::POWER_PLAN_REC;
    if crate::experiment::plan_mismatch(baseline, after, plan_fix).is_some() {
        return ArmNoise::Unmeasured(UNMEASURED_CONDITIONS);
    }
    let Some(n) = measure(baseline) else {
        return ArmNoise::Unmeasured(UNMEASURED_NOISE);
    };
    let cap = crate::noise_floor::cap_pair(n.cap, crate::noise_floor::cap_read(after));
    if cap != crate::noise_floor::CapPair::Same {
        return ArmNoise::Unmeasured(UNMEASURED_CAP);
    }
    ArmNoise::Measured(n)
}

/// Path-parameterized for the same reason as [`report_tuning_crash_at`]. The disarm at the end
/// deletes the armed file based on what was read at the top, so the read and the delete have to be
/// one step: an arm landing in between would otherwise be disarmed by a session it never measured.
fn on_session_finalized_at(
    armed_path_: &std::path::Path,
    result_path_: &std::path::Path,
    s: &SessionSummary,
    fix_off: Option<(String, bool)>,
    noise: Option<(String, ArmNoise)>,
) -> Option<ComparisonKind> {
    let _lock = lock_comparison();
    let armed = load_armed_from(armed_path_)?;
    crate::race_seam::hold(); // no-op in a release build; see race_seam
    // Same game, compared as every other game match in the app is (codebase review 2026-11-02).
    if s.process_name.is_empty() || !armed.game.eq_ignore_ascii_case(&s.process_name) {
        return None;
    }
    // P4-show-f1: a session behind another window the whole time measured nothing (its 0s are
    // "not measured"), so it neither settles nor disarms the comparison; the arm waits for play.
    // Codebase review 2026-11-02: nor does a session too short to judge or without a real 1% low,
    // which read as a -100% "regressed" (a 0 low) or a verdict off a handful of ticks. The bar is the
    // Trial's own: a real reading over at least MIN_TREATMENT_SAMPLES.
    if s.samples < crate::experiment::MIN_TREATMENT_SAMPLES || !crate::experiment::has_frame_reading(s) {
        return None;
    }
    // Both confound marks from one read (`ledger_marks`).
    let marks = ledger_marks().ok();
    // Item 8: the band measured for THIS arm (keyed by its arm time), or none; a band measured for an
    // arm that has since been replaced never judges the new one.
    let noise = noise
        .filter(|(armed_at, _)| *armed_at == armed.armed_at)
        .map_or(ArmNoise::Unmeasured(UNMEASURED_NOISE), |(_, n)| n);
    let mut result = build_result(
        &armed,
        s,
        &noise,
        // `.ok()` here is the honest direction, not a collapse: an unreadable ledger becomes `None`,
        // which the guard above refuses to attribute. It is never silently treated as a count.
        //
        // #283 / #395 review: this is the one call into ANOTHER MODULE from inside this module's
        // locked section, and it is not lock-free — on the corrupt-ledger branch it reaches
        // `support_evidence::record`, which takes that module's own lock.
        //
        // Corrected after the second review, which caught the earlier wording claiming this was the
        // only impurity reached under the lock: `ledger_len_checked` also resolves `history_path()`
        // → `compy_data_dir()`, and that goes through two `OnceLock` initializers — `data_root`'s
        // decision, and on a first-ever canonical-root resolution `migrate_legacy_data_once`'s
        // recursive copy of the legacy `Sentinel` folder. Neither reaches back into
        // comparison/drift/readiness, so the order below still holds; in practice both are warmed
        // by startup long before any session finalizes. Named here because "the one call" was the
        // kind of tidy sentence that stops anyone looking. (`ledger_marks` reads through the same
        // `load_history`, so the same note holds.)
        marks.map(|m| m.0),
        // The rows-not-rolled-back count, read the same honest way: unreadable is `None`.
        marks.map(|m| m.1),
        chrono::Utc::now(),
    );
    confound_if_fix_was_off(&mut result, &armed, fix_off);
    // Restored after PR #395's review: the `save_result` wrapper this was lifted out of created
    // the data folder first. Unreachable today — a `Some` arm above means the folder already exists
    // — but "unreachable today" is a property of the current call sites, not of this function.
    if let Some(dir) = result_path_.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // P7-notify: an unwritten result settled nothing the user can open, so it reports `None` (no
    // "result is ready" toast). The disarm below is unchanged on purpose (mutation-lifecycle scope).
    let written = save_result_to(result_path_, &result).is_ok();
    // Same window as `report_tuning_crash_at`: the result is written, the arm is not yet gone.
    crate::race_seam::panic_at(crate::race_seam::AFTER_RESULT_WRITE);
    if should_disarm(armed.kind) {
        let _ = std::fs::remove_file(armed_path_); // the one-shot fix comparison happened
    }
    written.then_some(armed.kind)
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
/// Test isolation (item 4): a scratch folder under the temp dir that starts EMPTY. Test folders are
/// named by process id and a counter, and Windows reuses process ids, so a name can come back in a
/// later test run with that run's files still inside; whatever is there is removed first. A folder
/// that can't be cleared (a file held open) stops the test rather than handing it stale state.
#[cfg(test)]
fn fresh_scratch(name: String) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(name);
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => panic!("a leftover scratch folder {} couldn't be cleared: {e}", dir.display()),
    }
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "scratch folder {} starts empty", dir.display());
    dir
}

#[cfg(test)]
mod comparison_persistence_tests {
    use super::*;

    fn scratch(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        super::fresh_scratch(format!("compy-cmp-{tag}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)))
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
            ledger_active: None,
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
            game_noise: None,
            unmeasured: None,
            noise_fall_pct: None,
            assumed_band: None,
        }
    }

    #[test]
    fn an_old_better_or_worse_judged_on_the_fixed_band_is_labelled_on_read_only() {
        // CR-debrief-assumed-label: a stored improved/regressed with no game_noise was judged on the
        // fixed band; it carries the label, with the game's noise as measured now.
        let wide = crate::noise_floor::GameNoise {
            model: crate::noise_floor::NOISE_MODEL_VERSION,
            low1_band_pct: 8.4,
            avg_band_pct: 6.0,
            low1_step_pct: 3.6,
            avg_step_pct: 2.6,
            sessions: 9,
            cap: crate::noise_floor::CapRead::Uncapped,
            cap_unread: 0,
            max_gap_mins: 0,
        };
        let l = assumed_band_for(&result("improved"), Some(&wide)).expect("labelled");
        assert_eq!((l.assumed_pct, l.measured_low1_pct, l.measured_sessions), (DEFAULT_NOISE_FLOOR_PCT, Some(8.4), Some(9)));
        assert!(l.claimed_change && l.judged);
        assert_eq!(assumed_band_for(&result("regressed"), None).and_then(|l| l.measured_low1_pct), None, "still unmeasured says so");
        // A no-change, a result judged on a measured band, and an unmeasured one get none.
        assert_eq!(assumed_band_for(&result("no-change"), Some(&wide)), None);
        assert_eq!(assumed_band_for(&ComparisonResult { game_noise: Some(wide.clone()), ..result("improved") }, Some(&wide)), None);
        assert_eq!(assumed_band_for(&ComparisonResult { noise_floor_pct: 0.0, ..result("unmeasured") }, None), None);
        // Never stored, never read back from disk.
        let labelled = ComparisonResult { assumed_band: assumed_band_for(&result("improved"), None), ..result("improved") };
        let json = serde_json::to_value(&labelled).expect("serialize");
        assert!(json.get("assumed_band").is_some(), "the read command sends it");
        let back: ComparisonResult = serde_json::from_value(json).expect("load");
        assert!(back.assumed_band.is_none(), "a stored label is never read back");
        assert!(serde_json::to_value(result("improved")).unwrap().get("assumed_band").is_none());
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

    #[test]
    fn a_measured_band_is_judged_the_same_log_distance_both_ways() {
        assert_eq!(classify_measured(20.0, 20.6), "no-change");
        assert_eq!(classify_measured(20.7, 20.6), "improved");
        // The fall matching +20.6% is -17.0% (B/(1+B) = 17.08, rounded down to 0.1).
        assert_eq!(classify_measured(-17.0, 20.6), "no-change");
        assert_eq!(classify_measured(-17.2, 20.6), "regressed");
    }

    /// A measured band of `low1_band_pct` on the 1% low (uncapped), for the verdict tests.
    pub(super) fn band(low1_band_pct: f64) -> ArmNoise {
        ArmNoise::Measured(crate::noise_floor::GameNoise {
            model: crate::noise_floor::NOISE_MODEL_VERSION,
            low1_band_pct,
            avg_band_pct: low1_band_pct,
            low1_step_pct: 1.0,
            avg_step_pct: 1.0,
            sessions: 6,
            cap: crate::noise_floor::CapRead::Uncapped,
            cap_unread: 0,
            max_gap_mins: 0,
        })
    }

    /// Item 8: an armed comparison on the owner's ROB RUN day, armed from the 13:55 as-is session.
    fn rob_arm(day: &[SessionSummary]) -> ArmedComparison {
        let b = &day[11];
        ArmedComparison {
            game: b.process_name.clone(),
            baseline_avg_fps: b.avg_fps,
            baseline_low1_fps: b.low1_fps_est,
            ..armed_fixture("2026-11-11T14:13:00+00:00".into(), 0)
        }
    }

    #[test]
    fn an_armed_comparison_is_judged_on_the_games_measured_band_not_3_percent() {
        // Item 8: the owner's ROB RUN day. The 1% low moves far more than 3% between sessions with
        // nothing changed, so a +12% after-session is inside this game's own swing: no win claimed.
        let day = crate::noise_floor::tests::rob_day();
        let ledger = crate::noise_floor::tests::rob_trials();
        let a = rob_arm(&day);
        let mut after = day[12].clone();
        after.low1_fps_est = a.baseline_low1_fps * 1.12;
        let noise = arm_noise_from(&a, &day, &after, |b| crate::noise_floor::measure_game_noise(&day, b, &ledger).ok());
        let ArmNoise::Measured(n) = &noise else { panic!("measured: {noise:?}") };
        assert!(n.low1_band_pct > 12.0, "the game's own band: {}", n.low1_band_pct);
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-11T15:00:00+00:00").unwrap().with_timezone(&chrono::Utc);
        let r = build_result(&a, &after, &noise, Some(0), None, now);
        assert_eq!(r.verdict, "no-change", "+12% inside a {}% band", n.low1_band_pct);
        assert_eq!(r.noise_floor_pct, n.low1_band_pct);
        assert_eq!(r.game_noise.as_ref(), Some(n));
        assert_eq!(r.unmeasured, None);
        assert_eq!(r.noise_fall_pct, Some(crate::noise_floor::fall_pct(n.low1_band_pct)));
        // Past the band it is a real result, both ways.
        let big = |f: f64| {
            let mut s = after.clone();
            s.low1_fps_est = a.baseline_low1_fps * f;
            build_result(&a, &s, &noise, Some(0), None, now).verdict
        };
        assert_eq!(big(1.0 + n.low1_band_pct / 100.0 + 0.01), "improved");
        assert_eq!(big(1.0 - n.low1_band_pct / 100.0), "regressed");
        // Between the matching fall and the band: a fall is judged on the fall, so "regressed".
        let fall = crate::noise_floor::fall_pct(n.low1_band_pct);
        assert!(fall < n.low1_band_pct);
        assert_eq!(big(1.0 - (fall + n.low1_band_pct) / 200.0), "regressed");
        assert_eq!(big(1.0 - (fall - 0.2) / 100.0), "no-change");
    }

    #[test]
    fn without_a_measured_band_an_armed_comparison_calls_nothing() {
        // Item 8: never the fixed 3%. A +12.5% 1% low with no band is shown, not called.
        let now = chrono::Utc::now();
        let a = armed_fixture(now.to_rfc3339(), 0);
        let r = build_result(&a, &session_fixture(90.0, None), &ArmNoise::Unmeasured(UNMEASURED_NOISE), Some(0), None, now);
        assert_eq!(r.verdict, "unmeasured");
        assert_eq!(r.noise_floor_pct, 0.0);
        assert_eq!(r.unmeasured.as_deref(), Some(UNMEASURED_NOISE));
        assert_eq!((r.game_noise, r.noise_fall_pct), (None, None));
        assert_eq!(r.delta_low1_pct, 12.5, "the numbers still show");
        // A fix read Off turns it "confounded", and the unmeasured reason goes with the verdict.
        let mut r = build_result(&a, &session_fixture(90.0, None), &ArmNoise::Unmeasured(UNMEASURED_NOISE), Some(0), None, now);
        confound_if_fix_was_off(&mut r, &a, Some((a.rec_id.clone(), true)));
        assert_eq!((r.verdict.as_str(), r.unmeasured), ("confounded", None));
        // The fairness guards still win over "unmeasured".
        let r = build_result(&a, &session_fixture(90.0, None), &ArmNoise::Unmeasured(UNMEASURED_NOISE), Some(1), None, now);
        assert_eq!((r.verdict.as_str(), r.unmeasured), ("confounded", None));
    }

    #[test]
    fn an_armed_comparison_finds_its_baseline_session_and_its_cap_state() {
        let day = crate::noise_floor::tests::rob_day();
        let ledger = crate::noise_floor::tests::rob_trials();
        let a = rob_arm(&day);
        assert_eq!(arm_baseline_session(&a, &day).map(|s| s.started_at.as_str()), Some(day[11].started_at.as_str()));
        // Not a session after the arm, nor one with other readings, nor another game.
        let late = ArmedComparison { armed_at: "2026-11-11T13:00:00+00:00".into(), ..a.clone() };
        assert!(arm_baseline_session(&late, &day).is_none());
        let other = ArmedComparison { baseline_low1_fps: 171.0, ..a.clone() };
        assert!(arm_baseline_session(&other, &day).is_none());
        let game = ArmedComparison { game: "other.exe".into(), ..a.clone() };
        assert!(arm_baseline_session(&game, &day).is_none());
        let measure = |b: &SessionSummary| crate::noise_floor::measure_game_noise(&day, b, &ledger).ok();
        assert_eq!(arm_noise_from(&other, &day, &day[12], measure), ArmNoise::Unmeasured(UNMEASURED_NOISE));
        // An after-session whose cap state differs from the band's, or can't be read: no verdict.
        let mut capped = day[12].clone();
        capped.fps_series = crate::noise_floor::tests::capped_series(240.0);
        assert_eq!(arm_noise_from(&a, &day, &capped, measure), ArmNoise::Unmeasured(UNMEASURED_CAP));
        let mut unread = day[12].clone();
        unread.fps_series.clear();
        unread.frame_cap = None;
        assert_eq!(arm_noise_from(&a, &day, &unread, measure), ArmNoise::Unmeasured(UNMEASURED_CAP));
        // Too few as-is sessions before the baseline: unmeasured.
        assert_eq!(arm_noise_from(&a, &day, &day[12], |_| None), ArmNoise::Unmeasured(UNMEASURED_NOISE));
        // Another GPU in the after-session: not comparable, whatever the band says (opus r2).
        let mut other_gpu = day[12].clone();
        other_gpu.hw_fingerprint.as_mut().expect("the ROB fixture carries a rig").gpu = "Some Other GPU".into();
        assert_eq!(arm_noise_from(&a, &day, &other_gpu, measure), ArmNoise::Unmeasured(UNMEASURED_CONDITIONS));
    }

    /// CR-plan-compare-rest: the session-debrief before/after judges only sessions shown to share a
    /// Windows power plan, held through both, as a two-session Trial does; an armed fix of the plan
    /// itself may differ between them, never switch during one.
    #[test]
    fn a_debrief_comparison_across_power_plans_calls_nothing() {
        const BAL: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
        const HIGH: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
        let plan = |s: &SessionSummary, start: Option<&str>, end: Option<&str>| {
            let mut s = s.clone();
            let g = s.game_state.take().unwrap_or_default();
            s.game_state = Some(g.with_power_plan(start.map(Into::into), end.map(Into::into)));
            s
        };
        let mut day = crate::noise_floor::tests::rob_day();
        let ledger = crate::noise_floor::tests::rob_trials();
        day[11] = plan(&day[11], Some(BAL), Some(BAL));
        let a = rob_arm(&day);
        let measure = |b: &SessionSummary| crate::noise_floor::measure_game_noise(&day, b, &ledger).ok();
        let measured = |n: &ArmNoise| matches!(n, ArmNoise::Measured(_));
        let after = &day[12];
        assert!(measured(&arm_noise_from(&a, &day, &plan(after, Some(BAL), Some(BAL)), measure)), "same plan");
        let not = ArmNoise::Unmeasured(UNMEASURED_CONDITIONS);
        assert_eq!(arm_noise_from(&a, &day, &plan(after, Some(HIGH), Some(HIGH)), measure), not, "another plan");
        assert_eq!(arm_noise_from(&a, &day, &plan(after, Some(BAL), Some(HIGH)), measure), not, "switched during");
        assert_eq!(arm_noise_from(&a, &day, &plan(after, Some(BAL), None), measure), not, "end unread");
        assert_eq!(arm_noise_from(&a, &day, &plan(after, None, None), measure), not, "unread");
        // A fix of the plan itself moves it between the sessions by design, never during one.
        let pu = ArmedComparison { rec_id: "power-ultimate".into(), kind: ComparisonKind::Fix, ..a.clone() };
        assert!(measured(&arm_noise_from(&pu, &day, &plan(after, Some(HIGH), Some(HIGH)), measure)));
        assert_eq!(arm_noise_from(&pu, &day, &plan(after, Some(HIGH), Some(BAL)), measure), not);
        // A session recorded before the plan was collected stays unchecked, as in a Trial.
        assert!(measured(&arm_noise_from(&a, &day, after, measure)), "no plan recorded on the after-session");
        // Every later session of a tune is held to the same rule (s41 opus SHOULD-FIX).
        let mut later = day.clone();
        later[12] = plan(after, Some(HIGH), Some(HIGH));
        assert!(!post_comparability(&a, &later)[0].comparable, "another plan");
        later[12] = plan(after, Some(BAL), Some(BAL));
        assert_eq!(post_comparability(&a, &later)[0].comparable, arm_conditions_comparable(&later[11], &later[12]));
    }

    #[test]
    fn every_session_after_a_tuning_arm_is_checked_against_its_baseline_with_the_same_rule() {
        // CR-tuning-comparability: later sessions get the comparability check the first one gets.
        let mut day = crate::noise_floor::tests::rob_day();
        let a = rob_arm(&day);
        let after: Vec<&str> = day[12..].iter().map(|s| s.started_at.as_str()).collect();
        let list = post_comparability(&a, &day);
        assert_eq!(list.iter().map(|p| p.started_at.as_str()).collect::<Vec<_>>(), after, "only sessions after the arm");
        for (p, s) in list.iter().zip(&day[12..]) {
            assert_eq!(p.comparable, arm_conditions_comparable(&day[11], s), "{list:?}");
        }
        assert!(list[0].comparable, "the session the arm's own comparison judged: {list:?}");
        // A later session on another GPU can't be judged against the baseline.
        let last = day.len() - 1;
        day[last].hw_fingerprint.as_mut().expect("rig").gpu = "Some Other GPU".into();
        let list = post_comparability(&a, &day);
        assert_eq!(list.last().map(|p| p.comparable), Some(false));
        assert_eq!(list.last().map(|p| p.comparable), Some(arm_conditions_comparable(&day[11], &day[last])));
        // CR-tuning-frames-unread-reason: a known difference is not "no recorded conditions".
        assert_eq!(list.last().map(|p| p.conditions_unknown), Some(false));
        assert!(list.iter().all(|p| !(p.comparable && p.conditions_unknown)), "{list:?}");
        // A later session that recorded no conditions, beside a baseline with no capture record either
        // (`comparability::derive`'s Unknown): not comparable, and said to be unknown.
        day[last].hw_fingerprint = None;
        day[last].game_state = None;
        day[last].capture_capabilities = None;
        day[11].capture_capabilities = None;
        assert_eq!(crate::comparability::derive(&day[11], &day[last]).verdict, crate::comparability::Comparability::Unknown);
        let list = post_comparability(&a, &day);
        let p = list.last().expect("the session is listed");
        assert!(!p.comparable && p.conditions_unknown, "{p:?}");
        // No stored baseline session: nothing is judged.
        let other = ArmedComparison { baseline_low1_fps: 171.0, ..a.clone() };
        assert!(post_comparability(&other, &day).is_empty());
    }

    #[test]
    fn an_older_result_without_a_band_still_loads() {
        let old = serde_json::json!({
            "rec_id": "r", "rec_title": "R", "game": "g.exe", "baseline_avg_fps": 1.0, "baseline_low1_fps": 1.0,
            "after_avg_fps": 1.0, "after_low1_fps": 1.0, "delta_avg_pct": 0.0, "delta_low1_pct": 0.0,
            "noise_floor_pct": 3.0, "verdict": "no-change", "at": "t"
        });
        let r: ComparisonResult = serde_json::from_value(old).unwrap();
        assert_eq!((r.game_noise, r.unmeasured), (None, None));
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
            ledger_active: None,
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
            samples: 600,
            avg_fps: 140.0,
            avg_frametime_ms: 7.1,
            low1_fps_est: low1,
            peak_gpu_temp_c: peak_temp,
            peak_gpu_usage_pct: Some(98),
            peak_ram_used_bytes: None,
            ram_total_bytes: None,
            compy_changes_active: Some(0),
            compy_changes_per_change: true,
            compy_changes_cant_confirm: Some(0),
            compy_changes_legacy_active: None,
            compy_changes_since_set_aside: None,
            hw_fingerprint: None,
            gaming_mode_active: None,
            gaming_mode_plan: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
            fps_series: Vec::new(),
            capture_capabilities: None,
            game_state: None,
            peak_cpu_temp_c: None,
            peak_gpu_hotspot_temp_c: None,
            background_secs_excluded: None,
            frame_pacing: None,
            gpu_load: None,
            frame_cap: None,
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
            ledger_active: None,
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
        let r = build_result(&armed, &session_fixture(81.0, Some(71)), &band(3.0), Some(0), None, now);
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
        let r = build_result(&armed, &session_fixture(70.0, Some(72)), &band(3.0), Some(0), None, now);
        assert_eq!(r.verdict, "regressed");
        assert_eq!(r.delta_temp_c, Some(-12));
    }

    #[test]
    fn build_result_carries_a_reported_crash() {
        let now = chrono::Utc::now();
        let mut armed = tuning_fixture(Some(84));
        armed.crash_reported = true;
        let r = build_result(&armed, &session_fixture(81.0, Some(71)), &band(3.0), Some(0), None, now);
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
/// are deterministic rather than probabilistic: each arms [`crate::race_seam`], which holds the seam
/// open from inside the critical section, so the interleaving lands every run instead of once in a
/// thousand. The widening does not create the defect — removing only the lock, with the widening
/// left in place, is what turns these red.
#[cfg(test)]
mod comparison_race_tests {
    use super::*;
    use std::sync::atomic::Ordering;

    fn scratch(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::AtomicUsize;
        static N: AtomicUsize = AtomicUsize::new(0);
        super::fresh_scratch(format!("compy-cmp-race-{tag}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)))
    }

    /// Item 4: the two "flaky" race tests read an EARLIER run's files. A scratch folder named by
    /// process id and counter is handed out again when Windows reuses the id (seen: a folder made on
    /// 2026-11-12 00:24 reused by the 2026-11-13 02:02 run with its old result file still inside), and
    /// a test asserting "no result yet" then failed with nothing racing. A reused name starts empty.
    #[test]
    fn a_scratch_folder_left_by_an_earlier_run_starts_empty() {
        let name = format!("compy-cmp-race-reused-{}", std::process::id());
        let dir = std::env::temp_dir().join(&name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("compy_comparison_result.json"), "{}").unwrap();
        std::fs::write(dir.join("compy_comparison.json"), "{}").unwrap();
        let fresh = super::fresh_scratch(name);
        assert_eq!(fresh, dir);
        assert_eq!(std::fs::read_dir(&fresh).unwrap().count(), 0, "nothing from the earlier run is left");
        let _ = std::fs::remove_dir_all(&fresh);
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
            ledger_active: None,
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
        let _seam = crate::race_seam::Widened::arm();
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
            let _ = on_session_finalized_at(&a, &r, &super::comparison_tests::session_fixture(80.0, None), None, None);
        });
        assert_survived(left, "session finalize");
    }

    /// P4-show-f1: a session that measured nothing (the game was behind another window the whole time)
    /// would otherwise read as a 1% low of 0, a -100% regression. It writes no result and leaves a
    /// one-shot Fix arm in place for the next session that measures play.
    #[test]
    fn a_session_that_measured_nothing_never_settles_a_comparison() {
        // No other test's armed seam may fire inside this one's finalizes.
        let _exclusive = crate::race_seam::exclusive();
        let dir = scratch("unmeasured");
        let (armed, result) = (
            dir.join("compy_comparison.json"),
            dir.join("compy_comparison_result.json"),
        );
        arm_at(&armed, armed_of(ComparisonKind::Fix, "waiting")).unwrap();
        let mut behind = super::comparison_tests::session_fixture(0.0, Some(55));
        behind.samples = 0;
        behind.avg_fps = 0.0;
        behind.avg_frametime_ms = 0.0;
        behind.background_secs_excluded = Some(900);
        assert_eq!(on_session_finalized_at(&armed, &result, &behind, None, None), None, "nothing settled");
        assert!(!result.exists(), "no result from a session with no reading");
        assert_eq!(load_armed_from(&armed).map(|a| a.rec_id), Some("waiting".to_string()), "the arm waits");
        assert_eq!(
            on_session_finalized_at(&armed, &result, &super::comparison_tests::session_fixture(84.0, None), None, None),
            Some(ComparisonKind::Fix),
            "the settle is reported to the session-end toast (P7-notify)"
        );
        assert!(result.exists() && load_armed_from(&armed).is_none(), "the next measured session settles it");
    }

    /// Codebase review 2026-11-02: a session with readings but no real 1% low read as a -100%
    /// "regressed", and one of a handful of ticks settled the arm on noise. Neither settles now: the bar
    /// is the Trial's own (a real reading over MIN_TREATMENT_SAMPLES). The game match ignores case,
    /// as every other one in the app does.
    #[test]
    fn a_short_or_lowless_session_never_settles_and_the_game_match_ignores_case() {
        let _exclusive = crate::race_seam::exclusive();
        let dir = scratch("unfair");
        let (armed, result) = (dir.join("compy_comparison.json"), dir.join("compy_comparison_result.json"));
        arm_at(&armed, armed_of(ComparisonKind::Fix, "waiting")).unwrap();
        let mut lowless = super::comparison_tests::session_fixture(0.0, None);
        lowless.samples = 1200;
        let mut short = super::comparison_tests::session_fixture(84.0, None);
        short.samples = crate::experiment::MIN_TREATMENT_SAMPLES - 1;
        for s in [&lowless, &short] {
            assert_eq!(on_session_finalized_at(&armed, &result, s, None, None), None, "nothing settled");
            assert!(!result.exists() && load_armed_from(&armed).is_some(), "the arm waits");
        }
        let mut upper = super::comparison_tests::session_fixture(84.0, None);
        upper.process_name = upper.process_name.to_uppercase();
        assert_eq!(on_session_finalized_at(&armed, &result, &upper, None, None), Some(ComparisonKind::Fix), "same game, other case");
    }

    /// The probe runs before the lock, and only for a session that could settle the arm (slice 6
    /// review): `newest_applied_reads_off` can spawn PowerShell, and a live probe never runs under a
    /// store lock. Tokens are built by concat! so this test's own lines don't match the scan.
    #[test]
    fn the_fix_probe_runs_before_the_lock_and_only_for_a_session_that_could_settle() {
        let src = include_str!("comparison.rs");
        let start = src.find(concat!("pub(crate) fn ", "on_session_finalized(s: &SessionSummary)")).expect("wrapper");
        let body = &src[start..];
        let body = &body[..body.find(concat!("fn on_session_", "finalized_at(")).expect("the locked fn")];
        assert!(body.contains(concat!("newest_applied_", "reads_off(")), "the wrapper reads the fix");
        assert!(!body.contains(concat!("lock_", "comparison()")), "and takes no lock to do it");
        let gate = body.find(concat!("could_", "settle &&")).expect("the settle gates");
        assert!(gate < body.find(concat!("newest_applied_", "reads_off(")).unwrap());
    }

    /// Review round 2: the marks see an undo Compy recorded, never the fix put back outside Compy
    /// (Windows Update restoring a setting), so a session measured without the fix was credited to it.
    #[test]
    fn a_fix_put_back_outside_compy_confounds_the_result() {
        let now = chrono::Utc::now();
        let mut armed = armed_of(ComparisonKind::Fix, "fix");
        armed.armed_at = now.to_rfc3339();
        let s = super::comparison_tests::session_fixture(84.0, None);
        let fair = |a: &ArmedComparison| build_result(a, &s, &super::comparison_tests::band(3.0), Some(a.ledger_watermark), None, now);
        let mut r = fair(&armed);
        assert_ne!(r.verdict, "confounded");
        confound_if_fix_was_off(&mut r, &armed, Some(("fix".into(), true)));
        assert_eq!(r.verdict, "confounded");
        for other in [Some(("other".to_string(), true)), Some(("fix".to_string(), false)), None] {
            let mut r = fair(&armed);
            confound_if_fix_was_off(&mut r, &armed, other.clone());
            assert_ne!(r.verdict, "confounded", "{other:?}");
        }
        armed.armed_at = (now - chrono::Duration::days(ARM_MAX_AGE_DAYS + 1)).to_rfc3339();
        let mut r = fair(&armed);
        confound_if_fix_was_off(&mut r, &armed, Some(("fix".into(), true)));
        assert_eq!(r.verdict, "expired", "expiry still wins");
    }

    /// Same review: an undo changes a row's status and leaves the entry count alone, so a delta measured
    /// after the fix itself was undone was credited to it. The active count catches it; expiry still
    /// wins; an arm written before the count existed keeps the count-only check.
    #[test]
    fn an_undo_since_the_arm_confounds_the_result_and_a_baseline_needs_a_reading() {
        let now = chrono::Utc::now();
        let mut armed = armed_of(ComparisonKind::Fix, "fix");
        armed.armed_at = now.to_rfc3339();
        armed.ledger_active = Some(2);
        let s = super::comparison_tests::session_fixture(84.0, None);
        let verdict = |a: &ArmedComparison, active: Option<usize>| {
            build_result(a, &s, &super::comparison_tests::band(3.0), Some(a.ledger_watermark), active, now).verdict
        };
        assert_eq!(verdict(&armed, Some(1)), "confounded", "a change was undone since the arm");
        assert_eq!(verdict(&armed, None), "confounded", "an unreadable count proves nothing fair");
        assert_ne!(verdict(&armed, Some(2)), "confounded", "the same active changes judge the delta");
        armed.ledger_active = None;
        assert_ne!(verdict(&armed, Some(1)), "confounded", "an older arm keeps the count-only check");
        armed.ledger_active = Some(2);
        armed.armed_at = (now - chrono::Duration::days(ARM_MAX_AGE_DAYS + 1)).to_rfc3339();
        assert_eq!(verdict(&armed, Some(1)), "expired", "expiry still wins");

        assert!(require_baseline_reading(140.0, 80.0).is_ok());
        for (avg, low) in [(0.0, 80.0), (140.0, 0.0), (f64::NAN, 80.0), (140.0, f64::INFINITY)] {
            assert!(require_baseline_reading(avg, low).is_err(), "{avg} / {low}");
        }
    }

    /// P7-notify review MUST-FIX: a result that could not be written settled nothing the user can
    /// open, so it must not report a settle (that would toast "before/after result is ready").
    #[test]
    fn an_unwritten_result_reports_no_settle() {
        let _exclusive = crate::race_seam::exclusive();
        let dir = scratch("unwritable");
        let armed = dir.join("compy_comparison.json");
        let blocker = dir.join("not_a_dir");
        std::fs::write(&blocker, b"file").unwrap();
        let result = blocker.join("compy_comparison_result.json"); // parent is a regular file
        arm_at(&armed, armed_of(ComparisonKind::Fix, "write-fails")).unwrap();
        assert_eq!(
            on_session_finalized_at(&armed, &result, &super::comparison_tests::session_fixture(84.0, None), None, None),
            None,
            "no result on disk, so no settle reaches the toast"
        );
        assert!(!result.exists());
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

    /// PR #395's review: poisoning is sticky and nothing else in this crate clears it, so a lock
    /// that only propagated `Err` would fail every later `arm` after ONE panic anywhere under it —
    /// for the rest of the process, with no diagnostic pointing at the cause. The panic below is
    /// deliberate; the message libtest prints for it is expected output, not a failure.
    ///
    /// FALSIFIED BEFORE TRUSTED: put `COMPARISON_LOCK.lock().map_err(..)?` back in `arm_at` and this
    /// fails with "comparison lock poisoned".
    #[test]
    fn a_panic_under_the_lock_does_not_permanently_break_arming() {
        let armed = scratch("poison").join("compy_comparison.json");

        // The other poisoning test must not be inside its own recovery window while this one reads
        // the flag, and vice versa. They are the only two things in the crate that panic under this
        // lock, so excluding them from each other is enough to make `!is_poisoned()` below mean
        // something. It does NOT make `is_poisoned() == true` assertable — see the note there.
        let _exclusive = crate::race_seam::exclusive();

        let died = std::thread::spawn(|| {
            let _held = lock_comparison();
            panic!("deliberate: poisoning COMPARISON_LOCK for the assertion below");
        })
        .join();
        assert!(died.is_err(), "the helper thread was supposed to panic");

        arm_at(&armed, armed_of(ComparisonKind::Fix, "after-poison"))
            .expect("arming must still work after an unrelated panic under the same lock");
        assert_eq!(load_armed_from(&armed).unwrap().rec_id, "after-poison");
        assert!(
            !COMPARISON_LOCK.is_poisoned(),
            "recovering without clearing leaves the flag set for the life of the process, so the first caller that ever decides to propagate inherits a panic from hours earlier"
        );
    }

    /// COMPARISON_LOCK spans TWO files, and `clear_poison` reconciles neither.
    ///
    /// PR #395's second independent review pressed on `lock_comparison`'s justification — "a thread
    /// that panicked mid-section can only have left the PREVIOUS complete file" — and was right that
    /// it is a per-FILE statement standing in for a pair. `on_session_finalized_at` writes the
    /// result and THEN deletes the arm; a panic between them leaves a finished comparison that never
    /// disarmed, so the next session would be measured against a baseline the user already consumed.
    ///
    /// Nothing panics in that gap today — the review checked, and so did I — so this test does not
    /// claim a live defect. It pins the window's actual shape, which is the part a future change can
    /// silently alter: what survives, that the lock is usable afterwards, and that the surviving arm
    /// is the ORIGINAL one rather than something half-written. If a reconciler is ever added, this
    /// test is what has to change, and changing it is the moment someone re-derives the argument.
    #[test]
    fn a_panic_between_the_two_writes_splits_the_pair_and_leaves_the_store_usable() {
        let dir = scratch("split-pair");
        let (armed, result) = (
            dir.join("compy_comparison.json"),
            dir.join("compy_comparison_result.json"),
        );
        arm_at(&armed, armed_of(ComparisonKind::Fix, "one-shot")).unwrap();

        let (a, r) = (armed.clone(), result.clone());
        let _seam = crate::race_seam::PanicAt::arm(crate::race_seam::AFTER_RESULT_WRITE);
        let died = std::thread::spawn(move || {
            let _ = on_session_finalized_at(&a, &r, &super::comparison_tests::session_fixture(80.0, None), None, None);
        })
        .join();
        assert!(died.is_err(), "the armed seam was supposed to panic mid-sequence");

        assert!(
            result.exists(),
            "the result write happens BEFORE the seam, so it must have landed — if this fails the seam moved and this test is no longer measuring the window it names"
        );
        assert_eq!(
            load_armed_from(&armed).map(|x| x.rec_id),
            Some("one-shot".to_string()),
            "the disarm happens AFTER the seam, so the original arm must still be there, intact and not half-written. THIS is the split the poison-clearing does not repair: a one-shot comparison whose result exists and which is still armed."
        );

        // There is deliberately NO `assert!(COMPARISON_LOCK.is_poisoned())` here, and the reason is
        // worth writing down because the assertion is the obvious thing to add back.
        //
        // The flag is process-global and libtest runs tests in parallel. Every one of the ~20 test
        // call sites in this file that takes COMPARISON_LOCK CLEARS the flag on its way in, so a
        // test asserting the flag is SET is asserting that no unrelated test ran in the microseconds
        // between the panic above and the assertion — which is not true, and cost a red gate run to
        // learn. What CAN be asserted is what this test asserts instead: the arm below still works
        // (so the recovery path did run — a lock that propagated instead would fail here) and the
        // flag is clear afterwards. `exclusive()` keeps the only other poisoning test out of that
        // window; nothing else in the crate panics under this lock.
        arm_at(&armed, armed_of(ComparisonKind::Fix, "after-split"))
            .expect("the store must still be usable after a panic split the pair");
        assert_eq!(load_armed_from(&armed).unwrap().rec_id, "after-split");
        assert!(
            !COMPARISON_LOCK.is_poisoned(),
            "the caller that recovered must also have cleared, or every later caller inherits it"
        );
    }
}
