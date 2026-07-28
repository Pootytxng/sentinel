// THE single source of truth for what Compy's three verdicts MEAN. Fed to all three surfaces that
// explain them — the visible "How we grade" key (Learn browse + Autopsy), the hover tooltip on every
// verdict chip, and the searchable "How Compy grades things" Learn entry — so the definition can
// never drift between them. Compy invented this vocabulary; defining our own terms transparently IS
// the anti-snake-oil ethos turned inward. Owner-voice, plain + honest (THE VOICE). Read-only copy.

import type { TweakVerdict } from "./knowledge";
import type { TFunction } from "i18next";

export type VerdictGlossaryRow = {
  verdict: TweakVerdict;
  /** The chip label shown on cards / the key (the verdict chips' display text). */
  chip: string;
  /** The plain-English meaning — shown in the key, on hover, and in the Learn entry. */
  definition: string;
};

// Order = how the key lists them: worth-doing → skip → refused.
export const VERDICT_GLOSSARY: readonly VerdictGlossaryRow[] = [
  {
    verdict: "real",
    chip: "Real",
    definition:
      "It actually does something. A measurable or well-proven effect on your games — worth doing.",
  },
  {
    verdict: "placebo",
    chip: "Placebo",
    definition:
      "All hype, no effect. Popular online, but it changes nothing you can measure. We skip these so you don't waste time chasing them.",
  },
  {
    verdict: "risky",
    chip: "Risky — refused",
    definition:
      "Not worth the downside. It might do something, but it brings real tradeoffs — instability, a security hole, or things breaking — so Compy refuses it, or lets you decide with eyes open.",
  },
];

// The Learn glossary entry's id — shared so knowledge.ts (which injects the entry) and Learn.tsx
// (which renders the key as that entry's body) agree on one literal.
export const VERDICT_GLOSSARY_ENTRY_ID = "how-we-grade";

const BY_VERDICT = VERDICT_GLOSSARY.reduce(
  (acc, row) => {
    acc[row.verdict] = row;
    return acc;
  },
  {} as Record<TweakVerdict, VerdictGlossaryRow>,
);

// i18n (2026-07-23): `t` is OPTIONAL and trailing so every existing call site (and the pinned
// verdict-glossary.test.ts, which calls these with one arg) keeps working unchanged — omitting it
// returns the English chip/definition below, same as before. Pass `t` (from useTranslation(), or
// threaded through like Learn.tsx's hitPill(h, t) for module-scope helpers) to get the localized
// string, keyed off this same English text as the defaultValue so a missing translation degrades to
// English rather than a raw key. The "Real"/"Placebo"/"Risky — refused" chips ARE localized in zh-CN as
// of 2026-07-24 (owner decision) — zh vocab lives in blackbook.json: verdictGlossary.{v}.chip (full
// badge) + learn.verdictFilters.{v} (short filter form). English stays the defaultValue fallback.
/** Chip label for a verdict — the single source that replaces Learn's old local VERDICT_LABEL. */
export const verdictChip = (v: TweakVerdict, t?: TFunction): string =>
  t ? t(`blackbook.verdictGlossary.${v}.chip`, BY_VERDICT[v].chip) : BY_VERDICT[v].chip;
/** Plain-English definition for a verdict — used by the visible key and the hover tooltips. */
export const verdictDefinition = (v: TweakVerdict, t?: TFunction): string =>
  t ? t(`blackbook.verdictGlossary.${v}.definition`, BY_VERDICT[v].definition) : BY_VERDICT[v].definition;
