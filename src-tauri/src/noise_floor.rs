//! P4-noise-store — this game's measured run-to-run noise on this PC, persisted to
//! `noise_floors.json` (Trial Protocol §5, Machine Model §4, Optimization Engine §10).
//!
//! One record per game + rig. A record is written only by the Benchmark tab's calibration
//! (`benchmark_trial::start_calibration`), which measures the 1% low's spread with nothing changed,
//! and only when every captured window came from the same game. Nothing here estimates a noise
//! level: a game Compy never calibrated on this PC reads `Unmeasured`, a measurement taken before
//! the GPU driver, Windows build or game build changed reads `Stale(Changed)`, and one whose
//! conditions can't be confirmed reads `Stale(Unconfirmed)` — never as current.
//!
//! What the number is: the spread (coefficient of variation) of the 1% low across the ten 2.5 s
//! windows of ONE ~25 s calibration, not the variation between whole sessions. Verdicts don't use
//! it: they judge against [`between_session_noise`] (P4-noise), the spread between the whole
//! sessions of the game's current unchanged run (P4-noise-stretch: the last 14 days, nothing changed
//! between them), read from the session store and change history, never below the fixed
//! `DEFAULT_NOISE_FLOOR_PCT` ([`noise_band_pct`]).
//!
//! Game builds aren't readable yet (`GameStateFingerprint::game_build` is always unknown), so a game
//! update can't mark a measurement stale until that field is filled; the record keeps the stamp so
//! the check starts working the day it is.
//!
//! Persistence is additive: every field past the identity has a serde default, and the file is new,
//! so an older Compy never reads it. Saves go through `atomic_write`; a corrupt file is set aside
//! as `.corrupt` and reads as "nothing measured", never as a guess.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::hardware::HwFingerprint;

const SCHEMA_VERSION: u32 = 1;
/// One row per game + rig, so this only bounds a file nobody should ever fill.
const MAX_RECORDS: usize = 200;

/// One calibration's result for one game on one rig.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct NoiseFloorRecord {
    /// The game's process name (e.g. `"wardogs.exe"`), matched case-insensitively.
    pub process_name: String,
    /// The rig the calibration ran on. Its `hash` changes with the GPU driver too.
    pub hw_fingerprint: HwFingerprint,
    /// Run-to-run spread of the 1% low, in percent (coefficient of variation across the windows).
    pub noise_pct: f64,
    /// How many windows the calibration measured.
    #[serde(default)]
    pub windows: u32,
    /// RFC 3339.
    #[serde(default)]
    pub measured_at: String,
    /// `"{CurrentBuildNumber}.{UBR}"` at calibration, when read.
    #[serde(default)]
    pub windows_build: Option<String>,
    /// The game's build at calibration, when read (not readable yet; see the module note).
    #[serde(default)]
    pub game_build: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub(crate) struct NoiseFloorStore {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub records: Vec<NoiseFloorRecord>,
}

/// The game and conditions a measurement is for, or a Trial was judged under.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NoiseConditions {
    pub process_name: String,
    pub hw_fingerprint: HwFingerprint,
    pub windows_build: Option<String>,
    pub game_build: Option<String>,
}

impl NoiseConditions {
    /// The conditions a recorded session ran under. `None` when the session didn't record its game
    /// or its rig, so nothing can be matched to it.
    pub(crate) fn of_session(s: &crate::sessions::SessionSummary) -> Option<Self> {
        let gs = s.game_state.as_ref();
        let process_name = gs.and_then(|g| g.process_name.clone()).unwrap_or_else(|| s.process_name.clone());
        let hw_fingerprint = s.hw_fingerprint.clone()?;
        if process_name.trim().is_empty() || !rig_was_read(&hw_fingerprint) {
            return None;
        }
        Some(Self {
            process_name,
            hw_fingerprint,
            windows_build: gs.and_then(|g| g.windows_build.clone()),
            game_build: gs.and_then(|g| g.game_build.clone()),
        })
    }

    /// The conditions right now for `process_name`, read the same way a session stamps them.
    pub(crate) fn current(process_name: &str) -> Option<Self> {
        let gs = crate::game_state::GameStateFingerprint::collect_v1(process_name, "", None);
        let hw_fingerprint = crate::hardware::current_fingerprint();
        let process_name = gs.process_name.clone()?;
        if !rig_was_read(&hw_fingerprint) {
            return None;
        }
        Some(Self { process_name, hw_fingerprint, windows_build: gs.windows_build, game_build: gs.game_build })
    }
}

/// Why a stored measurement wasn't used. Persisted on the Trial receipt (kebab-case).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum StaleReason {
    /// The GPU driver, rig, Windows build or game build is known to have changed since.
    Changed,
    /// Nothing is known to have changed, but a stamp (e.g. the Windows build) wasn't read on one
    /// side, so Compy can't confirm the conditions are the same.
    Unconfirmed,
}

/// What Compy knows about this game's noise under the given conditions.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum NoiseLookup {
    /// Measured for this game on this rig under the same driver and Windows build (the game build
    /// isn't readable yet, so it is not checked).
    Measured(f64),
    /// Measured for this game on this rig, but not usable under these conditions.
    Stale(StaleReason),
    /// Never measured for this game on this rig, or the rig itself wasn't read.
    Unmeasured,
}

/// The fingerprint's hash is always 16 hex characters, even for a rig nothing could be read from,
/// so it proves nothing on its own. A rig counts as read only when its GPU, driver and RAM were.
pub(crate) fn rig_was_read(h: &HwFingerprint) -> bool {
    !h.gpu.trim().is_empty() && !h.gpu_driver.trim().is_empty() && h.ram_gb > 0
}

/// Same machine, ignoring the driver: the driver is a freshness stamp, not identity.
fn same_rig(a: &HwFingerprint, b: &HwFingerprint) -> bool {
    a.gpu == b.gpu && a.ram_gb == b.ram_gb && a.display == b.display
}

/// Compare one stamp: `Some(true)` same, `Some(false)` known to differ, `None` unread on a side.
fn stamp<T: PartialEq>(then: Option<&T>, now: Option<&T>) -> Option<bool> {
    match (then, now) {
        (Some(a), Some(b)) => Some(a == b),
        (None, None) => Some(true),
        _ => None,
    }
}

fn same_key(r: &NoiseFloorRecord, c: &NoiseConditions) -> bool {
    r.process_name.eq_ignore_ascii_case(&c.process_name) && same_rig(&r.hw_fingerprint, &c.hw_fingerprint)
}

/// Pure: look up this game's noise under `now`. A rig that wasn't read matches nothing. The Windows
/// build must have been read at calibration: an unread one can't be confirmed unchanged.
pub(crate) fn lookup(store: &NoiseFloorStore, now: &NoiseConditions) -> NoiseLookup {
    if !rig_was_read(&now.hw_fingerprint) {
        return NoiseLookup::Unmeasured;
    }
    let Some(r) = store.records.iter().find(|r| same_key(r, now) && rig_was_read(&r.hw_fingerprint)) else {
        return NoiseLookup::Unmeasured;
    };
    if !r.noise_pct.is_finite() || r.noise_pct <= 0.0 {
        return NoiseLookup::Unmeasured;
    }
    let rig_same = r.hw_fingerprint.hash == now.hw_fingerprint.hash
        && r.hw_fingerprint.gpu_driver == now.hw_fingerprint.gpu_driver;
    let windows = if r.windows_build.is_none() {
        None
    } else {
        stamp(r.windows_build.as_ref(), now.windows_build.as_ref())
    };
    let game = stamp(r.game_build.as_ref(), now.game_build.as_ref());
    if !rig_same || windows == Some(false) || game == Some(false) {
        NoiseLookup::Stale(StaleReason::Changed)
    } else if windows.is_none() || game.is_none() {
        NoiseLookup::Stale(StaleReason::Unconfirmed)
    } else {
        NoiseLookup::Measured(r.noise_pct)
    }
}

/// Pure: record a calibration, replacing this game + rig's previous one (a newer measurement under
/// a new driver supersedes the old). A non-finite, negative or zero noise level is refused, not
/// stored (zero means the spread couldn't be measured, not that there was none), and so is a
/// measurement on a rig that wasn't read.
pub(crate) fn upsert(
    store: &mut NoiseFloorStore,
    at: &NoiseConditions,
    noise_pct: f64,
    windows: u32,
    measured_at: &str,
) -> bool {
    if !noise_pct.is_finite() || noise_pct <= 0.0 || windows < 2 || !rig_was_read(&at.hw_fingerprint) {
        return false;
    }
    store.records.retain(|r| !same_key(r, at));
    store.records.push(NoiseFloorRecord {
        process_name: at.process_name.clone(),
        hw_fingerprint: at.hw_fingerprint.clone(),
        noise_pct,
        windows,
        measured_at: measured_at.to_string(),
        windows_build: at.windows_build.clone(),
        game_build: at.game_build.clone(),
    });
    let over = store.records.len().saturating_sub(MAX_RECORDS);
    store.records.drain(..over);
    store.schema_version = SCHEMA_VERSION;
    true
}

// ─── Between-session noise (P4-noise) ─────────────────────────────────────

/// Fewest unchanged sessions of a game that count as a measurement of its session-to-session spread.
/// TRIAL_PROTOCOL §5 asks for "credible run-to-run variation" but names no count, so this is 3: the
/// fewest that give more than one comparison. Below it, the spread stays unmeasured.
pub(crate) const MIN_UNCHANGED_SESSIONS: usize = 3;

/// How much an unchanged game's 1% low differed between whole sessions on this PC. Persisted on the
/// Trial record and its noise evidence (additive: older records load as `None`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct BetweenSessionNoise {
    /// The largest difference in the 1% low between two sessions of the unchanged run the measured
    /// session belongs to, in percent of the lower one.
    pub spread_pct: f64,
    /// How many sessions were counted (at least [`MIN_UNCHANGED_SESSIONS`]).
    pub sessions: u32,
}

/// The band a Trial is judged against: the measured between-session spread, but never below the
/// fixed default; the fixed default when the spread isn't measured.
/// P4-judge-noisy: no verdict in this build judges on this (it falls back to the fixed default when
/// nothing is measured). A start still records it as `noise_floor_pct`, the band an older Compy, which
/// knows only this model, would judge the record on.
pub(crate) fn noise_band_pct(measured: Option<&BetweenSessionNoise>) -> f64 {
    let floor = crate::comparison::DEFAULT_NOISE_FLOOR_PCT;
    measured.map_or(floor, |m| m.spread_pct.max(floor))
}

/// A session measured under `then` describes the game under `now`: same game, same rig, same driver,
/// and the Windows build read on both sides and equal (the game build by the same stamp rule as
/// [`lookup`]). Anything unread doesn't count. Real play checks its with-change sessions against its
/// as-is ones by the same rule (`realplay::with_arm`).
pub(crate) fn still_current(then: &NoiseConditions, now: &NoiseConditions) -> bool {
    let rig = then.hw_fingerprint.hash == now.hw_fingerprint.hash
        && then.hw_fingerprint.gpu_driver == now.hw_fingerprint.gpu_driver
        && same_rig(&then.hw_fingerprint, &now.hw_fingerprint);
    let windows = then.windows_build.is_some() && then.windows_build == now.windows_build;
    then.process_name.eq_ignore_ascii_case(&now.process_name)
        && rig
        && windows
        && stamp(then.game_build.as_ref(), now.game_build.as_ref()) == Some(true)
}

fn parse(at: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(at).ok()
}

/// When a session ended, from its start and duration. `None` when the start can't be read or the sum
/// lies past the last date chrono can hold (a corrupt length). `Duration::seconds` and `+` panic there,
/// on a command thread holding the experiment gate, which a poisoned gate then refused for every later
/// Trial command (codebase review 2026-11-02): the same guard as `realplay::ended`.
fn ended(s: &crate::sessions::SessionSummary) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    let length = chrono::Duration::try_seconds(i64::try_from(s.duration_secs).ok()?)?;
    parse(&s.started_at)?.checked_add_signed(length)
}

