// THE INTERVIEW (design foundation step ③, docs/decisions/2026-08-11-design-foundation.md decision
// 2, issue #177). Pure taxonomy + finding derivation — no DOM, no state, no IPC.
//
// WHY THIS EXISTS. UX-1 (step ②) made the front door a verdict plus ONE button, and behind that
// button sat a flat panel: five choices, a fast-path row, all on one screen. That is a menu. The
// owner's escalation of 2026-08-11 was that non-technical testers find Compy "overwhelming, hard to
// navigate, completely unfamiliar", and a menu of five unfamiliar choices is the thing being
// described. Decision 2 answers it with a shape everyone already knows from tax software and
// insurance claims: ONE question per screen, answers in the words a person would actually say,
// "I am not sure" as a real answer, and a finding at the end rather than a hand-off.
//
// THE FOUR LAWS THIS MODULE IS BUILT TO OBEY, each pinned by home-interview-data.test.ts:
//
//   1. NO DEAD END. Every choice on every screen resolves to another question or a finding, and
//      every finding carries exactly one action that is reachable on THIS rail right now. The
//      not-sure answer is first-class on every screen, never a shrug that ends the conversation.
//   2. NEVER CLAIM UNMEASURED (honest-measurement law, CLAUDE.md). The level chip is DERIVED from
//      the evidence, never asserted: no evidence means the chip says so and the action is a way to
//      go and measure it. `level === "unknown"` if and only if `evidence` is empty.
//   3. EVIDENCE IS QUOTED, NEVER SYNTHESISED. Every evidence line traces to a fact the caller
//      measured (the live rec catalog, the Trust Ledger, a recorded session, the readiness checks,
//      the GPU sensor poll). A missing reading drops its line — it never becomes a zero or a guess.
//   4. A MUTATING ACTION STATES ITS UNDO. Any action that changes Windows carries the rollback
//      promise on the card, in front of the user, not buried in the confirm dialog.
//
// i18n note: a plain data module cannot call useTranslation(), so `t` is threaded as the LAST
// parameter — the same idiom as home-intake-data.ts, lab-guided-data.ts and ago()/smoothness().

import type { TFunction } from "i18next";
import type { LabStationKey } from "./lab-guided-data";
import type { HomeIntakeRoom } from "./home-intake-data";
import { knownFps } from "../lib/session-metrics";
import { readIntelligence } from "../design/theme";
import { confidenceWordKey, wordFromFinding } from "../data/confidence-word";

// ── The question tree ───────────────────────────────────────────────────────────────────────────

export type InterviewQuestionId = "start" | "crash" | "slow";

export type InterviewFindingId =
  | "sweep"
  // The GOAL half (owner direction 2026-08-26). Everything above this line assumes something is
  // wrong; these four assume nothing at all. See the note on `group` below for why they exist.
  | "wantFps"
  | "wantMonitor"
  | "wantScores"
  | "wantSpecs"
  | "crashInGame"
  | "crashAnytime"
  | "crashBoot"
  | "crashUnsure"
  | "slowAlways"
  | "slowSometimes"
  | "stutter"
  | "slowUnsure"
  | "heat"
  | "didItHelp";

/**
 * Every finding the tree can reach. Written once, here, so a sweep (a guard, an affordance census,
 * a copy audit) can enumerate the whole set without hand-listing it and going stale on the next
 * branch. `interviewQuestions` is the only thing that ROUTES to them; this is the census.
 */
export const INTERVIEW_FINDINGS: InterviewFindingId[] = [
  "sweep",
  "wantFps",
  "wantMonitor",
  "wantScores",
  "wantSpecs",
  "crashInGame",
  "crashAnytime",
  "crashBoot",
  "crashUnsure",
  "slowAlways",
  "slowSometimes",
  "stutter",
  "slowUnsure",
  "heat",
  "didItHelp",
];

/** Where an answer goes. There is no third case on purpose — see law 1. */
export type InterviewStep =
  | { kind: "question"; id: InterviewQuestionId }
  | { kind: "finding"; id: InterviewFindingId };

