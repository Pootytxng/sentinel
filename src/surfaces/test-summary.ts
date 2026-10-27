// P4-exit (ROADMAP Phase 4 exit, OPTIMIZATION_ENGINE §7–9): the per-game "We tested what mattered on
// this PC" summary. READ-ONLY and pure: it derives everything from records Compy already keeps and
// changes nothing.
//
//   - tested: a change with a judged Trial (it carries a verdict) on this game in this PC's
//     experiments store, the same "tested" P4-next uses. One row per change, from its newest judged
//     Trial: the verdict, its confidence band (the existing `verdict_confidence` vocabulary, never a
//     number) and the noise band that Trial was judged on;
//   - still applied: the Trial picker's own live answer for the change (`get_trial_candidates`), whose
//     "set by Compy" is the shared one-per-change rule (`history::live_change_groups`, the rule Health,
//     Optimize and History count by) over the ledger's live checks. A change the picker offers reads
//     not set now; "set by Compy" reads on; the rule's can't-confirm group reads can't-confirm; set by
//     Windows or by a Gaming Mode session is said as that. Anything the picker can't answer (the list
//     wasn't read, the ledger couldn't be checked, the change isn't for this PC) is "unknown", never
//     assumed off;
//   - skipped / left to test: the Trial picker's own answer (`get_trial_candidates`): a change left out
//     carries its reason; a change that passes and has no judged Trial here is still worth testing;
//   - context (§9): the game, rig, graphics driver and Windows build its newest session recorded, and
//     per tested change whether its Trial ran under the same driver and Windows build.
//
// TRUTHFUL COMPLETION (review 2026-10-26, ENGINE §7 and §10). A judged Trial is an ATTEMPT; only a
// MEASURED verdict (improved / no-change / regressed) is a RESULT. The summary keeps them apart:
//   - inconclusive: the change's newest judged Trial carries any other verdict (too-noisy, confounded,
//     not-comparable, expired, insufficient-evidence…). It was tried, nothing was learned;
//   - stale: a measured result whose Trial ran under a different graphics driver or Windows build
//     than the game's newest session (`sameContext === false`). It was a result; it may not hold now;
//   - retest: an inconclusive or stale change the picker still offers (`passes`), so it can be run
//     again, except an inconclusive one already judged inconclusive `RETEST_CAP` times in a row (§7:
//     repeatability is insufficient, stop). Those are `unjudged`: tried, and this PC can't judge them;
//   - unknown context stays unknown: a Trial or session that recorded no driver/build is never stale.
// "Compy finished the supported tests" is said only when the picker's list was read, nothing on it is
// untested, and nothing is worth another run. Exhausting the picker's list is a bounded claim about
// the changes Compy lists for this PC, never "everything that could matter".
//
// P5-learned (ROADMAP Phase 5 step 8, Constitution §13–14, ENGINE §8): the end-of-journey summary
// also says what was kept, what was put back and why (the record's own `kept` and verdict), and at
// most ONE lesson drawn from this PC's numbers. The lesson comes only from a fixed rule table over
// stored verdicts and deltas; it never names a cause, and when no rule applies there is no lesson.
//
// LESSON RULES. b = the noise band the Trial was judged on (`noise_evidence.band_pct`); L = the
// stored 1% low %-delta (`treatment.delta_low1_pct`); A = the stored average %-delta
// (`treatment.delta_avg_pct`, null = the average wasn't compared). Each delta reads "up" when > +b,
// "down" when < -b, otherwise "flat" (within the band). A measured rule applies only to a Trial whose
// verdict is improved, no-change or regressed and that recorded both b and L:
//   L up,   A flat    -> steadier-not-faster       ("1% lows rose, average barely moved")
//   L up,   A up      -> faster-and-steadier
//   L flat, A up      -> faster-not-steadier
//   L up,   A down    -> steadier-but-slower
//   L down, A up      -> faster-but-less-steady
//   L down, A flat    -> less-steady-not-slower
//   L down, A down    -> slower-and-less-steady
//   L flat, A down    -> slower-not-less-steady
//   L up,   A unknown -> steadier                  (average not compared)
//   L down, A unknown -> less-steady               (average not compared)
//   (L flat with A flat or unknown: no rule; that is the verdict itself, not a lesson)
// The too-noisy rule: the newest Trial of a change is "too-noisy" -> too-noisy ("this game swings a lot
// between sessions on your PC; Compy needs steadier sessions to judge").
// Order: the measured rules over the tested changes newest Trial first, then the too-noisy rule. The
// first match is the lesson; it carries that verdict's own confidence band, never a number.

