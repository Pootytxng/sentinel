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
        return Promise.resolve(state.experiments);
      case "get_trial_candidates":
        return Promise.resolve(state.recs);
      case "get_session_summaries":
        return Promise.resolve(state.sessions);
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
        const r = record({ id: `exp:${9 + state.startCalls}-0`, rec_id: args?.recId, rec_title: args?.recTitle, outcome: args?.outcome });
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
    // The button continues on the last as-is session, so the plan is one session.
    expect(screen.getByTestId("journey-plan").textContent).toBe(
      "Valorant: 1 session of about 10 min with Power plan. Your last as-is session still counts as the before-reading.",
    );
    expect(screen.getByRole("button", { name: "Stop here" })).toBeTruthy();
  });

  it("a fresh install with nothing tested shows no progress line", async () => {
    render(<ExperimentBench />);
    await screen.findByTestId("journey-plan");
    expect(screen.queryByTestId("journey-progress")).toBeNull();
  });

  it("continues after a restart with one tap, reusing the still-steady as-is session", async () => {
    twoOfFive();
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Next: Power plan");
    restart();
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Next: Power plan");
    state.saves = [session(later(1), 5400)];
    await press();
    await waitFor(() => expect(calls("start_experiment")).toHaveLength(1), { timeout: 3000 });
    // P5-continue's rule: Game Mode was put back, so its before-session is how the PC is now.
    expect(calls("start_experiment")[0]).toMatchObject({ recId: "power-plan", baselineSessionId: S1.started_at });
    expect(await finalLine()).toBe("Kept Power plan: 1% low up 4.2%.");
    // Only the with-change session was measured.
    expect(calls("start_fps_capture")).toHaveLength(1);
  });

  it("continuing measures a new as-is session when the last one isn't steady any more", async () => {
    twoOfFive();
    state.sessions = [OLD, { ...S1, fps_series: [] }, S2];
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Next: Power plan");
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
    expect(await finalLine()).toBe("Kept HAGS: 1% low up 4.2%.");
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
    render(<ExperimentBench />);
    expect(await progressLine()).toBe("2 of 5 tested · Testing now: Power plan");
    expect(screen.queryByTestId("exp-interrupted")).toBeNull();
  });
});
