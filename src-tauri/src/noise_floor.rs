//! P4-noise-store — this game's measured run-to-run noise on this PC, persisted to
//! `noise_floors.json` (Trial Protocol §5, Machine Model §4, Optimization Engine §10).
//!
//! One record per game + rig. A record is written only by the Benchmark tab's calibration
//! (`benchmark_trial::start_calibration`), which measures the 1% low's spread with nothing changed,
//! and only when every captured window came from the same game. Nothing here estimates a noise
//! level: a game Compy never calibrated on this PC reads `Unmeasured`, and a measurement taken
//! before the GPU driver, Windows build or game build changed reads `Stale`, never as current.
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
        if process_name.trim().is_empty() || hw_fingerprint.hash.is_empty() {
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
        if hw_fingerprint.hash.is_empty() {
            return None;
        }
        Some(Self { process_name, hw_fingerprint, windows_build: gs.windows_build, game_build: gs.game_build })
    }
}

/// What Compy knows about this game's noise under the given conditions.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum NoiseLookup {
    /// Measured for this game on this rig under the same driver, Windows build and game build.
    Measured(f64),
    /// Measured for this game on this rig, but the driver, Windows build or game build changed
    /// since, so the number no longer describes this PC.
    Stale,
    /// Never measured for this game on this rig.
    Unmeasured,
}

/// Same machine, ignoring the driver: the driver is a freshness stamp, not identity.
fn same_rig(a: &HwFingerprint, b: &HwFingerprint) -> bool {
    a.gpu == b.gpu && a.ram_gb == b.ram_gb && a.display == b.display
}

fn same_key(r: &NoiseFloorRecord, c: &NoiseConditions) -> bool {
    r.process_name.eq_ignore_ascii_case(&c.process_name) && same_rig(&r.hw_fingerprint, &c.hw_fingerprint)
}

/// Pure: look up this game's noise under `now`. An unread Windows build on either side can't be
/// confirmed unchanged, so it reads `Stale`, not `Measured`.
pub(crate) fn lookup(store: &NoiseFloorStore, now: &NoiseConditions) -> NoiseLookup {
    let Some(r) = store.records.iter().find(|r| same_key(r, now)) else {
        return NoiseLookup::Unmeasured;
    };
    let fresh = r.hw_fingerprint.hash == now.hw_fingerprint.hash
        && r.hw_fingerprint.gpu_driver == now.hw_fingerprint.gpu_driver
        && r.windows_build.is_some()
        && r.windows_build == now.windows_build
        && r.game_build == now.game_build;
    if fresh && r.noise_pct.is_finite() && r.noise_pct >= 0.0 {
        NoiseLookup::Measured(r.noise_pct)
    } else {
        NoiseLookup::Stale
    }
}

/// Pure: record a calibration, replacing this game + rig's previous one (a newer measurement under
/// a new driver supersedes the old). A non-finite or negative noise level is refused, not stored.
pub(crate) fn upsert(
    store: &mut NoiseFloorStore,
    at: &NoiseConditions,
    noise_pct: f64,
    windows: u32,
    measured_at: &str,
) -> bool {
    if !noise_pct.is_finite() || noise_pct < 0.0 || windows < 2 {
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

/// Record a calibration to `path`. `Ok(false)` when the measurement was refused (see [`upsert`]).
pub(crate) fn record_to(
    path: &Path,
    at: &NoiseConditions,
    noise_pct: f64,
    windows: u32,
    measured_at: &str,
) -> Result<bool, String> {
    let _g = write_gate().lock().unwrap_or_else(|p| p.into_inner());
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
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.8.1", Some("26200.1"))), NoiseLookup::Stale, "driver");
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", Some("26200.2"))), NoiseLookup::Stale, "Windows");
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", None)), NoiseLookup::Stale, "unread Windows build");
        let mut patched = at("wardogs.exe", "25.7.1", Some("26200.1"));
        patched.game_build = Some("1.2".into());
        assert_eq!(lookup(&s, &patched), NoiseLookup::Stale, "game build");
    }

    #[test]
    fn a_measurement_without_a_windows_build_is_never_current() {
        let mut s = NoiseFloorStore::default();
        assert!(upsert(&mut s, &at("wardogs.exe", "25.7.1", None), 2.0, 10, "t"));
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", None)), NoiseLookup::Stale);
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
        for bad in [f64::NAN, f64::INFINITY, -1.0] {
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
        // and reads as Stale because its Windows build can't be confirmed.
        let raw = r#"{"records":[{"process_name":"wardogs.exe","hw_fingerprint":{"hash":"hash-25.7.1","gpu":"Radeon RX 9070 XT","gpu_driver":"25.7.1","ram_gb":32,"display":"2560x1440@165"},"noise_pct":2.0}]}"#;
        let s: NoiseFloorStore = serde_json::from_str(raw).expect("loads");
        assert_eq!(s.records[0].windows, 0);
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", Some("26200.1"))), NoiseLookup::Stale);
    }

    #[test]
    fn a_file_with_fields_from_a_newer_compy_still_loads() {
        let raw = r#"{"schema_version":9,"future":true,"records":[{"process_name":"wardogs.exe","hw_fingerprint":{"hash":"hash-25.7.1","gpu":"Radeon RX 9070 XT","gpu_driver":"25.7.1","ram_gb":32,"display":"2560x1440@165"},"noise_pct":2.0,"windows":10,"measured_at":"t","windows_build":"26200.1","sessions":2}]}"#;
        let s: NoiseFloorStore = serde_json::from_str(raw).expect("loads");
        assert_eq!(lookup(&s, &at("wardogs.exe", "25.7.1", Some("26200.1"))), NoiseLookup::Measured(2.0));
    }
}
