//! P5-realplay (with P4-noise-stretch): real-play mode's pure core. A real-play Trial applies ONE
//! change once (through the existing audited `history::apply_recommendation`, from
//! `experiment::start_experiment`), leaves it on while the player plays however they play, and
//! judges it on several whole sessions on each side instead of one session against one session.
//!
//! This module decides, from records Compy already keeps, which sessions count and what they
//! support. It is pure: no file, no lock, no clock (the caller passes `now`), no Windows state. It
//! applies nothing and restores nothing; `experiment.rs` keeps or restores through the same path the
//! two-session conclude uses, and `history.rs` stays the only way anything changes.
//!
//! - **Before arm**, pinned at start: the unchanged run of sessions that ends at the anchor (the
//!   newest as-is session), [`MIN_SESSIONS`] to [`MAX_SESSIONS`] of them, each long enough and
//!   started within `comparison::ARM_MAX_AGE_DAYS`. Their numbers are copied onto the record, so the
//!   receipt survives the session store's 100-row cap.
//! - **With arm**, recounted from the session store at every read ([`with_arm`]): sessions of the
//!   same game that began after the change took effect, under the same rig, driver, Windows and game
//!   build, conditions, Gaming Mode state and Compy changes as the as-is sessions plus this one
//!   change, with the change shown on at the session's start and at the next observation after it.
//!   Every other session is listed with a reason ([`NotCountedReason`]) and never counted.
//! - **Judging** ([`judge`]): on ln(1% low) and ln(average), the effect between the arms against a
//!   band from the Trial's own between-session spread (Welch: each arm on its own spread, with
//!   Satterthwaite's degrees of freedom, Student t at α = 0.05/3), never below the fixed 3%. Looks at
//!   3, 5 and 8 sessions, each on the chronological prefix, so when Compy is opened never changes the
//!   verdict. Real play never records High confidence.
//!
//! Compy can't tell one scene or match from another without looking inside the game, which LOCKED
//! rule 2 forbids, so the band comes from the Trial's own sessions and nothing is borrowed from
//! older history.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::comparability::{Comparability, SessionComparability};
use crate::comparison::DEFAULT_NOISE_FLOOR_PCT;
use crate::experiment::{ConcludeOutcome, LedgerEntryRef, TrialOutcome};
use crate::intelligence::Confidence;
use crate::sessions::SessionSummary;

// ─── Owner-tunable defaults (plan §5) ────────────────────────────────────────

/// Fewest sessions on each side before anything is judged; a real-play start needs this many as-is
/// sessions.
pub(crate) const MIN_SESSIONS: usize = 3;
/// Most sessions on each side: the before arm keeps the newest this many, and the last look is here.
pub(crate) const MAX_SESSIONS: usize = 8;
/// The looks: after this many with-change sessions are counted, each judged on that prefix. Never
/// more than three, which is what the α = 0.05/3 in [`T_CRITICAL`] pays for.
pub(crate) const LOOKS: [usize; 3] = [3, 5, 8];
/// How long the change stays on for a real-play Trial, counted from when it took effect.
pub(crate) const WINDOW_DAYS: i64 = 14;
/// At an early look, "No clear difference" needs a band this narrow or narrower; a wider band keeps
/// collecting.
pub(crate) const SETTLED_BAND_PCT: f64 = 5.0;
/// At the final look, "No clear difference" needs a band this narrow or narrower; a wider one is
/// Unknown (`too-noisy`, stop reason `sessions-too-varied`).
pub(crate) const USEFUL_BAND_PCT: f64 = 10.0;
/// Fewest frame-rate readings (about one a second) a session needs to count on either side: the
/// same ~10 minutes of play a two-session Trial needs.
pub(crate) const MIN_READINGS: u32 = crate::experiment::MIN_BASELINE_SAMPLES;
/// Most not-counted sessions a record keeps (the newest).
pub(crate) const MAX_NOT_COUNTED: usize = 10;

/// Two-sided Student t critical values at α = 0.05/3 (Bonferroni over at most three looks), for
/// df 2 to 14: `scipy.stats.t.ppf(1 - 0.05/6, df)`, three decimals. Welch's degrees of freedom lie
/// between min(n, m) − 1 (2 with three sessions a side) and n + m − 2 (14 with eight a side). (The
/// df-14 value is 2.718: a t quantile that happens to share e's digits.)
#[allow(clippy::approx_constant)]
const T_CRITICAL: [f64; 13] = [7.649, 4.857, 3.961, 3.534, 3.287, 3.128, 3.016, 2.933, 2.870, 2.820, 2.779, 2.746, 2.718];
const T_FIRST_DF: usize = 2;

/// The t critical value for `df` degrees of freedom, which Welch's makes fractional: between two
/// whole df, the straight line between their values. t falls ever more slowly as df grows, so that
/// line lies above the exact value and can only be more cautious. Below 2 (or not a number) there is
/// no value; above 14 the df-14 value, which is wider than the true one.
pub(crate) fn t_critical(df: f64) -> Option<f64> {
    if df.is_nan() || df < T_FIRST_DF as f64 {
        return None;
    }
    let last = T_CRITICAL.len() - 1;
    let x = df - T_FIRST_DF as f64;
    let i = x.floor() as usize;
    if i >= last {
        return Some(T_CRITICAL[last]);
    }
    Some(T_CRITICAL[i] + (T_CRITICAL[i + 1] - T_CRITICAL[i]) * (x - i as f64))
}

/// The recorded conditions that, once changed, no later session can change back: a different GPU or
/// RAM, a driver, Windows or game update, a new capture method. A with-session showing one ends the
/// Trial (`RealPlayStop::Conditions`); a resolution or refresh change only leaves that session out.
const PERMANENT_CHANGES: [&str; 6] = ["gpu", "ram", "gpu-driver", "windows-build", "game-build", "capture-method"];

// ─── Persisted evidence (additive on `ExperimentRecord::real_play`) ─────────────

/// One session's numbers, copied onto the record so the receipt survives the session store's cap.
/// Every field reads leniently: a row with a field missing or of the wrong type loads (a NaN is
/// written as `null`, for one), and a number that isn't a real reading is never judged
/// ([`RealPlaySession::readable`]), so one damaged row never costs the whole record.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct RealPlaySession {
    /// The session's `started_at`.
    #[serde(default, deserialize_with = "text")]
    pub session_id: String,
    #[serde(default, deserialize_with = "reading")]
    pub low1_fps: f64,
    #[serde(default, deserialize_with = "reading")]
    pub avg_fps: f64,
    #[serde(default, deserialize_with = "count")]
    pub samples: u32,
}

/// A number as written, or NaN for anything else (`null`, text): never a reading.
fn reading<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(serde_json::Value::deserialize(d)?.as_f64().unwrap_or(f64::NAN))
}

/// A count as written, or 0 for anything else.
fn count<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    Ok(serde_json::Value::deserialize(d)?.as_u64().and_then(|n| u32::try_from(n).ok()).unwrap_or(0))
}

/// Text as written, or empty for anything else.
fn text<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(match serde_json::Value::deserialize(d)? {
        serde_json::Value::String(s) => s,
        _ => String::new(),
    })
}

impl RealPlaySession {
    pub(crate) fn of(s: &SessionSummary) -> Self {
        RealPlaySession { session_id: s.started_at.clone(), low1_fps: s.low1_fps_est, avg_fps: s.avg_fps, samples: s.samples }
    }

    /// Both numbers are real readings (finite and above zero). Nothing else is ever judged.
    fn readable(&self) -> bool {
        [self.low1_fps, self.avg_fps].iter().all(|x| x.is_finite() && *x > 0.0)
    }
}

/// Why a session of the game, played while the Trial ran, wasn't counted. Persisted (kebab-case)
/// and read leniently: a reason a newer Compy wrote, or none at all, reads as `Other`, never a failed
/// load.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum NotCountedReason {
    /// Fewer than [`MIN_READINGS`] readings.
    TooShort,
    /// Long enough, but without a frame-rate reading: no average or no 1% low was measured.
    NoReading,
    /// The game was behind another window the whole time.
    Behind,
    /// It began before the change took effect.
    BeforeChange,
    /// A recorded condition differs from the as-is sessions (rig, driver, Windows or game build,
    /// resolution, refresh, graphics API, frame generation, capture method), or couldn't be
    /// confirmed the same.
    ConditionsChanged,
    /// The change didn't read as on when the session began, or at the next check after it.
    ChangeNotOn,
    /// Another Compy change was applied or undone before the session ended, or the session ran with
    /// Compy changes other than the as-is sessions' plus this one.
    OtherCompyChange,
    /// Gaming Mode was on in this session and not in the as-is sessions, or the other way round, or
    /// it wasn't recorded.
    GamingModeDiffers,
    /// It began more than [`WINDOW_DAYS`] after the change took effect.
    AfterWindow,
    /// Anything else: a session record Compy can't read in full (a length that can't be added to its
    /// start), or a reason this build doesn't know.
    #[default]
    Other,
}

impl<'de> Deserialize<'de> for NotCountedReason {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        Ok(match v.as_str() {
            Some("too-short") => Self::TooShort,
            Some("no-reading") => Self::NoReading,
            Some("behind") => Self::Behind,
            Some("before-change") => Self::BeforeChange,
            Some("conditions-changed") => Self::ConditionsChanged,
            Some("change-not-on") => Self::ChangeNotOn,
            Some("other-compy-change") => Self::OtherCompyChange,
            Some("gaming-mode-differs") => Self::GamingModeDiffers,
            Some("after-window") => Self::AfterWindow,
            _ => Self::Other,
        })
    }
}

/// A session that wasn't counted, and why. Read leniently, like [`RealPlaySession`].
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct NotCounted {
    #[serde(default, deserialize_with = "text")]
    pub session_id: String,
    #[serde(default)]
    pub reason: NotCountedReason,
}

/// Why a running real-play Trial can't go on as it is, so closing it is the next step. Persisted on
/// the concluded record (kebab-case). `ChangeOff` and `Unreadable` describe the setting right now:
/// they clear on their own when it reads on again. Every other one is final.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RealPlayStop {
    /// The setting reads as off right now.
    ChangeOff,
    /// Its own change was undone in Test → Applied & history.
    PutBackInHistory,
    /// Compy can't read the setting right now.
    Unreadable,
    /// Another Compy change was applied or undone during the test.
    OtherChange,
    /// The rig, driver, Windows build, game build or capture method changed.
    Conditions,
    /// [`WINDOW_DAYS`] have passed since the change took effect.
    WindowOver,
    /// None of the as-is sessions is in Compy's session history any more, so nothing can be checked
    /// against them.
    BeforeMissing,
}

