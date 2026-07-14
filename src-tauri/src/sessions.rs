//! Session summaries (F3): READ-ONLY. Aggregates the telemetry monitoring
//! already produces (FPS / frametime / 1%-low + GPU/CPU/RAM) into a per-session
//! summary when a monitoring session ends. It mutates nothing, tunes nothing,
//! adds no detection, and applies/rolls back nothing.
//!
//! Metrics are LIVE ESTIMATES sampled ~1×/sec while monitoring is active — not
//! benchmark-grade proof. The session "1% low" is an estimate (the mean of the
//! FPS helper's per-second 1%-low figures), not a true all-frametime percentile.
//!
//! The aggregation math lives in the pure `SessionAccumulator` so it's
//! unit-testable; the monitoring loop feeds it primitive readings and persists
//! the finalized summary to %APPDATA%\Compy\sessions.json.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::compy_data_dir;

// Long-term history: retain up to this many sessions (the per-second frametime timeline is still
// stripped to the most-recent 5 below, so the file stays small). The free Sessions view shows the most
// recent 20; the extended history + trends over the full retained set is a Compy Pro view
// (`SessionTrends`, ProGate-gated — dark until licensing is armed).
const MAX_SESSIONS: usize = 100;
/// Sessions shorter than this (seconds) are too brief to debrief or compare fairly — an alt-tab blip
/// or accidental capture shouldn't produce a verdict or resolve an armed comparison. Owner-tunable.
const MIN_SESSION_SECS: u64 = 60;

