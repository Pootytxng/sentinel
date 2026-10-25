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
/// Read by `machine_model` (#456): the observed-chronology headroom must hold the fingerprint
/// stream these retained sessions can emit.
pub(crate) const MAX_SESSIONS: usize = 100;
/// Sessions shorter than this (seconds) are too brief to debrief or compare fairly — an alt-tab blip
/// or accidental capture shouldn't produce a verdict or resolve an armed comparison. Owner-tunable.
const MIN_SESSION_SECS: u64 = 60;
/// FPS-series downsampling: one point per this many seconds of real elapsed time. Each point is
/// the MEAN of the real ~1 Hz FPS samples that landed in the bucket — a real aggregate of real
/// samples, never an interpolation.
pub(crate) const FPS_SERIES_BUCKET_SECS: u32 = 10;
/// Series length cap: 6 h at 1 point/10 s. Past this the series just stops (its last x value
/// states its own coverage — same honesty contract as `stutter_timeline`'s 7200-tick cap).
const FPS_SERIES_MAX_POINTS: usize = 2160;
/// Keep the fps series for this many most-recent sessions (the free Sessions view window);
/// older sessions shed it on save — same policy as `stutter_timeline`'s 5, wider because the
/// series is ~10× smaller per hour.
const FPS_SERIES_KEEP: usize = 20;

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
    // `None` = Compy couldn't read its change history when the session began, so no count was
    // recorded (#669; never a fabricated 0). This is the in-memory and IPC shape (`null` to the UI).
    // On disk the field stays a plain number, so an older Compy can still load the file: an unknown
    // count is written as 0 plus `compy_changes_unrecorded: true` (see `disk_row` / `from_disk_row`).
    // A row with no count field at all loads as `None`: no Compy build ever wrote one, so nothing
    // says what the count was.
    #[serde(alias = "sentinel_changes_active", default)]
    pub(crate) compy_changes_active: Option<usize>, // active Compy changes during the session
    /// Was `compy_changes_active` counted per change by the shared live rule
    /// (`history::live_change_groups`: one per change, live check reads On; can't-confirm not
    /// included)? Builds before 453-f1 counted the newest row per change and included the ones
    /// Compy couldn't read, so their rows load `false` and their count is only compared with
    /// another old-rule count, never with a live count today. Additive: an older Compy ignores the
    /// key, and a row it re-saves loses it and reads back as old-rule (the cautious side).
    #[serde(default)]
    pub(crate) compy_changes_per_change: bool,
    /// Changes still applied that Compy couldn't confirm on or off when the session began (no live
    /// check, or the check read nothing). Counted apart from `compy_changes_active`, and compared
    /// apart (453-f1 review): undoing an unprobed change moves this, not the active count. `None` on
    /// rows an older Compy wrote and when the change history couldn't be read. Additive.
    #[serde(default)]
    pub(crate) compy_changes_cant_confirm: Option<usize>,
    /// The same moment counted the way builds before 453-f1 counted it, so a session an older Compy
    /// recorded is still compared like with like ([`comparable_change_counts`]). `None` on rows an
    /// older Compy wrote (their `compy_changes_active` is that count). Additive.
    #[serde(default)]
    pub(crate) compy_changes_legacy_active: Option<usize>,
    /// Rig identity at session time — groundwork for same-rig analysis. Additive: pre-fingerprint
    /// sessions parse with this as None.
    #[serde(default)]
    pub(crate) hw_fingerprint: Option<crate::hardware::HwFingerprint>,
    /// Was a Gaming Mode session live at ANY point during this FPS session? Sampled per tick by
    /// the monitoring loop (a save-time-only probe would miss a session that ended before
    /// monitoring stopped). Additive: pre-field records parse as None → honestly Unknown.
    #[serde(default)]
    pub(crate) gaming_mode_active: Option<bool>,
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
    /// Downsampled real FPS trace: `(bucket_start_elapsed_secs, mean fps)` per 10 s bucket of
    /// real ~1 Hz samples. Buckets with no presenting game emit nothing (gaps stay gaps). Kept
    /// for the most-recent FPS_SERIES_KEEP sessions, stripped (empty) for older ones. Additive:
    /// pre-series sessions parse with this empty.
    #[serde(default)]
    pub(crate) fps_series: Vec<(u32, f64)>,
    /// What the capture backend could actually measure for THIS session (Measurement Platform 2.0).
    /// Additive: sessions recorded before this field parse as None → honestly Unknown, never assumed
    /// to be today's backend. Stamped by the monitoring loop at save time; surfaces/exports/
    /// comparisons read it so an unsupported metric renders as unavailable, never as a real 0.
    #[serde(default)]
    pub(crate) capture_capabilities: Option<crate::capture::CaptureCapabilities>,
    /// The conditions this session ran under (Measurement Platform 2.0, Task E) — resolution, refresh,
    /// driver, Windows build, rig hash, etc. Additive: pre-field sessions parse as None → honestly
    /// Unknown. Stamped by the monitoring loop at save time. The comparability gate composes this WITH
    /// `capture_capabilities` (kept separate, not re-embedded, to avoid a second source of truth).
    #[serde(default)]
    pub(crate) game_state: Option<crate::game_state::GameStateFingerprint>,
    /// Peak CPU temperature via read-only interop (HWiNFO shared memory / LibreHardwareMonitor
    /// WMI — `cpu_temp.rs`). None when no compatible monitor is running — never fabricated; Compy
    /// ships no driver of its own, so it can only display a temp another tool is already publishing
    /// (LOCKED rule 1). Additive: pre-field sessions parse as None → honestly Unknown.
    #[serde(default)]
    pub(crate) peak_cpu_temp_c: Option<u32>,
    /// Peak GPU hotspot (junction) temperature — AMD-specific, the hottest on-die sensor RDNA
    /// cards expose. None on NVIDIA (NVML doesn't expose it) and on pre-field sessions. Additive.
    #[serde(default)]
    pub(crate) peak_gpu_hotspot_temp_c: Option<u32>,
    /// P4-comparable: seconds the game presented frames while another window was in front (the
    /// player alt-tabbed away). Those readings are left out of every measured number above
    /// (`samples`, the averages, the 1% low, `fps_series`), so a verdict or a noise band never
    /// judges time nobody was playing. `None` = this session never got a focus reading (an older
    /// Compy or helper, or a game whose window Compy can't attribute, e.g. UWP or launcher-owned),
    /// so nothing was left out on that ground and nothing says it was in front either. A menu shown
    /// in front can't be told apart from play, so it is never counted here. A floor, not a total:
    /// only seconds where the game still presented are counted (a minimized game that stops
    /// presenting adds nothing), and `duration_secs` is still wall time including these seconds.
    /// Additive: an older Compy ignores the key.
    #[serde(default)]
    pub(crate) background_secs_excluded: Option<u32>,
}