export type InterviewChoice = {
  /** Stable id — used for React keys and by the tests, never shown. */
  id: string;
  /** The user's own spoken words. Never a feature name, never a room name. */
  label: string;
  next: InterviewStep;
  /** The not-sure answer for this screen. Exactly one per screen (law 1). */
  unsure?: boolean;
  /**
   * ONE PLAIN ELABORATION, owned by the choice itself. 01-health-approved.png draws Home's
   * three shortcut cards as a title plus a grey line — "It crashed or froze" over "A game
   * or Windows closed unexpectedly." — and the owner ruled the comps exact (2026-08-23).
   * It lives HERE, beside the label, and not in Home's own copy, for the same reason the
   * label already lives here: Home renders the interview's wording verbatim so a shortcut
   * and the question it jumps to can never drift apart. Optional, because only the answers
   * a surface shows as a CARD need one — the interview's own screens render the label alone.
   */
  hint?: string;
  /**
   * WHICH HALF OF THE FRONT DOOR THIS ANSWER BELONGS TO (owner direction 2026-08-26):
   *
   *   "wrong" — something is broken, slow, hot, or was changed. Every answer this tree had until
   *             today, and the reason a distressed user opens Compy.
   *   "goal"  — nothing is wrong and the user still wants something. "I want more FPS", "I want to
   *             watch my FPS while I play", "I want to see my scores", "I want to know what is in
   *             this PC."
   *
   * His words: *"the home page options all seem to only point towards some sort of issue which
   * shouldnt be the only reason people are here in the first place"*, and: offering help should
   * only lead *"if there an indicator that something was detected from your pc"*. Compy's second
   * specialty is optimization, and a front door built only out of symptoms tells a user with a
   * healthy PC that they are in the wrong place — or worse, implies a problem Compy never measured,
   * which is the honest-measurement law failing in the other direction.
   *
   * Undefined = ungrouped, and exactly one answer is (the not-sure answer, which belongs to
   * neither half and stays last). `home-interview-data.test.ts` pins that BOTH halves are
   * non-empty, so a future trim cannot quietly return this screen to symptoms-only.
   */
  group?: "wrong" | "goal";
};

export type InterviewQuestion = {
  id: InterviewQuestionId;
  /** One question. Short enough to read in one breath. */
  question: string;
  choices: InterviewChoice[];
};

export const INTERVIEW_ROOT: InterviewQuestionId = "start";

export function interviewQuestions(t: TFunction): Record<InterviewQuestionId, InterviewQuestion> {
  const k = (s: string) => t(`home.interview.q.${s}`);
  return {
    start: {
      id: "start",
      question: k("start.question"),
      choices: [
        {
          id: "crash",
          label: k("start.crash"),
          hint: k("start.crashHint"),
          next: { kind: "question", id: "crash" },
          group: "wrong",
        },
        {
          id: "slow",
          label: k("start.slow"),
          hint: k("start.slowHint"),
          next: { kind: "question", id: "slow" },
          group: "wrong",
        },
        {
          id: "heat",
          label: k("start.heat"),
          hint: k("start.heatHint"),
          next: { kind: "finding", id: "heat" },
          group: "wrong",
        },
        {
          id: "changed",
          label: k("start.changed"),
          hint: k("start.changedHint"),
          next: { kind: "finding", id: "didItHelp" },
          group: "wrong",
        },
        // The GOAL half. These are not milder symptoms — they are the reasons someone whose PC is
        // working perfectly opens an optimizer, and until today this screen had none of them.
        {
          id: "moreFps",
          label: k("start.moreFps"),
          hint: k("start.moreFpsHint"),
          next: { kind: "finding", id: "wantFps" },
          group: "goal",
        },
        {
          id: "watchFps",
          label: k("start.watchFps"),
          hint: k("start.watchFpsHint"),
          next: { kind: "finding", id: "wantMonitor" },
          group: "goal",
        },
        {
          id: "scores",
          label: k("start.scores"),
          hint: k("start.scoresHint"),
          next: { kind: "finding", id: "wantScores" },
          group: "goal",
        },
        {
          id: "specs",
          label: k("start.specs"),
          hint: k("start.specsHint"),
          next: { kind: "finding", id: "wantSpecs" },
          group: "goal",
        },
        // Ungrouped on purpose, and last: "I am not sure" is the answer for someone who cannot
        // place themselves in either half, so filing it under one of them would be a small lie.
        {
          id: "unsure",
          label: k("start.unsure"),
          hint: k("start.unsureHint"),
          next: { kind: "finding", id: "sweep" },
          unsure: true,
        },
      ],
    },
    crash: {
      id: "crash",
      question: k("crash.question"),
      choices: [
        { id: "inGame", label: k("crash.inGame"), next: { kind: "finding", id: "crashInGame" } },
        { id: "anytime", label: k("crash.anytime"), next: { kind: "finding", id: "crashAnytime" } },
        { id: "boot", label: k("crash.boot"), next: { kind: "finding", id: "crashBoot" } },
        {
          id: "unsure",
          label: k("crash.unsure"),
          next: { kind: "finding", id: "crashUnsure" },
          unsure: true,
        },
      ],
    },
    slow: {
      id: "slow",
      question: k("slow.question"),
      choices: [
        { id: "always", label: k("slow.always"), next: { kind: "finding", id: "slowAlways" } },
        {
          id: "sometimes",
          label: k("slow.sometimes"),
          next: { kind: "finding", id: "slowSometimes" },
        },
        { id: "stutter", label: k("slow.stutter"), next: { kind: "finding", id: "stutter" } },
        {
          id: "unsure",
          label: k("slow.unsure"),
          next: { kind: "finding", id: "slowUnsure" },
          unsure: true,
        },
      ],
    },
  };
}

