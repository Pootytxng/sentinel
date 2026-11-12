//! Live trial runner — drives the Measure → (Change) → Re-measure loop on the running game,
//! composing already-verified pieces: the fps.rs frametime stream
//! (`monitoring::latest_frametimes`, the same source the Monitoring tab uses) feeding the
//! unit-tested verdict core (`benchmark_verdict`). Runs on a background thread; the UI polls
//! `trial_state`.
//!
//! Shipped here: **CALIBRATION** — collect windows under unchanged conditions, split them, and
//! confirm the pipeline reports "no measurable change". That validates the whole live path on real
//! frames AND surfaces the rig's run-to-run noise floor ("your rig varies ±X% between runs, so we
//! can only trust changes bigger than that"). No tweak, no mutation, no UAC — the safe entry point.
//!
//! Also shipped: the **tweak A-B trial** (`start_tweak_trial`) applies a real change then rolls it
//! back to measure it. Because it mutates the machine it carries its own safety — a `RollbackGuard`
//! Drop-guard that guarantees rollback on any exit/panic, reusing the audited `apply_recommendation`
//! boundary (no new mutation primitive). Reachable from the Benchmark tab's "Measure this tweak".
#![allow(dead_code)] // runner is integration; wired to commands + the Benchmark tab below.

use crate::benchmark_verdict::{MetricWindow, Trial, Verdict, WindowCtx};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Spacing between window snapshots — ≥ the rolling frametime buffer span (~1–2 s) so windows are
/// roughly independent.
const WINDOW_INTERVAL: Duration = Duration::from_millis(2500);
const PER_SIDE: usize = 5;
/// Consecutive "no fresh frames" reads before giving up (≈30 s of no presents).
const MAX_MISSES: usize = 12;
/// Windows discarded right after applying the tweak (shader recompile / settle).
const WARMUP_WINDOWS: usize = 2;

#[derive(Serialize, Clone, Debug, Default)]
pub(crate) struct TrialState {
    pub running: bool,
    pub kind: String,
    pub status: String,
    pub collected: usize,
    pub target: usize,
    pub verdict: Option<Verdict>,
    /// Calibration result: the rig's run-to-run noise (%).
    pub noise_floor_pct: Option<f64>,
    /// Tweak trial: whether the change applied for measurement was rolled back (rig left clean).
    pub rolled_back: bool,
    pub error: Option<String>,
}

fn state() -> &'static Mutex<TrialState> {
    static S: OnceLock<Mutex<TrialState>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(TrialState::default()))
}

fn cancel_flag() -> &'static AtomicBool {
    static C: OnceLock<AtomicBool> = OnceLock::new();
    C.get_or_init(|| AtomicBool::new(false))
}

pub(crate) fn trial_state() -> TrialState {
    state().lock().map(|s| s.clone()).unwrap_or_default()
}

pub(crate) fn cancel_trial() {
    cancel_flag().store(true, Ordering::Relaxed);
}

fn set<F: FnOnce(&mut TrialState)>(f: F) {
    if let Ok(mut s) = state().lock() {
        f(&mut s);
    }
}

/// CR-bench-holds-setting: the setting the tweak trial holds, `(rec_id, rec_title)`, from the moment
/// its apply is decided (under the Trial store gate, before the apply runs) until its rollback has
/// finished. While held, another apply of that setting is refused: a second ledger row would snapshot
/// the trial's applied state and keep reading "applied" after the trial rolls its change back.
/// Each held entry carries the token of the trial run that set it, so a run's release never clears
/// a later run's hold.
type Held = Option<(u64, String, String)>;

fn held() -> &'static Mutex<Held> {
    static H: OnceLock<Mutex<Held>> = OnceLock::new();
    H.get_or_init(|| Mutex::new(None))
}

/// The setting the tweak trial holds right now. A poisoned lock still answers with what it holds.
pub(crate) fn held_now() -> Option<(String, String)> {
    held().lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|(_, id, title)| (id.clone(), title.clone()))
}

/// Called by `experiment::apply_for_bench_trial` under the store gate, right before the apply.
pub(crate) fn hold(token: u64, rec_id: &str, rec_title: &str) {
    *held().lock().unwrap_or_else(|p| p.into_inner()) = Some((token, rec_id.to_string(), rec_title.to_string()));
}

/// A fresh token for one tweak-trial run.
fn next_token() -> u64 {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    N.fetch_add(1, Ordering::Relaxed)
}

/// Releases this run's hold when dropped. Declared in the trial thread BEFORE the `RollbackGuard`, so
/// it drops after it: the hold ends only once the rollback has run (or when the apply never happened).
struct HoldRelease(u64);

impl Drop for HoldRelease {
    fn drop(&mut self) {
        let mut h = held().lock().unwrap_or_else(|p| p.into_inner());
        if h.as_ref().is_some_and(|(token, _, _)| *token == self.0) {
            *h = None;
        }
    }
}