/// A session's change counts in the form another session's can be compared with (453-f1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChangeCounts {
    /// Counted per change by the shared live rule: on, and can't-confirm, each compared apart.
    PerChange { active: usize, cant_confirm: usize },
    /// Counted the way builds before 453-f1 counted (newest row, can't-confirm included).
    Legacy(usize),
}

impl std::fmt::Display for ChangeCounts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {
            ChangeCounts::PerChange { active, cant_confirm: 0 } | ChangeCounts::Legacy(active) => write!(f, "{active}"),
            ChangeCounts::PerChange { active, cant_confirm } => write!(f, "{active} (and {cant_confirm} it can't confirm)"),
        }
    }
}

impl SessionSummary {
    /// This session's counts in `per_change` form, or `None` when it recorded none in that form.
    fn change_counts(&self, per_change: bool) -> Option<ChangeCounts> {
        if per_change {
            if !self.compy_changes_per_change {
                return None;
            }
            Some(ChangeCounts::PerChange {
                active: self.compy_changes_active?,
                cant_confirm: self.compy_changes_cant_confirm?,
            })
        } else if self.compy_changes_per_change {
            self.compy_changes_legacy_active.map(ChangeCounts::Legacy)
        } else {
            self.compy_changes_active.map(ChangeCounts::Legacy)
        }
    }

    /// Why this session has no count to compare, in words, for "didn't record how many …" lines.
    pub(crate) fn unrecorded_changes_reason(&self) -> &'static str {
        if self.compy_changes_per_change
            && self.compy_changes_active.is_none()
            && self.compy_changes_cant_confirm.is_some_and(|n| n > 0)
        {
            "Compy couldn't confirm whether any of its changes were on"
        } else {
            "Compy couldn't read its change history"
        }
    }
}

/// Two sessions' change counts, made the same way so they can be compared: per change when both
/// sessions were counted per change, otherwise the older rule on both (a session this build
/// recorded carries that count too). `Err` names the session (`a` or `b`) with no count in the form
/// the pair needs.
pub(crate) fn comparable_change_counts<'s>(
    a: &'s SessionSummary,
    b: &'s SessionSummary,
) -> Result<(ChangeCounts, ChangeCounts), &'s SessionSummary> {
    let per_change = a.compy_changes_per_change && b.compy_changes_per_change;
    let ca = a.change_counts(per_change).ok_or(a)?;
    let cb = b.change_counts(per_change).ok_or(b)?;
    Ok((ca, cb))
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Pure aggregator. `record_fps` is called once per tick a game is presenting;
/// `record_sensors` once per tick for peak tracking. `finalize` is given the
/// measured duration so it stays deterministic and testable.
pub(crate) struct SessionAccumulator {
    started_at: String,
    compy_changes: Option<crate::history::SessionChangeCounts>,
    proc_counts: HashMap<String, u32>,
    fps_sum: f64,
    frametime_sum: f64,
    low1_sum: f64,
    samples: u32,
    peak_gpu_temp_c: Option<u32>,
    peak_gpu_usage_pct: Option<u32>,
    peak_ram_used_bytes: Option<u64>,
    ram_total_bytes: Option<u64>,
    peak_cpu_temp_c: Option<u32>,
    peak_gpu_hotspot_temp_c: Option<u32>,
    fps_series: Vec<(u32, f64)>,
    // Current (open) downsample bucket: index = elapsed / FPS_SERIES_BUCKET_SECS.
    bucket_idx: Option<u32>,
    bucket_sum: f64,
    bucket_count: u32,
    /// Ticks the game presented with another window in front; `None` until the helper reports focus.
    background_secs_excluded: Option<u32>,
}

