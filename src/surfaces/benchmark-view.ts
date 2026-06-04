// Pure presentation helpers for the Benchmark tab — labels, verdict tone, delta
// formatting. Kept separate from the component so they're unit-tested without a DOM.
import type { Status } from "../design";
import type { BenchComponent, Verdict, TrialVerdict } from "../types";

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
 * (unknown) on purpose — it's the honest non-result, never dressed up as a win. */
export function verdictTone(v: Verdict): Status {
  if (v === "improved") return "ready";
  if (v === "regressed") return "danger";
  return "unknown";
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
  return "unknown";
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
