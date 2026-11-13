//! Session summaries (F3): READ-ONLY. Aggregates the telemetry monitoring
//! already produces (FPS / frametime / 1%-low + GPU/CPU/RAM) into a per-session
//! summary when a monitoring session ends. It mutates nothing, tunes nothing,
//! adds no detection, and applies/rolls back nothing.
//!
//! Metrics are LIVE ESTIMATES sampled ~1×/sec while monitoring is active — not
//! benchmark-grade proof. The session "1% low" is an estimate (the mean of the
//! FPS helper's per-second 1%-low figures), not a true all-frametime percentile. The true per-frame
//! percentiles are `frame_pacing` (P4-smooth-measure), counted from every frame the helper saw.
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

/// Fewest frames a session's `frame_pacing` is computed from (its median and 99th percentile:
/// the 99th is then at least the 10th-slowest frame). Below this the session records none.
pub(crate) const MIN_PACING_FRAMES: u64 = 1000;
/// Fewest frames for a 99.9th percentile: below this it is only the slowest frame or few, so
/// `p999_ms` stays `None` while the median and 99th are still recorded.
pub(crate) const MIN_P999_FRAMES: u64 = 10_000;
/// A histogram reading more than this many seconds after the chain's last one only sets a new
/// starting point: the frames in between (helper silent, readings stale) can't be placed in time,
/// so they can't be shown to be measured play rather than time spent alt-tabbed.
pub(crate) const MAX_HIST_GAP_SECS: u32 = 2;

/// P4-smooth-measure: a session's TRUE per-frame frame-time percentiles, from every frame the FPS
/// helper saw of the session's game while it was measured (alt-tabbed seconds left out, as for
/// every other number). Counted in fixed 1% buckets (`fps::frame_hist`), so each figure is within
/// 0.5% of the real frame time; no frame is stored. A freeze of 1 s or more counts as a frame but
/// reads as 1000 ms, so a percentile that lands on one is capped there. Times in ms, rounded to
/// 0.001 ms (finer than the bucket error at any frame rate up to 4000 fps).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct FramePacing {
    /// How many frames the percentiles are taken over.
    pub(crate) frames: u64,
    pub(crate) p50_ms: f64,
    pub(crate) p99_ms: f64,
    /// `None` under [`MIN_P999_FRAMES`] frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) p999_ms: Option<f64>,
}

impl FramePacing {
    /// From one bucket count per `fps::frame_hist` bucket. `None` below [`MIN_PACING_FRAMES`].
    pub(crate) fn from_counts(counts: &[u64]) -> Option<Self> {
        let frames: u64 = counts.iter().sum();
        if frames < MIN_PACING_FRAMES {
            return None;
        }
        let at = |q| crate::fps::frame_hist::percentile(counts, q).map(round3);
        let p999_ms = if frames >= MIN_P999_FRAMES { Some(at(0.999)?) } else { None };
        Some(Self { frames, p50_ms: at(0.50)?, p99_ms: at(0.99)?, p999_ms })
    }

    /// How uneven the session's frames were: the 99th-percentile frame time over the median, a
    /// plain ratio (1.0 = every frame alike). Each side carries the 0.5% bucket error, so the ratio
    /// is good to about ±1%. `None` when either isn't a positive number.
    pub(crate) fn p99_over_p50(&self) -> Option<f64> {
        let r = self.p99_ms / self.p50_ms;
        (self.p50_ms > 0.0 && r.is_finite() && r > 0.0).then_some(r)
    }
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

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
    /// #618: the counts a session recorded from a change history that had been set aside before it
    /// began (`history::SessionStartCounts::since_set_aside`). Complete for every Compy move since that
    /// set-aside, never a total, so the fields above stay "not recorded" for this session and only a
    /// like-with-like comparison reads these ([`comparable_change_counts`],
    /// [`SessionSummary::counted_since_set_aside`]). Additive: an older Compy ignores the key and reads
    /// the session as unrecorded, the cautious side.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) compy_changes_since_set_aside: Option<CountsSinceSetAside>,
    /// Rig identity at session time — groundwork for same-rig analysis. Additive: pre-fingerprint
    /// sessions parse with this as None.
    #[serde(default)]
    pub(crate) hw_fingerprint: Option<crate::hardware::HwFingerprint>,
    /// Was a Gaming Mode session live at ANY point during this FPS session? Sampled per tick by
    /// the monitoring loop (a save-time-only probe would miss a session that ended before
    /// monitoring stopped). Additive: pre-field records parse as None → honestly Unknown.
    #[serde(default)]
    pub(crate) gaming_mode_active: Option<bool>,
    /// CR-trial-plan-switch-confound: what Gaming Mode did with the power plan while it was on for
    /// this session (it leaves the plan alone while a Trial or the benchmark holds a setting of it).
    /// None when Gaming Mode was never on, or for a session saved before this was recorded. Additive:
    /// not written when None; an unknown value reads as None.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "gaming_mode_plan_lenient")]
    pub(crate) gaming_mode_plan: Option<GamingModePlan>,
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
    /// P4-smooth-measure: true per-frame percentiles ([`FramePacing`]). `None` on rows an older Compy
    /// wrote, with an older helper, or with fewer than [`MIN_PACING_FRAMES`] measured frames.
    /// Additive: written only when present, and an older Compy ignores the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) frame_pacing: Option<FramePacing>,
    /// P9-bottleneck-sustained: the GPU-saturation share of this session ([`GpuLoad`]). `None` on
    /// rows written before it was counted, so a peak alone never reads as "the limiter". Additive:
    /// written only when present, and an older Compy ignores the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) gpu_load: Option<GpuLoad>,
}

/// #618: change counts counted from a fresh change history after a damaged one was set aside.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct CountsSinceSetAside {
    /// Changes whose live check reads On. `None` when every live change is can't-confirm (453-f1).
    pub(crate) active: Option<usize>,
    pub(crate) cant_confirm: usize,
    /// The set-aside ledger's last write (`history::ledger_set_aside_through`), RFC 3339: the counts
    /// are complete for every Compy move after it.
    pub(crate) since: String,
}

impl CountsSinceSetAside {
    fn of(counts: crate::history::SessionChangeCounts, at: chrono::DateTime<chrono::Utc>) -> Self {
        Self { active: counts.active, cant_confirm: counts.cant_confirm, since: at.to_rfc3339() }
    }

    /// The set-aside time these were counted since, or `None` when it can't be read back.
    fn since_instant(&self) -> Option<chrono::DateTime<chrono::Utc>> {
        chrono::DateTime::parse_from_rfc3339(&self.since).ok().map(|t| t.with_timezone(&chrono::Utc))
    }
}

/// A session's change counts in the form another session's can be compared with (453-f1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChangeCounts {
    /// Counted per change by the shared live rule: on, and can't-confirm, each compared apart.
    PerChange { active: usize, cant_confirm: usize },
    /// Counted the way builds before 453-f1 counted (newest row, can't-confirm included).
    Legacy(usize),
}