import type { SessionSummary } from "../types";

export type SummaryConfidence = "unknown" | "low" | "medium" | "high";

export type SummaryNoise = {
  band_pct: number;
  measured_noise_pct: number | null;
  measured_noise_stale?: "changed" | "unconfirmed" | null;
  between_sessions?: { spread_pct: number; sessions: number } | null;
};

/** The experiment fields the summary reads (experiment.rs `ExperimentRecord`). */
export type SummaryExperiment = {
  id: string;
  rec_id: string;
  rec_title: string;
  game: string;
  created_at: string;
  verdict: string | null;
  kept: boolean;
  concluded_at: string | null;
  verdict_confidence?: SummaryConfidence | null;
  noise_evidence?: SummaryNoise | null;
  baseline_session_id?: string | null;
  /** The stored after-session deltas. null while running and on records that never measured one. */
  treatment?: { delta_low1_pct: number; delta_avg_pct?: number | null } | null;
  /** The outcome the Trial was judged for. Absent on older records, which were judged as Recommended. */
  outcome?: "recommended" | "max-fps" | "smoothest" | null;
};

/** The Trial picker fields the summary reads (trial_candidates.rs `TrialCandidate`). */
export type SummaryCandidate = {
  id: string;
  title: string;
  passes: boolean;
  reason: string | null;
  detail: string | null;
  position?: number | null;
  too_small?: { effect_pct: number; band_pct: number } | null;
};

export type StillApplied = "on" | "cant-confirm" | "off" | "set-not-by-compy" | "gaming-mode" | "unknown";

/** What the picker's live answer for a tested change says about it being applied now. */
export function stillAppliedFrom(c: SummaryCandidate | undefined): StillApplied {
  if (!c) return "unknown";
  if (c.passes) return "off";
  switch (c.reason) {
    case "already-set-by-compy":
      return "on";
    case "already-set-unconfirmed":
      return "cant-confirm";
    case "already-set":
      return "set-not-by-compy";
    case "already-set-by-gaming-mode":
    case "already-set-by-gaming-mode-restore-unfinished":
      return "gaming-mode";
    // Too small to measure is judged only on a change that isn't set, as passing is.
    case "too-small-to-measure-here":
      return "off";
    default:
      return "unknown"; // couldn't check, not for this PC, no safe apply, a reason this build doesn't know
  }
}

export type TestedChange = {
  recId: string;
  title: string;
  verdict: string;
  /** The newest judged Trial reached a measured verdict (improved / no-change / regressed). */
  measured: boolean;
  /** Judged Trials of this change, newest first, that were inconclusive before a measured one (0 when
   *  the newest is measured). `RETEST_CAP` of them in a row and this PC stops offering another run. */
  inconclusiveRuns: number;
  kept: boolean;
  confidence: SummaryConfidence | null;
  stillApplied: StillApplied;
  /** The band the newest judged Trial was judged on. null when its verdict never reached the band. */
  noise: SummaryNoise | null;
  /** How many judged Trials of this change on this game. */
  trials: number;
  /** Its Trial's baseline ran under the same graphics driver and Windows build as the newest session.
   *  null when either side didn't record them. Derived from `context`. */
  sameContext: boolean | null;
  /** The three-way class behind `sameContext` (GPU, driver, Windows build). */
  context: ContextMatch;
  /** The newest judged Trial's stored deltas (null when it recorded none) and when it started. */
  deltaLow1Pct: number | null;
  deltaAvgPct: number | null;
  at: string;
};

