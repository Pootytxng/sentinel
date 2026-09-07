//! Shared Machine Model v1 — Roadmap Phase 2 (issue #385).
//!
//! **READ-ONLY COMPOSITION.** This module owns no data and produces no facts of its own. It reads
//! what the existing canonical producers already recorded, wraps each material fact in an envelope
//! that says where the fact came from and how fresh it is, and answers four questions in ONE value
//! that both flagship journeys can consume:
//!
//! 1. What machine is this?          → [`MachineIdentity`]
//! 2. What recently changed?         → [`ChangeChronology`]
//! 3. What did Compy change?         → [`CompyChangeTruth`]
//! 4. What evidence can we trust?    → [`EvidenceSummary`]
//!
//! MACHINE_MODEL.md §8 is the load-bearing rule here: each material fact keeps ONE canonical
//! producer. This module is deliberately not a new one. It probes nothing, persists nothing,
//! opens no network path, and touches no mutation boundary — [`compose`] is a pure function of
//! borrowed inputs, which is what makes that claim testable rather than merely stated.
//!
//! It also does NOT replace the domain vocabularies that already exist. The six [`EvidenceClass`]
//! values are MACHINE_MODEL.md §3's own list; where a producer has its own word for a fact's state
//! (the Trust Ledger's `"applied"` / `"rolled_back"`, its `provenance` tag), that word rides along
//! verbatim in [`DomainVocabulary`] instead of being collapsed into the model's class.

use serde::Serialize;

use crate::hardware::{HardwareInfo, HwFingerprint};
use crate::history::AppliedChangeView;
use crate::hwchange::HardwareFingerprint;
use crate::intelligence::{EventScope, IdentitySnapshot};

/// Bumped only when a consumer would read an existing field differently.
pub(crate) const SCHEMA_VERSION: u32 = 1;

/// Chronology entries returned. Bounded on purpose — MACHINE_MODEL.md §9 forbids turning the model
/// into a telemetry lake, and a consumer that needs the full history reads the timeline directly.
const MAX_CHRONOLOGY: usize = 25;
/// Compy-change rows returned. Same bound, same reason. The COUNTS above them are never truncated.
const MAX_CHANGES: usize = 25;

// ─── Evidence vocabulary (MACHINE_MODEL.md §3) ───────────────────────────

/// The six evidence classes, and only those six. This does NOT replace `intelligence::Confidence`,
/// `recommendations::Provenance`, `benchmark::RunConfidence`, `readiness::ReadinessStatus`,
/// `comparability::Comparability`, `priorities::Confidence` or `blackbox::Strength` — each of those
/// keeps its own domain meaning at its own call sites. This is the shared vocabulary for *how a
/// fact in this model was come by*, which is a different question from how confident a domain
/// engine is in its own verdict.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EvidenceClass {
    /// Read from the live machine now (or from a process-lifetime cache of a live read — see
    /// [`Freshness::UnstampedCache`], which is how a consumer tells the two apart).
    DirectlyObserved,
    /// Compy wrote this down earlier and is reading its own record back.
    RecordedHistorically,
    /// Computed from measured values rather than read as a value.
    DerivedFromMeasurement,
    /// A rule concluded it from other facts, and the rule can be wrong in named ways.
    InferredBounded,
    /// The user asserted it. v1 emits none: nothing in the four answers is user-asserted, and
    /// tagging an auto-written baseline as user-declared would be fabrication.
    UserDeclared,
    /// No value. The reason is named; a missing fact never becomes a plausible one.
    Unavailable,
}

/// The full §3 vocabulary, in order. Consumers use it to render a legend without hardcoding one,
/// and [`EvidenceSummary::classes_present`] filters it down to what a given model actually emitted.
pub(crate) const ALL_EVIDENCE_CLASSES: [EvidenceClass; 6] = [
    EvidenceClass::DirectlyObserved,
    EvidenceClass::RecordedHistorically,
    EvidenceClass::DerivedFromMeasurement,
    EvidenceClass::InferredBounded,
    EvidenceClass::UserDeclared,
    EvidenceClass::Unavailable,
];

/// MACHINE_MODEL.md §4: a consumer must be able to ask whether evidence is still comparable.
/// A timestamp alone cannot answer that, because some producers record none — so the model says
/// which of those situations it is in rather than inventing a stamp to paper over the difference.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Freshness {
    /// The producer stamped its own observation time. `observed_at` carries that stamp verbatim.
    Stamped,
    /// Read live while this model was composed. The producer records no time of its own, so
    /// `observed_at` stays None and the model's `built_at` is the only bound a consumer gets.
    LiveAtBuild,
    /// Served from a cache filled once per process with no capture time recorded. This is NOT
    /// proof of a read at `built_at`; treat it as durable identity, not as a live reading.
    UnstampedCache,
    /// Compy's own earlier record whose source row carries no usable time. The VALUE is real and
    /// historical; only its position in time is unknowable. Kept distinct from `NotApplicable`
    /// because collapsing the two lets a KNOWN historical fact be read as an absence, and a fact
    /// that HAS a value must never share a freshness state with one that has none (#385 review).
    UndatedHistorical,
    /// There is no value at all, so there is no freshness. Reserved for the absent facts built by
    /// [`Fact::unknown`] and [`Fact::not_applicable`]. A fact carrying a value never uses it.
    NotApplicable,
}

/// A producing domain's own word for a fact's state, carried through unchanged. The model classes
/// a fact; it does not overwrite what the domain called it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct DomainVocabulary {
    /// The vocabulary's owner in code, e.g. `"history::AppliedChange.status"`.
    pub vocabulary: &'static str,
    /// The domain's own value, verbatim.
    pub value: String,
}

/// One material fact, with everything a consumer needs to avoid pretending it knows more than it
/// does. Construct these ONLY through the constructors below: they are what make an unknown
/// impossible to spell as a known-but-empty value.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct Fact<T> {
    /// None whenever `class` is `Unavailable`, and only then.
    pub value: Option<T>,
    pub class: EvidenceClass,
    /// The canonical producer this fact was read from, named in code terms.
    pub source: &'static str,
    /// The producer's OWN observation time, never this model's build time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<String>,
    pub freshness: Freshness,
    /// Why the value is MISSING: this fact could exist for this subject and Compy does not have
    /// it. Present exactly when the fact is unknown, and never alongside `not_applicable_reason`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown_reason: Option<String>,
    /// Why the field does not apply to THIS subject, so there is nothing to know. A change that
    /// was never rolled back has no rollback time; that is not a gap in Compy's evidence, and
    /// counting it as one would inflate the unknown total with non-facts (#385 review).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_applicable_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<DomainVocabulary>,
}

impl<T> Fact<T> {
    fn known(
        value: T,
        class: EvidenceClass,
        source: &'static str,
        observed_at: Option<String>,
        freshness: Freshness,
    ) -> Self {
        Fact {
            value: Some(value),
            class,
            source,
            observed_at,
            freshness,
            unknown_reason: None,
            not_applicable_reason: None,
            domain: None,
        }
    }

    /// A live read served from a process-lifetime cache with no capture time.
    pub(crate) fn cached(value: T, source: &'static str) -> Self {
        Self::known(
            value,
            EvidenceClass::DirectlyObserved,
            source,
            None,
            Freshness::UnstampedCache,
        )
    }

    /// A read performed during this model build. Still unstamped by its producer.
    pub(crate) fn live(value: T, source: &'static str) -> Self {
        Self::known(
            value,
            EvidenceClass::DirectlyObserved,
            source,
            None,
            Freshness::LiveAtBuild,
        )
    }

    /// Compy's own earlier record, carrying the timestamp the record was written with. The
    /// timestamp is REQUIRED here: a historical fact with a build-time stamp would be a lie.
    pub(crate) fn historical(value: T, source: &'static str, observed_at: String) -> Self {
        Self::known(
            value,
            EvidenceClass::RecordedHistorically,
            source,
            Some(observed_at),
            Freshness::Stamped,
        )
    }

    /// Compy's own earlier record whose source row carries no usable time. The value is real; its
    /// position in time is not knowable, and the model says that instead of inventing one.
    pub(crate) fn known_undated(value: T, source: &'static str) -> Self {
        Self::known(
            value,
            EvidenceClass::RecordedHistorically,
            source,
            None,
            Freshness::UndatedHistorical,
        )
    }

    /// Computed from measured values.
    pub(crate) fn derived(value: T, source: &'static str, freshness: Freshness) -> Self {
        Self::known(
            value,
            EvidenceClass::DerivedFromMeasurement,
            source,
            None,
            freshness,
        )
    }

    /// Concluded by a rule that can be wrong in named ways.
    pub(crate) fn inferred(value: T, source: &'static str, freshness: Freshness) -> Self {
        Self::known(
            value,
            EvidenceClass::InferredBounded,
            source,
            None,
            freshness,
        )
    }

    /// No value, and why. The only way this model is allowed to say "I don't know".
    pub(crate) fn unknown(source: &'static str, reason: impl Into<String>) -> Self {
        Fact {
            value: None,
            class: EvidenceClass::Unavailable,
            source,
            observed_at: None,
            freshness: Freshness::NotApplicable,
            unknown_reason: Some(reason.into()),
            not_applicable_reason: None,
            domain: None,
        }
    }

    /// No value because the field does not APPLY to this subject, and why. Distinct from
    /// [`Fact::unknown`] in the one way that matters to a reader: nothing is missing here, so it
    /// never enters [`EvidenceSummary::unknowns`] and never contributes an evidence class to a
    /// roll-up. Conflating the two makes Compy report gaps it does not have (#385 review).
    pub(crate) fn not_applicable(source: &'static str, reason: impl Into<String>) -> Self {
        Fact {
            value: None,
            class: EvidenceClass::Unavailable,
            source,
            observed_at: None,
            freshness: Freshness::NotApplicable,
            unknown_reason: None,
            not_applicable_reason: Some(reason.into()),
            domain: None,
        }
    }

