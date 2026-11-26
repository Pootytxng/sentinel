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
// What stays the card's own word, on purpose:
//   - "Not recorded" (EvidenceKind `unknown`). The engine uses that kind both for "Compy kept no
//     record" and for "the record could not be read"; the shared tag "Couldn't read" would be untrue
//     for the first, so the card keeps the word it had until the engine tells the two apart.
//   - "Not read" (the hardware log Compy did not read back far enough, F7).
//   - "Supports this" / "Weakens this": relations, already plain.
import type { TFunction } from "i18next";
import { fromCertainty, fromEvidenceKind, strengthWire, type Mapped } from "../../data/certainty";
import { sourceWord, strengthWord } from "../../data/certainty-words";
import type { ParamedicCertainty, ParamedicEvidence } from "../../types";

export type ParamedicTagAxis = "source" | "strength" | "relation";
export type ParamedicTag = { axis: ParamedicTagAxis; text: string; tone?: "accent" | "warn" };

/** The tag in front of one evidence line. Returns a source or a relation, never a strength. */
export function evidenceTag(e: Pick<ParamedicEvidence, "kind" | "code" | "against">, t: TFunction): ParamedicTag {
  if (e.against) return { axis: "relation", text: t("paramedic.badge.against"), tone: "warn" };
  // F7: a log Compy did not read back far enough is "Not read"; "Not recorded" beside it would read as "no errors recorded".
  if (e.code === "whea-normal-unread") return { axis: "source", text: t("paramedic.badge.notRead") };
  // The cast: a kind this build does not know (a newer engine) maps to nothing at runtime.
  const m = fromEvidenceKind(e.kind) as Mapped | undefined;
  if (m?.axis === "source") {
    if (m.relation === "supports") return { axis: "relation", text: t("paramedic.badge.supports") };
    if (m.source === "unread") return { axis: "source", text: t("paramedic.badge.unknown") };
    return { axis: "source", text: sourceWord(m.source, t) };
  }
  // Unchanged from before this slice: a kind the card does not know falls through to "Measured".
  return { axis: "source", text: sourceWord("measured", t) };
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
  if (m?.axis === "source") return { axis: "source", text: sourceWord(m.source, t), tone: m.source === "measured" ? "accent" : undefined };
  // Unchanged from before this slice: `cant-tell` (never sent on a row today) and a value the card
  // does not know read "Possible", the lowest strength.
  return { axis: "strength", text: strengthWord("possible", t) };
}
