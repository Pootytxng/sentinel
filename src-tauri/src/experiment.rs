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

use chrono::{DateTime, Utc};

use crate::comparison::{self, ArmedComparison, ComparisonKind, DEFAULT_NOISE_FLOOR_PCT};
use crate::intelligence::Confidence;

const STORE_SCHEMA_VERSION: u32 = 1;

/// Below this many captured frames a treatment session's aggregate delta is noise, not signal —
/// the honest floor for "insufficient samples" (§4F stop-rule). Conservative + owner-tunable,
/// same spirit as `DEFAULT_NOISE_FLOOR_PCT`. ~10 s at 60 fps.
pub(crate) const MIN_TREATMENT_SAMPLES: u32 = 600;

/// Free-text cap for persisted experiment fields (title / game / hypothesis). Defense-in-depth at
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
    /// Halted on an error before a fair verdict (failed apply / restore-failed). Carries `stop_reason`.
    /// NB: a failed APPLY never creates a record (nothing to abort); this is for a failed RESTORE
    /// where the change is still live and the user must be told loudly.
    Aborted,
}

/// The treatment session's recorded metrics (§4F step 5). `samples` is the captured frame count —
/// the honesty gate against a too-short session.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct TreatmentRecord {
    pub avg_fps: f64,
    pub low1_fps: f64,
    pub samples: u32,
    pub crashed: bool,
    /// 1%-low %-delta vs baseline — the signal the verdict is judged on. Rounded to 0.1.
    pub delta_low1_pct: f64,
    pub recorded_at: String,
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
    pub noise_floor_pct: f64,
    #[serde(default)]
    pub treatment: Option<TreatmentRecord>,
    /// "improved" | "no-change" | "regressed" | "confounded" | "expired" | "insufficient-evidence".
    /// None while Running.
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
    /// the setting reads in the target state, `Some(false)` it does not (the start is aborted and the
    /// change restored), `None` the probe could not read it or no probe exists for this rec. Unknown
    /// stays unknown; it is never recorded as verified.
    #[serde(default)]
    pub target_verified: Option<bool>,
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
    /// Evidence is too thin (too few frames) or conflicts (another change landed mid-Trial).
    Inconclusive,
    /// No defensible comparison is possible: a different game, a baseline too old to compare, or
    /// no measurement was taken at all.
    Unmeasurable,
}

/// Every verdict string the engine can write, in one place so the §8 mapping is tested exhaustively.
#[cfg(test)]
const KNOWN_VERDICTS: [&str; 7] = [
    "improved",
    "regressed",
    "no-change",
    "insufficient-evidence",
    "confounded",
    "expired",
    "not-comparable",
];