export type LessonRule =
  | "steadier-not-faster"
  | "faster-and-steadier"
  | "faster-not-steadier"
  | "steadier-but-slower"
  | "faster-but-less-steady"
  | "less-steady-not-slower"
  | "slower-and-less-steady"
  | "slower-not-less-steady"
  | "steadier"
  | "less-steady"
  | "too-noisy";

type Dir = "up" | "flat" | "down";

/** The measured rules, keyed `${L}/${A}` (A "unknown" = the average wasn't compared). */
export const LESSON_RULES: Readonly<Record<string, LessonRule>> = {
  "up/flat": "steadier-not-faster",
  "up/up": "faster-and-steadier",
  "flat/up": "faster-not-steadier",
  "up/down": "steadier-but-slower",
  "down/up": "faster-but-less-steady",
  "down/flat": "less-steady-not-slower",
  "down/down": "slower-and-less-steady",
  "flat/down": "slower-not-less-steady",
  "up/unknown": "steadier",
  "down/unknown": "less-steady",
};

const MEASURED_VERDICTS = new Set(["improved", "no-change", "regressed"]);

/** A verdict that is a RESULT (the Trial compared before and after beyond its band), as opposed to
 *  an attempt that judged nothing (too-noisy, confounded, not-comparable, expired, insufficient…). */
export const isMeasuredVerdict = (verdict: string | null | undefined): boolean =>
  verdict != null && MEASURED_VERDICTS.has(verdict);

/** Inconclusive attempts in a row on one change before Compy stops offering another run (ENGINE §7:
 *  benchmark repeatability is insufficient; stopping early is success). The picker still allows
 *  testing it by hand. */
export const RETEST_CAP = 2;

/** Why a change is offered another run. */
export type RetestReason = "inconclusive" | "stale";

export type Lesson = {
  rule: LessonRule;
  /** The change whose Trial the lesson is drawn from. */
  recId: string;
  title: string;
  confidence: SummaryConfidence | null;
  /** The numbers the rule read (null for too-noisy, which reads only the verdict). */
  low1Pct: number | null;
  avgPct: number | null;
  bandPct: number | null;
};

const dirOf = (v: number, band: number): Dir => (v > band ? "up" : v < -band ? "down" : "flat");

/** The one lesson for these tested changes, by the rule table above; null when no rule applies. */
export function lessonFor(tested: readonly TestedChange[]): Lesson | null {
  const newest = [...tested].sort((a, b) => time(b.at) - time(a.at));
  for (const r of newest) {
    const band = r.noise?.band_pct;
    if (!MEASURED_VERDICTS.has(r.verdict) || band == null || r.deltaLow1Pct == null) continue;
    const key = `${dirOf(r.deltaLow1Pct, band)}/${r.deltaAvgPct == null ? "unknown" : dirOf(r.deltaAvgPct, band)}`;
    const rule = LESSON_RULES[key];
    if (rule)
      return {
        rule,
        recId: r.recId,
        title: r.title,
        confidence: r.confidence,
        low1Pct: r.deltaLow1Pct,
        avgPct: r.deltaAvgPct,
        bandPct: band,
      };
  }
  const noisy = newest.find((r) => r.verdict === "too-noisy");
  return noisy
    ? { rule: "too-noisy", recId: noisy.recId, title: noisy.title, confidence: noisy.confidence, low1Pct: null, avgPct: null, bandPct: null }
    : null;
}

export type SummaryContext = {
  gpu: string | null;
  driver: string | null;
  windowsBuild: string | null;
  display: string | null;
};

