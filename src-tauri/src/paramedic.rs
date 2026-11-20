//! PC Paramedic, Layer 1, slice F1 ("Something's wrong"). READ-ONLY.
//!
//! `diagnose` is a pure function over a game's recorded sessions: it decides whether the newest
//! judgeable session sits far outside that game's OWN history (frozen rules below), and if so lists
//! what Compy recorded changing before it, ranked by named supports and contradictions (design
//! `_train/m1-paramedic-design.md` sections A, B). It returns codes, ids and numbers only; every
//! sentence lives in the UI's locale files. It never writes a file, never calls an apply path and
//! reads no store of its own: `paramedic_diagnose` only reads what `intelligence::gather()` loads.
//!
//! It does not call `intelligence::what_changed`: that ranker is gated on comparability, a measured
//! noise band and an unchanged frame cap, and it refuses attribution when two things changed, which
//! is the exact reason nothing flagged the 2026-11-19/20 incident (design section 0). The finding ids
//! below are that catalog's ids; the inputs are `gather()`'s; the driver test is `hardware::driver_changed`.
//!
//! F4b: the command also asks `change_sources` (read-only: driver log, update log, the game's Steam manifest,
//! installed programs) what Windows recorded between the last normal session and the rough ones, once, off the
//! UI thread, within a total budget (`changes.rs`). The report is an INPUT to the pure `diagnose`; if the readers
//! fail or run long every kind is Unknown. Windows' dated driver install is the same fact as the sessions'
//! driver stamps and only sharpens the timing: it is never a second independent support.
//!
//! Wording law (Constitution 17, 25): a finding says what changed before the problem, never that it
//! caused it. Certainty is a band, never a number.

use std::collections::BTreeMap;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::intelligence::{self, SessionRef};

mod changes;
mod extras;
mod facts;
pub(crate) mod first_look;
mod mods;
mod recovery;
use changes::{ChangeRead, Limit};
use extras::CrashRead;
use mods::ModInput;
use recovery::{EarlierEpisode, NowLine, NowStatus, Outcome, Recovery};

// ---- Frozen constants (design A3 / B). A change re-runs the walk-forward fixture test. ----------
/// A session is judgeable only if it is long enough, has enough readings and Compy measured enough of it.
pub(crate) const MIN_JUDGE_SECS: u64 = 300;
pub(crate) const MIN_JUDGE_SAMPLES: u32 = 250;
pub(crate) const MIN_JUDGE_COVERAGE: f64 = 0.50;
/// A session can serve as "normal" only when Compy measured at least this much of it.
pub(crate) const BASELINE_COVERAGE: f64 = 0.80;
pub(crate) const BASELINE_MAX: usize = 10;
pub(crate) const BASELINE_MIN: usize = 3;
/// RULE_R: smoothness ratio (1% low / average) <= 0.80 x the baseline median AND 0.03 below its worst.
pub(crate) const RULE_R_FRACTION: f64 = 0.80;
pub(crate) const RULE_R_BELOW_MIN: f64 = 0.03;
/// RULE_P99: p99 frame time >= 2.0 x baseline median AND >= 1.3 x baseline max (corroborating).
pub(crate) const RULE_P99_MEDIAN_X: f64 = 2.0;
pub(crate) const RULE_P99_MAX_X: f64 = 1.3;
/// FIRED = RULE_R || (RULE_P99 && R <= 0.90 x baseline median).
pub(crate) const RULE_P99_R_FRACTION: f64 = 0.90;
/// RULE_AVG: average FPS <= 0.70 x baseline median. Supporting evidence only, never fires alone.
pub(crate) const RULE_AVG_FRACTION: f64 = 0.70;
/// Cause lines (design B, magnitude M).
pub(crate) const RAM_FULL_FRACTION: f64 = 0.90;
pub(crate) const RAM_BASELINE_MAX_FRACTION: f64 = 0.80;
pub(crate) const OTHER_CPU_P90_PCT: f64 = 15.0;
/// Recorded background load, rough sessions against the normal ones (`load_state`). All figures are the 90th
/// percentile of a session's readings (what the recorder keeps as `p90_pct_x10`), compared in tenths of a
/// percent so a boundary never depends on float rounding. A kind counts as HIGH in the rough session(s) when its
/// p90 is at or above its busy line AND at least its rise above the normal sessions' median AND the normal
/// median itself is under the busy line; SAME when it is under the busy line and within `LOAD_SAME_PTS` of the
/// normal median either way; anything else is in between (shown, never counted).
/// Other programs' 3D-engine work: a SUM over engines of everything but the game, and the desktop compositor and
/// a browser keep a floor under it, so its busy line sits above the processor's.
pub(crate) const OTHER_GPU_3D_P90_PCT: f64 = 20.0;
/// Other programs' video-engine work (decode, encode): idle unless something is playing, recording or
/// streaming, so a sustained 10% is a real encode or decode, and the rise needed is smaller.
pub(crate) const OTHER_GPU_VIDEO_P90_PCT: f64 = 10.0;
/// Rise over the normal median that counts as "more than usual" (processor and 3D engine).
pub(crate) const LOAD_RISE_PTS: f64 = 15.0;
/// The same for the video engine.
pub(crate) const LOAD_VIDEO_RISE_PTS: f64 = 10.0;
/// Within this many points of the normal median is "about the same".
pub(crate) const LOAD_SAME_PTS: f64 = 5.0;
/// Normal sessions with a recorded figure needed before the rough ones can be compared with them.
pub(crate) const LOAD_BASELINE_MIN: usize = 3;
/// Process starts of build/encode tools in one session that count as "busy programs were running".
pub(crate) const BUSY_START_MIN: u32 = 5;
/// With no game named, every game played within this many days of the newest session is judged.
pub(crate) const RECENT_GAME_DAYS: i64 = 14;
/// Build and encode tools whose repeated starts mean heavy background work (names, lower-case, no `.exe`).
const BUSY_PROGRAMS: &[&str] = &[
    "cargo", "cargo-clippy", "rustc", "rustup", "clippy-driver", "build-script-build", "link", "cl",
    "msbuild", "ninja", "cmake", "ffmpeg", "handbrake", "x264", "x265", "7z", "winrar",
];
const METHOD: &str = "paramedic-rules-v1";

// ---- Inputs: numbers a session recorded, plus identity sightings and drift notices. -------------
/// A session's frame-cap state (`noise_floor::CapRead`, reduced). A cap pins the average and lifts the
/// smoothness ratio, so a session is only ever compared with sessions in the same state.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub(crate) enum CapState {
    #[default]
    Unknown,
    Uncapped,
    Capped { at_fps: f64 },
}

impl CapState {
    fn read(self) -> crate::noise_floor::CapRead {
        match self {
            CapState::Unknown => crate::noise_floor::CapRead::Unknown,
            CapState::Uncapped => crate::noise_floor::CapRead::Uncapped,
            CapState::Capped { at_fps } => crate::noise_floor::CapRead::Capped { at_fps },
        }
    }

    /// The same state to compare like with like: two unread states, or two reads that
    /// `noise_floor::cap_pair` calls the same cap (its tolerance, not a second number of ours).
    fn same_as(self, other: CapState) -> bool {
        match (self, other) {
            (CapState::Unknown, CapState::Unknown) => true,
            _ => crate::noise_floor::cap_pair(self.read(), other.read()) == crate::noise_floor::CapPair::Same,
        }
    }

    /// Both states were read and they differ: the only case where "the cap changed" is established.
    fn known_change(self, other: CapState) -> bool {
        crate::noise_floor::cap_pair(self.read(), other.read()) == crate::noise_floor::CapPair::Changed
    }

    /// The card's own word for it: `unknown`, `uncapped` or the cap in whole frames per second.
    fn word(self) -> String {
        match self {
            CapState::Unknown => "unknown".into(),
            CapState::Uncapped => "uncapped".into(),
            CapState::Capped { at_fps } => format!("{}", at_fps.round() as i64),
        }
    }
}

/// What `diagnose` reads of one session. Built from a `SessionSummary` by `facts_from`; the fixture
/// test builds it straight from recorded numbers (no names, no paths).
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct SessionFacts {
    started_at: String,
    /// The game's process name, used only as the grouping key.
    game: String,
    duration_secs: u64,
    samples: u32,
    #[serde(default)]
    background_secs: u32,
    avg_fps: f64,
    low1_fps: f64,
    #[serde(default)]
    p99_ms: Option<f64>,
    #[serde(default)]
    peak_ram_bytes: Option<u64>,
    #[serde(default)]
    ram_total_bytes: Option<u64>,
    /// The highest graphics card temperature the session read, whole degrees C. None: no reading.
    #[serde(default)]
    peak_gpu_temp_c: Option<u32>,
    #[serde(default)]
    gpu_driver: Option<String>,
    #[serde(default)]
    windows_build: Option<String>,
    #[serde(default)]
    refresh_hz: Option<u32>,
    #[serde(default)]
    power_plan: Option<String>,
    #[serde(default)]
    rig: Option<String>,
    #[serde(default)]
    compy_changes: Option<usize>,
    /// Starts of build/encode programs seen during the session (`BUSY_PROGRAMS`).
    #[serde(default)]
    busy_starts: u32,
    /// Which programs those were. Empty in recorded fixtures; filled from the live session.
    #[serde(default)]
    busy_names: Vec<String>,
    /// Every program name seen starting during the session (lower case, no `.exe`), as the recorder kept
    /// them. Used only to tell whether a program Windows says was installed also ran in a rough session.
    #[serde(default)]
    started_names: Vec<String>,
    #[serde(default)]
    ram_events: u32,
    /// 90th percentile of how busy everything except the game was, percent. Unknown before TG-context v2.
    #[serde(default)]
    other_cpu_p90_pct: Option<f64>,
    /// Same for 3D-engine work done by everything but the game (a sum, clamped to 100). Sessions recorded
    /// before 2026-11-20 never have it: unknown, never zero.
    #[serde(default)]
    other_gpu_3d_p90_pct: Option<f64>,
    /// Same for video-engine work (decode, encode) by everything but the game.
    #[serde(default)]
    other_gpu_video_p90_pct: Option<f64>,
    /// The session-wide mean of the same three figures. A p90 cannot see a burst shorter than a tenth of the
    /// session, so "about the same as usual" is only a contradiction when the mean agrees with the p90.
    #[serde(default)]
    other_cpu_mean_pct: Option<f64>,
    #[serde(default)]
    other_gpu_3d_mean_pct: Option<f64>,
    #[serde(default)]
    other_gpu_video_mean_pct: Option<f64>,
    /// Which listed programs were open at the session's first frame (`running_at_start.rs`). `None` = not
    /// recorded (an older row, or no frame ever named the process): "Compy didn't record", never "nothing
    /// was running". Read only through `already_running_sentence` and `differs_between`.
    #[serde(default)]
    running_at_start: Option<crate::running_at_start::RunningAtStart>,
    /// Ticks the start recorder skipped (a burst of more than four names) and starts it dropped (a full log).
    #[serde(default)]
    start_ticks_skipped: Option<u32>,
    #[serde(default)]
    start_events_dropped: Option<u32>,
    #[serde(default)]
    cap: CapState,
    /// The recorder's read-only flag (`session_boundary::suspected_splice`) says this row may hold two games.
    /// Such a session is NOT judged: it is left out of baselines, rough counts, recovery pairs and every
    /// per-session evidence count, and the card says so in one note line.
    #[serde(default)]
    mixed: bool,
    /// Why the session stopped (`session_boundary::SessionEnd`). `None` = not recorded (an older row): such a
    /// row is never joined to the one after it, because Compy cannot tell a relaunch from a new sitting.
    #[serde(default)]
    ended: Option<crate::session_boundary::SessionEnd>,
}

/// A time Compy looked at the PC's identity (an `IdentitySnapshot`, reduced).
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Sighting {
    observed_at: String,
    #[serde(default)]
    gpu_driver: String,
    #[serde(default)]
    power_plan: String,
}

