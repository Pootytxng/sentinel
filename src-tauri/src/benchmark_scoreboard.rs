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
use serde::{Deserialize, Serialize};

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
    // Fail SAFE on the honesty boundary (sibling of `benchmark::normalize`'s Inf→100 fix): the
    // `ceiling <= 0.0` gate alone does NOT catch a non-finite input (`NaN <= 0.0` is false, so a
    // NaN/Inf slips through). A non-finite `current` would otherwise `(Inf / ceiling * 100)
    // .clamp(0,100)` straight to 100 — a fabricated "fully optimized" score — and a `NaN` would
    // leak through the clamp untouched (clamp returns NaN for a NaN self). Never award
    // completeness we did not actually measure.
    if !current.is_finite() || !ceiling.is_finite() || ceiling <= 0.0 {
        return 0.0;
    }
    (current / ceiling * 100.0).clamp(0.0, 100.0)
}

// ── Verified-result ledger (persisted, local-only) ──────────────────────────
// Only `Keep` verdicts land here (the firewall in practice). Each entry keeps its full
// provenance — the tweak + the verdict's effect & CI — so the UI can always drill a score down to
// its receipt. The cross-user flywheel (network) is a separate opt-in, stubbed for now.

/// One certified win, persisted. Mirrors `Award` + a title for display and a timestamp.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct AwardEntry {
    pub points: u32,
    pub rec_id: String,
    pub rec_title: String,
    pub metric: String,
    pub effect_pct: f64,
    pub ci_lo_pct: f64,
    pub ci_hi_pct: f64,
    pub at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct ScoreStore {
    awards: Vec<AwardEntry>,
}

/// What the UI reads: total points + entries, newest first.
#[derive(Serialize, Clone, Debug, Default)]
pub(crate) struct ScoreboardView {
    pub total_points: u32,
    pub awards: Vec<AwardEntry>,
    /// A2 LOCAL display-only stub (parallel to `awards`, same order): each win's `effect_pct`
    /// ranked within the cohort of ALL the user's verified wins — an honest self-relative standing,
    /// NOT a peer/network percentile (that's Phase C, gated). `None` per entry until the cohort is
    /// large enough to rank meaningfully. Never persisted; recomputed on each read.
    pub local_percentiles: Vec<Option<f64>>,
}

/// Minimum verified wins before a LOCAL percentile is meaningful. Below this, ranking 1–3 results
/// is degenerate (a single win is trivially "50th percentile of itself"), so we surface nothing
/// rather than a number that overclaims significance.
const MIN_COHORT_FOR_PERCENTILE: usize = 4;

/// LOCAL, display-only (A2 stub): rank each award's `effect_pct` within the cohort of ALL the
/// user's verified wins. Honest self-relative standing — there is NO peer/network cohort yet
/// (Phase C, gated), so "percentile" here means *among your own results*. Returns a vec parallel to
/// `awards` (same length, same order); every entry is `None` until the cohort clears the floor.
fn local_win_percentiles(awards: &[AwardEntry]) -> Vec<Option<f64>> {
    if awards.len() < MIN_COHORT_FOR_PERCENTILE {
        return vec![None; awards.len()];
    }
    let cohort: Vec<f64> = awards.iter().map(|a| a.effect_pct).collect();
    awards.iter().map(|a| percentile_rank(a.effect_pct, &cohort)).collect()
}

fn store_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("scoreboard.json")
}

