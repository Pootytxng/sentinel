//! Intelligence Phase 3 — user-started single-variable experiment engine + optimization
//! simulator. DARK groundwork (owner directive `docs/reviews/2026-07-16-owner-directive-
//! intelligence-platform.md` §4F/§4G; spec `docs/superpowers/specs/2026-07-17-intelligence-
//! phase3-experiment-engine.md`).
//!
//! This module ORCHESTRATES the existing audited mutation boundary — it invents NO new
//! apply/rollback primitive and adds NO `AppliedAction`/`RollbackAction`/`Snapshot` variant.
//! Applying a change goes through `history::apply_recommendation` (which captures the full
//! typed rollback contract + snapshot at apply time); restoring goes through
//! `history::rollback_change` (which resolves from `history.json` alone). The verdict reuses
//! `comparison::classify_with_guards` — the SAME 3% noise floor + confound/expiry guards the
//! rest of the app uses, so an experiment can never claim a win inside the noise.
//!
//! Gate: `experiment_gate()` is ARMED (2026-07-17, owner sign-off "Ship it live now", spec §7 —
//! hard-false from build until then, `receipts_gate`/`gaming_mode_gate` pattern). Arming was its
//! own owner-signed commit after a live apply→measure→restore round-trip on the real rig + a
//! Cowork-lane adversarial audit + rust-tauri-reviewer PASS. Every lifecycle command STILL
//! hard-checks the gate (defense in depth, now unreachable while armed); the FE renders nothing if
//! it ever reads false. Flipping the gate BACK is likewise an owner-signed decision, never a
//! refactor side effect. Arming reuses the existing audited boundary — no new mutation primitive.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::history::LedgerCoverage;
use chrono::{DateTime, Utc};

use crate::comparability::{Comparability, SessionComparability};
use crate::comparison::{self, ArmedComparison, ComparisonKind, DEFAULT_NOISE_FLOOR_PCT};
use crate::intelligence::Confidence;
use crate::sessions::SessionSummary;

const STORE_SCHEMA_VERSION: u32 = 1;

/// Below this many frame-rate readings a treatment session's aggregate delta is noise, not signal —
/// the honest floor for "insufficient samples" (§4F stop-rule). Conservative + owner-tunable,
/// same spirit as `DEFAULT_NOISE_FLOOR_PCT`. A reading is one of the session's ~1 Hz ticks
/// (`SessionSummary::samples`), so this is about 10 minutes of play, not a frame count.
pub(crate) const MIN_TREATMENT_SAMPLES: u32 = 600;

/// Free-text cap for persisted experiment fields (title / hypothesis; the game comes from Compy's own
/// session store since #583 lane 2b). Defense-in-depth at
/// the webview trust boundary, mirroring `history::MAX_REC_TITLE_LEN` — a compromised UI must not be
/// able to bloat `experiments.json` with megabyte strings. Truncate, don't reject.
const MAX_TEXT_LEN: usize = 200;

// ─────────────────────────────────────────────────────────────────────────
//  GATE — ARMED 2026-07-17 (Intelligence Phase 3). Owner sign-off "Ship it
//  live now" (spec §7). Arming is safe because the engine invents NO new
//  mutation primitive: start/restore reuse `history::apply_recommendation` /
//  `history::rollback_change` — the SAME audited boundary that has been LIVE
//  for weeks under the Benchmark tweak A/B trial. The apply→rollback
//  round-trip on a benign rec is proven on THIS rig as part of the arming
//  ship QA and recorded in RELEASE_STATE. Was hard-false from build → arming.
//  Flipping it BACK is likewise an owner-signed decision, never a side effect
//  of a refactor.
// ─────────────────────────────────────────────────────────────────────────

pub(crate) fn experiment_gate() -> bool {
    true
}

// ─── Canonical types ─────────────────────────────────────────────────────

/// Where an experiment sits in its lifecycle (§4F). Persisted; additive-only (kebab-case serde).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ExperimentStatus {
    /// Written to disk BEFORE the change is applied (Trial Protocol §4 record-first, #583), so a crash
    /// at any point of a start leaves a record naming the change. Promoted to `Running` once the apply
    /// succeeded and the evidence watermark was read. Never shown to the UI (`get_experiments` drops
    /// it); a Pending record found at launch means Compy stopped mid-start, and
    /// [`reconcile_interrupted_starts`] resolves it before the first window can read the store.
    Pending,
    /// Baseline captured + the one change applied; awaiting the treatment session.
    Running,
    /// Treatment measured, evidence justified keeping the change (verdict `improved`, no crash).
    Kept,
    /// Change rolled back — no measurable benefit, regression, confound, crash, or a user restore.
    Restored,
    /// Halted on an error before a fair verdict. Carries `stop_reason`. A failed apply keeps its
    /// record here (see `settle_failed_apply`), as does an interrupted start; a failed RESTORE lands
    /// here too, with the change still live, so the user must be told loudly.
    Aborted,
}

/// The treatment session's recorded metrics (§4F step 5). `samples` is the session's count of ~1 Hz
/// frame-rate readings — the honesty gate against a too-short session.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct TreatmentRecord {
    pub avg_fps: f64,
    pub low1_fps: f64,
    pub samples: u32,
    pub crashed: bool,
    /// 1%-low %-delta vs baseline — the signal the verdict is judged on. Rounded to 0.1.
    pub delta_low1_pct: f64,
    pub recorded_at: String,
    /// The session these numbers were read from (its `started_at`), looked up by the backend in
    /// `sessions.json` (#583 lane 2b). None on records concluded while the webview supplied the numbers.
    #[serde(default)]
    pub session_id: Option<String>,
    /// P4-sessions (§2/§11): the after-session graded on the same check as the baseline, its two
    /// halves against the noise floor. None on records concluded before sessions were graded, and on a
    /// session too short to grade.
    #[serde(default)]
    pub check: Option<BaselineCheck>,
    /// The after-session's first- and second-half average frame rate. None when it had no trace, and
    /// on older records.
    #[serde(default)]
    pub halves: Option<BaselineHalves>,
    /// P4-recommended: the average fps %-delta vs baseline (rounded 0.1), judged beside the 1% low on
    /// the same band: a win needs the average not to fall by more than it. None when either average
    /// is missing, and on records concluded before the average was judged (1% low only). Additive.
    #[serde(default)]
    pub delta_avg_pct: Option<f64>,
}

/// P4-maxfps-smooth (ENGINE §2): the outcome the user picked when starting a Trial. Persisted
/// (kebab-case); older records carry no `outcome` and load as `Recommended`, the default.
/// Smoothest (P4-smooth-offer) starts only for a game whose frame pacing Compy has measured between
/// unchanged sessions on this PC ([`smoothest_admission`]).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TrialOutcome {
    /// The 1% low beside the average (`with_recommended_outcome`).
    #[default]
    Recommended,
    /// The average beside the 1% low (`with_max_fps_outcome`).
    MaxFps,
    /// Frame pacing beside the 1% low (`with_smoothest_outcome`).
    Smoothest,
}

impl<'de> Deserialize<'de> for TrialOutcome {
    /// "max-fps" and "smoothest" read as themselves. Any other value (null, an older or unknown pick)
    /// reads as Recommended, so an unknown pick never fails the store's load and is never judged as
    /// something this build doesn't judge.
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        Ok(match v.as_str() {
            Some("max-fps") => TrialOutcome::MaxFps,
            Some("smoothest") => TrialOutcome::Smoothest,
            _ => TrialOutcome::Recommended,
        })
    }
}

/// P4-smooth-offer: the smallest band frame pacing is judged on, in percent. Each session's p99/p50
/// ratio is good to about ±1% (`sessions::FramePacing::p99_over_p50`), so a narrower band would
/// read the histogram's own bucket error as a change.
pub(crate) const PACING_RESOLUTION_PCT: f64 = 2.0;

/// P4-smooth-offer (ENGINE §2 `smoothest`): the frame-pacing evidence a Smoothest Trial is judged on,
/// recorded at start; `after_ratio` is added at conclude. Additive: older records load as `None`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct SmoothestEvidence {
    /// ± band on the p99/p50 ratio, in percent of the start session's ratio: this game's measured
    /// between-session pacing spread, never below [`PACING_RESOLUTION_PCT`].
    pub band_pct: f64,
    /// The start session's p99/p50 frame-time ratio (1.0 = every frame alike; lower is steadier).
    pub start_ratio: f64,
    /// The between-session pacing spread the band came from.
    pub between_sessions: crate::noise_floor::BetweenSessionNoise,
    /// The after-session's ratio, set at conclude. `None` while Running, or when that session
    /// recorded no frame pacing, which is never a win.
    #[serde(default)]
    pub after_ratio: Option<f64>,
}

/// P4-smooth-offer-b: why Smoothest can't start from a session yet, as a stable key the bench words
/// in the reader's language (`lab.experimentBench.smoothestHeld.*`) and a start words in English
/// ([`smoothest_held_message`]). Never a guess: each names exactly what is missing.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SmoothestHeld {
    /// Compy's change history couldn't be read, so no pair of sessions can be shown unchanged.
    HistoryUnread,
    /// Fewer than `noise_floor::MIN_UNCHANGED_SESSIONS` unchanged sessions of this game with frame
    /// pacing: how much pacing varies on its own isn't measured.
    Unmeasured,
    /// The session the Trial would start from recorded no frame pacing.
    NoStartPacing,
}

/// The start's refusal for a held Smoothest, in plain words. None reads as a baseline refusal (the
/// journey matches /baseline/i to offer a new as-is session; this is a different problem).
pub(crate) fn smoothest_held_message(held: SmoothestHeld) -> String {
    match held {
        SmoothestHeld::HistoryUnread => "Smoothest needs Compy's change history to tell which sessions ran with \
             nothing changed, and it couldn't be read just now. Try again in a moment; if it keeps \
             happening, check Test \u{2192} Applied & history."
            .to_string(),
        SmoothestHeld::Unmeasured => format!(
            "Smoothest needs at least {} sessions of this game with nothing changed between them, each \
             with frame pacing recorded by this version of Compy, so it knows how much the pacing varies \
             on its own. Play this game a few more times, then pick Smoothest.",
            crate::noise_floor::MIN_UNCHANGED_SESSIONS
        ),
        SmoothestHeld::NoStartPacing => "Smoothest needs frame pacing from the session this Trial starts from, \
             and that session didn't record it. Play this game once more, then start from that session."
            .to_string(),
    }
}

/// P4-smooth-offer: what a Smoothest start is judged against, or why it can't start. Admitted only
/// when this game's frame pacing was measured between unchanged sessions on this PC
/// (`noise_floor::between_session_pacing_noise`) and the session the Trial starts from recorded its
/// own; never estimated. `history_read` is false when Compy's change history couldn't be read: no
/// pair of sessions can then be shown unchanged, which is a different problem from too few sessions.
pub(crate) fn smoothest_admission(
    history_read: bool,
    pacing: Option<&crate::noise_floor::BetweenSessionNoise>,
    start_ratio: Option<f64>,
) -> Result<SmoothestEvidence, SmoothestHeld> {
    if !history_read {
        return Err(SmoothestHeld::HistoryUnread);
    }
    let pacing = pacing.ok_or(SmoothestHeld::Unmeasured)?;
    let start_ratio = start_ratio.filter(|r| r.is_finite() && *r > 0.0).ok_or(SmoothestHeld::NoStartPacing)?;
    Ok(SmoothestEvidence {
        // `f64::max` returns the other side for a NaN, so a NaN spread still gets the 2% floor.
        band_pct: pacing.spread_pct.max(PACING_RESOLUTION_PCT),
        start_ratio,
        between_sessions: pacing.clone(),
        after_ratio: None,
    })
}

/// The one read both the start and the bench's readiness check make: this game's pacing noise and
/// the session's own ratio, from Compy's session store and change history (P4-smooth-offer-b).
fn smoothest_for(
    sessions: &[SessionSummary],
    from: &SessionSummary,
    history: &Result<Vec<crate::history::AppliedChange>, String>,
) -> Result<SmoothestEvidence, SmoothestHeld> {
    let pacing = history
        .as_deref()
        .ok()
        // P4-judge-noisy (review r1): measured like the 1% low band, within one cap state.
        .and_then(|changes| crate::noise_floor::measure_pacing_noise(sessions, from, &ledger_rows(changes)));
    let ratio = from.frame_pacing.as_ref().and_then(|p| p.p99_over_p50());
    smoothest_admission(history.is_ok(), pacing.as_ref(), ratio)
}

/// P4-smooth-offer-b: whether Smoothest can start from a session, for the bench's picker. `held` is
/// `None` when it can.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct SmoothestReadiness {
    pub held: Option<SmoothestHeld>,
    /// `noise_floor::MIN_UNCHANGED_SESSIONS`, so the bench's sentence names the same number.
    pub min_sessions: usize,
}

/// P4-smooth-offer-b: the start's own Smoothest check, without starting. Read-only: reads the session
/// store and the change history, writes nothing. A session that can't be a baseline is the start's
/// refusal to give, so it comes back as an error and the bench says nothing about Smoothest.
#[tauri::command]
pub(crate) fn get_smoothest_readiness(baseline_session_id: String) -> Result<SmoothestReadiness, String> {
    if !experiment_gate() {
        return Err("The experiment engine isn't part of this build yet.".into());
    }
    let sessions = crate::sessions::get_session_summaries();
    let from = resolve_baseline(&sessions, &baseline_session_id)?;
    let (history, coverage) = ledger_view_for_one_change_checks(
        crate::history::load_history,
        crate::history::ledger_set_aside_through,
        Some(from.started_at.as_str()),
    );
    // #618: a session the change history can't cover is the start's refusal to give, as for a
    // session that can't be a baseline: Smoothest is neither offered nor held for a reason it isn't.
    if let (Err(why), LedgerCoverage::Lost | LedgerCoverage::Unknown) = (&history, coverage) {
        return Err(why.clone());
    }
    Ok(SmoothestReadiness {
        held: smoothest_for(&sessions_the_ledger_covers(&sessions, coverage), from, &history).err(),
        min_sessions: crate::noise_floor::MIN_UNCHANGED_SESSIONS,
    })
}

/// The outcome a start asked for, read at the webview trust boundary: none means Recommended,
/// anything unknown is refused before anything is recorded or changed. Smoothest is read here and
/// admitted or refused by `start_experiment` ([`smoothest_admission`]).
pub(crate) fn start_outcome(picked: Option<&str>) -> Result<TrialOutcome, String> {
    match picked {
        None | Some("recommended") => Ok(TrialOutcome::Recommended),
        Some("max-fps") => Ok(TrialOutcome::MaxFps),
        Some("smoothest") => Ok(TrialOutcome::Smoothest),
        Some(other) => {
            let other: String = other.chars().take(40).collect();
            Err(format!("experiment not started — Compy doesn't know the outcome \"{other}\"."))
        }
    }
}

/// §11 "what uncertainty/noise existed": the credible-noise band a verdict was judged against.
/// Recorded only when the verdict really was judged against it (see [`noise_evidence_for`]).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct NoiseEvidence {
    /// ± band on the 1% low, in percent. A delta inside it is `no-change`, never a win (§5).
    pub band_pct: f64,
    /// This game's own run-to-run noise on this PC, when Compy has measured it. `None` means it was
    /// never measured: the band is Compy's fixed default, not a calibration for this game, and the
    /// receipt says so instead of implying one. Never estimated.
    #[serde(default)]
    pub measured_noise_pct: Option<f64>,
    /// This game's noise was measured on this PC but wasn't used (`measured_noise_pct` stays `None`):
    /// `changed` = a driver, Windows or game update since; `unconfirmed` = Compy couldn't confirm
    /// nothing changed (a stamp wasn't read). Additive: older records load as `None`.
    #[serde(default)]
    pub measured_noise_stale: Option<crate::noise_floor::StaleReason>,
    /// P4-noise: this game's spread between whole unchanged sessions on this PC, as the start measured
    /// it; `band_pct` is this spread or the fixed default, whichever is larger. `None` when fewer than
    /// `noise_floor::MIN_UNCHANGED_SESSIONS` such sessions existed (the band is then the fixed
    /// default). Additive: older records load as `None`.
    #[serde(default)]
    pub between_sessions: Option<crate::noise_floor::BetweenSessionNoise>,
}

/// P4-judge-noisy (immutability: never stored). A verdict judged against the fixed ±3% default, before
/// Compy measured each game's noise, is labelled on read: the band it assumed, and this game's noise as
/// measured now (`None` = still not measured). The record itself is never rewritten.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct AssumedBandLabel {
    pub assumed_pct: f64,
    pub measured_low1_pct: Option<f64>,
    pub measured_sessions: Option<u32>,
    /// Whether the old verdict claimed a change (better or worse): only then does a wider measured
    /// noise mean it was judged against less noise than the game has (review r1).
    pub claimed_change: bool,
    /// Whether the old verdict judged anything at all (a too-noisy result did not).
    pub judged: bool,
}

/// How comparable the baseline and treatment sessions were (`comparability::derive` at conclude) —
/// the §11 "machine/workload context". Only `Comparable` or `Partial` ever concludes; see
/// [`resolve_treatment`].
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct SessionPairing {
    pub verdict: crate::comparability::Comparability,
    /// What Compy couldn't check because one of the sessions didn't record it. Empty when Comparable.
    #[serde(default)]
    pub missing_context: Vec<String>,
    /// P4-comparable: the stable keys of the conditions that differed ("resolution", "gpu-driver",
    /// …; `comparability::SessionComparability::changed_keys`), so the receipt says what differed
    /// in the reader's language. Additive: older records load empty.
    #[serde(default)]
    pub changed: Vec<String>,
    /// The stable keys of the conditions one session didn't record (`missing_keys`). Additive.
    #[serde(default)]
    pub unrecorded: Vec<String>,
    /// What each session's records say about stretches that weren't play: time left out because the
    /// game was in the background, and held-flat time Compy counted because it can't tell a menu
    /// from a frame cap. `None` when that session couldn't be read, and on older records.
    #[serde(default)]
    pub baseline_stretches: Option<crate::comparability::SessionStretches>,
    #[serde(default)]
    pub after_stretches: Option<crate::comparability::SessionStretches>,
}

impl SessionPairing {
    /// The receipt's view of a pairing, with what the two sessions' records say about their
    /// stretches that weren't play.
    pub(crate) fn of(
        pairing: &SessionComparability,
        baseline: Option<&SessionSummary>,
        after: Option<&SessionSummary>,
    ) -> Self {
        SessionPairing {
            verdict: pairing.verdict,
            missing_context: pairing.missing_context.clone(),
            changed: pairing.changed_keys.clone(),
            unrecorded: pairing.missing_keys.clone(),
            baseline_stretches: baseline.map(crate::comparability::stretches_of),
            after_stretches: after.map(crate::comparability::stretches_of),
        }
    }
}

/// One full experiment record, persisted to `experiments.json`. Every optional is `#[serde(default)]`
/// for forward-compat (additive-only, mutation-gate item 1).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct ExperimentRecord {
    pub id: String,
    pub rec_id: String,
    pub rec_title: String,
    pub game: String,
    pub hypothesis: String,
    pub created_at: String,
    pub status: ExperimentStatus,
    pub baseline_avg_fps: f64,
    pub baseline_low1_fps: f64,
    /// Trust-Ledger length captured AFTER our own apply — so a later external change trips the
    /// confound guard, but our own applied change never does (reused `classify_with_guards` idiom).
    pub ledger_watermark: usize,
    /// The `AppliedChangeView.id` produced by `apply_recommendation` — what `rollback_change` takes
    /// to restore. Rollback resolves from `history.json` alone via this id (mutation-gate item 3).
    pub applied_change_id: String,
    /// Distinct Compy changes already active at start — the single-variable honesty context.
    #[serde(default)]
    pub active_changes_at_start: usize,
    /// Non-null when other changes were already active: names that the experiment isolates only the
    /// ONE new variable, holding the rest constant. Never implies attribution across combined changes.
    #[serde(default)]
    pub attribution_warning: Option<String>,
    /// The band the before/after verdict is judged against, set at start: this game's measured
    /// between-session spread of the 1% low when there is one (`between_session_noise`), never below
    /// `DEFAULT_NOISE_FLOOR_PCT`; that default otherwise. The sessions' halves are NOT graded on it
    /// (see `halves_floor_pct`).
    pub noise_floor_pct: f64,
    /// The threshold both sessions' first/second-half average fps were graded on: always
    /// `DEFAULT_NOISE_FLOOR_PCT` (owner, 2026-10-24: halves differing by "> 3%" are uneven). Kept apart
    /// from `noise_floor_pct` because the halves are average fps and the band is a 1% low spread.
    /// `None` on records older than P4-noise, whose halves were graded on `noise_floor_pct`, which
    /// was always that same default then.
    #[serde(default)]
    pub halves_floor_pct: Option<f64>,
    /// P4-noise: the between-session spread `noise_floor_pct` came from. `None` when it wasn't
    /// measured (the floor is then the fixed default), and on older records.
    #[serde(default)]
    pub between_session_noise: Option<crate::noise_floor::BetweenSessionNoise>,
    /// P4-judge-noisy: this game's measured as-is noise (`noise_floor::measure_game_noise`), measured at
    /// start; this build judges the verdict on it alone (never on `noise_floor_pct`, which keeps the
    /// P4-noise band for an older Compy). `None` on records started before it: they are measured at
    /// conclude, and judged nothing when that can't be done, never on 3%. Additive: written only when
    /// present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_noise: Option<crate::noise_floor::GameNoise>,
    /// Read-only label for a verdict judged on the assumed band ([`AssumedBandLabel`]): set only on
    /// the copy `get_experiments` hands the UI, never read from or written to the store.
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub assumed_band: Option<AssumedBandLabel>,
    #[serde(default)]
    pub treatment: Option<TreatmentRecord>,
    /// "improved" | "no-change" | "regressed" | "confounded" | "expired" | "insufficient-evidence" |
    /// "not-comparable" | "too-noisy". A plain string, so an older Compy loads a verdict it doesn't
    /// know (it shows the raw word; `trial_result` is stored beside it). None while Running.
    #[serde(default)]
    pub verdict: Option<String>,
    #[serde(default)]
    pub kept: bool,
    /// Why the engine halted before a clean keep/restore (crash, restore-failed…). Never a silent skip.
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub concluded_at: Option<String>,
    /// How much the EVIDENCE QUALITY justifies trusting this verdict — a BAND, never a number
    /// (Task F). None while Running or for records written before this field existed (loads as
    /// honestly unknown, never assumed). Derived by [`verdict_confidence`] at conclude time.
    #[serde(default)]
    pub verdict_confidence: Option<Confidence>,
    /// Plain-language "what supports / limits this verdict" line — the experiment's methodology in
    /// one sentence. None while Running or on pre-existing records.
    #[serde(default)]
    pub verdict_note: Option<String>,
    /// The verdict in the Trial Protocol's five result classes (§8), which the keep rule (§9) is
    /// judged on. None while Running, after a user restore (nothing was classified), and on records
    /// written before this field existed.
    #[serde(default)]
    pub trial_result: Option<TrialResult>,
    /// What the live probe read straight after the apply (§4.5 "verify target state"): `Some(true)`
    /// the setting reads in the target state, `Some(false)` it does not, `None` the probe could not
    /// read it. Only `Some(true)` lets a start run; anything else aborts it and restores the change
    /// (§7 "target state cannot be verified"). Unknown stays unknown; it is never recorded as verified.
    #[serde(default)]
    pub target_verified: Option<bool>,
    /// §4.1 "verify current state": the live probe read the setting as NOT yet in the target state
    /// before the apply, so a restore is expected to read it back that way. Every start since #583
    /// lane 2 sets it (a start refuses otherwise); `false` on older records, whose prior state was
    /// never read, so their restore read-back stays unknown.
    #[serde(default)]
    pub prior_state_verified: bool,
    /// §4.10 "verify final state": whether the live read after the keep or restore matched the
    /// decision. `Some(false)` is always said out loud (see [`settle_restore`]); `None` means the
    /// setting couldn't be read, the prior state was never verified, or the Trial hasn't concluded.
    #[serde(default)]
    pub final_state_verified: Option<bool>,
    /// §4.2 the baseline session (its `started_at`), looked up by the backend in `sessions.json` at
    /// start; the baseline numbers above are copied from it (#583 lane 2b). None on records started
    /// while the webview supplied the numbers — such a record can't be concluded, only restored.
    #[serde(default)]
    pub baseline_session_id: Option<String>,
    /// §2/§11 the baseline's first- and second-half average frame rate, as the start graded it.
    /// None on records started before baselines were graded, and when the baseline had no trace.
    #[serde(default)]
    pub baseline_halves: Option<BaselineHalves>,
    /// §2/§11 how the start graded the baseline: steady, uneven or untraced. Uneven and untraced
    /// baselines start with a warning (owner decision 2026-10-24) and the receipt keeps it, so the
    /// result can say its baseline was uneven or unchecked. None on records started before baselines
    /// were graded (unknown, never assumed steady).
    #[serde(default)]
    pub baseline_check: Option<BaselineCheck>,
    /// When the apply returned — the change was in place from here on, so only a session that started
    /// later can be the after-reading. `created_at` is stamped before the apply (record first), so a
    /// session started while the apply or its UAC prompt was pending would pass a `created_at` test.
    /// None on older records and on starts that never applied; such a record can't be concluded.
    #[serde(default)]
    pub applied_at: Option<String>,
    /// How comparable the baseline and treatment sessions were. None until concluded, and on older
    /// records.
    #[serde(default)]
    pub session_pairing: Option<SessionPairing>,
    /// The noise band the verdict was judged against. None while Running, on older records, and when
    /// the verdict never reached the band (a crash, too few readings, a confound).
    #[serde(default)]
    pub noise_evidence: Option<NoiseEvidence>,
    /// P4-maxfps-smooth: what the user asked this Trial to aim for. Older records load as
    /// `Recommended`; an older Compy ignores the key (it judged everything as Recommended).
    #[serde(default)]
    pub outcome: TrialOutcome,
    /// P4-smooth-offer: the frame-pacing band and ratios a Smoothest Trial is judged on. `None` for
    /// every other outcome and on older records.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smoothest: Option<SmoothestEvidence>,
    /// P8-dims (RISK_MODEL §3; TRIAL_PROTOCOL §1 `risk_class`, §11): what the catalog stated about this
    /// change's risk when the Trial started, its one overall word and each dimension it states, so
    /// the receipt names the risk the Trial ran under. `None` on records started before it was kept,
    /// and when the change wasn't in the catalog at the start: the receipt then says "not recorded",
    /// never a guess. Additive; read leniently, so a value this build can't read is `None` and never
    /// fails the store's load.
    #[serde(
        default,
        deserialize_with = "crate::trial_candidates::lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub stated_risk: Option<crate::trial_candidates::StatedRisk>,
    /// P8-posture-show (RISK_MODEL §2): the user's answer to "How far may Compy go on this PC?" in force
    /// when the Trial started, as the start was told it. `None` on records started before it was kept
    /// (and on a start that didn't say): the receipt then says "not recorded", never the default.
    /// Additive; read leniently, so a choice this build doesn't know is `None`, never a failed load.
    #[serde(
        default,
        deserialize_with = "crate::trial_candidates::lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub risk_choice: Option<crate::trial_candidates::RiskChoice>,
    /// P8-ack (RISK_MODEL §1 Advanced, "explicit user acknowledgement when the cost is not obvious"):
    /// whether the user tapped "I understand, test it" on the line naming the change's cost before the
    /// Trial started, as the start was told it. `Some(false)` = no acknowledgement was asked (a low-risk
    /// change starts as before). `None` on records started before it was kept: "not recorded".
    /// Additive; read leniently, so a value this build can't read is `None`, never a failed load.
    #[serde(
        default,
        deserialize_with = "crate::trial_candidates::lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub cost_acknowledged: Option<bool>,
    /// P5-realplay: how this Trial is measured. Not written for a two-session Trial, so its record is
    /// byte-for-byte what it was; read leniently ([`TrialMode`]).
    #[serde(default, skip_serializing_if = "TrialMode::is_pair")]
    pub mode: TrialMode,
    /// P5-realplay: a real-play Trial's sessions and verdict numbers. `None` on every two-session
    /// Trial. An older Compy, which ignores this and `mode`, reads the record as the valid pair Trial
    /// its fallback fields describe and can conclude or restore it: `baseline_session_id` is the newest
    /// as-is session, `baseline_*_fps` are the as-is sessions' geometric means and `noise_floor_pct`
    /// is set as for any start; at conclude `treatment` holds the with-change sessions' means, total
    /// readings, the arms' deltas and the newest session, and `noise_evidence.band_pct` the real-play
    /// band. Read leniently: evidence this build can't read is `None` (such a record can only be put
    /// back), never a failed load.
    #[serde(
        default,
        deserialize_with = "crate::trial_candidates::lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub real_play: Option<crate::realplay::RealPlayEvidence>,
}

/// P5-realplay: how a Trial is measured. Persisted (kebab-case) only when it isn't a pair. Read
/// leniently: any value but "real-play" (an older or unknown mode) reads as `Pair`, so an unknown
/// word never fails the store's load, and a record of a mode this build doesn't know is the valid
/// pair Trial its fallback fields describe.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TrialMode {
    /// One as-is session against one session with the change on (the bench and the guided journey).
    #[default]
    Pair,
    /// The change stays on while the player plays however they play, and is judged on several
    /// sessions a side (`realplay`).
    RealPlay,
}

impl TrialMode {
    fn is_pair(&self) -> bool {
        *self == TrialMode::Pair
    }
}

impl<'de> Deserialize<'de> for TrialMode {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        Ok(if v.as_str() == Some("real-play") { TrialMode::RealPlay } else { TrialMode::Pair })
    }
}

/// P5-realplay: the way of measuring a start asked for, read at the webview trust boundary: none (or
/// "pair") is the two-session Trial, "real-play" leaves the change on across real play. Anything else
/// is refused before anything is recorded or changed, and so is Smoothest in real play: frame pacing
/// isn't compared across real-play sessions.
pub(crate) fn start_mode(picked: Option<&str>, outcome: TrialOutcome) -> Result<TrialMode, String> {
    let mode = match picked {
        None | Some("pair") => TrialMode::Pair,
        Some("real-play") => TrialMode::RealPlay,
        Some(other) => {
            let other: String = other.chars().take(40).collect();
            return Err(format!("experiment not started — Compy doesn't know the way of measuring \"{other}\"."));
        }
    };
    if mode == TrialMode::RealPlay && outcome == TrialOutcome::Smoothest {
        return Err("experiment not started — Smoothest compares frame pacing, which real play doesn't measure \
                    across sessions yet. Pick Recommended or Maximum FPS for real play, or test Smoothest with \
                    two sessions."
            .into());
    }
    Ok(mode)
}

/// Trial Protocol §8 — the five result classes a Trial is judged in (#583). Persisted (kebab-case).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TrialResult {
    /// Improvement beyond the noise floor with no disqualifying tradeoff.
    Better,
    /// A measured regression, or a crash during treatment (§6: instability is never a win).
    Worse,
    /// Any effect is inside the noise floor — too small to justify the change.
    Negligible,
    /// Evidence is too thin (too few readings), conflicts (another change landed mid-Trial), or one of
    /// the two sessions was too uneven on its own to judge a change by (P4-sessions).
    Inconclusive,
    /// No defensible comparison is possible: a different game, a baseline too old to compare, or
    /// no measurement was taken at all.
    Unmeasurable,
}

/// Every verdict string the engine can write, in one place so the §8 mapping is tested exhaustively.
#[cfg(test)]
const KNOWN_VERDICTS: [&str; 8] = [
    "improved",
    "regressed",
    "no-change",
    "insufficient-evidence",
    "confounded",
    "expired",
    "not-comparable",
    "too-noisy",
];

/// Map the engine's verdict string to its §8 class. An unrecognised verdict is `Unmeasurable`, which
/// the keep rule restores: an unknown can never be kept by accident.
pub(crate) fn trial_result_for(verdict: &str) -> TrialResult {
    match verdict {
        "improved" => TrialResult::Better,
        "regressed" => TrialResult::Worse,
        "no-change" => TrialResult::Negligible,
        "insufficient-evidence" | "confounded" | "too-noisy" => TrialResult::Inconclusive,
        _ => TrialResult::Unmeasurable, // "expired" · "not-comparable" · anything unknown
    }
}

/// Trial Protocol §9 keep rule, v1: only `Better` is eligible to keep; everything else restores.
/// `Inconclusive` restores too, because v1 offers no supported "keep it anyway" choice (§9 allows one
/// only "within a supported risk boundary").
pub(crate) const fn keep_rule(result: TrialResult) -> bool {
    matches!(result, TrialResult::Better)
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub(crate) struct ExperimentStore {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub experiments: Vec<ExperimentRecord>,
}

// ─── Persistence (own store, atomic tmp+rename, corrupt→aside) ────────────
//  Copied verbatim from intelligence.rs — the same fail-safe idiom every store uses.

fn store_path() -> PathBuf {
    crate::compy_data_dir().join("experiments.json")
}

/// Load, failing SAFE on corruption: the damaged file is set aside as `.corrupt` and we start
/// fresh — never parse-partially, never overwrite the bytes in place. For reads that only show the
/// store; a write builds on [`load_store_checked_from`].
pub(crate) fn load_store_from(path: &Path) -> ExperimentStore {
    load_store_checked_from(path).unwrap_or_default()
}

/// The read a Trial write builds on (codebase review 2026-11-02). Absent is a first run and a file
/// that doesn't parse is set aside, as above; but a file that is there and could not be read (a
/// sharing violation, a permissions glitch) is an error, never an empty store, or the save that
/// follows would replace every Trial on disk, a Running one and its applied-change link included,
/// with this one.
pub(crate) fn load_store_checked_from(path: &Path) -> Result<ExperimentStore, String> {
    let raw = match std::fs::read(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(ExperimentStore::default()),
        // CR-fix-needs-trial-store (third range review): this refusal now also stands in front of every
        // one-click Fix, which can't know whether a Trial is testing its setting without this file, so
        // it still refuses (a Fix never stacks on a setting a Trial measures), but it names the file and
        // the way out. Reached by a read error other than "not found": another program holding the file
        // (a backup, sync or antivirus scan; usually a moment), a permissions change on the file, or
        // something that is not a file at that path. The io error's text carries no path.
        Err(e) => {
            return Err(format!(
                "Compy couldn't read its Trial records right now ({e}). Nothing was changed. {STORE_WHERE} \
                 This is usually another program, such as a backup, sync or antivirus scan, holding the file \
                 for a moment: try again shortly. If it keeps happening, restart Compy and check that your \
                 Windows account can open that file; if the problem continues, close Compy and move that file to another \
                 folder (don't delete it: it is the record of your Trials). {TRIAL_CHANGES_STAY}"
            ))
        }
    };
    match serde_json::from_slice::<ExperimentStore>(&raw) {
        Ok(store) => Ok(store),
        // An earlier set-aside is kept, never deleted (`set_aside_damaged`). A damaged file that
        // could NOT be set aside is still in place, so this read refuses rather than hand back an
        // empty store whose save would write over the only copy of every Trial (review round 2).
        Err(_) if crate::atomic_write::set_aside_damaged(path) => Ok(ExperimentStore::default()),
        // Reached in practice when a rename is blocked: this file, or an earlier `.corrupt` copy that
        // must move first, held open by another program. Every dated `.corrupt` name being taken needs
        // 100 set-asides sharing one modified-time second (review r1 nits).
        Err(_) => Err(format!(
            "Compy couldn't read its Trial records (the file is damaged) and couldn't set the damaged file aside \
             right now. Nothing was changed. {STORE_WHERE} Try again shortly: another program may be holding it. \
             If it keeps happening, close Compy and move that file to another folder yourself (don't delete it: \
             it is the record of your Trials). {TRIAL_CHANGES_STAY}"
        )),
    }
}

/// Where the Trial store lives, for the refusals above. Folder named by its environment form, never
/// the expanded path (that would carry the Windows user name into words a support record may keep);
/// "normally" because a measurement sandbox or a redirected root keeps it elsewhere (review r1 nit 4).
const STORE_WHERE: &str = "The file is experiments.json in Compy's data folder (normally %APPDATA%\\Compy).";

/// A recorded Trial change is an ordinary ledger row, undone from the ledger alone (review r1). Why
/// the ledger can't stand in for the store in the check itself (review r1 nit 1): a Trial start's
/// row carries no Trial link (only outcome-switch rows do), and a Pending start whose change landed
/// without a receipt is named nowhere but the store. "Recorded", not "made", for that same case.
/// Review r2 (opus SHOULD-FIX): "with its undo there when it has one", never an absolute: a row that
/// reads "changed outside Compy" or was already put back has none.
const TRIAL_CHANGES_STAY: &str = "Any change a Trial recorded stays in Test \u{2192} Applied & history, with its \
     undo there when it has one; a Trial in that file, and its result, is no longer shown once it's moved.";

fn load_store() -> ExperimentStore {
    load_store_from(&store_path())
}

fn load_store_checked() -> Result<ExperimentStore, String> {
    load_store_checked_from(&store_path())
}

/// Atomic write (tmp + rename) so a crash mid-write can't corrupt the log.
pub(crate) fn save_store_to(path: &Path, store: &ExperimentStore) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn save_store(store: &ExperimentStore) -> Result<(), String> {
    save_store_to(&store_path(), store)
}

/// Serialize read-modify-write of the store so two concurrent lifecycle calls can't tear it.
fn store_write_gate() -> &'static Mutex<()> {
    static GATE: OnceLock<Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(()))
}

/// The only way this crate takes the experiment store gate. Records the acquisition, then blocks.
///
/// #398: this gate is the OUTERMOST lock the crate takes. The three lifecycle commands hold it and
/// then enter `HISTORY_LOCK` — `start_experiment` through `history::apply_recommendation`,
/// `conclude_experiment` and `restore_experiment` through `history::rollback_change`, and the outcome
/// switch's `apply_outcome_choice` / `undo_outcome_choice` through their `_citing` forms — so it is the
/// outer half of `Experiment -> History` and, on the failure branches that record support evidence,
/// of `Experiment -> SupportEvidence`. Until this helper existed the three sites open-coded
/// `.lock()` with no record at all, which meant the recorder saw an empty stack on entering the
/// ledger lock and could not have detected Experiment re-entry, an inverted edge, or a cycle.
///
/// The poison policy is unchanged and byte-identical to the three sites it replaces: refuse, never
/// recover. A poisoned gate means some other thread panicked mid-write of `experiments.json`; this
/// module has no reconciler for that and will not pretend to.
pub(crate) fn lock_store() -> Result<crate::race_seam::StoreGuard, String> {
    crate::race_seam::try_hold_lock(crate::race_seam::StoreLock::Experiment, || {
        store_write_gate().lock().map_err(|_| "experiment store lock poisoned".to_string())
    })
}

// ─── Pure decision core (injected clock/ledger → unit-testable, anti-fabrication) ──

/// The single-variable attribution note (§4F "warn when multiple changes active"). `None` when the
/// rig is clean (a truly isolated experiment); otherwise names the count and states the honest
/// limit — the experiment isolates the ONE new variable, it does not attribute the others.
///
/// `earlier_history_set_aside` (#618): the count comes from the fresh ledger, so changes the
/// set-aside one recorded may still be in place uncounted. Then a zero is not a clean rig.
pub(crate) fn attribution_warning(active_changes: usize, earlier_history_set_aside: bool) -> Option<String> {
    let set_aside = "Compy's earlier change history was damaged and set aside, so changes it recorded \
                     aren't counted here and may still be in place. This experiment measures ONLY the \
                     one new change, holding everything else constant.";
    match (active_changes, earlier_history_set_aside) {
        (0, false) => None,
        (0, true) => Some(set_aside.into()),
        (n, set_aside_too) => Some(format!(
            "{n} other Compy change{s} already active. This experiment measures ONLY the one new \
             change, holding the others constant — it can't attribute the result to any of them.{more}",
            s = if n == 1 { " is" } else { "s are" },
            more = if set_aside_too {
                " Compy's earlier change history was also set aside, so there may be more."
            } else {
                ""
            },
        )),
    }
}

/// How many OTHER settings Compy has active: the changes the shared rule counts as on
/// (`history::AppliedChangesSummary::active_recs`, from the ledger the start already loaded), with the
/// setting under test (`own_rec`) left out. An older applied row for it, undone in Windows, leaves it
/// testable again (see [`unverified_other_changes`]), so it is never "another change" in the start
/// note (#628).
pub(crate) fn other_active_changes(active_recs: &[String], own_rec: &str) -> usize {
    active_recs.iter().filter(|rec| rec.as_str() != own_rec).count()
}

/// Build the transient `ArmedComparison` the shipped verdict machinery consumes, from a record's
/// stored baseline. Reused so the experiment verdict is byte-identical to the session A/B verdict.
fn armed_from(rec: &ExperimentRecord) -> ArmedComparison {
    ArmedComparison {
        rec_id: rec.rec_id.clone(),
        rec_title: rec.rec_title.clone(),
        game: rec.game.clone(),
        baseline_avg_fps: rec.baseline_avg_fps,
        baseline_low1_fps: rec.baseline_low1_fps,
        armed_at: rec.created_at.clone(),
        ledger_watermark: rec.ledger_watermark,
        // A Trial has its own target and other-change guards; the comparison's active count is unused.
        ledger_active: None,
        kind: ComparisonKind::Fix,
        baseline_peak_temp_c: None,
        crash_reported: false,
    }
}

/// The 1%-low %-delta vs baseline (rounded 0.1). 0 when baseline is unusable — never a divide blow-up.
fn delta_low1_pct(baseline_low1: f64, treatment_low1: f64) -> f64 {
    if baseline_low1 <= 0.0 {
        return 0.0;
    }
    let raw = (treatment_low1 - baseline_low1) / baseline_low1 * 100.0;
    (raw * 10.0).round() / 10.0
}

/// P4-recommended: the average fps %-delta vs baseline (rounded 0.1). None when either average is
/// missing (0 or less): an unknown average is never read as "didn't drop".
pub(crate) fn delta_avg_pct(baseline_avg: f64, treatment_avg: f64) -> Option<f64> {
    if baseline_avg <= 0.0 || treatment_avg <= 0.0 || !baseline_avg.is_finite() || !treatment_avg.is_finite() {
        return None;
    }
    let raw = (treatment_avg - baseline_avg) / baseline_avg * 100.0;
    Some((raw * 10.0).round() / 10.0)
}

// ─── Trial lifecycle integrity (#583 lane 1: record-first, one at a time, no hidden state) ──

/// The experiment that blocks a new start: one still starting (`Pending`) or awaiting its treatment
/// session (`Running`). Trial Protocol §3 asks one causal question at a time, so the backend refuses a
/// second start rather than trusting the UI to hide the button.
pub(crate) fn active_trial(store: &ExperimentStore) -> Option<&ExperimentRecord> {
    store
        .experiments
        .iter()
        .find(|e| matches!(e.status, ExperimentStatus::Pending | ExperimentStatus::Running))
}

/// §4.5 — what the post-apply live probe established. Only a read that came back OFF is evidence the
/// apply did not take; an unreadable or unprobed setting is unknown, never "verified".
pub(crate) fn target_verification(check: Option<crate::history::ActiveCheck>) -> Option<bool> {
    use crate::history::ActiveCheck;
    match check {
        Some(ActiveCheck::On) => Some(true),
        Some(ActiveCheck::Off) => Some(false),
        Some(ActiveCheck::Unreadable) | Some(ActiveCheck::Unrecognised) | None => None,
    }
}

/// §4.1 "verify current state" — why a Trial can't start from what the live probe reads BEFORE the
/// apply, or `None` when it can. Only a read that says the setting is NOT yet changed qualifies:
/// already changed leaves nothing to test, and a setting Compy can't read could never be verified
/// after the apply or after a restore (§7 "target state cannot be verified").
pub(crate) fn pre_apply_refusal(check: crate::history::ActiveCheck) -> Option<&'static str> {
    use crate::history::ActiveCheck;
    match check {
        ActiveCheck::Off => None,
        ActiveCheck::On => Some(
            "this setting already reads as changed on this PC, so there's nothing to test — the \
             experiment would compare the setting against itself",
        ),
        ActiveCheck::Unreadable => Some(
            "Compy can't read this setting right now, so it couldn't prove the change took effect or \
             that a restore put it back — nothing was changed; try again in a moment",
        ),
        ActiveCheck::Unrecognised => Some(
            "Compy has no way to read this setting back, so it can't verify a before/after for it — \
             nothing was changed",
        ),
    }
}

/// §4.10 "verify final state" — does the live read after the keep/restore decision match it? A kept
/// change must still read as changed. A restored one must read back as not changed, which is only
/// judged when §4.1 proved that is where it started; otherwise its prior state is unknown, and so is
/// the answer. An unread setting is unknown either way.
pub(crate) fn final_state_check(
    kept: bool,
    prior_state_verified: bool,
    check: crate::history::ActiveCheck,
) -> Option<bool> {
    use crate::history::ActiveCheck;
    match (kept, check) {
        (true, ActiveCheck::On) => Some(true),
        (true, ActiveCheck::Off) => Some(false),
        (false, ActiveCheck::Off) if prior_state_verified => Some(true),
        (false, ActiveCheck::On) if prior_state_verified => Some(false),
        _ => None,
    }
}

/// Record §4.10 after a restore, from a live read taken AFTER the rollback. A read that still shows
/// the change means Compy can't say the machine is back where it started, so the record turns
/// `Aborted` and names it — the same loud path as a restore that failed outright. Returns the
/// user-facing message in that case, `None` otherwise (including an honest unknown).
/// `compy_restored` is false when the ledger said the change was already reverted outside Compy, so
/// the message never claims a restore Compy didn't perform.
fn settle_restore(
    rec: &mut ExperimentRecord,
    compy_restored: bool,
    check: crate::history::ActiveCheck,
) -> Option<String> {
    let verified = final_state_check(false, rec.prior_state_verified, check);
    rec.final_state_verified = verified;
    if verified != Some(false) {
        return None;
    }
    rec.status = ExperimentStatus::Aborted;
    rec.kept = false;
    let before = rec.stop_reason.take().unwrap_or_else(|| "restored".into());
    rec.stop_reason = Some(format!(
        "{before}; a read afterwards shows the setting as changed — check it in Test → Applied & history"
    ));
    Some(if compy_restored {
        "Compy restored the change, but the setting still reads as changed afterwards — something \
         else may have set it again. Check it in Test → Applied & history."
            .into()
    } else {
        "The change was already undone outside Compy, but the setting now reads as changed again — \
         something else is setting it. Check it in Test → Applied & history."
            .into()
    })
}

/// §7 at conclude: the change must still read as applied for its treatment session to be evidence
/// about it. Read before the keep/restore decision, so it can overrule a keep:
/// - reads OFF → it was reverted at some point during the test, so no effect in the session can be
///   attributed to it: `confounded`, restore. A wrong-game session keeps its stronger reason.
/// - unreadable → Compy can't confirm the change was in effect for the session, so no measured verdict
///   can be pinned on it: improved, no-change and regressed alike (a crash included) become
///   `insufficient-evidence` and restore (§9: only a verified Better keeps), and no noise band is
///   recorded. A verdict that already says it wasn't judged keeps its own reason.
pub(crate) fn guard_target_at_conclude(outcome: ConcludeOutcome, still_applied: Option<bool>) -> ConcludeOutcome {
    match still_applied {
        Some(true) => outcome,
        Some(false) if outcome.verdict != "not-comparable" => ConcludeOutcome {
            verdict: "confounded".into(),
            keep: false,
            stop_reason: Some("target-reverted-during-treatment".into()),
            confidence: Confidence::Low,
            note: "The setting no longer read as changed when the test ended — it was reverted \
                   during the test, so nothing in this session can be attributed to it. Compy \
                   restored the change."
                .into(),
            ..outcome
        },
        None if matches!(outcome.verdict.as_str(), "improved" | "no-change" | "regressed") => {
            let crashed = outcome.stop_reason.as_deref() == Some("crash-during-treatment");
            ConcludeOutcome {
                verdict: "insufficient-evidence".into(),
                keep: false,
                stop_reason: Some(
                    if crashed { "crash-during-treatment; target-unreadable-at-conclude" } else { "target-unreadable-at-conclude" }
                        .into(),
                ),
                confidence: Confidence::Unknown,
                note: if crashed {
                    "The game crashed during the test, but Compy couldn't read the setting back \
                     afterwards, so it can't tell whether the change was in effect — it restored the \
                     change without blaming it."
                } else {
                    "Compy couldn't read the setting back when the test ended, so it can't confirm \
                     the change was in effect for the measurement — it restored the change and \
                     judged nothing."
                }
                .into(),
                ..outcome
            }
        }
        _ => outcome,
    }
}

/// The simulator's "already in the target state?" — the live probe wins when it can read the
/// setting, so a change reverted outside Compy is testable again and a setting that was already
/// right before Compy touched it is never offered as a test. Only an unread setting falls back to
/// the ledger.
pub(crate) fn already_in_target(live: crate::history::ActiveCheck, ledger_active: bool) -> bool {
    use crate::history::ActiveCheck;
    match live {
        ActiveCheck::On => true,
        ActiveCheck::Off => false,
        ActiveCheck::Unreadable | ActiveCheck::Unrecognised => ledger_active,
    }
}

/// The ledger fields the launch reconcile needs, borrowed so the matcher stays pure and testable.
#[derive(Clone, Copy)]
pub(crate) struct LedgerEntryRef<'a> {
    pub id: &'a str,
    pub rec_id: &'a str,
    pub applied_at: &'a str,
    /// Ledger status is "applied" (not rolled back).
    pub applied: bool,
    /// When it was rolled back. None while applied, and on rollbacks older than the stamp.
    pub rolled_back_at: Option<&'a str>,
    /// CR-unconfirmed-remedy: when the user recorded this change as changed outside Compy. A move in
    /// time like an apply or an undo: a session from before it can't say which state it ran on, so
    /// every check that pairs sessions "with nothing moved between" treats this date as a move.
    pub outside_recorded_at: Option<&'a str>,
}

impl<'a> LedgerEntryRef<'a> {
    /// Every instant at which this row moved: applied, undone, recorded as changed outside Compy.
    pub(crate) fn moved_at(&self) -> impl Iterator<Item = &'a str> {
        [Some(self.applied_at), self.rolled_back_at, self.outside_recorded_at].into_iter().flatten()
    }
}

/// The Trust Ledger the §3 one-change checks read, or why it can't back them, in words.
/// `load_history` fails loud only once on a damaged ledger: it sets the file aside, and every later
/// load returns a fresh, EMPTY ledger that would read as "no Compy change moved". The marker left on
/// disk is the only evidence that the silence is a loss.
///
/// The loss has an edge in time (#618, `history::ledger_coverage`): every move the lost file held
/// happened at or before its last write, and the fresh ledger holds every move after. So it only
/// matters to a session that began at or before that time; one that began later is covered, and a
/// PC whose ledger was set aside once is not refused forever. Unknown on either side refuses.
///
/// The known limit is the marker's own time. Something outside Compy that back-dates the file, such
/// as restoring an old copy that keeps its modified date, moves the edge earlier. That same restore
/// of a copy that still parses would drop rows with no marker at all, so no ledger check here can see it.
fn ledger_for_one_change_checks<T>(loaded: Result<Vec<T>, String>, coverage: LedgerCoverage) -> Result<Vec<T>, String> {
    let history = loaded.map_err(|_| "Compy can't read its change history".to_string())?;
    match coverage {
        LedgerCoverage::Whole | LedgerCoverage::SinceSetAside(_) => Ok(history),
        LedgerCoverage::Lost => Err("a new baseline session is needed, because Compy's change history was \
                                     damaged and set aside after this one began"
            .into()),
        LedgerCoverage::Unknown => Err("Compy's change history was damaged and set aside, and Compy can't \
                                        tell whether that happened before the session this Trial compares \
                                        against began"
            .into()),
    }
}

/// The ledger the §3 one-change checks read and what it covers for the session that began at
/// `began`: the two reads behind `ledger_for_one_change_checks`, the ledger itself and the set-aside
/// marker, in the order that can't miss a set-aside made before the load (#618 review P2).
///
/// A damaged ledger is set aside by whichever reader loads it first, and Compy's background readers
/// load it too: a session summary being saved reaches `history::ledger_len_checked` through
/// `comparison::on_session_finalized` while a comparison is armed for that game, and the session
/// start, `intelligence::gather` and Game Readiness load it on their own. Read marker-first, a start
/// could see "nothing set aside", then load the fresh EMPTY ledger a background reader had just set
/// the damaged one aside for, and read that silence as "no Compy change moved" on a clean rig.
/// Loading FIRST closes that: a set-aside that happened before the load is on disk by the time the
/// marker is read, and one that happens after the load can't have changed the rows the load
/// returned. Two reads are still two reads, not one snapshot: a marker that appears after both is the
/// next reader's to see.
///
/// The reads come in as closures so the guard in the tests can stage a set-aside DURING the load.
fn ledger_view_for_one_change_checks<T>(
    load: impl FnOnce() -> Result<Vec<T>, String>,
    set_aside_through: impl FnOnce() -> Result<Option<DateTime<Utc>>, String>,
    began: Option<&str>,
) -> (Result<Vec<T>, String>, LedgerCoverage) {
    let loaded = load();
    let coverage = crate::history::ledger_coverage(set_aside_through(), began);
    (ledger_for_one_change_checks(loaded, coverage), coverage)
}

/// The sessions a between-session measurement may pair under `coverage` (#618): after a set-aside,
/// only those begun past its edge, the same edge `history::ledger_coverage` draws, because the fresh
/// ledger can't say what moved between sessions older than that. Every session otherwise.
pub(crate) fn sessions_the_ledger_covers(sessions: &[SessionSummary], coverage: LedgerCoverage) -> std::borrow::Cow<'_, [SessionSummary]> {
    match coverage {
        LedgerCoverage::SinceSetAside(at) => std::borrow::Cow::Owned(
            sessions
                .iter()
                .filter(|s| {
                    crate::history::ledger_coverage(Ok(Some(at)), Some(s.started_at.as_str()))
                        == LedgerCoverage::SinceSetAside(at)
                })
                .cloned()
                .collect(),
        ),
        LedgerCoverage::Whole | LedgerCoverage::Lost | LedgerCoverage::Unknown => std::borrow::Cow::Borrowed(sessions),
    }
}

/// The Trust Ledger as the pure checks here read it.
pub(crate) fn ledger_rows(history: &[crate::history::AppliedChange]) -> Vec<LedgerEntryRef<'_>> {
    history
        .iter()
        .map(|c| LedgerEntryRef {
            id: &c.id,
            rec_id: &c.rec_id,
            applied_at: &c.applied_at,
            applied: c.status == "applied",
            rolled_back_at: c.rolled_back_at.as_deref(),
            outside_recorded_at: c.changed_outside.as_ref().map(|m| m.recorded_at.as_str()),
        })
        .collect()
}

/// What a Trial start reads off the one ledger it loaded: the rows the §3 checks walk and both counts
/// it records, all folded from those same rows. There is no second load to disagree with the first
/// (#668): the start used to re-read the ledger for its counts, and a read that failed there (an AV
/// lock on history.json) counted 0 changes active on a rig that had some.
struct StartLedgerView<'a> {
    changes: &'a [crate::history::AppliedChange],
    rows: Vec<LedgerEntryRef<'a>>,
    /// The ledger's counts by the one shared rule (`history::summarize_history`, which counts through
    /// `history::live_change_groups`): `counts` is what `baseline_is_current` compares with the
    /// baseline session's own counts, `active` is recorded as the Trial's `active_changes_at_start`,
    /// and `active_recs` names those changes for the "other changes" note (453-f1 review).
    counts: crate::history::SessionChangeCounts,
    active: usize,
    active_recs: Vec<String>,
}

/// The start's view of the ledger it loaded, once the §3 baseline check has passed on it, or why the
/// start is refused, in the check's own words. An unreadable ledger has no view and so no count:
/// nothing after this can record a 0 for a ledger that didn't load.
///
/// #618: after a set-aside the ledger's counts are counted since it, so the baseline's are read the
/// same way (`SessionSummary::counted_since_set_aside`); a baseline that recorded none since that
/// set-aside keeps its whole fields, which are "not recorded", and is refused in those words.
fn baseline_checked_view<'a>(
    baseline: &SessionSummary,
    history: &'a Result<Vec<crate::history::AppliedChange>, String>,
    coverage: LedgerCoverage,
) -> Result<StartLedgerView<'a>, String> {
    let counted = match coverage {
        LedgerCoverage::SinceSetAside(at) => baseline.counted_since_set_aside(at),
        LedgerCoverage::Whole | LedgerCoverage::Lost | LedgerCoverage::Unknown => None,
    };
    let baseline = counted.as_ref().unwrap_or(baseline);
    let view = history.as_deref().map(|changes| {
        let summary = crate::history::summarize_history(changes);
        StartLedgerView {
            changes,
            rows: ledger_rows(changes),
            counts: summary.session_counts(),
            active: summary.active,
            active_recs: summary.active_recs,
        }
    });
    let ledger = match &view {
        Ok(view) => Ok((view.rows.as_slice(), view.counts)),
        Err(e) => Err(e.as_str()),
    };
    baseline_is_current(baseline, ledger)?;
    view.map_err(String::clone)
}

/// Whether any ledger entry other than `own` was applied or rolled back after `since`. A date that
/// can't be read counts as after: an unknown never passes as "nothing moved". A rollback older than
/// its stamp carries no date at all; the active-change counts are what catch those.
fn compy_change_moved_after(ledger: &[LedgerEntryRef<'_>], since: &str, own: Option<&str>) -> bool {
    let Ok(since) = DateTime::parse_from_rfc3339(since) else {
        return true;
    };
    let after = |at: &str| DateTime::parse_from_rfc3339(at).map_or(true, |at| at > since);
    ledger
        .iter()
        .filter(|c| Some(c.id) != own)
        .any(|c| c.moved_at().any(after))
}

/// Which ledger entry, if any, an interrupted (`Pending`) start applied: the earliest still-applied
/// entry for the same rec that no other experiment already owns and that was not provably applied
/// BEFORE this start began. An entry whose date can't be read is treated as possibly ours, so an
/// unknown resolves to "tell the user loudly", never to "nothing was changed".
pub(crate) fn interrupted_start_change<'a>(
    pending: &ExperimentRecord,
    ledger: &[LedgerEntryRef<'a>],
    claimed: &[&str],
) -> Option<&'a str> {
    let started = DateTime::parse_from_rfc3339(&pending.created_at).ok();
    ledger
        .iter()
        .filter(|c| c.applied && c.rec_id == pending.rec_id && !claimed.contains(&c.id))
        .filter(|c| match (started, DateTime::parse_from_rfc3339(c.applied_at).ok()) {
            (Some(s), Some(a)) => a >= s,
            _ => true,
        })
        // Earliest provable apply first; an undated entry only when nothing dated qualifies.
        .min_by_key(|c| {
            let at = DateTime::parse_from_rfc3339(c.applied_at).ok();
            (at.is_none(), at)
        })
        .map(|c| c.id)
}

/// What a reconcile did to one interrupted start.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum InterruptedStart {
    /// A change was applied and is still in place: the record becomes a loud `Aborted` naming it.
    ChangeStillApplied,
    /// The start recorded its change and the ledger shows it rolled back: `Restored`, nothing kept.
    ChangeAlreadyRolledBack,
    /// The start recorded a change the ledger no longer has: a loud `Aborted` naming it.
    ChangeMissing,
    /// The ledger could not be read: a loud `Aborted` saying Compy can't check the change, keeping any
    /// change id the start saved. Left `Pending`, it would stay hidden from the bench while blocking
    /// every later start for as long as the read keeps failing.
    LedgerUnreadable,
    /// No change record was found: a loud `Aborted`. Compy has no receipt for it, so no undo to run.
    /// Neither an empty ledger nor a live read proves nothing was changed: a setting written in
    /// several steps reads as unchanged when the apply was cut off part-way.
    ChangeUnrecorded,
}

/// PURE reconcile (injected ledger + clock). Every `Pending` record left by a start that never
/// finished is resolved; nothing is silently kept or silently dropped, and nothing is mutated here. There is no automatic
/// restore: no measurement exists, so §9 says restore, but a rollback may need elevation and nobody
/// asked for a prompt. The change stays in the Fix surface's active list, where its rollback lives,
/// and the record says so. A start that recorded its change id is matched by that id alone; only a
/// start interrupted inside the apply itself (id never saved) falls back to
/// [`interrupted_start_change`]. When that finds no change, the record becomes a loud `Aborted`
/// whose wording follows `changed` (a live read of the rec's setting, as [`target_verification`]
/// answers it). A ledger set aside as damaged, or an apply that changed Windows and then failed to
/// save its receipt, leaves no row to find; and a setting written in several steps reads as unchanged
/// when the apply stopped part-way. So neither is ever taken as "nothing was changed".
pub(crate) fn reconcile_interrupted_starts_in(
    store: &mut ExperimentStore,
    ledger: Result<&[LedgerEntryRef<'_>], &str>,
    changed: impl Fn(&str) -> Option<bool>,
    now: DateTime<Utc>,
) -> Vec<InterruptedStart> {
    let mut outcomes = Vec::new();
    let mut i = 0;
    while i < store.experiments.len() {
        if store.experiments[i].status != ExperimentStatus::Pending {
            i += 1;
            continue;
        }
        let recorded = store.experiments[i].applied_change_id.clone();
        let mut live_read = None;
        let resolution = match ledger {
            Err(_) => InterruptedStart::LedgerUnreadable,
            Ok(rows) if recorded.is_empty() => {
                let claimed: Vec<&str> = store
                    .experiments
                    .iter()
                    .map(|e| e.applied_change_id.as_str())
                    .filter(|id| !id.is_empty())
                    .collect();
                match interrupted_start_change(&store.experiments[i], rows, &claimed) {
                    Some(id) => {
                        store.experiments[i].applied_change_id = id.to_string();
                        InterruptedStart::ChangeStillApplied
                    }
                    None => {
                        live_read = changed(&store.experiments[i].rec_id);
                        InterruptedStart::ChangeUnrecorded
                    }
                }
            }
            Ok(rows) => match rows.iter().find(|r| r.id == recorded) {
                Some(r) if r.applied => InterruptedStart::ChangeStillApplied,
                Some(_) => InterruptedStart::ChangeAlreadyRolledBack,
                None => InterruptedStart::ChangeMissing,
            },
        };
        let rec = &mut store.experiments[i];
        match resolution {
            InterruptedStart::ChangeStillApplied => {
                rec.status = ExperimentStatus::Aborted;
                rec.stop_reason = Some(
                    "interrupted-start: Compy closed while this experiment was starting, after the \
                     change was applied. Nothing was measured, so undo it in Test → Applied & history."
                        .into(),
                );
            }
            InterruptedStart::ChangeAlreadyRolledBack => {
                rec.status = ExperimentStatus::Restored;
                rec.stop_reason = Some(
                    "interrupted-start: Compy closed while this experiment was starting; its change \
                     history shows the change already rolled back. Nothing was measured."
                        .into(),
                );
            }
            InterruptedStart::ChangeUnrecorded => {
                rec.status = ExperimentStatus::Aborted;
                rec.stop_reason = Some(
                    if live_read == Some(false) {
                        "interrupted-start: Compy closed while this experiment was starting, before it \
                         recorded a change. The setting reads as not changed, but a change cut off \
                         part-way can read that way too, and Compy has no undo record for it. If it \
                         looks changed in Windows, set it back there."
                    } else {
                        "interrupted-start: Compy closed while this experiment was starting. Its change \
                         history has no record of a change, but the setting doesn't read as unchanged, \
                         so Compy has no undo for it and it won't be listed in Test → Applied & history. \
                         Check the setting in Windows."
                    }
                    .into(),
                );
            }
            InterruptedStart::LedgerUnreadable => {
                rec.status = ExperimentStatus::Aborted;
                rec.stop_reason = Some(if recorded.is_empty() {
                    "interrupted-start: Compy closed while this experiment was starting, and its change \
                     history can't be read, so Compy can't tell whether the change was made. Nothing was \
                     measured. If it's listed in Test → Applied & history, undo it there; if not, check \
                     the setting in Windows."
                        .into()
                } else {
                    format!(
                        "interrupted-start: Compy closed while this experiment was starting, after the \
                         change ({recorded}) was applied, and its change history can't be read to check \
                         on it. Nothing was measured, so undo it in Test → Applied & history; if it isn't \
                         listed there, check the setting in Windows."
                    )
                });
            }
            InterruptedStart::ChangeMissing => {
                rec.status = ExperimentStatus::Aborted;
                rec.stop_reason = Some(format!(
                    "interrupted-start: Compy closed while this experiment was starting, and its \
                     change ({recorded}) is no longer in the change history — check it in Test → Applied & history."
                ));
            }
        }
        rec.kept = false;
        rec.trial_result = Some(TrialResult::Unmeasurable);
        rec.concluded_at = Some(now.to_rfc3339());
        outcomes.push(resolution);
        i += 1;
    }
    outcomes
}

/// The honest outcome of concluding an experiment. `verdict` is the surfaced string; `keep` decides
/// whether the change stays applied; `stop_reason` is set only on an error/blocked path. `confidence`
/// is a BAND (never a number), and `note` is a plain-language methodology/comparability line — the
/// two together answer "how much can I trust this before/after?" (Task F).
#[derive(Debug, PartialEq, Clone)]
pub(crate) struct ConcludeOutcome {
    pub verdict: String,
    pub keep: bool,
    pub delta_low1_pct: f64,
    pub stop_reason: Option<String>,
    /// How much the evidence QUALITY (not the effect size) justifies trusting this verdict.
    pub confidence: Confidence,
    /// Plain-language "what supports / limits this" note — the experiment's methodology in one line.
    pub note: String,
}

/// Whether the treatment session measured the SAME game as the baseline. Since #583 lane 2b both
/// names come from Compy's own session store and `resolve_treatment` refuses different games first
/// (via `comparability::derive`); this stays as defense-in-depth inside the pure verdict, so no
/// caller can make Compy compare two different games and call it a clean result. Decision doc
/// `docs/decisions/2026-07-18-experiment-comparability.md` §3/§4.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GameMatch {
    /// Both identities are known and equal (case-insensitive) — the single-variable compare is valid.
    Match,
    /// Both known and DIFFERENT — a different game is a different workload, so the before/after is not
    /// comparable at all; the verdict must decline, never keep a change on a wrong-game reading.
    Mismatch,
    /// The treatment game identity wasn't supplied, or either side is blank — honestly unknown. We do
    /// NOT assume the games matched (never fabricate identity), but this is no worse than before the
    /// check existed: the verdict proceeds exactly as it did, minus the unearned "same game" claim.
    Unverified,
}

/// Compare the baseline game identity to the treatment session's, conservatively: an absent or blank
/// identity on either side is [`GameMatch::Unverified`] (never silently treated as equal OR as
/// different) — only two known, non-blank, unequal names are a [`GameMatch::Mismatch`]. Process names
/// (`"cs2.exe"`) compare case-insensitively after trimming — the same identity the FE filters
/// treatment sessions by.
fn game_match(baseline: &str, treatment: Option<&str>) -> GameMatch {
    let baseline = baseline.trim();
    match treatment.map(str::trim) {
        Some(t) if !baseline.is_empty() && !t.is_empty() => {
            if baseline.eq_ignore_ascii_case(t) {
                GameMatch::Match
            } else {
                GameMatch::Mismatch
            }
        }
        _ => GameMatch::Unverified,
    }
}

/// The honest confidence BAND in an experiment verdict (Task F) — NOT a number and NOT a promise. It
/// answers "how much can you trust this before/after conclusion?" from the QUALITY of the evidence,
/// never the size of the effect. Precedence mirrors [`conclude_outcome`]:
///
/// - **not-comparable → Unknown** — the treatment measured a different game than the baseline, so
///   there is no comparable before/after at all; ahead of even the crash signal (a crash in the wrong
///   game can't be attributed to this change either).
/// - **crash → High** — a crash is an unambiguous stability failure; the "restore it" conclusion
///   does not depend on the fps reading at all.
/// - **insufficient samples → Unknown** — not enough comparable evidence to judge; the honest "we
///   don't know", never a fabricated verdict.
/// - **confounded / expired → Low** — another change happened mid-test, or the baseline is too old:
///   the before/after is no longer a clean single-variable compare.
/// - **improved / no-change / regressed** (clean guards + enough samples) → High when the treatment
///   session is comfortably long (≥ 2× the minimum readings), else Medium — a valid but shorter sample.
fn verdict_confidence(verdict: &str, treatment_samples: u32, crashed: bool) -> Confidence {
    // A different-game treatment is not comparable evidence at all — Unknown, ahead of the crash
    // signal (kept in step with `conclude_outcome`'s top-precedence game-match guard).
    if verdict == "not-comparable" {
        return Confidence::Unknown;
    }
    if crashed {
        return Confidence::High;
    }
    if treatment_samples < MIN_TREATMENT_SAMPLES {
        return Confidence::Unknown;
    }
    match verdict {
        "confounded" | "expired" => Confidence::Low,
        "insufficient-evidence" => Confidence::Unknown,
        _ if treatment_samples >= MIN_TREATMENT_SAMPLES.saturating_mul(2) => Confidence::High,
        _ => Confidence::Medium,
    }
}

/// P4-comparable: how much of a session was left out because another window was in front, as a
/// clause for "too few readings" reasons: "while the game was in front (12 min were left out
/// because another window was in front)". Empty when nothing was left out or focus wasn't recorded.
pub(crate) fn left_out_clause(session: &SessionSummary) -> String {
    match session.background_secs_excluded {
        Some(secs) if secs > 0 => {
            let span = if secs < 60 { format!("{secs} s") } else { format!("{} min", secs / 60) };
            format!(" while the game was in front ({span} were left out because another window was in front)")
        }
        _ => String::new(),
    }
}

/// A too-few-readings result on a session that left time out says the readings were counted while the
/// game was in front, and how much was left out, so "only 400 readings" from a 40-minute session is
/// not a mystery.
fn with_left_out_readings(outcome: ConcludeOutcome, treatment: &SessionSummary) -> ConcludeOutcome {
    let clause = left_out_clause(treatment);
    if clause.is_empty() || outcome.stop_reason.as_deref() != Some("insufficient-samples") {
        return outcome;
    }
    let note = format!(
        "Only {} frame-rate readings (about one a second) were captured{clause} — below the \
         {MIN_TREATMENT_SAMPLES} (about 10 minutes of play) Compy needs for a fair before/after. That \
         is not enough comparable evidence to judge this change, so it was restored and the result is \
         left as unknown.",
        treatment.samples
    );
    ConcludeOutcome { note, ..outcome }
}

/// The plain-language "what supports / limits this verdict" line (Task F) — the experiment's
/// methodology in one sentence, in product language (single-variable, comparable-evidence,
/// direct-comparison-limited). Never a numeric confidence.
fn verdict_note(verdict: &str, treatment_samples: u32, crashed: bool, game: GameMatch) -> String {
    if crashed {
        return "The game crashed during the test — an unambiguous stability failure on this rig, so \
                Compy restored the change. This verdict does not rely on the frame-rate reading."
            .into();
    }
    if treatment_samples < MIN_TREATMENT_SAMPLES {
        return format!(
            "Only {treatment_samples} frame-rate readings (about one a second) were captured — below \
             the {MIN_TREATMENT_SAMPLES} (about 10 minutes of play) Compy needs for a fair \
             before/after. That is not enough comparable evidence to judge this change, so it was \
             restored and the result is left as unknown."
        );
    }
    match verdict {
        "confounded" => "Another change happened during the test, so the before and after are no \
                         longer a clean single-variable comparison — this result can't be attributed \
                         to the change under test."
            .into(),
        "expired" => "The baseline is too old to compare fairly against this session, so direct \
                      comparison is limited."
            .into(),
        _ => {
            // Only claim the games matched when the backend actually VERIFIED it — never a silent
            // "same game" assumption (decision doc 2026-07-18-experiment-comparability §4). When
            // either game name is blank we drop the claim rather than assert something unproven;
            // a genuine Mismatch never reaches here (it returns "not-comparable" upstream).
            let same_rig_and_game = match game {
                GameMatch::Match => "on the same rig and game",
                _ => "on the same rig",
            };
            // No "back-to-back" claim: the baseline can be any earlier session, not the one before.
            // "No other change" is only what the ledger watermark proves: Compy's own changes during
            // the test. It never claims the baseline was taken just before the change.
            format!(
                "Baseline and treatment were captured {same_rig_and_game}, and Compy made no other \
                 change during the test."
            )
        }
    }
}

/// PURE conclude logic (§4F steps 6–8). Injected `ledger_now`/`now` so it's testable without disk or
/// the clock. Precedence (safety-first): crash → insufficient samples → the comparison verdict
/// (which itself layers expiry/confound over the noise-floor classify). KEEP only on a clear
/// `improved` with no crash and enough samples; EVERYTHING else restores (no benefit ⇒ back to the
/// known-clean baseline — "keep only when evidence justifies").
pub(crate) fn conclude_outcome(
    rec: &ExperimentRecord,
    treatment_low1: f64,
    treatment_samples: u32,
    crashed: bool,
    treatment_game: Option<&str>,
    ledger_now: Option<usize>,
    now: DateTime<Utc>,
) -> ConcludeOutcome {
    let delta = delta_low1_pct(rec.baseline_low1_fps, treatment_low1);
    let game = game_match(&rec.game, treatment_game);

    // TOP precedence (defense-in-depth, decision doc 2026-07-18-experiment-comparability §3/§4): if
    // the treatment session measured a KNOWN-different game than the baseline, this is not a
    // comparable before/after — a different game is a different workload, so nothing about that
    // session is attributable to the change under test (not even a crash). Decline with an honest
    // not-comparable verdict at Unknown confidence and RESTORE — never keep a change on a wrong-game
    // reading, never silently assume the games matched. An UNVERIFIED game (identity not supplied) is
    // no worse than before this check existed: fall through to the normal precedence below.
    if game == GameMatch::Mismatch {
        let treatment_name = treatment_game.map(str::trim).unwrap_or("unknown");
        return ConcludeOutcome {
            verdict: "not-comparable".into(),
            keep: false,
            delta_low1_pct: delta,
            stop_reason: Some("treatment-game-differs-from-baseline".into()),
            confidence: verdict_confidence("not-comparable", treatment_samples, crashed),
            note: format!(
                "The test session measured a different game ({treatment_name}) than the baseline \
                 ({}), so this isn't a comparable before/after — that's not enough comparable \
                 evidence to judge the change, so Compy restored it and left the result unknown.",
                rec.game.trim(),
            ),
        };
    }

    // A crash during the treatment session means the change is unstable/unsupported on this rig —
    // restore regardless of any fps reading (§4F "stop on crash"), and say so.
    if crashed {
        return ConcludeOutcome {
            verdict: "regressed".into(),
            keep: false,
            delta_low1_pct: delta,
            stop_reason: Some("crash-during-treatment".into()),
            confidence: verdict_confidence("regressed", treatment_samples, true),
            note: verdict_note("regressed", treatment_samples, true, game),
        };
    }

    // Too few readings ⇒ no honest verdict; restore rather than keep on thin evidence
    // (§1 "missing evidence renders as unknown, not zero"; §4F "stop on insufficient samples").
    if treatment_samples < MIN_TREATMENT_SAMPLES {
        return ConcludeOutcome {
            verdict: "insufficient-evidence".into(),
            keep: false,
            delta_low1_pct: delta,
            stop_reason: Some("insufficient-samples".into()),
            confidence: verdict_confidence("insufficient-evidence", treatment_samples, false),
            note: verdict_note("insufficient-evidence", treatment_samples, false, game),
        };
    }

    let armed = armed_from(rec);
    let verdict =
        comparison::classify_with_guards(&armed, delta, rec.noise_floor_pct, ledger_now, now)
            .to_string();
    // Keep ONLY a clean, attributable improvement (§9 keep rule). no-change / regressed / confounded /
    // expired all restore — a change that didn't measurably help has no justification to stay.
    let keep = keep_rule(trial_result_for(&verdict));
    let confidence = verdict_confidence(&verdict, treatment_samples, false);
    let note = verdict_note(&verdict, treatment_samples, false, game);
    ConcludeOutcome { verdict, keep, delta_low1_pct: delta, stop_reason: None, confidence, note }
}

// ─── Backend-owned evidence (#583 lane 2b: sessions looked up by id, never numbers from the UI) ──

/// What looking a session up by id found.
enum SessionLookup<'a> {
    Found(&'a SessionSummary),
    Missing,
    /// Two sessions share the id. Refused rather than guessing which one was meant.
    Ambiguous,
}

/// The session whose id (its `started_at`) is `id`.
fn session_by_id<'a>(sessions: &'a [SessionSummary], id: &str) -> SessionLookup<'a> {
    let mut hits = sessions.iter().filter(|s| s.started_at == id);
    match (hits.next(), hits.next()) {
        (None, _) => SessionLookup::Missing,
        (Some(s), None) => SessionLookup::Found(s),
        (Some(_), Some(_)) => SessionLookup::Ambiguous,
    }
}

/// A session carries a real frame-rate reading: both the average and the 1% low were measured.
/// Without a 1% low there is nothing to judge a Trial on.
pub(crate) fn has_frame_reading(s: &SessionSummary) -> bool {
    s.avg_fps.is_finite() && s.avg_fps > 0.0 && s.low1_fps_est.is_finite() && s.low1_fps_est > 0.0
}

// ─── P7-notify: which finished sessions earn the session-end toast ─────────

/// Why a saved session interrupts the player with a native toast (Constitution §15: only for a
/// decision or a state change; §33: never for engagement). Every other session stays silent and its
/// debrief simply waits in the app.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SessionEndNotice {
    /// A running Trial of this game (the bench or the guided journey) now has its after-session, so
    /// it gets a verdict.
    TrialMeasured,
    /// A one-shot before/after armed from a debrief (`ComparisonKind::Fix`) was settled by this session.
    BeforeAfterSettled,
    /// The 1% low fell below this game's last steady session by more than the noise band.
    Regressed,
    /// P5-realplay: with this session, a running real-play Trial of this game reached a look that
    /// gives a result ([`realplay_ready_notice`]).
    RealPlayReady,
}

impl SessionEndNotice {
    /// The toast body. English only, like every native toast Compy shows (`lib.rs`).
    pub(crate) fn body(self, process_name: &str) -> String {
        let game = crate::intelligence::pretty_game_name(process_name);
        let game = if game.is_empty() { "your game".to_string() } else { game };
        match self {
            Self::TrialMeasured => format!("Your {game} Trial session is measured. Open Compy for the verdict."),
            Self::RealPlayReady => format!("Your {game} test has enough sessions for a result. Open Compy to see it."),
            Self::BeforeAfterSettled => format!("Your {game} before/after result is ready in Compy."),
            Self::Regressed => format!(
                "{game} dipped lower than in your last steady session. The debrief in Compy has the details."
            ),
        }
    }
}

/// Pure (P7-notify): does the session that just saved earn the toast, and why. `sessions` is the
/// session store (it may hold `session` itself), `trials` the experiment store, `settled` what
/// `comparison::on_session_finalized` reported for this session, and `band_pct` the noise band the
/// regression check is judged against (`noise_floor::noise_band_pct`). No new threshold: the Trial
/// match is `began_after_apply` on a Running record, steadiness is `grade_baseline` on the default
/// floor, comparability is `comparability::derive`, and "worse" is `comparison::classify`.
///
/// A session that measured nothing (`samples == 0`, the game behind another window the whole time)
/// never notifies: it settles nothing and has no reading to compare.
pub(crate) fn session_end_notice(
    session: &SessionSummary,
    sessions: &[SessionSummary],
    trials: &[ExperimentRecord],
    settled: Option<ComparisonKind>,
    band_pct: Option<f64>,
) -> Option<SessionEndNotice> {
    if session.samples == 0 || !has_frame_reading(session) || session.process_name.trim().is_empty() {
        return None;
    }
    // Only THE after-session: the first saved session of the game after the change went on. A Trial
    // stays Running until the user concludes it, so later sessions must stay silent (§15/§33). A
    // real-play Trial has no single after-session: it stays on across many, and is told only when a
    // look gives a result (`realplay_ready_notice`).
    let after = |s: &SessionSummary, at: &str| began_after_apply(s, at) == Some(true);
    let trial = trials.iter().any(|t| {
        t.status == ExperimentStatus::Running
            && t.mode == TrialMode::Pair
            && t.game == session.process_name
            && t.applied_at.as_deref().is_some_and(|at| {
                after(session, at)
                    && !sessions.iter().any(|s| {
                        s.started_at != session.started_at
                            && s.process_name == session.process_name
                            && s.samples > 0
                            && after(s, at)
                    })
            })
    });
    if trial {
        return Some(SessionEndNotice::TrialMeasured);
    }
    if settled == Some(ComparisonKind::Fix) {
        return Some(SessionEndNotice::BeforeAfterSettled);
    }
    // An unmeasured band is a floor, not a measurement (P4-rank): it never drives a regression claim.
    let band_pct = band_pct?;
    // A session too short to be a baseline is too short to call a regression on.
    if matches!(grade_baseline(session, DEFAULT_NOISE_FLOOR_PCT), BaselineGrade::TooShort { .. }) {
        return None;
    }
    let at = |s: &SessionSummary| DateTime::parse_from_rfc3339(&s.started_at).ok();
    let now = at(session)?;
    let last_steady = sessions
        .iter()
        .filter(|s| s.process_name == session.process_name && has_frame_reading(s))
        .filter_map(|s| Some((at(s)?, s)))
        .filter(|(t, s)| *t < now && matches!(grade_baseline(s, DEFAULT_NOISE_FLOOR_PCT), BaselineGrade::Steady(_)))
        .max_by_key(|(t, _)| *t)
        .map(|(_, s)| s)?;
    match crate::comparability::derive(last_steady, session).verdict {
        // Partial means some conditions differ; "dipped lower" would read as a causal claim.
        Comparability::Comparable => {}
        Comparability::Partial | Comparability::NotComparable | Comparability::Unknown => return None,
    }
    // P4-judge-noisy: a session held by a frame cap the other wasn't (or whose cap can't be read) is
    // not compared: the cap, not the PC, could be the difference.
    if crate::noise_floor::cap_pair(crate::noise_floor::cap_read(last_steady), crate::noise_floor::cap_read(session))
        != crate::noise_floor::CapPair::Same
    {
        return None;
    }
    let delta = delta_low1_pct(last_steady.low1_fps_est, session.low1_fps_est);
    (comparison::classify(delta, band_pct) == "regressed").then_some(SessionEndNotice::Regressed)
}

/// [`session_end_notice`] on the live stores, for the monitoring loop right after a save. Reads only:
/// the experiment store is read the way `get_experiments` reads it (no gate, nothing written), and
/// no store lock is held across any of it. The band leaves `session` out of the spread, so the drop
/// being judged can't widen the band that judges it; an unreadable ledger or an unmeasured spread is
/// `None`, which never toasts a regression (the fixed default is a floor, not a measurement).
pub(crate) fn session_end_notice_now(
    session: &SessionSummary,
    settled: Option<ComparisonKind>,
) -> Option<SessionEndNotice> {
    if session.samples == 0 {
        return None;
    }
    let sessions = crate::sessions::get_session_summaries();
    let trials = load_store().experiments;
    let others: Vec<SessionSummary> = sessions.iter().filter(|s| s.started_at != session.started_at).cloned().collect();
    let (history, coverage) = ledger_view_for_one_change_checks(
        crate::history::load_history,
        crate::history::ledger_set_aside_through,
        Some(session.started_at.as_str()),
    );
    // P4-judge-noisy: the same measured band a Trial is judged on (its 1% low band); unmeasured is None.
    let band = history.as_deref().ok().and_then(|h| {
        crate::noise_floor::measure_game_noise(&sessions_the_ledger_covers(&others, coverage), session, &ledger_rows(h))
            .ok()
            .map(|n| n.low1_band_pct)
    });
    // P5-realplay: a real-play Trial of this game is told only when this session makes a look give a
    // result; the setting is read only when such a Trial runs.
    let rows = history.as_deref().ok().map(ledger_rows);
    let reads = crate::history::LiveReads::default();
    let live = |rec_id: &str| target_verification(Some(crate::history::probe_rec_target_with(rec_id, &reads)));
    realplay_ready_notice(session, &sessions, &trials, rows.as_deref(), coverage, live, Utc::now())
        .or_else(|| session_end_notice(session, &sessions, &trials, settled, band))
}

/// Whether `coverage`, read for a later session, also covers one begun at `began` (#618): after a
/// set-aside, only a session begun past its edge is.
fn coverage_covers(coverage: LedgerCoverage, began: Option<&str>) -> bool {
    match coverage {
        LedgerCoverage::Whole => true,
        LedgerCoverage::SinceSetAside(at) => {
            crate::history::ledger_coverage(Ok(Some(at)), began) == LedgerCoverage::SinceSetAside(at)
        }
        LedgerCoverage::Lost | LedgerCoverage::Unknown => false,
    }
}

/// Pure (P5-realplay): does the session that just saved make a running real-play Trial of its game
/// ready, so the player is told once (Constitution §15: a decision or a state change; §33: never for
/// engagement)? Only when this session is the last one of the look that decides: a look that keeps
/// collecting is no decision, and a later session never toasts a look already decided. A stopped
/// Trial, a session that doesn't count, and a change history that can't back the count (`ledger`
/// `None`, or `coverage` not reaching the Trial's own as-is sessions) all stay silent. `live` reads
/// the setting (as [`target_verification`] answers it) and is called only when such a Trial runs.
pub(crate) fn realplay_ready_notice(
    session: &SessionSummary,
    sessions: &[SessionSummary],
    trials: &[ExperimentRecord],
    ledger: Option<&[LedgerEntryRef<'_>]>,
    coverage: LedgerCoverage,
    live: impl FnOnce(&str) -> Option<bool>,
    now: DateTime<Utc>,
) -> Option<SessionEndNotice> {
    let trial = trials.iter().find(|t| {
        t.status == ExperimentStatus::Running
            && t.mode == TrialMode::RealPlay
            && game_match(&t.game, Some(session.process_name.as_str())) == GameMatch::Match
    })?;
    let ledger = ledger.filter(|_| coverage_covers(coverage, trial.baseline_session_id.as_deref()))?;
    let read = real_play_read(trial, sessions, ledger, live(&trial.rec_id), now).ok()?;
    if read.arm.stop.is_some() {
        return None;
    }
    let crate::realplay::Judgement::Decided { look, .. } = &read.judgement else { return None };
    let last = read.arm.counted.get(look.with.checked_sub(1)?)?;
    (last.started_at == session.started_at).then_some(SessionEndNotice::RealPlayReady)
}

/// Measurement item 8: this game's measured as-is noise up to `baseline` (`noise_floor::measure_game_noise`
/// over the sessions Compy's change history covers, the same read the old-verdict label makes), for the
/// comparisons outside a Trial: the armed Fix/Tuning comparison and the session-pattern trends. `None`
/// when it isn't measured (too few as-is sessions, an unreadable cap state, or a change history that
/// can't be read): the caller then calls nothing better or worse.
pub(crate) fn measured_noise_at(sessions: &[SessionSummary], baseline: &SessionSummary) -> Option<crate::noise_floor::GameNoise> {
    let (history, coverage) = ledger_view_for_one_change_checks(
        crate::history::load_history,
        crate::history::ledger_set_aside_through,
        Some(baseline.started_at.as_str()),
    );
    let history = ledger_for_one_change_checks(history, coverage).ok()?;
    let covered = sessions_the_ledger_covers(sessions, coverage);
    crate::noise_floor::measure_game_noise(&covered, baseline, &ledger_rows(&history)).ok()
}

/// P4-rank: the band the NEXT Trial would be judged against, only when it is measured — the
/// between-session spread of the game the bench offers as baseline (the newest session with a frame
/// reading and a known game, the same pick `ExperimentBench` makes), never below the fixed default.
/// `None` when that game's spread isn't measured or the change history can't be read: the fixed
/// default is a floor, not a measurement of this game, so it never marks a change too small.
pub(crate) fn next_trial_measured_band_pct() -> Option<f64> {
    let sessions = crate::sessions::get_session_summaries();
    let baseline = sessions
        .iter()
        .filter(|s| has_frame_reading(s) && !s.process_name.trim().is_empty())
        .filter_map(|s| Some((chrono::DateTime::parse_from_rfc3339(&s.started_at).ok()?, s)))
        .max_by_key(|(at, _)| *at)
        .map(|(_, s)| s)?;
    let (history, coverage) = ledger_view_for_one_change_checks(
        crate::history::load_history,
        crate::history::ledger_set_aside_through,
        Some(baseline.started_at.as_str()),
    );
    let history = history.ok()?;
    let covered = sessions_the_ledger_covers(&sessions, coverage);
    crate::noise_floor::measure_game_noise(&covered, baseline, &ledger_rows(&history)).ok().map(|n| n.low1_band_pct)
}

/// §4.2 — the baseline session a start is judged against, looked up in Compy's own session store.
/// Refuses one it can't find, one without a frame-rate reading (an unmeasured 1% low would make every
/// later delta meaningless), and one that didn't record which game was running.
pub(crate) fn resolve_baseline<'a>(
    sessions: &'a [SessionSummary],
    id: &str,
) -> Result<&'a SessionSummary, String> {
    let session = match session_by_id(sessions, id) {
        SessionLookup::Missing => {
            return Err("the baseline session isn't in your session history any more — play a \
                        monitored session, then try again"
                .into())
        }
        SessionLookup::Ambiguous => {
            return Err("two sessions in your history share that baseline's start time, so Compy \
                        can't tell which one to use"
                .into())
        }
        SessionLookup::Found(s) => s,
    };
    if session.behind_the_whole_time() {
        return Err("the baseline session measured nothing: another window was in front the whole \
                    time — play a session with the game in front, then try again"
            .into());
    }
    if !has_frame_reading(session) {
        return Err("the baseline session has no frame-rate reading, so there's nothing to compare \
                    the change against"
            .into());
    }
    if session.process_name.trim().is_empty() {
        return Err("the baseline session didn't record which game was running, so there's no game \
                    to measure the change in"
            .into());
    }
    Ok(session)
}

/// Below this many frame-rate readings a baseline is too short to compare a change against — the
/// same ~10 minutes of play the treatment session needs (Trial Protocol §2).
pub(crate) const MIN_BASELINE_SAMPLES: u32 = MIN_TREATMENT_SAMPLES;

/// The baseline session's average frame rate in its first and second half, read from its 10 s
/// `fps_series` buckets (each the mean of real ~1 Hz readings; gaps in play are not buckets). Stored on
/// the record at start so the receipt keeps the steadiness evidence after the session sheds its series.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct BaselineHalves {
    pub first_half_fps: f64,
    pub second_half_fps: f64,
}

/// Trial Protocol §2: how fit a baseline session is to judge a change against. Only `TooShort` is
/// refused; `Uneven` and `Untraced` start with a warning the record keeps ([`BaselineCheck`]).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum BaselineGrade {
    /// Long enough, and its two halves are within the noise floor of each other.
    Steady(BaselineHalves),
    /// Fewer than [`MIN_BASELINE_SAMPLES`] frame-rate readings.
    TooShort { samples: u32 },
    /// Its halves' average frame rates differ by more than the noise floor (relative to the first
    /// half), so the session's own drift would swamp a change's effect.
    Uneven(BaselineHalves),
    /// The session no longer carries its frame-rate trace (older sessions shed it), or the trace has
    /// fewer than two buckets per half, so steadiness can't be checked. Never read as steady.
    Untraced,
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().sum::<f64>() / xs.len() as f64
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// The threshold a Trial's sessions' halves are graded on (see `ExperimentRecord::halves_floor_pct`).
/// Never the verdict band: a wide between-session spread must not loosen the uneven check.
pub(crate) fn halves_floor_pct(rec: &ExperimentRecord) -> f64 {
    rec.halves_floor_pct.unwrap_or(DEFAULT_NOISE_FLOOR_PCT)
}

/// Pure: grade a session's two halves (average fps) against `halves_floor_pct`, the halves threshold
/// ([`halves_floor_pct`]), never the verdict band. The halves split the trace's buckets by count,
/// the earlier half first.
pub(crate) fn grade_baseline(session: &SessionSummary, halves_floor_pct: f64) -> BaselineGrade {
    if session.samples < MIN_BASELINE_SAMPLES {
        return BaselineGrade::TooShort { samples: session.samples };
    }
    let fps: Vec<f64> = session.fps_series.iter().map(|&(_, f)| f).filter(|f| f.is_finite() && *f > 0.0).collect();
    let half = fps.len() / 2;
    if half < 2 {
        return BaselineGrade::Untraced;
    }
    let (first, second) = (mean(&fps[..half]), mean(&fps[half..]));
    let halves = BaselineHalves { first_half_fps: round1(first), second_half_fps: round1(second) };
    if (second - first).abs() / first * 100.0 > halves_floor_pct {
        BaselineGrade::Uneven(halves)
    } else {
        BaselineGrade::Steady(halves)
    }
}

/// What the record keeps of a started Trial's baseline grade (a too-short baseline never starts).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum BaselineCheck {
    Steady,
    /// Its halves differ by more than the noise floor: the Trial ran, but its result may be less reliable.
    Uneven,
    /// It had no frame-rate trace, so its steadiness couldn't be checked.
    Untraced,
}

/// The start's view of a baseline: refused when it's too short (the same 600-reading floor a treatment
/// session needs), otherwise the grade and halves the record keeps. An uneven or untraced baseline
/// starts with a warning instead of being refused (owner decision 2026-10-24: "warn, don't block";
/// with a 3% floor both of the owner's real WARDOGS baselines grade uneven, 12-16% apart). The halves
/// are judged against the fixed default ([`halves_floor_pct`]), not the verdict band.
pub(crate) fn baseline_for_start(
    session: &SessionSummary,
    halves_floor_pct: f64,
) -> Result<(BaselineCheck, Option<BaselineHalves>), String> {
    match grade_baseline(session, halves_floor_pct) {
        BaselineGrade::Steady(h) => Ok((BaselineCheck::Steady, Some(h))),
        BaselineGrade::Uneven(h) => Ok((BaselineCheck::Uneven, Some(h))),
        BaselineGrade::Untraced => Ok((BaselineCheck::Untraced, None)),
        BaselineGrade::TooShort { samples } => Err(format!(
            "the baseline session is too short to compare against ({samples} of the \
             {MIN_BASELINE_SAMPLES} frame-rate readings Compy needs, about 10 minutes of play{}), \
             record a new baseline: play another session of this game, then start",
            left_out_clause(session)
        )),
    }
}

/// §3 one variable at a time — the baseline must have been measured with the same Compy changes in
/// place as now, so the before/after differs by this one change alone. Refuses when a Compy change was
/// applied or undone after the baseline session began, when the number of active Compy changes differs
/// from the one that session recorded (a change reverted outside Compy, or an undo too old to carry a
/// date), when the baseline session recorded no count at all (its start couldn't read the change
/// history, #669), and when the change history can't back the check (`ledger` is then why, in words,
/// from [`ledger_for_one_change_checks`]). A readable `ledger` is its rows AND `active_now`, counted
/// from those same rows the way a session counts it (`history::summarize_history(..).active`); an
/// unreadable one carries no count at all, so none can be invented for it (#668).
pub(crate) fn baseline_is_current(
    baseline: &SessionSummary,
    ledger: Result<(&[LedgerEntryRef<'_>], crate::history::SessionChangeCounts), &str>,
) -> Result<(), String> {
    let (ledger, now) = ledger.map_err(|why| {
        format!("{why}, so it can't check that nothing else changed since the baseline session")
    })?;
    let replay = "so the before/after would measure more than this one change — play a new baseline \
                  session, then start";
    if compy_change_moved_after(ledger, &baseline.started_at, None) {
        return Err(format!("a Compy change was applied or undone after the baseline session, {replay}"));
    }
    // #669: a baseline whose start couldn't read the change history (or, 453-f1, couldn't confirm any
    // of its changes) recorded no count, so there is nothing to compare against — refuse in words,
    // never read it as "0 then".
    let Some(then) = baseline.compy_changes_active else {
        let why = baseline.unrecorded_changes_reason();
        return Err(format!(
            "Compy didn't record how many of its changes were active when the baseline session began \
             ({why} at the time), {replay}"
        ));
    };
    // 453-f1: a baseline an older Compy recorded was counted by its older rule (newest row,
    // can't-confirm included). Today's ledger is counted by that same rule too, so the two are
    // compared like with like instead of refusing every pre-update baseline.
    if !baseline.compy_changes_per_change {
        if then != now.legacy_active {
            return Err(format!(
                "the number of active Compy changes is different from the baseline session's ({then} \
                 then, {} now, counted the way the older Compy that recorded it counted), {replay}",
                now.legacy_active
            ));
        }
        return Ok(());
    }
    let Some(active_now) = now.active else {
        return Err(format!(
            "Compy can't confirm whether any of its changes are on right now, so it can't match them \
             with the baseline session's {then}, {replay}"
        ));
    };
    if then != active_now {
        return Err(format!(
            "the number of active Compy changes is different from the baseline session's ({then} then, \
             {active_now} now), {replay}"
        ));
    }
    // Can't-confirm is compared apart: undoing a change Compy can't read moves only this count. A
    // per-change baseline with no can't-confirm count has nothing to compare it with, so it is
    // refused here exactly as `other_compy_change` refuses it at conclude (453-f1 final review).
    let Some(cant_then) = baseline.compy_changes_cant_confirm else {
        return Err(format!(
            "Compy didn't record how many of its changes it couldn't confirm when the baseline session \
             began, {replay}"
        ));
    };
    if cant_then != now.cant_confirm {
        return Err(format!(
            "the number of Compy changes it can't confirm is different from the baseline session's \
             ({cant_then} then, {} now), {replay}",
            now.cant_confirm
        ));
    }
    Ok(())
}

/// §3 at conclude — what else moved among Compy's own changes during the Trial, in words, or None.
/// Only this Trial's change may have been applied or undone since it started, and the after-session
/// must have run with exactly one more active Compy change than the baseline session: this one. A
/// session that can't be found or a ledger that can't be read is not judged here (the ledger
/// watermark already refuses to attribute on an unreadable ledger). A session that recorded no count
/// (its start couldn't read the change history, #669) can't show that exactly this one change was
/// added: it is named here, never read as a match.
pub(crate) fn other_compy_change(
    rec: &ExperimentRecord,
    baseline: Option<&SessionSummary>,
    treatment: Option<&SessionSummary>,
    ledger: Option<&[LedgerEntryRef<'_>]>,
) -> Option<String> {
    let own = Some(rec.applied_change_id.as_str()).filter(|id| !id.is_empty());
    if ledger.is_some_and(|l| compy_change_moved_after(l, &rec.created_at, own)) {
        return Some("another Compy change was applied or undone during the test".into());
    }
    let (baseline, treatment) = (baseline?, treatment?);
    // 453-f1: the two counts are made the same way (per change on both, or the older rule on both),
    // and per change, the active and can't-confirm counts are compared apart.
    let (then, after) = match crate::sessions::comparable_change_counts(baseline, treatment) {
        Ok(pair) => pair,
        Err(missing) => {
            let which = if std::ptr::eq(missing, baseline) { "baseline session" } else { "after-session" };
            return Some(format!(
                "the {which} didn't record how many Compy changes were active — {} when it began",
                missing.unrecorded_changes_reason()
            ));
        }
    };
    use crate::sessions::ChangeCounts::{Legacy, PerChange};
    let plus_this_one = then.adds_one_change(after);
    let active = |c: crate::sessions::ChangeCounts| {
        let (n, cant) = match c {
            PerChange { active, cant_confirm } => (active, cant_confirm),
            Legacy(n) => (n, 0),
        };
        let on = if n == 1 { "1 active Compy change".to_string() } else { format!("{n} active Compy changes") };
        if cant == 0 { on } else { format!("{on} and {cant} it can't confirm") }
    };
    (!plus_this_one).then(|| {
        let expected = match then {
            PerChange { active, .. } | Legacy(active) => active + 1,
        };
        format!("the after-session ran with {}, not {expected} (the baseline's {then} plus this one)", active(after))
    })
}

/// Fold [`other_compy_change`] into the outcome: another Compy change moving during the Trial aborts
/// it as `confounded` and restores (§3, §7), ahead of every verdict including a crash — as with a
/// changed condition, the result can't be pinned on this setting. A stronger reason already given
/// (`not-comparable`, or a confound) stands.
pub(crate) fn with_compy_state(outcome: ConcludeOutcome, other: Option<String>) -> ConcludeOutcome {
    let Some(what) = other else { return outcome };
    if matches!(outcome.verdict.as_str(), "not-comparable" | "confounded") {
        return outcome;
    }
    ConcludeOutcome {
        verdict: "confounded".into(),
        keep: false,
        stop_reason: Some("other-compy-change-during-trial".into()),
        confidence: Confidence::Low,
        note: format!(
            "Compy's own changes didn't stay put during the test ({what}), so the result can't be \
             pinned on this setting. Compy restored it; start a new test to measure it on its own."
        ),
        ..outcome
    }
}

/// How many other settings Compy has applied can't be confirmed still in place: `changed`, a live
/// read as [`target_verification`] answers it, says None (unreadable or unprobed) or false (set back,
/// e.g. undone in Windows). Sessions count every applied change as active whether or not it is still
/// in place, so the active-change counts can't show one set back during the test. Counted once per
/// setting. The setting under test (`own_rec`) is never "another setting", whatever its ledger rows
/// say: the start's pre-apply read and the conclude's target check verify it themselves, and an
/// older row for it undone in Windows leaves it testable again (see [`already_in_target`]).
pub(crate) fn unverified_other_changes(
    ledger: &[LedgerEntryRef<'_>],
    own_rec: &str,
    changed: impl Fn(&str) -> Option<bool>,
) -> usize {
    let recs: std::collections::BTreeSet<&str> = ledger
        .iter()
        .filter(|c| c.applied && c.rec_id != own_rec)
        .map(|c| c.rec_id)
        .collect();
    recs.into_iter().filter(|rec| changed(rec) != Some(true)).count()
}

/// §3/§7 when other Compy changes can't be confirmed still in place. Sessions count those as active
/// whether or not they still are, so nothing shows they stayed put during the test, and no result can be
/// pinned on this change alone (§3 isolation, §7 "another change invalidates attribution", §8
/// insufficient evidence, §9 only a verified Better keeps). Every measured verdict, a crash included,
/// becomes `insufficient-evidence` and restores, exactly as an unreadable target does in
/// [`guard_target_at_conclude`]: the measured delta stays as evidence and no noise band is recorded. A
/// verdict that already says it wasn't judged keeps its own reason. Every one-click change, startup-app
/// toggle, telemetry-task disable and session service suspend has a live read through its ledger row
/// (#620); what can't be read back is a retired change, a row with no typed action, or a read that
/// failed, and a setting undone in Windows reads as set back. [`unverified_start_refusal`]
/// turns such a Trial down before it starts; this catches one that changes only by the conclude.
pub(crate) fn with_unverified_changes(outcome: ConcludeOutcome, unverified: usize) -> ConcludeOutcome {
    if unverified == 0 || !matches!(outcome.verdict.as_str(), "improved" | "no-change" | "regressed") {
        return outcome;
    }
    let crashed = outcome.stop_reason.as_deref() == Some("crash-during-treatment");
    let what = match unverified {
        1 => "another setting Compy changed earlier can't be confirmed as still in place".to_string(),
        n => format!("{n} other settings Compy changed earlier can't be confirmed as still in place"),
    };
    ConcludeOutcome {
        verdict: "insufficient-evidence".into(),
        keep: false,
        stop_reason: Some(
            if crashed { "crash-during-treatment; other-change-unverified-at-conclude" } else { "other-change-unverified-at-conclude" }
                .into(),
        ),
        confidence: Confidence::Unknown,
        note: if crashed {
            format!(
                "The game crashed during the test, but {what}, so Compy can't pin the crash on this \
                 setting. Compy restored the change without blaming it."
            )
        } else {
            format!(
                "Compy can't tell whether this result is this setting's alone: {what}. Compy restored \
                 the change and judged nothing."
            )
        },
        ..outcome
    }
}

/// §3 at start — the same rule as [`with_unverified_changes`], applied before anything is recorded or
/// changed. Another applied setting not confirmed in place now would leave any result unjudged at
/// the conclude, so the user is told the remedy before playing a test session for nothing.
pub(crate) fn unverified_start_refusal(unverified: usize) -> Option<String> {
    let (what, undo) = match unverified {
        0 => return None,
        1 => ("another setting Compy changed earlier can't be confirmed as still in place".to_string(), "undo it"),
        n => (format!("{n} other settings Compy changed earlier can't be confirmed as still in place"), "undo them"),
    };
    Some(format!(
        "{what}, so a test couldn't show that its result is this setting's alone — {undo} in \
         Test → Applied & history, then start the test again"
    ))
}

/// CR-refuse-early: the start's §3 other-changes check, asked when the user starts the journey (or a
/// real-play Trial) for `rec_id`, BEFORE any as-is session is asked for, so a refusal known now is
/// never said only after ~40 minutes of play. Read-only: one ledger load and the same live reads the
/// start makes. The start itself checks again (the state can change mid-journey). `Ok(None)` = no
/// such refusal now; `Err` = the ledger couldn't be read, which the start would refuse on too.
#[tauri::command]
pub(crate) async fn trial_start_precheck(rec_id: String) -> Result<Option<String>, String> {
    // The reads (powercfg, WMI, the task listing) run on the blocking pool, never the UI thread.
    tauri::async_runtime::spawn_blocking(move || read_start_precheck(&rec_id))
        .await
        .map_err(|e| format!("Compy couldn't check before the test ({e})"))?
}

/// The work [`trial_start_precheck`] runs on the blocking pool.
fn read_start_precheck(rec_id: &str) -> Result<Option<String>, String> {
    let changes = crate::history::load_history()?;
    let rows = ledger_rows(&changes);
    let unverified = unverified_others_live(&changes, &rows, rec_id, &crate::history::LiveReads::default());
    Ok(precheck_refusal(unverified))
}

/// TG-preflight: one recorded condition that differs between a running Trial's baseline session and
/// the PC as it is now, before the after-session is played. `key` is stable ("gpu-driver",
/// "windows-build", "resolution", "power-plan") so the surface words it in the reader's language.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct PreflightDiff {
    pub key: String,
    pub before: String,
    pub after: String,
}

/// PURE (TG-preflight): what differs between the baseline session's recorded context and `live`,
/// compared only where both sides are known (never "the same" from a missing value, never a
/// difference from one either). The power plan is left out for a Trial of the plan itself (it moves
/// the plan by design) and when Gaming Mode was on for the
/// baseline (it lays its own plan over the session; the conclude's Gaming Mode checks cover that).
pub(crate) fn preflight_diffs(
    baseline: &crate::game_state::GameStateFingerprint,
    live: &crate::game_state::GameStateFingerprint,
    rec_id: &str,
) -> Vec<PreflightDiff> {
    let mut out = Vec::new();
    let mut push = |key: &str, b: Option<String>, a: Option<String>| {
        if let (Some(b), Some(a)) = (b, a) {
            if !b.eq_ignore_ascii_case(&a) {
                out.push(PreflightDiff { key: key.into(), before: b, after: a });
            }
        }
    };
    let clean = |v: &Option<String>| v.as_deref().map(str::trim).filter(|v| !v.is_empty()).map(str::to_string);
    push("gpu-driver", clean(&baseline.gpu_driver), clean(&live.gpu_driver));
    push("windows-build", clean(&baseline.windows_build), clean(&live.windows_build));
    let res = |g: &crate::game_state::GameStateFingerprint| match (g.resolution_width, g.resolution_height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => Some(format!("{w}×{h}")),
        _ => None,
    };
    push("resolution", res(baseline), res(live));
    // Opus r1 SHOULD-FIX: a refresh change or another monitor confounds at the conclude too
    // (`comparability::derive`), so it is said up front as well.
    push("refresh", baseline.display_refresh_hz.map(|h| format!("{h} Hz")), live.display_refresh_hz.map(|h| format!("{h} Hz")));
    push("display", clean(&baseline.active_display_identity), clean(&live.active_display_identity));
    // Opus r1 MUST-FIX: only a Trial of the plan itself moves the active plan by design; a setting OF
    // the plan (USB, PCIe, core parking) writes SCHEME_CURRENT and leaves the plan where it was.
    if rec_id != POWER_PLAN_REC && baseline.gaming_mode_active != Some(true) {
        let named = |g: Option<String>| g.map(|g| plan_name(&g).map_or(g, str::to_string));
        push("power-plan", named(clean(&baseline.power_plan_guid)), named(clean(&live.power_plan_guid)));
    }
    out
}

/// The ledger rec id of the power plan itself (gaming_orchestrator.rs `REC_POWER`).
const POWER_PLAN_REC: &str = "power-ultimate";

/// Opus r1 SHOULD-FIX: Windows' own plans by their fixed GUIDs, so the fix step can name the plan to
/// switch back to; any other plan is left unnamed (never guessed).
fn plan_name(guid: &str) -> Option<&'static str> {
    match guid.trim().to_ascii_lowercase().as_str() {
        "381b4222-f694-41f0-9685-ff5bb260df2e" => Some("Balanced"),
        "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" => Some("High performance"),
        "a1841308-3541-4fab-bc81-f71556f20b4a" => Some("Power saver"),
        "e9a42b02-d5df-448d-aa00-03f14749eb61" => Some("Ultimate Performance"),
        _ => None,
    }
}

/// TG-preflight (read-only): for a running two-session Trial with no after-session yet, what differs
/// between its baseline session's recorded context and the PC now. Empty when nothing differs, when
/// the Trial isn't waiting for its after-session, or when the baseline recorded no context. Blocks
/// nothing: a Trial played anyway under a changed condition is folded into `confounded` at the
/// conclude, as it always was (`with_comparability`, [`with_power_plan_check`]).
#[tauri::command]
pub(crate) async fn trial_preflight(experiment_id: String) -> Result<Vec<PreflightDiff>, String> {
    // The reads (hardware snapshot, powercfg) run on the blocking pool, never the UI thread.
    tauri::async_runtime::spawn_blocking(move || read_preflight(&experiment_id))
        .await
        .map_err(|e| format!("Compy couldn't compare the PC with the baseline ({e})"))
}

/// The work [`trial_preflight`] runs on the blocking pool.
fn read_preflight(experiment_id: &str) -> Vec<PreflightDiff> {
    let store = load_store();
    let Some(rec) = store.experiments.iter().find(|e| e.id == experiment_id) else { return Vec::new() };
    if rec.status != ExperimentStatus::Running || rec.mode != TrialMode::Pair || rec.treatment.is_some() {
        return Vec::new();
    }
    let Some(base_id) = rec.baseline_session_id.as_deref() else { return Vec::new() };
    let sessions = crate::sessions::get_session_summaries();
    let Some(baseline) = sessions.iter().find(|s| s.started_at == base_id).and_then(|s| s.game_state.as_ref()) else {
        return Vec::new();
    };
    let live = crate::game_state::GameStateFingerprint::collect_v1(&rec.game, "", None)
        .with_power_plan(crate::actions::current_power_plan_guid(), None);
    preflight_diffs(baseline, &live, &rec.rec_id)
}

/// PURE (TG-preflight): a two-session Trial whose sessions ran on different Windows power plans, or
/// whose plan changed during either session (TG-context v1, recorded on both), is folded into
/// `confounded` exactly as a changed recorded condition is ([`with_comparability`]): keep false, so
/// the shared restore runs. Compared only where recorded; a Trial of the plan itself (`power-ultimate`)
/// skips only the between-sessions comparison (it moves the plan by design), and every check is skipped
/// when Gaming Mode was on for either session (it lays its own plan over the
/// session; `comparability::derive` already compares Gaming Mode and its plan handling). A stronger
/// reason already given stands.
pub(crate) fn with_power_plan_check(
    outcome: ConcludeOutcome,
    baseline: Option<&SessionSummary>,
    treatment: &SessionSummary,
    rec_id: &str,
) -> ConcludeOutcome {
    let Some(baseline) = baseline else { return outcome };
    if matches!(outcome.verdict.as_str(), "not-comparable" | "confounded") {
        return outcome;
    }
    // Opus r1 MUST-FIX + SHOULD-FIX: only a Trial of the plan itself changes the plan between the
    // sessions by design; a switch during either session is still a confound, for it too.
    let plan_trial = rec_id == POWER_PLAN_REC;
    let gm_on = |s: &SessionSummary| s.gaming_mode_active == Some(true);
    if gm_on(baseline) || gm_on(treatment) {
        return outcome;
    }
    let (Some(b), Some(a)) = (baseline.game_state.as_ref(), treatment.game_state.as_ref()) else { return outcome };
    let guid = |g: &crate::game_state::GameStateFingerprint| {
        g.power_plan_guid.as_deref().map(str::trim).filter(|v| !v.is_empty()).map(str::to_ascii_lowercase)
    };
    let what = match (guid(b), guid(a)) {
        (Some(x), Some(y)) if x != y && !plan_trial => Some("the Windows power plan differed between the two sessions"),
        _ if b.power_plan_changed == Some(true) => Some("the Windows power plan changed during the baseline"),
        _ if a.power_plan_changed == Some(true) => Some("the Windows power plan changed during the after-session"),
        _ => None,
    };
    let Some(what) = what else { return outcome };
    ConcludeOutcome {
        verdict: "confounded".into(),
        keep: false,
        stop_reason: Some("conditions-changed-between-sessions".into()),
        confidence: Confidence::Low,
        note: format!(
            "Something besides this setting changed between the before and after readings ({what}), so the \
             result can't be pinned on this setting. Compy restored it; start a new test to measure it under \
             the new conditions."
        ),
        ..outcome
    }
}

/// The precheck's answer in the start's own words, so the remedies keyed on them (the undo, and
/// "changed outside Compy") are offered the same way.
fn precheck_refusal(unverified: usize) -> Option<String> {
    unverified_start_refusal(unverified).map(|why| format!("experiment not started — {why}"))
}

/// A live, read-only read of whether `rec_id`'s setting is changed, through its applied rows in
/// `changes` (the ledger's own live re-check: a startup-app toggle's direction is on its row, not in
/// its rec id); None when it can't be read or has no probe. `reads` is the pass this read belongs to.
fn read_back(
    changes: &[crate::history::AppliedChange],
    rec_id: &str,
    reads: &crate::history::LiveReads,
) -> Option<bool> {
    target_verification(Some(crate::history::probe_applied_setting(changes, rec_id, reads)))
}

/// [`unverified_other_changes`] read live through one [`crate::history::LiveReads`] for every row
/// (#686-followup): a Trial start or conclude lists the scheduled tasks once, however many task rows
/// the ledger holds, instead of one PowerShell spawn per row. Same reads, same verdicts.
fn unverified_others_live(
    changes: &[crate::history::AppliedChange],
    rows: &[LedgerEntryRef<'_>],
    own_rec: &str,
    reads: &crate::history::LiveReads,
) -> usize {
    let plan = std::cell::OnceCell::new();
    unverified_others_with(
        changes,
        rows,
        own_rec,
        |other| read_back(changes, other, reads),
        || plan.get_or_init(crate::current_power_scheme).clone(),
    )
}

/// [`unverified_others_live`] with its two reads handed in. CR-unconfirmed-remedy: a setting whose
/// every applied row the user recorded as changed outside Compy is confirmed only while the state
/// recorded then is still the live one (for a power plan: the same scheme GUID). Any other plan, or
/// a plan that can't be read, leaves it unconfirmed, so the Trial is refused or left unjudged exactly
/// as before. Every other setting is read back as before.
fn unverified_others_with(
    changes: &[crate::history::AppliedChange],
    rows: &[LedgerEntryRef<'_>],
    own_rec: &str,
    read_back: impl Fn(&str) -> Option<bool>,
    plan_now: impl Fn() -> Option<crate::history::ObservedPlan>,
) -> usize {
    unverified_other_changes(rows, own_rec, |other| match crate::history::recorded_outside_state(changes, other) {
        Some(recorded) => Some(crate::history::outside_state_holds(recorded, plan_now().as_ref())),
        None => read_back(other),
    })
}

/// The session with this id, when there is exactly one.
fn found<'a>(sessions: &'a [SessionSummary], id: Option<&str>) -> Option<&'a SessionSummary> {
    match session_by_id(sessions, id?) {
        SessionLookup::Found(s) => Some(s),
        SessionLookup::Missing | SessionLookup::Ambiguous => None,
    }
}

/// §4.6 — the treatment session a conclude is judged on, and how comparable it is to the baseline.
/// Both are looked up in Compy's own session store; nothing here trusts a number from the webview.
/// Refuses (the Trial stays Running, nothing is changed) when either session is missing, when the
/// treatment isn't a real reading played after the change was applied, or when the two sessions
/// aren't comparable or share too little recorded context to tell. Those are a wrong pick the user can
/// fix by playing the right session. A recorded condition that CHANGED (a driver or Windows update, a
/// new resolution) is not refused here: a driver or Windows update can't be undone by any later session,
/// so [`with_comparability`] aborts the Trial instead (§7 "another change invalidates attribution").
pub(crate) fn resolve_treatment<'a>(
    rec: &ExperimentRecord,
    sessions: &'a [SessionSummary],
    treatment_id: &str,
) -> Result<(&'a SessionSummary, SessionComparability), String> {
    let game = crate::intelligence::pretty_game_name(&rec.game);
    let Some(baseline_id) = rec.baseline_session_id.as_deref() else {
        return Err("this experiment was started before Compy kept a reference to its baseline \
                    session, so the before/after can't be checked — restore it and start a new one"
            .into());
    };
    if treatment_id == baseline_id {
        return Err("the session picked as the after-reading is the baseline itself".into());
    }
    let baseline = match session_by_id(sessions, baseline_id) {
        SessionLookup::Found(s) => s,
        _ => {
            return Err("the baseline session is no longer in your session history, so the \
                        before/after can't be checked — restore the experiment and start a new one"
                .into())
        }
    };
    let treatment = match session_by_id(sessions, treatment_id) {
        SessionLookup::Missing => {
            return Err(format!(
                "that session isn't in your session history — play a monitored {game} session, \
                 then conclude"
            ))
        }
        SessionLookup::Ambiguous => {
            return Err("two sessions in your history share that start time, so Compy can't tell \
                        which one to judge"
                .into())
        }
        SessionLookup::Found(s) => s,
    };
    if treatment.behind_the_whole_time() {
        return Err(format!(
            "that session measured nothing: another window was in front the whole time — play a \
             {game} session with the game in front, then conclude"
        ));
    }
    if !has_frame_reading(treatment) {
        return Err("that session has no frame-rate reading to judge".into());
    }
    if treatment.process_name.trim().is_empty() {
        return Err(format!(
            "that session didn't record which game was running, so Compy can't confirm it measured \
             {game}"
        ));
    }
    // Judged against the moment the apply returned, never `created_at`: that is stamped before the
    // apply, so a session begun while the apply (or its UAC prompt) was pending would pass.
    let Some(applied_at) = rec.applied_at.as_deref() else {
        return Err("this experiment didn't record when its change took effect, so no session can \
                    be shown to have been played after it — restore it and start a new one"
            .into());
    };
    let Some(played_after) = began_after_apply(treatment, applied_at) else {
        return Err("Compy can't tell whether that session was played after the change was \
                    applied, so it can't be the after-reading"
            .into());
    };
    if !played_after {
        return Err(format!(
            "that session was played before the change was applied, so it can't measure it — play \
             a new {game} session, then conclude"
        ));
    }

    let pairing = crate::comparability::derive(baseline, treatment);
    match pairing.verdict {
        Comparability::NotComparable => {
            return Err(format!(
                "the two sessions aren't comparable — {} Play a {game} session under the same \
                 conditions as the baseline, or restore the experiment.",
                pairing.reasons.join(" ")
            ))
        }
        Comparability::Unknown => {
            return Err("the two sessions don't share any recorded rig or conditions, so Compy can't \
                        check they're comparable — restore the experiment and start a new one"
                .into())
        }
        Comparability::Comparable | Comparability::Partial => {}
    }
    Ok((treatment, pairing))
}

/// Whether `session` began after the change took effect (`applied_at`, stamped when the apply
/// returned). None when either time can't be read: an unknown is never taken as "after".
fn began_after_apply(session: &SessionSummary, applied_at: &str) -> Option<bool> {
    match (
        DateTime::parse_from_rfc3339(&session.started_at),
        DateTime::parse_from_rfc3339(applied_at),
    ) {
        (Ok(t), Ok(a)) => Some(t > a),
        _ => None,
    }
}

/// §4F "stop on crash" beats every session refusal: a game that crashed on launch is the session least
/// likely to have left a usable reading, so a reported crash restores even when the named session
/// can't be judged (`Ok(None)`). Every other refusal stands.
pub(crate) fn crash_overrides_refusal<T>(
    resolved: Result<T, String>,
    crashed: bool,
) -> Result<Option<T>, String> {
    match resolved {
        Ok(found) => Ok(Some(found)),
        Err(_) if crashed => Ok(None),
        Err(why) => Err(why),
    }
}

/// The outcome of a reported crash whose session couldn't be used: the crash alone decides, so the
/// change is restored and no frame-rate reading is claimed.
fn crash_without_reading() -> ConcludeOutcome {
    ConcludeOutcome {
        verdict: "regressed".into(),
        keep: false,
        // Never persisted: without a usable session there is no treatment record to carry a delta.
        delta_low1_pct: 0.0,
        stop_reason: Some("crash-during-treatment".into()),
        confidence: Confidence::High,
        note: verdict_note("regressed", 0, true, GameMatch::Unverified),
    }
}

/// A reported crash always restores, but it is pinned on the change only when the sessions prove it
/// could be, exactly as for a measured result: the crash session is found and began after the change
/// took effect, the baseline is found, and the two are comparable. A missing session, one that can't
/// be shown to follow the change, another game or rig, two sessions that share too little recorded
/// context to tell, or a changed driver, Windows build or resolution each leave the crash unpinned.
/// Returns the pairing it judged by, for the §11 receipt.
pub(crate) fn crash_outcome(
    applied_at: Option<&str>,
    baseline: Option<&SessionSummary>,
    treatment: Option<&SessionSummary>,
) -> (ConcludeOutcome, Option<SessionComparability>) {
    let crash = crash_without_reading();
    let unpinned = |stop_reason: &str, why: String| ConcludeOutcome {
        verdict: "not-comparable".into(),
        keep: false,
        stop_reason: Some(stop_reason.into()),
        confidence: Confidence::Unknown,
        note: format!(
            "The game crashed, but {why} So the crash can't be pinned on this setting. Compy restored \
             the change."
        ),
        ..crash_without_reading()
    };
    let Some(treatment) = treatment else {
        let why = "Compy couldn't pick out that session, so it can't show the session began after the \
                   change took effect.";
        return (unpinned("crash-session-missing", why.into()), None);
    };
    if applied_at.and_then(|at| began_after_apply(treatment, at)) != Some(true) {
        let why = "Compy can't show that session began after the change took effect.";
        return (unpinned("crash-session-not-after-change", why.into()), None);
    }
    let Some(baseline) = baseline else {
        let why = "Compy couldn't pick out the baseline session, so it can't check that nothing else \
                   changed.";
        return (unpinned("crash-baseline-missing", why.into()), None);
    };
    let pairing = crate::comparability::derive(baseline, treatment);
    match pairing.verdict {
        Comparability::NotComparable => {
            let why = format!("that session isn't comparable to the baseline: {}", pairing.reasons.join(" "));
            return (unpinned("crash-session-not-comparable", why), Some(pairing));
        }
        Comparability::Unknown => {
            let why = "that session and the baseline share no recorded rig or conditions, so Compy can't \
                       check that nothing else changed.";
            return (unpinned("crash-session-comparability-unknown", why.into()), Some(pairing));
        }
        Comparability::Comparable | Comparability::Partial => {}
    }
    (with_comparability(crash, &pairing), Some(pairing))
}

/// The outcomes whose verdict was actually judged against the noise band: a measured
/// improved / no-change / regressed with nothing stopping it first (a crash is "regressed" too, but
/// it carries a stop reason and never looked at the band).
fn judged_against_noise(outcome: &ConcludeOutcome) -> bool {
    outcome.stop_reason.is_none()
        && matches!(outcome.verdict.as_str(), "improved" | "no-change" | "regressed")
}

/// Fold the sessions' comparability into the outcome:
/// - a recorded condition that changed between the two sessions (driver, Windows, resolution) aborts
///   the Trial as `confounded`, which restores (§7 "another change invalidates attribution"). This
///   comes first, ahead of even a crash: under a changed driver the crash can't be pinned on the
///   setting either. The measured delta stays as evidence;
/// - confidence never exceeds what the pairing supports (`confidence_limit`);
/// - a `Partial` pairing (a condition went unrecorded) never claims the like-for-like match it
///   couldn't check.
pub(crate) fn with_comparability(outcome: ConcludeOutcome, pairing: &SessionComparability) -> ConcludeOutcome {
    if !pairing.changed_context.is_empty() {
        return ConcludeOutcome {
            verdict: "confounded".into(),
            keep: false,
            stop_reason: Some("conditions-changed-between-sessions".into()),
            confidence: Confidence::Low.min(pairing.confidence_limit),
            note: format!(
                "Something besides this setting changed between the before and after readings ({}), \
                 so the result can't be pinned on this setting. Compy restored it; start a new test \
                 to measure it under the new conditions.",
                pairing.changed_context.join("; ")
            ),
            ..outcome
        };
    }
    let confidence = outcome.confidence.min(pairing.confidence_limit);
    if pairing.verdict != Comparability::Partial {
        return ConcludeOutcome { confidence, ..outcome };
    }
    let unchecked = match (pairing.missing_context.is_empty(), pairing.reasons.is_empty()) {
        (false, _) => pairing.missing_context.join(" "),
        (true, false) => pairing.reasons.join(" "),
        (true, true) => "Some conditions couldn't be confirmed.".to_string(),
    };
    let note = if judged_against_noise(&outcome) {
        format!(
            "Compy made no other change during the test, but not every condition could be checked: \
             {unchecked} So this comparison is limited to what both sessions recorded."
        )
    } else {
        format!("{} Not every condition could be checked either: {unchecked}", outcome.note)
    };
    ConcludeOutcome { confidence, note, ..outcome }
}

/// §11 — the noise evidence for a concluded Trial: the band the verdict was judged against, and only
/// when it was (see [`judged_against_noise`]), with this game's own noise on this PC as Compy's
/// calibration measured it under the treatment session's conditions (P4-noise-store). A game that
/// was never measured, or measured before a driver/Windows/game update, records `None` rather than
/// a guess; the stale case says so.
pub(crate) fn noise_evidence_for(
    outcome: &ConcludeOutcome,
    band_pct: f64,
    game_noise: &crate::noise_floor::NoiseLookup,
    between_sessions: Option<&crate::noise_floor::BetweenSessionNoise>,
) -> Option<NoiseEvidence> {
    use crate::noise_floor::NoiseLookup;
    let (measured_noise_pct, measured_noise_stale) = match game_noise {
        NoiseLookup::Measured(pct) => (Some(*pct), None),
        NoiseLookup::Stale(why) => (None, Some(*why)),
        NoiseLookup::Unmeasured => (None, None),
    };
    let between_sessions = between_sessions.cloned();
    judged_against_noise(outcome)
        .then_some(NoiseEvidence { band_pct, measured_noise_pct, measured_noise_stale, between_sessions })
}

/// The record's view of one session's steadiness: the grade's check and halves, `(None, None)` for a
/// session too short to grade (that Trial is `insufficient-evidence` before steadiness matters).
pub(crate) fn session_check(grade: BaselineGrade) -> (Option<BaselineCheck>, Option<BaselineHalves>) {
    match grade {
        BaselineGrade::Steady(h) => (Some(BaselineCheck::Steady), Some(h)),
        BaselineGrade::Uneven(h) => (Some(BaselineCheck::Uneven), Some(h)),
        BaselineGrade::Untraced => (Some(BaselineCheck::Untraced), None),
        BaselineGrade::TooShort { .. } => (None, None),
    }
}

/// The baseline's halves when it was uneven, at conclude: the start's grade when the record has one
/// (the session may have shed its trace since), else the baseline session graded now (a Trial started
/// before baselines were graded). Untraced or steady is `None`: only a measured unevenness counts.
/// P4-judge-noisy: no longer read by a conclude (an uneven session is judged against the measured
/// band); kept, test-only, to pin how records concluded before it were graded.
#[cfg(test)]
pub(crate) fn uneven_baseline_at_conclude(
    rec: &ExperimentRecord,
    baseline: Option<&SessionSummary>,
) -> Option<BaselineHalves> {
    let graded_now = || match baseline.map(|s| grade_baseline(s, halves_floor_pct(rec))) {
        Some(BaselineGrade::Uneven(h)) => Some(h),
        _ => None,
    };
    match rec.baseline_check {
        Some(BaselineCheck::Uneven) => rec.baseline_halves.clone().or_else(graded_now),
        Some(_) => None,
        None => graded_now(),
    }
}

/// P4-sessions (Trial Protocol §2 "if repeatability is too poor, Compy does not manufacture a
/// verdict", §5, §8 Inconclusive): a measured verdict (improved / no-change / regressed) where either
/// session's own two halves differ by more than the noise floor becomes `too-noisy` and restores. A
/// session that drifts that much by itself (the 2026-10-23 AFK baseline: 259.8 → 227.9 fps) would
/// swamp the change's effect, so the −18.5% that read "Slower" was the scene, not the setting.
///
/// "Either session is uneven" is judged here. "The effect is below the session-to-session spread" is
/// judged by the band itself: since P4-noise, `noise_floor_pct` is this game's spread between whole
/// unchanged sessions on this PC when Compy has measured it (`noise_floor::between_session_noise`),
/// never below the fixed default, so an effect inside it reads `no-change`, never a win. The halves
/// here are graded on the fixed default instead ([`halves_floor_pct`]): they are average fps, not a
/// 1% low spread.
///
/// A verdict that already says it wasn't judged (a crash, too few readings, a confound, another game)
/// keeps its own reason. The measured delta stays as evidence; no noise band is recorded.
///
/// P4-judge-noisy (owner 2026-11-12: "couldn't be judged" is not finished): retired from the conclude.
/// Graded on an ASSUMED 3% halves gap, it left every Trial on a game that swings more than that
/// unjudged; the measured whole-session band now carries that swing. Kept, test-only, to pin how the
/// records it produced ("too-noisy") were judged.
#[cfg(test)]
pub(crate) fn with_steady_sessions(
    outcome: ConcludeOutcome,
    uneven_baseline: Option<&BaselineHalves>,
    uneven_after: Option<&BaselineHalves>,
) -> ConcludeOutcome {
    if !judged_against_noise(&outcome) {
        return outcome;
    }
    let ran = |h: &BaselineHalves| {
        format!("{} fps in its first half and {} fps in its second", h.first_half_fps.round(), h.second_half_fps.round())
    };
    let which = match (uneven_baseline, uneven_after) {
        (None, None) => return outcome,
        (Some(b), None) => format!("the baseline was uneven ({})", ran(b)),
        (None, Some(a)) => format!("the after-session was uneven ({})", ran(a)),
        (Some(b), Some(a)) => {
            format!("both sessions were uneven (the baseline ran {}; the after-session {})", ran(b), ran(a))
        }
    };
    ConcludeOutcome {
        verdict: "too-noisy".into(),
        keep: false,
        stop_reason: Some("uneven-session".into()),
        confidence: Confidence::Unknown,
        note: format!(
            "Too noisy to judge: {which}. That is too uneven on its own to tell this setting's effect \
             apart from the scene, so Compy restored the change and judged nothing."
        ),
        ..outcome
    }
}

/// A percentage for a note: "+12.5%", "-6%", "3%" style without a trailing ".0".
fn signed_pct(x: f64) -> String {
    let body = if x.fract() == 0.0 { format!("{}", x.abs()) } else { format!("{:.1}", x.abs()) };
    if x > 0.0 {
        format!("+{body}%")
    } else if x < 0.0 {
        format!("-{body}%")
    } else {
        format!("{body}%")
    }
}

fn band_pct_text(band: f64) -> String {
    if band.fract() == 0.0 { format!("{band}") } else { format!("{band:.1}") }
}

/// Opus r2 (s27): a band as the verdict judges it: "±3%" when its fall is the same size, else the
/// rise and the fall that matches it ("+20.6% / -17%", `noise_floor::fall_pct`).
fn band_words(band: f64) -> String {
    let fall = crate::noise_floor::fall_pct(band);
    if (fall - band).abs() < 1e-9 {
        format!("±{}%", band_pct_text(band))
    } else {
        format!("+{}% / -{}%", band_pct_text(band), band_pct_text(fall))
    }
}

/// Opus r2 (s27): "fell by more than {what}" when the band's fall is the band itself, else the fall
/// it actually passed.
fn fell_words(band: f64, what: &str) -> String {
    let fall = crate::noise_floor::fall_pct(band);
    if (fall - band).abs() < 1e-9 {
        format!("fell by more than {what}")
    } else {
        format!("fell past -{}%, the fall matching the +{}% band", band_pct_text(fall), band_pct_text(band))
    }
}

/// P4-recommended (ENGINE §2 `recommended`, §6 "default wins ties"; TRIAL_PROTOCOL §8/§9): the
/// Recommended outcome of a measured verdict, judged on the same band (`noise_floor_pct`, a % of the
/// baseline) for both numbers:
/// - Better (`improved`, kept) only when the 1% low rose by more than the band AND the average fps
///   did not fall by more than it;
/// - Worse (`regressed`) when the 1% low fell by more than the band, whatever the average did;
/// - anything else is No change (`no-change`): the default is kept and the change restored. That
///   includes a 1% low gain beside an average that fell by more than the band, or that couldn't be
///   compared (an unknown average is never read as "didn't drop").
///
/// Only a verdict judged against the band is touched ([`judged_against_noise`]); a crash, too few
/// readings, a confound, another game or a too-noisy session keeps its own verdict and reason. It
/// never turns a restore into a keep: a `no-change` or `regressed` stays restored. The note gains one
/// sentence naming exactly what was compared.
pub(crate) fn with_recommended_outcome(
    outcome: ConcludeOutcome,
    band_pct: f64,
    delta_avg: Option<f64>,
) -> ConcludeOutcome {
    with_recommended_outcome_bands(outcome, band_pct, band_pct, delta_avg)
}

/// P4-judge-noisy: [`with_recommended_outcome`] with the 1% low and the average each judged on its own
/// measured band (`GameNoise::low1_band_pct`, `avg_band_pct`). The same rules; only the bands differ,
/// and the note names both when they do.
pub(crate) fn with_recommended_outcome_bands(
    outcome: ConcludeOutcome,
    band_pct: f64,
    avg_band_pct: f64,
    delta_avg: Option<f64>,
) -> ConcludeOutcome {
    if !judged_against_noise(&outcome) {
        return outcome;
    }
    let low = outcome.delta_low1_pct;
    // Opus r1 (s27): a fall is judged on the fall matching the band (`noise_floor::fall_pct`).
    let avg_fell = delta_avg.is_none_or(|avg| avg < -crate::noise_floor::fall_pct(avg_band_pct));
    let verdict = match outcome.verdict.as_str() {
        "improved" if avg_fell => "no-change".to_string(),
        v => v.to_string(),
    };
    let band = band_words(band_pct);
    let avg_text = delta_avg.map_or_else(
        || "the average frame rate couldn't be compared".to_string(),
        |avg| format!("the average frame rate {}", signed_pct(avg)),
    );
    let compared = if (avg_band_pct - band_pct).abs() < 1e-9 {
        format!("Compared with the baseline: the 1% low {}, {avg_text}, both against a {band} band.", signed_pct(low))
    } else {
        format!(
            "Compared with the baseline: the 1% low {} against a {band} band, {avg_text} against a {} band.",
            signed_pct(low),
            band_words(avg_band_pct)
        )
    };
    let why = match (verdict.as_str(), outcome.verdict.as_str()) {
        ("improved", _) => {
            "The 1% low rose by more than the band and the average didn't fall by more, so the change \
             was kept."
                .to_string()
        }
        ("no-change", "improved") if delta_avg.is_none() => {
            "The 1% low rose by more than the band, but without the average Compy can't confirm it \
             didn't fall, so this isn't a clear win: the default was kept and the change restored."
                .to_string()
        }
        ("no-change", "improved") => format!(
            "The 1% low rose by more than the band, but the average {}, so this isn't a clear win: the \
             default was kept and the change restored.",
            fell_words(avg_band_pct, "it")
        ),
        ("regressed", _) => format!("The 1% low {}, so the change was restored.", fell_words(band_pct, "the band")),
        _ => "The 1% low stayed inside the band, so the default was kept and the change restored.".to_string(),
    };
    let keep = keep_rule(trial_result_for(&verdict));
    ConcludeOutcome { verdict, keep, note: format!("{} {compared} {why}", outcome.note), ..outcome }
}

// ─── P4-judge-noisy: measured noise, cap state and plain words ─────────────

/// Why a Trial can't start (or a pre-P4-judge-noisy one can't be judged) because this game's noise
/// isn't measured, in plain words that ask for exactly what is missing. Says "baseline session", so
/// the guided journey offers to record one.
pub(crate) fn noise_unmeasured_message(why: &crate::noise_floor::NoiseUnmeasured, game: &str) -> String {
    let name = crate::intelligence::pretty_game_name(game);
    let name = if name.is_empty() { "this game".to_string() } else { name };
    if why.cap_unknown {
        return format!(
            "Compy can't tell from the baseline session's frame-rate trace whether a frame cap held it: either \
             the session has under 5 minutes of trace, or its frame rate held almost flat, which is how a cap \
             holds it too, or much of it sat at one level without quite the shape of a cap (a menu or lobby \
             held there can do that). So it can't pool that session with others to measure how much {name} varies on its \
             own, and it won't compare it as if it knew. If a frame cap (in the game, the driver or an overlay) \
             was on, turn it off and play a session of 10 minutes or more; if the baseline session was short, \
             play one of 10 minutes or more; if your frame rate is simply very steady with no cap, Compy can't \
             tell that apart from a cap yet and won't test this game this way."
        );
    }
    let more = why.need.saturating_sub(why.have).max(1);
    let sessions = if more == 1 { "session" } else { "sessions" };
    format!(
        "Compy hasn't measured how much {name} varies on its own yet, and it won't guess: it needs {} \
         baseline sessions of it played with nothing changed and the frame cap the same, and found {}. Play \
         {more} more baseline {sessions} like that, then start.",
        why.need, why.have
    )
}

/// The noise a Trial is concluded against: the start's measurement, or, for a record started before
/// P4-judge-noisy (none stored), one measured now from the as-is sessions up to its baseline. Never the
/// fixed default.
pub(crate) fn noise_for_conclude(
    rec: &ExperimentRecord,
    sessions: &[SessionSummary],
    baseline: Option<&SessionSummary>,
    rows: Option<&[LedgerEntryRef<'_>]>,
) -> Result<crate::noise_floor::GameNoise, crate::noise_floor::NoiseUnmeasured> {
    // A band stored by an older noise model is read on this build's base (never narrower).
    if let Some(n) = &rec.game_noise {
        return Ok(crate::noise_floor::on_baseline_base(n.clone()));
    }
    let unmeasured = crate::noise_floor::NoiseUnmeasured {
        have: 0,
        need: crate::noise_floor::MIN_UNCHANGED_SESSIONS,
        cap_unknown: false,
    };
    match (baseline, rows) {
        (Some(b), Some(rows)) => crate::noise_floor::measure_game_noise(sessions, b, rows),
        _ => Err(unmeasured),
    }
}

/// A Trial whose game's noise isn't measured is not judged: restored, with the sessions it needs named.
pub(crate) fn unmeasured_noise_outcome(outcome: ConcludeOutcome, why: &crate::noise_floor::NoiseUnmeasured, game: &str) -> ConcludeOutcome {
    if !judged_against_noise(&outcome) {
        return outcome;
    }
    ConcludeOutcome {
        verdict: "not-comparable".into(),
        keep: false,
        stop_reason: Some("noise-unmeasured".into()),
        confidence: Confidence::Unknown,
        note: format!("{} Compy restored the change and judged nothing.", noise_unmeasured_message(why, game)),
        ..outcome
    }
}

/// Opus r2/r3 (s27): what a concluded record keeps as its noise: the measurement a record started
/// without one was judged on, and, for a band stored by an older noise model, the band this build
/// read it as (`noise_floor::on_baseline_base`), so the receipt shows the band the verdict used. A
/// band of this model stays exactly as the start stored it.
pub(crate) fn keep_judged_noise(
    stored: &mut Option<crate::noise_floor::GameNoise>,
    judged_on: Option<crate::noise_floor::GameNoise>,
) {
    let older = stored.as_ref().is_some_and(|n| n.model < crate::noise_floor::NOISE_MODEL_VERSION);
    if stored.is_none() || older {
        *stored = judged_on;
    }
}

/// Opus r1 (s27): the 1% low is classified on the measured band stored as a rise over the baseline; a
/// fall past the matching fall (`noise_floor::fall_pct`, a little under the band) is Worse, as a fall
/// past the band was before. The outcome rules then read it as they read any Worse.
pub(crate) fn with_measured_fall(outcome: ConcludeOutcome, low_band_pct: f64) -> ConcludeOutcome {
    if !judged_against_noise(&outcome) || outcome.verdict != "no-change" {
        return outcome;
    }
    if outcome.delta_low1_pct < -crate::noise_floor::fall_pct(low_band_pct) {
        let note = outcome.note.clone();
        return rebuilt(outcome, "regressed", note);
    }
    outcome
}

/// Coordinator SHOULD-FIX (s27): the measured band holds for two sessions as far apart as the
/// measured sessions were from one to the next (`GameNoise::max_gap_mins`); a baseline and after-session
/// further apart than that are compared across a gap the band wasn't measured over, so they aren't judged. Says so, restores, and
/// judges nothing. A band recorded without the gap (0) or sessions whose starts can't be read can't say,
/// and are left as judged. A verdict that already says it wasn't judged keeps its own reason.
pub(crate) fn with_gap_check(
    outcome: ConcludeOutcome,
    noise: &crate::noise_floor::GameNoise,
    baseline_start: Option<&str>,
    after_start: Option<&str>,
) -> ConcludeOutcome {
    if !judged_against_noise(&outcome) || noise.max_gap_mins == 0 {
        return outcome;
    }
    let at = |s: Option<&str>| s.and_then(|s| DateTime::parse_from_rfc3339(s).ok());
    let (Some(b), Some(a)) = (at(baseline_start), at(after_start)) else {
        return outcome;
    };
    let gap = (a - b).num_minutes();
    if gap <= i64::from(noise.max_gap_mins) {
        return outcome;
    }
    let hours = |m: i64| format!("{:.1} hours", m as f64 / 60.0);
    ConcludeOutcome {
        verdict: "not-comparable".into(),
        keep: false,
        stop_reason: Some("gap-past-band".into()),
        confidence: Confidence::Unknown,
        note: format!(
            "{} The after-session began {} after the baseline, longer than the longest gap between one of the \
             sessions this game's noise was measured from and the next ({}). The band wasn't measured across a \
             gap that long, so it can't say how much the game moves over one. Compy restored the change and \
             judged nothing; play the after-session sooner after the baseline, then test again.",
            outcome.note,
            hours(gap),
            hours(i64::from(noise.max_gap_mins))
        ),
        ..outcome
    }
}

/// CR-trial-gm-baseline-overlap (opus + sonnet SHOULD-FIX of CR-trial-gm-between): why a session can't
/// be the "without" side of a Trial of `rec_id`, or `None` when it can. A Gaming Mode session sets
/// some catalog settings itself (`gaming_orchestrator::session_can_touch`); a baseline it was on for
/// may have run with the setting already in the Trial's target state, so both sessions would run the
/// same way and the change would read "no change" and be put back as useless. A baseline that didn't
/// record whether Gaming Mode was on can't show it wasn't. Settings Gaming Mode never touches are not
/// affected (`comparability::derive` still compares Gaming Mode on vs off between the two sessions).
pub(crate) fn gaming_mode_baseline_overlap(baseline: &SessionSummary, rec_id: &str) -> Option<String> {
    gaming_mode_overlap_words(baseline, rec_id, "then start the test. Nothing was changed.")
}

/// [`gaming_mode_baseline_overlap`]'s words with the closing step the caller needs.
fn gaming_mode_overlap_words(baseline: &SessionSummary, rec_id: &str, next: &str) -> Option<String> {
    if !crate::gaming_orchestrator::session_can_touch(rec_id) {
        return None;
    }
    match baseline.gaming_mode_active {
        Some(false) => None,
        Some(true) => Some(format!(
            "Gaming Mode was on during the baseline session, and Gaming Mode can change this setting itself, \
             so that session may already have run with it changed. Play this game with Gaming Mode off for the \
             baseline sessions Compy compares against, {next}"
        )),
        None => Some(format!(
            "Compy didn't record whether Gaming Mode was on during the baseline session, and Gaming Mode can \
             change this setting itself, so that session can't show it ran without the change. Play this game \
             with Gaming Mode off for the baseline sessions Compy compares against, {next}"
        )),
    }
}

/// CR-trial-gm-baseline-overlap: a Trial started before the start refused such a baseline is not
/// judged on it: confounded, restored, and says why. A verdict that already says it wasn't judged
/// keeps its own reason; a baseline that can't be found keeps the verdict it has (the pairing already
/// refuses a missing session).
pub(crate) fn with_gaming_mode_baseline_check(
    outcome: ConcludeOutcome,
    baseline: Option<&SessionSummary>,
    rec_id: &str,
) -> ConcludeOutcome {
    if !judged_against_noise(&outcome) {
        return outcome;
    }
    let Some(why) = baseline.and_then(|b| gaming_mode_overlap_words(b, rec_id, "then test again.")) else {
        return outcome;
    };
    ConcludeOutcome {
        verdict: "confounded".into(),
        keep: false,
        stop_reason: Some("gaming-mode-baseline".into()),
        confidence: Confidence::Unknown,
        note: format!("{why} Compy restored the change and judged nothing."),
        ..outcome
    }
}

fn cap_words(c: crate::noise_floor::CapRead) -> String {
    match c {
        crate::noise_floor::CapRead::Uncapped => "no cap held it".to_string(),
        crate::noise_floor::CapRead::Capped { at_fps } => format!("held at about {} fps", at_fps.round()),
        crate::noise_floor::CapRead::Unknown => "Compy couldn't read it".to_string(),
    }
}

/// P4-judge-noisy (owner fact 2026-11-12 17:02, a frame cap was on for a while): the two sessions'
/// cap states, read from their frame-rate traces, must be the same for a comparison. A cap that went
/// on, came off or moved confounds the Trial; a cap state Compy can't read on either side means it
/// can't confirm the sessions ran the same way. Both restore and say why. A verdict that already says
/// it wasn't judged keeps its own reason.
pub(crate) fn with_cap_check(
    outcome: ConcludeOutcome,
    baseline: crate::noise_floor::CapRead,
    after: crate::noise_floor::CapRead,
) -> ConcludeOutcome {
    use crate::noise_floor::{cap_pair, CapPair};
    if !judged_against_noise(&outcome) {
        return outcome;
    }
    let (stop, note) = match cap_pair(baseline, after) {
        CapPair::Same => return outcome,
        CapPair::Changed => (
            "frame-cap-changed",
            format!(
                "The frame cap changed between these sessions (in the baseline {}; in the after-session {}), \
                 so they can't be compared and the result can't be pinned on this setting. Compy restored it; \
                 play both sessions with the cap set the same way, then test again.",
                cap_words(baseline),
                cap_words(after)
            ),
        ),
        CapPair::Unknown => (
            "frame-cap-unread",
            format!(
                "Compy can't tell from the frame-rate traces whether a frame cap held both sessions the same \
                 way (in the baseline {}; in the after-session {}), so it can't confirm they ran alike. Compy \
                 restored the change and judged nothing. If a frame cap was on, turn it off for both \
                 sessions; otherwise play an after-session of at least 10 minutes with the game in front; \
                 then test again.",
                cap_words(baseline),
                cap_words(after)
            ),
        ),
    };
    ConcludeOutcome {
        verdict: "confounded".into(),
        keep: false,
        stop_reason: Some(stop.into()),
        confidence: Confidence::Low.min(outcome.confidence),
        note,
        ..outcome
    }
}

/// P4-judge-noisy: under a cap both sessions shared, the average frame rate can't rise past the cap, so
/// Maximum FPS (judged on the average) can't be judged: restored, saying the cap hides it and offering
/// a test with the cap lifted. Other outcomes are judged on the 1% low (and frame pacing), which the
/// cap doesn't flatten, and their note says the average is held.
pub(crate) fn with_cap_saturation(
    outcome: ConcludeOutcome,
    cap: crate::noise_floor::CapRead,
    picked: TrialOutcome,
    lows: (f64, f64),
    low_band_pct: f64,
) -> ConcludeOutcome {
    let crate::noise_floor::CapRead::Capped { at_fps } = cap else { return outcome };
    if !judged_against_noise(&outcome) {
        return outcome;
    }
    let at = at_fps.round();
    // Review r1: a 1% low that sits at the cap, or so close under it that a gain past the band could
    // not fit, is a ceiling reading too: "no change" can't be told from it, whichever outcome was
    // picked. A rise or fall past the band was measured, and stands.
    let headroom_pct = |low: f64| (at_fps - low) / low * 100.0;
    let no_room = headroom_pct(lows.0) <= low_band_pct || lows.1 >= at_fps * 0.985;
    if no_room && outcome.verdict == "no-change" {
        return ConcludeOutcome {
            verdict: "not-comparable".into(),
            keep: false,
            stop_reason: Some("frame-cap-hides-result".into()),
            confidence: Confidence::Unknown,
            note: format!(
                "Both sessions were held at about {at} fps, the way a frame cap holds them, and even the slowest 1% of \
                 frames sat too close under that cap for a gain past this game's noise to show, so the cap hides any \
                 change this setting made. Compy restored it and judged nothing. To test it, lift the cap (your \
                 choice) and play both sessions without it."
            ),
            ..outcome
        };
    }
    // Review r1: a cap flattens frame pacing too, so Smoothest isn't judged under one.
    if picked == TrialOutcome::Smoothest {
        return ConcludeOutcome {
            verdict: "not-comparable".into(),
            keep: false,
            stop_reason: Some("frame-cap-hides-pacing".into()),
            confidence: Confidence::Unknown,
            note: format!(
                "Both sessions were held at about {at} fps, the way a frame cap holds them. A cap evens out frame \
                 times, which is what Smoothest is judged on, so Compy can't judge it here and restored the change. \
                 To test it, lift the cap (your choice) and play both sessions without it."
            ),
            ..outcome
        };
    }
    if picked == TrialOutcome::MaxFps {
        return ConcludeOutcome {
            verdict: "not-comparable".into(),
            keep: false,
            stop_reason: Some("frame-cap-hides-average".into()),
            confidence: Confidence::Unknown,
            note: format!(
                "Both sessions were held at about {at} fps, the way a frame cap holds them. A cap hides any rise in \
                 the average frame rate, which is what Maximum FPS is judged on, so Compy can't judge it here and \
                 restored the change. To test it, lift the cap (your choice) and play both sessions without it."
            ),
            ..outcome
        };
    }
    let note = format!(
        "{} Both sessions were held at about {at} fps, the way a frame cap holds them, which hides any rise in \
         the average frame rate: this result rests on the 1% low, which the cap doesn't flatten.",
        outcome.note
    );
    ConcludeOutcome { note, ..outcome }
}

/// Fewer as-is sessions than this measure the band itself too loosely for High confidence: at five
/// sessions the band's own multiplier is still about 3.2 (`noise_floor::t95_eff`), at six about 3.0.
const FULL_CONFIDENCE_SESSIONS: u32 = 6;

/// The numbers beside the 1% low that a goal judged on, as [`with_noise_words`] reads them to tell a
/// negligible result from a mixed one: the average's change (a % of the baseline, `None` when it
/// couldn't be compared) and Smoothest's frame-pacing change with its band ([`pacing_change`]).
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct NoiseDeltas {
    pub avg: Option<f64>,
    pub pacing: Option<(f64, f64)>,
}

/// Smoothest's frame-pacing change and band, as [`with_smoothest_outcome`] judges it: the p99/p50
/// ratio's change as a % of the start ratio (rounded 0.1; s27, was the lower of the two), and the band
/// recorded at start.
/// `None` when either ratio is missing.
pub(crate) fn pacing_change(evidence: Option<&SmoothestEvidence>, after_ratio: Option<f64>) -> Option<(f64, f64)> {
    evidence
        .zip(after_ratio.filter(|r| r.is_finite() && *r > 0.0))
        .filter(|(ev, _)| ev.start_ratio.is_finite() && ev.start_ratio > 0.0)
        // Opus r2 (s27): a % of the start ratio. For a fall (steadier) that is never larger than the
        // pair-mean change the band was measured on, so no win is called inside it; for a rise it is a
        // little larger, so "more uneven" is called slightly early (the change is put back either way).
        .map(|(ev, after)| (((after - ev.start_ratio) / ev.start_ratio * 1000.0).round() / 10.0, ev.band_pct))
}

/// P4-judge-noisy: the measured band in plain words on a judged verdict, and a result inside it named
/// for what it is: negligible at this game's noise (the default wins; the change was put back), never
/// "no effect". Confidence follows how many as-is sessions measured the band: fewer than six cap it at
/// Medium.
pub(crate) fn with_noise_words(
    outcome: ConcludeOutcome,
    noise: &crate::noise_floor::GameNoise,
    game: &str,
    picked: TrialOutcome,
    deltas: NoiseDeltas,
) -> ConcludeOutcome {
    if !judged_against_noise(&outcome) {
        return outcome;
    }
    let name = crate::intelligence::pretty_game_name(game);
    let name = if name.is_empty() { "this game".to_string() } else { name };
    // Review r1: when the measured noise is under the smallest claim, the band is that minimum, and the
    // words say so instead of calling the whole band measured.
    let floored = |band: f64| band <= crate::noise_floor::MIN_CLAIM_PCT + 1e-9;
    let floor_words = if floored(noise.low1_band_pct) || floored(noise.avg_band_pct) {
        format!(
            " Where that came out under ±{}%, the band is ±{}%: the smallest change Compy ever claims.",
            band_pct_text(crate::noise_floor::MIN_CLAIM_PCT),
            band_pct_text(crate::noise_floor::MIN_CLAIM_PCT)
        )
    } else {
        String::new()
    };
    // Review r1: name the bands this outcome was actually judged on.
    let must_beat = match picked {
        TrialOutcome::Recommended => format!(
            "{} on the 1% low ({} on the average)",
            band_words(noise.low1_band_pct),
            band_words(noise.avg_band_pct)
        ),
        TrialOutcome::MaxFps => format!(
            "{} on both the average and the 1% low (the wider of their two bands)",
            band_words(noise.low1_band_pct.max(noise.avg_band_pct))
        ),
        TrialOutcome::Smoothest => format!(
            "{} on the 1% low, beside the frame-pacing band named above",
            band_words(noise.low1_band_pct)
        ),
    };
    let measured = format!(
        "Between {} sessions of {name} played on this PC with nothing changed, the 1% low moved by {}% and the \
         average by {}% from one session to the next (typical size), so a change must beat {must_beat} to \
         count.{floor_words}",
        noise.sessions,
        band_pct_text(noise.low1_step_pct),
        band_pct_text(noise.avg_step_pct),
    );
    // Coordinator SHOULD-FIX (s27): a band measured from few sessions is wide for that reason too.
    let measured = if noise.sessions < FULL_CONFIDENCE_SESSIONS && !(floored(noise.low1_band_pct) && floored(noise.avg_band_pct)) {
        format!(
            "{measured} The band is this wide partly because only {} sessions were measured; more sessions played \
             with nothing changed will narrow it.",
            noise.sessions
        )
    } else {
        measured
    };
    // P4-noise-sf: sessions passed over because their frame-cap state can't be read are named, never
    // dropped silently.
    let measured = match noise.cap_unread {
        0 => measured,
        1 => format!(
            "{measured} 1 other session of {name} under the same changes wasn't counted: Compy couldn't read \
             whether a frame cap held it."
        ),
        n => format!(
            "{measured} {n} other sessions of {name} under the same changes weren't counted: Compy couldn't read \
             whether a frame cap held them."
        ),
    };
    // Coordinator MUST-FIX (s27): "negligible" only when every number this goal judged on stayed inside
    // its band. A "no change" in which a number moved past its band (a 1% low up past the band beside an
    // average down past its own, or a number that couldn't be compared) says exactly what moved, never
    // "no difference Compy could tell apart". Either way the default wins and the change is put back.
    let max_band = noise.low1_band_pct.max(noise.avg_band_pct);
    let low_band = if picked == TrialOutcome::MaxFps { max_band } else { noise.low1_band_pct };
    let low = Some(outcome.delta_low1_pct);
    let judged: Vec<(&str, Option<f64>, f64, bool)> = match picked {
        // Opus r1: an average that couldn't be compared never lets a result be called negligible.
        TrialOutcome::Recommended => vec![("1% low", low, low_band, true), ("average", deltas.avg, noise.avg_band_pct, true)],
        TrialOutcome::MaxFps => vec![("1% low", low, low_band, true), ("average", deltas.avg, max_band, true)],
        TrialOutcome::Smoothest => vec![
            ("1% low", low, low_band, true),
            ("frame pacing", deltas.pacing.map(|p| p.0), deltas.pacing.map_or(0.0, |p| p.1), true),
        ],
    };
    // A rise past the band, or a fall past the fall that matches it (`noise_floor::fall_pct`).
    // Sonnet r1: frame pacing's change is already a % of the lower ratio, judged on its raw band both
    // ways (as `with_smoothest_outcome` does); only the 1% low and the average use the matching fall.
    let fall_of = |what: &str, band: f64| if what == "frame pacing" { band } else { crate::noise_floor::fall_pct(band) };
    let rose = |d: f64, band: f64| d > band + 1e-9;
    let fell = |what: &str, d: f64, band: f64| d < -fall_of(what, band) - 1e-9;
    let inside =
        |what: &str, d: Option<f64>, band: f64, required: bool| d.map_or(!required, |d| !rose(d, band) && !fell(what, d, band));
    let all_inside = judged.iter().all(|&(what, d, band, required)| inside(what, d, band, required));
    let negligible = if outcome.verdict != "no-change" {
        String::new()
    } else if all_inside {
        format!(
            " So this result is negligible at {name}'s noise: no difference Compy could tell apart from how much \
             the game moves on its own. The default wins, so the change was put back."
        )
    } else {
        let parts: Vec<String> = judged
            .iter()
            .map(|&(what, d, band, _)| match d {
                None => format!("the {what} couldn't be compared"),
                Some(d) if rose(d, band) => {
                    format!("the {what} rose past {name}'s noise ({} against +{}%)", signed_pct(d), band_pct_text(band))
                }
                Some(d) if fell(what, d, band) => format!(
                    "the {what} fell past {name}'s noise ({} against -{}%)",
                    signed_pct(d),
                    band_pct_text(fall_of(what, band))
                ),
                // Opus r3: the 1% low and the average name the rise and fall they were judged on; frame
                // pacing is judged on its raw band both ways.
                Some(d) => {
                    let words = if what == "frame pacing" { format!("±{}%", band_pct_text(band)) } else { band_words(band) };
                    format!("the {what} stayed inside {name}'s noise ({} against {words})", signed_pct(d))
                }
            })
            .collect();
        format!(
            " Not negligible: {}. Compy can't call this better or worse, so the default wins and the change \
             was put back.",
            parts.join("; ")
        )
    };
    let confidence = if noise.sessions < FULL_CONFIDENCE_SESSIONS {
        outcome.confidence.min(Confidence::Medium)
    } else {
        outcome.confidence
    };
    ConcludeOutcome { note: format!("{} {measured}{negligible}", outcome.note), confidence, ..outcome }
}

/// P4-judge-noisy (§ immutability): the read-only label for a verdict judged on the fixed band before
/// Compy measured each game's noise. A record judged against a measurement (`game_noise`, or the
/// earlier between-session spread) or never judged against a band gets none.
pub(crate) fn assumed_band_label(
    rec: &ExperimentRecord,
    measured_now: Option<&crate::noise_floor::GameNoise>,
) -> Option<AssumedBandLabel> {
    let judged_on_fixed = match &rec.noise_evidence {
        Some(n) => n.between_sessions.is_none(),
        // A verdict from before Compy kept noise evidence (engine armed 2026-07-17, evidence from
        // 2026-09-28) was judged on the record's fixed band, and a too-noisy one on the fixed halves floor.
        None => {
            matches!(rec.verdict.as_deref(), Some("improved" | "no-change" | "regressed" | "too-noisy")) && rec.game_noise.is_none()
        }
    };
    if !judged_on_fixed || rec.game_noise.is_some() || rec.between_session_noise.is_some() || rec.mode != TrialMode::Pair {
        return None;
    }
    let fixed_pct = if rec.noise_floor_pct.is_finite() && rec.noise_floor_pct > 0.0 { rec.noise_floor_pct } else { DEFAULT_NOISE_FLOOR_PCT };
    Some(AssumedBandLabel {
        assumed_pct: rec.noise_evidence.as_ref().map_or(fixed_pct, |n| n.band_pct),
        measured_low1_pct: measured_now.map(|n| n.low1_band_pct),
        measured_sessions: measured_now.map(|n| n.sessions),
        claimed_change: matches!(rec.verdict.as_deref(), Some("improved" | "regressed")),
        judged: rec.verdict.as_deref() != Some("too-noisy"),
    })
}

fn rebuilt(outcome: ConcludeOutcome, verdict: &str, note: String) -> ConcludeOutcome {
    let keep = keep_rule(trial_result_for(verdict));
    ConcludeOutcome { verdict: verdict.to_string(), keep, note, ..outcome }
}

/// P4-smooth-offer (ENGINE §2 `smoothest`, §6 "default wins ties"): the Smoothest outcome of a
/// measured verdict. Frame pacing is the p99/p50 frame-time ratio (lower is steadier). Its change is
/// taken as a % of the lower of the two ratios, rounded to 0.1, the way the band was measured
/// (`noise_floor::between_session_pacing_noise`), and judged against the band recorded at start; the 1% low on
/// `low_band_pct` (`noise_floor_pct`):
/// - Better (`improved`, kept) only when the ratio fell by more than its band AND the 1% low did not
///   fall by more than its band;
/// - Worse (`regressed`) when the ratio rose by more than its band, or the 1% low fell by more than its;
/// - anything else is No change: the default is kept and the change restored. Pacing that couldn't be
///   compared (no evidence recorded, or the after-session recorded none) is never a win.
///
/// Same precedence as [`with_recommended_outcome`]: only a verdict judged against the band is touched.
pub(crate) fn with_smoothest_outcome(
    outcome: ConcludeOutcome,
    evidence: Option<&SmoothestEvidence>,
    after_ratio: Option<f64>,
    low_band_pct: f64,
) -> ConcludeOutcome {
    if !judged_against_noise(&outcome) {
        return outcome;
    }
    let low = outcome.delta_low1_pct;
    let low_fell = low < -crate::noise_floor::fall_pct(low_band_pct);
    let low_band = band_words(low_band_pct);
    let low_fell_why = format!("The 1% low {}, so the change was restored.", fell_words(low_band_pct, "its band"));
    let Some((delta, band_pct)) = pacing_change(evidence, after_ratio) else {
        let (verdict, why) = if low_fell {
            ("regressed", low_fell_why.as_str())
        } else {
            (
                "no-change",
                "Without frame pacing from both sessions Compy can't tell whether frames got steadier, so \
                 the default was kept and the change restored.",
            )
        };
        let note = format!(
            "{} Judged for Smoothest. Compared with the start: frame pacing couldn't be compared, the 1% low \
             {} against a {low_band} band. {why}",
            outcome.note,
            signed_pct(low)
        );
        return rebuilt(outcome, verdict, note);
    };
    let (verdict, why) = if delta > band_pct {
        ("regressed", "Frames got more uneven by more than the band, so the change was restored.")
    } else if low_fell {
        ("regressed", low_fell_why.as_str())
    } else if delta < -band_pct {
        (
            "improved",
            "Frames got steadier by more than the band and the 1% low didn't fall by more than its band, so \
             the change was kept.",
        )
    } else {
        ("no-change", "Frame pacing stayed inside the band, so the default was kept and the change restored.")
    };
    let note = format!(
        "{} Judged for Smoothest. Compared with the start: the gap between the slowest 1% of frames and a \
         typical frame {} against a ±{}% band, the 1% low {} against a {low_band} band. {why}",
        outcome.note,
        signed_pct(delta),
        band_pct_text(band_pct),
        signed_pct(low)
    );
    rebuilt(outcome, verdict, note)
}

/// P4-maxfps-smooth (ENGINE §2 `max_fps`, §6 "default wins ties"): the Maximum FPS outcome of a
/// measured verdict, both numbers on the same band (`noise_floor_pct`, a % of the baseline):
/// - Better (`improved`, kept) only when the average rose by more than the band AND the 1% low did
///   not fall by more than it;
/// - Worse (`regressed`) when the average or the 1% low fell by more than the band;
/// - anything else is No change: the default is kept and the change restored. An average that
///   couldn't be compared is never a win.
///
/// Same precedence as [`with_recommended_outcome`]: only a verdict judged against the band is
/// touched, so a crash, too few readings, a confound, another game, a too-noisy session or changed
/// conditions keep their own verdict and reason.
pub(crate) fn with_max_fps_outcome(outcome: ConcludeOutcome, band_pct: f64, delta_avg: Option<f64>) -> ConcludeOutcome {
    if !judged_against_noise(&outcome) {
        return outcome;
    }
    let low = outcome.delta_low1_pct;
    let fall = crate::noise_floor::fall_pct(band_pct);
    let low_fell = low < -fall;
    let band = band_words(band_pct);
    let fell_why = |what: &str| format!("The {what} {}, so the change was restored.", fell_words(band_pct, "the band"));
    let Some(avg) = delta_avg else {
        let verdict = if low_fell { "regressed" } else { "no-change" };
        let why = if low_fell {
            fell_why("1% low")
        } else {
            "Without the average Compy can't tell whether it rose, so the default was kept and the change \
             restored."
                .to_string()
        };
        let note = format!(
            "{} Judged for Maximum FPS. Compared with the baseline: the average frame rate couldn't be \
             compared, the 1% low {}, against a {band} band. {why}",
            outcome.note,
            signed_pct(low)
        );
        return rebuilt(outcome, verdict, note);
    };
    let (verdict, why) = if avg < -fall {
        ("regressed", fell_why("average"))
    } else if low_fell {
        ("regressed", fell_why("1% low"))
    } else if avg > band_pct {
        (
            "improved",
            "The average rose by more than the band and the 1% low didn't fall by more, so the change was kept.".to_string(),
        )
    } else {
        ("no-change", "The average stayed inside the band, so the default was kept and the change restored.".to_string())
    };
    let note = format!(
        "{} Judged for Maximum FPS. Compared with the baseline: the average frame rate {}, the 1% low {}, \
         both against a {band} band. {why}",
        outcome.note,
        signed_pct(avg),
        signed_pct(low)
    );
    rebuilt(outcome, verdict, note)
}

// ─── §4G Optimization simulator (pure, read-only advisory — never a promise) ──

/// The deterministic facts the simulator reasons over. The command populates this from existing
/// read-only modules (hardware applicability · ledger active-state · the permanent blocklist);
/// the pure `simulate` maps it to one of the seven verbatim verdicts.
#[derive(Clone, Debug)]
pub(crate) struct SimContext {
    pub rec_id: String,
    pub rec_title: String,
    /// The rec targets hardware present on THIS rig (false ⇒ e.g. an NVIDIA rec on an AMD box).
    pub applicable: bool,
    /// In the hardware-tailored catalog but with NO one-click apply — an advisory to act on
    /// yourself (an SSD-upgrade or a security-tradeoff advisory, `!history::is_appliable`). The
    /// experiment engine can't run an automatic before/after on it, so it is never `worth-testing`;
    /// the verdict is `not-applicable`. False for a real one-click tweak AND for an unknown id
    /// (which stays `insufficient-evidence`, never fabricated).
    pub advisory_only: bool,
    /// The setting already reads as changed (live probe), or, when it can't be read, is active in the
    /// Trust Ledger ⇒ already-configured. See [`already_in_target`].
    pub already_active: bool,
    /// On the permanent safety/anti-cheat blocklist (LOCKED rule 6) ⇒ never a testable candidate.
    pub barred: bool,
    /// A deterministic signal that this rig already clears the bottleneck the tweak targets, so a
    /// gain is unlikely (e.g. the setting only helps memory-starved rigs; this one has headroom).
    pub likely_negligible: bool,
    /// Rule prior on whether it plausibly moves a metric here. `None`/`Unknown` ⇒ insufficient evidence.
    pub expected_impact: Option<Confidence>,
    /// What SHOULD move if the theory holds (e.g. "1% low FPS", "input latency"). None ⇒ unknown.
    pub metric_to_watch: Option<String>,
    /// Which detected hardware/state drives the call — the honest "for YOUR hardware" line.
    pub hardware_factor: String,
}

/// The simulator's answer. `is_promise` is ALWAYS false and pinned by a test — §4G forbids framing
/// this as a guaranteed gain. `confidence` is a band, never a number.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct SimulatorReport {
    pub rec_id: String,
    pub rec_title: String,
    /// One of: unlikely-to-matter · plausible-unproven · worth-testing · already-configured ·
    /// not-applicable · risk-exceeds-value · insufficient-evidence.
    pub verdict: String,
    pub confidence: Confidence,
    pub why: String,
    pub hardware_factor: String,
    pub metric_to_watch: Option<String>,
    pub disproof: String,
    pub is_promise: bool,
}

/// PURE §4G estimator. Safety-first precedence: barred → not-applicable → already-configured →
/// negligible → the impact prior. Explains why · which hardware/state drives it · what metric should
/// move · what would disprove the theory. NEVER a promise (`is_promise` hard-false).
pub(crate) fn simulate(ctx: &SimContext) -> SimulatorReport {
    let (verdict, confidence, why): (&str, Confidence, String) = if ctx.barred {
        (
            "risk-exceeds-value",
            Confidence::High,
            "On the permanent safety/anti-cheat blocklist — the stability or anti-cheat risk \
             outweighs any possible gain, so Compy will not test it."
                .into(),
        )
    } else if !ctx.applicable {
        (
            "not-applicable",
            Confidence::High,
            "This change targets hardware or a configuration this rig doesn't have, so it can't \
             do anything here."
                .into(),
        )
    } else if ctx.advisory_only {
        (
            "not-applicable",
            Confidence::High,
            "This is an advisory to act on yourself — Compy has no one-click change for it, so \
             there's no automatic before/after it can run. Do it manually if you want, then measure \
             the result in Test."
                .into(),
        )
    } else if ctx.already_active {
        (
            "already-configured",
            Confidence::High,
            "This rig is already in the target state — there's nothing left to change or test."
                .into(),
        )
    } else if ctx.likely_negligible {
        (
            "unlikely-to-matter",
            Confidence::Medium,
            "This tweak helps rigs that are short on the resource it frees, and this one already \
             has headroom — a measurable gain is unlikely."
                .into(),
        )
    } else {
        match ctx.expected_impact {
            Some(c @ (Confidence::High | Confidence::Medium)) => (
                "worth-testing",
                c,
                "There's a plausible, testable reason this could help on this rig — a controlled \
                 experiment would settle it."
                    .into(),
            ),
            Some(Confidence::Low) => (
                "plausible-unproven",
                Confidence::Low,
                "A gain is conceivable but weakly supported — worth a test only if the effort is low."
                    .into(),
            ),
            _ => (
                "insufficient-evidence",
                Confidence::Unknown,
                "Not enough evidence to estimate whether this matters on this rig — unknown, not zero."
                    .into(),
            ),
        }
    };

    let disproof = match verdict {
        "worth-testing" | "plausible-unproven" => match &ctx.metric_to_watch {
            Some(m) => format!(
                "A controlled before/after that shows {m} unchanged beyond the noise floor \
                 disproves it."
            ),
            None => "A controlled before/after with no measurable change beyond the noise floor \
                     disproves it."
                .into(),
        },
        "unlikely-to-matter" => "A controlled test showing a real gain beyond the noise floor \
                                 would overturn this call."
            .into(),
        "already-configured" => "If a probe showed the rig is NOT actually in the target state, \
                                 this would change."
            .into(),
        "not-applicable" => "If the required hardware/configuration were present, this would change."
            .into(),
        "risk-exceeds-value" => "Nothing measurable overrides the safety bar — this stays barred."
            .into(),
        _ => "A controlled before/after is the only thing that would resolve the unknown.".into(),
    };

    SimulatorReport {
        rec_id: ctx.rec_id.clone(),
        rec_title: ctx.rec_title.clone(),
        verdict: verdict.into(),
        confidence,
        why,
        hardware_factor: ctx.hardware_factor.clone(),
        metric_to_watch: ctx.metric_to_watch.clone(),
        disproof,
        is_promise: false,
    }
}

// ─── Command surface (all gated; refuse while dark — defense in depth) ────

/// State probe: is the experiment engine part of this build? (It is — ARMED 2026-07-17, spec §7.)
#[tauri::command]
pub(crate) fn get_experiment_gate() -> bool {
    experiment_gate()
}

/// Read-only history of experiments. Ungated (pure read); empty until the owner runs the first
/// experiment on the armed build.
#[tauri::command]
pub(crate) fn get_experiments() -> Vec<ExperimentRecord> {
    // `Pending` is the start's own bookkeeping, only on disk while `start_experiment` holds the store
    // lock (or until the launch reconcile resolves it). This read takes no lock, so a refresh during
    // the apply (a UAC prompt steals focus) must not render it as a finished row.
    let experiments: Vec<ExperimentRecord> =
        load_store().experiments.into_iter().filter(|e| e.status != ExperimentStatus::Pending).collect();
    // P4-judge-noisy: a verdict judged on the assumed band is labelled on this copy only, with this
    // game's noise as measured now; the store is never written here.
    if !experiments.iter().any(|e| assumed_band_label(e, None).is_some()) {
        return experiments;
    }
    let sessions = crate::sessions::get_session_summaries();
    with_assumed_band_labels(experiments, |game: &str| game_noise_now(&sessions, game))
}

/// `game`'s noise as measured now, for an assumed-band label: the same reads a start makes for that
/// session (#618 coverage included), so "measured now" is the band a Trial from the game's newest
/// session would be judged on. CR-debrief-assumed-label: the stored comparison result's label reads it too.
pub(crate) fn game_noise_now(sessions: &[SessionSummary], game: &str) -> Option<crate::noise_floor::GameNoise> {
    // At most the newest ten readable sessions are tried, so a refresh stays bounded.
    let mut candidates = readings_newest_first(sessions, game);
    candidates.truncate(10);
    first_measured(candidates, |from| measured_noise_at(sessions, from))
}

/// Sessions of `game` with a frame-rate reading whose frame-cap state can be read, newest first.
fn readings_newest_first<'a>(sessions: &'a [SessionSummary], game: &str) -> Vec<&'a SessionSummary> {
    let mut found: Vec<(DateTime<chrono::FixedOffset>, &SessionSummary)> = sessions
        .iter()
        .filter(|s| has_frame_reading(s) && game_match(game, Some(&s.process_name)) == GameMatch::Match)
        .filter(|s| crate::noise_floor::cap_read(s) != crate::noise_floor::CapRead::Unknown)
        .filter_map(|s| Some((DateTime::parse_from_rfc3339(&s.started_at).ok()?, s)))
        .collect();
    found.sort_by_key(|a| std::cmp::Reverse(a.0));
    found.into_iter().map(|(_, s)| s).collect()
}

/// Coordinator SHOULD-FIX (s27): the game's noise as measured now, from the newest session it can be
/// measured from. The newest session of a game can be a Trial's after-session (one change more), whose
/// own as-is pool is empty, so "measured now" walks back to the newest session that measures: the newest
/// as-is session whose cap state can be read. `None` only when no session of the game measures.
fn first_measured(
    candidates: Vec<&SessionSummary>,
    measure: impl FnMut(&SessionSummary) -> Option<crate::noise_floor::GameNoise>,
) -> Option<crate::noise_floor::GameNoise> {
    candidates.into_iter().find_map(measure)
}

/// P4-judge-noisy: label every verdict judged on the assumed band with its game's noise as measured
/// now (`measure_now`, by game: the band a Trial from its newest session would get; `None` = not
/// measured, and the label says so). Only labelled records are measured; nothing is written.
pub(crate) fn with_assumed_band_labels(
    mut experiments: Vec<ExperimentRecord>,
    measure_now: impl Fn(&str) -> Option<crate::noise_floor::GameNoise>,
) -> Vec<ExperimentRecord> {
    // Opus r1 (s27): measured once per game per read, however many of its records are labelled.
    let mut by_game: std::collections::HashMap<String, Option<crate::noise_floor::GameNoise>> =
        std::collections::HashMap::new();
    for e in &mut experiments {
        if assumed_band_label(e, None).is_none() {
            continue;
        }
        let now = by_game.entry(e.game.clone()).or_insert_with(|| measure_now(&e.game)).clone();
        e.assumed_band = assumed_band_label(e, now.as_ref());
    }
    experiments
}

/// P5-outcomes-f1: the Trial bench's outcome switch, "keep" side. Re-applies `rec_id` through the
/// audited `history` apply, and the Trust Ledger row records `experiment_id` as the Trial that
/// justified it. The id comes from the webview, so it is checked against this module's own store
/// first: it must be a Trial of this change judged Better. Refused while a Trial is starting or
/// running (a re-apply would confound it), like the switch itself.
///
/// Holds the store gate across the check AND the apply, as `start_experiment` does, so a start
/// can't write its Pending record between the two (the Experiment -> History nesting is declared
/// in `race_seam::ALLOWED_NESTING`). No new mutation primitive; any elevation is the existing apply's.
#[tauri::command]
pub(crate) fn apply_outcome_choice(
    rec_id: String,
    rec_title: String,
    experiment_id: String,
) -> Result<crate::history::AppliedChangeView, String> {
    if !experiment_gate() {
        return Err("Trials aren't enabled in this build.".to_string());
    }
    let _g = lock_store()?;
    // CR-bench-holds-setting: a keep re-apply on top of the benchmark's measurement would be the same
    // stale "applied" row once the benchmark rolls back.
    if let Some(refusal) = bench_refusal(std::iter::once(rec_id.as_str())) {
        return Err(refusal);
    }
    // CR-gm-spans-trial (review r1): nor while a Gaming Mode session holds it (its stop would put its
    // own snapshot back over the kept change), or is starting (CR-gm-stop-busy: a stop may run
    // beside it, over settings its contract holds, which this refuses).
    let _gm = crate::gaming_orchestrator::session_op_guard()?;
    if let Some(refusal) = crate::gaming_orchestrator::session_holds_refusal(&rec_id) {
        return Err(refusal);
    }
    let records = load_store().experiments;
    keep_outcome_locked(&records, &rec_id, &experiment_id, |link| {
        crate::history::apply_recommendation_citing(&rec_id, &rec_title, link)
    })
}

/// P5-outcomes-f1: the outcome switch's "put back" side. Undoes ledger row `change_id` through the
/// audited `history` rollback, and the row records `experiment_id` as the Trial that justified the
/// undo. That Trial must be one of the row's change judged not worth keeping. Same refusals, and the
/// same store gate held across the check and the undo, as [`apply_outcome_choice`].
#[tauri::command]
pub(crate) fn undo_outcome_choice(change_id: String, experiment_id: String) -> Result<(), String> {
    if !experiment_gate() {
        return Err("Trials aren't enabled in this build.".to_string());
    }
    let _g = lock_store()?;
    let records = load_store().experiments;
    // CR-gm-spans-trial (review r1): an undo while a Gaming Mode session holds this Trial's setting
    // would be put back by the session's stop; refused, as is one while a session starts.
    let _gm = crate::gaming_orchestrator::session_op_guard()?;
    if let Some(rec) = records.iter().find(|e| e.id == experiment_id) {
        if let Some(refusal) = crate::gaming_orchestrator::session_holds_refusal(&rec.rec_id) {
            return Err(refusal);
        }
        // CR-plan-held-refusal (opus r2): putting back a kept plan (or plan setting) while the benchmark
        // measures the other half writes the plan it is measuring; the apply twin is checked already.
        let held = crate::benchmark_trial::held_now();
        if let Some(refusal) = crate::benchmark_trial::bench_plan_class_refusal(held.as_ref(), std::iter::once(rec.rec_id.as_str())) {
            return Err(refusal);
        }
    }
    undo_outcome_locked(&records, &experiment_id, |cite| {
        crate::history::rollback_change_citing(&change_id, cite)
    })
}

/// CR-rp-same-setting-row: the refusal for a plain apply of a setting a Trial is testing right now.
/// A second ledger row for that setting would snapshot the Trial's own applied state, and when the
/// Trial puts its change back (a confounded or not-kept result restores the Trial's pre-test
/// snapshot) that newer row would still read "applied" over a setting that reads off. So the second
/// apply is refused before anything runs. `None` lets the apply go ahead. PURE. Every open record
/// is checked (review r1: a leftover Pending beside a Running one), and a Pending one is a start
/// that never finished, which the bench does not show, so it gets the start's own wording.
pub(crate) fn held_by_trial_refusal<'a>(
    records: &[ExperimentRecord],
    rec_ids: impl Iterator<Item = &'a str>,
) -> Option<String> {
    let open: Vec<&ExperimentRecord> = records
        .iter()
        .filter(|e| matches!(e.status, ExperimentStatus::Pending | ExperimentStatus::Running))
        .collect();
    if open.is_empty() {
        return None;
    }
    let ids: Vec<&str> = rec_ids.collect();
    // CR-plan-held-refusal: the power plan and the settings OF the plan are one class while a Trial
    // holds either; checked after a direct match, which keeps its own wording.
    let held = match open.iter().copied().find(|e| ids.contains(&e.rec_id.as_str())) {
        Some(held) => held,
        // Opus r2 NIT: the class half is the one helper the undo uses too.
        None => return plan_class_trial_refusal(records, ids.iter().copied()),
    };
    Some(if held.status == ExperimentStatus::Pending {
        format!(
            "An earlier Trial start of \u{201c}{}\u{201d} was interrupted and isn't resolved yet, so Compy won't \
             apply it again. Check Test \u{2192} Applied & history, then try again. Nothing was changed.",
            held.rec_title
        )
    } else {
        format!(
            "\u{201c}{}\u{201d} is being tested by a Trial right now, so Compy won't apply it again on top of \
             the test. Finish the Trial or put it back first. Nothing was changed.",
            held.rec_title
        )
    })
}

/// Who holds the plan in [`plan_class_refusal`] when it is the benchmark.
pub(crate) const BY_BENCHMARK: &str = "the benchmark";

/// CR-plan-held-refusal: the refusal for a change to the power plan, or to a setting of it, while a
/// Trial (`by` = "a Trial") or the benchmark (`by` = [`BY_BENCHMARK`]) is measuring the other.
pub(crate) fn plan_class_refusal(held_title: &str, interrupted: bool, by: &str) -> String {
    if interrupted {
        format!(
            "An earlier Trial start of \u{201c}{held_title}\u{201d} was interrupted and isn't resolved yet. \
             This change writes to the same power plan, so Compy won't make it now. Check Test \u{2192} \
             Applied & history, then try again. Nothing was changed."
        )
    } else {
        // CR-plan-held-behaviour-tests: the benchmark can be cancelled, as its direct-hold refusal says.
        let next = if by == BY_BENCHMARK { "Let it finish, or cancel it, first." } else { "Let it finish first." };
        format!(
            "\u{201c}{held_title}\u{201d} is being measured by {by} right now, and this change writes to the \
             same power plan, so Compy won't make it during the measurement. {next} Nothing was changed."
        )
    }
}

/// The UI's one-click apply (Fix, Optimize, the tour). The audited apply itself is
/// `history::apply_recommendation`; this command adds one refusal in front of it,
/// [`held_by_trial_refusal`], and holds the store gate across the check and the apply so a Trial
/// can't start in between (the gate is the outer half of `Experiment -> History`, as the Trial
/// start's own apply). A Trial store that can't be read refuses too: it could hold the running Trial.
#[tauri::command]
pub(crate) fn apply_recommendation(
    rec_id: String,
    rec_title: String,
) -> Result<crate::history::AppliedChangeView, String> {
    if !experiment_gate() {
        // Review r1: the benchmark's hold holds with Trials switched off too.
        if let Some(refusal) = bench_refusal(std::iter::once(rec_id.as_str())) {
            return Err(refusal);
        }
        // CR-gm-spans-followups (d): and a Gaming Mode session's, with its gate held through the write.
        let _gm = crate::gaming_orchestrator::plain_change_gate(std::iter::once(rec_id.as_str()))?;
        return crate::history::apply_recommendation(rec_id, rec_title);
    }
    let _g = lock_store()?;
    let records = load_store_checked()?.experiments;
    if let Some(refusal) = held_by_trial_refusal(&records, std::iter::once(rec_id.as_str())) {
        return Err(refusal);
    }
    if let Some(refusal) = bench_refusal(std::iter::once(rec_id.as_str())) {
        return Err(refusal);
    }
    let _gm = crate::gaming_orchestrator::plain_change_gate(std::iter::once(rec_id.as_str()))?;
    crate::history::apply_recommendation(rec_id, rec_title)
}

/// CR-gm-spans-followups (d): the UI's undo (Test → Applied & history, the Trust Ledger). The audited
/// undo itself is `history::rollback_change`, which the Trial and benchmark restores call directly;
/// this command adds one refusal in front of it: an undo of a setting a Gaming Mode session holds
/// would be put back on by that session's stop. Gaming Mode's operation gate (try_lock only) is held
/// from the check through the undo, so a session can't start in between. The row's setting is read
/// first, outside the gate (a row's rec id never changes).
#[tauri::command]
pub(crate) fn rollback_change(change_id: String) -> Result<(), String> {
    let rec_id = crate::history::rec_id_of_change(&change_id)?;
    // CR-plan-held-refusal (opus r1): an undo in the power-plan class while a Trial or the benchmark
    // measures the other half writes the plan being measured. Store gate, then Gaming Mode's, as the apply.
    let _g = plan_class_hold_check(rec_id.iter().map(String::as_str))?;
    let _gm = crate::gaming_orchestrator::plain_change_gate(rec_id.iter().map(String::as_str))?;
    crate::history::rollback_change(change_id)
}

/// CR-plan-held-refusal (opus r1): for the undo and the core-parking restore, the plan-class half of the
/// Trial and benchmark holds (an undo of the held setting itself keeps today's behaviour). Only a
/// setting in the plan class takes the store gate and reads the store, so every other undo and restore
/// runs as before. The gate is returned and held through the write, so a Trial can't start between
/// the check and the write; a Trial store that can't be read refuses (it could hold the running Trial).
/// Like the apply, it waits on the store gate (a lock, not a try-lock) behind a Trial start in progress.
fn plan_class_hold_check<'a>(rec_ids: impl Iterator<Item = &'a str> + Clone) -> Result<Option<crate::race_seam::StoreGuard>, String> {
    if !rec_ids.clone().any(crate::gaming_orchestrator::in_plan_class) {
        return Ok(None);
    }
    let gate = if experiment_gate() {
        let g = lock_store()?;
        // CR-plan-held-behaviour-tests (opus r1 nit): an unreadable store says why this change needs it.
        let records = load_store_checked()
            .map_err(|e| {
                format!(
                    "This change writes to your power plan, which a Trial may be measuring, so Compy checks its \
                     Trial records first. {e}"
                )
            })?
            .experiments;
        if let Some(refusal) = plan_class_trial_refusal(&records, rec_ids.clone()) {
            return Err(refusal);
        }
        Some(g)
    } else {
        None
    };
    let held = crate::benchmark_trial::held_now();
    if let Some(refusal) = crate::benchmark_trial::bench_plan_class_refusal(held.as_ref(), rec_ids) {
        return Err(refusal);
    }
    Ok(gate)
}

/// CR-plan-held-refusal (opus r1), PURE: only the plan-class half of [`held_by_trial_refusal`]: an open
/// Trial on the power plan or a setting of it, and a change to the other half.
pub(crate) fn plan_class_trial_refusal<'a>(records: &[ExperimentRecord], rec_ids: impl Iterator<Item = &'a str>) -> Option<String> {
    let ids: Vec<&str> = rec_ids.collect();
    let held = records
        .iter()
        .filter(|e| matches!(e.status, ExperimentStatus::Pending | ExperimentStatus::Running))
        .find(|e| ids.iter().any(|w| crate::gaming_orchestrator::plan_class_clash(&e.rec_id, w)))?;
    Some(plan_class_refusal(&held.rec_title, held.status == ExperimentStatus::Pending, "a Trial"))
}

/// CR-core-parking-held-with-plan: the webview's leftover restore. The core-parking restore writes the
/// ACTIVE plan (SCHEME_CURRENT): while a Gaming Mode session holds the plan that is the session's plan,
/// and after its stop the row would read off and its undo would write the session plan's priors onto
/// the user's own plan with no record. So it is refused then, with Gaming Mode's gate (try_lock only)
/// held through the ledger write, as every other plain apply. A leftover no session can touch takes no
/// gate and reads nothing. The audited restore is history's.
#[tauri::command]
pub(crate) fn restore_leftover(
    detector_id: String,
    display_title: String,
) -> Result<crate::history::AppliedChangeView, String> {
    // CR-plan-held-refusal (opus r1): the core-parking restore writes the plan a Trial or the benchmark
    // may be measuring.
    let _g = plan_class_hold_check(std::iter::once(detector_id.as_str()))?;
    let _gm = crate::gaming_orchestrator::plain_change_gate(std::iter::once(detector_id.as_str()))?;
    crate::history::restore_leftover(&detector_id, &display_title)
}

/// CR-gm-service-suspend-rows: the session service-suspend command (armed, no UI caller today).
/// A Gaming Mode session that suspends the same service resumes it on stop, under this row ("applied"
/// over a running service), so it is refused while one holds it, with Gaming Mode's try_lock-only gate
/// held through the ledger write, as the UI's other applies. The audited suspend is history's.
#[tauri::command]
pub(crate) fn suspend_known_service(service_name: String) -> Result<crate::history::AppliedChangeView, String> {
    let rec_id = crate::actions::KnownService::from_name(&service_name).map(|s| crate::history::suspend_rec_id(&s));
    let _gm = crate::gaming_orchestrator::plain_change_gate(rec_id.iter().map(String::as_str))?;
    crate::history::suspend_known_service(service_name)
}

/// CR-gm-spans-trial: the settings every open (Pending or Running) Trial holds, for Gaming Mode's
/// start. Read checked and without the store gate (Gaming Mode's start never waits on a Trial); a
/// store that can't be read is an error, since it could hold the running Trial.
pub(crate) fn open_trial_rec_ids() -> Result<Vec<String>, String> {
    if !experiment_gate() {
        return Ok(Vec::new());
    }
    Ok(open_rec_ids(&load_store_checked()?.experiments))
}

/// PURE: the rec ids of the open (Pending or Running) Trials in `records`.
fn open_rec_ids(records: &[ExperimentRecord]) -> Vec<String> {
    records
        .iter()
        .filter(|e| matches!(e.status, ExperimentStatus::Pending | ExperimentStatus::Running))
        .map(|e| e.rec_id.clone())
        .collect()
}

/// CR-bench-holds-setting: the benchmark tweak trial's hold, read now.
pub(crate) fn bench_refusal<'a>(rec_ids: impl Iterator<Item = &'a str>) -> Option<String> {
    crate::benchmark_trial::bench_held_refusal(crate::benchmark_trial::held_now().as_ref(), rec_ids)
}

/// The benchmark tweak trial's apply: the same Trial refusal and gate as [`apply_recommendation`],
/// and, under that gate before the apply runs, the setting is marked held by this trial run
/// (`token`) so a UI apply of it is refused until the trial has rolled it back
/// (CR-bench-holds-setting). A setting another bench run still holds is refused too.
pub(crate) fn apply_for_bench_trial(
    rec_id: String,
    rec_title: String,
    token: u64,
) -> Result<crate::history::AppliedChangeView, String> {
    let _g = if experiment_gate() {
        let g = lock_store()?;
        let records = load_store_checked()?.experiments;
        if let Some(refusal) = held_by_trial_refusal(&records, std::iter::once(rec_id.as_str())) {
            return Err(refusal);
        }
        Some(g)
    } else {
        None
    };
    if let Some(refusal) = bench_refusal(std::iter::once(rec_id.as_str())) {
        return Err(refusal);
    }
    // CR-bench-preapply-read: read the setting first, as a Trial start does (§4.1). Over a setting
    // that already reads as changed, the trial's snapshot would be "on": its rollback would put back
    // on a change the user undoes in the ledger during the measurement, and the "change off" baseline
    // was measured with it on. A setting that can't be read couldn't be verified either way. Read
    // before Gaming Mode's gate, as in a Trial start: its session check below still runs before the
    // hold and the apply, and a UI apply is kept out by the store gate.
    if let Some(why) = pre_apply_refusal(crate::history::probe_rec_target(&rec_id)) {
        return Err(why.to_string());
    }
    // CR-gm-spans-trial: a Gaming Mode session holding this setting would put its snapshot back on
    // stop, under the measurement (or over the benchmark's rollback). Gaming Mode's operation gate
    // (try_lock only) is held through the hold and the apply, as in a Trial start.
    let _gm = crate::gaming_orchestrator::session_op_guard()?;
    if let Some(refusal) = crate::gaming_orchestrator::session_holds_refusal(&rec_id) {
        return Err(refusal);
    }
    crate::benchmark_trial::hold(token, &rec_id, &rec_title);
    crate::history::apply_recommendation(rec_id, rec_title)
}

/// The UI's one-elevation batch, with the same refusal and gate as [`apply_recommendation`]: a batch
/// naming the setting a running Trial holds is refused whole, before anything runs.
#[tauri::command]
pub(crate) fn apply_recommendations_batch(
    items: Vec<crate::history::BatchApplyItem>,
) -> Result<crate::history::BatchApplyReport, String> {
    if !experiment_gate() {
        if let Some(refusal) = bench_refusal(items.iter().map(|i| i.rec_id.as_str())) {
            return Err(refusal);
        }
        let _gm = crate::gaming_orchestrator::plain_change_gate(items.iter().map(|i| i.rec_id.as_str()))?;
        return crate::history::apply_recommendations_batch(items);
    }
    let _g = lock_store()?;
    let records = load_store_checked()?.experiments;
    if let Some(refusal) = held_by_trial_refusal(&records, items.iter().map(|i| i.rec_id.as_str())) {
        return Err(refusal);
    }
    if let Some(refusal) = bench_refusal(items.iter().map(|i| i.rec_id.as_str())) {
        return Err(refusal);
    }
    let _gm = crate::gaming_orchestrator::plain_change_gate(items.iter().map(|i| i.rec_id.as_str()))?;
    crate::history::apply_recommendations_batch(items)
}

/// The keep side's decision, run under the store gate: refuse while a Trial starts or runs, check
/// the cited Trial, and only then call `apply` with its link.
fn keep_outcome_locked<T>(
    records: &[ExperimentRecord],
    rec_id: &str,
    experiment_id: &str,
    apply: impl FnOnce(crate::history::TrialLink) -> Result<T, String>,
) -> Result<T, String> {
    outcome_switch_open(records)?;
    apply(trial_link_in(records, experiment_id, rec_id, true)?)
}

/// The put-back side's decision, run under the store gate: refuse while a Trial starts or runs,
/// then hand `rollback` the check for the row's change.
fn undo_outcome_locked(
    records: &[ExperimentRecord],
    experiment_id: &str,
    rollback: impl FnOnce(crate::history::CiteTrial) -> Result<(), String>,
) -> Result<(), String> {
    outcome_switch_open(records)?;
    rollback(&|rec_id: &str| trial_link_in(records, experiment_id, rec_id, false))
}

/// PURE: the switch is closed while any Trial is starting or running.
fn outcome_switch_open(records: &[ExperimentRecord]) -> Result<(), String> {
    if records
        .iter()
        .any(|x| matches!(x.status, ExperimentStatus::Pending | ExperimentStatus::Running))
    {
        return Err("Finish or stop the Trial in progress before switching. Nothing was changed.".to_string());
    }
    Ok(())
}

/// PURE: the Trial an outcome-switch apply (`keep`) or undo cites, checked and copied for the
/// Trust Ledger. A keep needs a Trial of this change judged Better (`improved`);
/// an undo needs one judged not worth keeping (`no-change` or `regressed`). Anything else (unknown
/// id, another change, a Trial still running or not measured) refuses, and nothing is changed.
fn trial_link_in(
    records: &[ExperimentRecord],
    experiment_id: &str,
    rec_id: &str,
    keep: bool,
) -> Result<crate::history::TrialLink, String> {
    let x = records
        .iter()
        .find(|x| x.id == experiment_id && x.status != ExperimentStatus::Pending)
        .ok_or_else(|| "Compy couldn't find the Trial this choice is based on, so nothing was changed.".to_string())?;
    if x.rec_id != rec_id {
        return Err("That Trial tested a different change, so nothing was changed.".to_string());
    }
    let verdict = x.verdict.as_deref();
    let fits = if keep {
        verdict == Some("improved")
    } else {
        matches!(verdict, Some("no-change") | Some("regressed"))
    };
    if !fits {
        return Err(if keep {
            "That Trial didn't judge this change Better, so it can't be the reason to apply it. Nothing was changed."
        } else {
            "That Trial didn't find this change not worth keeping, so it can't be the reason to undo it. Nothing was changed."
        }
        .to_string());
    }
    Ok(crate::history::TrialLink {
        experiment_id: x.id.clone(),
        outcome: match x.outcome {
            TrialOutcome::MaxFps => "max-fps",
            TrialOutcome::Recommended => "recommended",
            TrialOutcome::Smoothest => "smoothest",
        }
        .to_string(),
        concluded_at: x.concluded_at.clone(),
    })
}

/// §4G — estimate whether a change is worth a controlled test. Refuses while dark. Read-only; NEVER
/// a promise of gain.
#[tauri::command]
pub(crate) fn simulate_optimization(rec_id: String) -> Result<SimulatorReport, String> {
    if !experiment_gate() {
        return Err("The optimization simulator isn't part of this build yet.".into());
    }
    let ctx = build_sim_context(&rec_id)?;
    Ok(simulate(&ctx))
}

/// P5-realplay: a real-play start's evidence, the as-is sessions it pins (`realplay::before_arm` on
/// the unchanged run that ends at `anchor`), or why it can't start, in words that name what to play.
/// When `anchor` itself can't be pinned, that is the reason given (`realplay::unpinnable_anchor`),
/// never "0 of them count so far".
fn real_play_start(
    sessions: &[SessionSummary],
    anchor: &SessionSummary,
    ledger: &[LedgerEntryRef<'_>],
    now: DateTime<Utc>,
) -> Result<crate::realplay::RealPlayEvidence, String> {
    use crate::realplay::{MIN_READINGS, MIN_SESSIONS};
    let before = crate::realplay::before_arm(sessions, anchor, ledger, now);
    let game = crate::intelligence::pretty_game_name(&anchor.process_name);
    if before.is_empty() {
        if let Some(why) = crate::realplay::unpinnable_anchor(anchor, sessions, now) {
            return Err(format!(
                "real play compares the change with the sessions of {game} that end at the one this test starts \
                 from, and that session can't be one of them: {why}; play {game} again for at least {MIN_READINGS} \
                 readings (about 10 minutes), then start from that session"
            ));
        }
    }
    if before.len() < MIN_SESSIONS {
        return Err(format!(
            "real play compares the change with at least {MIN_SESSIONS} sessions of {game} played the way your PC is \
             now, with nothing changed between them, in the last {} days, each at least {MIN_READINGS} readings \
             (about 10 minutes); {} of them count so far, so play {} more, then start",
            crate::comparison::ARM_MAX_AGE_DAYS,
            before.len(),
            MIN_SESSIONS - before.len()
        ));
    }
    Ok(crate::realplay::RealPlayEvidence { before, ..Default::default() })
}

/// P8-ack (RISK_MODEL §1): which changes need the user's tap on the line naming their cost before a
/// Trial starts — the catalog's `safe` ones don't; moderate, unstated and unlisted ones do. Mirrors
/// the UI's `needsCostAck` so both locks agree.
pub(crate) fn needs_cost_ack(stated: Option<&crate::trial_candidates::StatedRisk>) -> bool {
    stated.is_none_or(|r| r.overall != crate::trial_candidates::Risk::Low)
}

/// §4F step 1–4 — capture baseline, snapshot + apply ONE reversible change through the audited
/// ledger boundary, and record a Running experiment. Refuses while dark, and while another experiment
/// is starting or running. RECORD FIRST (#583): a `Pending` record naming the change is saved before
/// anything is applied, so no crash point can leave an applied change that no experiment names. A
/// failed apply never drops that record: it stays, loudly Aborted, and a live read of the setting only
/// words why (see `settle_failed_apply`). After a successful apply, a start that can't
/// finish (the target didn't take, or the evidence watermark is unreadable) restores the change
/// through the audited boundary before returning the error, never leaves it applied unrecorded.
/// The baseline is named by its session id and read from Compy's own session store (#583 lane 2b):
/// the game and the frame rates come from there, never from the webview. `risk_choice` is the risk
/// the user allows on this PC (P8-posture-show), kept on the record for its receipt; absent = not
/// recorded. `cost_acknowledged` is the user's tap on the line naming the change's cost (P8-ack), a
/// UI confirm before this command, kept on the record; a change the catalog doesn't rate low risk is
/// refused without it (P8-ack-enforce). `mode` "real-play" (P5-realplay)
/// leaves the change on while the player plays: the start then pins, from the session store, the
/// unchanged run of as-is sessions that ends at the baseline session, and refuses before anything is
/// recorded or changed when fewer than `realplay::MIN_SESSIONS` count; absent is the two-session Trial.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn start_experiment(
    rec_id: String,
    rec_title: String,
    baseline_session_id: String,
    hypothesis: String,
    outcome: Option<String>,
    risk_choice: Option<crate::trial_candidates::RiskChoice>,
    cost_acknowledged: Option<bool>,
    mode: Option<String>,
) -> Result<ExperimentRecord, String> {
    if !experiment_gate() {
        return Err("The experiment engine isn't part of this build yet.".into());
    }
    // P4-maxfps-smooth: an outcome this build can't judge is refused before anything happens.
    let outcome = start_outcome(outcome.as_deref())?;
    // P5-realplay: so is a way of measuring it doesn't know, and Smoothest in real play.
    let mode = start_mode(mode.as_deref(), outcome)?;
    // P8-dims: what the catalog states about this change's risk, read before the store lock and kept
    // on the record.
    let stated_risk = crate::trial_candidates::stated_risk_now(&rec_id);
    // P8-ack-enforce (RISK_MODEL §1 Advanced; owner delegated the call 2026-11-03): a change the
    // catalog rates moderate, or whose risk it doesn't state, starts only with the user's tap on its
    // cost line recorded. The UI asks first ("I understand, test it"); this is the second lock, so no
    // other caller — a later journey step, a scripted start — applies such a change to the machine
    // without that consent. Refused before anything is recorded or changed; a low-risk change starts
    // as before. The same rule as the UI's `needsCostAck`: safe starts, anything else needs the tap.
    if needs_cost_ack(stated_risk.as_ref()) && cost_acknowledged != Some(true) {
        let title: String = rec_title.chars().take(MAX_TEXT_LEN).collect();
        return Err(format!(
            "experiment not started — {title} isn't confirmed low risk, so its cost needs your OK \
             (\"I understand, test it\") before the Trial starts"
        ));
    }
    let _g = lock_store()?;

    // Cap the persisted free-text at the trust boundary (see MAX_TEXT_LEN). Truncate, don't reject.
    let rec_title: String = rec_title.chars().take(MAX_TEXT_LEN).collect();
    let hypothesis: String = hypothesis.chars().take(MAX_TEXT_LEN).collect();

    // One store read serves the single-active check, the id counter and the read-modify-write, all
    // under this one lock.
    let mut store = load_store_checked()?;
    // Under this lock no start is in flight, so any `Pending` here is an interrupted one: resolve it
    // now rather than letting it block until the next launch.
    reconcile_pending_locked(&mut store)?;
    // §3 one causal question at a time — enforced here, not only by the UI hiding the button.
    if let Some(active) = active_trial(&store) {
        return Err(if active.status == ExperimentStatus::Pending {
            format!(
                "an earlier experiment start ({}) was interrupted and isn't resolved yet — check \
                 Test → Applied & history, then try again",
                active.rec_title,
            )
        } else {
            format!(
                "another experiment ({}) is still running — conclude or restore it before starting \
                 a new one",
                active.rec_title,
            )
        });
    }

    // Step 2 (§4.2): the baseline, from Compy's own session store. Refused before anything is
    // recorded or changed, so a missing or unmeasured baseline costs the user nothing.
    let sessions = crate::sessions::get_session_summaries();
    let baseline = resolve_baseline(&sessions, &baseline_session_id)
        .map_err(|why| format!("experiment not started — {why}"))?;
    // §3: the baseline must still describe the Compy changes in place now. #618: bounded by when an
    // earlier ledger was set aside, against this baseline's own start.
    let (history, coverage) = ledger_view_for_one_change_checks(
        crate::history::load_history,
        crate::history::ledger_set_aside_through,
        Some(baseline.started_at.as_str()),
    );
    // #618: after a set-aside, only sessions past its edge can be paired as unchanged.
    let covered = sessions_the_ledger_covers(&sessions, coverage);
    // §5 (P4-judge-noisy): the bands this Trial is judged against, measured from this game's as-is
    // sessions on this PC; never assumed. Unmeasured (too few as-is sessions, or the baseline's cap
    // state can't be read) is refused before anything is recorded or changed, asking for the sessions
    // it needs. An unreadable ledger can't prove any pair unchanged; the §3 view below refuses it in
    // its own words first.
    // §2: a baseline too short to judge a change against is refused; an uneven or untraced one starts
    // and the record says so. Its halves are graded on the fixed default, which the record keeps as
    // `halves_floor_pct`, never on the verdict band (average fps vs a 1% low spread).
    let halves_floor = DEFAULT_NOISE_FLOOR_PCT;
    let (baseline_check, baseline_halves) = baseline_for_start(baseline, halves_floor)
        .map_err(|why| format!("experiment not started — {why}"))?;
    // CR-trial-gm-baseline-overlap: a baseline played with Gaming Mode on (or not recorded) can't
    // stand for "without" a setting Gaming Mode itself changes.
    if let Some(why) = gaming_mode_baseline_overlap(baseline, &rec_id) {
        return Err(format!("experiment not started — {why}"));
    }
    // P4-noise, kept on the record as evidence and for an older Compy, which judges only on
    // `noise_floor_pct`: the largest spread between whole unchanged sessions, never below the fixed
    // default. This build never judges on it: the verdict is judged on `game_noise` (P4-judge-noisy).
    let between = history
        .as_deref()
        .ok()
        .and_then(|changes| crate::noise_floor::between_session_noise(&covered, baseline, &ledger_rows(changes)));
    let noise_floor_pct = crate::noise_floor::noise_band_pct(between.as_ref());
    let game_noise = match history.as_deref() {
        Ok(changes) => Some(
            crate::noise_floor::measure_game_noise(&covered, baseline, &ledger_rows(changes))
                .map_err(|why| format!("experiment not started — {}", noise_unmeasured_message(&why, &baseline.process_name)))?,
        ),
        Err(_) => None,
    };
    // #668: every count below is folded from the rows this one load returned, never read again — a
    // second read that failed used to record 0 changes active on a rig that had some.
    let view = baseline_checked_view(baseline, &history, coverage)
        .map_err(|why| format!("experiment not started — {why}"))?;
    let (changes, rows) = (view.changes, view.rows.as_slice());
    let Some(game_noise) = game_noise else {
        return Err("experiment not started — Compy can't read its change history, so it can't tell which \
                    sessions ran with nothing changed or measure how much this game varies on its own"
            .into());
    };
    // P4-smooth-offer: Smoothest starts only when this game's frame pacing was measured between
    // unchanged sessions on this PC, and is judged on that band; refused before anything is recorded.
    // After the §3 view, so a history that can't cover this baseline is refused in its own words.
    let smoothest = match outcome {
        TrialOutcome::Smoothest => {
            let evidence = smoothest_for(&covered, baseline, &history)
                .map_err(|held| format!("experiment not started — {}", smoothest_held_message(held)))?;
            Some(evidence)
        }
        TrialOutcome::Recommended | TrialOutcome::MaxFps => None,
    };
    // P5-realplay: the as-is sessions a real-play Trial is judged against, pinned here and never
    // re-picked, from the sessions the ledger covers and the rows this start loaded: the unchanged run
    // that ends at this baseline. Too few is refused before anything is recorded or changed.
    let real_play = match mode {
        TrialMode::RealPlay => Some(
            real_play_start(&covered, baseline, rows, Utc::now()).map_err(|why| format!("experiment not started — {why}"))?,
        ),
        TrialMode::Pair => None,
    };
    // §3: other applied settings not confirmed in place would leave the result unjudged at conclude.
    let unverified = unverified_others_live(changes, rows, &rec_id, &crate::history::LiveReads::default());
    if let Some(why) = unverified_start_refusal(unverified) {
        return Err(format!("experiment not started — {why}"));
    }

    // Step 1 (§4.1): read the setting before anything is recorded or changed. Only a setting that
    // reads as not yet changed can start, so the restore has a verified state to return to.
    if let Some(why) = pre_apply_refusal(crate::history::probe_rec_target(&rec_id)) {
        return Err(format!("experiment not started — {why}"));
    }
    // CR-bench-holds-setting (review r1): a setting the benchmark tweak trial holds is refused by name,
    // even in the moment before its apply lands (its hold is set under this same gate).
    if let Some(why) = bench_refusal(std::iter::once(rec_id.as_str())) {
        return Err(format!("experiment not started — {why}"));
    }
    // CR-gm-spans-trial: a Gaming Mode session holding this setting would put its own snapshot back
    // when it stops, over the Trial's change or its restore. Review r1 (sonnet MUST-FIX): Gaming
    // Mode's own operation gate (try_lock only) is held from this check through the record and the
    // apply, so a session can't start in between, and none is starting now. (CR-gm-stop-busy: a stop
    // or recovery may run beside it; it restores only steps its contract holds, and a contract on
    // disk that holds this setting, or holds the power plan when this is a setting of the plan,
    // refused just below, as does any check made while a stop is putting changes back.)
    let _gm = crate::gaming_orchestrator::session_op_guard().map_err(|why| format!("experiment not started — {why}"))?;
    if let Some(why) = crate::gaming_orchestrator::session_holds_refusal(&rec_id) {
        return Err(format!("experiment not started — {why}"));
    }

    // Single-variable honesty context BEFORE we apply (§4F): how many changes are already active, by
    // the one shared rule a session counts with (453-f1 review); the note names only OTHER settings,
    // never an older row for the one under test (#628).
    let active = view.active;
    let others = other_active_changes(&view.active_recs, &rec_id);
    let warning = attribution_warning(others, matches!(coverage, LedgerCoverage::SinceSetAside(_)));

    // Step 0 — RECORD FIRST. Saved before the apply; a failed save stops here with nothing changed.
    let now = Utc::now();
    store.schema_version = STORE_SCHEMA_VERSION;
    store.experiments.push(ExperimentRecord {
        id: format!("exp:{}-{}", store.experiments.len() + 1, now.timestamp_millis()),
        rec_id: rec_id.clone(),
        rec_title: rec_title.clone(),
        game: baseline.process_name.clone(),
        hypothesis,
        created_at: now.to_rfc3339(),
        status: ExperimentStatus::Pending,
        baseline_avg_fps: baseline.avg_fps,
        baseline_low1_fps: baseline.low1_fps_est,
        baseline_session_id: Some(baseline.started_at.clone()),
        baseline_halves,
        baseline_check: Some(baseline_check),
        applied_at: None,
        session_pairing: None,
        noise_evidence: None,
        between_session_noise: between,
        game_noise: Some(game_noise),
        assumed_band: None,
        halves_floor_pct: Some(halves_floor),
        ledger_watermark: 0,
        applied_change_id: String::new(),
        active_changes_at_start: active,
        attribution_warning: warning,
        noise_floor_pct,
        treatment: None,
        verdict: None,
        kept: false,
        stop_reason: None,
        concluded_at: None,
        verdict_confidence: None,
        verdict_note: None,
        trial_result: None,
        target_verified: None,
        prior_state_verified: true,
        final_state_verified: None,
        // P4-maxfps-smooth: a webview that sends no pick asks for the default (`start_outcome`).
        outcome,
        smoothest,
        stated_risk,
        // P8-posture-show: the risk the user allowed when this Trial started, as the webview said it.
        risk_choice,
        // P8-ack: whether the user confirmed the change's cost before it started, as the webview said it.
        cost_acknowledged,
        mode,
        real_play,
    });
    let idx = store.experiments.len() - 1;
    // P5-realplay: an older Compy reads a real-play record as a pair Trial against the as-is sessions'
    // geometric means; its baseline session is already the newest of them.
    let means = store.experiments[idx].real_play.as_ref().and_then(|ev| crate::realplay::geometric_means(&ev.before));
    if let Some((low1, avg)) = means {
        (store.experiments[idx].baseline_low1_fps, store.experiments[idx].baseline_avg_fps) = (low1, avg);
    }
    save_store(&store)?;

    // Step 3–4: apply exactly ONE reversible change via the audited boundary. This captures the
    // typed rollback contract + prior-state snapshot at apply time (mutation-gate item 2).
    let applied = match crate::history::apply_recommendation(rec_id, rec_title) {
        Ok(applied) => applied,
        Err(e) => {
            let check = crate::history::probe_rec_target(&store.experiments[idx].rec_id);
            return Err(settle_failed_apply(&mut store, idx, &e, check));
        }
    };
    // The change is in place from here on; only a session started later can measure it.
    store.experiments[idx].applied_at = Some(Utc::now().to_rfc3339());
    store.experiments[idx].applied_change_id = applied.id().to_string();
    // Name the change on disk before any further step can fail or crash, so a reconcile matches it
    // by id instead of inferring it. A record that can't be saved can't own a change: restore it.
    if let Err(e) = save_store(&store) {
        return Err(abort_start(
            &mut store,
            idx,
            &format!("the experiment record could not be saved after the apply ({e})"),
        ));
    }

    // Step 5 (§4.5): the live probe must read the target state straight after the apply. Not
    // changed, or not readable, is a target Compy can't verify — §7 aborts and restores.
    let target = target_verification(applied.active_check);
    store.experiments[idx].target_verified = target;
    match target {
        Some(true) => {}
        Some(false) => {
            return Err(abort_start(
                &mut store,
                idx,
                "the setting did not read as changed after the apply, so there is nothing to measure",
            ))
        }
        None => {
            return Err(abort_start(
                &mut store,
                idx,
                "Compy could not read the setting back after the apply, so it can't prove the change \
                 took effect",
            ))
        }
    }

    // Watermark AFTER our apply so a LATER external change trips the confound guard, not our own. An
    // unreadable ledger means a fair before/after could never be proven (§7 "the app loses required
    // evidence"), so the start is aborted and the change restored. See `comparison::arm_watermark`.
    let ledger_watermark = match crate::comparison::arm_watermark() {
        Ok(w) => w,
        Err(e) => return Err(abort_start(&mut store, idx, &e)),
    };
    store.experiments[idx].ledger_watermark = ledger_watermark;
    store.experiments[idx].status = ExperimentStatus::Running;
    // A start the caller sees fail must not leave its change applied: restore when the promotion
    // can't be saved.
    if let Err(e) = save_store(&store) {
        return Err(abort_start(
            &mut store,
            idx,
            &format!("the experiment record could not be saved as running ({e})"),
        ));
    }
    Ok(store.experiments[idx].clone())
}

/// A failed apply. The record always stays, as a loud `Aborted` naming what Compy saw: the ledger can
/// fail AFTER Windows was changed (the receipt couldn't be built or saved), and an apply that writes
/// in several steps can stop part-way, leaving a setting that reads as unchanged. No receipt exists
/// for either, so Compy has no undo to run and never claims one. `check` is the live read taken after
/// the failure. If the save fails, the `Pending` record stays on disk and the next reconcile turns it
/// into the same loud record.
fn settle_failed_apply(
    store: &mut ExperimentStore,
    idx: usize,
    err: &str,
    check: crate::history::ActiveCheck,
) -> String {
    let message = mark_failed_apply(&mut store.experiments[idx], err, check);
    match save_store(store) {
        Ok(()) => message,
        Err(e) => format!("{message} (the experiment record could not be saved: {e})"),
    }
}

/// PURE half of [`settle_failed_apply`]: turns the record into a loud `Aborted` and returns the
/// message to surface.
fn mark_failed_apply(rec: &mut ExperimentRecord, err: &str, check: crate::history::ActiveCheck) -> String {
    let changed = target_verification(Some(check));
    let (why, message) = if changed == Some(false) {
        (
            "the apply reported an error; the setting reads as not changed, but a change that stopped \
             part-way can read that way too, and Compy saved no undo record for it",
            "The setting reads as not changed, but a change that stopped part-way can read that way \
             too, and Compy saved no undo record for it. If it looks changed in Windows, set it back there.",
        )
    } else if changed == Some(true) {
        (
            "the apply reported an error, but the setting reads as changed and Compy saved no undo \
             record for it",
            "the setting now reads as changed, and Compy saved no undo record for it, so it can't undo \
             it and it won't be listed in Test → Applied & history. Set it back in Windows.",
        )
    } else {
        (
            "the apply reported an error, and Compy can't read the setting to tell whether it changed",
            "Compy can't read the setting to tell whether it changed, and it saved no undo record for \
             it. Check the setting in Windows.",
        )
    };
    rec.status = ExperimentStatus::Aborted;
    rec.kept = false;
    rec.target_verified = changed;
    rec.trial_result = Some(TrialResult::Unmeasurable);
    rec.concluded_at = Some(Utc::now().to_rfc3339());
    rec.stop_reason = Some(format!("start-aborted: {why}: {err}"));
    format!("experiment aborted — the apply reported an error ({err}). {message}")
}

/// Abort a start AFTER its change was applied: restore through the audited boundary and record why.
/// Nothing was measured, so the result is `Unmeasurable` and §9 says restore. A restore that doesn't
/// complete leaves a loud `Aborted` record naming the change, exactly like a failed conclude.
/// Returns the error message for the caller to surface.
fn abort_start(store: &mut ExperimentStore, idx: usize, why: &str) -> String {
    let change_id = store.experiments[idx].applied_change_id.clone();
    let restored = crate::history::rollback_change(change_id);
    let compy_restored = restored.is_ok();
    let rec = &mut store.experiments[idx];
    rec.kept = false;
    rec.trial_result = Some(TrialResult::Unmeasurable);
    rec.concluded_at = Some(Utc::now().to_rfc3339());
    let mut message = match restored {
        Ok(()) => {
            rec.status = ExperimentStatus::Restored;
            rec.stop_reason = Some(format!("start-aborted: {why}; the change was restored"));
            format!("experiment aborted before measuring — {why}. Compy restored the change.")
        }
        Err(e) if restore_already_reverted(&e) => {
            rec.status = ExperimentStatus::Restored;
            rec.stop_reason = Some(format!(
                "start-aborted: {why}; the change was already reverted outside Compy"
            ));
            format!("experiment aborted before measuring — {why}. The change is already reverted.")
        }
        Err(e) => {
            rec.status = ExperimentStatus::Aborted;
            rec.stop_reason = Some(format!(
                "start-aborted: {why}; automatic restore did not complete — check it in Test → Applied & history: {e}"
            ));
            format!(
                "experiment aborted before measuring — {why} — and the automatic restore did not \
                 complete. Compy could not confirm the change was rolled back; check it in \
                 Test → Applied & history and undo it there. ({e})"
            )
        }
    };
    // §4.10: a restore is only as good as the read that follows it.
    if rec.status == ExperimentStatus::Restored {
        let check = crate::history::probe_rec_target(&rec.rec_id);
        if let Some(still) = settle_restore(rec, compy_restored, check) {
            message = format!("experiment aborted before measuring — {why}. {still}");
        }
    }
    match save_store(store) {
        Ok(()) => message,
        // The record on disk is still Pending; the next reconcile resolves it against the ledger.
        Err(e) => format!("{message} (the experiment record could not be saved: {e})"),
    }
}

/// Resolve every `Pending` record in `store` against the ledger and save when anything changed.
/// The caller holds `lock_store()`. Reads the ledger only when a `Pending` record exists, and never
/// mutates Windows: see [`reconcile_interrupted_starts_in`].
fn reconcile_pending_locked(store: &mut ExperimentStore) -> Result<Vec<InterruptedStart>, String> {
    if !store.experiments.iter().any(|e| e.status == ExperimentStatus::Pending) {
        return Ok(Vec::new());
    }
    let history = crate::history::load_history();
    let rows = ledger_rows(history.as_deref().unwrap_or_default());
    let ledger = match &history {
        Ok(_) => Ok(rows.as_slice()),
        Err(e) => Err(e.as_str()),
    };
    // The live read that words the loud record of a start with no change record; it never drops one.
    // One pass's reads, so several interrupted service-disable starts cost one WMI query.
    let reads = crate::history::LiveReads::default();
    let changed = |rec_id: &str| target_verification(Some(crate::history::probe_rec_target_with(rec_id, &reads)));
    let outcomes = reconcile_interrupted_starts_in(store, ledger, changed, Utc::now());
    if !outcomes.is_empty() {
        save_store(store)?;
    }
    Ok(outcomes)
}

/// Launch-time reconcile of starts that never finished (#583: no hidden state). Runs once from
/// `.setup` before the first window can read the store. `start_experiment` repeats it under the same
/// lock, so a launch whose save failed can't leave a stale `Pending` blocking every later start.
pub(crate) fn reconcile_interrupted_starts() -> Result<Vec<InterruptedStart>, String> {
    let _g = lock_store()?;
    let mut store = load_store_checked()?;
    reconcile_pending_locked(&mut store)
}

/// True iff a `rollback_change` failure means the change is ALREADY off — i.e. it was rolled back
/// outside Compy (e.g. the user reverted it from the Fix surface) before our automatic restore ran.
/// In that case the restore's goal (the change reverted) is already met, so we must NOT claim the
/// change is "still applied" — that would be a fabricated state. Matches the exact benign error
/// `history::rollback_change` returns for an already-rolled-back entry; ANY other error means Compy
/// could not confirm the change is off and we say exactly that, never more. Guard-tested below.
fn restore_already_reverted(err: &str) -> bool {
    err == "change has already been rolled back"
}

/// §4F step 5–8 — record the treatment session, judge it against the noise floor, and KEEP or
/// auto-RESTORE. Refuses while dark. On restore, the change is rolled back through the audited
/// `rollback_change` boundary; a failed restore is surfaced loudly (status Aborted), never hidden.
/// The treatment is named by its session id and read from Compy's own session store, like the
/// baseline (#583 lane 2b). A session that can't be the after-reading is refused before anything is
/// judged or changed, and the Trial stays Running, except after a reported crash, which always
/// restores. A pair whose recorded conditions changed aborts and restores (see `with_comparability`).
#[tauri::command]
pub(crate) fn conclude_experiment(
    experiment_id: String,
    treatment_session_id: String,
    crashed: bool,
) -> Result<ExperimentRecord, String> {
    if !experiment_gate() {
        return Err("The experiment engine isn't part of this build yet.".into());
    }
    let _g = lock_store()?;
    let mut store = load_store_checked()?;
    let idx = store
        .experiments
        .iter()
        .position(|e| e.id == experiment_id)
        .ok_or_else(|| format!("experiment '{experiment_id}' not found"))?;
    if store.experiments[idx].status != ExperimentStatus::Running {
        return Err("experiment is not running — nothing to conclude".into());
    }
    // P5-realplay: a real-play Trial is judged on several sessions a side (`conclude_realplay`), never
    // on one after-session; nothing is judged or changed here.
    if store.experiments[idx].mode == TrialMode::RealPlay {
        return Err("experiment not concluded — this test runs over several sessions of real play, so Compy \
                    judges it once enough of them count; to stop it now, put the change back"
            .into());
    }

    // §4.6: the treatment session and its comparability to the baseline, before anything is judged,
    // recorded or restored. A refusal leaves the Trial Running with the change applied; a reported
    // crash is never refused (`crash_overrides_refusal`).
    let sessions = crate::sessions::get_session_summaries();
    let resolved = crash_overrides_refusal(
        resolve_treatment(&store.experiments[idx], &sessions, &treatment_session_id),
        crashed,
    )
    .map_err(|why| format!("experiment not concluded — {why}"))?;

    let now = Utc::now();
    // #618: bounded by the record's own baseline, the same edge start checked: a ledger set aside
    // after it began (during the Trial, say) loses rows this conclude would need. The attribution
    // flag is start's: its warning is stored on the record.
    let (history, coverage) = ledger_view_for_one_change_checks(
        crate::history::load_history,
        crate::history::ledger_set_aside_through,
        store.experiments[idx].baseline_session_id.as_deref(),
    );
    let rows = history.as_deref().ok().map(ledger_rows);
    // `.ok()` is the honest direction here, not a collapse: an unreadable ledger becomes `None`,
    // which the confound guard REFUSES to attribute. It is never silently treated as a count.
    let ledger_now = history.as_ref().ok().map(Vec::len);
    // §7: the change must still read as applied for the treatment session to be evidence about it.
    // Read before the keep/restore decision so a reverted or unreadable setting can overrule a keep.
    let target_now = crate::history::probe_rec_target(&store.experiments[idx].rec_id);
    let rec = &store.experiments[idx];
    let baseline = found(&sessions, rec.baseline_session_id.as_deref());
    let treatment = found(&sessions, Some(&treatment_session_id));
    // P4-sessions: the after-session graded on its own halves, kept on the receipt as evidence.
    let (after_check, after_halves) = resolved
        .as_ref()
        .map_or((None, None), |(treatment, _)| session_check(grade_baseline(treatment, halves_floor_pct(rec))));
    // P4-smooth-offer: the after-session's frame pacing, judged only for Smoothest and kept on its record.
    let after_ratio = resolved
        .as_ref()
        .and_then(|(treatment, _)| treatment.frame_pacing.as_ref().and_then(|p| p.p99_over_p50()));
    // P4-judge-noisy: the measured noise this Trial is judged against (the start's, or measured now for
    // a record started before it, over the sessions the ledger covers, #618), never the fixed default;
    // unmeasured judges nothing.
    let covered_now = sessions_the_ledger_covers(&sessions, coverage);
    let noise = noise_for_conclude(rec, &covered_now, baseline, rows.as_deref());
    let (judged, crash_pairing) = match &resolved {
        Some((treatment, pairing)) => {
            // P4-judge-noisy: an uneven session is no longer a reason to judge nothing. Both sessions'
            // whole numbers are compared against a band measured on whole as-is sessions of this game,
            // which already holds swings like these; the halves stay on the receipt as evidence
            // (`baseline_halves` / `after_check`). Only sessions Compy must reject (too short, another
            // game, changed conditions or cap, unmeasured noise) go unjudged.
            // The 1% low is classified on the measured band itself, also for a record started before it
            // (whose stored `noise_floor_pct` was the fixed default), so no win is called inside it.
            let judged_rec = match &noise {
                Ok(n) => ExperimentRecord { noise_floor_pct: n.low1_band_pct, ..rec.clone() },
                Err(_) => rec.clone(),
            };
            let measured = with_comparability(
                with_left_out_readings(
                    conclude_outcome(
                        &judged_rec,
                        treatment.low1_fps_est,
                        treatment.samples,
                        crashed,
                        Some(&treatment.process_name),
                        ledger_now,
                        now,
                    ),
                    treatment,
                ),
                pairing,
            );
            // TG-preflight: a power plan that differed between the sessions, or changed during one,
            // confounds exactly as a changed recorded condition does (played anyway after the warning).
            let measured = with_power_plan_check(measured, baseline, treatment, &rec.rec_id);
            // The baseline's cap state as the start read it (its trace may be shed by now), else read now.
            let baseline_cap = match &noise {
                Ok(n) => n.cap,
                Err(_) => baseline.map_or(crate::noise_floor::CapRead::Unknown, crate::noise_floor::cap_read),
            };
            let after_cap = crate::noise_floor::cap_read(treatment);
            let paired = with_cap_check(measured, baseline_cap, after_cap);
            let paired = with_gaming_mode_baseline_check(paired, baseline, &rec.rec_id);
            let picked = match &noise {
                Err(why) => unmeasured_noise_outcome(paired, why, &rec.game),
                Ok(n) => {
                    // s27: two sessions further apart than the band was measured at can't be judged on it.
                    let paired =
                        with_gap_check(paired, n, rec.baseline_session_id.as_deref(), Some(treatment.started_at.as_str()));
                    // Sonnet r1 NIT: the 1% low's band as the picked goal judges it (Maximum FPS: the wider).
                    let low_band =
                        if rec.outcome == TrialOutcome::MaxFps { n.low1_band_pct.max(n.avg_band_pct) } else { n.low1_band_pct };
                    let paired = with_measured_fall(paired, low_band);
                    // P4-recommended: a verdict still judged on the band is read as the Recommended
                    // outcome, the average beside the 1% low, each on its measured band.
                    // P4-maxfps-smooth: or as the outcome the user picked at start (Maximum FPS on the
                    // wider of the two bands, so neither number is judged on less than its own).
                    let avg = delta_avg_pct(rec.baseline_avg_fps, treatment.avg_fps);
                    let picked = match rec.outcome {
                        TrialOutcome::Recommended => with_recommended_outcome_bands(paired, n.low1_band_pct, n.avg_band_pct, avg),
                        TrialOutcome::MaxFps => with_max_fps_outcome(paired, n.low1_band_pct.max(n.avg_band_pct), avg),
                        TrialOutcome::Smoothest => {
                            with_smoothest_outcome(paired, rec.smoothest.as_ref(), after_ratio, n.low1_band_pct)
                        }
                    };
                    let lows = (rec.baseline_low1_fps, treatment.low1_fps_est);
                    let deltas = NoiseDeltas { avg, pacing: pacing_change(rec.smoothest.as_ref(), after_ratio) };
                    let capped = with_cap_saturation(picked, after_cap, rec.outcome, lows, n.low1_band_pct);
                    with_noise_words(capped, n, &rec.game, rec.outcome, deltas)
                }
            };
            (picked, None)
        }
        None => crash_outcome(rec.applied_at.as_deref(), baseline, treatment),
    };
    let judged = with_compy_state(judged, other_compy_change(rec, baseline, treatment, rows.as_deref()));
    // §3: other settings Compy changed that aren't confirmed in place limit what this result can claim.
    let unverified = match (history.as_deref(), rows.as_deref()) {
        (Ok(changes), Some(rows)) => {
            unverified_others_live(changes, rows, &rec.rec_id, &crate::history::LiveReads::default())
        }
        _ => 0,
    };
    let judged = with_unverified_changes(judged, unverified);
    let outcome = guard_target_at_conclude(judged, target_verification(Some(target_now)));
    let rec_baseline_avg = store.experiments[idx].baseline_avg_fps;

    store.experiments[idx].treatment = resolved.as_ref().map(|(treatment, _)| TreatmentRecord {
        avg_fps: treatment.avg_fps,
        low1_fps: treatment.low1_fps_est,
        samples: treatment.samples,
        crashed,
        delta_low1_pct: outcome.delta_low1_pct,
        recorded_at: now.to_rfc3339(),
        session_id: Some(treatment.started_at.clone()),
        check: after_check,
        halves: after_halves.clone(),
        delta_avg_pct: delta_avg_pct(rec_baseline_avg, treatment.avg_fps),
    });
    if let Some(ev) = store.experiments[idx].smoothest.as_mut() {
        ev.after_ratio = after_ratio;
    }
    store.experiments[idx].session_pairing = resolved
        .as_ref()
        .map(|(_, pairing)| pairing)
        .or(crash_pairing.as_ref())
        .map(|pairing| SessionPairing::of(pairing, baseline, treatment));
    // §11: the band this verdict was judged against, when it was.
    // P4-judge-noisy: the band is the measured 1% low band; the measurement itself is kept on the
    // record (`game_noise`), also for a record started before it and measured here.
    let measured_noise = noise.ok();
    let band_pct = measured_noise.as_ref().map_or(store.experiments[idx].noise_floor_pct, |n| n.low1_band_pct);
    // Opus r2: a band stored by an older model was read on this build's base (`on_baseline_base`);
    // the record keeps the band the verdict was judged on, so the receipt shows the same band.
    keep_judged_noise(&mut store.experiments[idx].game_noise, measured_noise);
    let between = store.experiments[idx].between_session_noise.clone();
    let game_noise = treatment.map_or(crate::noise_floor::NoiseLookup::Unmeasured, crate::noise_floor::lookup_for_session);
    store.experiments[idx].noise_evidence = noise_evidence_for(&outcome, band_pct, &game_noise, between.as_ref());
    store.experiments[idx].verdict = Some(outcome.verdict.clone());
    store.experiments[idx].trial_result = Some(trial_result_for(&outcome.verdict));
    store.experiments[idx].verdict_confidence = Some(outcome.confidence);
    store.experiments[idx].verdict_note = Some(outcome.note.clone());
    store.experiments[idx].concluded_at = Some(now.to_rfc3339());

    finish_conclude(&mut store, idx, outcome, target_now)
}

/// The keep-or-restore tail both concludes share (`conclude_experiment`, `conclude_realplay`), run
/// under their store gate once the outcome is judged and the target check has had the last word
/// (`guard_target_at_conclude`). A keep changes nothing, so `target_now`, the read the conclude took
/// before deciding, is the final state. A restore goes through the audited `rollback_change`, which
/// resolves from history.json alone, and the setting is read back after it (§4.10). A restore that
/// doesn't complete is saved loudly as Aborted, never hidden.
fn finish_conclude(
    store: &mut ExperimentStore,
    idx: usize,
    outcome: ConcludeOutcome,
    target_now: crate::history::ActiveCheck,
) -> Result<ExperimentRecord, String> {
    if outcome.keep {
        store.experiments[idx].status = ExperimentStatus::Kept;
        store.experiments[idx].kept = true;
        store.experiments[idx].stop_reason = outcome.stop_reason;
        // §4.10: keeping changes nothing, so the read just taken IS the final state (a keep needs it
        // to read as changed — see `guard_target_at_conclude`).
        let prior = store.experiments[idx].prior_state_verified;
        store.experiments[idx].final_state_verified = final_state_check(true, prior, target_now);
    } else {
        // Restore through the audited boundary (resolves from history.json alone).
        let change_id = store.experiments[idx].applied_change_id.clone();
        let compy_restored = match crate::history::rollback_change(change_id) {
            Ok(()) => {
                store.experiments[idx].status = ExperimentStatus::Restored;
                store.experiments[idx].kept = false;
                store.experiments[idx].stop_reason = outcome.stop_reason;
                true
            }
            Err(e) if restore_already_reverted(&e) => {
                // The change was already reverted outside Compy before our restore ran — the desired
                // end state (change off) is already true. Honest: Restored, NOT a false "still applied".
                store.experiments[idx].status = ExperimentStatus::Restored;
                store.experiments[idx].kept = false;
                store.experiments[idx].stop_reason =
                    Some("the change was already reverted outside Compy before the automatic restore".into());
                false
            }
            Err(e) => {
                // NEVER hide a partial: Compy could not confirm the change was rolled back. We do NOT
                // fabricate certainty about its state — we tell the user to verify + roll back from Fix.
                store.experiments[idx].status = ExperimentStatus::Aborted;
                store.experiments[idx].kept = false;
                store.experiments[idx].stop_reason =
                    Some(format!("automatic restore did not complete — check it in Test → Applied & history: {e}"));
                save_store(store)?;
                return Err(format!(
                    "experiment concluded '{}' but the automatic restore did not complete — Compy \
                     could not confirm the change was rolled back; check it in Test → Applied & \
                     history and undo it there. ({e})",
                    outcome.verdict
                ));
            }
        };
        // §4.10: read the setting back after the restore.
        let rec_id = store.experiments[idx].rec_id.clone();
        let check = crate::history::probe_rec_target(&rec_id);
        if let Some(still) = settle_restore(&mut store.experiments[idx], compy_restored, check) {
            save_store(store)?;
            return Err(format!("experiment concluded '{}' — {still}", outcome.verdict));
        }
    }
    save_store(store)?;
    Ok(store.experiments[idx].clone())
}

/// User-initiated restore of a Running experiment (§4F "restore automatically … / stop on X"). Refuses
/// while dark. Rolls back through the audited boundary; a failed restore is surfaced loudly.
#[tauri::command]
pub(crate) fn restore_experiment(experiment_id: String) -> Result<ExperimentRecord, String> {
    if !experiment_gate() {
        return Err("The experiment engine isn't part of this build yet.".into());
    }
    let _g = lock_store()?;
    let mut store = load_store_checked()?;
    let idx = store
        .experiments
        .iter()
        .position(|e| e.id == experiment_id)
        .ok_or_else(|| format!("experiment '{experiment_id}' not found"))?;
    if store.experiments[idx].status != ExperimentStatus::Running {
        return Err("experiment is not running — nothing to restore".into());
    }
    let change_id = store.experiments[idx].applied_change_id.clone();
    let now = Utc::now();
    let compy_restored = match crate::history::rollback_change(change_id) {
        // Rolled back now, or already off outside Compy — either way the change is reverted (honest).
        Ok(()) => true,
        Err(e) if restore_already_reverted(&e) => false,
        Err(e) => {
            // Compy could not confirm the change is off — persist the halt loudly (don't leave it
            // showing "running" forever) and do NOT fabricate certainty about the change's state.
            store.experiments[idx].status = ExperimentStatus::Aborted;
            store.experiments[idx].kept = false;
            store.experiments[idx].stop_reason =
                Some(format!("restore did not complete — check it in Test → Applied & history: {e}"));
            store.experiments[idx].concluded_at = Some(now.to_rfc3339());
            save_store(&store)?;
            return Err(format!(
                "restore did not complete — Compy could not confirm the change was rolled back; \
                 check it in Test → Applied & history and undo it there. ({e})"
            ));
        }
    };
    store.experiments[idx].status = ExperimentStatus::Restored;
    store.experiments[idx].kept = false;
    store.experiments[idx].stop_reason = Some("user-restored".into());
    store.experiments[idx].concluded_at = Some(now.to_rfc3339());
    // §4.10: read the setting back after the restore.
    let rec_id = store.experiments[idx].rec_id.clone();
    let check = crate::history::probe_rec_target(&rec_id);
    if let Some(still) = settle_restore(&mut store.experiments[idx], compy_restored, check) {
        save_store(&store)?;
        return Err(still);
    }
    save_store(&store)?;
    Ok(store.experiments[idx].clone())
}

// ─── P5-realplay: a change left on while you play, judged on several sessions a side ──────

/// A running real-play Trial's record as the session classifier reads it, or why it can't be judged
/// as one, in words (such a record can only be put back).
fn real_play_trial(rec: &ExperimentRecord) -> Result<crate::realplay::Running<'_>, String> {
    if rec.mode != TrialMode::RealPlay {
        return Err("this Trial compares two sessions, so it isn't judged on real play".into());
    }
    let Some(evidence) = rec.real_play.as_ref() else {
        return Err("this test's record of its as-is sessions can't be read, so it can't be judged — put the \
                    change back"
            .into());
    };
    let Some(applied_at) = rec.applied_at.as_deref() else {
        return Err("this test didn't record when its change took effect, so no session can be shown to have \
                    been played after it — put the change back"
            .into());
    };
    Ok(crate::realplay::Running {
        game: &rec.game,
        created_at: &rec.created_at,
        applied_at,
        applied_change_id: &rec.applied_change_id,
        before: &evidence.before,
        cap: rec.game_noise.as_ref().map(|n| n.cap),
    })
}

/// A running real-play Trial read against the session store and the change history now.
pub(crate) struct RealPlayRead<'s> {
    pub arm: crate::realplay::WithArm<'s>,
    pub judgement: crate::realplay::Judgement,
}

/// Pure (P5-realplay): `rec` read as a running real-play Trial: which with-change sessions count
/// (`realplay::with_arm`) and where the looks stand (`realplay::judge`, the final look due once the
/// Trial is stopped). `live` is the setting read now, as [`target_verification`] answers it.
pub(crate) fn real_play_read<'s>(
    rec: &ExperimentRecord,
    sessions: &'s [SessionSummary],
    ledger: &[LedgerEntryRef<'_>],
    live: Option<bool>,
    now: DateTime<Utc>,
) -> Result<RealPlayRead<'s>, String> {
    let trial = real_play_trial(rec)?;
    let arm = crate::realplay::with_arm(&trial, sessions, ledger, live, now);
    let judgement = crate::realplay::judge(trial.before, &arm.counted_numbers(), rec.outcome, arm.stop.is_some());
    Ok(RealPlayRead { arm, judgement })
}

/// Pure (P5-realplay): what concluding `read` records before the conclude's own checks
/// (`with_unverified_changes`, then `guard_target_at_conclude`), or `None` while Compy is still
/// collecting. A decided look is its verdict, never above Medium, and never kept once the Trial's own
/// change was put back in Test → Applied & history ([`put_back_before_conclude`]), nor once another
/// Compy change moved or a permanent condition changed (`confounded`, restored; CR-1102-left owner
/// call a, [`confounded_by_conditions`]). A Trial stopped with
/// fewer than `realplay::MIN_SESSIONS` counted ends unjudged: `confounded` through [`with_compy_state`]
/// when another Compy change moved, or [`with_comparability`] when a driver, Windows or game build
/// changed (a change that reads off turns `confounded` at the target check); `insufficient-evidence`
/// when the window ran out, the setting couldn't be read or the as-is sessions are gone.
pub(crate) fn real_play_outcome(read: &RealPlayRead<'_>) -> Option<ConcludeOutcome> {
    use crate::realplay::{Judgement, RealPlayStop as Stop, MIN_SESSIONS, WINDOW_DAYS};
    if let Judgement::Decided { outcome, look } = &read.judgement {
        let decided = ConcludeOutcome { confidence: outcome.confidence.min(Confidence::Medium), ..outcome.clone() };
        return Some(match read.arm.stop {
            Some(Stop::PutBackInHistory) => put_back_before_conclude(decided, look),
            // CR-1102-left owner call (a), delegated 2026-11-10: a look that decided before another
            // Compy change moved, or before a permanent condition changed, is not kept. It is
            // folded exactly as a two-session Trial's confound is: `confounded`, keep false, so the
            // shared restore in `finish_conclude` puts the change back.
            // Review r1 (sonnet) SHOULD-FIX: `keep` is forced off after the fold too, so an early
            // return inside it can never leave this stop keeping.
            Some(Stop::OtherChange) => ConcludeOutcome {
                keep: false,
                ..with_compy_state(decided, Some("another Compy change was applied or undone during the test".into()))
            },
            Some(Stop::Conditions) => confounded_by_conditions(decided, read.arm.changed.as_ref().map(|(_, p)| p)),
            _ => decided,
        });
    }
    let stop = read.arm.stop?;
    let (stop_reason, why) = match stop {
        Stop::ChangeOff => ("real-play-change-off", "the setting no longer reads as changed".to_string()),
        Stop::PutBackInHistory => ("real-play-put-back-in-history", "it was put back in Test → Applied & history".into()),
        Stop::Unreadable => ("target-unreadable-at-conclude", "Compy can't read the setting to confirm it stayed on".into()),
        Stop::OtherChange => ("other-compy-change-during-trial", "another Compy change was applied or undone".into()),
        Stop::Conditions => ("conditions-changed-between-sessions", "the PC's conditions changed".into()),
        Stop::WindowOver => ("real-play-window-over", format!("the {WINDOW_DAYS} days ran out")),
        Stop::BeforeMissing => (
            "real-play-before-missing",
            "the as-is sessions it compares against are no longer in Compy's session history".into(),
        ),
    };
    let counted = read.arm.counted.len();
    let base = ConcludeOutcome {
        verdict: "insufficient-evidence".into(),
        keep: false,
        // Never persisted: with fewer than three sessions counted no delta is recorded.
        delta_low1_pct: 0.0,
        stop_reason: Some(stop_reason.into()),
        confidence: Confidence::Unknown,
        note: format!(
            "Only {counted} of the {MIN_SESSIONS} sessions Compy needs were counted with the change on ({why}), so \
             Compy restored the change and judged nothing."
        ),
    };
    Some(match stop {
        Stop::OtherChange => with_compy_state(base, Some("another Compy change was applied or undone during the test".into())),
        Stop::Conditions => match &read.arm.changed {
            Some((_, pairing)) => with_comparability(base, pairing),
            None => base,
        },
        _ => base,
    })
}

/// CR-1102-left owner call (a): a decided look on a Trial stopped because a permanent condition
/// changed is confounded in the shape of the two-session fold ([`with_comparability`]): verdict
/// `confounded`, keep false, the same stop reason, Low confidence, so the shared restore runs and a
/// `Conditions` stop never keeps. Its own note (review r1/r2, opus): it names what changed when the
/// stop carries it, and doesn't claim the counted sessions differed (they matched the reference).
fn confounded_by_conditions(decided: ConcludeOutcome, pairing: Option<&SessionComparability>) -> ConcludeOutcome {
    let what = pairing
        .map(|p| p.changed_context.join("; "))
        .filter(|w| !w.is_empty())
        .map(|w| format!(" ({w})"))
        .unwrap_or_default();
    ConcludeOutcome {
        verdict: "confounded".into(),
        keep: false,
        stop_reason: Some("conditions-changed-between-sessions".into()),
        confidence: Confidence::Low,
        note: format!(
            "The PC's conditions changed during the test{what}, so the result can't be pinned on this setting. \
             Compy restored it; start a new test to measure it under the new conditions."
        ),
        ..decided
    }
}

/// A decided look whose own change was put back in Test → Applied & history before the conclude
/// (rollback integrity, review of 59fc753). The Trial's ledger row is already rolled back, so it owns
/// nothing to keep, whatever the look measured and whatever the setting reads now (it can read on
/// again under another row, re-applied after the undo). Keep is false, so the shared restore runs and
/// meets the ledger's "already rolled back": Restored, or the loud Aborted state when the setting
/// still reads as changed afterwards (`settle_restore`). The measurement stays in the note, which
/// never says the change was kept.
fn put_back_before_conclude(decided: ConcludeOutcome, look: &crate::realplay::Look) -> ConcludeOutcome {
    ConcludeOutcome {
        keep: false,
        stop_reason: Some("real-play-put-back-in-history".into()),
        note: format!(
            "Real play: {} sessions with the change on, against {} sessions as the PC was before it: the 1% low {}, \
             the average frame rate {}, against a ±{}% band. The change was put back in Test → Applied & history \
             before Compy concluded the test, so Compy kept nothing.",
            look.with,
            look.before,
            signed_pct(look.delta_low1_pct),
            signed_pct(look.delta_avg_pct),
            band_pct_text(look.band_pct)
        ),
        ..decided
    }
}

/// Pure (P5-realplay): what a crash reported during a real-play Trial records before the conclude's
/// own checks. It always restores, and is pinned on the change only through [`crash_outcome`], on the
/// newest session of the game after the change took effect against the newest as-is session still
/// stored. As in the two-session conclude, another Compy change applied or undone during the test, or
/// a crash session that didn't run with exactly the as-is sessions' changes plus this one, confounds
/// it ahead of the crash ([`with_compy_state`] on [`other_compy_change`]): then nothing is pinned on
/// this setting. Returns the pairing it judged by, for the receipt.
pub(crate) fn real_play_crash(
    rec: &ExperimentRecord,
    sessions: &[SessionSummary],
    ledger: Option<&[LedgerEntryRef<'_>]>,
) -> Result<(ConcludeOutcome, Option<SessionPairing>), String> {
    let trial = real_play_trial(rec)?;
    let reference = crate::realplay::reference_session(trial.before, sessions);
    let newest = crate::realplay::newest_after(trial.game, trial.applied_at, sessions);
    let (crash, pairing) = crash_outcome(Some(trial.applied_at), reference, newest);
    let judged = with_compy_state(crash, other_compy_change(rec, reference, newest, ledger));
    Ok((judged, pairing.map(|p| SessionPairing::of(&p, reference, newest))))
}

/// Pure (P5-realplay): what a real-play conclude keeps on `rec` for the receipt once `outcome` is
/// final: the with-change sessions judged (the deciding look's prefix, or every one counted), the
/// sessions not counted and why, the deciding look's numbers, the pairing, and the pair fields an
/// older Compy reads (`treatment`, as the judged sessions' means). After a reported crash no look's
/// numbers are written, decided or not: the crash is the verdict, and a measured "+12%" beside
/// "Likely worse" would read as a result it isn't (review of 59fc753).
pub(crate) fn record_real_play(
    rec: &mut ExperimentRecord,
    read: Option<&RealPlayRead<'_>>,
    outcome: &ConcludeOutcome,
    crashed: bool,
    crash_pairing: Option<SessionPairing>,
    now: DateTime<Utc>,
) {
    let decided = read.filter(|_| !crashed).and_then(|r| match &r.judgement {
        crate::realplay::Judgement::Decided { look, .. } => Some(look.clone()),
        _ => None,
    });
    let judged_on: Vec<&SessionSummary> = match (read, &decided) {
        (Some(r), Some(look)) => r.arm.counted.iter().copied().take(look.with).collect(),
        (Some(r), None) => r.arm.counted.clone(),
        (None, _) => Vec::new(),
    };
    let newest_judged = decided.as_ref().and_then(|_| judged_on.last().copied());
    let reference = read.and_then(|r| r.arm.reference);
    let pairing = match (crash_pairing, newest_judged, read.and_then(|r| r.arm.changed.as_ref())) {
        (Some(p), _, _) => Some(p),
        (None, Some(newest), _) => reference.map(|r| SessionPairing::of(&crate::comparability::derive(r, newest), Some(r), Some(newest))),
        (None, None, Some((changed, p))) => Some(SessionPairing::of(p, reference, Some(changed))),
        (None, None, None) => None,
    };
    let numbers: Vec<crate::realplay::RealPlaySession> = judged_on.iter().map(|s| crate::realplay::RealPlaySession::of(s)).collect();
    let means = crate::realplay::geometric_means(&numbers);
    let game_noise = newest_judged.map_or(crate::noise_floor::NoiseLookup::Unmeasured, crate::noise_floor::lookup_for_session);
    if let Some(ev) = rec.real_play.as_mut() {
        ev.not_counted = read.map(|r| crate::realplay::newest_not_counted(&r.arm.not_counted)).unwrap_or_default();
        ev.stop = read.and_then(|r| r.arm.stop);
        if let Some(look) = &decided {
            ev.low1_spread_pct = Some(look.low1_spread_pct);
            ev.avg_spread_pct = Some(look.avg_spread_pct);
            ev.band_pct = Some(look.band_pct);
            ev.delta_low1_pct = Some(look.delta_low1_pct);
            ev.delta_avg_pct = Some(look.delta_avg_pct);
            ev.look = Some(look.ordinal);
        }
        ev.with = numbers;
    }
    // The pair fields an older Compy reads: the with-change sessions' means, total readings and deltas.
    rec.treatment = match (&decided, means, newest_judged) {
        (Some(look), Some((low1, avg)), Some(newest)) => Some(TreatmentRecord {
            avg_fps: avg,
            low1_fps: low1,
            samples: judged_on.iter().fold(0u32, |n, s| n.saturating_add(s.samples)),
            crashed,
            delta_low1_pct: look.delta_low1_pct,
            recorded_at: now.to_rfc3339(),
            session_id: Some(newest.started_at.clone()),
            check: None,
            halves: None,
            delta_avg_pct: Some(look.delta_avg_pct),
        }),
        _ => None,
    };
    rec.session_pairing = pairing;
    let band_pct = decided.as_ref().map_or(rec.noise_floor_pct, |look| look.band_pct);
    rec.noise_evidence = noise_evidence_for(outcome, band_pct, &game_noise, None);
    rec.verdict = Some(outcome.verdict.clone());
    rec.trial_result = Some(trial_result_for(&outcome.verdict));
    rec.verdict_confidence = Some(outcome.confidence);
    rec.verdict_note = Some(outcome.note.clone());
    rec.concluded_at = Some(now.to_rfc3339());
}

/// P5-realplay: where a game's real play stands, for the journey's panel. Before a start, how many
/// as-is sessions a real-play start would pin now and which one it names; while a real-play Trial of
/// the game runs, which sessions count, the next look, and why it can't go on when it can't.
/// Read-only and takes no lock, like `get_experiments`: it reads the experiment and session stores
/// and the change history, and reads the setting once (`probe_rec_target`), only while such a Trial
/// runs. Before a start it checks only that no Compy change moved since the newest as-is session
/// began; the start checks the active-change counts live again. A change history that can't back
/// the count is refused in words, never read as nothing counted.
///
/// Off the main thread (review of 59fc753): a plain command runs on the main thread, and each read
/// loads three stores and may run the setting's probe (`powercfg`, `sc`), so the window would stall
/// while it ran. It runs on the blocking pool instead, as `latency_measure_*` do; the invoke is the
/// same (`{ game }` in, the progress or an error out).
#[tauri::command]
pub(crate) async fn get_realplay_progress(game: String) -> Result<crate::realplay::RealPlayProgress, String> {
    tauri::async_runtime::spawn_blocking(move || read_realplay_progress(&game))
        .await
        .map_err(|e| format!("Compy couldn't read where real play stands ({e})"))?
}

/// The work [`get_realplay_progress`] runs on the blocking pool.
fn read_realplay_progress(game: &str) -> Result<crate::realplay::RealPlayProgress, String> {
    if !experiment_gate() {
        return Err("The experiment engine isn't part of this build yet.".into());
    }
    let game: String = game.chars().take(MAX_TEXT_LEN).collect();
    let sessions = crate::sessions::get_session_summaries();
    let now = Utc::now();
    let store = load_store();
    let running = store.experiments.iter().find(|e| {
        e.status == ExperimentStatus::Running
            && e.mode == TrialMode::RealPlay
            && game_match(&e.game, Some(game.as_str())) == GameMatch::Match
    });
    if let Some(rec) = running {
        let (history, _coverage) = ledger_view_for_one_change_checks(
            crate::history::load_history,
            crate::history::ledger_set_aside_through,
            rec.baseline_session_id.as_deref(),
        );
        let history = history?;
        let rows = ledger_rows(&history);
        let live = target_verification(Some(crate::history::probe_rec_target(&rec.rec_id)));
        let read = real_play_read(rec, &sessions, &rows, live, now)?;
        let trial = real_play_trial(rec)?;
        return Ok(crate::realplay::progress(&rec.id, &trial, &read.arm, &read.judgement));
    }
    let Some(anchor) = crate::realplay::newest_countable(&game, &sessions) else {
        return Ok(crate::realplay::before_start_progress(&game, &[]));
    };
    let (history, coverage) = ledger_view_for_one_change_checks(
        crate::history::load_history,
        crate::history::ledger_set_aside_through,
        Some(anchor.started_at.as_str()),
    );
    let history = history?;
    let rows = ledger_rows(&history);
    // §3: the as-is run describes this PC now only if no Compy change moved since its newest session began.
    let before = if compy_change_moved_after(&rows, &anchor.started_at, None) {
        Vec::new()
    } else {
        crate::realplay::before_arm(&sessions_the_ledger_covers(&sessions, coverage), anchor, &rows, now)
    };
    Ok(crate::realplay::before_start_progress(&game, &before))
}

/// P5-realplay: judge a running real-play Trial, then keep or restore its change through the shared
/// [`finish_conclude`]. Takes the Trial's id and whether the player reported a crash, never a number:
/// every session is read from Compy's own session store. Holds the store gate across the read, the
/// judgement and the keep/restore, as `conclude_experiment` does (the declared Experiment -> History
/// nesting). While Compy is still collecting (no look has decided and nothing stopped the test) it is
/// refused, with nothing judged or changed, unless a crash was reported: a crash always restores, and
/// is pinned on the change only as [`real_play_crash`] allows. Otherwise [`real_play_outcome`] is the
/// result, other settings Compy can't confirm leave it unjudged ([`with_unverified_changes`]), and a
/// setting that reads off or can't be read is never kept ([`guard_target_at_conclude`]). Real play
/// never records High confidence. What was measured goes on the record through [`record_real_play`].
#[tauri::command]
pub(crate) fn conclude_realplay(experiment_id: String, crashed: bool) -> Result<ExperimentRecord, String> {
    if !experiment_gate() {
        return Err("The experiment engine isn't part of this build yet.".into());
    }
    let _g = lock_store()?;
    let mut store = load_store_checked()?;
    let idx = store
        .experiments
        .iter()
        .position(|e| e.id == experiment_id)
        .ok_or_else(|| format!("experiment '{experiment_id}' not found"))?;
    if store.experiments[idx].status != ExperimentStatus::Running {
        return Err("experiment is not running — nothing to conclude".into());
    }
    let sessions = crate::sessions::get_session_summaries();
    let now = Utc::now();
    // #618: bounded by the Trial's own newest as-is session, as for a two-session conclude.
    let (history, _coverage) = ledger_view_for_one_change_checks(
        crate::history::load_history,
        crate::history::ledger_set_aside_through,
        store.experiments[idx].baseline_session_id.as_deref(),
    );
    let rows = history.as_deref().ok().map(ledger_rows);
    // §7: read before the keep/restore decision so a reverted or unreadable setting overrules a keep.
    // It is also the newest session's check that the change stayed on.
    let target_now = crate::history::probe_rec_target(&store.experiments[idx].rec_id);
    let live = target_verification(Some(target_now));
    let rec = &store.experiments[idx];
    real_play_trial(rec).map_err(|why| format!("experiment not concluded — {why}"))?;
    let read = match rows.as_deref() {
        Some(rows) => Some(real_play_read(rec, &sessions, rows, live, now).map_err(|why| format!("experiment not concluded — {why}"))?),
        None => None,
    };
    let (judged, crash_pairing) = if crashed {
        real_play_crash(rec, &sessions, rows.as_deref()).map_err(|why| format!("experiment not concluded — {why}"))?
    } else {
        let Some(read) = read.as_ref() else {
            let why = history.as_ref().err().cloned().unwrap_or_else(|| "Compy can't read its change history".into());
            return Err(format!(
                "experiment not concluded — {why}, so Compy can't tell which sessions count; try again, or put the \
                 change back"
            ));
        };
        let Some(outcome) = real_play_outcome(read) else {
            return Err(format!(
                "experiment not concluded — Compy is still collecting: {} sessions with the change on count so far, \
                 and nothing has stopped the test",
                read.arm.counted.len()
            ));
        };
        // P4-judge-noisy (review r1): under a frame cap all the counted sessions shared (they were
        // pooled within one cap state), "no change" can't be told from the ceiling, and Maximum FPS
        // isn't judged at all, exactly as for a two-session Trial.
        // CR-trial-gm-baseline-overlap (opus r1 MUST-FIX): a real-play Trial started before the start
        // refused it, on as-is sessions played with Gaming Mode on, isn't judged on them either (its
        // with-change sessions match that state, so both ran the setting the same way).
        let outcome = with_gaming_mode_baseline_check(outcome, read.arm.reference, &rec.rec_id);
        let cap = rec.game_noise.as_ref().map_or(crate::noise_floor::CapRead::Unknown, |n| n.cap);
        let lows: Vec<f64> = read.arm.counted.iter().map(|s| s.low1_fps_est).filter(|x| x.is_finite() && *x > 0.0).collect();
        let with_low = if lows.is_empty() { f64::NAN } else { lows.iter().sum::<f64>() / lows.len() as f64 };
        let band = match &read.judgement {
            crate::realplay::Judgement::Decided { look, .. } => look.band_pct,
            _ => rec.game_noise.as_ref().map_or(rec.noise_floor_pct, |n| n.low1_band_pct),
        };
        (with_cap_saturation(outcome, cap, rec.outcome, (rec.baseline_low1_fps, with_low), band), None)
    };
    // §3: other settings Compy changed that aren't confirmed in place limit what this result can claim.
    let unverified = match (history.as_deref(), rows.as_deref()) {
        (Ok(changes), Some(rows)) => {
            unverified_others_live(changes, rows, &rec.rec_id, &crate::history::LiveReads::default())
        }
        _ => 0,
    };
    let judged = with_unverified_changes(judged, unverified);
    let outcome = guard_target_at_conclude(judged, live);
    let outcome = ConcludeOutcome { confidence: outcome.confidence.min(Confidence::Medium), ..outcome };

    // §11: what was measured, kept on the record for the receipt.
    record_real_play(&mut store.experiments[idx], read.as_ref(), &outcome, crashed, crash_pairing, now);

    finish_conclude(&mut store, idx, outcome, target_now)
}

/// Build the simulator's deterministic context from live read-only state. Conservative by design:
/// unknowns default to `None`/insufficient-evidence rather than an invented prior.
///
/// Wired (arming, spec §7) to the real hardware-tailored catalog via the serde JSON boundary — the
/// same read-only idiom `leftovers.rs`/`export.rs` use, since `Recommendation`'s fields are private
/// and there is no find-by-id. Honesty notes on the derivations, each grounded in an existing field,
/// none fabricated:
/// - **barred = false for any catalog member.** There is NO per-rec blocklist flag in the source;
///   LOCKED rule 6 is enforced STRUCTURALLY — a barred tweak is never emitted into the catalog and
///   the mutation primitives are allowlist-guarded (`KnownService`/`KnownBloatTask`). So a rec that
///   IS in the catalog is, by construction, not barred, and `risk-exceeds-value` is unreachable from
///   real catalog data (its branch stays as tested-pure logic). The apply boundary — not the
///   read-only simulator — is what refuses a barred/unknown id if one is ever passed.
/// - **expected_impact from `provenance`.** No per-rec `Confidence` taxonomy exists; derive it
///   mechanically from the rec's own claim-quality: `verified`/`measured-signal` ⇒ `Medium` (real
///   measured evidence it moves a metric), `expected-impact` ⇒ `Low` (logical but unmeasured), absent
///   ⇒ `Unknown`. `already-configured`/`not-applicable` short-circuit BEFORE this in `simulate`.
/// - **likely_negligible = false.** No deterministic per-rig headroom signal is wired, so we never
///   claim negligibility (the `unlikely-to-matter` branch also stays test-only). Honest: don't invent.
/// - **metric_to_watch = "1% low FPS"** for catalog members: the ONE metric the experiment engine
///   actually judges on (`conclude_outcome` measures `delta_low1_pct`). Not a guess — it is what the
///   controlled before/after measures. `None` for an unknown id (nothing to measure).
/// - **advisory_only from `history::is_appliable`** (single source of truth with `dispatch_apply`).
///   A catalog member with NO one-click apply (the SSD-upgrade / security-tradeoff advisories) can't
///   be auto-applied+measured, so it reports `not-applicable`, never `worth-testing` — the simulator
///   won't invite a Start that would dead-end at the apply boundary. `false` for the unknown-id
///   fallback so it stays `insufficient-evidence`, not a fabricated not-applicable.
fn build_sim_context(rec_id: &str) -> Result<SimContext, String> {
    // Already in the target state? — the live probe when it can read the setting (the same read a
    // start refuses on, §4.1), else the Trust Ledger, independent of catalog membership, so a
    // still-applied retired rec still reads `already-configured`.
    let already_active = already_in_target(
        crate::history::probe_rec_target(rec_id),
        crate::history::rec_is_active(rec_id),
    );

    // Read the live, hardware-tailored catalog through the serde JSON boundary (fields are private;
    // there is no find-by-id — mirrors leftovers.rs / export.rs). Filter by id.
    let catalog = serde_json::to_value(crate::recommendations::get_recommendations())
        .map_err(|e| format!("could not read the recommendation catalog: {e}"))?;
    let found = catalog
        .as_array()
        .and_then(|arr| arr.iter().find(|r| r.get("id").and_then(|v| v.as_str()) == Some(rec_id)));

    let str_field = |v: &serde_json::Value, key: &str| -> Option<String> {
        v.get(key).and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(str::to_string)
    };

    let Some(r) = found else {
        // Not in the hardware-tailored catalog: a relevance-gated-out rec or an unknown id. We have no
        // honest prior, so report `insufficient-evidence` (unknown, not zero) — never a fabricated
        // not-applicable/worth-testing. `already_active` still stands from the ledger above.
        return Ok(SimContext {
            rec_id: rec_id.to_string(),
            rec_title: rec_id.to_string(),
            applicable: true,
            advisory_only: false,
            already_active,
            barred: false,
            likely_negligible: false,
            expected_impact: None,
            metric_to_watch: None,
            hardware_factor:
                "Compy has no catalog entry for this change on this rig, so it can't estimate an effect."
                    .into(),
        });
    };

    let rec_title = str_field(r, "title").unwrap_or_else(|| rec_id.to_string());
    // `eligible` is first-class: false ⇒ this rig's HARDWARE can't use the rec (e.g. an NVIDIA rec on
    // this AMD box); the catalog keeps it with an `ineligible_reason`.
    let applicable = r.get("eligible").and_then(|v| v.as_bool()).unwrap_or(true);
    let expected_impact = match r.get("provenance").and_then(|v| v.as_str()) {
        Some("verified") | Some("measured-signal") => Some(Confidence::Medium),
        Some("expected-impact") => Some(Confidence::Low),
        _ => None,
    };
    // The honest "for YOUR hardware" line: the rec's own `applies_to` when it fits this rig, else the
    // recorded `ineligible_reason`. Real catalog strings, never fabricated.
    let hardware_factor = if applicable {
        str_field(r, "applies_to")
            .unwrap_or_else(|| "Based on this rig's detected hardware and current state.".into())
    } else {
        str_field(r, "ineligible_reason")
            .unwrap_or_else(|| "This rig's hardware doesn't match what the change targets.".into())
    };

    Ok(SimContext {
        rec_id: rec_id.to_string(),
        rec_title,
        applicable,
        // Advisory-only iff Compy has no one-click apply for it — derived from the SAME allowlist
        // `dispatch_apply` runs, so the simulator and the apply boundary can never disagree.
        advisory_only: !crate::history::is_appliable(rec_id),
        already_active,
        barred: false,
        likely_negligible: false,
        expected_impact,
        metric_to_watch: Some("1% low FPS".into()),
        hardware_factor,
    })
}

#[cfg(test)]
mod experiment_tests {
    use super::*;
    use crate::noise_floor::{NoiseLookup, StaleReason};

    fn rec(baseline_low1: f64, watermark: usize) -> ExperimentRecord {
        ExperimentRecord {
            id: "exp:1-0".into(),
            rec_id: "test-rec".into(),
            rec_title: "Test rec".into(),
            game: "Test".into(),
            hypothesis: "hypothesis".into(),
            created_at: Utc::now().to_rfc3339(),
            status: ExperimentStatus::Running,
            baseline_avg_fps: 120.0,
            baseline_low1_fps: baseline_low1,
            baseline_session_id: None,
            baseline_halves: None,
            baseline_check: None,
            applied_at: None,
            session_pairing: None,
            noise_evidence: None,
            between_session_noise: None,
            game_noise: None,
            assumed_band: None,
            halves_floor_pct: None,
            ledger_watermark: watermark,
            applied_change_id: "change-1".into(),
            active_changes_at_start: 0,
            attribution_warning: None,
            noise_floor_pct: DEFAULT_NOISE_FLOOR_PCT,
            treatment: None,
            verdict: None,
            kept: false,
            stop_reason: None,
            concluded_at: None,
            verdict_confidence: None,
            verdict_note: None,
            trial_result: None,
            target_verified: None,
            prior_state_verified: false,
            final_state_verified: None,
            outcome: TrialOutcome::Recommended,
            smoothest: None,
            stated_risk: None,
            risk_choice: None,
            cost_acknowledged: None,
            mode: TrialMode::Pair,
            real_play: None,
        }
    }

    #[test]
    fn gate_is_armed_after_qa_and_owner_signoff() {
        // ARMED 2026-07-17 (spec §7): owner sign-off "Ship it live now". Arming reuses the audited
        // `history` apply/rollback boundary (LIVE for weeks under the Benchmark A/B trial), so no new
        // mutation primitive ships; the apply→rollback round-trip on a benign rec is proven on the rig
        // as part of the ship QA (recorded in RELEASE_STATE). Flipping it BACK is likewise an
        // owner-signed decision, never a side effect of a refactor.
        assert!(experiment_gate(), "experiment_gate is armed after QA + owner sign-off");
    }

    #[test]
    fn armed_lifecycle_commands_no_longer_refuse_for_the_gate() {
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        // With the gate armed, the defense-in-depth "isn't part of this build" short-circuit is
        // unreachable: a lookup command falls through to its REAL not-found path. We exercise only the
        // no-op lookup commands here (bogus id ⇒ nothing matches ⇒ no mutation). `start_experiment` is
        // deliberately NOT called — it applies a real reversible change through the ledger; that
        // round-trip is proven live on the rig by the ship QA (RELEASE_STATE), never in a unit run.
        let concluded =
            conclude_experiment("nonexistent".into(), "2026-01-01T00:00:00Z".into(), false).unwrap_err();
        assert!(!concluded.contains("isn't part of this build"), "gate no longer short-circuits: {concluded}");
        assert!(concluded.contains("not found"));
        let restored = restore_experiment("nonexistent".into()).unwrap_err();
        assert!(!restored.contains("isn't part of this build"), "gate no longer short-circuits: {restored}");
        assert!(restored.contains("not found"));
    }

    #[test]
    fn default_store_is_empty() {
        // Nothing can be created behind the closed gate, so a fresh store carries zero experiments.
        assert_eq!(ExperimentStore::default().experiments.len(), 0);
        assert_eq!(ExperimentStore::default().schema_version, 0);
    }

    // ── single-variable attribution (§4F) ──

    #[test]
    fn attribution_warning_none_when_rig_is_clean() {
        assert_eq!(attribution_warning(0, false), None);
    }

    #[test]
    fn attribution_warning_names_count_and_refuses_to_attribute_when_changes_active() {
        let one = attribution_warning(1, false).unwrap();
        assert!(one.contains("1 other Compy change is already active"));
        assert!(one.contains("ONLY the one new change"));
        let many = attribution_warning(3, false).unwrap();
        assert!(many.contains("3 other Compy changes are already active"));
        assert!(many.contains("can't attribute"));
    }

    // #628: a Trial on a setting whose older Compy change was undone in Windows said "1 other Compy
    // change is already active", counting that stale row for the setting under test.
    #[test]
    fn the_start_note_never_counts_a_stale_row_for_the_setting_under_test() {
        // 453-f1 review: the note counts the changes the shared rule reads as on
        // (`AppliedChangesSummary::active_recs`), never the setting under test.
        let stale = ["test-rec".to_string()];
        assert_eq!(other_active_changes(&stale, "test-rec"), 0);
        assert_eq!(attribution_warning(other_active_changes(&stale, "test-rec"), false), None, "no 'other change' note");
        let on = ["game-bar-disable".to_string(), "game-mode".to_string(), "test-rec".to_string()];
        assert_eq!(other_active_changes(&on, "test-rec"), 2, "each other change on, counted once");
        let note = attribution_warning(other_active_changes(&on, "test-rec"), false).unwrap();
        assert!(note.contains("2 other Compy changes are already active"), "{note}");
    }

    // ── conclude verdict logic (§4F steps 6–8, anti-fabrication) ──

    #[test]
    fn improvement_beyond_noise_is_kept() {
        let r = rec(90.0, 5);
        // +11% on the 1% low, no confound (ledger unchanged), plenty of samples.
        let o = conclude_outcome(&r, 100.0, 5000, false, None, Some(5), Utc::now());
        assert_eq!(o.verdict, "improved");
        assert!(o.keep, "a clean improvement is kept");
        assert!(o.stop_reason.is_none());
    }

    #[test]
    fn a_gain_inside_the_noise_floor_is_no_change_and_restores() {
        let r = rec(100.0, 5);
        // +2% < 3% floor → no-change, never "improved" (never credit inside the noise).
        let o = conclude_outcome(&r, 102.0, 5000, false, None, Some(5), Utc::now());
        assert_eq!(o.verdict, "no-change");
        assert!(!o.keep, "no measurable benefit ⇒ restore to the clean baseline");
    }

    #[test]
    fn a_regression_restores() {
        let r = rec(100.0, 5);
        let o = conclude_outcome(&r, 80.0, 5000, false, None, Some(5), Utc::now());
        assert_eq!(o.verdict, "regressed");
        assert!(!o.keep);
    }

    #[test]
    fn a_confound_refuses_attribution_and_restores() {
        let r = rec(90.0, 5);
        // Ledger advanced past the watermark → another change landed → confounded, even on a big gain.
        let o = conclude_outcome(&r, 120.0, 5000, false, None, Some(6), Utc::now());
        assert_eq!(o.verdict, "confounded");
        assert!(!o.keep, "can't attribute a confounded result → restore");
    }

    #[test]
    fn a_ledger_that_is_not_the_armed_one_also_refuses_attribution() {
        // The mirror of the case above, and the one that actually happens: the ledger reads BELOW
        // the watermark. `load_history_from` quarantines a corrupt ledger to `history.json.corrupt`,
        // and every load after that returns empty forever — so a `>` test saw "nothing landed" while
        // real changes were free to land into the fresh ledger, and kept the change on that reading.
        // The watermark means "the same ledger", so any difference refuses attribution.
        let r = rec(90.0, 5);
        let o = conclude_outcome(&r, 120.0, 5000, false, None, Some(0), Utc::now());
        assert_eq!(o.verdict, "confounded");
        assert!(!o.keep, "an unattributable reading is never kept");
        // An outright unreadable ledger is the strictest case of the same thing.
        let o = conclude_outcome(&r, 120.0, 5000, false, None, None, Utc::now());
        assert_eq!(o.verdict, "confounded");
        assert!(!o.keep, "an unreadable ledger can never justify keeping a change");
    }

    #[test]
    fn a_crash_forces_restore_regardless_of_fps() {
        let r = rec(90.0, 5);
        // Even a big apparent gain: a crash means unstable/unsupported → restore + honest stop reason.
        let o = conclude_outcome(&r, 130.0, 5000, true, None, Some(5), Utc::now());
        assert_eq!(o.verdict, "regressed");
        assert!(!o.keep);
        assert_eq!(o.stop_reason.as_deref(), Some("crash-during-treatment"));
    }

    #[test]
    fn too_few_samples_is_insufficient_evidence_not_a_verdict() {
        let r = rec(90.0, 5);
        let o = conclude_outcome(&r, 120.0, MIN_TREATMENT_SAMPLES - 1, false, None, Some(5), Utc::now());
        assert_eq!(o.verdict, "insufficient-evidence");
        assert!(!o.keep, "no verdict on thin evidence ⇒ restore");
        assert_eq!(o.stop_reason.as_deref(), Some("insufficient-samples"));
    }

    // ── treatment-game comparability guard (defense-in-depth, decision doc 2026-07-18 §3/§4) ──

    /// The pure identity check: known-equal (case-insensitive, trimmed) is Match; known-unequal is
    /// Mismatch; anything absent or blank is Unverified — NEVER silently equal or unequal.
    #[test]
    fn game_match_classifies_conservatively() {
        assert_eq!(game_match("cs2.exe", Some("cs2.exe")), GameMatch::Match);
        assert_eq!(game_match("cs2.exe", Some("CS2.EXE")), GameMatch::Match); // case-insensitive
        assert_eq!(game_match("  cs2.exe ", Some("cs2.exe")), GameMatch::Match); // trimmed
        assert_eq!(game_match("cs2.exe", Some("valorant.exe")), GameMatch::Mismatch);
        assert_eq!(game_match("cs2.exe", None), GameMatch::Unverified); // identity not supplied
        assert_eq!(game_match("cs2.exe", Some("   ")), GameMatch::Unverified); // blank treatment
        assert_eq!(game_match("", Some("cs2.exe")), GameMatch::Unverified); // blank baseline
    }

    /// A treatment session that measured a DIFFERENT game than the baseline is not a comparable
    /// before/after — decline with "not-comparable", restore, and name both games in the note.
    #[test]
    fn a_different_treatment_game_is_not_comparable_and_restores() {
        let r = rec(90.0, 5); // baseline game = "Test"
        // Even a big apparent gain on the 1% low can't count — it's a different workload.
        let o = conclude_outcome(&r, 130.0, 5000, false, Some("Other Game"), Some(5), Utc::now());
        assert_eq!(o.verdict, "not-comparable");
        assert!(!o.keep, "a wrong-game reading must never keep the change");
        assert_eq!(o.stop_reason.as_deref(), Some("treatment-game-differs-from-baseline"));
        assert_eq!(o.confidence, Confidence::Unknown, "not comparable ⇒ Unknown, never a band");
        assert!(o.note.contains("Other Game") && o.note.contains("Test"), "names both games");
        assert!(o.note.contains("not enough comparable evidence"));
    }

    /// The game-mismatch guard sits ABOVE the crash guard: a crash in a KNOWN-different game still
    /// isn't attributable to our change, so the verdict is not-comparable (Unknown), not regressed.
    #[test]
    fn game_mismatch_takes_precedence_over_crash() {
        let r = rec(90.0, 5);
        let o = conclude_outcome(&r, 130.0, 5000, true, Some("Other Game"), Some(5), Utc::now());
        assert_eq!(o.verdict, "not-comparable", "wrong game beats the crash signal");
        assert_eq!(o.confidence, Confidence::Unknown);
        assert!(!o.keep, "still restores — identical safety to the crash path");
    }

    /// Verifying the same game (case-insensitively) leaves the normal verdict untouched AND earns the
    /// "same rig and game" claim in the note — the ONLY path allowed to assert the games matched.
    #[test]
    fn a_verified_same_game_keeps_the_normal_verdict_and_claims_same_game() {
        let r = rec(90.0, 5); // baseline game = "Test"
        let o = conclude_outcome(&r, 100.0, 5000, false, Some("test"), Some(5), Utc::now());
        assert_eq!(o.verdict, "improved", "the guard must not disturb a clean same-game result");
        assert!(o.keep);
        assert!(o.note.contains("same rig and game"), "a verified match earns the full claim");
    }

    /// An UNVERIFIED game (identity not supplied) is no worse than before the check existed: the
    /// verdict proceeds exactly as it did, but the note DROPS the unearned "same game" assumption.
    #[test]
    fn an_unverified_game_proceeds_but_drops_the_same_game_claim() {
        let r = rec(90.0, 5);
        let o = conclude_outcome(&r, 100.0, 5000, false, None, Some(5), Utc::now());
        assert_eq!(o.verdict, "improved", "no identity ⇒ behaviour unchanged from before the guard");
        assert!(o.keep);
        assert!(o.note.contains("on the same rig,"), "still a same-rig single-variable compare");
        assert!(!o.note.contains("same rig and game"), "never silently assume the games matched");
    }

    // ── verdict CONFIDENCE band + methodology note (Task F — bands never numbers) ──

    /// A crash is an unambiguous stability failure — the "restore it" call doesn't depend on the fps
    /// reading, so the band is High and the note says exactly that.
    #[test]
    fn a_crash_verdict_is_high_confidence_and_says_it_does_not_rely_on_fps() {
        let r = rec(90.0, 5);
        let o = conclude_outcome(&r, 130.0, 5000, true, None, Some(5), Utc::now());
        assert_eq!(o.confidence, Confidence::High);
        assert!(o.note.to_lowercase().contains("crash"));
        assert!(o.note.contains("does not rely on the frame-rate reading"));
    }

    /// Thin evidence must render as Unknown — the honest "we don't know", never a fabricated band.
    #[test]
    fn insufficient_samples_leave_confidence_unknown() {
        let r = rec(90.0, 5);
        let o = conclude_outcome(&r, 120.0, MIN_TREATMENT_SAMPLES - 1, false, None, Some(5), Utc::now());
        assert_eq!(o.confidence, Confidence::Unknown);
        assert!(o.note.contains("not enough comparable evidence"));
    }

    /// A clean improvement with a valid-but-short treatment sample sits at Medium…
    #[test]
    fn a_clean_verdict_on_a_short_sample_is_medium() {
        let r = rec(90.0, 5);
        let o = conclude_outcome(&r, 100.0, MIN_TREATMENT_SAMPLES, false, None, Some(5), Utc::now());
        assert_eq!(o.verdict, "improved");
        assert_eq!(o.confidence, Confidence::Medium);
        assert!(o.note.contains("Compy made no other change during the test"), "{}", o.note);
    }

    /// …and rises to High once the treatment session is comfortably long (≥ 2× the minimum frames).
    #[test]
    fn a_clean_verdict_on_a_long_sample_is_high() {
        let r = rec(90.0, 5);
        let o = conclude_outcome(
            &r,
            100.0,
            MIN_TREATMENT_SAMPLES.saturating_mul(2),
            false,
            None,
            Some(5),
            Utc::now(),
        );
        assert_eq!(o.verdict, "improved");
        assert_eq!(o.confidence, Confidence::High);
    }

    /// A confound can't be attributed, so a big gain still lands at Low — evidence quality, not size.
    #[test]
    fn a_confounded_verdict_is_low_confidence_regardless_of_gain() {
        let r = rec(90.0, 5);
        let o = conclude_outcome(&r, 120.0, 5000, false, None, Some(6), Utc::now());
        assert_eq!(o.verdict, "confounded");
        assert_eq!(o.confidence, Confidence::Low);
        assert!(o.note.contains("can't be attributed"));
    }

    /// The methodology note is plain language — NEVER a numeric confidence (anti-fabrication guard).
    #[test]
    fn no_verdict_note_ever_carries_a_numeric_confidence() {
        let banned = ["% confidence", "confidence:", "score", "% bottleneck", "%bottleneck"];
        let r = rec(90.0, 5);
        let cases = [
            conclude_outcome(&r, 130.0, 5000, true, None, Some(5), Utc::now()), // crash
            conclude_outcome(&r, 120.0, MIN_TREATMENT_SAMPLES - 1, false, None, Some(5), Utc::now()), // insufficient
            conclude_outcome(&r, 100.0, 5000, false, None, Some(5), Utc::now()), // improved
            conclude_outcome(&r, 120.0, 5000, false, None, Some(6), Utc::now()), // confounded
            conclude_outcome(&r, 100.0, 5000, false, Some("Other Game"), Some(5), Utc::now()), // not-comparable
        ];
        for o in cases {
            let lc = o.note.to_lowercase();
            for b in banned {
                assert!(!lc.contains(b), "note leaked a numeric-confidence token {b:?}: {}", o.note);
            }
        }
    }

    // ── restore-failure honesty (anti-fabrication: never claim a state we can't confirm) ──

    #[test]
    fn a_change_reverted_outside_compy_is_not_falsely_reported_as_still_applied() {
        // The ONLY rollback_change error that means "already off" — kept in sync with the exact
        // literal history::rollback_change emits (history.rs carries a cross-reference comment). A
        // restore that hits this is honestly Restored, NEVER "the change is STILL APPLIED".
        assert!(restore_already_reverted("change has already been rolled back"));
        // Every OTHER failure means Compy could not CONFIRM the change is off — so we must not claim
        // it is off, and equally must not fabricate certainty that it is still on. All → not-benign.
        assert!(!restore_already_reverted("change 'x-123' not found in history"));
        assert!(!restore_already_reverted("history lock poisoned"));
        assert!(!restore_already_reverted("dispatch_rollback: registry write failed"));
        assert!(!restore_already_reverted(""));
    }

    // ── §4G simulator (never a promise) ──

    fn sim_ctx() -> SimContext {
        SimContext {
            rec_id: "r".into(),
            rec_title: "R".into(),
            applicable: true,
            advisory_only: false,
            already_active: false,
            barred: false,
            likely_negligible: false,
            expected_impact: None,
            metric_to_watch: Some("1% low FPS".into()),
            hardware_factor: "hw".into(),
        }
    }

    #[test]
    fn simulator_never_promises_a_gain() {
        let ctx = SimContext { expected_impact: Some(Confidence::High), ..sim_ctx() };
        let r = simulate(&ctx);
        assert!(!r.is_promise, "§4G: never framed as a guaranteed gain");
        assert_eq!(r.verdict, "worth-testing");
    }

    #[test]
    fn simulator_bars_win_over_everything() {
        let ctx =
            SimContext { barred: true, expected_impact: Some(Confidence::High), ..sim_ctx() };
        assert_eq!(simulate(&ctx).verdict, "risk-exceeds-value");
    }

    #[test]
    fn simulator_maps_each_signal_to_its_verbatim_verdict() {
        assert_eq!(
            simulate(&SimContext { applicable: false, ..sim_ctx() }).verdict,
            "not-applicable"
        );
        // An in-catalog advisory (no one-click apply) is also not-applicable — never worth-testing.
        assert_eq!(
            simulate(&SimContext { advisory_only: true, ..sim_ctx() }).verdict,
            "not-applicable"
        );
        // …and advisory precedence sits ABOVE the impact prior: even a would-be worth-testing prior
        // resolves not-applicable when Compy has no apply for it (can't be auto-measured).
        assert_eq!(
            simulate(&SimContext {
                advisory_only: true,
                expected_impact: Some(Confidence::High),
                ..sim_ctx()
            })
            .verdict,
            "not-applicable"
        );
        assert_eq!(
            simulate(&SimContext { already_active: true, ..sim_ctx() }).verdict,
            "already-configured"
        );
        assert_eq!(
            simulate(&SimContext { likely_negligible: true, ..sim_ctx() }).verdict,
            "unlikely-to-matter"
        );
        assert_eq!(
            simulate(&SimContext { expected_impact: Some(Confidence::Low), ..sim_ctx() }).verdict,
            "plausible-unproven"
        );
        assert_eq!(
            simulate(&SimContext { expected_impact: None, ..sim_ctx() }).verdict,
            "insufficient-evidence"
        );
    }

    // ── build_sim_context wiring (armed: reads the real catalog) ──

    #[test]
    fn unknown_rec_id_context_is_insufficient_evidence_not_fabricated() {
        // An id absent from the hardware-tailored catalog has NO honest prior. The wiring must report
        // insufficient-evidence (unknown, not zero), never fabricate not-applicable/worth-testing, and
        // never mark it barred (the read-only simulator makes no safety claim; the apply boundary does).
        let ctx = build_sim_context("definitely-not-a-real-rec-id-xyz").unwrap();
        assert!(!ctx.barred);
        assert!(!ctx.likely_negligible);
        assert!(ctx.expected_impact.is_none());
        assert!(ctx.metric_to_watch.is_none());
        assert_eq!(simulate(&ctx).verdict, "insufficient-evidence");
    }

    #[test]
    fn catalog_rec_context_is_coherent_and_within_reachable_verdicts() {
        // For a real catalog member the context is honest-by-construction: a non-empty title, never
        // barred (structural bar = absence from the catalog), the 1%-low metric the engine actually
        // measures, and a verdict only from the set reachable without an invented prior. Three branches
        // are UNreachable from real data (documented): "risk-exceeds-value" (barred = catalog absence),
        // "unlikely-to-matter" (no per-rig headroom signal is wired), and "insufficient-evidence" —
        // every catalog rec carries a non-optional `provenance` (Verified/MeasuredSignal/ExpectedImpact),
        // so `expected_impact` is always Some for a found member and the None branch can't fire here.
        // Read the first rec's id through the same serde boundary the wiring uses (fields are private).
        let catalog = serde_json::to_value(crate::recommendations::get_recommendations()).unwrap();
        let Some(first_id) = catalog
            .as_array()
            .and_then(|a| a.first())
            .and_then(|r| r.get("id"))
            .and_then(|v| v.as_str())
        else {
            return; // no recs on this rig → nothing to assert
        };
        let ctx = build_sim_context(first_id).unwrap();
        assert!(!ctx.rec_title.is_empty());
        assert!(!ctx.barred);
        assert_eq!(ctx.metric_to_watch.as_deref(), Some("1% low FPS"));
        let reachable =
            ["already-configured", "not-applicable", "worth-testing", "plausible-unproven"];
        assert!(
            reachable.contains(&simulate(&ctx).verdict.as_str()),
            "real-data verdict must never be a fabricated/unreachable branch"
        );
    }

    #[test]
    fn appliable_recs_are_one_click_advisories_are_not() {
        // The single source of truth: `history::is_appliable` (shared with `dispatch_apply`) is what
        // drives `advisory_only`. Real one-click tweaks return true; catalog advisories with no apply,
        // and any unknown id, return false — so the simulator can never invite a Start that dead-ends.
        assert!(crate::history::is_appliable("hags-enable"));
        assert!(crate::history::is_appliable("game-mode"));
        assert!(!crate::history::is_appliable("ssd-upgrade-advisory"));
        assert!(!crate::history::is_appliable("gpu-driver-update"));
        assert!(!crate::history::is_appliable("definitely-not-a-real-rec-id-xyz"));
    }

    #[test]
    fn advisory_only_rec_is_never_worth_testing() {
        // End-to-end: an in-catalog advisory (no one-click apply) must never resolve to a verdict that
        // invites Start — the engine can't run an automatic before/after on it. If the rig's tailored
        // catalog doesn't carry these ids they fall to the unknown-id path (insufficient-evidence),
        // which also never invites Start — so the honesty guard holds either way.
        for id in ["ssd-upgrade-advisory", "gpu-driver-update"] {
            let v = simulate(&build_sim_context(id).unwrap()).verdict;
            assert_ne!(v, "worth-testing", "{id} advisory must not read worth-testing");
            assert_ne!(v, "plausible-unproven", "{id} advisory must not read plausible-unproven");
        }
    }

    // ── persistence round-trip ──

    #[test]
    fn store_round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!("compy-exp-test-{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        let path = dir.join("experiments.json");
        let mut store = ExperimentStore { schema_version: STORE_SCHEMA_VERSION, experiments: vec![] };
        store.experiments.push(rec(90.0, 2));
        save_store_to(&path, &store).unwrap();
        let back = load_store_from(&path);
        assert_eq!(back.experiments.len(), 1);
        assert_eq!(back.experiments[0].rec_id, "test-rec");
        assert_eq!(back.schema_version, STORE_SCHEMA_VERSION);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_store_fails_safe_to_empty_and_sets_aside() {
        let dir = std::env::temp_dir().join(format!("compy-exp-corrupt-{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("experiments.json");
        std::fs::write(&path, b"{ not valid json").unwrap();
        let back = load_store_from(&path);
        assert_eq!(back.experiments.len(), 0, "corrupt store → empty, never a partial parse");
        assert!(path.with_extension("json.corrupt").exists(), "damaged file preserved for recovery");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // CR-1102-left (review round 2, call-site proof): a SECOND damaged store keeps the first set-aside
    // beside it, through the loader the writes build on, not only through the helper; and a damaged
    // file that cannot be set aside (a directory sits where `.corrupt` would go, and so do all of its
    // dated names) is a refused read, never an empty store the next save would write over.
    #[test]
    fn a_second_damaged_store_keeps_the_first_set_aside_and_an_unmovable_one_refuses_the_read() {
        let dir = std::env::temp_dir().join(format!("compy-exp-corrupt-twice-{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("experiments.json");
        std::fs::write(&path, b"{ first damage").unwrap();
        assert_eq!(load_store_checked_from(&path).map(|s| s.experiments.len()), Ok(0));
        std::fs::write(&path, b"{ second damage").unwrap();
        assert_eq!(load_store_checked_from(&path).map(|s| s.experiments.len()), Ok(0));
        let set_aside: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .filter(|n| n.starts_with("experiments.json.corrupt"))
            .collect();
        assert_eq!(set_aside.len(), 2, "both damaged files kept: {set_aside:?}");
        let mut bytes: Vec<_> = set_aside.iter().map(|n| std::fs::read(dir.join(n)).unwrap()).collect();
        bytes.sort();
        assert_eq!(bytes, vec![b"{ first damage".to_vec(), b"{ second damage".to_vec()]);
        // Unmovable: a directory already holds the `.corrupt` name and cannot be renamed over a file.
        let blocked = dir.join("blocked");
        std::fs::create_dir_all(&blocked).unwrap();
        let path = blocked.join("experiments.json");
        std::fs::write(&path, b"{ damage").unwrap();
        std::fs::create_dir_all(path.with_extension("json.corrupt").join("occupied")).unwrap();
        // The rename of the occupied `.corrupt` directory to its dated name succeeds on every
        // platform, so block that too: pre-create every dated name the helper would try.
        let secs = std::fs::symlink_metadata(path.with_extension("json.corrupt"))
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        std::fs::write(path.with_extension(format!("json.corrupt.{secs}")), b"").unwrap();
        for n in 1..100u32 {
            std::fs::write(path.with_extension(format!("json.corrupt.{secs}-{n}")), b"").unwrap();
        }
        let err = load_store_checked_from(&path).expect_err("a damaged file still in place refuses the read");
        assert!(err.contains("couldn't set the damaged file aside"), "{err}");
        // CR-fix-needs-trial-store: the refusal names the file and the way out, never the expanded path.
        assert!(err.contains("experiments.json") && err.contains("%APPDATA%\\Compy"), "{err}");
        assert!(err.contains("move that file to another folder") && err.contains("don't delete it"), "{err}");
        assert!(!err.contains(&*dir.to_string_lossy()), "no expanded path in the words: {err}");
        assert_eq!(std::fs::read(&path).unwrap(), b"{ damage", "the damaged bytes are untouched");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Codebase review 2026-11-02: a store that is there but can't be read right now (a sharing
    // violation, a permissions glitch) read as empty, and the start or conclude that followed saved one
    // record over every Trial on disk. A directory at the store's path fails the read on any platform.
    #[test]
    fn a_store_that_cant_be_read_right_now_is_an_error_for_a_write_never_an_empty_store() {
        let dir = std::env::temp_dir().join(format!("compy-exp-unreadable-{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        let path = dir.join("experiments.json");
        std::fs::create_dir_all(&path).unwrap();
        let err = load_store_checked_from(&path).expect_err("a write never builds on an unread store");
        assert!(err.contains("couldn't read its Trial records right now"), "{err}");
        // CR-fix-needs-trial-store: the refusal names the file and the way out, never the expanded path.
        assert!(err.contains("experiments.json") && err.contains("%APPDATA%\\Compy"), "{err}");
        assert!(err.contains("try again shortly") && err.contains("restart Compy"), "{err}");
        // Review r1 (both): a lasting cause (this test's directory at the path) gets the move-aside way out.
        assert!(err.contains("move that file to another folder") && err.contains("don't delete it"), "{err}");
        assert!(err.contains("Any change a Trial recorded stays in Test"), "{err}");
        assert!(!err.contains(&*dir.to_string_lossy()), "no expanded path in the words: {err}");
        assert!(path.is_dir() && !path.with_extension("json.corrupt").exists(), "nothing set aside or replaced");
        assert!(load_store_from(&path).experiments.is_empty(), "a read that only shows the store still shows nothing");
        assert_eq!(load_store_checked_from(&dir.join("absent.json")).map(|s| s.experiments.len()), Ok(0), "absent is a first run");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── Trial Protocol §8/§9: typed result + keep rule (#583) ──

    #[test]
    fn every_verdict_maps_to_its_protocol_class_and_only_better_keeps() {
        use TrialResult::*;
        let table = [
            ("improved", Better, true),
            ("regressed", Worse, false),
            ("no-change", Negligible, false),
            ("insufficient-evidence", Inconclusive, false),
            ("confounded", Inconclusive, false),
            ("expired", Unmeasurable, false),
            ("not-comparable", Unmeasurable, false),
            ("too-noisy", Inconclusive, false),
        ];
        assert_eq!(table.len(), KNOWN_VERDICTS.len(), "a new verdict needs a row in this table");
        for (verdict, class, keep) in table {
            assert!(KNOWN_VERDICTS.contains(&verdict), "{verdict} is not a known verdict");
            assert_eq!(trial_result_for(verdict), class, "{verdict}");
            assert_eq!(keep_rule(class), keep, "{verdict} → {class:?}");
        }
    }

    #[test]
    fn an_unknown_verdict_is_unmeasurable_and_never_kept() {
        assert_eq!(trial_result_for("some-future-verdict"), TrialResult::Unmeasurable);
        assert_eq!(trial_result_for(""), TrialResult::Unmeasurable);
        assert!(!keep_rule(trial_result_for("some-future-verdict")));
    }

    #[test]
    fn conclude_keeps_exactly_when_the_keep_rule_says_so_on_every_path() {
        let now = Utc::now();
        let r = rec(90.0, 5);
        let cases = [
            conclude_outcome(&r, 100.0, 5000, false, None, Some(5), now), // improved
            conclude_outcome(&r, 91.0, 5000, false, None, Some(5), now),  // no-change
            conclude_outcome(&r, 70.0, 5000, false, None, Some(5), now),  // regressed
            conclude_outcome(&r, 120.0, 5000, true, None, Some(5), now),  // crash
            conclude_outcome(&r, 120.0, 10, false, None, Some(5), now),   // too few frames
            conclude_outcome(&r, 120.0, 5000, false, None, Some(6), now), // confounded
            conclude_outcome(&r, 120.0, 5000, false, Some("Other"), Some(5), now), // other game
            conclude_outcome(&r, 120.0, 5000, false, None, Some(5), now + chrono::Duration::days(365)), // expired
            with_steady_sessions(
                conclude_outcome(&r, 100.0, 5000, false, None, Some(5), now),
                Some(&BaselineHalves { first_half_fps: 259.8, second_half_fps: 227.9 }),
                None,
            ), // too noisy
        ];
        let mut seen: Vec<&str> = Vec::new();
        for o in &cases {
            assert!(KNOWN_VERDICTS.contains(&o.verdict.as_str()), "unlisted verdict {}", o.verdict);
            assert_eq!(o.keep, keep_rule(trial_result_for(&o.verdict)), "{}", o.verdict);
            seen.push(&o.verdict);
        }
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), KNOWN_VERDICTS.len(), "every verdict path is exercised: {seen:?}");
        assert_eq!(cases.iter().filter(|o| o.keep).count(), 1, "only the clean improvement keeps");
    }

    #[test]
    fn trial_result_serializes_kebab_case_and_old_records_load_without_it() {
        assert_eq!(serde_json::to_string(&TrialResult::Unmeasurable).unwrap(), "\"unmeasurable\"");
        assert_eq!(serde_json::to_string(&ExperimentStatus::Pending).unwrap(), "\"pending\"");
        let mut old = serde_json::to_value(rec(90.0, 5)).unwrap();
        let obj = old.as_object_mut().unwrap();
        obj.remove("trial_result");
        obj.remove("target_verified");
        obj.remove("prior_state_verified");
        obj.remove("final_state_verified");
        let back: ExperimentRecord = serde_json::from_value(old).unwrap();
        assert_eq!(back.trial_result, None, "a pre-#583 record reads as unclassified, never guessed");
        assert_eq!(back.target_verified, None, "and its target as unverified");
        assert!(!back.prior_state_verified, "its prior state was never read");
        assert_eq!(back.final_state_verified, None, "nor its final state");
    }

    // ── P5-outcomes-f1: the Trial an outcome switch cites ──

    fn judged(id: &str, rec_id: &str, verdict: &str, outcome: TrialOutcome) -> ExperimentRecord {
        let mut r = rec(90.0, 5);
        r.id = id.into();
        r.rec_id = rec_id.into();
        r.status = if verdict == "improved" { ExperimentStatus::Kept } else { ExperimentStatus::Restored };
        r.verdict = Some(verdict.into());
        r.outcome = outcome;
        r.concluded_at = Some("2026-10-24T20:00:00+00:00".into());
        r
    }

    #[test]
    fn a_keep_cites_only_a_trial_of_this_change_judged_better() {
        let store = [
            judged("exp:max", "hags-on", "improved", TrialOutcome::MaxFps),
            judged("exp:rec", "hags-on", "no-change", TrialOutcome::Recommended),
            judged("exp:other", "game-mode-on", "improved", TrialOutcome::Recommended),
        ];
        let link = trial_link_in(&store, "exp:max", "hags-on", true).expect("a Better Trial justifies a keep");
        assert_eq!(link.experiment_id, "exp:max");
        assert_eq!(link.outcome, "max-fps");
        assert_eq!(link.concluded_at.as_deref(), Some("2026-10-24T20:00:00+00:00"));
        assert!(trial_link_in(&store, "exp:rec", "hags-on", true).is_err(), "no-change can't justify a keep");
        assert!(trial_link_in(&store, "exp:other", "hags-on", true).is_err(), "another change's Trial");
        assert!(trial_link_in(&store, "exp:missing", "hags-on", true).is_err(), "an unknown id");
    }

    #[test]
    fn the_outcome_switch_is_closed_while_a_trial_starts_or_runs() {
        let done = judged("exp:rec", "hags-on", "no-change", TrialOutcome::Recommended);
        assert!(outcome_switch_open(std::slice::from_ref(&done)).is_ok());
        for status in [ExperimentStatus::Pending, ExperimentStatus::Running] {
            let mut busy = judged("exp:run", "game-mode-on", "no-change", TrialOutcome::Recommended);
            busy.status = status;
            assert!(outcome_switch_open(&[done.clone(), busy]).is_err());
        }
    }

    #[test]
    fn a_switch_call_is_refused_while_a_pending_or_running_trial_exists_and_changes_nothing() {
        let keep = judged("exp:max", "hags-on", "improved", TrialOutcome::MaxFps);
        let off = judged("exp:rec", "hags-on", "no-change", TrialOutcome::Recommended);
        for status in [ExperimentStatus::Pending, ExperimentStatus::Running] {
            let mut busy = judged("exp:new", "game-mode-on", "no-change", TrialOutcome::Recommended);
            busy.status = status;
            busy.verdict = None;
            let store = [keep.clone(), off.clone(), busy];
            let applied = keep_outcome_locked(&store, "hags-on", "exp:max", |_| -> Result<(), String> {
                panic!("{status:?}: the apply must not run")
            });
            assert!(applied.is_err(), "{status:?}");
            let undone = undo_outcome_locked(&store, "exp:rec", |_| panic!("{status:?}: the undo must not run"));
            assert!(undone.is_err(), "{status:?}");
        }
        // With nothing in progress, both sides reach the ledger with the checked link.
        let store = [keep, off];
        let link = keep_outcome_locked(&store, "hags-on", "exp:max", Ok).expect("keep");
        assert_eq!(link.experiment_id, "exp:max");
        let mut cited = None;
        undo_outcome_locked(&store, "exp:rec", |cite| {
            cited = Some(cite("hags-on"));
            Ok(())
        })
        .expect("undo");
        assert_eq!(cited.expect("cited").expect("fits").experiment_id, "exp:rec");
    }

    #[test]
    fn the_outcome_switch_commands_hold_the_store_gate_across_the_check_and_the_ledger_write() {
        // No seam reaches these commands without the real data root, so the ordering is pinned on
        // the source: the gate is taken before the store is read, and the ledger call sits after it
        // in the same body (start_experiment's shape).
        let src = include_str!("experiment.rs");
        for (sig, call) in [
            ("pub(crate) fn apply_outcome_choice(", "crate::history::apply_recommendation_citing("),
            ("pub(crate) fn undo_outcome_choice(", "crate::history::rollback_change_citing("),
        ] {
            let body = src.split_once(sig).and_then(|(_, r)| r.split_once("\n}\n")).map(|(b, _)| b).expect(sig);
            let gate = body.find("let _g = lock_store()?;").expect("the gate is taken");
            let read = body.find("load_store()").expect("the store is read");
            let write = body.find(call).expect("the ledger is written");
            assert!(gate < read && read < write, "{sig}: gate, then read, then write");
        }
    }

    #[test]
    fn a_plain_change_to_the_power_plan_or_a_setting_of_it_is_refused_while_a_trial_holds_the_other() {
        // CR-plan-held-refusal: USB selective suspend, PCIe link power and core parking are settings OF
        // the active power plan; changing the plan while a Trial holds one of them (or one of them while
        // a Trial holds the plan) writes the plan the Trial is measuring.
        let open = |rec: &str, status: ExperimentStatus| {
            let mut e = judged("exp:run", rec, "no-change", TrialOutcome::Recommended);
            e.status = status;
            e.verdict = None;
            e
        };
        for status in [ExperimentStatus::Running, ExperimentStatus::Pending] {
            let plan = [open("power-ultimate", status)];
            for wanted in ["usb-selective-suspend-off", "pcie-aspm-off", "core-parking-forced"] {
                let why = held_by_trial_refusal(&plan, std::iter::once(wanted)).expect("refused");
                assert!(why.contains("same power plan") && why.contains("Nothing was changed"), "{status:?} {wanted}: {why}");
                let setting = [open(wanted, status)];
                let why = held_by_trial_refusal(&setting, std::iter::once("power-ultimate")).expect("refused");
                assert!(why.contains("same power plan"), "{status:?} {wanted}: {why}");
                // A batch naming one of them is refused whole.
                assert!(held_by_trial_refusal(&setting, ["game-mode-on", "power-ultimate"].into_iter()).is_some());
            }
            assert_eq!(status == ExperimentStatus::Pending, held_by_trial_refusal(&plan, std::iter::once("pcie-aspm-off")).unwrap().contains("was interrupted"));
            // Settings outside the plan class still apply; two settings of the plan don't clash with each other.
            assert_eq!(held_by_trial_refusal(&plan, std::iter::once("game-mode-on")), None);
            let usb = [open("usb-selective-suspend-off", status)];
            assert_eq!(held_by_trial_refusal(&usb, std::iter::once("pcie-aspm-off")), None);
        }
        // A concluded Trial holds nothing.
        let done = judged("exp:old", "power-ultimate", "no-change", TrialOutcome::Recommended);
        assert_eq!(held_by_trial_refusal(&[done], std::iter::once("pcie-aspm-off")), None);
    }

    #[test]
    fn an_undo_or_restore_in_the_plan_class_is_refused_while_a_trial_holds_the_other_half() {
        // CR-plan-held-refusal (opus r1): the undo and the core-parking restore check the class only.
        let open = |rec: &str, status: ExperimentStatus| {
            let mut e = judged("exp:run", rec, "no-change", TrialOutcome::Recommended);
            e.status = status;
            e.verdict = None;
            e
        };
        let usb = [open("usb-selective-suspend-off", ExperimentStatus::Running)];
        let why = plan_class_trial_refusal(&usb, std::iter::once("power-ultimate")).expect("refused");
        assert!(why.contains("same power plan") && why.contains("by a Trial"), "{why}");
        let plan = [open("power-ultimate", ExperimentStatus::Pending)];
        assert!(plan_class_trial_refusal(&plan, std::iter::once("core-parking-forced")).unwrap().contains("was interrupted"));
        // The held setting's own undo keeps today's behaviour; outside the class, nothing.
        assert_eq!(plan_class_trial_refusal(&usb, std::iter::once("usb-selective-suspend-off")), None);
        assert_eq!(plan_class_trial_refusal(&usb, std::iter::once("pcie-aspm-off")), None);
        assert_eq!(plan_class_trial_refusal(&plan, std::iter::once("game-mode-on")), None);
        let done = judged("exp:old", "power-ultimate", "no-change", TrialOutcome::Recommended);
        assert_eq!(plan_class_trial_refusal(&[done], std::iter::once("pcie-aspm-off")), None);
        // Only the plan class takes the check (every other undo and restore runs as before).
        for rec in ["power-ultimate", "usb-selective-suspend-off", "pcie-aspm-off", "core-parking-forced"] {
            assert!(crate::gaming_orchestrator::in_plan_class(rec), "{rec}");
        }
        assert!(!crate::gaming_orchestrator::in_plan_class("game-mode-on"));
    }

    #[test]
    fn a_plain_apply_of_the_setting_a_pending_or_running_trial_holds_is_refused() {
        // CR-rp-same-setting-row: a second row for the Trial's own setting would snapshot the Trial's
        // applied state and keep reading "applied" after the Trial puts its change back.
        let done = judged("exp:old", "hags-on", "no-change", TrialOutcome::Recommended);
        for status in [ExperimentStatus::Pending, ExperimentStatus::Running] {
            let mut busy = judged("exp:run", "game-mode-on", "no-change", TrialOutcome::Recommended);
            busy.status = status;
            busy.verdict = None;
            let store = [done.clone(), busy];
            let refused = held_by_trial_refusal(&store, std::iter::once("game-mode-on")).expect("refused");
            assert!(refused.contains("Nothing was changed"), "{status:?}: {refused}");
            assert!(
                held_by_trial_refusal(&store, ["hags-on", "game-mode-on"].into_iter()).is_some(),
                "{status:?}: a batch naming it is refused whole"
            );
            // Any other setting still applies (it confounds the Trial, which the Trial already reports).
            assert_eq!(held_by_trial_refusal(&store, ["hags-on", "fast-startup-off"].into_iter()), None);
        }
        // A concluded Trial holds nothing.
        assert_eq!(held_by_trial_refusal(std::slice::from_ref(&done), std::iter::once("hags-on")), None);
        assert_eq!(held_by_trial_refusal(&[], std::iter::once("hags-on")), None);
        // Review r1: every open record counts, not only the first; a leftover Pending one says so.
        let mut running = judged("exp:run", "game-mode-on", "no-change", TrialOutcome::Recommended);
        running.status = ExperimentStatus::Running;
        let mut stale = judged("exp:stale", "hags-on", "no-change", TrialOutcome::Recommended);
        stale.status = ExperimentStatus::Pending;
        let store = [running, stale];
        let refused = held_by_trial_refusal(&store, std::iter::once("hags-on")).expect("the Pending one holds it too");
        assert!(refused.contains("was interrupted") && refused.contains("Nothing was changed"), "{refused}");
        assert!(held_by_trial_refusal(&store, std::iter::once("game-mode-on")).expect("running").contains("being tested"));
    }

    #[test]
    fn gaming_mode_sees_every_open_trials_setting() {
        // CR-gm-spans-trial: Gaming Mode skips the settings open Trials hold; a concluded one holds none.
        let done = judged("exp:old", "hags-enable", "no-change", TrialOutcome::Recommended);
        let mut running = judged("exp:run", "game-mode", "no-change", TrialOutcome::Recommended);
        running.status = ExperimentStatus::Running;
        let mut pending = judged("exp:pend", "power-ultimate", "no-change", TrialOutcome::Recommended);
        pending.status = ExperimentStatus::Pending;
        assert_eq!(open_rec_ids(&[done.clone(), running, pending]), vec!["game-mode", "power-ultimate"]);
        assert!(open_rec_ids(&[done]).is_empty());
        // And a Trial start (and the benchmark's apply) checks the session's contract under its gate.
        let src = include_str!("experiment.rs");
        for (sig, write) in [
            ("pub(crate) fn start_experiment(", concat!("crate::history::", "apply_recommendation(")),
            ("pub(crate) fn apply_for_bench_trial(", concat!("crate::history::", "apply_recommendation(")),
            ("pub(crate) fn apply_outcome_choice(", concat!("crate::history::", "apply_recommendation_citing(")),
            ("pub(crate) fn undo_outcome_choice(", concat!("crate::history::", "rollback_change_citing(")),
        ] {
            let body = src.split_once(sig).map(|(_, r)| r).expect(sig);
            // Review r1 (sonnet MUST-FIX): Gaming Mode's operation gate is held from the check on, so
            // a session can't start between the check and the record or the ledger write.
            let gate = body.find(concat!("gaming_orchestrator::", "session_op_guard()")).expect(sig);
            let check = body.find(concat!("gaming_orchestrator::", "session_holds_refusal(")).expect(sig);
            let write = body.find(write).expect(sig);
            assert!(gate < check && check < write, "{sig}: gate, check, then the write");
            let held = &body[..write];
            assert!(held.contains(concat!("let _gm = crate::gaming_orchestrator::", "session_op_guard()")), "{sig}: held, not dropped");
        }
    }

    #[test]
    fn the_ui_apply_and_undo_refuse_a_setting_a_gaming_mode_session_holds() {
        // CR-gm-spans-followups (d): the webview's undo is this module's, not history's bare undo.
        let lib = include_str!("lib.rs");
        let handler = lib.split_once("generate_handler![").map(|(_, r)| r).expect("handler list");
        assert!(handler.contains("experiment::rollback_change,"), "the undo is registered from experiment");
        let bare = handler.lines().any(|l| l.trim() == "rollback_change," || l.trim() == "history::rollback_change,");
        assert!(!bare, "history's bare undo is not a command");
        let src = include_str!("experiment.rs");
        // The gate is held (bound to `_gm`, not dropped) from the check through the write.
        let gate = concat!("let _gm = crate::gaming_orchestrator::", "plain_change_gate(");
        for (sig, write, arms) in [
            ("pub(crate) fn apply_recommendation(", concat!("crate::history::", "apply_recommendation(rec_id"), 2),
            ("pub(crate) fn apply_recommendations_batch(", concat!("crate::history::", "apply_recommendations_batch(items)"), 2),
            ("pub(crate) fn rollback_change(", concat!("crate::history::", "rollback_change(change_id)"), 1),
            // CR-core-parking-held-with-plan review r3 (opus NIT): the leftover restore, the same standard.
            ("pub(crate) fn restore_leftover(", concat!("crate::history::", "restore_leftover(&detector_id"), 1),
        ] {
            let body = src.split_once(sig).and_then(|(_, r)| r.split_once("\n}\n")).map(|(b, _)| b).expect(sig);
            // Every path to the ledger write (Trials on and off) takes the gate, then checks, then writes.
            let mut from = 0;
            for _ in 0..arms {
                let rest = &body[from..];
                let g = rest.find(gate).expect(sig);
                let w = rest.find(write).expect(sig);
                assert!(g < w, "{sig}: the gate and check, then the write");
                from += w + write.len();
            }
            assert!(!body[from..].contains(write), "{sig}: no unchecked write");
        }
    }

    #[test]
    fn the_ui_apply_commands_refuse_under_the_store_gate_before_the_ledger_write() {
        // The commands the webview reaches are this module's, not history's bare applies.
        let lib = include_str!("lib.rs");
        let handler = lib.split_once("generate_handler![").map(|(_, r)| r).expect("handler list");
        for name in ["apply_recommendation,", "apply_recommendations_batch,"] {
            assert!(handler.contains(&format!("experiment::{name}")), "{name} is registered from experiment");
            assert!(!handler.contains(&format!("history::{name}")), "{name} is not registered from history");
        }
        // The benchmark trials apply (and later roll back) the same settings: they go through the
        // Trial-aware commands too, never history's bare applies.
        let bench = include_str!("benchmark_trial.rs");
        for bare in ["crate::history::apply_recommendation(", "crate::history::apply_recommendations_batch("] {
            assert!(!bench.contains(bare), "benchmark_trial.rs calls {bare}");
        }
        // CR-bench-holds-setting: the tweak trial applies through the gated apply that also marks it held.
        for gated in ["crate::experiment::apply_for_bench_trial(", "crate::experiment::apply_recommendations_batch("] {
            assert!(bench.contains(gated), "benchmark_trial.rs applies through {gated}");
        }
        assert!(!bench.contains("use crate::history::apply"), "no bare import of history's applies");
        let src = include_str!("experiment.rs");
        for (sig, call) in [
            ("pub(crate) fn apply_recommendation(", "crate::history::apply_recommendation(rec_id, rec_title)\n}"),
            ("pub(crate) fn apply_recommendations_batch(", "crate::history::apply_recommendations_batch(items)\n}"),
        ] {
            let body = src.split_once(sig).and_then(|(_, r)| r.split_once("\n}\n")).map(|(b, _)| b).expect(sig);
            let gate = body.find("let _g = lock_store()?;").expect("the gate is taken");
            let read = body.find("load_store_checked()?").expect("the store is read, an unreadable one refuses");
            let refuse = body.find("held_by_trial_refusal(").expect("the refusal is checked");
            // CR-bench-holds-setting: and the benchmark tweak trial's hold, under the same gate.
            let bench = body.rfind("bench_refusal(").expect("the benchmark hold is checked");
            // Review r1: and before the Trials-off early return too.
            let off = body.find("if !experiment_gate() {").expect("gate-off branch");
            assert!(body[off..gate].contains("bench_refusal("), "{sig}: the gate-off branch checks the hold");
            let write = body.rfind(call.trim_end_matches("\n}")).expect("the ledger is written");
            assert!(gate < read && read < refuse && refuse < bench && bench < write, "{sig}: gate, read, refuse, then write");
        }
        // The keep re-apply too, under its gate, before its ledger write.
        let body = src
            .split_once("pub(crate) fn apply_outcome_choice(")
            .and_then(|(_, r)| r.split_once("\n}\n"))
            .map(|(b, _)| b)
            .expect("keep");
        let (gate, bench) = (body.find("let _g = lock_store()?;").expect("gate"), body.find("bench_refusal(").expect("bench"));
        let write = body.find("crate::history::apply_recommendation_citing(").expect("write");
        assert!(gate < bench && bench < write, "keep: gate, bench hold, then write");
        // Review r1 MUST-FIX (sonnet): a Trial start too, under its gate, before anything is recorded.
        let start = src.split_once("pub(crate) fn start_experiment(").map(|(_, r)| r).expect("start");
        let (gate, bench) = (start.find("let _g = lock_store()?;").expect("gate"), start.find("bench_refusal(").expect("bench"));
        let record = start.find("store.experiments.push(").expect("record first");
        assert!(gate < bench && bench < record, "start: gate, bench hold, then the record");
    }

    #[test]
    fn an_undo_cites_only_a_trial_of_this_change_judged_not_worth_keeping() {
        let mut running = judged("exp:run", "hags-on", "no-change", TrialOutcome::Recommended);
        running.verdict = None;
        running.status = ExperimentStatus::Running;
        let mut pending = judged("exp:pend", "hags-on", "no-change", TrialOutcome::Recommended);
        pending.status = ExperimentStatus::Pending;
        let store = [
            judged("exp:max", "hags-on", "improved", TrialOutcome::MaxFps),
            judged("exp:rec", "hags-on", "no-change", TrialOutcome::Recommended),
            judged("exp:reg", "hags-on", "regressed", TrialOutcome::Recommended),
            judged("exp:noisy", "hags-on", "too-noisy", TrialOutcome::Recommended),
            running,
            pending,
        ];
        let link = trial_link_in(&store, "exp:rec", "hags-on", false).expect("no-change justifies an undo");
        assert_eq!(link.outcome, "recommended");
        assert!(trial_link_in(&store, "exp:reg", "hags-on", false).is_ok());
        for id in ["exp:max", "exp:noisy", "exp:run", "exp:pend"] {
            assert!(trial_link_in(&store, id, "hags-on", false).is_err(), "{id} can't justify an undo");
        }
    }

    // ── Record-first lifecycle integrity (#583 lane 1) ──

    fn with_status(status: ExperimentStatus) -> ExperimentRecord {
        let mut r = rec(90.0, 5);
        r.status = status;
        r
    }

    #[test]
    fn only_a_starting_or_running_experiment_blocks_a_new_start() {
        use ExperimentStatus::*;
        for (status, blocks) in [(Pending, true), (Running, true), (Kept, false), (Restored, false), (Aborted, false)] {
            let store = ExperimentStore { schema_version: 1, experiments: vec![with_status(status)] };
            assert_eq!(active_trial(&store).is_some(), blocks, "{status:?}");
        }
        assert!(active_trial(&ExperimentStore::default()).is_none());
    }

    #[test]
    fn the_target_check_keeps_changed_unchanged_and_unread_apart() {
        use crate::history::ActiveCheck;
        assert_eq!(target_verification(Some(ActiveCheck::On)), Some(true));
        assert_eq!(target_verification(Some(ActiveCheck::Off)), Some(false));
        assert_eq!(target_verification(Some(ActiveCheck::Unreadable)), None, "unread is unknown");
        assert_eq!(target_verification(Some(ActiveCheck::Unrecognised)), None, "unprobed is unknown");
        assert_eq!(target_verification(None), None);
    }

    // ── §4.1 / §4.10 target reads (#583 lane 2) ──

    #[test]
    fn a_trial_starts_only_from_a_setting_that_reads_unchanged() {
        use crate::history::ActiveCheck;
        assert_eq!(pre_apply_refusal(ActiveCheck::Off), None);
        for check in [ActiveCheck::On, ActiveCheck::Unreadable, ActiveCheck::Unrecognised] {
            let why = pre_apply_refusal(check).unwrap_or_else(|| panic!("{check:?} must refuse"));
            if check != ActiveCheck::On {
                assert!(why.contains("nothing was changed"), "{check:?}: {why}");
            }
        }
    }

    #[test]
    fn the_final_state_is_judged_against_the_decision_and_a_verified_prior() {
        use crate::history::ActiveCheck::*;
        // A keep must still read as changed.
        assert_eq!(final_state_check(true, true, On), Some(true));
        assert_eq!(final_state_check(true, true, Off), Some(false));
        assert_eq!(final_state_check(true, false, On), Some(true), "a keep needs no prior read");
        // A restore must read back as unchanged — judged only when §4.1 proved that's where it began.
        assert_eq!(final_state_check(false, true, Off), Some(true));
        assert_eq!(final_state_check(false, true, On), Some(false));
        assert_eq!(final_state_check(false, false, On), None, "an unread prior can't be judged");
        assert_eq!(final_state_check(false, false, Off), None);
        for kept in [true, false] {
            assert_eq!(final_state_check(kept, true, Unreadable), None, "unread is unknown");
            assert_eq!(final_state_check(kept, true, Unrecognised), None);
        }
    }

    fn restored() -> ExperimentRecord {
        let mut r = with_status(ExperimentStatus::Restored);
        r.prior_state_verified = true;
        r.stop_reason = Some("user-restored".into());
        r
    }

    #[test]
    fn a_restore_that_reads_back_unchanged_stays_restored() {
        use crate::history::ActiveCheck;
        let mut r = restored();
        assert_eq!(settle_restore(&mut r, true, ActiveCheck::Off), None);
        assert_eq!(r.status, ExperimentStatus::Restored);
        assert_eq!(r.final_state_verified, Some(true));
        assert_eq!(r.stop_reason.as_deref(), Some("user-restored"));
    }

    #[test]
    fn a_restore_that_still_reads_changed_is_said_out_loud() {
        use crate::history::ActiveCheck;
        let mut r = restored();
        let msg = settle_restore(&mut r, true, ActiveCheck::On).expect("a still-changed read is never silent");
        assert!(msg.contains("Applied & history") && msg.starts_with("Compy restored"), "{msg}");
        assert_eq!(r.status, ExperimentStatus::Aborted);
        assert!(!r.kept);
        assert_eq!(r.final_state_verified, Some(false));
        let why = r.stop_reason.unwrap();
        assert!(why.starts_with("user-restored; ") && why.contains("Applied & history"), "{why}");

        // Reverted outside Compy, then set again: loud too, but never claims Compy restored it.
        let mut outside = restored();
        let msg = settle_restore(&mut outside, false, ActiveCheck::On).expect("never silent");
        assert!(!msg.contains("Compy restored") && msg.contains("outside Compy") && msg.contains("Applied & history"), "{msg}");
        assert_eq!((outside.status, outside.final_state_verified), (ExperimentStatus::Aborted, Some(false)));
    }

    #[test]
    fn an_unknown_final_read_stays_unknown_and_leaves_the_restore_alone() {
        use crate::history::ActiveCheck;
        let mut unread = restored();
        assert_eq!(settle_restore(&mut unread, true, ActiveCheck::Unreadable), None);
        assert_eq!((unread.status, unread.final_state_verified), (ExperimentStatus::Restored, None));
        // A pre-lane-2 record never read its prior state, so a changed read proves nothing about it.
        let mut legacy = restored();
        legacy.prior_state_verified = false;
        assert_eq!(settle_restore(&mut legacy, true, ActiveCheck::On), None);
        assert_eq!((legacy.status, legacy.final_state_verified), (ExperimentStatus::Restored, None));
    }

    #[test]
    fn a_change_reverted_during_the_test_is_never_credited_or_kept() {
        let now = Utc::now();
        let r = rec(90.0, 5);
        let improved = conclude_outcome(&r, 120.0, 5000, false, Some("Test"), Some(5), now);
        assert!(improved.keep, "fixture: a clean improvement");

        assert_eq!(guard_target_at_conclude(improved.clone(), Some(true)), improved, "still applied: unchanged");

        let reverted = guard_target_at_conclude(improved.clone(), Some(false));
        assert_eq!(reverted.verdict, "confounded");
        assert!(!reverted.keep);
        assert_eq!(trial_result_for(&reverted.verdict), TrialResult::Inconclusive);
        assert_eq!(reverted.stop_reason.as_deref(), Some("target-reverted-during-treatment"));
        assert_eq!(reverted.delta_low1_pct, improved.delta_low1_pct, "the measured delta is kept as evidence");

        // An unread setting can't be shown to have been in effect, so NO measured verdict stands:
        // not a win, not a flat result, not a regression, not even a crash (Codex r1 on #611).
        let flat = conclude_outcome(&r, 90.0, 5000, false, Some("Test"), Some(5), now);
        let worse = conclude_outcome(&r, 60.0, 5000, false, Some("Test"), Some(5), now);
        let crash = conclude_outcome(&r, 120.0, 5000, true, Some("Test"), Some(5), now);
        assert_eq!(
            [&improved, &flat, &worse, &crash].map(|o| o.verdict.as_str()),
            ["improved", "no-change", "regressed", "regressed"],
            "fixture"
        );
        for judged in [improved.clone(), flat, worse, crash.clone()] {
            let unread = guard_target_at_conclude(judged.clone(), None);
            assert_eq!(unread.verdict, "insufficient-evidence", "unread after {}", judged.verdict);
            assert!(!unread.keep, "§9: only a verified Better keeps");
            assert_eq!(unread.confidence, Confidence::Unknown);
            assert_eq!(noise_evidence_for(&unread, DEFAULT_NOISE_FLOOR_PCT, &NoiseLookup::Unmeasured, None), None, "nothing was judged");
            assert_eq!(unread.delta_low1_pct, judged.delta_low1_pct, "the measured delta is kept as evidence");
        }
        let crash_unread = guard_target_at_conclude(crash, None);
        assert!(crash_unread.stop_reason.as_deref().unwrap().contains("crash-during-treatment"));
        assert!(crash_unread.note.contains("crashed") && crash_unread.note.contains("without blaming"));

        // A verdict that already says it wasn't judged keeps its own, stronger reason.
        let other_game = conclude_outcome(&r, 120.0, 5000, false, Some("Other"), Some(5), now);
        assert_eq!(guard_target_at_conclude(other_game.clone(), Some(false)), other_game);
        assert_eq!(guard_target_at_conclude(other_game.clone(), None), other_game);
        let confounded = conclude_outcome(&r, 120.0, 5000, false, Some("Test"), Some(6), now);
        assert_eq!(guard_target_at_conclude(confounded.clone(), None), confounded);
    }

    #[test]
    fn the_simulator_trusts_a_live_read_over_the_ledger() {
        use crate::history::ActiveCheck::*;
        assert!(already_in_target(On, false), "set outside Compy: nothing to test");
        assert!(!already_in_target(Off, true), "reverted outside Compy: testable again");
        assert!(already_in_target(Unreadable, true), "unread falls back to the ledger");
        assert!(!already_in_target(Unrecognised, false));
    }

    fn pending_at(created_at: &str) -> ExperimentRecord {
        let mut r = with_status(ExperimentStatus::Pending);
        r.id = "exp:9-0".into();
        r.created_at = created_at.into();
        r.applied_change_id = String::new();
        r
    }

    fn row<'a>(id: &'a str, rec_id: &'a str, applied_at: &'a str, applied: bool) -> LedgerEntryRef<'a> {
        LedgerEntryRef { id, rec_id, applied_at, applied, rolled_back_at: None, outside_recorded_at: None }
    }

    const START: &str = "2026-09-28T12:00:00+00:00";

    #[test]
    fn an_interrupted_start_owns_the_first_later_apply_of_its_own_rec() {
        let p = pending_at(START);
        let ledger = [
            row("older", "test-rec", "2026-09-28T11:59:59+00:00", true), // applied before the start
            row("other-rec", "game-mode", "2026-09-28T12:00:01+00:00", true),
            row("undone", "test-rec", "2026-09-28T12:00:01+00:00", false), // rolled back
            row("ours", "test-rec", "2026-09-28T12:00:02+00:00", true),
            row("later", "test-rec", "2026-09-28T12:05:00+00:00", true),
        ];
        assert_eq!(interrupted_start_change(&p, &ledger, &[]), Some("ours"));
        assert_eq!(interrupted_start_change(&p, &ledger, &["ours"]), Some("later"), "claimed ids are skipped");
        assert_eq!(interrupted_start_change(&p, &ledger[..3], &[]), None, "nothing of ours was applied");
    }

    #[test]
    fn an_undated_apply_is_treated_as_possibly_ours_but_a_dated_one_wins() {
        let p = pending_at(START);
        let undated = [row("undated", "test-rec", "not-a-date", true)];
        assert_eq!(interrupted_start_change(&p, &undated, &[]), Some("undated"), "unknown → loud, never dropped");
        let both = [row("undated", "test-rec", "not-a-date", true), row("dated", "test-rec", "2026-09-28T12:00:02+00:00", true)];
        assert_eq!(interrupted_start_change(&p, &both, &[]), Some("dated"));
    }

    /// The live read, when the setting reads unchanged.
    fn unchanged(_: &str) -> Option<bool> {
        Some(false)
    }

    /// The live read, on a path that must never need it: a start whose change the ledger shows.
    fn never_read(rec_id: &str) -> Option<bool> {
        panic!("the live read is only for a start with no change record ({rec_id})")
    }

    #[test]
    fn reconcile_never_drops_a_start_on_a_live_read() {
        // #611 r3 review: Game Bar's apply writes two values in turn, and its live read needs both, so
        // an apply cut off after the first reads as unchanged. A start with no change record stays as
        // a loud record that says so, whatever the setting reads.
        let mut store = ExperimentStore { schema_version: 1, experiments: vec![with_status(ExperimentStatus::Kept), pending_at(START)] };
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&[]), unchanged, Utc::now());
        assert_eq!(out, vec![InterruptedStart::ChangeUnrecorded]);
        assert_eq!(store.experiments.len(), 2, "nothing is dropped");
        assert_eq!(store.experiments[0].status, ExperimentStatus::Kept, "the kept record is untouched");
        let r = &store.experiments[1];
        assert_eq!(r.status, ExperimentStatus::Aborted);
        assert!(!r.kept);
        assert_eq!(r.trial_result, Some(TrialResult::Unmeasurable));
        let why = r.stop_reason.as_deref().unwrap();
        assert!(why.starts_with("interrupted-start: "), "{why}");
        assert!(why.contains("reads as not changed") && why.contains("part-way"), "{why}");
        assert!(why.contains("no undo record") && why.contains("set it back there"), "{why}");
        assert!(active_trial(&store).is_none(), "a loud record never blocks the next start");
    }

    #[test]
    fn reconcile_never_reads_an_empty_ledger_as_nothing_changed() {
        // #611 r2 review: a ledger set aside as damaged loads empty, and an apply that changed Windows
        // then failed to save its receipt leaves no row. Neither may drop the record on the ledger's
        // word alone (and, since r3, nor may a live read: see the test above).
        for live in [Some(true), None] {
            let mut store = ExperimentStore { schema_version: 1, experiments: vec![pending_at(START)] };
            let asked = std::cell::RefCell::new(Vec::new());
            let read = |rec_id: &str| {
                asked.borrow_mut().push(rec_id.to_string());
                live
            };
            let out = reconcile_interrupted_starts_in(&mut store, Ok(&[]), read, Utc::now());
            assert_eq!(out, vec![InterruptedStart::ChangeUnrecorded], "{live:?}");
            assert_eq!(asked.into_inner(), vec!["test-rec".to_string()], "the Trial's own setting is read");
            let r = &store.experiments[0];
            assert_eq!(r.status, ExperimentStatus::Aborted, "loud, never dropped: {live:?}");
            assert!(!r.kept);
            assert_eq!(r.trial_result, Some(TrialResult::Unmeasurable));
            assert!(r.concluded_at.is_some());
            let why = r.stop_reason.as_deref().unwrap();
            assert!(why.starts_with("interrupted-start: "), "{why}");
            assert!(why.contains("no undo") && why.contains("Check the setting in Windows"), "{why}");
            assert!(active_trial(&store).is_none(), "a loud record no longer blocks the next start");
        }
    }

    #[test]
    fn reconcile_names_a_change_that_is_still_applied_and_never_keeps_it() {
        let mut store = ExperimentStore { schema_version: 1, experiments: vec![pending_at(START)] };
        let ledger = [row("ours", "test-rec", "2026-09-28T12:00:02+00:00", true)];
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&ledger), never_read, Utc::now());
        assert_eq!(out, vec![InterruptedStart::ChangeStillApplied]);
        let r = &store.experiments[0];
        assert_eq!(r.status, ExperimentStatus::Aborted, "loud, never a silent keep");
        assert!(!r.kept);
        assert_eq!(r.applied_change_id, "ours", "the record now names the change so Fix can undo it");
        assert_eq!(r.trial_result, Some(TrialResult::Unmeasurable), "nothing was measured");
        assert!(r.concluded_at.is_some());
        assert!(r.stop_reason.as_deref().unwrap().contains("undo it in Test → Applied & history"));
        assert!(active_trial(&store).is_none(), "an interrupted start no longer blocks the next one");
    }

    #[test]
    fn reconcile_with_an_unreadable_ledger_leaves_a_loud_record_never_a_hidden_pending() {
        // Codex r4: left Pending, the record stays hidden from the bench while it blocks every later
        // start for as long as the read keeps failing, and a change it may have made gets no record.
        let mut named = pending_at(START);
        named.applied_change_id = "ours".into();
        let mut store = ExperimentStore { schema_version: 1, experiments: vec![pending_at(START), named] };
        let out = reconcile_interrupted_starts_in(&mut store, Err("parse: bad json"), never_read, Utc::now());
        assert_eq!(out, vec![InterruptedStart::LedgerUnreadable, InterruptedStart::LedgerUnreadable]);
        for r in &store.experiments {
            assert_eq!(r.status, ExperimentStatus::Aborted, "loud, never left Pending");
            assert!(!r.kept);
            assert_eq!(r.trial_result, Some(TrialResult::Unmeasurable), "nothing was measured");
            assert!(r.concluded_at.is_some());
            let why = r.stop_reason.as_deref().unwrap();
            assert!(why.contains("change history can't be read") && why.contains("check the setting in Windows"), "{why}");
        }
        let (unnamed, named) = (&store.experiments[0], &store.experiments[1]);
        assert!(unnamed.stop_reason.as_deref().unwrap().contains("can't tell whether the change was made"));
        assert_eq!(named.applied_change_id, "ours", "the saved link to the change is kept");
        assert!(named.stop_reason.as_deref().unwrap().contains("(ours) was applied"));
        assert!(active_trial(&store).is_none(), "an unreadable ledger no longer blocks every later start");
    }

    #[test]
    fn a_start_that_saved_its_change_id_is_matched_by_that_id_alone() {
        // The reviewer's case: the start named "ours", then a later Fix apply of the same rec landed
        // before any reconcile ran. The heuristic would pick the earliest; the saved id must win.
        let mut p = pending_at(START);
        p.applied_change_id = "ours".into();
        let ledger = [
            row("fix-later", "test-rec", "2026-09-28T12:00:01+00:00", true),
            row("ours", "test-rec", "2026-09-28T12:00:02+00:00", true),
        ];
        let mut store = ExperimentStore { schema_version: 1, experiments: vec![p] };
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&ledger), never_read, Utc::now());
        assert_eq!(out, vec![InterruptedStart::ChangeStillApplied]);
        assert_eq!(store.experiments[0].applied_change_id, "ours");
        assert_eq!(store.experiments[0].status, ExperimentStatus::Aborted);
    }

    #[test]
    fn a_saved_change_that_is_rolled_back_or_gone_is_reported_as_such() {
        let mut p = pending_at(START);
        p.applied_change_id = "ours".into();
        let rolled_back = [row("ours", "test-rec", "2026-09-28T12:00:02+00:00", false)];
        let mut store = ExperimentStore { schema_version: 1, experiments: vec![p.clone()] };
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&rolled_back), never_read, Utc::now());
        assert_eq!(out, vec![InterruptedStart::ChangeAlreadyRolledBack]);
        let r = &store.experiments[0];
        assert_eq!((r.status, r.kept, r.trial_result), (ExperimentStatus::Restored, false, Some(TrialResult::Unmeasurable)));

        let mut store = ExperimentStore { schema_version: 1, experiments: vec![p] };
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&[]), never_read, Utc::now());
        assert_eq!(out, vec![InterruptedStart::ChangeMissing]);
        let r = &store.experiments[0];
        assert_eq!(r.status, ExperimentStatus::Aborted, "a named change the ledger lost is loud, never dropped");
        let why = r.stop_reason.as_deref().unwrap();
        assert!(why.contains("ours") && why.contains("Applied & history"), "{why}");
    }

    #[test]
    fn reconcile_leaves_settled_and_running_experiments_alone() {
        use ExperimentStatus::*;
        let before: Vec<ExperimentRecord> = [Running, Kept, Restored, Aborted].into_iter().map(with_status).collect();
        let mut store = ExperimentStore { schema_version: 1, experiments: before.clone() };
        let ledger = [row("x", "test-rec", "2026-09-28T12:00:02+00:00", true)];
        assert!(reconcile_interrupted_starts_in(&mut store, Ok(&ledger), never_read, Utc::now()).is_empty());
        let statuses: Vec<_> = store.experiments.iter().map(|e| e.status).collect();
        assert_eq!(statuses, vec![Running, Kept, Restored, Aborted], "a Running experiment legitimately spans restarts");
    }

    #[test]
    fn get_experiments_never_hands_the_ui_a_pending_record() {
        // Source check: the unlocked read path filters Pending (a refresh mid-apply must not show it).
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn get_experiments()").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        assert!(body.contains("ExperimentStatus::Pending"), "get_experiments must drop Pending records");
    }

    // ─── #583 lane 2b: sessions looked up by id, and the §11 noise evidence ───

    const BASE_ID: &str = "2026-09-01T10:00:00.123456789+00:00";
    const TREAT_ID: &str = "2026-09-01T12:00:00.987654321+00:00";
    const STARTED: &str = "2026-09-01T11:00:00+00:00";
    /// The apply returned five minutes after the start began (a UAC prompt sat open).
    const APPLIED: &str = "2026-09-01T11:05:00+00:00";

    /// A fully recorded cs2 session on the owner-class rig; mutate the clone per test.
    fn session(started_at: &str, low1: f64) -> SessionSummary {
        SessionSummary {
            started_at: started_at.into(),
            duration_secs: 900,
            process_name: "cs2.exe".into(),
            samples: 900,
            avg_fps: 200.0,
            avg_frametime_ms: 5.0,
            low1_fps_est: low1,
            peak_gpu_temp_c: None,
            peak_gpu_usage_pct: None,
            peak_ram_used_bytes: None,
            ram_total_bytes: None,
            compy_changes_active: Some(0),
            compy_changes_per_change: true,
            compy_changes_cant_confirm: Some(0),
            compy_changes_legacy_active: None,
            compy_changes_since_set_aside: None,
            hw_fingerprint: Some(crate::hardware::HwFingerprint {
                hash: "deadbeef".into(),
                gpu: "Radeon RX 9070 XT".into(),
                gpu_driver: "25.7.1".into(),
                ram_gb: 32,
                display: "2560x1440@165".into(),
            }),
            gaming_mode_active: Some(false),
            gaming_mode_plan: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
            fps_series: Vec::new(),
            capture_capabilities: Some(crate::capture::CaptureCapabilities::etw_dxgi(None)),
            game_state: Some(crate::game_state::GameStateFingerprint {
                resolution_width: Some(2560),
                resolution_height: Some(1440),
                display_refresh_hz: Some(165),
                graphics_api: Some("DirectX 12".into()),
                windows_build: Some("26200.1".into()),
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

    /// A Running cs2 experiment started at `STARTED` against the `BASE_ID` session.
    fn running() -> ExperimentRecord {
        ExperimentRecord {
            game: "cs2.exe".into(),
            created_at: STARTED.into(),
            applied_at: Some(APPLIED.into()),
            baseline_session_id: Some(BASE_ID.into()),
            ..rec(150.0, 5)
        }
    }

    fn treatment_err(rec: &ExperimentRecord, sessions: &[SessionSummary], id: &str) -> String {
        resolve_treatment(rec, sessions, id).map(|_| ()).unwrap_err()
    }

    #[test]
    fn the_baseline_is_read_from_the_session_store_by_id() {
        let sessions = [session("2026-08-31T09:00:00+00:00", 90.0), session(BASE_ID, 150.0)];
        let b = resolve_baseline(&sessions, BASE_ID).unwrap();
        assert_eq!((b.started_at.as_str(), b.low1_fps_est, b.avg_fps), (BASE_ID, 150.0, 200.0));
        assert_eq!(b.process_name, "cs2.exe");
    }

    #[test]
    fn a_baseline_that_is_missing_unmeasured_gameless_or_ambiguous_is_refused() {
        let why = resolve_baseline(&[], BASE_ID).unwrap_err();
        assert!(why.contains("isn't in your session history"), "{why}");

        for (avg, low1) in [(0.0, 150.0), (200.0, 0.0), (200.0, f64::NAN), (f64::INFINITY, 150.0)] {
            let mut s = session(BASE_ID, low1);
            s.avg_fps = avg;
            let why = resolve_baseline(&[s], BASE_ID).unwrap_err();
            assert!(why.contains("no frame-rate reading"), "avg {avg} low1 {low1}: {why}");
        }

        let mut s = session(BASE_ID, 150.0);
        s.process_name = "   ".into();
        let why = resolve_baseline(&[s], BASE_ID).unwrap_err();
        assert!(why.contains("didn't record which game"), "{why}");

        let why = resolve_baseline(&[session(BASE_ID, 150.0), session(BASE_ID, 140.0)], BASE_ID).unwrap_err();
        assert!(why.contains("share"), "two sessions with one id are refused, never guessed: {why}");
    }

    /// P4-show-f1: a session the game spent behind another window has no reading; it is refused as a
    /// baseline and as an after-reading, and the refusal says why rather than "no reading".
    #[test]
    fn a_session_behind_another_window_the_whole_time_is_never_a_baseline_or_treatment() {
        let behind = |id: &str| {
            let mut s = session(id, 0.0);
            (s.samples, s.avg_fps, s.avg_frametime_ms, s.background_secs_excluded) = (0, 0.0, 0.0, Some(1200));
            s
        };
        let why = resolve_baseline(&[behind(BASE_ID)], BASE_ID).unwrap_err();
        assert!(why.contains("another window was in front the whole time"), "{why}");
        let why = treatment_err(&running(), &[session(BASE_ID, 150.0), behind(TREAT_ID)], TREAT_ID);
        assert!(why.contains("another window was in front the whole time"), "{why}");
        // Nor does it set the band the next Trial is judged on: the bench's baseline pick skips it.
        assert!(!has_frame_reading(&behind(TREAT_ID)));
    }

    #[test]
    fn a_comparable_later_session_is_accepted_as_the_treatment() {
        let sessions = [session(BASE_ID, 150.0), session(TREAT_ID, 180.0)];
        let (t, pairing) = resolve_treatment(&running(), &sessions, TREAT_ID).unwrap();
        assert_eq!((t.started_at.as_str(), t.low1_fps_est, t.samples), (TREAT_ID, 180.0, 900));
        assert_eq!(pairing.verdict, Comparability::Comparable);
        assert!(pairing.changed_context.is_empty() && pairing.missing_context.is_empty());
    }

    #[test]
    fn a_session_that_did_not_record_its_conditions_concludes_as_partial() {
        let mut t = session(TREAT_ID, 180.0);
        t.game_state = None;
        let sessions = [session(BASE_ID, 150.0), t];
        let (_, pairing) = resolve_treatment(&running(), &sessions, TREAT_ID).unwrap();
        assert_eq!(pairing.verdict, Comparability::Partial);
        assert_eq!(pairing.confidence_limit, Confidence::Medium);
        assert!(!pairing.missing_context.is_empty());
    }

    #[test]
    fn broken_session_refs_are_refused_before_anything_is_judged() {
        let sessions = [session(BASE_ID, 150.0), session(TREAT_ID, 180.0)];

        let legacy = ExperimentRecord { baseline_session_id: None, ..running() };
        let why = treatment_err(&legacy, &sessions, TREAT_ID);
        assert!(why.contains("restore it and start a new one"), "a pre-lane-2b trial: {why}");

        let why = treatment_err(&running(), &sessions, BASE_ID);
        assert!(why.contains("the baseline itself"), "{why}");

        let why = treatment_err(&running(), &[session(TREAT_ID, 180.0)], TREAT_ID);
        assert!(why.contains("baseline session is no longer"), "a pruned baseline: {why}");

        let why = treatment_err(&running(), &[session(BASE_ID, 150.0)], TREAT_ID);
        assert!(why.contains("isn't in your session history"), "{why}");

        let dup = [session(BASE_ID, 150.0), session(TREAT_ID, 180.0), session(TREAT_ID, 170.0)];
        let why = treatment_err(&running(), &dup, TREAT_ID);
        assert!(why.contains("share"), "{why}");

        let mut unmeasured = session(TREAT_ID, 0.0);
        unmeasured.avg_fps = 0.0;
        let why = treatment_err(&running(), &[session(BASE_ID, 150.0), unmeasured], TREAT_ID);
        assert!(why.contains("no frame-rate reading"), "{why}");

        let mut gameless = session(TREAT_ID, 180.0);
        gameless.process_name = String::new();
        let why = treatment_err(&running(), &[session(BASE_ID, 150.0), gameless], TREAT_ID);
        assert!(why.contains("didn't record which game"), "{why}");
    }

    #[test]
    fn a_session_played_before_the_change_is_never_the_after_reading() {
        let before = "2026-09-01T10:30:00+00:00"; // after the baseline, before the change
        let sessions = [session(BASE_ID, 150.0), session(before, 180.0)];
        let why = treatment_err(&running(), &sessions, before);
        assert!(why.contains("played before the change was applied"), "{why}");

        // Started after the Trial began but before the apply returned (the UAC prompt was open): the
        // change wasn't in place yet, so it can't be the after-reading (Codex r1 on #611).
        let mid_apply = "2026-09-01T11:02:00+00:00";
        let sessions = [session(BASE_ID, 150.0), session(mid_apply, 180.0)];
        let why = treatment_err(&running(), &sessions, mid_apply);
        assert!(why.contains("played before the change was applied"), "{why}");

        // A time Compy can't read is refused, never assumed to be later; so is a record that never
        // said when its change took effect.
        let sessions = [session(BASE_ID, 150.0), session(TREAT_ID, 180.0)];
        let garbled = ExperimentRecord { applied_at: Some("not a time".into()), ..running() };
        let why = treatment_err(&garbled, &sessions, TREAT_ID);
        assert!(why.contains("can't tell whether"), "{why}");
        let undated = ExperimentRecord { applied_at: None, ..running() };
        let why = treatment_err(&undated, &sessions, TREAT_ID);
        assert!(why.contains("didn't record when its change took effect"), "{why}");
    }

    #[test]
    fn a_pair_that_is_not_comparable_is_refused() {
        let base = session(BASE_ID, 150.0);

        let mut other_game = session(TREAT_ID, 180.0);
        other_game.process_name = "valorant.exe".into();
        let why = treatment_err(&running(), &[base.clone(), other_game], TREAT_ID);
        assert!(why.contains("aren't comparable") && why.contains("different games"), "{why}");

        let mut other_gpu = session(TREAT_ID, 180.0);
        other_gpu.hw_fingerprint.as_mut().unwrap().gpu = "GeForce RTX 5080".into();
        let why = treatment_err(&running(), &[base.clone(), other_gpu], TREAT_ID);
        assert!(why.contains("aren't comparable"), "{why}");

        // Nothing recorded on either side: comparability is Unknown, never assumed equal.
        let bare = |id: &str, low1: f64| SessionSummary {
            hw_fingerprint: None,
            game_state: None,
            capture_capabilities: None,
            ..session(id, low1)
        };
        let why = treatment_err(&running(), &[bare(BASE_ID, 150.0), bare(TREAT_ID, 180.0)], TREAT_ID);
        assert!(why.contains("don't share any recorded rig or conditions"), "{why}");
    }

    #[test]
    fn a_changed_condition_aborts_and_restores_instead_of_leaving_the_trial_stuck() {
        // `derive` lists each change (driver and Windows stay Comparable, resolution goes Partial).
        let mut new_driver = session(TREAT_ID, 180.0);
        new_driver.hw_fingerprint.as_mut().unwrap().gpu_driver = "25.8.1".into();
        let mut new_windows = session(TREAT_ID, 180.0);
        new_windows.game_state.as_mut().unwrap().windows_build = Some("26200.2".into());
        let mut new_res = session(TREAT_ID, 180.0);
        new_res.game_state.as_mut().unwrap().resolution_width = Some(1920);
        new_res.game_state.as_mut().unwrap().resolution_height = Some(1080);
        // CR-trial-gm-between: a Gaming Mode session that ran during the after-session only.
        let mut new_gm = session(TREAT_ID, 180.0);
        new_gm.gaming_mode_active = Some(true);

        for (what, treatment) in [
            ("GPU driver", new_driver),
            ("Windows build", new_windows),
            ("Resolution", new_res),
            ("Gaming Mode", new_gm),
        ] {
            // Accepted as the after-reading, so the Trial can end (§7 abort) rather than be refused
            // forever.
            let sessions = [session(BASE_ID, 150.0), treatment];
            let (_, pairing) = resolve_treatment(&running(), &sessions, TREAT_ID).unwrap();
            assert!(!pairing.changed_context.is_empty(), "{what}");

            // Even a clear improvement, and even a crash, is confounded and restored — never kept.
            let crash = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, Some("Test"), Some(5), Utc::now());
            for judged in [measured(180.0), crash] {
                let o = with_comparability(judged.clone(), &pairing);
                assert_eq!(o.verdict, "confounded", "{what}");
                assert!(!o.keep, "{what}: a confounded Trial restores");
                assert_eq!(o.stop_reason.as_deref(), Some("conditions-changed-between-sessions"));
                assert!(o.confidence <= Confidence::Low, "{what}: {:?}", o.confidence);
                assert!(o.note.contains(what), "{what}: the note names the changed condition: {}", o.note);
                assert_eq!(o.delta_low1_pct, judged.delta_low1_pct, "the measured delta stays as evidence");
                assert_eq!(trial_result_for(&o.verdict), TrialResult::Inconclusive);
                assert_eq!(noise_evidence_for(&o, DEFAULT_NOISE_FLOOR_PCT, &NoiseLookup::Unmeasured, None), None, "{what}");
            }
        }
    }

    #[test]
    fn a_reported_crash_restores_even_when_its_session_cannot_be_used() {
        // A crash beats every session refusal; without a crash the refusal stands.
        assert_eq!(crash_overrides_refusal::<u8>(Err("no session".into()), true), Ok(None));
        assert_eq!(crash_overrides_refusal::<u8>(Err("no session".into()), false), Err("no session".into()));
        assert_eq!(crash_overrides_refusal(Ok(7u8), true), Ok(Some(7)));
        assert_eq!(crash_overrides_refusal(Ok(7u8), false), Ok(Some(7)));

        // The crash outcome restores and claims no reading or noise band.
        let o = crash_without_reading();
        assert!(!o.keep);
        assert_eq!(o.stop_reason.as_deref(), Some("crash-during-treatment"));
        assert_eq!(noise_evidence_for(&o, DEFAULT_NOISE_FLOOR_PCT, &NoiseLookup::Unmeasured, None), None);
        assert!(o.note.contains("does not rely on the frame-rate reading"), "{}", o.note);
        // Same verdict, confidence and note as a crash judged on a real session.
        let with_session = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, None, Some(5), Utc::now());
        assert_eq!(
            (&o.verdict, o.confidence, &o.note, &o.stop_reason),
            (&with_session.verdict, with_session.confidence, &with_session.note, &with_session.stop_reason)
        );
    }

    fn pairing_for(treatment: SessionSummary) -> crate::comparability::SessionComparability {
        crate::comparability::derive(&session(BASE_ID, 150.0), &treatment)
    }

    fn partial_pairing() -> crate::comparability::SessionComparability {
        let mut t = session(TREAT_ID, 180.0);
        t.game_state = None;
        let p = pairing_for(t);
        assert_eq!(p.verdict, Comparability::Partial);
        p
    }

    /// A clean, attributable outcome on `rec(150.0, 5)`: the 1% low moved to `treatment_low1`.
    fn measured(treatment_low1: f64) -> ConcludeOutcome {
        conclude_outcome(&rec(150.0, 5), treatment_low1, 5000, false, Some("Test"), Some(5), Utc::now())
    }

    #[test]
    fn a_comparable_pairing_leaves_the_outcome_alone() {
        let o = measured(180.0);
        assert_eq!(o.verdict, "improved");
        assert_eq!(with_comparability(o.clone(), &pairing_for(session(TREAT_ID, 180.0))), o);
    }

    // TG-preflight: a power plan that differed between the two sessions, or changed during one,
    // confounds and restores like any changed recorded condition; unrecorded never does.
    fn with_plan(mut s: SessionSummary, guid: Option<&str>, changed: Option<bool>) -> SessionSummary {
        let g = s.game_state.get_or_insert_with(Default::default);
        g.power_plan_guid = guid.map(str::to_string);
        g.power_plan_changed = changed;
        s
    }
    const BAL: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
    const HIGH: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";

    #[test]
    fn a_power_plan_that_differed_or_changed_confounds_and_restores() {
        let m = measured(180.0);
        let base = with_plan(session(BASE_ID, 150.0), Some(BAL), Some(false));
        let same = with_plan(session(TREAT_ID, 180.0), Some(&BAL.to_uppercase()), Some(false));
        assert_eq!(with_power_plan_check(m.clone(), Some(&base), &same, "visual-effects"), m.clone());
        let other = with_plan(session(TREAT_ID, 180.0), Some(HIGH), Some(false));
        let o = with_power_plan_check(m.clone(), Some(&base), &other, "visual-effects");
        assert_eq!((o.verdict.as_str(), o.keep), ("confounded", false));
        assert_eq!(o.stop_reason.as_deref(), Some("conditions-changed-between-sessions"));
        assert!(o.note.contains("the Windows power plan differed between the two sessions"), "{}", o.note);
        let mid = with_plan(session(TREAT_ID, 180.0), Some(BAL), Some(true));
        let o = with_power_plan_check(m.clone(), Some(&base), &mid, "visual-effects");
        assert!(!o.keep && o.note.contains("changed during the after-session"), "{}", o.note);
    }

    #[test]
    fn the_power_plan_check_never_reads_a_difference_it_did_not_record() {
        let m = measured(180.0);
        let base = with_plan(session(BASE_ID, 150.0), Some(BAL), None);
        let unread = with_plan(session(TREAT_ID, 180.0), None, None);
        assert_eq!(with_power_plan_check(m.clone(), Some(&base), &unread, "visual-effects"), m.clone());
        assert_eq!(with_power_plan_check(m.clone(), None, &unread, "visual-effects"), m.clone());
        // The plan itself moves the plan between the sessions by design: no confound for that alone.
        let other = with_plan(session(TREAT_ID, 180.0), Some(HIGH), Some(false));
        assert_eq!(with_power_plan_check(m.clone(), Some(&base), &other, "power-ultimate"), m.clone());
        // Opus r1 MUST-FIX: a setting OF the plan leaves the plan where it was, so a switch is a confound.
        assert_eq!(with_power_plan_check(m.clone(), Some(&base), &other, "pcie-aspm-off").verdict, "confounded");
        // Opus r1 SHOULD-FIX: a switch DURING a session confounds a Trial of the plan too.
        let mid = with_plan(session(TREAT_ID, 180.0), Some(HIGH), Some(true));
        assert_eq!(with_power_plan_check(m.clone(), Some(&base), &mid, "power-ultimate").verdict, "confounded");
        // Gaming Mode lays its own plan over a session; its checks (comparability) cover that.
        let mut gm = other.clone();
        gm.gaming_mode_active = Some(true);
        assert_eq!(with_power_plan_check(m.clone(), Some(&base), &gm, "visual-effects"), m.clone());
        // A stronger reason already given stands.
        let already = with_comparability(m.clone(), &pairing_for(session(TREAT_ID, 180.0)));
        let first = ConcludeOutcome { verdict: "not-comparable".into(), ..already };
        assert_eq!(with_power_plan_check(first.clone(), Some(&base), &other, "visual-effects"), first);
    }

    #[test]
    fn preflight_names_each_recorded_difference_and_nothing_unrecorded() {
        use crate::game_state::GameStateFingerprint as G;
        let base = G {
            gpu_driver: Some("25.7.1".into()),
            windows_build: Some("26200.7000".into()),
            resolution_width: Some(2560),
            resolution_height: Some(1440),
            power_plan_guid: Some(BAL.into()),
            gaming_mode_active: Some(false),
            ..G::default()
        };
        assert!(preflight_diffs(&base, &base.clone(), "visual-effects").is_empty());
        let live = G {
            gpu_driver: Some("25.8.1".into()),
            windows_build: Some("26200.7100".into()),
            resolution_width: Some(1920),
            resolution_height: Some(1080),
            power_plan_guid: Some(HIGH.into()),
            ..G::default()
        };
        let keys: Vec<String> = preflight_diffs(&base, &live, "visual-effects").into_iter().map(|d| d.key).collect();
        assert_eq!(keys, ["gpu-driver", "windows-build", "resolution", "power-plan"]);
        let d = &preflight_diffs(&base, &live, "visual-effects")[2];
        assert_eq!((d.before.as_str(), d.after.as_str()), ("2560×1440", "1920×1080"));
        // Opus r1 SHOULD-FIX: Windows' own plans are named, so the step can say which to switch back to.
        let p = &preflight_diffs(&base, &live, "visual-effects")[3];
        assert_eq!((p.before.as_str(), p.after.as_str()), ("Balanced", "High performance"));
        let custom = G { power_plan_guid: Some("22222222-2222-2222-2222-222222222222".into()), ..base.clone() };
        assert_eq!(preflight_diffs(&base, &custom, "visual-effects")[0].after, "22222222-2222-2222-2222-222222222222");
        // Opus r1 SHOULD-FIX: refresh and monitor, which the conclude also compares.
        let refresh = G { display_refresh_hz: Some(60), active_display_identity: Some("DEL U2720Q".into()), ..base.clone() };
        let screen = G { display_refresh_hz: Some(165), active_display_identity: Some("AOC 24G2".into()), ..base.clone() };
        let keys: Vec<String> = preflight_diffs(&refresh, &screen, "visual-effects").into_iter().map(|d| d.key).collect();
        assert_eq!(keys, ["refresh", "display"]);
        // Unread live values are never a difference; only a Trial of the plan itself never names it.
        assert!(preflight_diffs(&base, &G::default(), "visual-effects").is_empty());
        let plan_only = G { power_plan_guid: Some(HIGH.into()), ..base.clone() };
        assert!(preflight_diffs(&base, &plan_only, "power-ultimate").is_empty());
        assert_eq!(preflight_diffs(&base, &plan_only, "pcie-aspm-off").len(), 1);
        let gm_base = G { gaming_mode_active: Some(true), ..base.clone() };
        assert!(preflight_diffs(&gm_base, &plan_only, "visual-effects").is_empty());
    }

    #[test]
    fn a_partial_pairing_caps_confidence_and_names_what_went_unchecked() {
        let pairing = partial_pairing();
        let o = with_comparability(measured(180.0), &pairing);
        assert_eq!(o.verdict, "improved", "comparability limits trust, never flips the verdict");
        assert!(o.confidence <= Confidence::Medium, "{:?}", o.confidence);
        assert!(o.note.contains("not every condition could be checked"), "{}", o.note);
        assert!(o.note.contains(&pairing.missing_context[0]), "{}", o.note);
        assert!(!o.note.contains("same rig and game"), "no like-for-like claim it couldn't check: {}", o.note);

        // A note that isn't the measured one keeps its own words and adds the caveat.
        let thin = conclude_outcome(&rec(150.0, 5), 180.0, 10, false, Some("Test"), Some(5), Utc::now());
        let o = with_comparability(thin.clone(), &pairing);
        assert!(o.note.starts_with(&thin.note), "{}", o.note);
        assert!(o.note.contains("Not every condition could be checked either"), "{}", o.note);
    }

    #[test]
    fn the_noise_band_is_recorded_only_when_the_verdict_was_judged_against_it() {
        let band = DEFAULT_NOISE_FLOOR_PCT;
        for (low1, verdict) in [(180.0, "improved"), (150.5, "no-change"), (100.0, "regressed")] {
            let o = measured(low1);
            assert_eq!(o.verdict, verdict);
            assert_eq!(
                noise_evidence_for(&o, band, &NoiseLookup::Unmeasured, None),
                Some(NoiseEvidence { band_pct: band, measured_noise_pct: None, measured_noise_stale: None, between_sessions: None }),
                "{verdict} was judged against the band"
            );
        }

        let crash = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, Some("Test"), Some(5), Utc::now());
        let thin = conclude_outcome(&rec(150.0, 5), 180.0, 10, false, Some("Test"), Some(5), Utc::now());
        let confounded = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Test"), Some(6), Utc::now());
        let wrong_game = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Other"), Some(5), Utc::now());
        let reverted = guard_target_at_conclude(measured(180.0), Some(false));
        let unread = guard_target_at_conclude(measured(180.0), None);
        for o in [crash, thin, confounded, wrong_game, reverted, unread] {
            assert_eq!(noise_evidence_for(&o, band, &NoiseLookup::Unmeasured, None), None, "{} never looked at the band", o.verdict);
        }
    }

    #[test]
    fn a_calibrated_game_noise_fills_the_receipt_and_a_stale_one_says_so() {
        // P4-noise-store: the receipt carries this game's measured noise when Compy has a current
        // calibration for it, and says "measured, but before an update" instead of using an old one.
        let band = DEFAULT_NOISE_FLOOR_PCT;
        let o = measured(180.0);
        assert_eq!(
            noise_evidence_for(&o, band, &NoiseLookup::Measured(1.8), None),
            Some(NoiseEvidence { band_pct: band, measured_noise_pct: Some(1.8), measured_noise_stale: None, between_sessions: None })
        );
        assert_eq!(
            noise_evidence_for(&o, band, &NoiseLookup::Stale(StaleReason::Unconfirmed), None),
            Some(NoiseEvidence { band_pct: band, measured_noise_pct: None, measured_noise_stale: Some(StaleReason::Unconfirmed), between_sessions: None })
        );
        assert_eq!(
            noise_evidence_for(&o, band, &NoiseLookup::Unmeasured, None),
            Some(NoiseEvidence { band_pct: band, measured_noise_pct: None, measured_noise_stale: None, between_sessions: None })
        );
        let crash = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, Some("Test"), Some(5), Utc::now());
        assert_eq!(noise_evidence_for(&crash, band, &NoiseLookup::Measured(1.8), None), None, "nothing was judged");
    }

    #[test]
    fn the_treatment_sessions_game_and_rig_pick_the_calibration() {
        let mut store = crate::noise_floor::NoiseFloorStore::default();
        let mut session = session(BASE_ID, 150.0);
        let at = crate::noise_floor::NoiseConditions::of_session(&session).expect("game + rig recorded");
        assert!(crate::noise_floor::upsert(&mut store, &at, 2.4, 10, "t"));
        assert_eq!(crate::noise_floor::lookup(&store, &at), NoiseLookup::Measured(2.4));
        let mut new_driver = session.clone();
        new_driver.hw_fingerprint.as_mut().unwrap().gpu_driver = "25.8.1".into();
        new_driver.hw_fingerprint.as_mut().unwrap().hash = "cafef00d".into();
        let later = crate::noise_floor::NoiseConditions::of_session(&new_driver).unwrap();
        assert_eq!(crate::noise_floor::lookup(&store, &later), NoiseLookup::Stale(StaleReason::Changed));
        let mut unread = session.clone();
        if let Some(f) = unread.hw_fingerprint.as_mut() {
            (f.gpu, f.gpu_driver, f.ram_gb) = (String::new(), String::new(), 0);
        }
        assert_eq!(crate::noise_floor::NoiseConditions::of_session(&unread), None, "an unread rig matches nothing");
        assert_eq!(crate::noise_floor::lookup_for_session(&unread), NoiseLookup::Unmeasured);
        session.hw_fingerprint = None;
        assert_eq!(crate::noise_floor::NoiseConditions::of_session(&session), None, "no rig, nothing to match");
    }

    #[test]
    fn a_receipt_with_measured_noise_still_loads_in_an_older_compy() {
        /// NoiseEvidence as builds before P4-noise-store declared it.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OldNoiseEvidence {
            band_pct: f64,
            #[serde(default)]
            measured_noise_pct: Option<f64>,
        }
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OldRecord {
            id: String,
            #[serde(default)]
            noise_evidence: Option<OldNoiseEvidence>,
        }
        #[derive(Deserialize)]
        struct OldStore {
            experiments: Vec<OldRecord>,
        }
        let mut stale = rec(150.0, 5);
        stale.noise_evidence = Some(NoiseEvidence { band_pct: 3.0, measured_noise_pct: None, measured_noise_stale: Some(StaleReason::Changed), between_sessions: None });
        let mut measured = rec(150.0, 5);
        measured.id = "exp:2-0".into();
        measured.noise_evidence = Some(NoiseEvidence { band_pct: 3.0, measured_noise_pct: Some(1.8), measured_noise_stale: None, between_sessions: None });
        let path = std::env::temp_dir().join(format!("compy-exp-noise-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = ExperimentStore { schema_version: STORE_SCHEMA_VERSION, experiments: vec![stale, measured] };
        save_store_to(&path, &store).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let old: OldStore = serde_json::from_str(&text).expect("an older Compy loads the file");
        let read: Vec<_> = old.experiments.iter().map(|e| e.noise_evidence.as_ref().map(|n| n.measured_noise_pct)).collect();
        assert_eq!(read, [Some(None), Some(Some(1.8))], "the older build reads the stale one as unmeasured");
        let back = load_store_from(&path);
        assert_eq!(back.experiments[0].noise_evidence.as_ref().unwrap().measured_noise_stale, Some(StaleReason::Changed));
        assert!(path.exists(), "the file was not set aside");
        let _ = std::fs::remove_file(&path);

        // And a receipt written before the field existed loads here as not stale.
        let pre: NoiseEvidence = serde_json::from_str(r#"{"band_pct":3.0,"measured_noise_pct":null}"#).unwrap();
        assert_eq!(pre.measured_noise_stale, None);
    }

    #[test]
    fn an_unmeasured_game_noise_is_written_as_unknown_not_guessed() {
        let v = serde_json::to_value(NoiseEvidence { band_pct: 3.0, measured_noise_pct: None, measured_noise_stale: None, between_sessions: None }).unwrap();
        assert!(v["measured_noise_pct"].is_null(), "{v}");
        assert_eq!(v["band_pct"], 3.0);
    }

    #[test]
    fn records_written_before_lane_2b_still_load() {
        let mut v = serde_json::to_value(ExperimentRecord {
            treatment: Some(TreatmentRecord {
                avg_fps: 200.0,
                low1_fps: 180.0,
                samples: 900,
                crashed: false,
                delta_low1_pct: 20.0,
                recorded_at: TREAT_ID.into(),
                session_id: Some(TREAT_ID.into()),
                check: Some(BaselineCheck::Uneven),
                halves: Some(BaselineHalves { first_half_fps: 180.0, second_half_fps: 200.0 }),
                delta_avg_pct: None,
            }),
            ..running()
        })
        .unwrap();
        let obj = v.as_object_mut().unwrap();
        for key in ["baseline_session_id", "applied_at", "session_pairing", "noise_evidence"] {
            assert!(obj.remove(key).is_some(), "{key} is written");
        }
        let t = obj.get_mut("treatment").unwrap().as_object_mut().unwrap();
        for key in ["session_id", "check", "halves"] {
            assert!(t.remove(key).is_some(), "treatment.{key} is written");
        }
        let old: ExperimentRecord = serde_json::from_value(v).unwrap();
        assert_eq!(old.baseline_session_id, None);
        assert_eq!(old.applied_at, None);
        assert_eq!(old.session_pairing, None);
        assert_eq!(old.noise_evidence, None);
        let t = old.treatment.unwrap();
        assert_eq!((t.session_id, t.check, t.halves), (None, None, None));
    }

    // P4-comparable: the receipt keeps what differed as keys a surface can translate, and what each
    // session's records say about time that wasn't play.
    #[test]
    fn a_partial_pairing_receipt_keeps_what_differed_and_the_stretches() {
        let base = session(BASE_ID, 150.0);
        let mut after = session(TREAT_ID, 180.0);
        after.game_state.as_mut().unwrap().resolution_width = Some(1920);
        after.game_state.as_mut().unwrap().graphics_api = None;
        after.background_secs_excluded = Some(420);
        after.fps_series = (0..80).map(|i| (i * 10, if i < 20 { 200.0 + (i % 7) as f64 * 3.0 } else { 120.0 })).collect();
        let pairing = crate::comparability::derive(&base, &after);
        assert_eq!(pairing.verdict, Comparability::Partial);
        let receipt = SessionPairing::of(&pairing, Some(&base), Some(&after));
        assert_eq!(receipt.changed, vec!["resolution"]);
        assert_eq!(receipt.unrecorded, vec!["graphics-api"]);
        let after_st = receipt.after_stretches.clone().unwrap();
        assert_eq!((after_st.left_out_secs, after_st.flat_secs, after_st.flat_fps), (Some(420), 600, Some(120.0)));
        let base_st = receipt.baseline_stretches.clone().unwrap();
        assert_eq!((base_st.left_out_secs, base_st.flat_secs, base_st.traced), (None, 0, false));
        // A session Compy couldn't read has no stretches, never an empty "clean" one.
        assert_eq!(SessionPairing::of(&pairing, None, Some(&after)).baseline_stretches, None);

        // Older-build safety, both ways: a pairing written before P4-comparable loads with nothing,
        // and one written now loads in the older shape (verdict + missing_context only).
        let old: SessionPairing = serde_json::from_str(r#"{"verdict":"partial","missing_context":["x"]}"#).unwrap();
        assert!(old.changed.is_empty() && old.unrecorded.is_empty());
        assert_eq!((old.baseline_stretches, old.after_stretches), (None, None));
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OlderPairing {
            verdict: Comparability,
            #[serde(default)]
            missing_context: Vec<String>,
        }
        let older: OlderPairing = serde_json::from_value(serde_json::to_value(&receipt).unwrap()).unwrap();
        assert_eq!(older.verdict, Comparability::Partial);
    }

    // P4-comparable review: "only 400 readings" from a long session must say the rest was left out
    // because another window was in front, at conclude and at start.
    #[test]
    fn too_few_readings_after_background_time_says_what_was_left_out() {
        let judge = |after: &SessionSummary| {
            with_left_out_readings(
                conclude_outcome(&rec(150.0, 5), 180.0, after.samples, false, Some("Test"), Some(5), Utc::now()),
                after,
            )
        };
        let mut after = session(TREAT_ID, 180.0);
        after.samples = 400;
        after.background_secs_excluded = Some(1500);
        let o = judge(&after);
        assert_eq!(o.verdict, "insufficient-evidence");
        assert!(
            o.note.contains("Only 400 frame-rate readings (about one a second) were captured while the game was in \
                             front (25 min were left out because another window was in front)"),
            "{}",
            o.note
        );
        // Focus not recorded, or nothing left out: the plain reason, no claim about focus.
        for secs in [None, Some(0)] {
            after.background_secs_excluded = secs;
            assert!(!judge(&after).note.contains("in front"), "{secs:?}");
        }
        // Enough readings: a judged verdict never carries the clause.
        after.samples = 5000;
        after.background_secs_excluded = Some(1500);
        assert!(!judge(&after).note.contains("left out"));

        // The start's refusal of a short baseline says the same.
        let mut base = session(BASE_ID, 150.0);
        base.samples = 400;
        base.background_secs_excluded = Some(45);
        let why = baseline_for_start(&base, DEFAULT_NOISE_FLOOR_PCT).unwrap_err();
        assert!(why.contains("400 of the 600") && why.contains("(45 s were left out because another window was in front)"), "{why}");
        base.background_secs_excluded = None;
        assert!(!baseline_for_start(&base, DEFAULT_NOISE_FLOOR_PCT).unwrap_err().contains("in front"));
    }

    /// A ledger row whose undo carries a date.
    fn undone<'a>(id: &'a str, applied_at: &'a str, rolled_back_at: &'a str) -> LedgerEntryRef<'a> {
        LedgerEntryRef { rolled_back_at: Some(rolled_back_at), ..row(id, "other-rec", applied_at, false) }
    }

    #[test]
    fn a_baseline_counts_only_while_compy_changes_stayed_put_since_it() {
        let mut base = session(BASE_ID, 150.0);
        base.compy_changes_active = Some(2);
        let before = "2026-09-01T09:00:00+00:00";
        let after = "2026-09-01T10:30:00+00:00";

        // Changes settled before the baseline began, and an old undo that carries no date, leave it
        // current.
        let settled =
            [row("a", "r1", before, true), row("b", "r2", before, true), row("c", "r3", before, false)];
        assert_eq!(baseline_is_current(&base, Ok((&settled, counts_now(2)))), Ok(()));

        // An apply or an undo after it began, or a date Compy can't read, refuses (Codex r1 on #611).
        for moved in [
            vec![row("a", "r1", after, true)],
            vec![undone("a", before, after)],
            vec![row("a", "r1", "not a time", true)],
            vec![undone("a", before, "not a time")],
        ] {
            let why = baseline_is_current(&base, Ok((&moved, counts_now(2)))).unwrap_err();
            assert!(why.contains("applied or undone after the baseline"), "{why}");
            assert!(why.contains("play a new baseline session"), "{why}");
        }
        let garbled = SessionSummary { started_at: "not a time".into(), ..base.clone() };
        assert!(baseline_is_current(&garbled, Ok((&settled, counts_now(2)))).is_err(), "an unreadable start is never assumed old");

        // A different count of active changes (one reverted outside Compy leaves no ledger date).
        let why = baseline_is_current(&base, Ok((&settled, counts_now(3)))).unwrap_err();
        assert!(why.contains("(2 then, 3 now)"), "{why}");

        // A history Compy can't read is refused, never assumed unchanged, and the refusal says why.
        let why = baseline_is_current(&base, Err("Compy can't read its change history")).unwrap_err();
        assert!(why.starts_with("Compy can't read its change history, so it can't check"), "{why}");
    }

    // #611 r1 review: a damaged ledger is set aside once, then every load returns a fresh, EMPTY one
    // that would read as "no Compy change moved" forever. The marker makes that silence a loss.
    #[test]
    fn a_ledger_set_aside_as_damaged_never_backs_a_one_change_claim() {
        use crate::history::LedgerCoverage::{Lost, SinceSetAside, Unknown, Whole};
        let unread = ledger_for_one_change_checks::<u8>(Err("sharing violation".into()), Whole).unwrap_err();
        assert_eq!(unread, "Compy can't read its change history");
        // #618: a ledger set aside after the baseline began may be missing rows it needs: refused, and
        // the refusal carries its fix (the journey offers a new as-is session for a baseline refusal).
        let lost = ledger_for_one_change_checks(Ok(Vec::<u8>::new()), Lost).unwrap_err();
        assert!(lost.starts_with("a new baseline session is needed") && lost.contains("set aside after this one began"), "{lost}");
        // Even a fresh ledger that has rows since is only part of the story.
        assert!(ledger_for_one_change_checks(Ok(vec!["c1"]), Lost).is_err());
        // Unknown stays unknown, in words that don't send the user to record a session that can't help.
        let unknown = ledger_for_one_change_checks(Ok(vec!["c1"]), Unknown).unwrap_err();
        assert!(unknown.contains("can't tell whether that happened before") && !unknown.contains("baseline"), "{unknown}");
        // Covered: the whole history, or every move since a set-aside the baseline began after.
        assert_eq!(ledger_for_one_change_checks(Ok(vec!["c1"]), Whole), Ok(vec!["c1"]));
        assert_eq!(ledger_for_one_change_checks(Ok(vec!["c1"]), SinceSetAside(Utc::now())), Ok(vec!["c1"]));

        let base = SessionSummary { compy_changes_active: Some(0), ..session(BASE_ID, 150.0) };
        let why = baseline_is_current(&base, Err(lost.as_str())).unwrap_err();
        assert!(why.contains("set aside") && why.contains("nothing else changed"), "{why}");
    }

    // #618 review: once a Trial can start after a set-aside, the count comes from the fresh ledger
    // alone. Changes the lost one recorded may still be applied, so a zero must not read as clean.
    #[test]
    fn attribution_warning_never_calls_a_rig_clean_when_earlier_history_was_set_aside() {
        let zero = attribution_warning(0, true).expect("a zero count after a set-aside is not a clean rig");
        assert!(zero.contains("set aside") && zero.contains("may still be in place"), "{zero}");
        assert!(zero.contains("ONLY the one new change"), "{zero}");
        let some = attribution_warning(2, true).unwrap();
        assert!(some.contains("2 other Compy changes are already active"), "{some}");
        assert!(some.contains("also set aside, so there may be more"), "{some}");
        assert!(!attribution_warning(3, false).unwrap().contains("set aside"));
    }

    fn utc(at: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(at).unwrap().with_timezone(&Utc)
    }

    // #618 review (P2): a damaged ledger is set aside by whichever reader loads it first, and a
    // background reader (a session summary being saved) can be that one, between a start's two reads.
    // Read marker-first, the start saw "nothing set aside", then loaded the fresh EMPTY ledger the
    // background reader had just left, and called the rig clean. The ledger is loaded FIRST now, so
    // a set-aside that landed before the load is on the marker by the time the marker is read. The
    // two reads are still two reads: this stages the set-aside DURING the load, deterministically.
    #[test]
    fn a_set_aside_that_lands_during_the_ledger_load_is_never_missed() {
        use std::cell::Cell;
        let marker: Cell<Option<DateTime<Utc>>> = Cell::new(None);
        let load_after_a_background_set_aside = || {
            marker.set(Some(utc(BASE_ID)));
            Ok(Vec::<&str>::new())
        };
        let read_marker = || Ok(marker.get());

        // A baseline begun at the set-aside time could be missing rows: refused, never covered.
        let (history, coverage) =
            ledger_view_for_one_change_checks(load_after_a_background_set_aside, read_marker, Some(BASE_ID));
        let why = history.expect_err("a fresh EMPTY ledger after a set-aside is not a quiet one");
        assert!(why.starts_with("a new baseline session is needed"), "{why}");
        assert_eq!(coverage, LedgerCoverage::Lost, "the coverage must come from the marker read AFTER the load");

        // The same race against a baseline begun well after the set-aside: covered by the fresh
        // ledger, so the check passes, but only since the set-aside, never as the whole history.
        marker.set(None);
        let (history, coverage) =
            ledger_view_for_one_change_checks(load_after_a_background_set_aside, read_marker, Some(TREAT_ID));
        assert_eq!(history, Ok(Vec::<&str>::new()));
        assert_eq!(coverage, LedgerCoverage::SinceSetAside(utc(BASE_ID)), "a pass is not a whole history");

        // Nothing set aside, before or during the load: the rows come back, the whole history.
        marker.set(None);
        let (history, coverage) = ledger_view_for_one_change_checks(|| Ok(vec!["c1"]), read_marker, Some(BASE_ID));
        assert_eq!((history, coverage), (Ok(vec!["c1"]), LedgerCoverage::Whole));

        // A load that fails loud (this reader set the damaged ledger aside) is a refusal in its own
        // words, whatever the marker says.
        let (history, _) = ledger_view_for_one_change_checks::<&str>(|| Err("parse: bad".into()), read_marker, Some(BASE_ID));
        assert_eq!(history.unwrap_err(), "Compy can't read its change history");
    }

    // #618: after a set-aside, a between-session measurement pairs only sessions past its edge (the
    // fresh ledger can't say what moved between older ones); with the whole history, every session.
    #[test]
    fn noise_pairs_only_sessions_the_ledger_covers() {
        let sessions = vec![session(BASE_ID, 150.0), session(TREAT_ID, 160.0)];
        let starts = |c: LedgerCoverage| sessions_the_ledger_covers(&sessions, c).iter().map(|s| s.started_at.clone()).collect::<Vec<_>>();
        assert_eq!(starts(LedgerCoverage::Whole), vec![BASE_ID.to_string(), TREAT_ID.to_string()]);
        assert_eq!(starts(LedgerCoverage::SinceSetAside(utc(BASE_ID))), vec![TREAT_ID.to_string()]);
        assert!(starts(LedgerCoverage::SinceSetAside(utc(TREAT_ID))).is_empty());
    }

    // #618: after a set-aside, the baseline is checked like with like: its counts since that
    // set-aside against the fresh ledger's. A baseline with only whole counts (or counts since another
    // set-aside) has nothing comparable and is refused as unrecorded, never matched against a partial.
    #[test]
    fn a_baseline_after_a_set_aside_is_checked_on_its_counts_since_it() {
        let at = utc(BASE_ID);
        let history: Result<Vec<crate::history::AppliedChange>, String> = Ok(Vec::new());
        let since = crate::sessions::CountsSinceSetAside { active: Some(0), cant_confirm: 0, since: at.to_rfc3339() };
        let base = SessionSummary {
            compy_changes_active: None,
            compy_changes_cant_confirm: None,
            compy_changes_since_set_aside: Some(since.clone()),
            ..session(TREAT_ID, 150.0)
        };
        let view = baseline_checked_view(&base, &history, LedgerCoverage::SinceSetAside(at));
        assert!(view.is_ok(), "{:?}", view.err());
        // Counted since a different set-aside: nothing like to compare with.
        let Err(why) = baseline_checked_view(&base, &history, LedgerCoverage::SinceSetAside(at + chrono::TimeDelta::seconds(5))) else {
            panic!("counts since another set-aside are never compared")
        };
        assert!(why.contains("didn't record how many of its changes"), "{why}");
        // Moved since the baseline began: refused by the ledger rows as before.
        let moved = SessionSummary { compy_changes_since_set_aside: Some(crate::sessions::CountsSinceSetAside { active: Some(1), ..since }), ..base.clone() };
        assert!(baseline_checked_view(&moved, &history, LedgerCoverage::SinceSetAside(at)).is_err());
    }

    // #669: a baseline session that recorded no count (its start couldn't read the change history) is
    // refused in words, even when the live count is 0 — never read as "0 then, 0 now".
    #[test]
    fn a_baseline_with_no_recorded_change_count_is_refused() {
        let base = SessionSummary { compy_changes_active: None, ..session(BASE_ID, 150.0) };
        let settled = [row("a", "r1", "2026-09-01T09:00:00+00:00", true)];
        for now in [0, 1] {
            let why = baseline_is_current(&base, Ok((&settled, counts_now(now)))).unwrap_err();
            assert!(why.contains("didn't record how many of its changes were active"), "{why}");
            assert!(why.contains("play a new baseline session"), "{why}");
            assert!(!why.contains("0 then"), "{why}");
        }
        // 453-f1 review: a count an older Compy recorded (newest row, can't-confirm included) is
        // compared with today's ledger counted by that same older rule, like with like — not refused.
        let old_rule = SessionSummary { compy_changes_active: Some(2), compy_changes_per_change: false, ..base.clone() };
        let legacy = |n| crate::history::SessionChangeCounts { active: Some(1), cant_confirm: 1, legacy_active: n };
        assert_eq!(baseline_is_current(&old_rule, Ok((&settled, legacy(2)))), Ok(()), "1 on + 1 can't confirm = the old 2");
        let why = baseline_is_current(&old_rule, Ok((&settled, legacy(3)))).unwrap_err();
        assert!(why.contains("(2 then, 3 now, counted the way the older Compy"), "{why}");
        // Per change, can't-confirm is compared apart: undoing an unprobed change moves only it.
        let per_change = SessionSummary { compy_changes_active: Some(1), compy_changes_cant_confirm: Some(2), ..base.clone() };
        let why = baseline_is_current(&per_change, Ok((&settled, legacy(9)))).unwrap_err();
        assert!(why.contains("can't confirm is different from the baseline session's (2 then, 1 now)"), "{why}");
        // A per-change baseline with no can't-confirm count is refused at start, as at conclude.
        let no_cant = SessionSummary { compy_changes_active: Some(1), compy_changes_cant_confirm: None, ..base.clone() };
        let why = baseline_is_current(&no_cant, Ok((&settled, counts_now(1)))).unwrap_err();
        assert!(why.contains("didn't record how many of its changes it couldn't confirm"), "{why}");
        let rec = ExperimentRecord { applied_change_id: "own".into(), ..running() };
        let treat = SessionSummary { compy_changes_active: Some(2), ..session(TREAT_ID, 180.0) };
        let what = other_compy_change(&rec, Some(&no_cant), Some(&treat), None).unwrap();
        assert!(what.contains("baseline session didn't record how many Compy changes were active"), "{what}");
        // A ledger where nothing can be confirmed has no active count to match.
        let unknown = crate::history::SessionChangeCounts { active: None, cant_confirm: 1, legacy_active: 1 };
        let why = baseline_is_current(&per_change, Ok((&settled, unknown))).unwrap_err();
        assert!(why.contains("can't confirm whether any of its changes are on right now"), "{why}");
        // A baseline that recorded "unknown" because nothing could be confirmed says that, not "couldn't read".
        let unconfirmed = SessionSummary { compy_changes_active: None, compy_changes_cant_confirm: Some(3), ..base.clone() };
        let why = baseline_is_current(&unconfirmed, Ok((&settled, counts_now(0)))).unwrap_err();
        assert!(why.contains("couldn't confirm whether any of its changes were on"), "{why}");
        // A recorded count still compares as before.
        let known = SessionSummary { compy_changes_active: Some(0), ..base };
        assert_eq!(baseline_is_current(&known, Ok((&settled, counts_now(0)))), Ok(()));
    }

    // #668: after the one-change check had loaded the ledger, the start read it twice more for its
    // counts, each a `load_history().unwrap_or_default()`: a read that failed there (an AV lock on
    // history.json) recorded 0 changes active on a rig that had some. Both counts now come from the
    // rows the one load returned, and a ledger that didn't load has no view, so no count at all.
    #[test]
    fn a_start_counts_active_changes_from_the_ledger_it_loaded_never_a_second_read() {
        let before = |mut c: crate::history::AppliedChange| {
            c.applied_at = "2026-08-01T00:00:00+00:00".into(); // before the baseline session began
            c
        };
        let mut undone = before(ledger_change("undone", None));
        undone.status = "rolled_back".into();
        let history: Result<Vec<crate::history::AppliedChange>, String> = Ok(vec![
            before(ledger_change("other-a", None)),
            before(ledger_change("other-b", None)),
            before(ledger_change("other-b", None)), // re-applied: still one setting
            undone,
        ]);
        // 453-f1: no live probe exists for these ids, so the shared rule can't confirm them: none is
        // active (so nothing is "other changes on"), and the active count is unknown, never 0. An
        // older-rule baseline is matched against the older rule's 2 (undone setting not counted).
        let base = SessionSummary {
            compy_changes_active: Some(2),
            compy_changes_per_change: false,
            compy_changes_cant_confirm: None,
            ..session(BASE_ID, 150.0)
        };
        let Ok(view) = baseline_checked_view(&base, &history, LedgerCoverage::Whole) else {
            panic!("a readable ledger at the count the baseline recorded is a view")
        };
        assert_eq!(view.rows.len(), 4, "the one-change checks walk every row");
        assert_eq!(view.active, 0, "can't-confirm is never counted active");
        assert!(view.active_recs.is_empty());
        assert_eq!(view.counts, crate::history::SessionChangeCounts { active: None, cant_confirm: 2, legacy_active: 2 });

        let moved = SessionSummary { compy_changes_active: Some(1), ..base.clone() };
        let Err(why) = baseline_checked_view(&moved, &history, LedgerCoverage::Whole) else {
            panic!("a count that moved since the baseline is never a view")
        };
        assert!(why.contains("(1 then, 2 now"), "{why}");

        // A ledger that didn't load is refused in words; there is no view, so no 0 to record.
        let unread = ledger_for_one_change_checks::<crate::history::AppliedChange>(Err("sharing violation".into()), LedgerCoverage::Whole);
        let Err(why) = baseline_checked_view(&base, &unread, LedgerCoverage::Whole) else {
            panic!("an unreadable ledger is never a view with a count")
        };
        assert!(why.starts_with("Compy can't read its change history"), "{why}");
    }

    // #669: at conclude, a session that recorded no count can't show that exactly this one change was
    // added — it is named as the reason (and confounds), never read as a match.
    #[test]
    fn a_session_with_no_recorded_change_count_is_named_never_matched() {
        let rec = ExperimentRecord { applied_change_id: "own".into(), ..running() };
        let base = SessionSummary { compy_changes_active: Some(2), ..session(BASE_ID, 150.0) };
        let treat = SessionSummary { compy_changes_active: Some(3), ..session(TREAT_ID, 180.0) };
        let settled = [row("own", "game-bar-disable", APPLIED, true)];
        assert_eq!(other_compy_change(&rec, Some(&base), Some(&treat), Some(&settled)), None);

        // 453-f1 review: an older-rule baseline is compared with the after-session's older-rule count.
        let old_rule_base = SessionSummary { compy_changes_per_change: false, ..base.clone() };
        let legacy_treat = |n| SessionSummary { compy_changes_legacy_active: Some(n), ..treat.clone() };
        assert_eq!(other_compy_change(&rec, Some(&old_rule_base), Some(&legacy_treat(3)), Some(&settled)), None);
        let what = other_compy_change(&rec, Some(&old_rule_base), Some(&legacy_treat(4)), Some(&settled)).unwrap();
        assert!(what.contains("4 active Compy changes, not 3"), "{what}");
        // Per change, the active and can't-confirm counts move apart: exactly one of them by one.
        let cant = |active, cant| SessionSummary { compy_changes_active: Some(active), compy_changes_cant_confirm: Some(cant), ..treat.clone() };
        assert_eq!(other_compy_change(&rec, Some(&base), Some(&cant(2, 1)), Some(&settled)), None, "this change, can't confirm");
        let what = other_compy_change(&rec, Some(&base), Some(&cant(3, 1)), Some(&settled)).unwrap();
        assert!(what.contains("3 active Compy changes and 1 it can't confirm"), "{what}");

        let unread = SessionSummary { compy_changes_active: None, ..treat.clone() };
        let what = other_compy_change(&rec, Some(&base), Some(&unread), Some(&settled)).unwrap();
        assert!(what.contains("after-session didn't record how many Compy changes were active"), "{what}");
        assert_eq!(with_compy_state(measured(180.0), Some(what)).verdict, "confounded");

        let unread_base = SessionSummary { compy_changes_active: None, ..base.clone() };
        let what = other_compy_change(&rec, Some(&unread_base), Some(&treat), Some(&settled)).unwrap();
        assert!(what.contains("baseline session didn't record how many Compy changes were active"), "{what}");
    }

    #[test]
    fn only_this_trials_change_may_move_during_the_test() {
        let rec = ExperimentRecord { applied_change_id: "own".into(), ..running() };
        let mut base = session(BASE_ID, 150.0);
        base.compy_changes_active = Some(2);
        let treat = SessionSummary { compy_changes_active: Some(3), ..session(TREAT_ID, 180.0) };
        let before = "2026-09-01T09:00:00+00:00";
        let during = "2026-09-01T11:30:00+00:00";
        let own = row("own", "game-bar-disable", APPLIED, true);

        // This Trial's own apply, and changes settled before it began, are not "another" change.
        let settled = [own, row("old", "r1", before, true), row("gone", "r2", before, false)];
        assert_eq!(other_compy_change(&rec, Some(&base), Some(&treat), Some(&settled)), None);

        // Another apply or undo after the Trial began is.
        for moved in [vec![own, row("x", "r1", during, true)], vec![own, undone("old", before, during)]] {
            let what = other_compy_change(&rec, Some(&base), Some(&treat), Some(&moved)).unwrap();
            assert!(what.contains("applied or undone during the test"), "{what}");
        }

        // So is an after-session that didn't run with the baseline's changes plus exactly this one.
        for n in [2, 4] {
            let t = SessionSummary { compy_changes_active: Some(n), ..treat.clone() };
            let what = other_compy_change(&rec, Some(&base), Some(&t), Some(&settled)).unwrap();
            assert!(what.contains(&format!("{n} active Compy changes, not 3")), "{what}");
        }
        let one = SessionSummary { compy_changes_active: Some(1), ..treat.clone() };
        let what = other_compy_change(&rec, Some(&base), Some(&one), Some(&settled)).unwrap();
        assert!(what.contains("1 active Compy change, not 3"), "{what}");

        // Nothing to compare is not judged here: the watermark already refuses an unreadable ledger.
        assert_eq!(other_compy_change(&rec, None, Some(&treat), None), None);
        assert_eq!(other_compy_change(&rec, Some(&base), None, Some(&settled)), None);
    }

    #[test]
    fn another_compy_change_during_the_test_confounds_and_restores() {
        let what = Some("another Compy change was applied or undone during the test".to_string());
        let crash = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, Some("Test"), Some(5), Utc::now());
        for judged in [measured(180.0), measured(150.5), measured(100.0), crash] {
            assert_eq!(with_compy_state(judged.clone(), None), judged, "nothing else moved: untouched");
            let o = with_compy_state(judged.clone(), what.clone());
            assert_eq!(o.verdict, "confounded", "{}", judged.verdict);
            assert!(!o.keep, "a confounded Trial restores");
            assert_eq!(o.stop_reason.as_deref(), Some("other-compy-change-during-trial"));
            assert_eq!(o.confidence, Confidence::Low);
            assert!(o.note.contains("during the test") && o.note.contains("restored"), "{}", o.note);
            assert_eq!(o.delta_low1_pct, judged.delta_low1_pct, "the measured delta stays as evidence");
            assert_eq!(trial_result_for(&o.verdict), TrialResult::Inconclusive);
            assert_eq!(noise_evidence_for(&o, DEFAULT_NOISE_FLOOR_PCT, &NoiseLookup::Unmeasured, None), None);
        }
        // A stronger reason already given stands.
        let wrong_game = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Other"), Some(5), Utc::now());
        let confounded = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Test"), Some(6), Utc::now());
        for o in [wrong_game, confounded] {
            assert_eq!(with_compy_state(o.clone(), what.clone()), o);
        }
    }

    /// A ledger row as `history.json` holds it, with the typed action that says what to read.
    /// Today's ledger counts with `n` changes on and none can't-confirm (the older rule agrees).
    fn counts_now(n: usize) -> crate::history::SessionChangeCounts {
        crate::history::SessionChangeCounts { active: Some(n), cant_confirm: 0, legacy_active: n }
    }

    fn ledger_change(rec_id: &str, action: Option<crate::actions::AppliedAction>) -> crate::history::AppliedChange {
        let mut c: crate::history::AppliedChange = serde_json::from_value(serde_json::json!({
            "id": rec_id, "rec_id": rec_id, "rec_title": "t",
            "applied_at": "2026-10-21T09:00:00+00:00", "snapshot": {}, "status": "applied"
        }))
        .expect("a ledger row");
        c.applied_action = action;
        c
    }

    #[test]
    fn a_readable_startup_toggle_counts_as_verified_and_an_unreadable_one_does_not() {
        // #620: a startup-app row's rec id doesn't say which way Compy flipped the entry, so a
        // rec-id-only read was Unrecognised and every later Trial refused to start or judge. The read
        // goes through the row. An entry with no approval value reads as Windows' default, enabled
        // (the name is one no machine has, and the read is KEY_READ only), so Compy's enable is in
        // place and its disable reads as set back; a row with no typed action has nothing to read.
        use crate::actions::AppliedAction::SetStartupEntryEnabled;
        let name = "compy-620-trial-read-back-absent-entry";
        let toggle = |enabled| Some(SetStartupEntryEnabled { name: name.into(), enabled });
        let rec = format!("startup-entry:{name}");
        let enabled = [ledger_change(&rec, toggle(true))];
        let disabled = [ledger_change(&rec, toggle(false))];
        let untyped = [ledger_change("startup-entry:untyped", None)];
        for (changes, unverified, why) in [
            (&enabled[..], 0, "in place: verified"),
            (&disabled[..], 1, "set back: unverified"),
            (&untyped[..], 1, "no typed action: unverified"),
        ] {
            let rows = ledger_rows(changes);
            let reads = crate::history::LiveReads::default();
            assert_eq!(unverified_others_live(changes, &rows, "test-rec", &reads), unverified, "{why}");
        }
        // The newest applied row is the one read: enable after an earlier disable is in place.
        let both = [disabled[0].clone(), enabled[0].clone()];
        let reads = crate::history::LiveReads::default();
        assert_eq!(unverified_others_live(&both, &ledger_rows(&both), "test-rec", &reads), 0);
    }

    // #686-followup: a Trial start read every other applied row back with its own LiveReads, so a
    // ledger with N telemetry-task rows spawned PowerShell N times. One pass now lists them once, and
    // the verdicts are the same: a disabled task is in place, a re-enabled one is set back, and a task
    // missing from the listing (or an unreadable listing) is unknown, never confirmed.
    #[test]
    fn a_trial_start_lists_the_tasks_once_however_many_task_rows_the_ledger_holds() {
        use crate::actions::{AppliedAction::DisableScheduledTask, KnownBloatTask};
        use std::sync::atomic::{AtomicUsize, Ordering};
        static SPAWNS: AtomicUsize = AtomicUsize::new(0);
        fn listing() -> Option<String> {
            SPAWNS.fetch_add(1, Ordering::SeqCst);
            Some(concat!(
                "\\Microsoft\\Windows\\Customer Experience Improvement Program\\\tUsbCeip\tDisabled\n",
                "\\Microsoft\\Windows\\Customer Experience Improvement Program\\\tConsolidator\tReady\n",
            ).to_string())
        }
        static FAILED: AtomicUsize = AtomicUsize::new(0);
        fn failed() -> Option<String> {
            FAILED.fetch_add(1, Ordering::SeqCst);
            None
        }
        let task = |t| Some(DisableScheduledTask { task: t });
        let changes = [
            ledger_change("bloat-task:ceip-usb", task(KnownBloatTask::CeipUsb)),
            ledger_change("bloat-task:ceip-consolidator", task(KnownBloatTask::CeipConsolidator)),
            ledger_change("bloat-task:compatibility-appraiser", task(KnownBloatTask::CompatibilityAppraiser)),
        ];
        let rows = ledger_rows(&changes);
        // ceip-usb reads as disabled (in place); consolidator is Ready (set back); the appraiser is not
        // in the listing (unknown). Two can't be confirmed.
        let reads = crate::history::LiveReads::with_task_listing(listing);
        assert_eq!(unverified_others_live(&changes, &rows, "test-rec", &reads), 2);
        assert_eq!(SPAWNS.load(Ordering::SeqCst), 1, "one task listing for {} task rows", changes.len());
        // An unreadable listing leaves every task row unknown, and is still tried only once.
        let reads = crate::history::LiveReads::with_task_listing(failed);
        assert_eq!(unverified_others_live(&changes, &rows, "test-rec", &reads), 3);
        assert_eq!(FAILED.load(Ordering::SeqCst), 1, "one failed listing, not one per row");
    }

    #[test]
    fn other_changes_not_confirmed_in_place_leave_the_result_unjudged() {
        // #611 r2+r3 review: sessions count an applied setting as active whether or not it is still
        // in place, so equal counts can't show it stayed put. Codex r4: one that reads as set back
        // (undone in Windows) moved as surely as an unreadable one may have. Each such setting is
        // counted once; this Trial's own change, rolled-back ones and ones that read back are not.
        // Codex r5: nor is an older row for the setting under test, which is never "another setting".
        const AT: &str = "2026-09-28T11:00:00+00:00";
        let ledger = [
            row("ours", "test-rec", AT, true),
            row("stale", "test-rec", AT, true),
            row("s1", "startup-entry", AT, true),
            row("s2", "startup-entry", AT, true),
            row("gm", "game-mode", AT, true),
            row("gb", "game-bar-disable", AT, true),
            row("gone", "service-suspend", AT, false),
        ];
        let read = |rec: &str| match rec {
            "game-mode" => Some(true),
            "game-bar-disable" => Some(false),
            "startup-entry" => None,
            other => panic!("{other} should not be read"),
        };
        assert_eq!(unverified_other_changes(&ledger, "test-rec", read), 2);
        assert_eq!(unverified_other_changes(&ledger[5..6], "test-rec", read), 1, "set back counts on its own");
        assert_eq!(unverified_other_changes(&ledger[..2], "test-rec", read), 0, "the setting under test never counts");
        assert_eq!(unverified_other_changes(&ledger[4..5], "test-rec", read), 0, "in place: not counted");

        let better = measured(180.0);
        assert_eq!((better.verdict.as_str(), better.keep), ("improved", true), "the fixture would keep");
        assert!(noise_evidence_for(&better, DEFAULT_NOISE_FLOOR_PCT, &NoiseLookup::Unmeasured, None).is_some());
        assert_eq!(with_unverified_changes(better.clone(), 0), better, "all read back: untouched");
        // §3/§7/§9: a Better that can't be shown to be this setting's alone is never kept.
        for (verdict, was) in [(measured(180.0), "improved"), (measured(150.0), "no-change"), (measured(120.0), "regressed")] {
            assert_eq!(verdict.verdict, was, "the fixture covers every measured verdict");
            for (n, says) in [(1, "another setting"), (3, "3 other settings")] {
                let o = with_unverified_changes(verdict.clone(), n);
                assert_eq!(o.verdict, "insufficient-evidence", "{} / {n}", verdict.verdict);
                assert!(!o.keep, "never kept: {} / {n}", verdict.verdict);
                assert_eq!(o.stop_reason.as_deref(), Some("other-change-unverified-at-conclude"));
                assert_eq!(o.confidence, Confidence::Unknown);
                assert_eq!(o.delta_low1_pct, verdict.delta_low1_pct, "the measured delta stays as evidence");
                assert!(o.note.contains(says) && o.note.contains("can't be confirmed as still in place"), "{}", o.note);
                assert!(o.note.contains("judged nothing"), "{}", o.note);
                assert_eq!(trial_result_for(&o.verdict), TrialResult::Inconclusive);
                assert_eq!(noise_evidence_for(&o, DEFAULT_NOISE_FLOOR_PCT, &NoiseLookup::Unmeasured, None), None, "no band claimed");
            }
        }
        // A crash is restored without blame.
        let crash = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, Some("Test"), Some(5), Utc::now());
        assert_eq!(crash.stop_reason.as_deref(), Some("crash-during-treatment"));
        let o = with_unverified_changes(crash, 1);
        assert_eq!((o.verdict.as_str(), o.keep), ("insufficient-evidence", false));
        assert_eq!(o.stop_reason.as_deref(), Some("crash-during-treatment; other-change-unverified-at-conclude"));
        assert!(o.note.contains("crashed") && o.note.contains("without blaming it"), "{}", o.note);
        // A verdict that already says it wasn't judged keeps its own reason.
        let confounded = with_compy_state(measured(180.0), Some("another change".into()));
        let wrong_game = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Other"), Some(5), Utc::now());
        let thin = conclude_outcome(&rec(150.0, 5), 180.0, MIN_TREATMENT_SAMPLES - 1, false, Some("Test"), Some(5), Utc::now());
        assert_eq!(wrong_game.verdict, "not-comparable");
        assert_eq!(thin.stop_reason.as_deref(), Some("insufficient-samples"));
        for unjudged in [confounded, wrong_game, thin] {
            assert_eq!(with_unverified_changes(unjudged.clone(), 2), unjudged);
        }
    }

    #[test]
    fn a_start_is_refused_when_other_changes_arent_confirmed_in_place() {
        // #611 in-house review: the conclude would leave such a Trial unjudged anyway, so it is turned
        // down before the user plays a test session for nothing, with the remedy named.
        assert_eq!(unverified_start_refusal(0), None, "all read back: the start goes ahead");
        for (n, says, undo) in [(1, "another setting", "undo it in"), (3, "3 other settings", "undo them in")] {
            let why = unverified_start_refusal(n).expect("refused");
            assert!(why.contains(says) && why.contains("can't be confirmed as still in place"), "{why}");
            assert!(why.contains(undo) && why.contains("Test → Applied & history"), "{why}");
        }
    }

    #[test]
    fn a_crash_is_still_checked_against_the_baseline_conditions() {
        let base = session(BASE_ID, 150.0);
        let after = session(TREAT_ID, 180.0);
        let crash = |b, t| crash_outcome(Some(APPLIED), b, t);
        // #611 r2 review: a session that can't be found never lets the crash alone decide. It
        // restores, but no high-confidence regression is pinned on a change it can't be tied to.
        for ((b, t), stop) in [
            ((None, None), "crash-session-missing"),
            ((Some(&base), None), "crash-session-missing"),
            ((None, Some(&after)), "crash-baseline-missing"),
        ] {
            let (o, pairing) = crash(b, t);
            assert_eq!(o.verdict, "not-comparable", "{stop}");
            assert!(!o.keep);
            assert_eq!(o.stop_reason.as_deref(), Some(stop));
            assert_eq!(o.confidence, Confidence::Unknown);
            assert!(o.note.contains("crashed") && o.note.contains("can't be pinned"), "{}", o.note);
            assert_eq!(trial_result_for(&o.verdict), TrialResult::Unmeasurable);
            assert_eq!(noise_evidence_for(&o, DEFAULT_NOISE_FLOOR_PCT, &NoiseLookup::Unmeasured, None), None);
            assert_eq!(pairing, None);
        }
        // A comparable session begun after the apply: the crash is the change's, and the pairing it
        // was judged by is kept (§11).
        let (o, pairing) = crash(Some(&base), Some(&after));
        assert_eq!(o, crash_without_reading());
        assert_eq!(pairing.map(|p| p.verdict), Some(Comparability::Comparable));

        // #611 r1 review: a crash in a session that can't be shown to follow the change is never
        // pinned on it: begun before the apply returned, undated, or on a record with no apply time.
        let mut undated = after.clone();
        undated.started_at = "yesterday".into();
        for (applied_at, t) in [
            (Some(APPLIED), &session(STARTED, 180.0)),
            (Some(APPLIED), &undated),
            (None, &after),
        ] {
            let (o, pairing) = crash_outcome(applied_at, Some(&base), Some(t));
            assert_eq!(o.verdict, "not-comparable", "{} / {applied_at:?}", t.started_at);
            assert!(!o.keep);
            assert_eq!(o.stop_reason.as_deref(), Some("crash-session-not-after-change"));
            assert_eq!(o.confidence, Confidence::Unknown);
            assert!(o.note.contains("began after the change took effect"), "{}", o.note);
            assert_eq!(trial_result_for(&o.verdict), TrialResult::Unmeasurable);
            assert_eq!(pairing, None);
        }

        // A changed driver: the crash can't be pinned on the setting (Codex r1 on #611).
        let mut new_driver = session(TREAT_ID, 180.0);
        new_driver.hw_fingerprint.as_mut().unwrap().gpu_driver = "25.8.1".into();
        let (o, _) = crash(Some(&base), Some(&new_driver));
        assert_eq!(o.verdict, "confounded");
        assert!(!o.keep);
        assert_eq!(o.stop_reason.as_deref(), Some("conditions-changed-between-sessions"));
        assert!(o.note.contains("GPU driver"), "{}", o.note);

        // Another game or GPU: not comparable, restored, and never blamed on the setting.
        let mut other_game = session(TREAT_ID, 180.0);
        other_game.process_name = "valorant.exe".into();
        let mut other_gpu = session(TREAT_ID, 180.0);
        other_gpu.hw_fingerprint.as_mut().unwrap().gpu = "GeForce RTX 5080".into();
        for t in [other_game, other_gpu] {
            let (o, pairing) = crash_outcome(Some(APPLIED), Some(&base), Some(&t));
            assert_eq!(o.verdict, "not-comparable", "{}", t.process_name);
            assert_eq!(pairing.map(|p| p.verdict), Some(Comparability::NotComparable));
            assert!(!o.keep);
            assert_eq!(o.stop_reason.as_deref(), Some("crash-session-not-comparable"));
            assert_eq!(o.confidence, Confidence::Unknown);
            assert!(o.note.contains("crashed") && o.note.contains("isn't comparable"), "{}", o.note);
            assert_eq!(trial_result_for(&o.verdict), TrialResult::Unmeasurable);
            assert_eq!(noise_evidence_for(&o, DEFAULT_NOISE_FLOOR_PCT, &NoiseLookup::Unmeasured, None), None);
        }

        // #611 r3 review: two sessions with nothing recorded in common can't show the crash is the
        // change's, exactly as a measured conclude refuses them.
        let bare = |id: &str| SessionSummary {
            hw_fingerprint: None,
            game_state: None,
            capture_capabilities: None,
            ..session(id, 180.0)
        };
        let (o, pairing) = crash_outcome(Some(APPLIED), Some(&bare(BASE_ID)), Some(&bare(TREAT_ID)));
        assert_eq!(pairing.map(|p| p.verdict), Some(Comparability::Unknown));
        assert_eq!(o.verdict, "not-comparable");
        assert!(!o.keep);
        assert_eq!(o.stop_reason.as_deref(), Some("crash-session-comparability-unknown"));
        assert_eq!(o.confidence, Confidence::Unknown);
        assert!(o.note.contains("crashed") && o.note.contains("share no recorded rig"), "{}", o.note);
        assert_eq!(trial_result_for(&o.verdict), TrialResult::Unmeasurable);
    }

    #[test]
    fn a_failed_apply_always_leaves_a_loud_record() {
        // #611 r3 review: an apply that writes in several steps can fail part-way and still read as
        // unchanged, so even that read never drops the record or says nothing changed.
        use crate::history::ActiveCheck;
        let pending = || ExperimentRecord { status: ExperimentStatus::Pending, applied_at: None, ..running() };
        let mut r = pending();
        let msg = mark_failed_apply(&mut r, "boom", ActiveCheck::Off);
        assert_eq!(r.status, ExperimentStatus::Aborted, "kept as a loud record");
        assert_eq!(r.target_verified, Some(false));
        assert!(msg.contains("(boom)") && msg.contains("reads as not changed") && msg.contains("part-way"), "{msg}");
        assert!(msg.contains("no undo record") && !msg.contains("nothing changed"), "{msg}");
        let reason = r.stop_reason.unwrap();
        assert!(reason.starts_with("start-aborted: ") && reason.contains("part-way") && reason.ends_with(": boom"), "{reason}");

        for (check, verified, says) in [
            (ActiveCheck::On, Some(true), "reads as changed"),
            (ActiveCheck::Unreadable, None, "can't read the setting"),
            (ActiveCheck::Unrecognised, None, "can't read the setting"),
        ] {
            let mut r = pending();
            let msg = mark_failed_apply(&mut r, "boom", check);
            assert_eq!(r.status, ExperimentStatus::Aborted, "{check:?}");
            assert!(!r.kept, "{check:?}");
            assert_eq!(r.target_verified, verified, "{check:?}");
            assert_eq!(r.trial_result, Some(TrialResult::Unmeasurable), "{check:?}");
            assert!(r.concluded_at.is_some(), "{check:?}");
            let reason = r.stop_reason.unwrap();
            assert!(reason.starts_with("start-aborted: ") && reason.ends_with(": boom"), "{reason}");
            assert!(msg.contains("(boom)") && msg.contains(says), "{check:?}: {msg}");
            assert!(msg.contains("no undo record"), "no undo is ever claimed: {msg}");
            assert!(!msg.contains("unchanged") && !msg.contains("nothing changed"), "{check:?}: {msg}");
        }
    }

    #[test]
    fn verdict_notes_say_readings_and_claim_no_back_to_back() {
        let thin = verdict_note("insufficient-evidence", 10, false, GameMatch::Match);
        assert!(thin.contains("readings") && !thin.contains("frames"), "{thin}");
        let measured = verdict_note("improved", 5000, false, GameMatch::Match);
        assert!(!measured.contains("back-to-back"), "{measured}");
    }

    // ─── P4-baseline-quality (Trial Protocol §2) ─────────────────────────

    /// The owner rig's 2026-10-23 WARDOGS sessions as `sessions.json` holds them (the 10 s buckets'
    /// mean fps, from 20 s in): the first live Trial's baseline (1202 s, 1172 readings, AFK into a new
    /// round) and its after-session (1125 s, 1095 readings).
    const AFK_BASELINE_FPS: &[f64] = &[142.8, 152.2, 177.9, 185.7, 180.0, 212.7, 252.2, 264.7, 319.8, 270.2, 263.9, 235.4, 224.0, 218.9, 207.8, 227.2, 231.1, 219.8, 263.2, 282.2, 337.6, 335.6, 312.8, 320.5, 328.9, 336.3, 335.1, 334.2, 330.5, 337.2, 334.4, 323.4, 330.1, 338.3, 329.2, 268.5, 155.9, 220.4, 304.7, 326.6, 327.5, 237.0, 215.5, 274.0, 223.8, 212.0, 219.5, 251.4, 259.3, 253.1, 251.1, 241.5, 242.2, 230.1, 245.3, 249.3, 220.5, 200.6, 202.0, 208.5, 206.3, 230.9, 255.6, 253.5, 255.8, 255.8, 269.1, 279.4, 265.0, 204.9, 212.1, 229.0, 235.1, 243.2, 272.1, 293.6, 263.2, 265.0, 258.6, 271.4, 276.3, 287.4, 289.1, 279.6, 269.0, 279.3, 237.8, 210.8, 204.0, 210.9, 213.5, 191.8, 183.4, 204.4, 214.0, 207.3, 205.1, 225.6, 199.7, 190.9, 180.2, 186.5, 195.1, 187.5, 202.1, 203.1, 194.5, 195.9, 200.8, 199.4, 220.2, 218.7, 216.4, 236.1, 216.1, 188.9, 209.6, 199.1, 213.0];
    const AFK_AFTER_FPS: &[f64] = &[184.0, 181.3, 192.7, 190.0, 188.7, 163.3, 160.6, 174.7, 174.9, 172.3, 172.9, 177.7, 190.7, 209.8, 200.1, 197.2, 192.1, 183.5, 190.4, 170.7, 183.1, 189.1, 190.8, 194.2, 186.4, 189.5, 204.0, 190.9, 193.4, 192.9, 179.4, 186.2, 194.8, 199.0, 197.2, 189.4, 182.7, 186.0, 185.2, 175.9, 189.4, 206.3, 195.5, 167.8, 175.2, 172.1, 163.6, 178.3, 187.8, 186.4, 198.0, 222.9, 234.6, 221.4, 222.8, 217.5, 203.9, 202.9, 190.4, 191.7, 209.3, 195.1, 189.9, 205.9, 204.0, 183.9, 190.2, 197.4, 207.5, 195.9, 194.4, 182.6, 191.3, 197.6, 194.1, 195.2, 193.5, 200.1, 194.5, 181.6, 286.0, 320.4, 287.4, 196.0, 187.2, 189.3, 267.6, 265.7, 260.3, 230.8, 235.9, 241.6, 232.6, 242.0, 261.0, 283.3, 255.5, 256.4, 232.2, 238.3, 228.0, 219.5, 217.6, 205.2, 181.0, 188.5, 203.7, 220.7, 210.9, 226.2, 255.5];

    fn traced(samples: u32, fps: &[f64]) -> SessionSummary {
        let mut s = session(BASE_ID, 150.0);
        s.samples = samples;
        s.fps_series = fps.iter().enumerate().map(|(i, &f)| (20 + 10 * i as u32, f)).collect();
        s
    }

    #[test]
    fn the_afk_baseline_from_the_first_live_trial_is_uneven_and_starts_with_the_warning_kept() {
        let grade = grade_baseline(&traced(1172, AFK_BASELINE_FPS), DEFAULT_NOISE_FLOOR_PCT);
        let halves = BaselineHalves { first_half_fps: 259.8, second_half_fps: 227.9 };
        assert_eq!(grade, BaselineGrade::Uneven(halves.clone()));
        // Warn, don't block (owner decision 2026-10-24): it starts, and the record keeps grade + halves.
        let started = baseline_for_start(&traced(1172, AFK_BASELINE_FPS), DEFAULT_NOISE_FLOOR_PCT);
        assert_eq!(started, Ok((BaselineCheck::Uneven, Some(halves))));
        // Its after-session grades the same way.
        assert!(matches!(grade_baseline(&traced(1095, AFK_AFTER_FPS), DEFAULT_NOISE_FLOOR_PCT), BaselineGrade::Uneven(_)));
        assert!(matches!(
            baseline_for_start(&traced(1095, AFK_AFTER_FPS), DEFAULT_NOISE_FLOOR_PCT),
            Ok((BaselineCheck::Uneven, Some(_)))
        ));
    }

    #[test]
    fn a_baseline_under_600_readings_is_too_short() {
        // The 2026-10-23 kill-mid-start check's 90 s baseline: 91 readings.
        let s = traced(91, &[275.6, 288.7, 284.8, 288.8, 278.4, 262.0, 262.4, 254.1, 263.8, 266.9]);
        assert_eq!(grade_baseline(&s, DEFAULT_NOISE_FLOOR_PCT), BaselineGrade::TooShort { samples: 91 });
        let why = baseline_for_start(&s, DEFAULT_NOISE_FLOOR_PCT).unwrap_err();
        assert!(why.contains("too short") && why.contains("91 of the 600"), "{why}");
        assert!(why.contains("record a new baseline"), "offers a re-record: {why}");
        assert!(matches!(grade_baseline(&traced(599, &[200.0; 60]), DEFAULT_NOISE_FLOOR_PCT), BaselineGrade::TooShort { .. }));
        // Still refused when it has no trace either: the reading count is checked first.
        assert!(baseline_for_start(&traced(599, &[]), DEFAULT_NOISE_FLOOR_PCT).is_err());
    }

    #[test]
    fn a_long_steady_baseline_starts_and_its_halves_are_kept() {
        let mut fps = vec![200.0; 30];
        fps.extend([204.0; 30]); // +2%: inside the 3% floor
        let started = baseline_for_start(&traced(600, &fps), DEFAULT_NOISE_FLOOR_PCT).unwrap();
        assert_eq!(started, (BaselineCheck::Steady, Some(BaselineHalves { first_half_fps: 200.0, second_half_fps: 204.0 })));
        fps[30..].fill(206.2); // +3.1%: outside it
        assert!(matches!(grade_baseline(&traced(600, &fps), DEFAULT_NOISE_FLOOR_PCT), BaselineGrade::Uneven(_)));
        fps[30..].fill(193.8); // a drop counts the same as a rise
        assert!(matches!(grade_baseline(&traced(600, &fps), DEFAULT_NOISE_FLOOR_PCT), BaselineGrade::Uneven(_)));
    }

    #[test]
    fn a_baseline_without_its_trace_starts_marked_untraced_never_steady() {
        // `session()` carries no fps_series, as an older session that shed it.
        assert_eq!(grade_baseline(&traced(900, &[]), DEFAULT_NOISE_FLOOR_PCT), BaselineGrade::Untraced);
        assert_eq!(grade_baseline(&traced(900, &[200.0, 200.0, 200.0]), DEFAULT_NOISE_FLOOR_PCT), BaselineGrade::Untraced);
        assert_eq!(baseline_for_start(&traced(900, &[]), DEFAULT_NOISE_FLOOR_PCT), Ok((BaselineCheck::Untraced, None)));
    }

    #[test]
    fn the_baseline_check_is_written_in_kebab_case_and_a_record_without_it_loads_as_unknown() {
        let marked = ExperimentRecord { baseline_check: Some(BaselineCheck::Uneven), ..running() };
        let mut v = serde_json::to_value(&marked).unwrap();
        assert_eq!(v["baseline_check"], "uneven");
        assert_eq!(serde_json::to_value(BaselineCheck::Untraced).unwrap(), "untraced");
        // Field absent (a record started before baselines were graded): unknown, never assumed steady.
        assert!(v.as_object_mut().unwrap().remove("baseline_check").is_some());
        let old: ExperimentRecord = serde_json::from_value(v).unwrap();
        assert_eq!(old.baseline_check, None);
    }

    #[test]
    fn a_record_without_baseline_halves_loads_and_an_older_compy_loads_one_with_them() {
        // New field absent (a record started before baselines were graded): loads as unknown.
        let mut v = serde_json::to_value(running()).unwrap();
        assert!(v.as_object_mut().unwrap().remove("baseline_halves").is_some(), "the field is written");
        let old: ExperimentRecord = serde_json::from_value(v).unwrap();
        assert_eq!(old.baseline_halves, None);
        // An older Compy's record type (no such field, no deny_unknown_fields) reads a new record.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OlderRecord {
            id: String,
            rec_id: String,
            status: ExperimentStatus,
            baseline_low1_fps: f64,
            noise_floor_pct: f64,
            #[serde(default)]
            baseline_session_id: Option<String>,
        }
        let new = ExperimentRecord {
            baseline_halves: Some(BaselineHalves { first_half_fps: 200.0, second_half_fps: 204.0 }),
            baseline_check: Some(BaselineCheck::Uneven),
            ..running()
        };
        let text = serde_json::to_string(&ExperimentStore { schema_version: STORE_SCHEMA_VERSION, experiments: vec![new] }).unwrap();
        #[derive(Deserialize)]
        struct OlderStore {
            experiments: Vec<OlderRecord>,
        }
        let older: OlderStore = serde_json::from_str(&text).expect("an older Compy loads the file");
        assert_eq!(older.experiments[0].baseline_session_id.as_deref(), Some(BASE_ID));
    }

    // ─── P4-sessions (Trial Protocol §2, §5, §8) ──────────────────────────────

    /// The first live Trial (2026-10-23, WARDOGS, `visual-effects`) as `experiments.json` recorded it
    /// at start: baseline avg 244.1 / 1% low 153.5, graded uneven (259.8 → 227.9 fps).
    fn afk_trial() -> ExperimentRecord {
        ExperimentRecord {
            game: "WardogsClient-Win64-Shipping.exe".into(),
            baseline_avg_fps: 244.1,
            baseline_low1_fps: 153.5,
            baseline_check: Some(BaselineCheck::Uneven),
            baseline_halves: Some(BaselineHalves { first_half_fps: 259.8, second_half_fps: 227.9 }),
            ..running()
        }
    }

    fn afk_after() -> SessionSummary {
        let mut s = traced(1095, AFK_AFTER_FPS);
        s.started_at = TREAT_ID.into();
        s.process_name = "WardogsClient-Win64-Shipping.exe".into();
        s.avg_fps = 203.5;
        s.low1_fps_est = 125.1;
        s
    }

    #[test]
    fn the_minus_18_5_percent_afk_trial_is_too_noisy_to_judge_not_slower() {
        let rec = afk_trial();
        let after = afk_after();
        // Concluded the same day, as the owner did (a baseline weeks old would be "expired" first).
        let concluded = DateTime::parse_from_rfc3339(APPLIED).unwrap().with_timezone(&Utc) + chrono::Duration::hours(1);
        let judged = conclude_outcome(&rec, after.low1_fps_est, after.samples, false, Some(&after.process_name), Some(5), concluded);
        // What the owner saw: "Slower — restored" on a −18.5% 1% low.
        assert_eq!((judged.verdict.as_str(), judged.delta_low1_pct), ("regressed", -18.5));

        let (after_check, after_halves) = session_check(grade_baseline(&after, rec.noise_floor_pct));
        assert_eq!(after_check, Some(BaselineCheck::Uneven), "the after-session swung too");
        assert_eq!(after_halves, Some(BaselineHalves { first_half_fps: 188.7, second_half_fps: 218.5 }));
        let o = with_steady_sessions(judged, uneven_baseline_at_conclude(&rec, None).as_ref(), after_halves.as_ref());
        assert_eq!(o.verdict, "too-noisy");
        assert_eq!(trial_result_for(&o.verdict), TrialResult::Inconclusive);
        assert!(!o.keep, "restored");
        assert_eq!(o.delta_low1_pct, -18.5, "the measured delta stays as evidence");
        assert_eq!(o.confidence, Confidence::Unknown);
        assert_eq!(o.stop_reason.as_deref(), Some("uneven-session"));
        assert!(o.note.contains("both sessions were uneven") && o.note.contains("260 fps in its first half"), "{}", o.note);
        assert_eq!(noise_evidence_for(&o, rec.noise_floor_pct, &NoiseLookup::Unmeasured, None), None, "nothing was judged against the band");
    }

    #[test]
    fn either_uneven_session_alone_makes_a_measured_verdict_too_noisy() {
        let h = BaselineHalves { first_half_fps: 200.0, second_half_fps: 220.0 };
        for low1 in [180.0, 150.5, 100.0] {
            let base_only = with_steady_sessions(measured(low1), Some(&h), None);
            assert_eq!(base_only.verdict, "too-noisy");
            assert!(base_only.note.contains("the baseline was uneven"), "{}", base_only.note);
            let after_only = with_steady_sessions(measured(low1), None, Some(&h));
            assert_eq!(after_only.verdict, "too-noisy");
            assert!(after_only.note.contains("the after-session was uneven"), "{}", after_only.note);
            assert_eq!(with_steady_sessions(measured(low1), None, None), measured(low1), "steady sessions keep the verdict");
        }
        // A clean improvement on steady sessions is still kept.
        assert!(with_steady_sessions(measured(180.0), None, None).keep);
    }

    #[test]
    fn a_verdict_that_was_never_judged_keeps_its_own_reason() {
        let h = BaselineHalves { first_half_fps: 200.0, second_half_fps: 240.0 };
        let crash = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, Some("Test"), Some(5), Utc::now());
        let thin = conclude_outcome(&rec(150.0, 5), 180.0, 10, false, Some("Test"), Some(5), Utc::now());
        let confounded = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Test"), Some(6), Utc::now());
        let wrong_game = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Other"), Some(5), Utc::now());
        for o in [crash, thin, confounded, wrong_game] {
            let verdict = o.verdict.clone();
            assert_eq!(with_steady_sessions(o, Some(&h), Some(&h)).verdict, verdict);
        }
        // And the later guards never turn "too noisy" back into a measured verdict or a keep.
        let noisy = with_steady_sessions(measured(180.0), Some(&h), None);
        assert_eq!(guard_target_at_conclude(noisy.clone(), None).verdict, "too-noisy");
        assert_eq!(with_unverified_changes(noisy.clone(), 2).verdict, "too-noisy");
        assert_eq!(guard_target_at_conclude(noisy, Some(false)).verdict, "confounded", "a reverted setting is the stronger reason");
    }

    #[test]
    fn a_too_noisy_result_on_a_partial_pairing_still_says_what_went_unchecked() {
        let pairing = partial_pairing();
        let h = BaselineHalves { first_half_fps: 259.8, second_half_fps: 227.9 };
        let o = with_comparability(with_steady_sessions(measured(180.0), Some(&h), None), &pairing);
        assert_eq!(o.verdict, "too-noisy", "a Partial pairing never turns it back into a measured verdict");
        assert!(o.note.starts_with("Too noisy to judge: the baseline was uneven"), "{}", o.note);
        assert!(o.note.contains("too uneven on its own to tell this setting's effect apart from the scene"), "{}", o.note);
        assert!(o.note.contains("Not every condition could be checked either"), "{}", o.note);
        assert!(o.note.contains(&pairing.missing_context[0]), "{}", o.note);
        assert_eq!(o.confidence, Confidence::Unknown);
    }

    #[test]
    fn the_baseline_grade_at_conclude_comes_from_the_start_else_from_the_session_now() {
        let uneven = traced(1172, AFK_BASELINE_FPS);
        let steady = traced(600, &[200.0; 60]);
        // Graded at start: the record wins, whatever the session holds now (it may have shed its trace).
        assert_eq!(
            uneven_baseline_at_conclude(&afk_trial(), Some(&steady)),
            Some(BaselineHalves { first_half_fps: 259.8, second_half_fps: 227.9 })
        );
        let started_steady = ExperimentRecord { baseline_check: Some(BaselineCheck::Steady), ..running() };
        assert_eq!(uneven_baseline_at_conclude(&started_steady, Some(&uneven)), None);
        let started_untraced = ExperimentRecord { baseline_check: Some(BaselineCheck::Untraced), ..running() };
        assert_eq!(uneven_baseline_at_conclude(&started_untraced, Some(&uneven)), None, "untraced is never read as uneven");
        // A Trial started before baselines were graded: the baseline session is graded now.
        assert!(uneven_baseline_at_conclude(&running(), Some(&uneven)).is_some());
        assert_eq!(uneven_baseline_at_conclude(&running(), Some(&steady)), None);
        assert_eq!(uneven_baseline_at_conclude(&running(), None), None);
    }

    #[test]
    fn the_after_sessions_grade_is_written_and_an_older_compy_still_loads_the_record() {
        let mut v = serde_json::to_value(ExperimentRecord {
            treatment: Some(TreatmentRecord {
                avg_fps: 203.5,
                low1_fps: 125.1,
                samples: 1095,
                crashed: false,
                delta_low1_pct: -18.5,
                recorded_at: TREAT_ID.into(),
                session_id: Some(TREAT_ID.into()),
                check: Some(BaselineCheck::Uneven),
                halves: Some(BaselineHalves { first_half_fps: 188.7, second_half_fps: 218.5 }),
                delta_avg_pct: Some(-16.6),
            }),
            verdict: Some("too-noisy".into()),
            trial_result: Some(TrialResult::Inconclusive),
            status: ExperimentStatus::Restored,
            ..afk_trial()
        })
        .unwrap();
        assert_eq!(v["treatment"]["check"], "uneven");
        assert_eq!(v["trial_result"], "inconclusive", "an existing class: an older Compy knows it");
        // An older Compy's types (no such fields, a plain-string verdict) load the file.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OlderTreatment {
            low1_fps: f64,
            delta_low1_pct: f64,
            #[serde(default)]
            session_id: Option<String>,
        }
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OlderRecord {
            status: ExperimentStatus,
            #[serde(default)]
            treatment: Option<OlderTreatment>,
            #[serde(default)]
            verdict: Option<String>,
            #[serde(default)]
            trial_result: Option<TrialResult>,
        }
        let older: OlderRecord = serde_json::from_value(v.clone()).expect("an older Compy loads it");
        assert_eq!(older.verdict.as_deref(), Some("too-noisy"));
        assert_eq!(older.trial_result, Some(TrialResult::Inconclusive));
        // And this build loads a treatment written before sessions were graded.
        let t = v["treatment"].as_object_mut().unwrap();
        t.remove("check");
        t.remove("halves");
        let back: ExperimentRecord = serde_json::from_value(v).unwrap();
        let t = back.treatment.unwrap();
        assert_eq!((t.check, t.halves), (None, None));
    }

    #[test]
    fn conclude_grades_both_sessions_before_it_records_a_verdict() {
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn conclude_experiment(").unwrap()..];
        let body = &body[..body.find("pub(crate) fn restore_experiment(").unwrap()];
        // P4-judge-noisy (owner 2026-11-12): the grades stay on the receipt as evidence, but an uneven
        // session no longer turns the verdict too-noisy; see
        // `an_uneven_session_is_no_longer_a_reason_to_judge_nothing`.
        assert!(body.contains("grade_baseline(treatment, halves_floor_pct(rec))"), "the after-session is graded");
        assert!(body.contains("check: after_check"), "the receipt keeps the after-session's grade");
    }

    // ─── P4-noise: the band comes from this game's unchanged sessions ─────────

    #[test]
    fn the_receipt_names_the_between_session_spread_the_band_came_from() {
        let o = measured(150.5);
        let measured = crate::noise_floor::BetweenSessionNoise { spread_pct: 5.9, sessions: 4 };
        let band = crate::noise_floor::noise_band_pct(Some(&measured));
        assert_eq!(band, 5.9);
        let n = noise_evidence_for(&o, band, &NoiseLookup::Unmeasured, Some(&measured)).unwrap();
        assert_eq!((n.band_pct, n.between_sessions), (5.9, Some(measured)));
    }

    #[test]
    fn a_band_from_unchanged_sessions_judges_the_verdict() {
        // A +4% 1% low after the change: a win against the fixed 3%, noise against a 5.9% spread.
        let mut r = rec(150.0, 5);
        r.noise_floor_pct = 5.9;
        let o = conclude_outcome(&r, 156.0, 900, false, Some("Test"), Some(5), Utc::now());
        assert_eq!(o.verdict, "no-change", "{}", o.note);
        r.noise_floor_pct = DEFAULT_NOISE_FLOOR_PCT;
        assert_eq!(conclude_outcome(&r, 156.0, 900, false, Some("Test"), Some(5), Utc::now()).verdict, "improved");
    }

    #[test]
    fn a_wide_between_session_band_never_loosens_the_uneven_check() {
        // Halves 4.5% apart are uneven on the fixed 3%, whatever the verdict band is.
        let fps: Vec<f64> = [200.0; 30].into_iter().chain([209.0; 30]).collect();
        let baseline = traced(900, &fps);
        for halves in [Some(DEFAULT_NOISE_FLOOR_PCT), None] {
            let r = ExperimentRecord { noise_floor_pct: 8.0, halves_floor_pct: halves, baseline_check: None, ..running() };
            assert_eq!(halves_floor_pct(&r), DEFAULT_NOISE_FLOOR_PCT, "{halves:?}");
            assert!(uneven_baseline_at_conclude(&r, Some(&baseline)).is_some(), "baseline graded on the band: {halves:?}");
            assert!(
                matches!(session_check(grade_baseline(&baseline, halves_floor_pct(&r))).0, Some(BaselineCheck::Uneven)),
                "after-session graded on the band: {halves:?}"
            );
        }
    }

    #[test]
    fn a_record_with_a_between_session_floor_loads_in_an_older_compy_and_an_older_record_loads_here() {
        let mut r = rec(150.0, 5);
        r.noise_floor_pct = 5.9;
        r.between_session_noise = Some(crate::noise_floor::BetweenSessionNoise { spread_pct: 5.9, sessions: 4 });
        r.noise_evidence = Some(NoiseEvidence {
            band_pct: 5.9,
            measured_noise_pct: None,
            measured_noise_stale: None,
            between_sessions: r.between_session_noise.clone(),
        });
        let text = serde_json::to_string(&ExperimentStore { schema_version: STORE_SCHEMA_VERSION, experiments: vec![r] }).unwrap();
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OldEvidence {
            band_pct: f64,
            #[serde(default)]
            measured_noise_pct: Option<f64>,
        }
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OldRecord {
            id: String,
            noise_floor_pct: f64,
            #[serde(default)]
            noise_evidence: Option<OldEvidence>,
        }
        #[derive(Deserialize)]
        struct OldStore {
            experiments: Vec<OldRecord>,
        }
        let old: OldStore = serde_json::from_str(&text).expect("an older Compy loads the file");
        assert_eq!(old.experiments[0].noise_floor_pct, 5.9, "the floor actually used is on the record");
        assert_eq!(old.experiments[0].noise_evidence.as_ref().map(|n| n.band_pct), Some(5.9));

        // A record written before P4-noise loads with nothing measured between sessions.
        let mut v = serde_json::to_value(rec(150.0, 5)).unwrap();
        v.as_object_mut().unwrap().remove("between_session_noise");
        v.as_object_mut().unwrap().remove("halves_floor_pct");
        v["noise_evidence"] = serde_json::json!({ "band_pct": 3.0, "measured_noise_pct": null });
        let back: ExperimentRecord = serde_json::from_value(v).expect("an older record loads");
        assert_eq!(back.between_session_noise, None);
        assert_eq!((back.halves_floor_pct, halves_floor_pct(&back)), (None, DEFAULT_NOISE_FLOOR_PCT));
        assert_eq!(back.noise_evidence.unwrap().between_sessions, None);
    }

    // ─── P4-recommended (ENGINE §2 recommended, §6 default wins ties) ─────────────

    /// A measured verdict on `rec(150.0, 5)` (baseline avg 120 fps, 1% low 150, band 3%), read as the
    /// Recommended outcome with the after-session's average.
    fn recommended(treatment_low1: f64, treatment_avg: f64) -> ConcludeOutcome {
        let r = rec(150.0, 5);
        with_recommended_outcome(measured(treatment_low1), r.noise_floor_pct, delta_avg_pct(r.baseline_avg_fps, treatment_avg))
    }

    #[test]
    fn a_1pct_low_gain_is_better_only_when_the_average_does_not_fall_beyond_the_band() {
        // +20% 1% low, average 120 → 118 (-1.7%): inside the band, a win.
        let kept = recommended(180.0, 118.0);
        assert_eq!((kept.verdict.as_str(), kept.keep), ("improved", true));
        assert_eq!(trial_result_for(&kept.verdict), TrialResult::Better);
        // The band's edge is not beyond it: -3.0% exactly still counts as "didn't drop".
        assert_eq!(recommended(180.0, 116.4).verdict, "improved");
        // +20% 1% low, but the average fell 8.3%: not a clear win; the default is kept.
        let o = recommended(180.0, 110.0);
        assert_eq!((o.verdict.as_str(), o.keep), ("no-change", false), "old code kept this");
        assert_eq!(trial_result_for(&o.verdict), TrialResult::Negligible);
        assert_eq!(o.stop_reason, None, "still judged against the band, so its noise evidence is recorded");
        assert!(o.note.contains("the 1% low +20%, the average frame rate -8.3%, both against a ±3% band"), "{}", o.note);
        assert!(o.note.contains("the average fell by more than it"), "{}", o.note);
        assert!(o.note.contains("default was kept and the change restored"), "{}", o.note);
    }

    #[test]
    fn an_average_that_rises_beside_a_falling_1pct_low_is_worse() {
        // Synthetic: 1% low 150 → 140 (-6.7%), average 120 → 130 (+8.3%).
        let o = recommended(140.0, 130.0);
        assert_eq!((o.verdict.as_str(), o.keep), ("regressed", false));
        assert_eq!(trial_result_for(&o.verdict), TrialResult::Worse);
        assert!(o.note.contains("the 1% low -6.7%, the average frame rate +8.3%, both against a ±3% band"), "{}", o.note);
        assert!(o.note.contains("The 1% low fell by more than the band"), "{}", o.note);
    }

    #[test]
    fn ties_keep_the_default_and_a_restore_is_never_turned_into_a_keep() {
        // +2% 1% low with a big average gain: inside the band on the 1% low, so No change.
        let tie = recommended(153.0, 150.0);
        assert_eq!((tie.verdict.as_str(), tie.keep), ("no-change", false));
        assert!(tie.note.contains("The 1% low stayed inside the band"), "{}", tie.note);
        for (low1, avg) in [(153.0, 150.0), (140.0, 130.0), (100.0, 200.0), (147.0, 60.0)] {
            assert!(!recommended(low1, avg).keep, "low1 {low1}, avg {avg}: a restore stays restored");
        }
        // An unknown average is never read as "didn't drop".
        let r = rec(150.0, 5);
        let unknown = with_recommended_outcome(measured(180.0), r.noise_floor_pct, None);
        assert_eq!((unknown.verdict.as_str(), unknown.keep), ("no-change", false));
        assert!(unknown.note.contains("the average frame rate couldn't be compared"), "{}", unknown.note);
        assert_eq!(delta_avg_pct(0.0, 120.0), None);
        assert_eq!(delta_avg_pct(120.0, 0.0), None);
    }

    #[test]
    fn the_recommended_rule_uses_the_measured_band_for_both_numbers() {
        // A 6% between-session band: a +5% 1% low is inside it, a -5% average is inside it too.
        let r = ExperimentRecord { noise_floor_pct: 6.0, ..rec(150.0, 5) };
        let judged = |low1: f64, avg: f64| {
            let o = conclude_outcome(&r, low1, 5000, false, Some("Test"), Some(5), Utc::now());
            with_recommended_outcome(o, r.noise_floor_pct, delta_avg_pct(r.baseline_avg_fps, avg))
        };
        assert_eq!(judged(157.5, 114.0).verdict, "no-change");
        assert_eq!(judged(165.0, 114.0).verdict, "improved", "+10% low, -5% avg: inside a 6% band");
        let fell = judged(165.0, 112.0);
        assert_eq!(fell.verdict, "no-change", "-6.7% avg is beyond a 6% band");
        assert!(fell.note.contains("+6% / -5.6% band"), "{}", fell.note);
    }

    #[test]
    fn every_earlier_gate_keeps_its_verdict_ahead_of_the_recommended_rule() {
        let h = BaselineHalves { first_half_fps: 200.0, second_half_fps: 240.0 };
        let crash = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, Some("Test"), Some(5), Utc::now());
        let thin = conclude_outcome(&rec(150.0, 5), 180.0, 10, false, Some("Test"), Some(5), Utc::now());
        let confounded = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Test"), Some(6), Utc::now());
        let wrong_game = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Other"), Some(5), Utc::now());
        let noisy = with_steady_sessions(measured(180.0), Some(&h), None);
        let changed = {
            let mut p = partial_pairing();
            p.changed_context = vec!["The GPU driver changed.".into()];
            with_comparability(measured(180.0), &p)
        };
        for o in [crash, thin, confounded, wrong_game, noisy, changed] {
            // An average that fell or is unknown would demote a win; a gate's verdict is left alone.
            for avg in [None, Some(-50.0), Some(50.0)] {
                assert_eq!(with_recommended_outcome(o.clone(), 3.0, avg), o, "{} / {avg:?}", o.verdict);
            }
        }
        // A Partial pairing keeps its caveat and gains what was compared.
        let partial = with_recommended_outcome(with_comparability(measured(180.0), &partial_pairing()), 3.0, Some(-1.0));
        assert_eq!(partial.verdict, "improved");
        assert!(partial.note.contains("not every condition could be checked"), "{}", partial.note);
        assert!(partial.note.contains("the 1% low +20%, the average frame rate -1%"), "{}", partial.note);
    }

    #[test]
    fn the_owners_minus_18_5_percent_trial_reads_too_noisy_and_on_steady_sessions_worse() {
        let rec = afk_trial();
        let after = afk_after();
        let concluded = DateTime::parse_from_rfc3339(APPLIED).unwrap().with_timezone(&Utc) + chrono::Duration::hours(1);
        let judged = conclude_outcome(&rec, after.low1_fps_est, after.samples, false, Some(&after.process_name), Some(5), concluded);
        let avg = delta_avg_pct(rec.baseline_avg_fps, after.avg_fps);
        assert_eq!(avg, Some(-16.6), "244.1 → 203.5 fps");
        // As concluded: both sessions uneven, so too noisy, restored, whatever the average says.
        let (_, after_halves) = session_check(grade_baseline(&after, halves_floor_pct(&rec)));
        let noisy = with_steady_sessions(judged.clone(), uneven_baseline_at_conclude(&rec, None).as_ref(), after_halves.as_ref());
        let o = with_recommended_outcome(noisy.clone(), rec.noise_floor_pct, avg);
        assert_eq!(o, noisy);
        assert_eq!((o.verdict.as_str(), o.keep), ("too-noisy", false));
        // Had both sessions been steady: the 1% low fell 18.5%, beyond the band, so Worse.
        let steady = with_recommended_outcome(judged, rec.noise_floor_pct, avg);
        assert_eq!((steady.verdict.as_str(), steady.keep), ("regressed", false));
        assert!(steady.note.contains("the 1% low -18.5%, the average frame rate -16.6%, both against a ±3% band"), "{}", steady.note);
    }

    #[test]
    fn the_average_delta_is_stored_additively_and_older_records_load_without_it() {
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn conclude_experiment(").unwrap()..];
        let body = &body[..body.find("pub(crate) fn restore_experiment(").unwrap()];
        assert!(
            body.contains("with_recommended_outcome_bands(paired, n.low1_band_pct, n.avg_band_pct, avg)"),
            "the verdict is read as Recommended, each number on its measured band (P4-judge-noisy)"
        );
        assert!(body.contains("delta_avg_pct: delta_avg_pct(rec_baseline_avg, treatment.avg_fps)"), "the receipt keeps it");
        let t = TreatmentRecord {
            avg_fps: 110.0,
            low1_fps: 180.0,
            samples: 900,
            crashed: false,
            delta_low1_pct: 20.0,
            recorded_at: TREAT_ID.into(),
            session_id: Some(TREAT_ID.into()),
            check: None,
            halves: None,
            delta_avg_pct: Some(-8.3),
        };
        let mut v = serde_json::to_value(ExperimentRecord { treatment: Some(t), ..running() }).unwrap();
        assert_eq!(v["treatment"]["delta_avg_pct"], -8.3);
        // An older Compy's treatment type (no such field) loads it.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OlderTreatment {
            avg_fps: f64,
            low1_fps: f64,
            delta_low1_pct: f64,
        }
        let older: OlderTreatment = serde_json::from_value(v["treatment"].clone()).expect("older shape loads");
        assert_eq!(older.delta_low1_pct, 20.0);
        // A treatment written before the average was judged loads as unknown.
        assert!(v["treatment"].as_object_mut().unwrap().remove("delta_avg_pct").is_some());
        let back: ExperimentRecord = serde_json::from_value(v).unwrap();
        assert_eq!(back.treatment.unwrap().delta_avg_pct, None);
    }

    // ─── P4-maxfps-smooth (ENGINE §2 max_fps; Smoothest held until frame pacing is measured) ──

    /// A measured verdict on `rec(150.0, 5)` (baseline avg 120 fps, 1% low 150, band 3%), read as the
    /// Maximum FPS outcome.
    fn max_fps(treatment_low1: f64, treatment_avg: f64) -> ConcludeOutcome {
        let r = rec(150.0, 5);
        with_max_fps_outcome(measured(treatment_low1), r.noise_floor_pct, delta_avg_pct(r.baseline_avg_fps, treatment_avg))
    }

    #[test]
    fn maximum_fps_keeps_an_average_gain_only_when_the_1pct_low_holds() {
        // Average +8.3%, 1% low unchanged: kept.
        let kept = max_fps(150.0, 130.0);
        assert_eq!((kept.verdict.as_str(), kept.keep), ("improved", true));
        assert!(kept.note.contains("Judged for Maximum FPS. Compared with the baseline: the average frame rate +8.3%, the 1% low 0%, both against a ±3% band."), "{}", kept.note);
        assert!(kept.note.contains("The average rose by more than the band and the 1% low didn't fall by more"), "{}", kept.note);
        // Average +8.3%, 1% low -6.7%: Worse.
        let low_fell = max_fps(140.0, 130.0);
        assert_eq!((low_fell.verdict.as_str(), low_fell.keep), ("regressed", false));
        assert!(low_fell.note.contains("The 1% low fell by more than the band"), "{}", low_fell.note);
        // A 1% low gain with the average inside the band: Recommended keeps it, Maximum FPS doesn't.
        let tie = max_fps(180.0, 122.4);
        assert_eq!((tie.verdict.as_str(), tie.keep), ("no-change", false));
        assert!(recommended(180.0, 122.4).keep, "the Recommended rule keeps the same reading");
        assert!(tie.note.contains("The average stayed inside the band"), "{}", tie.note);
        // Average fell beyond the band, whatever the 1% low did: Worse.
        let avg_fell = max_fps(180.0, 110.0);
        assert_eq!((avg_fell.verdict.as_str(), avg_fell.keep), ("regressed", false));
        assert!(avg_fell.note.contains("The average fell by more than the band"), "{}", avg_fell.note);
        // An unknown average is never a win.
        let r = rec(150.0, 5);
        let unknown = with_max_fps_outcome(measured(180.0), r.noise_floor_pct, None);
        assert_eq!((unknown.verdict.as_str(), unknown.keep), ("no-change", false));
        assert!(unknown.note.contains("the average frame rate couldn't be compared"), "{}", unknown.note);
    }

    #[test]
    fn maximum_fps_with_both_numbers_inside_the_band_is_no_change() {
        // Average +2% (120 → 122.4), 1% low -2% (150 → 147): both inside ±3%.
        let o = max_fps(147.0, 122.4);
        assert_eq!((o.verdict.as_str(), o.keep), ("no-change", false));
        assert_eq!(trial_result_for(&o.verdict), TrialResult::Negligible);
        assert_eq!(o.stop_reason, None, "still judged against the band");
        assert!(o.note.contains("the average frame rate +2%, the 1% low -2%, both against a ±3% band"), "{}", o.note);
        assert!(o.note.contains("The average stayed inside the band, so the default was kept and the change restored."), "{}", o.note);
        // The band's edges are inside it, on both numbers.
        assert_eq!(max_fps(145.5, 123.6).verdict, "no-change", "+3.0% avg, -3.0% 1% low");
    }

    #[test]
    fn every_earlier_gate_keeps_its_verdict_ahead_of_maximum_fps() {
        let h = BaselineHalves { first_half_fps: 200.0, second_half_fps: 240.0 };
        let crash = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, Some("Test"), Some(5), Utc::now());
        let thin = conclude_outcome(&rec(150.0, 5), 180.0, 10, false, Some("Test"), Some(5), Utc::now());
        let confounded = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Test"), Some(6), Utc::now());
        let wrong_game = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Other"), Some(5), Utc::now());
        let noisy = with_steady_sessions(measured(180.0), Some(&h), None);
        let changed = {
            let mut p = partial_pairing();
            p.changed_context = vec!["The GPU driver changed.".into()];
            with_comparability(measured(180.0), &p)
        };
        for o in [crash, thin, confounded, wrong_game, noisy, changed] {
            for avg in [None, Some(-50.0), Some(50.0)] {
                assert_eq!(with_max_fps_outcome(o.clone(), 3.0, avg), o, "{} / {avg:?}", o.verdict);
            }
        }
    }

    #[test]
    fn a_start_reads_smoothest_and_refuses_any_outcome_this_build_does_not_judge() {
        assert_eq!(start_outcome(None), Ok(TrialOutcome::Recommended));
        assert_eq!(start_outcome(Some("recommended")), Ok(TrialOutcome::Recommended));
        assert_eq!(start_outcome(Some("max-fps")), Ok(TrialOutcome::MaxFps));
        // P4-smooth-offer: read here, admitted or refused by `smoothest_admission` in the start.
        assert_eq!(start_outcome(Some("smoothest")), Ok(TrialOutcome::Smoothest));
        let unknown = start_outcome(Some(&"x".repeat(500))).unwrap_err();
        assert!(unknown.starts_with("experiment not started — Compy doesn't know the outcome"), "{unknown}");
        assert!(unknown.len() < 120, "a long pick is capped: {unknown}");
        // The refusal comes before the store is locked, read or written.
        let src = include_str!("experiment.rs");
        let start = &src[src.find("pub(crate) fn start_experiment(").unwrap()..];
        let refuse = start.find("let outcome = start_outcome(outcome.as_deref())?;").expect("start reads the pick");
        assert!(refuse < start.find("lock_store()").unwrap(), "refused before anything is touched");
        assert!(start[..start.find("save_store(&store)?").unwrap()].contains("        outcome,\n"));
        // A stored "smoothest" reads as itself; an unknown pick reads as Recommended.
        assert_eq!(serde_json::from_value::<TrialOutcome>("smoothest".into()).unwrap(), TrialOutcome::Smoothest);
        for v in ["turbo", ""] {
            assert_eq!(serde_json::from_value::<TrialOutcome>(v.into()).unwrap(), TrialOutcome::Recommended, "{v}");
        }
        assert_eq!(serde_json::from_value::<TrialOutcome>(serde_json::Value::Null).unwrap(), TrialOutcome::Recommended);
    }

    // P8-dims (RISK_MODEL §3, TRIAL_PROTOCOL §1 `risk_class`): a start keeps what the catalog stated
    // about the change's risk on its record, read before the store lock and saved with the Pending
    // record; an older record without it, or with a value this build can't read, loads as None
    // ("not recorded"), never as a failed store.
    #[test]
    fn a_start_keeps_the_catalogs_stated_risk_and_an_older_record_still_loads() {
        let src = include_str!("experiment.rs");
        let start = &src[src.find("pub(crate) fn start_experiment(").unwrap()..];
        let read = start.find("let stated_risk = crate::trial_candidates::stated_risk_now(&rec_id);").expect("start reads it");
        assert!(read < start.find("lock_store()").unwrap(), "read before the store lock");
        assert!(start[..start.find("save_store(&store)?").unwrap()].contains("        stated_risk,\n"), "saved with the Pending record");

        use crate::trial_candidates::{DimensionRisk, Risk, RiskDimensions, StatedRisk};
        let stated = StatedRisk {
            overall: Risk::Moderate,
            dimensions: RiskDimensions { security: Some(DimensionRisk::Low), ..RiskDimensions::default() },
            ..StatedRisk::default()
        };
        let r = ExperimentRecord { stated_risk: Some(stated.clone()), ..rec(150.0, 5) };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["stated_risk"]["overall"], "moderate");
        assert_eq!(v["stated_risk"]["dimensions"]["security"], "low");
        assert!(v["stated_risk"]["dimensions"]["reversibility"].is_null(), "not stated stays null");
        assert_eq!(serde_json::from_value::<ExperimentRecord>(v.clone()).unwrap().stated_risk, Some(stated));
        // A record that never kept it: no key, and it loads as None.
        assert!(serde_json::to_value(rec(150.0, 5)).unwrap().get("stated_risk").is_none());
        let mut old = v.clone();
        old.as_object_mut().unwrap().remove("stated_risk");
        assert_eq!(serde_json::from_value::<ExperimentRecord>(old).unwrap().stated_risk, None);
        // A value a newer Compy wrote that this build can't read: None, and the record still loads.
        let mut odd = v;
        odd["stated_risk"] = serde_json::json!("high");
        assert_eq!(serde_json::from_value::<ExperimentRecord>(odd).unwrap().stated_risk, None);
    }

    // P8-posture-show (RISK_MODEL §2): the start keeps the risk the user allowed, as the webview said
    // it, on the Pending record. A record from before, a start that didn't say, or a choice this build
    // doesn't know loads as None ("not recorded"), never as the default and never as a failed store.
    #[test]
    fn a_start_keeps_the_risk_choice_in_force_and_an_older_record_reads_not_recorded() {
        use crate::trial_candidates::RiskChoice;
        let src = include_str!("experiment.rs");
        let start = &src[src.find("pub(crate) fn start_experiment(").unwrap()..];
        let params = &start[..start.find(") -> Result<").unwrap()];
        assert!(params.contains("risk_choice: Option<crate::trial_candidates::RiskChoice>,"), "{params}");
        assert!(start[..start.find("save_store(&store)?").unwrap()].contains("        risk_choice,\n"), "saved with the Pending record");

        for (choice, word) in [(RiskChoice::LowOnly, "low-only"), (RiskChoice::LowAndModerate, "low-and-moderate")] {
            let v = serde_json::to_value(ExperimentRecord { risk_choice: Some(choice), ..rec(150.0, 5) }).unwrap();
            assert_eq!(v["risk_choice"], word);
            assert_eq!(serde_json::from_value::<ExperimentRecord>(v).unwrap().risk_choice, Some(choice));
        }
        // Not recorded: no key, and an older record loads as None, not as the default choice.
        let v = serde_json::to_value(rec(150.0, 5)).unwrap();
        assert!(v.get("risk_choice").is_none());
        assert_eq!(serde_json::from_value::<ExperimentRecord>(v.clone()).unwrap().risk_choice, None);
        for odd in [serde_json::json!("aggressive"), serde_json::json!(null), serde_json::json!(3)] {
            let mut r = v.clone();
            r["risk_choice"] = odd.clone();
            assert_eq!(serde_json::from_value::<ExperimentRecord>(r).unwrap().risk_choice, None, "{odd}");
        }
    }

    // P8-ack (RISK_MODEL §1 Advanced): the start keeps whether the user confirmed the change's cost
    // ("I understand, test it", a UI confirm before this command) on the Pending record, beside the
    // catalog's own cost words it read (`stated_risk.cost`), and (P8-ack-enforce) refuses a change
    // the catalog doesn't rate low risk without that tap. Older records load as None ("not
    // recorded"); a value this build can't read is None too, never a failed store.
    #[test]
    fn a_start_keeps_the_cost_acknowledgement_and_an_older_record_reads_not_recorded() {
        let src = include_str!("experiment.rs");
        let start = &src[src.find("pub(crate) fn start_experiment(").unwrap()..];
        let params = &start[..start.find(") -> Result<").unwrap()];
        assert!(params.contains("cost_acknowledged: Option<bool>,"), "{params}");
        let first_save = start.find("save_store(&store)?").unwrap();
        assert!(start[..first_save].contains("        cost_acknowledged,\n"), "saved with the Pending record");
        // P8-ack-enforce: the parameter, ONE refusal before the store lock (nothing recorded or changed
        // yet), and the record field — the second lock behind the UI's tap.
        assert_eq!(start[..first_save].matches("cost_acknowledged").count(), 3, "parameter, refusal, record field");
        let refusal = start.find("cost_acknowledged != Some(true)").expect("the refusal");
        let lock = start.find("let _g = lock_store()?;").expect("the store lock");
        assert!(refusal < lock, "refused before the store lock, so nothing is recorded or changed");
        assert!(start[..refusal].contains("needs_cost_ack(stated_risk.as_ref())"), "the catalog's own rating decides");
        // The rule itself: safe starts without the tap; moderate, unstated and unlisted need it.
        use crate::trial_candidates::{Risk, StatedRisk};
        let rated = |overall: Risk| StatedRisk { overall, ..Default::default() };
        assert!(!needs_cost_ack(Some(&rated(Risk::Low))));
        assert!(needs_cost_ack(Some(&rated(Risk::Moderate))));
        assert!(needs_cost_ack(Some(&rated(Risk::Unknown))));
        assert!(needs_cost_ack(None), "a change the catalog doesn't list can't be shown to be low risk");

        for ack in [true, false] {
            let v = serde_json::to_value(ExperimentRecord { cost_acknowledged: Some(ack), ..rec(150.0, 5) }).unwrap();
            assert_eq!(v["cost_acknowledged"], ack);
            assert_eq!(serde_json::from_value::<ExperimentRecord>(v).unwrap().cost_acknowledged, Some(ack));
        }
        let v = serde_json::to_value(rec(150.0, 5)).unwrap();
        assert!(v.get("cost_acknowledged").is_none());
        assert_eq!(serde_json::from_value::<ExperimentRecord>(v.clone()).unwrap().cost_acknowledged, None);
        for odd in [serde_json::json!("yes"), serde_json::json!(null), serde_json::json!(1)] {
            let mut r = v.clone();
            r["cost_acknowledged"] = odd.clone();
            assert_eq!(serde_json::from_value::<ExperimentRecord>(r).unwrap().cost_acknowledged, None, "{odd}");
        }
        // The cost words the user saw are the catalog's, kept with the stated risk at the start.
        let stated = crate::trial_candidates::StatedRisk { cost: Some("Search gets slower.".into()), ..Default::default() };
        let v = serde_json::to_value(ExperimentRecord { stated_risk: Some(stated.clone()), ..rec(150.0, 5) }).unwrap();
        assert_eq!(v["stated_risk"]["cost"], "Search gets slower.");
        assert_eq!(serde_json::from_value::<ExperimentRecord>(v).unwrap().stated_risk, Some(stated));
    }

    // ─── P4-smooth-offer-a (ENGINE §2 smoothest: offered once this game's pacing noise is measured) ──

    fn pacing(spread_pct: f64) -> crate::noise_floor::BetweenSessionNoise {
        crate::noise_floor::BetweenSessionNoise { spread_pct, sessions: 3 }
    }

    /// A measured verdict on `rec(150.0, 5)` (1% low 150, band 3%), read as Smoothest from a start
    /// ratio of 1.5 on a 2% pacing band.
    fn smoothest(treatment_low1: f64, after_ratio: Option<f64>) -> ConcludeOutcome {
        let ev = smoothest_admission(true, Some(&pacing(1.0)), Some(1.5)).unwrap();
        with_smoothest_outcome(measured(treatment_low1), Some(&ev), after_ratio, rec(150.0, 5).noise_floor_pct)
    }

    #[test]
    fn smoothest_starts_only_when_this_games_pacing_noise_is_measured() {
        assert_eq!(smoothest_admission(true, None, Some(1.5)), Err(SmoothestHeld::Unmeasured));
        assert_eq!(smoothest_admission(true, Some(&pacing(4.0)), None), Err(SmoothestHeld::NoStartPacing));
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(smoothest_admission(true, Some(&pacing(4.0)), Some(bad)), Err(SmoothestHeld::NoStartPacing), "{bad}");
        }
        // An unreadable history is said as itself, ahead of anything else.
        assert_eq!(smoothest_admission(false, None, None), Err(SmoothestHeld::HistoryUnread));
        // The band is the measured spread, never below the ratio's resolution; NaN gets the floor.
        assert_eq!(smoothest_admission(true, Some(&pacing(1.0)), Some(1.5)).unwrap().band_pct, PACING_RESOLUTION_PCT);
        assert_eq!(smoothest_admission(true, Some(&pacing(f64::NAN)), Some(1.5)).unwrap().band_pct, PACING_RESOLUTION_PCT);
        let wide = smoothest_admission(true, Some(&pacing(4.5)), Some(1.5)).unwrap();
        assert_eq!((wide.band_pct, wide.start_ratio, wide.after_ratio), (4.5, 1.5, None));
        assert_eq!(wide.between_sessions, pacing(4.5));
        // The words: each names what is missing, and none reads as a baseline refusal (the journey's
        // `refusesBaseline` matches /baseline/i).
        let unmeasured = smoothest_held_message(SmoothestHeld::Unmeasured);
        assert!(unmeasured.starts_with("Smoothest needs at least 3 sessions of this game with nothing changed between them"), "{unmeasured}");
        let no_ratio = smoothest_held_message(SmoothestHeld::NoStartPacing);
        assert!(no_ratio.contains("the session this Trial starts from"), "{no_ratio}");
        let unread = smoothest_held_message(SmoothestHeld::HistoryUnread);
        assert!(unread.starts_with("Smoothest needs Compy's change history"), "{unread}");
        assert!(unread.contains("Test \u{2192} Applied & history"), "{unread}");
        assert!(!unread.contains("Play this game"), "{unread}");
        for w in [unmeasured, no_ratio, unread] {
            assert!(!w.to_lowercase().contains("baseline"), "{w}");
        }
        // The keys the bench reads.
        assert_eq!(serde_json::to_value(SmoothestHeld::HistoryUnread).unwrap(), "history-unread");
        assert_eq!(serde_json::to_value(SmoothestHeld::Unmeasured).unwrap(), "unmeasured");
        assert_eq!(serde_json::to_value(SmoothestHeld::NoStartPacing).unwrap(), "no-start-pacing");
        // The start and the readiness check make the one same read, and the start refuses before the
        // record is saved or the change applied.
        let src = include_str!("experiment.rs");
        let start = &src[src.find("pub(crate) fn start_experiment(").unwrap()..];
        let admit = start.find("smoothest_for(&covered, baseline, &history)").expect("start admits Smoothest");
        assert!(admit < start.find("save_store(&store)?").unwrap(), "refused before anything is recorded");
        assert!(start[..start.find("save_store(&store)?").unwrap()].contains("        smoothest,\n"));
        let ready = &src[src.find("pub(crate) fn get_smoothest_readiness(").unwrap()..];
        let ready = &ready[..ready.find("\n}\n").unwrap()];
        assert!(ready.contains("held: smoothest_for(&sessions_the_ledger_covers(&sessions, coverage), from, &history).err(),"));
        for write in ["save_store", "lock_store", "apply_recommendation", "rollback_change", "write"] {
            assert!(!ready.contains(write), "the readiness check is read-only: {write}");
        }
    }

    #[test]
    fn smoothest_keeps_steadier_frames_only_when_the_1pct_low_holds() {
        // Ratio 1.5 → 1.44 (-4.2% of the lower ratio), 1% low unchanged: kept.
        let kept = smoothest(150.0, Some(1.44));
        assert_eq!((kept.verdict.as_str(), kept.keep), ("improved", true));
        assert!(kept.note.contains("Judged for Smoothest. Compared with the start: the gap between the slowest 1% of frames and a typical frame -4% against a ±2% band, the 1% low 0% against a ±3% band."), "{}", kept.note);
        assert!(kept.note.contains("Frames got steadier by more than the band"), "{}", kept.note);
        // Steadier, but the 1% low fell beyond its band (150 → 140, -6.7%): Worse.
        let low_fell = smoothest(140.0, Some(1.44));
        assert_eq!((low_fell.verdict.as_str(), low_fell.keep), ("regressed", false));
        assert!(low_fell.note.contains("The 1% low fell by more than its band"), "{}", low_fell.note);
        // More uneven beyond the band (1.5 → 1.56, +4%), whatever the 1% low did: Worse.
        let uneven = smoothest(180.0, Some(1.56));
        assert_eq!((uneven.verdict.as_str(), uneven.keep), ("regressed", false));
        assert!(uneven.note.contains("Frames got more uneven by more than the band"), "{}", uneven.note);
        // A 1% low gain with pacing inside the band: Recommended keeps it, Smoothest doesn't.
        let tie = smoothest(180.0, Some(1.5));
        assert_eq!((tie.verdict.as_str(), tie.keep), ("no-change", false));
        assert!(tie.note.contains("Frame pacing stayed inside the band"), "{}", tie.note);
    }

    #[test]
    fn smoothest_band_edges_are_inside_the_band() {
        // ±2.0% exactly is inside; 2.1% is beyond (each a % of the lower ratio).
        assert_eq!(smoothest(150.0, Some(1.47)).verdict, "no-change", "-2.0%");
        assert_eq!(smoothest(150.0, Some(1.53)).verdict, "no-change", "+2.0%");
        assert_eq!(smoothest(150.0, Some(1.4685)).verdict, "improved", "-2.1%");
        assert_eq!(smoothest(150.0, Some(1.5315)).verdict, "regressed", "+2.1%");
        // The 1% low's own edge (-3%) is inside its band.
        assert_eq!(smoothest(145.5, Some(1.44)).verdict, "improved", "-3.0% 1% low holds");
        assert_eq!(trial_result_for(&smoothest(150.0, Some(1.5)).verdict), TrialResult::Negligible);
    }

    #[test]
    fn smoothest_pacing_that_couldnt_be_compared_is_never_a_win() {
        for after in [None, Some(0.0), Some(f64::NAN)] {
            let o = smoothest(180.0, after);
            assert_eq!((o.verdict.as_str(), o.keep), ("no-change", false), "{after:?}");
            assert!(o.note.contains("frame pacing couldn't be compared"), "{}", o.note);
        }
        assert_eq!(smoothest(140.0, None).verdict, "regressed", "a falling 1% low still counts");
        // No evidence recorded at start (a hand-edited or damaged record): never a win either.
        let none = with_smoothest_outcome(measured(180.0), None, Some(1.2), 3.0);
        assert_eq!((none.verdict.as_str(), none.keep), ("no-change", false));
    }

    #[test]
    fn every_earlier_gate_keeps_its_verdict_ahead_of_smoothest() {
        let h = BaselineHalves { first_half_fps: 200.0, second_half_fps: 240.0 };
        let crash = conclude_outcome(&rec(150.0, 5), 180.0, 5000, true, Some("Test"), Some(5), Utc::now());
        let thin = conclude_outcome(&rec(150.0, 5), 180.0, 10, false, Some("Test"), Some(5), Utc::now());
        let confounded = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Test"), Some(6), Utc::now());
        let wrong_game = conclude_outcome(&rec(150.0, 5), 180.0, 5000, false, Some("Other"), Some(5), Utc::now());
        let noisy = with_steady_sessions(measured(180.0), Some(&h), None);
        let ev = smoothest_admission(true, Some(&pacing(1.0)), Some(1.5)).unwrap();
        for o in [crash, thin, confounded, wrong_game, noisy] {
            for after in [None, Some(1.0), Some(3.0)] {
                assert_eq!(with_smoothest_outcome(o.clone(), Some(&ev), after, 3.0), o, "{} / {after:?}", o.verdict);
            }
        }
    }

    #[test]
    fn smoothest_is_judged_at_conclude_and_its_evidence_is_stored_additively() {
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn conclude_experiment(").unwrap()..];
        let body = &body[..body.find("pub(crate) fn restore_experiment(").unwrap()];
        assert!(body.contains("with_smoothest_outcome(paired, rec.smoothest.as_ref(), after_ratio, n.low1_band_pct)"));
        assert!(body.contains("ev.after_ratio = after_ratio;"));
        // Absent on every other outcome's record, so their stored shape is unchanged.
        let plain = serde_json::to_value(rec(150.0, 5)).unwrap();
        assert!(plain.get("smoothest").is_none());
        // Round-trips, and a record without the key loads as None.
        let mut ev = smoothest_admission(true, Some(&pacing(3.5)), Some(1.42)).unwrap();
        ev.after_ratio = Some(1.31);
        let r = ExperimentRecord { outcome: TrialOutcome::Smoothest, smoothest: Some(ev.clone()), ..rec(150.0, 5) };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["outcome"], "smoothest");
        assert_eq!(v["smoothest"]["band_pct"], 3.5);
        let back: ExperimentRecord = serde_json::from_value(v.clone()).unwrap();
        assert_eq!((back.outcome, back.smoothest), (TrialOutcome::Smoothest, Some(ev)));
        let mut old = v;
        old.as_object_mut().unwrap().remove("smoothest");
        assert_eq!(serde_json::from_value::<ExperimentRecord>(old).unwrap().smoothest, None);
        // A Trial chosen for Smoothest names it on the change it keeps or undoes.
        let mut x = ExperimentRecord { outcome: TrialOutcome::Smoothest, ..rec(150.0, 5) };
        x.status = ExperimentStatus::Kept;
        x.verdict = Some("improved".into());
        let link = trial_link_in(&[x.clone()], &x.id, &x.rec_id, true).unwrap();
        assert_eq!(link.outcome, "smoothest");
    }

    #[test]
    fn the_picked_outcome_is_stored_additively_and_an_older_compy_still_loads_the_record() {
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn conclude_experiment(").unwrap()..];
        let body = &body[..body.find("pub(crate) fn restore_experiment(").unwrap()];
        assert!(body.contains("TrialOutcome::MaxFps => with_max_fps_outcome(paired, n.low1_band_pct.max(n.avg_band_pct), avg)"));

        let t = TreatmentRecord {
            avg_fps: 130.0,
            low1_fps: 150.0,
            samples: 900,
            crashed: false,
            delta_low1_pct: 0.0,
            recorded_at: TREAT_ID.into(),
            session_id: Some(TREAT_ID.into()),
            check: Some(BaselineCheck::Steady),
            halves: Some(BaselineHalves { first_half_fps: 129.0, second_half_fps: 131.0 }),
            delta_avg_pct: Some(8.3),
        };
        let r = ExperimentRecord {
            outcome: TrialOutcome::MaxFps,
            treatment: Some(t),
            verdict: Some("improved".into()),
            trial_result: Some(TrialResult::Better),
            status: ExperimentStatus::Kept,
            kept: true,
            ..rec(150.0, 5)
        };
        let mut v = serde_json::to_value(ExperimentStore { schema_version: STORE_SCHEMA_VERSION, experiments: vec![r] }).unwrap();
        assert_eq!(v["experiments"][0]["outcome"], "max-fps");
        // The previous Compy's record and treatment types, field for field (abd4c883, before the pick
        // existed), load the file.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct PrevTreatment {
            avg_fps: f64,
            low1_fps: f64,
            samples: u32,
            crashed: bool,
            delta_low1_pct: f64,
            recorded_at: String,
            #[serde(default)]
            session_id: Option<String>,
            #[serde(default)]
            check: Option<BaselineCheck>,
            #[serde(default)]
            halves: Option<BaselineHalves>,
            #[serde(default)]
            delta_avg_pct: Option<f64>,
        }
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct PrevRecord {
            id: String,
            rec_id: String,
            rec_title: String,
            game: String,
            hypothesis: String,
            created_at: String,
            status: ExperimentStatus,
            baseline_avg_fps: f64,
            baseline_low1_fps: f64,
            ledger_watermark: usize,
            applied_change_id: String,
            #[serde(default)]
            active_changes_at_start: usize,
            #[serde(default)]
            attribution_warning: Option<String>,
            noise_floor_pct: f64,
            #[serde(default)]
            halves_floor_pct: Option<f64>,
            #[serde(default)]
            between_session_noise: Option<crate::noise_floor::BetweenSessionNoise>,
            #[serde(default)]
            treatment: Option<PrevTreatment>,
            #[serde(default)]
            verdict: Option<String>,
            #[serde(default)]
            kept: bool,
            #[serde(default)]
            stop_reason: Option<String>,
            #[serde(default)]
            concluded_at: Option<String>,
            #[serde(default)]
            verdict_confidence: Option<Confidence>,
            #[serde(default)]
            verdict_note: Option<String>,
            #[serde(default)]
            trial_result: Option<TrialResult>,
            #[serde(default)]
            target_verified: Option<bool>,
            #[serde(default)]
            prior_state_verified: bool,
            #[serde(default)]
            final_state_verified: Option<bool>,
            #[serde(default)]
            baseline_session_id: Option<String>,
            #[serde(default)]
            baseline_halves: Option<BaselineHalves>,
            #[serde(default)]
            baseline_check: Option<BaselineCheck>,
            #[serde(default)]
            applied_at: Option<String>,
            #[serde(default)]
            session_pairing: Option<SessionPairing>,
            #[serde(default)]
            noise_evidence: Option<NoiseEvidence>,
        }
        #[derive(Deserialize)]
        struct PrevStore {
            experiments: Vec<PrevRecord>,
        }
        let old: PrevStore = serde_json::from_value(v.clone()).expect("the previous Compy loads the file");
        let o = &old.experiments[0];
        assert_eq!((o.verdict.as_deref(), o.kept, o.status), (Some("improved"), true, ExperimentStatus::Kept));
        assert_eq!(o.treatment.as_ref().and_then(|t| t.delta_avg_pct), Some(8.3));
        // A record written before the pick existed loads as Recommended.
        let rec_v = &mut v["experiments"][0];
        assert!(rec_v.as_object_mut().unwrap().remove("outcome").is_some());
        let back: ExperimentRecord = serde_json::from_value(rec_v.clone()).unwrap();
        assert_eq!(back.outcome, TrialOutcome::Recommended);
    }

    // ─── P7-notify: the session-end toast fires only on a decision or a state change ───

    /// A steady cs2 session at `at` with this 1% low: forty 10 s buckets whose two halves are the same
    /// run (so its halves are even), moving freely enough that no frame cap reads as holding it
    /// (P4-judge-noisy: a session's cap state must be readable and the same to compare).
    fn steady(at: &str, low1: f64) -> SessionSummary {
        let mut s = session(at, low1);
        s.fps_series = (0..40u32).map(|i| (10 * i, 170.0 + f64::from((i % 20) * 7 % 60))).collect();
        s
    }

    #[test]
    fn a_frame_cap_that_changed_or_cant_be_read_never_toasts_a_regression() {
        let before = steady(BEFORE, 150.0);
        let mut capped = steady(NOW, 120.0);
        capped.fps_series = (0..40u32).map(|i| (10 * i, 144.0)).collect();
        assert_eq!(notice(&capped, &[before.clone(), capped.clone()]), None, "a cap went on: not the PC");
        let mut short = steady(NOW, 120.0);
        short.fps_series.truncate(8);
        assert_eq!(notice(&short, &[before.clone(), short.clone()]), None, "cap state can't be read");
        let now = steady(NOW, 120.0);
        assert_eq!(notice(&now, &[before, now.clone()]), Some(SessionEndNotice::Regressed), "same cap state: compared");
    }

    const BEFORE: &str = "2026-09-02T18:00:00+00:00";
    const NOW: &str = "2026-09-02T20:00:00+00:00";

    fn notice(now: &SessionSummary, sessions: &[SessionSummary]) -> Option<SessionEndNotice> {
        session_end_notice(now, sessions, &[], None, MEASURED)
    }

    /// A measured band at the default width (the live path passes `None` when unmeasured).
    const MEASURED: Option<f64> = Some(DEFAULT_NOISE_FLOOR_PCT);

    #[test]
    fn an_ordinary_session_ends_without_a_toast() {
        // Old behaviour: every saved session toasted "Your <game> debrief is ready".
        let before = steady(BEFORE, 150.0);
        for low1 in [150.0, 147.0, 170.0] {
            let now = steady(NOW, low1);
            assert_eq!(notice(&now, &[before.clone(), now.clone()]), None, "1% low {low1}: nothing settled");
        }
        // The first session of a game has nothing to settle either.
        let first = steady(NOW, 150.0);
        assert_eq!(notice(&first, std::slice::from_ref(&first)), None);
    }

    #[test]
    fn a_session_that_measured_nothing_never_toasts() {
        let mut behind = session(NOW, 0.0);
        behind.samples = 0;
        behind.avg_fps = 0.0;
        behind.background_secs_excluded = Some(900);
        let sessions = [steady(BEFORE, 150.0), behind.clone()];
        assert_eq!(
            session_end_notice(&behind, &sessions, &[running()], Some(ComparisonKind::Fix), MEASURED),
            None,
            "not even with a Trial running and a before/after armed"
        );
    }

    #[test]
    fn a_trials_after_session_toasts() {
        let after = session("2026-09-01T12:00:00+00:00", 150.0);
        let sessions = [session(BASE_ID, 150.0), after.clone()];
        let at = |trials: &[ExperimentRecord], s: &SessionSummary| {
            session_end_notice(s, &sessions, trials, None, MEASURED)
        };
        assert_eq!(at(&[running()], &after), Some(SessionEndNotice::TrialMeasured));
        // Review SHOULD-FIX: only THE after-session. A second one while the Trial is still Running
        // (the user hasn't concluded) stays silent.
        let second = session("2026-09-01T14:00:00+00:00", 150.0);
        let with_second = [session(BASE_ID, 150.0), after.clone(), second.clone()];
        assert_eq!(session_end_notice(&second, &with_second, &[running()], None, MEASURED), None);
        // An earlier after-session that measured nothing doesn't use up the toast.
        let mut hidden = after.clone();
        hidden.samples = 0;
        let with_hidden = [session(BASE_ID, 150.0), hidden, second.clone()];
        assert_eq!(
            session_end_notice(&second, &with_hidden, &[running()], None, MEASURED),
            Some(SessionEndNotice::TrialMeasured)
        );
        // Played before the change went on: not the after-session.
        assert_eq!(at(&[running()], &session("2026-09-01T11:02:00+00:00", 150.0)), None);
        // Another game, or a Trial already judged: nothing to settle.
        assert_eq!(at(&[ExperimentRecord { game: "valorant.exe".into(), ..running() }], &after), None);
        assert_eq!(at(&[ExperimentRecord { status: ExperimentStatus::Kept, ..running() }], &after), None);
        // A record without the apply time can't place the session after the change.
        assert_eq!(at(&[ExperimentRecord { applied_at: None, ..running() }], &after), None);
    }

    #[test]
    fn a_settled_before_after_toasts_but_a_tuning_readout_does_not() {
        let now = steady(NOW, 150.0);
        let sessions = [steady(BEFORE, 150.0), now.clone()];
        let with = |k| session_end_notice(&now, &sessions, &[], Some(k), MEASURED);
        assert_eq!(with(ComparisonKind::Fix), Some(SessionEndNotice::BeforeAfterSettled));
        // A tuning baseline reads out on every session of the game; that alone settles nothing.
        assert_eq!(with(ComparisonKind::Tuning), None);
    }

    #[test]
    fn a_drop_below_the_last_steady_session_beyond_the_band_toasts() {
        let before = steady(BEFORE, 150.0);
        let now = steady(NOW, 120.0); // 1% low -20%
        let sessions = [before.clone(), now.clone()];
        assert_eq!(notice(&now, &sessions), Some(SessionEndNotice::Regressed));
        // Inside a wider measured band it is noise, not a regression.
        assert_eq!(session_end_notice(&now, &sessions, &[], None, Some(25.0)), None);
        // Review SHOULD-FIX: an unmeasured band is a floor, not a measurement, so no regression claim.
        assert_eq!(session_end_notice(&now, &sessions, &[], None, None), None);
        // ...while a Trial or a settled before/after needs no band.
        assert_eq!(
            session_end_notice(&now, &sessions, &[], Some(ComparisonKind::Fix), None),
            Some(SessionEndNotice::BeforeAfterSettled)
        );
        // Too short to judge.
        let mut short = steady(NOW, 120.0);
        short.samples = MIN_BASELINE_SAMPLES - 1;
        assert_eq!(notice(&short, &[before.clone(), short.clone()]), None);
        // The newest earlier session is uneven: the comparison is against the last STEADY one.
        let mut uneven = steady("2026-09-02T19:00:00+00:00", 120.0);
        uneven.fps_series = (0..8).map(|i| (10 * i, if i < 4 { 200.0 } else { 150.0 })).collect();
        assert_eq!(notice(&now, &[before.clone(), uneven.clone(), now.clone()]), Some(SessionEndNotice::Regressed));
        // Only an uneven or untraced history: nothing steady to regress from.
        assert_eq!(notice(&now, &[uneven.clone(), now.clone()]), None);
        assert_eq!(notice(&now, &[session(BEFORE, 150.0), now.clone()]), None);
        // A later session is never the reference.
        assert_eq!(notice(&now, &[steady("2026-09-02T21:00:00+00:00", 150.0), now.clone()]), None);
        // Another game's steady session is not this game's.
        let other = SessionSummary { process_name: "valorant.exe".into(), ..before.clone() };
        assert_eq!(notice(&now, &[other, now.clone()]), None);
        // Not comparable (a different GPU): no verdict, so no toast.
        let mut new_gpu = before.clone();
        if let Some(h) = new_gpu.hw_fingerprint.as_mut() {
            h.gpu = "GeForce RTX 5090".into();
            h.hash = "cafef00d".into();
        }
        assert_eq!(notice(&now, &[new_gpu, now.clone()]), None);
    }

    #[test]
    fn the_toast_says_why_in_plain_words() {
        let b = |n: SessionEndNotice| n.body("WARDOGS-Win64-Shipping.exe");
        assert_eq!(b(SessionEndNotice::TrialMeasured), "Your WARDOGS Trial session is measured. Open Compy for the verdict.");
        assert_eq!(b(SessionEndNotice::BeforeAfterSettled), "Your WARDOGS before/after result is ready in Compy.");
        assert!(b(SessionEndNotice::Regressed).starts_with("WARDOGS dipped lower than in your last steady session."));
        for n in [SessionEndNotice::TrialMeasured, SessionEndNotice::BeforeAfterSettled, SessionEndNotice::Regressed] {
            assert!(!b(n).contains("1%") && !b(n).contains(".exe"), "{}", b(n));
        }
    }

    #[test]
    fn the_session_end_toast_fires_only_through_the_notice_rule() {
        // Pinned on the source: the monitoring loop has no live seam in tests.
        let monitoring = include_str!("monitoring.rs");
        let call = monitoring.find("crate::notify_debrief_ready(").expect("the toast call");
        let rule = monitoring.find("crate::experiment::session_end_notice_now(").expect("the notice rule");
        assert!(rule < call, "the toast is decided by session_end_notice_now");
        assert_eq!(monitoring.matches("notify_debrief_ready(").count(), 1, "one toast site");
        let lib = include_str!("lib.rs");
        assert!(!lib.contains("debrief is ready in Compy"), "no unconditional 'debrief ready' copy left");
    }

    // ─── P5-realplay: a change left on while you play, judged on several sessions a side ───

    // A real-play Trial stays on across many sessions, so its first after-session is not "the"
    // after-session that gets a verdict, and nothing toasts it. Old behaviour: TrialMeasured.
    #[test]
    fn a_real_play_trial_is_silent_after_its_first_session() {
        let mut v = serde_json::to_value(running()).unwrap();
        v["mode"] = "real-play".into();
        let real_play: ExperimentRecord = serde_json::from_value(v).unwrap();
        let after = session("2026-09-01T12:00:00+00:00", 150.0);
        let sessions = [session(BASE_ID, 150.0), after.clone()];
        assert_eq!(session_end_notice(&after, &sessions, &[real_play], None, MEASURED), None);
        // A two-session Trial still toasts its after-session.
        assert_eq!(session_end_notice(&after, &sessions, &[running()], None, MEASURED), Some(SessionEndNotice::TrialMeasured));
    }

    const RP_CREATED: &str = "2026-09-03T19:30:00+00:00";
    const RP_APPLIED: &str = "2026-09-03T19:31:00+00:00";

    /// A 20-minute cs2 session at `at` with `active` Compy changes at its start: 0 as-is, 1 with the change.
    /// P4-judge-noisy: with a trace that moves freely, so its frame-cap state reads (uncapped) and real
    /// play may pool it.
    fn rp_session(at: &str, low1: f64, active: usize) -> SessionSummary {
        let fps_series = (0..120u32).map(|i| (i * 10, 200.0 * (0.78 + 0.44 * f64::from((i * 37) % 120) / 120.0))).collect();
        SessionSummary { compy_changes_active: Some(active), duration_secs: 1200, samples: 1200, fps_series, ..session(at, low1) }
    }

    fn rp_before_at(lows: [f64; 3]) -> Vec<SessionSummary> {
        ["2026-09-03T18:00:00+00:00", "2026-09-03T18:30:00+00:00", "2026-09-03T19:00:00+00:00"]
            .iter()
            .zip(lows)
            .map(|(at, low1)| rp_session(at, low1, 0))
            .collect()
    }

    fn rp_before() -> Vec<SessionSummary> {
        rp_before_at([150.0, 152.0, 151.0])
    }

    fn rp_with(lows: &[f64]) -> Vec<SessionSummary> {
        lows.iter().enumerate().map(|(i, &low1)| rp_session(&format!("2026-09-04T{:02}:00:00+00:00", 10 + i), low1, 1)).collect()
    }

    /// A Running real-play cs2 Trial started after `before`, its own change the ledger's `change-1`.
    fn rp_running_from(before: &[SessionSummary]) -> ExperimentRecord {
        ExperimentRecord {
            game: "cs2.exe".into(),
            created_at: RP_CREATED.into(),
            applied_at: Some(RP_APPLIED.into()),
            baseline_session_id: before.last().map(|s| s.started_at.clone()),
            mode: TrialMode::RealPlay,
            real_play: Some(crate::realplay::RealPlayEvidence {
                before: before.iter().map(crate::realplay::RealPlaySession::of).collect(),
                ..Default::default()
            }),
            ..rec(150.0, 5)
        }
    }

    fn rp_running() -> ExperimentRecord {
        rp_running_from(&rp_before())
    }

    fn rp_ledger() -> Vec<LedgerEntryRef<'static>> {
        vec![LedgerEntryRef { id: "change-1", rec_id: "test-rec", applied_at: RP_APPLIED, applied: true, rolled_back_at: None, outside_recorded_at: None }]
    }

    fn rp_now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-09-05T12:00:00+00:00").unwrap().with_timezone(&Utc)
    }

    fn rp_store(with: &[f64]) -> Vec<SessionSummary> {
        rp_before().into_iter().chain(rp_with(with)).collect()
    }

    #[test]
    fn a_real_play_record_round_trips_and_loads_in_an_older_shape() {
        let mut r = rp_running();
        if let Some(ev) = r.real_play.as_mut() {
            ev.with = ev.before.clone();
            (ev.band_pct, ev.delta_low1_pct, ev.delta_avg_pct, ev.look) = (Some(3.0), Some(0.2), Some(-0.1), Some(1));
            ev.not_counted = vec![crate::realplay::NotCounted {
                session_id: TREAT_ID.into(),
                reason: crate::realplay::NotCountedReason::TooShort,
            }];
        }
        (r.baseline_low1_fps, r.baseline_avg_fps) = (151.0, 200.0);
        r.status = ExperimentStatus::Restored;
        r.verdict = Some("no-change".into());
        r.treatment = Some(TreatmentRecord {
            avg_fps: 200.0,
            low1_fps: 151.3,
            samples: 3600,
            crashed: false,
            delta_low1_pct: 0.2,
            recorded_at: TREAT_ID.into(),
            session_id: Some("2026-09-04T12:00:00+00:00".into()),
            check: None,
            halves: None,
            delta_avg_pct: Some(-0.1),
        });
        let v = serde_json::to_value(ExperimentStore { schema_version: STORE_SCHEMA_VERSION, experiments: vec![r.clone()] }).unwrap();
        let x = &v["experiments"][0];
        assert_eq!(x["mode"], "real-play");
        assert_eq!(x["real_play"]["before"][2]["session_id"], "2026-09-03T19:00:00+00:00");
        assert_eq!(x["real_play"]["not_counted"][0]["reason"], "too-short");
        let back: ExperimentStore = serde_json::from_value(v.clone()).unwrap();
        assert_eq!((back.experiments[0].mode, &back.experiments[0].real_play), (TrialMode::RealPlay, &r.real_play));

        // A two-session Trial's record is what it was: neither key is written.
        let pair = serde_json::to_string(&running()).unwrap();
        assert!(!pair.contains("\"mode\"") && !pair.contains("real_play"), "{pair}");
        assert_eq!(serde_json::from_str::<ExperimentRecord>(&pair).unwrap().mode, TrialMode::Pair);

        // The previous Compy's record type (ec49306, before real play), field for field where it had no
        // default, loads the file as a two-session Trial it can conclude or restore: the newest as-is
        // session as its baseline, the as-is sessions' means as its numbers, the with-change sessions'
        // means and deltas as its after-reading.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct PrevTreatment {
            avg_fps: f64,
            low1_fps: f64,
            samples: u32,
            crashed: bool,
            delta_low1_pct: f64,
            recorded_at: String,
            #[serde(default)]
            session_id: Option<String>,
            #[serde(default)]
            delta_avg_pct: Option<f64>,
        }
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct PrevRecord {
            id: String,
            rec_id: String,
            rec_title: String,
            game: String,
            hypothesis: String,
            created_at: String,
            status: ExperimentStatus,
            baseline_avg_fps: f64,
            baseline_low1_fps: f64,
            ledger_watermark: usize,
            applied_change_id: String,
            noise_floor_pct: f64,
            #[serde(default)]
            baseline_session_id: Option<String>,
            #[serde(default)]
            applied_at: Option<String>,
            #[serde(default)]
            treatment: Option<PrevTreatment>,
            #[serde(default)]
            verdict: Option<String>,
            #[serde(default)]
            outcome: TrialOutcome,
        }
        #[derive(Deserialize)]
        struct PrevStore {
            experiments: Vec<PrevRecord>,
        }
        let prev: PrevStore = serde_json::from_value(v.clone()).expect("the previous Compy loads the file");
        let p = &prev.experiments[0];
        assert_eq!((p.status, p.baseline_session_id.as_deref()), (ExperimentStatus::Restored, Some("2026-09-03T19:00:00+00:00")));
        assert_eq!((p.baseline_low1_fps, p.applied_change_id.as_str(), p.outcome), (151.0, "change-1", TrialOutcome::Recommended));
        let t = p.treatment.as_ref().unwrap();
        assert_eq!((t.low1_fps, t.samples, t.delta_low1_pct, t.session_id.as_deref()), (151.3, 3600, 0.2, Some("2026-09-04T12:00:00+00:00")));
        // A running real-play record is a running pair Trial to it, which it can conclude or restore.
        let running_v = serde_json::to_value(rp_running()).unwrap();
        let p: PrevRecord = serde_json::from_value(running_v.clone()).unwrap();
        assert_eq!((p.status, p.applied_at.as_deref(), p.treatment.is_none()), (ExperimentStatus::Running, Some(RP_APPLIED), true));

        // Words this build doesn't know: an unknown mode reads as a pair, evidence it can't read as
        // None (such a record can only be put back), and nothing fails the store's load.
        let mut odd = running_v;
        odd["mode"] = "real-play-v2".into();
        odd["real_play"] = serde_json::json!({ "before": "not a list" });
        let back: ExperimentRecord = serde_json::from_value(odd).unwrap();
        assert_eq!((back.mode, &back.real_play), (TrialMode::Pair, &None));
        for m in [serde_json::Value::Null, serde_json::json!(3), serde_json::json!("pair")] {
            assert_eq!(serde_json::from_value::<TrialMode>(m.clone()).unwrap(), TrialMode::Pair, "{m}");
        }
        assert!(real_play_trial(&back).unwrap_err().contains("compares two sessions"));
        let lost = ExperimentRecord { mode: TrialMode::RealPlay, real_play: None, ..rp_running() };
        assert!(real_play_trial(&lost).unwrap_err().contains("put the change back"));
    }

    #[test]
    fn a_start_reads_real_play_and_refuses_smoothest_in_it_or_a_mode_it_doesnt_know() {
        use TrialOutcome::{MaxFps, Recommended, Smoothest};
        assert_eq!(start_mode(None, Recommended), Ok(TrialMode::Pair));
        assert_eq!(start_mode(Some("pair"), Smoothest), Ok(TrialMode::Pair));
        assert_eq!(start_mode(Some("real-play"), MaxFps), Ok(TrialMode::RealPlay));
        let smooth = start_mode(Some("real-play"), Smoothest).unwrap_err();
        assert!(smooth.starts_with("experiment not started — Smoothest compares frame pacing"), "{smooth}");
        let odd = start_mode(Some(&"y".repeat(500)), Recommended).unwrap_err();
        assert!(odd.starts_with("experiment not started — Compy doesn't know the way of measuring") && odd.len() < 130, "{odd}");

        // In the start: read before the store is touched; the as-is sessions pinned from the rows the
        // §3 check passed on, and refused before the record-first write; both saved with the Pending record.
        let src = include_str!("experiment.rs");
        let start = &src[src.find("pub(crate) fn start_experiment(").unwrap()..];
        let params = &start[..start.find(") -> Result<").unwrap()];
        assert!(params.contains("mode: Option<String>,"), "{params}");
        assert!(start.find("let mode = start_mode(mode.as_deref(), outcome)?;").unwrap() < start.find("lock_store()").unwrap());
        let first_save = start.find("save_store(&store)?").unwrap();
        let pin = start.find("real_play_start(&covered, baseline, rows, Utc::now())").expect("the start pins its as-is sessions");
        assert!(pin > start.find("baseline_checked_view(baseline, &history, coverage)").unwrap());
        assert!(pin < start.find("status: ExperimentStatus::Pending").unwrap() && pin < start.find("apply_recommendation(").unwrap());
        for field in ["        mode,\n", "        real_play,\n"] {
            assert!(start[..first_save].contains(field), "{field:?} is saved with the Pending record");
        }
        assert!(start.find("crate::realplay::geometric_means(&ev.before)").unwrap() < first_save, "the older-Compy numbers are on the first save");

        // What the start pins, and the refusal that names what to play.
        let ev = real_play_start(&rp_before(), &rp_before()[2], &rp_ledger(), rp_now()).unwrap();
        assert_eq!(ev, crate::realplay::RealPlayEvidence { before: rp_running().real_play.unwrap().before, ..Default::default() });
        let why = real_play_start(&rp_before()[..2], &rp_before()[1], &rp_ledger(), rp_now()).unwrap_err();
        assert!(why.contains("at least 3 sessions of cs2") && why.contains("2 of them count so far, so play 1 more"), "{why}");
    }

    #[test]
    fn a_two_session_conclude_refuses_a_real_play_trial_before_judging_anything() {
        // Shares this test process's data-root files with the plan-held scenes (s31 opus r1).
        let _files = crate::data_root::shared_root_files();
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn conclude_experiment(").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let refuse = body.find("if store.experiments[idx].mode == TrialMode::RealPlay {").expect("the refusal");
        assert!(refuse < body.find("resolve_treatment(").unwrap(), "before any session is read");
        assert!(body[refuse..].starts_with("if store.experiments[idx].mode == TrialMode::RealPlay {\n        return Err("));
        // The keep/restore tail is the shared one, after the target check.
        assert!(body.find("let outcome = guard_target_at_conclude(judged,").unwrap() < body.find("finish_conclude(&mut store, idx, outcome, target_now)").unwrap());
        let unknown = conclude_realplay("nonexistent".into(), false).unwrap_err();
        assert!(unknown.contains("not found"), "{unknown}");
    }

    #[test]
    fn a_real_play_change_reverted_outside_compy_ends_as_confounded_and_restores() {
        use crate::realplay::{Judgement, RealPlayStop};
        let rec = rp_running();
        // Three with-change sessions, then the setting reads off: the newest can't be shown on to its
        // end, so two count, and closing the test is the next step.
        let sessions = rp_store(&[151.0, 150.0, 152.0]);
        let read = real_play_read(&rec, &sessions, &rp_ledger(), Some(false), rp_now()).unwrap();
        assert_eq!((read.arm.stop, read.arm.counted.len()), (Some(RealPlayStop::ChangeOff), 2));
        let o = guard_target_at_conclude(real_play_outcome(&read).expect("a stopped Trial can be closed"), Some(false));
        assert_eq!((o.verdict.as_str(), o.keep), ("confounded", false));
        assert_eq!(o.stop_reason.as_deref(), Some("target-reverted-during-treatment"));
        // Four counted before it went off: the looks judge what was counted (here the first decides,
        // on the first three), and a change that reads off is still never kept.
        let sessions = rp_store(&[151.0, 150.0, 152.0, 151.0, 150.0]);
        let read = real_play_read(&rec, &sessions, &rp_ledger(), Some(false), rp_now()).unwrap();
        let Judgement::Decided { look, .. } = &read.judgement else { panic!("{:?}", read.judgement) };
        assert_eq!((read.arm.counted.len(), look.with, read.arm.stop), (4, 3, Some(RealPlayStop::ChangeOff)));
        let judged = real_play_outcome(&read).unwrap();
        assert_eq!(judged.verdict, "no-change");
        let o = guard_target_at_conclude(judged, Some(false));
        assert_eq!((o.verdict.as_str(), o.keep), ("confounded", false));
        // In the command: the target is read before the guard, and the guard comes before the shared
        // keep/restore, whose restore reads the setting back.
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn conclude_realplay(").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let probe = body.find("let target_now = crate::history::probe_rec_target(").unwrap();
        let guard = body.find("let outcome = guard_target_at_conclude(judged, live);").unwrap();
        let finish = body.find("finish_conclude(&mut store, idx, outcome, target_now)").unwrap();
        assert!(probe < guard && guard < finish);
        let tail = &src[src.find("fn finish_conclude(").unwrap()..];
        let tail = &tail[..tail.find("\n}\n").unwrap()];
        assert!(tail.find("crate::history::rollback_change(").unwrap() < tail.find("settle_restore(").unwrap());
    }

    #[test]
    fn a_real_play_change_put_back_in_history_reads_already_reverted() {
        use crate::realplay::RealPlayStop;
        let rec = rp_running();
        let sessions = rp_store(&[151.0, 150.0]);
        let undone = vec![LedgerEntryRef { applied: false, rolled_back_at: Some("2026-09-05T09:00:00+00:00"), ..rp_ledger()[0] }];
        let read = real_play_read(&rec, &sessions, &undone, Some(false), rp_now()).unwrap();
        assert_eq!(read.arm.stop, Some(RealPlayStop::PutBackInHistory), "its own row moving is not another change");
        let o = guard_target_at_conclude(real_play_outcome(&read).unwrap(), Some(false));
        assert!(!o.keep, "{o:?}");
        // The restore that follows meets the ledger's own "already rolled back", which records
        // Restored, the bench's behaviour, never a failed restore.
        assert!(restore_already_reverted("change has already been rolled back"));
        let src = include_str!("experiment.rs");
        let tail = &src[src.find("fn finish_conclude(").unwrap()..];
        let tail = &tail[..tail.find("\n}\n").unwrap()];
        let already = &tail[tail.find("Err(e) if restore_already_reverted(&e) => {").unwrap()..];
        assert!(already.find("ExperimentStatus::Restored").unwrap() < already.find("Err(e) => {").unwrap());
    }

    #[test]
    fn a_real_play_trial_stopped_early_ends_unjudged_and_says_why() {
        use crate::realplay::RealPlayStop;
        let rec = rp_running();
        let outcome = |sessions: &[SessionSummary], ledger: &[LedgerEntryRef<'_>], live: Option<bool>, now: DateTime<Utc>| {
            let read = real_play_read(&rec, sessions, ledger, live, now).unwrap();
            (read.arm.stop, real_play_outcome(&read).map(|o| guard_target_at_conclude(o, live)))
        };
        let two = rp_store(&[151.0, 150.0]);
        // Still collecting: nothing to record, so the command refuses.
        assert_eq!(outcome(&two, &rp_ledger(), Some(true), rp_now()), (None, None));
        // Another Compy change during the test: confounded.
        let mut moved = rp_ledger();
        moved.push(LedgerEntryRef { id: "game-mode", rec_id: "game-mode", applied_at: "2026-09-04T10:30:00+00:00", applied: true, rolled_back_at: None, outside_recorded_at: None });
        let (stop, o) = outcome(&two, &moved, Some(true), rp_now());
        let o = o.unwrap();
        assert_eq!((stop, o.verdict.as_str(), o.stop_reason.as_deref()), (Some(RealPlayStop::OtherChange), "confounded", Some("other-compy-change-during-trial")));
        // A driver update during the test: confounded, naming it.
        let mut updated = rp_store(&[151.0, 150.0]);
        updated[4].hw_fingerprint.as_mut().unwrap().gpu_driver = "25.9.1".into();
        let (stop, o) = outcome(&updated, &rp_ledger(), Some(true), rp_now());
        let o = o.unwrap();
        assert_eq!((stop, o.verdict.as_str()), (Some(RealPlayStop::Conditions), "confounded"));
        assert_eq!(o.stop_reason.as_deref(), Some("conditions-changed-between-sessions"));
        assert!(o.note.contains("GPU driver"), "{}", o.note);
        // The window ran out with two counted: unknown, never a guess.
        let late = rp_now() + chrono::Duration::days(14);
        let (stop, o) = outcome(&two, &rp_ledger(), Some(true), late);
        let o = o.unwrap();
        assert_eq!((stop, o.verdict.as_str(), o.keep), (Some(RealPlayStop::WindowOver), "insufficient-evidence", false));
        assert_eq!((o.stop_reason.as_deref(), o.confidence), (Some("real-play-window-over"), Confidence::Unknown));
        assert!(o.note.starts_with("Only 2 of the 3 sessions Compy needs were counted with the change on (the 14 days ran out)"), "{}", o.note);
        // Unreadable now: unjudged, and the target check leaves it unjudged.
        let (stop, o) = outcome(&two, &rp_ledger(), None, rp_now());
        assert_eq!((stop, o.unwrap().verdict.as_str()), (Some(RealPlayStop::Unreadable), "insufficient-evidence"));
        // A decided look is the verdict, never above Medium.
        let three = rp_store(&[168.0, 170.0, 169.0]);
        let (stop, o) = outcome(&three, &rp_ledger(), Some(true), rp_now());
        let o = o.unwrap();
        assert_eq!((stop, o.verdict.as_str(), o.keep, o.confidence), (None, "improved", true, Confidence::Medium));
    }

    #[test]
    fn a_decided_real_play_look_stopped_by_another_change_or_a_condition_puts_the_change_back() {
        // CR-1102-left owner call (a), delegated 2026-11-10: put it back, as a Trial does when another
        // change confounds it. Before, a look that decided (Likely better on three counted sessions)
        // was kept even though another Compy change moved, or the driver changed, after them.
        use crate::realplay::{Judgement, RealPlayStop};
        let rec = rp_running();
        let read_of = |sessions: &[SessionSummary], ledger: &[LedgerEntryRef<'_>]| {
            let read = real_play_read(&rec, sessions, ledger, Some(true), rp_now()).unwrap();
            let decided = matches!(read.judgement, Judgement::Decided { .. });
            (read.arm.stop, decided, real_play_outcome(&read).map(|o| guard_target_at_conclude(o, Some(true))))
        };
        let three = rp_store(&[168.0, 170.0, 169.0]);
        // Nothing moved: Likely better, kept (unchanged).
        let (stop, decided, o) = read_of(&three, &rp_ledger());
        assert_eq!((stop, decided, o.unwrap().keep), (None, true, true));
        // Another Compy change after the three counted sessions: decided, but confounded and put back.
        let mut moved = rp_ledger();
        moved.push(LedgerEntryRef { id: "game-mode", rec_id: "game-mode", applied_at: "2026-09-04T20:00:00+00:00", applied: true, rolled_back_at: None, outside_recorded_at: None });
        let (stop, decided, o) = read_of(&three, &moved);
        let o = o.unwrap();
        assert_eq!((stop, decided), (Some(RealPlayStop::OtherChange), true));
        assert_eq!((o.verdict.as_str(), o.keep, o.stop_reason.as_deref()), ("confounded", false, Some("other-compy-change-during-trial")));
        assert_eq!(o.confidence, Confidence::Low);
        // A driver update on a later session: decided on the three before it, but confounded and put back.
        let mut updated = rp_store(&[168.0, 170.0, 169.0, 169.0]);
        let last = updated.len() - 1;
        updated[last].hw_fingerprint.as_mut().unwrap().gpu_driver = "25.9.1".into();
        let (stop, decided, o) = read_of(&updated, &rp_ledger());
        let o = o.unwrap();
        assert_eq!((stop, decided), (Some(RealPlayStop::Conditions), true));
        assert_eq!((o.verdict.as_str(), o.keep, o.stop_reason.as_deref()), ("confounded", false, Some("conditions-changed-between-sessions")));
        assert_eq!(o.confidence, Confidence::Low);
        assert!(o.note.contains("GPU driver") && o.note.contains("changed during the test"), "{}", o.note);
        // The conclude's later checks only ever take a keep away.
        for live in [Some(false), None] {
            assert!(!guard_target_at_conclude(with_unverified_changes(o.clone(), 1), live).keep);
        }
        // With no pairing on the stop, the fold still never keeps.
        let kept = ConcludeOutcome { verdict: "improved".into(), keep: true, delta_low1_pct: 12.0, stop_reason: None, confidence: Confidence::Medium, note: "n".into() };
        let o = confounded_by_conditions(kept, None);
        assert_eq!((o.verdict.as_str(), o.keep, o.delta_low1_pct), ("confounded", false, 12.0));
    }

    #[test]
    fn a_real_play_trial_toasts_only_when_a_look_is_due() {
        let rec = rp_running();
        let ledger = rp_ledger();
        let all = rp_store(&[151.0, 150.0, 152.0, 151.0]);
        let saved = |k: usize| {
            // The session store as it stood when the k-th with-change session was saved.
            let sessions = &all[..3 + k];
            let session = &sessions[sessions.len() - 1];
            realplay_ready_notice(session, sessions, std::slice::from_ref(&rec), Some(&ledger), LedgerCoverage::Whole, |_| Some(true), rp_now())
        };
        assert_eq!((saved(1), saved(2)), (None, None), "no look before three sessions");
        assert_eq!(saved(3), Some(SessionEndNotice::RealPlayReady), "the first look gives No clear difference at ±3%");
        assert_eq!(saved(4), None, "already decided: a later session never toasts it again");
        // A look that keeps collecting is no decision: PBZ-like swings stay silent.
        let before = rp_before_at([172.0, 132.0, 178.0]);
        let swings = rp_running_from(&before);
        let sessions: Vec<SessionSummary> = before.into_iter().chain(rp_with(&[150.0, 181.0, 128.0])).collect();
        let notice = realplay_ready_notice(&sessions[5], &sessions, &[swings], Some(&ledger), LedgerCoverage::Whole, |_| Some(true), rp_now());
        assert_eq!(notice, None);
        // Stopped, no readable history, a history set aside after the as-is sessions began, or a
        // two-session Trial: silent.
        let sessions = &all[..6];
        let at = |trials: &[ExperimentRecord], ledger: Option<&[LedgerEntryRef<'_>]>, coverage: LedgerCoverage, live: Option<bool>| {
            realplay_ready_notice(&sessions[5], sessions, trials, ledger, coverage, |_| live, rp_now())
        };
        assert_eq!(at(std::slice::from_ref(&rec), Some(&ledger), LedgerCoverage::Whole, Some(true)), Some(SessionEndNotice::RealPlayReady));
        assert_eq!(at(std::slice::from_ref(&rec), Some(&ledger), LedgerCoverage::Whole, Some(false)), None);
        assert_eq!(at(std::slice::from_ref(&rec), None, LedgerCoverage::Whole, Some(true)), None);
        let set_aside = DateTime::parse_from_rfc3339("2026-09-04T09:00:00+00:00").unwrap().with_timezone(&Utc);
        assert_eq!(at(std::slice::from_ref(&rec), Some(&ledger), LedgerCoverage::SinceSetAside(set_aside), Some(true)), None);
        assert_eq!(at(&[ExperimentRecord { mode: TrialMode::Pair, ..rec.clone() }], Some(&ledger), LedgerCoverage::Whole, Some(true)), None);
        // The setting is read only when a real-play Trial of this game runs.
        let mut asked = false;
        realplay_ready_notice(&sessions[5], sessions, &[running()], Some(&ledger), LedgerCoverage::Whole, |_| {
            asked = true;
            Some(true)
        }, rp_now());
        assert!(!asked);
        // The words.
        let body = SessionEndNotice::RealPlayReady.body("WARDOGS-Win64-Shipping.exe");
        assert_eq!(body, "Your WARDOGS test has enough sessions for a result. Open Compy to see it.");
        assert!(!body.contains("1%") && !body.contains(".exe"));
        // And the live path asks this rule first, then the two-session one.
        let src = include_str!("experiment.rs");
        let now = &src[src.find("pub(crate) fn session_end_notice_now(").unwrap()..];
        let now = &now[..now.find("\n}\n").unwrap()];
        assert!(now.find("realplay_ready_notice(session,").unwrap() < now.find(".or_else(|| session_end_notice(session,").unwrap());
    }

    // ─── review of 59fc753 ─────────────────────────────────────────────────────

    // Rollback integrity: once its own row is put back, the Trial owns nothing to keep. A look that
    // decided "Likely better" before that, with the setting reading on again (re-applied under a new
    // row, say), used to be Kept while the row it names was already rolled back.
    #[test]
    fn a_real_play_change_put_back_in_history_is_never_kept_whatever_was_measured() {
        use crate::realplay::{Judgement, RealPlayStop};
        let rec = rp_running();
        let sessions = rp_store(&[168.0, 170.0, 169.0]);
        let undone = vec![LedgerEntryRef { applied: false, rolled_back_at: Some("2026-09-05T09:00:00+00:00"), ..rp_ledger()[0] }];
        let read = real_play_read(&rec, &sessions, &undone, Some(true), rp_now()).unwrap();
        assert_eq!(read.arm.stop, Some(RealPlayStop::PutBackInHistory));
        assert!(matches!(read.judgement, Judgement::Decided { .. }), "{:?}", read.judgement);
        let o = guard_target_at_conclude(real_play_outcome(&read).unwrap(), Some(true));
        assert!(!o.keep, "its own row is rolled back, so nothing may be kept: {o:?}");
        assert_eq!(o.stop_reason.as_deref(), Some("real-play-put-back-in-history"));
        assert!(!o.note.contains("was kept"), "{}", o.note);
        // The restore that follows meets the ledger's "already rolled back", and a setting that reads
        // on after it is the loud Aborted state, never a quiet Restored (a start always verifies the
        // prior state, so its record says so).
        let mut after = ExperimentRecord { prior_state_verified: true, ..rp_running() };
        let loud = settle_restore(&mut after, false, crate::history::ActiveCheck::On);
        assert_eq!(after.status, ExperimentStatus::Aborted);
        assert!(loud.is_some_and(|m| m.contains("already undone outside Compy")));
    }

    #[test]
    fn a_start_from_a_session_that_cant_be_pinned_says_why_not_how_many_count() {
        // The newest as-is session was played more than 14 days before the start: nothing is pinned,
        // and the refusal says that instead of "0 of them count so far".
        let late = rp_now() + chrono::Duration::days(20);
        let why = real_play_start(&rp_before(), &rp_before()[2], &rp_ledger(), late).unwrap_err();
        assert!(!why.contains("0 of them count so far"), "{why}");
        assert!(why.contains("more than 14 days ago"), "{why}");
    }

    // A crash during a real-play Trial is confounded, ahead of the crash, by another Compy change
    // moving during the test, exactly as in the two-session conclude; and the receipt never shows a
    // decided look's "+12%" beside the crash's "Likely worse".
    #[test]
    fn a_real_play_crash_during_another_compy_change_is_confounded_and_writes_no_look() {
        use crate::realplay::{Judgement, RealPlayStop};
        let rec = rp_running();
        let sessions = rp_store(&[168.0, 170.0, 169.0]);
        // Alone, the crash on the newest session after the change is pinned on it.
        let (alone, pairing) = real_play_crash(&rec, &sessions, Some(&rp_ledger())).unwrap();
        assert_eq!((alone.verdict.as_str(), alone.keep, alone.stop_reason.as_deref()), ("regressed", false, Some("crash-during-treatment")));
        assert!(pairing.is_some(), "the crash is judged against the as-is sessions' conditions");
        // Another Compy change applied during the test: the crash can't be pinned on this setting.
        let mut moved = rp_ledger();
        moved.push(LedgerEntryRef { id: "game-mode", rec_id: "game-mode", applied_at: "2026-09-04T10:30:00+00:00", applied: true, rolled_back_at: None, outside_recorded_at: None });
        let (o, _) = real_play_crash(&rec, &sessions, Some(&moved)).unwrap();
        assert_eq!((o.verdict.as_str(), o.keep, o.stop_reason.as_deref()), ("confounded", false, Some("other-compy-change-during-trial")));
        // So is a crash session that ran with Compy changes other than the as-is ones plus this one.
        let mut extra = sessions.clone();
        extra[5].compy_changes_active = Some(2);
        let (o, _) = real_play_crash(&rec, &extra, Some(&rp_ledger())).unwrap();
        assert_eq!(o.verdict, "confounded");
        // Even when another stop is shown first (its own change put back), another change still counts.
        let mut both = moved.clone();
        both[0] = LedgerEntryRef { applied: false, rolled_back_at: Some("2026-09-05T09:00:00+00:00"), ..both[0] };
        assert_eq!(real_play_read(&rec, &sessions, &both, Some(false), rp_now()).unwrap().arm.stop, Some(RealPlayStop::PutBackInHistory));
        assert_eq!(real_play_crash(&rec, &sessions, Some(&both)).unwrap().0.verdict, "confounded");

        // The record: a decided look's numbers stay off a crash's receipt.
        let read = real_play_read(&rec, &sessions, &rp_ledger(), Some(true), rp_now()).unwrap();
        assert!(matches!(read.judgement, Judgement::Decided { .. }), "{:?}", read.judgement);
        let mut crashed = rp_running();
        record_real_play(&mut crashed, Some(&read), &alone, true, pairing.clone(), rp_now());
        let ev = crashed.real_play.as_ref().unwrap();
        assert_eq!((ev.look, ev.delta_low1_pct, ev.band_pct), (None, None, None), "{ev:?}");
        assert!(crashed.treatment.is_none());
        assert_eq!(crashed.verdict.as_deref(), Some("regressed"));
        // Without a crash the same read writes its deciding look.
        let judged = real_play_outcome(&read).unwrap();
        let mut measured = rp_running();
        record_real_play(&mut measured, Some(&read), &judged, false, None, rp_now());
        let ev = measured.real_play.as_ref().unwrap();
        assert_eq!((ev.look, ev.with.len()), (Some(1), 3));
        assert!(ev.delta_low1_pct.is_some_and(|d| d > 10.0) && measured.treatment.is_some(), "{ev:?}");

        // In the command: the crash goes through that rule, and the record through that writer.
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn conclude_realplay(").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        assert!(body.contains("real_play_crash(rec, &sessions, rows.as_deref())"), "the crash branch goes through the pure crash rule");
        let write = body.find("record_real_play(&mut store.experiments[idx], read.as_ref(), &outcome, crashed, crash_pairing, now)").unwrap();
        assert!(body.find("let outcome = guard_target_at_conclude(judged, live);").unwrap() < write);
        assert!(write < body.find("finish_conclude(&mut store, idx, outcome, target_now)").unwrap());
        let crash_rule = &src[src.find("pub(crate) fn real_play_crash(").unwrap()..];
        assert!(crash_rule.contains("with_compy_state(crash, other_compy_change(rec, reference, newest, ledger))"));
    }

    #[test]
    fn real_play_progress_runs_off_the_main_thread() {
        let src = include_str!("experiment.rs");
        let at = src.find("fn get_realplay_progress(").unwrap();
        let head = &src[src[..at].rfind("#[tauri::command]").unwrap()..at];
        assert!(head.contains("async"), "a plain command runs on the main thread: {head:?}");
        let body = &src[at..];
        let body = &body[..body.find("\n}\n").unwrap()];
        assert!(body.contains("tauri::async_runtime::spawn_blocking(move || read_realplay_progress(&game))"), "{body}");
        // The invoke the webview makes is unchanged: `{ game }` in, the progress or an error out.
        assert!(body.starts_with("fn get_realplay_progress(game: String) -> Result<crate::realplay::RealPlayProgress, String> {"), "{body}");
        // And the work it hands over is the read it always was: no store lock, no mutation.
        let work = &src[src.find("fn read_realplay_progress(").unwrap()..];
        let work = &work[..work.find("\n}\n").unwrap()];
        assert!(!work.contains("lock_store(") && !work.contains("rollback_change(") && !work.contains("apply_recommendation("), "{work}");
    }

    // ── CR-plan-held-behaviour-tests: the UI's undo and the core-parking restore under a plan-class
    // hold, run through the real commands against this test process's own data root. Every elevated
    // command is caught by the batching sink (counted, never run), and both ledger rows point at a
    // plan that doesn't exist, so an undo that gets past the hold fails inside the undo itself,
    // before anything could elevate. ──

    /// A valid plan-GUID shape no Windows install has.
    const GONE_PLAN: &str = "0badf00d-0000-4000-8000-00000000c0de";

    fn plan_ledger_rows() -> serde_json::Value {
        serde_json::json!([
            {
                "id": "ph-usb", "rec_id": "usb-selective-suspend-off", "rec_title": "USB selective suspend off",
                "applied_at": "2026-11-13T09:00:00+00:00", "status": "applied",
                "snapshot": {
                    "kind": "power-plan-setting", "plan_guid": GONE_PLAN,
                    "subgroup_guid": "2a737441-1930-4402-8d77-b2bebba308a3",
                    "setting_guid": "48e6b7a6-50f5-4782-a5d4-53bb8f07e226",
                    "prior_ac_value": 1, "prior_dc_value": 1
                },
                "rollback_action": { "kind": "restore-power-plan-setting-from-snapshot" }
            },
            {
                "id": "ph-ult", "rec_id": "power-ultimate", "rec_title": "Ultimate Performance",
                "applied_at": "2026-11-13T09:01:00+00:00", "status": "applied",
                "snapshot": { "kind": "power-plan", "prior_guid": GONE_PLAN },
                "applied_action": { "kind": "set-ultimate-performance-plan" },
                "rollback_action": { "kind": "restore-power-plan-from-snapshot" }
            }
        ])
    }

    fn ledger_file() -> PathBuf {
        crate::compy_data_dir().join("history.json")
    }

    /// The shared test-root files for one scene, cleared again on drop; held under
    /// `data_root::shared_root_files` with every test that sets the benchmark hold or reads or counts
    /// those files (opus r1 MUST-FIX).
    struct PlanScene {
        _serial: std::sync::MutexGuard<'static, ()>,
    }

    impl Drop for PlanScene {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(store_path());
            let _ = std::fs::remove_dir(store_path());
            let _ = std::fs::remove_file(ledger_file());
        }
    }

    fn scene(trial_on_the_plan: Option<ExperimentStatus>) -> PlanScene {
        let serial = crate::data_root::shared_root_files();
        std::fs::create_dir_all(crate::compy_data_dir()).unwrap();
        let _ = std::fs::remove_dir(store_path());
        // Opus r2: temp + rename, so a test reading the ledger unlocked never sees it half written.
        let tmp = ledger_file().with_extension("json.scene-tmp");
        std::fs::write(&tmp, serde_json::to_vec(&plan_ledger_rows()).unwrap()).unwrap();
        std::fs::rename(&tmp, ledger_file()).unwrap();
        let experiments = trial_on_the_plan
            .map(|status| {
                vec![ExperimentRecord {
                    rec_id: "power-ultimate".into(),
                    rec_title: "Ultimate Performance".into(),
                    status,
                    ..rec(150.0, 0)
                }]
            })
            .unwrap_or_default();
        save_store(&ExperimentStore { experiments, ..Default::default() }).unwrap();
        PlanScene { _serial: serial }
    }

    fn ledger_now() -> Vec<crate::history::AppliedChange> {
        serde_json::from_slice(&std::fs::read(ledger_file()).unwrap()).unwrap()
    }

    fn row_status(id: &str) -> String {
        ledger_now().into_iter().find(|c| c.id == id).map(|c| c.status).expect("row")
    }

    #[test]
    fn an_undo_of_a_plan_setting_is_refused_while_a_trial_measures_the_plan_and_nothing_runs() {
        let _scene = scene(Some(ExperimentStatus::Running));
        let sink = crate::actions::ElevationDeferral::begin().unwrap();
        let why = crate::experiment::rollback_change("ph-usb".into()).expect_err("refused");
        assert!(why.contains("same power plan") && why.contains("by a Trial") && why.contains("Nothing was changed"), "{why}");
        assert_eq!(sink.deferred_count(), 0, "no elevated run");
        assert_eq!(row_status("ph-usb"), "applied", "the row is still active");
    }

    #[test]
    fn once_the_trial_has_concluded_the_same_undo_reaches_the_rollback() {
        let _scene = scene(Some(ExperimentStatus::Kept));
        let sink = crate::actions::ElevationDeferral::begin().unwrap();
        // Past the hold, the undo itself runs: it finds the row's plan gone, which only the dispatched
        // power-plan-setting undo says.
        let why = crate::experiment::rollback_change("ph-usb".into()).expect_err("the gone plan fails in the undo");
        assert!(why.contains("no longer exists") && !why.contains("same power plan"), "{why}");
        assert_eq!(sink.deferred_count(), 0);
    }

    #[test]
    fn the_trials_own_plan_row_is_not_refused_by_the_class_hold() {
        // Its undo keeps today's behaviour (the direct hold is the Trial's own restore's business).
        let _scene = scene(Some(ExperimentStatus::Running));
        let sink = crate::actions::ElevationDeferral::begin().unwrap();
        // It reaches the plan undo, whose one elevated write the sink catches (nothing runs).
        crate::experiment::rollback_change("ph-ult".into()).expect("not refused by the class hold");
        assert_eq!(sink.deferred_count(), 1, "the undo's elevated write, caught");
        assert_eq!(row_status("ph-ult"), "rolled_back");
    }

    #[test]
    fn a_core_parking_restore_is_refused_while_the_benchmark_measures_the_plan_and_records_nothing() {
        let _scene = scene(None);
        crate::benchmark_trial::hold(9_001, "power-ultimate", "Ultimate Performance");
        let _release = crate::benchmark_trial::TestHoldRelease(9_001);
        let sink = crate::actions::ElevationDeferral::begin().unwrap();
        let why = crate::experiment::restore_leftover("core-parking-forced".into(), "Core parking".into())
            .err()
            .expect("refused");
        assert!(why.contains("by the benchmark") && why.contains("same power plan"), "{why}");
        assert!(why.contains("Let it finish, or cancel it, first.") && why.contains("Nothing was changed"), "{why}");
        assert_eq!(sink.deferred_count(), 0, "no elevated run");
        assert!(ledger_now().iter().all(|c| c.rec_id != "core-parking-forced"), "no receipt");
    }

    #[test]
    fn a_core_parking_restore_is_not_refused_while_the_benchmark_holds_another_plan_setting() {
        let _scene = scene(None);
        crate::benchmark_trial::hold(9_002, "pcie-aspm-off", "PCIe link power off");
        let _release = crate::benchmark_trial::TestHoldRelease(9_002);
        let sink = crate::actions::ElevationDeferral::begin().unwrap();
        // Two settings of the plan don't clash: the restore goes on to its own reads and apply (whose
        // elevated write the sink catches). Machine-dependent past the hold (sonnet r1): on a PC whose
        // read-only core-parking query works it records a receipt here; otherwise it fails on that
        // read. Either way, what this proves is that the hold did not refuse it.
        match crate::experiment::restore_leftover("core-parking-forced".into(), "Core parking".into()) {
            Ok(view) => {
                assert_eq!(view.rec_id, "core-parking-forced");
                assert_eq!(sink.deferred_count(), 1, "the restore's one elevated write, caught");
            }
            // Opus r1: and not the hold check's own store read either.
            Err(why) => assert!(
                !why.contains("same power plan") && !why.contains("by the benchmark") && !why.contains("Trial records"),
                "{why}"
            ),
        }
    }

    #[test]
    fn a_plan_class_undo_with_an_unreadable_trial_store_says_so_and_changes_nothing() {
        // The honest behaviour: the store could hold the Trial measuring this plan, so the undo stops,
        // and the refusal says the Trial record couldn't be read and how to get past it.
        let _scene = scene(None);
        std::fs::remove_file(store_path()).unwrap();
        std::fs::create_dir(store_path()).unwrap(); // something that is not a file at that path
        let sink = crate::actions::ElevationDeferral::begin().unwrap();
        let why = crate::experiment::rollback_change("ph-usb".into()).expect_err("refused");
        assert!(why.contains("couldn't read its Trial records") && why.contains("Nothing was changed"), "{why}");
        assert!(why.contains("try again shortly") && why.contains("experiments.json"), "the way out: {why}");
        assert!(why.starts_with("This change writes to your power plan, which a Trial may be measuring"), "why: {why}");
        assert_eq!(sink.deferred_count(), 0);
        assert_eq!(row_status("ph-usb"), "applied");
    }
}

// CR-unconfirmed-remedy: a Compy plan change the user recorded as changed outside Compy stops
// blocking a Trial only while the plan recorded then is still the live one.
#[cfg(test)]
mod changed_outside_trial_tests {
    use super::*;
    use crate::history::{AppliedChange, ChangedOutside, ObservedPlan, ObservedState, CHANGED_OUTSIDE_SCHEMA};

    const SYNEZ: &str = "22222222-2222-2222-2222-222222222222";

    fn ultimate_rows() -> Vec<AppliedChange> {
        let row = |id: &str, at: &str| {
            serde_json::json!({
                "id": id, "rec_id": "power-ultimate", "rec_title": "Ultimate", "applied_at": at,
                "snapshot": { "kind": "power-plan", "prior_guid": "381b4222-f694-41f0-9685-ff5bb260df2e" },
                "status": "applied",
                "applied_action": { "kind": "set-ultimate-performance-plan" },
                "rollback_action": { "kind": "restore-power-plan-from-snapshot" }
            })
        };
        serde_json::from_value(serde_json::json!([
            row("u1", "2026-06-03T13:08:01+00:00"),
            row("u2", "2026-09-26T03:11:32+00:00")
        ]))
        .unwrap()
    }

    fn recorded(mut rows: Vec<AppliedChange>, at: &str) -> Vec<AppliedChange> {
        for c in &mut rows {
            c.changed_outside = Some(ChangedOutside {
                schema: CHANGED_OUTSIDE_SCHEMA,
                recorded_at: at.into(),
                observed: ObservedState::PowerPlan { guid: SYNEZ.into(), name: "Synez Power Plan".into() },
            });
        }
        rows
    }

    fn plan(guid: &str) -> Option<ObservedPlan> {
        Some(ObservedPlan { guid: guid.into(), name: "p".into(), class: crate::PowerPlanClass::Other })
    }

    #[test]
    fn unrecorded_ultimate_rows_reading_off_still_refuse_the_start() {
        let changes = ultimate_rows();
        let rows = ledger_rows(&changes);
        let n = unverified_others_with(&changes, &rows, "visual-effects", |_| Some(false), || plan(SYNEZ));
        assert_eq!(n, 1);
        assert!(unverified_start_refusal(n).unwrap().contains("can't be confirmed as still in place"));
    }

    #[test]
    fn recorded_rows_pass_only_while_the_recorded_plan_is_live() {
        let changes = recorded(ultimate_rows(), "2026-11-10T20:00:00+00:00");
        let rows = ledger_rows(&changes);
        let never = |_: &str| -> Option<bool> { panic!("a recorded rec is not read back as Compy's change") };
        assert_eq!(unverified_others_with(&changes, &rows, "visual-effects", never, || plan(SYNEZ)), 0);
        assert_eq!(unverified_others_with(&changes, &rows, "visual-effects", never, || plan("381b4222-f694-41f0-9685-ff5bb260df2e")), 1);
        assert_eq!(unverified_others_with(&changes, &rows, "visual-effects", never, || None), 1, "unreadable stays a refusal");
        // Another setting is still read back as before.
        let mut more = changes.clone();
        let mut gm = ultimate_rows().remove(0);
        gm.id = "g".into();
        gm.rec_id = "game-mode".into();
        more.push(gm);
        let rows = ledger_rows(&more);
        assert_eq!(unverified_others_with(&more, &rows, "visual-effects", |r| Some(r != "game-mode"), || plan(SYNEZ)), 1);
    }

    #[test]
    fn a_baseline_played_before_the_record_is_refused_and_one_after_it_is_not() {
        let changes = recorded(ultimate_rows(), "2026-11-10T20:00:00+00:00");
        let rows = ledger_rows(&changes);
        assert!(compy_change_moved_after(&rows, "2026-11-10T19:00:00+00:00", None), "the plan during that session is unknown");
        assert!(!compy_change_moved_after(&rows, "2026-11-10T20:05:00+00:00", None));
    }
}

// CR-refuse-early: the journey's up-front check says the start's own refusal, in the start's words,
// for the Synez-shaped ledger, and nothing once the plan is recorded as changed outside Compy.
#[cfg(test)]
mod refuse_early_tests {
    use super::*;
    use crate::history::{AppliedChange, ChangedOutside, ObservedPlan, ObservedState, CHANGED_OUTSIDE_SCHEMA};

    const SYNEZ: &str = "22222222-2222-2222-2222-222222222222";

    fn synez_shaped() -> Vec<AppliedChange> {
        let row = |id: &str| {
            serde_json::json!({
                "id": id, "rec_id": "power-ultimate", "rec_title": "Ultimate", "applied_at": "2026-09-26T03:11:32+00:00",
                "snapshot": { "kind": "power-plan", "prior_guid": "381b4222-f694-41f0-9685-ff5bb260df2e" },
                "status": "applied",
                "applied_action": { "kind": "set-ultimate-performance-plan" },
                "rollback_action": { "kind": "restore-power-plan-from-snapshot" }
            })
        };
        serde_json::from_value(serde_json::json!([row("u1"), row("u2")])).unwrap()
    }

    fn check(changes: &[AppliedChange]) -> Option<String> {
        let rows = ledger_rows(changes);
        let synez = || Some(ObservedPlan { guid: SYNEZ.into(), name: "Synez Power Plan".into(), class: crate::PowerPlanClass::Other });
        // The Ultimate rows read off: the active plan is Synez.
        precheck_refusal(unverified_others_with(changes, &rows, "visual-effects", |_| Some(false), synez))
    }

    #[test]
    fn the_synez_shaped_ledger_is_refused_up_front_in_the_starts_own_words() {
        let why = check(&synez_shaped()).expect("refused before any session");
        assert!(why.starts_with("experiment not started — "), "{why}");
        assert!(why.contains("can't be confirmed as still in place"), "the remedies key on these words: {why}");
        assert_eq!(Some(why), unverified_start_refusal(1).map(|w| format!("experiment not started — {w}")));
    }

    #[test]
    fn once_recorded_as_changed_outside_compy_the_journey_may_start() {
        let mut changes = synez_shaped();
        for c in &mut changes {
            c.changed_outside = Some(ChangedOutside {
                schema: CHANGED_OUTSIDE_SCHEMA,
                recorded_at: "2026-11-10T20:00:00+00:00".into(),
                observed: ObservedState::PowerPlan { guid: SYNEZ.into(), name: "Synez Power Plan".into() },
            });
        }
        assert_eq!(check(&changes), None);
    }

    // A source-text change detector (review: not a proof of read-only): it pins that the command
    // counts through the start's own function and names no save or apply of its own.
    #[test]
    fn the_command_reads_through_the_same_count_the_start_refuses_on() {
        let src = include_str!("experiment.rs");
        let body = &src[src.find("fn read_start_precheck(").unwrap()..];
        let body = &body[..body.find("\n}").unwrap()];
        assert!(body.contains("unverified_others_live(&changes, &rows, rec_id, &crate::history::LiveReads::default())"));
        assert!(body.contains("precheck_refusal(unverified)"));
        assert!(!body.contains("save") && !body.contains("apply"), "read-only");
    }

    // ─── P4-judge-noisy: verdicts on the measured band ───────────────────────

    use crate::noise_floor::{CapRead, GameNoise, NoiseUnmeasured};

    /// A running Trial of "Test" (baseline 1% low `baseline_low1`, average 120 fps), built from the
    /// older-record shape below: this module's own copy of `experiment_tests::rec`.
    fn rec(baseline_low1: f64, watermark: usize) -> ExperimentRecord {
        let mut r: ExperimentRecord = serde_json::from_value(legacy_no_change()).unwrap();
        r.game = "Test".into();
        r.created_at = Utc::now().to_rfc3339();
        r.status = ExperimentStatus::Running;
        r.baseline_low1_fps = baseline_low1;
        r.baseline_avg_fps = 120.0;
        r.ledger_watermark = watermark;
        r.treatment = None;
        r.verdict = None;
        r.verdict_note = None;
        r.noise_evidence = None;
        r.trial_result = None;
        r
    }

    fn measured(treatment_low1: f64) -> ConcludeOutcome {
        conclude_outcome(&rec(150.0, 5), treatment_low1, 5000, false, Some("Test"), Some(5), Utc::now())
    }

    /// ROB RUN's shape (owner's 2026-11-11 as-is sessions; `noise_floor` measures it from them): wide.
    const WIDE: GameNoise = GameNoise {
        model: crate::noise_floor::NOISE_MODEL_VERSION,
        low1_band_pct: 20.6,
        avg_band_pct: 16.4,
        low1_step_pct: 8.9,
        avg_step_pct: 7.1,
        sessions: 9,
        cap: CapRead::Uncapped,
        cap_unread: 0,
        max_gap_mins: 0,
    };
    /// A quiet game: sessions within about half a percent of each other.
    const QUIET: GameNoise = GameNoise {
        model: crate::noise_floor::NOISE_MODEL_VERSION,
        low1_band_pct: 3.0,
        avg_band_pct: 3.0,
        low1_step_pct: 0.5,
        avg_step_pct: 0.4,
        sessions: 8,
        cap: CapRead::Uncapped,
        cap_unread: 0,
        max_gap_mins: 0,
    };

    /// The conclude's chain for a Recommended Trial on `rec(150, 5)` (baseline 150 fps 1% low, 120 avg).
    fn judge_on(noise: &GameNoise, low_pct: f64, avg_pct: f64, base: CapRead, after: CapRead, picked: TrialOutcome) -> ConcludeOutcome {
        let r = ExperimentRecord { noise_floor_pct: noise.low1_band_pct, game_noise: Some(noise.clone()), ..rec(150.0, 5) };
        let o = conclude_outcome(&r, 150.0 * (1.0 + low_pct / 100.0), 5000, false, Some("Test"), Some(5), Utc::now());
        let low_band = if picked == TrialOutcome::MaxFps { noise.low1_band_pct.max(noise.avg_band_pct) } else { noise.low1_band_pct };
        let o = with_measured_fall(with_cap_check(o, base, after), low_band);
        let o = match picked {
            TrialOutcome::MaxFps => with_max_fps_outcome(o, noise.low1_band_pct.max(noise.avg_band_pct), Some(avg_pct)),
            _ => with_recommended_outcome_bands(o, noise.low1_band_pct, noise.avg_band_pct, Some(avg_pct)),
        };
        let lows = (150.0, 150.0 * (1.0 + low_pct / 100.0));
        let deltas = NoiseDeltas { avg: Some(avg_pct), pacing: None };
        with_noise_words(with_cap_saturation(o, after, picked, lows, noise.low1_band_pct), noise, "ROB RUN.exe", picked, deltas)
    }

    fn judge(noise: &GameNoise, low_pct: f64, avg_pct: f64) -> ConcludeOutcome {
        judge_on(noise, low_pct, avg_pct, CapRead::Uncapped, CapRead::Uncapped, TrialOutcome::Recommended)
    }

    #[test]
    fn on_a_wide_noise_game_plus_5_is_negligible_and_plus_30_is_better() {
        let small = judge(&WIDE, 5.0, 4.0);
        assert_eq!((small.verdict.as_str(), small.keep), ("no-change", false), "{}", small.note);
        assert_eq!(trial_result_for(&small.verdict), TrialResult::Negligible, "a judged outcome, not 'couldn't be judged'");
        assert!(small.note.contains("negligible at ROB RUN's noise") && small.note.contains("put back"), "{}", small.note);
        assert!(small.note.contains("Between 9 sessions") && small.note.contains("must beat +20.6% / -17%"), "{}", small.note);
        assert!(!small.note.contains("smallest change Compy ever claims"), "not floored: {}", small.note);
        // A quiet game's band is the 3% minimum, and the words say so instead of calling it measured.
        assert!(judge(&QUIET, 2.0, 0.0).note.contains("the smallest change Compy ever claims"));
        assert!(!small.note.contains("±3%"), "no assumed band: {}", small.note);
        let big = judge(&WIDE, 30.0, 5.0);
        assert_eq!((big.verdict.as_str(), big.keep), ("improved", true), "{}", big.note);
        assert_eq!(judge(&WIDE, -5.0, -4.0).verdict, "no-change", "a drop inside the band is no regression either");
        assert_eq!(judge(&WIDE, -30.0, -10.0).verdict, "regressed");
        // The average is judged on its own measured band: a +30% low with the average down 20% is no win.
        assert_eq!(judge(&WIDE, 30.0, -20.0).verdict, "no-change");
    }

    #[test]
    fn a_mixed_result_says_what_moved_and_is_never_called_negligible() {
        // Coordinator MUST-FIX (s27): a 1% low up past the band beside an average down past its own is
        // turned into "no change" (the default wins), but a difference WAS measured.
        let mixed = judge(&WIDE, 30.0, -20.0);
        assert_eq!((mixed.verdict.as_str(), mixed.keep), ("no-change", false), "restored: {}", mixed.note);
        assert!(!mixed.note.contains("negligible at ROB RUN's noise"), "{}", mixed.note);
        assert!(!mixed.note.contains("no difference Compy could tell apart"), "{}", mixed.note);
        assert!(mixed.note.contains("Not negligible"), "{}", mixed.note);
        assert!(mixed.note.contains("the 1% low rose past ROB RUN's noise (+30% against +20.6%)"), "{}", mixed.note);
        // The fall matching a +16.4% rise is 14% (16.4 / 1.164, rounded down).
        assert!(mixed.note.contains("the average fell past ROB RUN's noise (-20% against -14%)"), "{}", mixed.note);
        assert!(mixed.note.contains("can't call this better or worse") && mixed.note.contains("put back"), "{}", mixed.note);
        // Opus r1 MUST-FIX: an average that fell past the matching fall (14%) but not past the rise band
        // (16.4%) still vetoes the win; before, -15% let +30% through as a kept improvement.
        let veto = judge(&WIDE, 30.0, -15.0);
        assert_eq!((veto.verdict.as_str(), veto.keep), ("no-change", false), "{}", veto.note);
        assert!(veto.note.contains("the average fell past -14%, the fall matching the +16.4% band"), "{}", veto.note);
        // Opus r2 MUST-FIX: a 1% low down 19% (past -17%, inside +20.6%) says the fall it passed.
        let worse = judge(&WIDE, -19.0, 0.0);
        assert_eq!(worse.verdict, "regressed", "{}", worse.note);
        assert!(worse.note.contains("against a +20.6% / -17% band"), "{}", worse.note);
        assert!(worse.note.contains("The 1% low fell past -17%, the fall matching the +20.6% band"), "{}", worse.note);
        assert!(!worse.note.contains("±20.6%"), "{}", worse.note);
        // A 3% band reads as it always did.
        assert!(judge(&QUIET, -5.0, 0.0).note.contains("±3%"));
        // Opus r2 MUST-FIX: Smoothest's change is a % of the start ratio: 1.60 -> 1.48 is -7.5%, inside
        // an 8% band (as a % of the lower ratio it read -8.1%, a win inside the noise).
        let ev: SmoothestEvidence = serde_json::from_value(serde_json::json!({ "band_pct": 8.0, "start_ratio": 1.6, "between_sessions": { "spread_pct": 8.0, "sessions": 4 } })).unwrap();
        assert_eq!(pacing_change(Some(&ev), Some(1.48)), Some((-7.5, 8.0)));
        // A 1% low inside the band with an average that couldn't be compared is never "negligible".
        let r0 = ExperimentRecord { noise_floor_pct: WIDE.low1_band_pct, game_noise: Some(WIDE.clone()), ..rec(150.0, 5) };
        let o0 = conclude_outcome(&r0, 150.0 * 1.05, 5000, false, Some("Test"), Some(5), Utc::now());
        let o0 = with_recommended_outcome_bands(o0, WIDE.low1_band_pct, WIDE.avg_band_pct, None);
        let o0 = with_noise_words(o0, &WIDE, "ROB RUN.exe", TrialOutcome::Recommended, NoiseDeltas::default());
        assert!(!o0.note.contains("negligible at ROB RUN's noise"), "{}", o0.note);
        assert!(o0.note.contains("the average couldn't be compared"), "{}", o0.note);
        assert!(o0.note.contains("the 1% low stayed inside ROB RUN's noise (+5% against +20.6% / -17%)"), "{}", o0.note);
        // A 1% low that fell past the matching fall (17%) but not the rise band (20.6%) is Worse.
        let r1 = ExperimentRecord { noise_floor_pct: WIDE.low1_band_pct, game_noise: Some(WIDE.clone()), ..rec(150.0, 5) };
        let fell = with_measured_fall(conclude_outcome(&r1, 150.0 * 0.81, 5000, false, Some("Test"), Some(5), Utc::now()), WIDE.low1_band_pct);
        assert_eq!((fell.verdict.as_str(), fell.keep), ("regressed", false));
        // A 1% low up past the band whose average couldn't be compared: also no win, also not negligible.
        let r = ExperimentRecord { noise_floor_pct: WIDE.low1_band_pct, game_noise: Some(WIDE.clone()), ..rec(150.0, 5) };
        let o = conclude_outcome(&r, 150.0 * 1.3, 5000, false, Some("Test"), Some(5), Utc::now());
        let o = with_recommended_outcome_bands(o, WIDE.low1_band_pct, WIDE.avg_band_pct, None);
        let o = with_noise_words(o, &WIDE, "ROB RUN.exe", TrialOutcome::Recommended, NoiseDeltas::default());
        assert_eq!((o.verdict.as_str(), o.keep), ("no-change", false));
        assert!(!o.note.contains("negligible at ROB RUN's noise"), "{}", o.note);
        assert!(o.note.contains("the average couldn't be compared"), "{}", o.note);
        // Inside both bands: negligible, as before.
        assert!(judge(&WIDE, 5.0, 4.0).note.contains("negligible at ROB RUN's noise"));
        // The 1% low inside, the average up past its band: Recommended doesn't call it, and says why.
        let avg_only = judge(&WIDE, 5.0, 25.0);
        assert_eq!(avg_only.verdict, "no-change");
        assert!(avg_only.note.contains("the average rose past ROB RUN's noise"), "{}", avg_only.note);
    }

    #[test]
    fn a_concluded_record_keeps_the_band_its_verdict_was_judged_on() {
        // Opus r3 SHOULD-FIX: a model-2 band is rewritten with the band this build judged on; a band of
        // this model stays exactly as the start stored it; a record with none keeps the measurement.
        let old = GameNoise { model: 2, low1_band_pct: 23.0, ..WIDE };
        let judged = crate::noise_floor::on_baseline_base(old.clone());
        let mut stored = Some(old);
        keep_judged_noise(&mut stored, Some(judged.clone()));
        assert_eq!(stored, Some(judged));
        let mut current = Some(WIDE);
        keep_judged_noise(&mut current, Some(GameNoise { low1_band_pct: 40.0, ..WIDE }));
        assert_eq!(current, Some(WIDE));
        let mut none = None;
        keep_judged_noise(&mut none, Some(WIDE));
        assert_eq!(none, Some(WIDE));
    }

    #[test]
    fn measured_now_walks_back_past_an_after_session_to_the_newest_as_is_session() {
        // Coordinator SHOULD-FIX (s27): on the owner's PC the newest ROB RUN session is exp:10's
        // after-session (14 changes on), whose as-is pool is empty; the label then said "noise still
        // isn't measured" although nine as-is sessions exist.
        let s = crate::noise_floor::tests::rob_day();
        let ledger = crate::noise_floor::tests::rob_trials();
        // (the fixture's sessions carry one game name; its numbers are ROB RUN's)
        let game = s[0].process_name.clone();
        let candidates = readings_newest_first(&s, &game);
        assert_eq!(candidates[0].started_at, s[12].started_at, "the newest is the after-session");
        assert!(crate::noise_floor::measure_game_noise(&s, candidates[0], &ledger).is_err(), "it measures nothing");
        let n = first_measured(candidates, |from| crate::noise_floor::measure_game_noise(&s, from, &ledger).ok())
            .expect("measured from the newest as-is session");
        assert_eq!(n.sessions, 9);
        // A session whose cap state can't be read is never the one measured from.
        let mut short = s.clone();
        short[11].fps_series.truncate(10);
        let c = readings_newest_first(&short, &game);
        assert!(c.iter().all(|x| x.started_at != short[11].started_at));
    }

    #[test]
    fn two_sessions_further_apart_than_the_band_was_measured_at_are_not_judged() {
        // Coordinator SHOULD-FIX (s27): the owner's day drifts (1% low 228 -> 172), so a band measured
        // between successive sessions is too narrow for a baseline and an after-session a day apart.
        let s = crate::noise_floor::tests::rob_day();
        let n = crate::noise_floor::measure_game_noise(&s, &s[11], &crate::noise_floor::tests::rob_trials()).unwrap();
        // The nine as-is sessions' longest start-to-start gap: 04:39 -> 12:05.
        assert_eq!(n.max_gap_mins, 446, "{n:?}");
        let gain = || judge(&WIDE, 30.0, 5.0);
        let near = with_gap_check(gain(), &n, Some("2026-11-12T10:00:00+00:00"), Some("2026-11-12T10:40:00+00:00"));
        assert_eq!(near.verdict, "improved", "40 minutes apart is inside what was measured");
        let far = with_gap_check(gain(), &n, Some("2026-11-12T10:00:00+00:00"), Some("2026-11-13T10:00:00+00:00"));
        assert_eq!((far.verdict.as_str(), far.keep, far.stop_reason.as_deref()), ("not-comparable", false, Some("gap-past-band")));
        assert!(far.note.contains("24.0 hours after the baseline") && far.note.contains("and the next (7.4 hours)"), "{}", far.note);
        assert!(!far.note.contains("drifts over a day"), "no unmeasured claim: {}", far.note);
        // A band recorded before the gap was kept can't say: left as judged.
        assert_eq!(with_gap_check(gain(), &WIDE, Some("2026-11-12T10:00:00+00:00"), Some("2026-11-20T10:00:00+00:00")).verdict, "improved");
    }

    #[test]
    fn sessions_left_out_for_an_unreadable_cap_state_are_named_in_the_note() {
        // P4-noise-sf: the band says how many sessions it used and how many it couldn't read.
        assert!(!judge(&WIDE, 5.0, 4.0).note.contains("weren't counted"));
        let two = GameNoise { cap_unread: 2, ..WIDE };
        let note = judge(&two, 5.0, 4.0).note;
        assert!(note.contains("Between 9 sessions"), "{note}");
        assert!(note.contains("2 other sessions of ROB RUN under the same changes weren't counted"), "{note}");
        let one = judge(&GameNoise { cap_unread: 1, ..WIDE }, 5.0, 4.0).note;
        assert!(one.contains("1 other session of ROB RUN under the same changes wasn't counted"), "{one}");
    }

    #[test]
    fn on_a_quiet_game_plus_5_is_better() {
        let o = judge(&QUIET, 5.0, 1.0);
        assert_eq!((o.verdict.as_str(), o.keep), ("improved", true), "{}", o.note);
        assert_eq!(judge(&QUIET, 2.0, 0.0).verdict, "no-change");
    }

    #[test]
    fn the_owners_four_rob_run_trials_are_all_judged_on_the_measured_band() {
        // exp:7 -4% / -3.2%, exp:8 -7.3% / -6.5% (an after-session uneven 304/231), exp:9 +2.4% / +4.5%
        // (both uneven), exp:10 +1.7% / +0.7%: every one now a judged, negligible result.
        for (low, avg) in [(-4.0, -3.2), (-7.3, -6.5), (2.4, 4.5), (1.7, 0.7)] {
            let o = judge(&WIDE, low, avg);
            assert_eq!((o.verdict.as_str(), o.stop_reason.as_deref()), ("no-change", None), "{low}: {}", o.note);
        }
    }

    #[test]
    fn an_uneven_session_is_no_longer_a_reason_to_judge_nothing() {
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn conclude_experiment(").unwrap()..];
        let body = &body[..body.find("pub(crate) fn restore_experiment(").unwrap()];
        assert!(!body.contains(concat!("with_steady", "_sessions(")), "uneven halves no longer turn a verdict too-noisy");
        assert!(body.contains("noise_for_conclude(rec, &covered_now, baseline, rows.as_deref())"), "judged on measured noise");
        assert!(body.contains("noise_floor_pct: n.low1_band_pct, ..rec.clone()"), "the 1% low is classified on it");
        assert!(body.contains("with_cap_check(measured, baseline_cap, after_cap)"), "cap state compared");
        assert!(body.contains("check: after_check"), "the receipt still keeps the after-session's grade");
    }

    #[test]
    fn a_frame_cap_that_changed_or_cant_be_read_confounds_the_trial() {
        let changed = judge_on(&WIDE, 30.0, 5.0, CapRead::Uncapped, CapRead::Capped { at_fps: 240.0 }, TrialOutcome::Recommended);
        assert_eq!((changed.verdict.as_str(), changed.keep, changed.stop_reason.as_deref()), ("confounded", false, Some("frame-cap-changed")));
        assert!(changed.note.contains("The frame cap changed between these sessions") && changed.note.contains("about 240 fps"), "{}", changed.note);
        let unread = judge_on(&WIDE, 30.0, 5.0, CapRead::Unknown, CapRead::Uncapped, TrialOutcome::Recommended);
        assert_eq!((unread.verdict.as_str(), unread.stop_reason.as_deref()), ("confounded", Some("frame-cap-unread")));
        assert!(unread.note.contains("can't tell"), "{}", unread.note);
        // A cap moved from 144 to 240 is a change too.
        let moved = judge_on(&QUIET, 1.0, 1.0, CapRead::Capped { at_fps: 144.0 }, CapRead::Capped { at_fps: 240.0 }, TrialOutcome::Recommended);
        assert_eq!(moved.verdict, "confounded");
    }

    #[test]
    fn under_a_shared_cap_the_average_is_never_read_as_no_change() {
        let capped = CapRead::Capped { at_fps: 240.0 };
        let max_fps = judge_on(&QUIET, 1.0, 0.0, capped, capped, TrialOutcome::MaxFps);
        assert_eq!((max_fps.verdict.as_str(), max_fps.keep), ("not-comparable", false), "{}", max_fps.note);
        assert_eq!(max_fps.stop_reason.as_deref(), Some("frame-cap-hides-average"));
        assert!(max_fps.note.contains("lift the cap"), "{}", max_fps.note);
        let rec = judge_on(&QUIET, 1.0, 0.0, capped, capped, TrialOutcome::Recommended);
        assert_eq!(rec.verdict, "no-change");
        assert!(rec.note.contains("hides any rise in the average") && rec.note.contains("rests on the 1% low"), "{}", rec.note);
        // The 1% low, which the cap doesn't flatten, still decides a real gain.
        assert_eq!(judge_on(&QUIET, 8.0, 0.0, capped, capped, TrialOutcome::Recommended).verdict, "improved");
        // A 1% low that itself sits at the cap is a ceiling too: never "no change" (review r1).
        let ceiling = with_cap_saturation(measured(150.5), CapRead::Capped { at_fps: 150.0 }, TrialOutcome::Recommended, (150.0, 150.5), 3.0);
        assert_eq!((ceiling.verdict.as_str(), ceiling.keep, ceiling.stop_reason.as_deref()), ("not-comparable", false, Some("frame-cap-hides-result")));
        assert!(ceiling.note.contains("slowest 1% of frames sat too close under that cap"), "{}", ceiling.note);
        // Partial headroom: a 1% low 2% under a 153 fps cap leaves no room for a gain past a 3% band.
        let close = with_cap_saturation(measured(150.5), CapRead::Capped { at_fps: 153.0 }, TrialOutcome::Recommended, (150.0, 150.5), 3.0);
        assert_eq!(close.verdict, "not-comparable");
        // A measured fall past the band stands under a cap.
        assert_eq!(with_cap_saturation(measured(100.0), CapRead::Capped { at_fps: 153.0 }, TrialOutcome::Recommended, (150.0, 100.0), 3.0).verdict, "regressed");
        // Smoothest is never judged under a cap: a cap evens out frame times.
        let smooth = with_cap_saturation(measured(150.5), capped, TrialOutcome::Smoothest, (150.0, 150.5), 3.0);
        assert_eq!((smooth.verdict.as_str(), smooth.stop_reason.as_deref()), ("not-comparable", Some("frame-cap-hides-pacing")));
    }

    #[test]
    fn unmeasured_noise_judges_nothing_and_asks_for_the_sessions_it_needs() {
        let why = NoiseUnmeasured { have: 1, need: 3, cap_unknown: false };
        let m = noise_unmeasured_message(&why, "ROB RUN.exe");
        assert!(m.contains("won't guess") && m.contains("found 1") && m.contains("Play 2 more baseline sessions"), "{m}");
        let o = unmeasured_noise_outcome(measured(180.0), &why, "ROB RUN.exe");
        assert_eq!((o.verdict.as_str(), o.keep, o.stop_reason.as_deref()), ("not-comparable", false, Some("noise-unmeasured")));
        let cap = noise_unmeasured_message(&NoiseUnmeasured { have: 0, need: 3, cap_unknown: true }, "ROB RUN.exe");
        assert!(cap.contains("frame cap") && cap.contains("baseline session"), "{cap}");
        // A record started before P4-judge-noisy, with nothing to measure from, is never judged on its 3%.
        assert!(noise_for_conclude(&rec(150.0, 5), &[], None, None).is_err());
        let started = ExperimentRecord { game_noise: Some(WIDE), ..rec(150.0, 5) };
        assert_eq!(noise_for_conclude(&started, &[], None, None), Ok(WIDE));
    }

    #[test]
    fn the_start_measures_the_band_and_refuses_when_it_cant() {
        let src = include_str!("experiment.rs");
        let body = &src[src.find("pub(crate) fn start_experiment(").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        assert!(body.contains("crate::noise_floor::measure_game_noise(&covered, baseline, &ledger_rows(changes))"));
        assert!(body.contains("noise_unmeasured_message(&why, &baseline.process_name)"));
        assert!(body.contains("game_noise: Some(game_noise),"), "the measurement is on the record");
        // The verdict is classified on the measured band, never on the stored `noise_floor_pct`.
        let conclude = &src[src.find("pub(crate) fn conclude_experiment(").unwrap()..];
        assert!(conclude.contains("Ok(n) => ExperimentRecord { noise_floor_pct: n.low1_band_pct, ..rec.clone() },"));
        assert!(conclude.contains("Err(why) => unmeasured_noise_outcome(paired, why, &rec.game),"));
    }

    /// An exp:10-shaped record as an older Compy wrote it (shape only, from the owner's data).
    fn legacy_no_change() -> serde_json::Value {
        serde_json::json!({
            "id": "exp:10-1", "rec_id": "power-ultimate", "rec_title": "Ultimate", "game": "ROB RUN.exe",
            "hypothesis": "h", "created_at": "2026-11-11T14:14:07+00:00", "status": "restored",
            "baseline_avg_fps": 274.8, "baseline_low1_fps": 171.7, "ledger_watermark": 84,
            "applied_change_id": "power-ultimate-1", "active_changes_at_start": 13, "noise_floor_pct": 3.0,
            "halves_floor_pct": 3.0, "between_session_noise": null,
            "treatment": { "avg_fps": 276.7, "low1_fps": 174.7, "samples": 996, "crashed": false, "delta_low1_pct": 1.7,
                "recorded_at": "2026-11-11T14:31:08+00:00", "delta_avg_pct": 0.7 },
            "verdict": "no-change", "kept": false, "verdict_confidence": "medium",
            "verdict_note": "… both against a ±3% band …", "trial_result": "negligible",
            "noise_evidence": { "band_pct": 3.0, "measured_noise_pct": null, "measured_noise_stale": null, "between_sessions": null }
        })
    }

    #[test]
    fn old_records_load_unchanged_and_save_back_without_new_keys() {
        let old = legacy_no_change();
        let back: ExperimentRecord = serde_json::from_value(old.clone()).expect("an older record loads");
        assert_eq!((back.game_noise.as_ref(), back.assumed_band.as_ref()), (None, None));
        let out = serde_json::to_value(&back).unwrap();
        assert!(out.get("game_noise").is_none() && out.get("assumed_band").is_none(), "nothing added on save");
        assert!(out["noise_evidence"].get("game_noise").is_none());
        for k in ["verdict", "verdict_note", "noise_floor_pct", "trial_result", "noise_evidence", "verdict_confidence"] {
            assert_eq!(out[k], old[k], "{k} is history: never rewritten");
        }
        // A label the UI was handed is never read back from a store either.
        let mut labelled = out.clone();
        labelled["assumed_band"] = serde_json::json!({ "assumed_pct": 3.0, "measured_low1_pct": 20.6, "measured_sessions": 9 });
        let reread: ExperimentRecord = serde_json::from_value(labelled).unwrap();
        assert_eq!(reread.assumed_band, None);
    }

    #[test]
    fn a_new_record_keeps_its_measured_noise_and_an_older_compy_judges_on_its_own_band() {
        // As a start records it: `noise_floor_pct` keeps the P4-noise band an older Compy judges on (here
        // nothing measured by that model, so its floor); this build judges on `game_noise` alone.
        let r = ExperimentRecord {
            noise_floor_pct: crate::noise_floor::noise_band_pct(None),
            game_noise: Some(WIDE),
            ..rec(150.0, 5)
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["game_noise"]["low1_band_pct"], serde_json::json!(20.6));
        assert_eq!(v["game_noise"]["cap"], serde_json::json!({ "state": "uncapped" }));
        #[derive(Deserialize)]
        struct OlderRecord {
            noise_floor_pct: f64,
        }
        let older: OlderRecord = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(older.noise_floor_pct, 3.0, "an older Compy judges it as it always did");
        let back: ExperimentRecord = serde_json::from_value(v).unwrap();
        assert_eq!(back.game_noise, Some(WIDE));
        assert_eq!(noise_for_conclude(&back, &[], None, None).map(|n| n.low1_band_pct), Ok(20.6), "this build: the measurement");
    }

    #[test]
    fn a_verdict_judged_on_the_assumed_band_is_labelled_never_rewritten() {
        let old: ExperimentRecord = serde_json::from_value(legacy_no_change()).unwrap();
        assert_eq!(
            assumed_band_label(&old, Some(&WIDE)),
            Some(AssumedBandLabel { assumed_pct: 3.0, measured_low1_pct: Some(20.6), measured_sessions: Some(9), claimed_change: false, judged: true })
        );
        assert_eq!(
            assumed_band_label(&old, None),
            Some(AssumedBandLabel { assumed_pct: 3.0, measured_low1_pct: None, measured_sessions: None, claimed_change: false, judged: true }),
            "still unmeasured is said so"
        );
        let mut worse = old.clone();
        worse.verdict = Some("regressed".into());
        assert!(assumed_band_label(&worse, Some(&WIDE)).unwrap().claimed_change, "only a claimed change over-claimed");
        // An older too-noisy result (no band recorded, graded on the fixed 3% halves gap) is labelled too.
        let mut noisy = legacy_no_change();
        noisy["verdict"] = serde_json::json!("too-noisy");
        noisy["noise_evidence"] = serde_json::Value::Null;
        let noisy: ExperimentRecord = serde_json::from_value(noisy).unwrap();
        assert_eq!(assumed_band_label(&noisy, Some(&WIDE)).map(|l| (l.judged, l.claimed_change)), Some((false, false)));
        // Opus review r2: a verdict from before Compy kept noise evidence (2026-07-17..09-28) was judged
        // on the record's fixed band; it is labelled with that band, whatever it claimed.
        for verdict in ["improved", "no-change", "regressed"] {
            let mut early = legacy_no_change();
            early["verdict"] = serde_json::json!(verdict);
            early["noise_evidence"] = serde_json::Value::Null;
            let early: ExperimentRecord = serde_json::from_value(early).unwrap();
            let l = assumed_band_label(&early, Some(&WIDE)).expect(verdict);
            assert_eq!((l.assumed_pct, l.judged, l.claimed_change), (early.noise_floor_pct, true, verdict != "no-change"), "{verdict}");
        }
        let mut aborted = legacy_no_change();
        aborted["verdict"] = serde_json::json!("confounded");
        aborted["noise_evidence"] = serde_json::Value::Null;
        let aborted: ExperimentRecord = serde_json::from_value(aborted).unwrap();
        assert_eq!(assumed_band_label(&aborted, Some(&WIDE)), None, "never judged against a band");
        // Judged on a measurement: no label.
        let measured_rec = ExperimentRecord { game_noise: Some(WIDE), ..old.clone() };
        assert_eq!(assumed_band_label(&measured_rec, Some(&WIDE)), None);
        let mut spread = old.clone();
        spread.between_session_noise = Some(crate::noise_floor::BetweenSessionNoise { spread_pct: 21.6, sessions: 4 });
        assert_eq!(assumed_band_label(&spread, Some(&WIDE)), None, "exp:5's band was measured");
        // Labelling hands a copy; the verdict and note stay exactly as stored.
        let labelled = with_assumed_band_labels(vec![old.clone()], |_| None);
        assert_eq!((labelled[0].verdict.clone(), labelled[0].verdict_note.clone()), (old.verdict, old.verdict_note));
        assert_eq!(labelled[0].assumed_band.as_ref().map(|l| l.measured_low1_pct), Some(None));
    }

    #[test]
    fn a_baseline_played_with_gaming_mode_on_never_stands_for_without_a_setting_gaming_mode_sets() {
        // CR-trial-gm-baseline-overlap: Gaming Mode on for both sessions reads comparable, but if it set
        // the Trial's setting during the baseline, both ran the same state and a real effect reads
        // "no change" and is put back as useless.
        let mut baseline = crate::sessions::SessionAccumulator::new("2026-11-12T10:00:00+00:00".into(), Some(13)).finalize(600);
        for rec_id in ["game-bar-disable", "sysmain-disable", "power-ultimate", "pcie-aspm-off"] {
            baseline.gaming_mode_active = Some(true);
            let why = gaming_mode_baseline_overlap(&baseline, rec_id).expect(rec_id);
            assert!(why.contains("Gaming Mode was on during the baseline") && why.contains("Nothing was changed"), "{why}");
            baseline.gaming_mode_active = None;
            assert!(gaming_mode_baseline_overlap(&baseline, rec_id).unwrap().contains("didn't record"), "{rec_id}");
            baseline.gaming_mode_active = Some(false);
            assert_eq!(gaming_mode_baseline_overlap(&baseline, rec_id), None, "{rec_id}: Gaming Mode off");
        }
        // A setting Gaming Mode never touches is unaffected either way.
        baseline.gaming_mode_active = Some(true);
        assert_eq!(gaming_mode_baseline_overlap(&baseline, "hags-enable"), None);
        // A Trial already running on such a baseline is confounded at conclude, restored, judged nothing.
        let o = with_gaming_mode_baseline_check(measured(200.0), Some(&baseline), "game-bar-disable");
        assert_eq!((o.verdict.as_str(), o.keep, o.stop_reason.as_deref()), ("confounded", false, Some("gaming-mode-baseline")));
        assert!(o.note.contains("judged nothing") && o.note.contains("then test again") && !o.note.contains("Nothing was changed"), "{}", o.note);
        assert_eq!(with_gaming_mode_baseline_check(measured(200.0), Some(&baseline), "hags-enable").verdict, measured(200.0).verdict);
        assert_eq!(with_gaming_mode_baseline_check(measured(200.0), None, "game-bar-disable").verdict, measured(200.0).verdict);
    }
}