/// A setting Compy watches that was noticed changed (`drift::DriftNotice`, reduced).
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct DriftFact {
    id: String,
    #[serde(default)]
    last_ready_at: Option<String>,
    noticed_at: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub(crate) struct DiagnoseInputs {
    sessions: Vec<SessionFacts>,
    #[serde(default)]
    sightings: Vec<Sighting>,
    #[serde(default)]
    drift: Vec<DriftFact>,
    /// The identity-check store exists but could not be read: said as an unknown, never as "no checks".
    #[serde(default)]
    sightings_unread: bool,
    /// The setting-drift store exists but could not be read: said as an unknown, never as "no drift".
    #[serde(default)]
    drift_unread: bool,
    /// What Windows recorded in the diagnosis window. Never part of a recorded fixture: the command
    /// reads it, and tests build it by hand.
    #[serde(skip)]
    changes: ChangeRead,
    /// What the command's scan of the game's folder (and a cross-game folder) found, as a plain verdict.
    /// Never part of a recorded fixture; tests build it by hand.
    #[serde(skip)]
    mods: ModInput,
    /// The crash reports Windows keeps for apps, as the command read them. Never part of a recorded fixture.
    #[serde(skip)]
    crashes: CrashRead,
}

// ---- Outputs: codes, ids and numbers. The UI owns every sentence. ----------------------------
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Complaint {
    /// Slow or stuttering.
    Slow,
    Crash,
    WasFineBefore,
    Unknown,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum CantTellWhy {
    /// The problem is measured, but nothing Compy records changed before it.
    NothingChanged,
    /// The game's newest session was only partly measured, so it is not judged (and the older sessions
    /// are never reported as "nothing wrong" in its place). `looked_rough`: on the numbers it has, it
    /// would have fired.
    PartialMeasure { percent: u8, looked_rough: bool },
    /// The newest session ran under a different frame cap (or an unknown one) than the sessions before
    /// it, so the two are not comparable until Compy has seen three normal sessions in the new state.
    FrameCapChanged,
    NoSessions,
    /// F10 will answer crash complaints in this card; F1 does not.
    CrashNotCovered,
    /// An episode of rough sessions was followed by sessions that are neither clearly back to normal
    /// nor rough again (in between, partly measured, or under another frame cap). `partial`: the newest
    /// session was not measured well enough to be judged either way. `one_clear`: exactly one session
    /// since has run the way the game usually does (Recovered needs two). `cap_changed`: the newest
    /// session ran under another frame cap, so playing again cannot settle it.
    RecoveryUnclear { partial: bool, one_clear: bool, cap_changed: bool },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum DiagnosisState {
    NothingWrong { sessions_checked: u8 },
    CantTell { why: CantTellWhy },
    Found,
    /// F3: an episode of rough sessions is over: the game's newest judged sessions run the way it usually
    /// does. `Diagnosis::recovery` carries the numbers and what the recovery says about each candidate.
    Recovered,
    NeedsMorePlay { sessions_needed: u8, have: u8 },
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AnomalyRule {
    /// RULE_R fired: the dips went far below the game's own worst.
    StutterCollapse,
    /// Only the spike rule (RULE_P99 with a smoothness drop) fired.
    Spikes,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Metric {
    /// Smoothness ratio (1% low / average): how far it drops when it dips.
    pub ratio: f64,
    pub p99_ms: Option<f64>,
    pub avg_fps: f64,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct ProblemReading {
    pub rule: AnomalyRule,
    /// RULE_P99 also fired on at least one affected session.
    pub spikes: bool,
    /// The average dropped to <= 0.70 x its usual: supporting only, never the reason.
    pub avg_lower: bool,
    /// The game's own usual (baseline medians).
    pub before: Metric,
    /// Mean ratio and average of the affected sessions, worst p99.
    pub now: Metric,
    pub last_normal_at: String,
    /// The newest session before the episode that was fully measured (coverage >= BASELINE_COVERAGE) and
    /// ran at >= RECOVERY_R_FRACTION x the median. The card says "last ran normally" only when this is
    /// `last_normal_at`; otherwise it names this one as the last fully measured normal session.
    pub last_full_normal_at: Option<String>,
    pub sessions_affected: Vec<SessionRef>,
    /// Sessions Compy measured only in part that would also have fired: corroboration, never a reason alone.
    pub partial_sessions: Vec<SessionRef>,
    pub other_games_affected: Vec<String>,
    /// Sessions after the newest rough one that were not judged (partly measured): while any exist Compy
    /// cannot say the game is back to normal.
    pub later_unjudged: u8,
}

/// §25 vocabulary, per line of evidence.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EvidenceKind {
    Known,
    Measured,
    /// A recovery observation that supports a candidate (never proves it).
    SupportedInference,
    #[allow(dead_code)] // F8 (mechanism-only findings)
    ExpectedMechanism,
    Unknown,
}

/// Per finding: only these values exist. `Known` and `Measured` are reserved for the follow-up check (F3).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Certainty {
    #[allow(dead_code)]
    Known,
    #[allow(dead_code)]
    Measured,
    Likely,
    Possible,
    #[allow(dead_code)]
    Mechanism,
    #[allow(dead_code)]
    CantTell,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Evidence {
    pub kind: EvidenceKind,
    pub code: &'static str,
    pub args: BTreeMap<&'static str, String>,
    /// The line weakens the finding (a contradiction), it does not support it.
    pub against: bool,
    pub source: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum When {
    Exact { at: String },
    /// It happened between two times Compy has a reading for.
    ObservedBetween { from: String, to: String },
    /// Compy noticed it at this time; when it happened is not recorded.
    Seen { at: String },
    Unknown,
}

/// Closed allowlist of one-click actions a finding may point at (ARCHITECTURE_LOCKS 1.1/1.2). F1 offers
/// none: the paramedic only proposes, and the existing apply path stays untouched.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[allow(dead_code)] // F6 wires these
pub(crate) enum OneClickAction {
    UndoCompyChange { change_id: String },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[allow(dead_code)] // OneClick and Hardware arrive in F6 and F7
pub(crate) enum Fix {
    OneClick { action: OneClickAction, reversible: bool, needs_admin: bool },
    Steps { code: &'static str, args: BTreeMap<&'static str, String> },
    Hardware { code: &'static str },
    None { code: &'static str },
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct Finding {
    pub id: &'static str,
    pub confidence: Certainty,
    pub evidence: Vec<Evidence>,
    pub since_when: When,
    pub fix: Fix,
    /// Possible, with timing, and nothing against it: one of the changes Compy cannot yet tell apart.
    pub in_play: bool,
    /// F3: what the sessions since the episode say about this candidate. `None` unless the episode recovered.
    pub now: Option<NowStatus>,
    pub now_evidence: Vec<Evidence>,
}

/// Checked and found unchanged since the normal sessions (design B, C3). Says only what was compared.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct RuledOut {
    pub id: &'static str,
    pub args: BTreeMap<&'static str, String>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct Diagnosis {
    pub complaint: Complaint,
    pub state: DiagnosisState,
    /// The game's process name, as recorded.
    pub game: Option<String>,
    pub game_name: Option<String>,
    pub problem: Option<ProblemReading>,
    /// Ranked: [0] is the most likely, the rest are "also possible".
    pub findings: Vec<Finding>,
    pub not_it: Vec<RuledOut>,
    /// What Compy could not see, as codes.
    pub unknowns: Vec<&'static str>,
    /// What Compy could not see of Windows' own records, per kind of change (never "nothing changed").
    pub limits: Vec<Limit>,
    /// Things Compy looked at and found, which are listed under "What Compy checked" and are not
    /// findings (security definition and app updates, installed programs, other drivers).
    pub seen: Vec<RuledOut>,
    /// The newest of the game's normal sessions the problem was judged against.
    pub baseline: Option<SessionRef>,
    pub first_bad: Option<SessionRef>,
    /// Why the first finding leads: `cross-game` (other changes are contradicted), `cross-game-lead`
    /// (another game got rough too, but other changes still line up), `tie` (two Likely) or
    /// `not-separable` (no Likely, two or more in play: the card lists them without ranking a winner).
    pub why_first: Option<&'static str>,
    /// F3: set with `DiagnosisState::Recovered`.
    pub recovery: Option<Recovery>,
    /// F3: set when the current episode follows an earlier one that recovered.
    pub earlier_episode: Option<EarlierEpisode>,
    /// Start times of this game's recent sessions that may hold two games and were therefore not judged.
    pub mixed_sessions: Vec<String>,
    pub method: &'static str,
}

impl Diagnosis {
    fn empty(complaint: Complaint, state: DiagnosisState) -> Self {
        Self {
            complaint,
            state,
            game: None,
            game_name: None,
            problem: None,
            findings: Vec::new(),
            not_it: Vec::new(),
            unknowns: Vec::new(),
            limits: Vec::new(),
            seen: Vec::new(),
            baseline: None,
            first_bad: None,
            why_first: None,
            recovery: None,
            earlier_episode: None,
            mixed_sessions: Vec::new(),
            method: METHOD,
        }
    }
}

// ---- Small helpers --------------------------------------------------------------------------
fn ts(s: &str) -> Option<DateTime<Utc>> {
    intelligence::parse_utc(s)
}

fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n == 0 {
        0.0
    } else if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

fn gb(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / 1e9)
}

fn nonblank(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|x| !x.is_empty())
}

fn same_game(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

fn ev(kind: EvidenceKind, code: &'static str, source: &'static str, against: bool, args: &[(&'static str, String)]) -> Evidence {
    Evidence { kind, code, args: args.iter().cloned().collect(), against, source }
}

impl SessionFacts {
    fn start(&self) -> Option<DateTime<Utc>> {
        ts(&self.started_at)
    }

    fn end(&self) -> Option<DateTime<Utc>> {
        self.start().map(|t| t + chrono::Duration::seconds(self.duration_secs as i64))
    }

    /// How much of the session's own time Compy measured (alt-tabbed seconds are not the game's).
    fn coverage(&self) -> f64 {
        let span = self.duration_secs as f64 - f64::from(self.background_secs);
        if span > 0.0 {
            f64::from(self.samples) / span
        } else {
            0.0
        }
    }

    /// Smoothness ratio: 1% low over average. `None` when either is unread.
    fn ratio(&self) -> Option<f64> {
        let ok = self.avg_fps.is_finite() && self.low1_fps.is_finite() && self.avg_fps > 0.0 && self.low1_fps > 0.0;
        ok.then(|| self.low1_fps / self.avg_fps)
    }

    fn judgeable(&self) -> bool {
        self.duration_secs >= MIN_JUDGE_SECS
            && self.samples >= MIN_JUDGE_SAMPLES
            && self.coverage() >= MIN_JUDGE_COVERAGE
            && self.ratio().is_some()
    }

    fn ram_fraction(&self) -> Option<f64> {
        match (self.peak_ram_bytes, self.ram_total_bytes) {
            (Some(p), Some(t)) if t > 0 => Some(p as f64 / t as f64),
            _ => None,
        }
    }

    fn session_ref(&self) -> SessionRef {
        let r1 = |x: f64| (x * 10.0).round() / 10.0;
        SessionRef {
            started_at: self.started_at.clone(),
            game: intelligence::pretty_game_name(&self.game),
            duration_secs: self.duration_secs,
            samples: self.samples,
            avg_fps: r1(self.avg_fps),
            low1_fps: r1(self.low1_fps),
            gaming_mode_active: None,
            hw_hash: None,
        }
    }
}

// ---- A3: is something wrong? Walk-forward judging of one game's sessions. ------------------
#[derive(Clone, Debug)]
struct BaseStats {
    med_r: f64,
    min_r: f64,
    med_p99: Option<f64>,
    max_p99: Option<f64>,
    med_avg: f64,
    /// Indexes (into the game's session list) of the baseline sessions, ascending.
    ids: Vec<usize>,
}

#[derive(Clone, Copy, Debug)]
struct Eval {
    rule_r: bool,
    rule_p99: bool,
    fired: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Verdict {
    /// Not judgeable (too short, too few readings, or too little of it measured).
    Unjudged,
    /// Judgeable, but the game has fewer than `BASELINE_MIN` normal sessions before it.
    NeedsMore(usize),
    /// Judgeable, with enough normal sessions in total, but fewer than `BASELINE_MIN` under the same
    /// frame-cap state: not comparable, so neither normal nor rough.
    CapChanged,
    Normal,
    Fired,
}

#[derive(Clone, Debug)]
struct Judgement {
    verdict: Verdict,
    /// The rule would fire on this session (judgeable or not); a partial session only corroborates.
    would_fire: bool,
    base: Option<BaseStats>,
    eval: Option<Eval>,
}

fn base_stats(sess: &[&SessionFacts], pool: &[usize]) -> Option<BaseStats> {
    if pool.len() < BASELINE_MIN {
        return None;
    }
    let ids: Vec<usize> = pool[pool.len().saturating_sub(BASELINE_MAX)..].to_vec();
    let mut r: Vec<f64> = ids.iter().filter_map(|&i| sess[i].ratio()).collect();
    let mut avg: Vec<f64> = ids.iter().map(|&i| sess[i].avg_fps).collect();
    let mut p99: Vec<f64> = ids.iter().filter_map(|&i| sess[i].p99_ms).collect();
    let min_r = r.iter().copied().fold(f64::INFINITY, f64::min);
    let (med_p99, max_p99) = if p99.len() >= BASELINE_MIN {
        (Some(median(&mut p99)), p99.iter().copied().reduce(f64::max))
    } else {
        (None, None)
    };
    Some(BaseStats { med_r: median(&mut r), min_r, med_p99, max_p99, med_avg: median(&mut avg), ids })
}

fn evaluate(s: &SessionFacts, b: &BaseStats) -> Option<Eval> {
    let r = s.ratio()?;
    let rule_r = r <= RULE_R_FRACTION * b.med_r && r <= b.min_r - RULE_R_BELOW_MIN;
    let rule_p99 = match (s.p99_ms, b.med_p99, b.max_p99) {
        (Some(p), Some(m), Some(x)) => p >= RULE_P99_MEDIAN_X * m && p >= RULE_P99_MAX_X * x,
        _ => false,
    };
    let fired = rule_r || (rule_p99 && r <= RULE_P99_R_FRACTION * b.med_r);
    Some(Eval { rule_r, rule_p99, fired })
}

/// Each session is judged only against the game's earlier ones (a session never sees its own future).
fn judge_game(sess: &[&SessionFacts]) -> Vec<Judgement> {
    let mut pool: Vec<usize> = Vec::new();
    let mut out = Vec::with_capacity(sess.len());
    for (i, s) in sess.iter().enumerate() {
        let judgeable = s.judgeable();
        // A session is compared only with earlier normal sessions under the same frame-cap state. A thin
        // session whose cap could not be read (a short trace) only ever corroborates, and is compared with
        // the baseline sessions a cap cannot flatter (uncapped or unread): a cap lifts a ratio, so this
        // never invents a drop. Without this a partly measured session was never compared at all.
        let same: Vec<usize> = if !judgeable && s.cap == CapState::Unknown {
            pool.iter().copied().filter(|&j| !matches!(sess[j].cap, CapState::Capped { .. })).collect()
        } else {
            pool.iter().copied().filter(|&j| sess[j].cap.same_as(s.cap)).collect()
        };
        let base = base_stats(sess, &same);
        let eval = base.as_ref().and_then(|b| evaluate(s, b));
        let fired = eval.is_some_and(|e| e.fired);
        let verdict = if !judgeable {
            Verdict::Unjudged
        } else if base.is_none() && pool.len() >= BASELINE_MIN {
            Verdict::CapChanged
        } else if base.is_none() {
            Verdict::NeedsMore(pool.len())
        } else if fired {
            Verdict::Fired
        } else {
            Verdict::Normal
        };
        let flagged = eval.is_some_and(|e| e.rule_r || e.rule_p99);
        if judgeable && !flagged && s.coverage() >= BASELINE_COVERAGE {
            pool.push(i);
        }
        out.push(Judgement { verdict, would_fire: fired, base, eval });
    }
    out
}

/// A launch that follows the end of an earlier one by no more than this, after the earlier one's process
/// exited, can be the same sitting: the player closed the game (or it closed) and opened it again.
pub(crate) const SITTING_GAP_MINUTES: i64 = 10;

/// True unless a stamp recorded on BOTH launches differs: graphics driver, Windows build, power plan, refresh
/// rate, number of changes Compy had on, hardware, frame-cap state. A missing stamp may still join, but the\n/// caller compares a joining launch with EVERY member of the sitting. A change between two launches is never
/// hidden inside a sitting. (The game's own build is not recorded on a session row, so it cannot be compared.)
fn same_stamps(a: &SessionFacts, b: &SessionFacts) -> bool {
    fn same<T: PartialEq>(x: &Option<T>, y: &Option<T>) -> bool {
        match (x, y) {
            (Some(p), Some(q)) => p == q,
            _ => true,
        }
    }
    let cap = match (a.cap, b.cap) {
        (CapState::Unknown, _) | (_, CapState::Unknown) => true,
        (p, q) => p.same_as(q),
    };
    same(&a.gpu_driver, &b.gpu_driver)
        && same(&a.windows_build, &b.windows_build)
        && same(&a.power_plan, &b.power_plan)
        && same(&a.refresh_hz, &b.refresh_hz)
        && same(&a.compy_changes, &b.compy_changes)
        && same(&a.rig, &b.rig)
        && cap
}

/// PURE. Groups one game's rows (oldest first) into sittings, as lists of indices. A row joins the one before
/// it only when ALL hold: that row's recorded end is `ProcessExited` (the game's process went away); this row
/// began within `SITTING_GAP_MINUTES` of that row's end; no stamp recorded on both differs (`same_stamps`);
/// and the sitting still has at most ONE launch that can be judged for frame rate (the others are short
/// fragments). Two judgeable launches are two sessions, whatever the gap. A row with no recorded end (an older
/// row), one that ended because monitoring was stopped, or one whose process identity changed is never joined:
/// Compy cannot tell those from a fresh sitting.
fn group_sittings(rows: &[&SessionFacts], mixed: &[DateTime<Utc>]) -> Vec<Vec<usize>> {
    let mut out: Vec<Vec<usize>> = Vec::new();
    for i in 0..rows.len() {
        let in_group = out.last().map_or(0, |g: &Vec<usize>| g.iter().filter(|&&k| rows[k].judgeable()).count());
        let joins = i > 0
            && rows[i - 1].ended == Some(crate::session_boundary::SessionEnd::ProcessExited)
            && matches!((rows[i - 1].end(), rows[i].start()), (Some(e), Some(b)) if b - e <= chrono::Duration::minutes(SITTING_GAP_MINUTES))
            // Against EVERY launch already in the sitting, so X / not recorded / Y never chain into one.
            && out.last().is_none_or(|g| g.iter().all(|&k| same_stamps(rows[k], rows[i])))
            // A row Compy could not attribute to one game (suspected mixed) between the two launches breaks it.
            && !matches!((rows[i - 1].start(), rows[i].start()), (Some(a), Some(b)) if mixed.iter().any(|m| *m >= a && *m <= b))
            && in_group + usize::from(rows[i].judgeable()) <= 1;
        match out.last_mut() {
            Some(g) if joins => g.push(i),
            _ => out.push(vec![i]),
        }
    }
    out
}

/// A sitting's one row: its longest judgeable launch (the earliest on a tie), else its longest launch. With at
/// most one judgeable launch per sitting this is that launch.
fn sitting_value(rows: &[&SessionFacts], group: &[usize]) -> usize {
    let longest = |it: &mut dyn Iterator<Item = usize>| it.max_by_key(|&i| (rows[i].duration_secs, std::cmp::Reverse(i)));
    longest(&mut group.iter().copied().filter(|&i| rows[i].judgeable())).or_else(|| longest(&mut group.iter().copied())).unwrap_or(group[0])
}

/// One game's raw rows, oldest first. A session whose start cannot be read is left out, never guessed at, and
/// a session the capture flag marks as possibly two games is not one of the game's sessions here.
fn game_rows<'a>(inp: &'a DiagnoseInputs, game: &str) -> Vec<&'a SessionFacts> {
    let mut v: Vec<&SessionFacts> = inp.sessions.iter().filter(|s| !s.mixed && same_game(&s.game, game) && s.start().is_some()).collect();
    v.sort_by_key(|s| s.start());
    v
}

/// The start of every row the capture flag marks as possibly two games, whatever game it names.
fn mixed_starts(inp: &DiagnoseInputs) -> Vec<DateTime<Utc>> {
    inp.sessions.iter().filter(|s| s.mixed).filter_map(|s| s.start()).collect()
}

/// One game's sessions, oldest first, one per sitting (see `group_sittings`, `sitting_value`).
fn game_sessions<'a>(inp: &'a DiagnoseInputs, game: &str) -> Vec<&'a SessionFacts> {
    let rows = game_rows(inp, game);
    group_sittings(&rows, &mixed_starts(inp)).iter().map(|g| rows[sitting_value(&rows, g)]).collect()
}

/// When the sitting that `s` stands for began and ended: from its first launch's start to its last launch's
/// end. The END is where a normal sitting stops counting as "before"; the rough sitting's window still closes
/// at the rough launch's OWN start, so a change made between two launches is never read as coming after.
fn sitting_span(inp: &DiagnoseInputs, s: &SessionFacts) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>) {
    let rows = game_rows(inp, &s.game);
    let groups = group_sittings(&rows, &mixed_starts(inp));
    let Some(g) = groups.iter().find(|g| g.iter().any(|&i| rows[i].started_at == s.started_at)) else {
        return (s.start(), s.end());
    };
    let (first, last) = (rows[g[0]], rows[g[g.len() - 1]]);
    (first.start(), last.end().max(s.end()))
}

/// The started_at of the one launch standing for each of this game's sittings that held more than one launch.
fn merged_sitting_reps(inp: &DiagnoseInputs, game: &str) -> Vec<String> {
    let rows = game_rows(inp, game);
    group_sittings(&rows, &mixed_starts(inp)).iter().filter(|g| g.len() > 1).map(|g| rows[sitting_value(&rows, g)].started_at.clone()).collect()
}

/// A sitting's evidence comes from ALL its launches, now that at most one of them is judged for frame rate:
/// program starts and their counters are summed or united, the memory peak is the highest, and the start
/// snapshot is the union of the programs seen open at any launch's first frame. Judgeable and time fields stay
/// the representative launch's own. The raw rows stay in `sessions` for the readers that work on time.
fn merge_launches(r: &mut SessionFacts, all: &[&SessionFacts]) {
    r.busy_starts = all.iter().fold(0u32, |a, s| a.saturating_add(s.busy_starts));
    r.ram_events = all.iter().fold(0u32, |a, s| a.saturating_add(s.ram_events));
    let union = |pick: fn(&SessionFacts) -> &Vec<String>| {
        let mut v: Vec<String> = all.iter().flat_map(|s| pick(s).iter().cloned()).collect();
        v.sort();
        v.dedup();
        v
    };
    r.busy_names = union(|s| &s.busy_names);
    r.started_names = union(|s| &s.started_names);
    r.peak_ram_bytes = all.iter().filter_map(|s| s.peak_ram_bytes).max();
    r.peak_gpu_temp_c = all.iter().filter_map(|s| s.peak_gpu_temp_c).max();
    let sum = |pick: fn(&SessionFacts) -> Option<u32>| {
        let v: Vec<u32> = all.iter().filter_map(|s| pick(s)).collect();
        (!v.is_empty()).then(|| v.iter().fold(0u32, |a, b| a.saturating_add(*b)))
    };
    r.start_events_dropped = sum(|s| s.start_events_dropped);
    r.start_ticks_skipped = sum(|s| s.start_ticks_skipped);
    let readable: Vec<&crate::running_at_start::RunningAtStart> =
        all.iter().filter_map(|s| s.running_at_start.as_ref()).filter(|x| x.is_readable()).collect();
    if let Some(first) = readable.first() {
        let mut merged = (*first).clone();
        for other in &readable[1..] {
            merged.total_processes = merged.total_processes.max(other.total_processes);
            for k in &other.known {
                if !merged.known.iter().any(|m| m.id == k.id) {
                    merged.known.push(k.clone());
                }
            }
        }
        merged.known.sort_by_key(|k| crate::running_at_start::PROGRAMS.iter().position(|p| p.id == k.id));
        r.running_at_start = Some(merged);
    }
}

/// The inputs with each multi-launch sitting's evidence gathered onto its representative launch.
fn with_sitting_evidence(inp: &DiagnoseInputs) -> DiagnoseInputs {
    let mut out = inp.clone();
    let mut games: Vec<String> = Vec::new();
    for s in inp.sessions.iter().filter(|s| !s.mixed && s.start().is_some()) {
        if !games.iter().any(|g| same_game(g, &s.game)) {
            games.push(s.game.clone());
        }
    }
    for game in games {
        let mut idx: Vec<usize> = (0..inp.sessions.len())
            .filter(|&i| {
                let s = &inp.sessions[i];
                !s.mixed && s.start().is_some() && same_game(&s.game, &game)
            })
            .collect();
        idx.sort_by_key(|&i| inp.sessions[i].start());
        let rows: Vec<&SessionFacts> = idx.iter().map(|&i| &inp.sessions[i]).collect();
        for g in group_sittings(&rows, &mixed_starts(inp)).iter().filter(|g| g.len() > 1) {
            let rep = idx[sitting_value(&rows, g)];
            let members: Vec<&SessionFacts> =
                std::iter::once(&inp.sessions[rep]).chain(g.iter().map(|&k| idx[k]).filter(|&i| i != rep).map(|i| &inp.sessions[i])).collect();
            merge_launches(&mut out.sessions[rep], &members);
        }
    }
    out
}

/// This game's sessions of the last `RECENT_GAME_DAYS` that were left out as possibly holding two games.
fn mixed_of(inp: &DiagnoseInputs, game: &str) -> Vec<String> {
    let Some(newest) = inp.sessions.iter().filter_map(SessionFacts::start).max() else { return Vec::new() };
    let cutoff = newest - chrono::Duration::days(RECENT_GAME_DAYS);
    let mut v: Vec<&SessionFacts> =
        inp.sessions.iter().filter(|s| s.mixed && same_game(&s.game, game) && s.start().is_some_and(|t| t >= cutoff)).collect();
    v.sort_by_key(|s| s.start());
    v.into_iter().map(|s| s.started_at.clone()).collect()
}

// ---- Entry points -----------------------------------------------------------------------------
/// The pure core. `game` is a process name. `None` judges every game played within `RECENT_GAME_DAYS`
/// of the newest session and answers for the most recently rough one; with none rough, for the game
/// played last. A game with too few sessions never hides another game's problem.
pub(crate) fn diagnose(inp: &DiagnoseInputs, complaint: Complaint, game: Option<&str>) -> Diagnosis {
    // A sitting's evidence from all its launches (see `with_sitting_evidence`).
    let merged = with_sitting_evidence(inp);
    let inp = &merged;
    if let Some(g) = game {
        return diagnose_game(inp, complaint, g);
    }
    let Some(newest) = inp.sessions.iter().filter(|s| !s.mixed).filter_map(SessionFacts::start).max() else {
        return Diagnosis::empty(complaint, DiagnosisState::CantTell { why: CantTellWhy::NoSessions });
    };
    let cutoff = newest - chrono::Duration::days(RECENT_GAME_DAYS);
    // Each recent game once (by its case-folded name), with when it was last played.
    let mut recent: BTreeMap<String, (DateTime<Utc>, String)> = BTreeMap::new();
    for s in inp.sessions.iter().filter(|s| !s.mixed) {
        let Some(t) = s.start().filter(|t| *t >= cutoff) else { continue };
        let e = recent.entry(s.game.trim().to_ascii_lowercase()).or_insert((t, s.game.clone()));
        if t > e.0 {
            *e = (t, s.game.clone());
        }
    }
    let mut played: Vec<(DateTime<Utc>, String)> = recent.into_values().collect();
    played.sort_by_key(|p| std::cmp::Reverse(p.0));
    let answers: Vec<Diagnosis> = played.iter().map(|(_, g)| diagnose_game(inp, complaint, g)).collect();
    // Which game the card answers for: a game still rough (an ongoing episode) first, then one whose
    // recovery is unclear, then one that recovered; among equals the one whose newest rough session is the
    // most recent. A game that recovered never hides a game that is still rough.
    let rank_at = |d: &Diagnosis| {
        let rank = match d.state {
            DiagnosisState::Found | DiagnosisState::CantTell { why: CantTellWhy::NothingChanged } => 3u8,
            DiagnosisState::CantTell { why: CantTellWhy::RecoveryUnclear { .. } } => 2,
            DiagnosisState::Recovered => 1,
            _ => return None,
        };
        d.problem.as_ref().and_then(|p| p.sessions_affected.iter().filter_map(|s| ts(&s.started_at)).max()).map(|t| (rank, t))
    };
    let pick = (0..answers.len()).filter_map(|i| rank_at(&answers[i]).map(|k| (k, i))).max().map(|(_, i)| i).unwrap_or(0);
    answers.into_iter().nth(pick).unwrap_or_else(|| Diagnosis::empty(complaint, DiagnosisState::CantTell { why: CantTellWhy::NoSessions }))
}

fn diagnose_game(inp: &DiagnoseInputs, complaint: Complaint, game_key: &str) -> Diagnosis {
    let game_key = game_key.to_string();
    let mut d = Diagnosis::empty(complaint, DiagnosisState::CantTell { why: CantTellWhy::NoSessions });
    d.game_name = Some(intelligence::pretty_game_name(&game_key));
    d.game = Some(game_key.clone());
    d.mixed_sessions = mixed_of(inp, &game_key);
    if complaint == Complaint::Crash {
        d.state = DiagnosisState::CantTell { why: CantTellWhy::CrashNotCovered };
        return d;
    }
    let sess = game_sessions(inp, &game_key);
    if sess.is_empty() {
        return d;
    }
    let judged = judge_game(&sess);
    let Some(newest) = (0..sess.len()).rev().find(|&i| judged[i].verdict != Verdict::Unjudged) else {
        d.state = partial_state(&sess, &judged, 0);
        return d;
    };
    match judged[newest].verdict {
        Verdict::CapChanged => {
            let before = (0..newest).rev().find(|&i| judged[i].verdict != Verdict::Unjudged).map_or(CapState::Unknown, |i| sess[i].cap);
            d.state = DiagnosisState::CantTell { why: CantTellWhy::FrameCapChanged };
            // A change is a finding only when both caps were read. An unread side leaves just the
            // "can't tell" answer, which already says Compy may not be able to read it.
            if before.known_change(sess[newest].cap) {
                d.findings.push(cap_finding(sess[newest], before));
            }
        }
        Verdict::NeedsMore(have) => {
            d.state = DiagnosisState::NeedsMorePlay {
                sessions_needed: BASELINE_MIN.saturating_sub(have) as u8,
                have: have.min(BASELINE_MIN) as u8,
            };
        }
        // F3: after an episode of rough sessions the next sessions say whether it is over.
        Verdict::Normal if recovery_answer(inp, &game_key, &sess, &judged, newest, &mut d) => {}
        // Sessions after the newest judged one went unjudged: "nothing wrong" would speak for a session
        // Compy never read, so it says so instead.
        Verdict::Normal if newest + 1 < sess.len() => d.state = partial_state(&sess, &judged, newest + 1),
        Verdict::Normal => {
            let mut n = 0u8;
            for i in (0..=newest).rev() {
                match judged[i].verdict {
                    Verdict::Unjudged => {}
                    Verdict::Normal => {
                        n += 1;
                        if n >= 5 {
                            break;
                        }
                    }
                    _ => break,
                }
            }
            d.state = DiagnosisState::NothingWrong { sessions_checked: n.max(1) };
        }
        Verdict::Fired => explain(inp, &game_key, &sess, &judged, newest, &mut d, None),
        Verdict::Unjudged => {}
    }
    d
}

/// F3: when the game's newest judged session ran normally but an episode of rough sessions came shortly
/// before it, answers "is it back to normal?" and returns true. Returns false when there is no recent
/// episode (the ordinary answers apply). The rough episode is explained as usual so the card still has
/// its numbers and candidates; a recovery additionally re-scores each candidate.
fn recovery_answer<'a>(
    inp: &'a DiagnoseInputs,
    game_key: &str,
    sess: &[&'a SessionFacts],
    judged: &'a [Judgement],
    newest: usize,
    d: &mut Diagnosis,
) -> bool {
    let Some(f) = (0..newest).rev().find(|&i| judged[i].verdict == Verdict::Fired) else { return false };
    let Some(outcome) = recovery::outcome(sess, judged, f, sess.len()) else { return false };
    match outcome {
        Outcome::Recovered { idx } => {
            explain(inp, game_key, sess, judged, f, d, Some(&idx));
            d.state = if d.recovery.is_some() {
                DiagnosisState::Recovered
            } else {
                DiagnosisState::CantTell { why: CantTellWhy::RecoveryUnclear { partial: false, one_clear: false, cap_changed: false } }
            };
        }
        Outcome::Unclear { partial, one_clear, cap_changed } => {
            explain(inp, game_key, sess, judged, f, d, None);
            d.state = DiagnosisState::CantTell { why: CantTellWhy::RecoveryUnclear { partial, one_clear, cap_changed } };
        }
    }
    true
}

/// "Partly measured": the sessions from `from` on were never judged. The percentage is the newest
/// session's, and `looked_rough` is whether any of them would have fired on the numbers it has.
fn partial_state(sess: &[&SessionFacts], judged: &[Judgement], from: usize) -> DiagnosisState {
    let pct = (sess[sess.len() - 1].coverage() * 100.0).round().clamp(0.0, 100.0) as u8;
    let looked_rough = (from..sess.len()).any(|i| judged[i].would_fire);
    DiagnosisState::CantTell { why: CantTellWhy::PartialMeasure { percent: pct, looked_rough } }
}

/// The frame cap changed between two sessions whose caps were both read.
fn cap_finding(now: &SessionFacts, before: CapState) -> Finding {
    Finding {
        id: "frame-cap-change",
        confidence: Certainty::Measured,
        evidence: vec![ev(EvidenceKind::Measured, "cap-changed", "sessions", false, &[("from", before.word()), ("to", now.cap.word())])],
        since_when: When::Seen { at: now.started_at.clone() },
        fix: steps("frame-cap-change", &[("from", before.word()), ("to", now.cap.word())]),
        in_play: false,
        now: None,
        now_evidence: Vec::new(),
    }
}

/// The Tauri edge. Reads the three stores it needs without writing to any (no ledger load, no
/// set-aside of a damaged file) and calls no apply path. A store that exists but cannot be read is an
/// error the card shows, never an empty history. Windows' own dated records (driver installs, updates,
/// the game's Steam files, installed programs) are read once, off the UI thread, within
/// `changes::CHANGES_BUDGET`; if they cannot be read in time the diagnosis stands with each kind Unknown.
#[tauri::command]
pub(crate) async fn paramedic_diagnose(complaint: Complaint, game: Option<String>) -> Result<Diagnosis, String> {
    // Single flight: while one diagnosis is running, another call gets BUSY (the card keeps saying "still
    // checking") instead of starting a second set of reader threads.
    let Some(flight) = FlightGuard::begin() else { return Err(BUSY.to_string()) };
    tauri::async_runtime::spawn_blocking(move || -> Result<Diagnosis, String> {
        let _flight = flight;
        let inp = read_inputs_from(&crate::compy_data_dir())?;
        let fetch = |t0, t1, exe: String| changes::read_real_changes(t0, t1, &exe);
        let fetch_mods = |exe: String, others: Vec<String>, budget: std::time::Duration| mods::read_real_mods(&exe, &others, budget);
        let fetch_crashes = |exe: String| extras::read_real_crashes(&exe);
        // A reader still running from an earlier press is not started again (that kind reads "took too long").
        static SLOTS: changes::Slots = changes::Slots::new();
        Ok(changes::diagnose_with_all(inp, complaint, game.as_deref(), changes::CHANGES_BUDGET, fetch, Some(fetch_mods), Some(fetch_crashes), Some(&SLOTS)))
    })
    .await
    .map_err(|_| "the diagnosis stopped unexpectedly".to_string())?
}

/// What `paramedic_diagnose` returns as its error while another call is still running. The card treats it as
/// "still checking", never as a failure.
pub(crate) const BUSY: &str = "paramedic-busy";

static IN_FLIGHT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Held for the whole of one diagnosis (including a panic or an early return); dropping it frees the slot.
pub(crate) struct FlightGuard(());

impl FlightGuard {
    pub(crate) fn begin() -> Option<FlightGuard> {
        use std::sync::atomic::Ordering;
        IN_FLIGHT.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).ok().map(|_| FlightGuard(()))
    }
}

impl Drop for FlightGuard {
    fn drop(&mut self) {
        IN_FLIGHT.store(false, std::sync::atomic::Ordering::Release);
    }
}

/// What the diagnosis reads, from a data directory: sessions, identity checks and drift notices. A file
/// that is not there is an empty store. A sessions file that is there and cannot be read or parsed is an
/// `Err` (the sessions ARE the diagnosis). The identity and drift stores only corroborate, so one that
/// cannot be read degrades to an unknown line for that source and the rest of the answer stands.
pub(crate) fn read_inputs_from(dir: &std::path::Path) -> Result<DiagnoseInputs, String> {
    let sessions = crate::sessions::read_sessions_readonly_from(&dir.join("sessions.json"))?;
    let snapshots = intelligence::read_snapshots_readonly_from(&dir.join("intelligence.json"));
    let notices = crate::drift::read_notices_readonly_from(&dir.join("drift.json"));
    let mut inp = inputs_from_parts(&sessions, snapshots.as_deref().unwrap_or(&[]), notices.as_deref().unwrap_or(&[]));
    inp.sightings_unread = snapshots.is_err();
    inp.drift_unread = notices.is_err();
    Ok(inp)
}

// ---- Adapters from what Compy records ----------------------------------------------------------
fn busy_program(label: &str) -> Option<String> {
    let name = label.trim().strip_suffix(" starting").unwrap_or(label.trim());
    let name = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(name).to_ascii_lowercase();
    BUSY_PROGRAMS.contains(&name.as_str()).then_some(name)
}

pub(crate) fn facts_from(s: &crate::sessions::SessionSummary) -> SessionFacts {
    let gs = s.game_state.as_ref();
    let fp = s.hw_fingerprint.as_ref();
    let driver = gs
        .and_then(|g| g.gpu_driver.clone())
        .or_else(|| fp.map(|f| f.gpu_driver.clone()))
        .filter(|d| !d.trim().is_empty());
    let mut busy_names: Vec<String> = Vec::new();
    let mut started_names: Vec<String> = Vec::new();
    let mut busy_starts = 0u32;
    let mut ram_events = 0u32;
    for e in &s.stutter_events {
        match e.kind.as_str() {
            "process-start" => {
                let label = e.label.trim();
                let label = label.strip_suffix(" starting").unwrap_or(label);
                let name = label.to_ascii_lowercase();
                let name = name.strip_suffix(".exe").unwrap_or(&name).to_string();
                if !name.is_empty() && !started_names.contains(&name) {
                    started_names.push(name);
                }
                if let Some(n) = busy_program(&e.label) {
                    busy_starts += 1;
                    if !busy_names.contains(&n) {
                        busy_names.push(n);
                    }
                }
            }
            "ram" => ram_events += 1,
            _ => {}
        }
    }
    SessionFacts {
        started_at: s.started_at.clone(),
        game: s.process_name.clone(),
        duration_secs: s.duration_secs,
        samples: s.samples,
        background_secs: s.background_secs_excluded.unwrap_or(0),
        avg_fps: s.avg_fps,
        low1_fps: s.low1_fps_est,
        p99_ms: s.frame_pacing.as_ref().map(|p| p.p99_ms),
        peak_ram_bytes: s.peak_ram_used_bytes,
        ram_total_bytes: s.ram_total_bytes,
        peak_gpu_temp_c: s.peak_gpu_temp_c,
        gpu_driver: driver,
        windows_build: gs.and_then(|g| g.windows_build.clone()),
        refresh_hz: gs.and_then(|g| g.display_refresh_hz),
        power_plan: gs.and_then(|g| g.power_plan_guid.clone()),
        rig: fp.map(|f| format!("{}|{}", f.gpu, f.ram_gb)),
        compy_changes: s.compy_changes_active,
        busy_starts,
        busy_names,
        started_names,
        ram_events,
        other_cpu_p90_pct: gs.and_then(|g| g.other_cpu).map(|o| f64::from(o.p90_pct_x10) / 10.0),
        other_gpu_3d_p90_pct: gs.and_then(|g| g.other_gpu_3d).map(|o| f64::from(o.p90_pct_x10) / 10.0),
        other_gpu_video_p90_pct: gs.and_then(|g| g.other_gpu_video).map(|o| f64::from(o.p90_pct_x10) / 10.0),
        other_cpu_mean_pct: gs.and_then(|g| g.other_cpu).map(|o| f64::from(o.mean_pct_x10) / 10.0),
        other_gpu_3d_mean_pct: gs.and_then(|g| g.other_gpu_3d).map(|o| f64::from(o.mean_pct_x10) / 10.0),
        other_gpu_video_mean_pct: gs.and_then(|g| g.other_gpu_video).map(|o| f64::from(o.mean_pct_x10) / 10.0),
        running_at_start: gs.and_then(|g| g.running_at_start.clone()),
        start_ticks_skipped: gs.and_then(|g| g.start_ticks_skipped),
        start_events_dropped: gs.and_then(|g| g.start_events_dropped),
        // No crash marks are passed: the engine reads none, read-only or otherwise, so the flag runs on the
        // session's own series (a row written by a build that holds one process identity is Clean without looking).
        mixed: matches!(crate::session_boundary::suspected_splice(s, &[]), crate::session_boundary::Splice::Suspected(_)),
        ended: s.ended,
        cap: match crate::noise_floor::cap_read(s) {
            crate::noise_floor::CapRead::Uncapped => CapState::Uncapped,
            crate::noise_floor::CapRead::Capped { at_fps } => CapState::Capped { at_fps },
            crate::noise_floor::CapRead::Unknown => CapState::Unknown,
        },
    }
}

fn inputs_from_parts(
    sessions: &[crate::sessions::SessionSummary],
    snapshots: &[intelligence::IdentitySnapshot],
    notices: &[crate::drift::DriftNotice],
) -> DiagnoseInputs {
    DiagnoseInputs {
        sessions: sessions.iter().map(facts_from).collect(),
        sightings: snapshots
            .iter()
            .map(|s| Sighting {
                observed_at: s.observed_at.clone(),
                gpu_driver: s.gpu_driver.clone(),
                power_plan: s.power_plan.clone(),
            })
            .collect(),
        drift: notices
            .iter()
            .map(|n| DriftFact { id: n.id.clone(), last_ready_at: n.last_ready_at.clone(), noticed_at: n.noticed_at.clone() })
            .collect(),
        sightings_unread: false,
        drift_unread: false,
        changes: ChangeRead::NotRead,
        mods: ModInput::default(),
        crashes: CrashRead::NotRead,
    }
}

// ---- A4/B: what changed before the first rough session, ranked ------------------------------
/// One other game's sessions with their walk-forward judgements.
struct OtherGame<'a> {
    name: String,
    sess: Vec<&'a SessionFacts>,
    judged: Vec<Judgement>,
}

fn other_games<'a>(inp: &'a DiagnoseInputs, game: &str) -> Vec<OtherGame<'a>> {
    let mut keys: BTreeMap<String, String> = BTreeMap::new();
    for s in inp.sessions.iter().filter(|s| !s.mixed) {
        if !same_game(&s.game, game) {
            keys.entry(s.game.trim().to_ascii_lowercase()).or_insert_with(|| s.game.clone());
        }
    }
    keys.into_values()
        .map(|raw| {
            let sess = game_sessions(inp, &raw);
            let judged = judge_game(&sess);
            OtherGame { name: intelligence::pretty_game_name(&raw), sess, judged }
        })
        .collect()
}

struct Ctx<'a> {
    inp: &'a DiagnoseInputs,
    base: Vec<&'a SessionFacts>,
    affected: Vec<&'a SessionFacts>,
    baseline_newest: &'a SessionFacts,
    /// The newest session judged Normal before the first rough one (the date the card calls "last ran
    /// normally"); it can be newer than the newest baseline session.
    last_normal: &'a SessionFacts,
    /// The newest session before the first rough one that was fully measured and ran close to the usual:
    /// the one the headline calls "last ran normally" (or "last fully measured normal session").
    last_full_normal: Option<&'a SessionFacts>,
    first_bad: &'a SessionFacts,
    win_start: DateTime<Utc>,
    win_end: DateTime<Utc>,
    others: Vec<OtherGame<'a>>,
    /// This game's sessions and verdicts, oldest first.
    sess: Vec<&'a SessionFacts>,
    judged: &'a [Judgement],
    /// This game's partly measured sessions after the last normal one that would have fired.
    partial: Vec<&'a SessionFacts>,
}

impl<'a> Ctx<'a> {
    /// When the sitting a session stands for began and ended (see sitting_span).
    fn span_of(&self, s: &SessionFacts) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>) {
        sitting_span(self.inp, s)
    }

    /// Sessions of any game, judged Normal, that started between the last normal session's end and the
    /// first rough one's start: they ran fine while whatever changed was already (or not yet) in place.
    fn normal_in_window(&self) -> Vec<&'a SessionFacts> {
        let inside = |s: &SessionFacts| s.start().is_some_and(|t| t >= self.win_start && t < self.win_end);
        let mut v: Vec<&'a SessionFacts> = Vec::new();
        for (s, j) in self.sess.iter().zip(self.judged) {
            if j.verdict == Verdict::Normal && inside(s) {
                v.push(s);
            }
        }
        for o in &self.others {
            for (s, j) in o.sess.iter().zip(&o.judged) {
                if j.verdict == Verdict::Normal && inside(s) {
                    v.push(s);
                }
            }
        }
        v
    }
}