impl ChangeCounts {
    /// `after` is these counts with exactly one more Compy change in place: one more active with the
    /// same can't-confirm count, or one more can't-confirm with the same active one (453-f1 compares
    /// them apart); one more on the older rule. Counts made in different forms never match. The rule a
    /// two-session Trial's after-session is held to (`experiment::other_compy_change`), where the
    /// conclude reads the setting itself; a real-play session is held to [`Self::adds_one_active_change`].
    pub(crate) fn adds_one_change(self, after: ChangeCounts) -> bool {
        match (self, after) {
            (ChangeCounts::PerChange { active: a0, cant_confirm: c0 }, ChangeCounts::PerChange { active: a1, cant_confirm: c1 }) => {
                (a0.checked_add(1) == Some(a1) && c1 == c0) || (a1 == a0 && c0.checked_add(1) == Some(c1))
            }
            (ChangeCounts::Legacy(n0), ChangeCounts::Legacy(n1)) => n0.checked_add(1) == Some(n1),
            _ => false,
        }
    }

    /// `after` is these counts with exactly one more Compy change in place AND read as on: one more
    /// active, the same can't-confirm count. Stricter than [`Self::adds_one_change`]: one more change
    /// Compy couldn't confirm, or one more on the older rule (which counted those as on), never shows
    /// a change on. The rule a real-play session is held to (`realplay::with_arm`), at its start and
    /// at the check after it, since nothing else reads the setting for that session.
    pub(crate) fn adds_one_active_change(self, after: ChangeCounts) -> bool {
        matches!(
            (self, after),
            (ChangeCounts::PerChange { active: a0, cant_confirm: c0 }, ChangeCounts::PerChange { active: a1, cant_confirm: c1 })
                if a0.checked_add(1) == Some(a1) && c1 == c0
        )
    }
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

    /// P4-show-f1: the session measured nothing because the game was behind another window for
    /// every tick (no reading, and seconds left out on that ground). Saved so the session list and
    /// the Debrief can say why it has no numbers; every comparison, Trial, noise band, pattern and
    /// hint skips it (`samples == 0`), since its averages are 0 standing for "not measured".
    pub(crate) fn behind_the_whole_time(&self) -> bool {
        self.samples == 0 && self.background_secs_excluded.is_some_and(|n| n > 0)
    }

    /// #618: this session read with its counts since the set-aside at `at`, for a check whose own
    /// counts come from the fresh ledger since that same set-aside (`experiment::baseline_checked_view`).
    /// Like with like: both leave out exactly the changes the lost ledger recorded. `None` when this
    /// session recorded no counts since that set-aside (it began before it, or before this build).
    pub(crate) fn counted_since_set_aside(&self, at: chrono::DateTime<chrono::Utc>) -> Option<SessionSummary> {
        let since = self.compy_changes_since_set_aside.as_ref()?;
        if since.since_instant()? != at {
            return None;
        }
        Some(SessionSummary {
            compy_changes_active: since.active,
            compy_changes_cant_confirm: Some(since.cant_confirm),
            compy_changes_legacy_active: None,
            compy_changes_per_change: true,
            ..self.clone()
        })
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
///
/// #618: two sessions begun after the same set-aside compare their counts since it
/// ([`CountsSinceSetAside`]), like with like: both leave out exactly what the lost ledger recorded.
/// A session with whole counts never compares with one counted since a set-aside.
pub(crate) fn comparable_change_counts<'s>(
    a: &'s SessionSummary,
    b: &'s SessionSummary,
) -> Result<(ChangeCounts, ChangeCounts), &'s SessionSummary> {
    let per_change = a.compy_changes_per_change && b.compy_changes_per_change;
    let (ca, cb) = (a.change_counts(per_change), b.change_counts(per_change));
    if let (Some(ca), Some(cb)) = (ca, cb) {
        return Ok((ca, cb));
    }
    let since = |s: &SessionSummary| {
        let c = s.compy_changes_since_set_aside.as_ref()?;
        Some((c.since_instant()?, ChangeCounts::PerChange { active: c.active?, cant_confirm: c.cant_confirm }))
    };
    match (since(a), since(b)) {
        (Some((at_a, x)), Some((at_b, y))) if at_a == at_b => Ok((x, y)),
        _ => Err(if ca.is_none() { a } else { b }),
    }
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Pure aggregator. `record_fps` is called once per tick a game is presenting;
/// `record_sensors` once per tick for peak tracking. `finalize` is given the
/// measured duration so it stays deterministic and testable.
/// P5-enough: what the running capture has measured so far (`SessionAccumulator::progress`). Read-only,
/// in memory only; `get_fps_status` hands it to the UI while capture is active.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct CaptureProgress {
    /// The session's own start, so a finishing recorder clears only its own progress.
    #[serde(skip)]
    pub(crate) started_at: String,
    pub(crate) samples: u32,
    pub(crate) fps_series: Vec<(u32, f64)>,
}

/// One threshold for "this tick the GPU was saturated", shared with `priorities.rs` so the session
/// hint and the upgrade path can never disagree with the count recorded here.
pub(crate) const GPU_LIMITED_PCT: u32 = 95;

/// P9-bottleneck-sustained: how much of a session the GPU spent saturated, not just whether it ever
/// was. One loading-screen or menu spike reads 100% and used to name the GPU the session's limiter
/// with purchase links under it; a limiter is a share of the session, so this counts the ticks —
/// only the MEASURED ones (the game in front, a fresh frame reading), the same ticks the session's
/// own numbers are built from, so a launcher, a menu before the first frame, or another app's GPU
/// load while the game sat behind a window never counts (review 2026-11-03).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GpuLoad {
    /// Measured ticks that also read a GPU usage (the denominator, never the session's samples).
    pub(crate) readings: u32,
    /// Of those, the ticks at or above [`GPU_LIMITED_PCT`].
    pub(crate) busy: u32,
}

impl GpuLoad {
    /// Whole-percent share of the readings that were saturated, rounded DOWN so a share said as
    /// "49%" never sits beside a verdict decided on exact counts as if it were half; `None` with no
    /// reading or with counts that can't be (busy above readings).
    pub(crate) fn busy_share_pct(&self) -> Option<u32> {
        (self.readings > 0 && self.busy <= self.readings)
            .then(|| (u64::from(self.busy) * 100 / u64::from(self.readings)) as u32)
    }
}

pub(crate) struct SessionAccumulator {
    started_at: String,
    compy_changes: Option<crate::history::SessionChangeCounts>,
    /// #618: the counts since a set-aside, when the session began after one.
    compy_changes_since_set_aside: Option<CountsSinceSetAside>,
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
    /// P4-show-f1: those ticks per presenting process, so a session that was behind another window
    /// the whole time still names its game. Never folded into any measured number.
    background_proc_counts: HashMap<String, u32>,
    /// P9-bottleneck-sustained: GPU-usage readings seen, and how many were saturated.
    gpu_load: Option<GpuLoad>,
    /// P4-smooth-measure: each chain's last cumulative histogram reading, by histogram id: when it
    /// was read (session seconds) and one count per bucket, so the next reading of that chain adds
    /// only the frames since. Kept per chain so a report that flips between chains still counts;
    /// entries older than [`MAX_HIST_GAP_SECS`] are dropped (they could only reset anyway).
    hist_prev: HashMap<u64, (u32, Vec<u64>)>,
    /// Measured frames per bucket, per presenting process.
    pacing: HashMap<String, Vec<u64>>,
}