/// PURE: the refusal for an apply naming the setting the tweak trial holds. `None` lets it go ahead.
pub(crate) fn bench_held_refusal<'a>(
    held: Option<&(String, String)>,
    mut rec_ids: impl Iterator<Item = &'a str>,
) -> Option<String> {
    let (id, title) = held?;
    rec_ids.any(|r| r == id).then(|| {
        format!(
            "\u{201c}{title}\u{201d} is being measured by the benchmark right now, so Compy won't apply it \
             again on top of the measurement. Wait for it to finish and roll back, or cancel it. Nothing \
             was changed."
        )
    })
}

/// Start a calibration run (no tweak, no mutation). Needs the FPS capture active + a game
/// presenting. No-op if a trial is already running.
pub(crate) fn start_calibration() {
    {
        let Ok(mut s) = state().lock() else {
            return;
        };
        if s.running {
            return;
        }
        *s = TrialState {
            running: true,
            kind: "calibration".into(),
            status: "Starting…".into(),
            target: PER_SIDE * 2,
            ..Default::default()
        };
    }
    cancel_flag().store(false, Ordering::Relaxed);
    let _ = std::thread::Builder::new()
        .name("bench-calibration".into())
        .spawn(|| {
            let (windows, game) = collect_game_windows(PER_SIDE * 2, "Calibrating");
            if cancel_flag().load(Ordering::Relaxed) {
                set(|s| {
                    s.running = false;
                    s.status = "Cancelled.".into();
                });
                return;
            }
            if windows.len() < PER_SIDE * 2 {
                set(|s| {
                    s.running = false;
                    s.status = "No frames.".into();
                    s.error = Some(
                        "Couldn't collect enough game frames. Turn on FPS monitoring (Monitoring \
                         tab) and make sure a game is running and presenting."
                            .into(),
                    );
                });
                return;
            }
            let mid = windows.len() / 2;
            let trial = Trial {
                baseline: windows[..mid].to_vec(),
                treatment: windows[mid..].to_vec(),
            };
            let verdict = trial.verdict();
            let noise = run_to_run_noise(&windows);
            // P4-noise-store: keep this game's noise on this PC for the Trials that follow. Only when
            // every window came from one game and the spread was measurable; a failed save just
            // means nothing is remembered.
            if let (Some(noise), Some(at)) =
                (noise, game.as_deref().and_then(crate::noise_floor::NoiseConditions::current))
            {
                let _ = crate::noise_floor::record(
                    &at,
                    noise,
                    windows.len() as u32,
                    &chrono::Utc::now().to_rfc3339(),
                );
            }
            set(|s| {
                s.running = false;
                s.verdict = Some(verdict);
                s.noise_floor_pct = noise;
                s.status = calibration_done_status(noise, windows.len());
            });
        });
}

/// Guarantees the trial's applied tweak is rolled back on EVERY exit path — success, early return,
/// cancel, even a panic unwind — so a measurement never leaves the rig changed. Records the outcome
/// in the trial state so the UI can show "rolled back" or surface a rollback failure.
struct RollbackGuard {
    change_id: Option<String>,
}

impl Drop for RollbackGuard {
    fn drop(&mut self) {
        if let Some(id) = self.change_id.take() {
            let result = crate::history::rollback_change(id);
            set(|s| record_rollback_outcome(s, result));
        }
        // Clear `running` only now — AFTER the rollback has resolved. The armed-guard exit paths
        // deliberately leave `running` true so the backend's `if s.running { return; }` start guard
        // rejects a new trial (which would replace this shared TrialState mid-rollback and let this
        // drop clobber the new trial's fields) until the machine is fully unwound. It also keeps the
        // frontend polling long enough to observe a rollback FAILURE it must surface.
        set(|s| s.running = false);
    }
}

/// PURE: record how the trial's rollback ended. An undo that ran on Windows but couldn't be saved
/// to history (#631) is not a failed rollback: the rig is back as it was, so it says that, and
/// never "FAILED" or "undo it manually".
fn record_rollback_outcome(s: &mut TrialState, result: Result<(), String>) {
    match result {
        Ok(()) => {
            s.rolled_back = true;
            s.status = "Done — change measured and rolled back.".into();
        }
        Err(e) if crate::history::is_unrecorded_rollback(&e) => {
            s.rolled_back = true;
            s.error = Some(format!("Measurement finished and the change was rolled back. {e}"));
            s.status = "Done — rolled back, but not saved to history.".into();
        }
        Err(e) => {
            s.rolled_back = false;
            s.error = Some(format!(
                "Measurement finished, but rolling the change back FAILED: {e}. Undo it \
                 manually in the Trust Ledger."
            ));
            s.status = "Rollback failed — see the Ledger.".into();
        }
    }
}

