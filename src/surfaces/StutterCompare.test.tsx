// P6-stutter: on the Care view, a stutter compares the game's latest session with its last good one
// through the existing engine (`what_changed_between`) — never a hand-off to Monitor or Benchmark.
// "Good" = measured, steady (baseline-grade.ts) and comparable (the engine's own gate). No good one
// = the view says so and points at recording one in Benchmark.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { BlackBox } from "./BlackBox";
import { pickStutterPair, stutterLessonRule, MAX_GOOD_CANDIDATES } from "./StutterCompare";
import { LibraryContext } from "./library-context";
import { CARE_ARRIVAL_KEY } from "./care-arrival";
import { MIN_BASELINE_SAMPLES } from "./baseline-grade";
import type { SessionSummary, WhatChangedOutcome, Comparability } from "../types";

const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: unknown }[],
  sessions: [] as unknown[],
  verdictFor: {} as Record<string, string>,
  throwFor: "" as string,
  /** P7-teach: the current session's stored 1% low in the engine's report (baseline stays 80). */
  currentLow1: 80 as number,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, string>) => {
    h.calls.push({ cmd, args });
    if (cmd === "get_crash_blackbox") return Promise.resolve({ incidents: [], skipped_sources: [] });
    if (cmd === "get_session_summaries") return Promise.resolve(h.sessions);
    if (cmd === "what_changed_between") {
      if (h.throwFor === args!.baselineStartedAt) return Promise.reject(new Error("ipc down"));
      const verdict = h.verdictFor[args!.baselineStartedAt] ?? "comparable";
      return Promise.resolve(reportFor(args!.baselineStartedAt, args!.currentStartedAt, verdict as Comparability));
    }
    return Promise.resolve(null);
  }),
}));

const STEADY: [number, number][] = [[0, 120], [10, 121], [20, 120], [30, 119]];
const UNEVEN: [number, number][] = [[0, 140], [10, 140], [20, 100], [30, 100]];

const sess = (started_at: string, o: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    started_at,
    duration_secs: 1200,
    process_name: "Valorant.exe",
    samples: MIN_BASELINE_SAMPLES + 100,
    avg_fps: 120,
    avg_frametime_ms: 8.3,
    low1_fps_est: 80,
    fps_series: STEADY,
    ...o,
  }) as SessionSummary;

function reportFor(baseline: string, current: string, verdict: Comparability): WhatChangedOutcome {
  const ref = (started_at: string, low1_fps = 80) => ({
    started_at, game: "Valorant", duration_secs: 1200, samples: 700, avg_fps: 120, low1_fps,
    gaming_mode_active: null, hw_hash: "hw1",
  });
  return {
    kind: "report",
    baseline: ref(baseline),
    current: ref(current, h.currentLow1),
    game: "Valorant",
    verdict: "regressed",
    headline: `ENGINE HEADLINE ${baseline}`,
    observations: [],
    noise_floor_pct: 3,
    events_between: [],
    leading_hypotheses: [{
      id: "gpu-driver-change", title: "GPU driver updated", confidence: "medium",
      supporting_evidence: ["GPU driver changed between these sessions."], contradicting_evidence: [],
      missing_evidence: [], next_test: null, next_test_rec_id: null,
    }],
    ruled_out: [],
    unknowns: [],
    next_action: null,
    next_action_rec_id: null,
    confounded: false,
    gap_days: 2,
    notes: [],
    method_note: "",
    evidence_graph: { nodes: [], edges: [] },
    comparability: {
      verdict, reasons: [], changed_context: [], missing_context: [], candidate_causes: [],
      shared_metrics: [], confidence_limit: "high", allowed_conclusions: [],
    },
  } as unknown as WhatChangedOutcome;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  h.calls = [];
  h.sessions = [];
  h.verdictFor = {};
  h.throwFor = "";
  h.currentLow1 = 80;
});

const cmds = () => h.calls.map((c) => c.cmd);
const betweenCalls = () =>
  h.calls.filter((c) => c.cmd === "what_changed_between").map((c) => c.args as Record<string, string>);

