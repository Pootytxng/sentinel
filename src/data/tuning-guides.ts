// THE single source for Compy's hardware-aware tuning guides (spec 2026-06-08). The guide — method,
// typical range, discretion copy, undo, and the vendor-tool walkthrough steps — lives ONCE here and is
// consumed by every surface (Learn entry, Lab Tuning instrument, the Check nudge link target) so they
// CANNOT drift, the same single-source pattern as verdict-glossary.ts → the injected how-we-grade
// entry. All copy is Compy's own voice and the walkthrough is our own schematic (the "all original"
// law); we never apply a voltage or clock — Compy stays read-only/advisory (locked rule #6).
//
// v1 = AMD GPU undervolt ONLY (the hardware-verified path). NVIDIA UV, Intel, Ryzen PBO, and the
// overclock chapter are gated follow-ups, each on its own verified-sensor path.

import raw from "./tuning-guides.json";
import type { GuideEntry } from "./knowledge";
import type { Walkthrough } from "../surfaces/walkthroughs";
import { TOPIC_BY_ID } from "./knowledge-topics";

export type TuningKind = "undervolt" | "overclock";

export type TuningGuide = {
  /** Stable id — the Learn entry id, the walkthrough pairsWith key, AND the Check nudge link target. */
  id: string;
  vendor: string;
  kind: TuningKind;
  name: string;
  aliases: string[];
  goal: string;
  tool: string;
  steps: string[];
  range: string;
  discretion: string;
  undo: string;
  walkthrough: Walkthrough;
};

export const TUNING_GUIDES: TuningGuide[] = raw as TuningGuide[];

export const TUNING_GUIDE_BY_ID: Map<string, TuningGuide> = new Map(
  TUNING_GUIDES.map((g) => [g.id, g]),
);

/** Is this knowledge/rec id one of our tuning guides? Used by Learn's body branch + the Check nudge. */
export function isTuningGuideId(id: string | null | undefined): boolean {
  return !!id && TUNING_GUIDE_BY_ID.has(id);
}

/** The first tuning guide matching a GPU vendor ("amd" today) — what the Check nudge / Lab pick. */
export function tuningGuideForVendor(vendor: string): TuningGuide | null {
  return TUNING_GUIDES.find((g) => g.vendor === vendor) ?? null;
}

// Derived knowledge-index entry: a `guide`-type entry so the tuning guide is searchable + browsable in
// Learn. Its body fields derive from the SAME TuningGuide object → they can't drift from the rendered
// guide. Learn renders the rich body (tool/range/discretion) via a dedicated branch keyed on the id;
// these fields feed search (entryBody folds goal+steps+undo) and the collapsed one-liner (goal).
export function toGuideEntry(g: TuningGuide): GuideEntry {
  return {
    type: "guide",
    id: g.id,
    name: g.name,
    aliases: g.aliases,
    related: [],
    topic: TOPIC_BY_ID[g.id] ?? "general",
    tier: "safe",
    goal: g.goal,
    steps: g.steps,
    undo: g.undo,
  };
}

export const TUNING_GUIDE_ENTRIES: GuideEntry[] = TUNING_GUIDES.map(toGuideEntry);
export const TUNING_WALKTHROUGHS: Walkthrough[] = TUNING_GUIDES.map((g) => g.walkthrough);
