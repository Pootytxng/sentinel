// TG-preflight (Trial conditions guard, owner idea 2026-11-12; Constitution §37): before a Trial's
// after-session is played, say plainly what differs between the PC now and what the baseline session
// recorded, with exactly one fix step, and what happens if the user plays anyway (the conclude
// records it as confounded and puts the change back: experiment.rs `with_comparability` /
// `with_power_plan_check`). Blocks nothing. The comparison itself is the backend's
// (`trial_preflight`), over recorded values only.

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** experiment.rs `PreflightDiff`. */
export type PreflightDiff = { key: string; before: string; after: string };

const ITEM_KEY: Record<string, string> = {
  "gpu-driver": "gpuDriver",
  "windows-build": "windowsBuild",
  resolution: "resolution",
  "power-plan": "powerPlan",
};

/** The one fix step: a driver or Windows build that moved can't be set back from here, so the honest
 *  step is a fresh Trial; otherwise the first difference's own fix. */
function stepFor(diffs: readonly PreflightDiff[], t: Translate): string {
  const k = (key: string, o?: Record<string, unknown>) => t(`lab.experimentBench.preflight.step.${key}`, o);
  if (diffs.some((d) => d.key === "gpu-driver" || d.key === "windows-build")) return k("rebaseline");
  const first = diffs[0];
  return first.key === "resolution" ? k("resolution", { before: first.before }) : k("powerPlan");
}

/** The line for a running Trial waiting for its after-session; null when nothing known differs. */
export function preflightLine(diffs: readonly PreflightDiff[] | null | undefined, t: Translate): string | null {
  const known = (diffs ?? []).filter((d) => ITEM_KEY[d.key] != null);
  if (known.length === 0) return null;
  const list = known
    .map((d) => t(`lab.experimentBench.preflight.item.${ITEM_KEY[d.key]}`, { before: d.before, after: d.after }))
    .join(t("lab.experimentBench.preflight.joiner"));
  return [t("lab.experimentBench.preflight.lead", { list }), stepFor(known, t), t("lab.experimentBench.preflight.anyway")].join(" ");
}