describe("pickStutterPair grades with the existing rules only", () => {
  it("takes the newest MEASURED session as latest; a background-only one is skipped", () => {
    const p = pickStutterPair([
      sess("2026-10-20T10:00:00Z"),
      sess("2026-10-22T10:00:00Z", { fps_series: UNEVEN }),
      sess("2026-10-23T10:00:00Z", { samples: 0, background_secs_excluded: 900 }),
    ]);
    expect(p.kind === "pick" && p.latest.started_at).toBe("2026-10-22T10:00:00Z");
    expect(p.kind === "pick" && p.candidates.map((s) => s.started_at)).toEqual(["2026-10-20T10:00:00Z"]);
  });

  it("only offers earlier, steady sessions of the same game, newest first, capped", () => {
    const many = Array.from({ length: MAX_GOOD_CANDIDATES + 2 }, (_, i) =>
      sess(`2026-10-0${i + 1}T10:00:00Z`),
    );
    const p = pickStutterPair([
      ...many,
      sess("2026-10-15T10:00:00Z", { fps_series: UNEVEN }), // uneven: not steady
      sess("2026-10-16T10:00:00Z", { samples: 100 }), // too short
      sess("2026-10-17T10:00:00Z", { fps_series: [] }), // untraced: unknown, never steady
      sess("2026-10-18T10:00:00Z", { process_name: "Other.exe" }), // another game
      sess("2026-10-20T10:00:00Z"),
    ]);
    if (p.kind !== "pick") throw new Error("expected a pick");
    expect(p.latest.started_at).toBe("2026-10-20T10:00:00Z");
    expect(p.candidates).toHaveLength(MAX_GOOD_CANDIDATES);
    expect(p.candidates[0].started_at).toBe(`2026-10-0${MAX_GOOD_CANDIDATES + 2}T10:00:00Z`);
  });

  it("has nothing to pick when no session measured anything", () => {
    expect(pickStutterPair([sess("2026-10-20T10:00:00Z", { samples: 0 })]).kind).toBe("no-session");
  });
});

describe("the Care view compares on a stutter arrival", () => {
  it("runs the comparison on arrival, through what_changed_between, tagged not proven", async () => {
    h.sessions = [sess("2026-10-20T10:00:00Z"), sess("2026-10-24T10:00:00Z", { fps_series: UNEVEN })];
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    render(<BlackBox />);
    expect(await screen.findByText("ENGINE HEADLINE 2026-10-20T10:00:00Z")).toBeInTheDocument();
    expect(betweenCalls()).toEqual([
      { baselineStartedAt: "2026-10-20T10:00:00Z", currentStartedAt: "2026-10-24T10:00:00Z" },
    ]);
    expect(screen.getByText(/Your latest Valorant session vs your last steady one/)).toBeInTheDocument();
    expect(screen.getByText(/none of it is a proven cause/)).toBeInTheDocument();
    // The cause heading itself carries the tag, not only the section.
    const cause = screen.getByText("Most likely cause");
    expect(cause.parentElement?.textContent).toMatch(/not proven cause/i);
    // One-shot: the flag is spent, and no Monitor/Benchmark command was used.
    expect(localStorage.getItem(CARE_ARRIVAL_KEY)).toBeNull();
    expect(cmds().every((c) => ["get_session_summaries", "what_changed_between"].includes(c))).toBe(true);
  });

  it("skips a steady session the engine can't compare and uses the next one", async () => {
    h.sessions = [
      sess("2026-10-18T10:00:00Z"),
      sess("2026-10-20T10:00:00Z"),
      sess("2026-10-24T10:00:00Z"),
    ];
    h.verdictFor = { "2026-10-20T10:00:00Z": "not-comparable" };
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    render(<BlackBox />);
    expect(await screen.findByText("ENGINE HEADLINE 2026-10-18T10:00:00Z")).toBeInTheDocument();
    expect(betweenCalls().map((a) => a.baselineStartedAt)).toEqual([
      "2026-10-20T10:00:00Z",
      "2026-10-18T10:00:00Z",
    ]);
  });

  it("says there is no good session and points at Benchmark, instead of comparing", async () => {
    h.sessions = [sess("2026-10-20T10:00:00Z", { fps_series: UNEVEN }), sess("2026-10-24T10:00:00Z")];
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    render(<BlackBox />);
    expect(await screen.findByText(/no steady Valorant session/)).toBeInTheDocument();
    expect(screen.getByText(/record a session in Benchmark/)).toBeInTheDocument();
    expect(betweenCalls()).toEqual([]);
  });

  it("an unjudgeable pair is not a good one either", async () => {
    h.sessions = [sess("2026-10-20T10:00:00Z"), sess("2026-10-24T10:00:00Z")];
    h.verdictFor = { "2026-10-20T10:00:00Z": "unknown" };
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    render(<BlackBox />);
    expect(await screen.findByText(/no steady Valorant session/)).toBeInTheDocument();
    expect(screen.queryByText(/ENGINE HEADLINE/)).toBeNull();
  });

  it("says so when there is no measured session at all", async () => {
    h.sessions = [sess("2026-10-24T10:00:00Z", { samples: 0, background_secs_excluded: 600 })];
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    render(<BlackBox />);
    expect(await screen.findByText(/no recorded game session yet/)).toBeInTheDocument();
  });

  it("without the arrival flag it reads nothing on mount, and the button runs it", async () => {
    h.sessions = [sess("2026-10-20T10:00:00Z"), sess("2026-10-24T10:00:00Z")];
    render(<BlackBox />);
    await new Promise((r) => setTimeout(r, 0));
    expect(cmds()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /compare my latest session with my last steady one/i }));
    await waitFor(() => expect(screen.getByText("ENGINE HEADLINE 2026-10-20T10:00:00Z")).toBeInTheDocument());
  });
});

