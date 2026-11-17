// TG-drift-words (Trial conditions guard, owner idea 2026-11-12; Constitution §37): when a Trial was
// too noisy to judge, say in plain words what differed between its two sessions, using only what
// Compy RECORDED for each session, and give exactly one next step. Nothing is inferred: a field either
// session didn't record is never compared. When nothing recorded differs, name exactly what was
// compared and claim no cause. Words only: no verdict changes, no bar moves.
import type { SessionSummary } from "../types";

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** One recorded difference, most actionable first (the first one's fix is the one next step). */
export type DriftItem =
  | { key: "cap"; before: string; after: string }
  | { key: "power-plan" }
  | { key: "power-plan-changed"; which: "baseline" | "after" | "both" }
  | { key: "driver"; before: string; after: string }
  | { key: "windows-build"; before: string; after: string }
  | { key: "gaming-mode"; before: boolean; after: boolean }
  | { key: "resolution"; before: string; after: string }
  | { key: "background"; which: "baseline" | "after"; mins: number }
  | { key: "length"; beforeMins: number; afterMins: number };

/** A session spent this long behind another window before Compy names it (P4-comparable left those
 *  seconds out of every number; a short alt-tab is not a difference worth a step). */
export const DRIFT_BACKGROUND_MIN_SECS = 60;
/** One session at least this many times as long as the other is named as a length difference. */
export const DRIFT_LENGTH_RATIO = 2;

const text = (v: string | null | undefined): string | null => (v != null && v.trim() !== "" ? v.trim() : null);

function capWords(s: SessionSummary): string | null {
  const c = s.frame_cap;
  if (c == null || c.state === "unknown") return null;
  if (c.state === "uncapped") return "off";
  return c.at_fps != null ? `on@${Math.round(c.at_fps)}` : "on";
}

/** Opus r1 MUST-FIX: the backend's own cap rule (noise_floor.rs `cap_pair`): two caps within 3% of
 *  each other are the same cap; a cap whose rate wasn't read is not a recorded difference from another. */
export const DRIFT_SAME_CAP_FRAC = 0.03;
function capsDiffer(b: string, a: string): boolean {
  if ((b === "off") !== (a === "off")) return true;
  if (b === "off" || !b.startsWith("on@") || !a.startsWith("on@")) return false;
  const [x, y] = [Number(b.slice(3)), Number(a.slice(3))];
  return Math.abs(x - y) > Math.min(x, y) * DRIFT_SAME_CAP_FRAC;
}

function resolution(s: SessionSummary): string | null {
  const w = s.game_state?.resolution_width;
  const h = s.game_state?.resolution_height;
  return w != null && h != null && w > 0 && h > 0 ? `${w}×${h}` : null;
}

const driverOf = (s: SessionSummary) => text(s.game_state?.gpu_driver) ?? text(s.hw_fingerprint?.gpu_driver);
const gamingMode = (s: SessionSummary): boolean | null => s.gaming_mode_active ?? s.game_state?.gaming_mode_active ?? null;

/** The context fields BOTH sessions recorded, by copy key (session length aside, which every session
 *  has). Sonnet r1: none = nothing was compared, so "nothing differed" would be a claim from no data.
 *  Opus r2: the "nothing differed" line names exactly these, never more. */
export function comparedFields(baseline: SessionSummary, after: SessionSummary): string[] {
  const both = <T>(f: (s: SessionSummary) => T | null | undefined) => f(baseline) != null && f(after) != null;
  const fields: [string, boolean][] = [
    ["cap", both(capWords)],
    ["powerPlan", both((s) => text(s.game_state?.power_plan_guid)) || both((s) => s.game_state?.power_plan_changed)],
    ["driver", both(driverOf)],
    ["windowsBuild", both((s) => text(s.game_state?.windows_build))],
    ["gamingMode", both(gamingMode)],
    ["resolution", both(resolution)],
    ["background", both((s) => s.background_secs_excluded)],
  ];
  return fields.filter(([, on]) => on).map(([k]) => k);
}

/** What differed between the two sessions, from recorded context only, most actionable first. */
export function sessionDrift(baseline: SessionSummary, after: SessionSummary): DriftItem[] {
  const out: DriftItem[] = [];
  const [capB, capA] = [capWords(baseline), capWords(after)];
  if (capB != null && capA != null && capsDiffer(capB, capA)) out.push({ key: "cap", before: capB, after: capA });
  const [planB, planA] = [text(baseline.game_state?.power_plan_guid), text(after.game_state?.power_plan_guid)];
  if (planB != null && planA != null && planB.toLowerCase() !== planA.toLowerCase()) out.push({ key: "power-plan" });
  const [chB, chA] = [baseline.game_state?.power_plan_changed === true, after.game_state?.power_plan_changed === true];
  if (chB || chA) out.push({ key: "power-plan-changed", which: chB && chA ? "both" : chB ? "baseline" : "after" });
  const [drvB, drvA] = [driverOf(baseline), driverOf(after)];
  if (drvB != null && drvA != null && drvB !== drvA) out.push({ key: "driver", before: drvB, after: drvA });
  const [winB, winA] = [text(baseline.game_state?.windows_build), text(after.game_state?.windows_build)];
  if (winB != null && winA != null && winB !== winA) out.push({ key: "windows-build", before: winB, after: winA });
  const [gmB, gmA] = [gamingMode(baseline), gamingMode(after)];
  if (gmB != null && gmA != null && gmB !== gmA) out.push({ key: "gaming-mode", before: gmB, after: gmA });
  const [resB, resA] = [resolution(baseline), resolution(after)];
  if (resB != null && resA != null && resB !== resA) out.push({ key: "resolution", before: resB, after: resA });
  // Background: both sessions recorded focus, and one spent a real stretch behind another window
  // that the other didn't.
  const [bgB, bgA] = [baseline.background_secs_excluded, after.background_secs_excluded];
  if (bgB != null && bgA != null && Math.abs(bgB - bgA) >= DRIFT_BACKGROUND_MIN_SECS) {
    // Opus r1 NIT: name how much MORE the one session spent behind another window.
    const which = bgB > bgA ? "baseline" : "after";
    out.push({ key: "background", which, mins: Math.max(1, Math.round(Math.abs(bgB - bgA) / 60)) });
  }
  const [lenB, lenA] = [baseline.duration_secs, after.duration_secs];
  const mins = (secs: number) => Math.max(1, Math.round(secs / 60));
  if (lenB > 0 && lenA > 0 && Math.max(lenB, lenA) >= DRIFT_LENGTH_RATIO * Math.min(lenB, lenA))
    out.push({ key: "length", beforeMins: mins(lenB), afterMins: mins(lenA) });
  return out;
}

const capText = (v: string, t: Translate) =>
  v === "off"
    ? t("lab.experimentBench.drift.capOff")
    : v.startsWith("on@")
      ? t("lab.experimentBench.drift.capOnAt", { fps: v.slice(3) })
      : t("lab.experimentBench.drift.capOn");

function itemWords(d: DriftItem, t: Translate): string {
  const k = (key: string, o?: Record<string, unknown>) => t(`lab.experimentBench.drift.item.${key}`, o);
  switch (d.key) {
    case "cap":
      return k("cap", { before: capText(d.before, t), after: capText(d.after, t) });
    case "power-plan":
      return k("powerPlan");
    case "power-plan-changed":
      return k(`powerPlanChanged.${d.which}`);
    case "driver":
      return k("driver", { before: d.before, after: d.after });
    case "windows-build":
      return k("windowsBuild", { before: d.before, after: d.after });
    case "gaming-mode":
      return k(d.before ? "gamingModeOnThenOff" : "gamingModeOffThenOn");
    case "resolution":
      return k("resolution", { before: d.before, after: d.after });
    case "background":
      return k(`background.${d.which}`, { mins: d.mins });
    case "length":
      return k("length", { before: d.beforeMins, after: d.afterMins });
  }
}

const STEP_KEY: Record<DriftItem["key"], string> = {
  cap: "cap",
  "power-plan": "powerPlan",
  "power-plan-changed": "powerPlan",
  driver: "rebaseline",
  "windows-build": "rebaseline",
  "gaming-mode": "gamingMode",
  resolution: "resolution",
  background: "background",
  length: "length",
};

/** The plain words for a Trial that varied too much: what differed (or that nothing recorded did)
 *  and exactly one next step. null when either session can't be found (nothing honest to compare). */
export function driftWords(
  baseline: SessionSummary | null | undefined,
  after: SessionSummary | null | undefined,
  game: string,
  t: Translate,
): string | null {
  if (baseline == null || after == null) return null;
  const items = sessionDrift(baseline, after);
  if (items.length === 0) {
    const compared = comparedFields(baseline, after);
    const fields = [...compared, "length"].map((k) => t(`lab.experimentBench.drift.field.${k}`)).join(t("lab.experimentBench.drift.fieldJoiner"));
    return `${
      compared.length === 0 ? t("lab.experimentBench.drift.noContext") : t("lab.experimentBench.drift.nothingDiffers", { fields })
    } ${t("lab.experimentBench.drift.step.asIs", { game })}`;
  }
  const list = items.map((d) => itemWords(d, t)).join(t("lab.experimentBench.drift.joiner"));
  return `${t("lab.experimentBench.drift.differed", { list })} ${t(`lab.experimentBench.drift.step.${STEP_KEY[items[0].key]}`)}`;
}
