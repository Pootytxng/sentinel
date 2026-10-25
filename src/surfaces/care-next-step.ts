// P6-next (ROADMAP Phase 6 "one safe next experiment at a time"; Constitution §25): the Care view
// shows exactly ONE next step at its top, and under it a measured-payoff line.
//
// PRIORITY (documented, and the only order there is):
//   1. the NEWEST crash record that carries a Black Box assessment: its `next_step`;
//   2. otherwise the stutter comparison's next test (the what-changed report's `next_action`), and
//      only when that report measured a regression on a pair that isn't "not comparable";
//   3. otherwise nothing. Never two. The record or report the step came from shows a pointer to the
//      top instead of repeating it.
//
// PAYOFF (measured, never a verdict):
//   * the anchor is when the step was TAKEN where Compy can tell (the user answered "Did this help?"
//     on a record of the same kind with this same reading), else when Compy FIRST SHOWED it here
//     (stored locally, together with the stutter baseline it was shown against);
//   * a crash step counts records of the same kind after the anchor (same `tag`; for App crash and
//     App hang also the same faulting app): any → "came back"; none over at least
//     RESOLUTION_MIN_DAYS whole days → a measured absence, qualified when sources were skipped
//     (a skipped source can hide a record); less → too soon;
//   * a stutter step counts full-length (MIN_BASELINE_SAMPLES) sessions of the same game on the same
//     rig after the anchor, against the STORED steady 1% low and noise floor (no new threshold):
//     any below → "came back in K of N"; all within and at least MIN_PAYOFF_SESSIONS → "stayed
//     within"; else not enough play.
//   No outcome says it is fixed: an absence is a measurement, not proof of the cause.
import type { CrashIncident, SessionSummary, WhatChangedReport } from "../types";
import { RESOLUTION_MIN_DAYS } from "../data/blackbox-resolution";
import { MIN_BASELINE_SAMPLES } from "./baseline-grade";

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

/** The stutter baseline a step was shown against; stored with the anchor so later reads measure
 *  against the same numbers even if a later comparison picks another steady session. */
export type StutterBaseline = { low1: number; noiseFloorPct: number; startedAt: string; hwHash: string | null };

export type CareStep =
  | {
      source: "incident";
      key: string;
      headline: string;
      detail: string;
      research: boolean;
      kind: string;
      /** Lower-cased faulting app for App crash / App hang; null where the kind alone is the match. */
      app: string | null;
      /** The faulting app as Windows named it, for the copy; null where `app` is null. */
      appLabel: string | null;
      consistentWith: string;
      incidentId: string;
      incidentWhen: string;
    }
  | {
      source: "stutter";
      key: string;
      headline: string;
      game: string;
      processName: string;
      baseline: StutterBaseline;
    };

const ms = (iso: string) => Date.parse(iso);
const APP_KINDS = new Set(["App crash", "App hang"]);

function appOf(i: CrashIncident): string | null {
  return APP_KINDS.has(i.tag) ? (i.receipt?.faulting_app ?? "").toLowerCase() || null : null;
}

/** Same kind as the step: same tag, and for app kinds the same faulting app. */
export function sameKind(i: CrashIncident, step: { kind: string; app: string | null }): boolean {
  if (i.tag !== step.kind) return false;
  return !APP_KINDS.has(step.kind) || appOf(i) === step.app;
}

/** Pure: the ONE step, by the priority above. */
export function pickCareStep(
  incidents: CrashIncident[] | null | undefined,
  stutter: StutterResult | null | undefined,
): CareStep | null {
  const withStep = (incidents ?? []).filter((i) => i.assessment && Number.isFinite(ms(i.when)));
  if (withStep.length > 0) {
    const inc = withStep.reduce((a, b) => (ms(b.when) > ms(a.when) ? b : a));
    const a = inc.assessment!;
    const app = appOf(inc);
    return {
      source: "incident",
      // Keyed on the kind and the step, not the record: a later record of the same kind with the
      // same step keeps the earlier anchor, so it shows as a recurrence instead of a fresh start.
      // The detail is part of the key: two stop codes can share a headline and are separate steps.
      key: `incident|${inc.tag}|${app ?? ""}|${a.next_step.headline}|${a.next_step.detail}`,
      headline: a.next_step.headline,
      detail: a.next_step.detail,
      research: a.next_step.research_only,
      kind: inc.tag,
      app,
      appLabel: app ? (inc.receipt?.faulting_app ?? null) : null,
      consistentWith: a.consistent_with,
      incidentId: inc.incident_id,
      incidentWhen: inc.when,
    };
  }
  const r = stutter?.report;
  if (r && r.next_action && r.verdict === "regressed" && r.comparability?.verdict !== "not-comparable") {
    return {
      source: "stutter",
      key: `stutter|${stutter!.processName.toLowerCase()}|${r.next_action}`,
      headline: r.next_action,
      game: stutter!.game,
      processName: stutter!.processName,
      baseline: {
        low1: r.baseline.low1_fps,
        noiseFloorPct: r.noise_floor_pct,
        startedAt: r.baseline.started_at,
        hwHash: r.baseline.hw_hash ?? null,
      },
    };
  }
  return null;
}

/** True for a record whose step is the one lifted to the top: the record it came from, and any
 *  other record of the same kind (and app) carrying the very same step, headline AND detail. Its row
 *  shows a pointer instead of repeating it; a record with a different detail keeps its own block. */