/// A change candidate with the named supports and contradictions of design B.
struct Cand {
    id: &'static str,
    /// T: it happened inside the window (or a rough session itself carries it).
    t: bool,
    /// D: the value differs on the per-session records themselves.
    d: bool,
    /// X: another game got rough after the same change and never before it.
    x: bool,
    /// X is not independent: that game's rough sessions overlap recorded background activity or have no
    /// load numbers, so whatever slowed them may be the same thing that slowed this game.
    confounded: bool,
    /// M: a measured size past its fixed line.
    m: bool,
    /// R (F3): the sessions after the episode recovered in a way that supports this candidate (the driver
    /// changed again, the PC was quiet). Independent of the timing: it is a later observation. It orders
    /// candidates; it counts as a support (toward Likely) only for the background finding, where it is a
    /// measured recovery of the same load figure (see `independent`).
    r: bool,
    /// C1: a rough session where this change was absent or below its line (or, F3, the recovered
    /// session still had it).
    c1: bool,
    since: When,
    fix: Fix,
    evidence: Vec<Evidence>,
}

impl Cand {
    fn certainty(&self) -> Option<Certainty> {
        if !self.t {
            // A size with no timing (a full memory, a busy PC) is a Possible at best: nothing says it
            // changed before the problem. A graphics mod in the folder with no timing is listed the same way
            // ("Also possible"): the files are there, nothing dates them to the period.
            return (self.m || self.id == "graphics-mod").then_some(Certainty::Possible);
        }
        // Likely needs two independent supports and nothing against it. A changed per-session stamp and
        // the timing that follows from it are ONE support; another game's roughness counts only when it
        // is not confounded.
        Some(if self.independent() >= 2 && !self.c1 { Certainty::Likely } else { Certainty::Possible })
    }