/**
 * The start screen's answers, split into the two halves a reader can actually scan (owner
 * direction 2026-08-26). Nine answers in one flat list is the "menu of unfamiliar choices" the
 * interview was built to replace; the same nine under two short headings is a structure, and
 * DIR-1 names grouping as the sanctioned remedy for exactly this ("intimidation is a STRUCTURE
 * defect — grouping, boxed templates, fewer words; NEVER a switch and never hiding").
 *
 * Order is preserved, empty groups drop out, and the ungrouped remainder (the not-sure answer)
 * always comes last with no heading. Lives here rather than in the component because which half
 * an answer belongs to is taxonomy, and the component that renders it is not the only one that
 * reads it — Home's shortcut cards pick from the same halves.
 */
export type InterviewChoiceGroup = {
  id: "wrong" | "goal" | "other";
  /** Null for the ungrouped remainder — a heading over one answer is noise, not structure. */
  heading: string | null;
  choices: InterviewChoice[];
};

export function groupChoices(choices: InterviewChoice[], t: TFunction): InterviewChoiceGroup[] {
  const pick = (g: InterviewChoice["group"] | undefined) =>
    choices.filter((c) => c.group === g);
  const groups: InterviewChoiceGroup[] = [
    { id: "wrong", heading: t("home.interview.q.start.groupWrong"), choices: pick("wrong") },
    { id: "goal", heading: t("home.interview.q.start.groupGoal"), choices: pick("goal") },
    { id: "other", heading: null, choices: pick(undefined) },
  ];
  return groups.filter((g) => g.choices.length > 0);
}

// ── P7-palette: the interview's answers as command-palette intents ─────────────────────────────
// ROADMAP P7 bullet 1, Constitution §27: typing a plain problem ("it stutters", "it crashed",
// "more fps", "what changed") lands on the SAME journey as answering the interview — the palette
// opens the interview at that finding's card, and the card's one action is the P7-route action.
// The palette never fires an action itself, so a mutating finding (the fast path) still shows its
// undo line and waits for the tap. The "not sure" answers are not intents: nobody types "not sure"
// to find them, and the interview's own question is the honest way to reach them.

/** One palette row per finding: the plain words someone would type for it. */
export type PaletteIntent = {
  finding: InterviewFindingId;
  /** The plain problem or wish, short ("It stutters", "More FPS"). */
  label: string;
  /** Other words the same person might type (synonyms, symptoms). */
  keywords: string[];
};

/** The findings the palette offers, in the order the interview's own tree reaches them. */
export const PALETTE_INTENT_FINDINGS: InterviewFindingId[] = [
  "wantFps",
  "stutter",
  "slowSometimes",
  "slowAlways",
  "crashInGame",
  "crashAnytime",
  "crashBoot",
  "heat",
  "didItHelp",
  "wantMonitor",
  "wantScores",
  "wantSpecs",
  "sweep",
];

