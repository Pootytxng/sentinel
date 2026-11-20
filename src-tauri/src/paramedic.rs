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
//! Wording law (Constitution 17, 25): a finding says what changed before the problem, never that it
//! caused it. Certainty is a band, never a number.

use std::collections::BTreeMap;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::intelligence::{self, SessionRef};

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
pub(crate) const OTHER_CPU_BASELINE_MEDIAN_PCT: f64 = 5.0;
/// Process starts of build/encode tools in one session that count as "busy programs were running".
pub(crate) const BUSY_START_MIN: u32 = 5;
/// Build and encode tools whose repeated starts mean heavy background work (names, lower-case, no `.exe`).
const BUSY_PROGRAMS: &[&str] = &[
    "cargo", "cargo-clippy", "rustc", "rustup", "clippy-driver", "build-script-build", "link", "cl",
    "msbuild", "ninja", "cmake", "ffmpeg", "handbrake", "x264", "x265", "7z", "winrar",
];
const METHOD: &str = "paramedic-rules-v1";

// ---- Inputs: numbers a session recorded, plus identity sightings and drift notices. -------------
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
    #[serde(default)]
    ram_events: u32,
    /// 90th percentile of how busy everything except the game was, percent. Unknown before TG-context v2.
    #[serde(default)]
    other_cpu_p90_pct: Option<f64>,
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
    /// The game's newest sessions were only partly measured, so none is judged.
    PartialMeasure { percent: u8 },
    NoSessions,
    /// F10 will answer crash complaints in this card; F1 does not.
    CrashNotCovered,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum DiagnosisState {
    NothingWrong { sessions_checked: u8 },
    CantTell { why: CantTellWhy },
    Found,
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
    pub sessions_affected: Vec<SessionRef>,
    /// Sessions Compy measured only in part that would also have fired: corroboration, never a reason alone.
    pub partial_sessions: Vec<SessionRef>,
    pub other_games_affected: Vec<String>,
}

/// §25 vocabulary, per line of evidence.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EvidenceKind {
    Known,
    Measured,
    #[allow(dead_code)] // F3+ (judged "did it work" lines)
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
}

/// Checked and ruled out because unchanged (design B, C3).
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
    /// The newest of the game's normal sessions the problem was judged against.
    pub baseline: Option<SessionRef>,
    pub first_bad: Option<SessionRef>,
    /// Why the first finding leads: `cross-game` or `tie`.
    pub why_first: Option<&'static str>,
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
            baseline: None,
            first_bad: None,
            why_first: None,
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
        let base = base_stats(sess, &pool);
        let eval = base.as_ref().and_then(|b| evaluate(s, b));
        let judgeable = s.judgeable();
        let fired = eval.is_some_and(|e| e.fired);
        let verdict = if !judgeable {
            Verdict::Unjudged
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

/// One game's sessions, oldest first. A session whose start cannot be read is left out, never guessed at.
fn game_sessions<'a>(inp: &'a DiagnoseInputs, game: &str) -> Vec<&'a SessionFacts> {
    let mut v: Vec<&SessionFacts> = inp.sessions.iter().filter(|s| same_game(&s.game, game) && s.start().is_some()).collect();
    v.sort_by_key(|s| s.start());
    v
}

// ---- Entry points -----------------------------------------------------------------------------
/// The pure core. `game` is a process name; `None` means the game of the newest recorded session.
pub(crate) fn diagnose(inp: &DiagnoseInputs, complaint: Complaint, game: Option<&str>) -> Diagnosis {
    let newest_game = || {
        inp.sessions.iter().filter_map(|s| s.start().map(|t| (t, s.game.clone()))).max_by_key(|(t, _)| *t).map(|(_, g)| g)
    };
    let no_sessions = DiagnosisState::CantTell { why: CantTellWhy::NoSessions };
    let Some(game_key) = game.map(str::to_string).or_else(newest_game) else {
        return Diagnosis::empty(complaint, no_sessions);
    };
    let mut d = Diagnosis::empty(complaint, no_sessions);
    d.game_name = Some(intelligence::pretty_game_name(&game_key));
    d.game = Some(game_key.clone());
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
        let pct = (sess[sess.len() - 1].coverage() * 100.0).round().clamp(0.0, 100.0) as u8;
        d.state = DiagnosisState::CantTell { why: CantTellWhy::PartialMeasure { percent: pct } };
        return d;
    };
    match judged[newest].verdict {
        Verdict::NeedsMore(have) => {
            d.state = DiagnosisState::NeedsMorePlay {
                sessions_needed: BASELINE_MIN.saturating_sub(have) as u8,
                have: have.min(BASELINE_MIN) as u8,
            };
        }
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
        Verdict::Fired => explain(inp, &game_key, &sess, &judged, newest, &mut d),
        Verdict::Unjudged => {}
    }
    d
}

