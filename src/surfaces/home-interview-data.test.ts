import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import {
  INTERVIEW_FINDINGS,
  INTERVIEW_ROOT,
  interviewFinding,
  interviewQuestions,
  type InterviewFacts,
  type InterviewFindingId,
  type InterviewStep,
} from "./home-interview-data";
import type { HomeIntakeRoom } from "./home-intake-data";

// THE FOUR LAWS OF THE INTERVIEW, mechanised (design foundation step ③, issue #177). The module
// header of home-interview-data.ts states them in prose; prose is the weakest tier of enforcement
// and the most expensive one, so this file is the tier that actually holds them:
//
//   LAW 1  NO DEAD END. Every answer goes somewhere, every finding offers exactly one thing to do,
//          and nothing is ever offered in a room the live rail does not render.
//   LAW 2  NEVER CLAIM UNMEASURED. The level chip is derived from the evidence that was actually
//          collected — "unknown" if and only if nothing was, and "measured" only when the reading
//          answers the question that was just asked.
//   LAW 3  EVIDENCE IS QUOTED, NEVER SYNTHESISED. A line appears only when the fact behind it is
//          present. With nothing measured, there is nothing to show, and the card says so.
//   LAW 4  A MUTATING ACTION STATES ITS UNDO. Exactly the action that changes Windows carries the
//          rollback promise, and no other one does.
//
// These are honesty laws, not layout laws: breaking one does not look broken. That is precisely
// why they are pinned here rather than left to a visual review.

const t = i18n.t;
const Q = interviewQuestions(t);
const ALL_ROOMS: HomeIntakeRoom[] = ["play", "learn", "lab"];

/** Nothing measured, every room present. The state a fresh install with no history is really in. */
const BARE: InterviewFacts = {
  recsLoaded: false,
  safeStackReady: 0,
  fastPathWired: false,
  activeChanges: 0,
  sessionCount: 0,
  lastSession: null,
  readiness: null,
  gpuTempC: null,
  rooms: [...ALL_ROOMS],
};

/** Everything measured — the opposite corner, so no branch can pass by never being exercised. */
const RICH: InterviewFacts = {
  recsLoaded: true,
  safeStackReady: 3,
  fastPathWired: true,
  activeChanges: 2,
  sessionCount: 5,
  lastSession: { game: "Cyberpunk 2077", avgFps: 142.3, low1: 98.4, peakTempC: 71 },
  readiness: { passed: 3, total: 3, attention: 0 },
  gpuTempC: 62,
  rooms: [...ALL_ROOMS],
  trials: { armed: true, judged: 2 },
};

const find = (id: InterviewFindingId, facts: InterviewFacts = BARE) =>
  interviewFinding(id, facts, t);

/** Every step the tree can reach from the root, questions and findings alike. */
function walk(): InterviewStep[] {
  const seen: InterviewStep[] = [{ kind: "question", id: INTERVIEW_ROOT }];
  for (let i = 0; i < seen.length; i++) {
    const step = seen[i];
    if (step.kind !== "question") continue;
    for (const choice of Q[step.id].choices) {
      if (!seen.some((s) => s.kind === choice.next.kind && s.id === choice.next.id)) {
        seen.push(choice.next);
      }
    }
  }
  return seen;
}

describe("the census stays honest", () => {
  it("INTERVIEW_FINDINGS lists exactly what the tree can reach — no more, no less", () => {
    // The census exists so a sweep (this file, the crash guards, a copy audit) can enumerate the
    // whole set without hand-listing it. A census that drifts from the tree is worse than none:
    // every sweep built on it silently stops covering the branch that was added.
    const reachable = walk()
      .filter((s): s is { kind: "finding"; id: InterviewFindingId } => s.kind === "finding")
      .map((s) => s.id);
    expect([...INTERVIEW_FINDINGS].sort()).toEqual([...new Set(reachable)].sort());
  });
});

