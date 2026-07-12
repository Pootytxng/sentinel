// Pure presentation helpers for the Benchmark tab — labels, verdict tone, delta
// formatting. Kept separate from the component so they're unit-tested without a DOM.
import type { Status } from "../design";
import type { BenchComponent, Verdict, TrialVerdict } from "../types";
import { rigTierLine, type RigTier } from "../data/rig-tier";

const COMPONENT_LABELS: Record<BenchComponent, string> = {
  cpu: "CPU",
  ram: "Memory",
  gpu: "GPU",
  disk: "Disk",
};

export function componentLabel(c: BenchComponent): string {
  return COMPONENT_LABELS[c];
}

const VERDICT_LABELS: Record<Verdict, string> = {
  improved: "Improved",
  "no-measurable-change": "No measurable change",
  regressed: "Regressed",
};

export function verdictLabel(v: Verdict): string {
  return VERDICT_LABELS[v];
}

/** Map an efficacy verdict to a status-pill tone. "No measurable change" is neutral
 * INFO on purpose — it's the honest non-result (a determined finding), never dressed up
 * as a win and never an alarm. */
export function verdictTone(v: Verdict): Status {
  if (v === "improved") return "ready";
  if (v === "regressed") return "danger";
  return "info";
}

/** Signed percent to one decimal (e.g. "+4.2%", "-1.1%", "0%"). */
export function fmtDelta(pct: number): string {
  const r = Math.round(pct * 10) / 10;
  if (r === 0) return "0%";
  return r > 0 ? `+${r}%` : `${r}%`;
}

// ── Live trial (game-frametime) verdict — Keep / Revert / Inconclusive ──
export function trialVerdictLabel(v: TrialVerdict): string {
  if (v.verdict === "keep") return "Helped";
  if (v.verdict === "revert") return "Hurt — reverted";
  return "No measurable change";
}

export function trialVerdictTone(v: TrialVerdict): Status {
  if (v.verdict === "keep") return "ready";
  if (v.verdict === "revert") return "danger";
  return "info"; // "no measurable change" — a determined null, neutral not amber
}

export function trialReasonText(reason: string): string {
  switch (reason) {
    case "within-noise":
      return "the change stayed within your rig's run-to-run noise";
    case "conditions-unstable":
      return "conditions were too noisy to measure reliably — try again";
    case "invalid-trial":
      return "the run was invalid (throttling or background load) and was discarded";
    default:
      return reason;
  }
}

// ── A2 hardware-tier segmentation (LOCAL, no cohort/network) ──
// The measured inputs the rough rig tier reads — a structural subset of HardwareInfo, so this stays
// a pure, DOM-free, easily-tested helper (no coupling to the full App.tsx type).
export type RigSpecs = {
  gpus?: { vram_bytes: number }[];
  cpu_cores_physical: number;
  ram_total_bytes: number;
};

/**
 * Rig-tier segmentation for the Benchmark surface. Reuses the SAME transparent, owner-greenlit
 * bands the hardware grid shows (`src/data/rig-tier.ts`) so the two surfaces can never disagree, and
 * extracts the inputs the one canonical way (max VRAM across adapters · physical cores · total RAM).
 * Returns `null` when nothing is readable — never a fabricated tier from nothing. Purely LOCAL: it
 * classes YOUR rig from YOUR specs; no peer cohort, no network (that's Phase C, gated).
 */
export function benchRigTier(hw: RigSpecs): { tier: RigTier; basis: string } | null {
  return rigTierLine(
    Math.max(0, ...(hw.gpus ?? []).map((g) => g.vram_bytes)),
    hw.cpu_cores_physical,
    hw.ram_total_bytes,
  );
}

// ── A2 LOCAL percentile stub (display-only; no peer cohort) ──
/**
 * Format a verified win's standing among the user's OWN wins as a "top X%" line. The input is
 * `percentile_rank` (0–100) of the win's effect within the cohort of all the user's wins; the
 * "top %" shown is its complement (a higher percentile → a smaller, better top %), matching the
 * backend `percentile_rank` doc framing. Returns `null` when there's no rankable percentile yet
 * (too few wins → backend sends null; or a non-finite value), so the UI shows nothing rather than
 * a meaningless number. Strictly LOCAL — there is no peer/network cohort (that's Phase C, gated).
 */
export function fmtLocalWinTopPct(percentile: number | null | undefined): string | null {
  if (percentile == null || !Number.isFinite(percentile)) return null;
  const top = Math.min(100, Math.max(1, Math.round(100 - percentile)));
  return `Top ${top}% of your verified wins`;
}

/**
 * Expert-view variant (spec 2026-07-11-expert-layer-middle-ground §2): the TRUE percentile, not
 * the rounded "top N%" bucket. Same input contract and null-guards as fmtLocalWinTopPct; no
 * clamping — the raw number IS the point. Display-only over the already-computed value.
 */
export function fmtLocalWinPercentile(percentile: number | null | undefined): string | null {
  if (percentile == null || !Number.isFinite(percentile)) return null;
  return `Percentile ${percentile.toFixed(1)} of your verified wins (top ${(100 - percentile).toFixed(1)}%)`;
}
