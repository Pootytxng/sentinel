import raw from "../data/walkthroughs.json";
// i18n (2026-07-23): translated title + step captions only — see knowledge.ts's overlay comment for
// why the merge (deepMergeLocale) always keeps structural/logic fields (pairsWith, x/y, vendor,
// hotspot label) from the English schematic no matter what the zh-CN sibling omits.
import rawZhCN from "../data/walkthroughs.zh-CN.json";
import { TUNING_WALKTHROUGHS, tuningWalkthroughsForLanguage } from "../data/tuning-guides";
import { deepMergeLocale } from "../data/locale-merge";

// Show-me walkthroughs (spec 2026-06-06) — data-driven animated SCHEMATICS (never screenshots) of the
// out-of-Compy path for advisory recs. Adding one = adding JSON (the knowledge-layer pattern). The
// component renders these; nothing here touches the system. Deep links are opened only via the existing
// allowlisted openGuidedUri (no new allowlist entries this pass).

export type WalkthroughStep = { caption: string; x: number; y: number; label: string };
export type WalkthroughVariant = { vendor: string; label: string; steps: WalkthroughStep[] };
export type Walkthrough = {
  group: string;
  title: string;
  pairsWith: string[];
  deepLink?: string;
  deepLinkLabel?: string;
  biosGeneric?: boolean;
  variants: WalkthroughVariant[];
};

// The tuning-guide walkthroughs (their own schematics, no vendor screenshots) carry in the SAME single
// source as the guide copy (tuning-guides.ts) and register here so walkthroughForKey resolves them.
export const WALKTHROUGHS: Walkthrough[] = [...(raw as Walkthrough[]), ...TUNING_WALKTHROUGHS];
export const KNOWN_VENDORS = ["amd", "nvidia", "intel", "any"] as const;
export type GpuVendor = (typeof KNOWN_VENDORS)[number];

// Map every pairsWith key → its walkthrough, so a rec/readiness/knowledge id resolves one by id.
const BY_KEY = new Map<string, Walkthrough>();
for (const w of WALKTHROUGHS) {
  for (const k of w.pairsWith) BY_KEY.set(k.toLowerCase(), w);
}

export function walkthroughForKey(key: string | null | undefined): Walkthrough | null {
  if (!key) return null;
  return BY_KEY.get(key.toLowerCase()) ?? null;
}

// Detect the vendor from a GPU name so the right panel variant shows for the user's rig.
export function gpuVendor(name: string | null | undefined): GpuVendor {
  const n = (name ?? "").toLowerCase();
  if (n.includes("nvidia") || n.includes("geforce") || n.includes("rtx") || n.includes("gtx")) return "nvidia";
  if (n.includes("amd") || n.includes("radeon")) return "amd";
  if (n.includes("intel") || n.includes("arc")) return "intel";
  return "any";
}

export function resolveVariant(w: Walkthrough, vendor: GpuVendor): WalkthroughVariant {
  return (
    w.variants.find((v) => v.vendor === vendor) ??
    w.variants.find((v) => v.vendor === "any") ??
    w.variants[0]
  );
}

// ---------------------------------------------------------------------------------------------
// Simplified Chinese overlay (i18n, 2026-07-23) — WALKTHROUGHS/walkthroughForKey above stay frozen/
// English (walkthroughs.test.ts pins them); language-aware reads go through the functions below,
// same additive pattern as knowledge.ts's knowledgeForLanguage(). Matched by `group` (a walkthrough's
// stable key, same role `id` plays in the knowledge JSON).
const WALKTHROUGHS_ZH_CN: Walkthrough[] = [
  ...(raw as Walkthrough[]).map((w) => {
    const zh = (rawZhCN as Record<string, unknown>[]).find((z) => z.group === w.group);
    return zh ? deepMergeLocale(w, zh) : w;
  }),
  ...tuningWalkthroughsForLanguage("zh-CN"),
];

const BY_KEY_ZH_CN = new Map<string, Walkthrough>();
for (const w of WALKTHROUGHS_ZH_CN) {
  for (const k of w.pairsWith) BY_KEY_ZH_CN.set(k.toLowerCase(), w);
}

/** WALKTHROUGHS in the given app language. */
export function walkthroughsForLanguage(lang: string): Walkthrough[] {
  return lang === "zh-CN" ? WALKTHROUGHS_ZH_CN : WALKTHROUGHS;
}

/** walkthroughForKey, resolved in the given app language. */
export function walkthroughForKeyForLanguage(key: string | null | undefined, lang: string): Walkthrough | null {
  if (!key) return null;
  if (lang !== "zh-CN") return walkthroughForKey(key);
  return BY_KEY_ZH_CN.get(key.toLowerCase()) ?? null;
}