/// Map the engine's verdict string to its §8 class. An unrecognised verdict is `Unmeasurable`, which
/// the keep rule restores: an unknown can never be kept by accident.
pub(crate) fn trial_result_for(verdict: &str) -> TrialResult {
    match verdict {
        "improved" => TrialResult::Better,
        "regressed" => TrialResult::Worse,
        "no-change" => TrialResult::Negligible,
        "insufficient-evidence" | "confounded" => TrialResult::Inconclusive,
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
/// fresh — never parse-partially, never overwrite the bytes in place.
pub(crate) fn load_store_from(path: &Path) -> ExperimentStore {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return ExperimentStore::default(), // absent = first run
    };
    match serde_json::from_str::<ExperimentStore>(&raw) {
        Ok(store) => store,
        Err(_) => {
            let corrupt = path.with_extension("json.corrupt");
            let _ = std::fs::remove_file(&corrupt);
            let _ = std::fs::rename(path, &corrupt);
            ExperimentStore::default()
        }
    }
}

fn load_store() -> ExperimentStore {
    load_store_from(&store_path())
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
/// `conclude_experiment` and `restore_experiment` through `history::rollback_change` — so it is the
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
pub(crate) fn attribution_warning(active_changes: usize) -> Option<String> {
    if active_changes == 0 {
        return None;
    }
    Some(format!(
        "{active} other Compy change{s} already active. This experiment measures ONLY the one new \
         change, holding the others constant — it can't attribute the result to any of them.",
        active = active_changes,
        s = if active_changes == 1 { " is" } else { "s are" },
    ))
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

/// The ledger fields the launch reconcile needs, borrowed so the matcher stays pure and testable.
pub(crate) struct LedgerEntryRef<'a> {
    pub id: &'a str,
    pub rec_id: &'a str,
    pub applied_at: &'a str,
    /// Ledger status is "applied" (not rolled back).
    pub applied: bool,
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
        .filter(|c| c.applied && c.rec_id == pending.rec_id && !claimed.iter().any(|id| *id == c.id))
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
    /// No change was applied: the record is dropped, as a failed apply always was.
    Dropped,
    /// A change was applied and is still in place: the record becomes a loud `Aborted` naming it.
    ChangeStillApplied,
    /// The start recorded its change and the ledger shows it rolled back: `Restored`, nothing kept.
    ChangeAlreadyRolledBack,
    /// The start recorded a change the ledger no longer has: a loud `Aborted` naming it.
    ChangeMissing,
    /// The ledger could not be read. The record stays `Pending`, untouched, for the next reconcile,
    /// so a transient read failure never turns into a guess or a lost link to the change.
    LedgerUnreadable,
}

/// PURE reconcile (injected ledger + clock). Every `Pending` record left by a start that never
/// finished is resolved; nothing is silently kept and nothing is mutated here. There is no automatic
/// restore: no measurement exists, so §9 says restore, but a rollback may need elevation and nobody
/// asked for a prompt. The change stays in the Fix surface's active list, where its rollback lives,
/// and the record says so. A start that recorded its change id is matched by that id alone; only a
/// start interrupted inside the apply itself (id never saved) falls back to
/// [`interrupted_start_change`].
pub(crate) fn reconcile_interrupted_starts_in(
    store: &mut ExperimentStore,
    ledger: Result<&[LedgerEntryRef<'_>], &str>,
    now: DateTime<Utc>,
) -> Vec<InterruptedStart> {
    let mut outcomes = Vec::new();
    let mut i = 0;
    while i < store.experiments.len() {
        if store.experiments[i].status != ExperimentStatus::Pending {
            i += 1;
            continue;
        }
        let Ok(rows) = ledger else {
            outcomes.push(InterruptedStart::LedgerUnreadable);
            i += 1;
            continue;
        };
        let recorded = store.experiments[i].applied_change_id.clone();
        let resolution = if recorded.is_empty() {
            let claimed: Vec<&str> = store
                .experiments
                .iter()
                .map(|e| e.applied_change_id.as_str())
                .filter(|id| !id.is_empty())
                .collect();
            match interrupted_start_change(&store.experiments[i], rows, &claimed) {
                None => InterruptedStart::Dropped,
                Some(id) => {
                    store.experiments[i].applied_change_id = id.to_string();
                    InterruptedStart::ChangeStillApplied
                }
            }
        } else {
            match rows.iter().find(|r| r.id == recorded) {
                Some(r) if r.applied => InterruptedStart::ChangeStillApplied,
                Some(_) => InterruptedStart::ChangeAlreadyRolledBack,
                None => InterruptedStart::ChangeMissing,
            }
        };
        let rec = &mut store.experiments[i];
        match resolution {
            InterruptedStart::Dropped => {
                store.experiments.remove(i);
                outcomes.push(InterruptedStart::Dropped);
                continue;
            }
            InterruptedStart::ChangeStillApplied => {
                rec.status = ExperimentStatus::Aborted;
                rec.stop_reason = Some(
                    "interrupted-start: Compy closed while this experiment was starting, after the \
                     change was applied. Nothing was measured, so restore it from Fix."
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
            InterruptedStart::ChangeMissing | InterruptedStart::LedgerUnreadable => {
                rec.status = ExperimentStatus::Aborted;
                rec.stop_reason = Some(format!(
                    "interrupted-start: Compy closed while this experiment was starting, and its \
                     change ({recorded}) is no longer in the change history — verify in Fix."
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

/// Whether the treatment session measured the SAME game as the baseline — the defense-in-depth
/// game-identity check at the webview trust boundary (the same posture as `MAX_TEXT_LEN`: a
/// compromised or buggy UI must not be able to make Compy compare two different games and call it a
/// clean single-variable result). The FE already offers only a same-game treatment session, but the
/// BACKEND re-verifies rather than trusting the UI's filter. Decision doc
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
///   session is comfortably long (≥ 2× the minimum frames), else Medium — a valid but shorter sample.
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
            "Only {treatment_samples} frames were captured — below the {MIN_TREATMENT_SAMPLES} Compy \
             needs for a fair before/after. That is not enough comparable evidence to judge this \
             change, so it was restored and the result is left as unknown."
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
            // "same game" assumption (decision doc 2026-07-18-experiment-comparability §4). When the
            // treatment game wasn't supplied we drop the claim rather than assert something unproven;
            // a genuine Mismatch never reaches here (it returns "not-comparable" upstream).
            let same_rig_and_game = match game {
                GameMatch::Match => "on the same rig and game",
                _ => "on the same rig",
            };
            format!(
                "Baseline and treatment were captured back-to-back {same_rig_and_game}, changing only \
                 this one setting — a clean single-variable comparison. Only the 1% low frame rate \
                 was judged, against the same noise floor the rest of Compy uses."
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

    // Too few frames ⇒ no honest verdict; restore rather than keep on thin evidence
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
    /// Already active in the Trust Ledger ⇒ already-configured.
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
    load_store().experiments.into_iter().filter(|e| e.status != ExperimentStatus::Pending).collect()
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

/// §4F step 1–4 — capture baseline, snapshot + apply ONE reversible change through the audited
/// ledger boundary, and record a Running experiment. Refuses while dark, and while another experiment
/// is starting or running. RECORD FIRST (#583): a `Pending` record naming the change is saved before
/// anything is applied, so no crash point can leave an applied change that no experiment names. A
/// failed apply drops that record and changes nothing. After a successful apply, a start that can't
/// finish (the target didn't take, or the evidence watermark is unreadable) restores the change
/// through the audited boundary before returning the error, never leaves it applied unrecorded.
#[tauri::command]
pub(crate) fn start_experiment(
    rec_id: String,
    rec_title: String,
    game: String,
    baseline_avg_fps: f64,
    baseline_low1_fps: f64,
    hypothesis: String,
) -> Result<ExperimentRecord, String> {
    if !experiment_gate() {
        return Err("The experiment engine isn't part of this build yet.".into());
    }
    let _g = lock_store()?;

    // Cap the persisted free-text at the trust boundary (see MAX_TEXT_LEN). Truncate, don't reject.
    let rec_title: String = rec_title.chars().take(MAX_TEXT_LEN).collect();
    let game: String = game.chars().take(MAX_TEXT_LEN).collect();
    let hypothesis: String = hypothesis.chars().take(MAX_TEXT_LEN).collect();

    // One store read serves the single-active check, the id counter and the read-modify-write, all
    // under this one lock.
    let mut store = load_store();
    // Under this lock no start is in flight, so any `Pending` here is an interrupted one: resolve it
    // now rather than letting it block until the next launch.
    reconcile_pending_locked(&mut store)?;
    // §3 one causal question at a time — enforced here, not only by the UI hiding the button.
    if let Some(active) = active_trial(&store) {
        return Err(if active.status == ExperimentStatus::Pending {
            format!(
                "an earlier experiment start ({}) was interrupted and Compy can't read its change \
                 history yet to resolve it — open Fix to check the change history, then try again",
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

    // Single-variable honesty context BEFORE we apply (§4F): how many changes are already active.
    let active = crate::history::active_change_count();
    let warning = attribution_warning(active);

    // Step 0 — RECORD FIRST. Saved before the apply; a failed save stops here with nothing changed.
    let now = Utc::now();
    store.schema_version = STORE_SCHEMA_VERSION;
    store.experiments.push(ExperimentRecord {
        id: format!("exp:{}-{}", store.experiments.len() + 1, now.timestamp_millis()),
        rec_id: rec_id.clone(),
        rec_title: rec_title.clone(),
        game,
        hypothesis,
        created_at: now.to_rfc3339(),
        status: ExperimentStatus::Pending,
        baseline_avg_fps,
        baseline_low1_fps,
        ledger_watermark: 0,
        applied_change_id: String::new(),
        active_changes_at_start: active,
        attribution_warning: warning,
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
    });
    let idx = store.experiments.len() - 1;
    save_store(&store)?;

    // Step 3–4: apply exactly ONE reversible change via the audited boundary. This captures the
    // typed rollback contract + prior-state snapshot at apply time (mutation-gate item 2).
    let applied = match crate::history::apply_recommendation(rec_id, rec_title) {
        Ok(applied) => applied,
        Err(e) => {
            // Nothing changed, so nothing is recorded — the pre-#583 contract. If this save fails the
            // Pending record stays on disk, and the next reconcile finds no applied change and drops it.
            store.experiments.pop();
            let _ = save_store(&store);
            return Err(format!("experiment aborted — apply failed, nothing changed: {e}"));
        }
    };
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

    // Step 5 (§4.5): the live probe must not read the target state as OFF straight after the apply.
    let target = target_verification(applied.active_check);
    store.experiments[idx].target_verified = target;
    if target == Some(false) {
        return Err(abort_start(
            &mut store,
            idx,
            "the setting did not read as changed after the apply, so there is nothing to measure",
        ));
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

/// Abort a start AFTER its change was applied: restore through the audited boundary and record why.
/// Nothing was measured, so the result is `Unmeasurable` and §9 says restore. A restore that doesn't
/// complete leaves a loud `Aborted` record naming the change, exactly like a failed conclude.
/// Returns the error message for the caller to surface.
fn abort_start(store: &mut ExperimentStore, idx: usize, why: &str) -> String {
    let change_id = store.experiments[idx].applied_change_id.clone();
    let restored = crate::history::rollback_change(change_id);
    let rec = &mut store.experiments[idx];
    rec.kept = false;
    rec.trial_result = Some(TrialResult::Unmeasurable);
    rec.concluded_at = Some(Utc::now().to_rfc3339());
    let message = match restored {
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
                "start-aborted: {why}; automatic restore did not complete — verify in Fix: {e}"
            ));
            format!(
                "experiment aborted before measuring — {why} — and the automatic restore did not \
                 complete. Compy could not confirm the change was rolled back; open the Fix surface \
                 to check and roll it back. ({e})"
            )
        }
    };
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
    let rows: Vec<LedgerEntryRef<'_>> = history
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|c| LedgerEntryRef {
            id: &c.id,
            rec_id: &c.rec_id,
            applied_at: &c.applied_at,
            applied: c.status == "applied",
        })
        .collect();
    let ledger = match &history {
        Ok(_) => Ok(rows.as_slice()),
        Err(e) => Err(e.as_str()),
    };
    let outcomes = reconcile_interrupted_starts_in(store, ledger, Utc::now());
    if outcomes.iter().any(|o| *o != InterruptedStart::LedgerUnreadable) {
        save_store(store)?;
    }
    Ok(outcomes)
}

/// Launch-time reconcile of starts that never finished (#583: no hidden state). Runs once from
/// `.setup` before the first window can read the store. `start_experiment` repeats it under the same
/// lock, so a launch whose save failed can't leave a stale `Pending` blocking every later start.
pub(crate) fn reconcile_interrupted_starts() -> Result<Vec<InterruptedStart>, String> {
    let _g = lock_store()?;
    let mut store = load_store();
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
#[tauri::command]
pub(crate) fn conclude_experiment(
    experiment_id: String,
    treatment_avg_fps: f64,
    treatment_low1_fps: f64,
    treatment_samples: u32,
    crashed: bool,
    // The game the treatment session actually measured, for the backend's defense-in-depth
    // same-game check (the FE offers only a same-game session, but we re-verify — decision doc
    // 2026-07-18-experiment-comparability §3/§4). `Option` ⇒ IPC-backward-compatible: an older FE
    // that omits it reads as `Unverified` and the verdict proceeds exactly as before.
    treatment_game: Option<String>,
) -> Result<ExperimentRecord, String> {
    if !experiment_gate() {
        return Err("The experiment engine isn't part of this build yet.".into());
    }
    let _g = lock_store()?;
    let mut store = load_store();
    let idx = store
        .experiments
        .iter()
        .position(|e| e.id == experiment_id)
        .ok_or_else(|| format!("experiment '{experiment_id}' not found"))?;
    if store.experiments[idx].status != ExperimentStatus::Running {
        return Err("experiment is not running — nothing to conclude".into());
    }

    // Cap the treatment game at the trust boundary like the other free-text fields (MAX_TEXT_LEN) —
    // a compromised UI must not be able to smuggle an unbounded string through this command.
    let treatment_game: Option<String> =
        treatment_game.map(|g| g.chars().take(MAX_TEXT_LEN).collect());

    let now = Utc::now();
    // `.ok()` is the honest direction here, not a collapse: an unreadable ledger becomes `None`,
    // which the confound guard REFUSES to attribute. It is never silently treated as a count.
    let ledger_now = crate::history::ledger_len_checked().ok();
    let outcome = conclude_outcome(
        &store.experiments[idx],
        treatment_low1_fps,
        treatment_samples,
        crashed,
        treatment_game.as_deref(),
        ledger_now,
        now,
    );

    store.experiments[idx].treatment = Some(TreatmentRecord {
        avg_fps: treatment_avg_fps,
        low1_fps: treatment_low1_fps,
        samples: treatment_samples,
        crashed,
        delta_low1_pct: outcome.delta_low1_pct,
        recorded_at: now.to_rfc3339(),
    });
    store.experiments[idx].verdict = Some(outcome.verdict.clone());
    store.experiments[idx].trial_result = Some(trial_result_for(&outcome.verdict));
    store.experiments[idx].verdict_confidence = Some(outcome.confidence);
    store.experiments[idx].verdict_note = Some(outcome.note.clone());
    store.experiments[idx].concluded_at = Some(now.to_rfc3339());

    if outcome.keep {
        store.experiments[idx].status = ExperimentStatus::Kept;
        store.experiments[idx].kept = true;
        store.experiments[idx].stop_reason = outcome.stop_reason;
    } else {
        // Restore through the audited boundary (resolves from history.json alone).
        let change_id = store.experiments[idx].applied_change_id.clone();
        match crate::history::rollback_change(change_id) {
            Ok(()) => {
                store.experiments[idx].status = ExperimentStatus::Restored;
                store.experiments[idx].kept = false;
                store.experiments[idx].stop_reason = outcome.stop_reason;
            }
            Err(e) if restore_already_reverted(&e) => {
                // The change was already reverted outside Compy before our restore ran — the desired
                // end state (change off) is already true. Honest: Restored, NOT a false "still applied".
                store.experiments[idx].status = ExperimentStatus::Restored;
                store.experiments[idx].kept = false;
                store.experiments[idx].stop_reason =
                    Some("the change was already reverted outside Compy before the automatic restore".into());
            }
            Err(e) => {
                // NEVER hide a partial: Compy could not confirm the change was rolled back. We do NOT
                // fabricate certainty about its state — we tell the user to verify + roll back from Fix.
                store.experiments[idx].status = ExperimentStatus::Aborted;
                store.experiments[idx].kept = false;
                store.experiments[idx].stop_reason =
                    Some(format!("automatic restore did not complete — verify in Fix: {e}"));
                save_store(&store)?;
                return Err(format!(
                    "experiment concluded '{}' but the automatic restore did not complete — Compy \
                     could not confirm the change was rolled back; open the Fix surface to check and \
                     roll it back. ({e})",
                    outcome.verdict
                ));
            }
        }
    }
    save_store(&store)?;
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
    let mut store = load_store();
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
    match crate::history::rollback_change(change_id) {
        // Rolled back now, or already off outside Compy — either way the change is reverted (honest).
        Ok(()) => {}
        Err(e) if restore_already_reverted(&e) => {}
        Err(e) => {
            // Compy could not confirm the change is off — persist the halt loudly (don't leave it
            // showing "running" forever) and do NOT fabricate certainty about the change's state.
            store.experiments[idx].status = ExperimentStatus::Aborted;
            store.experiments[idx].kept = false;
            store.experiments[idx].stop_reason =
                Some(format!("restore did not complete — verify in Fix: {e}"));
            store.experiments[idx].concluded_at = Some(now.to_rfc3339());
            save_store(&store)?;
            return Err(format!(
                "restore did not complete — Compy could not confirm the change was rolled back; \
                 open the Fix surface to check and roll it back. ({e})"
            ));
        }
    }
    store.experiments[idx].status = ExperimentStatus::Restored;
    store.experiments[idx].kept = false;
    store.experiments[idx].stop_reason = Some("user-restored".into());
    store.experiments[idx].concluded_at = Some(now.to_rfc3339());
    save_store(&store)?;
    Ok(store.experiments[idx].clone())
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
    // Already active? — the Trust Ledger is the source of truth, independent of catalog membership,
    // so a still-applied retired rec still reads `already-configured`.
    let already_active = crate::history::rec_is_active(rec_id);

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
        // With the gate armed, the defense-in-depth "isn't part of this build" short-circuit is
        // unreachable: a lookup command falls through to its REAL not-found path. We exercise only the
        // no-op lookup commands here (bogus id ⇒ nothing matches ⇒ no mutation). `start_experiment` is
        // deliberately NOT called — it applies a real reversible change through the ledger; that
        // round-trip is proven live on the rig by the ship QA (RELEASE_STATE), never in a unit run.
        let concluded = conclude_experiment("nonexistent".into(), 120.0, 90.0, 1000, false, None).unwrap_err();
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
        assert_eq!(attribution_warning(0), None);
    }

    #[test]
    fn attribution_warning_names_count_and_refuses_to_attribute_when_changes_active() {
        let one = attribution_warning(1).unwrap();
        assert!(one.contains("1 other Compy change is already active"));
        assert!(one.contains("ONLY the one new change"));
        let many = attribution_warning(3).unwrap();
        assert!(many.contains("3 other Compy changes are already active"));
        assert!(many.contains("can't attribute"));
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
        assert!(o.note.contains("single-variable comparison"));
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
        let back: ExperimentRecord = serde_json::from_value(old).unwrap();
        assert_eq!(back.trial_result, None, "a pre-#583 record reads as unclassified, never guessed");
        assert_eq!(back.target_verified, None, "and its target as unverified");
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
    fn only_a_probe_that_reads_off_fails_the_target_check() {
        use crate::history::ActiveCheck;
        assert_eq!(target_verification(Some(ActiveCheck::On)), Some(true));
        assert_eq!(target_verification(Some(ActiveCheck::Off)), Some(false));
        assert_eq!(target_verification(Some(ActiveCheck::Unreadable)), None, "unread is unknown");
        assert_eq!(target_verification(Some(ActiveCheck::Unrecognised)), None, "unprobed is unknown");
        assert_eq!(target_verification(None), None);
    }

    fn pending_at(created_at: &str) -> ExperimentRecord {
        let mut r = with_status(ExperimentStatus::Pending);
        r.id = "exp:9-0".into();
        r.created_at = created_at.into();
        r.applied_change_id = String::new();
        r
    }

    fn row<'a>(id: &'a str, rec_id: &'a str, applied_at: &'a str, applied: bool) -> LedgerEntryRef<'a> {
        LedgerEntryRef { id, rec_id, applied_at, applied }
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

    #[test]
    fn reconcile_drops_a_start_that_changed_nothing() {
        let mut store = ExperimentStore { schema_version: 1, experiments: vec![with_status(ExperimentStatus::Kept), pending_at(START)] };
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&[]), Utc::now());
        assert_eq!(out, vec![InterruptedStart::Dropped]);
        assert_eq!(store.experiments.len(), 1, "the kept record is untouched");
        assert_eq!(store.experiments[0].status, ExperimentStatus::Kept);
    }

    #[test]
    fn reconcile_names_a_change_that_is_still_applied_and_never_keeps_it() {
        let mut store = ExperimentStore { schema_version: 1, experiments: vec![pending_at(START)] };
        let ledger = [row("ours", "test-rec", "2026-09-28T12:00:02+00:00", true)];
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&ledger), Utc::now());
        assert_eq!(out, vec![InterruptedStart::ChangeStillApplied]);
        let r = &store.experiments[0];
        assert_eq!(r.status, ExperimentStatus::Aborted, "loud, never a silent keep");
        assert!(!r.kept);
        assert_eq!(r.applied_change_id, "ours", "the record now names the change so Fix can undo it");
        assert_eq!(r.trial_result, Some(TrialResult::Unmeasurable), "nothing was measured");
        assert!(r.concluded_at.is_some());
        assert!(r.stop_reason.as_deref().unwrap().contains("restore it from Fix"));
        assert!(active_trial(&store).is_none(), "an interrupted start no longer blocks the next one");
    }

    #[test]
    fn reconcile_with_an_unreadable_ledger_leaves_the_start_pending_for_a_retry() {
        let mut store = ExperimentStore { schema_version: 1, experiments: vec![pending_at(START)] };
        let before = serde_json::to_string(&store).unwrap();
        let out = reconcile_interrupted_starts_in(&mut store, Err("parse: bad json"), Utc::now());
        assert_eq!(out, vec![InterruptedStart::LedgerUnreadable]);
        assert_eq!(serde_json::to_string(&store).unwrap(), before, "no guess, no terminal state, no lost link");
        assert!(active_trial(&store).is_some(), "still unresolved, so a new start stays refused");
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
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&ledger), Utc::now());
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
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&rolled_back), Utc::now());
        assert_eq!(out, vec![InterruptedStart::ChangeAlreadyRolledBack]);
        let r = &store.experiments[0];
        assert_eq!((r.status, r.kept, r.trial_result), (ExperimentStatus::Restored, false, Some(TrialResult::Unmeasurable)));

        let mut store = ExperimentStore { schema_version: 1, experiments: vec![p] };
        let out = reconcile_interrupted_starts_in(&mut store, Ok(&[]), Utc::now());
        assert_eq!(out, vec![InterruptedStart::ChangeMissing]);
        let r = &store.experiments[0];
        assert_eq!(r.status, ExperimentStatus::Aborted, "a named change the ledger lost is loud, never dropped");
        let why = r.stop_reason.as_deref().unwrap();
        assert!(why.contains("ours") && why.contains("verify in Fix"), "{why}");
    }

    #[test]
    fn reconcile_leaves_settled_and_running_experiments_alone() {
        use ExperimentStatus::*;
        let before: Vec<ExperimentRecord> = [Running, Kept, Restored, Aborted].into_iter().map(with_status).collect();
        let mut store = ExperimentStore { schema_version: 1, experiments: before.clone() };
        let ledger = [row("x", "test-rec", "2026-09-28T12:00:02+00:00", true)];
        assert!(reconcile_interrupted_starts_in(&mut store, Ok(&ledger), Utc::now()).is_empty());
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
}