impl SessionAccumulator {
    /// A session whose start recorded `active` changes on, none can't-confirm (tests).
    #[cfg(test)]
    pub(crate) fn new(started_at: String, active: Option<usize>) -> Self {
        Self::with_counts(
            started_at,
            crate::history::SessionStartCounts {
                whole: active.map(|a| crate::history::SessionChangeCounts { active: Some(a), cant_confirm: 0, legacy_active: a }),
                since_set_aside: None,
            },
        )
    }

    /// `counts.whole` is `None` when the session start couldn't read the change history (#669), or
    /// counted only since a set-aside (#618, kept apart in `since_set_aside`).
    pub(crate) fn with_counts(started_at: String, counts: crate::history::SessionStartCounts) -> Self {
        Self {
            started_at,
            compy_changes: counts.whole,
            compy_changes_since_set_aside: counts.since_set_aside.map(|(c, at)| CountsSinceSetAside::of(c, at)),
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
            background_proc_counts: HashMap::new(),
            gpu_load: None,
            hist_prev: HashMap::new(),
            pacing: HashMap::new(),
        }
    }

    /// P4-smooth-measure: one helper reading of its cumulative frame-time histogram at
    /// `elapsed_secs` into the session. The frames added since the previous reading of the same
    /// histogram are counted for `process_name`, but only when `measured` (the tick's own
    /// `record_tick` result: alt-tabbed frames stay out). A first reading of a chain, one more than
    /// [`MAX_HIST_GAP_SECS`] after that chain's last, or a count that went down (a restarted helper)
    /// only sets the starting point, so no frame is counted twice and no unplaced gap leaks in; the
    /// cost is at most one reading's frames.
    pub(crate) fn record_frame_hist(
        &mut self,
        process_name: &str,
        hist: &crate::fps::FrameHistWire,
        measured: bool,
        elapsed_secs: u32,
    ) {
        let mut now = vec![0u64; crate::fps::frame_hist::BUCKETS];
        for &(i, c) in &hist.counts {
            if let Some(slot) = now.get_mut(usize::from(i)) {
                *slot = c;
            }
        }
        let prev = self.hist_prev.insert(hist.id, (elapsed_secs, now));
        self.hist_prev.retain(|_, (at, _)| elapsed_secs.saturating_sub(*at) <= MAX_HIST_GAP_SECS);
        let (Some((prev_at, prev)), Some((_, now))) = (prev, self.hist_prev.get(&hist.id)) else { return };
        if elapsed_secs.saturating_sub(prev_at) > MAX_HIST_GAP_SECS || now.iter().zip(&prev).any(|(n, p)| n < p) {
            return;
        }
        if !measured || process_name.is_empty() {
            return;
        }
        let into = self
            .pacing
            .entry(process_name.to_string())
            .or_insert_with(|| vec![0; crate::fps::frame_hist::BUCKETS]);
        for ((slot, n), p) in into.iter_mut().zip(now).zip(&prev) {
            *slot += n - p;
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
                if !process_name.is_empty() {
                    *self.background_proc_counts.entry(process_name.to_string()).or_insert(0) += 1;
                }
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

    /// P9-bottleneck-sustained: count this tick's GPU usage toward the session's saturation share,
    /// but only when the tick was MEASURED (`record_tick` counted it: the game in front, a fresh
    /// frame reading). The peak above keeps every tick, as before; the share keeps the game's own.
    pub(crate) fn record_gpu_load(&mut self, gpu_usage_pct: Option<u32>, measured: bool) {
        let Some(u) = gpu_usage_pct else { return };
        if !measured {
            return;
        }
        let load = self.gpu_load.get_or_insert(GpuLoad { readings: 0, busy: 0 });
        load.readings += 1;
        if u >= GPU_LIMITED_PCT {
            load.busy += 1;
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

    /// P5-enough: the session so far, for the guided journey's "enough yet?" line. `samples` is the
    /// measured readings only (a background tick never counts), and the series includes the open
    /// bucket's mean the same way `finalize` flushes it, so the live grade and the saved one agree.
    pub(crate) fn progress(&self) -> CaptureProgress {
        let mut fps_series = self.fps_series.clone();
        if let Some(b) = self.bucket_idx {
            if self.bucket_count > 0 && fps_series.len() < FPS_SERIES_MAX_POINTS {
                fps_series.push((b * FPS_SERIES_BUCKET_SECS, round1(self.bucket_sum / self.bucket_count as f64)));
            }
        }
        CaptureProgress { started_at: self.started_at.clone(), samples: self.samples, fps_series }
    }

    /// Is this session saved? When it measured play ([`Self::has_data`]), and also (P4-show-f1)
    /// when capture ran, the game was found, and every tick was behind another window: a row with
    /// no readings whose left-out seconds say why. Sensors alone, or a game that was never named,
    /// still save nothing.
    pub(crate) fn worth_saving(&self) -> bool {
        self.has_data()
            || (self.background_secs_excluded.is_some_and(|n| n > 0) && !self.background_proc_counts.is_empty())
    }

    pub(crate) fn finalize(mut self, duration_secs: u64) -> SessionSummary {
        self.flush_bucket(); // the trailing partial bucket is real samples too
        let n = self.samples.max(1) as f64;
        let dominant = |m: HashMap<String, u32>| m.into_iter().max_by_key(|(_, c)| *c).map(|(p, _)| p);
        // A session with no reading is named by the game that was behind the other window.
        let background = if self.samples == 0 { dominant(self.background_proc_counts) } else { None };
        let process_name = dominant(self.proc_counts).or(background).unwrap_or_default();
        let frame_pacing = self.pacing.get(&process_name).and_then(|c| FramePacing::from_counts(c));
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
            compy_changes_since_set_aside: self.compy_changes_since_set_aside,
            // Stamped by the monitoring loop at save time (finalize stays pure/system-free).
            hw_fingerprint: None,
            gaming_mode_active: None,
            gaming_mode_plan: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
            fps_series: self.fps_series,
            capture_capabilities: None,
            game_state: None,
            peak_cpu_temp_c: self.peak_cpu_temp_c,
            peak_gpu_hotspot_temp_c: self.peak_gpu_hotspot_temp_c,
            background_secs_excluded: self.background_secs_excluded,
            frame_pacing,
            gpu_load: self.gpu_load,
        }
    }
}

/// CR-trial-plan-switch-confound: what Gaming Mode did with the power plan during a session it was on
/// for. Two sessions that both ran with Gaming Mode on but differ here ran on different power plans.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GamingModePlan {
    /// Gaming Mode switched the power plan for its session.
    Switched,
    /// Gaming Mode left the power plan as it was (a Trial or the benchmark held a setting of it).
    LeftAlone,
    /// Both, at different points of this session (Gaming Mode was started more than once).
    Mixed,
}

impl std::fmt::Display for GamingModePlan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Switched => "switched the power plan",
            Self::LeftAlone => "left the power plan alone",
            Self::Mixed => "switched the power plan for part of the session",
        })
    }
}

