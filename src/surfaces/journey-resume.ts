// P5-resume (ROADMAP Phase 5 step 5; OPTIMIZATION_ENGINE §7): the guided journey survives a Compy or
// game restart and spans days, because its progress is DERIVED from records Compy already keeps,
// never from a journey store of its own:
//   - tested: a change with a judged Trial (it carries a verdict) on this game in this PC's experiments
//     store, the same rule P4-next and the P4-exit summary use;
//   - left to test: the Trial picker's own live list (`get_trial_candidates`, passing changes in the
//     P4-rank order) minus what is tested; the first is the next change;
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

import { stillAppliedFrom, type SummaryCandidate } from "./test-summary";

/** The experiment fields progress reads (experiment.rs `ExperimentRecord`). */
export type ResumeExperiment = {
  id: string;
  rec_id: string;
  rec_title: string;
  game: string;
  status: string;
  verdict: string | null;
  kept?: boolean;
  created_at: string;
  concluded_at?: string | null;
  baseline_session_id?: string | null;
  treatment?: { session_id?: string | null } | null;
};

export type JourneyProgress = {
  game: string;
  tested: number;
  /** Tested + unfinished + left to test. */
  total: number;
  /** The first change left to test, in the picker's order; null when none is left. */
  next: { id: string; title: string } | null;
  /** A Trial of this game still Running (its change is on), or null. */
  unfinished: { id: string; title: string } | null;
  /** The session a continuing journey may reuse as its before-reading, or null. */
  asIs: string | null;
  /** When the newest judged Trial here was judged (ms), or -Infinity. */
  lastAt: number;
};

const when = (x: ResumeExperiment) => {
  const t = Date.parse(x.concluded_at ?? x.created_at);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/** `candidates`: the picker's passing changes in its suggested order (P4-rank). Pure. */
export function journeyProgress(
  game: string,
  experiments: readonly ResumeExperiment[],
  candidates: readonly { id: string; title: string }[],
): JourneyProgress {
  const judged = experiments.filter((x) => x.game === game && x.verdict != null).sort((a, b) => when(a) - when(b));
  const testedIds = new Set(judged.map((x) => x.rec_id));
  const running = experiments.find((x) => x.game === game && x.status === "running") ?? null;
  const unfinished = running && !testedIds.has(running.rec_id) ? running : null;
  const left = candidates.filter((c) => !testedIds.has(c.id) && c.id !== running?.rec_id);
  const newest = judged[judged.length - 1];
  const keptBetter = newest?.status === "kept" && newest.verdict === "improved";
  return {
    game,
    tested: testedIds.size,
    total: testedIds.size + (unfinished ? 1 : 0) + left.length,
    next: left[0] ? { id: left[0].id, title: left[0].title } : null,
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
