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
use crate::history::{ActiveCheck, AppliedChangeView};
use crate::hwchange::HardwareFingerprint;
use crate::intelligence::{EventScope, IdentitySnapshot};

/// Bumped only when a consumer would read an existing field differently.
pub(crate) const SCHEMA_VERSION: u32 = 1;

/// Chronology entries returned PER SCOPE THAT HAS ITS OWN SURFACE. Bounded on purpose —
/// MACHINE_MODEL.md §9 forbids turning the model into a telemetry lake, and a consumer that needs
/// the full history reads the timeline directly.
///
/// [`EventScope::Observed`] is exempt (#450) — bounded only by the sanity ceiling
/// [`MAX_OBSERVED_CHRONOLOGY`] (#456). Compy-applied and measurement events are each shown
/// by a surface that reads its own store in full (the Trust Ledger, the session record), so a cap
/// on the model's copy of them hides nothing. Observed changes have no other store: the History
/// tape is the only place they are ever shown, and it read them uncapped off the intelligence
/// timeline before it read them here — so capping them would silently shorten the record of what
/// happened to this machine.
const MAX_CHRONOLOGY: usize = 25;
/// Compy-change rows returned. Same bound, same reason. The COUNTS above them are never truncated,
/// and neither is the evidence pass: this caps what is SHOWN, never what is accounted for.
const MAX_CHANGES: usize = 25;
/// Observed rows the identity-snapshot store can put on the timeline at its retention limit:
/// [`crate::intelligence::MAX_IDENTITY_SNAPSHOTS`] readings ×
/// [`crate::intelligence::OBSERVED_KINDS_PER_READING`] kinds per reading. Written out as a literal
/// rather than derived so that a retention change cannot grow every `get_machine_model` payload
/// unnoticed: `the_observed_ceiling_is_tied_to_identity_snapshot_retention` fails until whoever
/// moved one constant moves the other on purpose (#456).
const IDENTITY_STREAM_OBSERVED_ROWS: usize = 2_000;
/// Room above that stream for the observed rows no snapshot count bounds: rig-fingerprint shifts
/// stamped on sessions (at most [`crate::sessions::MAX_SESSIONS`] prints × two kinds — the
/// fingerprint carries no Windows or power-plan field) and on ledger applies, plus active Drift
/// Watch notices. Applies and notices have no numeric cap, but each adds a row only when the rig
/// or a readiness state actually changed between two records — for the ledger that is proven,
/// not assumed: `ledger_applies_at_a_constant_rig_put_no_observed_rows_on_the_tape` and
/// `observed_rows_under_the_ledger_track_rig_flips_not_apply_count` (#506) — so this margin is
/// generous for any store that grew honestly.
const OBSERVED_CHRONOLOGY_HEADROOM: usize = 500;
/// The sanity ceiling on the observed-scope exemption (#456). Observed rows travel past
/// [`MAX_CHRONOLOGY`] because the History tape is their only surface — but "uncapped" still has
/// to be finite at THIS layer, because every `get_machine_model` payload carries them whether or
/// not the caller wants the tape. It sits above what the retained stores can produce
/// (`a_full_identity_store_never_reaches_the_observed_ceiling`), so it never shortens the tape
/// for a store the producers can hold. The realistic way to reach it is slow, legitimate growth:
/// a long-lived install whose rig genuinely changed more times than the headroom holds, across
/// ledger applies (no retention cap ever ages those out, though each real change is one or two
/// rows and an apply on an unchanged rig is none — see the two tests above) and sessions. A
/// corrupt or hand-edited store is the other way there. When it does bind, the OLDEST observed
/// rows drop off the shown list, `total_events` still counts them, and the tape starts later
/// rather than lying.
pub(crate) const MAX_OBSERVED_CHRONOLOGY: usize =
    IDENTITY_STREAM_OBSERVED_ROWS + OBSERVED_CHRONOLOGY_HEADROOM;

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
pub(crate) const PRODUCER_ACTIVE_CHECK: &str = "history::check_change_state";
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

/// One identity field a comparison ACTUALLY RAN over: today's live reading held a value, and the
/// named second producer held one to check it against.
///
/// This list exists because an empty [`MachineIdentity::disagreements`] is ambiguous on its own.
/// It is produced in two completely different situations: every compared field agreed, or NOTHING
/// WAS COMPARED — a fresh machine with no stamped identity snapshot and no acknowledged hardware
/// baseline has no second reading to differ from, and a snapshot whose fields all read empty is a
/// failed probe rather than a comparison. Rendering that absence as "No, they agree" turns missing
/// comparative evidence into a passing result (#385 review). `compared_fields` is what separates
/// the two cases: agreement may only be claimed when this list is non-empty, and it names exactly
/// which fields the claim covers.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct ComparedField {
    pub field: &'static str,
    /// The producer today's live reading was checked against.
    pub against: &'static str,
}

/// The outcome of the identity cross-check: what was compared, and where it differed. Returned as
/// one value so the two can never be gathered by separate passes and drift apart — the same reason
/// [`compose_evidence`] builds the unknown list and the unknown counts together.
pub(crate) struct IdentityComparison {
    pub compared_fields: Vec<ComparedField>,
    pub disagreements: Vec<IdentityDisagreement>,
}

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
    /// Every field a real comparison ran over, and which producer it ran against. Read this BEFORE
    /// [`Self::disagreements`]: an empty `disagreements` is only a finding when this list is
    /// non-empty. Empty here means nothing was compared at all, which is an absence of comparative
    /// evidence and must never be presented as agreement (#385 review).
    pub compared_fields: Vec<ComparedField>,
    /// Where the compared producers differ. Empty means they agreed ON THE FIELDS NAMED IN
    /// [`Self::compared_fields`] — and, when that list is empty, means only that there was nothing
    /// to disagree about. It is never on its own a claim that the producers agree.
    pub disagreements: Vec<IdentityDisagreement>,
}

// ─── B. What recently changed? ───────────────────────────────────────────

/// One entry of the recorded chronology, copied off the existing timeline assembler.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct ChronologyEntry {
    /// The SOURCE record's own id, copied from `intelligence::EventRecord::id` and never
    /// re-derived. It is the row key a view keys its list on, so two entries that share a
    /// timestamp stay distinguishable (#450).
    pub id: String,
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

/// Answer B: the supplied chronology, not every history source Compy retains.
/// The production build assembles it from every producer the intelligence timeline consults
/// (#393): the Trust Ledger, monitored sessions, the live Gaming Mode slot, the scoreboard, the
/// Lab baseline, the latest A/B comparison, identity snapshots and drift notices. Coverage travels
/// with the serialized answer so totals and time boundaries say what the view holds. Single-slot
/// producers (Gaming Mode slot, Lab baseline, A/B comparison) contribute their CURRENT record only:
/// overwritten history is gone and is never reconstructed.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct ChangeChronology {
    /// The earliest evidence in the supplied sources: the
    /// identity snapshots, the assembled timeline, and dated Trust-Ledger rows. Deriving it from
    /// identity snapshots alone dated "history starts" later than evidence already in hand, which
    /// would report a machine as unrecorded during a period Compy can still show (#385 review).
    /// Undated records are not candidates (see [`earliest_retained_evidence`]), so this bounds the
    /// DATED evidence only. It is not a claim that nothing earlier is retained, still less that
    /// nothing changed before it (#385 review).
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
    /// Explicit production producer scope, tied to the wiring by test rather than by prose; also
    /// rendered beside counts and newest/oldest dates.
    pub coverage_note: &'static str,
    /// Newest first. Capped at [`MAX_CHRONOLOGY`] for DISPLAY only, and only for the scopes another
    /// surface shows in full — every [`EventScope::Observed`] entry travels, because the History
    /// tape is their only surface (#450). `total_events` and
    /// `recorded_from` above cover the whole supplied record, and so does the evidence pass:
    /// [`compose_evidence`] walks the uncapped projection, never this list, so Answer B's span can
    /// never be narrower than the boundary reported beside it (#385 review).
    pub entries: Vec<ChronologyEntry>,
    /// Source records whose timestamps did not parse. Dropped, never guessed at.
    pub dropped_unparseable: usize,
    pub causation_note: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown_reason: Option<String>,
}

const CAUSATION_NOTE: &str = "Chronology never implies causation by itself. These entries say what was recorded and when, not what caused what.";
const CHRONOLOGY_COVERAGE: &str = "This view includes Compy-applied changes, monitored sessions, the live Gaming Mode slot, verified wins, the current Lab baseline, the latest A/B comparison, identity snapshots and drift notices. Single-slot sources show their current record only.";
const CHRONOLOGY_EMPTY: &str = "No events are recorded in this view. An empty view is not evidence that nothing changed or that other history is empty.";
const LEDGER_EMPTY: &str = "The Trust Ledger has no rows, so Compy has recorded no change on this machine.";
/// Prefix for an UNREADABLE ledger. An unreadable ledger is not an empty one: every count below is
/// unknown, not zero, and the load error rides along so the reason is checkable (#446).
const LEDGER_UNREADABLE: &str = "The Trust Ledger could not be read, so what Compy changed on this machine is unknown, not zero.";
const CHRONOLOGY_LEDGER_UNREADABLE: &str = "The Trust Ledger could not be read, so Compy-applied changes are missing from this view.";

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
    /// CHANGES (one per `rec_id`, not ledger rows) whose live check on this machine reads On. This
    /// is the ONLY count that may be read as "Compy's change is in effect on this PC now", and it is
    /// the number Health, Optimize ("Active on this PC") and History all print (#453). The live
    /// read is taken here, so a row stamped for another rig or written before rig stamping is
    /// still counted when it reads On: the stamp is attribution, carried below, never a reason to
    /// drop an active change. Counting rows and requiring a matching stamp put Health at 13 against
    /// Optimize's 14 on the owner's PC.
    pub active_now: usize,
    /// Of `active_now`, the changes whose newest live row is stamped for a DIFFERENT rig. They read
    /// On here; the stamp says the apply Compy recorded happened elsewhere.
    pub in_effect_other_rig: usize,
    /// Of `active_now`, the changes whose newest live row predates rig stamping, so which machine
    /// Compy applied it on is unknown. An attribution gap, not a doubt that it is on.
    pub in_effect_rig_unknown: usize,
    /// Equal to `active_now` since #453 (in effect here, whoever applied it and wherever). Kept on
    /// the wire so existing readers do not break; `in_effect_other_rig` and `in_effect_rig_unknown`
    /// are subsets of it, not addends.
    pub in_effect_total: usize,
    /// CHANGES (one per `rec_id`) still recorded as applied, none of whose applied rows the live
    /// check reads as on or can't-confirm: the read came back OFF (something outside Compy reverted
    /// it) or nothing re-checks it. Distinct from a rollback Compy performed. Per change since #453,
    /// so `active_now + in_effect_unknown + applied_but_not_in_effect + rolled_back` is the number
    /// of distinct changes in the ledger.
    pub applied_but_not_in_effect: usize,
    /// CHANGES (one per `rec_id`) that are applied but whose live check established nothing: the
    /// probe could not read the machine, or Compy has no probe for this kind of change. Neither in
    /// effect nor reverted — the "can't confirm" group every screen shows apart (#392, #638, #453).
    pub in_effect_unknown: usize,
    /// CHANGES (one per `rec_id`) whose every ledger row is rolled back (#453: per change, not per
    /// row; a change rolled back and re-applied is counted by its applied state instead).
    pub rolled_back: usize,
    /// Stamped with a fingerprint `history::same_rig` matches to today's machine. Carried so a
    /// consumer rendering rig attribution can name the on-this-PC count instead of showing only
    /// the two complements and heading them as if they were it (#385 review).
    /// `on_this_rig + not_on_this_rig + rig_unknown == total_recorded`, always.
    pub on_this_rig: usize,
    /// Stamped with a fingerprint that `history::same_rig` does not match to today's machine.
    pub not_on_this_rig: usize,
    /// Written before rig stamping existed. Honestly unknown, never assumed to be this rig.
    pub rig_unknown: usize,
    /// Newest first, capped at [`MAX_CHANGES`] for DISPLAY only. The counts above cover every row,
    /// and so does the evidence pass: [`compose_evidence`] walks the uncapped projection, never this
    /// list, so a gap in a row too old to show still gets both counted and named (#385 review).
    pub changes: Vec<CompyChangeFact>,
    pub ledger_note: &'static str,
    /// Present exactly when the ledger could not be read. Every count above is then 0 because
    /// nothing was read, NOT because nothing was recorded, and a consumer must render it that way
    /// (#446).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ledger_unreadable: Option<String>,
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
    /// Oldest producer-stamped time contributing to this answer, computed over every contributing
    /// record — never over a list a display cap has already truncated (#385 review).
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
    /// The ledger load error, when the ledger could not be read. `applied_changes` is then empty
    /// because nothing was read, and composition must say so rather than report an empty ledger.
    pub ledger_error: Option<&'a str>,
    /// The chronology, already assembled by its canonical producer.
    pub timeline: &'a [crate::intelligence::EventRecord],
    pub timeline_dropped: usize,
    /// Injected so composition is deterministic under test and never reads a clock itself.
    pub built_at: String,
}

