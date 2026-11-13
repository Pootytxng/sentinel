// component_evidence.rs — Intelligence Phase 4 (§4H, the hardware-twin spine): component-level
// evidence attribution. READ-ONLY.
//
// The directive's §4H twin: "every visible component should act as an index into its own state —
// active hypotheses, health, the next test. Every highlight must communicate real state. No
// decorative component glow without meaning… a component stays neutral when evidence is absent."
//
// This module is a PROJECTION, not a new detector. It re-keys the existing Intelligence Phase 2
// pattern findings (intelligence_patterns::detect_patterns) BY the hardware component each names.
// It invents no evidence and reaches no conclusion the Patterns tile doesn't already show: a
// component can light up ONLY if a real pattern implicates it, at that pattern's own confidence
// band. Absent evidence ⇒ the component is absent from the report ⇒ its card renders exactly as
// before (honest neutral). Same fetch surface as get_intelligence_patterns — zero mutation, zero
// network, nothing written.
//
// Honesty rails (§1, §5G):
//   • Only the detectors that name ONE physical component attribute to it — thermal-trend → GPU,
//     driver-split → GPU, memory-trend → memory. System-wide / game-side symptoms
//     (performance-trend, session-fade, multi-game-degradation, isolated-degradation,
//     gaming-mode-split) implicate NO single component: lighting a card off a general FPS decline
//     would be fabricating attribution (correlation ≠ causation). That restraint IS the feature.
//   • Confidence is INHERITED, never bumped: a component's band = the MAX band of the patterns
//     implicating it. Passive patterns are already capped at Medium upstream, so a component never
//     reads High — only a controlled experiment (the Lab) could earn that.
//   • Reasons are the source patterns' own plain-language findings — nothing synthesized.
//   • Provenance is inspectable: every entry carries the detector ids that implicated it.

use serde::Serialize;

use crate::intelligence::Confidence;
use crate::intelligence_patterns::{detect_patterns, PatternReport, SessionPattern};

/// A hardware component the twin can highlight. Kebab serialization matches the frontend
/// HardwareGrid card mapping (`gpu` → Graphics card, `memory` → Memory card). Deliberately only
/// the components a detector can honestly name today are modelled — there is no "cooling" bucket
/// (no detector measures a fan/cooler in isolation → nothing to attribute). The enum GROWS as
/// detectors that can name a new component are added; it never carries a variant we don't emit.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ComponentKind {
    Memory,
    Gpu,
}

impl ComponentKind {
    /// Plain-English possessive noun for the headline. User-facing, non-technical (§7 language).
    fn noun(self) -> &'static str {
        match self {
            ComponentKind::Memory => "your memory",
            ComponentKind::Gpu => "your graphics card",
        }
    }
}

/// One implicated component's evidence bundle — the "index" the twin lights the card with.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct ComponentEvidence {
    pub component: ComponentKind,
    /// Inherited band (MAX of the implicating patterns). Never bumped, never numeric.
    pub confidence: Confidence,
    /// One at-a-glance line: why this component is highlighted. Non-causal ("involves").
    pub headline: String,
    /// The implicating patterns' own findings, in detection order — nothing synthesized.
    pub reasons: Vec<String>,
    /// What would make the picture clearer (from the strongest pattern that offers a next test).
    pub next_test: Option<String>,
    /// Detector ids that implicated this component — inspectable provenance.
    pub sources: Vec<String>,
}

/// The per-component evidence report. `components` holds ONLY implicated components in a fixed,
/// deterministic order; empty ⇒ every card renders neutral (the common, honest case).
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub(crate) struct ComponentEvidenceReport {
    pub components: Vec<ComponentEvidence>,
    /// Passed through from the pattern report — lets a surface tell "no sessions yet" from
    /// "sessions exist but nothing implicates a component" (both render neutral, but honestly so).
    pub sessions_considered: usize,
}

/// Map a detector to the ONE physical component it unambiguously names, or `None` if it names
/// none. This match IS the entire honesty surface: only ids that implicate a single component
/// appear here — everything else stays neutral (no fabricated attribution).
fn component_for(pattern: &SessionPattern) -> Option<ComponentKind> {
    match pattern.id.as_str() {
        "thermal-trend" => Some(ComponentKind::Gpu), // peak GPU temperature trend
        "driver-split" => Some(ComponentKind::Gpu),  // GPU-driver-version split
        "memory-trend" => Some(ComponentKind::Memory), // peak RAM-pressure trend
        _ => None,
    }
}