describe("LAW 1 — no dead end", () => {
  it("every question offers real answers, and exactly one of them is the not-sure one", () => {
    for (const q of Object.values(Q)) {
      expect(q.question.trim().length, `${q.id}: blank question`).toBeGreaterThan(0);
      expect(q.choices.length, `${q.id}: fewer than two answers is not a question`).toBeGreaterThan(1);
      for (const c of q.choices) {
        expect(c.label.trim().length, `${q.id}/${c.id}: blank answer`).toBeGreaterThan(0);
      }
      // The user who does not know is the user this shape is built for. Exactly one — two would be
      // a choice between two kinds of not-knowing, which is the opposite of the point.
      const unsure = q.choices.filter((c) => c.unsure);
      expect(unsure.length, `${q.id}: needs exactly one not-sure answer`).toBe(1);
    }
  });

  it("every answer leads to a step that really exists — no branch points at nothing", () => {
    for (const q of Object.values(Q)) {
      for (const c of q.choices) {
        if (c.next.kind === "question") {
          expect(Q[c.next.id], `${q.id}/${c.id} → missing question`).toBeTruthy();
        } else {
          expect(INTERVIEW_FINDINGS, `${q.id}/${c.id} → uncensused finding`).toContain(c.next.id);
        }
      }
    }
  });

  it("the tree terminates — no answer loops back to a question already on the path", () => {
    // A cycle is a dead end that looks like progress: the user answers, arrives somewhere they
    // have been, and the dots keep growing. Back is for going back; the tree only goes forward.
    for (const q of Object.values(Q)) {
      for (const c of q.choices) {
        if (c.next.kind !== "question") continue;
        expect(c.next.id, `${q.id}/${c.id} points at itself`).not.toBe(q.id);
        for (const inner of Q[c.next.id].choices) {
          expect(inner.next.kind, `${q.id}/${c.id}/${inner.id}: third level`).toBe("finding");
        }
      }
    }
  });

  it("every finding offers exactly one thing to do, in every state of the machine", () => {
    for (const facts of [BARE, RICH]) {
      for (const id of INTERVIEW_FINDINGS) {
        const f = find(id, facts);
        expect(f.sentence.trim().length, `${id}: blank sentence`).toBeGreaterThan(0);
        expect(f.action.label.trim().length, `${id}: blank action`).toBeGreaterThan(0);
      }
    }
  });

  it("never offers a room the rail does not render — it degrades to the read-only check", () => {
    // The action that needs no room, no rail and no wiring is always available, so "no room" can
    // never mean "nothing". This is the mechanism behind the no-dead-end law, not a nicety.
    for (const id of INTERVIEW_FINDINGS) {
      for (const facts of [BARE, RICH]) {
        const stripped = { ...facts, rooms: [] as HomeIntakeRoom[] };
        const f = interviewFinding(id, stripped, t);
        expect(["check", "fastpath"], `${id}: offered a door with no rooms on the rail`).toContain(
          f.action.kind,
        );
      }
      // …and with only SOME rooms, it never names one of the missing ones.
      for (const room of ALL_ROOMS) {
        const partial = { ...RICH, rooms: ALL_ROOMS.filter((r) => r !== room) };
        const f = interviewFinding(id, partial, t);
        if (f.action.kind === "station" || f.action.kind === "room") {
          expect(partial.rooms, `${id}: routed to "${room}", which the rail does not render`).toContain(
            f.action.room,
          );
        }
      }
    }
  });
});

describe("LAW 2 — never claim unmeasured", () => {
  it('"unknown" if and only if there is no evidence — in both directions', () => {
    for (const facts of [BARE, RICH]) {
      for (const id of INTERVIEW_FINDINGS) {
        const f = find(id, facts);
        expect(
          f.level === "unknown",
          `${id}: level "${f.level}" with ${f.evidence.length} evidence line(s)`,
        ).toBe(f.evidence.length === 0);
      }
    }
  });

  it("the level chip always prints its own word, so hue is never the only carrier (COLOR-1)", () => {
    for (const id of INTERVIEW_FINDINGS) {
      for (const facts of [BARE, RICH]) {
        const f = find(id, facts);
        expect(f.levelLabel.trim().length, `${id}: the chip has no word`).toBeGreaterThan(0);
        expect(f.levelLabel, `${id}: the chip is printing its raw key`).not.toContain(
          "home.interview",
        );
      }
    }
  });

  it("with nothing measured, NOTHING says measured", () => {
    for (const id of INTERVIEW_FINDINGS) {
      const f = find(id, BARE);
      expect(f.level, `${id} claims a reading it does not have`).toBe("unknown");
      expect(f.evidence, `${id}`).toEqual([]);
    }
  });

  it('"measured" is reserved for a reading that answers THIS question, not a related one', () => {
    // The distinction that makes the chip worth trusting: a crash question answered while a
    // session recording happens to exist is "likely", not "measured" — the session is real
    // evidence, but it is not a measurement of the crash. Only findings whose own reading is on
    // the machine may say measured.
    const crash = INTERVIEW_FINDINGS.filter((id) => id.startsWith("crash"));
    expect(crash.length).toBeGreaterThan(0);
    for (const id of crash) {
      const f = find(id, RICH);
      expect(f.level, `${id} claims it MEASURED a crash it never read`).not.toBe("measured");
      expect(f.evidence.length, `${id} shows no supporting evidence at all`).toBeGreaterThan(0);
    }
    // …and the sweep, whose reading IS the readiness check, does earn it.
    expect(find("sweep", RICH).level).toBe("measured");
    expect(find("sweep", { ...RICH, readiness: null }).level).toBe("likely");
  });
});

