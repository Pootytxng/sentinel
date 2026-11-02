// P5-guided — the one-button "Optimize my game" journey on the Trial bench. The owner presses one
// button; Compy measures an as-is session, applies the top-ranked change through the audited
// start_experiment, measures a second session, concludes through conclude_experiment and shows the
// verdict. Capture stops when the game's process closes (get_fps_status `game_running`) or on
// "Done playing". A failure after the change went on restores it through restore_experiment.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import i18n from "../i18n";

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
  /** P5-realplay: what get_realplay_progress answers for a game (null = no answer). */
  rpProgress: null as ((game: string) => unknown) | null,
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
  // Round 3 of the 2026-10-26 follow-up review: a result counts as tested only under a MATCHING
  // context against the newest session, so fixture sessions record a driver and Windows build.
  hw_fingerprint: { gpu: "GPU", gpu_driver: "32.0.1" },
  game_state: { gpu_driver: "32.0.1", windows_build: "26200.8457" },
});

/** P5-realplay: the sessions of `game` that can count (600+ readings and a frame-rate reading, as
 *  realplay.rs `countable`), oldest first. */
function countable(game: string): Record<string, unknown>[] {
  return state.sessions
    .filter((s) => s.process_name === game && (s.samples as number) >= 600 && (s.avg_fps as number) > 0 && (s.low1_fps_est as number) > 0)
    .sort((a, b) => Date.parse(a.started_at as string) - Date.parse(b.started_at as string));
}
/** A session's numbers as a real-play record copies them (realplay.rs `RealPlaySession`). */
function numbers(s: Record<string, unknown>) {
  return { session_id: s.started_at, low1_fps: s.low1_fps_est, avg_fps: s.avg_fps, samples: s.samples };
}

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
        // P5-realplay: a real-play start pins its as-is sessions on the record, as the backend does.
        const anchor = state.sessions.find((s) => s.started_at === args?.baselineSessionId);
        const realPlay =
          args?.mode === "real-play"
            ? { mode: "real-play", real_play: { before: countable(String(anchor?.process_name ?? "")).slice(-8).map(numbers) } }
            : {};
        const r = record({ id: `exp:${9 + state.startCalls}-0`, rec_id: args?.recId, rec_title: args?.recTitle, outcome: args?.outcome, baseline_session_id: args?.baselineSessionId ?? "b", ...realPlay });
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
      case "get_realplay_progress":
        return Promise.resolve(state.rpProgress ? state.rpProgress(String(args?.game)) : null);
      case "conclude_realplay": {
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
import { LEDGER_CHANGED_EVENT } from "../types";

const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd).map(([, a]) => a as Record<string, unknown>);

const TREATMENT = { avg_fps: 247, low1_fps: 190, samples: 5400, crashed: false, delta_low1_pct: 4.2, delta_avg_pct: 1.1, recorded_at: "" };
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
  state.concludeResult = { status: "kept", kept: true, verdict: "improved", treatment: TREATMENT };
  state.refuse = {};
  state.startCaptureCalls = 0;
  state.failSecondCapture = false;
  state.startCalls = 0;
  state.refuseBaselines = [];
  state.rpProgress = null;
});

afterEach(() => cleanup());

const press = async () => {
  const btn = await screen.findByRole("button", { name: "Optimize my game" });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
};

/** Opens the finished journey's technical receipt and reads its rows, label to value. */
const receiptRows = async (): Promise<Record<string, string>> => {
  const journey = screen.getByTestId("journey");
  const door = journey.querySelector('[data-testid="journey-depth-receipt"] > summary')!;
  fireEvent.click(door);
  // Depth mounts a door's content on the details' toggle (a later task in jsdom): wait for it.
  await waitFor(() => expect(door.parentElement!.children.length).toBeGreaterThan(1));
  return Object.fromEntries(
    [...journey.querySelectorAll(".journey-receipt dt")].map((dt) => [dt.textContent ?? "", dt.nextElementSibling?.textContent ?? ""]),
  );
};

/** Review 2026-11-02 (P5-realplay, fix 2): buttons that sit on one line share one .exp-running-actions
 *  row ("Test it while I play normally" touched "Stop here", "Measure my next session" touched "OK"). */