/// Whether any Compy change was applied or undone between `a` starting and `b` ending. A date that
/// can't be read counts as inside: an unknown never passes as "nothing changed". An undo too old to
/// carry a date can't be placed; the sessions' active-change counts are what catch it.
fn compy_change_between(
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
    a: &crate::sessions::SessionSummary,
    b: &crate::sessions::SessionSummary,
) -> bool {
    let (Some(from), Some(to)) = (parse(&a.started_at), ended(b)) else { return true };
    let inside = |at: &str| parse(at).is_none_or(|at| at >= from && at <= to);
    ledger.iter().any(|c| c.moved_at().any(inside))
}

/// Two sessions of a game, `a` before `b`, between which Compy provably changed nothing: the same
/// number of active Compy changes recorded on both, no Compy change applied or undone from `a`'s
/// start to `b`'s end, Gaming Mode recorded and the same on both, and the pair fully comparable with
/// no recorded condition changed (`comparability::derive`). A pair the data can't prove unchanged
/// doesn't count.
fn unchanged_between(
    a: &crate::sessions::SessionSummary,
    b: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
) -> bool {
    let pairing = crate::comparability::derive(a, b);
    // 453-f1: both counts made the same way, and per change both the active and the can't-confirm
    // counts equal: undoing a change Compy can't read moves only the second.
    matches!(crate::sessions::comparable_change_counts(a, b), Ok((x, y)) if x == y)
        && a.gaming_mode_active.is_some()
        && a.gaming_mode_active == b.gaming_mode_active
        && pairing.verdict == crate::comparability::Comparability::Comparable
        && pairing.changed_context.is_empty()
        && !compy_change_between(ledger, a, b)
}

/// Pure (P4-noise): how much `now`'s game varied between whole sessions on this PC with nothing
/// changed, from Compy's own session store and change history. Only sessions long enough to be a
/// baseline, of the same game on the same rig under `now`'s driver and Windows build, are read, and
/// only the unchanged run `now` belongs to within the last 14 days ([`current_unchanged_run`],
/// P4-noise-stretch): the spread is the largest 1% low difference inside that run. A session in
/// another run (something changed between them) or older than that is never compared. Fewer than
/// [`MIN_UNCHANGED_SESSIONS`] counted sessions is `None`: unmeasured, never estimated.
/// P4-judge-noisy: replaced for every verdict by [`measure_game_noise`]; a start still records it as
/// evidence (`between_session_noise`) beside the band an older Compy judges on.
pub(crate) fn between_session_noise(
    sessions: &[crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
) -> Option<BetweenSessionNoise> {
    unchanged_spread(sessions, now, ledger, |s| (s.low1_fps_est.is_finite() && s.low1_fps_est > 0.0).then_some(s.low1_fps_est))
}

/// Pure (P4-smooth-measure): how much `now`'s game's frame pacing varied between whole unchanged
/// sessions on this PC: the same sessions, runs and [`MIN_UNCHANGED_SESSIONS`] as
/// [`between_session_noise`], read on each session's `frame_pacing` p99 / p50 ratio instead of its
/// 1% low. Unit: `spread_pct` is the largest difference in that ratio between two sessions of the
/// current unchanged run, in percent of the lower ratio (a ratio of 1.40 against 1.47 is 5%). Sessions
/// recorded without frame pacing (an older Compy or helper) aren't counted. `None` = unmeasured.
/// Resolution: each ratio carries about ±1% bucket error (`FramePacing::p99_over_p50`), so a
/// spread under ~2% is at the limit of what the histogram can resolve; a band that small must not
/// be read as "this game is that steady".
/// Smoothest is offered from it (`experiment::smoothest_admission`, P4-smooth-offer).
/// P4-judge-noisy (review r1): replaced by [`measure_pacing_noise`] (one cap state, RMS x t); kept,
/// test-only, to pin how Smoothest Trials started before it were admitted.
#[cfg(test)]
pub(crate) fn between_session_pacing_noise(
    sessions: &[crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
) -> Option<BetweenSessionNoise> {
    unchanged_spread(sessions, now, ledger, |s| s.frame_pacing.as_ref().and_then(|p| p.p99_over_p50()))
}

/// The sessions a measurement under `now` may read, oldest first: long enough to be a baseline, of
/// `now`'s game on its rig under its driver and Windows build ([`still_current`]), with a start that
/// can be read.
fn sessions_like<'s>(
    sessions: &'s [crate::sessions::SessionSummary],
    now: &NoiseConditions,
) -> Vec<(chrono::DateTime<chrono::FixedOffset>, &'s crate::sessions::SessionSummary)> {
    let mut like: Vec<_> = sessions
        .iter()
        .filter(|s| s.samples >= crate::experiment::MIN_BASELINE_SAMPLES)
        .filter(|s| NoiseConditions::of_session(s).is_some_and(|c| still_current(&c, now)))
        .filter_map(|s| Some((parse(&s.started_at)?, s)))
        .collect();
    like.sort_by_key(|(at, _)| *at);
    like
}

/// Pure (P5-realplay, P4-noise-stretch): the unchanged run `now` belongs to, oldest first. Of the
/// sessions [`sessions_like`] reads, those begun at most `window_days` before `now` began and not
/// after it, walked back from `now`: each session joins while nothing changed between it and the
/// next one already in the run ([`unchanged_between`]), and the first change ends the walk. `now`
/// is in the run when it is one of `sessions` and long enough; otherwise the run is the one that
/// continues to it, and a change between the newest session and `now` leaves it empty. A session
/// in another run, or older than the window, is never this PC's noise now.
pub(crate) fn current_unchanged_run<'s>(
    sessions: &'s [crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
    window_days: i64,
) -> Vec<&'s crate::sessions::SessionSummary> {
    let (Some(conditions), Some(began)) = (NoiseConditions::of_session(now), parse(&now.started_at)) else {
        return Vec::new();
    };
    let from = began - chrono::Duration::days(window_days);
    let mut run: Vec<&crate::sessions::SessionSummary> = Vec::new();
    let mut next = now;
    for &(at, s) in sessions_like(sessions, &conditions).iter().rev() {
        if at > began {
            continue;
        }
        if at < from {
            break;
        }
        if s.started_at != now.started_at && !unchanged_between(s, next, ledger) {
            break;
        }
        run.push(s);
        next = s;
    }
    run.reverse();
    run
}

/// The shared measurement behind both spreads: `metric` reads one positive number off a session, or
/// `None` to leave the session out. P4-noise-stretch (R4): only the unchanged run `now` belongs to,
/// within `comparison::ARM_MAX_AGE_DAYS` ([`current_unchanged_run`]), is measured. A run split off
/// by a change, or older than 14 days, ran under another configuration than the PC has now; before
/// R4 the widest spread of every unchanged run in history set the band (the owner's WARDOGS bench
/// retest was judged on ±21.6% from an older run, against its own run's 1.4%).
fn unchanged_spread(
    sessions: &[crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
    metric: impl Fn(&crate::sessions::SessionSummary) -> Option<f64>,
) -> Option<BetweenSessionNoise> {
    let xs: Vec<f64> = current_unchanged_run(sessions, now, ledger, crate::comparison::ARM_MAX_AGE_DAYS)
        .into_iter()
        .filter_map(|s| metric(s).filter(|x| x.is_finite() && *x > 0.0))
        .collect();
    if xs.len() < MIN_UNCHANGED_SESSIONS {
        return None;
    }
    let (lo, hi) = xs.iter().fold((f64::INFINITY, 0.0_f64), |(lo, hi), &x| (lo.min(x), hi.max(x)));
    let spread_pct = (hi - lo) / lo * 100.0;
    let sessions = u32::try_from(xs.len()).ok()?;
    spread_pct.is_finite().then_some(BetweenSessionNoise { spread_pct, sessions })
}

// ─── Measured as-is noise (P4-judge-noisy) ────────────────────────────────
//
// The one source every verdict that calls something better or worse judges against: a Trial
// (`experiment`), the session-end regression notice and "what changed?" (`intelligence`). How it is
// measured, all fixed before any comparison is made:
//
// - Which sessions: this game's as-is sessions on this PC, the ones [`as_is_run`] reads: long enough
//   to be a baseline, under the session's own rig, driver and Windows build, within the last 14 days,
//   in the same Compy configuration (same change counts, Gaming Mode, comparable conditions) and the
//   same frame-cap state ([`cap_read`]). A Trial that applied a change and put it back between two
//   as-is sessions leaves them in the same configuration (an "excursion"); its own after-session ran
//   under another one and is skipped, never pooled. Any other Compy move between two sessions ends
//   the run, as before.
// - Which number: for the 1% low and the average separately, the root mean square of the difference
//   between each session and the next, in percent of the pair's mean. A Trial compares one session
//   with the next one, so this is the noise a Trial actually faces; differences of neighbours also
//   keep a slow drift over a day (a GPU warming up) from counting more than once.
// - The band: that root mean square times the two-sided 95% Student-t multiplier for that many
//   differences (fewer sessions, a wider band), never below `MIN_CLAIM_PCT`, the smallest effect
//   Compy ever claims. Under `MIN_UNCHANGED_SESSIONS` sessions nothing is measured and nothing is
//   assumed: the caller says so and asks for the sessions it needs.
// - Whole sessions: a Trial compares the two sessions' whole numbers (every reading taken with the
//   game in front) against a band measured on the same whole numbers. No window is picked inside a
//   session: per-window 1% lows aren't recorded, and a window chosen after seeing the data could bias
//   the result. A session uneven inside itself is part of the noise this band already measures.

/// The noise model a Trial was judged under; stored on the record. 2 = P4-judge-noisy; 3 = s27: steps
/// as log ratios, the band stored as the matching rise over the baseline ([`measure_game_noise`]).
pub(crate) const NOISE_MODEL_VERSION: u32 = 3;

/// The smallest effect Compy ever claims as better or worse, in percent. Only ever applied on top of a
/// measured band, never in place of one.
pub(crate) const MIN_CLAIM_PCT: f64 = crate::comparison::DEFAULT_NOISE_FLOOR_PCT;

/// Two-sided 95% Student-t multiplier for `df` degrees of freedom (the normal 1.96 past 30).
pub(crate) fn t95(df: usize) -> f64 {
    const T: [f64; 30] = [
        12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131,
        2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
    ];
    match df {
        0 => f64::INFINITY,
        d if d <= T.len() => T[d - 1],
        _ => 1.96,
    }
}

/// The 95% multiplier for the root mean square of the `n - 1` successive differences of `n` sessions
/// (review r1): neighbouring differences share a session, so they are correlated (rho = -1/2) and
/// carry fewer degrees of freedom than their count: about 2(n-1)^2 / (3n-4) (1.6 at n = 3, 5.6 at
/// n = 9). The t value at that fractional count is interpolated in 1/df between the table's whole
/// counts, which is never narrower than the next whole count's.
pub(crate) fn t95_eff(n: usize) -> f64 {
    if n < 2 {
        return f64::INFINITY;
    }
    let k = (n - 1) as f64;
    let df = (2.0 * k * k / (3.0 * n as f64 - 4.0)).max(1.0);
    let (lo, hi) = (df.floor(), df.ceil());
    if lo >= 30.0 || (hi - lo).abs() < f64::EPSILON {
        return t95(lo as usize);
    }
    let (t_lo, t_hi) = (t95(lo as usize), t95(hi as usize));
    let w = (1.0 / lo - 1.0 / df) / (1.0 / lo - 1.0 / hi);
    t_lo + w * (t_hi - t_lo)
}

/// Fewest 10 s buckets a session needs before Compy reads whether a cap held it (five minutes).
pub(crate) const CAP_MIN_BUCKETS: usize = 30;
/// How close to the ceiling a bucket must sit to count as held there (1.5%).
const CAP_HOLD_FRACTION: f64 = 0.015;

/// Whether a frame cap held a session's frame rate, read from its measured 10 s frame-rate buckets only
/// (never from the display's refresh rate, never from a setting Compy can't read). Stored on the
/// record (kebab-case, tagged).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub(crate) enum CapRead {
    /// The frame rate moved freely: few buckets sat at the session's ceiling.
    Uncapped,
    /// A hard ceiling with dips under it, the way a frame cap (or a limit that acts like one) holds
    /// the frame rate ([`cap_read`]).
    Capped { at_fps: f64 },
    /// Too little trace to read, or a pattern in between: Compy can't tell, and says so.
    Unknown,
}

