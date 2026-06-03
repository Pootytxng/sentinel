//! Benchmark + Score engine (F6) — **PARKED + DARK**.
//!
//! Design: `docs/superpowers/specs/2026-06-02-benchmark-score-engine-design.md`.
//! Merge contract: `docs/BENCHMARK_INTEGRATION_PLAN.md` (HQ).
//!
//! This increment is the **pure score/standing core** only — types + a transparent,
//! data-driven scoring function + tests. It mutates nothing, runs nothing, and is
//! **not registered** in `lib.rs`'s `invoke_handler` (truly dark). The actual benchmark
//! workloads (CPU/RAM/disk runners) and the gated `benchmark_enabled()` command land in
//! later increments / at HQ integration. Honesty: every point traces to a real measured
//! component score or a real credited change — no fabricated number (spec §1, §2).
#![allow(dead_code)] // parked/dark: items are wired by HQ when the Benchmark tab lands.

use serde::{Deserialize, Serialize};

/// What the user cares about — weights the standing toward their goals (spec §4).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Intent {
    Fps,
    Latency,
    Smoothness,
    Thermals,
    Quality,
    PeaceOfMind,
}

impl Intent {
    const ALL: [Intent; 6] = [
        Intent::Fps,
        Intent::Latency,
        Intent::Smoothness,
        Intent::Thermals,
        Intent::Quality,
        Intent::PeaceOfMind,
    ];
}

/// A benchmarkable component.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Component {
    Cpu,
    Ram,
    Disk,
    Gpu,
}

/// Where a credited win came from — the "you + Sentinel, together" split (spec §4).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CreditSource {
    /// Applied a Sentinel recommendation that's still active.
    Guided,
    /// A good state the user achieved themselves (detected, not Sentinel-applied).
    SelfDirected,
}

/// A normalized per-component score from a benchmark run. `measured = false` means the
/// component couldn't be benchmarked this run — honest partial coverage, never a guess.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct ComponentScore {
    pub component: Component,
    /// 0..=100 normalized; only meaningful when `measured`.
    pub score: u32,
    pub measured: bool,
}

/// One credited win, traceable to a real applied change or a detected good state.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct Credit {
    pub id: String,
    pub label: String,
    pub points: i32,
    pub source: CreditSource,
    pub intents: Vec<Intent>,
}

/// Decoupled inputs to the pure scorer (assembled by the command wrapper at wire time).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub(crate) struct StandingInputs {
    pub components: Vec<ComponentScore>,
    pub credits: Vec<Credit>,
    pub selected_intents: Vec<Intent>,
    /// Last tier shown to the user, to detect crossings. `None` on first run.
    pub previous_tier: Option<u8>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct IntentScore {
    pub intent: Intent,
    pub points: i32,
}