/// The Tauri edge. Reads only what `gather()` already loads; writes nothing and calls no apply path.
#[tauri::command]
pub(crate) fn paramedic_diagnose(complaint: Complaint, game: Option<String>) -> Diagnosis {
    let g = intelligence::gather();
    diagnose(&inputs_from(&g), complaint, game.as_deref())
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
    let mut busy_starts = 0u32;
    let mut ram_events = 0u32;
    for e in &s.stutter_events {
        match e.kind.as_str() {
            "process-start" => {
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
        gpu_driver: driver,
        windows_build: gs.and_then(|g| g.windows_build.clone()),
        refresh_hz: gs.and_then(|g| g.display_refresh_hz),
        power_plan: gs.and_then(|g| g.power_plan_guid.clone()),
        rig: fp.map(|f| format!("{}|{}", f.gpu, f.ram_gb)),
        compy_changes: s.compy_changes_active,
        busy_starts,
        busy_names,
        ram_events,
        other_cpu_p90_pct: gs.and_then(|g| g.other_cpu).map(|o| f64::from(o.p90_pct_x10) / 10.0),
    }
}

pub(crate) fn inputs_from(g: &intelligence::Gathered) -> DiagnoseInputs {
    DiagnoseInputs {
        sessions: g.sessions.iter().map(facts_from).collect(),
        sightings: g
            .snapshots
            .iter()
            .map(|s| Sighting {
                observed_at: s.observed_at.clone(),
                gpu_driver: s.gpu_driver.clone(),
                power_plan: s.power_plan.clone(),
            })
            .collect(),
        drift: g
            .drift_notices
            .iter()
            .map(|n| DriftFact { id: n.id.clone(), last_ready_at: n.last_ready_at.clone(), noticed_at: n.noticed_at.clone() })
            .collect(),
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
    for s in &inp.sessions {
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
    first_bad: &'a SessionFacts,
    /// Every session of any game that started after the last normal one ended and before the first rough one.
    window: Vec<&'a SessionFacts>,
    win_start: DateTime<Utc>,
    win_end: DateTime<Utc>,
    others: Vec<OtherGame<'a>>,
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
    /// M: a measured size past its fixed line.
    m: bool,
    /// C1: a rough session where this change was absent or below its line.
    c1: bool,
    since: When,
    fix: Fix,
    evidence: Vec<Evidence>,
}

impl Cand {
    fn certainty(&self) -> Option<Certainty> {
        if !self.t {
            // A size with no timing (a full memory, a busy PC) is a Possible at best: nothing says it
            // changed before the problem.
            return self.m.then_some(Certainty::Possible);
        }
        // C2 (an unfired judgeable session after the change) cannot occur here: one would have
        // ended the trailing run of rough sessions this explanation is about.
        Some(if (self.d || self.x || self.m) && !self.c1 { Certainty::Likely } else { Certainty::Possible })
    }

    fn supports(&self) -> usize {
        usize::from(self.d) + usize::from(self.x) + usize::from(self.m) + usize::from(self.t)
    }
}

#[derive(Default)]
struct Out {
    cands: Vec<Cand>,
    not_it: Vec<RuledOut>,
    unknowns: Vec<&'static str>,
}

impl Out {
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
        "display-refresh-lower",
        "power-plan-change",
        "compy-change",
        "setting-drift",
        "windows-build-change",
    ];
    ORDER.iter().position(|x| *x == id).unwrap_or(ORDER.len())
}

fn explain(inp: &DiagnoseInputs, game_key: &str, sess: &[&SessionFacts], judged: &[Judgement], newest: usize, d: &mut Diagnosis) {
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
    let (Some(win_start), Some(win_end)) = (baseline_newest.end(), first_bad.start()) else {
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
    let partial: Vec<SessionRef> = ((last_base + 1)..sess.len())
        .filter(|&i| judged[i].verdict == Verdict::Unjudged && judged[i].would_fire)
        .map(|i| sess[i].session_ref())
        .collect();
    d.problem = Some(ProblemReading {
        rule: if evals.iter().flatten().any(|e| e.rule_r) { AnomalyRule::StutterCollapse } else { AnomalyRule::Spikes },
        spikes: evals.iter().flatten().any(|e| e.rule_p99),
        avg_lower: avg_now <= RULE_AVG_FRACTION * base.med_avg,
        before: Metric { ratio: base.med_r, p99_ms: base.med_p99, avg_fps: base.med_avg },
        now: Metric { ratio: ratio_now, p99_ms: affected.iter().filter_map(|s| s.p99_ms).reduce(f64::max), avg_fps: avg_now },
        last_normal_at: baseline_newest.started_at.clone(),
        sessions_affected: affected.iter().map(|s| s.session_ref()).collect(),
        partial_sessions: partial,
        other_games_affected: affected_others,
    });
    d.baseline = Some(baseline_newest.session_ref());
    d.first_bad = Some(first_bad.session_ref());
    let window: Vec<&SessionFacts> =
        inp.sessions.iter().filter(|s| s.start().is_some_and(|t| t >= win_start && t < win_end)).collect();
    let ctx = Ctx { inp, base: base_sess, affected, baseline_newest, first_bad, window, win_start, win_end, others };
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
    for code in ["game-patch", "startup-programs", "overlays"] {
        out.unknown(code);
    }
    rank(&mut out.cands);
    d.why_first = why_first(&out.cands);
    d.findings = out
        .cands
        .into_iter()
        .filter_map(|c| {
            let confidence = c.certainty()?;
            Some(Finding { id: c.id, confidence, evidence: c.evidence, since_when: c.since, fix: c.fix })
        })
        .collect();
    d.not_it = out.not_it;
    d.unknowns = out.unknowns;
    d.state = if d.findings.is_empty() {
        DiagnosisState::CantTell { why: CantTellWhy::NothingChanged }
    } else {
        DiagnosisState::Found
    };
}

/// Order by certainty, then the fixed category order, then more supports.
fn rank(c: &mut Vec<Cand>) {
    c.retain(|x| x.certainty().is_some());
    let rankc = |x: &Cand| match x.certainty() {
        Some(Certainty::Likely) => 0,
        _ => 1,
    };
    c.sort_by(|a, b| rankc(a).cmp(&rankc(b)).then(category(a.id).cmp(&category(b.id))).then(b.supports().cmp(&a.supports())));
}

fn why_first(c: &[Cand]) -> Option<&'static str> {
    let top = c.first()?;
    let second = c.get(1)?;
    if top.certainty() == Some(Certainty::Likely) && second.certainty() == Some(Certainty::Likely) {
        Some("tie")
    } else if top.x && !second.x {
        Some("cross-game")
    } else {
        None
    }
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
        return;
    };
    if !crate::hardware::driver_changed(from, to) {
        out.ruled_out("gpu-driver-change", &[("driver", to.to_string())]);
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
    let x_games: Vec<String> = c
        .others
        .iter()
        .filter(|o| {
            let first_rough = (0..o.sess.len()).find(|&j| {
                o.judged[j].verdict == Verdict::Fired && o.sess[j].start().is_some_and(|t| t >= c.win_start) && on(o.sess[j], to)
            });
            first_rough.is_some_and(|f| {
                o.judged[..f].iter().all(|j| j.verdict != Verdict::Fired) && o.judged[..f].iter().any(|j| j.verdict == Verdict::Normal)
            })
        })
        .map(|o| o.name.clone())
        .collect();
    let mut evidence = vec![changed(from, to)];
    evidence[0].code = "driver-changed";
    if rough_on_old == 0 {
        evidence.push(ev(
            EvidenceKind::Measured,
            "sessions-split",
            "sessions",
            false,
            &[("baselineAt", c.baseline_newest.started_at.clone()), ("count", c.affected.len().to_string())],
        ));
    } else {
        evidence.push(ev(EvidenceKind::Measured, "rough-on-old-driver", "sessions", true, &[("count", rough_on_old.to_string())]));
    }
    if !x_games.is_empty() {
        evidence.push(ev(EvidenceKind::Measured, "cross-game", "sessions", false, &[("games", x_games.join(", "))]));
    }
    evidence.push(ev(EvidenceKind::Unknown, "install-time-not-read", "snapshots", false, &[("seenAt", iso(first_new))]));
    out.cands.push(Cand {
        id: "gpu-driver-change",
        t: true,
        d: true,
        x: !x_games.is_empty(),
        m: false,
        c1: rough_on_old > 0,
        since: When::ObservedBetween { from: iso(last_old), to: iso(first_new) },
        fix: steps("gpu-driver-change", &[("from", from.to_string()), ("to", to.to_string())]),
        evidence,
    });
}

fn detect_background(c: &Ctx, out: &mut Out) {
    let busy = |s: &&SessionFacts| s.busy_starts >= BUSY_START_MIN;
    let in_window: Vec<&SessionFacts> = c.window.iter().copied().filter(busy).collect();
    let busy_rough: Vec<&SessionFacts> = c.affected.iter().copied().filter(busy).collect();
    let mut base_cpu: Vec<f64> = c.base.iter().filter_map(|s| s.other_cpu_p90_pct).collect();
    let can_measure = !base_cpu.is_empty() && median(&mut base_cpu) < OTHER_CPU_BASELINE_MEDIAN_PCT;
    let loud = |s: &SessionFacts| can_measure && s.other_cpu_p90_pct.is_some_and(|p| p >= OTHER_CPU_P90_PCT);
    let loud_rough = c.affected.iter().filter(|s| loud(s)).count();
    let all_measured = c.affected.iter().all(|s| s.other_cpu_p90_pct.is_some());
    if !all_measured {
        out.unknown("other-load");
    }
    if in_window.is_empty() && busy_rough.is_empty() && loud_rough == 0 {
        if all_measured && can_measure {
            out.ruled_out("background-load", &[]);
        }
        return;
    }
    let mut seen: Vec<&SessionFacts> = in_window.clone();
    for s in &busy_rough {
        if !seen.iter().any(|x| x.started_at == s.started_at) {
            seen.push(s);
        }
    }
    let mut names: Vec<String> = seen.iter().flat_map(|s| s.busy_names.iter().cloned()).collect();
    names.sort();
    names.dedup();
    let without = c.affected.iter().filter(|s| s.busy_starts < BUSY_START_MIN && !loud(s)).count();
    let mut evidence = Vec::new();
    if !seen.is_empty() {
        evidence.push(ev(
            EvidenceKind::Measured,
            "starts-seen",
            "sessions",
            false,
            &[("count", seen.len().to_string()), ("names", names.join(", "))],
        ));
    }
    if loud_rough > 0 {
        evidence.push(ev(EvidenceKind::Measured, "load-measured", "sessions", false, &[("count", loud_rough.to_string())]));
    }
    if without > 0 {
        evidence.push(ev(
            EvidenceKind::Measured,
            "starts-absent",
            "sessions",
            true,
            &[("count", without.to_string()), ("of", c.affected.len().to_string())],
        ));
    }
    if !all_measured {
        evidence.push(ev(EvidenceKind::Unknown, "load-not-recorded", "sessions", false, &[]));
    }
    let since = match (seen.iter().filter_map(|s| s.start()).min(), seen.iter().filter_map(|s| s.end()).max()) {
        (Some(a), Some(b)) => When::ObservedBetween { from: iso(a), to: iso(b) },
        _ => When::Unknown,
    };
    out.cands.push(Cand {
        id: "background-load",
        t: !seen.is_empty(),
        d: busy_rough.len() == c.affected.len(),
        x: false,
        m: loud_rough > 0,
        c1: without > 0,
        since,
        fix: steps("background-load", &[("names", names.join(", "))]),
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
    if full_rough.is_empty() {
        if c.affected.iter().any(|s| s.ram_fraction().is_none()) {
            out.unknown("memory");
        } else {
            out.ruled_out("memory-pressure", &[]);
        }
        return;
    }
    let peak = |s: &SessionFacts| s.peak_ram_bytes.unwrap_or(0);
    let worst = full_rough.iter().copied().max_by_key(|s| peak(s)).unwrap_or(full_rough[0]);
    let total = worst.ram_total_bytes.unwrap_or(0);
    let base_peak = c.base.iter().filter_map(|s| s.peak_ram_bytes).max().unwrap_or(0);
    let lower: Vec<&SessionFacts> = c.affected.iter().copied().filter(|s| !full(s)).collect();
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
    for n in &c.inp.drift {
        let Some(noticed) = ts(&n.noticed_at) else { continue };
        if n.id == "power-profile" && power_same {
            continue;
        }
        let ready = n.last_ready_at.as_deref().and_then(ts);
        let inside = noticed > c.win_start && noticed <= c.win_end && !ready.is_some_and(|r| r < c.win_start);
        if !inside {
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
        out.ruled_out("setting-drift", &[]);
        return;
    }
    evidence.push(ev(EvidenceKind::Unknown, "which-not-recorded", "drift", false, &[]));
    out.cands.push(Cand {
        id: "setting-drift",
        t: true,
        d: false,
        x: false,
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
        m: false,
        c1: c.affected.iter().any(|s| nonblank(&s.windows_build) == Some(b)),
        since: whole_window(c),
        fix: no_safe_change(),
        evidence: vec![changed(b, a)],
    });
}

#[cfg(test)]
mod tests;
