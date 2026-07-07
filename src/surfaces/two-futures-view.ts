// Pure logic for the Two Futures measured split (spec 2026-07-07-two-futures-measured-split).
// Kept DOM-free so the anti-fabrication law is unit-tested hard, the benchmark-view.ts way.
import type { BenchComponent, BenchmarkState, Efficacy } from "../types";

/** A BenchmarkState that carries a real measured pair — both sides ran, on different runs,
    with the backend's efficacy computed. Narrowed so the render path can't half-read it. */
export type MeasuredPair = BenchmarkState & {
  baseline: NonNullable<BenchmarkState["baseline"]>;
  latest: NonNullable<BenchmarkState["latest"]>;
  baseline_at: string;
  latest_at: string;
  efficacy: Efficacy;
};

/**
 * THE ONE LAW of this feature: no measured pair → no split view. Ever.
 * True only when baseline AND latest both exist, are distinct runs (a baseline re-shown as
 * "latest" is not a pair), and the backend computed efficacy from them. Everything the split
 * renders — both rigs' emphasis and every number on the rail — hangs off this gate; when it's
 * false the surface shows the honest empty state and mounts no 3D.
 */
export function hasMeasuredPair(s: BenchmarkState | null | undefined): s is MeasuredPair {
  return !!(
    s &&
    s.baseline &&
    s.latest &&
    s.baseline_at &&
    s.latest_at &&
    s.latest_at !== s.baseline_at &&
    s.efficacy
  );
}

// Rig part id → benchmark component. Structural parts (board/cooler/psu) have no measured
// component, so they can never carry emphasis.
const PART_COMPONENT: Record<string, BenchComponent> = {
  cpu: "cpu",
  gpu: "gpu",
  ram: "ram",
  storage: "disk",
};

/**
 * Measured-emphasis glow for one rig part on the "Now" side: scaled by the per-component
 * efficacy delta WHERE PRESENT, neutral (1) everywhere else. Within-noise verdicts stay
 * neutral too — the floor says the delta isn't distinguishable from noise, so the glow may
 * not imply it. Clamped so an outlier delta can't blow the material out.
 */
export function partGlow(efficacy: Efficacy | null | undefined, partId: string): number {
  const component = PART_COMPONENT[partId];
  if (!efficacy || !component) return 1;
  const row = efficacy.per_component.find((c) => c.component === component);
  if (!row || row.verdict === "no-measurable-change") return 1;
  return Math.min(2.2, Math.max(0.6, 1 + row.delta_pct * 0.08));
}