fn headline(kind: ComponentKind, count: usize) -> String {
    let noun = kind.noun();
    if count == 1 {
        format!("A measured session pattern involves {noun}.")
    } else {
        format!("{count} measured session patterns involve {noun}.")
    }
}

/// Project the detected patterns onto the components they name. Pure + deterministic: same
/// patterns (in any order) → same report. This is the whole engine — no I/O, no clock.
pub(crate) fn attribute(report: &PatternReport) -> ComponentEvidenceReport {
    let mut components: Vec<ComponentEvidence> = Vec::new();

    // Fixed component order → output is stable regardless of the order patterns arrived in
    // (mirrors the order-independence guard on the detectors themselves).
    for kind in [ComponentKind::Memory, ComponentKind::Gpu] {
        let implicating: Vec<&SessionPattern> = report
            .patterns
            .iter()
            .filter(|p| component_for(p) == Some(kind))
            .collect();
        if implicating.is_empty() {
            continue; // no evidence → never emitted → the card stays neutral
        }

        // Inherited band — the strongest implicating pattern. Confidence derives Ord
        // (Unknown < Low < Medium < High); passive patterns cap at Medium upstream, so this
        // can never fabricate a High.
        let confidence = implicating
            .iter()
            .map(|p| p.confidence)
            .max()
            .unwrap_or(Confidence::Unknown);

        // Reasons = each implicating pattern's own plain-language finding, verbatim.
        let reasons: Vec<String> = implicating.iter().map(|p| p.detail.clone()).collect();

        // Next test: prefer one from a pattern at the winning band (stable tie-break = detection
        // order); fall back to any implicating pattern that offers one.
        let next_test = implicating
            .iter()
            .filter(|p| p.confidence == confidence)
            .find_map(|p| p.next_test.clone())
            .or_else(|| implicating.iter().find_map(|p| p.next_test.clone()));

        let sources: Vec<String> = implicating.iter().map(|p| p.id.clone()).collect();

        components.push(ComponentEvidence {
            component: kind,
            confidence,
            headline: headline(kind, implicating.len()),
            reasons,
            next_test,
            sources,
        });
    }

    ComponentEvidenceReport {
        components,
        sessions_considered: report.sessions_considered,
    }
}

// ─── Command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn get_component_evidence() -> ComponentEvidenceReport {
    let sessions = crate::sessions::get_session_summaries();
    attribute(&detect_patterns(&sessions, &|s| crate::experiment::measured_noise_at(&sessions, s).map(|n| n.low1_band_pct)))
}