/// How tightly a hard ceiling holds its buckets (0.5%), and how far below it a dip must reach (2%).
const CAP_CEILING_FRACTION: f64 = 0.005;
const CAP_DIP_FRACTION: f64 = 0.02;
/// How far above a cap a bucket must run to be a menu or loading screen the cap doesn't hold (10%).
const CAP_TAIL_FRACTION: f64 = 0.10;

/// Pure: read a session's cap state from its frame-rate buckets ([`CapRead`]).
/// - Capped only with a cap's own shape (review r1: a steady uncapped game is not a cap): at least half
///   the buckets within 0.5% of the densest plateau (the ceiling), at most 2% just above it (0.5-10%
///   over: a cap clips, a steady game spreads both ways), at most a quarter far above it (menus and
///   loading screens a cap doesn't hold, s27), and at least 10% dipping more than 2% below it.
/// - Uncapped: no plateau holds more than a quarter of the buckets, and at most a quarter sit within
///   1.5% of the 90th-percentile bucket.
/// - Anything else (a frame rate held almost flat with no dips, which a cap or a very steady game can
///   both produce; too little trace) is Unknown: Compy says it can't tell.
///
/// P4-noise-sf: a session whose series has been shed (`sessions::FPS_SERIES_KEEP`) reads the state
/// written on its row while the series was kept (`SessionSummary::frame_cap`); a row shed before that
/// was recorded reads Unknown. While the series is kept it is read afresh, so the row never overrides it.
pub(crate) fn cap_read(s: &crate::sessions::SessionSummary) -> CapRead {
    if s.fps_series.is_empty() {
        return s.frame_cap.unwrap_or(CapRead::Unknown);
    }
    cap_read_series(s)
}

fn cap_read_series(s: &crate::sessions::SessionSummary) -> CapRead {
    let mut fps: Vec<f64> = s.fps_series.iter().map(|&(_, f)| f).filter(|f| f.is_finite() && *f > 0.0).collect();
    if fps.len() < CAP_MIN_BUCKETS {
        return CapRead::Unknown;
    }
    fps.sort_by(f64::total_cmp);
    let n = fps.len() as f64;
    let share = |pred: &dyn Fn(f64) -> bool| fps.iter().filter(|&&f| pred(f)).count() as f64 / n;
    // Coordinator SHOULD-FIX (s27): the ceiling is the densest plateau (the most buckets within 0.5% of
    // one value), not the 95th-percentile bucket, so a cap that holds the play while menus or loading
    // screens run far above it (more than 5% of the buckets) still reads as a cap.
    // `fps` is sorted, so the buckets within 0.5% of each value form a window whose ends only move
    // forward: one pass (opus r1: the plateau search runs on every save and walk).
    let (mut lo, mut hi, mut best) = (0usize, 0usize, (0usize, 0.0f64));
    for &v in &fps {
        while fps[lo] < v - v * CAP_CEILING_FRACTION {
            lo += 1;
        }
        while hi < fps.len() && fps[hi] <= v + v * CAP_CEILING_FRACTION {
            hi += 1;
        }
        if hi - lo >= best.0 {
            best = (hi - lo, v);
        }
    }
    let plateau = best.1;
    let held: Vec<f64> = fps.iter().copied().filter(|f| (f - plateau).abs() <= plateau * CAP_CEILING_FRACTION).collect();
    let ceiling = held[held.len() / 2];
    // A cap clips: nothing sits just above it. A steady uncapped game spreads both ways around its
    // average, so buckets just above the plateau tell it apart; a menu runs far above (>10%).
    let just_above = share(&|f| f > ceiling * (1.0 + CAP_CEILING_FRACTION) && f <= ceiling * (1.0 + CAP_TAIL_FRACTION));
    let far_above = share(&|f| f > ceiling * (1.0 + CAP_TAIL_FRACTION));
    let dips = share(&|f| f < ceiling * (1.0 - CAP_DIP_FRACTION));
    if held.len() as f64 / n >= 0.5 && just_above <= 0.02 && far_above <= 0.25 && dips >= 0.1 {
        return CapRead::Capped { at_fps: (ceiling * 10.0).round() / 10.0 };
    }
    // Uncapped only when no plateau holds much of the session either: a dense plateau that isn't read
    // as a cap (a near-miss of the shape above) is "can't tell", never "no cap".
    let p90 = fps[(fps.len() - 1) * 9 / 10];
    if held.len() as f64 / n <= 0.25 && share(&|f| (f - p90).abs() <= p90 * CAP_HOLD_FRACTION) <= 0.25 {
        CapRead::Uncapped
    } else {
        CapRead::Unknown
    }
}

/// How two sessions' cap states compare.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CapPair {
    /// Both uncapped, or both held at the same ceiling (within 3%).
    Same,
    /// Both read, and they differ: a cap went on, came off or moved.
    Changed,
    /// At least one side can't be read.
    Unknown,
}

pub(crate) fn cap_pair(a: CapRead, b: CapRead) -> CapPair {
    match (a, b) {
        (CapRead::Unknown, _) | (_, CapRead::Unknown) => CapPair::Unknown,
        (CapRead::Uncapped, CapRead::Uncapped) => CapPair::Same,
        (CapRead::Capped { at_fps: x }, CapRead::Capped { at_fps: y })
            if (x - y).abs() <= x.min(y) * 2.0 * CAP_HOLD_FRACTION =>
        {
            CapPair::Same
        }
        _ => CapPair::Changed,
    }
}

/// This game's measured as-is noise on this PC (P4-judge-noisy). Persisted on the Trial record and its
/// noise evidence; additive, so older records load as `None`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct GameNoise {
    /// [`NOISE_MODEL_VERSION`] when measured.
    #[serde(default)]
    pub model: u32,
    /// ± band on the 1% low, in percent: what a change must beat to be called better or worse.
    pub low1_band_pct: f64,
    /// ± band on the average frame rate, in percent.
    pub avg_band_pct: f64,
    /// The measured session-to-session difference of the 1% low (root mean square, percent).
    pub low1_step_pct: f64,
    /// The same for the average frame rate.
    pub avg_step_pct: f64,
    /// How many as-is sessions were measured.
    pub sessions: u32,
    /// The cap state every measured session shared.
    pub cap: CapRead,
    /// P4-noise-sf: sessions of this game under the same Compy changes that were left out because
    /// their frame-cap state can't be read ([`as_is_run_skipping`]). Additive: 0 on older records.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub cap_unread: u32,
    /// Coordinator SHOULD-FIX (s27): the longest time, in minutes, from one measured session's start to
    /// the next one's. The band holds for two sessions that far apart; past it (a day's drift) it
    /// doesn't. Additive: 0 on older records, which then can't say (no gap rule is applied to them).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub max_gap_mins: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// Why this game's noise isn't measured yet: too few as-is sessions, or the cap state of the session
/// it would be measured for can't be read. Never filled in with a guess.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct NoiseUnmeasured {
    /// As-is sessions Compy could count.
    pub have: usize,
    /// As-is sessions it needs ([`MIN_UNCHANGED_SESSIONS`]).
    pub need: usize,
    /// The session's cap state couldn't be read, so no sessions could be pooled with it.
    pub cap_unknown: bool,
}

/// A Compy change that was applied and put back entirely inside `(from, to)`: Compy's own dated apply
/// and undo, never recorded as changed outside. Sessions on either side ran in the same configuration.
fn excursion_inside(
    c: &crate::experiment::LedgerEntryRef<'_>,
    from: chrono::DateTime<chrono::FixedOffset>,
    to: chrono::DateTime<chrono::FixedOffset>,
) -> bool {
    let inside = |at: Option<&str>| at.and_then(parse).is_some_and(|t| t > from && t < to);
    !c.applied && c.outside_recorded_at.is_none() && inside(Some(c.applied_at)) && inside(c.rolled_back_at)
}

/// Two as-is sessions, `a` before `b`, in the same configuration: as [`unchanged_between`], except that
/// a change applied and put back entirely between `a`'s end and `b`'s start doesn't count as a move.
fn same_configuration(
    a: &crate::sessions::SessionSummary,
    b: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
) -> bool {
    let (Some(from), Some(a_end), Some(b_start), Some(to)) = (parse(&a.started_at), ended(a), parse(&b.started_at), ended(b))
    else {
        return false;
    };
    let pairing = crate::comparability::derive(a, b);
    matches!(crate::sessions::comparable_change_counts(a, b), Ok((x, y)) if x == y)
        && a.gaming_mode_active.is_some()
        && a.gaming_mode_active == b.gaming_mode_active
        && pairing.verdict == crate::comparability::Comparability::Comparable
        && pairing.changed_context.is_empty()
        && ledger.iter().all(|c| {
            let moved_inside = c.moved_at().any(|at| parse(at).is_none_or(|t| t >= from && t <= to));
            !moved_inside || excursion_inside(c, a_end, b_start)
        })
}

/// Pure (P4-judge-noisy): the as-is sessions `now`'s noise is measured from, oldest first. Walked back
/// from `now` over the sessions [`sessions_like`] reads within `window_days`: a session that ran under
/// other change counts than `now` (a Trial's after-session) or in another cap state is skipped, never
/// pooled; one that joins must be in the same configuration as the next one already in the run
/// ([`same_configuration`]); the first that isn't ends the walk.
pub(crate) fn as_is_run<'s>(
    sessions: &'s [crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
    window_days: i64,
) -> Vec<&'s crate::sessions::SessionSummary> {
    as_is_run_skipping(sessions, now, ledger, window_days).0
}

/// [`as_is_run`], and how many sessions the walk passed over only because their frame-cap state
/// can't be read (P4-noise-sf: a series shed before its cap state was written on the row, or a
/// pattern Compy can't tell): ran under `now`'s change counts, so they would otherwise have been
/// considered. Left out, never pooled, and counted so the band can say so.
pub(crate) fn as_is_run_skipping<'s>(
    sessions: &'s [crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
    window_days: i64,
) -> (Vec<&'s crate::sessions::SessionSummary>, usize) {
    let (Some(conditions), Some(began)) = (NoiseConditions::of_session(now), parse(&now.started_at)) else {
        return (Vec::new(), 0);
    };
    let cap_now = cap_read(now);
    let from = began - chrono::Duration::days(window_days);
    let mut run: Vec<&crate::sessions::SessionSummary> = Vec::new();
    let mut cap_unread = 0usize;
    let mut next = now;
    for &(at, s) in sessions_like(sessions, &conditions).iter().rev() {
        if at > began {
            continue;
        }
        if at < from {
            break;
        }
        if s.started_at == now.started_at {
            run.push(s);
            continue;
        }
        let same_counts = matches!(crate::sessions::comparable_change_counts(s, now), Ok((x, y)) if x == y);
        let cap = cap_read(s);
        if same_counts && cap == CapRead::Unknown {
            cap_unread += 1;
        }
        if !same_counts || cap_pair(cap, cap_now) != CapPair::Same {
            continue;
        }
        if !same_configuration(s, next, ledger) {
            break;
        }
        run.push(s);
        next = s;
    }
    run.reverse();
    (run, cap_unread)
}