export function isLifted(step: CareStep | null, inc: CrashIncident): boolean {
  if (!step || step.source !== "incident" || !inc.assessment) return false;
  if (step.incidentId === inc.incident_id && step.incidentWhen === inc.when) return true;
  return (
    sameKind(inc, step) &&
    inc.assessment.next_step.headline === step.headline &&
    inc.assessment.next_step.detail === step.detail
  );
}

export type Anchor = { at: number; basis: "taken" | "shown"; baseline?: StutterBaseline };

export type Payoff =
  | { kind: "came-back"; count: number; firstAt: number }
  | { kind: "none-since"; days: number }
  | { kind: "none-since-partial"; days: number }
  | { kind: "too-soon" }
  | { kind: "sessions-back"; bad: number; total: number }
  | { kind: "sessions-steady"; total: number }
  | { kind: "not-enough-sessions"; total: number };

/** Pure: the measured payoff of `step` since `anchor`. `skipped` = the scan skipped a source (needs
 *  admin), so an absence can't be claimed in full. `now` is injectable for tests. */
export function payoffFor(
  step: CareStep,
  anchor: Anchor,
  incidents: CrashIncident[],
  sessions: SessionSummary[],
  now: Date = new Date(),
  skipped = false,
): Payoff {
  if (step.source === "incident") {
    const after = incidents
      .filter((i) => sameKind(i, step))
      .map((i) => ms(i.when))
      .filter((t) => Number.isFinite(t) && t > anchor.at)
      .sort((a, b) => a - b);
    if (after.length > 0) return { kind: "came-back", count: after.length, firstAt: after[0] };
    const days = Math.floor((now.getTime() - anchor.at) / 86_400_000);
    if (days < RESOLUTION_MIN_DAYS) return { kind: "too-soon" };
    return skipped ? { kind: "none-since-partial", days } : { kind: "none-since", days };
  }
  const base = anchor.baseline ?? step.baseline;
  const game = step.processName.toLowerCase();
  const since = sessions.filter((s) => {
    const rig = s.hw_fingerprint?.hash ?? null;
    return (
      s.samples >= MIN_BASELINE_SAMPLES &&
      (s.process_name ?? "").toLowerCase() === game &&
      Number.isFinite(ms(s.started_at)) &&
      ms(s.started_at) > anchor.at &&
      Number.isFinite(s.low1_fps_est) &&
      (!rig || !base.hwHash || rig === base.hwHash)
    );
  });
  const floor = base.low1 * (1 - base.noiseFloorPct / 100);
  const bad = since.filter((s) => s.low1_fps_est < floor).length;
  if (bad > 0) return { kind: "sessions-back", bad, total: since.length };
  if (since.length >= MIN_PAYOFF_SESSIONS) return { kind: "sessions-steady", total: since.length };
  return { kind: "not-enough-sessions", total: since.length };
}

// ── Local anchors (per-PC convenience, like the "Did this help?" log; wrapped, never required) ──
export const SHOWN_KEY = "compy_care_step_shown";
const FEEDBACK_LOG_KEY = "compy_bb_feedback"; // BlackBox.tsx ResolutionFeedback's log

type ShownEntry = { at: string; baseline?: StutterBaseline };

function readShown(): Map<string, ShownEntry | string> {
  const raw = localStorage.getItem(SHOWN_KEY);
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  const out = new Map<string, ShownEntry | string>();
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" || (v && typeof v === "object" && typeof v.at === "string")) out.set(k, v);
    }
  }
  return out;
}

/** When the step was taken (a "Did this help?" answer on a record of the same kind with this
 *  reading), else when it was first shown here (recorded now, with its stutter baseline, if never
 *  before). Storage failing → shown now, against the step's own baseline. */
export function anchorFor(step: CareStep, incidents: CrashIncident[] = [], now: Date = new Date()): Anchor {
  if (step.source === "incident") {
    try {
      const log: unknown = JSON.parse(localStorage.getItem(FEEDBACK_LOG_KEY) || "[]");
      if (Array.isArray(log)) {
        for (let i = log.length - 1; i >= 0; i--) {
          const e = log[i];
          const at = e && typeof e.at === "string" ? ms(e.at) : NaN;
          if (
            e &&
            e.consistent_with === step.consistentWith &&
            Number.isFinite(at) &&
            // The answer's own record (keyed by its `when`) must be of the same kind.
            incidents.some((inc) => inc.when === e.when && sameKind(inc, step))
          ) {
            return { at, basis: "taken" };
          }
        }
      }
    } catch {
      /* unreadable log: fall through to "shown" */
    }
  }
  try {
    const map = readShown();
    const prior = map.get(step.key);
    const priorAt = typeof prior === "string" ? ms(prior) : prior && typeof prior.at === "string" ? ms(prior.at) : NaN;
    if (Number.isFinite(priorAt)) {
      const stored = typeof prior === "object" && prior.baseline ? prior.baseline : undefined;
      return {
        at: priorAt,
        basis: "shown",
        baseline: step.source === "stutter" ? (stored ?? step.baseline) : undefined,
      };
    }
    const entry: ShownEntry =
      step.source === "stutter" ? { at: now.toISOString(), baseline: step.baseline } : { at: now.toISOString() };
    map.set(step.key, entry);
    // Capped so an old step list can't grow without end.
    localStorage.setItem(SHOWN_KEY, JSON.stringify(Object.fromEntries([...map.entries()].slice(-50))));
  } catch {
    /* storage unavailable: the anchor is simply now */
  }
  return { at: now.getTime(), basis: "shown", baseline: step.source === "stutter" ? step.baseline : undefined };
}