describe("LAW 3 — evidence is quoted, never synthesised", () => {
  it("a line appears only when the fact behind it is present", () => {
    // Each probe removes ONE fact from the rich state and asserts the line it feeds disappears with
    // it. A line that survives its own fact's removal is a line that was invented.
    const probes: [string, Partial<InterviewFacts>, string][] = [
      ["readiness", { readiness: null }, "checks pass"],
      ["last session", { lastSession: null }, "Last recorded session"],
      ["session count", { sessionCount: 0 }, "to compare against"],
      ["applied changes", { activeChanges: 0 }, "still undoable"],
      // #452: a count the Machine Model could not give (pending or unreadable) is not a 0 to quote.
      ["unread applied changes", { activeChanges: null }, "still undoable"],
      ["gpu temperature", { gpuTempC: null }, "reading"],
      ["measured Trials", { trials: null }, "before-and-after Trial"],
    ];
    for (const [name, patch, fragment] of probes) {
      const withFact = INTERVIEW_FINDINGS.map((id) => find(id, RICH).evidence.join(" ")).join(" ");
      const without = INTERVIEW_FINDINGS.map((id) =>
        find(id, { ...RICH, ...patch }).evidence.join(" "),
      ).join(" ");
      expect(withFact, `no finding ever quotes ${name} — this probe proves nothing`).toContain(
        fragment,
      );
      expect(without, `${name} was removed and its line stayed — it is synthesised`).not.toContain(
        fragment,
      );
    }
  });

  it("only a measured Trial makes 'did it help' a measured answer (P7-route)", () => {
    // Changes and sessions on record show timing, not cause: without a judged before-and-after
    // Trial the answer is never "measured", however much else the machine has recorded.
    expect(find("didItHelp", RICH).level).toBe("measured");
    expect(find("didItHelp", { ...RICH, trials: null }).level).not.toBe("measured");
    expect(find("didItHelp", { ...RICH, trials: { armed: true, judged: 0 } }).level).not.toBe("measured");
    // A count the dark bench reports is not a count to quote.
    expect(find("didItHelp", { ...RICH, trials: { armed: false, judged: 4 } }).level).not.toBe("measured");
  });

  it("quotes the reading it was handed, not a rounded-up version of it", () => {
    const f = find("slowSometimes", RICH);
    const joined = f.evidence.join(" ");
    // 142.3 → "142", 98.4 → "98". Rounding for display is fine; inventing precision is not.
    expect(joined).toContain("142");
    expect(joined).toContain("98");
    expect(joined).toContain("Cyberpunk 2077");
  });

  it("prints no unresolved i18n key and no leftover interpolation", () => {
    for (const facts of [BARE, RICH]) {
      for (const id of INTERVIEW_FINDINGS) {
        const f = find(id, facts);
        for (const s of [f.sentence, f.levelLabel, f.action.label, ...f.evidence, f.undo ?? ""]) {
          expect(s, `${id}: unresolved key`).not.toContain("home.interview");
          expect(s, `${id}: unresolved interpolation`).not.toMatch(/\{\{|\}\}/);
        }
      }
    }
  });
});

describe("LAW 4 — a mutating action states its undo", () => {
  it("the rollback promise rides exactly the action that changes Windows", () => {
    for (const facts of [BARE, RICH]) {
      for (const id of INTERVIEW_FINDINGS) {
        const f = find(id, facts);
        expect(
          !!f.undo,
          `${id}: action "${f.action.kind}" ${f.undo ? "promises an undo it does not need" : "changes Windows with no undo promise"}`,
        ).toBe(f.action.kind === "fastpath");
      }
    }
  });

  it("the promise names where the undo lives, not just that one exists", () => {
    const f = find("sweep", RICH);
    expect(f.action.kind).toBe("fastpath");
    expect(f.undo).toBe(t("home.interview.f.act.undo"));
    expect(f.undo!.length, "an undo promise with no destination is a slogan").toBeGreaterThan(20);
  });

  it("never offers the one-tap stack unless it is genuinely ready AND wired", () => {
    // Three independent ways for it to be unavailable, each of which must suppress it on its own.
    // Offering an apply that cannot run is the honesty failure; it just fails silently instead of
    // loudly, which is worse.
    const blockers: Partial<InterviewFacts>[] = [
      { fastPathWired: false },
      { recsLoaded: false },
      { safeStackReady: 0 },
    ];
    for (const patch of blockers) {
      for (const id of INTERVIEW_FINDINGS) {
        const f = find(id, { ...RICH, ...patch });
        expect(
          f.action.kind,
          `${id}: offered the one-tap stack with ${JSON.stringify(patch)}`,
        ).not.toBe("fastpath");
      }
    }
  });
});

