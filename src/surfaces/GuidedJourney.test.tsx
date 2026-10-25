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
  reads: 0,
  concludeResult: null as Record<string, unknown> | null,
  refuse: {} as Record<string, string>,
  startCaptureCalls: 0,
  failSecondCapture: false,
}));

const session = (started_at: string, samples: number) => ({
  started_at,
  duration_secs: samples,
  process_name: "Valorant",
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

const finalLine = async () => {
  const line = await screen.findByRole("status", {}, { timeout: 3000 });
  return line.textContent ?? "";
};

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

  it("hides the button while another Trial is running", async () => {
    state.experiments = [record({ id: "exp:1-0" })];
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-running");
    expect(screen.queryByRole("button", { name: "Optimize my game" })).toBeNull();
  });
});
