import { type Walkthrough, walkthroughForKey } from "./walkthroughs";

// 3-mode preset GUIDED checklists for the Monitor surface (Max Quality / More FPS / Lower Latency —
// consumer-market terms per the owner's 2026-07-10 direction; ids kept stable). Goal-register
// comparatives, not the stat readouts' exact terms: the v3 console face shows measured "MAX FPS" /
// "LOWEST LATENCY" stats on the SAME screen, and a chip must never read as one of those values.
// Each preset is a curated, plain-English bundle of EXISTING guided walkthroughs — the same animated
// schematics shown elsewhere for advisory recs. This is purely advisory/read-only knowledge layer:
// it maps a goal the user has ("I want it to look best" / "I want steadier frames" / "I want a clean
// responsive picture") to the hand-followed, out-of-Compy steps that get there. Nothing here mutates
// Windows, opens a URI, or touches IPC — the keys resolve to walkthroughs the user steps through by
// hand. Adding/curating a preset = editing this list (the knowledge-layer pattern).
//
// Only keys that resolve to a real walkthrough (see src/surfaces/walkthroughs.ts: vrr · xmp-expo ·
// game-mode · storage-sense · hdr · amd-gpu-undervolt) are used; resolvePresetItems drops any key
// that no longer resolves so the UI never shows an empty/fabricated row.

export type TuningPreset = {
  /** Stable id (also the localStorage-free render key). */
  id: string;
  /** Short card label. */
  label: string;
  /** One plain-English line: what this preset is FOR. */
  goal: string;
  /** Ordered walkthrough pairsWith keys this preset bundles. */
  keys: readonly string[];
};

export type PresetItem = { key: string; walkthrough: Walkthrough };

export const TUNING_PRESETS: readonly TuningPreset[] = [
  {
    id: "visual-fidelity",
    label: "Max Quality",
    goal: "Make games look their best — richer color and a tear-free picture.",
    keys: ["hdr", "vrr"],
  },
  {
    id: "smooth",
    label: "More FPS",
    goal: "Chase higher, steadier frames — full RAM speed, Game Mode, a tear-free sync.",
    keys: ["game-mode", "xmp-expo", "vrr", "amd-gpu-undervolt"],
  },
  {
    id: "clarity",
    label: "Lower Latency",
    goal: "A more responsive PC — free up drive headroom, prioritize the game, and cut background drag.",
    keys: ["storage-sense", "game-mode"],
  },
];

// Resolve a preset's keys to their walkthroughs, in declared order, dropping any that no longer
// resolve (honest: we never render a checklist row we can't actually show steps for).
export function resolvePresetItems(preset: { keys: readonly string[] }): PresetItem[] {
  const items: PresetItem[] = [];
  for (const key of preset.keys) {
    const walkthrough = walkthroughForKey(key);
    if (walkthrough) items.push({ key, walkthrough });
  }
  return items;
}