// ─── Guard tests (§5G anti-fabrication) ──────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_pattern(id: &str, confidence: Confidence, detail: &str, next_test: Option<&str>) -> SessionPattern {
        SessionPattern {
            id: id.into(),
            game: None,
            title: format!("{id} title"),
            detail: detail.into(),
            confidence,
            confidence_reason: "reason".into(),
            supporting_evidence: vec![],
            raises_confidence: vec![],
            next_test: next_test.map(|s| s.into()),
        }
    }

    fn report(patterns: Vec<SessionPattern>, sessions: usize) -> PatternReport {
        PatternReport {
            patterns,
            coverage: vec![],
            sessions_considered: sessions,
            games_considered: 0,
        }
    }

    #[test]
    fn empty_patterns_yield_no_components_but_pass_through_the_count() {
        let out = attribute(&report(vec![], 7));
        assert!(out.components.is_empty(), "no patterns ⇒ every card neutral");
        assert_eq!(out.sessions_considered, 7, "count passes through honestly");
    }

    #[test]
    fn system_and_game_symptoms_implicate_no_component() {
        // Correlation ≠ causation: a general FPS decline must NOT light a single hardware card.
        let out = attribute(&report(
            vec![
                mk_pattern("performance-trend", Confidence::Medium, "1% lows drifting down", None),
                mk_pattern("session-fade", Confidence::Low, "fps fades within a session", None),
                mk_pattern("multi-game-degradation", Confidence::Medium, "slower across games", None),
                mk_pattern("isolated-degradation", Confidence::Low, "one game slower", None),
                mk_pattern("gaming-mode-split", Confidence::Medium, "mode split", None),
            ],
            9,
        ));
        assert!(out.components.is_empty(), "system/game symptoms attribute to no component");
    }

    #[test]
    fn component_naming_detectors_map_to_the_right_card() {
        let out = attribute(&report(
            vec![
                mk_pattern("thermal-trend", Confidence::Low, "peak GPU temp trending up", None),
                mk_pattern("memory-trend", Confidence::Low, "peak RAM pressure trending up", None),
            ],
            6,
        ));
        let kinds: Vec<ComponentKind> = out.components.iter().map(|c| c.component).collect();
        assert_eq!(kinds, vec![ComponentKind::Memory, ComponentKind::Gpu], "deterministic order, right cards");
    }

    #[test]
    fn driver_split_also_lands_on_the_gpu() {
        let out = attribute(&report(
            vec![mk_pattern("driver-split", Confidence::Medium, "faster after the driver update", None)],
            5,
        ));
        assert_eq!(out.components.len(), 1);
        assert_eq!(out.components[0].component, ComponentKind::Gpu);
    }

    #[test]
    fn same_component_merges_and_inherits_the_max_band() {
        // Two GPU patterns (thermal Low + driver Medium) → ONE GPU entry at Medium, both reasons.
        let out = attribute(&report(
            vec![
                mk_pattern("thermal-trend", Confidence::Low, "peak GPU temp trending up", None),
                mk_pattern("driver-split", Confidence::Medium, "faster after the driver update", None),
            ],
            8,
        ));
        assert_eq!(out.components.len(), 1, "same component merges to one entry");
        let gpu = &out.components[0];
        assert_eq!(gpu.component, ComponentKind::Gpu);
        assert_eq!(gpu.confidence, Confidence::Medium, "inherits the strongest band, never bumped");
        assert_eq!(gpu.reasons.len(), 2, "both findings kept");
        assert_eq!(gpu.sources, vec!["thermal-trend".to_string(), "driver-split".to_string()]);
    }

    #[test]
    fn confidence_equals_the_source_max_and_never_reaches_high() {
        // Passive patterns cap at Medium upstream — this asserts the projection never invents a High.
        for band in [Confidence::Low, Confidence::Medium] {
            let out = attribute(&report(vec![mk_pattern("memory-trend", band, "ram pressure", None)], 5));
            assert_eq!(out.components[0].confidence, band, "band inherited exactly");
            assert!(out.components[0].confidence < Confidence::High, "ambient attribution never reads High");
        }
    }

    #[test]
    fn reasons_are_the_source_details_verbatim_nothing_synthesized() {
        let out = attribute(&report(
            vec![mk_pattern("thermal-trend", Confidence::Low, "peak GPU temp rose 6°C over 8 sessions", None)],
            8,
        ));
        assert_eq!(out.components[0].reasons, vec!["peak GPU temp rose 6°C over 8 sessions".to_string()]);
    }

    #[test]
    fn next_test_prefers_a_pattern_at_the_winning_band() {
        // GPU: driver-split (Medium, next_test A) + thermal-trend (Low, next_test B) → A wins.
        let out = attribute(&report(
            vec![
                mk_pattern("thermal-trend", Confidence::Low, "temp trend", Some("watch temps in a Lab run")),
                mk_pattern("driver-split", Confidence::Medium, "driver split", Some("re-run the same game after a driver change")),
            ],
            8,
        ));
        assert_eq!(
            out.components[0].next_test.as_deref(),
            Some("re-run the same game after a driver change"),
            "next test comes from the highest-band pattern",
        );
    }

    #[test]
    fn every_emitted_entry_has_non_empty_provenance() {
        let out = attribute(&report(
            vec![
                mk_pattern("thermal-trend", Confidence::Low, "temp", None),
                mk_pattern("memory-trend", Confidence::Medium, "ram", None),
            ],
            8,
        ));
        assert_eq!(out.components.len(), 2);
        for c in &out.components {
            assert!(!c.sources.is_empty(), "no orphan evidence — every entry names its detectors");
            assert!(!c.headline.is_empty());
        }
    }

    #[test]
    fn component_set_and_bands_are_order_independent() {
        // The component set + inherited bands must not depend on the order patterns arrived in.
        // (Reason/source order WITHIN a merged entry follows detection order, which is itself
        // deterministic upstream — so the stable invariant to pin is the (component, band) set.)
        let patterns = vec![
            mk_pattern("thermal-trend", Confidence::Low, "temp", Some("t")),
            mk_pattern("driver-split", Confidence::Medium, "driver", Some("d")),
            mk_pattern("memory-trend", Confidence::Low, "ram", None),
        ];
        let mut reversed = patterns.clone();
        reversed.reverse();

        let bands = |r: &ComponentEvidenceReport| -> Vec<(ComponentKind, Confidence)> {
            r.components.iter().map(|c| (c.component, c.confidence)).collect()
        };
        assert_eq!(
            bands(&attribute(&report(patterns, 8))),
            bands(&attribute(&report(reversed, 8))),
            "component set + inherited bands are order-independent",
        );
    }
}
