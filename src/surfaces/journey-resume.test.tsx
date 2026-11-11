// P5-resume: the guided journey survives a Compy or game restart and spans days. Its progress is
// derived from the experiments store ("2 of 5 tested · Next: <change>"); one tap continues on a
// still-reusable as-is session; "Stop here" keeps every decision and says what stays on; a Trial left
// Running across a restart is named the same way by the progress line and the interrupted banner.
// The harness is GuidedJourney.test.tsx's.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "../i18n";

type Status = { active: boolean; status: string; sample: { process_name: string } | null; game_running?: boolean | null };

const state = vi.hoisted(() => ({
  experiments: [] as Record<string, unknown>[],
  recs: [] as unknown[],
  sessions: [] as Record<string, unknown>[],
  /** Sessions saved by each stop_fps_capture, in order (null = the capture saved nothing). */
  saves: [] as (Record<string, unknown> | null)[],
  /** What get_fps_status answers while capturing; `closesAfter` reads later read the game as closed. */
  playing: { active: true, status: "running", sample: { process_name: "Valorant" }, game_running: true } as Status,
  closesAfter: 2 as number | null,
  /** When set, get_fps_status answers this for read n (from 1) instead of `playing`/`closesAfter`. */
  statusAt: null as ((n: number) => Status) | null,
  reads: 0,
  concludeResult: null as Record<string, unknown> | null,
  refuse: {} as Record<string, string>,
  startCaptureCalls: 0,
  failSecondCapture: false,
  startCalls: 0,
  /** start_experiment refuses these "recId|baselineId" pairs with the backend's §3 baseline refusal. */
  refuseBaselines: [] as string[],
  /** When set, get_experiments still reads this record as Running (the store's re-read lags a conclude). */
  lagsConclude: null as string | null,
}));

const session = (started_at: string, samples: number, process_name = "Valorant") => ({
  started_at,
  duration_secs: samples,
  process_name,
  samples,
  avg_fps: 244,
  avg_frametime_ms: 4.1,
  low1_fps_est: 182,
  peak_gpu_temp_c: 61,
  peak_gpu_usage_pct: 88,
  peak_ram_used_bytes: 12_000_000_000,
  ram_total_bytes: 31_000_000_000,
  compy_changes_active: 0,
  fps_series: Array.from({ length: 60 }, (_, i) => [i * 10, 244] as [number, number]),
  // Round 3 of the 2026-10-26 follow-up review: "now" is the newest session, and a result counts as
  // tested only under a MATCHING context, so every fixture session records a driver and Windows build.
  // Tests about unverified or changed context override these on purpose.
  hw_fingerprint: { gpu: "GPU", gpu_driver: "32.0.1" },
  game_state: { gpu_driver: "32.0.1", windows_build: "26200.8457" },
});