export type GameTestSummary = {
  game: string;
  tested: TestedChange[];
  /** "finished-supported-tests" only when the picker's list was read, nothing on it is untested here,
   *  nothing is worth another run, and at least one change has a measured result whose context still
   *  matches; "worth-retesting" when nothing is untested but a result is inconclusive or stale;
   *  "nothing-testable-now" when nothing is untested or worth another run but nothing was measured
   *  (every attempt judged nothing); "results-unverified" when nothing is left but at least one
   *  measured result can't be tied to this PC as it is now (its Trial or the newest session recorded
   *  no driver or build): Compy has nothing to do next, and says what it has without claiming a
   *  current measurement (follow-up §2, §3). */
  headline: "finished-supported-tests" | "still-worth-testing" | "worth-retesting" | "results-unverified" | "nothing-testable-now" | "unknown";
  /** Measured results whose context is unverified (neither matching nor changed). */
  unverified: TestedChange[];
  /** Changes the picker offers that have no judged Trial on this game, in its suggested order. */
  leftToTest: SummaryCandidate[];
  /** Tested changes worth another run: inconclusive (under `RETEST_CAP`) or stale, and still offered
   *  by the picker. In the picker's order. */
  retest: TestedChange[];
  /** Tested changes whose newest judged Trial reached no measured verdict. */
  inconclusive: TestedChange[];
  /** Inconclusive changes judged inconclusive `RETEST_CAP` times in a row: this PC can't judge them. */
  unjudged: TestedChange[];
  /** Measured results whose Trial ran under a different driver or Windows build than now. */
  stale: TestedChange[];
  /** Stale results the picker no longer offers (the change is set now): testing again means putting
   *  it back first. Said apart, so a stale kept result is never a silent dead end. */
  staleKept: TestedChange[];
  /** Changes the picker leaves out, each with its reason. Empty when the list couldn't be read. */
  skipped: SummaryCandidate[];
  /** Tested changes whose live check reads On now. */
  staysApplied: TestedChange[];
  /** Tested changes Compy applied whose live check can't be read now. */
  cantConfirm: TestedChange[];
  context: SummaryContext | null;
  /** P5-learned: tested changes whose newest Trial kept them, and those it put back (each with its
   *  verdict as the why), in first-tested order. */
  kept: TestedChange[];
  putBack: TestedChange[];
  /** At most one lesson from this PC's numbers (`lessonFor`); null when no rule applies. */
  lesson: Lesson | null;
};

const time = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/** When a judged Trial was judged (ms): its `concluded_at`, else its `created_at`; -Infinity when
 *  neither parses. The ONE comparator for "newest judged Trial" (test-summary and journey-resume). */
export const judgedAt = (x: { concluded_at?: string | null; created_at?: string | null }): number =>
  time(x.concluded_at ?? x.created_at);

const text = (s: string | null | undefined): string | null => (s && s.trim() !== "" ? s : null);

function contextOf(s: SessionSummary | undefined): SummaryContext | null {
  if (!s) return null;
  const hw = s.hw_fingerprint ?? null;
  const ctx = {
    gpu: text(hw?.gpu),
    driver: text(hw?.gpu_driver ?? s.game_state?.gpu_driver),
    windowsBuild: text(s.game_state?.windows_build),
    display: text(hw?.display),
  };
  return Object.values(ctx).some((v) => v != null) ? ctx : null;
}

/** How a Trial's context (§9: GPU, graphics driver, Windows build) relates to the game's newest
 *  session (review 2026-10-26 follow-up §2: three classes, never two):
 *  - "matching": every part both sides recorded is the same, and both recorded at least the driver
 *    and the Windows build;
 *  - "changed": some part both sides recorded differs (a different GPU with the same driver is
 *    changed, not matching);
 *  - "unverified": a side recorded too little to compare. Unverified is not stale, but it is not
 *    proof that an old result applies now either, and nothing is "finished" on it. */
export type ContextMatch = "matching" | "changed" | "unverified";

/** The context (§9) of `game`'s newest session that recorded one, and the ONE classifier every
 *  reader of a Trial's context uses: the summary, the journey, the as-is reuse and the outcome
 *  switch (follow-up §1: one definition of evidence validity). Pure. */
