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

// ── The question tree ───────────────────────────────────────────────────────────────────────────

export type InterviewQuestionId = "start" | "crash" | "slow";

export type InterviewFindingId =
  | "sweep"
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
        { id: "crash", label: k("start.crash"), next: { kind: "question", id: "crash" } },
        { id: "slow", label: k("start.slow"), next: { kind: "question", id: "slow" } },
        { id: "heat", label: k("start.heat"), next: { kind: "finding", id: "heat" } },
        { id: "changed", label: k("start.changed"), next: { kind: "finding", id: "didItHelp" } },
        {
          id: "unsure",
          label: k("start.unsure"),
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
  /** activeChangeCount(changes) — applied and still live in the Trust Ledger. */
  activeChanges: number;
  /** How many monitored sessions are on record. */
  sessionCount: number;
  /** The most recent recorded session, or null when there is none. Never a placeholder. */
  lastSession: { game: string; avgFps: number; low1: number; peakTempC: number | null } | null;
  /** The readiness checks, or null while they are still running. */
  readiness: { passed: number; total: number; attention: number } | null;
  /** The live GPU temperature poll, or null when the sensor did not report. */
  gpuTempC: number | null;
  /** The rooms the rail ACTUALLY renders right now — the no-dead-end filter (law 1). */
  rooms: HomeIntakeRoom[];
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
  /** Land ON an instrument, never on a room's dock. */
  | { kind: "station"; label: string; station: LabStationKey; room: HomeIntakeRoom }
  /** A whole room, when the room itself is the answer. */
  | { kind: "room"; label: string; room: HomeIntakeRoom };

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
    if (facts.activeChanges > 0) ev.push(k("ev.changes", { count: facts.activeChanges }));
  };
  const readinessLine = () => {
    if (facts.readiness)
      ev.push(k("ev.readiness", { passed: facts.readiness.passed, total: facts.readiness.total }));
  };
  const sessionLine = () => {
    if (facts.lastSession)
      ev.push(
        k("ev.lastSession", {
          game: facts.lastSession.game,
          avg: Math.round(facts.lastSession.avgFps),
          low: Math.round(facts.lastSession.low1),
        }),
      );
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
      direct = facts.lastSession != null;
      sentence = k("slowSometimes.sentence");
      action =
        facts.sessionCount > 0
          ? roomDoor("play", k("act.readSession"))
          : station("benchmark", "lab", k("act.measure"));
      break;
    }
    case "stutter": {
      sessionLine();
      direct = facts.lastSession != null;
      sentence = k("stutter.sentence");
      action =
        facts.sessionCount > 0
          ? roomDoor("play", k("act.readSession"))
          : station("benchmark", "lab", k("act.measure"));
      break;
    }
    case "slowUnsure": {
      sessionLine();
      stackLine();
      direct = facts.lastSession != null;
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
      changesLine();
      sessionCountLine();
      direct = facts.activeChanges > 0 && facts.sessionCount > 0;
      sentence = k("didItHelp.sentence");
      action = station("benchmark", "lab", k("act.beforeAfter"));
      break;
    }
  }

  // LAW 2, mechanically. The chip is computed from what was actually collected — it is never a
  // literal in any branch above, so no future branch can hand-write a confidence it did not earn.
  const level: FindingLevel = ev.length === 0 ? "unknown" : direct ? "measured" : "likely";

  return {
    id,
    level,
    levelLabel: k(`level.${level}`),
    sentence,
    evidence: ev,
    action,
    // LAW 4 — the only mutating action, and it never renders without its undo line.
    undo: action.kind === "fastpath" ? k("act.undo") : undefined,
  };
}