/// Start a tweak A-B trial: measure the game with the change OFF, apply it, measure again, then
/// ALWAYS roll it back (Drop-guarded). The change comes from the verified appliable catalog. Needs
/// the FPS capture active + a game presenting. No-op if a trial is already running.
///
/// An elevated tweak prompts UAC twice (apply + rollback) — never per sample; a non-elevated one
/// prompts not at all.
pub(crate) fn start_tweak_trial(rec_id: String, rec_title: String) {
    {
        let Ok(mut s) = state().lock() else {
            return;
        };
        if s.running {
            return;
        }
        *s = TrialState {
            running: true,
            kind: "tweak".into(),
            status: "Starting…".into(),
            target: PER_SIDE * 2,
            ..Default::default()
        };
    }
    cancel_flag().store(false, Ordering::Relaxed);
    let _ = std::thread::Builder::new()
        .name("bench-tweak".into())
        .spawn(move || {
            // 1. Baseline — current state (change off). No mutation yet: a cancel/bail here leaves
            //    the rig untouched.
            set(|s| s.status = "Measuring baseline (change off)…".into());
            let baseline = collect_windows(PER_SIDE, "Baseline");
            if cancel_flag().load(Ordering::Relaxed) {
                set(|s| {
                    s.running = false;
                    s.status = "Cancelled.".into();
                });
                return;
            }
            if baseline.len() < PER_SIDE {
                set(|s| {
                    s.running = false;
                    s.status = "No frames.".into();
                    s.error = Some(
                        "Couldn't collect baseline frames. Turn on FPS monitoring with a game running."
                            .into(),
                    );
                });
                return;
            }
            // 2. Apply. If it fails, nothing was mutated — bail cleanly (no guard armed).
            set(|s| s.status = "Applying the change…".into());
            // CR-bench-holds-setting: released on every exit, after `_guard` (declared below) rolls back.
            let token = next_token();
            let _hold = HoldRelease(token);
            // CR-rp-same-setting-row: through the Trial-aware apply, so a setting a running Trial
            // holds is refused here too (this trial's own rollback would otherwise re-apply it).
            // CR-bench-holds-setting: it also marks the setting held, under the same gate, before the apply.
            let view = match crate::experiment::apply_for_bench_trial(rec_id.clone(), rec_title.clone(), token) {
                Ok(v) => v,
                Err(e) => {
                    set(|s| {
                        s.running = false;
                        s.error = Some(format!("Couldn't apply the change: {e}"));
                        s.status = "Apply failed.".into();
                    });
                    return;
                }
            };
            // ARMED: from here, every exit path rolls the change back.
            let _guard = RollbackGuard { change_id: Some(view.id().to_string()) };

            // 3. Warmup — discard while the change settles.
            set(|s| s.status = "Letting it settle…".into());
            let _ = collect_windows(WARMUP_WINDOWS, "Settling");

            // 4. Treatment (change on). A cancel here just yields fewer windows → the guard still
            //    rolls back below.
            set(|s| s.status = "Measuring with the change…".into());
            let treatment = collect_windows(PER_SIDE, "Treatment");
            if treatment.len() < PER_SIDE {
                set(|s| {
                    // `running` stays true until _guard's drop finishes the rollback (see RollbackGuard).
                    s.status = "No frames.".into();
                    s.error = Some("Couldn't collect frames with the change on.".into());
                });
                return; // _guard rolls back
            }

            // 5. Verdict, then roll back (the guard, on drop).
            let verdict = Trial { baseline, treatment }.verdict();
            // Record a verified win to the scoreboard — only a Keep earns one (the firewall).
            let _ = crate::benchmark_scoreboard::record_result(&rec_id, &rec_title, &verdict);
            set(|s| {
                // `running` stays true until _guard's drop finishes the rollback (see RollbackGuard).
                s.verdict = Some(verdict);
                s.status = "Rolling the change back…".into();
            });
            // _guard drops here → rollback finalizes the status / surfaces any rollback failure.
        });
}

// ── §2a AGGREGATE-STACK A/B — the honest cumulative-benefit trial ────────────────────────────────
//
// Applies the WHOLE enabled safe stack at once (one UAC, via the audited `apply_recommendations_batch`
// orchestration — NO new mutation primitive), measures the game with the stack ON, then rolls back
// EVERY change it made. The point is the Receipts-doctrine story: "your rig measured X% faster with
// the safe stack, and here's the proof" — the cumulative delta of individually-negligible tweaks,
// measured honestly, never claimed. Rollback-first is preserved by a multi-change Drop-guard that
// undoes exactly the entries the batch created (diffed from the ledger), on every exit path.
//
// Ships DARK: `stack_trial_gate()` returns false, so the command refuses and the FE renders nothing
// until live QA + owner sign-off flips it (mutation-gate item 7). Arming is a separate reviewable
// commit, never a side effect of this one.