/// Pure: is a session long enough to be worth keeping?
fn meets_min_duration(secs: u64) -> bool {
    secs >= MIN_SESSION_SECS
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct SessionSummary {
    pub(crate) started_at: String, // RFC3339
    pub(crate) duration_secs: u64,
    pub(crate) process_name: String, // dominant presenting process ("" if none)
    pub(crate) samples: u32,         // FPS sample ticks folded in
    pub(crate) avg_fps: f64,
    pub(crate) avg_frametime_ms: f64,
    pub(crate) low1_fps_est: f64, // ESTIMATE — mean of per-second 1%-low
    pub(crate) peak_gpu_temp_c: Option<u32>,
    pub(crate) peak_gpu_usage_pct: Option<u32>,
    pub(crate) peak_ram_used_bytes: Option<u64>,
    pub(crate) ram_total_bytes: Option<u64>,
    // Renamed from `sentinel_changes_active` in the Compy rename; alias keeps pre-rename
    // sessions.json (migrated from %APPDATA%\Sentinel) parseable.
    #[serde(alias = "sentinel_changes_active")]
    pub(crate) compy_changes_active: usize, // active Compy changes during the session
    /// Rig identity at session time — groundwork for same-rig analysis. Additive: pre-fingerprint
    /// sessions parse with this as None.
    #[serde(default)]
    pub(crate) hw_fingerprint: Option<crate::hardware::HwFingerprint>,
    /// Stutter Forensics: at most one hedged insight correlating the worst dips with a signal, or
    /// None when there's no clear pattern. Computed at finalize from the read-only session timeline.
    #[serde(default)]
    pub(crate) stutter_insight: Option<String>,
    /// Read-only per-second `(elapsed_secs, 1% low)` timeline + the signal log behind the insight.
    /// Kept only for the most-recent sessions (stripped on save) so sessions.json stays small.
    #[serde(default)]
    pub(crate) stutter_timeline: Vec<(u32, f64)>,
    #[serde(default)]
    pub(crate) stutter_events: Vec<crate::stutter::StutterEvent>,
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Pure aggregator. `record_fps` is called once per tick a game is presenting;
/// `record_sensors` once per tick for peak tracking. `finalize` is given the
/// measured duration so it stays deterministic and testable.
pub(crate) struct SessionAccumulator {
    started_at: String,
    compy_changes_active: usize,
    proc_counts: HashMap<String, u32>,
    fps_sum: f64,
    frametime_sum: f64,
    low1_sum: f64,
    samples: u32,
    peak_gpu_temp_c: Option<u32>,
    peak_gpu_usage_pct: Option<u32>,
    peak_ram_used_bytes: Option<u64>,
    ram_total_bytes: Option<u64>,
}

impl SessionAccumulator {
    pub(crate) fn new(started_at: String, compy_changes_active: usize) -> Self {
        Self {
            started_at,
            compy_changes_active,
            proc_counts: HashMap::new(),
            fps_sum: 0.0,
            frametime_sum: 0.0,
            low1_sum: 0.0,
            samples: 0,
            peak_gpu_temp_c: None,
            peak_gpu_usage_pct: None,
            peak_ram_used_bytes: None,
            ram_total_bytes: None,
        }
    }

    pub(crate) fn record_fps(&mut self, process_name: &str, fps: f64, frametime_ms: f64, low1_fps: f64) {
        if !process_name.is_empty() {
            *self.proc_counts.entry(process_name.to_string()).or_insert(0) += 1;
        }
        self.fps_sum += fps;
        self.frametime_sum += frametime_ms;
        self.low1_sum += low1_fps;
        self.samples += 1;
    }

    pub(crate) fn record_sensors(
        &mut self,
        gpu_temp_c: Option<u32>,
        gpu_usage_pct: Option<u32>,
        ram_used: Option<u64>,
        ram_total: Option<u64>,
    ) {
        if let Some(t) = gpu_temp_c {
            self.peak_gpu_temp_c = Some(self.peak_gpu_temp_c.map_or(t, |p| p.max(t)));
        }
        if let Some(u) = gpu_usage_pct {
            self.peak_gpu_usage_pct = Some(self.peak_gpu_usage_pct.map_or(u, |p| p.max(u)));
        }
        if let Some(r) = ram_used {
            self.peak_ram_used_bytes = Some(self.peak_ram_used_bytes.map_or(r, |p| p.max(r)));
        }
        if let Some(t) = ram_total {
            self.ram_total_bytes = Some(t);
        }
    }

    pub(crate) fn has_data(&self) -> bool {
        self.samples > 0
    }

    pub(crate) fn finalize(self, duration_secs: u64) -> SessionSummary {
        let n = self.samples.max(1) as f64;
        let process_name = self
            .proc_counts
            .into_iter()
            .max_by_key(|(_, c)| *c)
            .map(|(p, _)| p)
            .unwrap_or_default();
        SessionSummary {
            started_at: self.started_at,
            duration_secs,
            process_name,
            samples: self.samples,
            avg_fps: round1(self.fps_sum / n),
            avg_frametime_ms: round1(self.frametime_sum / n),
            low1_fps_est: round1(self.low1_sum / n),
            peak_gpu_temp_c: self.peak_gpu_temp_c,
            peak_gpu_usage_pct: self.peak_gpu_usage_pct,
            peak_ram_used_bytes: self.peak_ram_used_bytes,
            ram_total_bytes: self.ram_total_bytes,
            compy_changes_active: self.compy_changes_active,
            // Stamped by the monitoring loop at save time (finalize stays pure/system-free).
            hw_fingerprint: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
        }
    }
}

fn sessions_path() -> PathBuf {
    compy_data_dir().join("sessions.json")
}

fn load_sessions_from(path: &Path) -> Vec<SessionSummary> {
    if !path.exists() {
        return Vec::new();
    }
    match std::fs::read_to_string(path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(v) => v,
            Err(_) => {
                // A corrupt sessions.json must not be silently overwritten by the next save — set
                // the damaged bytes aside for recovery, then start fresh. (Unlike the Trust Ledger
                // this is not a rollback contract, so we don't hard-fail: losing session history is
                // non-destructive, and blocking every future save on it would be worse.)
                let corrupt = path.with_extension("json.corrupt");
                let _ = std::fs::rename(path, &corrupt);
                Vec::new()
            }
        },
        Err(_) => Vec::new(),
    }
}

fn save_session_to(path: &Path, summary: SessionSummary) -> Result<(), String> {
    let mut all = load_sessions_from(path);
    all.push(summary);
    let len = all.len();
    if len > MAX_SESSIONS {
        all.drain(0..len - MAX_SESSIONS); // keep the most recent MAX_SESSIONS
    }
    // Keep the (large) frametime timeline only for the 5 most-recent sessions; older sessions retain
    // the insight + events but shed the per-second series so sessions.json + exports stay small.
    let strip_before = all.len().saturating_sub(5);
    for s in all.iter_mut().take(strip_before) {
        s.stutter_timeline = Vec::new();
    }
    let json = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
    // Atomic swap (mirrors history.rs save_history_to): write beside the live file then rename it
    // in (MoveFileEx + REPLACE_EXISTING on Windows), so a crash mid-write leaves the prior valid
    // sessions.json intact plus an ignorable .tmp — never a torn half-written file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Returns `Ok(true)` if a real session was saved, `Ok(false)` if it was dropped as too short — the
/// caller uses this to decide whether to fire the debrief toast.
pub(crate) fn save_session(summary: SessionSummary) -> Result<bool, String> {
    // Drop trivially short sessions entirely — no debrief, and crucially no armed-comparison
    // resolution (a blip must not confound or settle a pending comparison; the arm waits).
    if !meets_min_duration(summary.duration_secs) {
        return Ok(false);
    }
    std::fs::create_dir_all(compy_data_dir()).map_err(|e| e.to_string())?;
    // M4: if a comparison was armed for this game, compute the cross-session delta now.
    crate::comparison::on_session_finalized(&summary);
    save_session_to(&sessions_path(), summary)?;
    Ok(true)
}

#[tauri::command]
pub(crate) fn get_session_summaries() -> Vec<SessionSummary> {
    // Newest first for the UI. Corrupt/missing file fails safe to empty.
    let mut all = load_sessions_from(&sessions_path());
    all.reverse();
    all
}

#[cfg(test)]
mod session_tests {
    use super::*;

    #[test]
    fn accumulator_computes_averages_and_peaks() {
        let mut acc = SessionAccumulator::new("2026-05-31T00:00:00Z".into(), 2);
        acc.record_fps("game.exe", 120.0, 8.3, 90.0);
        acc.record_sensors(Some(60), Some(95), Some(8_000_000_000), Some(32_000_000_000));
        acc.record_fps("game.exe", 100.0, 10.0, 70.0);
        acc.record_sensors(Some(64), Some(99), Some(9_000_000_000), Some(32_000_000_000));
        let s = acc.finalize(42);
        assert_eq!(s.samples, 2);
        assert_eq!(s.duration_secs, 42);
        assert_eq!(s.avg_fps, 110.0);
        assert_eq!(s.avg_frametime_ms, 9.2); // (8.3+10.0)/2 = 9.15 -> round1 9.2
        assert_eq!(s.low1_fps_est, 80.0);
        assert_eq!(s.peak_gpu_temp_c, Some(64));
        assert_eq!(s.peak_gpu_usage_pct, Some(99));
        assert_eq!(s.peak_ram_used_bytes, Some(9_000_000_000));
        assert_eq!(s.ram_total_bytes, Some(32_000_000_000));
        assert_eq!(s.compy_changes_active, 2);
        assert_eq!(s.process_name, "game.exe");
    }

    #[test]
    fn accumulator_picks_dominant_process() {
        let mut acc = SessionAccumulator::new("t".into(), 0);
        acc.record_fps("alt.exe", 60.0, 16.6, 50.0);
        acc.record_fps("game.exe", 60.0, 16.6, 50.0);
        acc.record_fps("game.exe", 60.0, 16.6, 50.0);
        assert_eq!(acc.finalize(10).process_name, "game.exe");
    }

    #[test]
    fn zero_sample_accumulator_never_fabricates_averages() {
        // Edge (R2-4): a session that recorded sensors but no FPS frames must not invent
        // numbers — averages stay zero, the game name stays honestly empty, no NaN/panic.
        let mut acc = SessionAccumulator::new("t".into(), 0);
        acc.record_sensors(Some(60), Some(95), Some(8_000_000_000), Some(32_000_000_000));
        assert!(!acc.has_data(), "sensors alone are not a game session");
        let s = acc.finalize(120);
        assert_eq!(s.samples, 0);
        assert_eq!(s.avg_fps, 0.0, "no frames → no fabricated average");
        assert!(s.avg_fps.is_finite() && s.low1_fps_est.is_finite(), "never NaN");
        assert!(s.process_name.is_empty(), "no presenting game was ever seen");
        assert_eq!(s.peak_gpu_temp_c, Some(60), "peaks are still honest observations");
    }

    #[test]
    fn single_sample_session_is_exact() {
        let mut acc = SessionAccumulator::new("t".into(), 0);
        acc.record_fps("game.exe", 144.0, 6.9, 120.0);
        let s = acc.finalize(MIN_SESSION_SECS);
        assert_eq!(s.samples, 1);
        assert_eq!(s.avg_fps, 144.0);
        assert_eq!(s.low1_fps_est, 120.0);
    }

    #[test]
    fn trivially_short_sessions_are_dropped() {
        assert!(!meets_min_duration(0));
        assert!(!meets_min_duration(MIN_SESSION_SECS - 1));
        assert!(meets_min_duration(MIN_SESSION_SECS));
        assert!(meets_min_duration(3600));
    }

    #[test]
    fn empty_accumulator_has_no_data() {
        let acc = SessionAccumulator::new("t".into(), 0);
        assert!(!acc.has_data());
    }

    #[test]
    fn sensors_without_fps_is_not_a_session() {
        let mut acc = SessionAccumulator::new("t".into(), 0);
        acc.record_sensors(Some(50), Some(10), Some(1), Some(2));
        assert!(!acc.has_data(), "no FPS sample means no game presented");
    }

    #[test]
    fn save_load_roundtrips_and_caps_at_max() {
        let path = std::env::temp_dir().join(format!("compy-sessions-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        for i in 0..(MAX_SESSIONS + 5) {
            let mut acc = SessionAccumulator::new(format!("t{i}"), 0);
            acc.record_fps("g.exe", 100.0 + i as f64, 10.0, 80.0);
            save_session_to(&path, acc.finalize(i as u64)).unwrap();
        }
        let all = load_sessions_from(&path);
        assert_eq!(all.len(), MAX_SESSIONS, "capped to the most recent MAX_SESSIONS");
        // oldest kept is t5 (0..4 dropped); newest is the last appended
        assert_eq!(all.first().unwrap().started_at, "t5");
        assert_eq!(all.last().unwrap().started_at, format!("t{}", MAX_SESSIONS + 4));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_or_corrupt_sessions_file_loads_empty() {
        let missing = std::env::temp_dir().join("compy-sessions-absent-zzz.json");
        let _ = std::fs::remove_file(&missing);
        assert!(load_sessions_from(&missing).is_empty());

        let corrupt = std::env::temp_dir().join(format!("compy-sessions-bad-{}.json", std::process::id()));
        std::fs::write(&corrupt, b"}}not json[[").unwrap();
        assert!(load_sessions_from(&corrupt).is_empty(), "corrupt file fails safe to empty");
        std::fs::remove_file(&corrupt).ok();
    }
}