describe("the words stay the user's", () => {
  it("no question, answer, sentence or action names a room or an instrument", () => {
    // The rail gets relabelled (Monitor→Live, Blackbook→History, Lab→Test, 2026-08-12). Copy that
    // hardcodes a room name drifts silently the next time it does — and a symptom said in the
    // app's vocabulary is not the user's own words, which is the whole premise of the shape.
    const NAMES = /\b(Monitor|Blackbook|Lab|Live|History|Black Box|Optimize)\b/;
    const strings = [
      ...Object.values(Q).flatMap((q) => [q.question, ...q.choices.map((c) => c.label)]),
      ...INTERVIEW_FINDINGS.flatMap((id) => {
        const f = find(id, RICH);
        return [f.sentence, f.action.label];
      }),
    ];
    for (const s of strings) {
      expect(s, `"${s}" names a room or an instrument`).not.toMatch(NAMES);
    }
  });
});

// P6-door (ROADMAP Phase 6, Constitution §18/§27): every "something's wrong" answer about a crash
// or a stutter lands on ONE Care view — the crash record with what changed before it — whatever
// the machine has measured. The stutter answer used to open the Monitor room or the benchmark.
describe("crash and stutter answers converge on one Care view", () => {
  const CARE_FINDINGS: InterviewFindingId[] = [
    "crashInGame",
    "crashAnytime",
    "crashBoot",
    "crashUnsure",
    "stutter",
  ];
  it.each(CARE_FINDINGS)("%s opens the blackbox station in every state of the machine", (id) => {
    for (const facts of [BARE, RICH]) {
      const a = find(id, facts).action;
      expect(a.kind === "station" ? a.station : a.kind, `${id} left the Care view`).toBe("blackbox");
    }
  });

  // P6-stutter: only the stutter answer arrives as a stutter, so only it runs the session comparison.
  it.each(CARE_FINDINGS)("%s carries the stutter arrival only when it is the stutter answer", (id) => {
    const a = find(id, RICH).action;
    expect(a.kind === "station" ? a.arrival : undefined).toBe(id === "stutter" ? "stutter" : undefined);
  });

  it("with Intelligence off the stutter answer keeps the crash-record promise and no arrival", () => {
    localStorage.setItem("compy_intelligence", "0");
    try {
      const f = find("stutter", RICH);
      const a = f.action;
      expect(a.kind === "station" ? a.station : a.kind).toBe("blackbox");
      expect(a.kind === "station" ? a.arrival : undefined).toBeUndefined();
      expect(a.label).toBe(i18n.t("home.interview.f.act.crashBehind"));
      expect(f.sentence).not.toMatch(/last steady/);
    } finally {
      localStorage.removeItem("compy_intelligence");
    }
  });
});

// P7-route (ROADMAP Phase 7 bullet 1): an answer lands on the journey that answers it. "I want more
// FPS" opens the guided Trial only when the bench is armed (otherwise the safe changes, worded as
// expected-not-proven); "did it help?" opens what Compy measured only when something was measured
// (otherwise "Since it last worked", which shows timing, not cause).
describe("answers land on the journey that answers them", () => {
  it("'I want more FPS' opens the guided journey only on an armed bench", () => {
    const armed = find("wantFps", RICH);
    expect(armed.action).toMatchObject({ kind: "room", room: "lab", arrival: "journey" });
    expect(armed.sentence).toBe(t("home.interview.f.wantFps.sentence"));
    for (const trials of [null, { armed: false, judged: 0 }]) {
      const f = find("wantFps", { ...RICH, trials });
      expect(f.action.kind === "station" ? f.action.station : f.action.kind).toBe("optimize");
      expect(f.sentence).toMatch(/expected, not proven/);
    }
  });

  it("'did it help?' opens what Compy tested only when a Trial measured something", () => {
    expect(find("didItHelp", RICH).action).toMatchObject({ kind: "room", room: "lab", arrival: "tested" });
    for (const trials of [null, { armed: true, judged: 0 }, { armed: false, judged: 3 }]) {
      const a = find("didItHelp", { ...RICH, trials }).action;
      expect(a.kind === "station" ? [a.station, a.arrival] : [a.kind]).toEqual(["blackbox", "since"]);
    }
  });

  it("never sends either answer to a room the rail does not render", () => {
    const noLab = { ...RICH, rooms: ["play", "learn"] as HomeIntakeRoom[] };
    for (const id of ["wantFps", "didItHelp"] as const) {
      const a = find(id, noLab).action;
      expect(a.kind === "room" || a.kind === "station" ? a.room : null).not.toBe("lab");
    }
  });
});