export function contextCheckFor(
  game: string,
  sessions: readonly SessionSummary[],
): {
  context: SummaryContext | null;
  /** The class of a Trial's baseline session against the game's newest. */
  matchOf: (baselineSessionId: string | null | undefined) => ContextMatch;
  /** `matchOf` as a tri-state: true matching, false changed, null unverified. */
  sameContext: (baselineSessionId: string | null | undefined) => boolean | null;
} {
  const ofGame = sessions
    .filter((s) => s.process_name === game)
    .sort((a, b) => time(b.started_at) - time(a.started_at));
  const context = contextOf(ofGame.find((s) => contextOf(s) != null));
  const matchOf = (baselineSessionId: string | null | undefined): ContextMatch => {
    const then = contextOf(sessions.find((s) => s.started_at === baselineSessionId));
    if (!then || !context) return "unverified";
    // Any part both sides recorded that differs: changed. GPU included.
    for (const k of ["gpu", "driver", "windowsBuild"] as const) {
      if (then[k] != null && context[k] != null && then[k] !== context[k]) return "changed";
    }
    // Matching needs at least the driver and the Windows build on both sides.
    return then.driver && then.windowsBuild && context.driver && context.windowsBuild ? "matching" : "unverified";
  };
  return {
    context,
    matchOf,
    sameContext: (id) => {
      const m = matchOf(id);
      return m === "unverified" ? null : m === "matching";
    },
  };
}

/** How many judged Trials of one change, newest first, judged nothing before one that did, counting
 *  only attempts whose context is not "changed" against now (follow-up §2: old attempts under a
 *  different driver, build or GPU don't exhaust the retest cap; an unverified one still counts, since
 *  nothing says it differed). `matchOf` absent = count every attempt. */
export function inconclusiveRunsOf(
  judgedOldestFirst: readonly { verdict: string | null; baseline_session_id?: string | null }[],
  matchOf?: (baselineSessionId: string | null | undefined) => ContextMatch,
): number {
  let n = 0;
  for (let i = judgedOldestFirst.length - 1; i >= 0 && !isMeasuredVerdict(judgedOldestFirst[i].verdict); i--) {
    if (matchOf && matchOf(judgedOldestFirst[i].baseline_session_id) === "changed") continue;
    n++;
  }
  return n;
}

/**
 * The summary for `game`, or null when it has no judged Trial (there is nothing to summarise yet).
 * `candidates` null = the picker's list couldn't be read.
 */
export function summarizeGame(
  game: string,
  experiments: readonly SummaryExperiment[],
  candidates: readonly SummaryCandidate[] | null,
  sessions: readonly SessionSummary[],
): GameTestSummary | null {
  const judged = experiments.filter((x) => x.game === game && x.verdict != null);
  if (judged.length === 0) return null;

  const stillApplied = (recId: string): StillApplied => stillAppliedFrom(candidates?.find((c) => c.id === recId));

  const { context, matchOf, sameContext } = contextCheckFor(game, sessions);

  // One row per change, from its newest judged Trial (`judgedAt` order), in first-judged order.
  const byRec = new Map<string, SummaryExperiment[]>();
  for (const x of [...judged].sort((a, b) => judgedAt(a) - judgedAt(b))) {
    byRec.set(x.rec_id, [...(byRec.get(x.rec_id) ?? []), x]);
  }
  const tested: TestedChange[] = [...byRec.values()].map((runs) => {
    const x = runs[runs.length - 1];
    return {
      recId: x.rec_id,
      title: x.rec_title,
      verdict: x.verdict as string,
      measured: isMeasuredVerdict(x.verdict),
      inconclusiveRuns: inconclusiveRunsOf(runs, matchOf),
      kept: x.kept,
      confidence: x.verdict_confidence ?? null,
      stillApplied: stillApplied(x.rec_id),
      noise: x.noise_evidence ?? null,
      trials: runs.length,
      sameContext: sameContext(x.baseline_session_id),
      context: matchOf(x.baseline_session_id),
      deltaLow1Pct: x.treatment?.delta_low1_pct ?? null,
      deltaAvgPct: x.treatment?.delta_avg_pct ?? null,
      at: x.created_at,
    };
  });

  const testedIds = new Set(tested.map((r) => r.recId));
  const inPickerOrder = (cs: SummaryCandidate[]) =>
    cs
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (a.c.position ?? Infinity) - (b.c.position ?? Infinity) || a.i - b.i)
      .map(({ c }) => c);
  const leftToTest = inPickerOrder((candidates ?? []).filter((c) => c.passes && !testedIds.has(c.id)));
  // A tested change the picker now leaves out (a kept change reads "already set") is listed as tested.
  const skipped = (candidates ?? []).filter((c) => !c.passes && !testedIds.has(c.id));

  const inconclusive = tested.filter((r) => !r.measured);
  const unjudged = inconclusive.filter((r) => r.inconclusiveRuns >= RETEST_CAP);
  const stale = tested.filter((r) => r.measured && r.sameContext === false);
  const retestIds = new Set([...inconclusive.filter((r) => r.inconclusiveRuns < RETEST_CAP), ...stale].map((r) => r.recId));
  const retest = inPickerOrder((candidates ?? []).filter((c) => c.passes && retestIds.has(c.id)))
    .map((c) => tested.find((r) => r.recId === c.id))
    .filter((r): r is TestedChange => r != null);
  const staleKept = stale.filter((r) => !retest.some((x) => x.recId === r.recId));
  const holds = tested.filter((r) => r.measured && r.context === "matching");
  const unverified = tested.filter((r) => r.measured && r.context === "unverified");

  return {
    game,
    tested,
    headline:
      candidates == null
        ? "unknown"
        : leftToTest.length > 0
          ? "still-worth-testing"
          : retest.length > 0 || stale.length > 0
            ? "worth-retesting"
            : unverified.length > 0
              ? "results-unverified"
              : holds.length > 0
                ? "finished-supported-tests"
                : "nothing-testable-now",
    leftToTest,
    retest,
    inconclusive,
    unjudged,
    stale,
    staleKept,
    unverified,
    skipped,
    staysApplied: tested.filter((r) => r.stillApplied === "on"),
    cantConfirm: tested.filter((r) => r.stillApplied === "cant-confirm"),
    context,
    kept: tested.filter((r) => r.kept),
    putBack: tested.filter((r) => !r.kept),
    lesson: lessonFor(tested),
  };
}

