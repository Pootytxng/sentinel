// THE single source of truth for what Compy's three verdicts MEAN. Fed to all three surfaces that
// explain them — the visible "How we grade" key (Learn browse + Autopsy), the hover tooltip on every
// verdict chip, and the searchable "How Compy grades things" Learn entry — so the definition can
// never drift between them. Compy invented this vocabulary; defining our own terms transparently IS
// the anti-snake-oil ethos turned inward. Owner-voice, plain + honest (THE VOICE). Read-only copy.

import type { TweakVerdict } from "./knowledge";

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

/** Chip label for a verdict — the single source that replaces Learn's old local VERDICT_LABEL. */
export const verdictChip = (v: TweakVerdict): string => BY_VERDICT[v].chip;
/** Plain-English definition for a verdict — used by the visible key and the hover tooltips. */
export const verdictDefinition = (v: TweakVerdict): string => BY_VERDICT[v].definition;