    pub(crate) fn with_domain(mut self, vocabulary: &'static str, value: impl Into<String>) -> Self {
        self.domain = Some(DomainVocabulary {
            vocabulary,
            value: value.into(),
        });
        self
    }

    /// Absent because Compy does not have it. NOT the same as absent because the field cannot
    /// apply, and only this one belongs in [`EvidenceSummary::unknowns`].
    #[cfg(test)]
    pub(crate) fn is_unknown(&self) -> bool {
        self.unknown_reason.is_some()
    }

    /// Absent because the field does not apply to this subject.
    pub(crate) fn is_not_applicable(&self) -> bool {
        self.not_applicable_reason.is_some()
    }

    /// A fact is in exactly one of three states: it has a value, it is missing, or it does not
    /// apply. Checked in tests over real composed models rather than assumed, so a future
    /// constructor cannot quietly introduce a fourth.
    #[cfg(test)]
    pub(crate) fn absence_is_well_formed(&self) -> bool {
        matches!(
            (
                self.value.is_some(),
                self.unknown_reason.is_some(),
                self.not_applicable_reason.is_some(),
            ),
            (true, false, false) | (false, true, false) | (false, false, true)
        )
    }
}

/// A probe that failed writes an empty string, not a value. Anything that would present `""` as a
/// known answer is a fabrication, so it becomes an explicit unknown here instead.
fn cached_str(value: &str, source: &'static str, reason: &str) -> Fact<String> {
    if value.is_empty() {
        Fact::unknown(source, reason)
    } else {
        Fact::cached(value.to_string(), source)
    }
}

// ─── Canonical producers ─────────────────────────────────────────────────

pub(crate) const PRODUCER_HARDWARE: &str = "hardware::current_fingerprint";
pub(crate) const PRODUCER_HARDWARE_INFO: &str = "hardware::get_hardware_info";
pub(crate) const PRODUCER_SNAPSHOT: &str = "intelligence::IdentitySnapshot";
pub(crate) const PRODUCER_HWCHANGE: &str = "hwchange::fingerprint (persisted baseline)";
pub(crate) const PRODUCER_LEDGER: &str = "history::AppliedChangeView";
pub(crate) const PRODUCER_TIMELINE: &str = "intelligence::assemble_timeline";

/// THE CANONICAL RIG-IDENTITY RULE, stated once so consumers stop re-deciding it:
///
/// `hardware::get_hardware_info` (reduced by `hardware::current_fingerprint`) is the single
/// canonical producer of the machine's CURRENT identity. Every other fingerprint in the tree is
/// either a recorded copy of an earlier reading or a differently-scoped identity, and none of them
/// overrides it. The model reports where they disagree and does not pick a winner beyond this rule.
pub(crate) const RIG_IDENTITY_RULE: &str = "hardware::get_hardware_info is the canonical producer of current rig identity. Other fingerprints are recorded or scoped copies; disagreement is reported, not resolved.";

/// An existing fingerprint that is deliberately NOT treated as a contributor to canonical identity,
/// with the reason. Naming them is the point: silence would read as an oversight.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct ExcludedProducer {
    pub producer: &'static str,
    pub reason: &'static str,
}

// ─── A. What machine is this? ────────────────────────────────────────────

/// One producer's claim about one identity field, at whatever time that producer looked.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct IdentityClaim {
    pub producer: &'static str,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<String>,
    pub freshness: Freshness,
}

/// Two producers do not currently say the same thing about one identity field.
///
/// A disagreement is EVIDENCE THAT THEY DIFFER. It is not proof that either producer is wrong, and
/// it is not authorization to overwrite one with the other — `interpretation` says so per case
/// because the honest reading differs between them.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct IdentityDisagreement {
    pub field: &'static str,
    pub left: IdentityClaim,
    pub right: IdentityClaim,
    pub interpretation: &'static str,
}

const DISAGREE_HISTORICAL: &str = "The recorded reading is older than the live one. The most likely cause is that the machine changed after the record was written — not that either producer is wrong. Neither value may overwrite the other.";
const DISAGREE_BASELINE: &str = "The hardware-change baseline was written at a different time and is only re-baselined when the user acknowledges a change. A difference here is what the Re-Run Setup signal exists to report; it does not make the baseline incorrect.";
const DISAGREE_UNITS: &str = "These producers use different rounding conventions for RAM, so a gap of 1 GB is a unit-convention difference rather than a hardware disagreement. Only a gap larger than the tolerance hwchange::diff_fingerprint itself applies is reported here.";

/// Answer A: the minimum useful identity, each field with provenance and freshness.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct MachineIdentity {
    pub cpu: Fact<String>,
    pub gpu: Fact<String>,
    pub gpu_driver: Fact<String>,
    pub ram_gb: Fact<u32>,
    pub display: Fact<String>,
    pub windows: Fact<String>,
    /// The stable grouping key every other store tags its rows with.
    pub rig_hash: Fact<String>,
    pub canonical_rule: &'static str,
    /// Exactly which existing producers contribute to canonical identity.
    pub contributing_producers: Vec<&'static str>,
    /// Existing fingerprints deliberately left out of canonical identity, with reasons.
    pub excluded_producers: Vec<ExcludedProducer>,
    /// Empty means the contributing producers currently agree on every compared field — which is a
    /// finding, not an absence of one.
    pub disagreements: Vec<IdentityDisagreement>,
}

// ─── B. What recently changed? ───────────────────────────────────────────

/// One entry of the recorded chronology, copied off the existing timeline assembler.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct ChronologyEntry {
    /// The SOURCE record's own timestamp. Never this model's build time.
    pub observed_at: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub event_type: String,
    /// Which store produced it.
    pub source: String,
    /// Whether Compy did it, measured it, or merely noticed it. Never blurred.
    pub scope: EventScope,
    /// For noticed changes: the two probe times bounding when it actually happened. The exact
    /// moment was not witnessed, and this pair is the only honest statement of that.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_between: Option<(String, String)>,
    pub class: EvidenceClass,
}

/// Answer B: the chronology Compy already recorded — nothing back-filled, nothing inferred.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct ChangeChronology {
    /// The earliest evidence Compy STILL RETAINS, across every retained chronology source: the
    /// identity snapshots, the assembled timeline, and dated Trust-Ledger rows. Deriving it from
    /// identity snapshots alone dated "history starts" later than evidence already in hand, which
    /// would report a machine as unrecorded during a period Compy can still show (#385 review).
    /// Before this boundary there is no record, which is different from nothing having changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recorded_from: Option<String>,
    /// Which retained source that boundary came from, so the claim is checkable rather than taken
    /// on trust. `None` exactly when `recorded_from` is `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recorded_from_source: Option<&'static str>,
    /// When IDENTITY recording specifically started. A narrower question than the boundary above,
    /// kept as its own field rather than allowed to stand in for it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_history_from: Option<String>,
    pub identity_snapshots: usize,
    pub total_events: usize,
    /// Newest first, capped at [`MAX_CHRONOLOGY`].
    pub entries: Vec<ChronologyEntry>,
    /// Source records whose timestamps did not parse. Dropped, never guessed at.
    pub dropped_unparseable: usize,
    pub causation_note: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown_reason: Option<String>,
}

const CAUSATION_NOTE: &str = "Chronology never implies causation by itself. These entries say what was recorded and when, not what caused what.";
const CHRONOLOGY_EMPTY: &str = "Nothing is recorded yet. Chronology starts when recording starts; an empty record is not evidence that nothing changed.";
const LEDGER_EMPTY: &str = "The Trust Ledger has no rows, so Compy has recorded no change on this machine.";

// ─── C. What did Compy change? ───────────────────────────────────────────

/// One Trust-Ledger row, re-expressed as facts. Every value here is passed through from
/// `history::AppliedChangeView`; nothing about the mutation system is re-derived or rewritten.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct CompyChangeFact {
    pub id: String,
    pub title: String,
    /// Stamped at apply time.
    pub applied_at: Fact<String>,
    /// The ledger's own status word rides along in `domain`.
    pub status: Fact<String>,
    /// Re-checked against the live machine at read time — that is why it is directly observed
    /// while everything around it is historical.
    pub still_active: Fact<bool>,
    /// Stamped at rollback time, and only from Intelligence Phase 2 onward. Older rollbacks have
    /// no recorded time and stay honestly unknown rather than being retro-dated.
    pub rolled_back_at: Fact<String>,
    /// From `history::same_rig`, which compares GPU · RAM · display and is deliberately
    /// driver-insensitive. Unknown for rows written before rig stamping existed.
    pub on_this_rig: Fact<bool>,
    /// Whether a typed rollback contract was captured at apply time.
    pub reversible: Fact<bool>,
    /// What a rollback would restore, when the captured snapshot supports saying so.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restores: Option<String>,
}