// P5-outcomes (ROADMAP Phase 5 step 6, ENGINE §5–6): when one change on one game has both a
// Recommended and a Maximum FPS result and they disagree on keeping it, the user may pick which one
// stands. READ-ONLY here: this only derives the choice; acting on it is the bench's, through the
// existing audited apply and undo commands.
//
//   - a result is the newest Trial of that change on that game judged for that outcome with a
//     measured verdict (improved / no-change / regressed), its noise band and its stored 1% low
//     delta. A too-noisy, confounded or otherwise unjudged Trial is not a result;
//   - the two results differ only when exactly one of them judged the change Better (`improved`, the
//     §9 keep rule). Both Better, or neither, agree: no choice. One result alone: no choice;
//   - the keep side always names the Trial that judged it Better under that outcome; there is no
//     keep side without one;
//   - which side is in effect comes from the Trial picker's live answer (`stillAppliedFrom`): on =
//     the keep side, off = the other. Anything else is unknown and nothing offers to switch;
//   - ENGINE §6, the default wins ties: an agreeing pair, or a result inside the band, keeps the
//     default the Trials already chose. Nothing here reopens a tie;
//   - follow-up review 2026-10-26 §1: a keep side whose Trial ran under a changed context (GPU,
//     driver or Windows build) is `keepStale`: the trade stays visible as history, but it is not
//     offered as current proof to re-apply the change. One validity rule, the summary's.

export type ResultOutcome = "recommended" | "max-fps";

/** Why a result kept or put back the change, in the words of its own outcome's rule. */
export type ResultReason = "low-up" | "avg-up" | "low-fell" | "avg-fell" | "low-flat" | "avg-flat" | "avg-unknown";

export type OutcomeResult = {
  outcome: ResultOutcome;
  /** The Trial (experiment record id) this result comes from. */
  trialId: string;
  /** It judged the change Better under this outcome. */
  keeps: boolean;
  reason: ResultReason;
  /** The delta the reason names (null only for avg-unknown). */
  pct: number | null;
};

