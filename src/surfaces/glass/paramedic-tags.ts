// D3 vocabulary, slice 2: the tags on the Something's-wrong card, through the shared vocabulary.
//
// Two kinds of tag sit on the card, and they answer different questions (data/certainty.ts):
//   - a tag on an EVIDENCE line says how Compy knows that line (a source), or how the line bears on
//     the row it sits under (a relation: "Supports this" / "Weakens this");
//   - a tag on a CANDIDATE row says how strongly the evidence points at it (a strength).
// An evidence line never gets a strength: evidenceTag() has no code path that returns one.
//
// This file only spells what the engine sent. It decides no level: "Most likely" is shown for the
// wire value `likely` and for nothing else, exactly as before (paramedic.rs emits it only behind its
// own two-independent-supports check).
//
// A line gets NO tag when no word would be true of it (review r1): a note that is not a fact Compy
// read (F1), a kind this build does not know (F2), and an `unknown` line that is neither "no record
// kept" nor "the read did not reach" (F4).
//
// What stays the card's own word, on purpose:
//   - "Not recorded" and "Not read": the card's words for the two exact cases below.
//   - "Supports this" / "Weakens this": relations, already plain.
import type { TFunction } from "i18next";
import { fromCertainty, fromEvidenceKind, strengthWire, type Mapped } from "../../data/certainty";
import { isShownSource, sourceWord, strengthWord } from "../../data/certainty-words";
import type { ParamedicCertainty, ParamedicEvidence } from "../../types";

export type ParamedicTagAxis = "source" | "strength" | "relation";
export type ParamedicTag = { axis: ParamedicTagAxis; text: string; tone?: "accent" | "warn" };

// EvidenceKind `unknown` covers three things the engine does not tell apart; the card does, by code (review r1, F4).
/** Compy kept no record: "Not recorded". */
const NO_RECORD = new Set([
  "load-not-recorded",
  "rough-load-not-recorded",
  "recovery-load-not-recorded",
  "ram-unrecorded",
  "ram-since-unread",
  "recovery-ram-not-read",
  "recovery-ram-rough-unread",
  "program-start-unread",
  "install-not-recorded",
  "recovery-compy-unread",
  "recovery-build-unread",
  "recovery-driver-unread",
  "driver-back-none",
  "drift-restored-none",
  "recovered-steam-latest-only",
]);
/** Compy tried and the read did not come back: the shared "Couldn't read". */
const READ_FAILED = new Set(["gap-unread", "recovery-records-unread", "cross-game-mod-unchecked"]);
/** The read worked but did not reach that far: "Not read" (F7's hardware log, and an install time Compy did not read). */
const NOT_READ = new Set(["whea-normal-unread", "install-time-not-read"]);

/** The tag in front of one evidence line, or null when no word would be true of it. A source or a
 *  relation, never a strength. */
export function evidenceTag(e: Pick<ParamedicEvidence, "kind" | "code" | "against">, t: TFunction): ParamedicTag | null {
  if (e.against) return { axis: "relation", text: t("paramedic.badge.against"), tone: "warn" };
  // A note on how a figure is built: not a fact Compy read, so it carries no source tag.
  if (e.code === "figure-scope") return null;
  // "Not recorded" beside these would read as "nothing was recorded there".
  if (NOT_READ.has(e.code)) return { axis: "source", text: t("paramedic.badge.notRead") };
  // The cast: a kind this build does not know (a newer engine) maps to nothing at runtime.
  const m = fromEvidenceKind(e.kind) as Mapped | undefined;
  // A kind this build does not know: no tag. Any source word here would be a guess.
  if (m?.axis !== "source") return null;
  if (m.relation === "supports") return { axis: "relation", text: t("paramedic.badge.supports") };
  if (m.source === "unread") {
    if (NO_RECORD.has(e.code)) return { axis: "source", text: t("paramedic.badge.unknown") };
    if (READ_FAILED.has(e.code)) return { axis: "source", text: sourceWord("unread", t) };
    // Recorded but not judged yet, or a code this build does not know: the sentence itself says what Compy can't tell.
    return null;
  }
  if (isShownSource(m.source)) return { axis: "source", text: sourceWord(m.source, t) };
  return null;
}

/** The tag on one candidate row. `likely` is the only value that reads "Most likely". A value that is
 *  a source on the wire (`measured`: the frame-cap reading; `known` and `mechanism`: never sent today)
 *  is shown as that source, not as a strength. */
export function candidateTag(confidence: ParamedicCertainty, t: TFunction): ParamedicTag {
  const m = fromCertainty(confidence) as Mapped | undefined;
  if (m?.axis === "strength") {
    const top = strengthWire(m.strength) === "most-likely";
    return { axis: "strength", text: strengthWord(m.strength, t), tone: top ? "accent" : undefined };
  }
  // The accent on "Measured" is the tone this chip had before this slice.
  if (m?.axis === "source" && isShownSource(m.source)) return { axis: "source", text: sourceWord(m.source, t), tone: m.source === "measured" ? "accent" : undefined };
  // Unchanged from before this slice: `cant-tell` (never sent on a row today) and a value the card
  // does not know read "Possible", the lowest strength.
  return { axis: "strength", text: strengthWord("possible", t) };
}
