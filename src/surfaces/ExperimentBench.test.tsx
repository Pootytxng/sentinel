// Intelligence Phase 3 — the experiment-bench surface. While the backend gate is false it renders
// NOTHING (mutation-gate item 7 — mechanized "FE renders nothing while gated"). When an owner-signed
// build arms the gate the interactive bench renders: a change picker → honest simulator read →
// start-against-a-real-baseline, a running panel (conclude / restore), and the honest history list.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { LEDGER_CHANGED_EVENT } from "../types";
import i18n from "../i18n";

const state = vi.hoisted(() => ({
  gate: false,
  experiments: [] as unknown[],
  recs: [] as unknown[],
  sessions: [] as unknown[],
  sim: null as unknown,
  simHang: false, // when true, simulate_optimization stays pending → lets a test observe the in-flight lock
  loadGate: null as Promise<void> | null, // when set, the initial ledger reads block on it
  refuse: {} as Record<string, string>, // a lifecycle command the backend refuses, with its message
  changes: [] as unknown[], // get_applied_changes (the P5-outcomes undo reads it)
  smoothReady: null as unknown, // get_smoothest_readiness; "reject" = the check failed
  realPlay: null as unknown, // P5-realplay: get_realplay_progress; "reject" = the read failed
  preflight: null as unknown, // TG-preflight: trial_preflight; "reject" = the read failed
}));

/** Hold the initial ledger reads until the returned function is called.
 *
 *  This used to be a wall-clock `loadDelayMs = 80`, which made the test that uses it a race it lost
 *  under load: the delay is measured against the runner's clock, but the assertion it guards runs
 *  after an `await findByRole`, and on a busy machine that await can outlast 80ms — at which point
 *  the options HAVE arrived, the "precondition" that the option is absent fails, and a green test
 *  turns red for reasons that have nothing to do with the code. Latency simulated with a timer is
 *  not a slow backend, it is a second racer. A gate the test opens itself is the same scenario with
 *  the race removed. */
const holdInitialLoad = () => {
  let open!: () => void;
  state.loadGate = new Promise<void>((resolve) => (open = resolve));
  return open;
};

/** Resolves only once any gate the test installed is open, so `busy` is still true when it looks. */
const afterLoad = <T,>(value: T): Promise<T> =>
  state.loadGate ? state.loadGate.then(() => value) : Promise.resolve(value);

const KEPT_EXPERIMENT = {
  id: "exp:1-0",
  rec_id: "hags",
  rec_title: "Hardware-accelerated GPU scheduling",
  game: "Valorant",
  hypothesis: "HAGS may lower frame-time variance",
  created_at: "2026-07-17T00:00:00Z",
  status: "kept",
  baseline_avg_fps: 240,
  baseline_low1_fps: 180,
  active_changes_at_start: 0,
  attribution_warning: null,
  noise_floor_pct: 3.0,
  treatment: {
    avg_fps: 250,
    low1_fps: 200,
    samples: 5000,
    crashed: false,
    delta_low1_pct: 11.1,
    recorded_at: "2026-07-17T01:00:00Z",
  },
  verdict: "improved",
  kept: true,
  stop_reason: null,
  concluded_at: "2026-07-17T01:00:00Z",
};

const RUNNING_EXPERIMENT = {
  ...KEPT_EXPERIMENT,
  id: "exp:2-0",
  status: "running",
  treatment: null,
  verdict: null,
  kept: false,
  concluded_at: null,
  baseline_session_id: "2026-07-16T22:00:00Z",
  applied_at: "2026-07-17T00:00:00Z",
};

// A concluded experiment whose treatment session measured a DIFFERENT game than the baseline: the
// backend's defense-in-depth game-match guard (2026-07-18) declines with the "not-comparable"
// verdict + Unknown confidence + restore. The FE must render a plain-English label, never the raw slug.
const NOT_COMPARABLE_EXPERIMENT = {
  ...KEPT_EXPERIMENT,
  id: "exp:3-0",
  status: "restored",
  verdict: "not-comparable",
  verdict_confidence: "unknown",
  verdict_note:
    "The test session measured a different game (cs2.exe) than the baseline (Valorant), so this " +
    "isn't a comparable before/after — that's not enough comparable evidence to judge the change.",
  kept: false,
};

const VALORANT_SESSION = {
  started_at: "2026-07-17T02:00:00Z",
  duration_secs: 1800,
  process_name: "Valorant",
  samples: 5400,
  avg_fps: 244,
  avg_frametime_ms: 4.1,
  low1_fps_est: 182,
  peak_gpu_temp_c: 61,
  peak_gpu_usage_pct: 88,
  peak_ram_used_bytes: 12_000_000_000,
  ram_total_bytes: 31_000_000_000,
  compy_changes_active: 0,
  // A steady trace (Trial Protocol §2): a baseline is graded on its 10 s fps buckets.
  fps_series: Array.from({ length: 180 }, (_, i) => [i * 10, 244] as [number, number]),
};

const WORTH_TESTING_SIM = {
  rec_id: "test-rec",
  rec_title: "Test tweak",
  verdict: "worth-testing",
  confidence: "medium",
  why: "This setting plausibly affects frame pacing on this class of GPU.",
  hardware_factor: "Your RX 9070 XT supports the underlying feature.",
  metric_to_watch: "1% low FPS",
  disproof: "1% low FPS stays within the 3% noise floor across a full session.",
  is_promise: false,
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    switch (cmd) {
      case "get_experiment_gate":
        return Promise.resolve(state.gate);
      case "get_experiments":
        return afterLoad(state.gate ? state.experiments : []);
      case "get_trial_candidates":
        return afterLoad(state.recs);
      case "get_session_summaries":
        return afterLoad(state.sessions);
      case "get_applied_changes":
        return Promise.resolve(state.changes);
      case "get_smoothest_readiness":
        return state.smoothReady === "reject" ? Promise.reject("unreadable") : Promise.resolve(state.smoothReady);
      case "get_realplay_progress":
        return state.realPlay === "reject"
          ? Promise.reject("Compy can't read its change history: the ledger was set aside")
          : Promise.resolve(state.realPlay);
      case "trial_preflight":
        return state.preflight === "reject" ? Promise.reject("unreadable") : Promise.resolve(state.preflight);
      case "simulate_optimization":
        if (state.simHang) return new Promise(() => {}); // never resolves
        return state.sim ? Promise.resolve(state.sim) : Promise.reject("no sim");
      case "start_experiment":
      case "conclude_experiment":
      case "restore_experiment":
        return cmd in state.refuse ? Promise.reject(state.refuse[cmd]) : Promise.resolve({});
      default:
        return Promise.resolve(null);
    }
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import ExperimentBench from "./ExperimentBench";
import { resetJourneyForTests } from "./GuidedJourney";
import { whenText } from "./journey-realplay";
import { invalidateProbe, putProbe } from "../data/probe-cache";

/** The args of the one call to `cmd` since the last `mockClear`. */
const callArgs = (cmd: string) => {
  const calls = vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);
  expect(calls, `exactly one ${cmd} call`).toHaveLength(1);
  return calls[0][1];
};

afterEach(() => {
  cleanup();
  state.gate = false;
  state.experiments = [];
  state.recs = [];
  state.sessions = [];
  state.sim = null;
  state.simHang = false;
  state.loadGate = null;
  state.refuse = {};
  state.changes = [];
  state.smoothReady = null;
  state.realPlay = null;
  // A real-play panel tap runs in the journey's module store; nothing of it may reach the next test.
  resetJourneyForTests();
  localStorage.removeItem("compy.journey.running");
});

// bug->guard (CI run 30696118350, 2026-08-01). Picking a value that has NO matching option yet is a
// SILENT NO-OP: the value stays "", onChange runs with "", no simulation is requested, and nothing
// anywhere reports a problem.
//
// Every test here used to fire straight at whatever `findByRole("combobox")` returned. That resolves
// the moment the control exists — but the OPTIONS arrive separately, from get_trial_candidates. On a
// fast desk both land in the same microtask flush, so it worked ~always. On a loaded CI runner the
// recs landed after the change event, the pick evaporated, and the failure surfaced three lines
// down as "Unable to find an element with the text: Worth testing" — accusing the assertion instead
// of the interaction that never happened. (The DOM dump in that run showed the options present,
// because by the time findByText gave up 1s later they had finally loaded. That is what made it
// read as a rendering bug rather than an ordering one.)
//
// So: wait for the option to EXIST, wait for the control to be USABLE, fire, then PROVE the pick
// took. Do not replace this with a bare fireEvent — the entire failure mode is that a bare
// fireEvent looks like it worked.
//
// C-10 (2026-08-18): the control is `design/Picker.tsx` now, not a native <select>, so the shape of
// each step changed while every step survived. The options live in a listbox PORTALLED to <body>,
// addressed by `[data-value]` (the replacement for `<option value>`), and the pick is proven by the
// trigger's rendered label rather than by a form value.
const pickChange = async (value: string) => {
  const trigger = await screen.findByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  const option = await waitFor(() => {
    const el = document.querySelector(`[role="listbox"] [data-value="${value}"]`);
    expect(el, `no option [data-value="${value}"] yet`).not.toBeNull();
    return el as HTMLElement;
  });
  const label = option.textContent ?? "";
  fireEvent.click(option);
  await waitFor(() => expect(trigger).toHaveTextContent(label));
  return trigger;
};

// A noise sentence now carries glossed terms ("noise floor", "1% low") as their own buttons, so the
// sentence spans several nodes: match the innermost element whose whole text is the line.
const wholeLine = (line: string) => (_: string, el: Element | null) =>
  !!el && el.textContent === line && ![...el.children].some((c) => c.textContent === line);