describe("review r1: partial pairs, one-shot, Intelligence off, a failing read", () => {
  it("a partly comparable pair is used, and the line makes no comparability claim of its own", async () => {
    h.sessions = [sess("2026-10-20T10:00:00Z"), sess("2026-10-24T10:00:00Z")];
    h.verdictFor = { "2026-10-20T10:00:00Z": "partial" };
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    render(<BlackBox />);
    expect(await screen.findByText("ENGINE HEADLINE 2026-10-20T10:00:00Z")).toBeInTheDocument();
    const line = screen.getByText(/compared with your last steady one/);
    expect(line.textContent).not.toMatch(/comparable/i);
  });

  it("is truly one-shot: a remount after an arrival does not run again", async () => {
    h.sessions = [sess("2026-10-20T10:00:00Z"), sess("2026-10-24T10:00:00Z")];
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    render(<BlackBox />);
    await screen.findByText("ENGINE HEADLINE 2026-10-20T10:00:00Z");
    cleanup();
    h.calls = [];
    render(<BlackBox />);
    await new Promise((r) => setTimeout(r, 0));
    expect(cmds()).toEqual([]);
    expect(screen.getByRole("button", { name: /compare my latest session/i })).toBeInTheDocument();
  });

  it("with Intelligence off the flag is spent, nothing runs, and the view says why", async () => {
    localStorage.setItem("compy_intelligence", "0");
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    h.sessions = [sess("2026-10-20T10:00:00Z"), sess("2026-10-24T10:00:00Z")];
    render(<BlackBox />);
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem(CARE_ARRIVAL_KEY)).toBeNull();
    expect(cmds()).toEqual([]);
    expect(screen.getByText(/Session comparison is switched off on this PC/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /compare my latest session/i })).toBeNull();
    // The empty crash view still reads honestly: no stutter promise in it.
    fireEvent.click(screen.getByRole("button", { name: /scan for recent crashes/i }));
    const empty = await screen.findByText(/No crashes or freezes recorded/);
    expect(empty.textContent).not.toMatch(/stutter/i);
  });

  it("a read that fails on a later candidate shows the read error and no report (pinned)", async () => {
    h.sessions = [sess("2026-10-18T10:00:00Z"), sess("2026-10-20T10:00:00Z"), sess("2026-10-24T10:00:00Z")];
    h.verdictFor = { "2026-10-20T10:00:00Z": "not-comparable" };
    h.throwFor = "2026-10-18T10:00:00Z";
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    render(<BlackBox />);
    expect(await screen.findByText(/couldn't read your sessions just now/)).toBeInTheDocument();
    expect(screen.queryByText(/ENGINE HEADLINE/)).toBeNull();
    expect(betweenCalls().map((a) => a.baselineStartedAt)).toEqual([
      "2026-10-20T10:00:00Z",
      "2026-10-18T10:00:00Z",
    ]);
    // The button comes back so the user can try again.
    expect(screen.getByRole("button", { name: /compare my latest session/i })).toBeInTheDocument();
  });
});

