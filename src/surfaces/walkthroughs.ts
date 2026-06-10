import raw from "../data/walkthroughs.json";
import { TUNING_WALKTHROUGHS } from "../data/tuning-guides";

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