describe("ExperimentBench (dark)", () => {
  it("renders NOTHING while the backend gate is hard-false (every shipped build today)", async () => {
    const { container } = render(<ExperimentBench />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(screen.queryByTestId("experiment-bench")).toBeNull();
  });
});

describe("ExperimentBench (armed)", () => {
  it("renders the measurement framing + honest history verdicts, never a raw enum", async () => {
    state.gate = true;
    state.experiments = [KEPT_EXPERIMENT];
    render(<ExperimentBench />);
    expect(await screen.findByTestId("experiment-bench")).toBeInTheDocument();
    // Measurement framing (intimidation pass 2026-08-21: the opener is one sentence of what Compy
    // DOES — baseline, one change, measure, put it back — not a paragraph; the retired "it never
    // promises a gain" vow-of-silence line is gone, per the reframed honest-measurement law).
    expect(screen.getByRole("heading", { name: "Test one change" })).toBeInTheDocument();
    const hint = screen.getByText(/measures a baseline/);
    expect(hint.textContent).toBe(
      "Compy measures a baseline, applies one reversible change, measures a real session, and puts the change back unless the numbers clearly beat the noise.",
    );
    expect(hint.textContent!.split(/\s+/).length).toBeLessThanOrEqual(30);
    expect(hint.textContent).not.toMatch(/never promises/);
    // The kept experiment renders its plain-English honest verdict, not a raw enum string.
    expect(await screen.findByText("Measurably faster — kept")).toBeInTheDocument();
    expect(screen.getByText("Hardware-accelerated GPU scheduling")).toBeInTheDocument();
  });

  // Guard for the treatment-game comparability fix (2026-07-18): the backend can now return a
  // "not-comparable" verdict when the treatment session measured a different game than the baseline.
  // The history list must render a friendly label for it — never leak the raw "not-comparable" slug.
  it("renders a plain-English label for a not-comparable (different-game) verdict, never the raw slug", async () => {
    state.gate = true;
    state.experiments = [NOT_COMPARABLE_EXPERIMENT];
    render(<ExperimentBench />);
    expect(await screen.findByTestId("experiment-bench")).toBeInTheDocument();
    expect(await screen.findByText("Not comparable — restored")).toBeInTheDocument();
    expect(screen.queryByText("not-comparable")).toBeNull();
    // The label can't say which pair failed, so the backend's reason is said once under the list.
    expect(screen.getByText(NOT_COMPARABLE_EXPERIMENT.verdict_note)).toBeInTheDocument();
    expect(rowMarks()).toEqual(["*"]);
    expectEachNoteOnceAndOffTheRows();
  });

  // Codex r4 (#611): a crash whose two sessions share no recorded rig context is restored as
  // "not-comparable" with an unknown pairing. The label once read "Different game", a mismatch nobody
  // measured; the bench now claims no cause of its own and says the backend's reason.
  it("never names a cause the record doesn't carry: an unknown crash pairing is not a different game", async () => {
    state.gate = true;
    const why =
      "The game crashed, but that session and the baseline share no recorded rig or conditions, so " +
      "Compy can't check that nothing else changed. So the crash can't be pinned on this setting. " +
      "Compy restored the change.";
    state.experiments = [
      { ...NOT_COMPARABLE_EXPERIMENT, stop_reason: "crash-session-comparability-unknown", verdict_note: why },
    ];
    render(<ExperimentBench />);
    expect(await screen.findByText("Not comparable — restored")).toBeInTheDocument();
    expect(screen.getByTestId("experiment-bench").textContent).not.toMatch(/different game/i);
    expect(screen.getByText(why)).toBeInTheDocument();
    expect(screen.queryByText(/crash-session-comparability-unknown/)).toBeNull();
    expectEachNoteOnceAndOffTheRows();
  });

  it("picking a change runs the simulator and offers Start against the real baseline", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    await pickChange("test-rec");

    // Honest simulator card renders the verdict label + the disproof + the real baseline numbers.
    expect(await screen.findByText("Worth testing")).toBeInTheDocument();

    // bug->guard (CI, 2026-08-01): everything below used to be a synchronous getBy after that one
    // findBy. The card does not commit in a single pass — the verdict label can be on screen a frame
    // before the baseline numbers and the Start button are, and the suite already said so out loud:
    // "An update to ExperimentBench inside a test was not wrapped in act(...)". Under parallel load
    // on a CI runner that gap widens and the assertions read a half-rendered card. This failed once
    // on the runner and passes 5/5 in isolation, which is the signature of a race rather than a
    // defect. Waiting for the TERMINAL state — an enabled Start button, which cannot exist until the
    // simulation has fully landed — makes everything below true instead of usually-true.
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    await waitFor(() => expect(start).toBeEnabled());

    // The card names the exact change under test — the mutation target the Start button will apply.
    expect(document.querySelector(".exp-sim-rec")?.textContent).toBe("Test tweak");
    expect(screen.getByText(/Disproved if:/)).toBeInTheDocument();
    expect(screen.getByText(/244/)).toBeInTheDocument(); // baseline avg fps
  });

  // P4-candidates / GB-picker (owner rig, 2026-10-23): `game-bar-disable` was never offered and the
  // picker said nothing about why. On that rig Windows already had Game Bar capture and Game DVR off
  // (AppCaptureEnabled = 0, GameDVR_Enabled = 0, no Compy row), so leaving it out was right; the
  // reason was missing. The picker now offers only changes worth testing on this PC and lists the
  // rest, each with its reason, behind a toggle. Advice-only changes (no one-click apply) used to be
  // offered too and dead-ended at Start.
  it("offers only changes worth testing on this PC and says why the others aren't listed", async () => {
    state.gate = true;
    state.recs = [
      { id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null },
      { id: "game-bar-disable", title: "Disable Game Bar and Game DVR", passes: false, reason: "already-set", detail: null },
      { id: "game-mode", title: "Enable Windows Game Mode", passes: false, reason: "already-set-by-compy", detail: null },
      { id: "hdr-advisory", title: "Check HDR", passes: false, reason: "no-safe-apply", detail: null },
      { id: "sysmain-disable", title: "Disable SysMain", passes: false, reason: "already-set-by-gaming-mode", detail: null },
      { id: "mouse-accel-off", title: "Turn off mouse acceleration", passes: false, reason: "already-set-unchecked", detail: null },
      { id: "nagle-disable", title: "Disable Nagle", passes: false, reason: "already-set-unconfirmed", detail: null },
      {
        id: "game-mode-stuck",
        title: "Windows Game Mode",
        passes: false,
        reason: "already-set-by-gaming-mode-restore-unfinished",
        detail: null,
      },
      {
        id: "eee-disable",
        title: "Turn off Energy-Efficient Ethernet",
        passes: false,
        reason: "not-for-this-pc",
        detail: "No wired Ethernet port.",
      },
    ];
    render(<ExperimentBench />);
    const trigger = await screen.findByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(document.querySelector('[role="listbox"] [data-value="test-rec"]')).not.toBeNull(),
    );
    const offered = [...document.querySelectorAll('[role="listbox"] [data-value]')]
      .map((el) => el.getAttribute("data-value"))
      .filter((v) => v);
    expect(offered).toEqual(["test-rec"]);
    fireEvent.click(trigger); // close the menu

    // The reasons sit behind the toggle, closed by default.
    const toggle = screen.getByRole("button", { name: "Show why others aren't listed" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".exp-why-list")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide why others aren't listed" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const row = (id: string) => document.querySelector(`.exp-why-list [data-rec="${id}"]`)?.textContent ?? "";
    expect(row("game-bar-disable")).toBe(
      "Disable Game Bar and Game DVR Already set this way in Windows, not by Compy.",
    );
    expect(row("game-mode")).toContain("Already set. Compy applied it.");
    expect(row("hdr-advisory")).toContain("Advice only.");
    expect(row("sysmain-disable")).toContain("Compy's Gaming Mode set it for this session");
    expect(row("mouse-accel-off")).toContain("Compy couldn't check whether it made this change.");
    expect(row("nagle-disable")).toContain("Compy applied this earlier but can't confirm");
    expect(row("nagle-disable")).not.toContain("not by Compy");
    expect(row("game-mode-stuck")).toContain("hasn't finished putting it back");
    expect(row("game-mode-stuck")).not.toContain("when the session ends");
    expect(row("eee-disable")).toContain("Doesn't fit this PC's hardware. No wired Ethernet port.");
    expect(row("test-rec")).toBe("");
  });

  // P8-posture-b (RISK_MODEL §2): the Trial asks once how far Compy may go, saves the answer, and every
  // candidate read carries it. A change above the chosen risk is listed with that reason, never dropped.
  it("asks once how far Compy may go, sends it with every candidate read, and saves a change", async () => {
    localStorage.removeItem("compy.trial.riskChoice");
    state.gate = true;
    state.recs = [
      { id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null },
      { id: "mod-rec", title: "Moderate tweak", passes: false, reason: "outside-chosen-risk", detail: null },
    ];
    render(<ExperimentBench />);
    const risk = await screen.findByRole("combobox", { name: "How far may Compy go on this PC?" });
    expect(risk).toHaveTextContent("Low and moderate risk");
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_trial_candidates", { riskChoice: "low-and-moderate" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show why others aren't listed" }));
    expect(document.querySelector('.exp-why-list [data-rec="mod-rec"]')?.textContent).toContain(
      "Outside the risk you chose.",
    );

    vi.mocked(invoke).mockClear();
    await waitFor(() => expect(risk).toBeEnabled());
    fireEvent.click(risk);
    const low = await waitFor(() => {
      const el = document.querySelector('[role="listbox"] [data-value="low-only"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(low);
    await waitFor(() => expect(risk).toHaveTextContent("Low risk only"));
    expect(localStorage.getItem("compy.trial.riskChoice")).toBe("low-only");
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_trial_candidates", { riskChoice: "low-only" }),
    );
    localStorage.removeItem("compy.trial.riskChoice");
  });

  // bug->guard (review MUST-FIX, 2026-10-28): a slow read made under the OLD risk answer landed after
  // the new one and offered a change above the chosen risk again. The latest read must win.
  it("a slower read under the old risk answer never overwrites the newer one", async () => {
    localStorage.removeItem("compy.trial.riskChoice");
    state.gate = true;
    const low = { id: "low-rec", title: "Low tweak", passes: true, reason: null, detail: null };
    const mod = { id: "mod-rec", title: "Moderate tweak", passes: true, reason: null, detail: null };
    const base = vi.mocked(invoke).getMockImplementation()!;
    // The first read lands at once (P8-launch-flash holds the risk answer until it has); every later
    // read under the old answer is the slow one.
    let reads = 0;
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: { riskChoice?: string }) => {
      if (cmd !== "get_trial_candidates") return base(cmd, args as never);
      reads += 1;
      return args?.riskChoice === "low-only"
        ? Promise.resolve([low, { ...mod, passes: false, reason: "outside-chosen-risk" }])
        : reads === 1
          ? Promise.resolve([low, mod])
          : new Promise((r) => setTimeout(() => r([low, mod]), 150));
    }) as typeof base);
    try {
      render(<ExperimentBench />);
      const risk = await screen.findByRole("combobox", { name: "How far may Compy go on this PC?" });
      await waitFor(() => expect(risk).toBeEnabled());
      // A refresh under the old answer is in flight when the answer changes.
      fireEvent(window, new Event(LEDGER_CHANGED_EVENT));
      await waitFor(() => expect(reads).toBe(2));
      fireEvent.click(risk);
      const opt = await waitFor(() => {
        const el = document.querySelector('[role="listbox"] [data-value="low-only"]');
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      fireEvent.click(opt);
      await waitFor(() => expect(risk).toHaveTextContent("Low risk only"));
      await new Promise((r) => setTimeout(r, 250)); // let the old, slow read land
      const pick = screen.getByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") });
      fireEvent.click(pick);
      await waitFor(() => expect(document.querySelector('[role="listbox"] [data-value="low-rec"]')).not.toBeNull());
      expect(document.querySelector('[role="listbox"] [data-value="mod-rec"]')).toBeNull();
    } finally {
      vi.mocked(invoke).mockImplementation(base);
      localStorage.removeItem("compy.trial.riskChoice");
    }
  });

  it("reads a saved risk answer back on the next visit, and ignores an unknown one", async () => {
    localStorage.setItem("compy.trial.riskChoice", "low-only");
    state.gate = true;
    render(<ExperimentBench />);
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_trial_candidates", { riskChoice: "low-only" }),
    );
    cleanup();
    vi.mocked(invoke).mockClear();
    localStorage.setItem("compy.trial.riskChoice", "anything-goes");
    render(<ExperimentBench />);
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_trial_candidates", { riskChoice: "low-and-moderate" }),
    );
    localStorage.removeItem("compy.trial.riskChoice");
  });

  // P4-rank (ENGINE §3.5, §3.7, §4): the picker used to offer changes in catalog order with no
  // reason for the order. It now follows the backend's suggested order (stronger evidence, then lower
  // risk), shows one reason per position, says when no effect size is known, and names a change too
  // small to measure here with the numbers that decided it.
  it("offers changes in the suggested test order, one reason each, and names a too-small change", async () => {
    state.gate = true;
    state.recs = [
      { id: "late", title: "Unmeasured tweak", passes: true, reason: null, detail: null,
        position: 2, evidence: "not-measured", risk: "moderate", stated_effect_pct: null, too_small: null },
      { id: "early", title: "Measured tweak", passes: true, reason: null, detail: null,
        position: 1, evidence: "measured", risk: "low", stated_effect_pct: null, too_small: null },
      { id: "tiny", title: "Tiny tweak", passes: false, reason: "too-small-to-measure-here", detail: null,
        position: null, evidence: "measured", risk: "low", stated_effect_pct: 1.5,
        too_small: { effect_pct: 1.5, band_pct: 4.2 } },
    ];
    render(<ExperimentBench />);
    const trigger = await screen.findByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(document.querySelector('[role="listbox"] [data-value="late"]')).not.toBeNull(),
    );
    const offered = [...document.querySelectorAll('[role="listbox"] [data-value]')]
      .map((el) => el.getAttribute("data-value"))
      .filter((v) => v);
    expect(offered).toEqual(["early", "late"]);
    fireEvent.click(trigger);

    const order = [...document.querySelectorAll(".exp-order-list li")].map((li) => li.textContent);
    expect(order).toEqual([
      "Measured tweak backed by measurements; low risk.",
      "Unmeasured tweak expected to help, not measured; moderate risk.",
    ]);
    expect(screen.getByText("Suggested order to test:")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Compy doesn't know how big any of these effects are, so none was left out as too small to measure here.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show why others aren't listed" }));
    expect(document.querySelector('.exp-why-list [data-rec="tiny"]')?.textContent).toBe(
      "Tiny tweak Too small to measure here. Its expected effect (1.5%) is no bigger than this game's measured run-to-run noise (4.2%).",
    );
  });

  it("shows no reasons toggle when every change is worth testing", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    render(<ExperimentBench />);
    await screen.findByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") });
    await waitFor(() => expect(screen.queryByText("Nothing worth testing on this PC right now.")).toBeNull());
    expect(screen.queryByRole("button", { name: /why others aren't listed/ })).toBeNull();
  });

  // bug->guard (P4-next, 2026-10-25): this flaked because "Nothing worth testing" rendered from the
  // EMPTY list before get_trial_candidates answered, so findByText won and the reasons button wasn't
  // there yet. An empty list before the load is not an empty catalog: the line waits for the load.
  it("with nothing worth testing, says so and still offers the reasons", async () => {
    state.gate = true;
    state.recs = [
      { id: "game-bar-disable", title: "Disable Game Bar and Game DVR", passes: false, reason: "already-set", detail: null },
    ];
    const open = holdInitialLoad();
    render(<ExperimentBench />);
    await screen.findByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") });
    expect(screen.queryByText("Nothing worth testing on this PC right now.")).toBeNull();
    open();
    expect(await screen.findByText("Nothing worth testing on this PC right now.")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Show why others aren't listed" }));
    expect(screen.getByText("Already set this way in Windows, not by Compy.")).toBeInTheDocument();
  });

  // P8-launch-flash (desk review 2026-11-02): until the first read returns, the bench can't know a
  // Trial is running and shows the launcher (about 3 s on the owner's rig). Its risk picker was live
  // then, so a pick saved a new risk choice while a Trial ran.
  it("holds the risk picker until the first read returns", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    const open = holdInitialLoad();
    render(<ExperimentBench />);
    const risk = await screen.findByRole("combobox", { name: "How far may Compy go on this PC?" });
    expect(risk).toBeDisabled();
    open();
    await waitFor(() => expect(risk).toBeEnabled());
  });

  // bug->guard (independent review, 2026-08-18): the C-10 port first carried the empty entry as the
  // Picker's `placeholder`, which is not an option and so cannot be chosen. That silently removed
  // the `<select>`'s blank `<option value="">` — the only way back out of a pick — and no test
  // noticed, because every test only ever picks FORWARD. This one goes back.
  it("the empty entry is re-selectable, and choosing it clears the pick and the simulator card", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    const trigger = await pickChange("test-rec");
    expect(await screen.findByText("Worth testing")).toBeInTheDocument();

    fireEvent.click(trigger);
    const empty = await waitFor(() => {
      const el = document.querySelector('[role="listbox"] [data-value=""]');
      expect(el, "the empty entry is not in the list at all").not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(empty);

    await waitFor(() => expect(screen.queryByText("Worth testing")).toBeNull());
    expect(trigger).not.toHaveTextContent("Test tweak");
    expect(screen.queryByRole("button", { name: /Start experiment/ })).toBeNull();
  });

  // The regression test for the CI failure itself, run under the condition that produced it: the
  // initial ledger reads land LATE, so the picker is still disabled when a test first reaches it.
  // This is what a loaded runner does to this component. Before the fix the change event vanished
  // and this test died on "Worth testing"; the assertion below only holds if the interaction waited.
  it("picks correctly even when the initial ledger reads land LATE (the loaded-CI-runner case)", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    const landTheReads = holdInitialLoad(); // nothing loads until this test says so
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    // The precondition that makes this test meaningful: the option really is absent at first, so a
    // bare fireEvent here would set nothing. If this ever stops being true the repro has rotted and
    // the test below is passing for the wrong reason. Held open by the gate rather than by a timer,
    // so a slow machine cannot let the reads land early and turn the precondition into a race.
    const trigger = await screen.findByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") });
    fireEvent.click(trigger);
    expect(document.querySelector('[role="listbox"] [data-value="test-rec"]')).toBeNull();
    fireEvent.click(trigger); // close again, so pickChange below drives it from the same state

    landTheReads();
    await pickChange("test-rec");

    expect(await screen.findByText("Worth testing")).toBeInTheDocument();
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    await waitFor(() => expect(start).toBeEnabled());
  });

  // Guard for W1 (mutation-boundary race, 2026-07-17): a fast reselect mid-simulation could leave the
  // launcher's `sim` — and thus the Start button's apply payload — pointing at a rec the dropdown no
  // longer shows. The picker MUST lock while a simulate_optimization call is in flight.
  it("locks the change picker while a simulation is in flight (no reselect race at the apply boundary)", async () => {
    state.gate = true;
    state.recs = [
      { id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null },
      { id: "other-rec", title: "Other tweak", passes: true, reason: null, detail: null },
    ];
    state.sessions = [VALORANT_SESSION];
    state.simHang = true; // simulate_optimization stays pending so we can observe the in-flight lock
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    await pickChange("test-rec");

    await waitFor(() => expect(screen.getByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") })).toBeDisabled());
  });

  // Guard for W2 (Intelligence Phase 3 fast-follow, 2026-07-17): the bench loads once when the gate
  // arms, so a change applied over in Optimize during the same Lab visit would leave the picker's
  // simulator read stale — still saying "Worth testing" + offering Start for a change already applied.
  // On refocus the bench MUST reload the ledger and re-derive the active pick's verdict, and the pick
  // must stay visible (resolving to "already configured") rather than silently vanishing.
  it("re-derives the active pick from the live ledger on refocus (no stale 'worth-testing' after a sibling apply)", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    await pickChange("test-rec");
    expect(await screen.findByText("Worth testing")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Start experiment/ })).toBeEnabled());

    // A sibling Optimize apply lands: the same rec is now applied and the sim re-reads as already-configured.
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: false, reason: "already-set", detail: null }];
    state.sim = { ...WORTH_TESTING_SIM, verdict: "already-configured" };
    fireEvent.focus(window);

    await waitFor(() => expect(screen.getByText("Already configured")).toBeInTheDocument());
    expect(screen.queryByText("Worth testing")).toBeNull();
    // Start is no longer offered for an already-applied change (the blocked verdict hides the launcher CTA).
    expect(screen.queryByRole("button", { name: /Start experiment/ })).toBeNull();
    // …and the pick stayed visible in the dropdown instead of silently disappearing. The Picker
    // (C-10) shows the chosen option's LABEL on its trigger; there is no form value to read.
    expect(screen.getByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") })).toHaveTextContent("Test tweak");
  });

  // Guard for Measurement-2.0 Task A (2026-07-18): the refocus fix (W2) only fires on OS focus /
  // visibilitychange — a change applied over in the sibling Optimize station during the SAME window
  // visit fires neither, so the bench would stay stale. Applying now dispatches an in-app
  // `compy:ledger-changed` event; the bench listens and re-derives the active pick from the live
  // ledger WITHOUT any refocus. Same honest outcome: "Already configured", no Start, pick stays visible.
  it("re-derives the active pick on an in-app ledger-changed event (sibling apply, same window, no refocus)", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    await pickChange("test-rec");
    expect(await screen.findByText("Worth testing")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Start experiment/ })).toBeEnabled());

    // A sibling Optimize apply lands in the same window — no focus/visibilitychange, just the event.
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: false, reason: "already-set", detail: null }];
    state.sim = { ...WORTH_TESTING_SIM, verdict: "already-configured" };
    fireEvent(window, new Event(LEDGER_CHANGED_EVENT));

    await waitFor(() => expect(screen.getByText("Already configured")).toBeInTheDocument());
    expect(screen.queryByText("Worth testing")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start experiment/ })).toBeNull();
    expect(screen.getByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") })).toHaveTextContent("Test tweak");
    // The kept pick is said once: in the dropdown, not again under "why others aren't listed".
    expect(screen.queryByRole("button", { name: /why others aren't listed/ })).toBeNull();
  });

  it("with a running experiment: shows the running panel with conclude + restore", async () => {
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [VALORANT_SESSION]; // newer same-game session → a real after-reading exists
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-running");
    expect(screen.getByRole("button", { name: /Conclude with my latest/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restore now" })).toBeInTheDocument();
    // Single-variable honesty: the launcher picker is hidden while an experiment is in flight.
    expect(screen.queryByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") })).toBeNull();
  });

  // TG-preflight: while the Trial waits for its after-session, what differs from the baseline's
  // recorded conditions is said up front with one fix step, and nothing is blocked.
  it("waiting for the after-session: names what differs from the baseline, one step, nothing blocked", async () => {
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [];
    state.preflight = [{ key: "resolution", before: "2560×1440", after: "1920×1080" }];
    render(<ExperimentBench />);
    const line = await screen.findByTestId("exp-preflight");
    expect(line).toHaveTextContent(
      "Before you play the after-session: the display is at 1920×1080 now, the baseline ran at 2560×1440. " +
        "Next: set the display back to 2560×1440 before you play. " +
        "If you play anyway, Compy can't pin the result on this change: it records that something else changed, judges nothing and puts the change back.",
    );
    expect(vi.mocked(invoke).mock.calls.some(([c, a]) => c === "trial_preflight" && (a as { experimentId: string }).experimentId === "exp:2-0")).toBe(true);
    // Nothing new is blocked: Restore stays, and the conclude waits only for a session as before.
    expect(screen.getByRole("button", { name: "Restore now" })).toBeEnabled();
    // Sonnet r1: fixed, and back in Compy: the line is read again and goes.
    state.preflight = [];
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByTestId("exp-preflight")).toBeNull());
    state.preflight = null;
  });

  it("waiting for the after-session: no line when nothing differs, the read fails, or a session was played", async () => {
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [];
    state.preflight = [];
    const { unmount } = render(<ExperimentBench />);
    await screen.findByTestId("experiment-running");
    expect(screen.queryByTestId("exp-preflight")).toBeNull();
    unmount();
    state.preflight = "reject";
    const second = render(<ExperimentBench />);
    await screen.findByTestId("experiment-running");
    expect(screen.queryByTestId("exp-preflight")).toBeNull();
    second.unmount();
    // An after-session exists: the line is about the session to come, so it's gone.
    state.preflight = [{ key: "power-plan", before: "a", after: "b" }];
    state.sessions = [VALORANT_SESSION];
    render(<ExperimentBench />);
    await screen.findByRole("button", { name: /Conclude with my latest/ });
    expect(screen.queryByTestId("exp-preflight")).toBeNull();
    state.preflight = null;
  });

  // Desk review 2026-11-02, on his rig: his running Trial said "The change is applied. Play a PBZ
  // session, then conclude" while Windows read the change as off and the summary below it said "Not
  // applied now." Concluding then is recorded confounded (guard_target_at_conclude): a session spent
  // for nothing. The panel now reads the picker's live answer, the summary's own read.
  const HAGS_CANDIDATE = { id: "hags", title: "Hardware-accelerated GPU scheduling", detail: null };
  it("with a running experiment whose change reads off: says so and leads with Restore now, never Conclude", async () => {
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [VALORANT_SESSION];
    state.recs = [{ ...HAGS_CANDIDATE, passes: true, reason: null }];
    render(<ExperimentBench />);
    await waitFor(() =>
      expect(screen.getByTestId("exp-running-step").textContent).toBe(
        "Compy reads Hardware-accelerated GPU scheduling as off now, so a Valorant session can't count toward this test. Restore now ends it and leaves the setting as it was before the test.",
      ),
    );
    expect(screen.getByTestId("experiment-running")).toHaveAttribute("data-change-off", "true");
    // Desk review 2026-11-02, round 2: the line above still said "Testing now" over this panel.
    expect(screen.getByTestId("journey-progress").textContent).toMatch(
      / · Compy reads Hardware-accelerated GPU scheduling as off \(see below\)$/,
    );
    expect(screen.queryByRole("button", { name: /Conclude with my latest/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore now" })).toHaveClass("exp-cta");
    expect(screen.queryByText(/after-reading|Latest Valorant session/)).toBeNull();
  });

  it("a running experiment whose change still reads on keeps the conclude step, Restore now beside it", async () => {
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [VALORANT_SESSION];
    state.recs = [{ ...HAGS_CANDIDATE, passes: false, reason: "already-set-by-compy" }];
    render(<ExperimentBench />);
    expect(await screen.findByRole("button", { name: /Conclude with my latest/ })).toBeEnabled();
    expect(screen.getByTestId("exp-running-step").textContent).toMatch(/^The change is applied\. Play a Valorant session/);
    expect(screen.getByTestId("experiment-running")).not.toHaveAttribute("data-change-off");
    expect(screen.getByRole("button", { name: "Restore now" })).toHaveClass("exp-cta-ghost");
  });

  it("an interrupted Trial whose change reads off never says it is still on", async () => {
    localStorage.setItem("compy.journey.running", RUNNING_EXPERIMENT.id);
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [VALORANT_SESSION];
    state.recs = [{ ...HAGS_CANDIDATE, passes: true, reason: null }];
    render(<ExperimentBench />);
    await waitFor(() =>
      expect(screen.getByTestId("exp-interrupted").textContent).toBe(
        "A test was interrupted, and Compy reads Hardware-accelerated GPU scheduling as off now.",
      ),
    );
  });

  // #583 lane 2b: the backend reads the baseline and the treatment from its own session store by id.
  // The webview names a session; it never hands over the game or a frame rate to be trusted.
  it("starts against the baseline by session id, never by frame rates it supplies", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    await pickChange("test-rec");
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    await waitFor(() => expect(start).toBeEnabled());

    vi.mocked(invoke).mockClear();
    fireEvent.click(start);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("start_experiment", expect.anything()));
    expect(callArgs("start_experiment")).toEqual({
      recId: "test-rec",
      recTitle: "Test tweak",
      baselineSessionId: VALORANT_SESSION.started_at,
      hypothesis: expect.any(String),
      outcome: "recommended",
      // P8-posture-show: the risk allowed now, for the record's receipt (the default here).
      riskChoice: "low-and-moderate",
      // P8-ack: nothing to confirm for a change the picker didn't rate above low risk.
      costAcknowledged: false,
    });
  });

  // P8-ack (RISK_MODEL §1 Advanced, "explicit user acknowledgement when the cost is not obvious"):
  // before a moderate change's Trial starts, one plain line names its cost in the catalog's own words
  // and the start is one tap on "I understand, test it", which the start records. A low-risk change
  // starts as before. Fails on the code before this slice (no line, the usual Start, nothing recorded).
  describe("P8-ack: a moderate change names its cost and starts from one tap", () => {
    const setUp = async (cand: Record<string, unknown>) => {
      state.gate = true;
      state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null, ...cand }];
      state.sessions = [VALORANT_SESSION];
      state.sim = WORTH_TESTING_SIM;
      render(<ExperimentBench />);
      await screen.findByTestId("experiment-bench");
      await pickChange("test-rec");
    };
    // The bench's own Start, in its launcher (the journey above it asks the same for its own start).
    const launcher = () => within(document.querySelector<HTMLElement>(".exp-start")!);
    const startWith = async (name: RegExp | string) => {
      await waitFor(() => expect(document.querySelector(".exp-start")).not.toBeNull());
      const btn = await launcher().findByRole("button", { name });
      await waitFor(() => expect(btn).toBeEnabled());
      vi.mocked(invoke).mockClear();
      fireEvent.click(btn);
      await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("start_experiment", expect.anything()));
      return callArgs("start_experiment") as Record<string, unknown>;
    };

    it("a moderate change: its cost in the catalog's words, then one tap that the start records", async () => {
      await setUp({ risk: "moderate", cost: "Start menu search becomes slower." });
      expect(await screen.findByTestId("exp-cost-ack")).toHaveTextContent("Test tweak has a cost: Start menu search becomes slower.");
      expect(launcher().queryByRole("button", { name: /Start experiment/ })).toBeNull();
      expect(await startWith("I understand, test it")).toMatchObject({ recId: "test-rec", costAcknowledged: true });
    });

    it("a change whose risk isn't stated asks the same; with no cost words it says the catalog has none", async () => {
      await setUp({ risk: "unknown", cost: null });
      expect(await screen.findByTestId("exp-cost-ack")).toHaveTextContent(
        "Test tweak isn't rated low risk, and Compy has no note on what it costs.",
      );
      expect(await startWith("I understand, test it")).toMatchObject({ costAcknowledged: true });
    });

    it("a low-risk change starts as before: no line, the usual Start, nothing to confirm", async () => {
      await setUp({ risk: "low", cost: "Cold boot takes a few seconds longer." });
      expect(await startWith(/Start experiment/)).toMatchObject({ costAcknowledged: false });
      expect(screen.queryByTestId("exp-cost-ack")).toBeNull();
      expect(screen.queryByRole("button", { name: "I understand, test it" })).toBeNull(); // nor in the journey
    });

    it("the line and the tap are in zh-CN too", async () => {
      await i18n.changeLanguage("zh-CN");
      try {
        await setUp({ risk: "moderate", cost: "Start menu search becomes slower." });
        expect(await screen.findByTestId("exp-cost-ack")).toHaveTextContent("Test tweak的代价：Start menu search becomes slower.");
        await waitFor(() => expect(document.querySelector(".exp-start")).not.toBeNull());
        expect(await launcher().findByRole("button", { name: "我了解，开始测试" })).toBeInTheDocument();
      } finally {
        await i18n.changeLanguage("en");
      }
    });
  });

  // P8-posture-show (RISK_MODEL §2): the start carries the answer to "How far may Compy go on this PC?"
  // in force when it starts, so the Trial's record can name it later. Fails on the code before this
  // slice, whose start sent no risk choice.
  it("a start carries the risk the user allows now, so the record can name it", async () => {
    localStorage.setItem("compy.trial.riskChoice", "low-only");
    try {
      state.gate = true;
      state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
      state.sessions = [VALORANT_SESSION];
      state.sim = WORTH_TESTING_SIM;
      render(<ExperimentBench />);
      await screen.findByTestId("experiment-bench");
      await pickChange("test-rec");
      const start = await screen.findByRole("button", { name: /Start experiment/ });
      await waitFor(() => expect(start).toBeEnabled());
      vi.mocked(invoke).mockClear();
      fireEvent.click(start);
      await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("start_experiment", expect.anything()));
      expect(callArgs("start_experiment")).toMatchObject({ recId: "test-rec", riskChoice: "low-only" });
    } finally {
      localStorage.removeItem("compy.trial.riskChoice");
    }
  });

  // P6-restore-f1: while the Care view's "Put back how it was" runs, App's busyId is "care-restore"
  // and LabGround passes ledgerBusy. Neither the bench's Start nor the guided journey's start may
  // begin a Trial then, and the bench says why in one line. Old code ignored App's flag entirely.
  it("starts no Trial while App's shared busy flag is held (Put back running), and says why", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    const { rerender } = render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    await pickChange("test-rec");
    // Reach the terminal state first (both starts enabled), so "disabled" below can only be the flag.
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    const journeyStart = screen.getByRole("button", { name: "Optimize my game" });
    await waitFor(() => expect(start).toBeEnabled());
    expect(journeyStart).toBeEnabled();
    expect(screen.queryByTestId("exp-ledger-busy")).toBeNull();

    // Put back starts: App's busyId becomes "care-restore" and LabGround passes ledgerBusy.
    rerender(<ExperimentBench ledgerBusy />);
    expect(start).toBeDisabled();
    expect(journeyStart).toBeDisabled();
    expect(screen.getByTestId("exp-ledger-busy")).toHaveTextContent(
      "Compy is still making another change, such as putting things back. You can start a Trial when it finishes.",
    );

    vi.mocked(invoke).mockClear();
    fireEvent.click(start);
    fireEvent.click(journeyStart);
    await Promise.resolve();
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "start_experiment")).toHaveLength(0);

    // The flag clears: both starts come back and the reason goes away.
    rerender(<ExperimentBench ledgerBusy={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Start experiment/ })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Optimize my game" })).toBeEnabled();
    expect(screen.queryByTestId("exp-ledger-busy")).toBeNull();
  });

  it("the busy line is in zh-CN too", async () => {
    state.gate = true;
    await i18n.changeLanguage("zh-CN");
    try {
      render(<ExperimentBench ledgerBusy />);
      expect(await screen.findByTestId("exp-ledger-busy")).toHaveTextContent("Compy 还在进行另一项更改");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  // Codex r1 on #611: the backend times the after-session from when the apply returned, so a session
  // begun while the apply (or its UAC prompt) was pending is never offered as the after-reading.
  it("offers only a session that started after the change took effect", async () => {
    state.gate = true;
    const appliedAt = "2026-07-17T03:00:00Z"; // after VALORANT_SESSION started, after created_at
    state.experiments = [{ ...RUNNING_EXPERIMENT, applied_at: appliedAt }];
    state.sessions = [VALORANT_SESSION];
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-running");
    expect(screen.queryByRole("button", { name: /Conclude with my latest/ })).toBeNull();

    cleanup();
    state.sessions = [VALORANT_SESSION, { ...VALORANT_SESSION, started_at: "2026-07-17T04:00:00Z" }];
    render(<ExperimentBench />);
    expect(await screen.findByRole("button", { name: /Conclude with my latest/ })).toBeEnabled();
  });

  it("concludes with the treatment by session id, never by frame rates it supplies", async () => {
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [VALORANT_SESSION];
    render(<ExperimentBench />);
    const conclude = await screen.findByRole("button", { name: /Conclude with my latest/ });

    vi.mocked(invoke).mockClear();
    fireEvent.click(conclude);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("conclude_experiment", expect.anything()));
    expect(callArgs("conclude_experiment")).toEqual({
      experimentId: RUNNING_EXPERIMENT.id,
      treatmentSessionId: VALORANT_SESSION.started_at,
      crashed: false,
    });
  });

  it("never offers a session without a 1% low reading as the baseline (the backend would refuse it)", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [{ ...VALORANT_SESSION, low1_fps_est: 0 }];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    await pickChange("test-rec");
    expect(await screen.findByText(/No baseline yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start experiment/ })).toBeNull();
  });

  // §11: the receipt states the noise floor the verdict was judged against, and says plainly when
  // this game's own noise on the PC was never measured. Absent evidence renders no line at all.
  it("states the noise floor a past verdict was judged against, and that the game's own noise is unmeasured", async () => {
    state.gate = true;
    state.experiments = [
      { ...KEPT_EXPERIMENT, noise_evidence: { band_pct: 3, measured_noise_pct: null } },
      { ...NOT_COMPARABLE_EXPERIMENT, noise_evidence: null },
    ];
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    // Only the judged row carries evidence, so its line is the list's one line; the not-comparable
    // row adds no noise line, only its own reason (Codex r4, #611).
    const shared = await waitFor(() => {
      const el = document.querySelector(".exp-bench-noise-shared");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(shared.textContent).toBe(
      "Judged against Compy's 3% noise floor. This game's own run-to-run noise on your PC hasn't been measured yet.",
    );
    expect([...document.querySelectorAll(".exp-bench-noise")].map((el) => el.textContent)).toEqual([
      `* ${NOT_COMPARABLE_EXPERIMENT.verdict_note}`,
    ]);
    expect(rowMarks()).toEqual([null, "*"]);
  });

  it("says nothing about noise when no past result was judged against the floor", async () => {
    state.gate = true;
    state.experiments = [
      { ...NOT_COMPARABLE_EXPERIMENT, noise_evidence: null },
      { ...NOT_COMPARABLE_EXPERIMENT, id: "exp:6-0", noise_evidence: null },
    ];
    render(<ExperimentBench />);
    await waitFor(() => expect(document.querySelectorAll(".exp-bench-row")).toHaveLength(2));
    expect(document.querySelectorAll(".exp-bench-noise-shared")).toHaveLength(0);
    expect(document.querySelector(".exp-history")?.textContent).not.toMatch(/noise/i);
    // Their shared reason is said once, never hoisted as the list's rule (Codex r4, #611).
    expect([...document.querySelectorAll(".exp-bench-noise")].map((el) => el.textContent)).toEqual([
      `* ${NOT_COMPARABLE_EXPERIMENT.verdict_note}`,
    ]);
    expect(rowMarks()).toEqual(["*", "*"]);
  });

  it("states a measured noise level when the record carries one", async () => {
    state.gate = true;
    state.experiments = [{ ...KEPT_EXPERIMENT, noise_evidence: { band_pct: 3, measured_noise_pct: 1.25 } }];
    render(<ExperimentBench />);
    expect(
      await screen.findByText(
        wholeLine("Judged against Compy's fixed 3% noise floor. In one 25-second calibration on your PC, this game's 1% low varied by ±1.3%. That number isn't used to judge yet, and the game version isn't checked."),
      ),
    ).toBeInTheDocument();
  });

  // P4-noise: the band came from this game's unchanged sessions on this PC, and the line says exactly
  // what was measured: how many sessions, which game, and by how much the 1% low varied between them.
  it("says how much the game varied across its unchanged sessions when that set the band", async () => {
    state.gate = true;
    state.experiments = [
      {
        ...KEPT_EXPERIMENT,
        game: "WardogsClient-Win64-Shipping.exe",
        noise_evidence: { band_pct: 5.94, measured_noise_pct: 1.25, between_sessions: { spread_pct: 5.94, sessions: 4 } },
      },
    ];
    render(<ExperimentBench />);
    expect(
      await screen.findByText(
        wholeLine("Judged against a ±5.9% noise floor: across 4 of your unchanged WardogsClient sessions on this PC, the 1% low frame rate differed by up to 5.9% between sessions played with nothing changed in between. Sessions on either side of a change are never compared."),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hasn't been measured yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/25-second calibration/)).not.toBeInTheDocument();
  });

  it("says the fixed minimum judged when the game varied less than it between sessions", async () => {
    state.gate = true;
    state.experiments = [
      { ...KEPT_EXPERIMENT, noise_evidence: { band_pct: 3, measured_noise_pct: null, between_sessions: { spread_pct: 1.84, sessions: 3 } } },
    ];
    render(<ExperimentBench />);
    expect(
      await screen.findByText(
        wholeLine("Judged against Compy's 3% minimum noise floor: across 3 of your unchanged Valorant sessions on this PC, the 1% low frame rate differed by up to 1.8% between sessions played with nothing changed in between, which is less than that minimum. Sessions on either side of a change are never compared."),
      ),
    ).toBeInTheDocument();
  });

  // P4-noise-copy-2: the spread is the largest 1% low difference inside one unchanged run
  // (noise_floor::unchanged_spread); sessions in different runs are never compared, so neither
  // locale may say "between any two of those sessions".
  it("never claims the spread compares any two of the counted sessions, in either locale", async () => {
    const en = (await import("../i18n/locales/en/lab.json")).default.experimentBench;
    const zh = (await import("../i18n/locales/zh-CN/lab.json")).default.experimentBench;
    for (const key of ["noiseBetweenSessions", "noiseBetweenSessionsBelowFloor"] as const) {
      expect(en[key]).not.toMatch(/any two/);
      expect(en[key]).toContain("Sessions on either side of a change are never compared.");
      expect(zh[key]).not.toContain("在两次之间");
      expect(zh[key]).toContain("改动前后的场次从不互相比较");
    }
  });

  // P4-noise-store: a calibration that isn't current isn't used, and the receipt says which reason —
  // an observed update, or conditions Compy couldn't confirm — never "hasn't been measured yet".
  it.each([
    [
      "changed",
      "Judged against Compy's 3% noise floor. This game's spread on your PC was measured before a driver or Windows update, so it wasn't used. The game version isn't checked.",
    ],
    [
      "unconfirmed",
      "Judged against Compy's 3% noise floor. This game's spread on your PC was measured, but Compy couldn't confirm nothing changed since, so it wasn't used. The game version isn't checked.",
    ],
  ] as const)("says why a %s noise measurement wasn't used", async (why, line) => {
    state.gate = true;
    state.experiments = [
      { ...KEPT_EXPERIMENT, noise_evidence: { band_pct: 3, measured_noise_pct: null, measured_noise_stale: why } },
    ];
    render(<ExperimentBench />);
    expect(await screen.findByText(wholeLine(line))).toBeInTheDocument();
    expect(screen.queryByText(/hasn't been measured yet/)).not.toBeInTheDocument();
  });

  // Self-review C-11 (#583 lane 2b): the same sentence under every row buries the rows. Identical
  // lines are said once for the list; only lines that differ stay on their rows.
  it("says an identical noise line once for the list, not under every row", async () => {
    state.gate = true;
    const judged = { band_pct: 3, measured_noise_pct: null };
    state.experiments = [
      { ...KEPT_EXPERIMENT, noise_evidence: judged },
      { ...KEPT_EXPERIMENT, id: "exp:3-0", noise_evidence: judged },
    ];
    render(<ExperimentBench />);
    const shared = await waitFor(() => {
      const el = document.querySelector(".exp-bench-noise-shared");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(shared.textContent).toBe(
      "Judged against Compy's 3% noise floor. This game's own run-to-run noise on your PC hasn't been measured yet.",
    );
    expect(document.querySelectorAll(".exp-bench-noise")).toHaveLength(0);
  });

  // C-11 as a class, not an instance (self-review #4, #583 lane 2b): every §11 sentence appears once
  // per list however many rows it covers, and no row carries a sentence — only a note's mark.
  function expectEachNoteOnceAndOffTheRows() {
    const sentences = [
      ...[...document.querySelectorAll(".exp-bench-noise-shared")].map((el) => el.textContent ?? ""),
      ...[...document.querySelectorAll(".exp-bench-noise")].map((el) => el.lastElementChild?.textContent ?? ""),
    ];
    expect(new Set(sentences).size, sentences.join("\n")).toBe(sentences.length);
    for (const row of document.querySelectorAll(".exp-bench-row")) {
      for (const s of sentences) expect(row.textContent).not.toContain(s);
    }
  }
  const rowMarks = () =>
    [...document.querySelectorAll(".exp-bench-row")].map((r) => r.querySelector(".exp-bench-noise-mark")?.textContent ?? null);

  it("says each differing noise line once, and marks its rows", async () => {
    state.gate = true;
    const unmeasured = { band_pct: 3, measured_noise_pct: null };
    const measured = { band_pct: 3, measured_noise_pct: 1.25 };
    state.experiments = [
      { ...KEPT_EXPERIMENT, noise_evidence: unmeasured },
      { ...KEPT_EXPERIMENT, id: "exp:3-0", noise_evidence: measured },
      { ...KEPT_EXPERIMENT, id: "exp:3-1", noise_evidence: unmeasured },
      { ...KEPT_EXPERIMENT, id: "exp:3-2", noise_evidence: measured },
    ];
    render(<ExperimentBench />);
    await waitFor(() => expect(document.querySelectorAll(".exp-bench-noise")).toHaveLength(2));
    expect(document.querySelector(".exp-bench-noise-shared")).toBeNull();
    expect([...document.querySelectorAll(".exp-bench-noise")].map((el) => el.textContent)).toEqual([
      "* Judged against Compy's 3% noise floor. This game's own run-to-run noise on your PC hasn't been measured yet.",
      "† Judged against Compy's fixed 3% noise floor. In one 25-second calibration on your PC, this game's 1% low varied by ±1.3%. That number isn't used to judge yet, and the game version isn't checked.",
    ]);
    expect(rowMarks()).toEqual(["*", "†", "*", "†"]);
    expectEachNoteOnceAndOffTheRows();
  });

  // IPC audit W2 + self-review item 3 (#583 lane 2b, three passes): a row with no record must not
  // fall silently under the list-wide line, yet neither the floor sentence nor the "no record" note
  // may repeat down the list (C-11). The rule is said once; the note is said once; only rows that
  // LOOK judged — a crash reads "Worse", an older result "Better" — carry its mark. Rows whose
  // verdict already says they weren't judged stay quiet, except "not comparable", which carries its
  // reason (Codex r4, #611).
  it("says the floor once and the missing-record note once, marking only rows that look judged", async () => {
    state.gate = true;
    const judged = { band_pct: 3, measured_noise_pct: null };
    const unjudged = (id: string, verdict: string | null) => ({
      ...NOT_COMPARABLE_EXPERIMENT, id, verdict, treatment: null, noise_evidence: null,
    });
    state.experiments = [
      { ...KEPT_EXPERIMENT, noise_evidence: judged },
      { ...KEPT_EXPERIMENT, id: "exp:4-0", noise_evidence: judged },
      unjudged("u1", null), unjudged("u2", null), unjudged("u3", "confounded"), unjudged("u4", "confounded"),
      unjudged("u5", "not-comparable"), unjudged("u6", "insufficient-evidence"), unjudged("u7", null),
      unjudged("u8", "confounded"),
      // A crash: restored, "Worse", never judged against the floor.
      { ...NOT_COMPARABLE_EXPERIMENT, id: "crash", verdict: "regressed", stop_reason: "crash-during-treatment", noise_evidence: null },
      // Results saved before the record existed.
      { ...KEPT_EXPERIMENT, id: "old-1", noise_evidence: null },
      { ...KEPT_EXPERIMENT, id: "old-2", verdict: "no-change", noise_evidence: undefined },
    ];
    render(<ExperimentBench />);
    await waitFor(() => expect(document.querySelectorAll(".exp-bench-row")).toHaveLength(13));
    expect(document.querySelector(".exp-bench-noise-shared")?.textContent).toMatch(/^Judged against Compy's 3% noise floor\./);
    expect([...document.querySelectorAll(".exp-bench-noise")].map((el) => el.textContent)).toEqual([
      `* ${NOT_COMPARABLE_EXPERIMENT.verdict_note}`,
      "† No noise-floor record was kept for these results.",
    ]);
    expect(rowMarks()).toEqual([null, null, null, null, null, null, "*", null, null, null, "†", "†", "†"]);
    expectEachNoteOnceAndOffTheRows();
  });

  it("says the missing-record note in the singular for one row", async () => {
    state.gate = true;
    state.experiments = [
      { ...KEPT_EXPERIMENT, noise_evidence: { band_pct: 3, measured_noise_pct: null } },
      { ...NOT_COMPARABLE_EXPERIMENT, id: "crash", verdict: "regressed", stop_reason: "crash-during-treatment", noise_evidence: null },
    ];
    render(<ExperimentBench />);
    expect(await screen.findByText("No noise-floor record was kept for this result.")).toBeInTheDocument();
    expect(rowMarks()).toEqual([null, "*"]);
    expectEachNoteOnceAndOffTheRows();
  });

  // Self-review #583 lane 2b: an aborted row showed the backend's machine tag ("start-aborted: …").
  it("shows an aborted result's reason as a sentence, without the machine tag", async () => {
    state.gate = true;
    state.experiments = [
      {
        ...NOT_COMPARABLE_EXPERIMENT, id: "ab", status: "aborted", verdict: null, treatment: null, noise_evidence: null,
        stop_reason:
          "start-aborted: the setting didn't read back as changed; automatic restore did not complete — check it in Test → Applied & history: Access is denied.",
      },
    ];
    render(<ExperimentBench />);
    const reason = await waitFor(() => {
      const el = document.querySelector(".exp-bench-abort");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(reason.textContent).toMatch(/^The setting didn't read back as changed; /);
    expect(reason.textContent).not.toContain("start-aborted");
  });

  // #611 review round 2: a crash whose conclude-time read failed, and whose read after the restore
  // still showed the setting changed, carries two stacked tags (experiment.rs); both must go.
  it("strips every stacked machine tag from an aborted crash's reason", async () => {
    state.gate = true;
    state.experiments = [
      {
        ...NOT_COMPARABLE_EXPERIMENT, id: "crash", status: "aborted", verdict: "insufficient-evidence", noise_evidence: null,
        stop_reason:
          "crash-during-treatment; target-unreadable-at-conclude; a read afterwards shows the setting as changed — check it in Test → Applied & history",
      },
    ];
    render(<ExperimentBench />);
    const reason = await waitFor(() => {
      const el = document.querySelector(".exp-bench-abort");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(reason.textContent).toMatch(/^A read afterwards shows the setting as changed/);
    expect(reason.textContent).not.toMatch(/crash-during-treatment|target-unreadable/);
  });

  // #611 review round 2: a Trial an older Compy started has no baseline id or no apply time, and the
  // backend refuses to conclude it. The bench must not offer a button that can only fail.
  it.each([
    ["no apply time", { applied_at: null }],
    ["no baseline session id", { baseline_session_id: null }],
  ])("offers only Restore for a running Trial with %s", async (_what, missing) => {
    state.gate = true;
    state.experiments = [{ ...RUNNING_EXPERIMENT, ...missing }];
    state.sessions = [VALORANT_SESSION, { ...VALORANT_SESSION, started_at: "2026-07-17T04:00:00Z" }];
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-running");
    expect(screen.getByText(/An older version of Compy started this experiment/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Conclude/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore now" })).toBeEnabled();
  });

  // #583 lane 2b: the backend now refuses a start or conclude on the sessions it reads (missing,
  // not comparable, played before the change). The refusal must reach the owner in words, and a
  // refused conclude leaves the Trial running rather than looking finished.
  it("shows a refused conclude and keeps the running panel", async () => {
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [VALORANT_SESSION];
    state.refuse = {
      conclude_experiment: "experiment not concluded — that session was played before the change was applied",
    };
    render(<ExperimentBench />);
    fireEvent.click(await screen.findByRole("button", { name: /Conclude with my latest/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("that session was played before the change was applied");
    expect(screen.getByTestId("experiment-running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore now" })).toBeInTheDocument();
  });

  it("shows a refused start and starts nothing", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    state.refuse = { start_experiment: "the baseline session is no longer in your session history" };
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    await pickChange("test-rec");
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer in your session history");
    expect(screen.queryByTestId("experiment-running")).toBeNull();
  });

  // IPC audit W1 (#583 lane 2b): a start can fail AFTER it applied — a failed target check restores
  // (or fails to) and writes a record. The screen must re-read and tell the sibling surfaces, or it
  // disagrees with what is applied on the PC.
  it("re-reads and signals the ledger when a start fails after applying", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    state.refuse = { start_experiment: "experiment aborted — the setting didn't read back as changed; Compy restored it" };
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    await pickChange("test-rec");
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    await waitFor(() => expect(start).toBeEnabled());
    // The failed start restored the change and recorded it; only a re-read can show that row.
    state.experiments = [{ ...NOT_COMPARABLE_EXPERIMENT, id: "exp:5-0", verdict: null, noise_evidence: null }];
    const ledger = vi.fn();
    window.addEventListener(LEDGER_CHANGED_EVENT, ledger);
    try {
      fireEvent.click(start);
      expect(await screen.findByRole("alert")).toHaveTextContent("Compy restored it");
      await waitFor(() => expect(document.querySelectorAll(".exp-bench-row")).toHaveLength(1));
      expect(ledger).toHaveBeenCalled();
    } finally {
      window.removeEventListener(LEDGER_CHANGED_EVENT, ledger);
    }
  });

  // Codex r1 on #611: a conclude that doesn't keep restores the change, and a failed conclude or
  // restore may have moved it too — sibling surfaces must re-derive or they show it still applied.
  it.each([
    ["a conclude", "Conclude with my latest", undefined],
    ["a failed conclude", "Conclude with my latest", { conclude_experiment: "restore failed — the setting still reads changed" }],
    ["a restore", "Restore now", undefined],
    ["a failed restore", "Restore now", { restore_experiment: "restore failed — the setting still reads changed" }],
  ])("signals the ledger after %s", async (_what, button, refuse) => {
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [VALORANT_SESSION];
    state.refuse = refuse ?? {};
    render(<ExperimentBench />);
    const control = await screen.findByRole("button", { name: new RegExp(button) });
    const ledger = vi.fn();
    window.addEventListener(LEDGER_CHANGED_EVENT, ledger);
    try {
      fireEvent.click(control);
      await waitFor(() => expect(ledger).toHaveBeenCalled());
      if (refuse) expect(await screen.findByRole("alert")).toHaveTextContent("still reads changed");
    } finally {
      window.removeEventListener(LEDGER_CHANGED_EVENT, ledger);
    }
  });

  // #621: the bench's writes moved the ledger but never reached App's refresh, so the Optimize station
  // beside it (App's recs/changes) kept showing the change as it was until a refocus. Each write now
  // announces the change AND runs App's refresh (`onChanged`, which LabGround passes) — failed ones too,
  // since a failed start/conclude/restore may still have applied or restored.
  it.each([
    ["a start", "Start experiment", undefined],
    ["a failed start", "Start experiment", { start_experiment: "experiment aborted — Compy restored it" }],
    ["a conclude", "Conclude with my latest", undefined],
    ["a failed conclude", "Conclude with my latest", { conclude_experiment: "restore failed — the setting still reads changed" }],
    ["a restore", "Restore now", undefined],
    ["a failed restore", "Restore now", { restore_experiment: "restore failed — the setting still reads changed" }],
  ])("announces the ledger change and refreshes App after %s", async (_what, button, refuse) => {
    state.gate = true;
    state.sessions = [VALORANT_SESSION];
    if (button === "Start experiment") {
      state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
      state.sim = WORTH_TESTING_SIM;
    } else {
      state.experiments = [RUNNING_EXPERIMENT];
    }
    const onChanged = vi.fn();
    render(<ExperimentBench onChanged={onChanged} />);
    await screen.findByTestId("experiment-bench");
    if (button === "Start experiment") await pickChange("test-rec");
    const control = await screen.findByRole("button", { name: new RegExp(button) });
    await waitFor(() => expect(control).toBeEnabled());
    state.refuse = refuse ?? {};
    const order: string[] = [];
    const ledger = vi.fn(() => order.push("announce"));
    onChanged.mockImplementation(() => order.push("refresh"));
    window.addEventListener(LEDGER_CHANGED_EVENT, ledger);
    try {
      fireEvent.click(control);
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(ledger).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["announce", "refresh"]);
      if (refuse) expect(await screen.findByRole("alert")).toBeInTheDocument();
    } finally {
      window.removeEventListener(LEDGER_CHANGED_EVENT, ledger);
    }
  });

  // #621: the announcement wakes the bench's own listener while the old pick is still set, starting a
  // quiet re-simulation of it. A started experiment clears the pick; that late answer must not bring
  // the simulator card back.
  it("a started experiment's announcement does not bring the cleared simulator card back", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    await pickChange("test-rec");
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Start experiment/ })).toBeNull());
    // Let the quiet re-simulation the announcement started settle, then look again.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /Start experiment/ })).toBeNull();
    expect(screen.queryByText(WORTH_TESTING_SIM.why)).toBeNull();
  });
});

// P4-baseline-quality (Trial Protocol §2): a baseline too short to judge a change against is said
// so, with a re-record, instead of offering a start the backend refuses; an uneven or untraced one
// warns, starts, and its receipt keeps the warning.
describe("the baseline is graded before a start", () => {
  // The owner rig's 2026-10-23 WARDOGS baseline (1172 readings; AFK into a new round): its 10 s fps
  // buckets as sessions.json holds them.
  const AFK_FPS = [142.8, 152.2, 177.9, 185.7, 180.0, 212.7, 252.2, 264.7, 319.8, 270.2, 263.9, 235.4, 224.0, 218.9, 207.8, 227.2, 231.1, 219.8, 263.2, 282.2, 337.6, 335.6, 312.8, 320.5, 328.9, 336.3, 335.1, 334.2, 330.5, 337.2, 334.4, 323.4, 330.1, 338.3, 329.2, 268.5, 155.9, 220.4, 304.7, 326.6, 327.5, 237.0, 215.5, 274.0, 223.8, 212.0, 219.5, 251.4, 259.3, 253.1, 251.1, 241.5, 242.2, 230.1, 245.3, 249.3, 220.5, 200.6, 202.0, 208.5, 206.3, 230.9, 255.6, 253.5, 255.8, 255.8, 269.1, 279.4, 265.0, 204.9, 212.1, 229.0, 235.1, 243.2, 272.1, 293.6, 263.2, 265.0, 258.6, 271.4, 276.3, 287.4, 289.1, 279.6, 269.0, 279.3, 237.8, 210.8, 204.0, 210.9, 213.5, 191.8, 183.4, 204.4, 214.0, 207.3, 205.1, 225.6, 199.7, 190.9, 180.2, 186.5, 195.1, 187.5, 202.1, 203.1, 194.5, 195.9, 200.8, 199.4, 220.2, 218.7, 216.4, 236.1, 216.1, 188.9, 209.6, 199.1, 213.0];
  const AFK_BASELINE = {
    ...VALORANT_SESSION,
    process_name: "WardogsClient-Win64-Shipping.exe",
    samples: 1172,
    avg_fps: 244.1,
    low1_fps_est: 153.5,
    fps_series: AFK_FPS.map((f, i) => [20 + i * 10, f] as [number, number]),
  };

  async function openStart(session: unknown) {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [session];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    await pickChange("test-rec");
    expect(await screen.findByText("Worth testing")).toBeInTheDocument();
  }

  async function startsAndIsSent() {
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    await waitFor(() => expect(start).toBeEnabled());
    vi.mocked(invoke).mockClear();
    fireEvent.click(start);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("start_experiment", expect.anything()));
  }

  // Owner decision 2026-10-24: warn, don't block. With a 3% floor both of the owner's real WARDOGS
  // baselines grade uneven, so blocking would stop nearly every Trial until P4-noise.
  it("the AFK baseline from the first live Trial warns it was uneven and still starts", async () => {
    await openStart(AFK_BASELINE);
    const warn = await screen.findByTestId("exp-baseline-warn");
    expect(warn).toHaveTextContent(
      "This baseline was uneven: first half 260 fps, second half 228 fps, so this experiment's result may be less reliable.",
    );
    expect(screen.queryByTestId("exp-baseline-unfit")).toBeNull();
    await startsAndIsSent();
  });

  it("a baseline under 600 readings reads too short and does not start", async () => {
    await openStart({ ...VALORANT_SESSION, samples: 91 });
    const note = await screen.findByTestId("exp-baseline-unfit");
    expect(note).toHaveTextContent(/too short.*91 of the 600 frame-rate readings/);
    expect(note).toHaveTextContent(/Record a new baseline/);
    expect(screen.queryByRole("button", { name: /Start experiment/ })).toBeNull();
  });

  // P4-comparable review: a short baseline that left background time out says how much.
  it("a too-short baseline says how much was left out with another window in front", async () => {
    await openStart({ ...VALORANT_SESSION, samples: 400, background_secs_excluded: 1500 });
    const note = await screen.findByTestId("exp-baseline-unfit");
    expect(note).toHaveTextContent(
      "Those readings are only the time the game was in front: 25 min were left out because another window was in front.",
    );
  });

  it("the re-record line reads naturally when the game has no name to show", async () => {
    await openStart({ ...VALORANT_SESSION, process_name: ".exe", samples: 91 });
    const note = await screen.findByTestId("exp-baseline-unfit");
    expect(note).toHaveTextContent("Record a new baseline: play another session of this game, then start.");
  });

  // The start warning and the receipt show the same numbers: both round the backend's 1-decimal halves.
  // Raw 259.46 rounds to 259, but the record keeps 259.5, which the receipt shows as 260.
  it("the start warning rounds the same 1-decimal halves the receipt does", async () => {
    const fps = [...Array(30).fill(259.46), ...Array(30).fill(200)];
    await openStart({ ...VALORANT_SESSION, samples: 600, fps_series: fps.map((f, i) => [i * 10, f] as [number, number]) });
    expect(await screen.findByTestId("exp-baseline-warn")).toHaveTextContent(/first half 260 fps, second half 200 fps/);
  });

  it("a baseline without its frame-rate trace warns it can't be checked and still starts", async () => {
    await openStart({ ...VALORANT_SESSION, fps_series: [] });
    expect(await screen.findByTestId("exp-baseline-warn")).toHaveTextContent(
      "Compy can't tell whether this baseline was steady: this session doesn't have enough of a frame-rate trace to check.",
    );
    await startsAndIsSent();
  });

  it("the receipt of a Trial started on an uneven baseline says so, running and past", async () => {
    state.gate = true;
    const halves = { first_half_fps: 259.8, second_half_fps: 227.9 };
    state.experiments = [{ ...RUNNING_EXPERIMENT, baseline_check: "uneven", baseline_halves: halves }];
    state.sessions = [VALORANT_SESSION];
    const { unmount } = render(<ExperimentBench />);
    await screen.findByTestId("experiment-running");
    expect(screen.getByTestId("exp-baseline-receipt")).toHaveTextContent(
      "This experiment's baseline was uneven: first half 260 fps, second half 228 fps, so its result may be less reliable.",
    );
    unmount();
    state.experiments = [{ ...KEPT_EXPERIMENT, baseline_check: "uneven", baseline_halves: halves }];
    render(<ExperimentBench />);
    expect(await screen.findByText("Measurably faster — kept")).toBeInTheDocument();
    expect(screen.getByTestId("exp-baseline-receipt")).toHaveTextContent(/baseline was uneven: first half 260 fps/);
  });

  it("the receipt of a Trial started on an untraced baseline says it wasn't checked; steady and older say nothing", async () => {
    state.gate = true;
    state.experiments = [
      { ...KEPT_EXPERIMENT, id: "a", baseline_check: "untraced", baseline_halves: null },
      { ...KEPT_EXPERIMENT, id: "b", baseline_check: "steady", baseline_halves: { first_half_fps: 200, second_half_fps: 202 } },
      { ...KEPT_EXPERIMENT, id: "c" }, // an older record: no grade at all
    ];
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    const receipts = await screen.findAllByTestId("exp-baseline-receipt");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toHaveTextContent(
      "Compy couldn't tell whether this experiment's baseline was steady: that session didn't have enough of a frame-rate trace to check.",
    );
  });

  it("a long, steady baseline still starts", async () => {
    await openStart(VALORANT_SESSION);
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    await waitFor(() => expect(start).toBeEnabled());
    expect(screen.queryByTestId("exp-baseline-unfit")).toBeNull();
    expect(screen.queryByTestId("exp-baseline-warn")).toBeNull();
  });
});

// P4-sessions (Trial Protocol §2, §8): a Trial where either session was uneven reads "Too noisy to
// judge — restored", never Slower/Faster, and its row says which session swung and by how much.
describe("a Trial judged on an uneven session", () => {
  // The first live Trial (2026-10-23, WARDOGS): −18.5% 1% low on an uneven baseline and after-session.
  const AFK_TRIAL = {
    ...KEPT_EXPERIMENT,
    status: "restored",
    kept: false,
    baseline_avg_fps: 244.1,
    baseline_low1_fps: 153.5,
    baseline_check: "uneven",
    baseline_halves: { first_half_fps: 259.8, second_half_fps: 227.9 },
    treatment: {
      ...KEPT_EXPERIMENT.treatment,
      avg_fps: 203.5,
      low1_fps: 125.1,
      samples: 1095,
      delta_low1_pct: -18.5,
      check: "uneven",
      halves: { first_half_fps: 188.7, second_half_fps: 218.5 }, // its AFK_AFTER_FPS buckets' halves
    },
    verdict: "too-noisy",
    stop_reason: "uneven-session",
  };

  it("the −18.5% AFK Trial reads too noisy to judge and names both uneven sessions", async () => {
    state.gate = true;
    state.experiments = [AFK_TRIAL];
    render(<ExperimentBench />);
    expect(await screen.findByText("Too noisy to judge — restored")).toBeInTheDocument();
    expect(screen.queryByText("Slower — restored")).toBeNull();
    expect(screen.getByTestId("exp-baseline-receipt")).toHaveTextContent(
      "The baseline was uneven: first half 260 fps, second half 228 fps.",
    );
    expect(screen.getByTestId("exp-after-receipt")).toHaveTextContent(
      "The after-session was uneven: first half 189 fps, second half 219 fps.",
    );
    expect(screen.getByTestId("exp-too-noisy-why")).toHaveTextContent(/Compy restored it and judged nothing/);
  });

  it("a measured result on steady sessions says nothing about unevenness", async () => {
    state.gate = true;
    state.experiments = [KEPT_EXPERIMENT];
    render(<ExperimentBench />);
    expect(await screen.findByText("Measurably faster — kept")).toBeInTheDocument();
    expect(screen.queryByTestId("exp-after-receipt")).toBeNull();
    expect(screen.queryByTestId("exp-too-noisy-why")).toBeNull();
  });
});

// P4-comparable: a Partial pair says what differed in one line, in the reader's language, and each
// session's time that wasn't play is named: background time left out, held-flat time counted.
describe("ExperimentBench — what differed and what wasn't play", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  const PARTIAL_TRIAL = {
    ...KEPT_EXPERIMENT,
    session_pairing: {
      verdict: "partial",
      missing_context: ["The graphics API wasn't recorded on one of these sessions."],
      changed: ["resolution", "refresh"],
      unrecorded: ["graphics-api"],
      // Tonight's real 09:39 WARDOGS session as the after-reading: 990 s held at 120 fps.
      baseline_stretches: { left_out_secs: 600, flat_secs: 0, flat_fps: null, traced: true },
      after_stretches: { left_out_secs: null, flat_secs: 990, flat_fps: 120, traced: true },
    },
  };

  it("names what differed and the stretches in one plain line each", async () => {
    state.gate = true;
    state.experiments = [PARTIAL_TRIAL];
    render(<ExperimentBench />);
    expect(await screen.findByTestId("exp-pairing-receipt")).toHaveTextContent(
      "What differed: the resolution, the refresh rate changed, and one of the sessions didn't record the graphics API.",
    );
    const stretches = screen.getAllByTestId("exp-stretch-receipt").map((n) => n.textContent);
    expect(stretches).toEqual([
      "Before session: 10 min with the game in the background was left out of the numbers.",
      "After session: 16 min held at about 120 fps. That may be a menu, a frame cap or the game in the background; Compy can't tell, so it was counted.",
    ]);
  });

  it("says the same in zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    state.gate = true;
    state.experiments = [PARTIAL_TRIAL];
    render(<ExperimentBench />);
    expect(await screen.findByTestId("exp-pairing-receipt")).toHaveTextContent(
      "差异：分辨率、刷新率有变化，且其中一局没有记录图形 API。",
    );
    expect(screen.getAllByTestId("exp-stretch-receipt")[1]).toHaveTextContent("测试后的那局：有 16 分钟稳定在约 120 fps。");
  });

  it("a session that recorded focus never blames the background, and minutes are floored", async () => {
    state.gate = true;
    state.experiments = [
      {
        ...KEPT_EXPERIMENT,
        session_pairing: {
          verdict: "comparable",
          baseline_stretches: { left_out_secs: 119, flat_secs: 59, flat_fps: 120, traced: true },
          after_stretches: { left_out_secs: 0, flat_secs: 119, flat_fps: 120, traced: true },
        },
      },
    ];
    render(<ExperimentBench />);
    await screen.findByText("Measurably faster — kept");
    expect(screen.getAllByTestId("exp-stretch-receipt").map((n) => n.textContent)).toEqual([
      // 119 s is 1 min, not 2; 59 s held flat is under a minute and gets no line.
      "Before session: 1 min with the game in the background was left out of the numbers.",
      "After session: 1 min held at about 120 fps. That may be a menu or a frame cap; Compy can't tell, so it was counted.",
    ]);
  });

  // P4-cap-note: the 2026-10-29 WARDOGS firing-range sessions both sat at ~320 fps. A No change between
  // two sides held at the same rate may be a frame cap, and the receipt says it says little.
  const capped = (verdict: string, before: { flat_secs: number; flat_fps: number | null }, after: { flat_secs: number; flat_fps: number | null }) => ({
    ...KEPT_EXPERIMENT,
    status: "restored",
    kept: false,
    verdict,
    session_pairing: {
      verdict: "comparable",
      baseline_stretches: { left_out_secs: 0, traced: true, ...before },
      after_stretches: { left_out_secs: 0, traced: true, ...after },
    },
  });
  const CAP_LINE =
    'Both sessions held at about 320 fps (15 min before, 14 min after), which looks like one frame cap. While it holds, a change can\'t show a gain, so this "No measurable change" says little about the change itself.';

  it("a No change between two sides held at the same rate says a cap may hide any gain", async () => {
    state.gate = true;
    state.experiments = [capped("no-change", { flat_secs: 900, flat_fps: 319.4 }, { flat_secs: 840, flat_fps: 320.6 })];
    render(<ExperimentBench />);
    await waitFor(() => expect(screen.getAllByTestId("exp-stretch-receipt").map((n) => n.textContent)).toContain(CAP_LINE));
  });

  // Desk review 2026-10-31: on the owner's WARDOGS row the cap line sat under the two per-session
  // "held at about 320 fps" lines it restates, three lines in a row. It now says it once, with the minutes.
  it("says the shared cap once, in place of the two per-session held lines", async () => {
    state.gate = true;
    state.experiments = [capped("no-change", { flat_secs: 900, flat_fps: 319.4 }, { flat_secs: 840, flat_fps: 320.6 })];
    render(<ExperimentBench />);
    await waitFor(() => expect(screen.getAllByTestId("exp-stretch-receipt").map((n) => n.textContent)).toContain(CAP_LINE));
    const lines = screen.getAllByTestId("exp-stretch-receipt").map((n) => n.textContent ?? "");
    expect(lines.filter((l) => /held at about/.test(l))).toEqual([CAP_LINE]);
  });

  it.each([
    ["a judged gain", capped("improved", { flat_secs: 900, flat_fps: 320 }, { flat_secs: 900, flat_fps: 320 })],
    ["different held rates", capped("no-change", { flat_secs: 900, flat_fps: 320 }, { flat_secs: 900, flat_fps: 240 })],
    ["one side held under a minute", capped("no-change", { flat_secs: 59, flat_fps: 320 }, { flat_secs: 900, flat_fps: 320 })],
    ["one side never held", capped("no-change", { flat_secs: 0, flat_fps: null }, { flat_secs: 900, flat_fps: 320 })],
  ])("adds no cap line for %s", async (_name, exp) => {
    state.gate = true;
    state.experiments = [exp];
    render(<ExperimentBench />);
    await screen.findAllByTestId("exp-stretch-receipt");
    expect(screen.queryByText(/looks like one frame cap/)).toBeNull();
  });

  it("says the cap note in zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    state.gate = true;
    state.experiments = [capped("no-change", { flat_secs: 900, flat_fps: 320 }, { flat_secs: 900, flat_fps: 320 })];
    render(<ExperimentBench />);
    await waitFor(() =>
      expect(screen.getAllByTestId("exp-stretch-receipt").map((n) => n.textContent)).toContain(
        "两次会话都稳定在约 320 fps（之前 15 分钟，之后 15 分钟），看起来是同一个帧率上限。上限生效时，更改无法显示出提升，所以这次的“无可测量的变化”几乎说明不了这项更改本身。",
      ),
    );
  });

  it("too few readings after background time says how much was left out", async () => {
    state.gate = true;
    state.experiments = [
      {
        ...KEPT_EXPERIMENT,
        status: "restored",
        kept: false,
        verdict: "insufficient-evidence",
        treatment: { ...KEPT_EXPERIMENT.treatment, samples: 400 },
        session_pairing: {
          verdict: "comparable",
          after_stretches: { left_out_secs: 1500, flat_secs: 0, flat_fps: null, traced: true },
        },
      },
    ];
    render(<ExperimentBench />);
    expect(await screen.findByTestId("exp-too-few-left-out")).toHaveTextContent(
      "Only 400 readings while the game was in front: 25 min were left out because another window was in front.",
    );
  });

  it("a comparable pair, or an older record with only English lines, adds no line", async () => {
    state.gate = true;
    state.experiments = [
      { ...KEPT_EXPERIMENT, session_pairing: { verdict: "comparable", missing_context: [] } },
      { ...KEPT_EXPERIMENT, id: "exp:old", session_pairing: { verdict: "partial", missing_context: ["x"] } },
    ];
    render(<ExperimentBench />);
    expect(await screen.findAllByText("Measurably faster — kept")).toHaveLength(2);
    expect(screen.queryByTestId("exp-pairing-receipt")).toBeNull();
    expect(screen.queryByTestId("exp-stretch-receipt")).toBeNull();
  });
});

// P4-recommended (ENGINE §2, §6): a judged row says exactly what was compared, the 1% low and the
// average on one band, and why that kept or restored the change.
describe("ExperimentBench — what the Recommended verdict compared", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  const judged = (verdict: string, low: number, avg: number | null) => ({
    ...KEPT_EXPERIMENT,
    status: verdict === "improved" ? "kept" : "restored",
    kept: verdict === "improved",
    verdict,
    treatment: { ...KEPT_EXPERIMENT.treatment, delta_low1_pct: low, delta_avg_pct: avg },
    noise_evidence: { band_pct: 3, measured_noise_pct: null },
  });

  it("a 1% low gain beside an average that fell beyond the band reads no change, restored", async () => {
    state.gate = true;
    state.experiments = [judged("no-change", 20, -8.3)];
    render(<ExperimentBench />);
    expect(await screen.findByText("No measurable change — restored")).toBeInTheDocument();
    expect(screen.getByTestId("exp-compared-receipt")).toHaveTextContent(
      "Compared with the baseline: 1% low +20%, average frame rate -8.3%, both against a ±3% band. The 1% low rose by more than the band, but the average fell by more than it, so this isn't a clear win: the default was kept and the change restored.",
    );
  });

  it("an average that rose beside a falling 1% low reads slower, restored", async () => {
    state.gate = true;
    state.experiments = [judged("regressed", -6.7, 8.3)];
    render(<ExperimentBench />);
    expect(await screen.findByText("Slower — restored")).toBeInTheDocument();
    expect(screen.getByTestId("exp-compared-receipt")).toHaveTextContent(
      "1% low -6.7%, average frame rate +8.3%, both against a ±3% band. The 1% low fell by more than the band, so the change was restored.",
    );
  });

  it("a kept win and a tie say why", async () => {
    state.gate = true;
    state.experiments = [judged("improved", 11.1, 4.2), { ...judged("no-change", 2, 10), id: "exp:9-0" }];
    render(<ExperimentBench />);
    const lines = (await screen.findAllByTestId("exp-compared-receipt")).map((n) => n.textContent);
    expect(lines[0]).toMatch(/1% low \+11\.1%, average frame rate \+4\.2%.*so the change was kept\.$/);
    expect(lines[1]).toMatch(/The 1% low stayed inside the band, so the default was kept and the change restored\.$/);
  });

  it("says the same in zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    state.gate = true;
    state.experiments = [judged("no-change", 20, -8.3)];
    render(<ExperimentBench />);
    expect(await screen.findByTestId("exp-compared-receipt")).toHaveTextContent(
      "与基准相比：1% 最低帧 +20%，平均帧率 -8.3%，两者都按 ±3% 的范围判定。1% 最低帧的提升超过了该范围，但平均帧率的下降也超过了它，所以不算明确的改善：保持默认，已恢复这项更改。",
    );
  });

  it("an older row judged on the 1% low alone, and a too-noisy row, say nothing about the average", async () => {
    state.gate = true;
    state.experiments = [
      { ...KEPT_EXPERIMENT, noise_evidence: { band_pct: 3, measured_noise_pct: null } },
      { ...judged("too-noisy", -18.5, -16.6), id: "exp:8-0", noise_evidence: null },
    ];
    render(<ExperimentBench />);
    expect(await screen.findByText("Measurably faster — kept")).toBeInTheDocument();
    expect(screen.queryByTestId("exp-compared-receipt")).toBeNull();
  });
});

// CR-trial-zero-base: an older record with a 0 or unread baseline 1% low has no defined percent change.
// Its row prints "—", carries no verdict wording, and says nothing about what was compared.
describe("ExperimentBench — a Trial with no baseline 1% low", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  const judgedOn = (baseline: number | null, delta: number | null) => ({
    ...KEPT_EXPERIMENT,
    baseline_low1_fps: baseline,
    treatment: { ...KEPT_EXPERIMENT.treatment, delta_low1_pct: delta, delta_avg_pct: 4.2 },
    noise_evidence: { band_pct: 3, measured_noise_pct: null },
  });

  it.each([
    ["a 0 baseline", 0, Infinity],
    ["a NaN baseline", NaN, NaN],
    ["a baseline serde wrote as null", null, null],
  ])("%s shows — and no verdict", async (_name, baseline, delta) => {
    state.gate = true;
    state.experiments = [judgedOn(baseline as number | null, delta as number | null)];
    render(<ExperimentBench />);
    expect(await screen.findByTestId("exp-bench-delta")).toHaveTextContent(/^—$/);
    expect(screen.queryByText("Measurably faster — kept")).toBeNull();
    expect(screen.queryByTestId("exp-compared-receipt")).toBeNull();
  });

  it("a real baseline still prints its delta and verdict", async () => {
    state.gate = true;
    state.experiments = [judgedOn(180, 11.1)];
    render(<ExperimentBench />);
    expect(await screen.findByText("Measurably faster — kept")).toBeInTheDocument();
    expect(screen.getByTestId("exp-bench-delta")).toHaveTextContent("+11.1");
  });
});

// P4-maxfps-smooth (ENGINE §2): the user picks what a Trial aims for; Recommended is the default.
// P4-smooth-offer-b: Smoothest is offered only when the backend says it can judge it from this session,
// and otherwise says what is missing. A judged row says what it compared, by its own outcome's rule.
describe("ExperimentBench — Maximum FPS, and Smoothest when measured", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  const openOutcomePicker = async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", passes: true, reason: null, detail: null }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    await pickChange("test-rec");
    const start = await screen.findByRole("button", { name: /Start experiment/ });
    await waitFor(() => expect(start).toBeEnabled());
    const trigger = screen.getAllByRole("combobox")[2];
    fireEvent.click(trigger);
    return { start, trigger };
  };

  it("offers Recommended and Maximum FPS, and starts with the pick", async () => {
    const { start, trigger } = await openOutcomePicker();
    const why = screen.getByTestId("exp-outcome-why");
    expect(trigger).toHaveTextContent("Recommended");
    expect(why).toHaveTextContent("Keeps the change only if the 1% low rises beyond the noise band");
    const labels = [...document.querySelectorAll('[role="listbox"] [data-value]')].map((n) => n.textContent);
    expect(labels).toEqual(["Recommended", "Maximum FPS", "Smoothest"]);
    fireEvent.click(document.querySelector('[role="listbox"] [data-value="max-fps"]') as HTMLElement);
    await waitFor(() => expect(trigger).toHaveTextContent("Maximum FPS"));
    expect(why).toHaveTextContent(
      "Keeps the change only if the average frame rate rises beyond the noise band and the 1% low doesn't fall beyond it.",
    );
    vi.mocked(invoke).mockClear();
    fireEvent.click(start);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("start_experiment", expect.anything()));
    expect(callArgs("start_experiment")).toMatchObject({ outcome: "max-fps" });
  });

  it("holds Smoothest with what is missing, and it can't be picked", async () => {
    state.smoothReady = { held: "unmeasured", min_sessions: 3 };
    const { trigger } = await openOutcomePicker();
    const smooth = document.querySelector('[role="listbox"] [data-value="smoothest"]') as HTMLElement;
    expect(smooth).toHaveAttribute("aria-disabled", "true");
    expect(await screen.findByTestId("exp-outcome-smoothest")).toHaveTextContent(
      "Smoothest needs at least 3 sessions of this game with nothing changed between them, each with frame pacing recorded by this version of Compy",
    );
    fireEvent.click(smooth);
    expect(trigger).toHaveTextContent("Recommended");
    // The check is asked about the session a Trial would start from.
    const asked = vi.mocked(invoke).mock.calls.filter(([c]) => c === "get_smoothest_readiness").map(([, a]) => a);
    expect(asked.length).toBeGreaterThan(0);
    for (const a of asked) expect(a).toEqual({ baselineSessionId: VALORANT_SESSION.started_at });
    cleanup();
    await i18n.changeLanguage("zh-CN");
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");
    await pickChange("test-rec");
    expect(await screen.findByTestId("exp-outcome-smoothest")).toHaveTextContent("“最流畅”需要这款游戏至少 3 次");
  });

  it("names each missing piece, and says it couldn't check when the check fails", async () => {
    for (const [ready, text] of [
      [{ held: "no-start-pacing", min_sessions: 3 }, "Smoothest needs frame pacing from the session this Trial starts from"],
      [{ held: "history-unread", min_sessions: 3 }, "Smoothest needs Compy's change history"],
      ["reject", "Compy couldn't check whether this game's frame pacing is measured yet"],
      [null, "Compy couldn't check whether this game's frame pacing is measured yet"],
    ] as const) {
      state.smoothReady = ready;
      const { trigger } = await openOutcomePicker();
      expect(await screen.findByTestId("exp-outcome-smoothest")).toHaveTextContent(text);
      expect(document.querySelector('[role="listbox"] [data-value="smoothest"]')).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(trigger);
      cleanup();
      vi.mocked(invoke).mockClear();
    }
  });

  it("offers Smoothest when the backend can judge it, and starts with that pick", async () => {
    state.smoothReady = { held: null, min_sessions: 3 };
    const { start, trigger } = await openOutcomePicker();
    const smooth = document.querySelector('[role="listbox"] [data-value="smoothest"]') as HTMLElement;
    await waitFor(() => expect(smooth).not.toHaveAttribute("aria-disabled", "true"));
    expect(screen.queryByTestId("exp-outcome-smoothest")).toBeNull();
    fireEvent.click(smooth);
    await waitFor(() => expect(trigger).toHaveTextContent("Smoothest"));
    expect(screen.getByTestId("exp-outcome-why")).toHaveTextContent(
      "Keeps the change only if frames get steadier beyond this game's own pacing band and the 1% low doesn't fall beyond its band.",
    );
    expect(start).toBeEnabled();
    vi.mocked(invoke).mockClear();
    fireEvent.click(start);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("start_experiment", expect.anything()));
    expect(callArgs("start_experiment")).toMatchObject({ outcome: "smoothest" });
  });

  it("asks again after a reload, and a Smoothest pick the check no longer allows goes back to Recommended", async () => {
    state.smoothReady = { held: null, min_sessions: 3 };
    const { trigger } = await openOutcomePicker();
    const smooth = document.querySelector('[role="listbox"] [data-value="smoothest"]') as HTMLElement;
    await waitFor(() => expect(smooth).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(smooth);
    await waitFor(() => expect(trigger).toHaveTextContent("Smoothest"));
    // Something changed the history: the next reload's answer holds it.
    state.smoothReady = { held: "unmeasured", min_sessions: 3 };
    fireEvent(window, new Event(LEDGER_CHANGED_EVENT));
    expect(await screen.findByTestId("exp-outcome-smoothest")).toHaveTextContent("Smoothest needs at least 3 sessions");
    await waitFor(() => expect(trigger).toHaveTextContent("Recommended"));
    expect(screen.getByTestId("exp-outcome-why")).toHaveTextContent("Keeps the change only if the 1% low rises beyond the noise band");
  });

  it("the picker's outcome names are the backend's", async () => {
    const { readFileSync } = await import("fs");
    const rs = readFileSync("src-tauri/src/experiment.rs", "utf8");
    const tsx = readFileSync("src/surfaces/ExperimentBench.tsx", "utf8");
    expect(tsx).toContain('const OUTCOME_OPTIONS = ["recommended", "max-fps", "smoothest"] as const;');
    // What the backend starts with. Smoothest is read there and admitted only for a game whose frame
    // pacing is measured (P4-smooth-offer-a); the bench still holds it until it reads that (-b).
    expect(rs).toContain('None | Some("recommended") => Ok(TrialOutcome::Recommended),');
    expect(rs).toContain('Some("max-fps") => Ok(TrialOutcome::MaxFps),');
    expect(rs).toContain('Some("smoothest") => Ok(TrialOutcome::Smoothest),');
    // The bench's readiness is the start's own check (`smoothest_for`), keyed as the bench reads it.
    expect(rs).toContain("let evidence = smoothest_for(&covered, baseline, &history)");
    expect(rs).toContain("held: smoothest_for(&sessions_the_ledger_covers(&sessions, coverage), from, &history).err(),");
    expect(rs).toContain("pub(crate) fn get_smoothest_readiness(baseline_session_id: String)");
    const keys = ["HistoryUnread", "Unmeasured", "NoStartPacing"].map((v) => v.replace(/[A-Z]/g, (c, i) => (i ? "-" : "") + c.toLowerCase()));
    expect(tsx).toContain(`type SmoothestHeld = ${keys.map((k) => `"${k}"`).join(" | ")};`);
    for (const v of ["HistoryUnread", "Unmeasured", "NoStartPacing"]) expect(rs).toContain(`    ${v},\n`);
    // Registered on both sides of the IPC allowlist.
    expect(readFileSync("src-tauri/build.rs", "utf8")).toContain('"get_smoothest_readiness",');
    expect(readFileSync("src-tauri/src/lib.rs", "utf8")).toContain("experiment::get_smoothest_readiness,");
  });

  it("a Smoothest row leads with frame pacing on its own band, and says why", async () => {
    const smooth = (verdict: string, low: number, after: number | null, id: string) => ({
      ...judged(verdict, low, 0),
      id,
      outcome: "smoothest",
      smoothest: { band_pct: 2, start_ratio: 1.5, after_ratio: after },
    });
    state.gate = true;
    state.experiments = [
      smooth("improved", 0, 1.44, "exp:1-0"),
      smooth("regressed", 0, 1.56, "exp:2-0"),
      smooth("regressed", -6.7, 1.44, "exp:3-0"),
      smooth("no-change", 0, 1.5, "exp:4-0"),
      smooth("no-change", 20, null, "exp:5-0"),
    ];
    render(<ExperimentBench />);
    const lines = (await screen.findAllByTestId("exp-compared-receipt")).map((n) => n.textContent);
    expect(lines[0]).toBe(
      "Judged for Smoothest. Compared with the baseline: the gap between the slowest 1% of frames and a typical frame -4.2% against a ±2% band, 1% low 0% against a ±3% band. Frames got steadier by more than the band and the 1% low didn't fall by more than its band, so the change was kept.",
    );
    expect(lines[1]).toMatch(/frame \+4% against a ±2% band.*Frames got more uneven by more than the band, so the change was restored\.$/);
    expect(lines[2]).toMatch(/The 1% low fell by more than the band, so the change was restored\.$/);
    expect(lines[3]).toMatch(/Frame pacing stayed inside the band, so the default was kept and the change restored\.$/);
    expect(lines[4]).toMatch(/^Judged for Smoothest\. Compared with the baseline: frame pacing couldn't be compared, 1% low \+20%.*Without frame pacing from both sessions/);
  });

  const judged = (verdict: string, low: number, avg: number) => ({
    ...KEPT_EXPERIMENT,
    outcome: "max-fps",
    status: verdict === "improved" ? "kept" : "restored",
    kept: verdict === "improved",
    verdict,
    treatment: { ...KEPT_EXPERIMENT.treatment, delta_low1_pct: low, delta_avg_pct: avg },
    noise_evidence: { band_pct: 3, measured_noise_pct: null },
  });

  it("a Maximum FPS row leads with the average and says why it was kept or restored", async () => {
    state.gate = true;
    state.experiments = [
      judged("improved", 0, 8.3),
      { ...judged("no-change", 20, 2), id: "exp:9-0" },
      { ...judged("regressed", 20, -8.3), id: "exp:8-0" },
      { ...judged("regressed", -6.7, 8.3), id: "exp:7-0" },
    ];
    render(<ExperimentBench />);
    const lines = (await screen.findAllByTestId("exp-compared-receipt")).map((n) => n.textContent);
    expect(lines[0]).toBe(
      "Judged for Maximum FPS. Compared with the baseline: average frame rate +8.3%, 1% low 0%, both against a ±3% band. The average rose by more than the band and the 1% low didn't fall by more, so the change was kept.",
    );
    expect(lines[1]).toMatch(/1% low \+20%.*The average stayed inside the band, so the default was kept and the change restored\.$/);
    expect(lines[2]).toMatch(/The average fell by more than the band, so the change was restored\.$/);
    expect(lines[3]).toMatch(/The 1% low fell by more than the band, so the change was restored\.$/);
  });

  it("says the same in zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    state.gate = true;
    state.experiments = [judged("improved", 0, 8.3)];
    render(<ExperimentBench />);
    expect(await screen.findByTestId("exp-compared-receipt")).toHaveTextContent(
      "按“最高帧率”判定。与基准相比：平均帧率 +8.3%，1% 最低帧 0%，两者都按 ±3% 的范围判定。平均帧率的提升超过了该范围，且 1% 最低帧的下降没有超过它，所以保留了这项更改。",
    );
  });

  it("an older row with no pick, or a stored pick this build doesn't judge, keeps the Recommended wording", async () => {
    state.gate = true;
    state.experiments = [
      { ...judged("no-change", 2, 10), outcome: undefined },
      { ...judged("no-change", 2, 10), outcome: "turbo", id: "exp:9-0" },
    ];
    render(<ExperimentBench />);
    const lines = (await screen.findAllByTestId("exp-compared-receipt")).map((n) => n.textContent);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/^Compared with the baseline: 1% low \+2%, average frame rate \+10%.*The 1% low stayed inside the band/);
    }
  });
});

