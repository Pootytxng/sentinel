import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { INTERVIEW_FINDINGS, interviewFinding, type InterviewFacts } from "./home-interview-data";

// D6 (owner decision 2026-11-24, plan _train/d6-test-room-opt-in-plan-v2.md): with Test's Tuning tools off,
// no interview answer routes into a hidden tool (the Optimize switches, Benchmark, Latency, Tuning, the guided
// journey or "What Compy tested"), and the answers that named them say where they are. Changes are still
// applied through Home's fast path (owner decision 2).

const t = i18n.t;
const HIDDEN_STATIONS = new Set(["optimize", "benchmark", "latency", "tuning"]);

/** Everything measured, every room present, a Trials bench with results: every branch has a reason to route
 *  to a tuning tool, so a missed gate shows. */
const RICH: InterviewFacts = {
  recsLoaded: true,
  safeStackReady: 3,
  fastPathWired: true,
  activeChanges: 2,
  sessionCount: 5,
  lastSession: { game: "Cyberpunk 2077", avgFps: 142.3, low1: 98.4, peakTempC: 71 },
  readiness: { passed: 3, total: 3, attention: 0 },
  gpuTempC: 62,
  rooms: ["play", "learn", "lab"],
  trials: { armed: true, judged: 2 },
};

describe("the interview with the tuning tools off", () => {
  // Break check: remove `&& !(toolsOff && TUNING_TOOL_STATIONS.includes(s))` from `station()` and wantScores
  // routes to the hidden Benchmark station again.
  it.each(INTERVIEW_FINDINGS)("%s routes to no hidden tool", (id) => {
    const f = interviewFinding(id, { ...RICH, tuningTools: false }, t);
    if (f.action.kind === "station") expect(HIDDEN_STATIONS.has(f.action.station)).toBe(false);
    if (f.action.kind === "room") expect(f.action.arrival).toBeUndefined();
  });

  // Control: with the tools on (or not told) the same facts DO reach a hidden tool somewhere, so the test
  // above can fail.
  it("the same facts with the tools on reach a tuning tool somewhere", () => {
    const routes = INTERVIEW_FINDINGS.map((id) => interviewFinding(id, RICH, t).action);
    expect(
      routes.some(
        (a) => (a.kind === "station" && HIDDEN_STATIONS.has(a.station)) || (a.kind === "room" && a.arrival != null),
      ),
    ).toBe(true);
  });

  // Break check: revert the `if (toolsOff)` branch in wantFps and the sentence becomes the journey's.
  it("'more FPS' says the testing is a tuning tool and keeps the one-tap starter stack", () => {
    const f = interviewFinding("wantFps", { ...RICH, tuningTools: false }, t);
    expect(f.sentence).toContain("Settings → Tuning tools");
    expect(f.action.kind).toBe("fastpath");
    expect(f.undo).toBeTruthy();
  });

  it("'did it help' does not claim nothing was measured; it says where the results are", () => {
    const f = interviewFinding("didItHelp", { ...RICH, tuningTools: false }, t);
    expect(f.sentence).toContain("Settings → Tuning tools");
    expect(f.sentence).toContain("timing, not cause");
    expect(f.action.kind === "station" ? f.action.station : f.action.kind).toBe("blackbox");
  });

  it("'scores' says the benchmark is a tuning tool", () => {
    const f = interviewFinding("wantScores", { ...RICH, tuningTools: false }, t);
    expect(f.sentence).toContain("Settings → Tuning tools");
    expect(f.action.kind).toBe("check");
  });
});