/// A real-play Trial's evidence, on `ExperimentRecord::real_play`. `before` is set at start (pinned,
/// never re-picked); the rest at conclude. Every field defaults, and empty or unknown ones aren't
/// written, so a record carries only what was measured.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub(crate) struct RealPlayEvidence {
    /// The as-is sessions, oldest first.
    #[serde(default)]
    pub before: Vec<RealPlaySession>,
    /// The with-change sessions the verdict was judged on (the deciding look's prefix), oldest first;
    /// on an early end, the ones that were counted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub with: Vec<RealPlaySession>,
    /// The between-session spread of each metric (pooled within-arm SD, as a %), for the receipt:
    /// descriptive only, since the band judges each arm on its own spread. `None` until a look.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low1_spread_pct: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avg_spread_pct: Option<f64>,
    /// ± band the verdict was judged against, in %: never below 3%.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_pct: Option<f64>,
    /// The effect between the arms, in % ((e^d − 1)·100 on the geometric means).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta_low1_pct: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta_avg_pct: Option<f64>,
    /// Which look gave the verdict: 1, 2 or 3. `None` when no look was made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub look: Option<u8>,
    /// Sessions of the game played while it ran that weren't counted, and why: the newest
    /// [`MAX_NOT_COUNTED`], oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub not_counted: Vec<NotCounted>,
    /// Why the test ended before a look decided it, when it did.
    #[serde(
        default,
        deserialize_with = "crate::trial_candidates::lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub stop: Option<RealPlayStop>,
}

// ─── Reading sessions ──────────────────────────────────────────────────────────

fn instant(at: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(at).ok().map(|t| t.with_timezone(&Utc))
}

/// When the session ended: its start plus its length, or `None` when its start can't be read or the
/// sum lies past the last date chrono can hold (a corrupt length). Such a session never counts.
fn ended(s: &SessionSummary) -> Option<DateTime<Utc>> {
    let length = Duration::try_seconds(i64::try_from(s.duration_secs).ok()?)?;
    instant(&s.started_at)?.checked_add_signed(length)
}

fn same_game(s: &SessionSummary, game: &str) -> bool {
    let (a, b) = (s.process_name.trim(), game.trim());
    !a.is_empty() && a.eq_ignore_ascii_case(b)
}

/// A session that can count on either side, by its own record: long enough, measured, in front,
/// with a length that adds up.
fn countable(s: &SessionSummary) -> bool {
    !s.behind_the_whole_time() && s.samples >= MIN_READINGS && crate::experiment::has_frame_reading(s) && ended(s).is_some()
}

/// The session recorded its Compy changes the way real play reads them: the ones on and the ones
/// Compy couldn't confirm apart (453-f1), in whole or since a set-aside (#618). An older Compy
/// counted a change it couldn't read as on, so no later session can be shown to have this Trial's
/// change on against such a session: it is never pinned as an as-is session.
fn counts_each_change(s: &SessionSummary) -> bool {
    let whole = s.compy_changes_per_change && s.compy_changes_active.is_some() && s.compy_changes_cant_confirm.is_some();
    whole || s.compy_changes_since_set_aside.as_ref().is_some_and(|c| c.active.is_some())
}

/// The session with this id, when exactly one has it.
fn unique<'s>(sessions: &'s [SessionSummary], id: &str) -> Option<&'s SessionSummary> {
    let mut hits = sessions.iter().filter(|s| s.started_at == id);
    match (hits.next(), hits.next()) {
        (Some(s), None) => Some(s),
        _ => None,
    }
}

/// The as-is session the with-sessions are checked against: the newest pinned one still in the
/// session store. They are one unchanged run (same conditions, Gaming Mode and Compy changes), so
/// any of them stands for all.
pub(crate) fn reference_session<'s>(before: &[RealPlaySession], sessions: &'s [SessionSummary]) -> Option<&'s SessionSummary> {
    before.iter().rev().find_map(|b| unique(sessions, &b.session_id))
}

/// The newest session of the game that can count on either side: the one a real-play start would
/// pin as its newest as-is session.
pub(crate) fn newest_countable<'s>(game: &str, sessions: &'s [SessionSummary]) -> Option<&'s SessionSummary> {
    sessions
        .iter()
        .filter(|s| same_game(s, game) && countable(s))
        .filter_map(|s| Some((instant(&s.started_at)?, s)))
        .max_by_key(|(at, _)| *at)
        .map(|(_, s)| s)
}

/// The geometric means of the 1% low and the average over `sessions` (the arms are judged on their
/// logs), or `None` when there is no session or a reading isn't real. Written on a real-play record
/// so an older Compy reads a pair Trial against the as-is sessions together, not against one of them.
pub(crate) fn geometric_means(sessions: &[RealPlaySession]) -> Option<(f64, f64)> {
    if sessions.is_empty() || !sessions.iter().all(RealPlaySession::readable) {
        return None;
    }
    let mean = |f: fn(&RealPlaySession) -> f64| (sessions.iter().map(|s| f(s).ln()).sum::<f64>() / sessions.len() as f64).exp();
    Some((mean(|s| s.low1_fps), mean(|s| s.avg_fps)))
}

/// The newest session of the game that began after the change took effect, counted or not: the one
/// a reported crash is pinned on (`experiment::crash_outcome`).
pub(crate) fn newest_after<'s>(game: &str, applied_at: &str, sessions: &'s [SessionSummary]) -> Option<&'s SessionSummary> {
    let applied = instant(applied_at)?;
    sessions
        .iter()
        .filter(|s| same_game(s, game))
        .filter_map(|s| Some((instant(&s.started_at)?, s)))
        .filter(|(at, _)| *at > applied)
        .max_by_key(|(at, _)| *at)
        .map(|(_, s)| s)
}

/// Pure (P5-realplay): the as-is sessions a real-play start pins, oldest first: the unchanged run
/// that ends at `anchor` (`noise_floor::current_unchanged_run` within
/// `comparison::ARM_MAX_AGE_DAYS`: same game, rig, driver, Windows and game build, comparable
/// conditions, Gaming Mode state and Compy changes, nothing Compy applied or undone between them),
/// trimmed by [`pin_before`]. A run split off by any change never counts, nor does anything older
/// than 14 days. Fewer than [`MIN_SESSIONS`] means a start refuses before anything is recorded.
pub(crate) fn before_arm(
    sessions: &[SessionSummary],
    anchor: &SessionSummary,
    ledger: &[LedgerEntryRef<'_>],
    now: DateTime<Utc>,
) -> Vec<RealPlaySession> {
    let run = crate::noise_floor::current_unchanged_run(sessions, anchor, ledger, crate::comparison::ARM_MAX_AGE_DAYS);
    pin_before(&run, anchor, now)
}

/// The before arm, from the unchanged run that ends at `anchor` (oldest first): the run's sessions
/// that can count and recorded each Compy change apart ([`counts_each_change`]), started within
/// `comparison::ARM_MAX_AGE_DAYS` before `now`, the newest [`MAX_SESSIONS`]. Empty unless the anchor
/// itself is the newest of them, so the anchor the record names is always its newest as-is session
/// ([`unpinnable_anchor`] says why it isn't).
fn pin_before(run: &[&SessionSummary], anchor: &SessionSummary, now: DateTime<Utc>) -> Vec<RealPlaySession> {
    let from = now - Duration::days(crate::comparison::ARM_MAX_AGE_DAYS);
    let kept: Vec<&SessionSummary> = run
        .iter()
        .copied()
        .filter(|s| countable(s) && counts_each_change(s))
        .filter(|s| instant(&s.started_at).is_some_and(|at| at >= from && at <= now))
        .collect();
    if kept.last().map(|s| s.started_at.as_str()) != Some(anchor.started_at.as_str()) {
        return Vec::new();
    }
    kept[kept.len().saturating_sub(MAX_SESSIONS)..].iter().map(|s| RealPlaySession::of(s)).collect()
}

/// Why `anchor` itself can't be the newest as-is session a real-play start pins, in words, or `None`
/// when it can. When it can't, nothing is pinned however many sessions were played, so a start says
/// this rather than how many count. `sessions` are the ones [`before_arm`] reads.
pub(crate) fn unpinnable_anchor(anchor: &SessionSummary, sessions: &[SessionSummary], now: DateTime<Utc>) -> Option<String> {
    let days = crate::comparison::ARM_MAX_AGE_DAYS;
    if anchor.behind_the_whole_time() {
        return Some("the game was behind another window the whole time".into());
    }
    if anchor.samples < MIN_READINGS {
        return Some(format!("it has fewer than {MIN_READINGS} readings"));
    }
    if !crate::experiment::has_frame_reading(anchor) {
        return Some("it has no frame-rate reading".into());
    }
    if ended(anchor).is_none() {
        return Some("its recorded length can't be added to its start".into());
    }
    if !counts_each_change(anchor) {
        return Some("an older version of Compy recorded it, before each change was counted on its own".into());
    }
    match instant(&anchor.started_at) {
        Some(at) if at < now - Duration::days(days) => return Some(format!("it was played more than {days} days ago")),
        Some(at) if at > now => return Some("it began later than this PC's clock reads now".into()),
        None => return Some("its start time can't be read".into()),
        Some(_) => {}
    }
    if unique(sessions, &anchor.started_at).is_none() || crate::noise_floor::NoiseConditions::of_session(anchor).is_none() {
        return Some(
            "Compy can't show what the PC was like during it (its rig and conditions weren't recorded, or the change \
             history doesn't reach back to it)"
                .into(),
        );
    }
    None
}

/// A running real-play Trial, as the session classifier reads it from its record.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Running<'a> {
    /// The game's process name.
    pub game: &'a str,
    /// When the start began: only a session begun after it is a candidate.
    pub created_at: &'a str,
    /// When the apply returned: the change was on from here.
    pub applied_at: &'a str,
    /// The Trust Ledger row of this Trial's own change.
    pub applied_change_id: &'a str,
    /// The pinned as-is sessions, oldest first.
    pub before: &'a [RealPlaySession],
}

/// Which with-change sessions count right now, which don't and why, and whether the Trial can go on.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WithArm<'s> {
    /// Counted, oldest first.
    pub counted: Vec<&'s SessionSummary>,
    /// Not counted, oldest first, every one (the record keeps the newest [`MAX_NOT_COUNTED`]).
    pub not_counted: Vec<NotCounted>,
    pub stop: Option<RealPlayStop>,
    /// The first session whose rig, driver, Windows or game build or capture method changed, and its
    /// pairing with the reference: an early end is judged by it (`experiment::with_comparability`).
    pub changed: Option<(&'s SessionSummary, SessionComparability)>,
    /// The as-is session the with-sessions were checked against ([`reference_session`]).
    pub reference: Option<&'s SessionSummary>,
}

impl WithArm<'_> {
    pub(crate) fn counted_numbers(&self) -> Vec<RealPlaySession> {
        self.counted.iter().map(|s| RealPlaySession::of(s)).collect()
    }
}

/// How a session's Compy-change counts compare with the as-is sessions'.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Counts {
    /// Exactly this Trial's one change more, read as on (`sessions::ChangeCounts::adds_one_active_change`).
    ThisOneMore,
    /// One change more that nothing shows on: one Compy couldn't confirm (453-f1), or counted the older
    /// way, which counted a change it couldn't read as on.
    Unconfirmed,
    /// The same as the as-is sessions: the change wasn't on.
    Same,
    /// Anything else.
    Other,
    /// One side recorded no count.
    Unrecorded,
}

fn counts_vs(reference: &SessionSummary, s: &SessionSummary) -> Counts {
    match crate::sessions::comparable_change_counts(reference, s) {
        Err(_) => Counts::Unrecorded,
        Ok((then, after)) if then.adds_one_active_change(after) => Counts::ThisOneMore,
        Ok((then, after)) if then.adds_one_change(after) => Counts::Unconfirmed,
        Ok((then, after)) if then == after => Counts::Same,
        Ok(_) => Counts::Other,
    }
}