/// Answer C: the applied-change truth, with active / rolled-back / not-on-this-rig preserved.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct CompyChangeTruth {
    pub total_recorded: usize,
    /// Status `"applied"`, still verified in effect against the live machine, AND matched to this
    /// machine by `history::same_rig`. This is the ONLY count that may be read as "Compy changed
    /// this on this PC and it is still that way". A row stamped for another rig, or one written
    /// before rig stamping existed, is NOT counted here even when the state reads as in effect:
    /// the live check proves the STATE is present, never that Compy is who applied it (#385
    /// review).
    pub active_now: usize,
    /// In effect on this machine now, but the row is stamped for a DIFFERENT rig. Compy did not
    /// apply it here; something else put the machine in that state, or the row travelled.
    pub in_effect_other_rig: usize,
    /// In effect on this machine now, but the row predates rig stamping, so which machine Compy
    /// applied it on is unknown. Neither this rig nor another one — honestly unattributed.
    pub in_effect_rig_unknown: usize,
    /// `active_now + in_effect_other_rig + in_effect_rig_unknown`. Carried so a consumer that
    /// genuinely wants "in effect, whoever applied it and wherever" reads one field instead of
    /// re-adding them and re-creating the conflation this split exists to remove.
    pub in_effect_total: usize,
    /// Status `"applied"` but the live check says the state is no longer in effect — something
    /// outside Compy reverted it. Distinct from a rollback Compy performed. Spans every rig
    /// attribution; `not_on_this_rig` and `rig_unknown` below cover the whole ledger the same way.
    pub applied_but_not_in_effect: usize,
    pub rolled_back: usize,
    /// Stamped with a fingerprint that `history::same_rig` does not match to today's machine.
    pub not_on_this_rig: usize,
    /// Written before rig stamping existed. Honestly unknown, never assumed to be this rig.
    pub rig_unknown: usize,
    /// Newest first, capped at [`MAX_CHANGES`]. The counts above cover every row.
    pub changes: Vec<CompyChangeFact>,
    pub ledger_note: &'static str,
}

const LEDGER_NOTE: &str = "The Trust Ledger is the canonical record of what Compy changed and how to undo it. This model reads it; rollback continues to resolve from history.json alone.";

// ─── D. What evidence can we trust right now? ────────────────────────────

/// A fact that has no value, and the named reason it has none.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct UnknownFact {
    pub field: String,
    pub source: &'static str,
    pub reason: String,
}

/// Freshness roll-up for one of the four answers.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct AnswerEvidence {
    pub answer: &'static str,
    pub classes: Vec<EvidenceClass>,
    /// Oldest producer-stamped time contributing to this answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oldest_observed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub newest_observed_at: Option<String>,
    /// Facts whose producer records no time at all. A consumer must not treat these as re-read now.
    pub unstamped_facts: usize,
    /// Facts Compy could have and does not. Equal, across all answers, to `unknowns.len()` —
    /// they are produced by the same pass, so the count and the list cannot disagree.
    pub unknown_facts: usize,
    /// Fields that do not apply to their subject. Counted, never folded into `unknown_facts`,
    /// and contributing no evidence class: nothing here was observed, inferred, or failed to read.
    pub not_applicable_facts: usize,
}

/// Answer D: enough for a consumer to decide what it may claim, without re-deriving any of it.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct EvidenceSummary {
    /// When this model was composed. NOT an observation time for any fact in it.
    pub built_at: String,
    pub answers: Vec<AnswerEvidence>,
    /// Every unknown in the model, collected so a consumer never has to hunt for them.
    pub unknowns: Vec<UnknownFact>,
    pub classes_present: Vec<EvidenceClass>,
    pub vocabulary: [EvidenceClass; 6],
}

// ─── The model ───────────────────────────────────────────────────────────

/// One aggregate answer, shared by both flagship journeys.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct MachineModel {
    pub schema_version: u32,
    pub built_at: String,
    pub identity: MachineIdentity,
    pub chronology: ChangeChronology,
    pub compy_changes: CompyChangeTruth,
    pub evidence: EvidenceSummary,
}

/// Everything [`compose`] reads — plain borrowed data in, one model out. Following the
/// `intelligence::TimelineInputs` pattern already in the tree, and for the same reason: the
/// composition stays pure, so "this module writes nothing" is a property of its type, not a promise.
pub(crate) struct MachineModelInputs<'a> {
    pub hardware: &'a HardwareInfo,
    /// The canonical current-identity reduction of `hardware`.
    pub live_fingerprint: &'a HwFingerprint,
    /// Ascending by `observed_at`, as `intelligence.json` stores them.
    pub identity_snapshots: &'a [IdentitySnapshot],
    /// The persisted hardware-change baseline, when one has been written.
    pub hw_baseline: Option<&'a HardwareFingerprint>,
    /// The Trust-Ledger view, exactly as Care and Performance already read it.
    pub applied_changes: &'a [AppliedChangeView],
    /// The chronology, already assembled by its canonical producer.
    pub timeline: &'a [crate::intelligence::EventRecord],
    pub timeline_dropped: usize,
    /// Injected so composition is deterministic under test and never reads a clock itself.
    pub built_at: String,
}

/// Compose the model. Pure: no I/O, no probe, no clock, no write.
pub(crate) fn compose(inp: &MachineModelInputs) -> MachineModel {
    let identity = compose_identity(inp);
    let chronology = compose_chronology(inp);
    let compy_changes = compose_compy_changes(inp);
    // The unknown LIST and the unknown COUNTS are built by the same pass, deliberately. They were
    // built by two — scattered `note_unknown` calls and a separate tally — and drifted apart:
    // a fact could be counted as unknown and never listed, or listed and never counted (#385
    // review). One pass makes them agree by construction rather than by remembering to.
    let evidence = compose_evidence(&inp.built_at, &identity, &chronology, &compy_changes);

    MachineModel {
        schema_version: SCHEMA_VERSION,
        built_at: inp.built_at.clone(),
        identity,
        chronology,
        compy_changes,
        evidence,
    }
}

fn compose_identity(inp: &MachineModelInputs) -> MachineIdentity {
    let fp = inp.live_fingerprint;

    let cpu = cached_str(
        &inp.hardware.cpu_brand,
        PRODUCER_HARDWARE_INFO,
        "The CPU brand string came back empty — the system inventory read did not return one.",
    );
    let gpu = cached_str(
        &fp.gpu,
        PRODUCER_HARDWARE,
        "No GPU was read, so there is no primary adapter to name.",
    );
    let gpu_driver = cached_str(
        &fp.gpu_driver,
        PRODUCER_HARDWARE,
        "The GPU driver version was not readable from the adapter that was detected.",
    );
    let display = cached_str(
        &fp.display,
        PRODUCER_HARDWARE,
        "No display mode was read, so resolution and refresh rate are unknown.",
    );
    let ram_gb = if fp.ram_gb > 0 {
        Fact::cached(fp.ram_gb, PRODUCER_HARDWARE)
    } else {
        Fact::unknown(
            PRODUCER_HARDWARE,
            "Total installed memory read as zero, which means the read failed rather than that the machine has no memory.",
        )
    };
    let windows = match inp.hardware.windows_version.as_ref() {
        Some(w) if !w.build.is_empty() => Fact::cached(
            format!("{} (build {}.{})", w.product_name, w.build, w.ubr),
            PRODUCER_HARDWARE_INFO,
        ),
        _ => Fact::unknown(
            PRODUCER_HARDWARE_INFO,
            "The Windows edition/build read returned nothing, so the OS version is unknown rather than assumed.",
        ),
    };
    // Derived, not read: a digest computed over measured identity fields.
    let rig_hash = if fp.hash.is_empty() {
        Fact::unknown(
            PRODUCER_HARDWARE,
            "The rig hash is computed from identity fields that were not readable.",
        )
    } else {
        Fact::derived(
            fp.hash.clone(),
            PRODUCER_HARDWARE,
            Freshness::UnstampedCache,
        )
    };

    MachineIdentity {
        cpu,
        gpu,
        gpu_driver,
        ram_gb,
        display,
        windows,
        rig_hash,
        canonical_rule: RIG_IDENTITY_RULE,
        contributing_producers: vec![PRODUCER_HARDWARE, PRODUCER_SNAPSHOT, PRODUCER_HWCHANGE],
        excluded_producers: vec![
            ExcludedProducer {
                producer: "game_state::GameStateFingerprint",
                reason: "Session-scoped measurement conditions (game, display mode, capture backend), not a claim about which rig this is.",
            },
            ExcludedProducer {
                producer: "history::same_rig",
                reason: "A comparison RULE the model applies to ledger rows, not a producer of an identity value of its own.",
            },
        ],
        disagreements: identity_disagreements(inp),
    }
}

/// Report where the contributing identity producers currently differ. Pure and total: it never
/// selects a winner, and it never reports a difference it cannot attribute to a real comparison.
pub(crate) fn identity_disagreements(inp: &MachineModelInputs) -> Vec<IdentityDisagreement> {
    let mut out = Vec::new();
    let fp = inp.live_fingerprint;
    let live = |value: &str| IdentityClaim {
        producer: PRODUCER_HARDWARE,
        value: value.to_string(),
        observed_at: None,
        freshness: Freshness::UnstampedCache,
    };

    // 1) Live identity vs the newest reading Compy actually stamped.
    if let Some(snap) = inp.identity_snapshots.last() {
        let recorded = |value: &str| IdentityClaim {
            producer: PRODUCER_SNAPSHOT,
            value: value.to_string(),
            observed_at: Some(snap.observed_at.clone()),
            freshness: Freshness::Stamped,
        };
        // An empty side is a failed probe, never evidence of a change — the same rule
        // `intelligence::str_changed` applies when deciding whether to record a snapshot at all.
        let differs = |a: &str, b: &str| !a.is_empty() && !b.is_empty() && a != b;
        for (field, a, b) in [
            ("gpu", fp.gpu.as_str(), snap.gpu.as_str()),
            ("gpu_driver", fp.gpu_driver.as_str(), snap.gpu_driver.as_str()),
            ("display", fp.display.as_str(), snap.display.as_str()),
            ("rig_hash", fp.hash.as_str(), snap.hw_hash.as_str()),
        ] {
            if differs(a, b) {
                out.push(IdentityDisagreement {
                    field,
                    left: live(a),
                    right: recorded(b),
                    interpretation: DISAGREE_HISTORICAL,
                });
            }
        }
        if fp.ram_gb > 0 && snap.ram_gb > 0 && fp.ram_gb != snap.ram_gb {
            out.push(IdentityDisagreement {
                field: "ram_gb",
                left: live(&fp.ram_gb.to_string()),
                right: recorded(&snap.ram_gb.to_string()),
                interpretation: DISAGREE_HISTORICAL,
            });
        }
    }

    // 2) Live identity vs the hardware-change baseline the user last acknowledged.
    if let Some(base) = inp.hw_baseline {
        let baseline = |value: String| IdentityClaim {
            producer: PRODUCER_HWCHANGE,
            value,
            observed_at: None,
            freshness: Freshness::UnstampedCache,
        };
        if !fp.gpu.is_empty()
            && !base.gpus.is_empty()
            && !base.gpus.iter().any(|g| g == &fp.gpu)
        {
            out.push(IdentityDisagreement {
                field: "gpu",
                left: live(&fp.gpu),
                right: baseline(base.gpus.join(", ")),
                interpretation: DISAGREE_BASELINE,
            });
        }
        // hardware rounds GiB, hwchange truncates. Reuse hwchange's own +/-1 tolerance rather than
        // inventing a second rule, so a rounding artefact never reads as a hardware disagreement.
        if fp.ram_gb > 0 && base.ram_gb > 0 && u64::from(fp.ram_gb).abs_diff(base.ram_gb) > 1 {
            out.push(IdentityDisagreement {
                field: "ram_gb",
                left: live(&fp.ram_gb.to_string()),
                right: baseline(base.ram_gb.to_string()),
                interpretation: DISAGREE_UNITS,
            });
        }
    }

    out
}