export function paletteIntents(t: TFunction): PaletteIntent[] {
  return PALETTE_INTENT_FINDINGS.map((finding) => ({
    finding,
    label: t(`home.interview.palette.${finding}.label`),
    keywords: String(t(`home.interview.palette.${finding}.keywords`))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  }));
}

/** The full interview path to a finding — root question, any question between, the finding —
 *  so a palette landing reads like an answered interview (breadcrumb and Back work as usual).
 *  null when the tree does not reach it (a guard would have to be wrong for that). */
export function pathToFinding(
  finding: InterviewFindingId,
  questions: Record<InterviewQuestionId, InterviewQuestion>,
): InterviewStep[] | null {
  const walk = (id: InterviewQuestionId, trail: InterviewStep[]): InterviewStep[] | null => {
    const here: InterviewStep[] = [...trail, { kind: "question", id }];
    for (const c of questions[id].choices) {
      if (c.next.kind === "finding") {
        if (c.next.id === finding) return [...here, c.next];
      } else if (!here.some((s) => s.kind === "question" && s.id === c.next.id)) {
        const deeper = walk(c.next.id, here);
        if (deeper) return deeper;
      }
    }
    return null;
  };
  return walk(INTERVIEW_ROOT, []);
}

// ── The live facts a finding is allowed to speak from ───────────────────────────────────────────
// Every field here is something the caller ALREADY holds. This module opens no new probe and adds
// no IPC; it is a different sentence over the same readings the room is already rendering.

export type InterviewFacts = {
  /** Has the rec catalog resolved? false while it is still loading or was never wired. */
  recsLoaded: boolean;
  /** safeFixesReadyList().length — the same allowlisted stack the Optimize verdict counts. */
  safeStackReady: number;
  /** Is the audited one-UAC batch primitive wired on this mount? */
  fastPathWired: boolean;
  /**
   * The Machine Model's in-effect count (`inEffectCounts(model).activeNow`, #452). null when the
   * model is not read yet or cannot read the ledger — an absence, never quoted as 0. Rows whose live
   * check failed are not in it.
   */
  activeChanges: number | null;
  /** How many monitored sessions are on record. */
  sessionCount: number;
  /**
   * The most recent recorded session, or null when there is none. Never a placeholder. A reading
   * the session did not measure is null (#671); its FPS is quoted only when both were measured.
   */
  lastSession: { game: string; avgFps: number | null; low1: number | null; peakTempC: number | null } | null;
  /** The readiness checks, or null while they are still running. */
  readiness: { passed: number; total: number; attention: number } | null;
  /** The live GPU temperature poll, or null when the sensor did not report. */
  gpuTempC: number | null;
  /** The rooms the rail ACTUALLY renders right now — the no-dead-end filter (law 1). */
  rooms: HomeIntakeRoom[];
  /**
   * P7-route: the Trial bench, read when the interview opens (`get_experiment_gate` +
   * `get_experiments`). `armed` is the bench's own gate — dark means no journey and no test
   * summary render, so nothing may route to them. `judged` counts changes with a measured result,
   * the records "What Compy tested" is built from; null = the records couldn't be read (follow-up
   * review 2026-10-26 §5: "couldn't read" is said as that, never as "nothing measured"). `armed`
   * null = even the gate didn't answer (round 3 §4): still "couldn't read", and it routes the way a
   * dark bench does, never to a panel that may not be there. Absent or null as a whole = not read at
   * all yet (the interview just opened): the same routing, and the unread wording.
   */
  trials?: { armed: boolean | null; judged: number | null } | null;
};

// ── The finding card ────────────────────────────────────────────────────────────────────────────

/**
 * The level chip. Three words, in descending strength, and the strength is EARNED:
 *  - `measured` — Compy has a reading that answers the question the user just asked.
 *  - `likely`   — Compy has related evidence that points somewhere, but has not measured this.
 *  - `unknown`  — Compy has nothing yet. The card says so and the action goes and measures.
 */
export type FindingLevel = "measured" | "likely" | "unknown";