/// The earliest moment another Compy change (any Trust Ledger row but `own`) was applied or undone
/// after the Trial began. A time that can't be read counts as the start itself, and a start that
/// can't be read makes every row count: an unknown never passes as "nothing moved".
fn other_change_since(ledger: &[LedgerEntryRef<'_>], own: &str, began: Option<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    let moved = |at: &str| match (instant(at), began) {
        (Some(t), Some(b)) => (t > b).then_some(t),
        (None, Some(b)) => Some(b),
        (_, None) => Some(DateTime::<Utc>::MIN_UTC),
    };
    ledger
        .iter()
        .filter(|c| c.id != own)
        .flat_map(|c| [Some(c.applied_at), c.rolled_back_at])
        .flatten()
        .filter_map(moved)
        .min()
}

/// What one candidate session comes to.
enum Count {
    Counted,
    Not(NotCountedReason),
    /// The newest session, waiting for a live read of the setting that worked.
    Pending,
}

/// Pure (P5-realplay): which sessions of the game, played while the Trial ran, count right now. A
/// session counts only when it began after the change took effect and within [`WINDOW_DAYS`], is
/// long enough, measured and in front, with a length that adds up, ran with no other Compy change
/// applied or undone before it ended, under the reference's rig, driver, Windows and game build and
/// fully comparable conditions, with the same Gaming Mode state and the reference's Compy changes
/// plus this one, read as on (never one Compy couldn't confirm), at its start, and is bracketed: the
/// next observation after it still shows the change on (the next session's start counts, in any
/// game, unless another Compy change moved before it began; for the newest session, `live`, the
/// setting read now: `None` when it can't be read, and then that session waits).
///
/// `stop` is why the Trial can't go on as it is, in this order: its own change was undone in
/// history, another Compy change moved, a permanent condition changed, the setting reads off now,
/// the window is over, the setting can't be read now, the as-is sessions are all gone.
pub(crate) fn with_arm<'s>(
    trial: &Running<'_>,
    sessions: &'s [SessionSummary],
    ledger: &[LedgerEntryRef<'_>],
    live: Option<bool>,
    now: DateTime<Utc>,
) -> WithArm<'s> {
    let reference = reference_session(trial.before, sessions);
    let applied = instant(trial.applied_at);
    let began = instant(trial.created_at);
    let until = applied.map(|a| a + Duration::days(WINDOW_DAYS));
    let put_back = ledger.iter().any(|c| c.id == trial.applied_change_id && !c.applied);
    let other_moved = other_change_since(ledger, trial.applied_change_id, began);
    // Every session, any game, in time order: the next observation after a session is the next one here.
    let mut timeline: Vec<(DateTime<Utc>, &SessionSummary)> =
        sessions.iter().filter_map(|s| Some((instant(&s.started_at)?, s))).collect();
    timeline.sort_by_key(|(at, _)| *at);

    let mut arm = WithArm { counted: Vec::new(), not_counted: Vec::new(), stop: None, changed: None, reference };
    let mut permanent = false;
    if let (Some(reference), Some(applied), Some(began)) = (reference, applied, began) {
        let conditions = crate::noise_floor::NoiseConditions::of_session(reference);
        for (i, &(at, s)) in timeline.iter().enumerate() {
            if !same_game(s, trial.game) || at <= began {
                continue;
            }
            let pairing = crate::comparability::derive(reference, s);
            if at > applied && pairing.changed_keys.iter().any(|k| PERMANENT_CHANGES.contains(&k.as_str())) {
                permanent = true;
                if arm.changed.is_none() {
                    arm.changed = Some((s, pairing.clone()));
                }
            }
            let next = timeline.get(i + 1).copied();
            let count = count_session(s, at, applied, until, other_moved, reference, conditions.as_ref(), &pairing, next, live);
            match count {
                Count::Counted => arm.counted.push(s),
                Count::Not(reason) => arm.not_counted.push(NotCounted { session_id: s.started_at.clone(), reason }),
                Count::Pending => {}
            }
        }
    }
    arm.stop = if put_back {
        Some(RealPlayStop::PutBackInHistory)
    } else if other_moved.is_some() {
        Some(RealPlayStop::OtherChange)
    } else if permanent {
        Some(RealPlayStop::Conditions)
    } else if live == Some(false) {
        Some(RealPlayStop::ChangeOff)
    } else if until.is_some_and(|u| now > u) {
        Some(RealPlayStop::WindowOver)
    } else if live.is_none() {
        Some(RealPlayStop::Unreadable)
    } else if reference.is_none() {
        Some(RealPlayStop::BeforeMissing)
    } else {
        None
    };
    arm
}

/// One candidate session against the rules [`with_arm`] names, in that order.
#[allow(clippy::too_many_arguments)]
fn count_session(
    s: &SessionSummary,
    at: DateTime<Utc>,
    applied: DateTime<Utc>,
    until: Option<DateTime<Utc>>,
    other_moved: Option<DateTime<Utc>>,
    reference: &SessionSummary,
    conditions: Option<&crate::noise_floor::NoiseConditions>,
    pairing: &SessionComparability,
    next: Option<(DateTime<Utc>, &SessionSummary)>,
    live: Option<bool>,
) -> Count {
    use NotCountedReason as R;
    if at <= applied {
        return Count::Not(R::BeforeChange);
    }
    if until.is_some_and(|u| at > u) {
        return Count::Not(R::AfterWindow);
    }
    if s.behind_the_whole_time() {
        return Count::Not(R::Behind);
    }
    if s.samples < MIN_READINGS {
        return Count::Not(R::TooShort);
    }
    if !crate::experiment::has_frame_reading(s) {
        return Count::Not(R::NoReading);
    }
    let Some(end) = ended(s) else {
        return Count::Not(R::Other);
    };
    if other_moved.is_some_and(|t| t <= end) {
        return Count::Not(R::OtherCompyChange);
    }
    let still_current = conditions
        .zip(crate::noise_floor::NoiseConditions::of_session(s))
        .is_some_and(|(then, now)| crate::noise_floor::still_current(then, &now));
    if !still_current || pairing.verdict != Comparability::Comparable || !pairing.changed_context.is_empty() {
        return Count::Not(R::ConditionsChanged);
    }
    if reference.gaming_mode_active.is_none() || reference.gaming_mode_active != s.gaming_mode_active {
        return Count::Not(R::GamingModeDiffers);
    }
    match counts_vs(reference, s) {
        Counts::ThisOneMore => {}
        Counts::Same | Counts::Unconfirmed | Counts::Unrecorded => return Count::Not(R::ChangeNotOn),
        Counts::Other => return Count::Not(R::OtherCompyChange),
    }
    let still_on = match next {
        // Another Compy change moved before the next observation began, so that check can't show this
        // change stayed on: the other change is why this session can't be bracketed.
        Some((next_at, _)) if other_moved.is_some_and(|t| t <= next_at) => return Count::Not(R::OtherCompyChange),
        Some((_, next)) => Some(counts_vs(reference, next) == Counts::ThisOneMore),
        None => live,
    };
    match still_on {
        Some(true) => Count::Counted,
        Some(false) => Count::Not(R::ChangeNotOn),
        None => Count::Pending,
    }
}

// ─── Judging ───────────────────────────────────────────────────────────────────

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// A log-scale amount as a percent: (e^x − 1)·100.
fn pct(log: f64) -> f64 {
    log.exp_m1() * 100.0
}

/// What one look measured on a prefix of the with-change sessions.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Look {
    /// 1, 2 or 3.
    pub ordinal: u8,
    /// How many with-change sessions it judged (the prefix).
    pub with: usize,
    /// How many as-is sessions it judged against.
    pub before: usize,
    /// ± band, in %, rounded to 0.1: the wider of the two metrics' bands, never below 3%.
    pub band_pct: f64,
    /// The effect, in %, rounded to 0.1: (e^d − 1)·100, d the difference of the arms' mean logs.
    pub delta_low1_pct: f64,
    pub delta_avg_pct: f64,
    /// The pooled within-arm spread of each metric, in %, rounded to 0.1: how much sessions varied on
    /// their own, for the receipt. Descriptive only; the band judges each arm on its own spread.
    pub low1_spread_pct: f64,
    pub avg_spread_pct: f64,
}

/// Where the looks stand.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Judgement {
    /// Fewer than [`MIN_SESSIONS`] with-change sessions counted: no look yet.
    TooFew,
    /// Every look so far left it open; the next is due at `next` counted sessions.
    Collecting { next: usize, last: Look },
    /// A look decided: the outcome a conclude records (before the conclude's own checks).
    Decided { look: Look, outcome: ConcludeOutcome },
}

/// One metric of one look, on the logs: the effect, its ± half-width, and the pooled spread.
struct Metric {
    /// d = mean(ln with) − mean(ln before).
    effect: f64,
    /// t·SE on Welch's terms, never assuming the arms vary alike.
    half_width: f64,
    /// The pooled within-arm SD: descriptive only ([`Look::low1_spread_pct`]).
    spread: f64,
}

/// One metric's Welch comparison: SE = √(s_b²/n + s_w²/m), each arm its own sample variance, and
/// t at Satterthwaite's degrees of freedom, (s_b²/n + s_w²/m)² / ((s_b²/n)²/(n−1) + (s_w²/m)²/(m−1)),
/// which lie between min(n, m) − 1 and n + m − 2 (clamped there against rounding, and the cautious
/// end when they can't be computed). Real play's two arms are played on different days, often in
/// different matches, so one can swing far more than the other; a pooled SD that assumes they don't
/// read Likely in up to 21% of Trials with no effect (review of 59fc753). Both arms at zero spread
/// leave nothing to scale, and the band is the fixed floor.
fn metric(before: &[&RealPlaySession], with: &[&RealPlaySession], f: fn(&RealPlaySession) -> f64) -> Option<Metric> {
    let (n, m) = (before.len(), with.len());
    if n < 2 || m < 2 {
        return None;
    }
    let arm = |xs: &[&RealPlaySession]| -> (f64, f64) {
        let logs: Vec<f64> = xs.iter().map(|s| f(s).ln()).collect();
        let mean = logs.iter().sum::<f64>() / logs.len() as f64;
        (mean, logs.iter().map(|x| (x - mean).powi(2)).sum::<f64>())
    };
    let ((mean_before, ss_before), (mean_with, ss_with)) = (arm(before), arm(with));
    let (nf, mf) = (n as f64, m as f64);
    // Each arm's variance of its mean.
    let (vb, vw) = (ss_before / (nf - 1.0) / nf, ss_with / (mf - 1.0) / mf);
    let se2 = vb + vw;
    let half_width = if se2 > 0.0 {
        let (low, high) = ((n.min(m) - 1) as f64, (n + m - 2) as f64);
        let df = se2.powi(2) / (vb.powi(2) / (nf - 1.0) + vw.powi(2) / (mf - 1.0));
        let df = if df.is_finite() { df.clamp(low, high) } else { low };
        t_critical(df)? * se2.sqrt()
    } else {
        0.0
    };
    Some(Metric { effect: mean_with - mean_before, half_width, spread: ((ss_before + ss_with) / (nf + mf - 2.0)).sqrt() })
}