/// DARK gate for the aggregate-stack A/B trial (§2a). While false the `start_stack_trial` command
/// refuses and no aggregate mutation can run. FULLY REVERSIBLE: flip to `true` (a deliberate,
/// reviewed commit) only after live apply/rollback QA on a real rig + owner sign-off.
pub(crate) fn stack_trial_gate() -> bool {
    false
}

/// The stack analogue of `RollbackGuard`: rolls back EVERY change the stack apply created, on any
/// exit path (success, early return, cancel, panic unwind), in REVERSE apply order (LIFO) so a
/// measurement never leaves the rig changed. Each rollback goes through the same audited
/// `history::rollback_change` boundary; a partial failure is surfaced loudly (undo the rest in the
/// Ledger) rather than silently swallowed.
struct StackRollbackGuard {
    change_ids: Vec<String>, // apply order; drained in reverse on drop
}

impl Drop for StackRollbackGuard {
    fn drop(&mut self) {
        if self.change_ids.is_empty() {
            return;
        }
        let results: Vec<(String, Result<(), String>)> = std::mem::take(&mut self.change_ids)
            .into_iter()
            .rev()
            .map(|id| {
                let r = crate::history::rollback_change(id.clone());
                (id, r)
            })
            .collect();
        set(|s| record_stack_rollback_outcome(s, results));
        // Clear `running` only after the whole stack has unwound — see RollbackGuard::drop for why
        // the armed-guard exit paths leave it true until here.
        set(|s| s.running = false);
    }
}

/// PURE: record how the stack's rollbacks ended. A change undone on Windows but not saved to history
/// (#631) is never counted as FAILED, and its message is always shown, even next to real failures,
/// because its ledger row still reads "applied".
fn record_stack_rollback_outcome(s: &mut TrialState, results: Vec<(String, Result<(), String>)>) {
    let mut failed: Vec<String> = Vec::new();
    let mut unrecorded: Vec<String> = Vec::new();
    for (id, r) in results {
        match r {
            Ok(()) => {}
            Err(e) if crate::history::is_unrecorded_rollback(&e) => unrecorded.push(e),
            Err(e) => failed.push(format!("{id}: {e}")),
        }
    }
    if failed.is_empty() {
        s.rolled_back = true;
        s.status = "Done — the stack was measured and fully rolled back.".into();
        if !unrecorded.is_empty() {
            s.error = Some(unrecorded.join(" "));
        }
    } else {
        s.rolled_back = false;
        let mut msg = format!(
            "Measurement finished, but rolling {} change(s) back FAILED: {}. Undo them manually \
             in the Trust Ledger.",
            failed.len(),
            failed.join("; ")
        );
        if !unrecorded.is_empty() {
            msg.push_str(&format!(
                " {} other change(s) were undone: {}",
                unrecorded.len(),
                unrecorded.join(" ")
            ));
        }
        s.error = Some(msg);
        s.status = "Rollback failed — see the Ledger.".into();
    }
}

/// The batch-safe subset of the requested stack: appliable, de-duplicated, and excluding
/// `power-ultimate` (the one exit-using elevated rec that `apply_recommendations_batch` refuses to
/// batch by design). Pure so the filtering contract is unit-testable without elevation.
pub(crate) fn stack_trial_items(
    requested: &[(String, String)],
) -> Vec<crate::history::BatchApplyItem> {
    let mut seen = std::collections::HashSet::new();
    requested
        .iter()
        .filter(|(id, _)| id != "power-ultimate")
        .filter(|(id, _)| crate::history::APPLIABLE_REC_IDS.contains(&id.as_str()))
        .filter(|(id, _)| seen.insert(id.clone()))
        .map(|(id, title)| crate::history::BatchApplyItem {
            rec_id: id.clone(),
            rec_title: title.clone(),
        })
        .collect()
}

