//! Stutter Forensics (Wave-2 #4): read-only correlation of a session's worst frametime dips against
//! signals observed during the session (process starts, RAM pressure, GPU clock drops). Emits AT MOST
//! ONE hedged insight — *"2 of your worst stutters lined up with OneDrive.exe starting"* — "lined up
//! with", NEVER "caused" — and stays silent when there's no clear pattern. Pure core, unit-tested.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

/// A timestamped signal observed during the session (collected read-only by the monitoring loop).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct StutterEvent {
    pub at_secs: u32,
    pub kind: String,  // "process-start" | "ram" | "gpu-clock"
    pub label: String, // ready-to-use phrase, e.g. "OneDrive.exe starting"
}

const DIP_FACTOR: f64 = 0.5; // a meaningful dip: 1% low below half the session median (≈ 2× frametime)
const DIP_FLOOR_MS: f64 = 12.0; // absolute floor (owner-tunable): a dip's worst-frametime must also
                                // exceed this, so high-fps variance (3→7 ms on a 400-fps title) that
                                // nobody felt can't manufacture a "dip".
const WINDOW_SECS: i64 = 2; // a signal "lines up" if within ±2 s of a dip
const MIN_LINEUP: usize = 2; // need ≥2 of the worst dips sharing a signal to claim a pattern
const WORST_N: usize = 3;
const MIN_TIMELINE: usize = 10; // too few samples → no judgment

/// Pure: take the worst dips (lowest 1% low, below the meaningful threshold) and look for a signal
/// that lines up with ≥2 of them. `timeline` = `(elapsed_secs, low1_fps)` per second. None = no
/// honest claim (too short, no meaningful dips, or no shared signal).
pub(crate) fn analyze(timeline: &[(u32, f64)], events: &[StutterEvent]) -> Option<String> {
    let mut lows: Vec<f64> = timeline.iter().map(|(_, l)| *l).filter(|l| *l > 0.0).collect();
    if lows.len() < MIN_TIMELINE {
        return None;
    }
    lows.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = lows[lows.len() / 2];
    if median <= 0.0 {
        return None;
    }
    // Worst dips: 1% low meaningfully below the session median, lowest first, capped at WORST_N.
    // A dip must be BOTH relatively bad (below half the median) AND absolutely felt (worst-frametime
    // over the floor, i.e. 1% low below 1000/floor fps).
    let floor_fps = 1000.0 / DIP_FLOOR_MS;
    let mut dips: Vec<(u32, f64)> = timeline
        .iter()
        .filter(|(_, l)| *l > 0.0 && *l < median * DIP_FACTOR && *l < floor_fps)
        .copied()
        .collect();
    dips.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    dips.truncate(WORST_N);
    if dips.len() < MIN_LINEUP {
        return None;
    }
    // For each dip, the distinct signal labels within the window (count each label once per dip).
    let mut counts: HashMap<String, usize> = HashMap::new();
    for (t, _) in &dips {
        let mut labels = HashSet::new();
        for e in events {
            if (e.at_secs as i64 - *t as i64).abs() <= WINDOW_SECS {
                labels.insert(e.label.clone());
            }
        }
        for l in labels {
            *counts.entry(l).or_insert(0) += 1;
        }
    }
    // Deterministic pick: highest count wins, ties broken by label (ascending). HashMap iteration
    // order is randomized per-run, so a bare `max_by_key` would name a DIFFERENT culprit across
    // restarts on the same input when two signals tie — the sort makes the same input always name
    // the same signal.
    let mut ranked: Vec<(String, usize)> = counts.into_iter().filter(|(_, c)| *c >= MIN_LINEUP).collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ranked
        .into_iter()
        .next()
        .map(|(label, count)| format!("{count} of your worst stutters lined up with {label}."))
}

#[cfg(test)]
mod stutter_tests {
    use super::*;

    fn ev(at: u32, label: &str) -> StutterEvent {
        StutterEvent { at_secs: at, kind: "process-start".into(), label: label.into() }
    }

    // A steady ~100-fps timeline with two deep dips (at 30 s and 60 s).
    fn timeline_with_dips() -> Vec<(u32, f64)> {
        let mut t: Vec<(u32, f64)> = (0..120).map(|s| (s, 100.0)).collect();
        t[30].1 = 20.0;
        t[60].1 = 18.0;
        t
    }

    #[test]
    fn lines_up_two_dips_with_the_same_signal() {
        let events = vec![ev(31, "OneDrive.exe starting"), ev(59, "OneDrive.exe starting")];
        let out = analyze(&timeline_with_dips(), &events).expect("a pattern");
        assert!(out.contains("OneDrive.exe starting"));
        assert!(out.contains("lined up with"));
        assert!(out.starts_with("2 "));
    }

    #[test]
    fn no_events_means_no_claim() {
        assert!(analyze(&timeline_with_dips(), &[]).is_none());
    }

    #[test]
    fn a_single_coincidence_is_not_a_pattern() {
        // Only one dip lines up → below MIN_LINEUP → silent (never manufacture a story).
        let events = vec![ev(31, "OneDrive.exe starting")];
        assert!(analyze(&timeline_with_dips(), &events).is_none());
    }

    #[test]
    fn too_short_a_session_is_silent() {
        let short: Vec<(u32, f64)> = (0..5).map(|s| (s, 100.0)).collect();
        assert!(analyze(&short, &[ev(1, "x"), ev(2, "x")]).is_none());
    }

    #[test]
    fn out_of_window_events_dont_count() {
        // Events 10 s away from the dips → no line-up.
        let events = vec![ev(15, "Steam.exe starting"), ev(45, "Steam.exe starting")];
        assert!(analyze(&timeline_with_dips(), &events).is_none());
    }

    #[test]
    fn high_fps_variance_below_the_floor_is_not_a_dip() {
        // 400-fps title dipping to 140 fps (~7 ms) — below half-median but ABOVE the 12 ms floor,
        // so nobody felt it. Even with lined-up events, no claim.
        let mut t: Vec<(u32, f64)> = (0..120).map(|s| (s, 400.0)).collect();
        t[30].1 = 140.0;
        t[60].1 = 140.0;
        let events = vec![ev(31, "OneDrive.exe starting"), ev(59, "OneDrive.exe starting")];
        assert!(analyze(&t, &events).is_none());
    }

    #[test]
    fn tied_signal_counts_break_deterministically_by_label() {
        // Two DIFFERENT signals each line up with both worst dips (tied count = 2). The pick must be
        // deterministic across runs (HashMap iteration order is randomized), broken by ascending
        // label — this pins the `ranked.sort_by` tie-break so it can't silently regress to
        // "whichever HashMap happened to iterate first" and name a different culprit each run.
        let events = vec![
            ev(31, "Zed.exe starting"),
            ev(59, "Zed.exe starting"),
            ev(31, "Alpha.exe starting"),
            ev(59, "Alpha.exe starting"),
        ];
        let out = analyze(&timeline_with_dips(), &events).expect("a pattern");
        assert!(
            out.contains("Alpha.exe starting"),
            "tie must break to the alphabetically-first label, got: {out}"
        );
        assert!(!out.contains("Zed.exe starting"));
    }
}