/// The measurements of one look: per metric, [`metric`]'s effect and a band of max(t·SE, ln 1.03);
/// the band used is the wider of the two metrics'.
fn measure(before: &[&RealPlaySession], with: &[&RealPlaySession], ordinal: u8) -> Option<Look> {
    let low = metric(before, with, |s| s.low1_fps)?;
    let avg = metric(before, with, |s| s.avg_fps)?;
    let band = |m: &Metric| pct(m.half_width).max(DEFAULT_NOISE_FLOOR_PCT);
    let look = Look {
        ordinal,
        with: with.len(),
        before: before.len(),
        band_pct: round1(band(&low).max(band(&avg))),
        delta_low1_pct: round1(pct(low.effect)),
        delta_avg_pct: round1(pct(avg.effect)),
        low1_spread_pct: round1(pct(low.spread)),
        avg_spread_pct: round1(pct(avg.spread)),
    };
    let numbers = [look.band_pct, look.delta_low1_pct, look.delta_avg_pct, look.low1_spread_pct, look.avg_spread_pct];
    numbers.iter().all(|x| x.is_finite()).then_some(look)
}

fn too_noisy(judged: ConcludeOutcome, look: &Look) -> ConcludeOutcome {
    ConcludeOutcome {
        verdict: "too-noisy".into(),
        keep: false,
        stop_reason: Some("sessions-too-varied".into()),
        confidence: Confidence::Unknown,
        note: format!(
            "Too varied to judge: your sessions varied by about ±{}% on their own, too much to tell this \
             change's effect after {} sessions with it on and {} without, so Compy restored it and judged \
             nothing.",
            look.band_pct, look.with, look.before
        ),
        ..judged
    }
}

/// One look's decision, or `None` to keep collecting. The verdict is `comparison::classify` on the
/// 1% low against the band, read as the picked outcome (`experiment::with_recommended_outcome` /
/// `with_max_fps_outcome`). Better or Worse decides; otherwise a band of [`SETTLED_BAND_PCT`] or
/// less decides No clear difference; at the final look a band of [`USEFUL_BAND_PCT`] or less does,
/// and a wider one is Unknown. Smoothest isn't judged in real play: frame pacing isn't compared
/// across real-play sessions, so such a record ends unjudged at its first look.
fn decide(look: &Look, outcome: TrialOutcome, is_final: bool) -> Option<ConcludeOutcome> {
    let verdict = crate::comparison::classify(look.delta_low1_pct, look.band_pct).to_string();
    let base = ConcludeOutcome {
        keep: crate::experiment::keep_rule(crate::experiment::trial_result_for(&verdict)),
        verdict,
        delta_low1_pct: look.delta_low1_pct,
        stop_reason: None,
        confidence: Confidence::Medium,
        note: format!(
            "Real play: {} sessions with the change on, against {} sessions as the PC was before it, played \
             however you play. The band is how much those sessions vary on their own.",
            look.with, look.before
        ),
    };
    let judged = match outcome {
        TrialOutcome::Recommended => {
            crate::experiment::with_recommended_outcome(base, look.band_pct, Some(look.delta_avg_pct))
        }
        TrialOutcome::MaxFps => crate::experiment::with_max_fps_outcome(base, look.band_pct, Some(look.delta_avg_pct)),
        TrialOutcome::Smoothest => {
            return Some(ConcludeOutcome {
                verdict: "insufficient-evidence".into(),
                keep: false,
                stop_reason: Some("real-play-smoothest-unsupported".into()),
                confidence: Confidence::Unknown,
                note: "Real play doesn't compare frame pacing across sessions, so a Smoothest test can't be \
                       judged this way. Compy restored the change and judged nothing."
                    .into(),
                ..base
            })
        }
    };
    match judged.verdict.as_str() {
        "improved" | "regressed" => Some(judged),
        _ if look.band_pct <= SETTLED_BAND_PCT => Some(judged),
        _ if is_final && look.band_pct <= USEFUL_BAND_PCT => Some(judged),
        _ if is_final => Some(too_noisy(judged, look)),
        _ => None,
    }
}

/// Pure (P5-realplay): where the looks stand for these arms. `with` is every counted with-change
/// session, oldest first; the looks happen at [`LOOKS`] counted sessions, each on the chronological
/// prefix, so a late read never changes a verdict an earlier read would have given. The final look
/// is at [`MAX_SESSIONS`], or at whatever was counted when `final_look_due` (the Trial was stopped:
/// window over, change off, another Compy change, conditions changed). Never more than three looks.
pub(crate) fn judge(
    before: &[RealPlaySession],
    with: &[RealPlaySession],
    outcome: TrialOutcome,
    final_look_due: bool,
) -> Judgement {
    let before: Vec<&RealPlaySession> = before.iter().filter(|s| s.readable()).collect();
    let before = &before[before.len().saturating_sub(MAX_SESSIONS)..];
    let with: Vec<&RealPlaySession> = with.iter().filter(|s| s.readable()).take(MAX_SESSIONS).collect();
    if before.len() < MIN_SESSIONS || with.len() < MIN_SESSIONS {
        return Judgement::TooFew;
    }
    let counted = with.len();
    let final_due = final_look_due || counted >= MAX_SESSIONS;
    let mut at: Vec<usize> = LOOKS.iter().copied().filter(|&k| k <= counted).collect();
    if final_due && at.last() != Some(&counted) {
        at.push(counted);
    }
    let mut last = None;
    for (i, &k) in at.iter().enumerate() {
        let Some(look) = measure(before, &with[..k], (i + 1) as u8) else { continue };
        let is_final = final_due && i + 1 == at.len();
        if let Some(outcome) = decide(&look, outcome, is_final) {
            return Judgement::Decided { look, outcome };
        }
        last = Some(look);
    }
    match last {
        Some(last) => Judgement::Collecting { next: LOOKS.iter().copied().find(|&k| k > counted).unwrap_or(MAX_SESSIONS), last },
        None => Judgement::TooFew,
    }
}

// ─── Progress (what `experiment::get_realplay_progress` hands the webview) ───────────

/// Where a game's real play stands. Serialized kebab-case.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RealPlayPhase {
    /// No real-play Trial of this game is running, and fewer than [`MIN_SESSIONS`] as-is sessions count.
    CollectingBefore,
    /// No Trial running, and enough as-is sessions count: a start applies the change at once.
    ReadyToStart,
    /// The change is on and Compy keeps collecting.
    Collecting,
    /// A look decided: concluding now records it.
    Ready,
    /// The Trial can't go on as it is (`stop` says why): concluding closes it.
    Stopped,
}

/// A game's real-play progress, for the journey's panel. Every count is a count of real records;
/// nothing is estimated.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct RealPlayProgress {
    pub phase: RealPlayPhase,
    /// The game's process name.
    pub game: String,
    /// The running real-play Trial, in the running phases.
    pub experiment_id: Option<String>,
    /// Before a start, the session a start would pin as its newest as-is session.
    pub anchor_session_id: Option<String>,
    /// As-is sessions counted: pinned ones while running, available ones before a start.
    pub before: usize,
    /// With-change sessions counted so far.
    pub with: usize,
    /// What the next step needs: [`MIN_SESSIONS`] as-is sessions before a start; while running, the
    /// count of the next look (or the deciding look's, when ready).
    pub need: usize,
    pub min_sessions: usize,
    pub max_sessions: usize,
    /// Readings a session needs to count (about one a second).
    pub min_readings: u32,
    pub window_days: i64,
    /// The band at the newest look, in %, while running and once three sessions count.
    pub band_pct: Option<f64>,
    /// When the change took effect, and when the window ends.
    pub applied_at: Option<String>,
    pub until: Option<String>,
    pub stop: Option<RealPlayStop>,
    /// The newest [`MAX_NOT_COUNTED`] sessions not counted, oldest first.
    pub not_counted: Vec<NotCounted>,
}

impl RealPlayProgress {
    fn new(phase: RealPlayPhase, game: &str) -> Self {
        RealPlayProgress {
            phase,
            game: game.to_string(),
            experiment_id: None,
            anchor_session_id: None,
            before: 0,
            with: 0,
            need: MIN_SESSIONS,
            min_sessions: MIN_SESSIONS,
            max_sessions: MAX_SESSIONS,
            min_readings: MIN_READINGS,
            window_days: WINDOW_DAYS,
            band_pct: None,
            applied_at: None,
            until: None,
            stop: None,
            not_counted: Vec::new(),
        }
    }
}

/// The newest [`MAX_NOT_COUNTED`] of `all`, oldest first.
pub(crate) fn newest_not_counted(all: &[NotCounted]) -> Vec<NotCounted> {
    all[all.len().saturating_sub(MAX_NOT_COUNTED)..].to_vec()
}

/// Pure: a game's progress before any real-play Trial of it runs, from the as-is sessions a start
/// would pin now.
pub(crate) fn before_start_progress(game: &str, before: &[RealPlaySession]) -> RealPlayProgress {
    let phase = if before.len() >= MIN_SESSIONS { RealPlayPhase::ReadyToStart } else { RealPlayPhase::CollectingBefore };
    RealPlayProgress {
        before: before.len(),
        anchor_session_id: before.last().map(|s| s.session_id.clone()),
        ..RealPlayProgress::new(phase, game)
    }
}

