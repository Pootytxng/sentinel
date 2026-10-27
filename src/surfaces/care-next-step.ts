// P6-next (ROADMAP Phase 6 "one safe next experiment at a time"; Constitution §25): the Care view
// shows exactly ONE next step at its top, and under it a measured-payoff line.
//
// PRIORITY (documented, and the only order there is):
//   1. the NEWEST crash record that carries a Black Box assessment: its `next_step`;
//   2. otherwise the stutter comparison's next test (the what-changed report's `next_action`), and
//      only when that report measured a regression on a pair that isn't "not comparable";
//   3. otherwise a STORED stutter step (P6-next-f2): the step this game was last shown with, still
//      measured against the anchor stored when it was first shown (see storedStutterStep), so its
//      payoff, including "stayed within", can show after the user plays good sessions;
//   4. otherwise nothing. Never two. The record or report the step came from shows a pointer to the
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
import { APP_KINDS, RESOLUTION_MIN_DAYS, appOf } from "../data/blackbox-resolution";
import { MIN_BASELINE_SAMPLES } from "./baseline-grade";
import { MAX_GOOD_CANDIDATES } from "./StutterCompare";

export { RESOLUTION_MIN_DAYS };
/** Measured sessions of the game needed before "it stayed within" is said at all. */
export const MIN_PAYOFF_SESSIONS = 2;
/** P6-next-f2: a stored stutter step ends once MORE than this many sessions (steady or not) have been
 *  counted since its anchor; that final read shows once, and the step retires on the next Care view. It is the comparison's own look-back (StutterCompare MAX_GOOD_CANDIDATES): past
 *  that many newer steady sessions, the comparison would never reach back to the session this step
 *  was measured against, so the old baseline has aged out of what Compy itself compares with. Up to
 *  and including it, "stayed within" shows (from MIN_PAYOFF_SESSIONS on). */
export const STORED_STEP_END_SESSIONS = MAX_GOOD_CANDIDATES;

/** What StutterCompare hands up once it has a report (null when it has none). */
export type StutterResult = {
  report: WhatChangedReport;
  game: string;
  processName: string;
  sessions: SessionSummary[];
};

/** The stutter baseline a step was shown against; stored with the anchor so later reads measure
 *  against the same numbers even if a later comparison picks another steady session. */
export type StutterBaseline = {
  low1: number;
  noiseFloorPct: number;
  startedAt: string;
  hwHash: string | null;
  /** P6-next-f2: the steady session's rig as the engine compares it (gpu, ram, display; never the
   *  hash, which includes the driver). Null/absent where unknown; then read from that session. */
  rig?: Rig | null;
};
export type Rig = { gpu: string; ram_gb: number; display: string };

const rigOf = (s: SessionSummary | undefined): Rig | null => {
  const f = s?.hw_fingerprint;
  return f ? { gpu: f.gpu, ram_gb: f.ram_gb, display: f.display } : null;
};
/** Same rig the way the engine says it (intelligence.rs): gpu, ram and display. A driver update is
 *  the same rig, so following a "roll back / update the driver" test never reads as a rig change. */
const sameRig = (a: Rig, b: Rig) => a.gpu === b.gpu && a.ram_gb === b.ram_gb && a.display === b.display;
/** The baseline's rig: stored with it, else the steady session's own fingerprint, else unknown. */
function baselineRig(base: StutterBaseline, sessions: SessionSummary[]): Rig | null {
  return base.rig ?? rigOf(sessions.find((s) => s.started_at === base.startedAt));
}

export type CareStep =
  | {
      source: "incident";
      key: string;
      headline: string;
      detail: string;
      research: boolean;
      /** The record's reading is beyond what Compy can safely narrow down (`beyond_us`). */
      beyond: boolean;
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
      /** P6-next-f2: shown from its stored anchor; the newest comparison did not pick it itself. */
      stored: boolean;
      /** P6-next-f2: its end is reached; this is the last read shown before it retires. */
      final?: boolean;
    };

const ms = (iso: string) => Date.parse(iso);
/** Same kind as the step: same tag, and for app kinds the same faulting app. */
export function sameKind(i: CrashIncident, step: { kind: string; app: string | null }): boolean {
  if (i.tag !== step.kind) return false;
  return !APP_KINDS.has(step.kind) || appOf(i) === step.app;
}

