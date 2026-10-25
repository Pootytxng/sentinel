// P6-next (ROADMAP Phase 6 "one safe next experiment at a time"; Constitution §25): the Care view
// shows exactly ONE next step at its top, and under it a measured-payoff line.
//
// PRIORITY (documented, and the only order there is):
//   1. the NEWEST crash record that carries a Black Box assessment: its `next_step`;
//   2. otherwise the stutter comparison's next test (the what-changed report's `next_action`);
//   3. otherwise nothing. Never two.
//
// PAYOFF (measured, never a verdict):
//   * the anchor is when the step was TAKEN where Compy can tell (the user answered "Did this help?"
//     on a record with this same reading), else when Compy FIRST SHOWED it here (stored locally);
//   * a crash step counts records of the same kind (`tag`) after the anchor: any → "came back";
//     none, and at least RESOLUTION_MIN_DAYS whole days → "none recorded in N days"; else too soon;
//   * a stutter step counts measured sessions of the same game after the anchor, against the steady
//     session's 1% low and the report's own noise floor (no new threshold): any below → "came back
//     in K of N"; all within and at least MIN_PAYOFF_SESSIONS → "stayed within"; else not enough play.
//   No outcome says it is fixed: an absence is a measurement, not proof of the cause.
import type { CrashIncident, SessionSummary, WhatChangedReport } from "../types";
import { RESOLUTION_MIN_DAYS } from "../data/blackbox-resolution";

export { RESOLUTION_MIN_DAYS };
/** Measured sessions of the game needed before "it stayed within" is said at all. */
export const MIN_PAYOFF_SESSIONS = 2;

/** What StutterCompare hands up once it has a report (null when it has none). */
export type StutterResult = {
  report: WhatChangedReport;
  game: string;
  processName: string;
  sessions: SessionSummary[];
};

export type CareStep =
  | {
      source: "incident";
      key: string;
      headline: string;
      detail: string;
      research: boolean;
      kind: string;
      consistentWith: string;
      incidentWhen: string;
    }
  | {
      source: "stutter";
      key: string;
      headline: string;
      game: string;
      processName: string;
      baselineLow1: number;
      noiseFloorPct: number;
    };

const ms = (iso: string) => Date.parse(iso);

/** Pure: the ONE step, by the priority above. */
export function pickCareStep(
  incidents: CrashIncident[] | null | undefined,
  stutter: StutterResult | null | undefined,
): CareStep | null {
  const withStep = (incidents ?? []).filter((i) => i.assessment && Number.isFinite(ms(i.when)));
  if (withStep.length > 0) {
    const inc = withStep.reduce((a, b) => (ms(b.when) > ms(a.when) ? b : a));
    const a = inc.assessment!;
    return {
      source: "incident",
      // Keyed on the kind and the step, not the record: a later record of the same kind with the
      // same step keeps the earlier anchor, so it shows as a recurrence instead of a fresh start.
      key: `incident|${inc.tag}|${a.next_step.headline}`,
      headline: a.next_step.headline,
      detail: a.next_step.detail,
      research: a.next_step.research_only,
      kind: inc.tag,
      consistentWith: a.consistent_with,
      incidentWhen: inc.when,
    };
  }
  const r = stutter?.report;
  if (r && r.next_action) {
    return {
      source: "stutter",
      key: `stutter|${stutter!.processName.toLowerCase()}|${r.next_action}`,
      headline: r.next_action,
      game: stutter!.game,
      processName: stutter!.processName,
      baselineLow1: r.baseline.low1_fps,
      noiseFloorPct: r.noise_floor_pct,
    };
  }
  return null;
}

export type Anchor = { at: number; basis: "taken" | "shown" };

export type Payoff =
  | { kind: "came-back"; count: number; firstAt: number }
  | { kind: "none-since"; days: number }
  | { kind: "too-soon" }
  | { kind: "sessions-back"; bad: number; total: number }
  | { kind: "sessions-steady"; total: number }
  | { kind: "not-enough-sessions"; total: number };

/** Pure: the measured payoff of `step` since `anchor`. `now` is injectable for tests. */
export function payoffFor(
  step: CareStep,
  anchor: Anchor,
  incidents: CrashIncident[],
  sessions: SessionSummary[],
  now: Date = new Date(),
): Payoff {
  if (step.source === "incident") {
    const after = incidents
      .filter((i) => i.tag === step.kind)
      .map((i) => ms(i.when))
      .filter((t) => Number.isFinite(t) && t > anchor.at)
      .sort((a, b) => a - b);
    if (after.length > 0) return { kind: "came-back", count: after.length, firstAt: after[0] };
    const days = Math.floor((now.getTime() - anchor.at) / 86_400_000);
    return days >= RESOLUTION_MIN_DAYS ? { kind: "none-since", days } : { kind: "too-soon" };
  }
  const game = step.processName.toLowerCase();
  const since = sessions.filter(
    (s) =>
      s.samples > 0 &&
      (s.process_name ?? "").toLowerCase() === game &&
      Number.isFinite(ms(s.started_at)) &&
      ms(s.started_at) > anchor.at &&
      Number.isFinite(s.low1_fps_est),
  );
  const floor = step.baselineLow1 * (1 - step.noiseFloorPct / 100);
  const bad = since.filter((s) => s.low1_fps_est < floor).length;
  if (bad > 0) return { kind: "sessions-back", bad, total: since.length };
  if (since.length >= MIN_PAYOFF_SESSIONS) return { kind: "sessions-steady", total: since.length };
  return { kind: "not-enough-sessions", total: since.length };
}

// ── Local anchors (per-PC convenience, like the "Did this help?" log; wrapped, never required) ──
export const SHOWN_KEY = "compy_care_step_shown";
const FEEDBACK_LOG_KEY = "compy_bb_feedback"; // BlackBox.tsx ResolutionFeedback's log

/** When the step was taken (a "Did this help?" answer on a record with this reading), else when it
 *  was first shown here (recorded now if never before). Storage failing → shown now. */
export function anchorFor(step: CareStep, now: Date = new Date()): Anchor {
  if (step.source === "incident") {
    try {
      const log: unknown = JSON.parse(localStorage.getItem(FEEDBACK_LOG_KEY) || "[]");
      if (Array.isArray(log)) {
        for (let i = log.length - 1; i >= 0; i--) {
          const e = log[i];
          const at = e && typeof e.at === "string" ? ms(e.at) : NaN;
          if (e && e.consistent_with === step.consistentWith && Number.isFinite(at)) {
            return { at, basis: "taken" };
          }
        }
      }
    } catch {
      /* unreadable log: fall through to "shown" */
    }
  }
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    const prior = map && typeof map[step.key] === "string" ? ms(map[step.key]) : NaN;
    if (Number.isFinite(prior)) return { at: prior, basis: "shown" };
    const next = { ...(map && typeof map === "object" ? map : {}), [step.key]: now.toISOString() };
    // Capped so an old step list can't grow without end.
    const trimmed = Object.fromEntries(Object.entries(next).slice(-50));
    localStorage.setItem(SHOWN_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage unavailable: the anchor is simply now */
  }
  return { at: now.getTime(), basis: "shown" };
}
