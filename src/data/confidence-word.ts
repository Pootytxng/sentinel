// P7-confidence (ROADMAP Phase 7 bullet 6; Constitution §25): ONE user-facing confidence vocabulary.
// Every surface that tags a conclusion says one of five words, mapped from the producer's own field
// — never a percentage, never a raw high/medium/low printed as if it meant something to a person:
//   Known     — a deterministic observation (Compy read the fact itself);
//   Measured  — an observed experiment or session result;
//   Likely    — a supported inference: the evidence points this way but does not prove the cause;
//   Expected  — engineering reasoning, not a measured outcome;
//   Unknown   — Compy lacks sufficient evidence (§26: a valid answer).
// The raw band stays available to the technical layer (`data-confidence` on the chip); only the
// default face is translated.
import type { ConfidenceBand, Provenance } from "../types";
import type { FindingLevel } from "../surfaces/home-interview-data";
import { fromBench, fromFindingLevel, fromHypothesisBand, fromPatternBand, fromPriorityRow, fromProvenance, PROVENANCE_VALUES, type BenchKind, type Mapped } from "./certainty";

export type ConfidenceWord = "known" | "measured" | "measuredOnce" | "possible" | "likely" | "expected" | "unknown";

// D3 slice 1: every function below produces the same word it always did, but by going through the
// two-axis mappers in certainty.ts (`from…` -> Mapped -> this word). Screens still see only the five
// words; the new tags arrive in slice 2. confidence-word.test.ts pins old-vs-new output.
function legacyWord(m: Mapped): ConfidenceWord {
  if (m.axis === "strength") return "likely";
  if (m.axis === "cant-tell") return "unknown";
  switch (m.source) {
    case "read": return "known";
    case "measured":
    case "measured-once": return "measured";
    case "general": return "expected";
    default: return "unknown";
  }
}

/** The word for a Mapped value as it is SHOWN today (u3-focus, 2026-11-21): a strength reads
 *  "Possible" (nothing above it is shown without two independent supports, and no band producer
 *  proves two); a source seen once reads "Measured once". Only a most-likely strength keeps the word
 *  "Likely", and none of the band mappers below can produce one. wordFromProvenance and
 *  wordFromFinding keep legacyWord: their screens are not part of this change. */
function shownWord(m: Mapped): ConfidenceWord {
  if (m.axis === "strength") return m.strength === "possible" ? "possible" : "likely";
  if (m.axis === "source" && m.source === "measured-once") return "measuredOnce";
  return legacyWord(m);
}

/** An inference band (limiter rows, hardware evidence, What-changed hypotheses):
 *  high and medium are shown as "Possible" (certainty.ts fromHypothesisBand caps them there: the
 *  evidence behind a band is not two independent supports); low and unknown are "Unknown". */
export function wordFromBand(band: ConfidenceBand | "high" | "medium" | "low" | null | undefined): ConfidenceWord {
  return shownWord(fromHypothesisBand(band));
}

/** A cross-session pattern (History's "Patterns across your sessions"). The rows are measured
 *  observations (certainty.ts `fromPatternBand`: source "measured"), so a supported pattern says
 *  "Measured", never "Likely": the screen states a trend in the numbers, not a cause. A band that is
 *  low or unknown is not a supported trend, so it stays "Unknown". The retired strength word
 *  ("Likely" above "Possible" with no two independent supports) cannot come out of here. */
export function wordFromPattern(band: ConfidenceBand | "high" | "medium" | "low" | null | undefined): ConfidenceWord {
  if (band !== "high" && band !== "medium") return "unknown";
  return legacyWord(fromPatternBand(band));
}

/** A priority row only says it was measured when its basis says so. Older data with no basis reads as
 *  a fact: never claim a measurement the row doesn't carry. */
export const isMeasuredRow = (basis: "fact" | "measured" | undefined): boolean => basis === "measured";

/** A priority row's word: a fact Compy read is "Known" (its effect on FPS is not measured, so never
 *  "Likely"); a measured row keeps the band's word ("Possible" or "Unknown"). */
export function wordFromRow(basis: "fact" | "measured" | undefined, band: ConfidenceBand | "high" | "medium" | "low" | null | undefined): ConfidenceWord {
  // A measured row with a low rank is source "measured" in the new vocabulary, but its word today is
  // Unknown, so a measured row still takes the band's word (wordFromBand).
  const m = fromPriorityRow(basis, band);
  return m.axis === "source" && m.note === "effect-not-measured" ? "known" : wordFromBand(band);
}

/** A recommendation's provenance: Verified = Compy read the fact (Known); measured-signal = measured
 *  elsewhere (`provenance.ts` labels the chip "Measured elsewhere"; the word here is Measured); expected-impact = Expected. */
export function wordFromProvenance(p: Provenance): ConfidenceWord {
  return PROVENANCE_VALUES.includes(p) ? legacyWord(fromProvenance(p)) : "unknown";
}

/** A bench result's word, through certainty.ts fromBench: a simulator estimate is "Expected"; a real-play
 *  result and a two-session Trial are each ONE before/after comparison, so "Measured once" (never
 *  "Measured", never "Likely"); a low or unknown band is "Unknown". */
export function wordFromBench(kind: BenchKind, band: ConfidenceBand | "high" | "medium" | "low" | null | undefined): ConfidenceWord {
  return shownWord(fromBench(kind, band));
}

/** The Home interview's finding level is already in the vocabulary. */
export function wordFromFinding(level: FindingLevel): ConfidenceWord {
  return legacyWord(fromFindingLevel(level));
}

/** The i18n key of a word (common.confidenceWord.*). */
export const confidenceWordKey = (w: ConfidenceWord): string => `common.confidenceWord.${w}`;

/** The i18n key of a word's one-line hint (common.confidenceHint.*), shown as the chip's title: it
 *  says what the word qualifies — for "Likely", that the reading itself is measured and only its
 *  role (the limiter, the cause) is inferred (review of this slice, SHOULD-FIX). */
export const confidenceHintKey = (w: ConfidenceWord): string => `common.confidenceHint.${w}`;