/// The earliest timestamp any retained chronology source still holds, and which source it came
/// from. Identity snapshots are ONE of those sources, not the boundary: a Trust-Ledger row or a
/// timeline event written before the first snapshot is retained evidence too, and dating history
/// from the snapshot alone would report the machine as unrecorded during a stretch Compy can still
/// show (#385 review).
///
/// Candidates are compared as strings, which is the ordering convention this whole module already
/// uses for the RFC3339 UTC stamps its producers write. Empty stamps are not candidates: an undated
/// row cannot bound anything. Ties keep the first source listed, so the result is deterministic.
fn earliest_retained_evidence(inp: &MachineModelInputs) -> (Option<String>, Option<&'static str>) {
    let candidates: [(&'static str, Option<&str>); 3] = [
        (
            PRODUCER_TIMELINE,
            inp.timeline
                .iter()
                .map(|e| e.timestamp.as_str())
                .filter(|t| !t.is_empty())
                .min(),
        ),
        (
            PRODUCER_LEDGER,
            inp.applied_changes
                .iter()
                .map(|c| c.applied_at.as_str())
                .filter(|t| !t.is_empty())
                .min(),
        ),
        (
            PRODUCER_SNAPSHOT,
            inp.identity_snapshots
                .iter()
                .map(|s| s.observed_at.as_str())
                .filter(|t| !t.is_empty())
                .min(),
        ),
    ];

    let mut best: Option<(&str, &'static str)> = None;
    for (source, candidate) in candidates {
        if let Some(at) = candidate {
            if best.is_none_or(|(b, _)| at < b) {
                best = Some((at, source));
            }
        }
    }
    match best {
        Some((at, source)) => (Some(at.to_string()), Some(source)),
        None => (None, None),
    }
}

fn compose_chronology(inp: &MachineModelInputs) -> ChangeChronology {
    let (recorded_from, recorded_from_source) = earliest_retained_evidence(inp);
    let identity_history_from = inp
        .identity_snapshots
        .iter()
        .map(|s| s.observed_at.as_str())
        .filter(|t| !t.is_empty())
        .min()
        .map(str::to_string);

    let unknown_reason = if inp.timeline.is_empty() {
        Some(CHRONOLOGY_EMPTY.to_string())
    } else {
        None
    };

    // The assembler emits ascending; consumers want newest first.
    let entries = inp
        .timeline
        .iter()
        .rev()
        .take(MAX_CHRONOLOGY)
        .map(|e| ChronologyEntry {
            observed_at: e.timestamp.clone(),
            summary: e.summary.clone(),
            detail: e.detail.clone(),
            event_type: e.event_type.clone(),
            source: e.source.clone(),
            scope: e.scope,
            observed_between: e.observed_between.clone(),
            class: EvidenceClass::RecordedHistorically,
        })
        .collect();

    ChangeChronology {
        recorded_from,
        recorded_from_source,
        identity_history_from,
        identity_snapshots: inp.identity_snapshots.len(),
        total_events: inp.timeline.len(),
        entries,
        dropped_unparseable: inp.timeline_dropped,
        causation_note: CAUSATION_NOTE,
        unknown_reason,
    }
}

fn compose_compy_changes(inp: &MachineModelInputs) -> CompyChangeTruth {
    let mut active_now = 0usize;
    let mut in_effect_other_rig = 0usize;
    let mut in_effect_rig_unknown = 0usize;
    let mut applied_but_not_in_effect = 0usize;
    let mut rolled_back = 0usize;
    let mut not_on_this_rig = 0usize;
    let mut rig_unknown = 0usize;

    for c in inp.applied_changes {
        if c.status == "rolled_back" {
            rolled_back += 1;
        } else if c.is_still_active {
            // `is_still_active` re-checks the live machine, so it proves the STATE is in effect
            // here. It says nothing about who applied it or where, and `same_rig` is the only
            // thing that does. Attribution is therefore carried, never collapsed (#385 review).
            match c.on_this_rig {
                Some(true) => active_now += 1,
                Some(false) => in_effect_other_rig += 1,
                None => in_effect_rig_unknown += 1,
            }
        } else {
            applied_but_not_in_effect += 1;
        }
        match c.on_this_rig {
            Some(false) => not_on_this_rig += 1,
            None => rig_unknown += 1,
            Some(true) => {}
        }
    }

    let changes: Vec<CompyChangeFact> = inp
        .applied_changes
        .iter()
        .rev()
        .take(MAX_CHANGES)
        .map(|c| {
            let applied_at = if c.applied_at.is_empty() {
                Fact::unknown(
                    PRODUCER_LEDGER,
                    "This ledger row carries no apply time. It is not dated rather than dated now.",
                )
            } else {
                Fact::historical(c.applied_at.clone(), PRODUCER_LEDGER, c.applied_at.clone())
            };
            let status = match applied_at.observed_at.as_ref() {
                Some(at) => Fact::historical(c.status.clone(), PRODUCER_LEDGER, at.clone()),
                // An undated row still HAS a status; it just cannot be placed in time.
                None => Fact::known_undated(c.status.clone(), PRODUCER_LEDGER),
            }
            .with_domain("history::AppliedChange.status", c.status.clone());
            let rolled_back_at = match c.rolled_back_at.as_ref() {
                Some(t) => Fact::historical(t.clone(), PRODUCER_LEDGER, t.clone()),
                None if c.status == "rolled_back" => Fact::unknown(
                    PRODUCER_LEDGER,
                    "This change was rolled back before rollback times were stamped. The date is unknown and must not be guessed.",
                ),
                // NOT an unknown: this change was never rolled back, so a rollback time does not
                // exist to be missing. Reporting it as unknown made Compy count evidence gaps it
                // does not have, and put a count in the roll-up with no matching entry in the
                // unknown list (#385 review).
                None => Fact::not_applicable(
                    PRODUCER_LEDGER,
                    "This change has not been rolled back, so there is no rollback time for it to have.",
                ),
            };
            let stamp = applied_at.observed_at.clone();
            let on_this_rig = match c.on_this_rig {
                Some(v) => Fact::inferred(v, "history::same_rig", Freshness::UnstampedCache),
                None => Fact::unknown(
                    PRODUCER_LEDGER,
                    "This row predates rig stamping, so which machine it was applied on is unknown.",
                ),
            };
            CompyChangeFact {
                id: c.id.clone(),
                title: c.rec_title.clone(),
                applied_at,
                status,
                still_active: Fact::live(c.is_still_active, "history::check_change_active"),
                rolled_back_at,
                on_this_rig,
                reversible: match stamp {
                    Some(at) => Fact::historical(c.rollback_action.is_some(), PRODUCER_LEDGER, at),
                    None => Fact::known_undated(c.rollback_action.is_some(), PRODUCER_LEDGER),
                },
                restores: c.restores_label.clone(),
            }
        })
        .collect();

    CompyChangeTruth {
        total_recorded: inp.applied_changes.len(),
        active_now,
        in_effect_other_rig,
        in_effect_rig_unknown,
        in_effect_total: active_now + in_effect_other_rig + in_effect_rig_unknown,
        applied_but_not_in_effect,
        rolled_back,
        not_on_this_rig,
        rig_unknown,
        changes,
        ledger_note: LEDGER_NOTE,
    }
}

/// Fold one fact into an answer's roll-up AND, when it is missing, into the model's single unknown
/// list. Both happen here so a count can never exist without its matching entry (#385 review).
fn tally<T>(
    ev: &mut AnswerEvidence,
    field: &str,
    fact: &Fact<T>,
    unknowns: &mut Vec<UnknownFact>,
) {
    // A field that does not apply is not evidence: it contributes no class, no freshness and no
    // unknown. It is counted so the roll-up still accounts for every field it was handed.
    if fact.is_not_applicable() {
        ev.not_applicable_facts += 1;
        return;
    }
    if !ev.classes.contains(&fact.class) {
        ev.classes.push(fact.class);
    }
    match fact.freshness {
        Freshness::Stamped => {
            if let Some(at) = fact.observed_at.as_ref() {
                if ev.oldest_observed_at.as_deref().is_none_or(|o| at.as_str() < o) {
                    ev.oldest_observed_at = Some(at.clone());
                }
                if ev.newest_observed_at.as_deref().is_none_or(|n| at.as_str() > n) {
                    ev.newest_observed_at = Some(at.clone());
                }
            }
        }
        // An undated historical record has a real value and no knowable time, so it is unstamped
        // for exactly the same reason a cached read is: a consumer must not treat it as re-read.
        Freshness::LiveAtBuild | Freshness::UnstampedCache | Freshness::UndatedHistorical => {
            ev.unstamped_facts += 1
        }
        Freshness::NotApplicable => {}
    }
    if let Some(reason) = fact.unknown_reason.as_ref() {
        ev.unknown_facts += 1;
        unknowns.push(UnknownFact {
            field: field.to_string(),
            source: fact.source,
            reason: reason.clone(),
        });
    }
}

/// An absence with no `Fact` behind it — an empty timeline, an empty ledger. Recorded through the
/// same list and the same counter as every other unknown, for the same reason.
fn tally_absent(
    ev: &mut AnswerEvidence,
    field: &str,
    source: &'static str,
    reason: &str,
    unknowns: &mut Vec<UnknownFact>,
) {
    ev.classes.push(EvidenceClass::Unavailable);
    ev.unknown_facts += 1;
    unknowns.push(UnknownFact {
        field: field.to_string(),
        source,
        reason: reason.to_string(),
    });
}

fn empty_answer(answer: &'static str) -> AnswerEvidence {
    AnswerEvidence {
        answer,
        classes: Vec::new(),
        oldest_observed_at: None,
        newest_observed_at: None,
        unstamped_facts: 0,
        unknown_facts: 0,
        not_applicable_facts: 0,
    }
}

fn compose_evidence(
    built_at: &str,
    identity: &MachineIdentity,
    chronology: &ChangeChronology,
    changes: &CompyChangeTruth,
) -> EvidenceSummary {
    let mut unknowns: Vec<UnknownFact> = Vec::new();

    let mut a = empty_answer("What machine is this?");
    tally(&mut a, "identity.cpu", &identity.cpu, &mut unknowns);
    tally(&mut a, "identity.gpu", &identity.gpu, &mut unknowns);
    tally(&mut a, "identity.gpu_driver", &identity.gpu_driver, &mut unknowns);
    tally(&mut a, "identity.ram_gb", &identity.ram_gb, &mut unknowns);
    tally(&mut a, "identity.display", &identity.display, &mut unknowns);
    tally(&mut a, "identity.windows", &identity.windows, &mut unknowns);
    tally(&mut a, "identity.rig_hash", &identity.rig_hash, &mut unknowns);

    let mut b = empty_answer("What recently changed?");
    for e in &chronology.entries {
        if !b.classes.contains(&e.class) {
            b.classes.push(e.class);
        }
        if b.oldest_observed_at.as_deref().is_none_or(|o| e.observed_at.as_str() < o) {
            b.oldest_observed_at = Some(e.observed_at.clone());
        }
        if b.newest_observed_at.as_deref().is_none_or(|n| e.observed_at.as_str() > n) {
            b.newest_observed_at = Some(e.observed_at.clone());
        }
    }
    if chronology.entries.is_empty() {
        tally_absent(
            &mut b,
            "chronology.entries",
            PRODUCER_TIMELINE,
            chronology
                .unknown_reason
                .as_deref()
                .unwrap_or(CHRONOLOGY_EMPTY),
            &mut unknowns,
        );
    }

    let mut c = empty_answer("What did Compy change?");
    for ch in &changes.changes {
        let at = |f: &str| format!("compy_changes[{}].{}", ch.id, f);
        tally(&mut c, &at("applied_at"), &ch.applied_at, &mut unknowns);
        tally(&mut c, &at("status"), &ch.status, &mut unknowns);
        tally(&mut c, &at("still_active"), &ch.still_active, &mut unknowns);
        tally(&mut c, &at("rolled_back_at"), &ch.rolled_back_at, &mut unknowns);
        tally(&mut c, &at("on_this_rig"), &ch.on_this_rig, &mut unknowns);
        tally(&mut c, &at("reversible"), &ch.reversible, &mut unknowns);
    }
    if changes.changes.is_empty() {
        tally_absent(
            &mut c,
            "compy_changes.changes",
            PRODUCER_LEDGER,
            LEDGER_EMPTY,
            &mut unknowns,
        );
    }

    let answers = vec![a, b, c];
    let classes_present: Vec<EvidenceClass> = ALL_EVIDENCE_CLASSES
        .iter()
        .copied()
        .filter(|k| answers.iter().any(|ans| ans.classes.contains(k)))
        .collect();

    EvidenceSummary {
        built_at: built_at.to_string(),
        answers,
        unknowns,
        classes_present,
        vocabulary: ALL_EVIDENCE_CLASSES,
    }
}

// ─── Gathering (the only impure half) ────────────────────────────────────

/// Read every canonical producer once and compose. READ-ONLY by construction: each call below is a
/// documented reader. In particular it uses `intelligence::load_store` rather than
/// `get_intelligence_timeline` (which refreshes and writes snapshots) and
/// `hwchange::persisted_baseline` rather than `get_hardware_changes` (which writes a first-run
/// baseline). Picking the writing variant of either would silently make this module a mutator.
pub(crate) fn build() -> MachineModel {
    let hardware = crate::hardware::get_hardware_info();
    let live_fingerprint = crate::hardware::current_fingerprint();
    let snapshots = crate::intelligence::load_store().identity_snapshots;
    let baseline = crate::hwchange::persisted_baseline();
    let raw_changes = crate::history::load_history().unwrap_or_default();
    let applied_changes = crate::history::get_applied_changes();

    let assembly = crate::intelligence::assemble_timeline(&crate::intelligence::TimelineInputs {
        applied: &raw_changes,
        sessions: &[],
        gaming_slot: None,
        awards: &[],
        benchmark_baseline_at: None,
        comparison: None,
        snapshots: &snapshots,
        drift_notices: &[],
    });

    compose(&MachineModelInputs {
        hardware: &hardware,
        live_fingerprint: &live_fingerprint,
        identity_snapshots: &snapshots,
        hw_baseline: baseline.as_ref(),
        applied_changes: &applied_changes,
        timeline: &assembly.events,
        timeline_dropped: assembly.dropped_unparseable,
        built_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// The one read-only Machine Model command. The diagnostics surface renders the SAME value this
/// returns — see `diagnostics::machine_model_section` — so the two can never drift into a second
/// implementation of the same truth.
#[tauri::command]
pub(crate) fn get_machine_model() -> MachineModel {
    build()
}

#[cfg(test)]
mod machine_model_tests {
    use super::*;
    use crate::hardware::HwFingerprint;

    /// This module's own source, read at compile time so the read-only claim is checked against
    /// the code rather than trusted.
    const OWN_SOURCE: &str = include_str!("machine_model.rs");

    fn fp(gpu: &str, driver: &str, ram_gb: u32, display: &str, hash: &str) -> HwFingerprint {
        HwFingerprint {
            hash: hash.into(),
            gpu: gpu.into(),
            gpu_driver: driver.into(),
            ram_gb,
            display: display.into(),
        }
    }

    fn snap(observed_at: &str, gpu: &str, driver: &str, ram_gb: u32, hash: &str) -> IdentitySnapshot {
        IdentitySnapshot {
            observed_at: observed_at.into(),
            gpu: gpu.into(),
            gpu_driver: driver.into(),
            gpu_driver_date: String::new(),
            windows_build: "26100".into(),
            windows_ubr: Some(1742),
            windows_display_version: "24H2".into(),
            power_plan: "Balanced".into(),
            ram_gb,
            display: "2560x1440@250".into(),
            hw_hash: hash.into(),
        }
    }

    fn hardware() -> HardwareInfo {
        HardwareInfo {
            cpu_brand: "AMD Ryzen 7 7800X3D".into(),
            windows_version: Some(crate::hardware::WindowsVersionInfo {
                edition: "Professional".into(),
                display_version: "24H2".into(),
                build: "26100".into(),
                ubr: 1742,
                product_name: "Windows 11 Pro 24H2".into(),
            }),
            ..Default::default()
        }
    }

    struct Fixture {
        hardware: HardwareInfo,
        fingerprint: HwFingerprint,
        snapshots: Vec<IdentitySnapshot>,
        baseline: Option<HardwareFingerprint>,
        changes: Vec<AppliedChangeView>,
        timeline: Vec<crate::intelligence::EventRecord>,
    }

    impl Fixture {
        fn new() -> Self {
            Fixture {
                hardware: hardware(),
                fingerprint: fp("Radeon RX 9070 XT", "25.5.1", 32, "2560x1440@250", "abc123"),
                snapshots: vec![snap(
                    "2026-08-01T10:00:00Z",
                    "Radeon RX 9070 XT",
                    "25.5.1",
                    32,
                    "abc123",
                )],
                baseline: None,
                changes: Vec::new(),
                timeline: Vec::new(),
            }
        }

        fn model(&self) -> MachineModel {
            compose(&MachineModelInputs {
                hardware: &self.hardware,
                live_fingerprint: &self.fingerprint,
                identity_snapshots: &self.snapshots,
                hw_baseline: self.baseline.as_ref(),
                applied_changes: &self.changes,
                timeline: &self.timeline,
                timeline_dropped: 0,
                built_at: "2026-09-06T12:00:00Z".into(),
            })
        }
    }

    // ── 1. Directly observed facts keep their source and their class ──────

    #[test]
    fn directly_observed_facts_keep_source_and_class() {
        let m = Fixture::new().model();
        assert_eq!(m.identity.gpu.class, EvidenceClass::DirectlyObserved);
        assert_eq!(m.identity.gpu.source, PRODUCER_HARDWARE);
        assert_eq!(m.identity.gpu.value.as_deref(), Some("Radeon RX 9070 XT"));
        assert_eq!(m.identity.cpu.source, PRODUCER_HARDWARE_INFO);
        // A cached identity read must never claim it was taken at build time.
        assert_eq!(m.identity.gpu.freshness, Freshness::UnstampedCache);
        assert!(m.identity.gpu.observed_at.is_none());
        // The hash is COMPUTED from measured fields, so it is not "directly observed".
        assert_eq!(m.identity.rig_hash.class, EvidenceClass::DerivedFromMeasurement);
    }

    // ── 2. Historical facts keep their historical timestamp ───────────────

    #[test]
    fn historical_facts_keep_their_own_timestamp_not_now() {
        let mut f = Fixture::new();
        f.changes.push(crate::history::test_view(
            "chg-1",
            "game-mode",
            "Enable Game Mode",
            "2026-07-04T09:30:00Z",
            "applied",
            true,
            Some(true),
            None,
            true,
        ));
        let m = f.model();
        let c = &m.compy_changes.changes[0];
        assert_eq!(c.applied_at.observed_at.as_deref(), Some("2026-07-04T09:30:00Z"));
        assert_eq!(c.applied_at.class, EvidenceClass::RecordedHistorically);
        assert_eq!(c.applied_at.freshness, Freshness::Stamped);
        assert_ne!(c.applied_at.observed_at.as_deref(), Some(m.built_at.as_str()));
        // built_at is the model's own composition time and belongs to no fact.
        assert_eq!(m.evidence.built_at, "2026-09-06T12:00:00Z");
    }

    #[test]
    fn chronology_entries_carry_the_source_records_time() {
        let mut f = Fixture::new();
        f.timeline.push(crate::intelligence::EventRecord {
            id: "obs:gpu-driver-change:2026-08-20T00:00:00Z".into(),
            timestamp: "2026-08-20T00:00:00Z".into(),
            event_type: "gpu-driver-change".into(),
            source: "identity-snapshot".into(),
            scope: EventScope::Observed,
            game: None,
            summary: "GPU driver changed".into(),
            detail: Some("25.5.1 to 25.6.0".into()),
            observed_between: Some((
                "2026-08-01T10:00:00Z".into(),
                "2026-08-20T00:00:00Z".into(),
            )),
            since_rolled_back: false,
            rec_id: None,
        });
        let m = f.model();
        let e = &m.chronology.entries[0];
        assert_eq!(e.observed_at, "2026-08-20T00:00:00Z");
        assert_eq!(e.class, EvidenceClass::RecordedHistorically);
        // The uncertainty WINDOW survives — the exact moment was never witnessed.
        assert!(e.observed_between.is_some());
        assert_eq!(e.scope, EventScope::Observed);
        assert!(m.chronology.causation_note.contains("never implies causation"));
    }

    // ── 3. A missing fact becomes an explicit Unknown with a reason ───────

    #[test]
    fn missing_facts_become_explicit_unknowns_with_reasons() {
        let mut f = Fixture::new();
        f.hardware.windows_version = None;
        f.fingerprint = fp("", "", 0, "", "");
        let m = f.model();

        for fact_is_unknown in [
            m.identity.gpu.is_unknown(),
            m.identity.gpu_driver.is_unknown(),
            m.identity.display.is_unknown(),
            m.identity.ram_gb.is_unknown(),
            m.identity.windows.is_unknown(),
            m.identity.rig_hash.is_unknown(),
        ] {
            assert!(fact_is_unknown);
        }
        // Unknown means NO value and a NAMED reason — never a plausible-looking blank.
        assert!(m.identity.gpu.value.is_none());
        assert!(m.identity.gpu.unknown_reason.is_some());
        assert!(m.identity.ram_gb.value.is_none());
        assert_eq!(m.identity.windows.freshness, Freshness::NotApplicable);

        // Every unknown is collected under answer D so a consumer never has to hunt.
        let fields: Vec<&str> = m.evidence.unknowns.iter().map(|u| u.field.as_str()).collect();
        assert!(fields.contains(&"identity.windows"));
        assert!(fields.contains(&"identity.gpu"));
        assert!(m.evidence.unknowns.iter().all(|u| !u.reason.is_empty()));
        assert!(m.evidence.classes_present.contains(&EvidenceClass::Unavailable));
    }

    #[test]
    fn an_empty_probe_result_is_never_reported_as_a_known_empty_value() {
        let f = cached_str("", PRODUCER_HARDWARE, "probe returned nothing");
        assert!(f.is_unknown());
        assert!(f.value.is_none());
    }

    // ── 4. Disagreeing identity producers produce a REPORT, not a winner ──

    #[test]
    fn disagreeing_identity_producers_are_reported_not_silently_resolved() {
        let mut f = Fixture::new();
        // The live read says the driver moved on; the recorded snapshot still says 25.5.1.
        f.fingerprint = fp("Radeon RX 9070 XT", "25.6.0", 32, "2560x1440@250", "def456");
        let m = f.model();

        let fields: Vec<&str> = m.identity.disagreements.iter().map(|d| d.field).collect();
        assert!(fields.contains(&"gpu_driver"), "driver disagreement must be reported");
        assert!(fields.contains(&"rig_hash"));

        let d = m
            .identity
            .disagreements
            .iter()
            .find(|d| d.field == "gpu_driver")
            .unwrap();
        // BOTH claims survive with their own provenance. Neither is overwritten.
        assert_eq!(d.left.producer, PRODUCER_HARDWARE);
        assert_eq!(d.left.value, "25.6.0");
        assert_eq!(d.right.producer, PRODUCER_SNAPSHOT);
        assert_eq!(d.right.value, "25.5.1");
        assert_eq!(d.right.observed_at.as_deref(), Some("2026-08-01T10:00:00Z"));
        // And the model says explicitly that a difference is not proof of an error.
        assert!(d.interpretation.contains("not that either producer is wrong"));
        // The canonical rule is stated rather than left for each consumer to re-invent.
        assert!(m.identity.canonical_rule.contains("canonical producer"));
        assert!(m.identity.contributing_producers.contains(&PRODUCER_SNAPSHOT));
        // The fifth fingerprint is named as excluded, with a reason, not silently dropped.
        assert!(m
            .identity
            .excluded_producers
            .iter()
            .any(|e| e.producer == "game_state::GameStateFingerprint"));
    }

    #[test]
    fn a_failed_probe_on_one_side_is_not_a_disagreement() {
        let mut f = Fixture::new();
        f.fingerprint = fp("", "", 32, "2560x1440@250", "abc123");
        let m = f.model();
        assert!(
            !m.identity.disagreements.iter().any(|d| d.field == "gpu"),
            "an empty probe result is missing data, never evidence that the GPU changed"
        );
    }

    #[test]
    fn ram_rounding_conventions_do_not_read_as_a_hardware_disagreement() {
        let mut f = Fixture::new();
        // hardware rounds GiB (32), hwchange truncates (31). Same machine, different convention.
        f.baseline = Some(crate::hwchange::test_fingerprint(
            "AMD Ryzen 7 7800X3D",
            &["Radeon RX 9070 XT"],
            31,
        ));
        assert!(
            !f.model().identity.disagreements.iter().any(|d| d.field == "ram_gb"),
            "a 1 GB unit-convention gap must not be reported as a disagreement"
        );

        // A real 16 GB difference IS reported.
        f.baseline = Some(crate::hwchange::test_fingerprint(
            "AMD Ryzen 7 7800X3D",
            &["Radeon RX 9070 XT"],
            16,
        ));
        let m = f.model();
        let d = m
            .identity
            .disagreements
            .iter()
            .find(|d| d.field == "ram_gb")
            .expect("a 16 GB gap is a real disagreement");
        assert_eq!(d.right.producer, PRODUCER_HWCHANGE);
        assert!(d.interpretation.contains("rounding conventions"));
    }

    // ── 5. Active / rolled back / not-on-this-rig stay distinguishable ────

    #[test]
    fn compy_history_distinguishes_active_rolled_back_and_other_rig() {
        let mut f = Fixture::new();
        f.changes = vec![
            crate::history::test_view(
                "a",
                "game-mode",
                "Enable Game Mode",
                "2026-07-01T00:00:00Z",
                "applied",
                true,
                Some(true),
                None,
                true,
            ),
            crate::history::test_view(
                "b",
                "hags-enable",
                "Enable HAGS",
                "2026-07-02T00:00:00Z",
                "rolled_back",
                false,
                Some(true),
                Some("2026-07-03T00:00:00Z".into()),
                true,
            ),
            crate::history::test_view(
                "c",
                "nagle-disable",
                "Disable Nagle",
                "2026-07-03T00:00:00Z",
                "applied",
                true,
                Some(false),
                None,
                true,
            ),
            crate::history::test_view(
                "d",
                "mouse-accel-off",
                "Turn off mouse acceleration",
                "2026-07-04T00:00:00Z",
                "applied",
                false,
                None,
                None,
                false,
            ),
        ];
        let m = f.model();
        let t = &m.compy_changes;
        assert_eq!(t.total_recorded, 4);
        // Rows "a" (this rig) and "c" (another rig) both read as in effect. Only "a" is Compy's
        // change on THIS PC. Before the #385 review both were counted as `active_now`.
        assert_eq!(t.active_now, 1);
        assert_eq!(t.in_effect_other_rig, 1);
        assert_eq!(t.in_effect_rig_unknown, 0);
        assert_eq!(t.in_effect_total, 2);
        assert_eq!(t.rolled_back, 1);
        assert_eq!(t.not_on_this_rig, 1);
        assert_eq!(t.rig_unknown, 1);
        // "Applied, but something outside Compy reverted it" is its own state, not a rollback.
        assert_eq!(t.applied_but_not_in_effect, 1);

        let by_id = |id: &str| t.changes.iter().find(|c| c.id == id).unwrap();
        let b = by_id("b");
        assert_eq!(b.status.value.as_deref(), Some("rolled_back"));
        // The ledger's own word survives; the model classes the fact without replacing it.
        assert_eq!(
            b.status.domain.as_ref().map(|d| d.vocabulary),
            Some("history::AppliedChange.status")
        );
        assert_eq!(b.rolled_back_at.value.as_deref(), Some("2026-07-03T00:00:00Z"));
        // A rollback is REPRESENTED. The row does not disappear from history.
        assert!(t.changes.iter().any(|c| c.id == "b"));
        // A row that predates rig stamping stays honestly unknown, never assumed to be this rig.
        assert!(by_id("d").on_this_rig.is_unknown());
        assert!(by_id("d").reversible.value == Some(false));
        // "still active" is a LIVE re-check, so it is classed differently from the stored status.
        assert_eq!(by_id("a").still_active.class, EvidenceClass::DirectlyObserved);
        assert_eq!(by_id("a").status.class, EvidenceClass::RecordedHistorically);
    }

    #[test]
    fn an_undated_rollback_is_unknown_rather_than_retro_dated() {
        let mut f = Fixture::new();
        f.changes.push(crate::history::test_view(
            "old",
            "sysmain-disable",
            "Disable SysMain",
            "2026-01-01T00:00:00Z",
            "rolled_back",
            false,
            Some(true),
            None,
            true,
        ));
        let m = f.model();
        let c = &m.compy_changes.changes[0];
        assert!(c.rolled_back_at.is_unknown());
        assert!(c.rolled_back_at.value.is_none());
        assert!(c.rolled_back_at.unknown_reason.as_deref().unwrap().contains("unknown"));
        assert!(m
            .evidence
            .unknowns
            .iter()
            .any(|u| u.field == "compy_changes[old].rolled_back_at"));
    }

    // -- 5b. The four HQ review repairs, each with its own falsifiable proof (#385) --

    /// REPAIR 1. `NotApplicable` means "there is no value". A record Compy really holds, whose row
    /// simply carries no date, HAS a value -- so giving it that freshness let a known historical
    /// fact be read as an absence. It now has a state of its own.
    #[test]
    fn a_known_historical_fact_never_carries_the_absent_facts_freshness() {
        let undated: Fact<String> = Fact::known_undated("applied".into(), PRODUCER_LEDGER);
        assert_eq!(undated.value.as_deref(), Some("applied"));
        assert_eq!(undated.class, EvidenceClass::RecordedHistorically);
        assert_eq!(undated.freshness, Freshness::UndatedHistorical);
        assert_ne!(
            undated.freshness,
            Freshness::NotApplicable,
            "a fact that HAS a value must not share a freshness state with facts that have none"
        );
        assert!(!undated.is_unknown());
        assert!(!undated.is_not_applicable());

        // And the two absent kinds keep NotApplicable, which is now only theirs.
        assert_eq!(
            Fact::<String>::unknown(PRODUCER_LEDGER, "why").freshness,
            Freshness::NotApplicable
        );
        assert_eq!(
            Fact::<String>::not_applicable(PRODUCER_LEDGER, "why").freshness,
            Freshness::NotApplicable
        );

        // End to end: an undated ledger row reaches the model as undated-historical, and is
        // rolled up as unstamped -- a consumer must not read it as re-read at build time.
        let mut f = Fixture::new();
        f.changes.push(crate::history::test_view(
            "undated", "game-mode", "Enable Game Mode", "", "applied", true, Some(true), None, true,
        ));
        let m = f.model();
        let c = &m.compy_changes.changes[0];
        assert_eq!(c.status.value.as_deref(), Some("applied"));
        assert_eq!(c.status.freshness, Freshness::UndatedHistorical);
        assert_eq!(c.reversible.freshness, Freshness::UndatedHistorical);
        let ev = m
            .evidence
            .answers
            .iter()
            .find(|a| a.answer == "What did Compy change?")
            .unwrap();
        assert!(
            ev.unstamped_facts >= 2,
            "undated historical facts are unstamped, not timeless"
        );
    }

    /// REPAIR 2. A change that was never rolled back has no rollback time to be MISSING. Counting
    /// it as unknown both invented an evidence gap and put a number in the roll-up with no
    /// matching entry in the unknown list.
    #[test]
    fn a_change_never_rolled_back_has_no_rollback_time_to_be_missing() {
        let mut f = Fixture::new();
        f.changes.push(crate::history::test_view(
            "active", "game-mode", "Enable Game Mode", "2026-07-01T00:00:00Z", "applied", true,
            Some(true), None, true,
        ));
        let m = f.model();
        let c = &m.compy_changes.changes[0];

        assert!(c.rolled_back_at.is_not_applicable());
        assert!(
            !c.rolled_back_at.is_unknown(),
            "not-applicable is not a missing fact"
        );
        assert!(c.rolled_back_at.value.is_none());
        assert!(c.rolled_back_at.unknown_reason.is_none());
        assert!(c
            .rolled_back_at
            .not_applicable_reason
            .as_deref()
            .unwrap()
            .contains("has not been rolled back"));

        // It must not appear in the unknown list, and must not inflate the unknown count.
        assert!(
            !m.evidence
                .unknowns
                .iter()
                .any(|u| u.field == "compy_changes[active].rolled_back_at"),
            "a field that cannot apply is not evidence Compy failed to gather"
        );
        let ev = m
            .evidence
            .answers
            .iter()
            .find(|a| a.answer == "What did Compy change?")
            .unwrap();
        assert_eq!(ev.not_applicable_facts, 1);
        assert_eq!(ev.unknown_facts, 0);
        // ... and it contributes no evidence class, so nothing reads as unavailable.
        assert!(!ev.classes.contains(&EvidenceClass::Unavailable));

        // A change that WAS rolled back with no stamp stays a genuine unknown -- the two are
        // distinguished, not merged. Falsifies "everything absent became not-applicable".
        let mut g = Fixture::new();
        g.changes.push(crate::history::test_view(
            "old", "sysmain-disable", "Disable SysMain", "2026-01-01T00:00:00Z", "rolled_back",
            false, Some(true), None, true,
        ));
        let gm = g.model();
        assert!(gm.compy_changes.changes[0].rolled_back_at.is_unknown());
        assert!(!gm.compy_changes.changes[0].rolled_back_at.is_not_applicable());
    }

    /// REPAIR 2, the other half: the roll-up's unknown COUNT and the explicit unknown LIST are
    /// produced by one pass, so they cannot disagree. They did.
    #[test]
    fn the_unknown_counts_and_the_explicit_unknown_list_always_agree() {
        let mut hostile = Fixture::new();
        // Every identity probe failed, an undated row, an unstamped rollback, an unattributed
        // row: as many absences of as many kinds as the model can hold at once.
        hostile.hardware.windows_version = None;
        hostile.fingerprint = fp("", "", 0, "", "");
        hostile.changes = vec![
            crate::history::test_view("u1", "a", "A", "", "applied", true, None, None, false),
            crate::history::test_view(
                "u2", "b", "B", "2026-02-02T00:00:00Z", "rolled_back", false, Some(false), None,
                true,
            ),
            crate::history::test_view(
                "u3", "c", "C", "2026-03-03T00:00:00Z", "applied", false, Some(true), None, true,
            ),
        ];

        for (i, f) in [Fixture::new(), hostile].iter().enumerate() {
            let m = f.model();
            let counted: usize = m.evidence.answers.iter().map(|a| a.unknown_facts).sum();
            assert_eq!(
                counted,
                m.evidence.unknowns.len(),
                "case {i}: the unknown count and the unknown list must be the same evidence"
            );
            assert!(m.evidence.unknowns.iter().all(|u| !u.reason.is_empty()));

            // Every fact is in exactly one of the three states, never a fourth.
            for c in &m.compy_changes.changes {
                for ok in [
                    c.applied_at.absence_is_well_formed(),
                    c.status.absence_is_well_formed(),
                    c.still_active.absence_is_well_formed(),
                    c.rolled_back_at.absence_is_well_formed(),
                    c.on_this_rig.absence_is_well_formed(),
                    c.reversible.absence_is_well_formed(),
                ] {
                    assert!(ok, "case {i}: a fact has a value, a reason, or a non-applicability");
                }
            }
            for ok in [
                m.identity.cpu.absence_is_well_formed(),
                m.identity.gpu.absence_is_well_formed(),
                m.identity.gpu_driver.absence_is_well_formed(),
                m.identity.ram_gb.absence_is_well_formed(),
                m.identity.display.absence_is_well_formed(),
                m.identity.windows.absence_is_well_formed(),
                m.identity.rig_hash.absence_is_well_formed(),
            ] {
                assert!(ok, "case {i}: identity facts obey the same three-state rule");
            }
        }
    }

    /// REPAIR 3. `is_still_active` re-checks the LIVE machine, so it proves a setting is in
    /// effect here. It never proves Compy applied it here. Counting an other-rig or unstamped row
    /// as `active_now` claimed exactly that.
    #[test]
    fn active_now_never_claims_an_other_rig_or_unattributed_row_was_applied_here() {
        let mut f = Fixture::new();
        f.changes = vec![
            // In effect, and same_rig matched: the one row Compy may claim for this PC.
            crate::history::test_view(
                "mine", "game-mode", "Enable Game Mode", "2026-07-01T00:00:00Z", "applied", true,
                Some(true), None, true,
            ),
            // In effect, but stamped for a DIFFERENT rig.
            crate::history::test_view(
                "elsewhere", "nagle-disable", "Disable Nagle", "2026-07-02T00:00:00Z", "applied",
                true, Some(false), None, true,
            ),
            // In effect, but written before rig stamping: attribution unknown, not "this PC".
            crate::history::test_view(
                "unstamped", "hags-enable", "Enable HAGS", "2026-07-03T00:00:00Z", "applied", true,
                None, None, true,
            ),
            // Applied here and reverted outside Compy: in NO in-effect bucket.
            crate::history::test_view(
                "reverted", "mouse-accel-off", "Turn off mouse acceleration",
                "2026-07-04T00:00:00Z", "applied", false, Some(true), None, true,
            ),
            crate::history::test_view(
                "undone", "sysmain-disable", "Disable SysMain", "2026-07-05T00:00:00Z",
                "rolled_back", false, Some(true), Some("2026-07-06T00:00:00Z".into()), true,
            ),
        ];
        let t = &f.model().compy_changes;

        assert_eq!(t.active_now, 1, "only the row same_rig matched may be claimed for this PC");
        assert_eq!(t.in_effect_other_rig, 1);
        assert_eq!(t.in_effect_rig_unknown, 1);
        assert_eq!(t.in_effect_total, 3);
        assert_eq!(
            t.active_now + t.in_effect_other_rig + t.in_effect_rig_unknown,
            t.in_effect_total,
            "the three attributions partition the in-effect rows exactly"
        );
        // The whole ledger still partitions: in effect + reverted outside + rolled back.
        assert_eq!(
            t.in_effect_total + t.applied_but_not_in_effect + t.rolled_back,
            t.total_recorded
        );
        assert_eq!(t.total_recorded, 5);
        assert_eq!(t.applied_but_not_in_effect, 1);
        assert_eq!(t.rolled_back, 1);
        // Whole-ledger rig attribution is unchanged and still covers every row.
        assert_eq!(t.not_on_this_rig, 1);
        assert_eq!(t.rig_unknown, 1);

        // The rows themselves keep their own attribution, so a consumer can check the counts.
        let by_id = |id: &str| t.changes.iter().find(|c| c.id == id).unwrap();
        assert_eq!(by_id("elsewhere").on_this_rig.value, Some(false));
        assert!(by_id("unstamped").on_this_rig.is_unknown());
        assert!(by_id("elsewhere").still_active.value == Some(true));
    }

    /// REPAIR 4. "History starts" is the earliest evidence Compy STILL RETAINS. Deriving it from
    /// the first identity snapshot dated history later than records already in hand.
    #[test]
    fn history_starts_at_the_earliest_retained_evidence_not_the_first_identity_snapshot() {
        let mut f = Fixture::new();
        // The first identity snapshot is 2026-08-01 (from Fixture::new). A ledger row and a
        // timeline event both predate it, and the ledger row is the oldest thing retained.
        f.changes.push(crate::history::test_view(
            "old", "game-mode", "Enable Game Mode", "2026-05-01T00:00:00Z", "applied", true,
            Some(true), None, true,
        ));
        f.timeline.push(crate::intelligence::EventRecord {
            id: "applied:old".into(),
            timestamp: "2026-06-15T00:00:00Z".into(),
            event_type: "change-applied".into(),
            source: "history".into(),
            scope: EventScope::CompyApplied,
            game: None,
            summary: "Enable Game Mode".into(),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: Some("game-mode".into()),
        });
        let m = f.model();

        assert_eq!(
            m.chronology.recorded_from.as_deref(),
            Some("2026-05-01T00:00:00Z"),
            "retained ledger evidence predates the first identity snapshot and bounds history"
        );
        assert_eq!(m.chronology.recorded_from_source, Some(PRODUCER_LEDGER));
        assert_ne!(
            m.chronology.recorded_from.as_deref(),
            m.chronology.identity_history_from.as_deref(),
            "the boundary must not silently be the identity-snapshot date"
        );
        // The narrower identity-only question keeps its own honest answer.
        assert_eq!(
            m.chronology.identity_history_from.as_deref(),
            Some("2026-08-01T10:00:00Z")
        );

        // Drop the ledger row: the timeline event is now the oldest retained evidence, and the
        // named source moves with it. Falsifies "the source label is hardcoded".
        f.changes.clear();
        let m = f.model();
        assert_eq!(m.chronology.recorded_from.as_deref(), Some("2026-06-15T00:00:00Z"));
        assert_eq!(m.chronology.recorded_from_source, Some(PRODUCER_TIMELINE));

        // Drop that too, and identity snapshots are legitimately the earliest thing retained.
        f.timeline.clear();
        let m = f.model();
        assert_eq!(m.chronology.recorded_from.as_deref(), Some("2026-08-01T10:00:00Z"));
        assert_eq!(m.chronology.recorded_from_source, Some(PRODUCER_SNAPSHOT));

        // An undated ledger row can bound nothing, and must not erase a real boundary.
        f.changes.push(crate::history::test_view(
            "undated", "hags-enable", "Enable HAGS", "", "applied", true, Some(true), None, true,
        ));
        let m = f.model();
        assert_eq!(m.chronology.recorded_from.as_deref(), Some("2026-08-01T10:00:00Z"));
        assert_eq!(m.chronology.recorded_from_source, Some(PRODUCER_SNAPSHOT));

        // Nothing retained at all: no boundary is invented, and no source is named.
        f.changes.clear();
        f.snapshots.clear();
        let m = f.model();
        assert!(m.chronology.recorded_from.is_none());
        assert!(m.chronology.recorded_from_source.is_none());
        assert!(m.chronology.identity_history_from.is_none());
    }

    // ── 6. Composition performs no write, persistence or mutation ─────────

    #[test]
    fn composition_module_contains_no_write_or_mutation_call() {
        // compose() takes only borrowed data and returns a value, so it CANNOT write. This guards
        // the rest of the module against acquiring a writer later.
        //
        // Every needle is ASSEMBLED at runtime rather than written as a literal: a scanner that
        // matches its own source is a scanner that can never fail, and a check that cannot fail is
        // not evidence. Reconstructing them keeps the only occurrences in this file real ones.
        let joined = |a: &str, b: &str| format!("{a}::{b}");
        let banned: Vec<(String, usize)> = vec![
            (joined("fs", "write"), 0),
            (joined("fs", "create_dir"), 0),
            (joined("fs", "remove_file"), 0),
            (format!("save_{}", "store_to"), 0),
            (format!("save_{}", "history"), 0),
            (format!("write_{}", "fingerprint"), 0),
            (format!("apply_{}", "recommendation"), 0),
            (format!("rollback_{}", "change"), 0),
            (joined("crate", "actions"), 0),
            (format!("record_identity_{}", "snapshot_now"), 0),
            (format!("refresh_identity_{}", "snapshots_async"), 0),
            (format!("{}_elevated_powershell", "run"), 0),
            (format!("acknowledge_hardware_{}", "changes"), 0),
            // build()'s doc comment names the two WRITING variants it deliberately does not call.
            // Exactly one mention each: prose. A second would be a call.
            (format!("get_intelligence_{}", "timeline"), 1),
            (format!("get_hardware_{}", "changes"), 1),
        ];
        for (needle, allowed) in banned {
            let hits = OWN_SOURCE.match_indices(needle.as_str()).count();
            assert_eq!(
                hits, allowed,
                "machine_model.rs must not reference {needle} outside its documented avoidance note"
            );
        }
    }

    #[test]
    fn composing_twice_from_the_same_inputs_yields_the_same_model() {
        let f = Fixture::new();
        let a = serde_json::to_string(&f.model()).unwrap();
        let b = serde_json::to_string(&f.model()).unwrap();
        assert_eq!(a, b, "composition is a pure function of its inputs");
    }

    // ── 7. The command and the diagnostics section share ONE model ────────

    #[test]
    fn the_diagnostics_section_renders_the_same_model_the_command_returns() {
        let mut f = Fixture::new();
        f.changes.push(crate::history::test_view(
            "a",
            "game-mode",
            "Enable Game Mode",
            "2026-07-01T00:00:00Z",
            "applied",
            true,
            Some(true),
            None,
            true,
        ));
        let m = f.model();
        let section = crate::diagnostics::machine_model_section(&m);
        let rendered = serde_json::to_string(&section).unwrap();

        // The section is a pure render of &MachineModel, so it cannot be a second implementation.
        // Every value it shows has to trace back to the model it was handed.
        assert!(rendered.contains(m.identity.gpu.value.as_deref().unwrap()));
        assert!(rendered.contains(m.identity.rig_hash.value.as_deref().unwrap()));
        assert!(rendered.contains(&m.compy_changes.active_now.to_string()));
        assert!(rendered.contains(&m.built_at));
    }

    // ── 8. Existing producers keep their own vocabularies ─────────────────

    #[test]
    fn the_model_maps_existing_vocabularies_rather_than_replacing_them() {
        // The six classes are the MACHINE_MODEL.md §3 list, exactly.
        assert_eq!(ALL_EVIDENCE_CLASSES.len(), 6);
        // And the domain enums this slice does NOT touch still exist with their own meanings.
        assert_eq!(
            crate::intelligence::Confidence::High.max(crate::intelligence::Confidence::Low),
            crate::intelligence::Confidence::High,
            "intelligence::Confidence keeps its own ranking order"
        );
        let m = Fixture::new().model();
        assert_eq!(m.schema_version, SCHEMA_VERSION);
        // Nothing in v1 is user-declared, and the model does not pretend otherwise.
        assert!(!m.evidence.classes_present.contains(&EvidenceClass::UserDeclared));
    }

    #[test]
    fn an_empty_machine_still_answers_all_four_questions_honestly() {
        let mut f = Fixture::new();
        f.snapshots.clear();
        let m = f.model();
        assert!(m.chronology.recorded_from.is_none());
        assert_eq!(m.chronology.identity_snapshots, 0);
        assert!(m.chronology.unknown_reason.is_some());
        assert_eq!(m.compy_changes.total_recorded, 0);
        assert_eq!(m.evidence.answers.len(), 3);
        // An empty record is reported as an unknown, never as "nothing changed".
        assert!(m
            .evidence
            .unknowns
            .iter()
            .any(|u| u.field == "chronology.entries"));
    }
}
