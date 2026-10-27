// P5-resume (ROADMAP Phase 5 step 5; OPTIMIZATION_ENGINE §7): the guided journey survives a Compy or
// game restart and spans days, because its progress is DERIVED from records Compy already keeps,
// never from a journey store of its own:
//   - tested: a change whose newest judged Trial on this game reached a MEASURED verdict (improved /
//     no-change / regressed) in this PC's experiments store, the rule the P4-exit summary uses
//     (test-summary.ts, "truthful completion"). An inconclusive attempt (too noisy, confounded…) is
//     counted apart, never as tested;
//   - left to test: the Trial picker's own live list (`get_trial_candidates`, passing changes in the
//     P4-rank order) minus what has a judged Trial; the first is the next change. When nothing is
//     left, the next change is one worth ANOTHER run (`nextToTest`): an inconclusive one under the
//     retest cap, or a result judged under an older driver or Windows build, if the picker still
//     offers it; none = the journey has nothing left here;
//   - unfinished: a Trial of this game still Running (after a restart, the bench's interrupted banner
//     names the same one). It counts toward the total but not as tested, and the line names it instead
//     of offering the next change, so the line and the banner never disagree;
//   - the as-is session a continuing journey may reuse: P5-continue's rule, read from the newest judged
//     Trial (a kept Better: the session measured with it on; otherwise its before-session). Whether it
//     is still reusable is `reusableAsIs`, and whether it is still comparable is the start's to say.
//
// The only thing kept outside the experiments store is "Stop here" (ENGINE §7: the user ends the
// journey): one per-game timestamp in this webview's localStorage under a key older builds never read.
// It stops Compy offering the next change for that game until a newer Trial is judged there or the
// owner picks it up again. It changes nothing on the PC: kept changes stay on.

import type { SessionSummary } from "../types";
import {
  contextCheckFor,
  inconclusiveRunsOf,
  isMeasuredVerdict,
  judgedAt,
  RETEST_CAP,
  stillAppliedFrom,
  type ContextMatch,
  type RetestReason,
  type SummaryCandidate,
} from "./test-summary";

/** The experiment fields progress reads (experiment.rs `ExperimentRecord`). */
export type ResumeExperiment = {
  id: string;
  rec_id: string;
  rec_title: string;
  game: string;
  status: string;
  verdict: string | null;
  kept?: boolean;
  /** Always set by experiment.rs; optional only because the journey's own copy types it loosely. */
  created_at?: string;
  concluded_at?: string | null;
  baseline_session_id?: string | null;
  treatment?: { session_id?: string | null } | null;
};

export type NextToTest<C extends { id: string; title: string }> = C & {
  /** null = never tested here; otherwise why this change is offered another run. */
  retest: RetestReason | null;
};

export type JourneyProgress = {
  game: string;
  /** Changes with a measured result here that still holds (not stale). */
  tested: number;
  /** Changes tried here whose newest judged Trial judged nothing (too noisy, confounded…). */
  inconclusive: number;
  /** Changes with a measured result judged under a different driver or Windows build than now. */
  stale: number;
  /** Stale results the picker no longer offers (the change is set now; put it back to test again). */
  staleKept: number;
  /** Tested + inconclusive + stale + unfinished + left to test. */
  total: number;
  /** The first change left to test, in the picker's order, else one worth another run (`retest`
   *  says why); null when nothing is left. */
  next: NextToTest<{ id: string; title: string }> | null;
  /** A Trial of this game still Running (its change is on), or null. */
  unfinished: { id: string; title: string } | null;
  /** The session a continuing journey may reuse as its before-reading, or null. */
  asIs: string | null;
  /** When the newest judged Trial here was judged (ms), or -Infinity. */
  lastAt: number;
};

const when = judgedAt;

/** The judged Trials of `game`, oldest first, grouped per change. */
function judgedByRec(game: string, experiments: readonly ResumeExperiment[]): Map<string, ResumeExperiment[]> {
  const byRec = new Map<string, ResumeExperiment[]>();
  for (const x of experiments.filter((x) => x.game === game && x.verdict != null).sort((a, b) => when(a) - when(b)))
    byRec.set(x.rec_id, [...(byRec.get(x.rec_id) ?? []), x]);
  return byRec;
}

/** Why a tested change is worth another run on `game`, or null (it has a result that still holds,
 *  or this PC gave up judging it). `sessions` tell whether a result is stale; none = unknown, never
 *  stale. Pure. */
export function retestReasonFor(
  runs: readonly ResumeExperiment[],
  matchOf: (baselineSessionId: string | null | undefined) => ContextMatch,
): RetestReason | null {
  const newest = runs[runs.length - 1];
  if (!newest) return null;
  if (!isMeasuredVerdict(newest.verdict)) return inconclusiveRunsOf(runs, matchOf) < RETEST_CAP ? "inconclusive" : null;
  return matchOf(newest.baseline_session_id) === "changed" ? "stale" : null;
}