impl SessionAccumulator {
    /// A session whose start recorded `active` changes on, none can't-confirm (tests).
    #[cfg(test)]
    pub(crate) fn new(started_at: String, active: Option<usize>) -> Self {
        Self::with_counts(
            started_at,
            active.map(|a| crate::history::SessionChangeCounts { active: Some(a), cant_confirm: 0, legacy_active: a }),
        )
    }

    /// `counts` is `None` when the session start couldn't read the change history (#669).
    pub(crate) fn with_counts(started_at: String, counts: Option<crate::history::SessionChangeCounts>) -> Self {
        Self {
            started_at,
            compy_changes: counts,
            proc_counts: HashMap::new(),
            fps_sum: 0.0,
            frametime_sum: 0.0,
            low1_sum: 0.0,
            samples: 0,
            peak_gpu_temp_c: None,
            peak_gpu_usage_pct: None,
            peak_ram_used_bytes: None,
            ram_total_bytes: None,
            peak_cpu_temp_c: None,
            peak_gpu_hotspot_temp_c: None,
            fps_series: Vec::new(),
            bucket_idx: None,
            bucket_sum: 0.0,
            bucket_count: 0,
            background_secs_excluded: None,
        }
    }

    /// One helper tick with its focus reading (P4-comparable). `foreground` is whether the game's
    /// window was the one in front: `Some(false)` (alt-tabbed away) is counted as background time
    /// and left out of the measurement; `Some(true)` and `None` (a helper that doesn't report focus)
    /// are measured as before. Returns whether the tick was measured.
    pub(crate) fn record_tick(
        &mut self,
        process_name: &str,
        fps: f64,
        frametime_ms: f64,
        low1_fps: f64,
        elapsed_secs: u32,
        foreground: Option<bool>,
    ) -> bool {
        match foreground {
            Some(false) => {
                *self.background_secs_excluded.get_or_insert(0) += 1;
                false
            }
            Some(true) => {
                self.background_secs_excluded.get_or_insert(0);
                self.record_fps(process_name, fps, frametime_ms, low1_fps, elapsed_secs);
                true
            }
            None => {
                self.record_fps(process_name, fps, frametime_ms, low1_fps, elapsed_secs);
                true
            }
        }
    }

    /// `elapsed_secs` is real wall time into the session (the monitoring loop's own clock) —
    /// sample index is NOT a substitute, because ticks only arrive while a game presents.
    pub(crate) fn record_fps(
        &mut self,
        process_name: &str,
        fps: f64,
        frametime_ms: f64,
        low1_fps: f64,
        elapsed_secs: u32,
    ) {
        if !process_name.is_empty() {
            *self.proc_counts.entry(process_name.to_string()).or_insert(0) += 1;
        }
        self.fps_sum += fps;
        self.frametime_sum += frametime_ms;
        self.low1_sum += low1_fps;
        self.samples += 1;

        let bucket = elapsed_secs / FPS_SERIES_BUCKET_SECS;
        match self.bucket_idx {
            Some(b) if b == bucket => {
                self.bucket_sum += fps;
                self.bucket_count += 1;
            }
            _ => {
                self.flush_bucket();
                self.bucket_idx = Some(bucket);
                self.bucket_sum = fps;
                self.bucket_count = 1;
            }
        }
    }

    /// Close the open bucket into the series as `(bucket_start_secs, mean fps)`. Past the length
    /// cap the series stops growing (its last point states its own coverage).
    fn flush_bucket(&mut self) {
        if let Some(b) = self.bucket_idx.take() {
            if self.bucket_count > 0 && self.fps_series.len() < FPS_SERIES_MAX_POINTS {
                self.fps_series.push((
                    b * FPS_SERIES_BUCKET_SECS,
                    round1(self.bucket_sum / self.bucket_count as f64),
                ));
            }
        }
        self.bucket_sum = 0.0;
        self.bucket_count = 0;
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

    /// CPU temp (HWiNFO/LibreHardwareMonitor interop, `cpu_temp.rs`) and GPU hotspot (junction)
    /// temp — both optional and tool/vendor-dependent, tracked as running peaks like
    /// `record_sensors`. Kept separate so callers without a thermal reading can skip it cleanly.
    pub(crate) fn record_thermals(&mut self, cpu_temp_c: Option<u32>, gpu_hotspot_temp_c: Option<u32>) {
        if let Some(t) = cpu_temp_c {
            self.peak_cpu_temp_c = Some(self.peak_cpu_temp_c.map_or(t, |p| p.max(t)));
        }
        if let Some(t) = gpu_hotspot_temp_c {
            self.peak_gpu_hotspot_temp_c =
                Some(self.peak_gpu_hotspot_temp_c.map_or(t, |p| p.max(t)));
        }
    }

    pub(crate) fn has_data(&self) -> bool {
        self.samples > 0
    }

    pub(crate) fn finalize(mut self, duration_secs: u64) -> SessionSummary {
        self.flush_bucket(); // the trailing partial bucket is real samples too
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
            compy_changes_active: self.compy_changes.and_then(|c| c.active),
            compy_changes_cant_confirm: self.compy_changes.map(|c| c.cant_confirm),
            compy_changes_legacy_active: self.compy_changes.map(|c| c.legacy_active),
            compy_changes_per_change: true,
            // Stamped by the monitoring loop at save time (finalize stays pure/system-free).
            hw_fingerprint: None,
            gaming_mode_active: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
            fps_series: self.fps_series,
            capture_capabilities: None,
            game_state: None,
            peak_cpu_temp_c: self.peak_cpu_temp_c,
            peak_gpu_hotspot_temp_c: self.peak_gpu_hotspot_temp_c,
            background_secs_excluded: self.background_secs_excluded,
        }
    }
}

