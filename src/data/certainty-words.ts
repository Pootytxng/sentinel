// D3 vocabulary, slice 2: the WORDS for the two axes in certainty.ts, one key per word.
//
//   common.source.*    how Compy knows a fact  (certainty.ts `Source`)
//   common.strength.*  how strongly the evidence points at a reason  (certainty.ts `Strength`)
//
// A screen that shows a tag gets its text from here, so the same tag reads the same on every screen.
// The Something's-wrong card is the first screen on these words (surfaces/glass/paramedic-tags.ts);
// the Problems room and Home follow in slice 3.
//
// Only a word some screen shows today has a key (review r1, F3): the source `user` ("You told Compy")
// gets its word in the slice that first shows it. ShownSource is the type that keeps a caller from
// asking for a word that does not exist.
//
// Every key is written out as a literal inside t(), so the orphan-key guard and the affordance census
// see it. No function here decides WHEN a word is earned: that is certainty.ts (and the Rust rules
// behind it). These only spell the answer.
import type { TFunction } from "i18next";
import { strengthWire, type Source, type Strength } from "./certainty";

/** Sources that have a word on a screen today. The others get theirs in the slice that first shows them. */
export type ShownSource = Exclude<Source, "user">;
export const isShownSource = (s: Source): s is ShownSource => s !== "user";

/** The tag for a source. */
export function sourceWord(source: ShownSource, t: TFunction): string {
  switch (source) {
    case "read":
      return t("common.source.read");
    case "measured":
      return t("common.source.measured");
    case "measured-once":
      return t("common.source.measuredOnce");
    case "general":
      return t("common.source.general");
    case "unread":
      return t("common.source.unread");
  }
}

/** The tag for a strength. There are two and only two: no strength is a sentence, never a tag. */
export function strengthWord(strength: Strength, t: TFunction): string {
  return strengthWire(strength) === "most-likely" ? t("common.strength.mostLikely") : t("common.strength.possible");
}