/**
 * The next change to test on `game` (P4-next, P5-continue, P5-resume share this one rule): the first
 * change in the picker's order with no judged Trial here; when none is left, the first one worth
 * another run (inconclusive under the retest cap, or a stale result), tagged with why; null when
 * nothing is left. `candidates`: the picker's passing changes in its suggested order. `exclude`: a
 * change not to offer (the one still Running). Pure.
 */
export function nextToTest<C extends { id: string; title: string }>(
  game: string,
  experiments: readonly ResumeExperiment[],
  candidates: readonly C[],
  sessions: readonly SessionSummary[] = [],
  exclude: string | null = null,
): NextToTest<C> | null {
  const byRec = judgedByRec(game, experiments);
  const fresh = candidates.find((c) => !byRec.has(c.id) && c.id !== exclude);
  if (fresh) return { ...fresh, retest: null };
  const { matchOf } = contextCheckFor(game, sessions);
  for (const c of candidates) {
    if (c.id === exclude) continue;
    const why = retestReasonFor(byRec.get(c.id) ?? [], matchOf);
    if (why) return { ...c, retest: why };
  }
  return null;
}

/** `candidates`: the picker's passing changes in its suggested order (P4-rank). Pure. */
export function journeyProgress(
  game: string,
  experiments: readonly ResumeExperiment[],
  candidates: readonly { id: string; title: string }[],
  sessions: readonly SessionSummary[] = [],
): JourneyProgress {
  const byRec = judgedByRec(game, experiments);
  const judged = [...byRec.values()].flat().sort((a, b) => when(a) - when(b));
  const { matchOf } = contextCheckFor(game, sessions);
  const newestOf = (runs: ResumeExperiment[]) => runs[runs.length - 1];
  const measured = [...byRec.values()].filter((runs) => isMeasuredVerdict(newestOf(runs).verdict));
  const staleRuns = measured.filter((runs) => matchOf(newestOf(runs).baseline_session_id) === "changed");
  const running = experiments.find((x) => x.game === game && x.status === "running") ?? null;
  const unfinished = running && !byRec.has(running.rec_id) ? running : null;
  const left = candidates.filter((c) => !byRec.has(c.id) && c.id !== running?.rec_id);
  const offered = new Set(candidates.map((c) => c.id));
  const newest = judged[judged.length - 1];
  const keptBetter = newest?.status === "kept" && newest.verdict === "improved";
  return {
    game,
    tested: measured.length - staleRuns.length,
    inconclusive: byRec.size - measured.length,
    stale: staleRuns.length,
    staleKept: staleRuns.filter((runs) => !offered.has(newestOf(runs).rec_id)).length,
    total: byRec.size + (unfinished ? 1 : 0) + left.length,
    next: nextToTest(game, experiments, candidates, sessions, running?.rec_id ?? null),
    unfinished: running ? { id: running.id, title: running.rec_title } : null,
    asIs: newest ? ((keptBetter ? newest.treatment?.session_id : newest.baseline_session_id) ?? null) : null,
    lastAt: newest ? when(newest) : Number.NEGATIVE_INFINITY,
  };
}

/** The tested changes on `game` whose newest judged Trial kept them and whose live check (the
 *  picker's answer) reads on now, in first-tested order. A kept change that can't be confirmed on is
 *  not claimed. Pure. */
export function stillOnFor(
  game: string,
  experiments: readonly ResumeExperiment[],
  candidates: readonly SummaryCandidate[] | null,
): string[] {
  const newest = new Map<string, ResumeExperiment>();
  for (const x of experiments.filter((x) => x.game === game && x.verdict != null).sort((a, b) => when(a) - when(b)))
    newest.set(x.rec_id, x);
  return [...newest.values()]
    .filter((x) => x.kept && stillAppliedFrom(candidates?.find((c) => c.id === x.rec_id)) === "on")
    .map((x) => x.rec_title);
}

// ── Stop here ──────────────────────────────────────────────────────────────────────────────────
const STOP_KEY = "compy.journey.stopped";
function readStops(): Record<string, number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STOP_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function writeStops(stops: Record<string, number>) {
  try {
    localStorage.setItem(STOP_KEY, JSON.stringify(stops));
  } catch {
    /* storage unavailable: the offer simply stays */
  }
}
/** The owner ends the journey for `game`. Nothing on the PC changes. */
export function stopJourneyHere(game: string, now: number = Date.now()) {
  writeStops({ ...readStops(), [game]: now });
}
/** The owner picks the journey for `game` up again. */
export function pickUpJourney(game: string) {
  const stops = readStops();
  delete stops[game];
  writeStops(stops);
}
/** Stopped here: a stop at or after the newest judged Trial on the game. */
export function journeyStopped(p: JourneyProgress): boolean {
  const at = readStops()[p.game];
  return typeof at === "number" && Number.isFinite(at) && at >= p.lastAt;
}
