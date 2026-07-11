import { spikeIndices } from "../../design/console/Oscilloscope";

// FrametimeRibbon's pure geometry profile (plan 2026-07-10-monitor-v3-ribbon, Task 3). The ribbon
// is DATA, not decoration: one top-edge vertex per REAL frame sample, y proportional to the true
// frametime magnitude from a ZERO baseline (a 41 ms spike towers over 7 ms frames — honest
// proportions, unlike the 2D strip's band-normalization), spikes at their exact sample x (the
// SAME detector the strip markers use — one source). < 2 samples ⇒ null: the caller renders
// nothing (never a ghost/synthetic ribbon).

export const RIBBON_SPAN_X = 8; // world units, centered: x ∈ [-4, 4]
export const RIBBON_MAX_Y = 2.5;

export type RibbonSpike = { i: number; x: number; y: number; ms: number; worst: boolean };
export type RibbonProfile = {
  /** Top edge, one vertex per real sample, oldest → newest across the full span. */
  top: { x: number; y: number }[];
  /** The frame-budget plane's height (same scale), null when no budget given. */
  budgetY: number | null;
  spikes: RibbonSpike[];
};

export function ribbonProfile(win: number[], budget?: number): RibbonProfile | null {
  if (win.length < 2) return null;
  const max = Math.max(...win, budget ?? -Infinity);
  if (!(max > 0)) return null;
  const scaleY = RIBBON_MAX_Y / max;
  const denom = win.length - 1;
  const toX = (i: number) => (i / denom) * RIBBON_SPAN_X - RIBBON_SPAN_X / 2;
  const idx = spikeIndices(win, budget);
  let worst = -1;
  for (const i of idx) if (worst < 0 || win[i] > win[worst]) worst = i;
  return {
    top: win.map((v, i) => ({ x: toX(i), y: Math.max(v, 0) * scaleY })),
    budgetY: budget != null ? budget * scaleY : null,
    spikes: idx.map((i) => ({
      i,
      x: toX(i),
      y: win[i] * scaleY,
      ms: win[i],
      worst: i === worst,
    })),
  };
}