    fn independent(&self) -> usize {
        // F3 review: for every finding but the background one a recovery observation (`r`) is NOT a support:
        // it orders candidates (`supports`), but no path to Likely exists that did not exist before the
        // recovery slice. The background finding is the one exception, below.
        if self.id == "background-load" {
            // Program starts (`d`) and a measured high load (`m`) are the same fact seen twice, so `d` never
            // counts here. The second, independent line is a measured recovery of the same kind (`r`) or
            // another game's own measured contrast (`x`, not confounded).
            return usize::from(self.m) + usize::from(self.r || (self.x && !self.confounded));
        }
        usize::from(self.d) + usize::from(self.x && !self.confounded) + usize::from(self.m)
    }

    /// Possible, with timing, and nothing against it.
    fn in_play(&self) -> bool {
        self.t && !self.c1 && self.certainty() == Some(Certainty::Possible)
    }

    fn supports(&self) -> usize {
        usize::from(self.d) + usize::from(self.x) + usize::from(self.m) + usize::from(self.r) + usize::from(self.t)
    }
}

#[derive(Default)]
struct Out {
    cands: Vec<Cand>,
    not_it: Vec<RuledOut>,
    unknowns: Vec<&'static str>,
    seen: Vec<RuledOut>,
}

impl Out {
    fn see(&mut self, id: &'static str, args: &[(&'static str, String)]) {
        self.seen.push(RuledOut { id, args: args.iter().cloned().collect() });
    }

    fn ruled_out(&mut self, id: &'static str, args: &[(&'static str, String)]) {
        self.not_it.push(RuledOut { id, args: args.iter().cloned().collect() });
    }

    fn unknown(&mut self, code: &'static str) {
        if !self.unknowns.contains(&code) {
            self.unknowns.push(code);
        }
    }
}