/** Pure: the ONE step, by the priority above. */
export function pickCareStep(
  incidents: CrashIncident[] | null | undefined,
  stutter: StutterResult | null | undefined,
  /** P6-next-f2: the stored stutter step for this game (storedStutterStep), or null. */
  stored: CareStep | null = null,
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
      beyond: !!a.beyond_us,
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
        rig: rigOf(stutter!.sessions.find((s) => s.started_at === r.baseline.started_at)),
      },
      stored: false,
    };
  }
  return stored && stored.source === "stutter" ? stored : null;
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
  const baseRig = baselineRig(base, sessions);
  const since = sessions.filter((s) => {
    const rig = rigOf(s);
    return (
      s.samples >= MIN_BASELINE_SAMPLES &&
      (s.process_name ?? "").toLowerCase() === game &&
      Number.isFinite(ms(s.started_at)) &&
      ms(s.started_at) > anchor.at &&
      Number.isFinite(s.low1_fps_est) &&
      (!rig || !baseRig || sameRig(rig, baseRig))
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

/** Why a stored stutter step stopped showing (P6-next-f2). A retired entry is never shown again; a
 *  NEW regression with the same cause starts a fresh anchor over it. */
export type Retired = "ended" | "dismissed" | "replaced" | "rig";
type ShownEntry = {
  at: string;
  baseline?: StutterBaseline;
  retired?: Retired;
  /** The Care view (BlackBox mount) that showed the final read; another view retires it. */
  finalView?: string;
};

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
    const found = map.get(step.key);
    // A retired stutter step that regressed again is a fresh step: new anchor, new baseline.
    let prior = typeof found === "object" && found.retired ? undefined : found;
    // Follow-up review 2026-10-26 §4: the same advice on different hardware is not the same step.
    // A stored stutter baseline whose rig (gpu, ram, display; never the hash, which includes the
    // driver) differs from the one this step was just judged on would measure the new problem from
    // the old machine's numbers. Retire it as a rig change and anchor afresh. Either rig unknown:
    // nothing is known to differ, so the anchor is kept.
    if (step.source === "stutter" && typeof prior === "object" && prior.baseline) {
      const was = prior.baseline.rig ?? null;
      const is = step.baseline.rig ?? null;
      if (was && is && !sameRig(was, is)) {
        map.set(step.key, { ...prior, retired: "rig" });
        prior = undefined;
      }
    }
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
    // P6-next-f2: a new stutter step for this game replaces the one stored before it.
    if (step.source === "stutter") {
      const game = stutterGameOf(step.key);
      for (const [k, v] of map) {
        if (k !== step.key && stutterGameOf(k) === game && typeof v === "object" && !v.retired) {
          map.set(k, { ...v, retired: "replaced" });
        }
      }
    }
    map.delete(step.key); // re-inserted last, so the cap below keeps it
    map.set(step.key, entry);
    // Capped so an old step list can't grow without end.
    localStorage.setItem(SHOWN_KEY, JSON.stringify(Object.fromEntries([...map.entries()].slice(-50))));
  } catch {
    /* storage unavailable: the anchor is simply now */
  }
  return { at: now.getTime(), basis: "shown", baseline: step.source === "stutter" ? step.baseline : undefined };
}

// ── P6-next-f2: the stored stutter step ──
/** The game part of a stutter step key (`stutter|<process lower>|<next test>`), else null. */
function stutterGameOf(key: string): string | null {
  if (!key.startsWith("stutter|")) return null;
  const end = key.indexOf("|", 8);
  return end > 8 ? key.slice(8, end) : null;
}

function writeShown(map: Map<string, ShownEntry | string>) {
  localStorage.setItem(SHOWN_KEY, JSON.stringify(Object.fromEntries([...map.entries()].slice(-50))));
}

/** The newest full-length session of the game: the rig it was played on now. */
function newestRigOf(sessions: SessionSummary[], game: string): Rig | null {
  const full = sessions.filter(
    (s) =>
      s.samples >= MIN_BASELINE_SAMPLES &&
      (s.process_name ?? "").toLowerCase() === game &&
      Number.isFinite(ms(s.started_at)),
  );
  if (full.length === 0) return null;
  return rigOf(full.reduce((a, b) => (ms(b.started_at) > ms(a.started_at) ? b : a)));
}

/** The stutter step this game was last shown with, still alive: its stored anchor (first shown,
 *  steady 1% low, noise floor, steady session, rig) exists, it is not retired, and the comparison has
 *  sessions of the same game to count. It is retired here, for good, when:
 *    * the rig changed: the game's newest full-length session is on another rig (gpu, ram or
 *      display; a driver update is not a rig change) than the anchor's steady session;
 *    * it ended: more than STORED_STEP_END_SESSIONS sessions counted since the anchor, whatever they
 *      measured. The final read is shown (`final`) in the Care view `view` that first reached it,
 *      and the step retires in the next one, so the end is seen, never silent.
 *  None of this applies while the newest comparison itself picks this step (fresh): its anchor
 *  stays as it is. (Dismissed: dismissStoredStep; replaced: anchorFor when a new step for this game
 *  is first shown.) Storage missing or unreadable → null: nothing stored is shown. */
export function storedStutterStep(
  stutter: StutterResult | null | undefined,
  now: Date = new Date(),
  view = "",
): CareStep | null {
  if (!stutter) return null;
  const game = stutter.processName.toLowerCase();
  try {
    const map = readShown();
    let best: { key: string; at: number; baseline: StutterBaseline } | null = null;
    for (const [k, v] of map) {
      if (stutterGameOf(k) !== game || typeof v !== "object" || v.retired || !v.baseline) continue;
      const at = ms(v.at);
      if (Number.isFinite(at) && (!best || at > best.at)) best = { key: k, at, baseline: v.baseline };
    }
    if (!best) return null;
    const step: CareStep = {
      source: "stutter",
      key: best.key,
      headline: best.key.slice(8 + game.length + 1),
      game: stutter.game,
      processName: stutter.processName,
      baseline: best.baseline,
      stored: true,
    };
    const fresh = pickCareStep(null, stutter);
    if (fresh && fresh.key === best.key) return step;
    const retire = (why: Retired) => {
      map.set(best!.key, { ...(map.get(best!.key) as ShownEntry), retired: why });
      writeShown(map);
      return null;
    };
    const now_ = newestRigOf(stutter.sessions, game);
    const then = baselineRig(best.baseline, stutter.sessions);
    if (now_ && then && !sameRig(now_, then)) return retire("rig");
    const p = payoffFor(step, { at: best.at, basis: "shown", baseline: best.baseline }, [], stutter.sessions, now);
    if ("total" in p && p.total > STORED_STEP_END_SESSIONS) {
      const e = map.get(best.key) as ShownEntry;
      // Follow-up review 2026-10-26 §4: the final read is "shown" only once a Care view actually
      // rendered it (markFinalShown, from the view, after pickCareStep chose this step over a crash
      // card). Preparing it here is not showing it. Retire only after a DIFFERENT view showed it.
      if (e.finalView !== undefined && e.finalView !== view) return retire("ended");
      return { ...step, final: true };
    }
    return step;
  } catch {
    return null;
  }
}

/** The Care view `view` is rendering the stored stutter step `key`'s final read right now: record
 *  it, so the step retires in the next view, never in one where a crash card took its place. First
 *  view to show it wins; later views in the same session change nothing. */
export function markFinalShown(key: string, view: string): void {
  try {
    const map = readShown();
    const e = map.get(key);
    if (e && typeof e === "object" && !e.retired && e.finalView === undefined) {
      map.set(key, { ...e, finalView: view });
      writeShown(map);
    }
  } catch {
    /* storage unavailable: the final read simply shows again next time */
  }
}

/** The user's "Stop tracking this step": the stored step is retired and never shown again. */
export function dismissStoredStep(key: string): void {
  try {
    const map = readShown();
    const v = map.get(key);
    if (v && typeof v === "object") {
      map.set(key, { ...v, retired: "dismissed" });
      writeShown(map);
    }
  } catch {
    /* storage unavailable: nothing to retire */
  }
}