impl GamingModePlan {
    /// PURE: what a session reads once a Gaming Mode session that `switched` (or didn't) the plan is
    /// seen during it, given what was seen before.
    pub(crate) fn seen(before: Option<Self>, switched: bool) -> Self {
        let now = if switched { Self::Switched } else { Self::LeftAlone };
        match before {
            None => now,
            Some(b) if b == now => now,
            Some(_) => Self::Mixed,
        }
    }
}

/// An unknown or damaged `gaming_mode_plan` value reads as not recorded, never as a failed load.
fn gaming_mode_plan_lenient<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<GamingModePlan>, D::Error> {
    Ok(serde_json::from_value(serde_json::Value::deserialize(d)?).ok())
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
    load_sessions_checked_from(path).unwrap_or_default()
}

/// The read a save builds on (codebase review 2026-11-02). A sessions.json that is there and could
/// not be read right now (a sharing violation, a permissions glitch) is an error, never an empty
/// history: the save that follows would otherwise rewrite the file with this one session and drop
/// every baseline and real-play session before it. Absent and damaged files read as they always did.
fn load_sessions_checked_from(path: &Path) -> Result<Vec<SessionSummary>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Compy couldn't read its session history right now ({e}), so this session wasn't added to it.")),
    };
    match std::str::from_utf8(&bytes).ok().map(parse_sessions) {
        Some(Ok(v)) => Ok(v),
        // A corrupt sessions.json must not be silently overwritten by the next save — set the
        // damaged bytes aside for recovery, then start fresh. (Unlike the Trust Ledger this is not
        // a rollback contract, so a set-aside that WORKED does not hard-fail: losing session history
        // is non-destructive, and blocking every future save on it would be worse.) Bytes that
        // aren't UTF-8 are damage too, set aside rather than overwritten. An earlier set-aside is
        // kept, never renamed over (`set_aside_damaged`).
        _ if crate::atomic_write::set_aside_damaged(path) => Ok(Vec::new()),
        // The set-aside itself failed (the file is locked, or a hundred set-asides share its second):
        // the damaged file is still in place, so this one session is not added rather than saved
        // over the only copy of the history (review round 2).
        _ => Err("Compy couldn't set its damaged session history aside right now, so this session wasn't added to it.".to_string()),
    }
}

fn save_session_to(path: &Path, summary: SessionSummary) -> Result<(), String> {
    // A sharing violation (a scanner, a backup) usually clears in moments: read twice more before
    // giving this session up, never rewrite the history around a read that failed.
    let retry = |wait_ms: u64| {
        std::thread::sleep(std::time::Duration::from_millis(wait_ms));
        load_sessions_checked_from(path)
    };
    let mut all = load_sessions_checked_from(path).or_else(|_| retry(150)).or_else(|_| retry(300))?;
    all.push(summary);
    // Keep at most MAX_SESSIONS rows (`machine_model`'s headroom counts on it). P4-show-f1: when a
    // save goes over, a row that measured nothing (`samples == 0`) is let go before any measured
    // one, oldest first, and the row just saved always stays. So a measured row is let go for an
    // unmeasured one only when the one just saved is the only unmeasured row left; while the
    // history isn't full, unmeasured rows simply take free slots.
    while all.len() > MAX_SESSIONS {
        let newest = all.len() - 1;
        let drop = all[..newest].iter().position(|s| s.samples == 0).unwrap_or(0);
        all.remove(drop);
    }
    // Keep the (large) frametime timeline only for the 5 most-recent sessions; older sessions retain
    // the insight + events but shed the per-second series so sessions.json + exports stay small.
    // The downsampled fps series is ~10× smaller per hour, so it survives a wider window (the
    // free Sessions view's 20) before it too is shed. P4-show-f1: both windows count measured
    // sessions only; a row that measured nothing has neither, so alt-tabbed sessions never strip
    // the last measured session's detail.
    let mut measured = 0usize;
    for s in all.iter_mut().rev().filter(|s| s.samples > 0) {
        measured += 1;
        if measured > 5 {
            s.stutter_timeline = Vec::new();
        }
        if measured > FPS_SERIES_KEEP {
            s.fps_series = Vec::new();
        }
    }
    let rows = all.iter().map(disk_row).collect::<Result<Vec<_>, _>>()?;
    let json = serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?;
    // Atomic swap (mirrors history.rs save_history_to): write beside the live file then rename it
    // in (MoveFileEx + REPLACE_EXISTING on Windows), so a crash mid-write leaves the prior valid
    // sessions.json intact plus an ignorable .tmp — never a torn half-written file.
    // The temp file is synced before the swap, as the ledger's is.
    let tmp = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// The newest row that measured play in `get_session_summaries` output serialized to JSON (newest
/// first), for readers that take "the most recent session": a row with `samples: 0` (P4-show-f1,
/// the game was behind another window the whole time) has no numbers to read, so it is skipped. A
/// row without the key counts as measured.
pub(crate) fn newest_measured_row(sessions: &serde_json::Value) -> Option<&serde_json::Value> {
    sessions.as_array()?.iter().find(|s| s.get("samples").and_then(serde_json::Value::as_u64) != Some(0))
}

/// Does saving a session with `samples` readings trigger a Tier 2 receipt? Not when it measured
/// nothing (P4-show-f1): the receipt is built from the newest measured session, so an armed build
/// would re-send an older session's receipt.
fn sends_receipt(samples: u32) -> bool {
    samples > 0
}

/// What a save did, for the caller's session-end toast decision (P7-notify,
/// `experiment::session_end_notice`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SavedSession {
    /// The kind of armed comparison this session settled, if any.
    pub(crate) settled: Option<crate::comparison::ComparisonKind>,
}