fn sessions_path() -> PathBuf {
    compy_data_dir().join("sessions.json")
}

/// The sessions.json key that marks a row's `compy_changes_active` as not recorded (#669). The count
/// itself stays a plain number on disk: an older Compy reads `compy_changes_active` as a required
/// number and sets the whole file aside on a `null`, losing every session and Trial baseline.
const UNRECORDED_KEY: &str = "compy_changes_unrecorded";

/// The sessions.json key holding a per-change row's active count (453-f1). `compy_changes_active` on
/// disk stays the count an older Compy understands: the older rule's (newest row per change,
/// can't-confirm included). An older build ignores this key and compares its own older-rule count
/// with that number, like with like; this build reads this key back as `compy_changes_active`.
const ON_KEY: &str = "compy_changes_on";
const LEGACY_KEY: &str = "compy_changes_legacy_active";

/// One session as sessions.json stores it: an unknown count is written as 0 plus
/// `compy_changes_unrecorded: true`, never as `null`. A per-change row (453-f1) writes the older
/// rule's count as `compy_changes_active` (so an older build never compares its count with a number
/// that leaves out the changes it counts) and the per-change count under [`ON_KEY`]. Serialized
/// through a string first, so a value JSON can't hold (a non-finite number) still fails the save as
/// it always did.
fn disk_row(summary: &SessionSummary) -> Result<serde_json::Value, String> {
    let text = serde_json::to_string(summary).map_err(|e| e.to_string())?;
    let mut row: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let Some(obj) = row.as_object_mut() else { return Ok(row) };
    // The number an older build reads: the older rule's count on a per-change row, else the count.
    let older_rule_count = if summary.compy_changes_per_change {
        obj.insert(ON_KEY.into(), summary.compy_changes_active.into());
        obj.remove(LEGACY_KEY);
        summary.compy_changes_legacy_active
    } else {
        summary.compy_changes_active
    };
    match older_rule_count {
        Some(n) => {
            obj.insert("compy_changes_active".into(), n.into());
        }
        None => {
            obj.insert("compy_changes_active".into(), 0.into());
            obj.insert(UNRECORDED_KEY.into(), true.into());
        }
    }
    Ok(row)
}

/// One sessions.json row back into a session: a row marked `compy_changes_unrecorded` has no
/// older-rule count, whatever number sits beside the mark; a per-change row's active count is
/// [`ON_KEY`] and its `compy_changes_active` is the older rule's count.
fn from_disk_row(mut row: serde_json::Value) -> Result<SessionSummary, serde_json::Error> {
    if let Some(obj) = row.as_object_mut() {
        if obj.remove(UNRECORDED_KEY).and_then(|v| v.as_bool()) == Some(true) {
            obj.remove("sentinel_changes_active");
            obj.insert("compy_changes_active".into(), serde_json::Value::Null);
        }
        if let Some(on) = obj.remove(ON_KEY) {
            let older = obj.remove("compy_changes_active").unwrap_or(serde_json::Value::Null);
            obj.insert(LEGACY_KEY.into(), older);
            obj.insert("compy_changes_active".into(), on);
        }
    }
    serde_json::from_value(row)
}

fn parse_sessions(text: &str) -> Result<Vec<SessionSummary>, serde_json::Error> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(text)?;
    rows.into_iter().map(from_disk_row).collect()
}