/// Compose the model. Pure: no I/O, no probe, no clock, no write.
pub(crate) fn compose(inp: &MachineModelInputs) -> MachineModel {
    let identity = compose_identity(inp);
    let (chronology, all_chronology) = compose_chronology(inp);
    let (compy_changes, all_change_facts) = compose_compy_changes(inp);
    // The unknown LIST and the unknown COUNTS are built by the same pass, deliberately. They were
    // built by two — scattered `note_unknown` calls and a separate tally — and drifted apart:
    // a fact could be counted as unknown and never listed, or listed and never counted (#385
    // review). One pass makes them agree by construction rather than by remembering to.
    let evidence = compose_evidence(
        &inp.built_at,
        inp.ledger_error,
        &identity,
        &chronology,
        &all_chronology,
        &all_change_facts,
    );

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
    let comparison = compare_identity_producers(inp);

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
        compared_fields: comparison.compared_fields,
        disagreements: comparison.disagreements,
    }
}

/// Report which identity fields were compared and where the contributing producers currently
/// differ. Pure and total: it never selects a winner, and it never reports a difference it cannot
/// attribute to a real comparison.
///
/// A field is COMPARED when both sides hold a value. An empty string or a zero RAM reading is a
/// failed probe, not a value — the same rule `intelligence::str_changed` applies when deciding
/// whether to record a snapshot at all — so such a field is neither a disagreement nor evidence of
/// agreement. Recording that distinction is the whole point: without it, "no snapshot and no
/// baseline exist" and "every compared field agreed" produce byte-identical output, and a consumer
/// reads a fresh machine as having passed a check that never ran (#385 review).
pub(crate) fn compare_identity_producers(inp: &MachineModelInputs) -> IdentityComparison {
    let mut out = Vec::new();
    let mut compared = Vec::new();
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
        // It is equally not evidence of AGREEMENT, so a field only enters `compared` when both
        // sides actually held a value to compare.
        let ran = |a: &str, b: &str| !a.is_empty() && !b.is_empty();
        for (field, a, b) in [
            ("gpu", fp.gpu.as_str(), snap.gpu.as_str()),
            ("gpu_driver", fp.gpu_driver.as_str(), snap.gpu_driver.as_str()),
            ("display", fp.display.as_str(), snap.display.as_str()),
            ("rig_hash", fp.hash.as_str(), snap.hw_hash.as_str()),
        ] {
            if !ran(a, b) {
                continue;
            }
            compared.push(ComparedField { field, against: PRODUCER_SNAPSHOT });
            if a != b {
                out.push(IdentityDisagreement {
                    field,
                    left: live(a),
                    right: recorded(b),
                    interpretation: DISAGREE_HISTORICAL,
                });
            }
        }
        if fp.ram_gb > 0 && snap.ram_gb > 0 {
            compared.push(ComparedField { field: "ram_gb", against: PRODUCER_SNAPSHOT });
            if fp.ram_gb != snap.ram_gb {
                out.push(IdentityDisagreement {
                    field: "ram_gb",
                    left: live(&fp.ram_gb.to_string()),
                    right: recorded(&snap.ram_gb.to_string()),
                    interpretation: DISAGREE_HISTORICAL,
                });
            }
        }
    }

    // 2) Live identity vs the hardware-change baseline the user last acknowledged.
    if let Some(base) = inp.hw_baseline {
        // The baseline is a PERSISTED record with no time in it, not something read this session.
        // `UnstampedCache` says "read now, no timestamp"; this is "recorded once, timeless", which
        // is exactly what `UndatedHistorical` means everywhere else in this file (#385 review).
        let baseline = |value: String| IdentityClaim {
            producer: PRODUCER_HWCHANGE,
            value,
            observed_at: None,
            freshness: Freshness::UndatedHistorical,
        };
        // The baseline records EVERY adapter, sorted, and `hwchange::diff_fingerprint` compares
        // the whole list. Checking only that the primary adapter appears in it let an added or
        // removed second GPU read as agreement here while hwchange reported "GPU changed" (#447).
        // The live list comes from hwchange's own reduction so both surfaces apply one rule.
        let live_gpus = crate::hwchange::fingerprint(inp.hardware).gpus;
        if !live_gpus.is_empty() && !base.gpus.is_empty() {
            compared.push(ComparedField { field: "gpu", against: PRODUCER_HWCHANGE });
            if live_gpus != base.gpus {
                out.push(IdentityDisagreement {
                    field: "gpu",
                    left: IdentityClaim {
                        producer: PRODUCER_HARDWARE_INFO,
                        value: live_gpus.join(", "),
                        observed_at: None,
                        freshness: Freshness::UnstampedCache,
                    },
                    right: baseline(base.gpus.join(", ")),
                    interpretation: DISAGREE_BASELINE,
                });
            }
        }
        // hardware rounds GiB, hwchange truncates. Reuse hwchange's own +/-1 tolerance rather than
        // inventing a second rule, so a rounding artefact never reads as a hardware disagreement.
        // The comparison still RAN — the tolerance decides the verdict, not whether it happened.
        if fp.ram_gb > 0 && base.ram_gb > 0 {
            compared.push(ComparedField { field: "ram_gb", against: PRODUCER_HWCHANGE });
            if u64::from(fp.ram_gb).abs_diff(base.ram_gb) > 1 {
                out.push(IdentityDisagreement {
                    field: "ram_gb",
                    left: live(&fp.ram_gb.to_string()),
                    right: baseline(base.ram_gb.to_string()),
                    interpretation: DISAGREE_UNITS,
                });
            }
        }
    }

    IdentityComparison { compared_fields: compared, disagreements: out }
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