const sharesRow = (a: HTMLElement, b: HTMLElement) => {
  expect(a.parentElement, `${a.textContent} and ${b.textContent} share one row`).toBe(b.parentElement);
  expect(a.parentElement).toHaveClass("exp-running-actions");
};
/** ...and no two buttons are the journey's own neighbouring blocks, side by side with nothing between. */
const noTouchingButtons = (root: HTMLElement) => {
  const kids = [...root.children];
  kids.forEach((el, i) => {
    if (el.tagName === "BUTTON") expect(kids[i + 1]?.tagName, `${el.textContent} touches the button beside it`).not.toBe("BUTTON");
  });
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
    expect(await finalLine()).toBe("Kept HAGS: the frame rate in your worst moments (the 1% low) is up 4.2%.");
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

  // P7-depth-verdicts (Constitution §13): the result line is the answer; the rule it was judged by is
  // one tap; the record's own numbers one more. Fails on the code before this slice (no doors).
  it("the result has three depths: the line, the keep rule it was judged by, and the record's numbers", async () => {
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Kept HAGS: the frame rate in your worst moments (the 1% low) is up 4.2%.");
    const journey = screen.getByTestId("journey");
    // Answer face: no raw record field, no door open.
    expect(journey.querySelector(".journey-why")).toBeNull();
    expect(journey.querySelector(".journey-receipt")).toBeNull();
    fireEvent.click(journey.querySelector('[data-testid="journey-depth-why"] > summary')!);
    await waitFor(() => expect(journey.querySelector(".journey-why")).not.toBeNull());
    // The harness record holds a noise FLOOR but not the judged band, so no band figure is named.
    expect(journey.querySelector(".journey-why")!.textContent).toBe(
      "Recommended keeps a change only when the frame rate in your worst moments (the 1% low) improved beyond the normal run-to-run wobble (the noise band) and the average did not fall beyond it; otherwise the change goes back.",
    );
    const door1 = journey.querySelector('[data-testid="journey-depth-receipt"] > summary')!;
    fireEvent.click(door1);
    // Depth mounts a door's content on the details' toggle (a later task in jsdom): wait for it.
    await waitFor(() => expect(door1.parentElement!.children.length).toBeGreaterThan(1));
    const rows = Object.fromEntries(
      [...journey.querySelectorAll(".journey-receipt dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]),
    );
    expect(rows).toMatchObject({
      Change: "hags",
      Outcome: "recommended",
      Verdict: "improved",
      "Before, average": "244.0 fps",
      "After, average": "247.0 fps +1.1%",
      "Before, 1% low": "182.0 fps",
      "After, 1% low": "190.0 fps +4.2%",
      "Noise floor": "±3%",
      "After, samples": "5400",
      Trial: "exp:9-0",
    });
    // Nothing the record didn't hold: no judged band or measured-noise row (none recorded), no blank value.
    expect(rows["Noise band"]).toBeUndefined();
    expect(rows["Measured noise"]).toBeUndefined();
    expect([...journey.querySelectorAll(".journey-receipt dd")].every((dd) => dd.textContent!.trim() !== "")).toBe(true);
  });

  it("an attempt that judged nothing explains that, not a keep rule", async () => {
    state.concludeResult = { status: "restored", verdict: "insufficient-evidence" };
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Put HAGS back: there wasn't enough play with it on to judge.");
    const journey = screen.getByTestId("journey");
    const door2 = journey.querySelector('[data-testid="journey-depth-why"] > summary')!;
    fireEvent.click(door2);
    // Depth mounts a door's content on the details' toggle (a later task in jsdom): wait for it.
    await waitFor(() => expect(door2.parentElement!.children.length).toBeGreaterThan(1));
    expect(journey.querySelector(".journey-why")!.textContent).toMatch(/could not be compared fairly, so nothing was judged/);
    expect(journey.querySelector(".journey-why")!.textContent).not.toMatch(/keeps a change/);
    // Review SHOULD-FIX 1: the why never asserts the change "went back" — the line above owns that claim.
    expect(journey.querySelector(".journey-why")!.textContent).not.toMatch(/went back/);
  });

  // Review SHOULD-FIX 2 + 3: a record without the judged band names no band figure (its floor is shown
  // AS a floor in the receipt), and a Maximum FPS pick is explained by the Maximum FPS rule.
  it("names the band only when the record holds it, and the Maximum FPS rule for a Maximum FPS pick", async () => {
    state.concludeResult = { status: "kept", kept: true, verdict: "improved", outcome: "max-fps", treatment: TREATMENT, noise_evidence: { band_pct: 5.94, measured_noise_pct: 4.1 } };
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Kept HAGS: average up 1.1%.");
    const journey = screen.getByTestId("journey");
    const door3 = journey.querySelector('[data-testid="journey-depth-why"] > summary')!;
    fireEvent.click(door3);
    // Depth mounts a door's content on the details' toggle (a later task in jsdom): wait for it.
    await waitFor(() => expect(door3.parentElement!.children.length).toBeGreaterThan(1));
    expect(journey.querySelector(".journey-why")!.textContent).toBe(
      "Maximum FPS keeps a change only when the average improved beyond the ±5.9% normal run-to-run wobble (the noise band) and the frame rate in your worst moments (the 1% low) held; otherwise the change goes back.",
    );
    const door4 = journey.querySelector('[data-testid="journey-depth-receipt"] > summary')!;
    fireEvent.click(door4);
    // Depth mounts a door's content on the details' toggle (a later task in jsdom): wait for it.
    await waitFor(() => expect(door4.parentElement!.children.length).toBeGreaterThan(1));
    const rows = Object.fromEntries(
      [...journey.querySelectorAll(".journey-receipt dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]),
    );
    expect(rows["Noise band"]).toBe("±5.9%");
    expect(rows["Measured noise"]).toBe("±4.1%");
    expect(rows["Noise floor"]).toBeUndefined(); // the judged band is recorded: the floor is not shown as if it were it
    expect(rows.Outcome).toBe("max-fps");
  });

  // P8-dims (RISK_MODEL §3, "do not collapse these into one arbitrary score"): the receipt names the
  // catalog's overall word AND each risk dimension it states for the change, from the record the
  // Trial started with; a dimension it doesn't state reads "not stated", never filled in from the
  // overall word. Fails on the code before this slice, whose receipt had no risk row at all.
  it("the receipt lists each risk dimension the catalog states, and says so for one it doesn't", async () => {
    state.concludeResult = {
      status: "kept",
      kept: true,
      verdict: "improved",
      treatment: TREATMENT,
      stated_risk: { overall: "moderate", dimensions: { reversibility: "low", stability: null, compatibility: null, security: "high" } },
    };
    render(<ExperimentBench />);
    await press();
    await finalLine();
    const rows = await receiptRows();
    expect(rows).toMatchObject({
      "Risk, overall": "moderate risk",
      Reversibility: "low risk",
      Stability: "not stated",
      Compatibility: "not stated",
      Security: "high risk",
    });
    // One dimension stated keeps all four rows; the one-row summary is only for none stated.
    expect(rows["Risk dimensions"]).toBeUndefined();
  });

  // N3 (Rust review of P8-dims): no catalog entry states its dimensions yet, so every receipt read four
  // rows of "not stated". With none stated, one row says so. Fails on the code before it (four rows).
  it("with no dimension stated, the receipt says so in one row, not four", async () => {
    // An overall word the catalog didn't state (or one this build doesn't know), and no dimensions.
    state.concludeResult = { status: "restored", verdict: "no-change", treatment: TREATMENT, stated_risk: { overall: "unknown", dimensions: {} } };
    render(<ExperimentBench />);
    await press();
    await finalLine();
    const rows = await receiptRows();
    expect(rows["Risk, overall"]).toBe("not stated");
    expect(rows["Risk dimensions"]).toBe("not stated in the catalog");
    for (const label of ["Reversibility", "Stability", "Compatibility", "Security"]) expect(rows[label], label).toBeUndefined();
    // A dimension in a form this build doesn't know is not "stated" either.
    cleanup();
    resetJourneyForTests({ pollMs: 5, saveWaitMs: 40 });
    state.concludeResult = { status: "restored", verdict: "no-change", treatment: TREATMENT, stated_risk: { overall: "low", dimensions: { stability: "extreme", security: null } } };
    state.saves = [session(later(3), 5400), session(later(4), 5400)];
    await i18n.changeLanguage("zh-CN");
    try {
      render(<ExperimentBench />);
      const btn = await screen.findByRole("button", { name: "优化我的游戏" });
      await waitFor(() => expect(btn).toBeEnabled());
      fireEvent.click(btn);
      await finalLine();
      const zh = await receiptRows();
      expect(zh["风险维度"]).toBe("目录中未说明");
      expect(zh["稳定性"]).toBeUndefined();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  // P8-posture-show (RISK_MODEL §2): the journey's start carries the risk the user allows on this PC,
  // and the receipt names the one its Trial's record kept; a record without one says "not recorded",
  // never the default. Fails on the code before this slice (no choice sent, no row).
  it("the start carries the risk allowed, and the receipt names the one the record kept", async () => {
    localStorage.setItem("compy.trial.riskChoice", "low-only");
    try {
      state.concludeResult = { status: "kept", kept: true, verdict: "improved", treatment: TREATMENT, risk_choice: "low-only" };
      render(<ExperimentBench />);
      await press();
      await finalLine();
      expect(calls("start_experiment")[0]).toMatchObject({ recId: "hags", riskChoice: "low-only" });
      expect((await receiptRows())["Risk you allowed"]).toBe("Low risk only");
    } finally {
      localStorage.removeItem("compy.trial.riskChoice");
    }
    cleanup();
    resetJourneyForTests({ pollMs: 5, saveWaitMs: 40 });
    state.concludeResult = { status: "restored", verdict: "no-change", treatment: TREATMENT, risk_choice: "anything-goes" };
    state.saves = [session(later(3), 5400), session(later(4), 5400)];
    render(<ExperimentBench />);
    await press();
    await finalLine();
    const starts = calls("start_experiment");
    expect(starts[starts.length - 1]).toMatchObject({ riskChoice: "low-and-moderate" });
    expect((await receiptRows())["Risk you allowed"]).toBe("not recorded");
  });

  // P8-ack (RISK_MODEL §1 Advanced): when the journey's change is moderate, the plan is followed by one
  // plain line naming its cost in the catalog's own words, and the journey starts from one tap on "I
  // understand, test it"; the start records it and the receipt names the cost and the confirmation. A
  // low-risk change starts from "Optimize my game" as before. Fails on the code before this slice.
  it("a moderate change names its cost and starts from one tap; the receipt names both", async () => {
    state.recs = [
      { id: "hags", title: "HAGS", passes: true, reason: null, detail: null, position: 1, evidence: "not-measured", risk: "moderate", cost: "Reboot required." },
    ];
    state.concludeResult = {
      status: "kept",
      kept: true,
      verdict: "improved",
      treatment: TREATMENT,
      cost_acknowledged: true,
      stated_risk: { overall: "moderate", dimensions: {}, cost: "Reboot required." },
    };
    render(<ExperimentBench />);
    expect(await screen.findByTestId("journey-cost-ack")).toHaveTextContent("HAGS has a cost: Reboot required.");
    expect(screen.queryByRole("button", { name: "Optimize my game" })).toBeNull();
    const tap = screen.getByRole("button", { name: "I understand, test it" });
    // Review 2026-11-02 (fix 10): the cost line keeps the journey's 9px either side, and the tap under it
    // sits in a row, so the two margins meet as one 9px.
    expect(screen.getByTestId("journey-cost-ack")).toHaveClass("exp-journey-cost");
    expect(tap.parentElement).toHaveClass("exp-running-actions");
    await waitFor(() => expect(tap).toBeEnabled());
    fireEvent.click(tap);
    await finalLine();
    expect(calls("start_experiment")[0]).toMatchObject({ recId: "hags", costAcknowledged: true });
    expect(await receiptRows()).toMatchObject({ Cost: "Reboot required.", "Cost confirmed": "yes, before the Trial started" });
  });

  it("a low-risk change starts as before, and its receipt says no confirmation was needed", async () => {
    state.concludeResult = {
      status: "kept",
      kept: true,
      verdict: "improved",
      treatment: TREATMENT,
      cost_acknowledged: false,
      stated_risk: { overall: "low", dimensions: {}, cost: null },
    };
    render(<ExperimentBench />);
    await press();
    await finalLine();
    expect(screen.queryByTestId("journey-cost-ack")).toBeNull();
    expect(calls("start_experiment")[0]).toMatchObject({ recId: "hags", costAcknowledged: false });
    expect(await receiptRows()).toMatchObject({ Cost: "not stated", "Cost confirmed": "not needed: low risk" });
  });

  it("the next change, when moderate, keeps its plan line and starts from the same one tap", async () => {
    state.recs = [
      { id: "hags", title: "HAGS", passes: true, reason: null, detail: null, position: 1, evidence: "not-measured", risk: "low" },
      { id: "sysmain", title: "SysMain", passes: true, reason: null, detail: null, position: 2, evidence: "not-measured", risk: "moderate", cost: "App launches get a little slower." },
    ];
    state.saves = [session(later(1), 5400), session(later(2), 5400), session(later(3), 5400)];
    render(<ExperimentBench />);
    await press();
    await finalLine();
    expect(await screen.findByTestId("journey-next-plan")).toHaveTextContent(/Next: SysMain/);
    expect(screen.getByTestId("journey-cost-ack")).toHaveTextContent("SysMain has a cost: App launches get a little slower.");
    expect(screen.getByTestId("journey-cost-ack")).toHaveClass("exp-journey-cost");
    expect(screen.queryByRole("button", { name: /Next: SysMain/ })).toBeNull();
    const tap = screen.getByRole("button", { name: "I understand, test it" });
    expect(tap.parentElement).toHaveClass("exp-running-actions");
    // The generic OK shares one row with Stop here, and no button touches another.
    sharesRow(screen.getByRole("button", { name: "Stop here" }), screen.getByRole("button", { name: "OK" }));
    noTouchingButtons(screen.getByTestId("journey"));
    await waitFor(() => expect(tap).toBeEnabled());
    fireEvent.click(tap);
    await waitFor(() => expect(calls("start_experiment")).toHaveLength(2), { timeout: 3000 });
    expect(calls("start_experiment")[1]).toMatchObject({ recId: "sysmain", costAcknowledged: true });
  });

  it("a record from before Compy kept the confirmation says not recorded", async () => {
    render(<ExperimentBench />);
    await press();
    await finalLine();
    const rows = await receiptRows();
    expect(rows["Cost confirmed"]).toBe("not recorded");
    expect(rows.Cost).toBeUndefined(); // no catalog risk was kept either, so no cost words to show
  });

  it("a Trial whose record kept no catalog risk says not recorded, and lists no dimension", async () => {
    render(<ExperimentBench />);
    await press();
    await finalLine();
    const rows = await receiptRows();
    expect(rows["Risk, overall"]).toBe("not recorded");
    for (const label of ["Reversibility", "Stability", "Compatibility", "Security"]) expect(rows[label], label).toBeUndefined();
  });

  it("game exits early in session 2: too few readings is judged and the change is restored", async () => {
    state.saves = [session(later(1), 5400), session(later(2), 120)];
    state.concludeResult = { status: "restored", verdict: "insufficient-evidence" };
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Put HAGS back: there wasn't enough play with it on to judge.");
  });

  it("game exits before any reading was saved in session 2: the change is put back", async () => {
    state.saves = [session(later(1), 5400), null];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toMatch(/game closed before Compy had a reading, so Compy put HAGS back/);
    expect(calls("restore_experiment")).toEqual([{ experimentId: "exp:9-0" }]);
    expect(calls("conclude_experiment")).toHaveLength(0);
  });

  it("a session behind another window the whole time says so, as-is or with the change (P4-show-f1)", async () => {
    const behind = (at: string) => ({ ...session(at, 0), avg_fps: 0, low1_fps_est: 0, fps_series: [], background_secs_excluded: 900 });
    state.saves = [behind(later(1))];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe(
      "Compy didn't get a reading from that session: another window was in front the whole time. Nothing was changed.",
    );
    expect(calls("start_experiment")).toHaveLength(0);
    cleanup();
    resetJourneyForTests({ pollMs: 5, saveWaitMs: 40 });
    state.saves = [session(later(3), 5400), behind(later(4))];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toMatch(/another window was in front the whole time, so Compy put HAGS back/);
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
    expect(await finalLine()).toBe("Kept HAGS: average up 1.1%.");
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
    expect(await finalLine()).toBe("Kept HAGS: the frame rate in your worst moments (the 1% low) is up 4.2%.");
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
    expect(await finalLine()).toBe("Kept HAGS: the frame rate in your worst moments (the 1% low) is up 4.2%.");
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
    expect(await finalLine()).toBe("Kept HAGS: the frame rate in your worst moments (the 1% low) is up 4.2%.");
    expect(calls("start_experiment")).toHaveLength(1);
    expect(calls("start_experiment")[0].baselineSessionId).toBe(first.started_at);
    expect(calls("start_fps_capture")).toHaveLength(2);
  });
});

// P5-continue: a concluded journey says what it did in one line and offers the next untested change
// (P4-next) as one tap, reusing the last as-is session when the start accepts it, until nothing is left.
const lineIs = (text: string | RegExp) =>
  waitFor(() => expect(screen.getByTestId("journey-line").textContent).toMatch(text), { timeout: 3000 });

describe("P5-continue: the journey acts on the verdict and offers the next change", () => {
  it("kept then next: says what it kept and reuses the session measured with it as the next baseline", async () => {
    const asIs = session(later(1), 5400);
    const withHags = session(later(2), 5400);
    state.saves = [asIs, withHags, session(later(3), 5400)];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Kept HAGS: the frame rate in your worst moments (the 1% low) is up 4.2%.");
    expect(calls("restore_experiment")).toHaveLength(0);
    // Review 2026-11-02 (fix 2): Next, Stop here and OK touched; Stop here and OK share one row.
    sharesRow(screen.getByRole("button", { name: "Stop here" }), screen.getByRole("button", { name: "OK" }));
    noTouchingButtons(screen.getByTestId("journey"));
    fireEvent.click(screen.getByRole("button", { name: "Next: Game Mode, about 10 min" }));
    await lineIs(/^Game Mode is on\. Compy uses your last session as the before-reading, so this is the only session: play Valorant/);
    const [, second] = calls("start_experiment");
    expect(second).toMatchObject({ recId: "game-mode", baselineSessionId: withHags.started_at });
    // No new as-is session was measured for it.
    expect(calls("start_fps_capture")).toHaveLength(3);
    await lineIs("Kept Game Mode: the frame rate in your worst moments (the 1% low) is up 4.2%.");
    expect(calls("conclude_experiment")[1]).toMatchObject({ experimentId: "exp:10-0" });
  });

  it("restored then next: says why in plain words; a baseline the start refuses gets a new as-is session", async () => {
    const asIs = session(later(1), 5400);
    const fresh = session(later(3), 5400);
    state.saves = [asIs, session(later(2), 5400), fresh, session(later(4), 5400)];
    state.concludeResult = { status: "restored", verdict: "no-change", treatment: { ...TREATMENT, delta_low1_pct: 0.4 } };
    // The rollback moved after the as-is session, so the backend won't compare against it (§3).
    state.refuseBaselines = [`game-mode|${asIs.started_at}`];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Put HAGS back: it made no difference Compy could measure.");
    fireEvent.click(screen.getByRole("button", { name: "Next: Game Mode, about 10 min" }));
    await lineIs(/^Compy can't use your last session as the before-reading \(.*baseline session.*\), so it needs a new one\. Session 1 of 2: play Valorant/);
    await waitFor(() => expect(calls("start_experiment")).toHaveLength(3), { timeout: 3000 });
    const starts = calls("start_experiment");
    expect(starts[1]).toMatchObject({ recId: "game-mode", baselineSessionId: asIs.started_at });
    expect(starts[2]).toMatchObject({ recId: "game-mode", baselineSessionId: fresh.started_at });
    await lineIs("Put Game Mode back: it made no difference Compy could measure.");
    expect(calls("start_fps_capture")).toHaveLength(4);
  });

  it("restored then next: the as-is session is reused when the start accepts it", async () => {
    const asIs = session(later(1), 5400);
    state.saves = [asIs, session(later(2), 5400), session(later(3), 5400)];
    state.concludeResult = { status: "restored", verdict: "regressed", treatment: { ...TREATMENT, delta_low1_pct: -6 } };
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Put HAGS back: the game ran worse with it.");
    fireEvent.click(screen.getByRole("button", { name: "Next: Game Mode, about 10 min" }));
    await lineIs(/^Game Mode is on\. Compy uses your last session/);
    expect(calls("start_experiment")[1]).toMatchObject({ baselineSessionId: asIs.started_at });
    expect(calls("start_fps_capture")).toHaveLength(3);
  });

  it("next needs a new baseline when the last session was uneven, without trying to start on it", async () => {
    const fresh = session(later(3), 5400);
    state.saves = [session(later(1), 5400), uneven(later(2)), fresh, session(later(4), 5400)];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Kept HAGS: the frame rate in your worst moments (the 1% low) is up 4.2%.");
    fireEvent.click(screen.getByRole("button", { name: "Next: Game Mode, about 20 min (a new before-session first)" }));
    await lineIs(/^Session 1 of 2: play Valorant as usual/);
    await waitFor(() => expect(calls("start_experiment")).toHaveLength(2), { timeout: 3000 });
    expect(calls("start_experiment")[1]).toMatchObject({ recId: "game-mode", baselineSessionId: fresh.started_at });
  });

  it("nothing left: says so as a success and offers no next change", async () => {
    state.recs = [{ id: "hags", title: "HAGS", passes: true, reason: null, detail: null, position: 1, evidence: "not-measured", risk: "low" }];
    render(<ExperimentBench />);
    await press();
    expect(await finalLine()).toBe("Kept HAGS: the frame rate in your worst moments (the 1% low) is up 4.2%.");
    expect((await screen.findByTestId("journey-done")).textContent).toBe("Nothing else here is worth testing on this PC.");
    expect(screen.queryByRole("button", { name: /^Next:/ })).toBeNull();
  });

  // Review 2026-11-02 (fix 11, P8-posture-note): under "Low risk only" the journey said "Nothing else
  // here is worth testing on this PC." while changes were held back by that choice, and the summary
  // right below said "...N more changes are above it". "Nothing left" never hides the risk choice.
  const HELD = { id: "sysmain", title: "SysMain", passes: false, reason: "outside-chosen-risk", detail: null, position: null, evidence: "not-measured", risk: "moderate" };
  const ONLY_HAGS = { id: "hags", title: "HAGS", passes: true, reason: null, detail: null, position: 1, evidence: "not-measured", risk: "low" };
  it("nothing left, low risk only, a change held back: says nothing else WITHIN the risk chosen, here and once idle", async () => {
    localStorage.setItem("compy.trial.riskChoice", "low-only");
    try {
      state.recs = [ONLY_HAGS, HELD];
      render(<ExperimentBench />);
      await press();
      await finalLine();
      expect((await screen.findByTestId("journey-done")).textContent).toBe("Nothing else within the risk you chose is worth testing on this PC.");
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
      await waitFor(() =>
        expect(screen.getByTestId("journey-progress").textContent).toBe("1 of 1 tested. Nothing else within the risk you chose is worth testing on this PC."),
      );
    } finally {
      localStorage.removeItem("compy.trial.riskChoice");
    }
  });

  it("nothing left, low risk only, nothing held back: keeps today's line", async () => {
    localStorage.setItem("compy.trial.riskChoice", "low-only");
    try {
      state.recs = [ONLY_HAGS];
      render(<ExperimentBench />);
      await press();
      await finalLine();
      expect((await screen.findByTestId("journey-done")).textContent).toBe("Nothing else here is worth testing on this PC.");
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
      await waitFor(() => expect(screen.getByTestId("journey-progress").textContent).toBe("1 of 1 tested. Nothing else here is worth testing on this PC."));
    } finally {
      localStorage.removeItem("compy.trial.riskChoice");
    }
  });

  it("a failure in the next journey still restores and says so", async () => {
    state.saves = [session(later(1), 5400), session(later(2), 5400), session(later(3), 5400)];
    render(<ExperimentBench />);
    await press();
    await finalLine();
    state.refuse = { conclude_experiment: "experiment not concluded — the disk was full" };
    fireEvent.click(screen.getByRole("button", { name: "Next: Game Mode, about 10 min" }));
    await lineIs(/^Something went wrong, so Compy put Game Mode back the way it was\. Nothing was kept\./);
    expect(calls("restore_experiment")).toEqual([{ experimentId: "exp:10-0" }]);
  });
});

// P5-realplay: "Test it while I play normally". The change goes on once and stays on while the owner
// plays however he plays; each tap measures one session; a decided look is concluded right after the
// session that decided it; a stopped test waits for a tap; "Put it back now" is the audited restore.
describe("P5-realplay: the change stays on while you play", () => {
  /** What get_realplay_progress answers for these records, the backend's way for this harness: before a
   *  start every session of the game with 600+ readings counts as-is (whatever its halves did), the
   *  newest the anchor; while a real-play Trial runs, the unpinned ones begun after its apply count
   *  with the change on, and three of them decide. `over` sets the answer's fields. */
  const backendLike =
    (over: Record<string, unknown> = {}) =>
    (game: string) => {
      const ok = countable(game);
      const run = state.experiments.find((x) => x.status === "running" && x.mode === "real-play");
      const base = { game, min_sessions: 3, max_sessions: 8, min_readings: 600, window_days: 14, band_pct: null, stop: null, not_counted: [] };
      if (!run) {
        const n = Math.min(ok.length, 8);
        return {
          ...base,
          phase: n >= 3 ? "ready-to-start" : "collecting-before",
          experiment_id: null,
          anchor_session_id: (ok[ok.length - 1]?.started_at as string) ?? null,
          before: n,
          with: 0,
          need: 3,
          applied_at: null,
          until: null,
          ...over,
        };
      }
      const pinned = new Set(((run.real_play as { before: { session_id: string }[] }).before ?? []).map((b) => b.session_id));
      const applied = Date.parse(run.applied_at as string);
      const withN = ok.filter((s) => !pinned.has(s.started_at as string) && Date.parse(s.started_at as string) > applied).length;
      return {
        ...base,
        phase: withN >= 3 ? "ready" : "collecting",
        experiment_id: run.id,
        anchor_session_id: null,
        before: pinned.size,
        with: withN,
        need: 3,
        applied_at: run.applied_at,
        until: new Date(applied + 14 * 86_400_000).toISOString(),
        ...over,
      };
    };
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const AS_IS = [session("2026-10-02T10:00:00Z", 5400), session("2026-10-03T10:00:00Z", 5400)];
  /** A real-play Trial of HAGS on Valorant, on since an hour ago, pinned on OLD and AS_IS. */
  const running = (over: Record<string, unknown> = {}) =>
    record({ mode: "real-play", applied_at: ago(60), real_play: { before: [OLD, ...AS_IS].map(numbers) }, ...over });
  const enabled = async (name: string) => {
    const btn = await screen.findByRole("button", { name });
    await waitFor(() => expect(btn).toBeEnabled());
    return btn;
  };
  const statusIs = (text: string) =>
    waitFor(() => expect(screen.getByTestId("realplay-status").textContent).toBe(text), { timeout: 3000 });
  const WON = {
    status: "kept",
    kept: true,
    verdict: "improved",
    verdict_confidence: "medium",
    outcome: "recommended",
    real_play: {
      before: [OLD, ...AS_IS].map(numbers),
      with: [1, 2, 3].map((i) => numbers(session(ago(10 * i), 5400))),
      band_pct: 3,
      delta_low1_pct: 12.1,
      delta_avg_pct: 0.4,
      low1_spread_pct: 1.1,
      avg_spread_pct: 0.6,
      look: 1,
    },
  };

  // ✗ on the code before real play: there was no real-play choice, and an uneven session 1 was retaken.
  it("an uneven as-is session counts toward real play, no retake", async () => {
    state.rpProgress = backendLike();
    state.sessions = [OLD, AS_IS[0]];
    const swinging = uneven(later(1));
    state.saves = [swinging];
    render(<ExperimentBench />);
    expect((await screen.findByTestId("journey-realplay-plan")).textContent).toBe(
      "Or test it while you play normally: Compy first measures 3 sessions of Valorant as your PC is now (2 so far), then turns HAGS on and leaves it on while you play however you like.",
    );
    fireEvent.click(await enabled("Test it while I play normally"));
    // The uneven session makes three: the change goes on through the audited start, on it.
    await waitFor(() => expect(calls("start_experiment")).toHaveLength(1), { timeout: 3000 });
    expect(calls("start_experiment")[0]).toMatchObject({ recId: "hags", mode: "real-play", baselineSessionId: swinging.started_at });
    expect(screen.queryByRole("button", { name: "Play one more as-is session" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Test anyway" })).toBeNull();
    expect(calls("start_fps_capture")).toHaveLength(1);
    // The panel now says the change is on, derived from the record and the progress read.
    expect((await screen.findByTestId("realplay-on")).textContent).toMatch(/^HAGS is on \(since .+\)\. It stays on while you play/);
    await statusIs("Keep playing, Compy is still collecting (0 of 3 sessions).");
    // Real play never tags the running Trial for the "interrupted" banner.
    expect(localStorage.getItem("compy.journey.running")).toBeNull();
  });

  it("while fewer than three as-is sessions count, one more is measured and nothing goes on", async () => {
    state.rpProgress = backendLike();
    state.sessions = [OLD];
    state.saves = [session(later(1), 5400)];
    render(<ExperimentBench />);
    fireEvent.click(await enabled("Test it while I play normally"));
    await waitFor(() => expect(screen.getByTestId("journey")).toHaveAttribute("data-phase", "rp-before"), { timeout: 3000 });
    expect(screen.getByTestId("journey-line").textContent).toBe(
      "Nothing has been changed yet. Keep playing, Compy is still collecting (2 of 3 sessions of Valorant as your PC is now).",
    );
    expect(screen.getByTestId("realplay-note").textContent).toBe("That session counts.");
    expect(calls("start_experiment")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Measure my next session" })).toBeEnabled();
    // Review 2026-11-02 (fix 2): "Measure my next session" touched "OK"; they share one row now.
    sharesRow(screen.getByRole("button", { name: "Measure my next session" }), screen.getByRole("button", { name: "OK" }));
    noTouchingButtons(screen.getByTestId("journey"));
  });

  // Review 2026-11-02 (fix 2): the offer's "Test it while I play normally" touched "Stop here" (0px).
  // The last row of the idle journey holds Stop here: beside the offer's button, else beside the start.
  it("the offer's button and Stop here share one row; with no offer, Stop here sits beside the start", async () => {
    state.rpProgress = backendLike();
    state.sessions = [OLD, ...AS_IS];
    // A journey under way on Valorant (Game Mode measured there), so Stop here is offered.
    state.experiments = [
      record({ id: "exp:1-0", rec_id: "game-mode", rec_title: "Game Mode", status: "restored", verdict: "no-change", treatment: TREATMENT, baseline_session_id: OLD.started_at, concluded_at: ago(90) }),
    ];
    const first = render(<ExperimentBench />);
    const offer = await enabled("Test it while I play normally");
    sharesRow(offer, screen.getByRole("button", { name: "Stop here" }));
    noTouchingButtons(screen.getByTestId("journey"));
    first.unmount();
    state.rpProgress = null;
    render(<ExperimentBench />);
    const start = await enabled("Optimize my game");
    expect(screen.queryByRole("button", { name: "Test it while I play normally" })).toBeNull();
    sharesRow(start, screen.getByRole("button", { name: "Stop here" }));
    noTouchingButtons(screen.getByTestId("journey"));
  });

  // ✗ on the code before real play: the journey concluded right after its one with-change session.
  it("after a with-change session it keeps collecting instead of concluding", async () => {
    state.experiments = [running()];
    state.sessions = [OLD, ...AS_IS];
    state.rpProgress = backendLike();
    state.closesAfter = null;
    state.saves = [session(later(1), 5400)];
    render(<ExperimentBench />);
    await statusIs("Keep playing, Compy is still collecting (0 of 3 sessions).");
    fireEvent.click(await enabled("Measure my next session"));
    await waitFor(() => expect(screen.getByTestId("journey-line").textContent).toBe(
      "HAGS is on. Play Valorant however you like; Compy stops measuring when you close the game.",
    ));
    expect(localStorage.getItem("compy.journey.recording")).toBe("real-play");
    fireEvent.click(screen.getByRole("button", { name: "Done playing" }));
    await statusIs("Keep playing, Compy is still collecting (1 of 3 sessions).");
    expect(screen.getByTestId("realplay-note").textContent).toBe("That session counts.");
    expect(calls("conclude_realplay")).toHaveLength(0);
    expect(calls("conclude_experiment")).toHaveLength(0);
    expect(calls("restore_experiment")).toHaveLength(0);
    expect(state.experiments[0]).toMatchObject({ status: "running" });
  });

  it("a decided look is concluded right after the session that decided it: Likely better, kept", async () => {
    state.experiments = [running()];
    state.sessions = [OLD, ...AS_IS, session(ago(30), 5400), session(ago(20), 5400)];
    state.rpProgress = backendLike();
    state.saves = [session(later(1), 5400)];
    state.concludeResult = WON;
    const announced = vi.fn();
    window.addEventListener(LEDGER_CHANGED_EVENT, announced);
    try {
      render(<ExperimentBench />);
      await statusIs("Keep playing, Compy is still collecting (2 of 3 sessions).");
      fireEvent.click(await enabled("Measure my next session"));
      expect(await finalLine()).toBe(
        "Likely better: Compy kept HAGS. With it on, your 1% low (the worst moments) was 12.1% higher across 3 sessions than across 3 without it, more than the ±3% your sessions vary on their own.",
      );
      expect(calls("conclude_realplay")).toEqual([{ experimentId: "exp:9-0", crashed: false }]);
      expect(announced).toHaveBeenCalled();
    } finally {
      window.removeEventListener(LEDGER_CHANGED_EVENT, announced);
    }
    expect(calls("conclude_experiment")).toHaveLength(0);
    expect(calls("restore_experiment")).toHaveLength(0);
    // After real play the idle panel offers the next change both ways; the result offers no pair "Next".
    expect(screen.queryByRole("button", { name: /^Next:/ })).toBeNull();
    expect(await receiptRows()).toMatchObject({
      "Way of measuring": "real-play",
      Verdict: "improved",
      Confidence: "medium",
      "Sessions without it": "3",
      "Sessions with it": "3",
      "Spread between sessions, 1% low": "±1.1%",
      "Deciding look": "1",
    });
    const journey = screen.getByTestId("journey");
    fireEvent.click(journey.querySelector('[data-testid="journey-depth-why"] > summary')!);
    await waitFor(() => expect(journey.querySelector(".journey-why")?.textContent).toMatch(/^Real play compares your sessions with the change on/));
  });

  it("Put it back now restores through restore_experiment and says so", async () => {
    state.experiments = [running()];
    state.sessions = [OLD, ...AS_IS];
    state.rpProgress = backendLike();
    const announced = vi.fn();
    window.addEventListener(LEDGER_CHANGED_EVENT, announced);
    try {
      render(<ExperimentBench />);
      fireEvent.click(await enabled("Put it back now"));
      expect(await finalLine()).toBe("Compy put HAGS back the way it was before the test. Nothing was judged.");
      expect(announced).toHaveBeenCalled();
    } finally {
      window.removeEventListener(LEDGER_CHANGED_EVENT, announced);
    }
    expect(calls("restore_experiment")).toEqual([{ experimentId: "exp:9-0" }]);
    expect(calls("conclude_realplay")).toHaveLength(0);
  });

  it("a test that stops after a session waits for the owner's tap, then closes through the conclude", async () => {
    state.experiments = [running()];
    state.sessions = [OLD, ...AS_IS, session(ago(30), 5400), session(ago(20), 5400)];
    // The change reads off after this session: the test can't go on, and nothing is judged until the tap.
    state.rpProgress = (g) => (state.sessions.length > 5 ? backendLike({ phase: "stopped", stop: "change-off", with: 2 })(g) : backendLike()(g));
    state.saves = [session(later(1), 5400)];
    state.concludeResult = {
      status: "restored",
      verdict: "confounded",
      stop_reason: "target-reverted-during-treatment",
      real_play: { before: [OLD, ...AS_IS].map(numbers), with: [1, 2].map((i) => numbers(session(ago(10 * i), 5400))), stop: "change-off" },
    };
    render(<ExperimentBench />);
    fireEvent.click(await enabled("Measure my next session"));
    await statusIs("HAGS no longer reads as on, so no new session can count. If it reads as on again, Compy keeps collecting.");
    expect(calls("conclude_realplay")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Measure my next session" })).toBeNull();
    expect(screen.getByTestId("realplay-close-how").textContent).toMatch(/^Closing judges the sessions Compy counted\./);
    fireEvent.click(await enabled("Close this test"));
    expect(await finalLine()).toBe(
      "Unknown: Compy put HAGS back. Only 2 sessions with it on were counted before the test stopped (it no longer read as on), too few to judge.",
    );
    expect(calls("conclude_realplay")).toEqual([{ experimentId: "exp:9-0", crashed: false }]);
  });

  it("a result a look decided while Compy was closed waits for See the result", async () => {
    state.experiments = [running()];
    state.sessions = [OLD, ...AS_IS];
    state.rpProgress = backendLike({ phase: "ready", with: 3 });
    state.concludeResult = WON;
    render(<ExperimentBench />);
    await statusIs("Compy has enough sessions for a result.");
    expect(calls("conclude_realplay")).toHaveLength(0);
    // Review 2026-11-02 (fix 4): before the tap, the panel says what the tap does.
    expect(screen.getByTestId("realplay-see-how").textContent).toBe(
      "Seeing the result ends the test: Compy keeps HAGS only if the result is Likely better, and otherwise puts it back the way it was before the test.",
    );
    fireEvent.click(await enabled("See the result"));
    expect(await finalLine()).toMatch(/^Likely better: Compy kept HAGS\./);
  });

  // Review 2026-11-02 (fix 8): a record that holds no numbers for its verdict (a crash one) said
  // "Unknown: ... doesn't hold the numbers" and, in its receipt, "Verdict regressed", "Confidence medium".
  it("a result whose record holds no numbers says not judged for its verdict and confidence, in en and zh-CN", async () => {
    const CRASHED = {
      status: "restored",
      kept: false,
      verdict: "regressed",
      verdict_confidence: "high",
      stop_reason: "crash-during-treatment",
      outcome: "recommended",
      real_play: { before: [OLD, ...AS_IS].map(numbers), with: [1, 2].map((i) => numbers(session(ago(10 * i), 5400))) },
    };
    for (const [lang, see, rows] of [
      ["en", "See the result", { verdict: "Verdict", confidence: "Confidence", word: "not judged" }],
      ["zh-CN", "查看结果", { verdict: "判定", confidence: "置信度", word: "未判定" }],
    ] as const) {
      cleanup();
      resetJourneyForTests({ pollMs: 5, saveWaitMs: 40 });
      await i18n.changeLanguage(lang);
      try {
        state.experiments = [running()];
        state.sessions = [OLD, ...AS_IS];
        state.rpProgress = backendLike({ phase: "ready", with: 3 });
        state.concludeResult = CRASHED;
        render(<ExperimentBench />);
        fireEvent.click(await enabled(see));
        const line = await finalLine();
        if (lang === "en") expect(line).toBe("Unknown: Compy put HAGS back. This record doesn't hold the numbers its verdict was judged on.");
        const receipt = await receiptRows();
        expect(receipt[rows.verdict], lang).toBe(rows.word);
        expect(receipt[rows.confidence], lang).toBe(rows.word);
      } finally {
        await i18n.changeLanguage("en");
      }
    }
  });

  it("with three as-is sessions the change goes on at once and the session about to be played is measured with it", async () => {
    state.rpProgress = backendLike();
    state.sessions = [OLD, ...AS_IS];
    state.saves = [session(later(1), 5400)];
    render(<ExperimentBench />);
    expect((await screen.findByTestId("journey-realplay-plan")).textContent).toBe(
      "Or test it while you play normally: HAGS goes on now and stays on while you play Valorant however you like, for up to 8 sessions or 14 days. Compy compares those sessions with your last 3 without it.",
    );
    fireEvent.click(await enabled("Test it while I play normally"));
    await statusIs("Keep playing, Compy is still collecting (1 of 3 sessions).");
    expect(calls("start_experiment")).toEqual([
      expect.objectContaining({ recId: "hags", mode: "real-play", baselineSessionId: AS_IS[1].started_at, outcome: "recommended", costAcknowledged: false }),
    ]);
    expect(calls("start_fps_capture")).toHaveLength(1);
    expect(calls("conclude_realplay")).toHaveLength(0);
    expect(localStorage.getItem("compy.journey.running")).toBeNull();
  });

  it("the two-session journey stays the default; with no progress read, real play isn't offered", async () => {
    state.rpProgress = backendLike();
    state.sessions = [OLD, ...AS_IS];
    render(<ExperimentBench />);
    await screen.findByTestId("journey-realplay-plan");
    await press();
    await finalLine();
    expect(calls("start_experiment")[0].mode).toBeUndefined();
    expect(calls("conclude_experiment")).toHaveLength(1);
    cleanup();
    resetJourneyForTests({ pollMs: 5, saveWaitMs: 40 });
    state.rpProgress = null;
    render(<ExperimentBench />);
    await screen.findByRole("button", { name: "Optimize my game" });
    expect(screen.queryByTestId("journey-realplay-plan")).toBeNull();
    expect(screen.queryByRole("button", { name: "Test it while I play normally" })).toBeNull();
  });

  it("a change that isn't low risk starts real play only from the tap on its cost line", async () => {
    state.recs = [
      { id: "hags", title: "HAGS", passes: true, reason: null, detail: null, position: 1, evidence: "not-measured", risk: "moderate", cost: "Reboot required." },
    ];
    state.rpProgress = backendLike();
    state.sessions = [OLD, ...AS_IS];
    state.saves = [session(later(1), 5400)];
    render(<ExperimentBench />);
    expect(await screen.findByTestId("journey-cost-ack")).toHaveTextContent("HAGS has a cost: Reboot required.");
    fireEvent.click(await enabled("I understand, test it while I play normally"));
    await waitFor(() => expect(calls("start_experiment")).toHaveLength(1), { timeout: 3000 });
    expect(calls("start_experiment")[0]).toMatchObject({ mode: "real-play", costAcknowledged: true });
  });

  // Rust review fix: a start that can't pin its as-is sessions says why (e.g. older than 14 days); the
  // journey shows the backend's words as they are, and nothing was changed.
  it("a refused real-play start shows the backend's reason as it is, and nothing goes on", async () => {
    const why =
      "experiment not started — real play can't pin the as-is sessions of Valorant: the newest one is older than 14 days, so play a new one, then start";
    state.rpProgress = backendLike();
    state.sessions = [OLD, ...AS_IS];
    state.refuse = { start_experiment: why };
    render(<ExperimentBench />);
    fireEvent.click(await enabled("Test it while I play normally"));
    expect(await finalLine()).toBe(`Compy didn't start the test, and nothing was changed: ${why}`);
    expect(calls("start_fps_capture")).toHaveLength(0);
    expect(calls("restore_experiment")).toHaveLength(0);
    // Review 2026-11-02 (fix 2): the generic OK sits in a row of its own, 9px under the line.
    expect(screen.getByRole("button", { name: "OK" }).parentElement).toHaveClass("exp-running-actions");
  });

  // Rust review fix: a long session with no frame-rate reading is not counted ("no-reading"). The
  // journey never reads such a session back itself, so the note takes the backend's reason for it.
  it("a session saved without a frame-rate reading is named with the backend's reason", async () => {
    state.experiments = [running()];
    state.sessions = [OLD, ...AS_IS];
    const blank = { ...session(later(1), 5400), avg_fps: 0, low1_fps_est: 0, fps_series: [] };
    state.saves = [blank];
    state.rpProgress = (g) =>
      state.sessions.includes(blank) ? backendLike({ not_counted: [{ session_id: blank.started_at, reason: "no-reading" }] })(g) : backendLike()(g);
    render(<ExperimentBench />);
    fireEvent.click(await enabled("Measure my next session"));
    await waitFor(() => expect(screen.getByTestId("realplay-note").textContent).toBe("That session doesn't count: no frame-rate reading."), {
      timeout: 3000,
    });
    expect(screen.getByTestId("realplay-not-counted").textContent).toMatch(/no frame-rate reading/);
    await statusIs("Keep playing, Compy is still collecting (0 of 3 sessions).");
  });

  it("a failure while measuring judges nothing, leaves the change on and says so", async () => {
    state.experiments = [running()];
    state.sessions = [OLD, ...AS_IS];
    state.rpProgress = backendLike();
    state.refuse = { start_fps_capture: "helper did not launch" };
    render(<ExperimentBench />);
    fireEvent.click(await enabled("Measure my next session"));
    expect(await finalLine()).toBe(
      "Compy couldn't finish that step, so nothing was judged. HAGS is still on until you close the test or put it back. (helper did not launch)",
    );
    expect(calls("restore_experiment")).toHaveLength(0);
    expect(state.experiments[0]).toMatchObject({ status: "running" });
  });
});
