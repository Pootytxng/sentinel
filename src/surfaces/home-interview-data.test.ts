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

  it("an unread change count cannot make 'did it help' a measured answer", () => {
    // RICH has changes and sessions on record, so the answer is direct; without a count it is not.
    expect(find("didItHelp", RICH).level).toBe("measured");
    expect(find("didItHelp", { ...RICH, activeChanges: null }).level).not.toBe("measured");
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