#[derive(Serialize, Clone, Debug, Default)]
pub(crate) struct Breakdown {
    pub guided: i32,
    pub self_directed: i32,
    pub by_intent: Vec<IntentScore>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Direction {
    Up,
    Down,
}

/// Emitted **only on a tier crossing**, once per crossing — the seam the design lane
/// subscribes to for its single tasteful cosmetic shift (spec §5). The engine never
/// touches UI.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct SyncLevelEvent {
    pub from_level: u8,
    pub to_level: u8,
    pub direction: Direction,
    pub reason: String,
    pub intents_satisfied: Vec<Intent>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct Standing {
    pub score: u32,
    pub tier: u8,
    pub tier_name: &'static str,
    /// Points to the next tier, or `None` at the top tier.
    pub next_tier_delta: Option<u32>,
    pub breakdown: Breakdown,
    pub events: Vec<SyncLevelEvent>,
    /// Honest coverage: how many components were actually benchmarked.
    pub measured_components: usize,
    pub total_components: usize,
}

/// Tier thresholds as **data**, not magic numbers scattered in code (spec §5).
/// `(min_score_inclusive, placeholder_name)`. Names are placeholders — final naming is
/// the design lane's. (Continuity with the concept mockup: Dialed → Locked-In.)
const TIERS: &[(u32, &str)] = &[
    (0, "Booting"),
    (250, "Warming Up"),
    (500, "Dialed"),
    (750, "Locked-In"),
];

/// Map a score to `(1-based tier, name, points-to-next-tier)`.
fn tier_for(score: u32) -> (u8, &'static str, Option<u32>) {
    let mut idx = 0usize;
    for (i, (min, _)) in TIERS.iter().enumerate() {
        if score >= *min {
            idx = i;
        }
    }
    let name = TIERS[idx].1;
    let next_delta = TIERS.get(idx + 1).map(|(min, _)| min - score);
    ((idx as u8) + 1, name, next_delta)
}

/// Intent weight: a credit whose intents intersect the user's selected intents counts at
/// full weight; others at 0.75 — still real, just less emphasized. With no intents
/// selected, everything is full weight (universal / zero-setup, spec §4).
fn weight_for(credit_intents: &[Intent], selected: &[Intent]) -> f64 {
    if selected.is_empty() {
        return 1.0;
    }
    if credit_intents.iter().any(|i| selected.contains(i)) {
        1.0
    } else {
        0.75
    }
}

/// Pure, transparent scorer. Base comes from measured component scores; credits add real,
/// traceable points; intents weight them; tiers come from the data table; a crossing
/// vs `previous_tier` emits exactly one event. No hidden formula (spec §1, §4).
pub(crate) fn compute_standing(inputs: &StandingInputs) -> Standing {
    let total_components = inputs.components.len();
    let measured: Vec<u32> = inputs
        .components
        .iter()
        .filter(|c| c.measured)
        .map(|c| c.score)
        .collect();
    let measured_components = measured.len();

    // Base: average measured component score (0..=100) scaled into a 0..=600 band.
    let base: i32 = if measured.is_empty() {
        0
    } else {
        let avg = measured.iter().sum::<u32>() as f64 / measured.len() as f64;
        (avg * 6.0).round() as i32
    };

    let selected = &inputs.selected_intents;
    let mut guided = 0i32;
    let mut self_directed = 0i32;
    let mut credit_total = 0i32;
    for c in &inputs.credits {
        let pts = (c.points as f64 * weight_for(&c.intents, selected)).round() as i32;
        credit_total += pts;
        match c.source {
            CreditSource::Guided => guided += pts,
            CreditSource::SelfDirected => self_directed += pts,
        }
    }

    let by_intent: Vec<IntentScore> = Intent::ALL
        .iter()
        .filter_map(|intent| {
            let sum: i32 = inputs
                .credits
                .iter()
                .filter(|c| c.intents.contains(intent))
                .map(|c| (c.points as f64 * weight_for(&c.intents, selected)).round() as i32)
                .sum();
            (sum != 0).then_some(IntentScore { intent: *intent, points: sum })
        })
        .collect();

    let score = (base + credit_total).max(0) as u32;
    let (tier, tier_name, next_tier_delta) = tier_for(score);

    let mut events = Vec::new();
    if let Some(prev) = inputs.previous_tier {
        if tier != prev {
            let direction = if tier > prev { Direction::Up } else { Direction::Down };
            let reason = match direction {
                Direction::Up => format!("Crossed into tier {tier} — {tier_name}."),
                Direction::Down => {
                    format!("Dropped to tier {tier} — {tier_name} (a change was reverted).")
                }
            };
            events.push(SyncLevelEvent {
                from_level: prev,
                to_level: tier,
                direction,
                reason,
                intents_satisfied: by_intent.iter().map(|i| i.intent).collect(),
            });
        }
    }

    Standing {
        score,
        tier,
        tier_name,
        next_tier_delta,
        breakdown: Breakdown { guided, self_directed, by_intent },
        events,
        measured_components,
        total_components,
    }
}

#[cfg(test)]
mod benchmark_tests {
    use super::*;

    fn comp(component: Component, score: u32, measured: bool) -> ComponentScore {
        ComponentScore { component, score, measured }
    }
    fn credit(points: i32, source: CreditSource, intents: &[Intent]) -> Credit {
        Credit {
            id: "x".into(),
            label: "x".into(),
            points,
            source,
            intents: intents.to_vec(),
        }
    }
    fn intent_pts(s: &Standing, want: Intent) -> i32 {
        s.breakdown.by_intent.iter().find(|i| i.intent == want).map(|i| i.points).unwrap_or(0)
    }

    #[test]
    fn empty_inputs_degrade_gracefully() {
        let s = compute_standing(&StandingInputs::default());
        assert_eq!(s.score, 0);
        assert_eq!(s.tier, 1);
        assert_eq!(s.tier_name, "Booting");
        assert!(s.events.is_empty());
        assert_eq!(s.measured_components, 0);
    }