/// Pure: a running real-play Trial's progress, from its arms read now. A stop comes first: a Trial
/// that can't go on is never shown as ready to keep a result.
pub(crate) fn progress(experiment_id: &str, trial: &Running<'_>, arm: &WithArm<'_>, judgement: &Judgement) -> RealPlayProgress {
    let (phase, need, band_pct) = match judgement {
        Judgement::Decided { look, .. } => (RealPlayPhase::Ready, look.with, Some(look.band_pct)),
        Judgement::Collecting { next, last } => (RealPlayPhase::Collecting, *next, Some(last.band_pct)),
        Judgement::TooFew => (RealPlayPhase::Collecting, MIN_SESSIONS, None),
    };
    let phase = if arm.stop.is_some() { RealPlayPhase::Stopped } else { phase };
    let until = instant(trial.applied_at).map(|a| (a + Duration::days(WINDOW_DAYS)).to_rfc3339());
    RealPlayProgress {
        experiment_id: Some(experiment_id.to_string()),
        before: trial.before.len(),
        with: arm.counted.len(),
        need,
        band_pct,
        applied_at: Some(trial.applied_at.to_string()),
        until,
        stop: arm.stop,
        not_counted: newest_not_counted(&arm.not_counted),
        ..RealPlayProgress::new(phase, trial.game)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fuzz_support::Rng;

    const WARDOGS: &str = "WardogsClient-Win64-Shipping.exe";
    const CREATED: &str = "2026-10-20T19:30:00+00:00";
    const APPLIED: &str = "2026-10-20T19:31:00+00:00";
    const OWN: &str = "own-change";

    fn now() -> DateTime<Utc> {
        instant("2026-10-23T12:00:00+00:00").unwrap()
    }

    /// A fully recorded 20-minute WARDOGS session on the owner's rig with `active` Compy changes at
    /// its start, as `sessions.json` stores one.
    fn played(started_at: &str, low1: f64, avg: f64, active: usize) -> SessionSummary {
        SessionSummary {
            started_at: started_at.into(),
            duration_secs: 1200,
            process_name: WARDOGS.into(),
            samples: 1170,
            avg_fps: avg,
            avg_frametime_ms: 1000.0 / avg,
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
            hw_fingerprint: Some(crate::hardware::HwFingerprint {
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

    fn numbers(low1: &[f64], avg: &[f64]) -> Vec<RealPlaySession> {
        low1.iter()
            .zip(avg)
            .enumerate()
            .map(|(i, (&l, &a))| RealPlaySession { session_id: format!("s{i}"), low1_fps: l, avg_fps: a, samples: 1200 })
            .collect()
    }

    fn flat(low1: &[f64]) -> Vec<RealPlaySession> {
        numbers(low1, &vec![240.0; low1.len()])
    }

    fn decided(j: Judgement) -> (Look, ConcludeOutcome) {
        match j {
            Judgement::Decided { look, outcome } => (look, outcome),
            other => panic!("expected a decision, got {other:?}"),
        }
    }

    // ─── judge ─────────────────────────────────────────────────────────────────

    #[test]
    #[allow(clippy::approx_constant)]
    fn the_t_table_is_the_bonferroni_t_and_never_narrower_than_the_normal() {
        // Welch's degrees of freedom go down to 2 with three sessions a side (review of 59fc753).
        assert_eq!((t_critical(2.0), t_critical(3.0), t_critical(4.0)), (Some(7.649), Some(4.857), Some(3.961)));
        assert_eq!(t_critical(14.0), Some(2.718));
        assert_eq!(t_critical(1.9), None, "below Welch's least df for three sessions a side, nothing is judged");
        assert_eq!(t_critical(f64::NAN), None);
        assert_eq!(t_critical(40.0), Some(2.718), "beyond the table the df-14 value is the cautious one");
        assert!(T_CRITICAL.windows(2).all(|w| w[0] > w[1]), "decreasing with df");
        // z at α = 0.05/3 two-sided is 2.394: a t value is always wider than it.
        assert!(T_CRITICAL.iter().all(|&t| t > 2.394), "{T_CRITICAL:?}");
        assert_eq!(T_CRITICAL.len(), 2 * MAX_SESSIONS - 2 - T_FIRST_DF + 1, "df 2 (Welch, 3 a side) to 14 (8 + 8)");
        // Between whole df the line between them: never below the exact t, and within 10% of it.
        // scipy.stats.t.ppf(1 - 0.05/6, df) for these df is 5.7842, 4.3135, 3.3497, 2.8437, 2.7285.
        for (df, exact) in [(2.5, 5.7842), (3.5, 4.3135), (5.7, 3.3497), (10.5, 2.8437), (13.6, 2.7285)] {
            let t = t_critical(df).unwrap();
            assert!(t >= exact - 0.0005 && t < exact * 1.1, "df {df}: {t} against {exact}");
        }
    }

    #[test]
    fn wardogs_idle_sessions_read_no_clear_difference_at_the_first_look() {
        // The owner's idle WARDOGS sessions, 2026-10-29: 211/214/212 as-is, 213/212/214 with the change.
        let j = judge(&flat(&[211.0, 214.0, 212.0]), &flat(&[213.0, 212.0, 214.0]), TrialOutcome::Recommended, false);
        let (look, o) = decided(j);
        assert_eq!((look.ordinal, look.with, look.band_pct), (1, 3, 3.0), "{look:?}");
        assert_eq!((o.verdict.as_str(), o.keep, o.confidence), ("no-change", false, Confidence::Medium));
        assert_eq!(o.stop_reason, None, "judged against the band, so its noise evidence is recorded");
        assert!(o.note.starts_with("Real play: 3 sessions with the change on, against 3 sessions"), "{}", o.note);
        assert!(o.note.contains("The 1% low stayed inside the band"), "{}", o.note);
    }

    #[test]
    fn a_twelve_percent_gain_reads_likely_better_and_is_kept_at_medium() {
        let j = judge(&flat(&[211.0, 214.0, 212.0]), &flat(&[237.0, 239.0, 238.0]), TrialOutcome::Recommended, false);
        let (look, o) = decided(j);
        assert_eq!((look.ordinal, look.delta_low1_pct), (1, 12.1), "{look:?}");
        assert_eq!((o.verdict.as_str(), o.keep, o.confidence), ("improved", true, Confidence::Medium));
        // Never more than Medium: two arms of real play are not a controlled bench pair.
        assert!(o.note.contains("the 1% low +12.1%, the average frame rate 0%, both against a ±3% band"), "{}", o.note);
    }

    #[test]
    fn pbz_swings_keep_collecting_at_three_and_five_and_read_unknown_at_eight() {
        // PBZ, 2026-10-29: whole sessions 172 / 132 / 178 on the 1% low.
        let before = flat(&[172.0, 132.0, 178.0]);
        let with = flat(&[150.0, 181.0, 128.0, 170.0, 141.0, 176.0, 135.0, 166.0]);
        for k in [3, 4, 5, 6, 7] {
            match judge(&before, &with[..k], TrialOutcome::Recommended, false) {
                Judgement::Collecting { next, last } => {
                    assert!(last.band_pct > SETTLED_BAND_PCT, "{k}: {last:?}");
                    assert_eq!(next, if k < 5 { 5 } else { 8 }, "{k}");
                }
                other => panic!("{k}: still collecting, got {other:?}"),
            }
        }
        let j = judge(&before, &with, TrialOutcome::Recommended, false);
        let (look, o) = decided(j);
        assert_eq!((look.ordinal, look.with), (3, 8));
        assert!(look.band_pct > USEFUL_BAND_PCT, "{look:?}");
        assert_eq!((o.verdict.as_str(), o.keep), ("too-noisy", false));
        assert_eq!((o.stop_reason.as_deref(), o.confidence), (Some("sessions-too-varied"), Confidence::Unknown));
        assert!(o.note.starts_with("Too varied to judge: your sessions varied by about ±"), "{}", o.note);
    }

    #[test]
    fn one_outlier_session_among_steady_ones_never_reads_likely() {
        let steady = |x: f64| [x; 8];
        let before = flat(&steady(212.0));
        for drop in [0.85, 0.6, 0.4] {
            for at in 0..8 {
                let mut with: Vec<f64> = steady(212.0).to_vec();
                with[at] *= drop;
                for k in MIN_SESSIONS..=MAX_SESSIONS {
                    for final_due in [false, true] {
                        if let Judgement::Decided { outcome, look } = judge(&before, &flat(&with[..k]), TrialOutcome::Recommended, final_due) {
                            assert!(
                                !matches!(outcome.verdict.as_str(), "improved" | "regressed"),
                                "drop {drop} at {at}, {k} counted, final {final_due}: {look:?} {}",
                                outcome.verdict
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn the_band_never_drops_below_three_percent() {
        let same = flat(&[200.0; 8]);
        for k in MIN_SESSIONS..=MAX_SESSIONS {
            let (look, o) = decided(judge(&same[..3], &same[..k], TrialOutcome::Recommended, true));
            assert_eq!((look.band_pct, look.delta_low1_pct), (3.0, 0.0), "{k}");
            assert_eq!(o.verdict, "no-change");
        }
        // A +3.0% effect sits on the band's edge, which is inside it; +3.5% is beyond.
        let with = flat(&[206.0, 206.0, 206.0]);
        assert_eq!(decided(judge(&same[..3], &with, TrialOutcome::Recommended, false)).1.verdict, "no-change");
        let with = flat(&[207.0, 207.0, 207.0]);
        assert_eq!(decided(judge(&same[..3], &with, TrialOutcome::Recommended, false)).1.verdict, "improved");
    }

    #[test]
    fn the_verdict_is_the_same_whenever_compy_reads_it() {
        // Reading after every session, or once after the eighth, gives one verdict: each look judges
        // the same chronological prefix.
        let mut rng = Rng::seeded(0x5EED);
        for _ in 0..200 {
            let before = flat(&(0..3 + rng.below(6)).map(|_| 200.0 * (1.0 + (rng.below(21) as f64 - 10.0) / 100.0)).collect::<Vec<_>>());
            let with: Vec<f64> = (0..8).map(|_| 205.0 * (1.0 + (rng.below(31) as f64 - 15.0) / 100.0)).collect();
            let at_the_end = judge(&before, &flat(&with), TrialOutcome::Recommended, false);
            let first_decided = (MIN_SESSIONS..=MAX_SESSIONS)
                .map(|k| judge(&before, &flat(&with[..k]), TrialOutcome::Recommended, false))
                .find(|j| matches!(j, Judgement::Decided { .. }))
                .expect("the eighth session always decides");
            assert_eq!(first_decided, at_the_end);
        }
    }

    #[test]
    fn maximum_fps_is_judged_on_the_average() {
        // 1% low flat, average +10%: Recommended has no clear difference, Maximum FPS reads better.
        let before = numbers(&[150.0, 151.0, 150.0], &[240.0, 241.0, 240.0]);
        let with = numbers(&[150.0, 150.0, 151.0], &[264.0, 265.0, 264.0]);
        let (_, rec) = decided(judge(&before, &with, TrialOutcome::Recommended, false));
        assert_eq!((rec.verdict.as_str(), rec.keep), ("no-change", false));
        let (look, max) = decided(judge(&before, &with, TrialOutcome::MaxFps, false));
        assert_eq!((max.verdict.as_str(), max.keep), ("improved", true), "{look:?}");
        assert!(max.note.contains("Judged for Maximum FPS"), "{}", max.note);
        // The average falling beyond the band is Worse for Maximum FPS.
        let fell = numbers(&[150.0, 150.0, 151.0], &[216.0, 215.0, 216.0]);
        assert_eq!(decided(judge(&before, &fell, TrialOutcome::MaxFps, false)).1.verdict, "regressed");
    }

    #[test]
    fn smoothest_is_never_judged_in_real_play() {
        let (_, o) = decided(judge(&flat(&[200.0; 3]), &flat(&[230.0; 3]), TrialOutcome::Smoothest, false));
        assert_eq!((o.verdict.as_str(), o.keep), ("insufficient-evidence", false));
        assert_eq!(o.stop_reason.as_deref(), Some("real-play-smoothest-unsupported"));
    }

    #[test]
    fn a_stopped_trial_takes_its_final_look_on_what_was_counted_and_never_more_than_three() {
        // Four counted when it stopped: looks at 3 and 4; the band 5-10% settles only at the final one.
        let before = flat(&[200.0, 207.0, 196.0]);
        let with = flat(&[204.0, 196.0, 208.0, 199.0]);
        let open = judge(&before, &with, TrialOutcome::Recommended, false);
        let Judgement::Collecting { next: 5, last } = &open else { panic!("{open:?}") };
        assert!(last.band_pct > SETTLED_BAND_PCT && last.band_pct <= USEFUL_BAND_PCT, "{last:?}");
        let (look, o) = decided(judge(&before, &with, TrialOutcome::Recommended, true));
        assert_eq!((look.ordinal, look.with, o.verdict.as_str()), (2, 4, "no-change"));
        // Fewer than three counted is never judged, stopped or not.
        assert_eq!(judge(&before, &with[..2], TrialOutcome::Recommended, true), Judgement::TooFew);
        assert_eq!(judge(&before[..2], &with, TrialOutcome::Recommended, true), Judgement::TooFew);
        // However many were counted, the deciding look is the first, second or third.
        let wide = flat(&[150.0, 181.0, 128.0, 170.0, 141.0, 176.0, 135.0, 166.0, 150.0, 181.0]);
        for k in MIN_SESSIONS..=wide.len() {
            for stop in [false, true] {
                if let Judgement::Decided { look, .. } = judge(&before, &wide[..k], TrialOutcome::Recommended, stop) {
                    assert!((1..=3).contains(&look.ordinal) && look.with <= MAX_SESSIONS, "{k} {stop}: {look:?}");
                }
            }
        }
    }

    #[test]
    fn a_reading_that_isnt_real_is_never_judged() {
        let with = numbers(&[200.0, 0.0, 201.0], &[240.0, 240.0, f64::NAN]);
        assert_eq!(judge(&flat(&[200.0; 3]), &with, TrialOutcome::Recommended, true), Judgement::TooFew);
    }

    /// Box–Muller on the fixed-seed generator: a standard normal draw.
    fn normal(rng: &mut Rng) -> f64 {
        let u = |rng: &mut Rng| ((rng.next_u64() >> 11) as f64 + 0.5) / (1u64 << 53) as f64;
        let (a, b) = (u(rng), u(rng));
        (-2.0 * a.ln()).sqrt() * (std::f64::consts::TAU * b).cos()
    }

    /// Log-normal sessions with no real effect, σ 1–16%: "Likely" (better or worse) at any look, read
    /// after every session, is the false-positive rate the α = 0.05/3 per look caps near 5%.
    #[test]
    fn null_effect_reads_likely_at_most_5_percent() {
        let mut rng = Rng::seeded(0xA5A5_A5A5_A5A5_A5A5);
        let trials = 2000;
        let mut likely = 0;
        for _ in 0..trials {
            let sigma = (1 + rng.below(16)) as f64 / 100.0;
            let n = MIN_SESSIONS + rng.below(MAX_SESSIONS - MIN_SESSIONS + 1);
            let draw = |k: usize, rng: &mut Rng| -> Vec<RealPlaySession> {
                let low: Vec<f64> = (0..k).map(|_| 150.0 * (sigma * normal(rng)).exp()).collect();
                let avg: Vec<f64> = (0..k).map(|_| 240.0 * (sigma * 0.5 * normal(rng)).exp()).collect();
                numbers(&low, &avg)
            };
            let before = draw(n, &mut rng);
            let with = draw(MAX_SESSIONS, &mut rng);
            if let Judgement::Decided { outcome, .. } = judge(&before, &with, TrialOutcome::Recommended, false) {
                if matches!(outcome.verdict.as_str(), "improved" | "regressed") {
                    likely += 1;
                }
            }
        }
        let rate = likely as f64 / trials as f64;
        println!("{likely} of {trials} null Trials read Likely ({:.2}%)", rate * 100.0);
        assert!(rate <= 0.05, "{likely} of {trials} null Trials read Likely ({:.1}%)", rate * 100.0);
    }

    /// The other side of the null tests above: a judge that never says Likely would pass them. At σ 4%
    /// between sessions, a real +10% on both numbers reads Likely better almost always with 8 as-is
    /// sessions, and about half the time with 3. That is the price of Welch's band (review of
    /// 59fc753): it doesn't assume the two arms vary alike, so its first looks, with 3 sessions a side,
    /// have 2 to 4 degrees of freedom. The pooled band's 74% with 3 (plan §1) came from assuming
    /// they do, which read Likely in up to 21% of Trials with no effect when they don't.
    #[test]
    fn a_real_ten_percent_gain_is_found_most_of_the_time() {
        let mut rng = Rng::seeded(0x0F0F_0F0F_0F0F_0F0F);
        let found = |n: usize, rng: &mut Rng| -> f64 {
            let trials = 1000;
            let mut better = 0;
            for _ in 0..trials {
                let draw = |k: usize, gain: f64, rng: &mut Rng| -> Vec<RealPlaySession> {
                    let low: Vec<f64> = (0..k).map(|_| 150.0 * gain * (0.04 * normal(rng)).exp()).collect();
                    let avg: Vec<f64> = (0..k).map(|_| 240.0 * gain * (0.02 * normal(rng)).exp()).collect();
                    numbers(&low, &avg)
                };
                let before = draw(n, 1.0, rng);
                let with = draw(MAX_SESSIONS, 1.1, rng);
                if let Judgement::Decided { outcome, .. } = judge(&before, &with, TrialOutcome::Recommended, false) {
                    if outcome.verdict == "improved" {
                        better += 1;
                    }
                }
            }
            better as f64 / trials as f64
        };
        let (three, eight) = (found(3, &mut rng), found(8, &mut rng));
        println!("a real +10% read Likely better: 3 as-is {three:.3}, 8 as-is {eight:.3}");
        assert!(three >= 0.4 && eight >= 0.9 && eight > three, "3 as-is: {three:.3}, 8 as-is: {eight:.3}");
    }

    // ─── with_arm ──────────────────────────────────────────────────────────────

    fn change<'a>(id: &'a str, applied_at: &'a str, rolled_back_at: Option<&'a str>) -> LedgerEntryRef<'a> {
        LedgerEntryRef { id, rec_id: id, applied_at, applied: rolled_back_at.is_none(), rolled_back_at }
    }

    /// The as-is evening (14 changes on), the change applied at 19:31, then the with-sessions (15).
    fn as_is() -> Vec<SessionSummary> {
        vec![
            played("2026-10-20T18:00:00+00:00", 211.0, 240.0, 14),
            played("2026-10-20T18:30:00+00:00", 214.0, 241.0, 14),
            played("2026-10-20T19:00:00+00:00", 212.0, 240.0, 14),
        ]
    }

    fn with_sessions() -> Vec<SessionSummary> {
        vec![
            played("2026-10-21T18:00:00+00:00", 213.0, 240.0, 15),
            played("2026-10-21T18:30:00+00:00", 212.0, 241.0, 15),
            played("2026-10-21T19:00:00+00:00", 214.0, 240.0, 15),
        ]
    }

    fn ledger() -> Vec<LedgerEntryRef<'static>> {
        vec![change("game-mode", "2026-10-10T14:00:00+00:00", None), change(OWN, APPLIED, None)]
    }

    fn pinned() -> Vec<RealPlaySession> {
        as_is().iter().map(RealPlaySession::of).collect()
    }

    fn arm<'s>(sessions: &'s [SessionSummary], ledger: &[LedgerEntryRef<'_>], live: Option<bool>, before: &[RealPlaySession]) -> WithArm<'s> {
        let trial = Running { game: WARDOGS, created_at: CREATED, applied_at: APPLIED, applied_change_id: OWN, before };
        with_arm(&trial, sessions, ledger, live, now())
    }

    fn all(extra: Vec<SessionSummary>) -> Vec<SessionSummary> {
        as_is().into_iter().chain(with_sessions()).chain(extra).collect()
    }

    fn reasons(a: &WithArm<'_>) -> Vec<(String, NotCountedReason)> {
        a.not_counted.iter().map(|n| (n.session_id.clone(), n.reason)).collect()
    }

    #[test]
    fn three_with_change_sessions_under_the_same_conditions_count() {
        let sessions = all(Vec::new());
        let a = arm(&sessions, &ledger(), Some(true), &pinned());
        assert_eq!(a.counted.len(), 3);
        assert!(a.not_counted.is_empty(), "{:?}", a.not_counted);
        assert_eq!((a.stop, a.reference.map(|s| s.started_at.as_str())), (None, Some("2026-10-20T19:00:00+00:00")));
        let j = judge(&pinned(), &a.counted_numbers(), TrialOutcome::Recommended, false);
        assert_eq!(decided(j).1.verdict, "no-change");
    }

    #[test]
    fn every_session_that_cant_count_is_listed_with_its_reason_and_never_counted() {
        use NotCountedReason as R;
        let at = |t: &str| format!("2026-10-22T{t}:00+00:00");
        let mut short = played(&at("10:00"), 200.0, 240.0, 15);
        short.samples = MIN_READINGS - 1;
        let mut behind = played(&at("10:30"), 0.0, 0.0, 15);
        (behind.samples, behind.avg_fps, behind.avg_frametime_ms, behind.background_secs_excluded) = (0, 0.0, 0.0, Some(1500));
        let mut resolution = played(&at("11:00"), 200.0, 240.0, 15);
        resolution.game_state.as_mut().unwrap().resolution_width = Some(2560);
        let mut gaming = played(&at("11:30"), 200.0, 240.0, 15);
        gaming.gaming_mode_active = Some(true);
        let not_on = played(&at("12:00"), 200.0, 240.0, 14);
        let two_more = played(&at("12:30"), 200.0, 240.0, 16);
        let unrecorded = {
            let mut s = played(&at("13:00"), 200.0, 240.0, 15);
            s.compy_changes_active = None;
            s
        };
        let before_change = played("2026-10-20T19:30:30+00:00", 200.0, 240.0, 15);
        let ok = played(&at("14:00"), 213.0, 240.0, 15);
        let sessions = all(vec![before_change, short, behind, resolution, gaming, not_on, two_more, unrecorded, ok]);
        let a = arm(&sessions, &ledger(), Some(true), &pinned());
        assert_eq!(
            reasons(&a),
            vec![
                ("2026-10-20T19:30:30+00:00".into(), R::BeforeChange),
                (at("10:00"), R::TooShort),
                (at("10:30"), R::Behind),
                (at("11:00"), R::ConditionsChanged),
                (at("11:30"), R::GamingModeDiffers),
                (at("12:00"), R::ChangeNotOn),
                (at("12:30"), R::OtherCompyChange),
                // The session after `unrecorded` shows the change on, but its own start didn't record it.
                (at("13:00"), R::ChangeNotOn),
            ]
        );
        assert_eq!(a.counted.len(), 4, "the three on 10-21 and the 14:00 one");
        assert!(a.counted.iter().all(|s| s.compy_changes_active == Some(15)));
        // A resolution change leaves the session out but doesn't stop the Trial.
        assert_eq!((a.stop, a.changed.is_some()), (None, false));
    }

    #[test]
    fn the_session_just_before_a_check_that_shows_the_change_off_isnt_counted() {
        // 12:00 began with the change on (15), but the next session began without it (14): it may have
        // gone off during 12:00, so 12:00 isn't counted either.
        let sessions = all(vec![
            played("2026-10-22T12:00:00+00:00", 200.0, 240.0, 15),
            played("2026-10-22T13:00:00+00:00", 200.0, 240.0, 14),
        ]);
        let a = arm(&sessions, &ledger(), Some(true), &pinned());
        assert_eq!(a.counted.len(), 3);
        assert_eq!(
            reasons(&a),
            vec![
                ("2026-10-22T12:00:00+00:00".into(), NotCountedReason::ChangeNotOn),
                ("2026-10-22T13:00:00+00:00".into(), NotCountedReason::ChangeNotOn),
            ]
        );
        // The next observation can be a session of another game.
        let mut other_game = played("2026-10-22T13:00:00+00:00", 90.0, 120.0, 14);
        other_game.process_name = "cs2.exe".into();
        let sessions = all(vec![played("2026-10-22T12:00:00+00:00", 200.0, 240.0, 15), other_game]);
        let a = arm(&sessions, &ledger(), Some(true), &pinned());
        assert_eq!(reasons(&a), vec![("2026-10-22T12:00:00+00:00".into(), NotCountedReason::ChangeNotOn)]);
    }

    #[test]
    fn the_newest_session_counts_only_when_the_live_read_shows_the_change_on() {
        let sessions = all(Vec::new());
        assert_eq!(arm(&sessions, &ledger(), Some(true), &pinned()).counted.len(), 3);
        let off = arm(&sessions, &ledger(), Some(false), &pinned());
        assert_eq!(off.counted.len(), 2);
        assert_eq!(reasons(&off), vec![("2026-10-21T19:00:00+00:00".into(), NotCountedReason::ChangeNotOn)]);
        assert_eq!(off.stop, Some(RealPlayStop::ChangeOff));
        // Unreadable: the newest session waits (not counted, not listed) until a read works.
        let unread = arm(&sessions, &ledger(), None, &pinned());
        assert_eq!((unread.counted.len(), unread.not_counted.len(), unread.stop), (2, 0, Some(RealPlayStop::Unreadable)));
    }

    #[test]
    fn another_compy_change_stops_the_trial_and_no_session_after_it_counts() {
        let sessions = all(vec![played("2026-10-22T12:00:00+00:00", 200.0, 240.0, 16)]);
        // Applied at 18:45 on 10-21, during the second with-session.
        let mut l = ledger();
        l.push(change("visual-effects", "2026-10-21T18:45:00+00:00", None));
        let a = arm(&sessions, &l, Some(true), &pinned());
        assert_eq!(a.stop, Some(RealPlayStop::OtherChange));
        // 18:00 ended (18:20) before the other change moved (18:45) and the next session still began
        // with this change on: it counts. 18:30 was running when the other change landed; nothing after counts.
        assert_eq!(a.counted.iter().map(|s| s.started_at.as_str()).collect::<Vec<_>>(), vec!["2026-10-21T18:00:00+00:00"]);
        assert!(reasons(&a).iter().filter(|(_, r)| *r == NotCountedReason::OtherCompyChange).count() >= 3, "{:?}", reasons(&a));
        // An undo counts the same, and so does a row whose time can't be read.
        let mut l = ledger();
        l.push(change("visual-effects", "2026-10-01T10:00:00+00:00", Some("2026-10-22T09:00:00+00:00")));
        assert_eq!(arm(&sessions, &l, Some(true), &pinned()).stop, Some(RealPlayStop::OtherChange));
        let mut l = ledger();
        l.push(change("visual-effects", "not a date", None));
        let plain = all(Vec::new());
        let a = arm(&plain, &l, Some(true), &pinned());
        assert_eq!((a.stop, a.counted.len()), (Some(RealPlayStop::OtherChange), 0));
        // A change that moved before the Trial began is the start's business, not the conclude's.
        let mut l = ledger();
        l.push(change("visual-effects", "2026-10-19T10:00:00+00:00", None));
        assert_eq!(arm(&all(Vec::new()), &l, Some(true), &pinned()).stop, None);
    }

    #[test]
    fn a_driver_or_windows_update_stops_the_trial() {
        for edit in [
            (|s: &mut SessionSummary| s.hw_fingerprint.as_mut().unwrap().gpu_driver = "32.0.40000.1".into()) as fn(&mut SessionSummary),
            |s: &mut SessionSummary| s.game_state.as_mut().unwrap().windows_build = Some("26200.9000".into()),
        ] {
            let mut updated = played("2026-10-22T12:00:00+00:00", 200.0, 240.0, 15);
            edit(&mut updated);
            let sessions = all(vec![updated]);
            let a = arm(&sessions, &ledger(), Some(true), &pinned());
            assert_eq!(a.stop, Some(RealPlayStop::Conditions));
            assert_eq!(reasons(&a), vec![("2026-10-22T12:00:00+00:00".into(), NotCountedReason::ConditionsChanged)]);
            let (s, pairing) = a.changed.expect("the pairing an early end is judged by");
            assert_eq!(s.started_at, "2026-10-22T12:00:00+00:00");
            assert!(!pairing.changed_context.is_empty(), "{pairing:?}");
            // The three before the update still count.
            assert_eq!(a.counted.len(), 3);
        }
    }

    #[test]
    fn a_session_after_the_window_doesnt_count_and_the_window_ends_the_trial() {
        let late = played("2026-11-04T12:00:00+00:00", 200.0, 240.0, 15);
        let sessions = all(vec![late]);
        let trial = Running { game: WARDOGS, created_at: CREATED, applied_at: APPLIED, applied_change_id: OWN, before: &pinned() };
        let a = with_arm(&trial, &sessions, &ledger(), Some(true), instant("2026-11-05T00:00:00+00:00").unwrap());
        assert_eq!(reasons(&a), vec![("2026-11-04T12:00:00+00:00".into(), NotCountedReason::AfterWindow)]);
        assert_eq!((a.counted.len(), a.stop), (3, Some(RealPlayStop::WindowOver)));
    }

    #[test]
    fn its_own_change_undone_in_history_stops_the_trial_as_put_back() {
        let l = vec![change("game-mode", "2026-10-10T14:00:00+00:00", None), change(OWN, APPLIED, Some("2026-10-22T09:00:00+00:00"))];
        let sessions = all(Vec::new());
        let a = arm(&sessions, &l, Some(false), &pinned());
        assert_eq!(a.stop, Some(RealPlayStop::PutBackInHistory), "its own row moving is not another change");
    }

    #[test]
    fn with_no_as_is_session_left_in_the_store_nothing_counts() {
        let sessions = with_sessions();
        let a = arm(&sessions, &ledger(), Some(true), &pinned());
        assert_eq!((a.counted.len(), a.reference, a.stop), (0, None, Some(RealPlayStop::BeforeMissing)));
        // Any pinned session still in the store stands for the run.
        let sessions: Vec<_> = as_is()[..1].iter().cloned().chain(with_sessions()).collect();
        let a = arm(&sessions, &ledger(), Some(true), &pinned());
        assert_eq!((a.counted.len(), a.stop), (3, None));
    }

    #[test]
    fn the_crash_session_is_the_newest_one_after_the_change() {
        let sessions = all(vec![played("2026-10-22T12:00:00+00:00", 20.0, 40.0, 15)]);
        assert_eq!(newest_after(WARDOGS, APPLIED, &sessions).map(|s| s.started_at.as_str()), Some("2026-10-22T12:00:00+00:00"));
        assert_eq!(newest_after(WARDOGS, APPLIED, &as_is()), None);
    }

    // ─── before arm ────────────────────────────────────────────────────────────

    #[test]
    fn the_before_arm_is_the_newest_eight_of_the_run_ending_at_the_anchor_within_fourteen_days() {
        let run: Vec<SessionSummary> = (0..10).map(|i| played(&format!("2026-10-{:02}T18:00:00+00:00", 12 + i), 200.0, 240.0, 14)).collect();
        let refs: Vec<&SessionSummary> = run.iter().collect();
        let anchor = run.last().unwrap();
        let pinned = pin_before(&refs, anchor, instant("2026-10-22T20:00:00+00:00").unwrap());
        assert_eq!(pinned.len(), MAX_SESSIONS);
        assert_eq!(pinned.first().map(|s| s.session_id.as_str()), Some("2026-10-14T18:00:00+00:00"));
        assert_eq!(pinned.last().map(|s| s.session_id.as_str()), Some(anchor.started_at.as_str()));
        // Fourteen days before now: a run that began a month ago keeps only its last two weeks.
        let pinned = pin_before(&refs, anchor, instant("2026-11-03T12:00:00+00:00").unwrap());
        assert_eq!(pinned.iter().map(|s| s.session_id.as_str()).collect::<Vec<_>>(), vec!["2026-10-20T18:00:00+00:00", "2026-10-21T18:00:00+00:00"]);
        // Too short or behind sessions are left out, and an anchor that can't count pins nothing.
        let mut short = run.clone();
        short[9].samples = 100;
        let refs: Vec<&SessionSummary> = short.iter().collect();
        assert!(pin_before(&refs, &short[9], instant("2026-10-22T20:00:00+00:00").unwrap()).is_empty());
        let refs: Vec<&SessionSummary> = run[..9].iter().collect();
        assert!(pin_before(&refs, anchor, instant("2026-10-22T20:00:00+00:00").unwrap()).is_empty(), "the anchor must be the run's newest");
    }

    #[test]
    fn a_real_play_start_pins_the_unchanged_run_that_ends_at_the_anchor() {
        // A Compy change on 10-19 splits the history: only the run after it describes this PC now.
        let ledger = vec![change("visual-effects", "2026-10-19T12:00:00+00:00", None)];
        let sessions: Vec<SessionSummary> = std::iter::once(played("2026-10-18T18:00:00+00:00", 150.0, 240.0, 13)).chain(as_is()).collect();
        let pinned = before_arm(&sessions, &sessions[3], &ledger, now());
        assert_eq!(pinned, self::pinned(), "the three as-is sessions, never the one before the change");
        // Two sessions since the change: too few, so the progress says so and a start refuses.
        let two = before_arm(&sessions[..3], &sessions[2], &ledger, now());
        assert_eq!(two.len(), 2);
        assert_eq!(before_start_progress(WARDOGS, &two).phase, RealPlayPhase::CollectingBefore);
        // Older than 14 days on the clock: nothing to pin.
        assert!(before_arm(&sessions, &sessions[3], &ledger, instant("2026-11-10T00:00:00+00:00").unwrap()).is_empty());
    }

    #[test]
    fn the_older_compy_fallback_is_the_geometric_mean_of_the_as_is_sessions() {
        let (low1, avg) = geometric_means(&numbers(&[100.0, 400.0], &[200.0, 200.0])).unwrap();
        assert!((low1 - 200.0).abs() < 1e-9 && (avg - 200.0).abs() < 1e-9, "{low1} {avg}");
        assert_eq!(geometric_means(&[]), None);
        assert_eq!(geometric_means(&numbers(&[100.0, 0.0], &[200.0, 200.0])), None, "a reading that isn't real is never averaged");
        // The session a start would pin as its newest: long enough, in front, of this game.
        let mut sessions = as_is();
        sessions.push(played("2026-10-20T20:00:00+00:00", 200.0, 240.0, 14));
        sessions[3].samples = 120;
        assert_eq!(newest_countable(WARDOGS, &sessions).map(|s| s.started_at.as_str()), Some("2026-10-20T19:00:00+00:00"));
        assert_eq!(newest_countable("cs2.exe", &sessions), None);
    }

    // ─── progress ──────────────────────────────────────────────────────────────

    #[test]
    fn progress_says_collecting_ready_or_stopped_from_the_arms_alone() {
        let before = pinned();
        let trial = Running { game: WARDOGS, created_at: CREATED, applied_at: APPLIED, applied_change_id: OWN, before: &before };
        let sessions = all(Vec::new());
        let two: Vec<SessionSummary> = sessions[..5].to_vec();
        let a = with_arm(&trial, &two, &ledger(), Some(true), now());
        let j = judge(&before, &a.counted_numbers(), TrialOutcome::Recommended, a.stop.is_some());
        let p = progress("exp:1", &trial, &a, &j);
        assert_eq!((p.phase, p.before, p.with, p.need, p.band_pct), (RealPlayPhase::Collecting, 3, 2, 3, None));
        assert_eq!(p.until.as_deref(), Some("2026-11-03T19:31:00+00:00"));
        assert_eq!((p.max_sessions, p.min_readings, p.window_days), (8, 600, 14));
        let a = with_arm(&trial, &sessions, &ledger(), Some(true), now());
        let j = judge(&before, &a.counted_numbers(), TrialOutcome::Recommended, a.stop.is_some());
        let p = progress("exp:1", &trial, &a, &j);
        assert_eq!((p.phase, p.with, p.need, p.band_pct), (RealPlayPhase::Ready, 3, 3, Some(3.0)));
        // A stop comes first, even over a decided look: the setting reads off now.
        let a = with_arm(&trial, &sessions, &ledger(), Some(false), now());
        let j = judge(&before, &a.counted_numbers(), TrialOutcome::Recommended, a.stop.is_some());
        let p = progress("exp:1", &trial, &a, &j);
        assert_eq!((p.phase, p.stop), (RealPlayPhase::Stopped, Some(RealPlayStop::ChangeOff)));
        // Before a start: how many as-is sessions a start would pin, and which one it names.
        let p = before_start_progress(WARDOGS, &before[..2]);
        assert_eq!((p.phase, p.before, p.need, p.anchor_session_id.as_deref()), (RealPlayPhase::CollectingBefore, 2, 3, Some("2026-10-20T18:30:00+00:00")));
        assert_eq!(before_start_progress(WARDOGS, &before).phase, RealPlayPhase::ReadyToStart);
        // The wire shape the journey reads.
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["phase"], "collecting-before");
        assert!(v.get("anchor_session_id").is_some() && v.get("not_counted").is_some());
    }

    #[test]
    fn the_record_keeps_only_the_newest_ten_not_counted() {
        let all: Vec<NotCounted> = (0..14).map(|i| NotCounted { session_id: format!("s{i}"), reason: NotCountedReason::TooShort }).collect();
        let kept = newest_not_counted(&all);
        assert_eq!(kept.len(), MAX_NOT_COUNTED);
        assert_eq!((kept[0].session_id.as_str(), kept[9].session_id.as_str()), ("s4", "s13"));
    }

    #[test]
    fn the_evidence_round_trips_and_reads_unknown_words_leniently() {
        let ev = RealPlayEvidence {
            before: pinned(),
            with: pinned(),
            band_pct: Some(3.0),
            delta_low1_pct: Some(0.3),
            look: Some(1),
            not_counted: vec![NotCounted { session_id: "x".into(), reason: NotCountedReason::GamingModeDiffers }],
            stop: Some(RealPlayStop::WindowOver),
            ..Default::default()
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["not_counted"][0]["reason"], "gaming-mode-differs");
        assert_eq!(v["stop"], "window-over");
        assert!(v.get("avg_spread_pct").is_none(), "unmeasured fields aren't written");
        assert_eq!(serde_json::from_value::<RealPlayEvidence>(v.clone()).unwrap(), ev);
        // Words a newer Compy wrote: the reason reads Other, the stop reads None, nothing fails.
        let mut odd = v;
        odd["not_counted"][0]["reason"] = "rained-out".into();
        odd["stop"] = "solar-flare".into();
        let back: RealPlayEvidence = serde_json::from_value(odd).unwrap();
        assert_eq!((back.not_counted[0].reason, back.stop), (NotCountedReason::Other, None));
        // A record with only the pinned sessions (as started) loads with everything else unknown.
        let started: RealPlayEvidence = serde_json::from_value(serde_json::json!({ "before": [] })).unwrap();
        assert_eq!(started, RealPlayEvidence::default());
    }

    // ─── review of 59fc753 ─────────────────────────────────────────────────────

    /// The arms needn't vary alike: real play's two sides are played on different days, often in
    /// different matches, so one side can swing three or eight times as much as the other. A pooled
    /// SD assumes they don't, and read Likely in 11–21% of null Trials of these shapes (review of
    /// 59fc753); Welch's band, each arm judged on its own spread, keeps every shape at 5% or less.
    #[test]
    fn null_effect_with_unequal_spreads_reads_likely_at_most_5_percent() {
        let mut rng = Rng::seeded(0x00C0_FFEE_0059_FC75);
        // (as-is σ, with-change σ, as-is sessions): the three shapes the review simulated.
        let shapes = [(0.03, 0.09, 8), (0.01, 0.08, 8), (0.09, 0.03, 3)];
        let trials = 2000;
        let (mut seen, mut likely) = ([0usize; 3], [0usize; 3]);
        for t in 0..trials {
            let k = t % shapes.len();
            let (before_sigma, with_sigma, n) = shapes[k];
            let draw = |count: usize, sigma: f64, rng: &mut Rng| -> Vec<RealPlaySession> {
                let low: Vec<f64> = (0..count).map(|_| 150.0 * (sigma * normal(rng)).exp()).collect();
                let avg: Vec<f64> = (0..count).map(|_| 240.0 * (sigma * 0.5 * normal(rng)).exp()).collect();
                numbers(&low, &avg)
            };
            let before = draw(n, before_sigma, &mut rng);
            let with = draw(MAX_SESSIONS, with_sigma, &mut rng);
            seen[k] += 1;
            if let Judgement::Decided { outcome, .. } = judge(&before, &with, TrialOutcome::Recommended, false) {
                if matches!(outcome.verdict.as_str(), "improved" | "regressed") {
                    likely[k] += 1;
                }
            }
        }
        let rates: Vec<String> = (0..shapes.len())
            .map(|k| format!("{:?}: {} of {} ({:.1}%)", shapes[k], likely[k], seen[k], 100.0 * likely[k] as f64 / seen[k] as f64))
            .collect();
        println!("null Trials that read Likely: {rates:?}");
        assert!((0..shapes.len()).all(|k| likely[k] * 20 <= seen[k]), "null Trials that read Likely: {rates:?}");
    }

    #[test]
    fn a_damaged_row_on_the_record_loads_and_is_never_judged() {
        let v = serde_json::json!({
            "before": [
                { "session_id": "a", "low1_fps": 150.0, "avg_fps": 240.0, "samples": 1200 },
                { "session_id": "b" },
                { "session_id": 7, "low1_fps": null, "avg_fps": "fast", "samples": -1 },
                {}
            ],
            "not_counted": [{ "session_id": "c" }, {}]
        });
        let ev: RealPlayEvidence = serde_json::from_value(v).expect("a damaged row degrades; it doesn't lose the record");
        assert_eq!(ev.before.len(), 4);
        assert_eq!((ev.before[1].session_id.as_str(), ev.before[1].samples), ("b", 0));
        assert!(ev.before[0].readable() && ev.before[1..].iter().all(|s| !s.readable()), "{:?}", ev.before);
        let reasons: Vec<NotCountedReason> = ev.not_counted.iter().map(|n| n.reason).collect();
        assert_eq!(reasons, vec![NotCountedReason::Other; 2]);
        // Only the one real row can be judged, and one as-is session is never enough.
        assert_eq!(judge(&ev.before, &flat(&[150.0; 3]), TrialOutcome::Recommended, true), Judgement::TooFew);
    }

    #[test]
    fn a_session_with_no_frame_rate_reading_says_so_not_too_short() {
        // Long enough and in front, but no 1% low was measured.
        let none = played("2026-10-22T10:00:00+00:00", 0.0, 240.0, 15);
        let sessions = all(vec![none, played("2026-10-22T11:00:00+00:00", 213.0, 240.0, 15)]);
        let a = arm(&sessions, &ledger(), Some(true), &pinned());
        let r = reasons(&a);
        assert_eq!(r.len(), 1, "{r:?}");
        assert_eq!(serde_json::to_value(r[0].1).unwrap(), "no-reading", "{r:?}");
    }

    #[test]
    fn a_session_that_couldnt_confirm_its_own_change_doesnt_count() {
        // 14 changes on, and the 15th, this one, Compy couldn't read when 10:00 began: nothing shows it
        // on, there or as the check after 19:00 the evening before.
        let mut unsure = played("2026-10-22T10:00:00+00:00", 213.0, 240.0, 14);
        unsure.compy_changes_cant_confirm = Some(1);
        let sessions = all(vec![unsure, played("2026-10-22T11:00:00+00:00", 213.0, 240.0, 15)]);
        let a = arm(&sessions, &ledger(), Some(true), &pinned());
        assert_eq!(
            reasons(&a),
            vec![
                ("2026-10-21T19:00:00+00:00".into(), NotCountedReason::ChangeNotOn),
                ("2026-10-22T10:00:00+00:00".into(), NotCountedReason::ChangeNotOn),
            ]
        );
        assert_eq!(a.counted.len(), 3, "10-21 18:00 and 18:30, and 11:00");
    }

    #[test]
    fn as_is_sessions_an_older_compy_counted_are_never_pinned() {
        // Before 453-f1 a session counted a change Compy couldn't read as on, so no later session could
        // be shown to have this change on against it: such sessions are never pinned.
        let older: Vec<SessionSummary> = as_is()
            .into_iter()
            .map(|mut s| {
                (s.compy_changes_per_change, s.compy_changes_cant_confirm) = (false, None);
                s
            })
            .collect();
        let refs: Vec<&SessionSummary> = older.iter().collect();
        assert!(pin_before(&refs, &older[2], now()).is_empty());
        let current = as_is();
        let refs: Vec<&SessionSummary> = current.iter().collect();
        assert_eq!(pin_before(&refs, &current[2], now()).len(), 3, "counted per change, they pin");
    }

    #[test]
    fn a_session_whose_length_cant_be_added_to_its_start_never_counts_or_panics() {
        let mut corrupt = played("2026-10-22T10:00:00+00:00", 213.0, 240.0, 15);
        // Past chrono's last date once added to its start.
        corrupt.duration_secs = 9_000_000_000_000;
        // Another change after it, so its end is read.
        let mut l = ledger();
        l.push(change("visual-effects", "2026-10-22T12:00:00+00:00", None));
        let sessions = all(vec![corrupt.clone()]);
        let a = arm(&sessions, &l, Some(true), &pinned());
        assert_eq!(a.stop, Some(RealPlayStop::OtherChange));
        assert!(reasons(&a).contains(&("2026-10-22T10:00:00+00:00".into(), NotCountedReason::Other)), "{:?}", reasons(&a));
        assert!(!countable(&corrupt), "nor is it ever an as-is session");
    }

    #[test]
    fn the_session_before_another_compy_change_is_left_out_for_that_change() {
        // The other change landed at 19:00 on 10-21: after 18:30 ended (18:50), as 19:00 began.
        let mut l = ledger();
        l.push(change("visual-effects", "2026-10-21T19:00:00+00:00", None));
        let mut sessions = all(Vec::new());
        sessions[5].compy_changes_active = Some(16);
        let a = arm(&sessions, &l, Some(true), &pinned());
        assert_eq!(a.counted.iter().map(|s| s.started_at.as_str()).collect::<Vec<_>>(), vec!["2026-10-21T18:00:00+00:00"]);
        assert_eq!(
            reasons(&a),
            vec![
                ("2026-10-21T18:30:00+00:00".into(), NotCountedReason::OtherCompyChange),
                ("2026-10-21T19:00:00+00:00".into(), NotCountedReason::OtherCompyChange),
            ]
        );
        // A check taken after another change moved can't vouch for this one, even when its count
        // happens to read as this one change more.
        sessions[5].compy_changes_active = Some(15);
        let a = arm(&sessions, &l, Some(true), &pinned());
        assert_eq!(a.counted.len(), 1, "{:?}", reasons(&a));
    }
}