// P4-next (ENGINE §7): after a Trial concludes, its result offers the next change in the suggested
// order not yet tested on that game here, as an offer only; with none left it says so as a success.
// "Tested" = a record of the change on that game in this PC's experiments store with a verdict.
describe("ExperimentBench — the next change to test after a Trial", () => {
  const cand = (id: string, title: string, position: number, evidence = "not-measured") => ({
    id,
    title,
    passes: true,
    reason: null,
    detail: null,
    position,
    evidence,
    risk: "low",
    stated_effect_pct: null,
  });
  const rec = (rec_id: string, game: string, verdict: string | null, status = "restored") => ({
    ...KEPT_EXPERIMENT,
    id: `exp:${rec_id}-${game}`,
    rec_id,
    rec_title: rec_id,
    game,
    status,
    verdict,
    kept: status === "kept",
    baseline_session_id: VALORANT_SESSION.started_at,
  });

  // Round 3: a result counts as tested only under a MATCHING context against the newest session, so the
  // harness session records a driver and build, and the records' baselines point at it.
  const CTX_SESSION = { ...VALORANT_SESSION, hw_fingerprint: { gpu: "GPU", gpu_driver: "32.0.1" }, game_state: { gpu_driver: "32.0.1", windows_build: "26200.8457" } };
  /** Render a running Trial, let the store hold `after` once it concludes, and conclude it. */
  const concludeInto = async (after: unknown[]) => {
    state.gate = true;
    state.experiments = [RUNNING_EXPERIMENT];
    state.sessions = [CTX_SESSION];
    render(<ExperimentBench />);
    const conclude = await screen.findByRole("button", { name: /Conclude with my latest/ });
    state.experiments = after;
    vi.mocked(invoke).mockClear();
    fireEvent.click(conclude);
    return screen.findByTestId("exp-next");
  };

  it("offers the next untested change with one line saying why, and never starts it", async () => {
    state.recs = [
      cand("a-rec", "Change A", 1, "measured"),
      cand("b-rec", "Change B", 2),
      cand("c-rec", "Change C", 3),
    ];
    state.sim = { ...WORTH_TESTING_SIM, rec_id: "b-rec", rec_title: "Change B" };
    // A was tested on Valorant (too noisy still counts); B only on another game, so B is next.
    const next = await concludeInto([
      rec("hags", "Valorant", "no-change"),
      rec("a-rec", "Valorant", "too-noisy"),
      rec("b-rec", "cs2.exe", "improved", "kept"),
    ]);
    expect(next).toHaveTextContent(/Next to test on Valorant: Change B/);
    expect(next).toHaveTextContent(
      "It's next in the suggested order: expected to help, not measured; low risk. How big its effect is isn't known.",
    );
    expect(next).toHaveTextContent("Nothing changes until you start it.");
    expect(next).not.toHaveTextContent("Change A");
    fireEvent.click(screen.getByRole("button", { name: "Set up this test" }));
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("simulate_optimization", { recId: "b-rec" }),
    );
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("start_experiment", expect.anything());
  });

  it("a Trial the user restored before a verdict doesn't count as tested", async () => {
    state.recs = [cand("a-rec", "Change A", 1)];
    const next = await concludeInto([rec("hags", "Valorant", "no-change"), rec("a-rec", "Valorant", null)]);
    expect(next).toHaveTextContent(/Next to test on Valorant: Change A/);
  });

  // Round 3 of the 2026-10-26 follow-up review (§2): the "none left" line is worded from what EVERY
  // change holds. Two measured, matching results: no more to test, plainly. One measured beside one
  // that judged nothing and is no longer offered: the counts, never "every change has a result".
  it.each([
    ["kept", "improved", "kept", "No more changes are available to test on Valorant right now."],
    ["restored", "no-change", "restored", "No more changes are available to test on Valorant right now."],
    ["too noisy", "too-noisy", "restored", "1 change was measured. 1 couldn't be judged."],
  ])("with none left after a %s result, says so as a success, not a warning, and counts what was and wasn't measured", async (_n, verdict, status, why) => {
    state.recs = [
      cand("a-rec", "Change A", 1),
      { id: "hags", title: "HAGS", passes: false, reason: "already-set-by-compy", detail: null },
    ];
    const next = await concludeInto([rec("hags", "Valorant", verdict, status), rec("a-rec", "Valorant", "regressed")]);
    const done = screen.getByTestId("exp-next-done");
    expect(done).toHaveTextContent("Nothing else here is worth testing on this PC.");
    expect(done.closest(".exp-bench-warn, [role=alert]")).toBeNull();
    const line = screen.getByTestId("exp-next-done-why");
    expect(line).toHaveTextContent(why);
    expect(line).not.toHaveTextContent("has a result");
    expect(next).toHaveTextContent("Compy doesn't know how big any change's effect would be");
    expect(screen.queryByRole("button", { name: "Set up this test" })).toBeNull();
  });

  it("offers nothing before a Trial concludes in this visit", async () => {
    state.gate = true;
    state.recs = [cand("a-rec", "Change A", 1)];
    state.experiments = [KEPT_EXPERIMENT];
    render(<ExperimentBench />);
    await screen.findByText("Suggested order to test:");
    expect(screen.queryByTestId("exp-next")).toBeNull();
  });
});