/// Fixed category order for ties (design B): known large effect on frame pacing first.
fn category(id: &str) -> usize {
    const ORDER: &[&str] = &[
        "hardware-change",
        "background-load",
        "gpu-driver-change",
        "memory-pressure",
        "gpu-hotter",
        "display-refresh-lower",
        "power-plan-change",
        "compy-change",
        "setting-drift",
        "windows-build-change",
        "game-files-change",
        "windows-update",
        "program-installed",
        "other-driver-change",
        "graphics-mod",
    ];
    ORDER.iter().position(|x| *x == id).unwrap_or(ORDER.len())
}

fn explain<'a>(
    inp: &'a DiagnoseInputs,
    game_key: &str,
    sess: &[&'a SessionFacts],
    judged: &'a [Judgement],
    newest: usize,
    d: &mut Diagnosis,
    // F3: the sessions (indexes) that ran normally after this episode. With them, each candidate is
    // re-scored against the recovery and `d.recovery` is set.
    recovered: Option<&[usize]>,
) {
    let mut run = vec![newest];
    for i in (0..newest).rev() {
        match judged[i].verdict {
            Verdict::Unjudged => {}
            Verdict::Fired => run.push(i),
            _ => break,
        }
    }
    run.reverse();
    let first = run[0];
    let Some(base) = judged[first].base.as_ref().filter(|b| !b.ids.is_empty()) else {
        return;
    };
    let base_sess: Vec<&SessionFacts> = base.ids.iter().map(|&i| sess[i]).collect();
    let affected: Vec<&SessionFacts> = run.iter().map(|&i| sess[i]).collect();
    let (baseline_newest, first_bad) = (base_sess[base_sess.len() - 1], sess[first]);
    let (Some(win_start), Some(win_end)) = (sitting_span(inp, baseline_newest).1, first_bad.start()) else {
        return;
    };
    let others = other_games(inp, game_key);
    let affected_others: Vec<String> = others
        .iter()
        .filter(|o| (0..o.sess.len()).any(|j| o.judged[j].verdict == Verdict::Fired && o.sess[j].start().is_some_and(|t| t >= win_start)))
        .map(|o| o.name.clone())
        .collect();
    let evals: Vec<Option<Eval>> = run.iter().map(|&i| judged[i].eval).collect();
    let n = affected.len() as f64;
    let ratio_now = affected.iter().filter_map(|s| s.ratio()).sum::<f64>() / n;
    let avg_now = affected.iter().map(|s| s.avg_fps).sum::<f64>() / n;
    let last_base = base.ids[base.ids.len() - 1];
    let partial_facts: Vec<&SessionFacts> = ((last_base + 1)..sess.len())
        .filter(|&i| judged[i].verdict == Verdict::Unjudged && judged[i].would_fire)
        .map(|i| sess[i])
        .collect();
    let partial: Vec<SessionRef> = partial_facts.iter().map(|s| s.session_ref()).collect();
    // "It last ran normally": the newest session judged Normal before the first rough one, which can be
    // newer than the newest baseline session (a thinly measured session is Normal but not a baseline).
    let last_normal: &SessionFacts = (0..first).rev().find(|&i| judged[i].verdict == Verdict::Normal).map_or(baseline_newest, |i| sess[i]);
    let last_normal_at = last_normal.started_at.clone();
    // The newest earlier session that was fully measured and ran close to the game's usual: the date the
    // card may call "last ran normally" without leaning on an idle or thinly measured session.
    let last_full_normal: Option<&SessionFacts> = (0..first)
        .rev()
        .find(|&i| {
            judged[i].verdict == Verdict::Normal
                && sess[i].coverage() >= BASELINE_COVERAGE
                && sess[i].ratio().is_some_and(|r| r >= recovery::RECOVERY_R_FRACTION * base.med_r)
        })
        .map(|i| sess[i]);
    let last_full_normal_at = last_full_normal.map(|s| s.started_at.clone());
    d.problem = Some(ProblemReading {
        rule: if evals.iter().flatten().any(|e| e.rule_r) { AnomalyRule::StutterCollapse } else { AnomalyRule::Spikes },
        spikes: evals.iter().flatten().any(|e| e.rule_p99),
        avg_lower: avg_now <= RULE_AVG_FRACTION * base.med_avg,
        before: Metric { ratio: base.med_r, p99_ms: base.med_p99, avg_fps: base.med_avg },
        now: Metric { ratio: ratio_now, p99_ms: affected.iter().filter_map(|s| s.p99_ms).reduce(f64::max), avg_fps: avg_now },
        last_normal_at,
        last_full_normal_at,
        sessions_affected: affected.iter().map(|s| s.session_ref()).collect(),
        partial_sessions: partial,
        other_games_affected: affected_others,
        later_unjudged: ((newest + 1)..sess.len()).filter(|&i| judged[i].verdict == Verdict::Unjudged).count().min(u8::MAX as usize) as u8,
    });
    // A new episode after an earlier one that recovered is a new episode: one line says so.
    if recovered.is_none() {
        d.earlier_episode = recovery::earlier_episode(sess, judged, first);
    }
    d.baseline = Some(baseline_newest.session_ref());
    d.first_bad = Some(first_bad.session_ref());
    let ctx = Ctx {
        inp,
        base: base_sess,
        affected,
        baseline_newest,
        last_normal,
        last_full_normal,
        first_bad,
        win_start,
        win_end,
        others,
        sess: sess.to_vec(),
        judged,
        partial: partial_facts,
    };
    let mut out = Out::default();
    detect_hardware(&ctx, &mut out);
    detect_driver(&ctx, &mut out);
    detect_background(&ctx, &mut out);
    detect_memory(&ctx, &mut out);
    detect_compy_changes(&ctx, &mut out);
    detect_setting_drift(&ctx, &mut out);
    detect_power_plan(&ctx, &mut out);
    detect_display(&ctx, &mut out);
    detect_windows(&ctx, &mut out);
    changes::detect_windows_update(&ctx, &mut out);
    changes::detect_game_files(&ctx, &mut out);
    changes::detect_programs(&ctx, &mut out);
    // Last: it is a candidate only when nothing above explains the timing.
    changes::detect_other_drivers(&ctx, &mut out);
    // Files in the game's own folder: a candidate only for a mod's own loader, never an all-clear when unread.
    mods::detect(&ctx, &mut out);
    extras::detect_temperature(&ctx, &mut out);
    // After every candidate: the crash line compares the crashes' dates with the earliest dated one.
    extras::detect_crashes(&ctx, &mut out);
    start_unknowns(&ctx, &mut out);
    start_listing_note(&ctx, &mut out);
    sitting_note(&ctx, &mut out);
    d.limits = changes::limits(&ctx);
    if inp.drift_unread {
        out.unknown("drift-unreadable");
    }
    if inp.sightings_unread {
        out.unknown("identity-unreadable");
    }
    // F3: the recovery re-scores each candidate (a support or a contradiction) before the ranking.
    let now_lines: Vec<NowLine> = match recovered {
        Some(idx) => {
            let rec: Vec<&SessionFacts> = idx.iter().map(|&i| sess[i]).collect();
            // A change to the game's files between the rough sessions and the normal ones is a candidate
            // in its own right (the Steam manifest keeps only the newest change).
            recovery::gap_candidates(&ctx, &rec, &mut out.cands);
            recovery::apply(&ctx, &rec, &mut out.cands)
        }
        None => Vec::new(),
    };
    rank(&mut out.cands);
    d.why_first = why_first(&out.cands);
    let mut now_by_id: BTreeMap<&'static str, NowLine> = now_lines.into_iter().map(|l| (l.id, l)).collect();
    d.findings = out
        .cands
        .into_iter()
        .filter_map(|c| {
            let confidence = c.certainty()?;
            let in_play = c.in_play();
            let line = now_by_id.remove(c.id);
            let (now, now_evidence) = match line {
                Some(l) => (Some(l.status), l.evidence),
                None => (None, Vec::new()),
            };
            Some(Finding { id: c.id, confidence, evidence: c.evidence, since_when: c.since, fix: c.fix, in_play, now, now_evidence })
        })
        .collect();
    if let Some(idx) = recovered {
        let rec: Vec<&SessionFacts> = idx.iter().map(|&i| sess[i]).collect();
        recovery::settle(&ctx, &rec, &mut d.findings);
        let since = ((newest + 1)..sess.len()).filter(|&i| judged[i].verdict != Verdict::Unjudged).count();
        d.recovery = recovery::build_block(&ctx, &rec, d, since);
    }
    d.not_it = out.not_it;
    d.seen = out.seen;
    d.unknowns = out.unknowns;
    d.state = if d.findings.is_empty() {
        DiagnosisState::CantTell { why: CantTellWhy::NothingChanged }
    } else {
        DiagnosisState::Found
    };
}

/// Likely first (fixed category order breaks ties), then the changes in play (Possible, with timing,
/// nothing against), then the rest. Within the last two, more supports first, then the category order.
const TIMING_ONLY_SOURCES: &[&str] = &["windows-update", "game-files-change", "program-installed", "other-driver-change", "graphics-mod"];

fn rank(c: &mut Vec<Cand>) {
    c.retain(|x| x.certainty().is_some());
    let class = |x: &Cand| match x.certainty() {
        Some(Certainty::Likely) => 0,
        _ if x.in_play() => 1,
        _ => 2,
    };
    // A candidate whose only support is timing from the dated readers never ranks above one that has any
    // other support: it leads only when nothing better-evidenced is in play.
    let timing_only = |x: &Cand| class(x) != 0 && x.t && !x.d && !x.x && !x.m && TIMING_ONLY_SOURCES.contains(&x.id);
    c.sort_by(|a, b| {
        let by_class = timing_only(a).cmp(&timing_only(b)).then(class(a).cmp(&class(b)));
        if class(a) == 0 {
            by_class.then(category(a.id).cmp(&category(b.id)))
        } else {
            by_class.then(b.supports().cmp(&a.supports())).then(category(a.id).cmp(&category(b.id)))
        }
    });
    // Background programs seen only in a partly measured session or another game's rough session (none in
    // this game's fully measured rough ones) are a weaker support than a measured driver change: they never
    // rank above the driver.
    // A recorded high load figure is a measurement of this game's own rough sessions, so it is not weak.
    let weak_background = |x: &Cand| {
        x.id == "background-load" && !x.evidence.iter().any(|e| e.code == "starts-seen" || (e.code.starts_with("load-") && e.args.get("how").is_some_and(|h| h == "high")))
    };
    if let (Some(bg), Some(drv)) = (c.iter().position(weak_background), c.iter().position(|x| x.id == "gpu-driver-change")) {
        if bg < drv {
            let cand = c.remove(bg);
            c.insert(drv, cand);
        }
    }
    // A hotter reading is one measured size with no date: it ranks with the other sizes (after memory-pressure
    // in the category order) but never above a change that is dated, even one that only has its timing.
    if let (Some(h), Some(last_dated)) = (c.iter().position(|x| x.id == "gpu-hotter"), c.iter().rposition(|x| x.t)) {
        if h < last_dated {
            let cand = c.remove(h);
            c.insert(last_dated, cand);
        }
    }
}

fn why_first(c: &[Cand]) -> Option<&'static str> {
    let top = c.first()?;
    let likely = |x: &Cand| x.certainty() == Some(Certainty::Likely);
    if likely(top) {
        if c.get(1).is_some_and(likely) {
            return Some("tie");
        }
        // "The other changes don't line up" is said only when every runner-up is contradicted or has no timing.
        if top.x && !top.confounded {
            let others_out = c[1..].iter().all(|r| r.c1 || !r.t);
            return Some(if others_out { "cross-game" } else { "cross-game-lead" });
        }
        return None;
    }
    (c.iter().filter(|x| x.in_play()).count() >= 2).then_some("not-separable")
}

// ---- Detectors: each reads what Compy recorded and adds a candidate, a ruled-out line or an unknown.
fn no_safe_change() -> Fix {
    Fix::None { code: "no-safe-change" }
}

fn steps(code: &'static str, args: &[(&'static str, String)]) -> Fix {
    Fix::Steps { code, args: args.iter().cloned().collect() }
}

/// Between the last normal session's end and the first rough session's start.
fn whole_window(c: &Ctx) -> When {
    When::ObservedBetween { from: iso(c.win_start), to: iso(c.win_end) }
}

fn changed(from: &str, to: &str) -> Evidence {
    ev(EvidenceKind::Known, "value-changed", "sessions", false, &[("from", from.to_string()), ("to", to.to_string())])
}