fn load_sessions_from(path: &Path) -> Vec<SessionSummary> {
    if !path.exists() {
        return Vec::new();
    }
    match std::fs::read_to_string(path) {
        Ok(s) => match parse_sessions(&s) {
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
    // The downsampled fps series is ~10× smaller per hour, so it survives a wider window (the
    // free Sessions view's 20) before it too is shed.
    let series_strip_before = all.len().saturating_sub(FPS_SERIES_KEEP);
    for s in all.iter_mut().take(series_strip_before) {
        s.fps_series = Vec::new();
    }
    let rows = all.iter().map(disk_row).collect::<Result<Vec<_>, _>>()?;
    let json = serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?;
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
    // Tier 2 receipts (Q9a, #217): a finalized session is the ONLY thing that produces a receipt,
    // so this is the only trigger. Inert in every shipped build — it returns on receipts_gate()
    // before it reads consent, spawns anything, or touches the network. The call site lands in the
    // dark commit on purpose, so arming stays a one-line owner-signed flip rather than a
    // behavioural diff nobody reviewed.
    crate::receipts::on_session_finalized();
    // Care trigger 3 of 3 (Tier 1 task 9): a session that just ended is the likeliest moment for a
    // crash to have been recorded, so the observer gets one targeted look. Throttled like the
    // foreground trigger, off-thread, and it cannot fail this save — `scan_async` swallows
    // everything by contract.
    crate::incident_observer::scan_async(crate::incident_observer::ScanTrigger::SessionFinalized);
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

    /// P4-comparable: alt-tabbed seconds are counted but never folded into the FPS figures.
    #[test]
    fn background_ticks_stay_out_of_every_fps_figure() {
        let mut played = SessionAccumulator::new("2026-10-25T00:00:00Z".into(), Some(0));
        let mut with_break = SessionAccumulator::new("2026-10-25T00:00:00Z".into(), Some(0));
        for t in 0..20u32 {
            played.record_tick("game.exe", 120.0, 8.3, 90.0, t, Some(true));
            with_break.record_tick("game.exe", 120.0, 8.3, 90.0, t, Some(true));
        }
        // 15 s behind the desktop, where the game kept presenting at a very different rate.
        for t in 20..35u32 {
            with_break.record_tick("game.exe", 30.0, 33.3, 20.0, t, Some(false));
        }
        let a = played.finalize(20);
        let b = with_break.finalize(35);
        assert_eq!(b.samples, a.samples);
        assert_eq!(b.avg_fps, a.avg_fps);
        assert_eq!(b.avg_frametime_ms, a.avg_frametime_ms);
        assert_eq!(b.low1_fps_est, a.low1_fps_est);
        assert_eq!(b.fps_series, a.fps_series);
        assert_eq!(a.background_secs_excluded, Some(0));
        assert_eq!(b.background_secs_excluded, Some(15));
    }

    #[test]
    fn a_session_that_was_only_in_the_background_has_no_data() {
        let mut acc = SessionAccumulator::new("2026-10-25T00:00:00Z".into(), Some(0));
        acc.record_tick("game.exe", 120.0, 8.3, 90.0, 0, Some(false));
        assert!(!acc.has_data());
    }

    #[test]
    fn a_row_an_older_compy_wrote_reads_background_as_unknown() {
        let mut acc = SessionAccumulator::new("2026-10-25T00:00:00Z".into(), Some(0));
        acc.record_fps("game.exe", 120.0, 8.3, 90.0, 0);
        let mut row = serde_json::to_value(acc.finalize(60)).unwrap();
        row.as_object_mut().unwrap().remove("background_secs_excluded");
        let back: SessionSummary = serde_json::from_value(row).unwrap();
        assert_eq!(back.background_secs_excluded, None);
    }

    #[test]
    fn accumulator_computes_averages_and_peaks() {
        let mut acc = SessionAccumulator::new("2026-05-31T00:00:00Z".into(), Some(2));
        acc.record_fps("game.exe", 120.0, 8.3, 90.0, 0);
        acc.record_sensors(Some(60), Some(95), Some(8_000_000_000), Some(32_000_000_000));
        acc.record_fps("game.exe", 100.0, 10.0, 70.0, 1);
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
        assert_eq!(s.compy_changes_active, Some(2));
        assert_eq!(s.process_name, "game.exe");
    }

    #[test]
    fn accumulator_tracks_thermal_peaks_and_never_fabricates_absent_readings() {
        let mut acc = SessionAccumulator::new("2026-07-22T00:00:00Z".into(), Some(0));
        acc.record_thermals(Some(58), Some(72));
        acc.record_thermals(Some(63), None); // no hotspot reading this tick — peak must hold
        acc.record_thermals(None, Some(80)); // no CPU reading this tick — peak must hold
        let s = acc.finalize(60);
        assert_eq!(s.peak_cpu_temp_c, Some(63));
        assert_eq!(s.peak_gpu_hotspot_temp_c, Some(80));
    }

    #[test]
    fn accumulator_picks_dominant_process() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_fps("alt.exe", 60.0, 16.6, 50.0, 0);
        acc.record_fps("game.exe", 60.0, 16.6, 50.0, 1);
        acc.record_fps("game.exe", 60.0, 16.6, 50.0, 2);
        assert_eq!(acc.finalize(10).process_name, "game.exe");
    }

    #[test]
    fn zero_sample_accumulator_never_fabricates_averages() {
        // Edge (R2-4): a session that recorded sensors but no FPS frames must not invent
        // numbers — averages stay zero, the game name stays honestly empty, no NaN/panic.
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
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
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_fps("game.exe", 144.0, 6.9, 120.0, 0);
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
        let acc = SessionAccumulator::new("t".into(), Some(0));
        assert!(!acc.has_data());
    }

    #[test]
    fn sensors_without_fps_is_not_a_session() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_sensors(Some(50), Some(10), Some(1), Some(2));
        assert!(!acc.has_data(), "no FPS sample means no game presented");
    }

    #[test]
    fn save_load_roundtrips_and_caps_at_max() {
        let path = std::env::temp_dir().join(format!("compy-sessions-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        for i in 0..(MAX_SESSIONS + 5) {
            let mut acc = SessionAccumulator::new(format!("t{i}"), Some(0));
            acc.record_fps("g.exe", 100.0 + i as f64, 10.0, 80.0, 0);
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
    fn fps_series_downsamples_to_ten_second_buckets() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        // 25 real 1 Hz ticks, fps = 100 + elapsed. Buckets: [0..9] [10..19] [20..24 partial].
        for e in 0u32..25 {
            acc.record_fps("g.exe", 100.0 + e as f64, 10.0, 80.0, e);
        }
        let s = acc.finalize(25);
        assert_eq!(
            s.fps_series,
            vec![(0, 104.5), (10, 114.5), (20, 122.0)],
            "each point is the bucket's mean of REAL samples; the trailing partial bucket flushes at finalize"
        );
    }

    #[test]
    fn fps_series_gaps_stay_gaps() {
        // A game presenting at 0–4 s and again at 30–34 s (minimized between): the empty
        // buckets emit NOTHING — a gap is a gap, never an interpolated line.
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        for e in 0u32..5 {
            acc.record_fps("g.exe", 100.0, 10.0, 80.0, e);
        }
        for e in 30u32..35 {
            acc.record_fps("g.exe", 200.0, 5.0, 160.0, e);
        }
        let s = acc.finalize(35);
        assert_eq!(s.fps_series, vec![(0, 100.0), (30, 200.0)]);
    }

    #[test]
    fn fps_series_caps_at_max_points() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        // One tick per bucket, 50 buckets past the cap — the series stops, never grows unbounded.
        for b in 0..(FPS_SERIES_MAX_POINTS + 50) {
            acc.record_fps("g.exe", 100.0, 10.0, 80.0, b as u32 * FPS_SERIES_BUCKET_SECS);
        }
        let s = acc.finalize(1);
        assert_eq!(s.fps_series.len(), FPS_SERIES_MAX_POINTS);
        assert_eq!(
            s.fps_series.last().unwrap().0,
            (FPS_SERIES_MAX_POINTS as u32 - 1) * FPS_SERIES_BUCKET_SECS,
            "the last kept point states the series' own coverage"
        );
    }

    #[test]
    fn pre_series_sessions_parse_with_empty_series() {
        // Additive-contract guard: a sessions.json written before fps_series existed must
        // still parse (serde default), same as the other additive fields.
        let json = r#"[{
            "started_at": "t", "duration_secs": 120, "process_name": "g.exe", "samples": 3,
            "avg_fps": 100.0, "avg_frametime_ms": 10.0, "low1_fps_est": 80.0,
            "peak_gpu_temp_c": null, "peak_gpu_usage_pct": null, "peak_ram_used_bytes": null,
            "ram_total_bytes": null, "compy_changes_active": 0
        }]"#;
        let all: Vec<SessionSummary> = serde_json::from_str(json).unwrap();
        assert!(all[0].fps_series.is_empty());
        assert!(all[0].stutter_timeline.is_empty());
        // Measurement Platform 2.0 additive fields: an old session predates capture_capabilities and
        // game_state, so both must parse as None (honestly Unknown) — NEVER silently assumed to be
        // today's backend or back-filled with fabricated conditions.
        assert!(all[0].capture_capabilities.is_none());
        assert!(all[0].game_state.is_none());
    }

    // P4-comparable: a tick the game presented behind another window is not play, so it stays out of
    // every number a verdict or a noise band reads, and is counted apart.
    #[test]
    fn ticks_with_the_game_in_the_background_are_left_out_of_the_numbers() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        for e in 0..10 {
            assert!(acc.record_tick("g.exe", 200.0, 5.0, 150.0, e, Some(true)));
        }
        // Alt-tabbed away: the game throttles to 120 fps behind the browser.
        for e in 10..30 {
            assert!(!acc.record_tick("g.exe", 120.0, 8.3, 110.0, e, Some(false)));
        }
        let s = acc.finalize(30);
        assert_eq!(s.samples, 10);
        assert_eq!((s.avg_fps, s.avg_frametime_ms, s.low1_fps_est), (200.0, 5.0, 150.0));
        assert_eq!(s.fps_series, vec![(0, 200.0)], "background buckets stay gaps");
        assert_eq!(s.background_secs_excluded, Some(20));
    }

    #[test]
    fn focus_in_front_all_session_records_zero_left_out_and_no_reading_records_none() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_tick("g.exe", 200.0, 5.0, 150.0, 0, Some(true));
        assert_eq!(acc.finalize(10).background_secs_excluded, Some(0));
        // A helper that doesn't report focus: every tick is measured, and nothing claims none was
        // in the background.
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        for e in 0..5 {
            assert!(acc.record_tick("g.exe", 120.0, 8.3, 110.0, e, None));
        }
        let s = acc.finalize(10);
        assert_eq!((s.samples, s.background_secs_excluded), (5, None));
    }

    #[test]
    fn background_secs_is_additive_both_ways() {
        // An older row has no key and loads as "focus not recorded".
        let old = r#"[{"started_at": "t", "duration_secs": 120, "process_name": "g.exe", "samples": 3,
            "avg_fps": 100.0, "avg_frametime_ms": 10.0, "low1_fps_est": 80.0, "peak_gpu_temp_c": null,
            "peak_gpu_usage_pct": null, "peak_ram_used_bytes": null, "ram_total_bytes": null,
            "compy_changes_active": 0}]"#;
        assert_eq!(parse_sessions(old).unwrap()[0].background_secs_excluded, None);
        // A row this build writes still loads in a build that has never heard of the key.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OlderRow {
            samples: u32,
            avg_fps: f64,
            low1_fps_est: f64,
        }
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_tick("g.exe", 200.0, 5.0, 150.0, 0, Some(true));
        acc.record_tick("g.exe", 120.0, 8.3, 110.0, 1, Some(false));
        let row = disk_row(&acc.finalize(MIN_SESSION_SECS)).unwrap();
        assert_eq!(row["background_secs_excluded"], 1);
        let older: OlderRow = serde_json::from_value(row.clone()).unwrap();
        assert_eq!((older.samples, older.avg_fps), (1, 200.0));
        assert_eq!(from_disk_row(row).unwrap().background_secs_excluded, Some(1));
    }

    // #669: a session whose start couldn't read the change history records NO count: it finalizes as
    // None, reaches the UI as null and reads back as None. A session never records a count it didn't measure.
    #[test]
    fn an_unread_change_history_at_start_is_recorded_as_no_count() {
        let mut acc = SessionAccumulator::new("t".into(), None);
        acc.record_fps("g.exe", 100.0, 10.0, 80.0, 0);
        let s = acc.finalize(10);
        assert_eq!(s.compy_changes_active, None);
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""compy_changes_active":null"#), "{json}");
        let back: SessionSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(back.compy_changes_active, None);
    }

    // #669 review: an unknown count must not break an older Compy reading the same sessions.json. The
    // old build read `compy_changes_active` as a required number and set the whole file aside on a
    // `null`. On disk the unknown count is 0 plus a mark the old build ignores; this build reads the
    // mark back as unknown.
    #[test]
    fn an_unknown_count_on_disk_still_loads_in_an_older_compy_and_reads_back_unknown() {
        /// SessionSummary as builds before #669 declared it: the count a required plain number.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OldSessionSummary {
            started_at: String,
            duration_secs: u64,
            process_name: String,
            samples: u32,
            avg_fps: f64,
            avg_frametime_ms: f64,
            low1_fps_est: f64,
            peak_gpu_temp_c: Option<u32>,
            peak_gpu_usage_pct: Option<u32>,
            peak_ram_used_bytes: Option<u64>,
            ram_total_bytes: Option<u64>,
            #[serde(alias = "sentinel_changes_active")]
            compy_changes_active: usize,
        }
        let path = std::env::temp_dir().join(format!("compy-sessions-unrecorded-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let session = |count: Option<usize>| {
            let mut acc = SessionAccumulator::new("t".into(), count);
            acc.record_fps("g.exe", 100.0, 10.0, 80.0, 0);
            acc.finalize(MIN_SESSION_SECS)
        };
        save_session_to(&path, session(None)).unwrap();
        save_session_to(&path, session(Some(3))).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains(r#""compy_changes_active": null"#), "{text}");
        assert!(text.contains(r#""compy_changes_unrecorded": true"#), "{text}");
        // 453-f1: the rule mark is one more key the older build ignores.
        assert!(text.contains(r#""compy_changes_per_change": true"#), "{text}");
        let old: Vec<OldSessionSummary> = serde_json::from_str(&text).expect("an older Compy loads the file");
        assert_eq!(old.iter().map(|s| s.compy_changes_active).collect::<Vec<_>>(), [0, 3]);
        let back = load_sessions_from(&path);
        assert_eq!(back.iter().map(|s| s.compy_changes_active).collect::<Vec<_>>(), [None, Some(3)]);
        assert!(path.exists(), "the file was not set aside");
        let _ = std::fs::remove_file(&path);
    }

    // #669: every sessions.json row on disk carries a number (pre-rename rows under the old name), and
    // each loads as a KNOWN count; a row marked unrecorded, a `null` (an unreleased dev build of #669)
    // and a row without the field load as unknown, never as 0.
    #[test]
    fn a_recorded_count_loads_as_known_and_a_missing_one_as_unknown() {
        let row = |count: &str| {
            format!(
                r#"[{{ "started_at": "t", "duration_secs": 120, "process_name": "g.exe", "samples": 3,
                "avg_fps": 100.0, "avg_frametime_ms": 10.0, "low1_fps_est": 80.0,
                "peak_gpu_temp_c": null, "peak_gpu_usage_pct": null, "peak_ram_used_bytes": null,
                "ram_total_bytes": null{count} }}]"#
            )
        };
        let load = |json: String| parse_sessions(&json).unwrap().remove(0);
        assert_eq!(load(row(r#", "compy_changes_active": 2"#)).compy_changes_active, Some(2));
        assert_eq!(load(row(r#", "sentinel_changes_active": 2"#)).compy_changes_active, Some(2));
        assert_eq!(load(row(r#", "compy_changes_active": null"#)).compy_changes_active, None);
        assert_eq!(load(row("")).compy_changes_active, None);
        let unrecorded = r#", "compy_changes_active": 0, "compy_changes_unrecorded": true"#;
        assert_eq!(load(row(unrecorded)).compy_changes_active, None);
        let marked_old_name = r#", "sentinel_changes_active": 0, "compy_changes_unrecorded": true"#;
        assert_eq!(load(row(marked_old_name)).compy_changes_active, None);
        let recorded = r#", "compy_changes_active": 0, "compy_changes_unrecorded": false"#;
        assert_eq!(load(row(recorded)).compy_changes_active, Some(0));
        // 453-f1: a row an older Compy wrote was counted by the old rule; this build's rows say so.
        assert!(!load(row(r#", "compy_changes_active": 2"#)).compy_changes_per_change);
        let per_change = r#", "compy_changes_active": 2, "compy_changes_per_change": true"#;
        assert!(load(row(per_change)).compy_changes_per_change);
    }

    // 453-f1 review: a session records the changes Compy can't confirm apart from the active count
    // (and the older rule's count beside them), and a start where nothing could be confirmed records
    // the active count as unknown — on disk the downgrade-safe 0 + unrecorded mark — never as 0.
    #[test]
    fn a_session_records_cant_confirm_apart_and_nothing_confirmed_as_unknown() {
        let path = std::env::temp_dir().join(format!("compy-sessions-cant-confirm-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let session = |active, cant| {
            let counts = crate::history::SessionChangeCounts { active, cant_confirm: cant, legacy_active: 7 };
            let mut acc = SessionAccumulator::with_counts("t".into(), Some(counts));
            acc.record_fps("g.exe", 100.0, 10.0, 80.0, 0);
            acc.finalize(MIN_SESSION_SECS)
        };
        save_session_to(&path, session(Some(2), 1)).unwrap();
        save_session_to(&path, session(None, 3)).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        // Nothing confirmed: the per-change count is unknown (null under its own key), while an
        // older build still reads its own rule's count, which is known.
        assert!(text.contains(r#""compy_changes_on": null"#), "{text}");
        assert!(!text.contains("compy_changes_unrecorded"), "{text}");
        let back = load_sessions_from(&path);
        let got: Vec<_> = back
            .iter()
            .map(|s| (s.compy_changes_active, s.compy_changes_cant_confirm, s.compy_changes_legacy_active))
            .collect();
        assert_eq!(got, [(Some(2), Some(1), Some(7)), (None, Some(3), Some(7))]);
        assert_eq!(back[1].unrecorded_changes_reason(), "Compy couldn't confirm whether any of its changes were on");
        assert_eq!(back[0].unrecorded_changes_reason(), "Compy couldn't read its change history");
        let _ = std::fs::remove_file(&path);
    }

    // 453-f1 final review (downgrade): an older build (038e5606) ignores `compy_changes_per_change`
    // and compares its own older-rule count with `compy_changes_active`. Baseline 1 on + 1 Compy
    // can't confirm is 2 by that rule; writing the per-change 1 there let it pass a Trial after the
    // on change was reverted (1 = 1). On disk the field stays the older rule's number.
    #[test]
    fn an_older_compy_reads_the_older_rule_count_from_a_per_change_row() {
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OldSessionSummary {
            started_at: String,
            duration_secs: u64,
            process_name: String,
            samples: u32,
            avg_fps: f64,
            avg_frametime_ms: f64,
            low1_fps_est: f64,
            peak_gpu_temp_c: Option<u32>,
            peak_gpu_usage_pct: Option<u32>,
            peak_ram_used_bytes: Option<u64>,
            ram_total_bytes: Option<u64>,
            #[serde(alias = "sentinel_changes_active")]
            compy_changes_active: usize,
        }
        let path = std::env::temp_dir().join(format!("compy-sessions-downgrade-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let counts = crate::history::SessionChangeCounts { active: Some(1), cant_confirm: 1, legacy_active: 2 };
        let mut acc = SessionAccumulator::with_counts("t".into(), Some(counts));
        acc.record_fps("g.exe", 100.0, 10.0, 80.0, 0);
        save_session_to(&path, acc.finalize(MIN_SESSION_SECS)).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let old: Vec<OldSessionSummary> = serde_json::from_str(&text).expect("an older Compy loads the file");
        assert_eq!(old[0].compy_changes_active, 2, "the older build sees the older rule's number: {text}");
        assert!(!text.contains("compy_changes_unrecorded"), "{text}");
        // This build reads its own counts back unchanged.
        let back = load_sessions_from(&path);
        assert_eq!(
            (back[0].compy_changes_active, back[0].compy_changes_cant_confirm, back[0].compy_changes_legacy_active),
            (Some(1), Some(1), Some(2))
        );
        // And re-saving round-trips the same row.
        assert_eq!(disk_row(&back[0]).unwrap(), serde_json::from_str::<Vec<serde_json::Value>>(&text).unwrap()[0]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn fps_series_persists_and_strips_past_keep_window() {
        let path = std::env::temp_dir().join(format!("compy-sessions-series-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let total = FPS_SERIES_KEEP + 5;
        for i in 0..total {
            let mut acc = SessionAccumulator::new(format!("t{i}"), Some(0));
            acc.record_fps("g.exe", 100.0, 10.0, 80.0, 0);
            save_session_to(&path, acc.finalize(90)).unwrap();
        }
        let all = load_sessions_from(&path);
        assert_eq!(all.len(), total);
        for s in all.iter().take(total - FPS_SERIES_KEEP) {
            assert!(s.fps_series.is_empty(), "older than the keep window → series shed on save");
        }
        for s in all.iter().skip(total - FPS_SERIES_KEEP) {
            assert_eq!(s.fps_series, vec![(0, 100.0)], "the {FPS_SERIES_KEEP} most recent keep their real series");
        }
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
