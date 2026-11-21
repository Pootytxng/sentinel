// D3 vocabulary, slice 1: the types and the mappers from today's producers.
//
// Compy answers two different questions, and each gets its own axis:
//   1. SOURCE   - how does Compy know this fact? (read it, measured it, could not read it ...)
//   2. STRENGTH - how strongly does the evidence point at a reason? (possible, most likely)
// A fact line carries one source and never a strength. Only a candidate reason carries a strength.
// "Compy can't tell" is a plain sentence, not a rung: so Possible is the lowest strength ever shown.
//
// Nothing here changes a stored or wire value. The mappers accept every value the Rust side and the
// existing screens already use, so old data keeps reading. confidence-word.ts is the first caller
// (its words are produced through these mappers, unchanged). Words for the new tags, and their
// zh-CN twins, arrive in slice 2.
//
// WHAT TYPESCRIPT PREVENTS HERE (checked by `tsc`, which runs in `npm run build`; vitest does not
// type-check, and the @ts-expect-error lines in certainty.test.ts only prove anything under tsc):
//   - a strength on a fact line: the `source` arm of Mapped has no `strength` field;
//   - a value on an unread line: the `unread` arm of SourcedValue has no `value` field;
//   - a most-likely that did not come from strengthFor() or fromCertainty("likely"): the
//     most-likely strength is a branded type, so the bare literal "most-likely" is not a Strength.
// Everything else (two independent supports are really independent, the order callers pass to
// limitMostLikelyToOne, coverage being computed right) is a runtime rule or a caller duty, tested
// but not enforced by types.
import type { ConfidenceBand, Provenance } from "../types";
import type { FindingLevel } from "../surfaces/home-interview-data";

/** How Compy knows a fact. Wire names are the literals (kebab-case). */
export const SOURCES = ["read", "measured", "measured-once", "user", "general", "unread"] as const;
export type Source = (typeof SOURCES)[number];

/** The wire spellings of a strength, for serialisation and i18n. There is no "none" member on
 *  purpose: no strength is the absence of one (the "can't tell" sentence), never a rung. */
export const STRENGTHS = ["possible", "most-likely"] as const;
export type StrengthWire = (typeof STRENGTHS)[number];

declare const MOST_LIKELY_BRAND: unique symbol;
/** The top strength. Branded: the only places that create one are strengthFor() and
 *  fromCertainty("likely") below, so a bare "most-likely" string does not type-check as a Strength. */
export type MostLikely = "most-likely" & { readonly [MOST_LIKELY_BRAND]: true };
export type Strength = "possible" | MostLikely;

// The two creation sites. strengthFor() applies the two-support rule here. fromCertainty("likely")
// is the one legacy path: it trusts paramedic.rs (~line 1322), which only emits Likely behind its own
// `independent() >= 2` and no-contradicting-session check.
const MOST_LIKELY = "most-likely" as MostLikely;

/** A strength back to its wire spelling (for rendering keys and serialisation). */
export const strengthWire = (s: Strength): StrengthWire => (s === "possible" ? "possible" : "most-likely");

/** The two fixed notes that sit beside a source tag; they are not tags themselves. */
export const SOURCE_NOTES = ["effect-not-measured", "checked-none"] as const;
export type SourceNote = (typeof SOURCE_NOTES)[number];

/** What an existing value becomes. The three arms are separate on purpose: a fact line (source arm)
 *  has no strength field, so it cannot carry one. */
export type Mapped =
  /** A fact line. `relation` is only set where the old value also said "supports this". */
  | { axis: "source"; source: Source; note?: SourceNote; relation?: "supports" }
  /** A candidate reason. */
  | { axis: "strength"; strength: Strength }
  /** No tag at all: Compy says it can't tell (a sentence). */
  | { axis: "cant-tell" };

const source = (s: Source, extra: { note?: SourceNote; relation?: "supports" } = {}): Mapped => ({ axis: "source", source: s, ...extra });
const possible: Mapped = { axis: "strength", strength: "possible" };
const CANT_TELL: Mapped = { axis: "cant-tell" };

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

/** What a candidate's evidence amounts to. */
export interface StrengthEvidence {
  /** Independent supporting lines. This must be the count the Rust side computes with
   *  `independent()` (paramedic.rs ~1325-1336), not a count of lines: two lines from one record are
   *  one support. This function cannot tell the difference. */
  independentSupports: number;
  /** Lines that weaken the candidate. */
  contradicting: number;
  /** The main support is a line Compy could not read. */
  keySupportUnread: boolean;
  /** A measured size past its own line (a lone support that still earns Possible). */
  measuredSize?: boolean;
}

/** The strongest strength the evidence allows, or null when Compy can't tell. Most likely needs two
 *  independent supports, no contradicting evidence, and a main support that was read. Possible needs
 *  one support or a measured size. Nothing else is ever shown. */
export function strengthFor(e: StrengthEvidence): Strength | null {
  if (e.independentSupports >= 2 && e.contradicting === 0 && !e.keySupportUnread) return MOST_LIKELY;
  if (e.independentSupports >= 1 || e.measuredSize === true) return "possible";
  return null;
}

/** At most one "most likely" per answer: the FIRST one in the array keeps it, any later one is shown
 *  as Possible. Which one wins depends on the order, so the caller must pass its strongest candidate
 *  first (the Paramedic already orders Likely first, paramedic.rs ~1570). */
export function limitMostLikelyToOne(strengths: readonly (Strength | null)[]): (Strength | null)[] {
  let seen = false;
  return strengths.map((s) => {
    if (s === null || s === "possible") return s;
    if (seen) return "possible";
    seen = true;
    return s;
  });
}