/// Start an aggregate-stack A/B trial. Measures the game with the stack OFF, applies the whole safe
/// stack in ONE elevation, measures again, then ALWAYS rolls back every change (Drop-guarded). Needs
/// the FPS capture active + a game presenting. No-op if a trial is already running, or if the gate
/// is dark.
pub(crate) fn start_stack_trial(requested: Vec<(String, String)>) {
    if !stack_trial_gate() {
        return; // DARK: the aggregate trial is not armed
    }
    let items = stack_trial_items(&requested);
    if items.is_empty() {
        set(|s| {
            s.running = false;
            s.error = Some("No appliable safe tweaks to measure as a stack.".into());
            s.status = "Nothing to apply.".into();
        });
        return;
    }
    {
        let Ok(mut s) = state().lock() else {
            return;
        };
        if s.running {
            return;
        }
        *s = TrialState {
            running: true,
            kind: "stack".into(),
            status: "Starting…".into(),
            target: PER_SIDE * 2,
            ..Default::default()
        };
    }
    cancel_flag().store(false, Ordering::Relaxed);
    let _ = std::thread::Builder::new()
        .name("bench-stack".into())
        .spawn(move || {
            // 1. Baseline — stack off. No mutation yet: a cancel/bail here leaves the rig untouched.
            set(|s| s.status = "Measuring baseline (stack off)…".into());
            let baseline = collect_windows(PER_SIDE, "Baseline");
            if cancel_flag().load(Ordering::Relaxed) {
                set(|s| {
                    s.running = false;
                    s.status = "Cancelled.".into();
                });
                return;
            }
            if baseline.len() < PER_SIDE {
                set(|s| {
                    s.running = false;
                    s.status = "No frames.".into();
                    s.error = Some(
                        "Couldn't collect baseline frames. Turn on FPS monitoring with a game running."
                            .into(),
                    );
                });
                return;
            }
            // 2. Apply the whole stack in one batch (one UAC). Diff the ledger around it so the guard
            //    rolls back EXACTLY the entries this batch created — never anything pre-existing.
            //    The diff's isolation relies on apply_recommendations_batch holding HISTORY_LOCK for
            //    its whole duration (so no unrelated write interleaves the two reads); if a future
            //    refactor shrinks that lock scope, revisit this.
            set(|s| s.status = "Applying the safe stack…".into());
            // The "before" read is fallible on purpose: a corrupt/unreadable ledger must ABORT here,
            // BEFORE any mutation — never swallow to [] and then apply against an orphaned ledger
            // (rust-tauri-reviewer, §2a). No mutation has happened yet, so this is a clean bail.
            let before: std::collections::HashSet<String> = match crate::history::all_change_ids() {
                Ok(ids) => ids.into_iter().collect(),
                Err(e) => {
                    set(|s| {
                        s.running = false;
                        s.error = Some(format!(
                            "Couldn't read the Trust Ledger before measuring — refusing to change \
                             anything until it's readable. ({e})"
                        ));
                        s.status = "Ledger unreadable — nothing changed.".into();
                    });
                    return;
                }
            };
            // CR-rp-same-setting-row: the Trial-aware batch, as the UI's (refused whole if it names a
            // setting a running Trial holds).
            if let Err(e) = crate::experiment::apply_recommendations_batch(items) {
                set(|s| {
                    s.running = false;
                    s.error = Some(format!("Couldn't apply the stack: {e}"));
                    s.status = "Apply failed.".into();
                });
                return;
            }
            // New entries, in apply order (all_change_ids preserves on-disk order). The apply just
            // persisted a valid ledger, so this read should succeed; if it somehow can't, the changes
            // ARE recorded (each individually rollback-able), so surface it loudly rather than
            // pretending nothing was applied — the user undoes them in the Ledger.
            let after = match crate::history::all_change_ids() {
                Ok(ids) => ids,
                Err(e) => {
                    set(|s| {
                        s.running = false;
                        s.error = Some(format!(
                            "The stack was applied, but the ledger couldn't be re-read to roll it \
                             back automatically — undo it in the Trust Ledger. ({e})"
                        ));
                        s.status = "Applied — roll back manually in the Ledger.".into();
                    });
                    return;
                }
            };
            let new_ids: Vec<String> =
                after.into_iter().filter(|id| !before.contains(id)).collect();
            if new_ids.is_empty() {
                // Nothing actually applied (every item skipped, e.g. UAC declined) → nothing to
                // measure or roll back. Honest bail, no guard.
                set(|s| {
                    s.running = false;
                    s.status = "Nothing applied.".into();
                    s.error = Some(
                        "The stack didn't apply — nothing was changed, so there's nothing to measure."
                            .into(),
                    );
                });
                return;
            }
            // ARMED: from here, every exit path rolls back every applied change.
            let applied_n = new_ids.len();
            let _guard = StackRollbackGuard { change_ids: new_ids };

            // 3. Warmup — discard while the stack settles.
            set(|s| s.status = "Letting it settle…".into());
            let _ = collect_windows(WARMUP_WINDOWS, "Settling");

            // 4. Treatment (stack on). A cancel here just yields fewer windows → the guard still
            //    rolls back below.
            set(|s| s.status = "Measuring with the stack on…".into());
            let treatment = collect_windows(PER_SIDE, "Treatment");
            if treatment.len() < PER_SIDE {
                set(|s| {
                    // `running` stays true until _guard's drop finishes the rollback (see StackRollbackGuard).
                    s.status = "No frames.".into();
                    s.error = Some("Couldn't collect frames with the stack on.".into());
                });
                return; // _guard rolls back
            }

            // 5. Verdict, then roll back (the guard, on drop). The aggregate delta is the honest
            //    cumulative story; it is NOT banked to the scoreboard (that firewall is per-tweak
            //    Keep verdicts only — an aggregate isn't attributable to one rec).
            let verdict = Trial { baseline, treatment }.verdict();
            set(|s| {
                // `running` stays true until _guard's drop finishes the rollback (see StackRollbackGuard).
                s.verdict = Some(verdict);
                s.status = format!("Rolling back the {applied_n}-tweak stack…");
            });
            // _guard drops here → rollback finalizes the status / surfaces any rollback failure.
        });
}