export type InterviewAction =
  /** The audited one-tap safe stack. MUTATES — always carries `undo` (law 4). */
  | { kind: "fastpath"; label: string }
  /** Re-run the readiness check. Read-only. */
  | { kind: "check"; label: string }
  /** Land ON an instrument, never on a room's dock. `arrival` says what the user came with, for a
   *  station that answers it differently (P6-stutter: the Care view runs its session comparison;
   *  P7-route: "since" brings the Care view's "Since it last worked" into view). */
  | {
      kind: "station";
      label: string;
      station: LabStationKey;
      room: HomeIntakeRoom;
      arrival?: "stutter" | "since";
    }
  /** A whole room, when the room itself is the answer. P7-route: `arrival` names the panel of the
   *  Test room's overview that answers (the guided journey, or "What Compy tested"), see
   *  lab-arrival.ts. */
  | { kind: "room"; label: string; room: HomeIntakeRoom; arrival?: "journey" | "tested" };

export type InterviewFinding = {
  id: InterviewFindingId;
  level: FindingLevel;
  /** The chip's word, translated. */
  levelLabel: string;
  /** One plain sentence. What Compy thinks is going on, in the user's language. */
  sentence: string;
  /** Measured lines only. Empty means level is "unknown" — see law 2. */
  evidence: string[];
  action: InterviewAction;
  /** The rollback promise. Present exactly when the action changes Windows (law 4). */
  undo?: string;
};

/** Rooms are only offered when the live rail renders them (law 1). */
const reachable = (room: HomeIntakeRoom, facts: InterviewFacts) => facts.rooms.includes(room);