/** A value with its source. The unread arm carries a reason and NO value: "couldn't read" can never
 *  be turned into an empty or zero value by accident (under `tsc`). */
export type SourcedValue<T> =
  | { source: Exclude<Source, "unread">; value: T }
  | { source: "unread"; reason: string };

/** Absence may be said ("Checked: none found") only when the read covered the whole window; any
 *  part not covered makes the line unread. Couldn't read is never none. The caller computes
 *  coverage (blackbox.rs SystemLogCoverage). */
export function sourceForAbsence(coveredWholeWindow: boolean): Mapped {
  return coveredWholeWindow ? source("read", { note: "checked-none" }) : source("unread");
}

// ---------------------------------------------------------------------------------------------
// Mappers: one per existing producer. Input literals are the producers' serialized names.
// ---------------------------------------------------------------------------------------------

/** paramedic.rs `Certainty` (kebab-case). Only `likely` becomes most-likely, and it does so by
 *  trusting the Rust two-support rule (see MOST_LIKELY above); new callers must not build a
 *  most-likely from a legacy string. */
export const CERTAINTY_VALUES = ["known", "measured", "likely", "possible", "mechanism", "cant-tell"] as const;
export type CertaintyWire = (typeof CERTAINTY_VALUES)[number];
export function fromCertainty(c: CertaintyWire): Mapped {
  switch (c) {
    case "known": return source("read");
    case "measured": return source("measured");
    case "likely": return { axis: "strength", strength: MOST_LIKELY };
    case "possible": return possible;
    case "mechanism": return source("general");
    case "cant-tell": return CANT_TELL;
  }
}

/** paramedic.rs `EvidenceKind` (kebab-case). The separate `against` flag stays as it is. */
export const EVIDENCE_KIND_VALUES = ["known", "measured", "supported-inference", "expected-mechanism", "unknown"] as const;
export type EvidenceKindWire = (typeof EVIDENCE_KIND_VALUES)[number];
export function fromEvidenceKind(k: EvidenceKindWire): Mapped {
  switch (k) {
    case "known": return source("read");
    case "measured": return source("measured");
    case "supported-inference": return source("measured", { relation: "supports" });
    case "expected-mechanism": return source("general");
    case "unknown": return source("unread");
  }
}

/** blackbox.rs `Strength` (lowercase). Every band is Possible: today's rules rest on one kind of
 *  evidence, and a reserved strong/partial stays Possible until a rule proves two supports. */
export const BLACKBOX_STRENGTH_VALUES = ["strong", "partial", "weak"] as const;
export type BlackboxStrengthWire = (typeof BLACKBOX_STRENGTH_VALUES)[number];
export function fromBlackboxStrength(_s: BlackboxStrengthWire): Mapped {
  return possible;
}

/** priorities.rs `Basis` (kebab-case); absent on rows written before it existed. */
export const PRIORITY_BASIS_VALUES = ["fact", "measured"] as const;
export type PriorityBasisWire = (typeof PRIORITY_BASIS_VALUES)[number];

/** A priority row. A fact Compy read is source "read" with the note that its effect on FPS is not
 *  measured (never a strength, and old rows with no basis read as a fact). A measured row's fixed
 *  table rank is not two supports, so at best it is Possible; a low rank has no strength. */
export function fromPriorityRow(basis: PriorityBasisWire | undefined, band: ConfidenceBand | null | undefined): Mapped {
  if (basis !== "measured") return source("read", { note: "effect-not-measured" });
  return band === "high" || band === "medium" ? possible : source("measured");
}

/** intelligence.rs `Confidence` of a What-changed hypothesis (kebab-case). Capped at Possible until
 *  an audit shows two independent supports (design question 2, open); low and unknown are "can't tell". */
export function fromHypothesisBand(band: ConfidenceBand | null | undefined): Mapped {
  return band === "high" || band === "medium" ? possible : CANT_TELL;
}

/** intelligence_patterns.rs rows are measured observations; the band says nothing about the source. */
export function fromPatternBand(_band: ConfidenceBand | null | undefined): Mapped {
  return source("measured");
}

/** home-interview-data.ts `FindingLevel`. "unknown" there means "no evidence", not "Compy tried to
 *  read and failed", so it is "can't tell", not source `unread` (the design table says unread: wrong). */
export const FINDING_LEVEL_VALUES = ["measured", "likely", "unknown"] as const satisfies readonly FindingLevel[];
export function fromFindingLevel(level: FindingLevel): Mapped {
  switch (level) {
    case "measured": return source("measured");
    case "likely": return possible;
    case "unknown": return CANT_TELL;
  }
}

/** types.ts `Provenance` of a recommendation's impact claim. */
export const PROVENANCE_VALUES = ["verified", "measured-signal", "expected-impact"] as const satisfies readonly Provenance[];
export function fromProvenance(p: Provenance): Mapped {
  switch (p) {
    case "verified": return source("read");
    case "measured-signal": return source("measured-once");
    case "expected-impact": return source("general");
  }
}

/** ExperimentBench `BenchWord` kinds (the one source of truth: ExperimentBench.tsx imports this
 *  type). A real-play result is one uncontrolled comparison. A two-session Trial ("measured") is one
 *  before/after pair, and the Trial record stores no repeat count (ExperimentBench.tsx ~232: `mode`
 *  is absent on a two-session Trial), so it is `measured-once`, never `measured`. */
export const BENCH_KIND_VALUES = ["estimate", "measured", "real-play"] as const;
export type BenchKind = (typeof BENCH_KIND_VALUES)[number];
export function fromBench(kind: BenchKind, band: ConfidenceBand | null | undefined): Mapped {
  if (band !== "high" && band !== "medium") return CANT_TELL;
  return kind === "estimate" ? source("general") : source("measured-once");
}