/// Pure (P4-judge-noisy, review r1): this game's measured frame-pacing noise for a Smoothest Trial from
/// `now`: the p99/p50 ratio of the same as-is sessions [`measure_game_noise`] reads ([`as_is_run`], so
/// never across cap states), as the root mean square of each session's difference from the next times
/// [`t95_eff`]. `spread_pct` is that band (the Smoothest start floors it at its resolution). Sessions
/// that recorded no pacing aren't counted; under [`MIN_UNCHANGED_SESSIONS`] is `None`.
pub(crate) fn measure_pacing_noise(
    sessions: &[crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
) -> Option<BetweenSessionNoise> {
    if cap_read(now) == CapRead::Unknown {
        return None;
    }
    let ratios: Vec<f64> = as_is_run(sessions, now, ledger, crate::comparison::ARM_MAX_AGE_DAYS)
        .into_iter()
        .filter_map(|s| s.frame_pacing.as_ref().and_then(|p| p.p99_over_p50()))
        .filter(|r| r.is_finite() && *r > 0.0)
        .collect();
    if ratios.len() < MIN_UNCHANGED_SESSIONS {
        return None;
    }
    let band = ((t95_eff(ratios.len()) * step_pct(&ratios)) * 10.0).ceil() / 10.0;
    let sessions = u32::try_from(ratios.len()).ok()?;
    band.is_finite().then_some(BetweenSessionNoise { spread_pct: band, sessions })
}

/// Root mean square of the difference between each value and the next, in percent of the pair's mean.
fn step_pct(xs: &[f64]) -> f64 {
    let d: Vec<f64> = xs.windows(2).map(|w| (w[1] - w[0]) / ((w[0] + w[1]) / 2.0) * 100.0).collect();
    (d.iter().map(|x| x * x).sum::<f64>() / d.len() as f64).sqrt()
}

/// Coordinator SHOULD-FIX (s27): root mean square of the log ratio of each value to the next, in
/// percent (100 ln(b/a)): a rise and the equal fall back weigh the same, and the band built from it is
/// read on the baseline's own base ([`measure_game_noise`]).
fn log_step_pct(xs: &[f64]) -> f64 {
    let d: Vec<f64> = xs.windows(2).map(|w| 100.0 * (w[1] / w[0]).ln()).collect();
    (d.iter().map(|x| x * x).sum::<f64>() / d.len() as f64).sqrt()
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Opus r1 MUST-FIX (s27): the fall that matches a measured band stored as a rise over the baseline
/// (`GameNoise::low1_band_pct`, `avg_band_pct`): the same log distance below, `B / (1 + B)`, rounded
/// down to 0.1 so it is never wider than that. A veto on a win ("didn't fall by more than the band")
/// and a Worse are judged on this, so a fall the game's own noise can't hold never lets a win through.
pub(crate) fn fall_pct(band_pct: f64) -> f64 {
    (100.0 * band_pct / (100.0 + band_pct) * 10.0).floor() / 10.0
}

/// Opus r1 SHOULD-FIX (s27): a band measured under noise model 2 (each step a % of the pair's mean,
/// stored as the band itself) read on this build's base: never narrower than the rise over the
/// baseline that matches its own step, so a Trial started before this build doesn't conclude on a
/// band that calls wins inside its noise.
pub(crate) fn on_baseline_base(n: GameNoise) -> GameNoise {
    if n.model >= NOISE_MODEL_VERSION || n.sessions < 2 {
        return n;
    }
    let t = t95_eff(n.sessions as usize);
    let rise = |stored: f64, step: f64| {
        stored.max(((100.0 * (t * step / 100.0).exp_m1()).max(MIN_CLAIM_PCT) * 10.0).ceil() / 10.0)
    };
    GameNoise {
        low1_band_pct: rise(n.low1_band_pct, n.low1_step_pct),
        avg_band_pct: rise(n.avg_band_pct, n.avg_step_pct),
        ..n
    }
}

/// Pure (P4-judge-noisy): this game's measured noise for a comparison against `now`, or why it isn't
/// measured. See the section note above for every rule; nothing here falls back to a default.
pub(crate) fn measure_game_noise(
    sessions: &[crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
) -> Result<GameNoise, NoiseUnmeasured> {
    let cap = cap_read(now);
    if cap == CapRead::Unknown {
        return Err(NoiseUnmeasured { have: 0, need: MIN_UNCHANGED_SESSIONS, cap_unknown: true });
    }
    let (run, cap_unread) = as_is_run_skipping(sessions, now, ledger, crate::comparison::ARM_MAX_AGE_DAYS);
    let counted: Vec<&crate::sessions::SessionSummary> = run
        .into_iter()
        .filter(|s| s.low1_fps_est.is_finite() && s.low1_fps_est > 0.0 && s.avg_fps.is_finite() && s.avg_fps > 0.0)
        .collect();
    let read: Vec<(f64, f64)> = counted.iter().map(|s| (s.low1_fps_est, s.avg_fps)).collect();
    let max_gap_mins = counted
        .windows(2)
        .filter_map(|w| Some((parse(&w[1].started_at)? - parse(&w[0].started_at)?).num_minutes()))
        .max()
        .and_then(|m| u32::try_from(m.max(1)).ok())
        .unwrap_or(0);
    if read.len() < MIN_UNCHANGED_SESSIONS {
        return Err(NoiseUnmeasured { have: read.len(), need: MIN_UNCHANGED_SESSIONS, cap_unknown: false });
    }
    let low: Vec<f64> = read.iter().map(|r| r.0).collect();
    let avg: Vec<f64> = read.iter().map(|r| r.1).collect();
    let t = t95_eff(read.len());
    let (low1_step_pct, avg_step_pct) = (log_step_pct(&low), log_step_pct(&avg));
    // Rounded up, so rounding never narrows the band (review r1). Coordinator SHOULD-FIX (s27): the
    // steps are log ratios, the same either way round; the band is stored as the RISE over the
    // baseline that matches it (e^b - 1), on the base a Trial's change is taken on (a % of its
    // baseline), so a win is never called inside the measured band. A fall is judged on the same
    // ± band from the baseline: a little stricter than the log distance (1 - 1/(1 + band)) for calling
    // Worse, never looser for calling Better; a change is put back either way.
    let band = |step: f64| ((100.0 * (t * step / 100.0).exp_m1()).max(MIN_CLAIM_PCT) * 10.0).ceil() / 10.0;
    let sessions = u32::try_from(read.len()).unwrap_or(u32::MAX);
    (low1_step_pct.is_finite() && avg_step_pct.is_finite())
        .then(|| GameNoise {
            model: NOISE_MODEL_VERSION,
            low1_band_pct: band(low1_step_pct),
            avg_band_pct: band(avg_step_pct),
            low1_step_pct: round1(low1_step_pct),
            avg_step_pct: round1(avg_step_pct),
            sessions,
            cap,
            cap_unread: u32::try_from(cap_unread).unwrap_or(u32::MAX),
            max_gap_mins,
        })
        .ok_or(NoiseUnmeasured { have: read.len(), need: MIN_UNCHANGED_SESSIONS, cap_unknown: false })
}

// ─── Persistence ──────────────────────────────────────────────────────────

fn store_path() -> PathBuf {
    crate::compy_data_dir().join("noise_floors.json")
}

/// Absent reads as empty. A file that doesn't parse is set aside as `.corrupt`, never parsed
/// partially, so a damaged file can't hand back a noise level nobody measured. A file that is there
/// but can't be read right now also reads as empty here, for lookups; a write builds on
/// [`load_checked_from`] instead.
pub(crate) fn load_from(path: &Path) -> NoiseFloorStore {
    load_checked_from(path).unwrap_or_default()
}

/// The read a calibration write builds on (codebase review 2026-11-02). A file that exists and could
/// not be read (a sharing violation, a permissions glitch) is an error, never an empty store: the save
/// that follows would otherwise replace every game's calibration with this one.
pub(crate) fn load_checked_from(path: &Path) -> Result<NoiseFloorStore, String> {
    let raw = match std::fs::read(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(NoiseFloorStore::default()),
        Err(e) => return Err(format!("Compy couldn't read its noise calibrations right now ({e}). Nothing was changed.")),
    };
    match serde_json::from_slice::<NoiseFloorStore>(&raw) {
        Ok(store) => Ok(store),
        // An earlier set-aside is kept, never deleted (`set_aside_damaged`). A damaged file that
        // could NOT be set aside is still in place: refuse, so no save writes over it (review round 2).
        Err(_) if crate::atomic_write::set_aside_damaged(path) => Ok(NoiseFloorStore::default()),
        Err(_) => Err(
            "Compy couldn't read its noise calibrations (the file is damaged) and couldn't set the damaged file aside right now. Nothing was changed.".to_string(),
        ),
    }
}

pub(crate) fn load() -> NoiseFloorStore {
    load_from(&store_path())
}

pub(crate) fn save_to(path: &Path, store: &NoiseFloorStore) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    crate::atomic_write::write_atomic(path, &json).map_err(|e| e.to_string())
}

/// Leaf lock: held only around this file's read-modify-write, never while taking another lock.
fn write_gate() -> &'static Mutex<()> {
    static GATE: OnceLock<Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(()))
}

/// The only way this crate takes the noise-floor gate. Records the acquisition, then blocks.
///
/// #398: a process-wide gate around a persisted read-modify-write (`load_from` -> `upsert` ->
/// `save_to`) is a store lock, so it is `race_seam::StoreLock::NoiseFloor`. A leaf: nothing inside
/// reaches another store (`store_path` is resolved by the caller before the gate is taken), and the
/// recorder panics by name if a later edit nests one in. Poison policy unchanged: the gate guards
/// no data of its own, so a poisoned one is taken over.
pub(crate) fn lock_gate() -> crate::race_seam::StoreGuard {
    crate::race_seam::hold_lock(crate::race_seam::StoreLock::NoiseFloor, || {
        write_gate().lock().unwrap_or_else(|p| p.into_inner())
    })
}

/// Record a calibration to `path`. `Ok(false)` when the measurement was refused (see [`upsert`]).
pub(crate) fn record_to(
    path: &Path,
    at: &NoiseConditions,
    noise_pct: f64,
    windows: u32,
    measured_at: &str,
) -> Result<bool, String> {
    let _g = lock_gate();
    let mut store = load_checked_from(path)?;
    if !upsert(&mut store, at, noise_pct, windows, measured_at) {
        return Ok(false);
    }
    save_to(path, &store).map(|()| true)
}

pub(crate) fn record(at: &NoiseConditions, noise_pct: f64, windows: u32, measured_at: &str) -> Result<bool, String> {
    record_to(&store_path(), at, noise_pct, windows, measured_at)
}