/// Returns `Ok(Some(_))` if a real session was saved, `Ok(None)` if it was dropped as too short.
/// Saving alone no longer fires the debrief toast: the caller asks `experiment::session_end_notice`.
pub(crate) fn save_session(summary: SessionSummary) -> Result<Option<SavedSession>, String> {
    // Drop trivially short sessions entirely — no debrief, and crucially no armed-comparison
    // resolution (a blip must not confound or settle a pending comparison; the arm waits).
    if !meets_min_duration(summary.duration_secs) {
        return Ok(None);
    }
    std::fs::create_dir_all(compy_data_dir()).map_err(|e| e.to_string())?;
    let measured_samples = summary.samples;
    // The comparison reads this session once it is saved (codebase review 2026-11-02): a save can
    // now refuse, and a fix comparison settled against a session the history doesn't hold would show
    // a result no session backs, with its arm already spent.
    let compared = summary.clone();
    save_session_to(&sessions_path(), summary)?;
    // M4: if a comparison was armed for this game, compute the cross-session delta now.
    let settled = crate::comparison::on_session_finalized(&compared);
    // Tier 2 receipts (Q9a, #217): a finalized session is the ONLY thing that produces a receipt,
    // so this is the only trigger. Inert in every shipped build — it returns on receipts_gate()
    // before it reads consent, spawns anything, or touches the network. The call site lands in the
    // dark commit on purpose, so arming stays a one-line owner-signed flip rather than a
    // behavioural diff nobody reviewed.
    if sends_receipt(measured_samples) {
        crate::receipts::on_session_finalized();
    }
    // Care trigger 3 of 3 (Tier 1 task 9): a session that just ended is the likeliest moment for a
    // crash to have been recorded, so the observer gets one targeted look. Throttled like the
    // foreground trigger, off-thread, and it cannot fail this save — `scan_async` swallows
    // everything by contract.
    crate::incident_observer::scan_async(crate::incident_observer::ScanTrigger::SessionFinalized);
    Ok(Some(SavedSession { settled }))
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

    use crate::fps::{frame_hist, FrameHistWire};

    /// A helper's cumulative histogram: `frames` of (frame time ms, how many so far).
    fn wire(id: u64, frames: &[(f64, u64)]) -> FrameHistWire {
        let mut counts = vec![0u64; frame_hist::BUCKETS];
        for &(ms, n) in frames {
            counts[frame_hist::bucket(ms)] += n;
        }
        FrameHistWire {
            id,
            counts: counts.iter().enumerate().filter(|(_, c)| **c > 0).map(|(i, c)| (i as u16, *c)).collect(),
        }
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() / b < 0.006
    }

    /// P4-smooth-measure: the session's percentiles are taken over every frame the helper saw, from
    /// its cumulative histogram, not from per-second figures. Per-second 1% lows here would all read
    /// the same 4 ms second; the true p99.9 is the 50 ms hitches.
    #[test]
    fn frame_pacing_is_the_true_per_frame_percentiles_of_the_session() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        // First reading sets the starting point: frames before it aren't this session's.
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 0, Some(true));
        acc.record_frame_hist("g.exe", &wire(7, &[(4.0, 500)]), true, 0);
        // Ten seconds of play, read every second: 985 frames at 4 ms, 13 at 10 ms, 2 at 50 ms each.
        for t in 1..=10u64 {
            acc.record_tick("g.exe", 240.0, 4.2, 230.0, t as u32, Some(true));
            acc.record_frame_hist("g.exe", &wire(7, &[(4.0, 500 + 985 * t), (10.0, 13 * t), (50.0, 2 * t)]), true, t as u32);
        }
        let p = acc.finalize(10).frame_pacing.expect("10 000 frames measured");
        assert_eq!(p.frames, 10_000);
        assert!(near(p.p50_ms, 4.0) && near(p.p99_ms, 10.0) && near(p.p999_ms.unwrap(), 50.0), "{p:?}");
        assert!(near(p.p99_over_p50().unwrap(), 2.5));
    }

    #[test]
    fn alt_tabbed_frames_and_restarted_counts_are_never_counted() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_frame_hist("g.exe", &wire(1, &[]), true, 0);
        acc.record_frame_hist("g.exe", &wire(1, &[(4.0, 1000)]), true, 1);
        // Alt-tabbed: 600 frames at 33 ms behind the browser stay out.
        let behind = acc.record_tick("g.exe", 30.0, 33.0, 28.0, 2, Some(false));
        acc.record_frame_hist("g.exe", &wire(1, &[(4.0, 1000), (33.0, 600)]), behind, 2);
        // A count that went down (a restarted helper reusing nothing) only sets a new start.
        acc.record_frame_hist("g.exe", &wire(1, &[(4.0, 10)]), true, 3);
        acc.record_frame_hist("g.exe", &wire(1, &[(4.0, 310)]), true, 4);
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 4, Some(true));
        let p = acc.finalize(10).frame_pacing.expect("1300 frames at 4 ms");
        assert_eq!((p.frames, p.p999_ms), (1300, None));
        assert!(near(p.p99_ms, 4.0), "no alt-tabbed or double-counted frame: {p:?}");
    }

    /// Readings that stopped for more than 2 s (stale helper file) can't place the frames in
    /// between, so they only set a new start: 2000 frames presented while nobody could tell whether
    /// the game was in front never reach the numbers.
    #[test]
    fn a_gap_between_readings_resets_the_start() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 0, Some(true));
        acc.record_frame_hist("g.exe", &wire(1, &[]), true, 0);
        acc.record_frame_hist("g.exe", &wire(1, &[(4.0, 1000)]), true, 2);
        acc.record_frame_hist("g.exe", &wire(1, &[(4.0, 1000), (40.0, 2000)]), true, 10);
        acc.record_frame_hist("g.exe", &wire(1, &[(4.0, 1300), (40.0, 2000)]), true, 11);
        let p = acc.finalize(12).frame_pacing.expect("1300 frames");
        assert_eq!(p.frames, 1300);
        assert!(near(p.p99_ms, 4.0), "{p:?}");
    }

    /// A report that flips between two chains every tick still counts each chain's own frames.
    #[test]
    fn a_report_that_flips_between_chains_still_counts() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 0, Some(true));
        for t in 0..=20u64 {
            let (id, ms) = if t % 2 == 0 { (1, 4.0) } else { (2, 8.0) };
            acc.record_frame_hist("g.exe", &wire(id, &[(ms, 200 * t)]), true, t as u32);
        }
        // Chain 1 read at 0, 2, .., 20 (+4000 since its first), chain 2 at 1, 3, .., 19 (+3600).
        let p = acc.finalize(20).frame_pacing.expect("both chains counted");
        assert_eq!(p.frames, 7600);
    }

    #[test]
    fn too_few_frames_or_an_older_helper_records_no_frame_pacing() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 0, Some(true));
        acc.record_frame_hist("g.exe", &wire(1, &[]), true, 0);
        acc.record_frame_hist("g.exe", &wire(1, &[(4.0, MIN_PACING_FRAMES - 1)]), true, 1);
        assert_eq!(acc.finalize(10).frame_pacing, None);
        // Enough for the median and the 99th, not for the 99.9th.
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 0, Some(true));
        acc.record_frame_hist("g.exe", &wire(1, &[]), true, 0);
        acc.record_frame_hist("g.exe", &wire(1, &[(4.0, MIN_P999_FRAMES - 1)]), true, 1);
        let p = acc.finalize(10).frame_pacing.expect("p50 and p99 recorded");
        assert_eq!(p.p999_ms, None);
        // An older helper sends no histogram at all.
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 0, None);
        assert_eq!(acc.finalize(10).frame_pacing, None);
        // Only the session's own game's frames count.
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 0, Some(true));
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 1, Some(true));
        acc.record_frame_hist("other.exe", &wire(1, &[]), true, 0);
        acc.record_frame_hist("other.exe", &wire(1, &[(4.0, 5000)]), true, 1);
        assert_eq!(acc.finalize(10).frame_pacing, None);
    }

    /// Additive both ways: a row an older Compy wrote reads as no frame pacing; a row without it is
    /// written without the key; and a row with it still loads in an older Compy (whose struct has no
    /// such field and denies no unknown keys, like this one).
    #[test]
    fn frame_pacing_is_additive_and_small_on_disk() {
        let mut acc = SessionAccumulator::new("2026-10-25T00:00:00Z".into(), Some(0));
        acc.record_tick("g.exe", 240.0, 4.2, 230.0, 0, Some(true));
        let without = acc.finalize(120);
        let row = disk_row(&without).unwrap();
        assert!(row.get("frame_pacing").is_none(), "absent, not null");
        assert_eq!(from_disk_row(row).unwrap().frame_pacing, None);

        let mut with = without.clone();
        with.frame_pacing = Some(FramePacing { frames: 1_234_567, p50_ms: 4.172, p99_ms: 11.834, p999_ms: Some(26.051) });
        let row = disk_row(&with).unwrap();
        assert_eq!(from_disk_row(row.clone()).unwrap(), with);
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OlderRow {
            started_at: String,
            samples: u32,
            background_secs_excluded: Option<u32>,
        }
        let older: OlderRow = serde_json::from_value(row).expect("an older Compy still loads the row");
        assert_eq!(older.samples, with.samples);

        // What a session costs in sessions.json (pretty-printed, as saved).
        let bytes = |s: &SessionSummary| serde_json::to_string_pretty(&vec![disk_row(s).unwrap()]).unwrap().len();
        let added = bytes(&with) - bytes(&without);
        eprintln!("frame_pacing adds {added} bytes per session");
        assert!(added <= 140, "{added} bytes");
    }

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

    /// A session spent behind another window, as the monitoring loop would build it: 90 ticks of the
    /// game presenting with the browser in front.
    fn behind_the_whole_time(started_at: &str) -> SessionAccumulator {
        let mut acc = SessionAccumulator::new(started_at.into(), Some(0));
        for t in 0..90u32 {
            // Never a measured tick, so the recorder publishes no P5-enough progress for it.
            assert!(!acc.record_tick("game.exe", 30.0, 33.3, 20.0, t, Some(false)));
            acc.record_sensors(Some(55), Some(40), None, None);
        }
        assert_eq!(acc.progress().samples, 0);
        acc
    }

    /// P4-show-f1: a session whose game was behind another window for every tick has no reading, but
    /// it is saved, named by its game, so the session list and Debrief can say why it is empty.
    #[test]
    fn a_session_behind_another_window_the_whole_time_is_saved_with_no_readings() {
        let acc = behind_the_whole_time("2026-10-25T00:00:00Z");
        assert!(!acc.has_data(), "nothing was measured");
        assert!(acc.worth_saving(), "but it is saved, so the UI can say why");
        let s = acc.finalize(90);
        assert_eq!(s.process_name, "game.exe", "named by the game that was behind the other window");
        assert_eq!((s.samples, s.background_secs_excluded), (0, Some(90)));
        assert_eq!((s.avg_fps, s.low1_fps_est, s.avg_frametime_ms), (0.0, 0.0, 0.0), "no number from the background");
        assert!(s.fps_series.is_empty() && s.frame_pacing.is_none());
        assert!(s.behind_the_whole_time());
        // Without a named game, or without a focus reading, there is still nothing to save.
        let mut unnamed = SessionAccumulator::new("t".into(), Some(0));
        unnamed.record_tick("", 30.0, 33.3, 20.0, 0, Some(false));
        assert!(!unnamed.worth_saving());
        let mut sensors = SessionAccumulator::new("t".into(), Some(0));
        sensors.record_sensors(Some(55), Some(40), None, None);
        assert!(!sensors.worth_saving());
        // A session with play is named by the played game, never by one only seen behind.
        let mut mixed = SessionAccumulator::new("t".into(), Some(0));
        for t in 0..5u32 {
            mixed.record_tick("other.exe", 30.0, 33.3, 20.0, t, Some(false));
        }
        mixed.record_tick("game.exe", 120.0, 8.3, 90.0, 5, Some(true));
        let m = mixed.finalize(10);
        assert_eq!(m.process_name, "game.exe");
        assert!(!m.behind_the_whole_time());
    }

    /// An older Compy reads the zero-sample row like any other: every number it requires is there and
    /// finite, so it neither fails to load sessions.json nor sets it aside as corrupt.
    #[test]
    fn an_older_compy_loads_a_zero_sample_row() {
        let path = std::env::temp_dir().join(format!("compy-sessions-zero-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut played = SessionAccumulator::new("2026-10-24T00:00:00Z".into(), Some(0));
        played.record_tick("game.exe", 120.0, 8.3, 90.0, 0, Some(true));
        save_session_to(&path, played.finalize(600)).unwrap();
        save_session_to(&path, behind_the_whole_time("2026-10-25T00:00:00Z").finalize(90)).unwrap();
        // The shape a build from before focus readings (0.9.x) declares: every field it requires.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OlderRow {
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
            compy_changes_active: usize,
            #[serde(default)]
            stutter_timeline: Vec<(u32, f64)>,
            #[serde(default)]
            fps_series: Vec<(u32, f64)>,
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let older: Vec<OlderRow> = serde_json::from_str(&text).expect("an older Compy loads the file");
        assert_eq!(older.len(), 2);
        assert_eq!((older[1].samples, older[1].avg_fps, older[1].process_name.as_str()), (0, 0.0, "game.exe"));
        // And this build reads it back unchanged, file kept.
        let back = load_sessions_from(&path);
        assert_eq!(back.len(), 2);
        assert!(back[1].behind_the_whole_time());
        assert!(path.exists() && !path.with_extension("json.corrupt").exists());
        std::fs::remove_file(&path).ok();
    }

    /// The 100-row cap: a row that measured nothing goes before any measured one, oldest first, and
    /// the one just saved stays. A run of alt-tabbed sessions can't push out a baseline.
    #[test]
    fn rows_that_measured_nothing_never_push_out_measured_sessions() {
        let path = std::env::temp_dir().join(format!("compy-sessions-zcap-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let measured = |i: usize| {
            let mut acc = SessionAccumulator::new(format!("m{i}"), Some(0));
            acc.record_fps("g.exe", 100.0, 10.0, 80.0, 0);
            acc.finalize(600)
        };
        for i in 0..MAX_SESSIONS - 1 {
            save_session_to(&path, measured(i)).unwrap();
        }
        for i in 0..5 {
            save_session_to(&path, behind_the_whole_time(&format!("z{i}")).finalize(90)).unwrap();
        }
        let all = load_sessions_from(&path);
        assert_eq!(all.len(), MAX_SESSIONS);
        assert_eq!(all.iter().filter(|s| s.samples > 0).count(), MAX_SESSIONS - 1, "every measured session kept");
        let kept: Vec<&str> = all.iter().filter(|s| s.samples == 0).map(|s| s.started_at.as_str()).collect();
        assert_eq!(kept, ["z4"], "only the newest unmeasured row stays");
        // A measured session saved into a full history lets the unmeasured row go first.
        save_session_to(&path, measured(500)).unwrap();
        let all = load_sessions_from(&path);
        assert_eq!(all.len(), MAX_SESSIONS);
        assert!(all.iter().all(|s| s.samples > 0) && all[0].started_at == "m0");
        std::fs::remove_file(&path).ok();
    }

    /// Review (P4-show-f1): the 5-session timeline window and the fps-series window count measured
    /// sessions only, so a run of alt-tabbed sessions can't strip the last measured one's detail.
    #[test]
    fn rows_that_measured_nothing_never_strip_measured_detail() {
        let path = std::env::temp_dir().join(format!("compy-sessions-zdetail-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        for i in 0..FPS_SERIES_KEEP + 1 {
            let mut acc = SessionAccumulator::new(format!("m{i:02}"), Some(0));
            for t in 0..20u32 {
                acc.record_fps("g.exe", 100.0, 10.0, 80.0, t);
            }
            let mut s = acc.finalize(600);
            s.stutter_timeline = vec![(0, 80.0)];
            save_session_to(&path, s).unwrap();
        }
        for i in 0..FPS_SERIES_KEEP {
            save_session_to(&path, behind_the_whole_time(&format!("z{i:02}")).finalize(90)).unwrap();
        }
        let all = load_sessions_from(&path);
        std::fs::remove_file(&path).ok();
        let measured: Vec<&SessionSummary> = all.iter().filter(|s| s.samples > 0).collect();
        let n = measured.len();
        assert!(measured[n - 5..].iter().all(|s| !s.stutter_timeline.is_empty()), "the 5 newest measured keep their timeline");
        assert!(measured[n - 6].stutter_timeline.is_empty());
        assert!(measured[n - FPS_SERIES_KEEP..].iter().all(|s| !s.fps_series.is_empty()), "the 20 newest measured keep their series");
        assert!(measured[0].fps_series.is_empty());
    }

    /// Review (P4-show-f1): saving a session that measured nothing never triggers a receipt, which
    /// would be built from (and re-send) the newest measured session instead.
    #[test]
    fn a_session_that_measured_nothing_sends_no_receipt() {
        assert!(!sends_receipt(0));
        assert!(sends_receipt(1));
    }

    #[test]
    fn newest_measured_row_skips_rows_that_measured_nothing() {
        let rows = serde_json::json!([{ "samples": 0, "avg_fps": 0.0 }, { "samples": 900, "avg_fps": 120.0 }]);
        assert_eq!(newest_measured_row(&rows).unwrap()["avg_fps"], 120.0);
        let keyless = serde_json::json!([{ "avg_fps": 90.0 }]);
        assert_eq!(newest_measured_row(&keyless).unwrap()["avg_fps"], 90.0, "no key reads as measured");
        assert!(newest_measured_row(&serde_json::json!([{ "samples": 0 }])).is_none());
    }

    // P9-bottleneck-sustained: the session counts its GPU readings and how many were saturated, so
    // a limiter claim can rest on a share of the session instead of one peak sample.
    #[test]
    fn gpu_load_counts_saturated_measured_readings_and_floors_its_share() {
        let mut acc = SessionAccumulator::new("2026-11-03T00:00:00Z".into(), Some(0));
        acc.record_fps("game.exe", 120.0, 8.3, 90.0, 0);
        for u in [40, 95, 100, 96, 60, 94] {
            acc.record_sensors(None, Some(u), None, None);
            acc.record_gpu_load(Some(u), true);
        }
        acc.record_gpu_load(None, true); // a tick with no usage reading counts nowhere
        acc.record_gpu_load(Some(100), false); // an unmeasured tick (launcher, menu, behind a window) counts nowhere
        acc.record_gpu_load(Some(100), false);
        let s = acc.finalize(9);
        assert_eq!(s.peak_gpu_usage_pct, Some(100));
        let load = s.gpu_load.expect("counted");
        assert_eq!((load.readings, load.busy), (6, 3));
        assert_eq!(load.busy_share_pct(), Some(50));
        assert_eq!(GpuLoad { readings: 200, busy: 99 }.busy_share_pct(), Some(49), "49.5 floors, never half");
        assert_eq!(GpuLoad { readings: 900, busy: 1 }.busy_share_pct(), Some(0));
        assert_eq!(GpuLoad { readings: 0, busy: 0 }.busy_share_pct(), None);
        assert_eq!(GpuLoad { readings: 3, busy: 4 }.busy_share_pct(), None, "counts that can't be");
        assert_eq!(GpuLoad { readings: u32::MAX, busy: u32::MAX }.busy_share_pct(), Some(100), "no overflow");
    }

    #[test]
    fn gpu_load_is_counted_only_on_measured_ticks() {
        // Unmeasured ticks alone leave the share unrecorded: a peak from the launcher is a moment.
        let mut acc = SessionAccumulator::new("2026-11-03T00:00:00Z".into(), Some(0));
        acc.record_fps("game.exe", 120.0, 8.3, 90.0, 0);
        acc.record_sensors(None, Some(100), None, None);
        acc.record_gpu_load(Some(100), false);
        let s = acc.finalize(1);
        assert_eq!(s.peak_gpu_usage_pct, Some(100));
        assert_eq!(s.gpu_load, None);
    }

    #[test]
    fn gpu_load_is_additive_both_ways() {
        // Never recorded: no key on disk, and a row an older Compy wrote reads as not recorded.
        let mut acc = SessionAccumulator::new("2026-11-03T00:00:00Z".into(), Some(0));
        acc.record_fps("game.exe", 120.0, 8.3, 90.0, 0);
        let row = disk_row(&acc.finalize(60)).unwrap();
        assert!(row.get("gpu_load").is_none(), "no reading, no key");
        assert_eq!(from_disk_row(row).unwrap().gpu_load, None);
        // Recorded: a small object, read back whole.
        let mut acc = SessionAccumulator::new("2026-11-03T00:00:00Z".into(), Some(0));
        acc.record_fps("game.exe", 120.0, 8.3, 90.0, 0);
        acc.record_gpu_load(Some(99), true);
        let row = disk_row(&acc.finalize(60)).unwrap();
        assert_eq!(row["gpu_load"], serde_json::json!({ "readings": 1, "busy": 1 }));
        assert_eq!(from_disk_row(row).unwrap().gpu_load, Some(GpuLoad { readings: 1, busy: 1 }));
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

    /// P5-enough: the live progress counts measured readings only (a background tick never counts)
    /// and its series includes the open bucket exactly as `finalize` will save it.
    #[test]
    fn progress_counts_measured_readings_and_matches_finalize() {
        let mut acc = SessionAccumulator::new("t".into(), Some(0));
        for i in 0..15u32 {
            acc.record_tick("g.exe", 100.0 + f64::from(i / 10) * 10.0, 10.0, 80.0, i, Some(true));
        }
        for i in 15..20u32 {
            assert!(!acc.record_tick("g.exe", 500.0, 2.0, 400.0, i, Some(false)));
        }
        let p = acc.progress();
        assert_eq!(p.samples, 15, "the 5 alt-tabbed ticks are not readings that count");
        assert_eq!(p.fps_series, vec![(0, 100.0), (10, 110.0)], "the open bucket is included");
        assert_eq!(p.started_at, "t");
        let s = acc.finalize(20);
        assert_eq!((s.samples, s.fps_series), (p.samples, p.fps_series), "live and saved agree");
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
        // CR-trial-plan-switch-confound: an old session predates gaming_mode_plan: not recorded.
        assert!(all[0].gaming_mode_plan.is_none());
    }

    // CR-trial-plan-switch-confound: what Gaming Mode did with the power plan, recorded per session.
    #[test]
    fn gaming_mode_plan_is_recorded_per_session_and_reads_leniently() {
        use GamingModePlan as P;
        // One Gaming Mode session, or several that did the same: that handling; ones that differed: mixed.
        assert_eq!(P::seen(None, true), P::Switched);
        assert_eq!(P::seen(None, false), P::LeftAlone);
        assert_eq!(P::seen(Some(P::Switched), true), P::Switched);
        assert_eq!(P::seen(Some(P::Switched), false), P::Mixed);
        assert_eq!(P::seen(Some(P::LeftAlone), true), P::Mixed);
        assert_eq!(P::seen(Some(P::Mixed), true), P::Mixed);
        let row = |plan: serde_json::Value| {
            serde_json::json!({
                "started_at": "t", "duration_secs": 120, "process_name": "g.exe", "samples": 3,
                "avg_fps": 100.0, "avg_frametime_ms": 10.0, "low1_fps_est": 80.0,
                "peak_gpu_temp_c": null, "peak_gpu_usage_pct": null, "peak_ram_used_bytes": null,
                "ram_total_bytes": null, "compy_changes_active": 0, "gaming_mode_active": true,
                "gaming_mode_plan": plan
            })
        };
        let s: SessionSummary = serde_json::from_value(row(serde_json::json!("left-alone"))).unwrap();
        assert_eq!(s.gaming_mode_plan, Some(P::LeftAlone));
        // A value a newer Compy may write, or a damaged one, reads as not recorded; the row still loads.
        for odd in [serde_json::json!("something-new"), serde_json::json!(7), serde_json::Value::Null] {
            let s: SessionSummary = serde_json::from_value(row(odd.clone())).unwrap();
            assert_eq!(s.gaming_mode_plan, None, "{odd}");
        }
        // Written kebab-case, and not written at all when not recorded (an older Compy never sees it).
        let mut unrecorded = s.clone();
        unrecorded.gaming_mode_plan = None;
        assert!(serde_json::to_value(&unrecorded).unwrap().get("gaming_mode_plan").is_none());
        let mut with = s.clone();
        with.gaming_mode_plan = Some(P::Switched);
        assert_eq!(serde_json::to_value(&with).unwrap()["gaming_mode_plan"], "switched");
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
            let mut acc = SessionAccumulator::with_counts("t".into(), crate::history::SessionStartCounts { whole: Some(counts), since_set_aside: None });
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
        let mut acc = SessionAccumulator::with_counts("t".into(), crate::history::SessionStartCounts { whole: Some(counts), since_set_aside: None });
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

    // Codebase review 2026-11-02: a sessions.json that is there but can't be read right now read as
    // empty, and the save that followed rewrote it with one session, dropping every baseline before it.
    #[test]
    fn a_save_never_rewrites_a_history_it_could_not_read() {
        let dir = std::env::temp_dir().join(format!("compy-sessions-unreadable-{}", std::process::id()));
        let path = dir.join("sessions.json");
        std::fs::create_dir_all(&path).unwrap(); // a read that fails on every platform
        let mut acc = SessionAccumulator::new("2026-11-02T20:00:00Z".into(), Some(0));
        acc.record_fps("g.exe", 100.0, 10.0, 80.0, 0);
        let err = save_session_to(&path, acc.finalize(600)).expect_err("the save refuses");
        assert!(err.contains("couldn't read its session history right now"), "{err}");
        assert!(path.is_dir() && !path.with_extension("json.corrupt").exists(), "nothing replaced or set aside");
        std::fs::remove_dir_all(&dir).ok();
    }

    // Review of the 2026-11-02 fixes: the armed comparison was settled (and a fix arm spent) before the
    // save, which can now refuse, so a result could stand against a session the history doesn't hold.
    // Both run against the process-wide data root, so the order is pinned in the source. Tokens are
    // built by concat! so this test's own lines don't match the scan.
    #[test]
    fn a_session_settles_a_comparison_only_once_it_is_saved() {
        let src = include_str!("sessions.rs");
        let start = src.find(concat!("pub(crate) fn ", "save_session(")).expect("save_session");
        let body = &src[start..];
        let body = &body[..body.find(concat!("fn get_", "session_summaries")).expect("next fn")];
        let saved = body.find(concat!("save_", "session_to(&sessions_path()")).expect("the save");
        let settled = body.find(concat!("comparison::", "on_session_finalized(")).expect("the settle");
        assert!(saved < settled, "the comparison must read a session the history holds");
    }

    // #618: a session begun after a set-aside keeps the fresh ledger's counts apart from its total
    // (which stays "not recorded" for every reader), and compares them only like with like.
    #[test]
    fn counts_since_a_set_aside_are_never_a_total_and_compare_only_like_with_like() {
        let at = chrono::DateTime::parse_from_rfc3339("2026-09-01T10:00:00Z").unwrap().with_timezone(&chrono::Utc);
        let counts = crate::history::SessionChangeCounts { active: Some(2), cant_confirm: 1, legacy_active: 3 };
        let since = |at| crate::history::SessionStartCounts { whole: None, since_set_aside: Some((counts, at)) };
        let session = |c: crate::history::SessionStartCounts| {
            let mut acc = SessionAccumulator::with_counts("2026-09-02T10:00:00Z".into(), c);
            acc.record_fps("g.exe", 100.0, 10.0, 80.0, 0);
            acc.finalize(MIN_SESSION_SECS)
        };
        let a = session(since(at));
        // Never a total: every reader of the whole fields sees "not recorded".
        assert_eq!((a.compy_changes_active, a.compy_changes_cant_confirm, a.compy_changes_legacy_active), (None, None, None));
        assert_eq!(a.compy_changes_since_set_aside.as_ref().map(|c| (c.active, c.cant_confirm)), Some((Some(2), 1)));
        // On disk and back, and an older row without the key reads as before.
        let row = disk_row(&a).unwrap();
        assert_eq!(row["compy_changes_unrecorded"], true, "an older Compy reads the total as not recorded");
        assert_eq!(from_disk_row(row.clone()).unwrap(), a);
        let mut old = row;
        old.as_object_mut().unwrap().remove("compy_changes_since_set_aside");
        assert_eq!(from_disk_row(old).unwrap().compy_changes_since_set_aside, None);

        // Two sessions since the SAME set-aside compare those counts; the edge is an instant, not text.
        let mut b = session(since(at));
        b.compy_changes_since_set_aside.as_mut().unwrap().since = "2026-09-01T12:00:00+02:00".into();
        let pc = ChangeCounts::PerChange { active: 2, cant_confirm: 1 };
        assert_eq!(comparable_change_counts(&a, &b), Ok((pc, pc)));
        // A different set-aside, or a session with whole counts, is never compared with them.
        let other = session(since(at + chrono::TimeDelta::hours(1)));
        assert!(comparable_change_counts(&a, &other).is_err());
        let whole = session(crate::history::SessionStartCounts { whole: Some(counts), since_set_aside: None });
        assert_eq!(comparable_change_counts(&whole, &a).unwrap_err().started_at, a.started_at, "names the one with no total");
        assert!(comparable_change_counts(&a, &whole).is_err());

        // Read for a check counted since that set-aside, the session carries those counts per change.
        let counted = a.counted_since_set_aside(at).expect("counted since this set-aside");
        assert_eq!((counted.compy_changes_active, counted.compy_changes_cant_confirm), (Some(2), Some(1)));
        assert!(counted.compy_changes_per_change);
        assert_eq!(counted.compy_changes_legacy_active, None);
        assert!(a.counted_since_set_aside(at + chrono::TimeDelta::seconds(1)).is_none(), "another set-aside");
        assert!(whole.counted_since_set_aside(at).is_none(), "a session with whole counts has none since");
    }
}