fn detect_hardware(c: &Ctx, out: &mut Out) {
    let before = c.base.iter().rev().find_map(|s| nonblank(&s.rig));
    match (before, nonblank(&c.first_bad.rig)) {
        (Some(b), Some(a)) if b != a => out.cands.push(Cand {
            id: "hardware-change",
            t: true,
            d: true,
            x: false,
            confounded: false,
            r: false,
            m: false,
            c1: c.affected.iter().any(|s| nonblank(&s.rig) == Some(b)),
            since: whole_window(c),
            fix: no_safe_change(),
            evidence: vec![ev(EvidenceKind::Known, "hardware-changed", "sessions", false, &[])],
        }),
        (Some(_), Some(_)) => out.ruled_out("hardware-change", &[]),
        _ => out.unknown("hardware"),
    }
}

fn detect_driver(c: &Ctx, out: &mut Out) {
    let from = c.base.iter().rev().find_map(|s| nonblank(&s.gpu_driver));
    let (Some(from), Some(to)) = (from, nonblank(&c.first_bad.gpu_driver)) else {
        out.unknown("gpu-driver");
        // The sessions say nothing about the driver, but Windows may have dated an install.
        changes::windows_only_driver(c, out);
        return;
    };
    if !crate::hardware::driver_changed(from, to) {
        let mut args = vec![("driver", to.to_string())];
        args.extend(changes::driver_unchanged_args(c));
        out.ruled_out("gpu-driver-change", &args);
        changes::driver_same_stamp_note(c, out);
        return;
    }
    let on = |s: &SessionFacts, v: &str| nonblank(&s.gpu_driver).is_some_and(|x| crate::hardware::same_driver(x, v));
    // When the new driver was first seen (a session or an identity check), and the last time the old one was.
    let first_new = c
        .inp
        .sessions
        .iter()
        .filter(|s| on(s, to))
        .filter_map(|s| s.start())
        .chain(c.inp.sightings.iter().filter(|g| crate::hardware::same_driver(&g.gpu_driver, to)).filter_map(|g| ts(&g.observed_at)))
        .filter(|t| *t >= c.win_start)
        .min()
        .unwrap_or(c.win_end);
    let last_old = c
        .inp
        .sessions
        .iter()
        .filter(|s| on(s, from))
        .filter_map(|s| s.end())
        .chain(c.inp.sightings.iter().filter(|g| crate::hardware::same_driver(&g.gpu_driver, from)).filter_map(|g| ts(&g.observed_at)))
        .filter(|t| *t <= first_new)
        .max()
        .unwrap_or(c.win_start);
    let rough_on_old = c.affected.iter().filter(|s| on(s, from)).count();
    let first_rough_of = |o: &OtherGame| {
        (0..o.sess.len()).find(|&j| {
            o.judged[j].verdict == Verdict::Fired && o.sess[j].start().is_some_and(|t| t >= c.win_start) && on(o.sess[j], to)
        })
    };
    let x_others: Vec<&OtherGame> = c
        .others
        .iter()
        .filter(|o| {
            first_rough_of(o).is_some_and(|f| {
                o.judged[..f].iter().all(|j| j.verdict != Verdict::Fired)
                    && o.judged[..f].iter().any(|j| j.verdict == Verdict::Normal)
                    // It must not have run normally on the new driver first: that is a game the change spared.
                    && !(0..f).any(|j| {
                        o.judged[j].verdict == Verdict::Normal && o.sess[j].start().is_some_and(|t| t >= c.win_start) && on(o.sess[j], to)
                    })
            })
        })
        .collect();
    // "Never before it" is said only if EVERY earlier session of that game was judged Normal. The first
    // sessions of a game have nothing to be compared with yet (`NeedsMore`) but, measured well enough to
    // be a baseline, they ARE the baseline: they count. An unjudged, thin, partly measured or
    // frame-cap-changed earlier session leaves the sentence unsaid.
    let never_before = x_others.iter().all(|o| {
        first_rough_of(o).is_some_and(|f| {
            (0..f).all(|j| match o.judged[j].verdict {
                Verdict::Normal => true,
                Verdict::NeedsMore(_) => o.sess[j].coverage() >= BASELINE_COVERAGE,
                _ => false,
            })
        })
    });
    let x_games: Vec<String> = x_others.iter().map(|o| o.name.clone()).collect();
    let mod_other = mods::other_game_mods(c, &x_games);
    // A cited game whose folder was not checked for mods (when mods were asked for at all) cannot be called
    // clean: its support stays confounded, and the card says so.
    let mod_unchecked = mods::other_game_unchecked(c, &x_games);
    // Independent only if one of those games' rough sessions was measured quiet: none overlapping recorded
    // background activity, and every one with a load number. Otherwise the same busy PC may explain both.
    let x_clean = x_others.iter().any(|o| {
        (0..o.sess.len())
            .filter(|&j| o.judged[j].verdict == Verdict::Fired && o.sess[j].start().is_some_and(|t| t >= c.win_start))
            .all(|j| {
                let s = o.sess[j];
                // Every recorded load figure under its kind's busy line: a busy PC in the other game's rough
                // sessions may explain both games (the background finding owns that explanation).
                s.busy_starts < BUSY_START_MIN
                    && s.other_cpu_p90_pct.is_some()
                    && LOAD_KINDS.iter().all(|k| k.read(s).is_none_or(|v| tenths(v) < tenths(k.busy_pct())))
            })
    });
    // Sessions that ran normally on the new driver (any game, between the last normal session and the first
    // rough one), however thinly measured, weigh against it.
    let normal_new: Vec<&SessionFacts> = c.normal_in_window().into_iter().filter(|s| on(s, to)).collect();
    let partial_old: Vec<&&SessionFacts> = c.partial.iter().filter(|s| on(s, from)).collect();
    let mut evidence = vec![changed(from, to)];
    evidence[0].code = "driver-changed";
    if rough_on_old == 0 {
        // "The last normal session used the old driver": said only of the very session the card calls the
        // last normal one, and only if it did run on the old driver (else the normal-on-new-driver line
        // below says what it is).
        // The session named is the one the headline names. If the only normal session on the old driver is a
        // thin one, it is labelled as partly measured instead.
        if let Some(full) = c.last_full_normal.filter(|s| on(s, from)) {
            evidence.push(ev(
                EvidenceKind::Measured,
                "sessions-split",
                "sessions",
                false,
                &[("baselineAt", full.started_at.clone()), ("count", c.affected.len().to_string())],
            ));
        } else if on(c.last_normal, from) {
            evidence.push(ev(
                EvidenceKind::Measured,
                "sessions-split-partly",
                "sessions",
                false,
                &[("baselineAt", c.last_normal.started_at.clone()), ("count", c.affected.len().to_string())],
            ));
        }
    } else {
        evidence.push(ev(EvidenceKind::Measured, "rough-on-old-driver", "sessions", true, &[("count", rough_on_old.to_string())]));
    }
    if !x_games.is_empty() {
        evidence.push(ev(
            EvidenceKind::Measured,
            "cross-game",
            "sessions",
            false,
            &[("games", x_games.join(", ")), ("neverBefore", never_before.to_string())],
        ));
        if !x_clean {
            evidence.push(ev(EvidenceKind::Unknown, "cross-game-confounded", "sessions", false, &[("games", x_games.join(", "))]));
        }
        // That game's own folder holds graphics-mod files (a mod's loader, or only its settings or data): its
        // rough sessions may have their own reason, so they are not independent support for a system-wide cause.
        for (other, name) in &mod_other {
            evidence.push(ev(
                EvidenceKind::Known,
                "cross-game-mod",
                "game-folder",
                false,
                &[("otherGame", other.clone()), ("name", (*name).to_string())],
            ));
        }
        for other in &mod_unchecked {
            evidence.push(ev(EvidenceKind::Unknown, "cross-game-mod-unchecked", "game-folder", false, &[("otherGame", other.clone())]));
        }
    }
    if let Some(newest_ok) = normal_new.iter().max_by_key(|s| s.start()) {
        evidence.push(ev(
            EvidenceKind::Measured,
            "normal-on-new-driver",
            "sessions",
            true,
            &[("count", normal_new.len().to_string()), ("lastAt", newest_ok.started_at.clone())],
        ));
    }
    if let Some(p) = partial_old.first() {
        // A partly measured session never counts alone: shown as a neutral line, it sets no contradiction.
        evidence.push(ev(
            EvidenceKind::Measured,
            "partial-rough-on-old-driver",
            "sessions",
            false,
            &[("date", p.started_at.clone()), ("count", partial_old.len().to_string())],
        ));
    }
    // Windows' own record of the install. It is the same fact as the sessions' stamps (it dates it), so it
    // never adds an independent support: `d` stays the one support for "the driver changed".
    let record = changes::driver_record(c, Some(to), first_new, out);
    let (exact, after_rough) = (record.exact, record.after_rough);
    evidence.extend(record.evidence);
    out.cands.push(Cand {
        id: "gpu-driver-change",
        t: true,
        d: true,
        x: !x_games.is_empty(),
        confounded: !x_games.is_empty() && (!x_clean || !mod_other.is_empty() || !mod_unchecked.is_empty()),
        r: false,
        m: false,
        c1: rough_on_old > 0 || !normal_new.is_empty() || after_rough,
        since: match exact {
            Some(at) => When::Exact { at: iso(at) },
            None => When::ObservedBetween { from: iso(last_old), to: iso(first_new) },
        },
        fix: steps("gpu-driver-change", &[("from", from.to_string()), ("to", to.to_string())]),
        evidence,
    });
}

/// Adds a session that saw busy-program starts, once.
fn note_busy<'s>(s: &'s SessionFacts, seen: &mut Vec<&'s SessionFacts>) {
    if s.busy_starts >= BUSY_START_MIN && !seen.iter().any(|x| x.started_at == s.started_at && x.game == s.game) {
        seen.push(s);
    }
}

/// Which recorded figure of "everything except the game" a line is about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LoadKind {
    Cpu,
    Gpu3d,
    GpuVideo,
}

const LOAD_KINDS: [LoadKind; 3] = [LoadKind::Cpu, LoadKind::Gpu3d, LoadKind::GpuVideo];