/// Collect `n` window snapshots from the live frametime stream, `WINDOW_INTERVAL` apart. Returns
/// fewer if the game stops presenting or the run is cancelled.
fn collect_windows(n: usize, label: &str) -> Vec<MetricWindow> {
    collect_game_windows(n, label).0
}

/// The one game every window came from, or `None` when the game changed mid-run or had no name —
/// a noise level measured across two games describes neither.
fn one_game(names: &[String]) -> Option<String> {
    let first = names.first()?;
    (!first.trim().is_empty() && names.iter().all(|n| n.eq_ignore_ascii_case(first))).then(|| first.clone())
}

/// [`collect_windows`], also naming the game the windows came from (see [`one_game`]).
fn collect_game_windows(n: usize, label: &str) -> (Vec<MetricWindow>, Option<String>) {
    let mut names = Vec::new();
    let mut out = Vec::new();
    let mut misses = 0usize;
    while out.len() < n {
        if cancel_flag().load(Ordering::Relaxed) {
            break;
        }
        std::thread::sleep(WINDOW_INTERVAL);
        if let Some((proc, ft)) = crate::monitoring::latest_frametimes() {
            // Sample the GPU's live clock + temperature alongside the frametimes so the verdict
            // engine's throttle/thermal validity gates actually engage (they no-op on a zero
            // reading). `bg_load_flag`/`input_to_photon_ms` stay unset — no honest signal is wired
            // for those yet, so they contribute nothing rather than a fabricated confound.
            let (avg_clock_mhz, max_temp_c) = crate::monitoring::sample_gpu_validity();
            let ctx = WindowCtx { avg_clock_mhz, max_temp_c, ..WindowCtx::default() };
            if let Some(w) = MetricWindow::from_frametimes(&ft, ctx) {
                out.push(w);
                names.push(proc);
                let got = out.len();
                set(|s| {
                    s.collected = got;
                    s.status = format!("{label}: window {got}/{n}");
                });
                misses = 0;
                continue;
            }
        }
        misses += 1;
        if misses >= MAX_MISSES {
            break;
        }
    }
    let game = one_game(&names);
    (out, game)
}

/// Run-to-run noise = coefficient of variation (%) of the 1% lows across the captured windows.
/// `None` when it can't be measured (fewer than two windows, or a mean 1% low of zero) — never a
/// 0 that would read as "±0%".
fn run_to_run_noise(windows: &[MetricWindow]) -> Option<f64> {
    let xs: Vec<f64> = windows.iter().map(|w| w.p1_low_fps).collect();
    if xs.len() < 2 {
        return None;
    }
    let mean = xs.iter().sum::<f64>() / xs.len() as f64;
    if !mean.is_finite() || mean <= 0.0 {
        return None;
    }
    let var = xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (xs.len() - 1) as f64;
    Some(var.sqrt() / mean * 100.0)
}

/// PURE: the status line once a calibration finishes. The number is the spread of the 1% low
/// across the windows of ONE 25-second calibration, not a comparison between separate runs, so it
/// says exactly that. When it is unmeasured, it names the real reason: too few windows, or a 1%
/// low that read as zero.
fn calibration_done_status(noise: Option<f64>, window_count: usize) -> String {
    match noise {
        Some(noise) => format!(
            "Calibration done — in one 25-second calibration on your PC, the 1% low varied by ±{noise:.1}%."
        ),
        None if window_count < 2 => "Calibration done — fewer than two measurement windows were captured, \
             so the spread couldn't be measured."
            .into(),
        None => "Calibration done — the 1% low read as zero, so the spread couldn't be measured.".into(),
    }
}

#[cfg(test)]
mod trial_tests {
    use super::*;

    fn win(p1: f64) -> MetricWindow {
        MetricWindow {
            avg_fps: p1 + 20.0,
            p1_low_fps: p1,
            p01_low_fps: p1 - 10.0,
            frametime_stdev_ms: 1.0,
            stutter_pct: 0.0,
            frame_count: 600,
            input_to_photon_ms: None,
            avg_clock_mhz: 0.0,
            max_temp_c: 0.0,
            bg_load_flag: false,
        }
    }