const record = (over: Record<string, unknown>) => ({
  id: "exp:9-0",
  rec_id: "hags",
  rec_title: "HAGS",
  game: "Valorant",
  hypothesis: "h",
  created_at: new Date().toISOString(),
  status: "running",
  baseline_avg_fps: 244,
  baseline_low1_fps: 182,
  baseline_session_id: "b",
  applied_at: new Date().toISOString(),
  active_changes_at_start: 0,
  attribution_warning: null,
  noise_floor_pct: 3,
  treatment: null,
  verdict: null,
  kept: false,
  stop_reason: null,
  concluded_at: null,
  verdict_confidence: null,
  verdict_note: null,
  ...over,
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    if (cmd in state.refuse) return Promise.reject(state.refuse[cmd]);
    switch (cmd) {
      case "get_experiment_gate":
        return Promise.resolve(true);
      case "get_experiments":
        return Promise.resolve(
          state.experiments.map((x) => (x.id === state.lagsConclude ? { ...x, status: "running", verdict: null, concluded_at: null } : x)),
        );
      case "get_trial_candidates":
        return Promise.resolve(state.recs);
      case "get_session_summaries":
        return Promise.resolve(state.sessions);
      case "get_applied_changes":
        return Promise.resolve([]);
      case "start_fps_capture":
        state.startCaptureCalls += 1;
        state.reads = 0;
        if (state.failSecondCapture && state.startCaptureCalls === 2) return Promise.reject("helper did not launch");
        return Promise.resolve(null);
      case "get_fps_status": {
        state.reads += 1;
        if (state.statusAt) return Promise.resolve(state.statusAt(state.reads));
        const closed = state.closesAfter != null && state.reads > state.closesAfter;
        return Promise.resolve(closed ? { ...state.playing, sample: null, game_running: false } : state.playing);
      }
      case "stop_fps_capture": {
        const s = state.saves.shift();
        if (s) state.sessions = [...state.sessions, s];
        return Promise.resolve(null);
      }
      case "start_experiment": {
        if (state.refuseBaselines.includes(`${args?.recId}|${args?.baselineSessionId}`))
          return Promise.reject(
            "experiment not started — a Compy change was applied or undone after the baseline session, so the before/after would measure more than this one change — play a new baseline session, then start",
          );
        // The real start records the baseline it was given (round 3: a baseline that can't be found reads unverified).
        const r = record({ id: `exp:${9 + state.startCalls}-0`, rec_id: args?.recId, rec_title: args?.recTitle, outcome: args?.outcome, baseline_session_id: args?.baselineSessionId ?? "b" });
        state.startCalls += 1;
        state.experiments = [...state.experiments, r];
        return Promise.resolve(r);
      }
      case "conclude_experiment": {
        const cur: Record<string, unknown> = state.experiments.find((x) => x.id === args?.experimentId) ?? record({});
        const r: Record<string, unknown> = { ...cur, ...(state.concludeResult ?? {}), concluded_at: new Date().toISOString() };
        state.experiments = state.experiments.map((x) => (x.id === r.id ? r : x));
        return Promise.resolve(r);
      }
      case "restore_experiment": {
        state.experiments = state.experiments.map((x) => (x.id === args?.experimentId ? { ...x, status: "restored" } : x));
        return Promise.resolve(state.experiments.find((x) => x.id === args?.experimentId) ?? {});
      }
      default:
        return Promise.resolve(null);
    }
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import ExperimentBench from "./ExperimentBench";
import { resetJourneyForTests } from "./GuidedJourney";

const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd).map(([, a]) => a as Record<string, unknown>);

const TREATMENT = { avg_fps: 247, low1_fps: 190, samples: 5400, crashed: false, delta_low1_pct: 4.2, delta_avg_pct: 1.1, recorded_at: "" };
const OLD = session("2026-10-01T10:00:00Z", 5400);
const later = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

beforeEach(() => {
  localStorage.clear();
  resetJourneyForTests({ pollMs: 5, saveWaitMs: 40 });
  vi.mocked(invoke).mockClear();
  state.experiments = [];
  state.recs = [
    { id: "game-mode", title: "Game Mode", passes: true, reason: null, detail: null, position: 2, evidence: "not-measured", risk: "low" },
    { id: "hags", title: "HAGS", passes: true, reason: null, detail: null, position: 1, evidence: "not-measured", risk: "low" },
  ];
  state.sessions = [OLD];
  state.saves = [session(later(1), 5400), session(later(2), 5400)];
  state.playing = { active: true, status: "running", sample: { process_name: "Valorant" }, game_running: true };
  state.closesAfter = 2;
  state.statusAt = null;
  state.reads = 0;
  state.concludeResult = { status: "kept", kept: true, verdict: "improved", treatment: TREATMENT };
  state.refuse = {};
  state.startCaptureCalls = 0;
  state.failSecondCapture = false;
  state.startCalls = 0;
  state.refuseBaselines = [];
  state.lagsConclude = null;
});

afterEach(() => cleanup());

const press = async () => {
  const btn = await screen.findByRole("button", { name: "Optimize my game" });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
};

/** The journey's closing line, once it has one (only a finished journey's line is a status). */
const finalLine = () =>
  waitFor(
    () => {
      const el = screen.getByTestId("journey-line");
      expect(el.getAttribute("role")).toBe("status");
      return el.textContent ?? "";
    },
    { timeout: 3000 },
  );


// Two days of a journey on Valorant: HAGS was kept (it is on), Game Mode was put back. Five changes
// are worth testing here in all (HAGS now reads as set by Compy, so the picker leaves it out).
const S1 = session("2026-10-20T10:30:00Z", 5400); // with HAGS on: Game Mode's before-session
const S2 = session("2026-10-21T10:30:00Z", 5400); // with Game Mode on
const HAGS_KEPT = record({
  id: "exp:1-0",
  rec_id: "hags",
  rec_title: "HAGS",
  status: "kept",
  kept: true,
  verdict: "improved",
  baseline_session_id: OLD.started_at,
  treatment: { ...TREATMENT, session_id: S1.started_at },
  created_at: "2026-10-20T10:00:00Z",
  concluded_at: "2026-10-20T11:00:00Z",
});
const GAME_MODE_BACK = record({
  id: "exp:2-0",
  rec_id: "game-mode",
  rec_title: "Game Mode",
  status: "restored",
  kept: false,
  verdict: "no-change",
  baseline_session_id: S1.started_at,
  treatment: { ...TREATMENT, delta_low1_pct: 0.3, session_id: S2.started_at },
  created_at: "2026-10-21T10:00:00Z",
  concluded_at: "2026-10-21T11:00:00Z",
});
const cand = (id: string, title: string, position: number | null, passes = true, reason: string | null = null) => ({
  id,
  title,
  passes,
  reason,
  detail: null,
  position,
  evidence: "not-measured",
  risk: "low",
});
const twoOfFive = () => {
  state.experiments = [HAGS_KEPT, GAME_MODE_BACK];
  state.recs = [
    cand("hags", "HAGS", null, false, "already-set-by-compy"),
    cand("game-mode", "Game Mode", 1),
    cand("power-plan", "Power plan", 2),
    cand("core-parking", "Core parking", 3),
    cand("timer", "Timer resolution", 4),
  ];
  state.sessions = [OLD, S1, S2];
};
const progressLine = () => screen.findByTestId("journey-progress").then((el) => el.textContent ?? "");
/** A Compy restart: the webview's module state is gone; the experiments store and localStorage stay. */
const restart = () => {
  cleanup();
  resetJourneyForTests({ pollMs: 5, saveWaitMs: 40 });
};
const writes = () => ["start_experiment", "conclude_experiment", "restore_experiment", "start_fps_capture"].flatMap(calls);

describe("P5-resume: progress comes from the experiments store", () => {
  it("after 2 of 5 tested, Optimize says so and names the next change", async () => {
    twoOfFive();
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Next: Power plan");
    // CR-next-reuse-moved: Game Mode went on after S1 and was put back, so the start's §3 check
    // refuses S1; the plan says two sessions up front instead of promising one.
    expect(screen.getByTestId("journey-plan").textContent).toBe(
      "Valorant: 2 sessions of about 10 min: one as-is, then one with Power plan.",
    );
    expect(screen.getByRole("button", { name: "Stop here" })).toBeTruthy();
  });

  it("continues on the last session when nothing moved after it (a kept change was on throughout)", async () => {
    // Only HAGS tested and kept: it went on before S1 (its with-change session) and stayed on.
    state.experiments = [HAGS_KEPT];
    state.recs = [cand("hags", "HAGS", null, false, "already-set-by-compy"), cand("game-mode", "Game Mode", 1), cand("power-plan", "Power plan", 2)];
    state.sessions = [OLD, S1];
    render(<ExperimentBench />);
    await progressLine();
    expect(screen.getByTestId("journey-plan").textContent).toBe(
      "Valorant: 1 session of about 10 min with Game Mode. Your last as-is session still counts as the before-reading.",
    );
  });

  it("a fresh install with nothing tested shows no progress line", async () => {
    render(<ExperimentBench />);
    await screen.findByTestId("journey-plan");
    expect(screen.queryByTestId("journey-progress")).toBeNull();
  });

  it("continues after a restart with one tap, on a new as-is session since Game Mode moved after S1", async () => {
    twoOfFive();
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Next: Power plan");
    restart();
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Next: Power plan");
    const fresh = session(later(1), 5400);
    state.saves = [fresh, session(later(2), 5400)];
    await press();
    await waitFor(() => expect(calls("start_experiment")).toHaveLength(1), { timeout: 3000 });
    // CR-next-reuse-moved: Game Mode went on after S1 and was put back, so S1 is never tried.
    expect(calls("start_experiment")[0]).toMatchObject({ recId: "power-plan", baselineSessionId: fresh.started_at });
    expect(await finalLine()).toBe("Kept Power plan: the frame rate in your worst moments (the 1% low) is up 4.2%.");
    expect(calls("start_fps_capture")).toHaveLength(2);
  });

  // Codebase review 2026-11-02: a continuing journey sets no phase before its start, so its button
  // stayed live through the start (and any UAC prompt). A second tap started a second run, whose
  // error path put back the first run's change while the first run said it was on.
  it("a second tap while a continuing journey starts is ignored: one start, nothing put back", async () => {
    // A journey that continues on its last session (nothing moved after S1; CR-next-reuse-moved).
    state.experiments = [HAGS_KEPT];
    state.recs = [cand("hags", "HAGS", null, false, "already-set-by-compy"), cand("game-mode", "Game Mode", 1), cand("power-plan", "Power plan", 2)];
    state.sessions = [OLD, S1];
    render(<ExperimentBench />);
    await progressLine();
    state.saves = [session(later(1), 5400)];
    const btn = await screen.findByRole("button", { name: "Optimize my game" });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(await finalLine()).toBe("Kept Game Mode: the frame rate in your worst moments (the 1% low) is up 4.2%.");
    expect(calls("start_experiment")[0]).toMatchObject({ recId: "game-mode", baselineSessionId: S1.started_at });
    expect(calls("start_experiment")).toHaveLength(1);
    expect(calls("restore_experiment")).toHaveLength(0);
  });

  it("continuing measures a new as-is session when the last one isn't steady any more", async () => {
    // Nothing moved after S1 (HAGS kept), so steadiness alone decides (CR-next-reuse-moved).
    state.experiments = [HAGS_KEPT];
    state.recs = [cand("hags", "HAGS", null, false, "already-set-by-compy"), cand("game-mode", "Game Mode", 1), cand("power-plan", "Power plan", 2)];
    state.sessions = [OLD, { ...S1, fps_series: [] }];
    render(<ExperimentBench />);
    await progressLine();
    expect(screen.getByTestId("journey-plan").textContent).toMatch(/^Valorant: 2 sessions of about 10 min/);
  });

  it("Stop here keeps every decision, says what stays on, and survives a restart", async () => {
    twoOfFive();
    render(<ExperimentBench />);
    await progressLine();
    vi.mocked(invoke).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Stop here" }));
    const stopped = "Stopped here: 2 of 5 tested. Nothing was undone. Still on: HAGS.";
    await waitFor(() => expect(screen.getByTestId("journey-progress").textContent).toBe(stopped));
    // Nothing on the PC was touched: no restore, no start, no capture.
    expect(writes()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Optimize my game" })).toBeNull();
    restart();
    render(<ExperimentBench />);
    await waitFor(() => expect(screen.getByTestId("journey-progress").textContent).toBe(stopped));
    fireEvent.click(screen.getByRole("button", { name: "Pick up where you left off" }));
    expect(await progressLine()).toBe("2 of 5 tested · Next: Power plan");
    expect(screen.getByRole("button", { name: "Optimize my game" })).toBeTruthy();
  });

  it("Stop here after a verdict keeps the change it just kept", async () => {
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Kept HAGS: the frame rate in your worst moments (the 1% low) is up 4.2%.");
    // The picker now reads HAGS as set by Compy.
    state.recs = [cand("hags", "HAGS", null, false, "already-set-by-compy"), cand("game-mode", "Game Mode", 2)];
    fireEvent.click(screen.getByRole("button", { name: "Stop here" }));
    await waitFor(() =>
      expect(screen.getByTestId("journey-progress").textContent).toMatch(/^Stopped here: 1 of 2 tested\. Nothing was undone\./),
    );
    expect(calls("restore_experiment")).toHaveLength(0);
  });

  it("an unreadable stop record from any build is ignored, never a crash", async () => {
    twoOfFive();
    localStorage.setItem("compy.journey.stopped", "not json");
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Next: Power plan");
  });
});

describe("P5-resume: an interrupted Trial and the progress line agree", () => {
  it("a journey Trial left Running across a restart is named, not skipped past to Next", async () => {
    twoOfFive();
    // Power plan was on when Compy closed mid-test: it reads as set by Compy, and its Trial is Running.
    state.recs = state.recs.map((r) => ((r as { id: string }).id === "power-plan" ? cand("power-plan", "Power plan", 2, false, "already-set-by-compy") : r));
    state.experiments = [...state.experiments, record({ id: "exp:3-0", rec_id: "power-plan", rec_title: "Power plan" })];
    localStorage.setItem("compy.journey.running", "exp:3-0");
    render(<ExperimentBench />);
    expect((await screen.findByTestId("exp-interrupted")).textContent).toMatch(/^A test was interrupted: Power plan is still on\./);
    expect(await progressLine()).toBe("2 of 5 tested · Power plan didn't finish testing (see below)");
    expect(screen.queryByText(/Next:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Optimize my game" })).toBeNull();
  });

  it("once that Trial is put back, progress offers it again as next", async () => {
    twoOfFive();
    state.experiments = [...state.experiments, record({ id: "exp:3-0", rec_id: "power-plan", rec_title: "Power plan", status: "restored" })];
    localStorage.setItem("compy.journey.running", "exp:3-0");
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Next: Power plan");
    expect(screen.queryByTestId("exp-interrupted")).toBeNull();
  });

  it("a Trial started by hand says it is being tested now", async () => {
    twoOfFive();
    state.experiments = [...state.experiments, record({ id: "exp:3-0", rec_id: "power-plan", rec_title: "Power plan" })];
    // A running Trial's change is on, and the picker says so (P8-off-progress reads a passing
    // candidate as "off", which a running Trial's change never is).
    state.recs = state.recs.map((r) => ((r as { id: string }).id === "power-plan" ? cand("power-plan", "Power plan", null, false, "already-set-by-compy") : r));
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Testing now: Power plan");
    expect(screen.queryByTestId("exp-interrupted")).toBeNull();
  });
});

// TRUTHFUL COMPLETION (critical review 2026-10-26 §4): the reviewer ran the journey's progress with
// one "too noisy to judge" Trial and a newer session under a different driver and Windows build, and
// got "1 of 1 tested · next: none · context still matches: false". An attempt is not a test; a stale
// result is not one that still holds. These fail on the code before the fix.
import { journeyProgress, nextToTest } from "./journey-resume";
import type { SessionSummary } from "../types";

describe("truthful completion: the journey never counts an attempt or a stale result as finished", () => {
  const ctx = (s: ReturnType<typeof session>, driver: string, build: string) =>
    ({ ...s, hw_fingerprint: { gpu: "GPU", gpu_driver: driver }, game_state: { gpu_driver: driver, windows_build: build } }) as unknown as SessionSummary;
  const BEFORE = ctx(session("2026-10-20T10:00:00Z", 5400), "32.0.1", "26200.8457");
  const AFTER = ctx(session("2026-10-20T11:00:00Z", 5400), "32.0.1", "26200.8457");
  const NEWER = ctx(session("2026-10-26T10:00:00Z", 5400), "33.0.1", "26200.9000");
  const noisy = (id: string, at: string) =>
    record({ id, status: "restored", kept: false, verdict: "too-noisy", baseline_session_id: BEFORE.started_at, created_at: at, concluded_at: at });
  const measured = (id: string, at: string, verdict = "no-change") =>
    record({ id, status: "restored", kept: false, verdict, baseline_session_id: BEFORE.started_at, created_at: at, concluded_at: at, treatment: { ...TREATMENT, session_id: AFTER.started_at } });
  const HAGS = cand("hags", "HAGS", 1);

  it("the reviewer's input: one inconclusive attempt + a changed context is 0 tested, next = retest", () => {
    const p = journeyProgress("Valorant", [noisy("exp:1-0", "2026-10-20T12:00:00Z")], [HAGS], [BEFORE, AFTER, NEWER]);
    expect(p).toMatchObject({ tested: 0, inconclusive: 1, total: 1, next: { id: "hags", retest: "inconclusive" } });
  });

  it("a measured result judged under an older driver and Windows build is offered again as stale", () => {
    const p = journeyProgress("Valorant", [measured("exp:1-0", "2026-10-20T12:00:00Z")], [HAGS], [BEFORE, AFTER, NEWER]);
    expect(p).toMatchObject({ tested: 0, stale: 1, inconclusive: 0, total: 1, next: { id: "hags", retest: "stale" } });
    // The same result with a matching newest context still holds: nothing is next. With no sessions at
    // all, nothing ties it to this PC (round 3): it is offered again as unverified.
    expect(journeyProgress("Valorant", [measured("exp:1-0", "2026-10-20T12:00:00Z")], [HAGS], [BEFORE, AFTER]).next).toBeNull();
    expect(journeyProgress("Valorant", [measured("exp:1-0", "2026-10-20T12:00:00Z")], [HAGS]).next).toMatchObject({ retest: "unverified" });
  });

  it("untested changes come first; two inconclusive runs in a row stop the offer", () => {
    const GM = cand("game-mode", "Game Mode", 2);
    const one = [noisy("exp:1-0", "2026-10-20T12:00:00Z")];
    expect(nextToTest("Valorant", one, [HAGS, GM])).toMatchObject({ id: "game-mode", retest: null });
    const two = [...one, noisy("exp:2-0", "2026-10-21T12:00:00Z")];
    expect(nextToTest("Valorant", two, [HAGS])).toBeNull();
    expect(journeyProgress("Valorant", two, [HAGS])).toMatchObject({ tested: 0, inconclusive: 1, total: 1, next: null });
    // A measured result after the two attempts is a result: tested under a matching context, and not offered again.
    const then = [...two, measured("exp:3-0", "2026-10-22T12:00:00Z")];
    expect(journeyProgress("Valorant", then, [HAGS], [BEFORE, AFTER])).toMatchObject({ tested: 1, inconclusive: 0, next: null });
  });

  // REVIEW ROUND 4 (2026-10-27): the reviewer alternated "measured but unverified" and "too noisy" on
  // fresh baselines with no recorded context, six times, and was offered a run every time: the two
  // counters reset each other. ONE budget now. Fails on the code before this fix.
  it("round 4: alternating unverified and inconclusive attempts stop the offer at the shared cap", () => {
    // No sessions recorded a context: every measured result is unverified.
    const m1 = measured("exp:1", "2026-10-20T12:00:00Z");
    const n2 = noisy("exp:2", "2026-10-21T12:00:00Z");
    const m3 = measured("exp:3", "2026-10-22T12:00:00Z");
    const n4 = noisy("exp:4", "2026-10-23T12:00:00Z");
    expect(nextToTest("Valorant", [m1], [HAGS])).toMatchObject({ id: "hags", retest: "unverified" });
    expect(nextToTest("Valorant", [m1, n2], [HAGS])).toBeNull();
    expect(nextToTest("Valorant", [m1, n2, m3], [HAGS])).toBeNull();
    expect(nextToTest("Valorant", [m1, n2, m3, n4], [HAGS])).toBeNull();
    // The other order too: noisy, then measured-unverified.
    expect(nextToTest("Valorant", [n2, m3], [HAGS])).toBeNull();
    // A measured result under a matching context resets the budget: the next noisy run is offered once.
    expect(nextToTest("Valorant", [m1, n2, m3, n4], [HAGS], [BEFORE, AFTER])).toMatchObject({ id: "hags", retest: "inconclusive" });
    expect(journeyProgress("Valorant", [m1, n2, m3, n4], [HAGS])).toMatchObject({ tested: 0, inconclusive: 1, unverified: 0, next: null });
  });

  it("Optimize says a retest is a retest, and how many tries judged nothing", async () => {
    state.experiments = [noisy("exp:1-0", "2026-10-20T12:00:00Z")];
    state.recs = [HAGS];
    state.sessions = [BEFORE, AFTER];
    render(<ExperimentBench />);
    // Review 2026-11-02, round 2: "Retest: HAGS 1 try couldn't be judged." ran on; the line's own " · ".
    expect(await progressLine()).toBe("0 of 1 tested · Retest: HAGS · 1 try couldn't be judged.");
    expect(screen.getByTestId("journey-retest-why").textContent).toBe(
      "HAGS was tried before, but the frame rate moved around too much to judge. This run tries it again.",
    );
    expect(screen.getByRole("button", { name: "Optimize my game" })).toBeTruthy();
  });

  it("after two tries judged nothing, Optimize says so instead of 'nothing else is worth testing'", async () => {
    state.experiments = [noisy("exp:1-0", "2026-10-20T12:00:00Z"), noisy("exp:2-0", "2026-10-21T12:00:00Z")];
    state.recs = [HAGS];
    state.sessions = [BEFORE, AFTER];
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("0 of 1 tested. Nothing else here is worth testing on this PC. 1 try couldn't be judged.");
  });
});

// Review round 1 of P4-exit-truth (2026-10-26).
import { reusableAsIs } from "./GuidedJourney";

describe("truthful completion, review round 1", () => {
  const ctx = (s: ReturnType<typeof session>, driver: string, build: string) =>
    ({ ...s, hw_fingerprint: { gpu: "GPU", gpu_driver: driver }, game_state: { gpu_driver: driver, windows_build: build } }) as unknown as SessionSummary;
  const BEFORE = ctx(session("2026-10-20T10:00:00Z", 5400), "32.0.1", "26200.8457");
  const AFTER = ctx(session("2026-10-20T11:00:00Z", 5400), "32.0.1", "26200.8457");
  const NEWER = ctx(session("2026-10-26T10:00:00Z", 5400), "33.0.1", "26200.9000");
  const HAGS = cand("hags", "HAGS", 1);
  const measured = (id: string, at: string, over: Record<string, unknown> = {}) =>
    record({ id, status: "restored", kept: false, verdict: "no-change", baseline_session_id: BEFORE.started_at, created_at: at, concluded_at: at, treatment: { ...TREATMENT, session_id: AFTER.started_at }, ...over });

  it("MUST-FIX 1: an as-is session from an older driver or Windows build is never reused, so a stale retest records a fresh before-reading", () => {
    // Steady, usable, the same game: reusable while the context matches, never once it changed.
    expect(reusableAsIs([BEFORE, AFTER], BEFORE.started_at, "Valorant")).not.toBeNull();
    expect(reusableAsIs([BEFORE, AFTER, NEWER], BEFORE.started_at, "Valorant")).toBeNull();
    // Round 3: a session with no driver or build recorded is NOT reusable either (its result would be
    // unverified, run after run); unknown is not stale, but it is not a match.
    const bare = { ...session("2026-10-27T10:00:00Z", 5400), hw_fingerprint: null, game_state: null } as unknown as SessionSummary;
    expect(reusableAsIs([BEFORE, AFTER, NEWER, bare], bare.started_at, "Valorant")).toBeNull();
    // The journey's own asIs for a stale journey is that old-context session: the bench reads it as not reusable.
    const p = journeyProgress("Valorant", [measured("exp:1-0", "2026-10-20T12:00:00Z")], [HAGS], [BEFORE, AFTER, NEWER]);
    expect(p.next).toMatchObject({ id: "hags", retest: "stale" });
    expect(reusableAsIs([BEFORE, AFTER, NEWER], p.asIs, "Valorant")).toBeNull();
  });

  it("NIT + SHOULD-FIX 2: a stale result is counted apart from tested, and a kept one says to put it back", () => {
    const stale = journeyProgress("Valorant", [measured("exp:1-0", "2026-10-20T12:00:00Z")], [HAGS], [BEFORE, AFTER, NEWER]);
    expect(stale).toMatchObject({ tested: 0, stale: 1, staleKept: 0, inconclusive: 0, total: 1 });
    // Kept and set now: the picker no longer offers it, so nothing is next, and the count says why.
    const kept = journeyProgress("Valorant", [measured("exp:1-0", "2026-10-20T12:00:00Z", { status: "kept", kept: true, verdict: "improved" })], [], [BEFORE, AFTER, NEWER]);
    expect(kept).toMatchObject({ tested: 0, stale: 1, staleKept: 1, next: null, total: 1 });
  });

  it("P8-posture-b: a change held back by the chosen risk is not set, so its stale result is never 'kept and set'", () => {
    const old = [measured("exp:1-0", "2026-10-20T12:00:00Z")];
    // Without the held-back list the missing change reads as set by Compy (the old, wrong answer).
    expect(journeyProgress("Valorant", old, [], [BEFORE, AFTER, NEWER])).toMatchObject({ staleKept: 1 });
    expect(journeyProgress("Valorant", old, [], [BEFORE, AFTER, NEWER], ["hags"])).toMatchObject({ stale: 1, staleKept: 0 });
  });

  it("SHOULD-FIX 4: journey and summary agree on which Trial is newest when concluded order differs from start order", () => {
    // Started first, judged last: it is the newest judged Trial of HAGS, so its (inconclusive) verdict rules.
    const startedFirstJudgedLast = record({ id: "exp:a", status: "restored", kept: false, verdict: "too-noisy", baseline_session_id: BEFORE.started_at, created_at: "2026-10-20T09:00:00Z", concluded_at: "2026-10-22T12:00:00Z" });
    const p = journeyProgress("Valorant", [measured("exp:b", "2026-10-21T12:00:00Z"), startedFirstJudgedLast], [HAGS], [BEFORE, AFTER]);
    expect(p).toMatchObject({ tested: 0, inconclusive: 1, next: { id: "hags", retest: "inconclusive" } });
  });

  it("Optimize says a kept result is stale and how to test it again", async () => {
    state.experiments = [measured("exp:1-0", "2026-10-20T12:00:00Z", { status: "kept", kept: true, verdict: "improved" })];
    state.recs = [{ ...HAGS, passes: false, reason: "already-set-by-compy" }];
    state.sessions = [BEFORE, AFTER, NEWER];
    render(<ExperimentBench />);
    expect(await progressLine()).toBe(
      "0 of 1 tested. Nothing else here is worth testing on this PC. 1 result is from an older graphics driver or Windows build. 1 of those is a kept change: put it back to test it again.",
    );
    expect((await screen.findByTestId("exp-summary-stale-kept")).textContent).toBe(
      "1 kept change was judged under an older graphics driver or Windows build (put it back, then test again): HAGS",
    );
    expect(screen.getByTestId("exp-summary")).toHaveAttribute("data-headline", "worth-retesting");
  });

  it("SHOULD-FIX 3: the Trial just judged counts over a store copy that still reads Running", async () => {
    // HAGS is top-ranked and untested; the journey tests it. The store's re-read lags the conclude.
    state.experiments = [];
    state.recs = [cand("hags", "HAGS", 1), cand("game-mode", "Game Mode", 2)];
    state.sessions = [OLD];
    state.concludeResult = { status: "restored", kept: false, verdict: "no-change", treatment: { ...TREATMENT, delta_low1_pct: 0.3 } };
    state.lagsConclude = "exp:9-0";
    render(<ExperimentBench />);
    await press();
    await finalLine();
    // Next is Game Mode, never HAGS again as if untested.
    const next = await screen.findByRole("button", { name: /^Next: / });
    expect(next.textContent).toMatch(/^Next: Game Mode/);
  });

  // Round 3 of the follow-up review (§1, §3): the journey agrees with the summary on unverified
  // results, and the newest session is the reference for "now".
  it("round 3 §3: a measured result that can't be tied to this PC is counted apart and offered again, not 'nothing left'", () => {
    const bareNewest = { ...session("2026-10-27T10:00:00Z", 5400), hw_fingerprint: null, game_state: null } as unknown as SessionSummary;
    const p = journeyProgress("Valorant", [measured("exp:1-0", "2026-10-20T12:00:00Z")], [HAGS], [BEFORE, AFTER, bareNewest]);
    expect(p).toMatchObject({ tested: 0, stale: 0, unverified: 1, total: 1, next: { id: "hags", retest: "unverified" } });
    // The same with the newest session recording a matching context: tested, nothing next.
    expect(journeyProgress("Valorant", [measured("exp:1-0", "2026-10-20T12:00:00Z")], [HAGS], [BEFORE, AFTER]).next).toBeNull();
  });

  it("round 3 §1 + review MUST-FIX 1: an as-is session is reused only under a MATCHING context; unverified retests are capped", () => {
    const bareNewest = { ...session("2026-10-27T10:00:00Z", 5400), hw_fingerprint: null, game_state: null } as unknown as SessionSummary;
    // The newest session can't be classified: the old as-is session is NOT reused (it would make the next
    // result unverified too, run after run); a fresh before-session is the route to a verifiable result.
    expect(reusableAsIs([BEFORE, AFTER, bareNewest], BEFORE.started_at, "Valorant")).toBeNull();
    expect(reusableAsIs([BEFORE, AFTER], BEFORE.started_at, "Valorant")).not.toBeNull();
    // A newest session with a different GPU and nothing else reads as changed: not reusable either.
    const otherGpu = { ...session("2026-10-27T10:00:00Z", 5400), hw_fingerprint: { gpu: "OTHER" }, game_state: null } as unknown as SessionSummary;
    expect(reusableAsIs([BEFORE, AFTER, otherGpu], BEFORE.started_at, "Valorant")).toBeNull();
    // Two unverified results in a row: no third offer; the count still says what they are.
    const two = [measured("exp:1-0", "2026-10-20T12:00:00Z"), measured("exp:2-0", "2026-10-21T12:00:00Z")];
    expect(journeyProgress("Valorant", two, [HAGS], [BEFORE, AFTER, bareNewest])).toMatchObject({ tested: 0, unverified: 1, next: null });
    expect(journeyProgress("Valorant", two.slice(0, 1), [HAGS], [BEFORE, AFTER, bareNewest]).next).toMatchObject({ retest: "unverified" });
  });
});

// CR-next-reuse-moved: the offer's "about 10 min" holds only when no Trial moved a change after the
// as-is session began, the start's §3 rule (experiment.rs `compy_change_moved_after`).
import { trialMovedSince } from "./GuidedJourney";

describe("CR-next-reuse-moved: a Trial's own apply and put-back count as moves", () => {
  const AS_IS = "2026-11-11T12:05:50.928438400+00:00";
  const trial = (created_at: string | undefined, status: string, concluded_at: string | null = null) => ({ created_at, status, concluded_at });
  it("an apply after the session moves it; a put-back after it moves it; a kept or running end does not", () => {
    expect(trialMovedSince([], AS_IS)).toBe(false);
    // Applied after the session began (the finished Trial itself): moved.
    expect(trialMovedSince([trial("2026-11-11T12:18:00Z", "restored", "2026-11-11T12:40:00Z")], AS_IS)).toBe(true);
    // Applied before, kept: its end moved nothing; the session measured with it on is reusable.
    expect(trialMovedSince([trial("2026-11-11T12:00:00Z", "kept", "2026-11-11T12:40:00Z")], AS_IS)).toBe(false);
    // Applied before, put back after: moved.
    expect(trialMovedSince([trial("2026-11-11T12:00:00Z", "restored", "2026-11-11T12:40:00Z")], AS_IS)).toBe(true);
    expect(trialMovedSince([trial("2026-11-11T12:00:00Z", "aborted", "2026-11-11T12:40:00Z")], AS_IS)).toBe(true);
    // Still running, applied before: nothing moved yet.
    expect(trialMovedSince([trial("2026-11-11T12:00:00Z", "running")], AS_IS)).toBe(false);
    // Everything before the session: nothing moved.
    expect(trialMovedSince([trial("2026-11-10T12:00:00Z", "restored", "2026-11-10T13:00:00Z")], AS_IS)).toBe(false);
  });
  it("an unknown never passes as nothing moved", () => {
    expect(trialMovedSince([], null)).toBe(true);
    expect(trialMovedSince([], "not a date")).toBe(true);
    expect(trialMovedSince([trial("garbled", "kept")], AS_IS)).toBe(true);
    expect(trialMovedSince([trial("2026-11-10T12:00:00Z", "restored", "garbled")], AS_IS)).toBe(true);
  });
  // CR-next-moved-outside: the start's §3 check counts a "changed outside Compy" record's time as a
  // move (experiment.rs `outside_recorded_at`), so the offer does too. Fails on the old helper.
  it("a changed-outside record written after the session moves it; an unread ledger counts as moved", () => {
    const rec = (recorded_at: string) => ({ changed_outside: { recorded_at } });
    expect(trialMovedSince([], AS_IS, [rec("2026-11-11T12:30:00Z")])).toBe(true);
    expect(trialMovedSince([], AS_IS, [rec("2026-11-10T12:30:00Z")])).toBe(false);
    expect(trialMovedSince([], AS_IS, [rec("garbled")])).toBe(true);
    expect(trialMovedSince([], AS_IS, [{ changed_outside: null }, {}])).toBe(false);
    expect(trialMovedSince([], AS_IS, null)).toBe(true);
  });
});