export type OutcomeChoice = {
  recId: string;
  title: string;
  recommended: OutcomeResult;
  maxFps: OutcomeResult;
  /** The side that keeps the change, and the Trial that judged it Better under that outcome. */
  keepOutcome: ResultOutcome;
  keepTrialId: string;
  /** The keep Trial's context against the game's newest session (`contextCheckFor`). */
  keepContext: ContextMatch;
  /** The keep Trial's context is not known to match now (changed, or unverified): shown as
   *  history, never offered as proof to re-apply the change (review follow-up §1, round 2: the
   *  same rule the summary's "finished" uses, matching only). */
  keepStale: boolean;
  /** Which side is in effect now; null when the live check can't tell. */
  inEffect: ResultOutcome | null;
};

const outcomeOf = (x: SummaryExperiment): ResultOutcome => (x.outcome === "max-fps" ? "max-fps" : "recommended");

/** The reason a measured Trial gives, by its outcome's own rule (experiment.rs
 *  `with_recommended_outcome` / `with_max_fps_outcome`). */
function resultOf(x: SummaryExperiment): OutcomeResult | null {
  const band = x.noise_evidence?.band_pct;
  const low = x.treatment?.delta_low1_pct;
  if (!x.verdict || !MEASURED_VERDICTS.has(x.verdict) || band == null || low == null) return null;
  const avg = x.treatment?.delta_avg_pct ?? null;
  const outcome = outcomeOf(x);
  const keeps = x.verdict === "improved";
  const r = (reason: ResultReason, pct: number | null): OutcomeResult => ({ outcome, trialId: x.id, keeps, reason, pct });
  if (outcome === "recommended") {
    if (keeps) return r("low-up", low);
    if (x.verdict === "regressed") return r("low-fell", low);
    if (low > band && avg == null) return r("avg-unknown", null);
    if (low > band && avg != null && avg < -band) return r("avg-fell", avg);
    return r("low-flat", low);
  }
  if (keeps) return avg == null ? null : r("avg-up", avg);
  if (x.verdict === "regressed") return avg != null && avg < -band ? r("avg-fell", avg) : r("low-fell", low);
  return avg == null ? r("avg-unknown", null) : r("avg-flat", avg);
}

/** The changes on `game` whose Recommended and Maximum FPS results disagree, in first-tested order.
 *  `candidates` null = the picker's list couldn't be read (nothing is then known to be in effect). */
export function outcomeChoices(
  game: string,
  experiments: readonly SummaryExperiment[],
  candidates: readonly SummaryCandidate[] | null,
  sessions: readonly SessionSummary[] = [],
): OutcomeChoice[] {
  const { matchOf } = contextCheckFor(game, sessions);
  const baselineOf = new Map(experiments.map((x) => [x.id, x.baseline_session_id ?? null]));
  const newest = new Map<string, { title: string; first: number; recommended?: OutcomeResult; "max-fps"?: OutcomeResult; at: Record<string, number> }>();
  for (const x of experiments) {
    if (x.game !== game) continue;
    const res = resultOf(x);
    if (!res) continue;
    const at = time(x.created_at);
    const row = newest.get(x.rec_id) ?? { title: x.rec_title, first: at, at: {} };
    row.first = Math.min(row.first, at);
    if (row[res.outcome] == null || at > row.at[res.outcome]) {
      row[res.outcome] = res;
      row.at[res.outcome] = at;
      row.title = x.rec_title;
    }
    newest.set(x.rec_id, row);
  }
  const out: { first: number; choice: OutcomeChoice }[] = [];
  for (const [recId, row] of newest) {
    const rec = row.recommended;
    const max = row["max-fps"];
    if (!rec || !max || rec.keeps === max.keeps) continue;
    const keep = rec.keeps ? rec : max;
    const other = rec.keeps ? max : rec;
    const live = stillAppliedFrom(candidates?.find((c) => c.id === recId));
    const keepContext = matchOf(baselineOf.get(keep.trialId));
    out.push({ first: row.first, choice: {
      recId,
      title: row.title,
      recommended: rec,
      maxFps: max,
      keepOutcome: keep.outcome,
      keepTrialId: keep.trialId,
      keepContext,
      keepStale: keepContext !== "matching",
      inEffect: live === "on" ? keep.outcome : live === "off" ? other.outcome : null,
    } });
  }
  return out.sort((a, b) => a.first - b.first).map((o) => o.choice);
}