    #[test]
    fn an_apply_of_the_setting_the_tweak_trial_holds_is_refused_until_its_rollback_ran() {
        // CR-bench-holds-setting: a UI apply while the benchmark measures a change would snapshot the
        // trial's applied state and keep reading "applied" after the trial rolls it back.
        let held = ("game-mode-on".to_string(), "Turn on Game Mode".to_string());
        let refused = bench_held_refusal(Some(&held), std::iter::once("game-mode-on")).expect("refused");
        assert!(refused.contains("Turn on Game Mode") && refused.contains("Nothing was changed"), "{refused}");
        assert!(bench_held_refusal(Some(&held), ["hags-on", "game-mode-on"].into_iter()).is_some(), "a batch naming it");
        assert_eq!(bench_held_refusal(Some(&held), ["hags-on"].into_iter()), None, "another setting applies");
        assert_eq!(bench_held_refusal(None, std::iter::once("game-mode-on")), None, "nothing held");

        // A run's release clears only its own hold, never a later run's.
        hold(7, "game-mode-on", "Turn on Game Mode");
        assert_eq!(held_now(), Some(held.clone()));
        hold(8, "hags-on", "HAGS");
        drop(HoldRelease(7));
        assert_eq!(held_now().map(|h| h.0), Some("hags-on".to_string()), "run 7 can't clear run 8's hold");
        drop(HoldRelease(8));
        assert_eq!(held_now(), None);
    }

    #[test]
    fn the_tweak_trial_holds_the_setting_from_its_apply_until_after_its_rollback() {
        // The hold is set by the gated apply (before the apply runs) and released by `_hold`, declared
        // before `_guard` so it drops after the rollback has run, on every exit path.
        let src = include_str!("benchmark_trial.rs");
        let body = src.split_once("pub(crate) fn start_tweak_trial(").map(|(_, r)| r).expect("fn");
        let body = body.split_once("\n}\n").map(|(b, _)| b).expect("body");
        let hold = body.find("let _hold = HoldRelease(token);").expect("the hold release is armed");
        let apply = body.find("crate::experiment::apply_for_bench_trial(").expect("held apply");
        let guard = body.find("let _guard = RollbackGuard").expect("rollback guard");
        assert!(hold < apply && apply < guard, "hold release, apply, then the rollback guard");
        let exp = include_str!("experiment.rs");
        let f = exp.split_once("pub(crate) fn apply_for_bench_trial(").map(|(_, r)| r).expect("fn");
        let f = f.split_once("\n}\n").map(|(b, _)| b).expect("body");
        let (trial, bench) = (f.find("held_by_trial_refusal(").expect("trial"), f.find("bench_refusal(").expect("bench"));
        let (mark, write) = (f.find("benchmark_trial::hold(").expect("marked"), f.find(concat!("crate::history::", "apply_recommendation(")).expect("apply"));
        assert!(trial < bench && bench < mark && mark < write, "refusals, mark held, then the apply");
    }

    #[test]
    fn an_unrecorded_rollback_never_reads_as_failed() {
        // #631: the undo ran on Windows; only the history save failed.
        let e = format!("{} (disk full), so Test → Applied & history may still list this change \
                         as applied.", crate::history::ROLLBACK_UNRECORDED_LEAD);
        let mut s = TrialState::default();
        record_rollback_outcome(&mut s, Err(e));
        let err = s.error.clone().unwrap_or_default();
        assert!(s.rolled_back, "the rig was rolled back");
        assert!(!err.contains("FAILED") && !err.contains("manually"), "{err}");
        assert!(!s.status.contains("failed"), "{}", s.status);
        assert!(err.contains(crate::history::ROLLBACK_UNRECORDED_LEAD), "{err}");
    }

    #[test]
    fn a_genuine_rollback_failure_still_reads_as_failed() {
        let mut s = TrialState::default();
        record_rollback_outcome(&mut s, Err("access denied".into()));
        assert!(!s.rolled_back);
        assert!(s.error.unwrap_or_default().contains("FAILED: access denied"));
        assert_eq!(s.status, "Rollback failed — see the Ledger.");
    }

    #[test]
    fn a_stack_with_failed_and_unrecorded_undos_reports_both() {
        // #631 review: the unrecorded rows still read "applied" in the ledger, so their message
        // must survive next to the genuine failures.
        let unrec = format!("{} (disk full).", crate::history::ROLLBACK_UNRECORDED_LEAD);
        let mut s = TrialState::default();
        record_stack_rollback_outcome(
            &mut s,
            vec![
                ("a".into(), Ok(())),
                ("b".into(), Err("access denied".into())),
                ("c".into(), Err(unrec.clone())),
            ],
        );
        let err = s.error.clone().unwrap_or_default();
        assert!(!s.rolled_back);
        assert!(err.contains("rolling 1 change(s) back FAILED: b: access denied"), "{err}");
        assert!(err.contains(&unrec), "{err}");
        assert!(!err.contains("c: "), "an unrecorded undo is not listed as failed: {err}");
    }

