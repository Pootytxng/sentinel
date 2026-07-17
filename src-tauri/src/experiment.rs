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
//! Gate: `experiment_gate()` is HARD-FALSE (test-pinned, `receipts_gate`/`gaming_mode_gate`
//! pattern). Every lifecycle command refuses while dark (defense in depth); the FE renders
//! nothing. Arming is its own owner-signed commit after a live apply→measure→restore QA +
//! a Cowork-lane adversarial audit + owner sign-off (spec §7). Until then this changes zero
//! machine state and the surface shows nothing.

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
//  GATE — HARD-FALSE. Flipping this is an owner-signed decision (spec §7),
//  never a side effect of a refactor. Mirrors `receipts_gate`/`gaming_mode_gate`.
// ─────────────────────────────────────────────────────────────────────────

pub(crate) fn experiment_gate() -> bool {
    false
}

// ─── Canonical types ─────────────────────────────────────────────────────

/// Where an experiment sits in its lifecycle (§4F). Persisted; additive-only (kebab-case serde).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ExperimentStatus {
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

/// The honest outcome of concluding an experiment. `verdict` is the surfaced string; `keep` decides
/// whether the change stays applied; `stop_reason` is set only on an error/blocked path.
#[derive(Debug, PartialEq, Clone)]
pub(crate) struct ConcludeOutcome {
    pub verdict: String,
    pub keep: bool,
    pub delta_low1_pct: f64,
    pub stop_reason: Option<String>,
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
    ledger_now: usize,
    now: DateTime<Utc>,
) -> ConcludeOutcome {
    let delta = delta_low1_pct(rec.baseline_low1_fps, treatment_low1);

    // A crash during the treatment session means the change is unstable/unsupported on this rig —
    // restore regardless of any fps reading (§4F "stop on crash"), and say so.
    if crashed {
        return ConcludeOutcome {
            verdict: "regressed".into(),
            keep: false,
            delta_low1_pct: delta,
            stop_reason: Some("crash-during-treatment".into()),
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
        };
    }

    let armed = armed_from(rec);
    let verdict =
        comparison::classify_with_guards(&armed, delta, rec.noise_floor_pct, ledger_now, now)
            .to_string();
    // Keep ONLY a clean, attributable improvement. no-change / regressed / confounded / expired all
    // restore — a change that didn't measurably help has no justification to stay.
    let keep = verdict == "improved";
    ConcludeOutcome { verdict, keep, delta_low1_pct: delta, stop_reason: None }
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

/// State probe: is the experiment engine part of this build? (It is not — DARK.)
#[tauri::command]
pub(crate) fn get_experiment_gate() -> bool {
    experiment_gate()
}

/// Read-only history of experiments. Ungated (pure read); returns `[]` while dark because no
/// experiment can be created behind the closed gate.
#[tauri::command]
pub(crate) fn get_experiments() -> Vec<ExperimentRecord> {
    load_store().experiments
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
/// ledger boundary, and record a Running experiment. Refuses while dark. Stops (returns Err, records
/// NOTHING) on a failed apply — never continue after an error, never a half-started experiment.
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
    let _g = store_write_gate().lock().map_err(|_| "experiment store lock poisoned".to_string())?;

    // Cap the persisted free-text at the trust boundary (see MAX_TEXT_LEN). Truncate, don't reject.
    let rec_title: String = rec_title.chars().take(MAX_TEXT_LEN).collect();
    let game: String = game.chars().take(MAX_TEXT_LEN).collect();
    let hypothesis: String = hypothesis.chars().take(MAX_TEXT_LEN).collect();

    // Single-variable honesty context BEFORE we apply (§4F): how many changes are already active.
    let active = crate::history::active_change_count();
    let warning = attribution_warning(active);

    // Step 3–4: apply exactly ONE reversible change via the audited boundary. This captures the
    // typed rollback contract + prior-state snapshot at apply time (mutation-gate item 2). A failed
    // apply aborts the whole experiment — nothing is recorded, nothing is left half-applied.
    let applied = crate::history::apply_recommendation(rec_id.clone(), rec_title.clone())
        .map_err(|e| format!("experiment aborted — apply failed, nothing changed: {e}"))?;

    // Watermark AFTER our apply so a LATER external change trips the confound guard, not our own.
    let ledger_watermark = crate::history::ledger_len();
    let now = Utc::now();
    // One store read serves both the id counter and the read-modify-write under this single lock.
    let mut store = load_store();
    let rec = ExperimentRecord {
        id: format!("exp:{}-{}", store.experiments.len() + 1, now.timestamp_millis()),
        rec_id,
        rec_title,
        game,
        hypothesis,
        created_at: now.to_rfc3339(),
        status: ExperimentStatus::Running,
        baseline_avg_fps,
        baseline_low1_fps,
        ledger_watermark,
        applied_change_id: applied.id().to_string(),
        active_changes_at_start: active,
        attribution_warning: warning,
        noise_floor_pct: DEFAULT_NOISE_FLOOR_PCT,
        treatment: None,
        verdict: None,
        kept: false,
        stop_reason: None,
        concluded_at: None,
    };
    store.schema_version = STORE_SCHEMA_VERSION;
    store.experiments.push(rec.clone());
    save_store(&store)?;
    Ok(rec)
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
) -> Result<ExperimentRecord, String> {
    if !experiment_gate() {
        return Err("The experiment engine isn't part of this build yet.".into());
    }
    let _g = store_write_gate().lock().map_err(|_| "experiment store lock poisoned".to_string())?;
    let mut store = load_store();
    let idx = store
        .experiments
        .iter()
        .position(|e| e.id == experiment_id)
        .ok_or_else(|| format!("experiment '{experiment_id}' not found"))?;
    if store.experiments[idx].status != ExperimentStatus::Running {
        return Err("experiment is not running — nothing to conclude".into());
    }

    let now = Utc::now();
    let ledger_now = crate::history::ledger_len();
    let outcome = conclude_outcome(
        &store.experiments[idx],
        treatment_low1_fps,
        treatment_samples,
        crashed,
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
    let _g = store_write_gate().lock().map_err(|_| "experiment store lock poisoned".to_string())?;
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
/// unknowns default to `None`/insufficient-evidence rather than an invented prior. Only reached when
/// armed (the command gate-checks first).
///
/// ⚠ ARMING BLOCKER: this is pre-arming scaffolding. `applicable`/`barred`/`likely_negligible`/
/// `expected_impact` are hardcoded to their conservative defaults, so the simulator can only ever
/// emit `already-configured` or `insufficient-evidence` today — it cannot yet report
/// `risk-exceeds-value`/`not-applicable`/`worth-testing` for a genuinely barred/inapplicable/
/// high-value rec. Wire these to the real catalog + blocklist + hardware priors BEFORE arming the
/// gate (spec §7); the gate being hard-false is what makes shipping this stub safe.
fn build_sim_context(rec_id: &str) -> Result<SimContext, String> {
    // Already active? — the ledger is the source of truth.
    let already_active = crate::history::rec_is_active(rec_id);
    // Title: the rec_id itself for now. The live-catalog title lookup wires in at arming (see the
    // ARMING BLOCKER above); until then the id is the honest, non-fabricated fallback.
    let rec_title = rec_id.to_string();
    Ok(SimContext {
        rec_id: rec_id.to_string(),
        rec_title,
        applicable: true,
        already_active,
        barred: false,
        likely_negligible: false,
        expected_impact: None, // conservative: unknown until a rule prior wires in (arming step)
        metric_to_watch: None,
        hardware_factor: "Based on this rig's detected hardware and current state.".into(),
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
        }
    }

    #[test]
    fn gate_is_pinned_false_until_owner_signs_off() {
        // Flipping this is an owner-signed decision (spec §7), never a side effect of a refactor.
        assert!(!experiment_gate(), "experiment_gate must stay hard-false");
    }

    #[test]
    fn every_lifecycle_command_refuses_while_dark() {
        assert!(simulate_optimization("x".into()).unwrap_err().contains("isn't part of this build"));
        assert!(start_experiment(
            "x".into(),
            "X".into(),
            "G".into(),
            120.0,
            90.0,
            "h".into()
        )
        .unwrap_err()
        .contains("isn't part of this build"));
        assert!(conclude_experiment("x".into(), 120.0, 90.0, 1000, false)
            .unwrap_err()
            .contains("isn't part of this build"));
        assert!(restore_experiment("x".into()).unwrap_err().contains("isn't part of this build"));
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
        let o = conclude_outcome(&r, 100.0, 5000, false, 5, Utc::now());
        assert_eq!(o.verdict, "improved");
        assert!(o.keep, "a clean improvement is kept");
        assert!(o.stop_reason.is_none());
    }

    #[test]
    fn a_gain_inside_the_noise_floor_is_no_change_and_restores() {
        let r = rec(100.0, 5);
        // +2% < 3% floor → no-change, never "improved" (never credit inside the noise).
        let o = conclude_outcome(&r, 102.0, 5000, false, 5, Utc::now());
        assert_eq!(o.verdict, "no-change");
        assert!(!o.keep, "no measurable benefit ⇒ restore to the clean baseline");
    }

    #[test]
    fn a_regression_restores() {
        let r = rec(100.0, 5);
        let o = conclude_outcome(&r, 80.0, 5000, false, 5, Utc::now());
        assert_eq!(o.verdict, "regressed");
        assert!(!o.keep);
    }

    #[test]
    fn a_confound_refuses_attribution_and_restores() {
        let r = rec(90.0, 5);
        // Ledger advanced past the watermark → another change landed → confounded, even on a big gain.
        let o = conclude_outcome(&r, 120.0, 5000, false, 6, Utc::now());
        assert_eq!(o.verdict, "confounded");
        assert!(!o.keep, "can't attribute a confounded result → restore");
    }

    #[test]
    fn a_crash_forces_restore_regardless_of_fps() {
        let r = rec(90.0, 5);
        // Even a big apparent gain: a crash means unstable/unsupported → restore + honest stop reason.
        let o = conclude_outcome(&r, 130.0, 5000, true, 5, Utc::now());
        assert_eq!(o.verdict, "regressed");
        assert!(!o.keep);
        assert_eq!(o.stop_reason.as_deref(), Some("crash-during-treatment"));
    }

    #[test]
    fn too_few_samples_is_insufficient_evidence_not_a_verdict() {
        let r = rec(90.0, 5);
        let o = conclude_outcome(&r, 120.0, MIN_TREATMENT_SAMPLES - 1, false, 5, Utc::now());
        assert_eq!(o.verdict, "insufficient-evidence");
        assert!(!o.keep, "no verdict on thin evidence ⇒ restore");
        assert_eq!(o.stop_reason.as_deref(), Some("insufficient-samples"));
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
}