// P4-exit (ROADMAP Phase 4 exit): the per-game summary on the bench, on the owner's real WARDOGS
// records. It reads; it never offers a write.
describe("P4-exit: what Compy tested on this game", () => {
  const owner = async () => (await import("../test/fixtures/wardogs-p4-exit.json")).default;
  const pass = (id: string, title: string, position: number) => ({ id, title, passes: true, reason: null, detail: null, position, evidence: "not-measured", risk: "low" });

  async function renderOwner(recs: unknown[]) {
    const f = await owner();
    state.gate = true;
    state.experiments = f.experiments;
    state.sessions = f.sessions;
    state.recs = recs;
    render(<ExperimentBench />);
    return screen.findByTestId("exp-summary");
  }

  it("on the owner's WARDOGS data: Slower, restored, medium confidence, not applied; one more worth testing", async () => {
    const panel = await renderOwner([
      pass("mouse-accel-off", "Turn off mouse acceleration", 1),
      pass("visual-effects", "Trim Windows visual effects", 2),
      { id: "game-bar-disable", title: "Turn off Game Bar", passes: false, reason: "already-set", detail: null },
    ]);
    expect(panel).toHaveTextContent("What Compy tested on WardogsClient");
    expect(screen.getByTestId("exp-summary-headline")).toHaveTextContent(
      "1 more change is still worth testing on WardogsClient, so this isn't finished yet.",
    );
    expect(panel).not.toHaveTextContent("finished the supported tests");
    const tested = screen.getByTestId("exp-summary-tested");
    expect(tested).toHaveTextContent("Trim Windows visual effects: Slower — restored · Measured · Not applied now.");
    expect(screen.getByTestId("exp-summary-stays")).toHaveTextContent("Nothing from these tests stays applied.");
    expect(screen.getByTestId("exp-summary-left")).toHaveTextContent("Turn off mouse acceleration");
    expect(screen.getByTestId("exp-summary-skipped")).toHaveTextContent("Turn off Game Bar: Already set this way in Windows, not by Compy.");
    // P7-depth-verdicts: the noise band, the context line and each change's deltas are the RECEIPT,
    // one tap away; the answer face carries no raw number beyond the stated minimum band and the
    // lesson's own figure. "1% low" is the metric's name.
    expect(screen.queryByTestId("exp-summary-noise")).toBeNull();
    expect(screen.queryByTestId("exp-summary-context")).toBeNull();
    expect(panel.textContent!.replace(/1% lows?/g, "").match(/[\d.]+\s*%/g)).toEqual(["18.5%", "3%"]);
    // Read-only: the panel has no action button (a glossed term's own trigger is a disclosure, not an action).
    expect(panel.querySelectorAll("button:not(.kl-term)")).toHaveLength(0);
    const door1 = panel.querySelector('[data-testid="exp-summary-depth-receipt"] > summary')!;
    fireEvent.click(door1);
    // Depth mounts a door's content on the details' toggle (a later task in jsdom): wait for it.
    await waitFor(() => expect(door1.parentElement!.children.length).toBeGreaterThan(1));
    expect(screen.getByTestId("exp-summary-noise")).toHaveTextContent(
      "Judged against Compy's 3% noise floor. This game's own run-to-run noise on your PC hasn't been measured yet.",
    );
    expect(screen.getByTestId("exp-summary-context")).toHaveTextContent(
      "WardogsClient · AMD Radeon RX 9070 XT · driver 32.0.32015.7029 · Windows build 26200.8457 · 1920×1080 @ 250 Hz",
    );
    // Round 4 review: this line is the LAST RECORDED context, dated, never "measured on" (whether a
    // result is current is each row's judgment against the newest session).
    expect(screen.getByTestId("exp-summary-context").textContent).toMatch(/^Last recorded context \(.+\): WardogsClient/);
    expect(screen.getByTestId("exp-summary-context")).toHaveAttribute("data-context-at");
    expect(screen.getByTestId("exp-summary-context")).not.toHaveTextContent("Measured on");
    // The receipt's per-change row: id, verdict, the stored deltas, the band it was judged on, trials, context.
    const receipt = screen.getByTestId("exp-summary-receipt");
    expect(receipt.querySelector("dt")!.textContent).toBe("visual-effects");
    // The owner's record stored no average delta: the row shows none, never a made-up one. It predates
    // P8-posture-show, so the risk allowed when it started is "not recorded", never the default.
    expect(receipt.querySelector("dd")!.textContent).toBe(
      "regressed · 1% low -18.5% · band ±3% · 1 trial · matching · risk you allowed: not recorded",
    );
  });

  // P8-posture-show (RISK_MODEL §2): each tested change's receipt row names the risk the user allowed
  // when its newest judged Trial started, from that Trial's record. Fails on the code before this slice.
  it("each tested row's receipt names the risk allowed when its Trial started", async () => {
    const f = await owner();
    state.gate = true;
    state.experiments = f.experiments.map((x: Record<string, unknown>) => ({ ...x, risk_choice: "low-only" }));
    state.sessions = f.sessions;
    state.recs = [pass("visual-effects", "Trim Windows visual effects", 1)];
    render(<ExperimentBench />);
    const panel = await screen.findByTestId("exp-summary");
    const door = panel.querySelector('[data-testid="exp-summary-depth-receipt"] > summary')!;
    fireEvent.click(door);
    // 3s: the default 1s timed out once under a loaded parallel run (review 2026-11-02, round 2).
    await waitFor(() => expect(door.parentElement!.children.length).toBeGreaterThan(1), { timeout: 3000 });
    expect(screen.getByTestId("exp-summary-receipt").querySelector("dd")!.textContent).toMatch(
      / · risk you allowed: Low risk only$/,
    );
  });

  it("says it finished the supported tests only when the picker has nothing untested or worth another run", async () => {
    const panel = await renderOwner([pass("visual-effects", "Trim Windows visual effects", 1)]);
    expect(panel).toHaveAttribute("data-headline", "finished-supported-tests");
    expect(screen.getByTestId("exp-summary-headline")).toHaveTextContent(
      "Compy finished the supported tests for WardogsClient on this PC: every change it lists as worth testing here has a measured result.",
    );
    expect(screen.queryByTestId("exp-summary-retest")).toBeNull();
    // P9-settings-done: with no scan in hand the limiter is "not measured" and no upgrade is the answer.
    const done = screen.getByTestId("exp-summary-settings-done");
    expect(done).toHaveAttribute("data-kind", "not-measured");
    expect(done).toHaveTextContent(
      "Settings have reached what Compy can test here. What holds this PC back hasn't been measured, so no upgrade is recommended.",
    );
  });

  it("P9-settings-done: a finished summary names the last scan's top limiter, a setting or a part", async () => {
    const lim = (id: string, title: string) => ({ id, title, reason: "", linked: null, confidence: "medium", status: "attention" });
    const scan = (limiters: unknown[]) => ({
      readiness: null,
      priorities: { limiters, already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null },
      recs: [],
      reverted: [],
      elapsed: null,
    });
    try {
      putProbe("readiness-scan", scan([lim("monitor-refresh", "Monitor refresh rate")]));
      await renderOwner([pass("visual-effects", "Trim Windows visual effects", 1)]);
      expect(screen.getByTestId("exp-summary-settings-done")).toHaveTextContent(
        "The last check's top limiter is a setting, not a part: Monitor refresh rate. No upgrade is recommended for it.",
      );
      cleanup();
      putProbe("readiness-scan", scan([lim("gpu-headroom", "Graphics card")]));
      await renderOwner([pass("visual-effects", "Trim Windows visual effects", 1)]);
      const done = screen.getByTestId("exp-summary-settings-done");
      expect(done).toHaveAttribute("data-kind", "part-limiter");
      expect(done).toHaveTextContent("The last check's top limiter is a part of this PC: Graphics card.");
      // P9-part-line-context (Phase 9 Exit: never a part in isolation): what Compy can't check.
      expect(done).toHaveTextContent(
        "Graphics card. Before any part: Compy can't check how a new one would fit the rest of this PC (its power supply, motherboard and case). Check those first.",
      );
      // Phase 9 law: a named part is never a shopping line.
      expect(done.textContent).not.toMatch(/buy|\$|price|upgrade to/i);
    } finally {
      invalidateProbe("readiness-scan");
    }
  });

  // P9-summary-no-dead-pointer: Check's upgrade block never renders in the shipped room
  // (P9-upgrade-block-reachable), so the GPU-limiter line must not send the user there.
  it("P9-summary-no-dead-pointer: the GPU-limiter line names no room it can't be read in", async () => {
    const scan = {
      readiness: null,
      priorities: {
        limiters: [],
        already_fine: [],
        not_worth_touching: [],
        session_hint: null,
        upgrade_path: null,
        gpu_limited_games: [{ game: "WardogsClient-Win64-Shipping.exe", share_pct: 80, peak_pct: 99, threshold_pct: 95 }],
      },
      recs: [],
      reverted: [],
      elapsed: null,
    };
    try {
      putProbe("readiness-scan", scan);
      await renderOwner([pass("visual-effects", "Trim Windows visual effects", 1)]);
      const done = screen.getByTestId("exp-summary-settings-done");
      expect(done).toHaveAttribute("data-kind", "gpu-limiter");
      expect(done).toHaveTextContent(
        "80% of Compy's GPU readings were at 95% load or more, so the GPU is the measured limiter for this game. Compy can't check your power supply, case or the rest of the system for a new card.",
      );
      expect(done.textContent).not.toMatch(/Optimize|\bCheck\b|→/);
      // Review nit: zh-CN too, straight from the locale files.
      const en = (await import("../i18n/locales/en/lab.json")).default as { experimentBench: { summary: { settingsDone: { gpuLimiter: string } } } };
      const zh = (await import("../i18n/locales/zh-CN/lab.json")).default as typeof en;
      expect(en.experimentBench.summary.settingsDone.gpuLimiter).not.toMatch(/Optimize|\bCheck\b|→/);
      expect(zh.experimentBench.summary.settingsDone.gpuLimiter).not.toMatch(/「优化」|「检查」|→/);
    } finally {
      invalidateProbe("readiness-scan");
    }
  });

  // P9-no-upgrade-cpu-unknown (fourth range review, honesty): a GPU that often wasn't busy is the
  // usual sign of a CPU limit or a frame cap, neither of which Compy measures, so the measured-clear
  // line says so and rules out only a GPU upgrade; the share is the rule's own, from the row.
  it("P9-no-upgrade-cpu-unknown: the measured-clear line says what Compy can't measure and rules out only a GPU upgrade", async () => {
    const scan = {
      readiness: null,
      priorities: {
        limiters: [],
        already_fine: [],
        not_worth_touching: [],
        session_hint: null,
        upgrade_path: null,
        gpu_clear_games: [{ game: "WardogsClient-Win64-Shipping.exe", busy: 120, readings: 900, threshold_pct: 95, limit_share_pct: 50 }],
      },
      recs: [],
      reverted: [],
      elapsed: null,
    };
    try {
      putProbe("readiness-scan", scan);
      await renderOwner([pass("visual-effects", "Trim Windows visual effects", 1)]);
      const done = screen.getByTestId("exp-summary-settings-done");
      expect(done).toHaveAttribute("data-kind", "nothing-limiting");
      expect(done).toHaveTextContent(
        "120 of 900 GPU readings were at 95% load or more, under the 50% Compy counts as GPU-limited, so Compy doesn't count the GPU as the limit there. A GPU that often isn't near full load usually means the CPU or a frame cap set the pace, and Compy measures neither, so it can't say the CPU didn't hold this game back. No GPU upgrade is recommended.",
      );
      expect(done.textContent).not.toMatch(/nothing holding this PC back|No upgrade is recommended/);
      const zh = (await import("../i18n/locales/zh-CN/lab.json")).default as {
        experimentBench: { summary: { settingsDone: { nothingLimitingMeasured: string } } };
      };
      const line = zh.experimentBench.summary.settingsDone.nothingLimitingMeasured;
      expect(line).toContain("{{limitShare}}%");
      expect(line).toMatch(/CPU.*帧率上限.*都不测量/);
      expect(line).toMatch(/不建议升级显卡。$/);
    } finally {
      invalidateProbe("readiness-scan");
    }
  });

  // P9-summary-screen-limit: the same session averaged at or above its screen's refresh.
  it("P9-summary-screen-limit: a GPU-limited session that out-ran its screen names the screen", async () => {
    const g = { game: "WardogsClient-Win64-Shipping.exe", share_pct: 80, peak_pct: 99, threshold_pct: 95, avg_fps: 251.6, refresh_hz: 250 };
    const scan = {
      readiness: null,
      priorities: { limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null, gpu_limited_games: [g] },
      recs: [],
      reverted: [],
      elapsed: null,
    };
    try {
      putProbe("readiness-scan", scan);
      await renderOwner([pass("visual-effects", "Trim Windows visual effects", 1)]);
      const done = screen.getByTestId("exp-summary-settings-done");
      expect(done).toHaveAttribute("data-kind", "gpu-limiter");
      expect(done).toHaveTextContent(
        "80% of Compy's GPU readings were at 95% load or more, but your screen ran at 250 Hz in that session, so it could show at most 250 frames a second, and that session averaged 252 fps: on average a faster GPU wouldn't have shown you more frames at that refresh rate; the slowest moments can still depend on it. For frame rate at 250 Hz, no GPU upgrade is recommended for this game.",
      );
      expect(done.textContent).not.toMatch(/measured limiter for this game/);
    } finally {
      invalidateProbe("readiness-scan");
    }
  });

  // P9-session-on-this-hardware: a session that can't be tied to the card in this PC now says so,
  // under the GPU-limiter line and under the measured-clear line; a session on this card adds nothing.
  it.each([
    ["gpu-limiter", "not-recorded", "That session didn't record which graphics card it ran on, so Compy can't tie this line to the card in this PC now."],
    ["gpu-limiter", "card-unread", "Compy can't identify the graphics card in this PC right now, so it can't tie this line to the card that session ran on."],
    ["nothing-limiting", "not-recorded", "That session didn't record which graphics card it ran on, so Compy can't tie this line to the card in this PC now."],
    ["gpu-limiter", "this-card", null],
    ["nothing-limiting", "this-card", null],
  ])("P9-session-on-this-hardware: a %s line from a %s session", async (kind, gpu_tie, words) => {
    const game = "WardogsClient-Win64-Shipping.exe";
    const rows =
      kind === "gpu-limiter"
        ? { gpu_limited_games: [{ game, share_pct: 80, peak_pct: 99, threshold_pct: 95, gpu_tie }] }
        : { gpu_clear_games: [{ game, busy: 120, readings: 900, threshold_pct: 95, limit_share_pct: 50, gpu_tie }] };
    const scan = {
      readiness: null,
      priorities: { limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null, ...rows },
      recs: [],
      reverted: [],
      elapsed: null,
    };
    try {
      putProbe("readiness-scan", scan);
      await renderOwner([pass("visual-effects", "Trim Windows visual effects", 1)]);
      const done = screen.getByTestId("exp-summary-settings-done");
      expect(done).toHaveAttribute("data-kind", kind);
      if (words) expect(screen.getByTestId("exp-summary-settings-done-untied").textContent).toBe(` ${words}`);
      else expect(screen.queryByTestId("exp-summary-settings-done-untied")).toBeNull();
    } finally {
      invalidateProbe("readiness-scan");
    }
  });

  it("P9-settings-done: no settings-done line while changes are still worth testing", async () => {
    const panel = await renderOwner([
      pass("visual-effects", "Trim Windows visual effects", 1),
      pass("mouse-accel", "Turn off mouse acceleration", 2),
    ]);
    expect(panel).toHaveAttribute("data-headline", "still-worth-testing");
    expect(screen.queryByTestId("exp-summary-settings-done")).toBeNull();
    // P9-software-first: no scan in hand, no part named, so no line either.
    expect(screen.queryByTestId("exp-summary-software-first")).toBeNull();
  });

  it("P9-software-first: a part named by the last check comes after the settings still worth trying", async () => {
    const lim = (id: string, title: string) => ({ id, title, reason: "", linked: null, confidence: "medium", status: "attention" });
    const scan = (limiters: unknown[]) => ({
      readiness: null,
      priorities: { limiters, already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null },
      recs: [],
      reverted: [],
      elapsed: null,
    });
    try {
      putProbe("readiness-scan", scan([lim("gpu-headroom", "Graphics card")]));
      const panel = await renderOwner([
        pass("visual-effects", "Trim Windows visual effects", 1),
        pass("mouse-accel", "Turn off mouse acceleration", 2),
      ]);
      expect(panel).toHaveAttribute("data-headline", "still-worth-testing");
      const line = screen.getByTestId("exp-summary-software-first");
      expect(line).toHaveTextContent(
        "The last check's top limiter is a part of this PC: Graphics card. Try this setting before any upgrade: Turn off mouse acceleration.",
      );
      expect(line.textContent).not.toMatch(/buy|\$|price|upgrade to/i);
      expect(screen.queryByTestId("exp-summary-settings-done")).toBeNull();
      cleanup();
      // A setting as the limiter: nothing to put before it.
      putProbe("readiness-scan", scan([lim("monitor-refresh", "Monitor refresh rate")]));
      await renderOwner([pass("visual-effects", "Trim Windows visual effects", 1), pass("mouse-accel", "Turn off mouse acceleration", 2)]);
      expect(screen.queryByTestId("exp-summary-software-first")).toBeNull();
    } finally {
      invalidateProbe("readiness-scan");
    }
  });

  // TRUTHFUL COMPLETION (critical review 2026-10-26 §4): an attempt is not a result.
  it("a 'too noisy' attempt reads as worth another run, never as finished", async () => {
    const f = await owner();
    state.gate = true;
    state.experiments = f.experiments.map((x) => (x.verdict ? { ...x, verdict: "too-noisy", status: "restored", kept: false } : x));
    state.sessions = f.sessions;
    state.recs = [pass("visual-effects", "Trim Windows visual effects", 1)];
    render(<ExperimentBench />);
    const panel = await screen.findByTestId("exp-summary");
    expect(panel).toHaveAttribute("data-headline", "worth-retesting");
    expect(screen.getByTestId("exp-summary-headline")).toHaveTextContent(
      // Round 4 review: the headline names the reason PRESENT, not a fixed pair of reasons.
      "1 result on WardogsClient needs another run before it counts: couldn't be judged last time.",
    );
    expect(screen.getByTestId("exp-summary-headline")).not.toHaveTextContent("older graphics driver");
    expect(screen.getByTestId("exp-summary-retest")).toHaveTextContent("Worth another run: Trim Windows visual effects (couldn't be judged last time)");
    expect(panel).not.toHaveTextContent("finished the supported tests");
  });

  // P8-posture-note (review r1 SHOULD-FIX): "nothing left to test" must not hide a change held back
  // by the risk the user chose (Low risk only: the moderate change is held, the low one at its cap).
  it("'nothing left to test' still names a change held back by the chosen risk", async () => {
    const f = await owner();
    const judged = f.experiments.find((x) => x.verdict)!;
    const noisy = (id: string, at: string) => ({ ...judged, id, verdict: "too-noisy", status: "restored", kept: false, created_at: at, concluded_at: at });
    state.gate = true;
    state.experiments = [noisy("exp:n-a", "2026-10-24T11:00:00Z"), noisy("exp:n-b", "2026-10-25T11:00:00Z")];
    state.sessions = f.sessions;
    state.recs = [
      pass("visual-effects", "Trim Windows visual effects", 1),
      { id: "mouse-accel-off", title: "Turn off mouse acceleration", passes: false, reason: "outside-chosen-risk", detail: null, risk: "moderate" },
    ];
    render(<ExperimentBench />);
    const panel = await screen.findByTestId("exp-summary");
    expect(panel).toHaveAttribute("data-headline", "nothing-testable-now");
    const headline = screen.getByTestId("exp-summary-headline");
    expect(headline).toHaveTextContent("Nothing on WardogsClient is left for Compy to test right now");
    expect(headline).toHaveTextContent("1 more change is held back by the risk you chose.");
    await i18n.changeLanguage("zh-CN");
    try {
      expect(await screen.findByText(/另有 1 项更改因你选择的风险范围而暂不测试/)).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  // P8-posture-stale-copy: the held change has a (stale) measured result, so the stopping point must
  // not say "nothing was measured"; it says the result is older and the change is above the risk.
  it("a held change whose only result is stale is never worded as 'nothing was measured'", async () => {
    const f = await owner();
    const judged = f.experiments.find((x) => x.verdict)!;
    const ofGame = f.sessions.filter((s) => s.process_name === judged.game);
    const last = ofGame[ofGame.length - 1] as Record<string, unknown> & { hw_fingerprint: object; game_state: object };
    const newer = {
      ...last,
      started_at: "2026-10-30T00:00:00Z",
      hw_fingerprint: { ...last.hw_fingerprint, gpu_driver: "99.0.0" },
      game_state: { ...last.game_state, gpu_driver: "99.0.0" },
    };
    state.gate = true;
    state.experiments = f.experiments;
    state.sessions = [...f.sessions, newer] as typeof f.sessions;
    state.recs = [
      { id: judged.rec_id, title: judged.rec_title, passes: false, reason: "outside-chosen-risk", detail: null, risk: "moderate" },
    ];
    render(<ExperimentBench />);
    const panel = await screen.findByTestId("exp-summary");
    expect(panel).toHaveAttribute("data-headline", "nothing-testable-now");
    const headline = screen.getByTestId("exp-summary-headline");
    expect(headline).not.toHaveTextContent("nothing was measured");
    expect(headline).toHaveTextContent(
      "Nothing on WardogsClient is left for Compy to test within the risk you chose. 1 change has a result from an older graphics driver or Windows build",
    );
    await i18n.changeLanguage("zh-CN");
    try {
      expect(await screen.findByText(/有 1 项更改的结果来自较旧的显卡驱动或 Windows 版本/)).toBeInTheDocument();
      expect(screen.getByTestId("exp-summary-headline")).not.toHaveTextContent("也没有测得任何结果");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  // Harness review 2026-11-02 (round 1): beside a stale held change, a bare "1 couldn't be judged."
  // had no subject and read as belonging to the stale change. The unjudged one is another change.
  it("beside a stale held change, a change that couldn't be judged is named as another change", async () => {
    const f = await owner();
    const judged = f.experiments.find((x) => x.verdict)!;
    const ofGame = f.sessions.filter((s) => s.process_name === judged.game);
    const last = ofGame[ofGame.length - 1] as Record<string, unknown> & { hw_fingerprint: object; game_state: object };
    const newer = {
      ...last,
      started_at: "2026-10-30T00:00:00Z",
      hw_fingerprint: { ...last.hw_fingerprint, gpu_driver: "99.0.0" },
      game_state: { ...last.game_state, gpu_driver: "99.0.0" },
    };
    const noisy = { ...judged, id: "exp:noisy-1", rec_id: "game-mode", rec_title: "Game Mode", verdict: "too-noisy", kept: false };
    state.gate = true;
    state.experiments = [...f.experiments, noisy] as typeof f.experiments;
    state.sessions = [...f.sessions, newer] as typeof f.sessions;
    state.recs = [
      { id: judged.rec_id, title: judged.rec_title, passes: false, reason: "outside-chosen-risk", detail: null, risk: "moderate" },
    ];
    render(<ExperimentBench />);
    const panel = await screen.findByTestId("exp-summary");
    expect(panel).toHaveAttribute("data-headline", "nothing-testable-now");
    const headline = screen.getByTestId("exp-summary-headline");
    expect(headline).toHaveTextContent(
      "so Compy won't test it again unless you allow that risk. 1 other change couldn't be judged.",
    );
    expect(headline).not.toHaveTextContent(/allow that risk\. 1 couldn't be judged/);
    await i18n.changeLanguage("zh-CN");
    try {
      expect(await screen.findByText(/另有 1 项更改无法判断/)).toBeInTheDocument();
      expect(screen.getByTestId("exp-summary-headline")).toHaveTextContent("相关更改超出了你选择的风险范围");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("never claims it when the picker's list couldn't be read, nor 'not applied' without it", async () => {
    const f = await owner();
    state.gate = true;
    state.experiments = f.experiments;
    state.sessions = f.sessions;
    state.recs = null as unknown as unknown[];
    render(<ExperimentBench />);
    const panel = await screen.findByTestId("exp-summary");
    expect(panel).toHaveAttribute("data-headline", "unknown");
    expect(panel).not.toHaveTextContent("finished the supported tests");
    expect(screen.getByTestId("exp-summary-tested")).toHaveTextContent("Couldn't read whether it's applied now.");
  });

  it("reads in Chinese too", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      await renderOwner([pass("visual-effects", "Trim Windows visual effects", 1)]);
      expect(screen.getByTestId("exp-summary-headline")).toHaveTextContent("已在这台主机上完成 WardogsClient 的受支持测试");
      expect(screen.getByTestId("exp-summary-tested")).toHaveTextContent("目前未应用。");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// P5-learned (ROADMAP Phase 5 step 8): the summary says what was kept, what was put back and why, and
// at most one lesson from the documented rules, its numbers behind a toggle. On the owner's records.
describe("P5-learned: what Compy learned on this PC", () => {
  const pass = (id: string, title: string, position: number) => ({ id, title, passes: true, reason: null, detail: null, position, evidence: "not-measured", risk: "low" });

  const fixtures = {
    "wardogs-p4-exit": () => import("../test/fixtures/wardogs-p4-exit.json"),
    "p5-learned-today": () => import("../test/fixtures/p5-learned-today.json"),
  };
  async function renderWith(fixture: keyof typeof fixtures) {
    const f = (await fixtures[fixture]()).default;
    state.gate = true;
    state.experiments = f.experiments;
    state.sessions = f.sessions;
    state.recs = [pass("visual-effects", "Trim Windows visual effects", 1)];
    render(<ExperimentBench />);
    return screen.findByTestId("exp-summary");
  }

  it("WARDOGS: put back because it ran worse; lesson: less steady, average not compared", async () => {
    const panel = await renderWith("wardogs-p4-exit");
    expect(screen.getByTestId("exp-summary-happened")).toHaveTextContent(
      "Put Trim Windows visual effects back: the game ran worse with it.",
    );
    const lesson = screen.getByTestId("exp-summary-lesson");
    expect(lesson).toHaveAttribute("data-rule", "less-steady");
    expect(lesson).toHaveTextContent(
      "With Trim Windows visual effects, 1% lows fell: WardogsClient got less steady. The average wasn't compared. · Measured",
    );
    const detail = screen.getByTestId("exp-summary-lesson-detail");
    expect(detail.tagName).toBe("DETAILS");
    expect(detail).not.toHaveAttribute("open");
    expect(detail).toHaveTextContent(
      "From the Trial of Trim Windows visual effects: 1% low -18.5%, average not compared, against a 3% noise band. Rule used: the 1% low fell beyond the band; the average wasn't compared.",
    );
    expect(panel.querySelectorAll("button:not(.kl-term)")).toHaveLength(0);
  });

  // CR-lesson-avg-band (opus r1): on measured per-metric bands the receipt names the band each
  // number was read against, so an average called "faster" is never shown inside the stated band.
  it("measured bands: the receipt names the 1% low's band and the average's own band", async () => {
    const f = (await fixtures["wardogs-p4-exit"]()).default;
    const judged = f.experiments.find((x: { verdict: string | null }) => x.verdict != null)!;
    state.gate = true;
    state.experiments = [
      {
        ...judged,
        verdict: "improved",
        kept: true,
        noise_evidence: { band_pct: 23, measured_noise_pct: null },
        game_noise: { low1_band_pct: 23, avg_band_pct: 18, low1_step_pct: 9.2, avg_step_pct: 7.2, sessions: 9 },
        treatment: { ...(judged.treatment as object), delta_low1_pct: 30, delta_avg_pct: 20 },
      },
    ];
    state.sessions = f.sessions;
    state.recs = [pass("visual-effects", "Trim Windows visual effects", 1)];
    render(<ExperimentBench />);
    await screen.findByTestId("exp-summary");
    expect(screen.getByTestId("exp-summary-lesson")).toHaveAttribute("data-rule", "faster-and-steadier");
    expect(screen.getByTestId("exp-summary-lesson-detail")).toHaveTextContent(
      "From the Trial of Trim Windows visual effects: 1% low +30% against a noise band of 23%, average +20% against a noise band of 18%.",
    );
  });

  // TG-drift-words: on the owner's real Aniimo Trial judged too noisy, the history says what Compy
  // recorded differently between its two sessions (or that nothing did), with one next step.
  it("Aniimo today: the too-noisy Trial's note names what differed between its sessions, with one next step", async () => {
    // Opus r1 SHOULD-FIX: on the owner's records driver, build, resolution and Gaming Mode match (no cap
    // or power plan recorded), background is 24 s vs 36 s and length 1083 s vs 1057 s.
    // Opus r2 MUST-FIX: the line names exactly what was compared and claims no cause.
    const panel = await renderWith("p5-learned-today");
    const body = panel.ownerDocument.body;
    expect(body).toHaveTextContent(
      "Compy compared what it recorded for both sessions (graphics driver, Windows build, Gaming Mode, display resolution, time behind other windows, session length) and found no difference worth naming, so it can't point to any of them. " +
        "Next: play a few more sessions of Aniimo with nothing changed, so Compy can measure how much it moves, then run the Trial again.",
    );
    // Opus r2 SHOULD-FIX: the words sit on the too-noisy row's own footnote, never in the list's
    // shared line (which stays the one noise line the judged rows share).
    const shared = body.querySelector(".exp-bench-noise-shared");
    expect(shared).not.toBeNull();
    expect(shared!.textContent).not.toMatch(/Compy compared/);
    const marked = [...body.querySelectorAll(".exp-bench-noise-mark")].map((m) => m.parentElement?.textContent ?? "");
    expect(marked.some((txt) => /Compy compared what it recorded/.test(txt))).toBe(true);
  });

  it("Aniimo today: put back as too noisy; lesson: the game swings between sessions", async () => {
    const panel = await renderWith("p5-learned-today");
    expect(panel).toHaveTextContent("What Compy tested on Aniimo");
    expect(screen.getByTestId("exp-summary-happened")).toHaveTextContent(
      "Put Trim Windows visual effects back: the frame rate moved around too much to tell.",
    );
    expect(screen.getByTestId("exp-summary-lesson")).toHaveTextContent(
      "Aniimo swings a lot between sessions on your PC; Compy needs steadier sessions to judge. · Unknown",
    );
    // A too-noisy Trial judged nothing, so none of its stored deltas is shown.
    expect(panel).not.toHaveTextContent("15.5");
    expect(panel).not.toHaveTextContent("16%");
    // bug→guard 2026-10-29 (owner-rig PBZ Trial): a result that never reached the band says so, not
    // "no record was kept", which read as a lost record.
    // gloss triggers (a confidence word, "noise floor") are not actions
    expect(panel.querySelectorAll("button:not(.kl-term)")).toHaveLength(0);
    const door = panel.querySelector('[data-testid="exp-summary-depth-receipt"] > summary')!;
    fireEvent.click(door);
    await waitFor(() => expect(door.parentElement!.children.length).toBeGreaterThan(1));
    const noise = screen.getByTestId("exp-summary-noise");
    expect(noise).toHaveTextContent("One result was not judged against a noise floor: its sessions could not be compared fairly.");
    expect(noise).not.toHaveTextContent("No noise-floor record was kept");
  });

  it("no rule, no lesson", async () => {
    const f = (await import("../test/fixtures/wardogs-p4-exit.json")).default;
    state.gate = true;
    // Same record, but the 1% low stayed inside the band: nothing to learn beyond the verdict.
    state.experiments = f.experiments.map((x: Record<string, unknown>, i: number) =>
      i === 0 ? { ...x, verdict: "no-change", treatment: { ...(x.treatment as object), delta_low1_pct: -1.2 } } : x,
    );
    state.sessions = f.sessions;
    state.recs = [pass("visual-effects", "Trim Windows visual effects", 1)];
    render(<ExperimentBench />);
    await screen.findByTestId("exp-summary");
    expect(screen.getByTestId("exp-summary-happened")).toHaveTextContent("it made no difference Compy could measure");
    expect(screen.queryByTestId("exp-summary-lesson")).toBeNull();
  });

  it("reads in Chinese too", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      await renderWith("p5-learned-today");
      expect(screen.getByTestId("exp-summary-happened")).toHaveTextContent("已恢复 Trim Windows visual effects：帧率波动太大，无法判断。");
      expect(screen.getByTestId("exp-summary-lesson")).toHaveTextContent("每局之间的波动很大");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// P4-next-f1: the picker's own list marks a change already tested on this game (a record on it with a
// verdict, the P4-next rule) with its last verdict and lists it after the untested ones, each group in
// the suggested order. It stays pickable: re-testing is allowed.
describe("P4-next-f1: the picker marks changes already tested on this game", () => {
  const cand = (id: string, title: string, position: number) => ({
    id, title, passes: true, reason: null, detail: null, position, evidence: "not-measured", risk: "low", stated_effect_pct: null,
  });
  const rec = (rec_id: string, game: string, verdict: string | null, concluded_at: string) => ({
    ...KEPT_EXPERIMENT, id: `exp:${rec_id}-${game}-${concluded_at}`, rec_id, rec_title: rec_id, game,
    status: verdict === "improved" ? "kept" : "restored", verdict, kept: verdict === "improved", concluded_at,
  });

  const openPicker = async () => {
    state.gate = true;
    state.sessions = [VALORANT_SESSION];
    state.recs = [cand("a-rec", "Change A", 1), cand("b-rec", "Change B", 2), cand("c-rec", "Change C", 3), cand("d-rec", "Change D", 4)];
    state.experiments = [
      // A: tested twice on Valorant; the newer verdict is the one shown.
      rec("a-rec", "Valorant", "improved", "2026-07-10T00:00:00Z"),
      rec("a-rec", "Valorant", "regressed", "2026-07-12T00:00:00Z"),
      rec("c-rec", "Valorant", "too-noisy", "2026-07-11T00:00:00Z"),
      // B only on another game, D restored before a verdict: neither counts as tested here.
      rec("b-rec", "cs2.exe", "improved", "2026-07-11T00:00:00Z"),
      rec("d-rec", "Valorant", null, "2026-07-11T00:00:00Z"),
    ];
    state.sim = { ...WORTH_TESTING_SIM, rec_id: "a-rec", rec_title: "Change A" };
    render(<ExperimentBench />);
    const trigger = await screen.findByRole("combobox", { name: i18n.t("lab.experimentBench.pickLabel") });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    return waitFor(() => {
      const opts = [...document.querySelectorAll<HTMLElement>('[role="listbox"] [data-value]')].filter((o) => o.dataset.value);
      expect(opts).toHaveLength(4);
      return opts;
    });
  };

  it("lists untested changes first, tested ones after with their last verdict, both in the suggested order", async () => {
    const opts = await openPicker();
    expect(opts.map((o) => o.dataset.value)).toEqual(["b-rec", "d-rec", "a-rec", "c-rec"]);
    expect(opts.map((o) => o.textContent)).toEqual([
      "Change B",
      "Change D",
      "Change A · Tested: Slower — restored",
      "Change C · Tested: Too noisy to judge — restored",
    ]);
  });

  it("a tested change stays pickable", async () => {
    const opts = await openPicker();
    const a = opts.find((o) => o.dataset.value === "a-rec")!;
    expect(a).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(a);
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("simulate_optimization", { recId: "a-rec" }),
    );
  });

  it("reads in Chinese too", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      const opts = await openPicker();
      expect(opts.find((o) => o.dataset.value === "a-rec")).toHaveTextContent("Change A · 已测试：变慢了——已恢复");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// P5-outcomes (ROADMAP Phase 5 step 6, ENGINE §5–6): one change with a Recommended and a Maximum FPS
// result that disagree offers the choice, with the trade in one line. Acting goes through
// apply_outcome_choice / undo_outcome_choice, which reuse the audited apply (apply_recommendation) and
// undo (rollback_change) paths and record the Trial behind them on the ledger row (P5-outcomes-f1).
describe("P5-outcomes: pick between Recommended and Maximum FPS", () => {
  const VAL = "Valorant";
  const trial = (over: Record<string, unknown>) => ({
    ...KEPT_EXPERIMENT,
    status: "restored",
    kept: false,
    verdict: "regressed",
    verdict_confidence: "medium",
    noise_evidence: { band_pct: 3, measured_noise_pct: null },
    treatment: { ...KEPT_EXPERIMENT.treatment, delta_low1_pct: -4, delta_avg_pct: 6 },
    outcome: "recommended",
    ...over,
  });
  // Round 2 of the 2026-10-26 follow-up review: a keep is offered only on a MATCHING context, so the
  // happy-path fixtures record a driver and Windows build on both the baseline and the newest session.
  const CTX = { hw_fingerprint: { gpu: "GPU", gpu_driver: "32.0.1" }, game_state: { gpu_driver: "32.0.1", windows_build: "26200.8457" } };
  const VAL_SESSION = { ...VALORANT_SESSION, process_name: VAL, ...CTX };
  const REC_OFF = trial({ id: "exp:rec", baseline_session_id: VAL_SESSION.started_at });
  const MAX_KEEP = trial({
    id: "exp:max",
    baseline_session_id: VAL_SESSION.started_at,
    created_at: "2026-07-18T00:00:00Z",
    status: "kept",
    kept: true,
    verdict: "improved",
    treatment: { ...KEPT_EXPERIMENT.treatment, delta_low1_pct: -2, delta_avg_pct: 6 },
    outcome: "max-fps",
  });
  const hags = (passes: boolean, reason: string | null) => ({
    id: "hags",
    title: "Hardware-accelerated GPU scheduling",
    passes,
    reason,
    detail: null,
    position: 1,
    evidence: "not-measured",
    risk: "low",
  });

  async function renderWith(experiments: unknown[], recs: unknown[], sessions: unknown[] = [VAL_SESSION]) {
    state.gate = true;
    state.experiments = experiments;
    state.sessions = sessions;
    state.recs = recs;
    render(<ExperimentBench />);
    await screen.findByTestId("exp-summary");
  }

  it("two differing results: the choice, with the actual trade in one line", async () => {
    await renderWith([REC_OFF, MAX_KEEP], [hags(false, "already-set-by-compy")]);
    const row = await screen.findByTestId("exp-outcome-choice-row");
    expect(row).toHaveAttribute("data-in-effect", "max-fps");
    expect(screen.getByTestId("exp-outcome-choice-trade")).toHaveTextContent(
      "Recommended doesn't keep this change: 1% lows fell 4%. Maximum FPS keeps it: average up 6%.",
    );
    expect(screen.getByTestId("exp-outcome-choice-current")).toHaveTextContent("In effect now: Maximum FPS.");
    const btn = screen.getByRole("button", { name: "Use Recommended: undo Hardware-accelerated GPU scheduling" });
    expect(btn).toHaveAttribute("data-outcome", "recommended");
    // The summary itself stays read-only.
    expect(screen.getByTestId("exp-summary").querySelectorAll("button:not(.kl-term)")).toHaveLength(0);
  });

  it("two agreeing results, or a single one: no choice", async () => {
    await renderWith([trial({ id: "exp:rec", verdict: "improved", kept: true, treatment: { ...KEPT_EXPERIMENT.treatment, delta_low1_pct: 5, delta_avg_pct: 1 } }), MAX_KEEP], [hags(false, "already-set-by-compy")]);
    expect(screen.queryByTestId("exp-outcome-choice")).toBeNull();
    cleanup();
    await renderWith([REC_OFF, trial({ id: "exp:max", outcome: "max-fps", verdict: "no-change", treatment: { ...KEPT_EXPERIMENT.treatment, delta_low1_pct: 0, delta_avg_pct: 1 } })], [hags(true, null)]);
    expect(screen.queryByTestId("exp-outcome-choice")).toBeNull();
    cleanup();
    await renderWith([MAX_KEEP], [hags(false, "already-set-by-compy")]);
    expect(screen.queryByTestId("exp-outcome-choice")).toBeNull();
    cleanup();
    // A Maximum FPS Trial that judged nothing is no result, so there is no keep side to offer.
    await renderWith([REC_OFF, { ...MAX_KEEP, verdict: "too-noisy", kept: false }], [hags(true, null)]);
    expect(screen.queryByTestId("exp-outcome-choice")).toBeNull();
  });

  // Follow-up review 2026-10-26 §1: the summary calls a result stale after a driver change; the
  // switch must not offer that same Trial as proof to re-apply the change. Fails on the old code.
  it("never offers the keep side when its Trial ran under a changed graphics driver or Windows build", async () => {
    const newer = { ...VAL_SESSION, started_at: "2026-10-26T00:00:00Z", hw_fingerprint: { gpu: "GPU", gpu_driver: "33.0.1" }, game_state: { gpu_driver: "33.0.1", windows_build: "26200.9000" } };
    await renderWith([REC_OFF, MAX_KEEP], [hags(true, null)], [VAL_SESSION, newer]);
    const row = await screen.findByTestId("exp-outcome-choice-row");
    expect(row).toHaveAttribute("data-in-effect", "recommended");
    // The trade is still shown as history …
    expect(screen.getByTestId("exp-outcome-choice-trade")).toHaveTextContent("Maximum FPS keeps it: average up 6%.");
    // … but the keep side is not offered; the reason is said in its place.
    expect(screen.queryByRole("button", { name: /Use Maximum FPS/ })).toBeNull();
    expect(screen.getByTestId("exp-outcome-choice-stale")).toHaveTextContent(
      "The result that kept Hardware-accelerated GPU scheduling under Maximum FPS came from a different graphics card, driver or Windows build. Test it again before Compy applies it on that basis.",
    );
    // And the summary agrees: that result is stale.
    expect(screen.getByTestId("exp-summary")).toHaveAttribute("data-headline", "worth-retesting");
  });

  // Round 2 of the follow-up review: an unverified context is not proof either. The keep side is
  // withheld with its own reason, and the summary says the result can't be tied to this PC.
  it("never offers the keep side when its Trial's context can't be verified against this PC", async () => {
    // A newest session that records no driver or build: the keep Trial's context can't be verified.
    await renderWith([REC_OFF, MAX_KEEP], [hags(true, null)], [{ ...VALORANT_SESSION, process_name: VAL }]);
    const row = await screen.findByTestId("exp-outcome-choice-row");
    expect(row).toHaveAttribute("data-in-effect", "recommended");
    expect(screen.queryByRole("button", { name: /Use Maximum FPS/ })).toBeNull();
    const why = screen.getByTestId("exp-outcome-choice-stale");
    expect(why).toHaveAttribute("data-context", "unverified");
    expect(why).toHaveTextContent("can't be tied to this PC as it is now");
    // Round 3 §3 + review MUST-FIX 1: HAGS has TWO unverified measured Trials here (Recommended and
    // Maximum FPS), so the retest cap is reached: no third run is offered, and the summary says the
    // results can't be tied to this PC rather than "worth another run".
    expect(screen.getByTestId("exp-summary")).toHaveAttribute("data-headline", "results-unverified");
    expect(screen.queryByTestId("exp-summary-retest")).toBeNull();
    expect(screen.getByTestId("exp-summary-headline")).toHaveTextContent("can't be tied to this PC as it is now");
  });

  // Round 4 review: the "worth retesting" headline explained every retest as noise or an older
  // driver/build, even when the one reason present was a context that can't be tied to this PC.
  it("the retest headline names the reason present: an unverified context is said as that, not as noise", async () => {
    await renderWith([REC_OFF], [hags(true, null)], [{ ...VALORANT_SESSION, process_name: VAL }]);
    expect(screen.getByTestId("exp-summary")).toHaveAttribute("data-headline", "worth-retesting");
    expect(screen.getByTestId("exp-summary-headline")).toHaveTextContent(
      "1 result on Valorant needs another run before it counts: can't be tied to this PC as it is now.",
    );
    expect(screen.getByTestId("exp-summary-headline")).not.toHaveTextContent("too noisy");
    expect(screen.getByTestId("exp-summary-headline")).not.toHaveTextContent("older graphics driver");
    // And with no context recorded at all, the context line (in the receipt) says so without a date.
    const door2 = screen.getByTestId("exp-summary").querySelector('[data-testid="exp-summary-depth-receipt"] > summary')!;
    fireEvent.click(door2);
    // Depth mounts a door's content on the details' toggle (a later task in jsdom): wait for it.
    await waitFor(() => expect(door2.parentElement!.children.length).toBeGreaterThan(1));
    expect(screen.getByTestId("exp-summary-context")).toHaveTextContent("Last recorded context: Compy has no recorded rig details for Valorant.");
    expect(screen.getByTestId("exp-summary-context")).not.toHaveAttribute("data-context-at");
  });

  // Review of the round-4 fix, MUST-FIX: the headline counts and explains only the rows a run is
  // actually asked for. An unverified change the cap has stopped offering is neither counted nor
  // named there (it is said in its own row). Fails on the code before this fix (count 2, both reasons).
  it("the retest headline leaves out a change the cap has stopped offering", async () => {
    const GM = { ...hags(true, null), id: "game-mode", title: "Game Mode", position: 2 };
    const noisyGm = trial({ id: "exp:gm", rec_id: "game-mode", rec_title: "Game Mode", verdict: "too-noisy", created_at: "2026-07-19T00:00:00Z", baseline_session_id: VAL_SESSION.started_at });
    // HAGS: two unverified measured Trials (cap reached). Game Mode: one attempt that judged nothing (offered).
    await renderWith([REC_OFF, MAX_KEEP, noisyGm], [hags(true, null), GM], [{ ...VALORANT_SESSION, process_name: VAL }]);
    expect(screen.getByTestId("exp-summary")).toHaveAttribute("data-headline", "worth-retesting");
    expect(screen.getByTestId("exp-summary-headline")).toHaveTextContent("1 result on Valorant needs another run before it counts: couldn't be judged last time.");
    expect(screen.getByTestId("exp-summary-headline")).not.toHaveTextContent("can't be tied");
    expect(screen.getByTestId("exp-summary-retest")).toHaveTextContent("Worth another run: Game Mode (couldn't be judged last time)");
    expect(screen.getByTestId("exp-summary-retest")).not.toHaveTextContent("Hardware-accelerated");
  });

  it("choosing the keep side re-applies through apply_recommendation, citing the Better Trial", async () => {
    await renderWith([REC_OFF, MAX_KEEP], [hags(true, null)]);
    const btn = await screen.findByRole("button", { name: "Use Maximum FPS: apply Hardware-accelerated GPU scheduling again" });
    expect(btn).toHaveAttribute("data-trial", "exp:max");
    vi.mocked(invoke).mockClear();
    fireEvent.click(btn);
    await waitFor(() => expect(callArgs("apply_outcome_choice")).toEqual({ recId: "hags", recTitle: "Hardware-accelerated GPU scheduling", experimentId: "exp:max" }));
    // P5-outcomes-f1: the Trust Ledger row records the Trial that justified it.
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "rollback_change" || c === "undo_outcome_choice")).toBe(false);
  });

  it("choosing the put-back side undoes the newest live apply through rollback_change, citing the Trial that put it back", async () => {
    state.changes = [
      { id: "chg-old", rec_id: "hags", rec_title: "HAGS", applied_at: "2026-07-17T00:00:00Z", status: "rolled_back", is_still_active: false, active_check: null },
      { id: "chg-live", rec_id: "hags", rec_title: "HAGS", applied_at: "2026-07-18T00:00:00Z", status: "applied", is_still_active: true, active_check: "on" },
      { id: "chg-other", rec_id: "game-bar-disable", rec_title: "Game Bar", applied_at: "2026-07-19T00:00:00Z", status: "applied", is_still_active: true, active_check: "on" },
    ];
    await renderWith([REC_OFF, MAX_KEEP], [hags(false, "already-set-by-compy")]);
    const btn = await screen.findByRole("button", { name: "Use Recommended: undo Hardware-accelerated GPU scheduling" });
    expect(btn).not.toHaveAttribute("data-trial");
    vi.mocked(invoke).mockClear();
    fireEvent.click(btn);
    await waitFor(() => expect(callArgs("undo_outcome_choice")).toEqual({ changeId: "chg-live", experimentId: "exp:rec" }));
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "apply_recommendation" || c === "apply_outcome_choice")).toBe(false);
  });

  it("no switch while a Trial is running; the trade still shows", async () => {
    const running = { ...RUNNING_EXPERIMENT, id: "exp:run", rec_id: "game-bar-disable", rec_title: "Turn off Game Bar" };
    await renderWith([REC_OFF, MAX_KEEP, running], [hags(false, "already-set-by-compy")]);
    const row = await screen.findByTestId("exp-outcome-choice-row");
    expect(screen.getByTestId("exp-outcome-choice-trade")).toHaveTextContent("Maximum FPS keeps it: average up 6%.");
    expect(screen.getByTestId("exp-outcome-choice-locked")).toHaveTextContent("Finish or stop the Trial in progress before switching.");
    expect(row.querySelectorAll("button")).toHaveLength(0);
  });

  const undoBtn = () => screen.findByRole("button", { name: "Use Recommended: undo Hardware-accelerated GPU scheduling" });
  const notFound = "Compy couldn't confirm Hardware-accelerated GPU scheduling is applied now, so nothing was undone.";

  it("put back with no applied change on record: nothing undone, says so", async () => {
    state.changes = [];
    await renderWith([REC_OFF, MAX_KEEP], [hags(false, "already-set-by-compy")]);
    const btn = await undoBtn();
    vi.mocked(invoke).mockClear();
    fireEvent.click(btn);
    expect(await screen.findByRole("alert")).toHaveTextContent(notFound);
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "rollback_change" || c === "undo_outcome_choice")).toBe(false);
  });

  it("put back when the newest apply can't be confirmed on: nothing undone, says so", async () => {
    state.changes = [
      { id: "chg-old", rec_id: "hags", rec_title: "HAGS", applied_at: "2026-07-17T00:00:00Z", status: "applied", is_still_active: true, active_check: "unreadable" },
    ];
    await renderWith([REC_OFF, MAX_KEEP], [hags(false, "already-set-by-compy")]);
    const btn = await undoBtn();
    vi.mocked(invoke).mockClear();
    fireEvent.click(btn);
    expect(await screen.findByRole("alert")).toHaveTextContent(notFound);
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "rollback_change" || c === "undo_outcome_choice")).toBe(false);
  });

  it("both writes announce LEDGER_CHANGED_EVENT", async () => {
    vi.mocked(invoke).mockClear();
    const heard = vi.fn();
    window.addEventListener(LEDGER_CHANGED_EVENT, heard);
    try {
      await renderWith([REC_OFF, MAX_KEEP], [hags(true, null)]);
      fireEvent.click(await screen.findByRole("button", { name: "Use Maximum FPS: apply Hardware-accelerated GPU scheduling again" }));
      await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
      cleanup();
      heard.mockClear();
      state.changes = [
        { id: "chg-live", rec_id: "hags", rec_title: "HAGS", applied_at: "2026-07-18T00:00:00Z", status: "applied", is_still_active: true, active_check: "on" },
      ];
      await renderWith([REC_OFF, MAX_KEEP], [hags(false, "already-set-by-compy")]);
      fireEvent.click(await undoBtn());
      await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
      expect(callArgs("undo_outcome_choice")).toEqual({ changeId: "chg-live", experimentId: "exp:rec" });
    } finally {
      window.removeEventListener(LEDGER_CHANGED_EVENT, heard);
    }
  });

  it("can't tell what is in effect: no switch, nothing written", async () => {
    await renderWith([REC_OFF, MAX_KEEP], [hags(false, "already-set-unconfirmed")]);
    const row = await screen.findByTestId("exp-outcome-choice-row");
    expect(row).toHaveAttribute("data-in-effect", "unknown");
    expect(row.querySelectorAll("button")).toHaveLength(0);
  });

  it("reads in Chinese too", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      await renderWith([REC_OFF, MAX_KEEP], [hags(false, "already-set-by-compy")]);
      expect(await screen.findByTestId("exp-outcome-choice-trade")).toHaveTextContent(
        "推荐不保留此更改：1% 低帧下降 4%。 最高帧率保留它：平均帧率提高 6%。",
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// Desk review 2026-10-31 (P8-posture-b): the journey line ("1 of 1 tested. Nothing else here is worth
// testing on this PC.") sat flush against the new "How far may Compy go on this PC?" field, 0px, while
// the launcher keeps a 12px rhythm everywhere else. jsdom has no layout, so the rule itself is pinned.
describe("ExperimentBench spacing under the journey line", () => {
  /** ExperimentBench.css with its comments stripped, and the body of the rule `selector` names. */
  const ruleBody = async (selector: RegExp) => {
    const { readFileSync } = await import("fs");
    const css = readFileSync("src/surfaces/ExperimentBench.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
  };

  it("keeps the launcher's 12px rhythm below the journey line", async () => {
    const { readFileSync } = await import("fs");
    const css = readFileSync("src/surfaces/ExperimentBench.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = css.match(/\.exp-journey\s*\+\s*\.exp-launch\s*\{([^}]*)\}/);
    expect(rule, "nothing spaces the launcher from the journey line above it").not.toBeNull();
    expect(rule![1]).toMatch(/margin-top:\s*12px/);
  });

  // Review 2026-11-02 (P5-realplay, fix 2): a real-play panel's last block sat 0px above the summary's
  // eyebrow, and its own blocks (and the journey's lines and buttons) sat flush against each other.
  // Round 2: a rule naming only the journey left the launcher (the resting state) and a classic running
  // panel flush on the eyebrow, so the rule names the summary itself.
  it("keeps the bench's 12px rhythm between whatever sits above the summary and the summary", async () => {
    const rule = await ruleBody(/\.exp-bench\s*>\s*\.exp-summary/);
    expect(rule, "nothing spaces the summary from the launcher, panel or journey above it").not.toBeNull();
    expect(rule).toMatch(/margin-top:\s*12px/);
    expect(await ruleBody(/\.exp-journey\s*\+\s*\.exp-summary/), "a neighbour-only rule misses the launcher").toBeNull();
  });

  // Review 2026-11-02, round 2: "Compy doesn't know how big any of these effects are…" sat flush under
  // the ranked list's last row.
  it("keeps a note under the ranked list off its last row", async () => {
    const rule = await ruleBody(/\.exp-order-list\s*\+\s*\.exp-note/);
    expect(rule, "the note sits flush on the list").not.toBeNull();
    expect(rule).toMatch(/margin-top:\s*6px/);
  });

  // Review 2026-11-02, round 2: the aim pills are one toggle (aria-pressed), and the chosen one looked
  // exactly like the other. jsdom has no cascade, so the rule is pinned, hovered or not.
  it("marks the chosen aim pill, hovered or not", async () => {
    const rule = await ruleBody(/\.exp-cta-ghost\.exp-journey-aim-on,\s*\.exp-cta-ghost\.exp-journey-aim-on:hover:not\(:disabled\)/);
    expect(rule, "the chosen aim pill has no look of its own").not.toBeNull();
    expect(rule).toMatch(/border-color:\s*var\(--ix-accent\)/);
    expect(rule).toMatch(/background:\s*var\(--ix-accent-wash\)/);
  });

  it("keeps the running panel's 9px rhythm between the journey's own blocks", async () => {
    const rule = await ruleBody(/\.exp-journey:not\(\.exp-running\)\s*>\s*\*\s*\+\s*\*/);
    expect(rule, "nothing spaces the journey's blocks from each other").not.toBeNull();
    expect(rule).toMatch(/margin-top:\s*9px/);
  });

  it("keeps 9px between the journey's progress line and the running panel under it", async () => {
    const rule = await ruleBody(/\.exp-journey-progress\s*\+\s*\.exp-running/);
    expect(rule, "the progress line sits flush on the running panel's frame").not.toBeNull();
    expect(rule).toMatch(/margin-top:\s*9px/);
  });

  // Review 2026-11-02 (fix 10): the cost line a user reads before "I understand, test it" sat 0px under
  // the aim pills and 1px above the button.
  it("gives the cost line the journey's 9px either side", async () => {
    // Two classes: a one-class rule here loses to `.exp-note { margin: 0 }`, which comes later in the
    // file (caught in self-review, 2026-11-02: the rule was there and did nothing).
    const rule = await ruleBody(/\.exp-journey\s+\.exp-journey-cost/);
    expect(rule, "the cost line has no spacing of its own that outranks .exp-note").not.toBeNull();
    expect(rule).toMatch(/margin:\s*9px 0\b/);
  });
});

// P5-realplay: a real-play Trial leaves its change on for days while the owner plays however he plays.
// Its panel is derived from the record and get_realplay_progress, so it reads the same after a restart.
describe("P5-realplay: a running real-play Trial on the bench", () => {
  const APPLIED = "2026-10-29T10:25:00Z";
  const UNTIL = "2026-11-12T10:25:00+00:00";
  const PBZ = "PhantomBladeZero.exe";
  const numbers = (low1_fps: number, i: number) => ({ session_id: `2026-10-29T0${i}:00:00Z`, low1_fps, avg_fps: 170, samples: 661 });
  // The owner's 2026-10-29 PBZ sessions: whole sessions 172 / 132 / 178 on the 1% low.
  const RP_RUNNING = {
    ...RUNNING_EXPERIMENT,
    id: "exp:7-0",
    rec_title: "HAGS",
    game: PBZ,
    mode: "real-play",
    applied_at: APPLIED,
    baseline_session_id: "2026-10-29T02:00:00Z",
    real_play: { before: [172, 132, 178].map(numbers) },
  };
  const rpProgress = (over: Record<string, unknown> = {}) => ({
    phase: "collecting",
    game: PBZ,
    experiment_id: "exp:7-0",
    anchor_session_id: null,
    before: 3,
    with: 2,
    need: 3,
    min_sessions: 3,
    max_sessions: 8,
    min_readings: 600,
    window_days: 14,
    band_pct: null,
    applied_at: APPLIED,
    until: UNTIL,
    stop: null,
    not_counted: [],
    ...over,
  });

  // ✗ on the code before real play: the running panel offered "conclude with your latest session",
  // and a journey Trial still running after a relaunch was called interrupted.
  it("a running real-play Trial says the change is on, how to put it back and N of M, and never shows the interrupted banner", async () => {
    state.gate = true;
    state.experiments = [RP_RUNNING];
    state.realPlay = rpProgress({ not_counted: [{ session_id: "2026-10-30T21:14:00Z", reason: "too-short" }] });
    // Even a webview that remembers this Trial as a journey's says nothing about an interruption.
    localStorage.setItem("compy.journey.running", "exp:7-0");
    render(<ExperimentBench />);
    // Before the progress read answers, the panel already says the change is on and since when.
    expect((await screen.findByTestId("realplay-on")).textContent).toMatch(/^HAGS is on \(since /);
    await waitFor(() => expect(screen.getByTestId("realplay-status").textContent).toBe("Keep playing, Compy is still collecting (2 of 3 sessions)."));
    expect(screen.getByTestId("realplay-on").textContent).toBe(
      `HAGS is on (since ${whenText(APPLIED, "en")}). It stays on while you play, until Compy has a result: at most 8 sessions, or by ${whenText(UNTIL, "en")}.`,
    );
    expect(screen.getByTestId("realplay-put-back-how").textContent).toBe(
      "To put it back, tap Restore now: Compy restores the setting exactly as it was before the test. You can also undo it in Test → Applied & history.",
    );
    expect(within(screen.getByTestId("realplay-not-counted")).getByText(`${whenText("2026-10-30T21:14:00Z", "en")}: too short to count (about 10 minutes of play needed)`)).toBeTruthy();
    expect(screen.queryByTestId("exp-interrupted")).toBeNull();
    expect(screen.queryByTestId("experiment-running")).toBeNull();
    expect(screen.queryByRole("button", { name: /Conclude/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Measure my next session" })).toBeEnabled();
    // "Restore now" is the existing audited restore, announced like every ledger write.
    const announced = vi.fn();
    window.addEventListener(LEDGER_CHANGED_EVENT, announced);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Restore now" }));
      await waitFor(() => expect(callArgs("restore_experiment")).toEqual({ experimentId: "exp:7-0" }));
      await waitFor(() => expect(announced).toHaveBeenCalled());
    } finally {
      window.removeEventListener(LEDGER_CHANGED_EVENT, announced);
    }
  });

  // ✗ on the code before real play: two PBZ sessions this far apart were "too noisy", and the change went back.
  it("PBZ 2026-10-29 in real play: still collecting, never too noisy after two sessions", async () => {
    state.gate = true;
    state.experiments = [RP_RUNNING];
    state.realPlay = rpProgress({ with: 2 });
    const first = render(<ExperimentBench />);
    await waitFor(() => expect(screen.getByTestId("realplay-status").textContent).toBe("Keep playing, Compy is still collecting (2 of 3 sessions)."));
    expect(screen.getByTestId("experiment-bench").textContent).not.toMatch(/noisy/i);
    expect(screen.queryByTestId("realplay-not-yet")).toBeNull();
    first.unmount();
    // After the first look (3 sessions with it on) the swings still leave it open: a few more, never a verdict.
    state.realPlay = rpProgress({ with: 3, need: 5, band_pct: 21.66 });
    render(<ExperimentBench />);
    await waitFor(() => expect(screen.getByTestId("realplay-status").textContent).toBe("Keep playing, Compy is still collecting (3 of 5 sessions)."));
    expect(screen.getByTestId("realplay-not-yet").textContent).toBe("Not clear yet: the allowance for normal swings between your sessions is ±21.7% so far, so Compy needs a few more.");
    expect(screen.getByTestId("experiment-bench").textContent).not.toMatch(/noisy/i);
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "conclude_realplay" || c === "conclude_experiment")).toEqual([]);
  });

  it("when the count can't be read, it says so in the backend's words and still offers Restore now", async () => {
    state.gate = true;
    state.experiments = [RP_RUNNING];
    state.realPlay = "reject";
    render(<ExperimentBench />);
    await waitFor(() =>
      expect(screen.getByTestId("realplay-status").textContent).toBe("Compy can't count this test's sessions right now. HAGS stays on until you put it back."),
    );
    expect(screen.getByTestId("realplay-unread").textContent).toBe("Compy can't read its change history: the ledger was set aside");
    expect(screen.getByRole("button", { name: "Restore now" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Measure my next session" })).toBeNull();
  });

  // Review 2026-11-02 (fix 2): the panel's blocks sat flush (0px) against each other. It now wears the
  // pair running panel's frame and 9px rhythm (.exp-running), every block a child of that frame, and
  // the progress line above it keeps 9px from the frame (.exp-journey-progress + .exp-running).
  it("the real-play panel shares the pair running panel's frame and rhythm", async () => {
    state.gate = true;
    state.experiments = [RP_RUNNING];
    state.realPlay = rpProgress({ not_counted: [{ session_id: "2026-10-30T21:14:00Z", reason: "too-short" }] });
    render(<ExperimentBench />);
    await waitFor(() => expect(screen.getByTestId("realplay-status").textContent).toBe("Keep playing, Compy is still collecting (2 of 3 sessions)."));
    const panel = screen.getByTestId("journey");
    expect(panel).toHaveAttribute("data-phase", "realplay");
    expect(panel).toHaveClass("exp-running");
    expect(screen.getByTestId("journey-progress").textContent).toMatch(/ · Testing now: HAGS$/);
    for (const id of ["realplay-on", "realplay-status", "realplay-put-back-how", "realplay-not-counted"])
      expect(screen.getByTestId(id).parentElement, id).toBe(panel);
    const measure = screen.getByRole("button", { name: "Measure my next session" });
    expect(measure.parentElement).toHaveClass("exp-running-actions");
    expect(measure.parentElement?.parentElement).toBe(panel);
    const line = screen.getByTestId("journey-progress");
    expect(line).toHaveClass("exp-journey-progress");
    expect(line.nextElementSibling).toBe(panel);
  });

  // Review 2026-11-02 (fix 1): a stopped panel offered the put-back beside "no longer reads as on".
  it("a stopped test whose change is already off offers no put-back; one that can't read it still does", async () => {
    state.gate = true;
    state.experiments = [RP_RUNNING];
    state.realPlay = rpProgress({ phase: "stopped", stop: "change-off" });
    const first = render(<ExperimentBench />);
    await waitFor(() => expect(screen.getByTestId("realplay-on").textContent).toBe("HAGS is no longer on."));
    // Review 2026-11-02, round 2: the line above said "Testing now: HAGS" over a stopped test.
    expect(screen.getByTestId("journey-progress").textContent).toMatch(/ · Test stopped: HAGS$/);
    expect(screen.queryByRole("button", { name: "Restore now" })).toBeNull();
    expect(screen.queryByTestId("realplay-put-back-how")).toBeNull();
    expect(screen.getByRole("button", { name: "Close this test" })).toBeEnabled();
    first.unmount();
    state.realPlay = rpProgress({ phase: "stopped", stop: "unreadable" });
    render(<ExperimentBench />);
    await waitFor(() => expect(screen.getByTestId("realplay-on").textContent).toBe("Compy can't tell whether HAGS is on right now."));
    expect(screen.getByRole("button", { name: "Restore now" })).toBeEnabled();
    expect(screen.getByTestId("realplay-put-back-how")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close this test" })).toBeEnabled();
  });

  it("says the same in zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      state.gate = true;
      state.experiments = [RP_RUNNING];
      state.realPlay = rpProgress();
      render(<ExperimentBench />);
      await waitFor(() => expect(screen.getByTestId("realplay-status").textContent).toBe("继续玩吧，Compy 仍在收集数据（2/3 局）。"));
      expect(screen.getByTestId("realplay-on").textContent).toMatch(/^HAGS已开启（自 .+ 起）。在 Compy 得出结果之前它会一直保持开启：最多 8 局，最晚到 .+。$/);
      expect(screen.getByRole("button", { name: "立即恢复" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "测量我的下一局" })).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  const RP_KEPT = {
    ...RP_RUNNING,
    id: "exp:8-0",
    game: "Valorant",
    status: "kept",
    verdict: "improved",
    kept: true,
    concluded_at: "2026-11-01T10:00:00Z",
    verdict_confidence: "medium",
    outcome: "recommended",
    noise_evidence: { band_pct: 3, measured_noise_pct: null, between_sessions: null },
    treatment: { avg_fps: 241, low1_fps: 202, samples: 3510, crashed: false, delta_low1_pct: 12.1, delta_avg_pct: 0.4, recorded_at: "" },
    real_play: {
      before: [172, 132, 178].map(numbers),
      with: [190, 201, 199].map(numbers),
      band_pct: 3,
      delta_low1_pct: 12.1,
      delta_avg_pct: 0.4,
      look: 1,
    },
  };

  it("a concluded real-play row reads Likely better, with its own band, never Measurably faster", async () => {
    state.gate = true;
    state.experiments = [RP_KEPT];
    render(<ExperimentBench />);
    const row = (await screen.findByText("Likely better — kept")).closest("li")!;
    expect(row.textContent).not.toMatch(/Measurably faster/);
    expect(within(row).getByTestId("exp-compared-receipt").textContent).toBe(
      "Compared across 3 sessions with it on and 3 without: 1% low +12.1%, average frame rate +0.4%, both against a ±3% band (the allowance for normal swings between sessions). The 1% low rose by more than the band and the average didn't fall by more, so the change was kept.",
    );
    expect(screen.getAllByText(wholeLine("Judged against a ±3% band from this test's own sessions: an allowance for normal swings between your Valorant sessions (3 without the change, 3 with it).")).length).toBeGreaterThan(0);
    // The per-game summary says the real-play face and the Likely word, never Measured.
    const summary = await screen.findByTestId("exp-summary");
    expect(summary.textContent).toMatch(/Likely better — kept/);
    expect(summary.textContent).toMatch(/Likely/);
    expect(summary.textContent).not.toMatch(/Measurably faster/);
  });

  // Review 2026-11-02 (fix 3): the rule sentence was picked by verdict alone, so a real-play row put
  // back in Test → Applied & history after a Likely better ended "...so the change was kept", beside
  // its own "restored" face.
  it("a real-play row put back after Likely better never says the change was kept", async () => {
    state.gate = true;
    const putBack = {
      ...RP_KEPT,
      status: "restored",
      kept: false,
      stop_reason: "real-play-put-back-in-history",
      real_play: { ...RP_KEPT.real_play, stop: "put-back-in-history" },
    };
    state.experiments = [putBack];
    const first = render(<ExperimentBench />);
    const row = (await screen.findByText("Likely better — restored")).closest("li")!;
    expect(within(row).getByTestId("exp-compared-receipt").textContent).toBe(
      "Compared across 3 sessions with it on and 3 without: 1% low +12.1%, average frame rate +0.4%, both against a ±3% band (the allowance for normal swings between sessions). The 1% low rose by more than the band and the average didn't fall by more, but the change was put back before Compy kept it.",
    );
    expect(row.textContent).not.toMatch(/so the change was kept/);
    first.unmount();
    // Maximum FPS leads with the average, and ends the same way.
    state.experiments = [{ ...putBack, outcome: "max-fps" }];
    const second = render(<ExperimentBench />);
    const maxRow = (await screen.findByText("Likely better — restored")).closest("li")!;
    expect(within(maxRow).getByTestId("exp-compared-receipt").textContent).toBe(
      "Judged for Maximum FPS. Compared across 3 sessions with it on and 3 without: average frame rate +0.4%, 1% low +12.1%, both against a ±3% band (the allowance for normal swings between sessions). The average rose by more than the band and the 1% low didn't fall by more, but the change was put back before Compy kept it.",
    );
    second.unmount();
    await i18n.changeLanguage("zh-CN");
    try {
      state.experiments = [putBack];
      render(<ExperimentBench />);
      const zhRow = (await screen.findByText("较可能更好——已恢复")).closest("li")!;
      const zh = within(zhRow).getByTestId("exp-compared-receipt").textContent;
      expect(zh).toMatch(/但在 Compy 保留它之前，这项更改已被恢复原样。$/);
      expect(zh).not.toMatch(/所以保留了这项更改/);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("a real-play row that judged nothing says why in real-play words, never the session-halves sentence", async () => {
    state.gate = true;
    state.experiments = [
      { ...RP_KEPT, status: "restored", kept: false, verdict: "too-noisy", stop_reason: "sessions-too-varied", verdict_confidence: "unknown", noise_evidence: null, treatment: null },
    ];
    render(<ExperimentBench />);
    const row = (await screen.findByText("Unknown — restored")).closest("li")!;
    expect(within(row).getByTestId("exp-too-noisy-why").textContent).toBe(
      "Your sessions varied too much from one to the next to tell this setting's effect apart, so Compy restored it and judged nothing.",
    );
    expect(row.textContent).not.toMatch(/A session this uneven/);
  });

  it("reads in Chinese too", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      state.gate = true;
      state.experiments = [RP_KEPT];
      render(<ExperimentBench />);
      expect((await screen.findAllByText("较可能更好——已保留")).length).toBeGreaterThan(0);
      expect(screen.getByTestId("experiment-bench").textContent).not.toMatch(/lab\.experimentBench|\{\{/);
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
