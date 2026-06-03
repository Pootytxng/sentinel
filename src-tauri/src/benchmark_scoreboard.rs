//! Scoreboard / arcade layer [B] — the crowd-facing hook that sits on the verdict engine [A]
//! and can never contaminate it (spec: Verdict Engine + Competitive layer).
//!
//! THE FIREWALL (non-negotiable): this module DEPENDS ON the verdict engine — it reads a
//! [`Verdict`] and awards points ONLY on [`Verdict::Keep`]. It has **no path back into verdict
//! math**: no shared mutable state, no callback, nothing here is an input to [A]. The dependency
//! is one-directional and enforced by the module boundary — `award` takes a verdict in and
//! returns points out; that's the only seam, and `benchmark_verdict` never imports this module.
//!
//! Consequence (why this makes UserBenchmark's failure mode structurally impossible): chasing the
//! score IS improving real, *certified* 1% / 0.1% lows — the dopamine loop and the truth loop are
//! the same signal. `Inconclusive` and `Revert` award ZERO.
//!
//! Glass-box: every figure carries its provenance (the tweak's `rec_id` + the verdict's CI), so a
//! later Arcade/Lab UI can always drill a score down to its raw receipt.
#![allow(dead_code)] // [B] core: wired to commands + an Arcade/Lab UI in a later phase.

use crate::benchmark_verdict::Verdict;
use serde::Serialize;

/// Points scale with the certified improvement; capped so one tweak can't run away with the board.
const POINTS_PER_PCT: f64 = 10.0;
const MAX_POINTS_PER_AWARD: u32 = 1000;

/// Points + provenance for a single certified result. Every number traces back to the verdict's
/// CI and the tweak that earned it — no score without its receipt.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Award {
    pub points: u32,
    /// The tweak (rec_id) that earned it — the drill-down handle.
    pub rec_id: String,
    /// The certified metric, e.g. "1% low" / "0.1% low" — latency/consistency language, not avg FPS.
    pub metric: String,
    pub effect_pct: f64,
    pub ci_lo_pct: f64,
    pub ci_hi_pct: f64,
}

/// Award points for a verdict on a tweak. **Only `Keep` scores** — `Revert` and `Inconclusive`
/// earn nothing. This is the firewall in practice: the board can only ever reward a result the
/// engine certified.
pub(crate) fn award(rec_id: &str, verdict: &Verdict) -> Option<Award> {
    match verdict {
        Verdict::Keep { effect_pct, ci_lo_pct, ci_hi_pct, metric } => {
            let points = (effect_pct.max(0.0) * POINTS_PER_PCT).round() as u32;
            Some(Award {
                points: points.min(MAX_POINTS_PER_AWARD),
                rec_id: rec_id.to_string(),
                metric: metric.clone(),
                effect_pct: *effect_pct,
                ci_lo_pct: *ci_lo_pct,
                ci_hi_pct: *ci_hi_pct,
            })
        }
        // Never reward an uncertified result.
        Verdict::Revert { .. } | Verdict::Inconclusive { .. } => None,
    }
}

/// Percentile rank (0..=100) of `value` within a **like-to-like** cohort sample — the honest
/// "top X% for setups like yours" framing. Transparent + never vendor-weighted (the exact knob
/// UserBenchmark rigged). Uses mid-rank for ties. `None` if the cohort is empty.
pub(crate) fn percentile_rank(value: f64, cohort: &[f64]) -> Option<f64> {
    if cohort.is_empty() {
        return None;
    }
    let below = cohort.iter().filter(|&&x| x < value).count() as f64;
    let equal = cohort.iter().filter(|&&x| (x - value).abs() < f64::EPSILON).count() as f64;
    Some((below + equal / 2.0) / cohort.len() as f64 * 100.0)
}

/// Optimization-completeness (0..=100): how close the current measure is to the best the engine
/// has actually measured on THIS rig (`ceiling`) — self-improvement vs your own headroom, not a
/// peer/vendor number. Honest by construction.
pub(crate) fn completeness_pct(current: f64, ceiling: f64) -> f64 {
    if ceiling <= 0.0 {
        return 0.0;
    }
    (current / ceiling * 100.0).clamp(0.0, 100.0)
}

#[cfg(test)]
mod scoreboard_tests {
    use super::*;
    use crate::benchmark_verdict::InconclusiveReason;

    fn keep(effect: f64) -> Verdict {
        Verdict::Keep {
            effect_pct: effect,
            ci_lo_pct: effect - 1.0,
            ci_hi_pct: effect + 1.0,
            metric: "1% low".into(),
        }
    }

    #[test]
    fn only_keep_awards_points() {
        // The core invariant: a certified Keep scores; nothing else does.
        assert!(award("rec", &keep(8.0)).is_some());
        assert_eq!(
            award(
                "rec",
                &Verdict::Inconclusive { reason: InconclusiveReason::WithinNoise }
            ),
            None
        );
        assert_eq!(
            award(
                "rec",
                &Verdict::Revert { effect_pct: -9.0, ci_lo_pct: -11.0, ci_hi_pct: -7.0, metric: "0.1% low".into() }
            ),
            None
        );
    }

    #[test]
    fn within_noise_awards_zero() {
        // DoD invariant #1: a within-noise tweak → Inconclusive → zero points.
        let v = Verdict::Inconclusive { reason: InconclusiveReason::WithinNoise };
        assert!(award("rec", &v).is_none());
    }

    #[test]
    fn points_scale_and_cap() {
        assert_eq!(award("r", &keep(5.0)).unwrap().points, 50);
        assert_eq!(award("r", &keep(1000.0)).unwrap().points, MAX_POINTS_PER_AWARD);
    }

    #[test]
    fn award_carries_drilldown_receipt() {
        // DoD invariant #3: every gamified figure resolves to a raw CI + the tweak (rec_id).
        let a = award("disable-xyz", &keep(8.0)).unwrap();
        assert_eq!(a.rec_id, "disable-xyz");
        assert_eq!(a.metric, "1% low");
        assert!(a.ci_lo_pct < a.ci_hi_pct);
    }

    #[test]
    fn percentile_rank_is_like_to_like() {
        let cohort = [10.0, 20.0, 30.0, 40.0];
        assert_eq!(percentile_rank(25.0, &cohort), Some(50.0));
        assert_eq!(percentile_rank(45.0, &cohort), Some(100.0));
        assert_eq!(percentile_rank(5.0, &cohort), Some(0.0));
        assert_eq!(percentile_rank(1.0, &[]), None);
    }

    #[test]
    fn completeness_clamps() {
        assert_eq!(completeness_pct(90.0, 100.0), 90.0);
        assert_eq!(completeness_pct(120.0, 100.0), 100.0);
        assert_eq!(completeness_pct(50.0, 0.0), 0.0);
    }
}