impl LoadKind {
    fn code(self) -> &'static str {
        match self {
            LoadKind::Cpu => "load-cpu",
            LoadKind::Gpu3d => "load-gpu3d",
            LoadKind::GpuVideo => "load-gpuvideo",
        }
    }

    fn busy_pct(self) -> f64 {
        match self {
            LoadKind::Cpu => OTHER_CPU_P90_PCT,
            LoadKind::Gpu3d => OTHER_GPU_3D_P90_PCT,
            LoadKind::GpuVideo => OTHER_GPU_VIDEO_P90_PCT,
        }
    }

    fn rise_pts(self) -> f64 {
        match self {
            LoadKind::Cpu | LoadKind::Gpu3d => LOAD_RISE_PTS,
            LoadKind::GpuVideo => LOAD_VIDEO_RISE_PTS,
        }
    }

    fn read(self, s: &SessionFacts) -> Option<f64> {
        match self {
            LoadKind::Cpu => s.other_cpu_p90_pct,
            LoadKind::Gpu3d => s.other_gpu_3d_p90_pct,
            LoadKind::GpuVideo => s.other_gpu_video_p90_pct,
        }
    }

    fn read_mean(self, s: &SessionFacts) -> Option<f64> {
        match self {
            LoadKind::Cpu => s.other_cpu_mean_pct,
            LoadKind::Gpu3d => s.other_gpu_3d_mean_pct,
            LoadKind::GpuVideo => s.other_gpu_video_mean_pct,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LoadHow {
    /// Counts as support (one independent measurement).
    High,
    /// Counts against: about the same as in the normal sessions.
    Same,
    /// Shown with its numbers, counted neither way.
    Between,
}

/// A percentage in tenths, so the two sides of a line are compared as whole numbers.
fn tenths(x: f64) -> i64 {
    (x * 10.0).round() as i64
}

/// One rough figure against the normal sessions' median, for one kind (see the constants' docs).
fn classify_load(kind: LoadKind, rough: f64, base: f64) -> LoadHow {
    let (r, b) = (tenths(rough), tenths(base));
    let (busy, rise, same) = (tenths(kind.busy_pct()), tenths(kind.rise_pts()), tenths(LOAD_SAME_PTS));
    if r >= busy && r - b >= rise && b < busy {
        LoadHow::High
    } else if r < busy && (r - b).abs() <= same {
        LoadHow::Same
    } else {
        LoadHow::Between
    }
}

/// What the recorded figures say about one kind, for the rough sessions and the baseline sessions.
#[derive(Clone, Copy, Debug, PartialEq)]
enum LoadState {
    /// Every rough session and at least `LOAD_BASELINE_MIN` baseline sessions have the figure. `rough` is the
    /// HIGHEST rough figure (the one shown). `High` also needs every recorded normal figure under the busy line:
    /// with a busy normal session in the mix the rise is not a rise over "usual", and it reads as in between.
    /// `mean_same` says the sessions' means agree with their p90s about "the same as usual" (a p90 cannot see a
    /// burst shorter than a tenth of the session).
    Compared { how: LoadHow, rough: f64, base: f64, mean_same: bool },
    /// Every rough session has it; too few normal sessions do.
    RoughOnly { rough: f64 },
    /// Enough normal sessions have it; not every rough session does.
    BaseOnly { base: f64 },
    Neither,
}

fn load_state(c: &Ctx, kind: LoadKind) -> LoadState {
    let rough_all: Vec<Option<f64>> = c.affected.iter().map(|s| kind.read(s)).collect();
    let mut rough: Vec<f64> = rough_all.iter().flatten().copied().collect();
    let rough_ok = !rough_all.is_empty() && rough.len() == rough_all.len();
    let mut base: Vec<f64> = c.base.iter().filter_map(|s| kind.read(s)).collect();
    let base_ok = base.len() >= LOAD_BASELINE_MIN;
    match (rough_ok, base_ok) {
        (true, true) => {
            let clean = base.iter().all(|x| tenths(*x) < tenths(kind.busy_pct()));
            let b = median(&mut base.clone());
            let hows: Vec<LoadHow> = rough.iter().map(|r| classify_load(kind, *r, b)).collect();
            let mut how = if hows.iter().all(|h| *h == LoadHow::High) {
                LoadHow::High
            } else if hows.iter().all(|h| *h == LoadHow::Same) {
                LoadHow::Same
            } else {
                LoadHow::Between
            };
            if how == LoadHow::High && !clean {
                how = LoadHow::Between;
            }
            let shown = rough.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            let mean_same = how == LoadHow::Same && {
                let rough_means: Vec<Option<f64>> = c.affected.iter().map(|s| kind.read_mean(s)).collect();
                let mut base_means: Vec<f64> = c.base.iter().filter_map(|s| kind.read_mean(s)).collect();
                rough_means.iter().all(Option::is_some) && base_means.len() >= LOAD_BASELINE_MIN && {
                    let top = rough_means.iter().flatten().copied().fold(f64::NEG_INFINITY, f64::max);
                    (tenths(top) - tenths(median(&mut base_means))).abs() <= tenths(LOAD_SAME_PTS)
                }
            };
            LoadState::Compared { how, rough: shown, base: b, mean_same }
        }
        (true, false) => LoadState::RoughOnly { rough: median(&mut rough) },
        (false, true) => LoadState::BaseOnly { base: median(&mut base) },
        (false, false) => LoadState::Neither,
    }
}

fn how_word(h: LoadHow) -> &'static str {
    match h {
        LoadHow::High => "high",
        LoadHow::Same => "same",
        LoadHow::Between => "between",
    }
}

/// Another game with its own measured contrast in the same kind: its rough sessions since the window opened are
/// every one High against at least `LOAD_BASELINE_MIN` of its own normal sessions that all ran under the busy line.
fn other_game_contrast(c: &Ctx, kind: LoadKind) -> bool {
    c.others.iter().any(|o| {
        let rough: Vec<&SessionFacts> = o
            .sess
            .iter()
            .copied()
            .zip(&o.judged)
            .filter(|(s, j)| j.would_fire && s.start().is_some_and(|t| t >= c.win_start))
            .map(|(s, _)| s)
            .collect();
        let Some(first) = rough.iter().filter_map(|s| s.start()).min() else { return false };
        let figs: Vec<f64> = rough.iter().filter_map(|s| kind.read(s)).collect();
        if figs.len() != rough.len() {
            return false;
        }
        let mut normal: Vec<f64> = o
            .sess
            .iter()
            .copied()
            .zip(&o.judged)
            .filter(|(s, j)| matches!(j.verdict, Verdict::Normal | Verdict::NeedsMore(_)) && s.start().is_some_and(|t| t < first))
            .filter_map(|(s, _)| kind.read(s))
            .collect();
        if normal.len() < LOAD_BASELINE_MIN || normal.iter().any(|x| tenths(*x) >= tenths(kind.busy_pct())) {
            return false;
        }
        let b = median(&mut normal);
        figs.iter().all(|r| classify_load(kind, *r, b) == LoadHow::High)
    })
}

/// A later session that ran normally with the same kind's figure recorded and back within the normal band:
/// the recovery is measured on both sides.
fn load_recovered(c: &Ctx, kind: LoadKind, base: f64) -> bool {
    let Some(last) = c.affected.iter().filter_map(|s| s.start()).max() else { return false };
    // Only one of the two newest judged sessions counts (the rule a recovery itself follows): an older
    // normal session followed by newer judged ones says nothing about how the PC is now.
    let mut newest: Vec<usize> = (0..c.sess.len()).filter(|&i| c.judged[i].verdict != Verdict::Unjudged).collect();
    newest.reverse();
    newest.truncate(2);
    newest.into_iter().any(|i| {
        let (s, j) = (c.sess[i], &c.judged[i]);
        j.verdict == Verdict::Normal && s.start().is_some_and(|t| t > last) && kind.read(s).is_some_and(|v| classify_load(kind, v, base) == LoadHow::Same)
    })
}

fn pct_word(x: f64) -> String {
    format!("{}", x.round() as i64)
}

/// The evidence line for one kind, or `None` when neither side recorded it. `how` says which sentence the card
/// uses; only `high` supports and only `same` weakens.
fn load_evidence(kind: LoadKind, st: LoadState, rough_sessions: usize, against_same: bool) -> Option<Evidence> {
    let line = |how: &str, against: bool, args: &[(&'static str, String)]| {
        let mut a: Vec<(&'static str, String)> = vec![("how", how.to_string()), ("count", rough_sessions.to_string())];
        a.extend(args.iter().cloned());
        ev(EvidenceKind::Measured, kind.code(), "sessions", against, &a)
    };
    match st {
        LoadState::Compared { how, rough, base, .. } => {
            let nums = [("rough", pct_word(rough)), ("base", pct_word(base))];
            Some(match how {
                LoadHow::High => line("high", false, &nums),
                LoadHow::Same => line("same", against_same, &nums),
                LoadHow::Between => line("between", false, &nums),
            })
        }
        LoadState::RoughOnly { rough } => Some(line("rough-only", false, &[("rough", pct_word(rough))])),
        LoadState::BaseOnly { base } => Some(line("base-only", false, &[("base", pct_word(base))])),
        LoadState::Neither => None,
    }
}

/// Fewer readable snapshots than this among the normal sessions and nothing is compared with them: two
/// sessions are not a baseline for "was it open at the start" ("0 of 2" says almost nothing).
pub(crate) const RUNNING_BASELINE_MIN: usize = 3;

/// The start-of-session snapshots of the rough sessions and of the baseline sessions, readable ones only. A
/// row with none, or an unread one, is "Compy didn't record", never "nothing was running".
struct StartRead<'a> {
    rough: Vec<&'a crate::running_at_start::RunningAtStart>,
    rough_total: usize,
    base: Vec<&'a crate::running_at_start::RunningAtStart>,
}

fn start_read<'a>(c: &Ctx<'a>) -> StartRead<'a> {
    let readable = |v: &[&'a SessionFacts]| -> Vec<&'a crate::running_at_start::RunningAtStart> {
        v.iter().filter_map(|s| s.running_at_start.as_ref()).filter(|r| r.is_readable()).collect()
    };
    StartRead { rough: readable(&c.affected), rough_total: c.affected.len(), base: readable(&c.base) }
}

impl StartRead<'_> {
    /// Every rough session has a readable snapshot.
    fn complete(&self) -> bool {
        self.rough_total > 0 && self.rough.len() == self.rough_total
    }
}

fn nofm_args(d: &crate::running_at_start::Difference) -> Vec<(&'static str, String)> {
    vec![
        ("r", d.in_rough.n.to_string()),
        ("rm", d.in_rough.of.to_string()),
        ("n", d.in_normal.n.to_string()),
        ("nm", d.in_normal.of.to_string()),
    ]
}

/// What the start-of-session snapshots say, for the "Other programs" finding, strictly within the module's
/// rules. A program that is not always resident and was open in EVERY readable rough snapshot gets
/// `already_running_sentence` (presence only); any program, resident or not, is compared only through
/// `differs_between`, and only in the direction "open in a larger share of the rough sessions", as a counts
/// line (never "it was open" for a program that was not open in every rough session). TIMING needs more: a
/// non-resident program open in every readable rough snapshot and in none of at least `RUNNING_BASELINE_MIN`
/// readable normal ones. A resident program is only ever a counts line on a finding that exists for another
/// reason; it never makes one, is never timing and is never named in the fix. Returns the lines, whether any
/// is timing, and the names of non-resident recorder/overlay programs that earned the timing.
fn start_evidence(c: &Ctx, game: &str) -> (Vec<Evidence>, bool, Vec<&'static str>) {
    use crate::running_at_start as ras;
    let st = start_read(c);
    let mut evidence = Vec::new();
    let mut timing = false;
    let mut named: Vec<&'static str> = Vec::new();
    if st.rough.is_empty() {
        return (evidence, timing, named);
    }
    let diffs = if st.base.len() >= RUNNING_BASELINE_MIN { ras::differs_between(&st.rough, &st.base) } else { Vec::new() };
    for p in ras::PROGRAMS {
        let diff = diffs.iter().find(|d| d.id == p.id && d.more_in_rough());
        let in_every_rough = st.rough.iter().all(|r| r.known.iter().any(|k| k.id == p.id));
        let presence = ras::ProgramPresence { id: p.id, name: p.display_name, always_resident: p.always_resident };
        if in_every_rough && ras::already_running_sentence(&presence, game).is_some() {
            evidence.push(ev(EvidenceKind::Measured, "already-running", "sessions", false, &[("id", p.id.to_string()), ("name", p.display_name.to_string())]));
            if let Some(d) = diff {
                let mut a = vec![("id", p.id.to_string())];
                a.extend(nofm_args(d));
                evidence.push(ev(EvidenceKind::Measured, "open-counts", "sessions", false, &a));
                if d.in_normal.n == 0 && d.in_normal.of as usize >= RUNNING_BASELINE_MIN {
                    timing = true;
                    if p.category == ras::Category::RecorderOverlay {
                        named.push(p.display_name);
                    }
                }
            }
        } else if let Some(d) = diff {
            let mut a = vec![("id", p.id.to_string()), ("name", p.display_name.to_string())];
            a.extend(nofm_args(d));
            evidence.push(ev(EvidenceKind::Measured, "open-counts-named", "sessions", false, &a));
        }
    }
    (evidence, timing, named)
}

/// What Compy could not see about the start of the rough sessions. With a readable snapshot on every rough
/// session the generic "which overlays or recorders" line is replaced by what the snapshot cannot cover (it
/// only looks for the programs on Compy's own list); otherwise that line stays and the missing snapshot is said.
fn start_unknowns(c: &Ctx, out: &mut Out) {
    out.unknown("startup-programs");
    if start_read(c).complete() {
        out.unknown("start-list-only");
    } else {
        out.unknown("overlays");
        out.unknown("running-at-start");
    }
}

/// One line when the start recorder stopped listing starts in a rough session (a full log: a count of how many
/// were dropped), or skipped a burst of simultaneous starts (no count of starts exists for that).
fn start_listing_note(c: &Ctx, out: &mut Out) {
    let dropped = c.affected.iter().filter_map(|s| s.start_events_dropped).fold(0u32, u32::saturating_add);
    let skipped = c.affected.iter().filter_map(|s| s.start_ticks_skipped).fold(0u32, u32::saturating_add);
    if dropped > 0 {
        out.see("starts-dropped", &[("n", dropped.to_string())]);
    } else if skipped > 0 {
        out.see("starts-skipped", &[]);
    }
}

/// One line, under what Compy checked, when launches of this game were counted together: a game closed and
/// opened again within `SITTING_GAP_MINUTES` is one session for baselines, counts and recovery. It counts only
/// the sittings among the sessions Compy compared (baseline, rough and recovered ones), says how many times
/// that happened and nothing about why the game closed, and is left out when there were none.
fn sitting_note(c: &Ctx, out: &mut Out) {
    let last_rough = c.affected.iter().filter_map(|s| s.start()).max();
    let recovered = c
        .sess
        .iter()
        .copied()
        .zip(c.judged)
        .filter(|(s, j)| j.verdict == Verdict::Normal && matches!((s.start(), last_rough), (Some(a), Some(b)) if a > b))
        .map(|(s, _)| s);
    let compared: Vec<&str> = c.base.iter().copied().chain(c.affected.iter().copied()).chain(recovered).map(|s| s.started_at.as_str()).collect();
    let n = merged_sitting_reps(c.inp, &c.first_bad.game).iter().filter(|r| compared.contains(&r.as_str())).count();
    if n > 0 {
        out.see("sitting-merged", &[("count", n.to_string())]);
    }
}