export function interviewFinding(
  id: InterviewFindingId,
  facts: InterviewFacts,
  t: TFunction,
): InterviewFinding {
  const k = (s: string, o?: Record<string, unknown>) => t(`home.interview.f.${s}`, o ?? {});
  const ev: string[] = [];

  // Evidence lines shared by several findings. Each one is a quoted reading or it is absent.
  const stackLine = () => {
    if (!facts.recsLoaded) return;
    ev.push(
      facts.safeStackReady > 0
        ? k("ev.stackReady", { count: facts.safeStackReady })
        : k("ev.stackClear"),
    );
  };
  const changesLine = () => {
    if (facts.activeChanges != null && facts.activeChanges > 0)
      ev.push(k("ev.changes", { count: facts.activeChanges }));
  };
  const readinessLine = () => {
    if (facts.readiness)
      ev.push(k("ev.readiness", { passed: facts.readiness.passed, total: facts.readiness.total }));
  };
  // An unmeasured FPS is no FPS evidence: it quotes no number and earns no `measured` chip (#671).
  // The session itself still counts, so its peak temperature stays quotable in gpuTempLine.
  const avgFps = knownFps(facts.lastSession?.avgFps);
  const low1 = knownFps(facts.lastSession?.low1);
  const fpsSession =
    facts.lastSession && avgFps != null && low1 != null ? { game: facts.lastSession.game, avgFps, low1 } : null;
  const sessionLine = () => {
    if (fpsSession)
      ev.push(
        k("ev.lastSession", {
          game: fpsSession.game,
          avg: Math.round(fpsSession.avgFps),
          low: Math.round(fpsSession.low1),
        }),
      );
  };
  // P7-route: only a judged Trial on an armed bench is a tested change; anything else is not quoted.
  // Follow-up review 2026-10-26 §5: a count that couldn't be read is UNKNOWN, kept apart from zero.
  const testedCount = facts.trials?.armed === true ? (facts.trials.judged ?? 0) : 0;
  // Round 3 §4: "records read" is tracked apart from "bench armed". Only a bench that positively read as
  // dark (armed: false) is a confirmed empty history; a failed gate check, a failed records read, or no
  // read at all are all "couldn't read".
  const testedUnknown = facts.trials == null || (facts.trials.armed !== false && facts.trials.judged == null);
  const benchArmed = facts.trials?.armed === true;
  const testedLine = () => {
    if (testedCount > 0) ev.push(k("ev.tested", { count: testedCount }));
  };
  const sessionCountLine = () => {
    if (facts.sessionCount > 0) ev.push(k("ev.sessionCount", { count: facts.sessionCount }));
  };
  const gpuTempLine = () => {
    if (facts.gpuTempC != null) ev.push(k("ev.gpuTemp", { temp: Math.round(facts.gpuTempC) }));
    if (facts.lastSession?.peakTempC != null)
      ev.push(k("ev.peakTemp", { temp: Math.round(facts.lastSession.peakTempC) }));
  };

  // The action that is ALWAYS available — no room, no rail, no wiring needed. Every branch below
  // falls back onto it rather than offering a door that is not there.
  const runCheck = (): InterviewAction => ({ kind: "check", label: k("act.check") });
  const fastPath = (): InterviewAction => ({
    kind: "fastpath",
    label: k("act.fastpath", { count: facts.safeStackReady }),
  });
  /** An instrument if the rail has its room, otherwise the always-there read-only fallback. */
  const station = (s: LabStationKey, room: HomeIntakeRoom, label: string): InterviewAction =>
    reachable(room, facts) ? { kind: "station", label, station: s, room } : runCheck();
  const roomDoor = (r: HomeIntakeRoom, label: string): InterviewAction =>
    reachable(r, facts) ? { kind: "room", label, room: r } : runCheck();

  /** The one-tap stack, but only when it is genuinely ready AND wired. Otherwise `alt`. */
  const fastPathOr = (alt: InterviewAction): InterviewAction =>
    facts.fastPathWired && facts.recsLoaded && facts.safeStackReady > 0 ? fastPath() : alt;

  let sentence: string;
  let action: InterviewAction;
  /** True when the evidence collected below MEASURES the thing that was just asked about. */
  let direct = false;

  switch (id) {
    case "sweep": {
      readinessLine();
      stackLine();
      changesLine();
      direct = facts.readiness != null;
      sentence = k("sweep.sentence");
      action = fastPathOr(runCheck());
      break;
    }
    // ── The GOAL findings (owner direction 2026-08-26) ──────────────────────────────────────────
    // Law 2 is doing real work in this half. Nobody asking "I want more FPS" has reported a
    // symptom, so there is nothing to be `direct` about unless Compy already holds the reading
    // that answers them — which is exactly why the level chip is derived rather than written.
    case "wantFps": {
      // P7-route (ROADMAP P7 bullet 1, Constitution §3, §11, §27): "more FPS" is a goal Compy can
      // TEST on this PC, so the answer is the guided journey (one change, measured before and
      // after, kept only if it helped), on the Test room where it lives. It no longer claims where
      // frames go, which Compy never measured. With the bench dark or unread, it says only what the
      // Optimize station delivers: the safe changes, unmeasured on the user's game.
      stackLine();
      readinessLine();
      testedLine();
      direct = facts.recsLoaded;
      if (benchArmed && reachable("lab", facts)) {
        sentence = k("wantFps.sentence");
        action = { kind: "room", label: k("act.journey"), room: "lab", arrival: "journey" };
      } else {
        sentence = k("wantFps.sentenceNoJourney");
        action = station("optimize", "lab", k("act.optimize"));
      }
      break;
    }
    case "wantMonitor": {
      // No session on record is the COMMON case here, and it must read as "not measured yet"
      // rather than as a zero: the whole point of this answer is that the user has not measured
      // anything and wants to start.
      sessionCountLine();
      direct = false;
      sentence = k("wantMonitor.sentence");
      action = roomDoor("play", k("act.watchLive"));
      break;
    }
    case "wantScores": {
      sessionCountLine();
      sessionLine();
      direct = fpsSession != null;
      sentence = k("wantScores.sentence");
      action = station("benchmark", "lab", k("act.seeScores"));
      break;
    }
    case "wantSpecs": {
      // Diagnostics' own whenLine is "You just want to know what's in this PC." — this answer and
      // that station are the same sentence, which is what makes it the right door rather than a
      // near-enough one. No evidence line: the parts list is not something Compy has "measured"
      // in the sense law 2 means, so this stays honestly `unknown` and the action goes and reads it.
      sentence = k("wantSpecs.sentence");
      action = station("diagnostics", "lab", k("act.seeParts"));
      break;
    }
    case "crashInGame": {
      sessionLine();
      changesLine();
      sentence = k("crashInGame.sentence");
      action = station("blackbox", "lab", k("act.crashRecord"));
      break;
    }
    case "crashAnytime": {
      changesLine();
      sentence = k("crashAnytime.sentence");
      action = station("blackbox", "lab", k("act.crashRecord"));
      break;
    }
    case "crashBoot": {
      changesLine();
      sentence = k("crashBoot.sentence");
      action = station("blackbox", "lab", k("act.crashRecord"));
      break;
    }
    case "crashUnsure": {
      changesLine();
      sentence = k("crashUnsure.sentence");
      action = station("blackbox", "lab", k("act.crashRecord"));
      break;
    }
    case "slowAlways": {
      stackLine();
      readinessLine();
      direct = facts.recsLoaded;
      sentence = k("slowAlways.sentence");
      action = fastPathOr(station("diagnostics", "lab", k("act.diagnostics")));
      break;
    }
    case "slowSometimes": {
      sessionLine();
      direct = fpsSession != null;
      sentence = k("slowSometimes.sentence");
      action =
        facts.sessionCount > 0
          ? roomDoor("play", k("act.readSession"))
          : station("benchmark", "lab", k("act.measure"));
      break;
    }
    case "stutter": {
      sessionLine();
      direct = fpsSession != null;
      // The comparison is one of the engine's surfaces, off under compy_intelligence "0"; then the
      // answer promises only what the view still delivers, the crash record.
      const compare = readIntelligence();
      sentence = k(compare ? "stutter.sentence" : "stutter.sentenceNoCompare");
      // P6-door (ROADMAP Phase 6, Constitution §27): a hitch is a "something's wrong" answer, so
      // it lands on the SAME Care view as every crash answer and Home's one Care door — the crash
      // record and what changed before it — rather than handing the user to a room to read their
      // own session. P6-stutter: arriving with a stutter, that view compares the latest session of
      // the game with its last good one (StutterCompare.tsx), on the same station, no second door.
      {
        const care = station("blackbox", "lab", k(compare ? "act.careView" : "act.crashBehind"));
        action = care.kind === "station" && compare ? { ...care, arrival: "stutter" } : care;
      }
      break;
    }
    case "slowUnsure": {
      sessionLine();
      stackLine();
      direct = fpsSession != null;
      sentence = k("slowUnsure.sentence");
      action = fastPathOr(station("benchmark", "lab", k("act.measure")));
      break;
    }
    case "heat": {
      gpuTempLine();
      direct = facts.gpuTempC != null;
      sentence = k("heat.sentence");
      action = station("tuning", "lab", k("act.heat"));
      break;
    }
    case "didItHelp": {
      // P7-route: answered by what Compy already recorded, not by a fresh benchmark. A judged Trial
      // is a measured answer, so "What Compy tested" opens; with none, Compy can only line up what
      // changed and when, which is "Since it last worked" on the Care view (time order, not cause).
      changesLine();
      sessionCountLine();
      testedLine();
      direct = testedCount > 0;
      if (testedCount > 0 && reachable("lab", facts)) {
        sentence = k("didItHelp.sentenceTested");
        action = { kind: "room", label: k("act.whatTested"), room: "lab", arrival: "tested" };
      } else if (testedUnknown && benchArmed && reachable("lab", facts)) {
        // Follow-up review 2026-10-26 §5: the records couldn't be read. "You haven't measured this"
        // and "I couldn't retrieve your measurements" are different statements; this is the second.
        // The panel that reads the records itself is where to look.
        sentence = k("didItHelp.sentenceUnread");
        action = { kind: "room", label: k("act.whatTested"), room: "lab", arrival: "tested" };
      } else {
        // Round 4 review: a bench read as dark is "testing unavailable", not "nothing measured" —
        // its records were never read, so no count (empty or otherwise) is claimed.
        sentence = k(
          testedUnknown
            ? "didItHelp.sentenceUnreadSince"
            : facts.trials?.armed === false
              ? "didItHelp.sentenceUnavailableSince"
              : "didItHelp.sentenceSince",
        );
        const since = station("blackbox", "lab", k("act.sinceWorked"));
        action = since.kind === "station" ? { ...since, arrival: "since" } : since;
      }
      break;
    }
  }

  // LAW 2, mechanically. The chip is computed from what was actually collected — it is never a
  // literal in any branch above, so no future branch can hand-write a confidence it did not earn.
  const level: FindingLevel = ev.length === 0 ? "unknown" : direct ? "measured" : "likely";

  return {
    id,
    level,
    levelLabel: t(confidenceWordKey(wordFromFinding(level))),
    sentence,
    evidence: ev,
    action,
    // LAW 4 — the only mutating action, and it never renders without its undo line.
    undo: action.kind === "fastpath" ? k("act.undo") : undefined,
  };
}