// P7-teach (Constitution §14): after this pair's own readings, at most one lesson from the P5-learned
// rule table, worded for two sessions of one game, linking the Library entry it reads from. The
// stored verdict wins over the re-derived direction. Fails on the code before this slice.
describe("P7-teach: the stutter comparison teaches one lesson from this pair's own readings", () => {
  const report = (over: Record<string, unknown>) =>
    ({ ...(reportFor("b", "c", "comparable") as unknown as Record<string, unknown>), ...over }) as unknown as Parameters<typeof stutterLessonRule>[0];
  const refs = (bLow: number, cLow: number, bAvg = 120, cAvg = 120) => ({
    baseline: { started_at: "b", game: "Valorant", duration_secs: 1, samples: 1, avg_fps: bAvg, low1_fps: bLow, gaming_mode_active: null, hw_hash: null },
    current: { started_at: "c", game: "Valorant", duration_secs: 1, samples: 1, avg_fps: cAvg, low1_fps: cLow, gaming_mode_active: null, hw_hash: null },
  });

  it("reads the rule from the stored readings against the report's floor", () => {
    expect(stutterLessonRule(report({ verdict: "regressed", ...refs(80, 70) }))).toBe("less-steady-not-slower");
    expect(stutterLessonRule(report({ verdict: "regressed", ...refs(80, 70, 120, 110) }))).toBe("slower-and-less-steady");
    expect(stutterLessonRule(report({ verdict: "improved", ...refs(80, 90) }))).toBe("steadier-not-faster");
    expect(stutterLessonRule(report({ verdict: "no-change", ...refs(80, 81, 120, 130) }))).toBe("faster-not-steadier");
  });

  it("no lesson when the verdict is inconclusive, a baseline reading is missing, or the deltas sit inside the floor", () => {
    expect(stutterLessonRule(report({ verdict: "inconclusive", ...refs(80, 70) }))).toBeNull();
    expect(stutterLessonRule(report({ verdict: "regressed", ...refs(0, 70) }))).toBeNull();
    expect(stutterLessonRule(report({ verdict: "regressed", ...refs(80, 70, 0, 110) }))).toBeNull();
    expect(stutterLessonRule(report({ verdict: "no-change", ...refs(80, 81) }))).toBeNull();
    // Confounded (two or more change families moved) and a zero floor teach nothing either.
    expect(stutterLessonRule(report({ verdict: "regressed", confounded: true, ...refs(80, 70) }))).toBeNull();
    expect(stutterLessonRule(report({ verdict: "regressed", noise_floor_pct: 0, ...refs(80, 70) }))).toBeNull();
    // A current 1% low of 0 is a real reading (-100%), not a missing one.
    expect(stutterLessonRule(report({ verdict: "regressed", ...refs(80, 0) }))).toBe("less-steady-not-slower");
  });

  it("the stored verdict wins: a re-derived 1% low direction that disagrees with it teaches nothing", () => {
    // The engine said regressed, the stored readings read flat on the 1% low: no lesson, never a
    // lesson that contradicts the verdict.
    expect(stutterLessonRule(report({ verdict: "regressed", ...refs(80, 80, 120, 130) }))).toBeNull();
    expect(stutterLessonRule(report({ verdict: "improved", ...refs(80, 70) }))).toBeNull();
  });

  it("renders the one lesson after the report, with the Library link, and none when no rule fits", async () => {
    h.currentLow1 = 70;
    h.sessions = [sess("2026-10-20T10:00:00Z"), sess("2026-10-24T10:00:00Z", { fps_series: UNEVEN })];
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    const openLibrary = vi.fn();
    render(
      <LibraryContext.Provider value={{ openLibrary }}>
        <BlackBox />
      </LibraryContext.Provider>,
    );
    await screen.findByText("ENGINE HEADLINE 2026-10-20T10:00:00Z");
    const lesson = screen.getByTestId("stutter-lesson");
    expect(lesson.getAttribute("data-rule")).toBe("less-steady-not-slower");
    expect(lesson.textContent).toContain("Between these two sessions, 1% lows fell and the average barely moved: Valorant got less steady, not slower.");
    expect(screen.getAllByTestId("stutter-lesson")).toHaveLength(1);
    fireEvent.click(lesson.querySelector("button")!);
    expect(openLibrary).toHaveBeenCalledWith("one-percent-lows");

    cleanup();
    h.currentLow1 = 80; // the verdict says regressed but the readings read flat: nothing taught
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    render(<BlackBox />);
    await screen.findByText("ENGINE HEADLINE 2026-10-20T10:00:00Z");
    expect(screen.queryByTestId("stutter-lesson")).toBeNull();
  });
});

describe("the empty crash view no longer claims stutters can't be checked", () => {
  for (const lang of ["en", "zh-CN"]) {
    it(`${lang}: emptyClean / emptyWithSkipped drop the 'not yet' line`, () => {
      const g = JSON.parse(readFileSync(join("src", "i18n", "locales", lang, "gaming.json"), "utf8"));
      for (const k of ["emptyClean", "emptyWithSkipped"]) {
        expect(g.blackBox[k]).not.toMatch(/can't check stutters here yet|还不能在这里检查卡顿/);
      }
    });
  }
});