fn detect_background(c: &Ctx, out: &mut Out) {
    let busy_rough: Vec<&SessionFacts> = c.affected.iter().copied().filter(|s| s.busy_starts >= BUSY_START_MIN).collect();
    // Starts seen in a ROUGH session of the episode count as timing: this game's own rough and partly measured
    // sessions only (another game's are a display line, below). A heavy
    // build during a session that ran fine is evidence against, not timing, so a session judged Normal
    // never counts. The start recorder is names-only and misses programs already running, second copies of
    // a running name, bursts of more than four names and everything past 50 events, so an absence of
    // starts is never evidence that the PC was quiet.
    let mut seen: Vec<&SessionFacts> = Vec::new();
    for s in c.affected.iter().copied().chain(c.partial.iter().copied()) {
        note_busy(s, &mut seen);
    }
    // Where each start was seen, so every count says what it counts (F16): this game's fully measured rough
    // sessions, its partly measured ones, and another game's rough sessions.
    let mut other_seen: Vec<(&str, &SessionFacts)> = Vec::new();
    for o in &c.others {
        for (s, j) in o.sess.iter().copied().zip(&o.judged) {
            if j.would_fire && s.start().is_some_and(|t| t >= c.win_start) {
                // Another game's starts are a display line only: they never date THIS game's problem.
                if s.busy_starts >= BUSY_START_MIN {
                    other_seen.push((o.name.as_str(), s));
                }
            }
        }
    }
    let partial_seen: Vec<&SessionFacts> = c.partial.iter().copied().filter(|s| s.busy_starts >= BUSY_START_MIN).collect();
    let names_of = |v: &[&SessionFacts]| -> String {
        let mut n: Vec<String> = v.iter().flat_map(|s| s.busy_names.iter().cloned()).collect();
        n.sort();
        n.dedup();
        n.join(", ")
    };
    // Recorded load, per kind: a measurement of its own, independent of the lossy start events. Only sessions
    // since 2026-11-20 carry it, and only a figure recorded on BOTH sides is ever compared.
    let states: Vec<(LoadKind, LoadState)> = LOAD_KINDS.iter().map(|k| (*k, load_state(c, *k))).collect();
    // Kinds with a measured contrast on both sides: every rough session High, and at least LOAD_BASELINE_MIN
    // normal sessions with the figure, every one under the busy line (see `load_state`).
    let high_kinds: Vec<(LoadKind, f64)> = states
        .iter()
        .filter_map(|(k, s)| if let LoadState::Compared { how: LoadHow::High, base, .. } = s { Some((*k, *base)) } else { None })
        .collect();
    let high = !high_kinds.is_empty();
    // A kind whose rough and normal figures both round to 0% says nothing worth a line ("about 0%, about the
    // same as normal (0%)"): it is left out of every line. It still counts in the arithmetic above.
    let shown = |st: &LoadState| !matches!(st, LoadState::Compared { rough, base, .. } if tenths(*rough) < 5 && tenths(*base) < 5);
    let compared: Vec<LoadState> = states.iter().map(|(_, s)| *s).filter(|s| matches!(s, LoadState::Compared { .. })).collect();
    // "About the same" is a contradiction only when NOTHING is high, EVERY compared kind is about the same and each
    // kind's mean agrees with its p90 (a p90 cannot see a burst shorter than a tenth of the session). With a high
    // kind, the same reading of another kind (an idle video engine) says nothing about the processor.
    let contradiction = !high && !compared.is_empty() && compared.iter().all(|s| matches!(s, LoadState::Compared { how: LoadHow::Same, mean_same: true, .. }));
    let rough_only = states.iter().any(|(_, s)| matches!(s, LoadState::RoughOnly { .. }));
    let base_only = states.iter().any(|(_, s)| matches!(s, LoadState::BaseOnly { .. }));
    let none_recorded = states.iter().all(|(_, s)| *s == LoadState::Neither);
    // What Compy could not see, said for the state each set of sessions is in (never "the PC was quiet").
    if compared.is_empty() {
        if none_recorded {
            out.unknown("other-load");
        }
        if rough_only {
            out.unknown("other-load-rough-only");
        }
        if base_only {
            out.unknown("other-load-base-only");
        }
    }    // What the start-of-session snapshots say (presence only; see `start_evidence`).
    let (start_ev, snap_timing, recorders) = start_evidence(c, &intelligence::pretty_game_name(&c.first_bad.game));
    if seen.is_empty() && !high && !snap_timing {
        // Nothing to list as a finding. The figures are still worth saying, with their numbers: "about the same"
        // for every kind (with the means agreeing) sits with what Compy checked as unchanged; any other reading,
        // including a mix of the same and in between, is only listed under "also looked at".
        for (kind, st) in states.iter().filter(|(_, st)| shown(st)) {
            if let LoadState::Compared { how, rough, base, .. } = st {
                let mut a = vec![
                    ("kind", kind.code().to_string()),
                    ("rough", pct_word(*rough)),
                    ("base", pct_word(*base)),
                    ("count", c.affected.len().to_string()),
                ];
                if contradiction {
                    out.ruled_out("background-load", &a);
                } else {
                    a.push(("how", how_word(*how).to_string()));
                    out.see("load-seen", &a);
                }
            }
        }
        return;
    }    let mut evidence = Vec::new();
    if !busy_rough.is_empty() {
        evidence.push(ev(
            EvidenceKind::Measured,
            "starts-seen",
            "sessions",
            false,
            &[("count", busy_rough.len().to_string()), ("names", names_of(&busy_rough))],
        ));
    }
    if let Some(newest) = partial_seen.iter().copied().max_by_key(|s| s.start()) {
        evidence.push(ev(
            EvidenceKind::Measured,
            "starts-seen-partial",
            "sessions",
            false,
            &[("date", newest.started_at.clone()), ("names", names_of(&[newest]))],
        ));
    }
    if !other_seen.is_empty() {
        let mut games: Vec<String> = other_seen.iter().map(|(g, _)| (*g).to_string()).collect();
        games.sort();
        games.dedup();
        let sessions: Vec<&SessionFacts> = other_seen.iter().map(|(_, s)| *s).collect();
        let newest_other = sessions.iter().copied().max_by_key(|s| s.start()).map(|s| s.started_at.clone()).unwrap_or_default();
        evidence.push(ev(
            EvidenceKind::Measured,
            "starts-seen-other",
            "sessions",
            false,
            &[
                ("count", other_seen.len().to_string()),
                ("otherGame", games.join(", ")),
                ("names", names_of(&sessions)),
                ("date", newest_other),
            ],
        ));
    }
    evidence.extend(start_ev);
    evidence.extend(states.iter().filter(|(_, st)| shown(st)).filter_map(|(k, st)| load_evidence(*k, *st, c.affected.len(), contradiction)));
    if compared.iter().any(shown) {
        // The figure is everything except the game: say so once.
        evidence.push(ev(EvidenceKind::Known, "figure-scope", "sessions", false, &[]));
    }
    if none_recorded {
        evidence.push(ev(EvidenceKind::Unknown, "load-not-recorded", "sessions", false, &[]));
    }
    // A time range only over this game's own fully measured rough sessions that had programs starting. A
    // partly measured session or another game's session is dated on its own evidence line: stretching the
    // range over them would claim programs were starting across a period that includes sessions that ran fine.
    let since = match (busy_rough.iter().filter_map(|s| s.start()).min(), busy_rough.iter().filter_map(|s| s.end()).max()) {
        (Some(a), Some(b)) => When::ObservedBetween { from: iso(a), to: iso(b) },
        _ => When::Unknown,
    };
    out.cands.push(Cand {
        id: "background-load",
        // Timing comes from starts, or from a program that was NOT already open at the start of the normal
        // sessions (`start_evidence`): a recorded load figure says how busy the PC was, not when.
        t: !seen.is_empty() || snap_timing,
        // Never a support here: a start in every rough session and a measured high load are one fact (see
        // `Cand::independent`); the starts are timing only.
        d: false,
        // Another game's own measured contrast in the same kind, and a measured recovery of the same kind.
        x: high_kinds.iter().any(|(k, _)| other_game_contrast(c, *k)),
        confounded: false,
        r: high_kinds.iter().any(|(k, b)| load_recovered(c, *k, *b)),
        // One recorded measurement with a contrast on both sides: every rough session far busier than normal ones
        // that were all under the busy line.
        m: high,
        c1: contradiction,
        since,
        // Programs are named in the steps only when this game's own fully measured rough sessions had them.
        // A recorder or overlay open at the start of the rough sessions and of none of the normal ones is named too.
        fix: steps("background-load", &[("names", names_of(&busy_rough)), ("programs", recorders.join(", "))]),
        evidence,
    });
}

fn detect_memory(c: &Ctx, out: &mut Out) {
    let base_max = c.base.iter().filter_map(|s| s.ram_fraction()).reduce(f64::max);
    let Some(base_max) = base_max else {
        out.unknown("memory");
        return;
    };
    let full = |s: &SessionFacts| s.ram_fraction().is_some_and(|f| f >= RAM_FULL_FRACTION);
    let full_rough: Vec<&SessionFacts> =
        if base_max < RAM_BASELINE_MAX_FRACTION { c.affected.iter().copied().filter(|s| full(s)).collect() } else { Vec::new() };
    let peak = |s: &SessionFacts| s.peak_ram_bytes.unwrap_or(0);
    if full_rough.is_empty() {
        if c.affected.iter().any(|s| s.ram_fraction().is_none()) {
            out.unknown("memory");
        } else if let Some(w) = c.affected.iter().copied().filter(|s| full(s)).max_by_key(|s| peak(s)) {
            // Memory was nearly full in a rough session, but the normal sessions already peaked that high:
            // that is no change, and it is not "never nearly full" either. Said as what it is.
            let base_peak = c.base.iter().filter_map(|s| s.peak_ram_bytes).max().unwrap_or(0);
            out.ruled_out(
                "memory-as-full",
                &[("peakGb", gb(peak(w))), ("totalGb", gb(w.ram_total_bytes.unwrap_or(0))), ("basePeakGb", gb(base_peak))],
            );
        } else {
            // Every rough session had a reading, none reached the line the code applies: the card says that
            // line (the same constant), never a vaguer "nearly full".
            out.ruled_out(
                "memory-pressure",
                &[("percent", format!("{}", (RAM_FULL_FRACTION * 100.0).round() as u32)), ("count", c.affected.len().to_string())],
            );
        }
        return;
    }
    let worst = full_rough.iter().copied().max_by_key(|s| peak(s)).unwrap_or(full_rough[0]);
    let total = worst.ram_total_bytes.unwrap_or(0);
    let base_peak = c.base.iter().filter_map(|s| s.peak_ram_bytes).max().unwrap_or(0);
    // Only sessions that recorded a reading can be "lower"; a missing reading is neither high nor low.
    let lower: Vec<&SessionFacts> = c.affected.iter().copied().filter(|s| s.ram_fraction().is_some_and(|f| f < RAM_FULL_FRACTION)).collect();
    let mut evidence = vec![
        ev(EvidenceKind::Measured, "ram-peak", "sessions", false, &[("peakGb", gb(peak(worst))), ("totalGb", gb(total))]),
        ev(EvidenceKind::Measured, "ram-baseline", "sessions", false, &[("peakGb", gb(base_peak))]),
    ];
    if full_rough.iter().any(|s| s.ram_events > 0) {
        evidence.push(ev(EvidenceKind::Measured, "ram-warning", "sessions", false, &[]));
    }
    if let Some(l) = lower.iter().copied().max_by_key(|s| peak(s)) {
        evidence.push(ev(EvidenceKind::Measured, "ram-lower", "sessions", true, &[("peakGb", gb(peak(l))), ("count", lower.len().to_string())]));
    }
    out.cands.push(Cand {
        id: "memory-pressure",
        t: false,
        d: false,
        x: false,
        confounded: false,
        r: false,
        m: true,
        c1: !lower.is_empty(),
        since: When::Exact { at: worst.started_at.clone() },
        fix: steps("memory-pressure", &[("peakGb", gb(peak(worst))), ("totalGb", gb(total))]),
        evidence,
    });
}

fn detect_compy_changes(c: &Ctx, out: &mut Out) {
    let before: Vec<usize> = c.base.iter().filter_map(|s| s.compy_changes).collect();
    let now: Vec<usize> = c.affected.iter().filter_map(|s| s.compy_changes).collect();
    let (Some(lo), Some(hi)) = (before.iter().copied().min(), before.iter().copied().max()) else {
        out.unknown("compy-changes");
        return;
    };
    if now.is_empty() {
        out.unknown("compy-changes");
        return;
    }
    let outside = |n: usize| n < lo || n > hi;
    if !now.iter().any(|&n| outside(n)) {
        out.ruled_out("compy-change", &[("count", now[0].to_string())]);
        return;
    }
    let from = c.baseline_newest.compy_changes.unwrap_or(lo).to_string();
    let to = c.first_bad.compy_changes.unwrap_or(now[0]).to_string();
    out.cands.push(Cand {
        id: "compy-change",
        t: true,
        d: true,
        x: false,
        confounded: false,
        r: false,
        m: false,
        c1: now.iter().any(|&n| !outside(n)),
        since: whole_window(c),
        fix: steps("compy-change", &[]),
        evidence: vec![ev(EvidenceKind::Known, "count-changed", "sessions", false, &[("from", from), ("to", to)])],
    });
}

enum PowerRead {
    Same,
    Differs,
    Unknown,
}

/// The power plan between the last normal session and the first rough one: the sessions' own stamp when
/// both recorded one, otherwise the identity checks on either side of the window.
fn power_read(c: &Ctx) -> PowerRead {
    if let (Some(b), Some(a)) = (nonblank(&c.baseline_newest.power_plan), nonblank(&c.first_bad.power_plan)) {
        return if b.eq_ignore_ascii_case(a) { PowerRead::Same } else { PowerRead::Differs };
    }
    let pick = |limit: DateTime<Utc>| {
        c.inp
            .sightings
            .iter()
            .filter(|g| !g.power_plan.trim().is_empty())
            .filter_map(|g| ts(&g.observed_at).filter(|t| *t <= limit).map(|t| (t, g.power_plan.trim().to_ascii_lowercase())))
            .max_by_key(|(t, _)| *t)
    };
    match (pick(c.win_start), pick(c.win_end)) {
        (Some((_, b)), Some((_, a))) if b == a => PowerRead::Same,
        // Differing names with no session stamp on both sides cannot be placed before or after the baseline.
        (Some(_), Some(_)) => PowerRead::Differs,
        _ => PowerRead::Unknown,
    }
}

fn detect_power_plan(c: &Ctx, out: &mut Out) {
    let session_stamps = nonblank(&c.baseline_newest.power_plan).is_some() && nonblank(&c.first_bad.power_plan).is_some();
    match power_read(c) {
        PowerRead::Same => out.ruled_out("power-plan-change", &[]),
        PowerRead::Differs if session_stamps => out.cands.push(Cand {
            id: "power-plan-change",
            t: true,
            d: true,
            x: false,
            confounded: false,
            r: false,
            m: false,
            c1: false,
            since: whole_window(c),
            fix: no_safe_change(),
            evidence: vec![ev(EvidenceKind::Known, "power-plan-changed", "sessions", false, &[])],
        }),
        PowerRead::Differs => out.unknown("power-plan-timing"),
        PowerRead::Unknown => out.unknown("power-plan"),
    }
}

fn detect_setting_drift(c: &Ctx, out: &mut Out) {
    let power_same = matches!(power_read(c), PowerRead::Same);
    let mut evidence = Vec::new();
    let mut since = When::Unknown;
    let mut ambiguous = false;
    for n in &c.inp.drift {
        let Some(noticed) = ts(&n.noticed_at) else { continue };
        if n.id == "power-profile" && power_same {
            continue;
        }
        let ready = n.last_ready_at.as_deref().and_then(ts);
        let noticed_in_window = noticed > c.win_start && noticed <= c.win_end;
        if noticed_in_window && ready.is_some_and(|r| r < c.win_start) {
            // Seen in the window, but last seen fine before it: when it changed is not recorded, so it
            // is neither listed as a change in the window nor ruled out.
            ambiguous = true;
            continue;
        }
        if !noticed_in_window {
            continue;
        }
        if evidence.is_empty() {
            since = match ready {
                Some(r) => When::ObservedBetween { from: iso(r), to: iso(noticed) },
                None => When::Seen { at: iso(noticed) },
            };
        }
        evidence.push(ev(EvidenceKind::Known, "drift-noticed", "drift", false, &[("check", n.id.clone())]));
    }
    if evidence.is_empty() {
        if ambiguous {
            out.unknown("drift-timing");
        } else if !c.inp.drift_unread {
            // An unread store is not "no changes noticed".
            out.ruled_out("setting-drift", &[]);
        }
        return;
    }
    evidence.push(ev(EvidenceKind::Unknown, "which-not-recorded", "drift", false, &[]));
    out.cands.push(Cand {
        id: "setting-drift",
        t: true,
        d: false,
        x: false,
        confounded: false,
        r: false,
        m: false,
        c1: false,
        since,
        fix: steps("setting-drift", &[]),
        evidence,
    });
}

fn detect_display(c: &Ctx, out: &mut Out) {
    let before = c.base.iter().rev().find_map(|s| s.refresh_hz);
    let (Some(b), Some(a)) = (before, c.first_bad.refresh_hz) else {
        out.unknown("display");
        return;
    };
    if a >= b {
        out.ruled_out("display-refresh-lower", &[("hz", a.to_string())]);
        return;
    }
    out.cands.push(Cand {
        id: "display-refresh-lower",
        t: true,
        d: true,
        x: false,
        confounded: false,
        r: false,
        m: false,
        c1: c.affected.iter().any(|s| s.refresh_hz == Some(b)),
        since: whole_window(c),
        fix: no_safe_change(),
        evidence: vec![changed(&b.to_string(), &a.to_string())],
    });
}

fn detect_windows(c: &Ctx, out: &mut Out) {
    let before = c.base.iter().rev().find_map(|s| nonblank(&s.windows_build));
    let (Some(b), Some(a)) = (before, nonblank(&c.first_bad.windows_build)) else {
        out.unknown("windows-build");
        return;
    };
    if b == a {
        out.ruled_out("windows-build-change", &[("build", a.to_string())]);
        return;
    }
    out.cands.push(Cand {
        id: "windows-build-change",
        t: true,
        d: true,
        x: false,
        confounded: false,
        r: false,
        m: false,
        c1: c.affected.iter().any(|s| nonblank(&s.windows_build) == Some(b)),
        since: whole_window(c),
        fix: no_safe_change(),
        evidence: vec![changed(b, a)],
    });
}

#[cfg(test)]
mod tests;