/// Returns the wire struct AND the uncapped entry projection behind it, on the same contract as
/// [`compose_compy_changes`]: `entries` is capped for DISPLAY, while `recorded_from` and the
/// evidence pass both speak for the whole retained record. Handing [`compose_evidence`] the capped
/// list made Answer B report an oldest-evidence time NEWER than the model's own retained-history
/// boundary as soon as the record outgrew the cap — one model contradicting itself (#385 review).
fn compose_chronology(inp: &MachineModelInputs) -> (ChangeChronology, Vec<ChronologyEntry>) {
    let (recorded_from, recorded_from_source) = earliest_retained_evidence(inp);
    let identity_history_from = inp
        .identity_snapshots
        .iter()
        .map(|s| s.observed_at.as_str())
        .filter(|t| !t.is_empty())
        .min()
        .map(str::to_string);

    // An unreadable ledger leaves a hole in this view even when other producers filled it, so it
    // is named whether or not the timeline is empty (#446).
    let unknown_reason = match (inp.ledger_error, inp.timeline.is_empty()) {
        (Some(e), true) => Some(format!("{CHRONOLOGY_LEDGER_UNREADABLE} {CHRONOLOGY_EMPTY} ({e})")),
        (Some(e), false) => Some(format!("{CHRONOLOGY_LEDGER_UNREADABLE} ({e})")),
        (None, true) => Some(CHRONOLOGY_EMPTY.to_string()),
        (None, false) => None,
    };

    // The assembler emits ascending; consumers want newest first. Projected in full FIRST, so the
    // cap below is a display decision taken over a complete list rather than a limit baked into
    // the only projection that exists.
    let all_entries: Vec<ChronologyEntry> = inp
        .timeline
        .iter()
        .rev()
        .map(|e| ChronologyEntry {
            id: e.id.clone(),
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
    // The cap counts only the scopes another surface already shows in full; observed changes are
    // shown nowhere else, so they all travel (see [`MAX_CHRONOLOGY`]) — short of the sanity
    // ceiling [`MAX_OBSERVED_CHRONOLOGY`], which sits above what the retained stores can produce
    // and is reached only by slow legitimate growth on a long-lived install, or a corrupt store
    // (#456, #506). Order is untouched — the list stays newest-first with the capped scopes simply
    // thinning out at the tail, and should the ceiling ever bind it is the OLDEST observed rows
    // that fall off it.
    let mut capped_taken = 0usize;
    let mut observed_taken = 0usize;
    let entries: Vec<ChronologyEntry> = all_entries
        .iter()
        .filter(|e| {
            if e.scope == EventScope::Observed {
                observed_taken += 1;
                return observed_taken <= MAX_OBSERVED_CHRONOLOGY;
            }
            capped_taken += 1;
            capped_taken <= MAX_CHRONOLOGY
        })
        .cloned()
        .collect();

    (
        ChangeChronology {
            recorded_from,
            recorded_from_source,
            identity_history_from,
            identity_snapshots: inp.identity_snapshots.len(),
            total_events: inp.timeline.len(),
            coverage_note: CHRONOLOGY_COVERAGE,
            entries,
            dropped_unparseable: inp.timeline_dropped,
            causation_note: CAUSATION_NOTE,
            unknown_reason,
        },
        all_entries,
    )
}

/// Returns the wire struct AND the uncapped fact projection behind it. The struct's `changes` list
/// is capped for display; the evidence pass must still cover every row the counts cover, so the
/// full projection is handed to [`compose_evidence`] and dropped after (#385 review).
fn compose_compy_changes(inp: &MachineModelInputs) -> (CompyChangeTruth, Vec<CompyChangeFact>) {
    let mut on_this_rig = 0usize;
    let mut not_on_this_rig = 0usize;
    let mut rig_unknown = 0usize;

    // Rig attribution stays per ROW: it is a fact about each recorded apply.
    for c in inp.applied_changes {
        tally_rig_attribution(c.on_this_rig, &mut on_this_rig, &mut not_on_this_rig, &mut rig_unknown);
    }

    // What is in effect is counted per CHANGE, not per ledger row (#453). Game Mode applied eight
    // times is one change that is on, and the owner's ledger printed it as eight. The live check is
    // read on THIS machine, so a row that reads On is active here whatever its rig stamp says; a
    // missing stamp (a row older than rig stamping) is an attribution gap, never a reason to drop an
    // active change. Attribution is still carried: `in_effect_other_rig` / `in_effect_rig_unknown`
    // say how many of the active changes were stamped for another rig or not stamped at all.
    // `src/data/live-changes.ts` `liveChangeGroups` is the same rule for Optimize and History, and
    // `active_and_unknown_counts_match_the_shared_ts_fixture` pins both to one fixture.
    let live = live_change_groups(inp.applied_changes);
    let active_now = live.iter().filter(|c| c.active_check == Some(ActiveCheck::On)).count();
    let in_effect_unknown = live.len() - active_now;
    let in_effect_other_rig = live
        .iter()
        .filter(|c| c.active_check == Some(ActiveCheck::On) && c.on_this_rig == Some(false))
        .count();
    let in_effect_rig_unknown = live
        .iter()
        .filter(|c| c.active_check == Some(ActiveCheck::On) && c.on_this_rig.is_none())
        .count();
    // The rest of the per-change partition (#453 review): a change with no live row is "no longer
    // in effect" while any of its rows is still applied, and "rolled back" only when all of them are.
    let live_recs: std::collections::HashSet<&str> = live.iter().map(|c| c.rec_id.as_str()).collect();
    let mut applied_recs: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut all_recs: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for c in inp.applied_changes {
        all_recs.insert(c.rec_id.as_str());
        if c.status != "rolled_back" {
            applied_recs.insert(c.rec_id.as_str());
        }
    }
    let applied_but_not_in_effect = applied_recs.difference(&live_recs).count();
    let rolled_back = all_recs.len() - live_recs.len() - applied_but_not_in_effect;

    // EVERY row, newest first — deliberately NOT the capped display list. Capping here made the
    // evidence pass walk 25 rows while the counts above walked the whole ledger, so a ledger whose
    // newest 25 rows happen to be clean rendered "Evidence not available: None" beside a nonzero
    // unattributed count in the same section (#385 review).
    let all_facts: Vec<CompyChangeFact> = inp
        .applied_changes
        .iter()
        .rev()
        .map(|c| {
            let applied_at = if c.applied_at.is_empty() {
                Fact::unknown(
                    PRODUCER_LEDGER,
                    "This ledger row carries no apply time. It is not dated rather than dated now.",
                )
            } else {
                Fact::historical(c.applied_at.clone(), PRODUCER_LEDGER, c.applied_at.clone())
            };
            // A status is stamped with the moment it BECAME true: the rollback time for a
            // rolled-back row, the apply time for an applied one. Stamping every status with
            // applied_at dated the wrong event and made a rollback look as old as its apply
            // (#385 review). An untimed rollback stays undated rather than borrowing a date.
            let status_at = if c.status == "rolled_back" {
                c.rolled_back_at.clone()
            } else {
                applied_at.observed_at.clone()
            };
            let status = match status_at {
                Some(at) => Fact::historical(c.status.clone(), PRODUCER_LEDGER, at),
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
                still_active: match c.active_check {
                    Some(ActiveCheck::On) => Fact::live(true, PRODUCER_ACTIVE_CHECK),
                    Some(ActiveCheck::Off) => Fact::live(false, PRODUCER_ACTIVE_CHECK),
                    Some(ActiveCheck::Unreadable) => Fact::unknown(
                        PRODUCER_ACTIVE_CHECK,
                        "The live check for this setting could not read the machine, so whether it is still in effect is unknown.",
                    ),
                    Some(ActiveCheck::Unrecognised) => Fact::unknown(
                        PRODUCER_ACTIVE_CHECK,
                        "Compy has no live check for this kind of change, so whether it is still in effect is unknown.",
                    ),
                    None => Fact::not_applicable(
                        PRODUCER_ACTIVE_CHECK,
                        "This change is not in the applied state, so there is no live setting to check.",
                    ),
                },
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

    let changes: Vec<CompyChangeFact> = all_facts.iter().take(MAX_CHANGES).cloned().collect();

    let truth = CompyChangeTruth {
        total_recorded: inp.applied_changes.len(),
        active_now,
        in_effect_other_rig,
        in_effect_rig_unknown,
        in_effect_total: active_now,
        applied_but_not_in_effect,
        in_effect_unknown,
        rolled_back,
        on_this_rig,
        not_on_this_rig,
        rig_unknown,
        changes,
        ledger_note: LEDGER_NOTE,
        ledger_unreadable: inp.ledger_error.map(|e| format!("{LEDGER_UNREADABLE} ({e})")),
    };
    (truth, all_facts)
}

/// One row per change (`rec_id`) that is on or cannot be confirmed: the newest apply whose live check
/// reads On, Unreadable or Unrecognised represents it, because that is the apply an undo targets.
/// Mirrors `liveChangeGroups` in `src/data/live-changes.ts` (#453): same filter, same "newest wins,
/// a tie (to the millisecond) or an unparseable time keeps the first seen" rule.
fn live_change_groups(rows: &[AppliedChangeView]) -> Vec<&AppliedChangeView> {
    // Millisecond precision, truncated, because that is all `Date.parse` keeps on the TS side:
    // two applies inside one millisecond are a tie on both sides, and a tie keeps the first seen.
    fn time(c: &AppliedChangeView) -> Option<i64> {
        chrono::DateTime::parse_from_rfc3339(&c.applied_at).ok().map(|t| t.timestamp_millis())
    }
    let mut order: Vec<&str> = Vec::new();
    let mut by_rec: std::collections::HashMap<&str, &AppliedChangeView> = std::collections::HashMap::new();
    for c in rows {
        let live = c.status == "applied"
            && matches!(
                c.active_check,
                Some(ActiveCheck::On | ActiveCheck::Unreadable | ActiveCheck::Unrecognised)
            );
        if !live {
            continue;
        }
        match by_rec.get(c.rec_id.as_str()) {
            None => {
                order.push(c.rec_id.as_str());
                by_rec.insert(c.rec_id.as_str(), c);
            }
            Some(prev) => {
                // TS: `time(c) > time(prev)` with an unparseable time as -Infinity.
                let newer = match (time(c), time(prev)) {
                    (Some(a), Some(b)) => a > b,
                    (Some(_), None) => true,
                    _ => false,
                };
                if newer {
                    by_rec.insert(c.rec_id.as_str(), c);
                }
            }
        }
    }
    order.into_iter().map(|r| by_rec[r]).collect()
}

fn tally_rig_attribution(
    attribution: Option<bool>,
    on_this_rig: &mut usize,
    not_on_this_rig: &mut usize,
    rig_unknown: &mut usize,
) {
    match attribution {
        Some(true) => *on_this_rig += 1,
        Some(false) => *not_on_this_rig += 1,
        None => *rig_unknown += 1,
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

/// `all_chronology` and `all_changes` are the UNCAPPED projections from [`compose_chronology`] and
/// [`compose_compy_changes`], never `ChangeChronology::entries` or `CompyChangeTruth::changes`. The
/// answers they summarise are reported over the whole record, so their evidence has to be too, or
/// the same screen can show a count with nothing named behind it — and, for the chronology, an
/// evidence span narrower than the retained-history boundary printed beside it (#385 review).
fn compose_evidence(
    built_at: &str,
    ledger_error: Option<&str>,
    identity: &MachineIdentity,
    chronology: &ChangeChronology,
    all_chronology: &[ChronologyEntry],
    all_changes: &[CompyChangeFact],
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
    for e in all_chronology {
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
    if all_chronology.is_empty() {
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
    for ch in all_changes {
        let at = |f: &str| format!("compy_changes[{}].{}", ch.id, f);
        tally(&mut c, &at("applied_at"), &ch.applied_at, &mut unknowns);
        tally(&mut c, &at("status"), &ch.status, &mut unknowns);
        tally(&mut c, &at("still_active"), &ch.still_active, &mut unknowns);
        tally(&mut c, &at("rolled_back_at"), &ch.rolled_back_at, &mut unknowns);
        tally(&mut c, &at("on_this_rig"), &ch.on_this_rig, &mut unknowns);
        tally(&mut c, &at("reversible"), &ch.reversible, &mut unknowns);
    }
    if let Some(e) = ledger_error {
        tally_absent(
            &mut c,
            "compy_changes.changes",
            PRODUCER_LEDGER,
            &format!("{LEDGER_UNREADABLE} ({e})"),
            &mut unknowns,
        );
        tally_absent(
            &mut b,
            "chronology.applied_changes",
            PRODUCER_LEDGER,
            CHRONOLOGY_LEDGER_UNREADABLE,
            &mut unknowns,
        );
    } else if all_changes.is_empty() {
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

/// Every producer the chronology is assembled from, read ONCE by [`build`] and mapped onto the
/// assembler's input shape by [`ChronologyProducers::timeline_inputs`]. Before this seam existed,
/// six of the eight were hard-coded empty in `build` (#393), so a session, verified win, Lab
/// baseline, A/B verdict or drift notice newer than the newest applied change never reached the
/// chronology and "Most recent" named the wrong event: false, not merely partial. The map below is
/// the only place a producer can be dropped, and `chronology_coverage_names_every_wired_producer`
/// fails when one is.
struct ChronologyProducers {
    applied: Vec<crate::history::AppliedChange>,
    sessions: Vec<crate::sessions::SessionSummary>,
    /// Live Gaming Mode slot, if any: (started_at, human status label).
    gaming_slot: Option<(String, &'static str)>,
    awards: Vec<crate::benchmark_scoreboard::AwardEntry>,
    benchmark_baseline_at: Option<String>,
    comparison: Option<crate::comparison::ComparisonResult>,
    snapshots: Vec<IdentitySnapshot>,
    drift_notices: Vec<crate::drift::DriftNotice>,
}

impl ChronologyProducers {
    /// Borrow every producer into the assembler's input shape. No field is dropped or replaced by
    /// an empty literal here; the coverage guard proves that by pushing one record per producer
    /// through this exact function.
    fn timeline_inputs(&self) -> crate::intelligence::TimelineInputs<'_> {
        crate::intelligence::TimelineInputs {
            applied: &self.applied,
            sessions: &self.sessions,
            gaming_slot: self.gaming_slot.clone(),
            awards: &self.awards,
            benchmark_baseline_at: self.benchmark_baseline_at.clone(),
            comparison: self.comparison.as_ref(),
            snapshots: &self.snapshots,
            drift_notices: &self.drift_notices,
        }
    }
}

/// Read every canonical producer once and compose. READ-ONLY by construction: each call below is a
/// documented reader. In particular it uses `intelligence::load_store` rather than the
/// snapshot-refreshing intelligence path (which appends snapshots) and
/// `hwchange::persisted_baseline` rather than `get_hardware_changes` (which writes a first-run
/// baseline). Picking the writing variant of either would silently make this module a mutator.
pub(crate) fn build() -> MachineModel {
    let hardware = crate::hardware::get_hardware_info();
    let live_fingerprint = crate::hardware::current_fingerprint();
    let baseline = crate::hwchange::persisted_baseline();
    // ONE ledger read, both projections derived from it. Reading twice — raw rows here, the view
    // through the ledger's own command — let an apply or rollback land BETWEEN the reads and compose
    // a single model from two ledger states: the change count could include a row the chronology
    // never saw. One shared answer that contradicts itself is the exact failure this slice exists to
    // remove (#385 review 5135765472, blocker 2). The view projection still lives in `history`, so
    // this module gains no second definition of what a ledger row means.
    // An unreadable ledger is carried, not defaulted: `unwrap_or_default` made it compose exactly
    // like an empty one and report "Compy has recorded no change" on the one machine where every
    // rollback is blocked (#446).
    let (raw_changes, ledger_error) = match crate::history::load_history() {
        Ok(rows) => (rows, Option::<String>::None),
        Err(e) => (Vec::default(), Some(e)),
    };
    let applied_changes = crate::history::applied_change_views(&raw_changes);

    // Every other producer the intelligence timeline consults (#393), read the way
    // `intelligence::gather` reads it, each exactly once. Each is a documented reader:
    // `load_session`, `benchmark_state`, `latest_result` and `active_drift_notices` only read
    // their store; `get_session_summaries` and `scoreboard` also set an UNPARSEABLE store aside as
    // `*.json.corrupt` on load, the same quarantine-on-corrupt shape as `intelligence::load_store`
    // and the ledger read above. None persists, refreshes, probes or mutates Windows state.
    let producers = ChronologyProducers {
        applied: raw_changes,
        sessions: crate::sessions::get_session_summaries(),
        gaming_slot: crate::gaming_session::load_session().map(|f| {
            (
                f.started_at.clone(),
                crate::intelligence::gaming_status_label(f.status),
            )
        }),
        awards: crate::benchmark_scoreboard::scoreboard().awards,
        benchmark_baseline_at: crate::benchmark::benchmark_state().baseline_at,
        comparison: crate::comparison::latest_result(),
        snapshots: crate::intelligence::load_store().identity_snapshots,
        drift_notices: crate::drift::active_drift_notices(),
    };
    let assembly = crate::intelligence::assemble_timeline(&producers.timeline_inputs());

    compose(&MachineModelInputs {
        hardware: &hardware,
        live_fingerprint: &live_fingerprint,
        identity_snapshots: &producers.snapshots,
        hw_baseline: baseline.as_ref(),
        applied_changes: &applied_changes,
        ledger_error: ledger_error.as_deref(),
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
            gpus: vec![crate::hardware::GpuInfo {
                name: "Radeon RX 9070 XT".into(),
                ..Default::default()
            }],
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

    /// One rendered diagnostics entry as the frontend receives it: (label, value, note).
    type RenderedEntry = (String, String, String);

    struct Fixture {
        hardware: HardwareInfo,
        fingerprint: HwFingerprint,
        snapshots: Vec<IdentitySnapshot>,
        baseline: Option<HardwareFingerprint>,
        changes: Vec<AppliedChangeView>,
        ledger_error: Option<String>,
        timeline: Vec<crate::intelligence::EventRecord>,
    }

    // ── Producer-seam fixtures (#393) ─────────────────────────────────────
    //
    // Raw producer rows go through the SAME seam `build()` uses (`ChronologyProducers` →
    // `timeline_inputs()` → the assembler → `compose`), so these tests exercise the production
    // mapping rather than a hand-built timeline. Rows are built through serde where the type
    // derives it, so a fixture names only the fields the assembler reads and every additive field
    // takes its declared default.

    fn ledger_row(id: &str, title: &str, applied_at: &str) -> crate::history::AppliedChange {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "rec_id": id,
            "rec_title": title,
            "applied_at": applied_at,
            "snapshot": null,
            "status": "applied",
        }))
        .expect("ledger row fixture")
    }

    fn session_row(started_at: &str) -> crate::sessions::SessionSummary {
        serde_json::from_value(serde_json::json!({
            "started_at": started_at,
            "duration_secs": 600,
            "process_name": "game.exe",
            "samples": 600,
            "avg_fps": 120.0,
            "avg_frametime_ms": 8.3,
            "low1_fps_est": 90.0,
            "compy_changes_active": 0,
        }))
        .expect("session fixture")
    }

    fn award_row(at: &str) -> crate::benchmark_scoreboard::AwardEntry {
        serde_json::from_value(serde_json::json!({
            "points": 10,
            "rec_id": "game-mode",
            "rec_title": "Enable Game Mode",
            "metric": "1% low",
            "effect_pct": 4.2,
            "ci_lo_pct": 1.1,
            "ci_hi_pct": 7.3,
            "at": at,
        }))
        .expect("award fixture")
    }

    fn comparison_row(at: &str) -> crate::comparison::ComparisonResult {
        serde_json::from_value(serde_json::json!({
            "rec_id": "game-mode",
            "rec_title": "Enable Game Mode",
            "game": "game.exe",
            "baseline_avg_fps": 110.0,
            "baseline_low1_fps": 80.0,
            "after_avg_fps": 118.0,
            "after_low1_fps": 88.0,
            "delta_avg_pct": 7.3,
            "delta_low1_pct": 10.0,
            "noise_floor_pct": 3.0,
            "verdict": "improved",
            "at": at,
        }))
        .expect("comparison fixture")
    }

    fn producers() -> ChronologyProducers {
        ChronologyProducers {
            applied: Vec::new(),
            sessions: Vec::new(),
            gaming_slot: None,
            awards: Vec::new(),
            benchmark_baseline_at: None,
            comparison: None,
            snapshots: Fixture::new().snapshots,
            drift_notices: Vec::new(),
        }
    }

    /// Compose from raw producers exactly as `build()` does, minus the disk and hardware reads.
    fn model_from(p: &ChronologyProducers) -> MachineModel {
        let assembly = crate::intelligence::assemble_timeline(&p.timeline_inputs());
        let views = crate::history::applied_change_views(&p.applied);
        let f = Fixture::new();
        compose(&MachineModelInputs {
            hardware: &f.hardware,
            live_fingerprint: &f.fingerprint,
            identity_snapshots: &p.snapshots,
            hw_baseline: None,
            applied_changes: &views,
            ledger_error: None,
            timeline: &assembly.events,
            timeline_dropped: assembly.dropped_unparseable,
            built_at: "2026-09-06T12:00:00Z".into(),
        })
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
                ledger_error: None,
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
                ledger_error: self.ledger_error.as_deref(),
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
        // The source record's own id, copied through unchanged — the row key a view lists on (#450).
        assert_eq!(e.id, "obs:gpu-driver-change:2026-08-20T00:00:00Z");
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
        // Rows "a" (this rig) and "c" (another rig) both read as in effect on THIS machine, so both
        // are active here (#453). The other-rig stamp is carried as attribution, not subtracted.
        assert_eq!(t.active_now, 2);
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

    /// #453 (replaces #385 REPAIR 3). The live check is read on THIS machine, so a change that reads
    /// On is active here whatever its rig stamp says. Dropping other-rig and unstamped rows put
    /// Health at 13 while Optimize and History said 14 on the owner's PC. The stamp is still carried
    /// as attribution: `in_effect_other_rig` / `in_effect_rig_unknown` are subsets of `active_now`.
    #[test]
    fn active_now_counts_every_live_on_change_and_carries_rig_attribution_apart() {
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

        assert_eq!(t.active_now, 3, "every change whose live check reads On is active on this PC");
        assert_eq!(t.in_effect_other_rig, 1);
        assert_eq!(t.in_effect_rig_unknown, 1);
        assert_eq!(t.in_effect_total, 3);
        // Attribution is a breakdown of the active changes, never an addend: 1 stamped here,
        // 1 stamped elsewhere, 1 unstamped, and together exactly the 3 active.
        assert_eq!(t.active_now - t.in_effect_other_rig - t.in_effect_rig_unknown, 1);
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

    /// #453 Phase 2 four-screen check. One fixture shaped like the owner's ledger (Game Mode applied
    /// repeatedly, pre-stamp rows that read On, an other-rig row that reads On, one change Compy
    /// cannot read) is read here for Health and by `src/live-changes-parity.test.ts` for Optimize
    /// and History. All three must print the fixture's expected numbers. On the old per-row,
    /// stamped-only count this ledger gave 4 active where the other screens gave 7. The #453 review
    /// added a same-millisecond tie with mixed checks (first seen wins on both sides; a nanosecond
    /// compare picked the other row), a newer rollback over an older apply that still reads on, and
    /// an undated row.
    #[test]
    fn active_and_unknown_counts_match_the_shared_ts_fixture() {
        let fx: serde_json::Value =
            serde_json::from_str(include_str!("../../src/test/fixtures/live-changes-parity.json"))
                .expect("parity fixture parses");
        let mut f = Fixture::new();
        f.changes = fx["rows"]
            .as_array()
            .expect("rows")
            .iter()
            .map(|r| {
                let s = |k: &str| r[k].as_str().map(str::to_string);
                let check = match r["active_check"].as_str() {
                    Some("on") => Some(ActiveCheck::On),
                    Some("off") => Some(ActiveCheck::Off),
                    Some("unreadable") => Some(ActiveCheck::Unreadable),
                    Some("unrecognised") => Some(ActiveCheck::Unrecognised),
                    _ => None,
                };
                let status = s("status").expect("status");
                let mut v = crate::history::test_view(
                    &s("id").expect("id"),
                    &s("rec_id").expect("rec_id"),
                    &s("rec_title").expect("rec_title"),
                    &s("applied_at").expect("applied_at"),
                    &status,
                    check.is_some_and(|c| c != ActiveCheck::Off),
                    r["on_this_rig"].as_bool(),
                    None,
                    true,
                );
                v.active_check = check;
                v
            })
            .collect();
        let t = &f.model().compy_changes;
        let want = |k: &str| fx["expected"][k].as_u64().expect("expected count") as usize;
        assert_eq!(t.active_now, want("active"), "Health's 'active now' is the shared count");
        assert_eq!(t.in_effect_unknown, want("cantConfirm"), "Health's can't-confirm is the shared count");
        // The rest of the per-change partition, and the attribution subsets of `active_now`.
        assert_eq!(t.applied_but_not_in_effect, want("notInEffect"));
        assert_eq!(t.rolled_back, want("rolledBack"));
        assert_eq!(t.in_effect_other_rig, want("otherRig"));
        assert_eq!(t.in_effect_rig_unknown, want("rigUnknown"));
        assert_eq!(t.total_recorded, fx["rows"].as_array().map_or(0, Vec::len));
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
            // Retired with its writing refresh (#453): no mention may return.
            (format!("get_intelligence_{}", "timeline"), 0),
            // build()'s doc comment names the WRITING variant it deliberately does not call.
            // Exactly one mention: prose. A second would be a call.
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

    /// Blocker 2 of review 5135765472: `build()` read the Trust Ledger TWICE — once for the raw
    /// rows that feed the timeline and chronology, and again through the ledger's own view command,
    /// which performs its own load. An apply or rollback landing BETWEEN those two reads composes
    /// one `MachineModel` from two ledger states: the Compy-change count can include a row the
    /// chronology never saw. One shared answer contradicting itself is precisely what this slice
    /// exists to remove.
    ///
    /// A runtime assertion cannot establish this. Both reads return identical rows on a quiet disk,
    /// and provoking the race needs a mutation to interleave between two calls inside one function —
    /// so a runtime guard would be nondeterministic and could not be causally falsified. The
    /// property is STRUCTURAL — the ledger is read exactly once and the self-loading producer is not
    /// called — so it is checked structurally, which makes split-state composition impossible rather
    /// than merely unlikely. Reinstating either shape turns this red.
    ///
    /// Needles are assembled at runtime for the reason the read-only scan above states: a scanner
    /// that matches its own source is a scanner that can never fail.
    #[test]
    fn the_model_is_composed_from_exactly_one_trust_ledger_read() {
        let self_loading_producer = format!("get_applied_{}", "changes");
        assert_eq!(
            OWN_SOURCE.match_indices(self_loading_producer.as_str()).count(),
            0,
            "machine_model.rs must not call {self_loading_producer}: it performs its OWN ledger \
             load, and that second read is what lets one model be composed from two ledger states. \
             Derive the view from rows already loaded instead."
        );

        let ledger_read = format!("load_{}", "history");
        assert_eq!(
            OWN_SOURCE.match_indices(ledger_read.as_str()).count(),
            1,
            "the Trust Ledger must be read EXACTLY once per model, with every ledger-derived \
             projection taken from that one snapshot"
        );
    }

    // ── 7. The command and the diagnostics section share ONE model ────────

    #[test]
    fn chronology_scope_travels_in_api_and_rendered_diagnostics() {
        let mut f = Fixture::new();
        for populated in [false, true] {
            if populated {
                f.timeline.push(crate::intelligence::EventRecord {
                    id: "scoped-identity".into(), timestamp: "2026-08-20T00:00:00Z".into(),
                    event_type: "gpu-driver-change".into(), source: "identity-snapshot".into(),
                    scope: EventScope::Observed, game: None, summary: "GPU driver changed".into(),
                    detail: None, observed_between: None, since_rolled_back: false, rec_id: None,
                });
            }
            let m = f.model();
            let wire = serde_json::to_value(&m).unwrap();
            let coverage = wire["chronology"]["coverage_note"].as_str().unwrap_or("");
            assert!(coverage.contains("monitored sessions"), "{coverage}");
            assert!(coverage.contains("identity snapshots"), "{coverage}");
            assert!(coverage.contains("current record only"), "{coverage}");
            assert!(!coverage.contains("excludes"), "{coverage}");
            let entries = rendered_entries(&m);
            let (_, value, note) = entry_by_label(&entries, "Recorded changes");
            assert!(value.contains("events in this view"), "{value}");
            assert!(note.contains(coverage), "{note}");
            if populated {
                assert!(note.contains("Most recent in this view:"), "{note}");
                assert!(!note.contains("Most recent:"), "{note}");
            } else {
                assert!(!note.contains("Nothing is recorded yet"), "{note}");
            }
            let (_, _, boundary) = entry_by_label(&entries, "Earliest dated record");
            assert!(boundary.contains("in this view"), "{boundary}");
        }
    }

    // ── 8. Every producer reaches the chronology (#393) ───────────────────

    /// RED first for #393: with six of eight producers hard-coded empty, a session newer than the
    /// newest applied change never reached the chronology, so `entries.first()` named the applied
    /// change as "Most recent" (false, not partial) and `total_events` counted one producer. Through
    /// the production seam, the newer producer event leads and the total counts every wired row.
    #[test]
    fn newer_producer_event_leads_the_chronology_and_total_counts_wired_producers() {
        let mut p = producers();
        p.applied.push(ledger_row("chg-1", "Enable Game Mode", "2026-08-10T10:00:00Z"));
        p.sessions.push(session_row("2026-08-12T20:00:00Z"));
        let m = model_from(&p);

        assert_eq!(m.chronology.total_events, 2, "one applied change + one session");
        let first = m.chronology.entries.first().expect("newest entry");
        assert_eq!(first.source, "sessions", "{}", first.summary);
        assert_eq!(first.observed_at, "2026-08-12T20:00:00Z");
        assert_eq!(m.chronology.entries[1].source, "trust-ledger");
        assert_eq!(m.chronology.entries[1].observed_at, "2026-08-10T10:00:00Z");
    }

    /// CHRONOLOGY_COVERAGE is tied to the wiring, not to prose. One record per producer goes
    /// through the same seam `build()` uses: every producer must surface, the total must count each
    /// one, and the coverage note must name each source that surfaced. A producer silently dropped
    /// from `timeline_inputs` fails the first assertion; a note that stops naming one fails the
    /// second; and the structural half fails when `build()` stops reading one through its accessor
    /// or feeds the seam an empty literal again.
    #[test]
    fn chronology_coverage_names_every_wired_producer() {
        let mut p = producers();
        p.applied.push(ledger_row("chg-1", "Enable Game Mode", "2026-08-02T10:00:00Z"));
        p.drift_notices.push(crate::drift::DriftNotice {
            id: "game-mode".into(),
            label: "Game Mode".into(),
            last_ready_at: Some("2026-08-02T10:00:00Z".into()),
            noticed_at: "2026-08-03T10:00:00Z".into(),
        });
        p.sessions.push(session_row("2026-08-04T10:00:00Z"));
        p.gaming_slot = Some(("2026-08-05T10:00:00Z".into(), "active"));
        p.awards.push(award_row("2026-08-06T10:00:00Z"));
        p.benchmark_baseline_at = Some("2026-08-07T10:00:00Z".into());
        p.comparison = Some(comparison_row("2026-08-08T10:00:00Z"));
        // A second snapshot whose driver differs is the one identity delta the scan reports.
        p.snapshots.push(snap("2026-08-09T10:00:00Z", "Radeon RX 9070 XT", "25.6.1", 32, "abc123"));
        let m = model_from(&p);

        // (source as the assembler stamps it, phrase the coverage note must carry for it)
        const WIRED: [(&str, &str); 8] = [
            ("trust-ledger", "Compy-applied changes"),
            ("sessions", "monitored sessions"),
            ("gaming-session", "live Gaming Mode slot"),
            ("scoreboard", "verified wins"),
            ("benchmark", "current Lab baseline"),
            ("comparison", "latest A/B comparison"),
            ("identity-snapshot", "identity snapshots"),
            ("drift-watch", "drift notices"),
        ];
        let sources: std::collections::BTreeSet<&str> =
            m.chronology.entries.iter().map(|e| e.source.as_str()).collect();
        for (source, phrase) in WIRED {
            assert!(sources.contains(source), "producer {source} never reached the chronology: {sources:?}");
            assert!(
                CHRONOLOGY_COVERAGE.contains(phrase),
                "coverage note no longer names {source} as {phrase:?}: {CHRONOLOGY_COVERAGE}"
            );
        }
        assert_eq!(sources.len(), WIRED.len(), "{sources:?}");
        assert_eq!(m.chronology.total_events, WIRED.len(), "one record per producer");
        assert_eq!(m.chronology.entries.first().map(|e| e.source.as_str()), Some("identity-snapshot"));
        assert!(!CHRONOLOGY_COVERAGE.contains("excludes"), "{CHRONOLOGY_COVERAGE}");

        // Structural half: `build()` reads every producer through its accessor, exactly once, and
        // hands the seam no empty literal. Needles are assembled at runtime for the reason the
        // read-only scan above states: a scanner that matches its own source can never fail.
        let build_src = {
            let start = OWN_SOURCE.find("pub(crate) fn build() -> MachineModel {").expect("build() present");
            let body = &OWN_SOURCE[start..];
            &body[..body.find("\n}\n").expect("build() closes")]
        };
        let accessors = [
            format!("get_session_{}", "summaries()"),
            format!("load_{}", "session()"),
            format!("{}()", "scoreboard"),
            format!("benchmark_{}", "state()"),
            format!("latest_{}", "result()"),
            format!("active_drift_{}", "notices()"),
            format!("timeline_{}", "inputs()"),
        ];
        for accessor in accessors {
            assert_eq!(
                build_src.matches(accessor.as_str()).count(),
                1,
                "build() must read the {accessor} producer exactly once"
            );
        }
        for empty in [format!("&{}", "[]"), format!(": {}", "None"), format!("Vec::{}", "new()")] {
            assert!(!build_src.contains(empty.as_str()), "build() feeds the seam {empty} instead of a producer");
        }
    }

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

        // Pinned EXHAUSTIVELY and by exact string, not by substring over four of eleven entries.
        // Containment could not tell "1 on this PC" from "1 elsewhere", and a section that grew a
        // twelfth entry — or quietly dropped one — still passed. Every value below is a claim, so
        // every value is pinned; changing one has to be a deliberate edit here too (#385 review).
        let expected: Vec<(&str, &str)> = vec![
            ("Processor", "AMD Ryzen 7 7800X3D"),
            ("Graphics", "Radeon RX 9070 XT"),
            ("Graphics driver", "25.5.1"),
            ("Display", "2560x1440@250"),
            ("Windows", "Windows 11 Pro 24H2 (build 26100.1742)"),
            ("Rig identity", "abc123"),
            ("Memory", "32 GB"),
            ("Identity producers disagree", "No"),
            ("Recorded changes", "0 events in this view · 1 identity snapshots"),
            ("Earliest dated record", "2026-07-01T00:00:00Z"),
            (
                "Changes Compy applied",
                "1 recorded (1 ledger entry) · 1 active on this PC · 0 rolled back · 0 no longer in effect · 0 could not be checked",
            ),
            ("In effect, other or unknown PC", "0 recorded on another PC · 0 unattributed"),
            ("Applied on this machine", "1 on this PC · 0 elsewhere · 0 unknown"),
            ("Evidence not available", "1 facts"),
            ("Model built", "2026-09-06T12:00:00Z"),
        ];
        let actual: Vec<(String, String)> = rendered_entries(&m)
            .into_iter()
            .map(|(l, v, _)| (l, v))
            .collect();
        let actual_refs: Vec<(&str, &str)> =
            actual.iter().map(|(l, v)| (l.as_str(), v.as_str())).collect();
        assert_eq!(actual_refs, expected);

        // And the pinned strings are the MODEL's, not a second implementation's.
        assert_eq!(m.identity.gpu.value.as_deref(), Some("Radeon RX 9070 XT"));
        assert_eq!(m.compy_changes.active_now, 1);
        assert_eq!(m.compy_changes.on_this_rig, 1);
        assert_eq!(m.built_at, "2026-09-06T12:00:00Z");
        // Every entry carries a note: a bare value with no explanation is not a receipt.
        assert!(rendered_entries(&m).iter().all(|(_, _, note)| !note.is_empty()));
    }

    // ── 7b. The RENDERED text is held to the same truth standard as the model ──
    //
    // The #385 review found two headings that asserted what the model deliberately refuses to
    // establish, and noted the real defect underneath: no test asserted either string, so changing
    // them broke nothing — and so would changing them back. A model-only count test cannot see a
    // heading. These three go through the exact serialization the frontend receives.

    /// Every rendered entry as (label, value, note), taken from the SERIALIZED section rather than
    /// the struct: `DiagnosticEntry`'s fields are private to `diagnostics`, and the serialized form
    /// is what a user actually reads.
    fn rendered_entries(m: &MachineModel) -> Vec<RenderedEntry> {
        let section = crate::diagnostics::machine_model_section(m);
        let v = serde_json::to_value(&section).expect("the section serializes");
        v["entries"]
            .as_array()
            .expect("the section renders an entries array")
            .iter()
            .map(|e| {
                (
                    e["label"].as_str().unwrap_or_default().to_string(),
                    e["value"].as_str().unwrap_or_default().to_string(),
                    e["note"].as_str().unwrap_or_default().to_string(),
                )
            })
            .collect()
    }

    fn entry_by_label<'a>(entries: &'a [RenderedEntry], label: &str) -> &'a RenderedEntry {
        entries.iter().find(|(l, _, _)| l == label).unwrap_or_else(|| {
            let all: Vec<&str> = entries.iter().map(|(l, _, _)| l.as_str()).collect();
            panic!("no rendered entry labelled {label:?}; rendered labels were {all:?}")
        })
    }

    fn entry_whose_value_contains<'a>(entries: &'a [RenderedEntry], needle: &str) -> &'a RenderedEntry {
        entries.iter().find(|(_, v, _)| v.contains(needle)).unwrap_or_else(|| {
            panic!("no rendered entry whose value contains {needle:?}")
        })
    }

    /// same-PC / other-PC / unknown-PC, all three in effect at once. The unknown row must not be
    /// rendered under a heading that asserts it was NOT applied here: `on_this_rig: None` is the
    /// model refusing to answer that question, and the presentation may not answer it instead.
    #[test]
    fn the_rendered_attribution_never_calls_an_unattributed_row_not_applied_here() {
        let mut f = Fixture::new();
        f.changes.push(crate::history::test_view(
            "same", "game-mode", "Enable Game Mode", "2026-07-01T00:00:00Z", "applied", true,
            Some(true), None, true,
        ));
        f.changes.push(crate::history::test_view(
            "other", "hags-enable", "Enable HAGS", "2026-07-02T00:00:00Z", "applied", true,
            Some(false), None, true,
        ));
        f.changes.push(crate::history::test_view(
            "nostamp", "power-plan", "High performance", "2026-07-03T00:00:00Z", "applied", true,
            None, None, true,
        ));
        let m = f.model();
        // All three read On on this machine, so all three are active here (#453); the model keeps
        // the other-rig and unstamped attribution apart. This test is about the render.
        assert_eq!(
            (m.compy_changes.active_now, m.compy_changes.in_effect_other_rig, m.compy_changes.in_effect_rig_unknown),
            (3, 1, 1)
        );

        let entries = rendered_entries(&m);
        let (label, value, note) = entry_whose_value_contains(&entries, "unattributed");

        // FALSIFIER: restore the pre-repair heading "In effect but not applied here" and this reds.
        assert!(
            !label.contains("not applied here"),
            "the heading over the unattributed count asserts a negative the model refuses to establish: {label:?}"
        );
        assert!(
            label.to_lowercase().contains("unknown"),
            "the heading does not name the unknown case, so the count reads as another PC's: {label:?}"
        );
        assert!(value.contains("1 recorded on another PC"), "{value:?}");
        assert!(value.contains("1 unattributed"), "{value:?}");
        assert!(
            note.contains("missing stamp"),
            "the note does not say a missing stamp is what makes the row unattributed: {note:?}"
        );

        // The live read is taken here, so every change that reads On is active on this PC (#453).
        let (_, applied, _) = entry_by_label(&entries, "Changes Compy applied");
        assert!(applied.contains("3 recorded"), "{applied:?}");
        assert!(applied.contains("3 active on this PC"), "{applied:?}");
        assert!(note.contains("1 of the 3 changes active on this PC are stamped for this PC"), "{note:?}");
    }

    /// An undated ledger row alongside a dated snapshot. The boundary is computed from dated
    /// records only, so the rendered note may not claim a boundary for ALL retained evidence.
    #[test]
    fn the_rendered_history_boundary_bounds_dated_evidence_only() {
        let mut f = Fixture::new();
        f.changes.push(crate::history::test_view(
            "undated", "hags-enable", "Enable HAGS", "", "applied", true, Some(true), None, true,
        ));
        let m = f.model();
        assert_eq!(m.chronology.recorded_from.as_deref(), Some("2026-08-01T10:00:00Z"));

        let entries = rendered_entries(&m);
        let (label, value, note) = entry_by_label(&entries, "Earliest dated record");
        assert_eq!(value, "2026-08-01T10:00:00Z");
        assert!(
            label.to_lowercase().contains("dated"),
            "the heading does not qualify the boundary as dated-only: {label:?}"
        );
        // FALSIFIER: restore "Nothing before this date is recorded" and this reds.
        assert!(
            !note.contains("Nothing before this date is recorded"),
            "the note asserts an absence of earlier records the boundary cannot establish: {note:?}"
        );
        assert!(
            note.contains("Undated records cannot be placed in time"),
            "the note does not say why undated evidence is outside the boundary: {note:?}"
        );
    }

    /// Only undated history. No boundary may be invented — and the undated row must still be
    /// reported, because dropping it would trade one false claim for another.
    #[test]
    fn an_only_undated_history_renders_no_boundary_and_is_not_erased() {
        let mut f = Fixture::new();
        f.snapshots.clear();
        f.timeline.clear();
        f.changes.push(crate::history::test_view(
            "undated", "hags-enable", "Enable HAGS", "", "applied", true, None, None, true,
        ));
        let m = f.model();
        assert!(m.chronology.recorded_from.is_none(), "an undated row cannot bound anything");

        let entries = rendered_entries(&m);
        assert!(
            !entries.iter().any(|(l, _, _)| l.contains("dated record") || l == "History starts"),
            "a boundary was rendered with nothing dated retained: {:?}",
            entries.iter().map(|(l, _, _)| l.as_str()).collect::<Vec<_>>()
        );
        let (_, applied, _) = entry_by_label(&entries, "Changes Compy applied");
        assert!(applied.starts_with("1 recorded"), "the undated row was erased: {applied:?}");
    }

    // ── 7c. The evidence pass covers every row the counts cover ───────────

    /// A ledger whose newest [`MAX_CHANGES`] rows are clean and whose older rows are not. This is
    /// the exact shape that let the display cap leak into the truth: the roll-up counts walk the
    /// whole ledger, so an evidence pass walking only the shown rows finds nothing to report.
    fn ledger_gappy_only_beyond_the_cap() -> Vec<AppliedChangeView> {
        let mut changes = Vec::new();
        // Oldest first — these five are pushed first, so they are the five the display cap drops.
        for i in 0..5 {
            changes.push(crate::history::test_view(
                &format!("old-{i}"),
                "rec-old",
                "An undated, unattributed row",
                "",
                "applied",
                true,
                None,
                None,
                true,
            ));
        }
        for i in 0..MAX_CHANGES {
            changes.push(crate::history::test_view(
                &format!("new-{i}"),
                "rec-new",
                "A stamped, attributed row",
                &format!("2026-08-{:02}T10:00:00Z", i + 1),
                "applied",
                true,
                Some(true),
                None,
                true,
            ));
        }
        changes
    }

    /// That ledger in a fixture whose identity and chronology are otherwise complete, so the ONLY
    /// evidence gaps anywhere in the model are the ones the display cap drops. Without the timeline
    /// event the empty-chronology unknown would mask the very contradiction under test.
    fn fixture_gappy_only_beyond_the_cap() -> Fixture {
        let mut f = Fixture::new();
        f.changes = ledger_gappy_only_beyond_the_cap();
        f.timeline.push(crate::intelligence::EventRecord {
            id: "applied:new-0".into(),
            timestamp: "2026-08-01T10:00:00Z".into(),
            event_type: "change-applied".into(),
            source: "history".into(),
            scope: EventScope::CompyApplied,
            game: None,
            summary: "A stamped, attributed row".into(),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: Some("rec-new".into()),
        });
        f
    }

    #[test]
    fn evidence_covers_rows_the_display_cap_drops() {
        let m = fixture_gappy_only_beyond_the_cap().model();

        // The display list is still capped, and every row IN it is clean — so a tally that walked
        // `compy_changes.changes` would legitimately find zero gaps.
        assert_eq!(m.compy_changes.changes.len(), MAX_CHANGES);
        assert!(
            m.compy_changes
                .changes
                .iter()
                .all(|c| c.on_this_rig.value == Some(true) && c.applied_at.value.is_some()),
            "the fixture's point is that the SHOWN rows carry no gaps"
        );

        // The counts, which walk the whole ledger, do see them.
        assert_eq!(m.compy_changes.total_recorded, MAX_CHANGES + 5);
        assert_eq!(m.compy_changes.rig_unknown, 5);
        // Five unstamped ROWS, but they are one change (`rec-old`), counted once (#453).
        assert_eq!(m.compy_changes.in_effect_rig_unknown, 1);

        // So the evidence must too: five unattributed rows and five undated ones, each named.
        let unattributed: Vec<&str> = m
            .evidence
            .unknowns
            .iter()
            .map(|u| u.field.as_str())
            .filter(|f| f.ends_with(".on_this_rig"))
            .collect();
        assert_eq!(
            unattributed.len(),
            5,
            "every unattributed row the count reports must be named: {:?}",
            m.evidence.unknowns.iter().map(|u| &u.field).collect::<Vec<_>>()
        );
        for i in 0..5 {
            assert!(
                unattributed.contains(&format!("compy_changes[old-{i}].on_this_rig").as_str()),
                "row old-{i} is counted as unattributed but never named"
            );
        }
        assert_eq!(
            m.evidence
                .unknowns
                .iter()
                .filter(|u| u.field.ends_with(".applied_at"))
                .count(),
            5
        );

        // And the roll-up counter and the list still cannot disagree — nor may anything else in
        // this fixture contribute a gap, or the rendered assertion below would prove nothing.
        let counted: usize = m.evidence.answers.iter().map(|a| a.unknown_facts).sum();
        assert_eq!(counted, m.evidence.unknowns.len());
        assert_eq!(m.evidence.unknowns.len(), 10);
    }

    #[test]
    fn the_rendered_evidence_line_never_reads_none_while_a_count_reports_gaps() {
        let m = fixture_gappy_only_beyond_the_cap().model();
        let entries = rendered_entries(&m);

        let (_, attribution, _) = entry_by_label(&entries, "Applied on this machine");
        assert!(
            attribution.contains("5 unknown"),
            "the attribution row reports the gaps: {attribution}"
        );

        let (_, evidence, note) = entry_by_label(&entries, "Evidence not available");
        assert_ne!(
            evidence.as_str(),
            "None",
            "the same section reports 5 unknown attributions — 'None' contradicts it on one screen"
        );
        assert_eq!(evidence.as_str(), "10 facts");
        assert!(
            note.contains("old-"),
            "the named reasons must reach the rows the count is about: {note}"
        );
    }

    // ── 7d. Every disagreement branch, and every stamp, is exercised ──────

    #[test]
    fn a_snapshot_ram_mismatch_is_reported_against_the_stamped_snapshot() {
        let mut f = Fixture::new();
        // Live reads 32 GB; the snapshot Compy stamped says 16. No baseline, so this can only
        // come from the identity-snapshot branch.
        f.snapshots[0].ram_gb = 16;
        let m = f.model();
        let d = m
            .identity
            .disagreements
            .iter()
            .find(|d| d.field == "ram_gb")
            .expect("a 16 GB gap against the stamped snapshot is a disagreement");
        assert_eq!(d.left.producer, PRODUCER_HARDWARE);
        assert_eq!(d.left.value, "32");
        assert_eq!(d.right.producer, PRODUCER_SNAPSHOT);
        assert_eq!(d.right.value, "16");
        // A stamped snapshot keeps its own time — that is what makes it historical evidence.
        assert_eq!(d.right.observed_at.as_deref(), Some("2026-08-01T10:00:00Z"));
        assert_eq!(d.right.freshness, Freshness::Stamped);
        assert_eq!(d.interpretation, DISAGREE_HISTORICAL);
    }

    #[test]
    fn a_baseline_gpu_mismatch_is_reported_as_an_undated_baseline_record() {
        let mut f = Fixture::new();
        f.baseline = Some(crate::hwchange::test_fingerprint(
            "AMD Ryzen 7 7800X3D",
            &["GeForce RTX 4090"],
            32,
        ));
        let m = f.model();
        let d = m
            .identity
            .disagreements
            .iter()
            .find(|d| d.field == "gpu")
            .expect("the acknowledged baseline names a GPU this machine does not have");
        assert_eq!(d.right.producer, PRODUCER_HWCHANGE);
        assert_eq!(d.right.value, "GeForce RTX 4090");
        assert_eq!(d.interpretation, DISAGREE_BASELINE);
        // The baseline is a persisted record with no time in it. Calling that an unstamped CACHE
        // would say it was read this session, which is a different and stronger claim.
        assert!(d.right.observed_at.is_none());
        assert_eq!(d.right.freshness, Freshness::UndatedHistorical);
        assert_ne!(d.right.freshness, Freshness::UnstampedCache);
    }

    #[test]
    fn a_rolled_back_status_is_stamped_at_the_rollback_not_at_the_apply() {
        let mut f = Fixture::new();
        f.changes.push(crate::history::test_view(
            "chg-timed",
            "game-mode",
            "Enable Game Mode",
            "2026-07-01T00:00:00Z",
            "rolled_back",
            false,
            Some(true),
            Some("2026-08-15T00:00:00Z".into()),
            true,
        ));
        f.changes.push(crate::history::test_view(
            "chg-untimed",
            "game-mode",
            "Enable Game Mode",
            "2026-07-02T00:00:00Z",
            "rolled_back",
            false,
            Some(true),
            None,
            true,
        ));
        let m = f.model();
        let by_id = |id: &str| {
            m.compy_changes
                .changes
                .iter()
                .find(|c| c.id == id)
                .unwrap_or_else(|| panic!("row {id} is missing"))
        };

        let timed = by_id("chg-timed");
        assert_eq!(timed.applied_at.observed_at.as_deref(), Some("2026-07-01T00:00:00Z"));
        assert_eq!(
            timed.status.observed_at.as_deref(),
            Some("2026-08-15T00:00:00Z"),
            "the status became 'rolled_back' at the rollback, six weeks after the apply"
        );

        // An untimed rollback has a real status and no knowable time. It must not borrow the
        // apply time to look dated.
        let untimed = by_id("chg-untimed");
        assert_eq!(untimed.status.value.as_deref(), Some("rolled_back"));
        assert!(untimed.status.observed_at.is_none());
        assert_eq!(untimed.status.freshness, Freshness::UndatedHistorical);
    }

    #[test]
    fn rig_attribution_names_the_on_this_pc_count_and_accounts_for_every_row() {
        let mut f = Fixture::new();
        for (id, rig) in [
            ("here-1", Some(true)),
            ("here-2", Some(true)),
            ("elsewhere", Some(false)),
            ("unstamped", None),
        ] {
            f.changes.push(crate::history::test_view(
                id,
                "game-mode",
                "Enable Game Mode",
                "2026-07-01T00:00:00Z",
                "applied",
                true,
                rig,
                None,
                true,
            ));
        }
        let m = f.model();
        let c = &m.compy_changes;
        assert_eq!(c.on_this_rig, 2);
        assert_eq!(c.not_on_this_rig, 1);
        assert_eq!(c.rig_unknown, 1);
        assert_eq!(
            c.on_this_rig + c.not_on_this_rig + c.rig_unknown,
            c.total_recorded,
            "rig attribution must account for every recorded row, with no fourth bucket"
        );

        // The heading says "Applied on this machine", so the value has to contain that count and
        // not only its two complements.
        let entries = rendered_entries(&m);
        let (_, value, _) = entry_by_label(&entries, "Applied on this machine");
        assert_eq!(value.as_str(), "2 on this PC · 1 elsewhere · 1 unknown");
    }

    #[test]
    fn the_agreement_line_claims_only_the_fields_that_were_compared() {
        let m = Fixture::new().model();
        assert!(
            m.identity.disagreements.is_empty(),
            "this fixture is the all-agree case"
        );
        let entries = rendered_entries(&m);
        let (_, value, note) = entry_by_label(&entries, "Identity producers disagree");
        assert_eq!(value.as_str(), "No");
        // Windows build and CPU are never compared, so agreement across "every producer" is a
        // claim the model cannot support (#385 review).
        assert!(
            !note.contains("Every producer that contributes"),
            "the note must not generalise past what identity_disagreements actually reads: {note}"
        );
        assert!(note.contains("GPU, driver, display, memory and the rig hash"));
        assert!(note.contains("Windows build are not compared"));
        // And that phrase must be MEASURED, not recited: it names exactly the fields the model
        // says it compared, so the note cannot outlive a change to what actually gets compared.
        let compared: Vec<&str> = m.identity.compared_fields.iter().map(|c| c.field).collect();
        for field in ["gpu", "gpu_driver", "display", "ram_gb", "rig_hash"] {
            assert!(
                compared.contains(&field),
                "{field} is named in the note, so it must have been compared"
            );
        }
    }

    // ── 7e. Nothing compared is not agreement (#385 review, finding 1) ────

    #[test]
    fn a_machine_with_nothing_to_compare_never_renders_as_producers_agreeing() {
        let mut f = Fixture::new();
        // A fresh install: Compy has stamped no identity snapshot, and the user has acknowledged
        // no hardware baseline. There is no second reading in existence to compare against.
        f.snapshots.clear();
        f.baseline = None;
        let m = f.model();
        assert!(
            m.identity.compared_fields.is_empty(),
            "with no snapshot and no baseline, no comparison can have run"
        );
        assert!(
            m.identity.disagreements.is_empty(),
            "and so nothing can have disagreed — this is the ambiguity being fixed"
        );

        let entries = rendered_entries(&m);
        let (_, value, note) = entry_by_label(&entries, "Identity producers disagree");
        assert_ne!(
            value.as_str(),
            "No",
            "an absence of comparative evidence must never render as a passing check"
        );
        assert_eq!(value.as_str(), "Not compared");
        assert!(
            note.contains("absence of comparative evidence, not agreement"),
            "the note must say why there is no answer rather than implying one: {note}"
        );
        assert!(
            !note.contains("agree."),
            "no branch of the zero-comparison note may assert agreement: {note}"
        );
    }

    #[test]
    fn a_snapshot_whose_fields_all_failed_to_read_is_not_a_comparison() {
        let mut f = Fixture::new();
        // A snapshot row exists, but its fields came back empty — failed probes, not readings. An
        // empty side is already excluded from DISAGREEING; it must be excluded from AGREEING for
        // the same reason, or a broken probe reads as a clean bill of health.
        f.baseline = None;

        // First the partial case, which proves the rule is applied PER FIELD: only `display` came
        // back, so only `display` may be spoken for.
        f.snapshots = vec![snap("2026-08-01T10:00:00Z", "", "", 0, "")];
        let m = f.model();
        assert_eq!(
            m.identity
                .compared_fields
                .iter()
                .map(|c| c.field)
                .collect::<Vec<_>>(),
            vec!["display"],
            "only the one field that actually read back is comparable"
        );
        let entries = rendered_entries(&m);
        let (_, _, note) = entry_by_label(&entries, "Identity producers disagree");
        assert!(
            note.contains("compared — display — agree"),
            "the note may claim only the field that was read: {note}"
        );

        // Then the total case: nothing in the snapshot read back at all.
        f.snapshots[0].display = String::new();
        let m = f.model();
        assert!(
            m.identity.compared_fields.is_empty(),
            "a snapshot whose every field failed to read compares nothing"
        );
        let entries = rendered_entries(&m);
        let (_, value, _) = entry_by_label(&entries, "Identity producers disagree");
        assert_eq!(
            value.as_str(),
            "Not compared",
            "a broken probe must not read as a clean bill of health"
        );
    }

    #[test]
    fn a_baseline_with_no_snapshot_is_still_a_real_comparison() {
        // The positive control for the two guards above: the "Not compared" branch must be
        // reachable ONLY by an actual absence. A machine with no snapshot but an acknowledged
        // baseline HAS been compared, and must still be able to report agreement.
        let mut f = Fixture::new();
        f.snapshots.clear();
        f.baseline = Some(crate::hwchange::test_fingerprint(
            "AMD Ryzen 7 7800X3D",
            &["Radeon RX 9070 XT"],
            32,
        ));
        let m = f.model();
        assert_eq!(
            m.identity
                .compared_fields
                .iter()
                .map(|c| (c.field, c.against))
                .collect::<Vec<_>>(),
            vec![("gpu", PRODUCER_HWCHANGE), ("ram_gb", PRODUCER_HWCHANGE)],
            "the baseline compares GPU and memory, and only those"
        );
        assert!(m.identity.disagreements.is_empty(), "and they match");
        let entries = rendered_entries(&m);
        let (_, value, note) = entry_by_label(&entries, "Identity producers disagree");
        assert_eq!(value.as_str(), "No");
        assert!(
            note.contains("compared — GPU and memory — agree"),
            "the note must claim only the two fields the baseline actually compared, not the five \
             a snapshot would have: {note}"
        );
    }

    // ── 7f. The evidence span is not the display cap (#385 review, finding 3) ──

    #[test]
    fn the_answer_b_evidence_span_covers_chronology_the_display_cap_drops() {
        let mut f = Fixture::new();
        f.snapshots.clear();
        // MAX_CHRONOLOGY + 5 dated events, ascending exactly as the assembler emits them, so the
        // display cap must drop the five OLDEST.
        f.timeline = (0..MAX_CHRONOLOGY + 5)
            .map(|i| crate::intelligence::EventRecord {
                id: format!("applied:evt-{i}"),
                timestamp: format!("2026-01-{:02}T00:00:00Z", i + 1),
                event_type: "change-applied".into(),
                source: "history".into(),
                scope: EventScope::CompyApplied,
                game: None,
                summary: format!("Event {i}"),
                detail: None,
                observed_between: None,
                since_rolled_back: false,
                rec_id: None,
            })
            .collect();
        let m = f.model();
        assert_eq!(m.chronology.entries.len(), MAX_CHRONOLOGY, "display is capped");
        assert_eq!(m.chronology.total_events, MAX_CHRONOLOGY + 5, "the record is not");

        let b = m
            .evidence
            .answers
            .iter()
            .find(|a| a.answer == "What recently changed?")
            .expect("Answer B is always present");
        assert_eq!(
            b.oldest_observed_at.as_deref(),
            Some("2026-01-01T00:00:00Z"),
            "the span must reach the oldest RETAINED event, not the oldest SHOWN one"
        );
        // The contract the review named: these two signals describe the same retained record and
        // are printed on the same screen, so they may not disagree.
        assert_eq!(
            b.oldest_observed_at.as_deref(),
            m.chronology.recorded_from.as_deref(),
            "the evidence span and the model's own retained-history boundary must agree"
        );
        assert_eq!(
            b.newest_observed_at.as_deref(),
            Some(format!("2026-01-{:02}T00:00:00Z", MAX_CHRONOLOGY + 5).as_str())
        );
    }

    // ── 7g. The display cap never shortens the History tape (#450) ─────────

    /// The History tape read the observed events off the intelligence timeline, uncapped, and now
    /// reads them out of this model. So the model's list must carry EVERY observed event the
    /// timeline holds — a cap there would delete rows from the only surface that shows them —
    /// while the scopes that have their own surface stay capped.
    #[test]
    fn the_observed_scope_is_never_cut_off_at_the_display_cap() {
        let mut f = Fixture::new();
        f.snapshots.clear();
        let event = |i: usize, scope: EventScope| crate::intelligence::EventRecord {
            id: format!("{}:evt-{i}", if scope == EventScope::Observed { "obs" } else { "applied" }),
            timestamp: format!("2026-01-{:02}T00:00:00Z", i + 1),
            event_type: "gpu-driver-change".into(),
            source: "identity-snapshot".into(),
            scope,
            game: None,
            summary: format!("Event {i}"),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: None,
        };
        let over_cap = MAX_CHRONOLOGY + 5;
        f.timeline = (0..over_cap)
            .map(|i| event(i, EventScope::Observed))
            .chain((0..over_cap).map(|i| event(i, EventScope::CompyApplied)))
            .collect();

        let m = f.model();
        let observed: Vec<&ChronologyEntry> = m
            .chronology
            .entries
            .iter()
            .filter(|e| e.scope == EventScope::Observed)
            .collect();
        assert_eq!(
            observed.len(),
            over_cap,
            "every observed event must travel — the tape shows no fewer rows than it did when it \
             read the timeline itself"
        );
        // And by id, so a truncation cannot hide behind a matching count.
        let ids: Vec<&str> = observed.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"obs:evt-0"), "including the oldest: {ids:?}");
        assert_eq!(
            m.chronology
                .entries
                .iter()
                .filter(|e| e.scope != EventScope::Observed)
                .count(),
            MAX_CHRONOLOGY,
            "the scopes with their own surface stay capped"
        );
        assert_eq!(m.chronology.total_events, over_cap * 2, "the record is not capped either");
    }

    // ── 7b. The exemption has a bound, and the bound is tied to the producers (#456) ─────────

    /// `IDENTITY_STREAM_OBSERVED_ROWS` is a literal on purpose: a derived constant would move in
    /// step with snapshot retention and every `get_machine_model` payload would grow with nobody
    /// noticing. This test IS the notice — it fails until whoever moved either side moves the other.
    #[test]
    fn the_observed_ceiling_is_tied_to_identity_snapshot_retention() {
        use crate::intelligence::{MAX_IDENTITY_SNAPSHOTS, OBSERVED_KINDS_PER_READING};
        assert_eq!(
            IDENTITY_STREAM_OBSERVED_ROWS,
            MAX_IDENTITY_SNAPSHOTS * OBSERVED_KINDS_PER_READING,
            "identity-snapshot retention or the per-reading kind count moved: re-derive \
             IDENTITY_STREAM_OBSERVED_ROWS (and so MAX_OBSERVED_CHRONOLOGY) in the same change — \
             this is the size of every get_machine_model payload changing"
        );
        // Compile-time, per clippy (assertions_on_constants): the inequalities hold or the test
        // target does not build — which fails `cargo test` just as loudly, at the same named test.
        const {
            assert!(
                OBSERVED_CHRONOLOGY_HEADROOM >= crate::sessions::MAX_SESSIONS * 2,
                "the headroom must at least hold the session fingerprint stream: MAX_SESSIONS prints × \
                 two kinds (hardware-change, gpu-driver-change)"
            );
        }
        assert_eq!(
            MAX_OBSERVED_CHRONOLOGY,
            IDENTITY_STREAM_OBSERVED_ROWS + OBSERVED_CHRONOLOGY_HEADROOM
        );
        const {
            assert!(
                MAX_OBSERVED_CHRONOLOGY > MAX_CHRONOLOGY,
                "the exemption widens the display cap, never narrows it"
            );
        }
    }

    /// The property slice 2 bought, re-proven under the ceiling: a store filled to the producers'
    /// own retention limits — every reading changing everything the scanner watches, every
    /// session print shifting the rig — still puts EVERY observed row through the model. The
    /// ceiling is a sanity bound above that, not a second display cap.
    #[test]
    fn a_full_identity_store_never_reaches_the_observed_ceiling() {
        use crate::intelligence::MAX_IDENTITY_SNAPSHOTS;
        use crate::sessions::MAX_SESSIONS;
        let stamp = |base: &str, hours: usize| {
            (chrono::DateTime::parse_from_rfc3339(base).expect("base stamp")
                + chrono::Duration::hours(hours as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        };
        let mut p = producers();
        // MAX_IDENTITY_SNAPSHOTS readings, each changing driver, RAM, display, Windows build and
        // power plan (GPU held, so the driver delta is not reset as a swap artefact): four
        // observed kinds per reading after the first — the widest stream the snapshot store holds.
        p.snapshots = (0..MAX_IDENTITY_SNAPSHOTS)
            .map(|i| {
                let mut s = snap(
                    &stamp("2020-01-01T00:00:00Z", i),
                    "Radeon RX 9070 XT",
                    &format!("25.{i}.1"),
                    16 + 16 * (i as u32 % 2),
                    "h",
                );
                s.display = format!("2560x1440@{}", 60 + i);
                s.windows_build = format!("{}", 26100 + i);
                s.power_plan = format!("plan-{i}");
                s
            })
            .collect();
        // MAX_SESSIONS fingerprinted sessions in a disjoint period, each shifting driver and RAM:
        // two observed kinds per print, none deduplicated against the snapshot stream.
        p.sessions = (0..MAX_SESSIONS)
            .map(|i| {
                let mut s = session_row(&stamp("2023-01-01T00:00:00Z", i));
                s.hw_fingerprint = Some(fp(
                    "Radeon RX 9070 XT",
                    &format!("s{i}"),
                    16 + 16 * (i as u32 % 2),
                    "2560x1440@165",
                    "h",
                ));
                s
            })
            .collect();

        let assembled = crate::intelligence::assemble_timeline(&p.timeline_inputs());
        let observed_in_record = assembled
            .events
            .iter()
            .filter(|e| e.scope == EventScope::Observed)
            .count();
        assert!(
            observed_in_record > MAX_CHRONOLOGY,
            "the fixture must exercise the exemption: {observed_in_record} observed rows"
        );
        assert!(
            observed_in_record <= MAX_OBSERVED_CHRONOLOGY,
            "a store at the producers' own limits produced {observed_in_record} observed rows, over \
             the {MAX_OBSERVED_CHRONOLOGY} ceiling — the ceiling would now shorten the History tape"
        );

        let m = model_from(&p);
        let observed_shown = m
            .chronology
            .entries
            .iter()
            .filter(|e| e.scope == EventScope::Observed)
            .count();
        assert_eq!(
            observed_shown, observed_in_record,
            "every observed row travels — the tape is not shortened"
        );
        assert_eq!(m.chronology.total_events, assembled.events.len());
    }

    /// The headroom's third producer, stated so it can be falsified (#506). The Trust Ledger never
    /// caps `AppliedChange` rows and stamps a rig fingerprint on every apply, so on apply count
    /// alone it could outgrow any ceiling. It does not, because `assemble_timeline` feeds every
    /// fingerprinted record — sessions and applies together, time-ordered — through ONE
    /// `IdentityDeltaScan`, which emits a row only when a print DIFFERS from the last one it saw.
    /// A rig that never changes puts nothing on the tape however often Compy applies.
    #[test]
    fn ledger_applies_at_a_constant_rig_put_no_observed_rows_on_the_tape() {
        let stamp = |i: usize| {
            (chrono::DateTime::parse_from_rfc3339("2020-01-01T00:00:00Z").expect("base stamp")
                + chrono::Duration::minutes(i as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        };
        let mut p = producers();
        p.snapshots.clear();
        // More applies than the ceiling holds, every one on the same rig: if apply count drove
        // observed rows, this store alone would bind the ceiling.
        let applies = MAX_OBSERVED_CHRONOLOGY * 2;
        p.applied = (0..applies)
            .map(|i| {
                let mut c = ledger_row(&format!("apply-{i}"), "Enable Game Mode", &stamp(i));
                c.hw_fingerprint = Some(fp("Radeon RX 9070 XT", "25.5.1", 32, "2560x1440@165", "h"));
                c
            })
            .collect();

        let assembled = crate::intelligence::assemble_timeline(&p.timeline_inputs());
        let observed = assembled
            .events
            .iter()
            .filter(|e| e.scope == EventScope::Observed)
            .count();
        assert_eq!(
            observed, 0,
            "a constant rig stamped on {applies} applies put {observed} observed rows on the tape"
        );
        assert_eq!(
            assembled.events.len(),
            applies,
            "every apply still reached the timeline as its own Compy-applied event"
        );

        let m = model_from(&p);
        assert!(
            m.chronology.entries.iter().all(|e| e.scope != EventScope::Observed),
            "nothing observed is shown"
        );
        assert_eq!(
            m.chronology.entries.len(),
            MAX_CHRONOLOGY,
            "the applied scope stays on its own display cap"
        );
        assert_eq!(m.chronology.total_events, applies, "the record counts every apply");
    }

    /// And when the rig DOES change under the ledger, the tape grows with the changes and not with
    /// the applies between them: the same flips spread over eight times as many applies are the
    /// same observed rows, in the same order. Each flip is at most two rows — hardware-change and
    /// gpu-driver-change — because a rig fingerprint carries no Windows or power-plan field; that
    /// "× two kinds" is the arithmetic `OBSERVED_CHRONOLOGY_HEADROOM` is sized from.
    #[test]
    fn observed_rows_under_the_ledger_track_rig_flips_not_apply_count() {
        let stamp = |i: usize| {
            (chrono::DateTime::parse_from_rfc3339("2020-01-01T00:00:00Z").expect("base stamp")
                + chrono::Duration::minutes(i as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        };
        // `flips` rig changes, one every `period` applies; every flip moves the driver AND the
        // RAM — the widest change one print can carry.
        let store = |flips: usize, period: usize| {
            let mut p = producers();
            p.snapshots.clear();
            p.applied = (0..(flips + 1) * period)
                .map(|i| {
                    let seg = i / period;
                    let mut c = ledger_row(&format!("apply-{i}"), "Enable Game Mode", &stamp(i));
                    c.hw_fingerprint = Some(fp(
                        "Radeon RX 9070 XT",
                        &format!("25.{seg}.1"),
                        16 + 16 * (seg as u32 % 2),
                        "2560x1440@165",
                        &format!("h{seg}"),
                    ));
                    c
                })
                .collect();
            p
        };
        let observed_kinds = |p: &ChronologyProducers| -> Vec<String> {
            crate::intelligence::assemble_timeline(&p.timeline_inputs())
                .events
                .into_iter()
                .filter(|e| e.scope == EventScope::Observed)
                .map(|e| e.event_type)
                .collect()
        };

        let flips = 40;
        let sparse = store(flips, 3);
        let dense = store(flips, 25);
        assert!(
            dense.applied.len() >= 8 * sparse.applied.len(),
            "the fixture must separate flips from applies: {} vs {} applies",
            dense.applied.len(),
            sparse.applied.len()
        );
        let sparse_kinds = observed_kinds(&sparse);
        let dense_kinds = observed_kinds(&dense);
        assert_eq!(sparse_kinds.len(), flips * 2, "{flips} flips × two kinds per print");
        assert_eq!(
            dense_kinds, sparse_kinds,
            "the same flips over 8× the applies: the same rows, the same kinds, the same order"
        );
        assert_eq!(
            sparse_kinds.iter().filter(|k| *k == "hardware-change").count(),
            flips,
            "one hardware-change per flip"
        );
        assert_eq!(
            sparse_kinds.iter().filter(|k| *k == "gpu-driver-change").count(),
            flips,
            "one gpu-driver-change per flip"
        );

        // And the model shows every one of them: they are what the headroom is for.
        let m = model_from(&dense);
        let shown = m
            .chronology
            .entries
            .iter()
            .filter(|e| e.scope == EventScope::Observed)
            .count();
        assert_eq!(shown, flips * 2, "every observed row travels");
        assert_eq!(
            m.chronology.total_events,
            dense.applied.len() + flips * 2,
            "the record counts every apply and every flip"
        );
    }
    /// When the ceiling does bind — a long-lived install whose rig changed more times than the
    /// headroom holds, or a store beyond what the producers retain — it behaves like the display
    /// cap and not like a lie: the newest rows stay, the oldest fall
    /// off the SHOWN list, and `total_events` still counts every one of them.
    #[test]
    fn past_the_observed_ceiling_the_oldest_rows_drop_and_the_count_stays_honest() {
        let mut f = Fixture::new();
        f.snapshots.clear();
        let stamp = |i: usize| {
            (chrono::DateTime::parse_from_rfc3339("2020-01-01T00:00:00Z").expect("base stamp")
                + chrono::Duration::minutes(i as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        };
        let event = |i: usize, scope: EventScope| crate::intelligence::EventRecord {
            id: format!("{}:evt-{i}", if scope == EventScope::Observed { "obs" } else { "applied" }),
            timestamp: stamp(i),
            event_type: "gpu-driver-change".into(),
            source: "identity-snapshot".into(),
            scope,
            game: None,
            summary: format!("Event {i}"),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: None,
        };
        let over = MAX_OBSERVED_CHRONOLOGY + 3;
        let applied = MAX_CHRONOLOGY + 2;
        f.timeline = (0..over)
            .map(|i| event(i, EventScope::Observed))
            .chain((0..applied).map(|i| event(i, EventScope::CompyApplied)))
            .collect();

        let m = f.model();
        let observed: Vec<&str> = m
            .chronology
            .entries
            .iter()
            .filter(|e| e.scope == EventScope::Observed)
            .map(|e| e.id.as_str())
            .collect();
        assert_eq!(observed.len(), MAX_OBSERVED_CHRONOLOGY, "the ceiling is exact");
        let newest = format!("obs:evt-{}", over - 1);
        assert_eq!(observed.first().copied(), Some(newest.as_str()), "newest first, and kept");
        for i in 0..3 {
            let oldest = format!("obs:evt-{i}");
            assert!(!observed.contains(&oldest.as_str()), "the oldest rows are the ones that fall off");
        }
        assert_eq!(
            m.chronology.entries.iter().filter(|e| e.scope != EventScope::Observed).count(),
            MAX_CHRONOLOGY,
            "the scopes with their own surface stay on the display cap"
        );
        assert_eq!(m.chronology.total_events, over + applied, "the record is never capped");
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

    // ── Review fixes for #387: #446 · #392 · #447 ─────────────────────────

    /// #446: `build()` defaulted a load error to an empty row list, so a corrupt ledger — the one
    /// state in which every rollback is blocked — rendered "Compy has recorded no change on this
    /// machine". An unreadable ledger must compose as UNKNOWN, carry its error, and never borrow
    /// the empty-ledger sentence.
    #[test]
    fn an_unreadable_ledger_is_unknown_never_an_empty_one() {
        let mut f = Fixture::new();
        f.ledger_error = Some("history.json did not parse".into());
        let m = f.model();

        let note = m.compy_changes.ledger_unreadable.as_deref().expect("the load error is carried");
        assert!(note.contains("history.json did not parse"));
        let ledger_unknown = m
            .evidence
            .unknowns
            .iter()
            .find(|u| u.field == "compy_changes.changes")
            .expect("an unreadable ledger is an unknown fact");
        assert!(ledger_unknown.reason.contains("could not be read"));
        assert!(
            !m.evidence.unknowns.iter().any(|u| u.reason == LEDGER_EMPTY),
            "an unreadable ledger must never be reported as an empty one"
        );
        assert!(m
            .evidence
            .unknowns
            .iter()
            .any(|u| u.field == "chronology.applied_changes"));
        let reason = m.chronology.unknown_reason.as_deref().expect("chronology names the hole");
        assert!(reason.starts_with(CHRONOLOGY_LEDGER_UNREADABLE));
        // Diagnostics renders no counts for it: a zero there would be a claim nothing read.
        let rendered = rendered_entries(&m);
        let (_, value, note) = rendered
            .iter()
            .find(|(l, _, _)| l == "Changes Compy applied")
            .expect("the section renders the ledger row");
        assert_eq!(value, "Unreadable");
        assert!(note.contains("history.json did not parse"));

        // Other producers filling the view do not make the missing ledger rows disappear.
        f.timeline.push(crate::intelligence::EventRecord {
            id: "session:1".into(),
            timestamp: "2026-08-02T00:00:00Z".into(),
            event_type: "session-ended".into(),
            source: "sessions".into(),
            scope: EventScope::Observed,
            game: None,
            summary: "Session".into(),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: None,
        });
        let m = f.model();
        assert!(m
            .chronology
            .unknown_reason
            .as_deref()
            .is_some_and(|r| r.starts_with(CHRONOLOGY_LEDGER_UNREADABLE)));

        // A READABLE empty ledger still says empty, and carries no load error.
        f.ledger_error = None;
        let m = Fixture::new().model();
        assert!(m.compy_changes.ledger_unreadable.is_none());
        assert!(m.evidence.unknowns.iter().any(|u| u.reason == LEDGER_EMPTY));

        // Structural half: build() must not default the load error away again.
        let defaulted = format!("load_{}().unwrap_or_default", "history");
        assert_eq!(OWN_SOURCE.match_indices(defaulted.as_str()).count(), 0);
        let carried = format!("ledger_error: ledger_error.as_{}", "deref()");
        assert_eq!(OWN_SOURCE.match_indices(carried.as_str()).count(), 1);
    }

    /// #392: a probe that read nothing (or a rec Compy has no probe for) kept the legacy
    /// `is_still_active == true`, and the model reported it as live-proven "in effect". Unread is
    /// unknown: its own count, an unknown fact, never folded into "active" or "not in effect".
    #[test]
    fn an_unread_live_check_is_unknown_not_proven_in_effect() {
        let mut f = Fixture::new();
        for (id, check) in [
            ("on", ActiveCheck::On),
            ("off", ActiveCheck::Off),
            ("unread", ActiveCheck::Unreadable),
            ("unprobed", ActiveCheck::Unrecognised),
        ] {
            // One change per check: the counts are per change since #453.
            let mut v = crate::history::test_view(
                id, id, "Enable Game Mode", "2026-07-04T09:30:00Z", "applied",
                check.legacy_active(), Some(true), None, true,
            );
            v.active_check = Some(check);
            f.changes.push(v);
        }
        let m = f.model();
        let t = &m.compy_changes;
        assert_eq!(t.active_now, 1, "only the successful ON read is proven in effect");
        assert_eq!(t.applied_but_not_in_effect, 1, "only the successful OFF read is not in effect");
        assert_eq!(t.in_effect_unknown, 2);
        assert_eq!(t.on_this_rig, 4, "attribution is tallied for every row regardless");

        let by_id = |id: &str| t.changes.iter().find(|c| c.id == id).expect("row present");
        assert_eq!(by_id("on").still_active.value, Some(true));
        assert_eq!(by_id("on").still_active.class, EvidenceClass::DirectlyObserved);
        assert_eq!(by_id("off").still_active.value, Some(false));
        for id in ["unread", "unprobed"] {
            let fact = &by_id(id).still_active;
            assert!(fact.is_unknown(), "{id} must be unknown, not a live reading");
            assert!(fact.value.is_none());
        }

        // A rolled-back row is not re-checked, so "still active" does not apply to it.
        let mut f = Fixture::new();
        f.changes.push(crate::history::test_view(
            "rb", "game-mode", "Enable Game Mode", "2026-07-04T09:30:00Z", "rolled_back", false,
            Some(true), Some("2026-07-05T00:00:00Z".into()), true,
        ));
        let m = f.model();
        assert!(m.compy_changes.changes[0].still_active.is_not_applicable());
        assert_eq!(m.compy_changes.rolled_back, 1);
        assert_eq!(m.compy_changes.in_effect_unknown, 0);
    }

    /// #447: the baseline check only asked whether the PRIMARY adapter appeared in the baseline
    /// list, so adding or removing a second GPU read as agreement here while
    /// `hwchange::diff_fingerprint` reported "GPU changed". Both surfaces must apply one rule.
    #[test]
    fn the_gpu_baseline_compare_matches_hwchange_on_the_whole_adapter_list() {
        // Only hwchange's GPU lines are the comparison under test; CPU/RAM fixtures differ.
        let gpu_verdicts = |base: &HardwareFingerprint, live: &HardwareFingerprint| {
            crate::hwchange::diff_fingerprint(base, live)
                .iter()
                .filter(|l| l.starts_with("GPU"))
                .count()
        };
        let mut f = Fixture::new();
        // Live machine: one adapter. Baseline: that adapter plus an iGPU since removed.
        f.baseline = Some(crate::hwchange::test_fingerprint(
            "AMD Ryzen 7 7800X3D",
            &["AMD Radeon(TM) Graphics", "Radeon RX 9070 XT"],
            31,
        ));
        let m = f.model();
        let d = m
            .identity
            .disagreements
            .iter()
            .find(|d| d.field == "gpu")
            .expect("a removed adapter is a GPU disagreement");
        assert_eq!(d.left.value, "Radeon RX 9070 XT");
        assert_eq!(d.right.producer, PRODUCER_HWCHANGE);

        // The model agrees with hwchange's own verdict on the same pair, both ways.
        let base = f.baseline.clone().unwrap();
        let live = crate::hwchange::fingerprint(&hardware());
        assert!(gpu_verdicts(&base, &live) > 0);

        f.baseline = Some(crate::hwchange::test_fingerprint(
            "AMD Ryzen 7 7800X3D",
            &["Radeon RX 9070 XT"],
            31,
        ));
        let m = f.model();
        assert!(!m.identity.disagreements.iter().any(|d| d.field == "gpu"));
        assert!(m.identity.compared_fields.iter().any(|c| c.field == "gpu"));
        let same = crate::hwchange::fingerprint(&hardware());
        assert_eq!(gpu_verdicts(f.baseline.as_ref().unwrap(), &same), 0);
    }

    // ── Wire contract (#449) ──────────────────────────────────────────────
    //
    // The frontend's TypeScript copy of this model (`src/types.ts`) is checked against
    // `src/test/fixtures/machine-model.wire.json` by `src/machine-model-contract.test.ts`. This test
    // is the other half: the fixture must be exactly what serde emits, so a field added, renamed or
    // removed here goes red until the fixture (and therefore the TS contract) is updated with it.
    // To regenerate deliberately, run `COMPY_PRINT_WIRE_FIXTURE=1 cargo test --lib wire_fixture --
    // --nocapture` and save the JSON printed between the markers. This module never writes a file
    // (see `composition_module_contains_no_write_or_mutation_call`), not even from a test.

    const WIRE_FIXTURE: &str =
        concat!(env!("CARGO_MANIFEST_DIR"), "/../src/test/fixtures/machine-model.wire.json");

    fn wire_fixture_model() -> MachineModel {
        let mut f = Fixture::new();
        // An unknown fact: Windows edition/build could not be read.
        f.hardware.windows_version = None;
        // An identity disagreement: the stored baseline holds a different RAM total.
        f.baseline = Some(crate::hwchange::test_fingerprint(
            "AMD Ryzen 7 7800X3D",
            &["Radeon RX 9070 XT"],
            16,
        ));
        let mut applied = crate::history::test_view(
            "chg-1",
            "game-mode",
            "Enable Game Mode",
            "2026-07-04T09:30:00Z",
            "applied",
            true,
            Some(true),
            None,
            true,
        );
        applied.restores_label = Some("Game Mode off".into());
        f.changes.push(applied);
        f.changes.push(crate::history::test_view(
            "chg-2",
            "hags",
            "Turn on hardware-accelerated GPU scheduling",
            "2026-07-05T09:30:00Z",
            "rolled_back",
            false,
            None,
            Some("2026-07-06T09:30:00Z".into()),
            true,
        ));
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
        f.model()
    }

    #[test]
    fn wire_fixture_matches_what_serde_emits() {
        let m = wire_fixture_model();
        // The fixture must carry the states the frontend has to render honestly.
        assert!(m.identity.windows.is_unknown(), "fixture needs an unknown fact");
        assert!(!m.identity.disagreements.is_empty(), "fixture needs an identity disagreement");

        let emitted = serde_json::to_string_pretty(&m).expect("model serializes") + "\n";
        if std::env::var_os("COMPY_PRINT_WIRE_FIXTURE").is_some() {
            println!("----- BEGIN machine-model.wire.json -----\n{emitted}----- END -----");
        }
        let on_disk = std::fs::read_to_string(WIRE_FIXTURE)
            .expect("src/test/fixtures/machine-model.wire.json is missing")
            .replace("\r\n", "\n");
        assert!(
            on_disk == emitted,
            "the Machine Model wire shape changed. Update src/types.ts, then regenerate the fixture \
             with COMPY_PRINT_WIRE_FIXTURE=1 and re-run src/machine-model-contract.test.ts"
        );
    }
}
