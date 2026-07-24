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
// i18n (2026-07-23): the zh-CN sibling carries translated text fields only (no `walkthrough` — its
// steps' Chinese captions are hand-authored below, same reasoning as knowledge.ts's injected entries).
import rawZhCN from "./tuning-guides.zh-CN.json";
import type { GuideEntry } from "./knowledge";
import { deepMergeLocale } from "./locale-merge";
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

// ---------------------------------------------------------------------------------------------
// Simplified Chinese overlay (i18n, 2026-07-23) — same additive pattern as knowledge.ts: the exports
// above stay frozen/English (tuning-guides.test.ts pins them), and language-aware reads go through
// the functions below instead. tuning-guides.zh-CN.json has no `walkthrough` field of its own (the
// schematic's hotspot coordinates/labels are vendor-tool chrome, not sentence prose), so the one
// walkthrough's title + step captions are hand-translated here, matching the pattern already used by
// the standalone data/walkthroughs.zh-CN.json siblings (translate title/caption, keep everything else
// — group, pairsWith, x/y, hotspot label — as the English schematic defines it).
const TUNING_WALKTHROUGH_ZH_CN: Record<string, Partial<Walkthrough>> = {
  "amd-gpu-undervolt": {
    title: "给你的 Radeon 显卡降压(Adrenalin)",
    variants: [
      {
        vendor: "amd",
        label: "AMD Adrenalin",
        steps: [
          { caption: "Adrenalin → Performance(性能)", x: 14, y: 20, label: "Performance" },
          { caption: "Tuning(调校)→ Custom(自定义)", x: 42, y: 22, label: "Tuning · Custom" },
          { caption: "打开 GPU Tuning,电压切换到 Manual(手动)", x: 40, y: 54, label: "Manual mV" },
          { caption: "把最大电压调低 25–50 mV,点击 Apply(应用)", x: 70, y: 54, label: "Lower mV" },
          { caption: "压力测试 20–30 分钟,留意是否重置", x: 70, y: 82, label: "Stress test" },
        ],
      },
    ],
  },
};

const TUNING_GUIDES_ZH_CN: TuningGuide[] = TUNING_GUIDES.map((g) => {
  const zhText = (rawZhCN as Record<string, unknown>[]).find((z) => String(z.id) === g.id);
  const merged = zhText ? deepMergeLocale(g, zhText) : g;
  const zhWalkthrough = TUNING_WALKTHROUGH_ZH_CN[g.id];
  return zhWalkthrough ? deepMergeLocale(merged, { walkthrough: zhWalkthrough }) : merged;
});

const TUNING_GUIDE_ENTRIES_ZH_CN: GuideEntry[] = TUNING_GUIDES_ZH_CN.map(toGuideEntry);
const TUNING_WALKTHROUGHS_ZH_CN: Walkthrough[] = TUNING_GUIDES_ZH_CN.map((g) => g.walkthrough);

/** TUNING_GUIDES in the given app language — see knowledge.ts's knowledgeForLanguage() for the same
 * pattern applied to the main corpus. "en" returns the frozen English array unchanged. */
export function tuningGuidesForLanguage(lang: string): TuningGuide[] {
  return lang === "zh-CN" ? TUNING_GUIDES_ZH_CN : TUNING_GUIDES;
}

/** TUNING_GUIDE_ENTRIES in the given app language. */
export function tuningGuideEntriesForLanguage(lang: string): GuideEntry[] {
  return lang === "zh-CN" ? TUNING_GUIDE_ENTRIES_ZH_CN : TUNING_GUIDE_ENTRIES;
}

/** TUNING_WALKTHROUGHS in the given app language. */
export function tuningWalkthroughsForLanguage(lang: string): Walkthrough[] {
  return lang === "zh-CN" ? TUNING_WALKTHROUGHS_ZH_CN : TUNING_WALKTHROUGHS;
}

const TUNING_GUIDE_BY_ID_ZH_CN: Map<string, TuningGuide> = new Map(
  TUNING_GUIDES_ZH_CN.map((g) => [g.id, g]),
);

/** TUNING_GUIDE_BY_ID in the given app language. */
export function tuningGuideByIdForLanguage(lang: string): Map<string, TuningGuide> {
  return lang === "zh-CN" ? TUNING_GUIDE_BY_ID_ZH_CN : TUNING_GUIDE_BY_ID;
}

/** tuningGuideForVendor, resolved in the given app language. */
export function tuningGuideForVendorForLanguage(vendor: string, lang: string): TuningGuide | null {
  return tuningGuidesForLanguage(lang).find((g) => g.vendor === vendor) ?? null;
}
