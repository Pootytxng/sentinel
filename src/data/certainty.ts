// D3 vocabulary, slice 1 (types only; nothing renders from this file yet).
//
// Compy answers two different questions, and each gets its own axis:
//   1. SOURCE   - how does Compy know this fact? (read it, measured it, could not read it ...)
//   2. STRENGTH - how strongly does the evidence point at a reason? (possible, most likely)
// A fact line carries one source and never a strength. Only a candidate reason carries a strength.
// "Compy can't tell" is a plain sentence, not a rung: so Possible is the lowest strength ever shown.
//
// Nothing here changes a stored or wire value. The mappers below accept every value the Rust side
// and the existing screens already use, so old data keeps reading. Words shown to people (and their
// zh-CN twins) arrive in slice 2; this file only names the keys they will live under.
import type { ConfidenceBand, Provenance } from "../types";
import type { FindingLevel } from "../surfaces/home-interview-data";

/** How Compy knows a fact. Wire names are the literals (kebab-case). */
export const SOURCES = ["read", "measured", "measured-once", "user", "general", "unread"] as const;
export type Source = (typeof SOURCES)[number];

/** How strongly the evidence points at a reason. There is no "none" member on purpose: no strength
 *  is the absence of one (the "can't tell" sentence), never a value that could be mistaken for a rung. */
export const STRENGTHS = ["possible", "most-likely"] as const;
export type Strength = (typeof STRENGTHS)[number];

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
const strength = (s: Strength): Mapped => ({ axis: "strength", strength: s });
const CANT_TELL: Mapped = { axis: "cant-tell" };

/** The i18n key of a source tag (common.source.*; strings land in slice 2). */
export const sourceKey = (s: Source): string => `common.source.${s}`;
/** The i18n key of a strength tag (common.strength.*; strings land in slice 2). */
export const strengthKey = (s: Strength): string => `common.strength.${s}`;

// ---------------------------------------------------------------------------------------------
// Rules the types make hard to break
// ---------------------------------------------------------------------------------------------

/** What a candidate's evidence amounts to. */
export interface StrengthEvidence {
  /** Independent supporting lines (two lines from one record count once: the caller decides). */
  independentSupports: number;
  /** Lines that weaken the candidate. */
  contradicting: number;
  /** The main support is a line Compy could not read. */
  keySupportUnread: boolean;
  /** A measured size past its own line (a lone support that still earns Possible). */
  measuredSize?: boolean;
}

/** The strongest strength the evidence allows, or null when Compy can't tell.
 *  Most likely needs two independent supports, no contradicting evidence, and a main support that
 *  was read. Possible needs one support or a measured size. Nothing else is ever shown. */
export function strengthFor(e: StrengthEvidence): Strength | null {
  if (e.independentSupports >= 2 && e.contradicting === 0 && !e.keySupportUnread) return "most-likely";
  if (e.independentSupports >= 1 || e.measuredSize === true) return "possible";
  return null;
}

/** At most one "most likely" per answer: the first keeps it, any later one is shown as Possible. */
export function limitMostLikelyToOne(strengths: readonly (Strength | null)[]): (Strength | null)[] {
  let seen = false;
  return strengths.map((s) => {
    if (s !== "most-likely") return s;
    if (seen) return "possible";
    seen = true;
    return s;
  });
}

/** A value with its source. The unread arm carries a reason and NO value: "couldn't read" can never
 *  be turned into an empty or zero value by accident. */
export type SourcedValue<T> =
  | { source: Exclude<Source, "unread">; value: T }
  | { source: "unread"; reason: string };

/** Absence may be said ("Checked: none found") only when the read covered the whole window; any
 *  part not covered makes the line unread. Couldn't read is never none. */
export function sourceForAbsence(coveredWholeWindow: boolean): Mapped {
  return coveredWholeWindow ? source("read", { note: "checked-none" }) : source("unread");
}

// ---------------------------------------------------------------------------------------------
// Mappers: one per existing producer. Input literals are the producers' serialized names.
// ---------------------------------------------------------------------------------------------

/** paramedic.rs `Certainty` (kebab-case). Only `likely` can become most-likely. */
export const CERTAINTY_VALUES = ["known", "measured", "likely", "possible", "mechanism", "cant-tell"] as const;
export type CertaintyWire = (typeof CERTAINTY_VALUES)[number];
export function fromCertainty(c: CertaintyWire): Mapped {
  switch (c) {
    case "known": return source("read");
    case "measured": return source("measured");
    case "likely": return strength("most-likely");
    case "possible": return strength("possible");
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
  return strength("possible");
}

/** priorities.rs `Basis` (kebab-case); absent on rows written before it existed. */
export const PRIORITY_BASIS_VALUES = ["fact", "measured"] as const;
export type PriorityBasisWire = (typeof PRIORITY_BASIS_VALUES)[number];

/** A priority row. A fact Compy read is source "read" with the note that its effect on FPS is not
 *  measured (never a strength, and old rows with no basis read as a fact). A measured row's fixed
 *  table rank is not two supports, so at best it is Possible; a low rank has no strength. */
export function fromPriorityRow(basis: PriorityBasisWire | undefined, band: ConfidenceBand | null | undefined): Mapped {
  if (basis !== "measured") return source("read", { note: "effect-not-measured" });
  return band === "high" || band === "medium" ? strength("possible") : source("measured");
}

/** intelligence.rs `Confidence` of a What-changed hypothesis (kebab-case). Capped at Possible until
 *  an audit shows two independent supports; low and unknown are "can't tell". */
export function fromHypothesisBand(band: ConfidenceBand | null | undefined): Mapped {
  return band === "high" || band === "medium" ? strength("possible") : CANT_TELL;
}

/** intelligence_patterns.rs rows are measured observations; the band says nothing about the source. */
export function fromPatternBand(_band: ConfidenceBand | null | undefined): Mapped {
  return source("measured");
}

/** home-interview-data.ts `FindingLevel`. */
export const FINDING_LEVEL_VALUES = ["measured", "likely", "unknown"] as const satisfies readonly FindingLevel[];
export function fromFindingLevel(level: FindingLevel): Mapped {
  switch (level) {
    case "measured": return source("measured");
    case "likely": return strength("possible");
    case "unknown": return source("unread");
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

/** ExperimentBench `BenchWord` kinds. A real-play result is one uncontrolled comparison. */
export const BENCH_KIND_VALUES = ["estimate", "measured", "real-play"] as const;
export type BenchKind = (typeof BENCH_KIND_VALUES)[number];
export function fromBench(kind: BenchKind, band: ConfidenceBand | null | undefined): Mapped {
  if (band !== "high" && band !== "medium") return CANT_TELL;
  return kind === "estimate" ? source("general") : kind === "real-play" ? source("measured-once") : source("measured");
}
