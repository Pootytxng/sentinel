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
//! NEXT (not shipped): the tweak A-B trial applies a real change then rolls it back to measure it.
//! That mutates the machine, so it gets its own careful build (a Drop-guard guaranteeing rollback
//! on any exit/panic) + live validation — deliberately not shipped unverified here.
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
            let windows = collect_windows(PER_SIDE * 2, "Calibrating");
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
            set(|s| {
                s.running = false;
                s.verdict = Some(verdict);
                s.noise_floor_pct = Some(noise);
                s.status = format!("Calibration done — your rig varies ≈ ±{noise:.1}% run-to-run.");
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
            match crate::history::rollback_change(id) {
                Ok(()) => set(|s| {
                    s.rolled_back = true;
                    s.status = "Done — change measured and rolled back.".into();
                }),
                Err(e) => set(|s| {
                    s.rolled_back = false;
                    s.error = Some(format!(
                        "Measurement finished, but rolling the change back FAILED: {e}. Undo it \
                         manually in the Trust Ledger."
                    ));
                    s.status = "Rollback failed — see the Ledger.".into();
                }),
            }
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
            let view = match crate::history::apply_recommendation(rec_id.clone(), rec_title) {
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
                    s.running = false;
                    s.status = "No frames.".into();
                    s.error = Some("Couldn't collect frames with the change on.".into());
                });
                return; // _guard rolls back
            }

            // 5. Verdict, then roll back (the guard, on drop).
            let verdict = Trial { baseline, treatment }.verdict();
            set(|s| {
                s.running = false;
                s.verdict = Some(verdict);
                s.status = "Rolling the change back…".into();
            });
            // _guard drops here → rollback finalizes the status / surfaces any rollback failure.
        });
}

/// Collect `n` window snapshots from the live frametime stream, `WINDOW_INTERVAL` apart. Returns
/// fewer if the game stops presenting or the run is cancelled.
fn collect_windows(n: usize, label: &str) -> Vec<MetricWindow> {
    let mut out = Vec::new();
    let mut misses = 0usize;
    while out.len() < n {
        if cancel_flag().load(Ordering::Relaxed) {
            break;
        }
        std::thread::sleep(WINDOW_INTERVAL);
        if let Some((_proc, ft)) = crate::monitoring::latest_frametimes() {
            if let Some(w) = MetricWindow::from_frametimes(&ft, WindowCtx::default()) {
                out.push(w);
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
    out
}

/// Run-to-run noise = coefficient of variation (%) of the 1% lows across the captured windows.
fn run_to_run_noise(windows: &[MetricWindow]) -> f64 {
    let xs: Vec<f64> = windows.iter().map(|w| w.p1_low_fps).collect();
    if xs.len() < 2 {
        return 0.0;
    }
    let mean = xs.iter().sum::<f64>() / xs.len() as f64;
    if mean <= 0.0 {
        return 0.0;
    }
    let var = xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (xs.len() - 1) as f64;
    var.sqrt() / mean * 100.0
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
    fn noise_is_zero_for_identical_windows() {
        let ws = vec![win(100.0), win(100.0), win(100.0)];
        assert_eq!(run_to_run_noise(&ws), 0.0);
    }

    #[test]
    fn noise_grows_with_spread() {
        let tight = vec![win(99.0), win(100.0), win(101.0)];
        let loose = vec![win(70.0), win(100.0), win(130.0)];
        assert!(run_to_run_noise(&loose) > run_to_run_noise(&tight));
    }
}
