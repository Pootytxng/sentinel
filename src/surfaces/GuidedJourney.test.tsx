// P5-guided — the one-button "Optimize my game" journey on the Trial bench. The owner presses one
// button; Compy measures an as-is session, applies the top-ranked change through the audited
// start_experiment, measures a second session, concludes through conclude_experiment and shows the
// verdict. Capture stops when the game's process closes (get_fps_status `game_running`) or on
// "Done playing". A failure after the change went on restores it through restore_experiment.
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
        const r = record({ rec_id: args?.recId, rec_title: args?.recTitle, outcome: args?.outcome });
        state.experiments = [r];
        return Promise.resolve(r);
      }
      case "conclude_experiment": {
        const r = record(state.concludeResult ?? {});
        state.experiments = [r];
        return Promise.resolve(r);
      }
      case "restore_experiment": {
        state.experiments = state.experiments.map((x) => ({ ...x, status: "restored" }));
        return Promise.resolve(state.experiments[0] ?? {});
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

const OLD = session("2026-10-01T10:00:00Z", 5400);
const later = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

beforeEach(() => {
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
  state.concludeResult = { status: "kept", kept: true, verdict: "improved" };
  state.refuse = {};
  state.startCaptureCalls = 0;
  state.failSecondCapture = false;
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

describe("P5-guided: one button runs the whole Trial", () => {
  it("says the plan and time in one line for the last-played game and the top-ranked change", async () => {
    render(<ExperimentBench />);
    const plan = await screen.findByTestId("journey-plan");
    expect(plan.textContent).toMatch(/2 sessions of about 10 min: one as-is, then one with HAGS\./);
    expect(plan.textContent).toMatch(/Valorant/);
    expect(screen.getByRole("button", { name: "Recommended" })).toHaveAttribute("aria-pressed", "true");
  });

  it("happy path: measures as-is, applies the change, measures again, concludes and shows Better", async () => {
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("HAGS: Measurably faster — kept.");
    const [start] = calls("start_experiment");
    expect(start).toMatchObject({ recId: "hags", recTitle: "HAGS", outcome: "recommended" });
    // The as-is session just measured is the baseline, not the older one.
    expect(start.baselineSessionId).not.toBe(OLD.started_at);
    const [conclude] = calls("conclude_experiment");
    expect(conclude).toMatchObject({ experimentId: "exp:9-0", crashed: false });
    expect(conclude.treatmentSessionId).not.toBe(start.baselineSessionId);
    expect(calls("start_fps_capture")).toHaveLength(2);
    expect(calls("stop_fps_capture")).toHaveLength(2);
    expect(calls("restore_experiment")).toHaveLength(0);
  });

  it("game exits early in session 2: too few readings is judged and the change is restored", async () => {
    state.saves = [session(later(1), 5400), session(later(2), 120)];
    state.concludeResult = { status: "restored", verdict: "insufficient-evidence" };
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("HAGS: Not enough data to judge — restored.");
  });

  it("game exits before any reading was saved in session 2: the change is put back", async () => {
    state.saves = [session(later(1), 5400), null];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toMatch(/game closed before Compy had a reading, so Compy put HAGS back/);
    expect(calls("restore_experiment")).toEqual([{ experimentId: "exp:9-0" }]);
    expect(calls("conclude_experiment")).toHaveLength(0);
  });

  it("a too-short as-is session changes nothing", async () => {
    state.saves = [session(later(1), 200)];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toMatch(/200 readings, and Compy needs 600 .* Nothing was changed\./);
    expect(calls("start_experiment")).toHaveLength(0);
  });

  it("rollback on error: a failed conclude restores the change and says so plainly", async () => {
    state.refuse = { conclude_experiment: "experiment not concluded — the disk was full" };
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toMatch(/^Something went wrong, so Compy put HAGS back the way it was\. Nothing was kept\./);
    expect(calls("restore_experiment")).toEqual([{ experimentId: "exp:9-0" }]);
  });

  it("rollback on error: measuring can't restart for session 2, so the change is restored", async () => {
    state.failSecondCapture = true;
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toMatch(/Something went wrong, so Compy put HAGS back.*helper did not launch/);
    expect(calls("restore_experiment")).toHaveLength(1);
    expect(calls("conclude_experiment")).toHaveLength(0);
  });

  it("a restore that fails is said, never hidden", async () => {
    state.refuse = { conclude_experiment: "boom", restore_experiment: "restore failed: key locked" };
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toMatch(/couldn't confirm HAGS was put back.*restore failed: key locked/);
  });

  it("never keeps a change the verdict didn't call Better", async () => {
    state.concludeResult = { status: "kept", kept: true, verdict: "no-change" };
    render(<ExperimentBench />);
    await press();
    await finalLine();
    expect(calls("restore_experiment")).toEqual([{ experimentId: "exp:9-0" }]);
  });

  it("Maximum FPS is one tap away and the Trial is started for it; Done playing ends each session", async () => {
    state.closesAfter = null; // the game never closes: the owner says when he's done
    render(<ExperimentBench />);
    const max = await screen.findByRole("button", { name: "Maximum FPS" });
    fireEvent.click(max);
    expect(max).toHaveAttribute("aria-pressed", "true");
    await press();
    fireEvent.click(await screen.findByRole("button", { name: "Done playing" }));
    await waitFor(() => expect(calls("start_experiment")).toHaveLength(1));
    expect(calls("start_experiment")[0]).toMatchObject({ outcome: "max-fps" });
    expect(await screen.findByText(/Session 2 of 2: HAGS is on/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Done playing" }));
    expect(await finalLine()).toBe("HAGS: Measurably faster — kept.");
  });

  it("a game never seen before measuring stopped is a failed start, with nothing changed", async () => {
    state.playing = { active: false, status: "declined", sample: null };
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toMatch(/didn't start the test, and nothing was changed: Compy couldn't start measuring/);
    expect(calls("start_experiment")).toHaveLength(0);
  });

  it("a session of another game is not used as the baseline, and the room can plan for that game", async () => {
    state.saves = [session(later(1), 5400, "Foo.exe")];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toMatch(/^That session was Foo.*, not Valorant, so it can't be the before-reading\. Nothing was changed\.$/);
    expect(calls("start_experiment")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /^Plan for Foo.* instead$/ }));
    await waitFor(() => expect(screen.getByTestId("journey-plan").textContent).toMatch(/^Foo.*: 2 sessions/));
  });

  it("an unknown game_running never ends a session; only Done playing does", async () => {
    state.statusAt = (n) =>
      n === 1
        ? { active: true, status: "running", sample: { process_name: "Valorant" }, game_running: true }
        : { active: true, status: "running", sample: null, game_running: null };
    render(<ExperimentBench />);
    await press();
    await waitFor(() => expect(state.reads).toBeGreaterThan(10));
    expect(screen.getByTestId("journey")).toHaveAttribute("data-phase", "as-is");
    expect(calls("stop_fps_capture")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Done playing" }));
    await waitFor(() => expect(calls("start_experiment")).toHaveLength(1));
  });

  it("a room switch keeps the journey and its capture; only the window going away stops them", async () => {
    state.closesAfter = null;
    const first = render(<ExperimentBench />);
    await press();
    fireEvent.click(await screen.findByRole("button", { name: "Done playing" }));
    await screen.findByText(/Session 2 of 2: HAGS is on/);
    expect(calls("stop_fps_capture")).toHaveLength(1);

    // Leaving the room unmounts the panel: the journey keeps polling, capture keeps running.
    first.unmount();
    const readsAtLeave = state.reads;
    await waitFor(() => expect(state.reads).toBeGreaterThan(readsAtLeave + 3));
    expect(calls("stop_fps_capture")).toHaveLength(1);

    // Coming back shows the running journey again, not the bench's running panel.
    render(<ExperimentBench />);
    expect(await screen.findByText(/Session 2 of 2: HAGS is on/)).toBeTruthy();
    expect(screen.queryByTestId("experiment-running")).toBeNull();

    // The window really going away (a reload, Compy closing) stops the capture and judges nothing.
    window.dispatchEvent(new Event("pagehide"));
    expect(calls("stop_fps_capture")).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 60));
    expect(calls("conclude_experiment")).toHaveLength(0);
    expect(calls("restore_experiment")).toHaveLength(0);
    expect(state.experiments[0]).toMatchObject({ status: "running" });

    // What the relaunch sees: the interrupted-test banner over the running panel.
    cleanup();
    render(<ExperimentBench />);
    const banner = await screen.findByTestId("exp-interrupted");
    expect(banner.textContent).toBe("A test was interrupted: HAGS is still on. Conclude with your latest session or put it back.");
    expect(screen.getByRole("button", { name: "Restore now" })).toBeTruthy();
  });

  it("the interrupted banner names only a Trial a journey started", async () => {
    localStorage.setItem("compy.journey.running", "exp:1-0");
    state.experiments = [record({ id: "exp:1-0" })];
    render(<ExperimentBench />);
    expect((await screen.findByTestId("exp-interrupted")).textContent).toMatch(/^A test was interrupted: HAGS is still on\./);
    cleanup();
    state.experiments = [record({ id: "exp:2-0" })];
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-running");
    expect(screen.queryByTestId("exp-interrupted")).toBeNull();
  });

  it("hides the button while another Trial is running", async () => {
    state.experiments = [record({ id: "exp:1-0" })];
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-running");
    expect(screen.queryByRole("button", { name: "Optimize my game" })).toBeNull();
  });
});

// P5-rebaseline: the owner's real Aniimo Trial (exp:3) ran its baseline at 293 fps in the first half
// and 241 in the second, was tested anyway and ended "too noisy". The journey now grades session 1 the
// backend's way and asks for one more as-is session instead of applying the change.
const halves = (first: number, second: number) => [
  ...Array.from({ length: 30 }, (_, i) => [i * 10, first] as [number, number]),
  ...Array.from({ length: 30 }, (_, i) => [300 + i * 10, second] as [number, number]),
];
const uneven = (started_at: string) => ({ ...session(started_at, 5400), fps_series: halves(293, 241) });
const phaseIs = (kind: string) =>
  waitFor(() => expect(screen.getByTestId("journey")).toHaveAttribute("data-phase", kind), { timeout: 3000 });

describe("P5-rebaseline: an uneven as-is session is retaken, not tested", () => {
  it("uneven then steady: asks for one more as-is session in plain words, then tests on the steady one", async () => {
    const steady = session(later(2), 5400);
    state.saves = [uneven(later(1)), steady, session(later(3), 5400)];
    render(<ExperimentBench />);
    await press();
    await phaseIs("uneven");
    expect(screen.getByTestId("journey-line").textContent).toBe(
      "That session swung from 293 to 241 fps, too uneven to compare against. Nothing has been changed yet. Play one more as-is session of Valorant, about 10 minutes.",
    );
    expect(calls("start_experiment")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Test anyway" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play one more as-is session" }));
    expect(await screen.findByText(/^One more as-is session: play Valorant as usual/)).toBeTruthy();
    expect(await finalLine()).toBe("HAGS: Measurably faster — kept.");
    expect(calls("start_experiment")).toHaveLength(1);
    expect(calls("start_experiment")[0].baselineSessionId).toBe(steady.started_at);
    expect(calls("start_fps_capture")).toHaveLength(3);
  });

  it("uneven twice then test anyway: starts on the latest session with the bench's uneven warning", async () => {
    const second = uneven(later(2));
    state.saves = [uneven(later(1)), second, session(later(3), 5400)];
    render(<ExperimentBench />);
    await press();
    await phaseIs("uneven");
    fireEvent.click(screen.getByRole("button", { name: "Play one more as-is session" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Test anyway" })).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId("journey-line").textContent).toBe(
      "That session swung from 293 to 241 fps, too uneven to compare against. Nothing has been changed yet. You can test HAGS on this session anyway, or stop here.",
    );
    expect(screen.getByTestId("journey-warn").textContent).toBe(
      "This baseline was uneven: first half 293 fps, second half 241 fps, so this experiment's result may be less reliable.",
    );
    expect(screen.queryByRole("button", { name: "Play one more as-is session" })).toBeNull();
    expect(calls("start_experiment")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Test anyway" }));
    expect(await finalLine()).toBe("HAGS: Measurably faster — kept.");
    expect(calls("start_experiment")[0].baselineSessionId).toBe(second.started_at);
    expect(calls("start_fps_capture")).toHaveLength(3);
  });

  it("uneven twice then stop: nothing is changed and no third session is measured", async () => {
    state.saves = [uneven(later(1)), uneven(later(2))];
    render(<ExperimentBench />);
    await press();
    await phaseIs("uneven");
    fireEvent.click(screen.getByRole("button", { name: "Play one more as-is session" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }, { timeout: 3000 }));
    expect(await finalLine()).toBe("Stopped. Nothing was changed.");
    expect(calls("start_experiment")).toHaveLength(0);
    expect(calls("restore_experiment")).toHaveLength(0);
    expect(calls("start_fps_capture")).toHaveLength(2);
    expect(calls("stop_fps_capture")).toHaveLength(2);
  });

  it("a session without its frame-rate trace is retaken too, never read as steady", async () => {
    state.saves = [{ ...session(later(1), 5400), fps_series: [] }];
    render(<ExperimentBench />);
    await press();
    await phaseIs("uneven");
    expect(screen.getByTestId("journey-line").textContent).toMatch(
      /^Compy couldn't check how steady that session was, so it can't compare against it\. Nothing has been changed yet\./,
    );
    expect(calls("start_experiment")).toHaveLength(0);
  });

  it("a steady first session (halves 2.9% apart) goes straight to the change", async () => {
    const first = { ...session(later(1), 5400), fps_series: halves(300, 291.3) };
    state.saves = [first, session(later(2), 5400)];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("HAGS: Measurably faster — kept.");
    expect(calls("start_experiment")).toHaveLength(1);
    expect(calls("start_experiment")[0].baselineSessionId).toBe(first.started_at);
    expect(calls("start_fps_capture")).toHaveLength(2);
  });
});