/// What Compy knows about the noise of the game a session ran, on the rig it ran on.
pub(crate) fn lookup_for_session(s: &crate::sessions::SessionSummary) -> NoiseLookup {
    match NoiseConditions::of_session(s) {
        Some(c) => lookup(&load(), &c),
        None => NoiseLookup::Unmeasured,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn rig(driver: &str) -> HwFingerprint {
        HwFingerprint {
            hash: format!("hash-{driver}"),
            gpu: "Radeon RX 9070 XT".into(),
            gpu_driver: driver.into(),
            ram_gb: 32,
            display: "2560x1440@165".into(),
        }
    }

    fn at(game: &str, driver: &str, windows_build: Option<&str>) -> NoiseConditions {
        NoiseConditions {
            process_name: game.into(),
            hw_fingerprint: rig(driver),
            windows_build: windows_build.map(Into::into),
            game_build: None,
        }
    }

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("compy-noise-{name}-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(p.with_extension("json.corrupt"));
        p
    }

    #[test]
    fn a_game_never_calibrated_reads_unmeasured() {
        let mut s = NoiseFloorStore::default();
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", Some("26200.1"))), NoiseLookup::Unmeasured);
        assert!(upsert(&mut s, &at("cs2.exe", "25.7.1", Some("26200.1")), 1.4, 10, "t"));
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", Some("26200.1"))), NoiseLookup::Unmeasured, "another game's noise is not this game's");
        let mut other_gpu = at("cs2.exe", "25.7.1", Some("26200.1"));
        other_gpu.hw_fingerprint.gpu = "GeForce RTX 5080".into();
        other_gpu.hw_fingerprint.hash = "other".into();
        assert_eq!(lookup(&s, &other_gpu), NoiseLookup::Unmeasured, "another PC's noise is not this PC's");
    }

    #[test]
    fn a_calibration_reads_back_for_the_same_game_and_rig() {
        let mut s = NoiseFloorStore::default();
        assert!(upsert(&mut s, &at("WARDOGS.exe", "25.7.1", Some("26200.1")), 2.25, 10, "t"));
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", Some("26200.1"))), NoiseLookup::Measured(2.25));
    }

    #[test]
    fn a_driver_windows_or_game_update_makes_it_stale() {
        let mut s = NoiseFloorStore::default();
        assert!(upsert(&mut s, &at("wardogs.exe", "25.7.1", Some("26200.1")), 2.0, 10, "t"));
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.8.1", Some("26200.1"))), NoiseLookup::Stale(StaleReason::Changed), "driver");
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", Some("26200.2"))), NoiseLookup::Stale(StaleReason::Changed), "Windows");
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", None)), NoiseLookup::Stale(StaleReason::Unconfirmed), "unread Windows build now");
        let mut patched = at("wardogs.exe", "25.7.1", Some("26200.1"));
        patched.game_build = Some("1.2".into());
        assert_eq!(lookup(&s, &patched), NoiseLookup::Stale(StaleReason::Unconfirmed), "game build read now, not then");
    }

    #[test]
    fn a_measurement_without_a_windows_build_is_never_current() {
        let mut s = NoiseFloorStore::default();
        assert!(upsert(&mut s, &at("wardogs.exe", "25.7.1", None), 2.0, 10, "t"));
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", None)), NoiseLookup::Stale(StaleReason::Unconfirmed));
        assert_eq!(
            lookup(&s, &at("wardogs.exe", "25.8.1", None)),
            NoiseLookup::Stale(StaleReason::Changed),
            "an observed change wins over an unconfirmed one"
        );
    }

    #[test]
    fn a_game_build_change_is_stale_once_builds_are_read() {
        let mut s = NoiseFloorStore::default();
        let mut then = at("wardogs.exe", "25.7.1", Some("26200.1"));
        then.game_build = Some("1.1".into());
        assert!(upsert(&mut s, &then, 2.0, 10, "t"));
        let mut now = then.clone();
        now.game_build = Some("1.2".into());
        assert_eq!(lookup(&s, &now), NoiseLookup::Stale(StaleReason::Changed));
        assert_eq!(lookup(&s, &then), NoiseLookup::Measured(2.0));
    }

    #[test]
    fn an_unread_rig_is_never_measured() {
        // `fingerprint_of` hashes even an all-empty rig, so the hash alone proves nothing.
        let unread = |c: &NoiseConditions| {
            let mut c = c.clone();
            c.hw_fingerprint.gpu = String::new();
            c.hw_fingerprint.gpu_driver = String::new();
            c.hw_fingerprint.ram_gb = 0;
            c
        };
        let good = at("wardogs.exe", "25.7.1", Some("26200.1"));
        let mut s = NoiseFloorStore::default();
        assert!(!upsert(&mut s, &unread(&good), 2.0, 10, "t"), "save path refuses an unread rig");
        assert!(s.records.is_empty());
        // A row on disk from an unread rig, looked up from an equally unread rig: still unmeasured.
        s.records.push(NoiseFloorRecord {
            process_name: "wardogs.exe".into(),
            hw_fingerprint: unread(&good).hw_fingerprint,
            noise_pct: 2.0,
            windows: 10,
            measured_at: "t".into(),
            windows_build: Some("26200.1".into()),
            game_build: None,
        });
        assert_eq!(lookup(&s, &unread(&good)), NoiseLookup::Unmeasured, "lookup path");
        for (gpu, driver, ram) in [("", "25.7.1", 32), ("Radeon RX 9070 XT", "", 32), ("Radeon RX 9070 XT", "25.7.1", 0)] {
            let mut c = good.clone();
            c.hw_fingerprint.gpu = gpu.into();
            c.hw_fingerprint.gpu_driver = driver.into();
            c.hw_fingerprint.ram_gb = ram;
            assert!(!rig_was_read(&c.hw_fingerprint), "{gpu:?} {driver:?} {ram}");
        }
    }

    #[test]
    fn a_new_calibration_replaces_the_old_one_for_that_game_and_rig() {
        let mut s = NoiseFloorStore::default();
        assert!(upsert(&mut s, &at("wardogs.exe", "25.7.1", Some("26200.1")), 2.0, 10, "t1"));
        assert!(upsert(&mut s, &at("wardogs.exe", "25.8.1", Some("26200.1")), 3.5, 10, "t2"));
        assert_eq!(s.records.len(), 1);
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.8.1", Some("26200.1"))), NoiseLookup::Measured(3.5));
    }

    #[test]
    fn an_impossible_measurement_is_refused() {
        let mut s = NoiseFloorStore::default();
        let c = at("wardogs.exe", "25.7.1", Some("26200.1"));
        for bad in [f64::NAN, f64::INFINITY, -1.0, 0.0] {
            assert!(!upsert(&mut s, &c, bad, 10, "t"), "{bad}");
        }
        assert!(!upsert(&mut s, &c, 1.0, 1, "t"), "one window has no spread");
        assert!(s.records.is_empty());
    }

    #[test]
    fn the_file_round_trips_and_a_corrupt_one_reads_as_nothing_measured() {
        let path = temp("roundtrip");
        let c = at("wardogs.exe", "25.7.1", Some("26200.1"));
        assert_eq!(record_to(&path, &c, 1.8, 10, "2026-10-24T10:00:00Z"), Ok(true));
        assert_eq!(lookup(&load_from(&path), &c), NoiseLookup::Measured(1.8));
        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(lookup(&load_from(&path), &c), NoiseLookup::Unmeasured);
        assert!(path.with_extension("json.corrupt").exists(), "the damaged file is set aside");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("json.corrupt"));
    }

    // Codebase review 2026-11-02: a file that is there but can't be read right now read as empty, and
    // the calibration saved after it replaced every other game's noise level.
    #[test]
    fn a_calibration_never_rewrites_a_store_it_could_not_read() {
        let path = temp("unreadable");
        let _ = std::fs::remove_file(&path);
        std::fs::create_dir_all(&path).unwrap(); // a read that fails on every platform
        let c = at("wardogs.exe", "25.7.1", Some("26200.1"));
        let err = record_to(&path, &c, 1.8, 10, "2026-10-24T10:00:00Z").expect_err("the write refuses");
        assert!(err.contains("couldn't read its noise calibrations right now"), "{err}");
        assert!(path.is_dir() && !path.with_extension("json.corrupt").exists(), "nothing replaced or set aside");
        assert_eq!(lookup(&load_from(&path), &c), NoiseLookup::Unmeasured, "a lookup still reads nothing measured");
        let _ = std::fs::remove_dir_all(&path);
    }

    // Same review: `Duration::seconds` and `+` panicked on a corrupt session length, on a command
    // thread holding the experiment gate, which then refused every later Trial command.
    #[test]
    fn a_corrupt_session_length_never_panics_it_just_has_no_end() {
        for secs in [u64::MAX, i64::MAX as u64, 9_000_000_000_000_000] {
            let mut s = played("2026-10-24T10:00:00Z", 180.0, 0);
            s.duration_secs = secs;
            assert_eq!(ended(&s), None, "{secs}");
        }
        assert!(ended(&played("2026-10-24T10:00:00Z", 180.0, 0)).is_some(), "an ordinary length still ends");
    }

    #[test]
    fn a_record_with_only_its_identity_still_loads() {
        // Additive: a row written before the stamps existed (or by a build that drops them) loads,
        // and reads as Unconfirmed because its Windows build can't be confirmed.
        let raw = r#"{"records":[{"process_name":"wardogs.exe","hw_fingerprint":{"hash":"hash-25.7.1","gpu":"Radeon RX 9070 XT","gpu_driver":"25.7.1","ram_gb":32,"display":"2560x1440@165"},"noise_pct":2.0}]}"#;
        let s: NoiseFloorStore = serde_json::from_str(raw).expect("loads");
        assert_eq!(s.records[0].windows, 0);
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", Some("26200.1"))), NoiseLookup::Stale(StaleReason::Unconfirmed));
    }

    #[test]
    fn a_file_with_fields_from_a_newer_compy_still_loads() {
        let raw = r#"{"schema_version":9,"future":true,"records":[{"process_name":"wardogs.exe","hw_fingerprint":{"hash":"hash-25.7.1","gpu":"Radeon RX 9070 XT","gpu_driver":"25.7.1","ram_gb":32,"display":"2560x1440@165"},"noise_pct":2.0,"windows":10,"measured_at":"t","windows_build":"26200.1","sessions":2}]}"#;
        let s: NoiseFloorStore = serde_json::from_str(raw).expect("loads");
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", Some("26200.1"))), NoiseLookup::Measured(2.0));
    }

    // ─── P4-noise: between-session noise ──────────────────────────────────

    use crate::experiment::LedgerEntryRef;
    use crate::sessions::SessionSummary;

    const WARDOGS: &str = "WardogsClient-Win64-Shipping.exe";

    /// A fully recorded 20-minute WARDOGS session on the owner's rig, as `sessions.json` stores one.
    fn played(started_at: &str, low1: f64, active: usize) -> SessionSummary {
        SessionSummary {
            started_at: started_at.into(),
            duration_secs: 1200,
            process_name: WARDOGS.into(),
            samples: 1170,
            avg_fps: 240.0,
            avg_frametime_ms: 4.2,
            low1_fps_est: low1,
            peak_gpu_temp_c: None,
            peak_gpu_usage_pct: None,
            peak_ram_used_bytes: None,
            ram_total_bytes: None,
            compy_changes_active: Some(active),
            compy_changes_per_change: true,
            compy_changes_cant_confirm: Some(0),
            compy_changes_legacy_active: None,
            compy_changes_since_set_aside: None,
            hw_fingerprint: Some(HwFingerprint {
                hash: "62f1370e0d48cfea".into(),
                gpu: "Radeon RX 9070 XT".into(),
                gpu_driver: "32.0.32015.7029".into(),
                ram_gb: 32,
                display: "1920x1080@250".into(),
            }),
            gaming_mode_active: Some(false),
            gaming_mode_plan: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
            fps_series: Vec::new(),
            capture_capabilities: Some(crate::capture::CaptureCapabilities::etw_dxgi(None)),
            game_state: Some(crate::game_state::GameStateFingerprint {
                process_name: Some(WARDOGS.into()),
                resolution_width: Some(1920),
                resolution_height: Some(1080),
                display_refresh_hz: Some(250),
                windows_build: Some("26200.8457".into()),
                ..Default::default()
            }),
            peak_cpu_temp_c: None,
            peak_gpu_hotspot_temp_c: None,
            background_secs_excluded: None,
            frame_pacing: None,
            gpu_load: None,
            frame_cap: None,
        }
    }

    fn change<'a>(id: &'a str, applied_at: &'a str, rolled_back_at: Option<&'a str>) -> LedgerEntryRef<'a> {
        LedgerEntryRef { id, rec_id: id, applied_at, applied: rolled_back_at.is_none(), rolled_back_at, outside_recorded_at: None }
    }

    /// An evening of play with nothing changed: four sessions, 1% low 150 / 156 / 147 / 153.
    fn evening() -> Vec<SessionSummary> {
        vec![
            played("2026-10-25T18:00:00+00:00", 150.0, 14),
            played("2026-10-25T18:30:00+00:00", 156.0, 14),
            played("2026-10-25T19:00:00+00:00", 147.0, 14),
            played("2026-10-25T19:30:00+00:00", 153.0, 14),
        ]
    }

    /// Changes Compy made long before the evening, still applied.
    fn settled() -> Vec<LedgerEntryRef<'static>> {
        vec![change("game-mode", "2026-10-23T14:38:16+00:00", None)]
    }

    fn spread(lo: f64, hi: f64) -> f64 {
        (hi - lo) / lo * 100.0
    }

    #[test]
    fn unchanged_sessions_measure_the_games_spread_between_sessions() {
        let s = evening();
        let got = between_session_noise(&s, &s[3], &settled()).expect("four unchanged sessions measure it");
        assert_eq!(got.sessions, 4);
        assert!((got.spread_pct - spread(147.0, 156.0)).abs() < 1e-9, "{got:?}");
        assert!((noise_band_pct(Some(&got)) - spread(147.0, 156.0)).abs() < 1e-9, "a wider spread is the band");
    }

    #[test]
    fn fewer_than_three_unchanged_sessions_stay_unmeasured() {
        let s = evening();
        assert_eq!(between_session_noise(&s[..2], &s[1], &settled()), None, "two sessions are one comparison");
        assert_eq!(noise_band_pct(None), crate::comparison::DEFAULT_NOISE_FLOOR_PCT);
        assert_eq!(between_session_noise(&s[..3], &s[2], &settled()).map(|n| n.sessions), Some(3));
    }

    #[test]
    fn a_spread_below_three_percent_still_judges_against_three() {
        let s: Vec<_> = [150.0, 151.0, 150.5].iter().enumerate()
            .map(|(i, &low1)| played(&format!("2026-10-25T1{i}:00:00+00:00"), low1, 14))
            .collect();
        let got = between_session_noise(&s, &s[2], &settled()).unwrap();
        assert!(got.spread_pct < 1.0, "{got:?}");
        assert_eq!(noise_band_pct(Some(&got)), 3.0);
    }

    #[test]
    fn a_compy_change_between_sessions_splits_them() {
        let s = evening();
        // Applied between the 2nd and 3rd session: 150/156 and 147/153 are two runs of two, and only
        // the run that ends at now is this PC's noise (P4-noise-stretch). Two sessions: unmeasured.
        let ledger = vec![change("visual-effects", "2026-10-25T18:55:00+00:00", None)];
        let mut moved = s.clone();
        for x in &mut moved[2..] {
            x.compy_changes_active = Some(15);
        }
        assert_eq!(between_session_noise(&moved, &moved[3], &ledger), None);
        // A third session in that run measures it, and 156 → 147 across the change is never compared.
        let mut third = played("2026-10-25T20:00:00+00:00", 150.0, 15);
        third.compy_changes_active = Some(15);
        moved.push(third);
        let got = between_session_noise(&moved, &moved[4], &ledger).unwrap();
        assert_eq!(got.sessions, 3);
        assert!((got.spread_pct - spread(147.0, 153.0)).abs() < 1e-9, "{got:?}");

        // Applied and undone between two sessions (counts equal again): still a change.
        let undone = vec![change("visual-effects", "2026-10-25T18:55:00+00:00", Some("2026-10-25T18:58:00+00:00"))];
        assert_eq!(between_session_noise(&s[1..3], &s[2], &undone), None);
        let three = [s[0].clone(), s[1].clone(), s[2].clone()];
        assert_eq!(between_session_noise(&three, &three[2], &undone), None, "150/156 is one run of two");
        // Applied during a session counts too.
        let during = vec![change("visual-effects", "2026-10-25T18:10:00+00:00", None)];
        assert_eq!(between_session_noise(&s[..3], &s[2], &during).map(|n| n.sessions), None);
        // An undated ledger row can't be placed, so it splits every pair.
        let undated = vec![change("visual-effects", "not a date", None)];
        assert_eq!(between_session_noise(&s, &s[3], &undated), None);
    }

    #[test]
    fn a_count_change_without_a_dated_row_splits_them() {
        // An undo too old to carry a date: only the active-change counts show it.
        let mut s = evening();
        s[2].compy_changes_active = Some(13);
        s[3].compy_changes_active = Some(13);
        assert_eq!(between_session_noise(&s[..3], &s[2], &settled()), None);
        // A session that couldn't read its change history proves nothing.
        let mut s = evening();
        s[1].compy_changes_active = None;
        assert_eq!(between_session_noise(&s[..3], &s[2], &settled()), None);
        // 453-f1 review: undoing a change Compy can't read moves only the can't-confirm count, and
        // that splits the sessions too.
        let mut s = evening();
        s[1].compy_changes_cant_confirm = Some(1);
        assert_eq!(between_session_noise(&s[..3], &s[2], &settled()), None);
        // A session an older Compy recorded is compared on the older rule's count: the newer
        // sessions carry that count too, and only a match keeps the pair.
        let mut s = evening();
        s[0].compy_changes_per_change = false;
        s[0].compy_changes_cant_confirm = None;
        assert_eq!(between_session_noise(&s[..3], &s[2], &settled()), None, "no older-rule count on the newer one");
        s[1].compy_changes_legacy_active = Some(14);
        s[2].compy_changes_legacy_active = Some(14);
        assert_eq!(between_session_noise(&s[..3], &s[2], &settled()).map(|n| n.sessions), Some(3));
        s[1].compy_changes_legacy_active = Some(15);
        assert_eq!(between_session_noise(&s[..3], &s[2], &settled()), None, "older-rule counts differ");
    }

    #[test]
    fn only_comparable_sessions_of_this_game_on_this_rig_count() {
        let base = evening();
        let check = |what: &str, edit: &dyn Fn(&mut SessionSummary)| {
            let mut s = base[..3].to_vec();
            edit(&mut s[1]);
            assert_eq!(between_session_noise(&s, &s[2], &settled()), None, "{what}");
        };
        check("another game", &|x| x.process_name = "cs2.exe".into());
        check("resolution changed", &|x| x.game_state.as_mut().unwrap().resolution_width = Some(2560));
        check("refresh unrecorded", &|x| x.game_state.as_mut().unwrap().display_refresh_hz = None);
        check("no capture record", &|x| x.capture_capabilities = None);
        check("gaming mode on", &|x| x.gaming_mode_active = Some(true));
        check("gaming mode unrecorded", &|x| x.gaming_mode_active = None);
        check("rig unread", &|x| x.hw_fingerprint.as_mut().unwrap().gpu_driver = String::new());
        check("too short to be a baseline", &|x| x.samples = 599);
        check("no 1% low", &|x| x.low1_fps_est = 0.0);
        // Measured under another driver or Windows build than now: not this rig's noise any more.
        check("older driver", &|x| x.hw_fingerprint.as_mut().unwrap().gpu_driver = "31.0".into());
        check("Windows build unread", &|x| x.game_state.as_mut().unwrap().windows_build = None);
    }

    /// P4-show-f1: a session the game spent behind another window has no 1% low, so it isn't counted,
    /// and it doesn't break the run around it either. What proves "nothing changed" is the change
    /// history plus the two measured sessions' own records; a session with no reading adds no
    /// evidence either way (the same as one too short to be a baseline), and a Compy change made
    /// while it ran is still in the history and still splits the run.
    #[test]
    fn a_session_with_no_reading_is_skipped_without_breaking_the_run() {
        let mut s = evening();
        let mut behind = played("2026-10-25T18:52:00+00:00", 0.0, 15);
        (behind.samples, behind.avg_fps, behind.avg_frametime_ms, behind.background_secs_excluded) = (0, 0.0, 0.0, Some(1500));
        behind.gaming_mode_active = Some(true);
        s.insert(2, behind);
        let got = between_session_noise(&s, &s[4], &settled()).expect("the four measured sessions still count");
        assert_eq!(got.sessions, 4);
        assert!((got.spread_pct - spread(147.0, 156.0)).abs() < 1e-9, "one unbroken run: {got:?}");
        // A Compy change applied while it ran still splits the measured sessions: the run that ends at
        // now is 147 / 153, two sessions, so nothing is measured (P4-noise-stretch).
        let during = vec![change("visual-effects", "2026-10-25T18:55:00+00:00", None)];
        assert_eq!(between_session_noise(&s, &s[4], &during), None);
    }

    #[test]
    fn the_noise_is_read_under_the_conditions_now() {
        let s = evening();
        let mut now = s[3].clone();
        now.hw_fingerprint.as_mut().unwrap().gpu_driver = "33.0".into();
        assert_eq!(between_session_noise(&s, &now, &settled()), None, "a driver update since: not measured now");
        now = s[3].clone();
        now.game_state.as_mut().unwrap().windows_build = None;
        assert_eq!(between_session_noise(&s, &now, &settled()), None, "Windows build unread now");
        // The order sessions are stored in doesn't matter.
        let mut shuffled = s.clone();
        shuffled.reverse();
        assert_eq!(between_session_noise(&shuffled, &s[3], &settled()), between_session_noise(&s, &s[3], &settled()));
    }

    /// The owner's real WARDOGS sessions and ledger (2026-10-23, copied from `%APPDATA%\Compy`):
    /// every pair had a Compy change between them (the `visual-effects` Trial applied at 15:12:25,
    /// restored 15:32:42, applied and restored 16:08:54), and the third session is 91 readings.
    #[test]
    fn the_owner_rigs_wardogs_sessions_measure_nothing_yet() {
        let mut s = vec![
            played("2026-10-23T14:49:55.232150+00:00", 153.5, 14),
            played("2026-10-23T15:12:49.470221700+00:00", 125.1, 15),
            played("2026-10-23T16:06:22.472457100+00:00", 190.7, 14),
        ];
        s[0].duration_secs = 1202;
        s[1].duration_secs = 1125;
        s[2].duration_secs = 106;
        s[2].samples = 91;
        let ledger = vec![
            change("game-mode", "2026-10-23T14:38:16.083695300+00:00", None),
            change("ve-1", "2026-10-23T15:12:25.719687+00:00", Some("2026-10-23T15:32:42.252265700+00:00")),
            change("ve-2", "2026-10-23T16:08:54.598522500+00:00", Some("2026-10-23T16:08:54.600786600+00:00")),
        ];
        assert_eq!(between_session_noise(&s, &s[1], &ledger), None);
        // Even with the counts made equal, the dated Trial rows split every pair.
        s[1].compy_changes_active = Some(14);
        s[2].samples = 1170;
        assert_eq!(between_session_noise(&s, &s[2], &ledger), None);
    }

    /// P4-noise-stretch (R4), the owner's WARDOGS bench retest: an evening of 148 / 136 / 122 on
    /// 2026-10-25, a Compy change, then 211 / 214 / 212 on 2026-10-29. The Trial started from the
    /// 10-29 run is judged on that run's 1.4% (the 3% floor), not on the 21.3% an older run of
    /// another configuration had: the widest spread in history set the band before.
    #[test]
    fn the_band_is_the_trials_own_run_not_the_widest_in_history() {
        let s = vec![
            played("2026-10-25T18:00:00+00:00", 148.0, 14),
            played("2026-10-25T18:30:00+00:00", 136.0, 14),
            played("2026-10-25T19:00:00+00:00", 122.0, 14),
            played("2026-10-29T18:00:00+00:00", 211.0, 15),
            played("2026-10-29T18:30:00+00:00", 214.0, 15),
            played("2026-10-29T19:00:00+00:00", 212.0, 15),
        ];
        let ledger = vec![
            change("game-mode", "2026-10-23T14:38:16+00:00", None),
            change("visual-effects", "2026-10-27T12:00:00+00:00", None),
        ];
        let got = between_session_noise(&s, &s[5], &ledger).expect("the 10-29 run measures it");
        assert_eq!(got.sessions, 3);
        assert!((got.spread_pct - spread(211.0, 214.0)).abs() < 1e-9, "{got:?}");
        assert_eq!(noise_band_pct(Some(&got)), 3.0);
    }

    /// P4-noise-stretch (R4): sessions a few weeks old, even with nothing changed since, are not this
    /// PC's noise now: drivers, games and Windows move on, so only the last 14 days count.
    #[test]
    fn a_run_older_than_14_days_is_not_this_pcs_noise_now() {
        let s = vec![
            played("2026-10-01T18:00:00+00:00", 150.0, 14),
            played("2026-10-01T18:30:00+00:00", 156.0, 14),
            played("2026-10-01T19:00:00+00:00", 147.0, 14),
            played("2026-10-25T18:00:00+00:00", 153.0, 14),
        ];
        let long_ago = vec![change("game-mode", "2026-09-01T10:00:00+00:00", None)];
        assert_eq!(between_session_noise(&s, &s[3], &long_ago), None, "only the session of 10-25 is in the last 14 days");
        // Read for a session not in the store (the session-end toast's view): the same.
        let next = played("2026-10-25T19:00:00+00:00", 151.0, 14);
        assert_eq!(between_session_noise(&s[..3], &next, &long_ago), None);
    }

    // ─── P5-realplay / P4-noise-stretch: the run a measurement now belongs to ──────

    fn ids(run: &[&SessionSummary]) -> Vec<String> {
        run.iter().map(|s| s.started_at.clone()).collect()
    }

    #[test]
    fn the_current_run_is_the_newest_unchanged_run_ending_at_now() {
        let s = evening();
        assert_eq!(ids(&current_unchanged_run(&s, &s[3], &settled(), 14)), ids(&s.iter().collect::<Vec<_>>()));
        // A Compy change between the 2nd and 3rd session: only the run that ends at now.
        let ledger = vec![change("visual-effects", "2026-10-25T18:55:00+00:00", None)];
        let mut moved = s.clone();
        for x in &mut moved[2..] {
            x.compy_changes_active = Some(15);
        }
        assert_eq!(ids(&current_unchanged_run(&moved, &moved[3], &ledger, 14)), ids(&[&moved[2], &moved[3]]));
        // Ending at an earlier session: the run up to it, and nothing played after it.
        assert_eq!(ids(&current_unchanged_run(&moved, &moved[1], &ledger, 14)), ids(&[&moved[0], &moved[1]]));
        // `now` not in the store (the session-end toast's view): the run that continues to it...
        let mut later = played("2026-10-25T20:00:00+00:00", 151.0, 14);
        assert_eq!(current_unchanged_run(&s, &later, &settled(), 14).len(), 4);
        // ...and a change between the newest session and `now` leaves nothing current.
        later.compy_changes_active = Some(15);
        assert!(current_unchanged_run(&s, &later, &settled(), 14).is_empty());
        // A session too short to measure is passed over without breaking the run.
        let mut short = s.clone();
        short[2].samples = 300;
        assert_eq!(ids(&current_unchanged_run(&short, &short[3], &settled(), 14)), ids(&[&s[0], &s[1], &s[3]]));
        // Another rig's or driver's sessions are never in it.
        assert!(current_unchanged_run(&s, &{
            let mut x = s[3].clone();
            x.hw_fingerprint.as_mut().unwrap().gpu_driver = "33.0".into();
            x
        }, &settled(), 14)
        .is_empty());
    }

    #[test]
    fn the_current_run_reaches_back_only_window_days() {
        let long_ago = vec![change("game-mode", "2026-09-01T10:00:00+00:00", None)];
        let s = vec![
            played("2026-10-01T18:00:00+00:00", 150.0, 14),
            played("2026-10-05T18:00:00+00:00", 152.0, 14),
            played("2026-10-20T18:00:00+00:00", 151.0, 14),
            played("2026-10-25T18:00:00+00:00", 153.0, 14),
        ];
        assert_eq!(ids(&current_unchanged_run(&s, &s[3], &long_ago, 14)), ids(&[&s[2], &s[3]]));
        assert_eq!(current_unchanged_run(&s, &s[3], &long_ago, 30).len(), 4);
    }

    fn paced(mut s: SessionSummary, p50: f64, p99: f64) -> SessionSummary {
        s.frame_pacing = Some(crate::sessions::FramePacing { frames: 280_000, p50_ms: p50, p99_ms: p99, p999_ms: Some(p99 * 2.0) });
        s
    }

    /// P4-smooth-measure: the same unchanged sessions measure how much the frame pacing (p99 / p50)
    /// varied between them, in percent of the lower ratio.
    #[test]
    fn unchanged_sessions_measure_the_pacing_spread_between_sessions() {
        let e = evening();
        // p99/p50: 1.40, 1.47, 1.43, 1.45
        let s = vec![
            paced(e[0].clone(), 4.00, 5.60),
            paced(e[1].clone(), 4.00, 5.88),
            paced(e[2].clone(), 4.00, 5.72),
            paced(e[3].clone(), 4.00, 5.80),
        ];
        let got = between_session_pacing_noise(&s, &s[3], &settled()).expect("four unchanged sessions measure it");
        assert_eq!(got.sessions, 4);
        assert!((got.spread_pct - spread(1.40, 1.47)).abs() < 1e-9, "{got:?}");
        // The 1% low band is read as before, untouched by frame pacing.
        assert_eq!(between_session_noise(&s, &s[3], &settled()), between_session_noise(&e, &e[3], &settled()));
        // Older sessions without frame pacing aren't counted: two left is unmeasured.
        let mut old = s.clone();
        old[0].frame_pacing = None;
        old[1].frame_pacing = None;
        assert_eq!(between_session_pacing_noise(&old, &old[3], &settled()), None);
        assert_eq!(between_session_pacing_noise(&e, &e[3], &settled()), None, "nothing recorded pacing");
        // A Compy change between sessions splits them, exactly as for the 1% low.
        let ledger = vec![change("ve", "2026-10-25T18:45:00+00:00", Some("2026-10-25T18:50:00+00:00"))];
        assert_eq!(between_session_pacing_noise(&s[..3], &s[2], &ledger), None);
    }

    #[test]
    fn a_between_session_measurement_round_trips_through_json() {
        // The struct is new in P4-noise; records without it load as `None` (see experiment.rs's
        // `a_record_with_a_between_session_floor_loads_in_an_older_compy_and_an_older_record_loads_here`).
        let n = BetweenSessionNoise { spread_pct: 4.2, sessions: 3 };
        let back: BetweenSessionNoise = serde_json::from_value(serde_json::to_value(&n).unwrap()).unwrap();
        assert_eq!(back, n);
    }

    // ─── P4-judge-noisy: measured as-is noise, cap state ──────────────────
    //
    // Fixtures shaped on the owner's ROB RUN day of 2026-11-11 (read-only from his session store; no
    // file copied): nine as-is sessions with 13 Compy changes on, four Trials whose change was applied
    // just after an as-is session and put back before the next one, their after-sessions with 14 on.
    // Each session's frame rate moved freely (no bucket ceiling held), so every one reads uncapped.

    /// 120 ten-second buckets that move freely around `avg` (no ceiling holds them).
    pub(crate) fn free_series(avg: f64) -> Vec<(u32, f64)> {
        (0..120u32).map(|i| (i * 10, avg * (0.78 + 0.44 * f64::from((i * 37) % 120) / 120.0))).collect()
    }

    /// 120 buckets held at `cap`, one in ten dipping under it, none above.
    pub(crate) fn capped_series(cap: f64) -> Vec<(u32, f64)> {
        (0..120u32).map(|i| (i * 10, if i % 10 == 3 { cap * 0.8 } else { cap })).collect()
    }

    fn rob(started_at: &str, secs: u64, avg: f64, low1: f64, active: usize) -> SessionSummary {
        let mut s = played(started_at, low1, active);
        s.duration_secs = secs;
        s.avg_fps = avg;
        s.fps_series = free_series(avg);
        s
    }

    /// (started_at, duration s, avg fps, 1% low, active changes) of the owner's 13 ROB RUN sessions.
    const ROB_DAY: [(&str, u64, f64, f64, usize); 13] = [
        ("2026-11-11T01:49:34+00:00", 2315, 327.9, 227.6, 13),
        ("2026-11-11T02:29:57+00:00", 1350, 309.1, 226.0, 13),
        ("2026-11-11T02:52:43+00:00", 1221, 278.2, 209.6, 13),
        ("2026-11-11T04:17:26+00:00", 1247, 262.0, 179.3, 13),
        ("2026-11-11T04:39:20+00:00", 1230, 298.8, 205.7, 13),
        ("2026-11-11T05:01:14+00:00", 1152, 289.2, 197.5, 14), // exp:7 after
        ("2026-11-11T12:05:50+00:00", 808, 284.7, 180.5, 13),
        ("2026-11-11T12:19:41+00:00", 1243, 266.3, 167.4, 14), // exp:8 after
        ("2026-11-11T12:42:41+00:00", 1267, 271.0, 173.0, 13),
        ("2026-11-11T13:04:53+00:00", 1264, 266.9, 172.7, 13),
        ("2026-11-11T13:27:19+00:00", 1658, 278.8, 176.9, 14), // exp:9 after
        ("2026-11-11T13:55:50+00:00", 1089, 274.8, 171.7, 13),
        ("2026-11-11T14:14:22+00:00", 1002, 276.7, 174.7, 14), // exp:10 after
    ];

    pub(crate) fn rob_day() -> Vec<SessionSummary> {
        ROB_DAY.iter().map(|&(at, secs, avg, low1, n)| rob(at, secs, avg, low1, n)).collect()
    }

    /// The four Trials' changes: applied just after an as-is session ended, put back before the next.
    pub(crate) fn rob_trials() -> Vec<LedgerEntryRef<'static>> {
        let mut l = settled();
        l.push(change("ve-7", "2026-11-11T05:01:00+00:00", Some("2026-11-11T05:20:29+00:00")));
        l.push(change("pu-8", "2026-11-11T12:19:27+00:00", Some("2026-11-11T12:40:28+00:00")));
        l.push(change("ve-9", "2026-11-11T13:27:06+00:00", Some("2026-11-11T13:55:01+00:00")));
        l.push(change("pu-10", "2026-11-11T14:14:08+00:00", Some("2026-11-11T14:31:08+00:00")));
        l
    }

    #[test]
    fn rob_runs_noise_is_measured_from_its_nine_as_is_sessions_across_the_trials() {
        let s = rob_day();
        // exp:10's baseline (13:55): every as-is session of the day is in the run; no after-session is.
        let run = as_is_run(&s, &s[11], &rob_trials(), 14);
        assert_eq!(run.len(), 9, "{:?}", run.iter().map(|r| &r.started_at).collect::<Vec<_>>());
        assert!(run.iter().all(|r| r.compy_changes_active == Some(13)));
        let n = measure_game_noise(&s, &s[11], &rob_trials()).expect("measured");
        eprintln!("ROB RUN measured noise: {n:?}");
        assert_eq!((n.sessions, n.cap, n.model), (9, CapRead::Uncapped, NOISE_MODEL_VERSION));
        // Wide: far past the old assumed ±3%. (s27: the band is now the rise over the baseline matching
        // the log step, so it sits above the pair-mean 23.0% / 18.0% the review measured.)
        assert!(n.low1_band_pct > 15.0 && n.low1_band_pct < 27.0, "{n:?}");
        assert!(n.avg_band_pct > 10.0 && n.avg_band_pct < 21.0, "{n:?}");
    }

    #[test]
    fn the_band_is_read_on_the_baselines_own_base_so_no_win_is_called_inside_it() {
        // Coordinator SHOULD-FIX (s27): the review measured ROB RUN at RMS 9.20% / 7.18% of each pair's
        // mean, t 2.495, a 23.0% / 18.0% band. A Trial's change is a % of its baseline, and a session
        // 23% of the pair's mean above the one before is about 26% above it: on that base a "win" at 24%
        // was inside the game's own swing. The band is now that swing as a rise over the baseline.
        let s = rob_day();
        let n = measure_game_noise(&s, &s[11], &rob_trials()).expect("measured");
        assert!(n.low1_band_pct >= 25.0 && n.low1_band_pct <= 26.5, "{n:?}");
        assert!(n.avg_band_pct >= 19.0 && n.avg_band_pct <= 20.5, "{n:?}");
        // The log step is the same rise or fall: 100 -> 125 and 125 -> 100 are one step each way.
        assert!((log_step_pct(&[100.0, 125.0]) - log_step_pct(&[125.0, 100.0])).abs() < 1e-12);
        // And the band is exactly the rise that matches t times the step, rounded up.
        let t = t95_eff(9);
        let want = ((100.0 * (t * log_step_pct(&s_lows(&s)) / 100.0).exp_m1()) * 10.0).ceil() / 10.0;
        assert!((n.low1_band_pct - want).abs() < 1e-9, "{} vs {want}", n.low1_band_pct);
    }

    #[test]
    fn a_fall_is_judged_at_the_same_log_distance_and_an_older_band_is_never_narrower() {
        // Opus r1 (s27): +25% and -20% are the same distance (1.25 x 0.8 = 1).
        assert_eq!(fall_pct(25.0), 20.0);
        assert_eq!(fall_pct(3.0), 2.9, "rounded down, never wider than the matching fall");
        // A model-2 band (pair-mean step, the band itself) is read on this build's base.
        let old = GameNoise {
            model: 2,
            low1_band_pct: 23.0,
            avg_band_pct: 18.0,
            low1_step_pct: 9.2,
            avg_step_pct: 7.2,
            sessions: 9,
            cap: CapRead::Uncapped,
            cap_unread: 0,
            max_gap_mins: 0,
        };
        let now = on_baseline_base(old.clone());
        assert!(now.low1_band_pct > 25.0 && now.avg_band_pct > 19.0, "{now:?}");
        let current = GameNoise { model: NOISE_MODEL_VERSION, ..old };
        assert_eq!(on_baseline_base(current.clone()), current, "a band on this model is untouched");
    }

    /// The nine as-is sessions' 1% lows, oldest first (`rob_day` minus the four after-sessions).
    fn s_lows(s: &[SessionSummary]) -> Vec<f64> {
        [0, 1, 2, 3, 4, 6, 8, 9, 11].iter().map(|&i| s[i].low1_fps_est).collect()
    }

    #[test]
    fn a_change_kept_between_sessions_still_ends_the_run() {
        let s = rob_day();
        // The 04:39 -> 12:05 Trial's change never put back: everything before it is another configuration.
        let mut l = rob_trials();
        l[1] = change("ve-7", "2026-11-11T05:01:00+00:00", None);
        let run = as_is_run(&s, &s[11], &l, 14);
        assert!(run.iter().all(|r| r.started_at.as_str() >= "2026-11-11T12:05"), "{}", run.len());
        // A put-back recorded as changed outside Compy is a move too.
        let mut outside = rob_trials();
        outside[3].outside_recorded_at = Some("2026-11-11T13:40:00+00:00");
        assert_eq!(as_is_run(&s, &s[11], &outside, 14).len(), 1, "only 13:55 itself");
        // An undo inside an after-session (not entirely between two as-is sessions) is no excursion.
        let mut late = rob_trials();
        late[3] = change("ve-9", "2026-11-11T13:27:06+00:00", Some("2026-11-11T13:56:30+00:00"));
        assert_eq!(as_is_run(&s, &s[11], &late, 14).len(), 1);
    }

    #[test]
    fn too_few_as_is_sessions_measure_nothing_and_say_how_many_are_needed() {
        let s = rob_day();
        // At 02:29 only two as-is sessions exist.
        let why = measure_game_noise(&s, &s[1], &rob_trials()).expect_err("unmeasured");
        assert_eq!(why, NoiseUnmeasured { have: 2, need: MIN_UNCHANGED_SESSIONS, cap_unknown: false });
        // Three is enough, with the widest multiplier (t for two differences).
        let n = measure_game_noise(&s, &s[2], &rob_trials()).unwrap();
        assert_eq!(n.sessions, 3);
        // (the stored step is rounded to 0.1, so the band is checked to within that rounding times t)
        // (s27: the band is the rise over the baseline matching t times the log step)
        let rise = (100.0 * (t95_eff(3) * n.low1_step_pct / 100.0).exp_m1()).max(MIN_CLAIM_PCT);
        assert!((n.low1_band_pct - rise).abs() < 1.0, "{n:?}");
    }

    #[test]
    fn the_multiplier_counts_the_correlated_differences_as_fewer() {
        // 2(n-1)^2/(3n-4) degrees of freedom: 1.6 at three sessions, 5.6 at nine; never narrower than
        // the whole count above it, and wider than treating the n-1 differences as independent.
        assert!(t95_eff(3) > t95(2) && t95_eff(3) < t95(1), "{}", t95_eff(3));
        assert!(t95_eff(9) > t95(6) && t95_eff(9) < t95(5) && t95_eff(9) > t95(8), "{}", t95_eff(9));
        assert!(t95_eff(200) >= 1.96 && t95_eff(200) <= 2.05, "{}", t95_eff(200));
        assert_eq!(t95_eff(1), f64::INFINITY);
    }

    #[test]
    fn a_steady_uncapped_game_is_never_read_as_capped() {
        // Review r1: a game that holds ~200 fps evenly, with no ceiling and no dips, could be a cap or
        // just steady: Compy says it can't tell, never "capped".
        let mut s = played("2026-11-11T01:49:34+00:00", 200.0, 13);
        s.fps_series = (0..120u32).map(|i| (i * 10, 200.0 + f64::from(i % 5) * 0.4 - 0.8)).collect();
        assert_eq!(cap_read(&s), CapRead::Unknown);
        // Steady around 200 then a 5% faster steady session: no "the cap changed" claim either.
        let mut faster = s.clone();
        faster.fps_series = s.fps_series.iter().map(|&(t, f)| (t, f * 1.05)).collect();
        assert_eq!(cap_pair(cap_read(&s), cap_read(&faster)), CapPair::Unknown);
    }

    #[test]
    fn a_quiet_game_measures_a_narrow_band_never_below_the_smallest_claim() {
        let mut s = evening();
        for (x, low) in s.iter_mut().zip([150.0, 150.6, 150.2, 150.9]) {
            x.low1_fps_est = low;
            x.fps_series = free_series(240.0);
        }
        let n = measure_game_noise(&s, &s[3], &settled()).unwrap();
        assert_eq!((n.low1_band_pct, n.avg_band_pct), (MIN_CLAIM_PCT, MIN_CLAIM_PCT), "{n:?}");
    }

    #[test]
    fn the_cap_state_is_read_from_the_frame_trace_never_from_the_refresh_rate() {
        let mut s = played("2026-11-11T01:49:34+00:00", 200.0, 13);
        s.fps_series = free_series(300.0);
        assert_eq!(cap_read(&s), CapRead::Uncapped, "refresh 250, frame rate free: uncapped");
        s.fps_series = capped_series(144.0);
        assert_eq!(cap_read(&s), CapRead::Capped { at_fps: 144.0 }, "held at 144 on a 250 Hz screen");
        s.fps_series = capped_series(250.0);
        assert_eq!(cap_read(&s), CapRead::Capped { at_fps: 250.0 });
        s.fps_series = free_series(300.0)[..20].to_vec();
        assert_eq!(cap_read(&s), CapRead::Unknown, "too little trace to tell");
        s.fps_series = Vec::new();
        assert_eq!(cap_read(&s), CapRead::Unknown);
        // A pattern in between (a third of the time at a ceiling) can't be told either way.
        s.fps_series = (0..120u32).map(|i| (i * 10, if i % 3 == 0 { 240.0 } else { 150.0 + f64::from(i % 50) })).collect();
        assert_eq!(cap_read(&s), CapRead::Unknown);
        assert_eq!(cap_pair(CapRead::Capped { at_fps: 144.0 }, CapRead::Capped { at_fps: 145.0 }), CapPair::Same);
        assert_eq!(cap_pair(CapRead::Capped { at_fps: 144.0 }, CapRead::Capped { at_fps: 240.0 }), CapPair::Changed);
        assert_eq!(cap_pair(CapRead::Capped { at_fps: 144.0 }, CapRead::Uncapped), CapPair::Changed);
        assert_eq!(cap_pair(CapRead::Unknown, CapRead::Uncapped), CapPair::Unknown);
    }

    #[test]
    fn capped_and_uncapped_sessions_are_never_pooled_into_one_band() {
        let mut s = rob_day();
        // The owner had a cap on for a while (2026-11-12 17:02): say 02:52 and 04:17 ran held at 240.
        for i in [2, 3] {
            s[i].fps_series = capped_series(240.0);
            s[i].avg_fps = 238.0;
        }
        let uncapped = as_is_run(&s, &s[11], &rob_trials(), 14);
        assert_eq!(uncapped.len(), 7, "the capped two are left out of an uncapped band");
        assert!(uncapped.iter().all(|r| cap_read(r) == CapRead::Uncapped));
        // Measured from a capped session, only capped sessions count: two, so not measured.
        let why = measure_game_noise(&s, &s[3], &rob_trials()).expect_err("two capped sessions");
        assert_eq!((why.have, why.cap_unknown), (2, false));
        // A session whose cap state can't be read measures nothing and says so.
        let mut short = s.clone();
        short[11].fps_series.truncate(10);
        assert!(measure_game_noise(&short, &short[11], &rob_trials()).unwrap_err().cap_unknown);
    }

    #[test]
    fn a_cap_still_reads_as_a_cap_when_menus_run_far_above_it() {
        // Coordinator SHOULD-FIX (s27): a 144 fps cap holds the play, but a fifth of the buckets are
        // menus or loading at 360 fps. The 95th-percentile bucket is a menu, which read "uncapped".
        let mut s = played("2026-11-11T01:49:34+00:00", 140.0, 13);
        s.fps_series = (0..120u32)
            .map(|i| (i * 10, match i % 10 { 3 => 115.0, 7 | 8 => 360.0, _ => 144.0 }))
            .collect();
        assert_eq!(cap_read(&s), CapRead::Capped { at_fps: 144.0 });
        // A steady uncapped game with the same menus is never read as capped: no dips under its plateau.
        s.fps_series = (0..120u32)
            .map(|i| (i * 10, if matches!(i % 10, 7 | 8) { 360.0 } else { 200.0 + f64::from(i % 5) * 0.4 - 0.8 }))
            .collect();
        assert_eq!(cap_read(&s), CapRead::Unknown);
        // A steady game spread a little both ways (just above its plateau too) isn't a cap either.
        s.fps_series = (0..120u32)
            .map(|i| (i * 10, match i % 10 { 3 => 180.0, 5 | 6 => 204.0, _ => 200.0 }))
            .collect();
        assert!(!matches!(cap_read(&s), CapRead::Capped { .. }), "{:?}", cap_read(&s));
        // A freely moving game with menus far above is still uncapped.
        let mut free = free_series(250.0);
        for b in free.iter_mut().filter(|(t, _)| matches!((t / 10) % 10, 7 | 8)) {
            b.1 = 700.0;
        }
        s.fps_series = free;
        assert_eq!(cap_read(&s), CapRead::Uncapped);
    }

    #[test]
    fn a_shed_series_counts_on_its_written_cap_state_and_an_unreadable_one_is_named() {
        // P4-noise-sf: the two oldest as-is sessions have shed their series (past the newest 20).
        let mut s = rob_day();
        for i in [0, 1] {
            s[i].fps_series = Vec::new();
            s[i].frame_cap = Some(CapRead::Uncapped);
        }
        // Their cap state was written on the row while the series was kept: they still count.
        let n = measure_game_noise(&s, &s[11], &rob_trials()).expect("measured");
        assert_eq!((n.sessions, n.cap_unread), (9, 0), "{n:?}");
        // Shed before the cap state was recorded: left out, and the band says how many.
        for i in [0, 1] {
            s[i].frame_cap = None;
        }
        let n = measure_game_noise(&s, &s[11], &rob_trials()).expect("measured");
        assert_eq!((n.sessions, n.cap_unread), (7, 2), "{n:?}");
        // After-sessions under other change counts are never counted as unread.
        s[5].fps_series = Vec::new();
        assert_eq!(measure_game_noise(&s, &s[11], &rob_trials()).unwrap().cap_unread, 2);
        // Additive: an older record without the count reads 0, and 0 isn't written.
        let json = serde_json::to_value(&n).unwrap();
        assert_eq!(json["cap_unread"], 2);
        let mut old = json.clone();
        old.as_object_mut().unwrap().remove("cap_unread");
        assert_eq!(serde_json::from_value::<GameNoise>(old).unwrap().cap_unread, 0);
        let zero = GameNoise { cap_unread: 0, ..n };
        assert!(serde_json::to_value(&zero).unwrap().get("cap_unread").is_none());
    }
}