    #[test]
    fn a_stack_with_only_unrecorded_undos_is_rolled_back() {
        let unrec = format!("{} (disk full).", crate::history::ROLLBACK_UNRECORDED_LEAD);
        let mut s = TrialState::default();
        record_stack_rollback_outcome(&mut s, vec![("a".into(), Err(unrec.clone()))]);
        assert!(s.rolled_back);
        assert_eq!(s.error.as_deref(), Some(unrec.as_str()));
        assert!(!s.status.contains("failed"), "{}", s.status);
    }

    #[test]
    fn calibration_names_a_game_only_when_every_window_came_from_it() {
        let names = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(one_game(&names(&["wardogs.exe", "WARDOGS.exe"])).as_deref(), Some("wardogs.exe"));
        assert_eq!(one_game(&names(&["wardogs.exe", "cs2.exe"])), None, "the game changed mid-run");
        assert_eq!(one_game(&names(&["", ""])), None, "no game named");
        assert_eq!(one_game(&[]), None);
    }

    #[test]
    fn noise_is_zero_for_identical_windows() {
        let ws = vec![win(100.0), win(100.0), win(100.0)];
        assert_eq!(run_to_run_noise(&ws), Some(0.0));
    }

    #[test]
    fn noise_is_unmeasured_not_zero_when_it_cant_be_computed() {
        assert_eq!(run_to_run_noise(&[win(0.0), win(0.0), win(0.0)]), None, "no frame rate");
        assert_eq!(run_to_run_noise(&[win(100.0)]), None, "one window");
        assert_eq!(run_to_run_noise(&[]), None);
    }

    #[test]
    fn calibration_status_names_one_calibration_not_run_to_run() {
        let s = calibration_done_status(Some(2.04), 10);
        assert_eq!(
            s,
            "Calibration done — in one 25-second calibration on your PC, the 1% low varied by ±2.0%."
        );
        assert!(!s.contains("run-to-run"));
    }

    #[test]
    fn calibration_status_gives_the_real_reason_when_unmeasured() {
        let few = calibration_done_status(run_to_run_noise(&[win(100.0)]), 1);
        assert!(few.contains("fewer than two measurement windows"), "{few}");
        assert!(!few.contains("zero"), "{few}");
        let zero = calibration_done_status(run_to_run_noise(&[win(0.0), win(0.0)]), 2);
        assert!(zero.contains("read as zero"), "{zero}");
        assert!(!zero.contains("fewer than two"), "{zero}");
    }

    #[test]
    fn noise_grows_with_spread() {
        let tight = vec![win(99.0), win(100.0), win(101.0)];
        let loose = vec![win(70.0), win(100.0), win(130.0)];
        assert!(run_to_run_noise(&loose).unwrap() > run_to_run_noise(&tight).unwrap());
    }

    // ── §2a aggregate-stack A/B guards (mutation-gate item 7 + 8) ──

    #[test]
    fn stack_trial_ships_dark() {
        // The aggregate trial must be OFF until live QA + owner sign-off flips it deliberately.
        assert!(!stack_trial_gate(), "stack_trial_gate must ship false (dark)");
    }

    #[test]
    fn start_stack_trial_refuses_while_dark() {
        // With the gate dark, starting the trial is a no-op: it never sets the running "stack" state
        // and never touches the machine (the gate short-circuits before any state write or apply).
        start_stack_trial(vec![("game-mode".into(), "Game Mode".into())]);
        let s = trial_state();
        assert_ne!(s.kind, "stack", "dark stack trial must not enter the running state");
    }

    #[test]
    fn stack_trial_items_filters_to_the_batch_safe_subset() {
        let requested = vec![
            ("game-mode".to_string(), "Game Mode".to_string()),
            ("power-ultimate".to_string(), "Ultimate".to_string()), // refused by the batch → dropped
            ("not-a-real-rec".to_string(), "Bogus".to_string()),    // not appliable → dropped
            ("game-mode".to_string(), "Game Mode".to_string()),     // duplicate → dropped
            ("hags-enable".to_string(), "HAGS".to_string()),
        ];
        let items = stack_trial_items(&requested);
        let ids: Vec<&str> = items.iter().map(|i| i.rec_id.as_str()).collect();
        assert_eq!(ids, vec!["game-mode", "hags-enable"]);
    }

    #[test]
    fn stack_trial_items_empty_when_nothing_appliable() {
        let requested = vec![("power-ultimate".to_string(), "Ultimate".to_string())];
        assert!(stack_trial_items(&requested).is_empty());
    }
}
