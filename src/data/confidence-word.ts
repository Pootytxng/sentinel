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

export type ConfidenceWord = "known" | "measured" | "likely" | "expected" | "unknown";

/** An inference band (limiter rows, hardware evidence, What-changed hypotheses, patterns):
 *  high and medium are supported inferences; low and unknown are not enough evidence to lean on. */
export function wordFromBand(band: ConfidenceBand | "high" | "medium" | "low" | null | undefined): ConfidenceWord {
  return band === "high" || band === "medium" ? "likely" : "unknown";
}

/** A priority row only says it was measured when its basis says so. Older data with no basis reads as
 *  a fact: never claim a measurement the row doesn't carry. */
export const isMeasuredRow = (basis: "fact" | "measured" | undefined): boolean => basis === "measured";

/** A priority row's word: a fact Compy read is "Known" (its effect on FPS is not measured, so never
 *  "Likely"); a measured row keeps the band's word. */
export function wordFromRow(basis: "fact" | "measured" | undefined, band: ConfidenceBand | "high" | "medium" | "low" | null | undefined): ConfidenceWord {
  return isMeasuredRow(basis) ? wordFromBand(band) : "known";
}

/** A recommendation's provenance: Verified = Compy read the fact (Known); measured-signal = measured
 *  elsewhere (`provenance.ts` labels the chip "Measured elsewhere"; the word here is Measured); expected-impact = Expected. */
export function wordFromProvenance(p: Provenance): ConfidenceWord {
  return p === "verified" ? "known" : p === "measured-signal" ? "measured" : p === "expected-impact" ? "expected" : "unknown";
}

/** The Home interview's finding level is already in the vocabulary. */
export function wordFromFinding(level: FindingLevel): ConfidenceWord {
  return level;
}

/** The i18n key of a word (common.confidenceWord.*). */
export const confidenceWordKey = (w: ConfidenceWord): string => `common.confidenceWord.${w}`;

/** The i18n key of a word's one-line hint (common.confidenceHint.*), shown as the chip's title: it
 *  says what the word qualifies — for "Likely", that the reading itself is measured and only its
 *  role (the limiter, the cause) is inferred (review of this slice, SHOULD-FIX). */
export const confidenceHintKey = (w: ConfidenceWord): string => `common.confidenceHint.${w}`;
