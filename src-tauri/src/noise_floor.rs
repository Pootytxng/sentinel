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
//! it: they judge against [`between_session_noise`] (P4-noise), the spread between whole unchanged
//! sessions of the game read from the session store and change history, never below the fixed
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
    /// The largest difference in the 1% low between two of the counted sessions that ran with nothing
    /// changed between them, in percent of the lower one.
    pub spread_pct: f64,
    /// How many sessions were counted (at least [`MIN_UNCHANGED_SESSIONS`]).
    pub sessions: u32,
}

/// The band a Trial is judged against: the measured between-session spread, but never below the
/// fixed default; the fixed default when the spread isn't measured.
pub(crate) fn noise_band_pct(measured: Option<&BetweenSessionNoise>) -> f64 {
    let floor = crate::comparison::DEFAULT_NOISE_FLOOR_PCT;
    measured.map_or(floor, |m| m.spread_pct.max(floor))
}

/// A session measured under `then` describes the game under `now`: same game, same rig, same driver,
/// and the Windows build read on both sides and equal (the game build by the same stamp rule as
/// [`lookup`]). Anything unread doesn't count.
fn still_current(then: &NoiseConditions, now: &NoiseConditions) -> bool {
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

/// When a session ended, from its start and duration. `None` when the start can't be read.
fn ended(s: &crate::sessions::SessionSummary) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    let secs = i64::try_from(s.duration_secs).ok()?;
    Some(parse(&s.started_at)? + chrono::Duration::seconds(secs))
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
    ledger.iter().any(|c| inside(c.applied_at) || c.rolled_back_at.is_some_and(inside))
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
/// baseline, of the same game on the same rig under `now`'s driver and Windows build, are read. In
/// time order, each session either continues the previous one's unchanged run ([`unchanged_between`])
/// or starts a new run; runs of two or more are counted, and the spread is the largest 1% low
/// difference inside one run (sessions in different runs are never compared: something changed
/// between them). Fewer than [`MIN_UNCHANGED_SESSIONS`] counted sessions is `None`: unmeasured,
/// never estimated.
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
/// 1% low. Unit: `spread_pct` is the largest difference in that ratio between two sessions of one
/// unchanged run, in percent of the lower ratio (a ratio of 1.40 against 1.47 is 5%). Sessions
/// recorded without frame pacing (an older Compy or helper) aren't counted. `None` = unmeasured.
/// Resolution: each ratio carries about ±1% bucket error (`FramePacing::p99_over_p50`), so a
/// spread under ~2% is at the limit of what the histogram can resolve; a band that small must not
/// be read as "this game is that steady".
/// Measured only; nothing offers Smoothest from it yet (P4-smooth-offer).
#[cfg_attr(not(test), allow(dead_code))] // wired by P4-smooth-offer.
pub(crate) fn between_session_pacing_noise(
    sessions: &[crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
) -> Option<BetweenSessionNoise> {
    unchanged_spread(sessions, now, ledger, |s| s.frame_pacing.as_ref().and_then(|p| p.p99_over_p50()))
}

/// The shared measurement behind both spreads: `metric` reads one positive number off a session, or
/// `None` to leave the session out.
fn unchanged_spread(
    sessions: &[crate::sessions::SessionSummary],
    now: &crate::sessions::SessionSummary,
    ledger: &[crate::experiment::LedgerEntryRef<'_>],
    metric: impl Fn(&crate::sessions::SessionSummary) -> Option<f64>,
) -> Option<BetweenSessionNoise> {
    let now = NoiseConditions::of_session(now)?;
    let mut usable: Vec<(chrono::DateTime<chrono::FixedOffset>, &crate::sessions::SessionSummary, f64)> = sessions
        .iter()
        .filter(|s| s.samples >= crate::experiment::MIN_BASELINE_SAMPLES)
        .filter(|s| NoiseConditions::of_session(s).is_some_and(|c| still_current(&c, &now)))
        .filter_map(|s| Some((parse(&s.started_at)?, s, metric(s).filter(|x| x.is_finite() && *x > 0.0)?)))
        .collect();
    usable.sort_by_key(|(at, _, _)| *at);
    let mut runs: Vec<Vec<f64>> = Vec::new();
    let mut prev: Option<&crate::sessions::SessionSummary> = None;
    for &(_, s, x) in &usable {
        match (prev, runs.last_mut()) {
            (Some(p), Some(run)) if unchanged_between(p, s, ledger) => run.push(x),
            _ => runs.push(vec![x]),
        }
        prev = Some(s);
    }
    let runs: Vec<&Vec<f64>> = runs.iter().filter(|r| r.len() >= 2).collect();
    let counted: usize = runs.iter().map(|r| r.len()).sum();
    if counted < MIN_UNCHANGED_SESSIONS {
        return None;
    }
    let spread_pct = runs
        .iter()
        .map(|r| {
            let (lo, hi) = r.iter().fold((f64::INFINITY, 0.0_f64), |(lo, hi), &x| (lo.min(x), hi.max(x)));
            (hi - lo) / lo * 100.0
        })
        .fold(0.0_f64, f64::max);
    let sessions = u32::try_from(counted).ok()?;
    spread_pct.is_finite().then_some(BetweenSessionNoise { spread_pct, sessions })
}

// ─── Persistence ──────────────────────────────────────────────────────────

fn store_path() -> PathBuf {
    crate::compy_data_dir().join("noise_floors.json")
}

/// Absent reads as empty. A file that doesn't parse is set aside as `.corrupt`, never parsed
/// partially, so a damaged file can't hand back a noise level nobody measured.
pub(crate) fn load_from(path: &Path) -> NoiseFloorStore {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return NoiseFloorStore::default();
    };
    match serde_json::from_str::<NoiseFloorStore>(&raw) {
        Ok(store) => store,
        Err(_) => {
            let corrupt = path.with_extension("json.corrupt");
            let _ = std::fs::remove_file(&corrupt);
            let _ = std::fs::rename(path, &corrupt);
            NoiseFloorStore::default()
        }
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
    let mut store = load_from(path);
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
mod tests {
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
            hw_fingerprint: Some(HwFingerprint {
                hash: "62f1370e0d48cfea".into(),
                gpu: "Radeon RX 9070 XT".into(),
                gpu_driver: "32.0.32015.7029".into(),
                ram_gb: 32,
                display: "1920x1080@250".into(),
            }),
            gaming_mode_active: Some(false),
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
        }
    }

    fn change<'a>(id: &'a str, applied_at: &'a str, rolled_back_at: Option<&'a str>) -> LedgerEntryRef<'a> {
        LedgerEntryRef { id, rec_id: id, applied_at, applied: rolled_back_at.is_none(), rolled_back_at }
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
        // Applied between the 2nd and 3rd session: 150/156 (4.0%) and 147/153 (4.1%) are two runs of
        // two. Four sessions count, the wider run sets the spread, and 156 → 147 is never compared.
        let ledger = vec![change("visual-effects", "2026-10-25T18:55:00+00:00", None)];
        let mut moved = s.clone();
        for x in &mut moved[2..] {
            x.compy_changes_active = Some(15);
        }
        let got = between_session_noise(&moved, &moved[3], &ledger).unwrap();
        assert_eq!(got.sessions, 4);
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
}