fn load_store() -> ScoreStore {
    std::fs::read_to_string(store_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_store(store: &ScoreStore) -> Result<(), String> {
    std::fs::create_dir_all(crate::compy_data_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(store_path(), json).map_err(|e| e.to_string())
}

/// Record a trial's result. Only a certified `Keep` earns a ledger entry (the firewall); anything
/// else is a no-op returning `None`. Returns the entry on success.
pub(crate) fn record_result(rec_id: &str, rec_title: &str, verdict: &Verdict) -> Option<AwardEntry> {
    let a = award(rec_id, verdict)?;
    let entry = AwardEntry {
        points: a.points,
        rec_id: a.rec_id,
        rec_title: rec_title.to_string(),
        metric: a.metric,
        effect_pct: a.effect_pct,
        ci_lo_pct: a.ci_lo_pct,
        ci_hi_pct: a.ci_hi_pct,
        at: chrono::Utc::now().to_rfc3339(),
    };
    let mut store = load_store();
    store.awards.push(entry.clone());
    let _ = save_store(&store);
    Some(entry)
}

pub(crate) fn scoreboard() -> ScoreboardView {
    let store = load_store();
    let total_points = store.awards.iter().map(|a| a.points).sum();
    let mut awards = store.awards;
    awards.reverse(); // newest first
    let local_percentiles = local_win_percentiles(&awards);
    ScoreboardView { total_points, awards, local_percentiles }
}

pub(crate) fn clear_scoreboard() -> Result<(), String> {
    save_store(&ScoreStore::default())
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

    // ── percentile_rank: appended coverage ──────────────────────────────────
    // Pins the exact mid-rank-for-ties behavior + the 0..=100 output range.

    #[test]
    fn percentile_rank_empty_cohort_is_none() {
        // An empty cohort has no peers to rank against → None (the documented contract).
        assert_eq!(percentile_rank(42.0, &[]), None);
        // Holds regardless of the value (incl. 0.0 / negatives).
        assert_eq!(percentile_rank(0.0, &[]), None);
        assert_eq!(percentile_rank(-5.0, &[]), None);
    }

    #[test]
    fn percentile_rank_single_element_cohort() {
        let cohort = [10.0];
        // Below the only member: below=0, equal=0 → 0.0.
        assert_eq!(percentile_rank(5.0, &cohort), Some(0.0));
        // Equal to the only member: mid-rank → (0 + 1/2) / 1 * 100 = 50.0.
        assert_eq!(percentile_rank(10.0, &cohort), Some(50.0));
        // Above the only member: below=1 → 100.0.
        assert_eq!(percentile_rank(15.0, &cohort), Some(100.0));
    }

    #[test]
    fn percentile_rank_below_all_is_zero() {
        let cohort = [10.0, 20.0, 30.0, 40.0];
        // Nothing is < value and nothing equals it → floor of the range.
        assert_eq!(percentile_rank(1.0, &cohort), Some(0.0));
    }

    #[test]
    fn percentile_rank_above_all_is_hundred() {
        let cohort = [10.0, 20.0, 30.0, 40.0];
        // Every member is strictly below → ceiling of the range.
        assert_eq!(percentile_rank(100.0, &cohort), Some(100.0));
    }

    #[test]
    fn percentile_rank_equal_to_a_member_uses_mid_rank() {
        let cohort = [10.0, 20.0, 30.0, 40.0];
        // value == 20.0: below = {10} = 1, equal = {20} = 1 → (1 + 1/2) / 4 * 100 = 37.5.
        let r = percentile_rank(20.0, &cohort).unwrap();
        assert!((r - 37.5).abs() < 1e-9, "expected 37.5, got {r}");
    }

    #[test]
    fn percentile_rank_middle_value_counts_strictly_below() {
        let cohort = [10.0, 20.0, 30.0, 40.0];
        // value == 25.0 (no exact tie): below = {10,20} = 2, equal = 0 → 2/4 * 100 = 50.0.
        let r = percentile_rank(25.0, &cohort).unwrap();
        assert!((r - 50.0).abs() < 1e-9, "expected 50.0, got {r}");
    }

    #[test]
    fn percentile_rank_ties_average_their_rank() {
        // Multiple exact ties: mid-rank splits the tied block in half.
        let cohort = [10.0, 20.0, 20.0, 20.0, 30.0];
        // value == 20.0: below = {10} = 1, equal = 3 → (1 + 3/2) / 5 * 100 = 50.0.
        let r = percentile_rank(20.0, &cohort).unwrap();
        assert!((r - 50.0).abs() < 1e-9, "expected 50.0, got {r}");
    }

    #[test]
    fn percentile_rank_stays_within_zero_to_hundred() {
        // Range guard over a spread of probe values against a fixed cohort.
        let cohort = [10.0, 20.0, 30.0, 40.0];
        for v in [-100.0, 0.0, 10.0, 25.0, 40.0, 1000.0] {
            let r = percentile_rank(v, &cohort).unwrap();
            assert!((0.0..=100.0).contains(&r), "rank {r} out of range for value {v}");
        }
    }

    // ── local_win_percentiles (A2 display-only stub) ─────────────────────────
    // Pins the cohort floor (degenerate small samples show nothing), the parallel-length
    // invariant, and the in-range self-relative standing. NO peer cohort is involved — this
    // ranks the user's own wins against each other.

    fn entry(effect: f64) -> AwardEntry {
        AwardEntry {
            points: (effect * POINTS_PER_PCT) as u32,
            rec_id: "rec".into(),
            rec_title: "Rec".into(),
            metric: "1% low".into(),
            effect_pct: effect,
            ci_lo_pct: effect - 1.0,
            ci_hi_pct: effect + 1.0,
            at: "2026-06-25T00:00:00Z".into(),
        }
    }

    #[test]
    fn local_percentiles_empty_for_too_few_wins() {
        // Below the cohort floor → every entry is None (we show nothing, never a degenerate rank).
        for n in 0..MIN_COHORT_FOR_PERCENTILE {
            let awards: Vec<AwardEntry> = (0..n).map(|i| entry(i as f64 + 1.0)).collect();
            let pcts = local_win_percentiles(&awards);
            assert_eq!(pcts.len(), n, "length must mirror awards for n={n}");
            assert!(pcts.iter().all(|p| p.is_none()), "expected all-None for n={n}");
        }
    }

    #[test]
    fn local_percentiles_rank_within_own_wins_at_floor() {
        // At the floor (4 wins, distinct effects) every entry gets a Some standing, parallel to
        // awards and in 0..=100. Self-inclusive mid-rank → strongest ≈ 87.5, weakest ≈ 12.5.
        let awards = vec![entry(2.0), entry(4.0), entry(6.0), entry(8.0)];
        let pcts = local_win_percentiles(&awards);
        assert_eq!(pcts.len(), awards.len());
        assert!(pcts.iter().all(|p| p.is_some()));
        for p in &pcts {
            let v = p.unwrap();
            assert!((0.0..=100.0).contains(&v), "rank {v} out of range");
        }
        // Order follows the awards' effects: weakest entry ranks lowest, strongest highest.
        assert!((pcts[0].unwrap() - 12.5).abs() < 1e-9, "weakest got {:?}", pcts[0]);
        assert!((pcts[3].unwrap() - 87.5).abs() < 1e-9, "strongest got {:?}", pcts[3]);
        assert!(pcts[0].unwrap() < pcts[3].unwrap());
    }

    #[test]
    fn local_percentiles_align_to_award_order() {
        // The vec is strictly parallel to `awards` — index i is award i's standing, whatever the
        // ordering. A higher effect at any position must carry a higher percentile.
        let awards = vec![entry(9.0), entry(1.0), entry(5.0), entry(7.0), entry(3.0)];
        let pcts = local_win_percentiles(&awards);
        assert_eq!(pcts.len(), 5);
        // award[0]=9.0 is the strongest → top rank; award[1]=1.0 the weakest → bottom rank.
        assert!(pcts[0].unwrap() > pcts[3].unwrap()); // 9.0 > 7.0
        assert!(pcts[1].unwrap() < pcts[4].unwrap()); // 1.0 < 3.0
    }

    // ── completeness_pct: appended coverage ─────────────────────────────────
    // Pins the div-by-zero guard, the 0..=100 clamp, and the boundary values.

    #[test]
    fn completeness_pct_ceiling_zero_is_zero_not_nan() {
        // FINDING-guard: ceiling <= 0 short-circuits to 0.0 BEFORE the division,
        // so there is no div-by-zero → no NaN/Inf escapes. Verify reality, both
        // current=0 (0/0) and current>0 (x/0) cases that would otherwise be NaN/Inf.
        let z = completeness_pct(0.0, 0.0);
        assert_eq!(z, 0.0);
        assert!(!z.is_nan() && z.is_finite());
        let p = completeness_pct(50.0, 0.0);
        assert_eq!(p, 0.0);
        assert!(!p.is_nan() && p.is_finite());
    }

    #[test]
    fn completeness_pct_negative_ceiling_is_zero() {
        // The guard is `ceiling <= 0.0`, so a negative ceiling also yields 0.0
        // (never a negative-then-clamped path).
        assert_eq!(completeness_pct(50.0, -100.0), 0.0);
    }

    #[test]
    fn completeness_pct_current_zero_is_zero() {
        // No progress against a real ceiling → 0%.
        assert_eq!(completeness_pct(0.0, 200.0), 0.0);
    }

    #[test]
    fn completeness_pct_at_ceiling_is_hundred() {
        // Exactly at the measured ceiling → fully optimized, 100%.
        assert_eq!(completeness_pct(150.0, 150.0), 100.0);
    }

    #[test]
    fn completeness_pct_above_ceiling_caps_at_hundred() {
        // Beat the prior best → still capped at 100 (no overflow past full).
        assert_eq!(completeness_pct(500.0, 150.0), 100.0);
    }

    #[test]
    fn completeness_pct_normal_mid_value() {
        // A representative in-range value reports its straight ratio.
        let r = completeness_pct(75.0, 150.0);
        assert!((r - 50.0).abs() < 1e-9, "expected 50.0, got {r}");
    }

    #[test]
    fn completeness_pct_negative_current_clamps_to_zero() {
        // A negative current (with a positive ceiling) clamps up to the 0.0 floor.
        assert_eq!(completeness_pct(-30.0, 150.0), 0.0);
    }

    #[test]
    fn completeness_pct_non_finite_fails_safe_to_zero() {
        // bug→guard (sibling of `benchmark::normalize`'s Inf→100 honesty hazard): a non-finite
        // input must NEVER fabricate a "fully optimized" score. The `ceiling <= 0.0` gate does
        // NOT catch these (NaN <= 0.0 is false), so the point-of-use is_finite check is what
        // closes the class. The two real pre-fix leaks were `+Inf current → 100` (fabricated
        // perfect) and `NaN → NaN` (leaked through clamp); the others were already safe but are
        // pinned here so the whole boundary stays honest.
        assert_eq!(completeness_pct(f64::INFINITY, 150.0), 0.0); // was 100.0 (fabricated perfect)
        assert_eq!(completeness_pct(f64::NAN, 150.0), 0.0); // was NaN (leaked through clamp)
        assert_eq!(completeness_pct(f64::NEG_INFINITY, 150.0), 0.0);
        assert_eq!(completeness_pct(50.0, f64::NAN), 0.0); // was NaN (leaked through clamp)
        assert_eq!(completeness_pct(50.0, f64::INFINITY), 0.0);
    }
}