    #[test]
    fn base_comes_from_measured_components_only() {
        // One measured at 100, one unmeasured → avg of measured = 100 → base 600.
        let inputs = StandingInputs {
            components: vec![comp(Component::Cpu, 100, true), comp(Component::Gpu, 0, false)],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.score, 600);
        assert_eq!(s.tier, 3); // >=500 "Dialed"
        assert_eq!(s.tier_name, "Dialed");
        assert_eq!(s.measured_components, 1);
        assert_eq!(s.total_components, 2);
    }

    #[test]
    fn credits_split_guided_vs_self_directed() {
        let inputs = StandingInputs {
            credits: vec![
                credit(40, CreditSource::Guided, &[Intent::Latency]),
                credit(20, CreditSource::SelfDirected, &[Intent::Latency]),
            ],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.breakdown.guided, 40);
        assert_eq!(s.breakdown.self_directed, 20);
        assert_eq!(s.score, 60);
        assert_eq!(intent_pts(&s, Intent::Latency), 60);
    }

    #[test]
    fn selected_intents_weight_matching_credits_higher() {
        // Selected = Latency. Latency credit full; FPS credit at 0.75.
        let inputs = StandingInputs {
            credits: vec![
                credit(40, CreditSource::Guided, &[Intent::Latency]),
                credit(20, CreditSource::SelfDirected, &[Intent::Fps]),
            ],
            selected_intents: vec![Intent::Latency],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.breakdown.guided, 40);
        assert_eq!(s.breakdown.self_directed, 15); // round(20 * 0.75)
        assert_eq!(s.score, 55);
        assert_eq!(intent_pts(&s, Intent::Fps), 15);
    }

    #[test]
    fn tier_crossing_up_emits_one_up_event() {
        let inputs = StandingInputs {
            components: vec![comp(Component::Cpu, 100, true)], // base 600 → tier 3
            previous_tier: Some(2),
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.tier, 3);
        assert_eq!(s.events.len(), 1);
        assert_eq!(s.events[0].direction, Direction::Up);
        assert_eq!(s.events[0].from_level, 2);
        assert_eq!(s.events[0].to_level, 3);
    }

    #[test]
    fn tier_regression_emits_down_event() {
        // avg 50 → base 300 → tier 2; previously at tier 3.
        let inputs = StandingInputs {
            components: vec![comp(Component::Cpu, 50, true)],
            previous_tier: Some(3),
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.tier, 2);
        assert_eq!(s.events.len(), 1);
        assert_eq!(s.events[0].direction, Direction::Down);
        assert_eq!(s.events[0].from_level, 3);
        assert_eq!(s.events[0].to_level, 2);
    }

    #[test]
    fn no_event_when_tier_unchanged() {
        let inputs = StandingInputs {
            components: vec![comp(Component::Cpu, 100, true)], // tier 3
            previous_tier: Some(3),
            ..Default::default()
        };
        assert!(compute_standing(&inputs).events.is_empty());
    }

    #[test]
    fn peace_of_mind_path_scores_without_any_tweaks() {
        // No measured components, no applied tweaks — pure "we checked, you're good" credit.
        let inputs = StandingInputs {
            credits: vec![credit(80, CreditSource::SelfDirected, &[Intent::PeaceOfMind])],
            selected_intents: vec![Intent::PeaceOfMind],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.score, 80);
        assert_eq!(intent_pts(&s, Intent::PeaceOfMind), 80);
        assert_eq!(s.measured_components, 0); // climbed with zero benchmarked components
    }

    #[test]
    fn by_intent_omits_zero_intents() {
        let inputs = StandingInputs {
            credits: vec![credit(10, CreditSource::Guided, &[Intent::Thermals])],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        // Only Thermals should appear.
        assert_eq!(s.breakdown.by_intent.len(), 1);
        assert_eq!(s.breakdown.by_intent[0].intent, Intent::Thermals);
    }

    #[test]
    fn top_tier_has_no_next_delta() {
        let inputs = StandingInputs {
            credits: vec![credit(800, CreditSource::Guided, &[])],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.tier, 4);
        assert_eq!(s.tier_name, "Locked-In");
        assert!(s.next_tier_delta.is_none());
    }
}
