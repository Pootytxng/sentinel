// Intelligence Phase 3 — the experiment-bench surface. While the backend gate is false it renders
// NOTHING (mutation-gate item 7 — mechanized "FE renders nothing while gated"). When an owner-signed
// build arms the gate the interactive bench renders: a change picker → honest simulator read →
// start-against-a-real-baseline, a running panel (conclude / restore), and the honest history list.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { LEDGER_CHANGED_EVENT } from "../types";

const state = vi.hoisted(() => ({
  gate: false,
  experiments: [] as unknown[],
  recs: [] as unknown[],
  sessions: [] as unknown[],
  sim: null as unknown,
  simHang: false, // when true, simulate_optimization stays pending → lets a test observe the in-flight lock
  loadGate: null as Promise<void> | null, // when set, the initial ledger reads block on it
  refuse: {} as Record<string, string>, // a lifecycle command the backend refuses, with its message
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
      case "get_recommendations":
        return afterLoad(state.recs);
      case "get_session_summaries":
        return afterLoad(state.sessions);
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
});

// bug->guard (CI run 30696118350, 2026-08-01). Picking a value that has NO matching option yet is a
// SILENT NO-OP: the value stays "", onChange runs with "", no simulation is requested, and nothing
// anywhere reports a problem.
//
// Every test here used to fire straight at whatever `findByRole("combobox")` returned. That resolves
// the moment the control exists — but the OPTIONS arrive separately, from get_recommendations. On a
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
  const trigger = await screen.findByRole("combobox");
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
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
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

  // bug->guard (independent review, 2026-08-18): the C-10 port first carried the empty entry as the
  // Picker's `placeholder`, which is not an option and so cannot be chosen. That silently removed
  // the `<select>`'s blank `<option value="">` — the only way back out of a pick — and no test
  // noticed, because every test only ever picks FORWARD. This one goes back.
  it("the empty entry is re-selectable, and choosing it clears the pick and the simulator card", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
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
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    const landTheReads = holdInitialLoad(); // nothing loads until this test says so
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    // The precondition that makes this test meaningful: the option really is absent at first, so a
    // bare fireEvent here would set nothing. If this ever stops being true the repro has rotted and
    // the test below is passing for the wrong reason. Held open by the gate rather than by a timer,
    // so a slow machine cannot let the reads land early and turn the precondition into a race.
    const trigger = await screen.findByRole("combobox");
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
      { id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false },
      { id: "other-rec", title: "Other tweak", eligible: true, currently_applied: false },
    ];
    state.sessions = [VALORANT_SESSION];
    state.simHang = true; // simulate_optimization stays pending so we can observe the in-flight lock
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    await pickChange("test-rec");

    await waitFor(() => expect(screen.getByRole("combobox")).toBeDisabled());
  });

  // Guard for W2 (Intelligence Phase 3 fast-follow, 2026-07-17): the bench loads once when the gate
  // arms, so a change applied over in Optimize during the same Lab visit would leave the picker's
  // simulator read stale — still saying "Worth testing" + offering Start for a change already applied.
  // On refocus the bench MUST reload the ledger and re-derive the active pick's verdict, and the pick
  // must stay visible (resolving to "already configured") rather than silently vanishing.
  it("re-derives the active pick from the live ledger on refocus (no stale 'worth-testing' after a sibling apply)", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    await pickChange("test-rec");
    expect(await screen.findByText("Worth testing")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Start experiment/ })).toBeEnabled());

    // A sibling Optimize apply lands: the same rec is now applied and the sim re-reads as already-configured.
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: true }];
    state.sim = { ...WORTH_TESTING_SIM, verdict: "already-configured" };
    fireEvent.focus(window);

    await waitFor(() => expect(screen.getByText("Already configured")).toBeInTheDocument());
    expect(screen.queryByText("Worth testing")).toBeNull();
    // Start is no longer offered for an already-applied change (the blocked verdict hides the launcher CTA).
    expect(screen.queryByRole("button", { name: /Start experiment/ })).toBeNull();
    // …and the pick stayed visible in the dropdown instead of silently disappearing. The Picker
    // (C-10) shows the chosen option's LABEL on its trigger; there is no form value to read.
    expect(screen.getByRole("combobox")).toHaveTextContent("Test tweak");
  });

  // Guard for Measurement-2.0 Task A (2026-07-18): the refocus fix (W2) only fires on OS focus /
  // visibilitychange — a change applied over in the sibling Optimize station during the SAME window
  // visit fires neither, so the bench would stay stale. Applying now dispatches an in-app
  // `compy:ledger-changed` event; the bench listens and re-derives the active pick from the live
  // ledger WITHOUT any refocus. Same honest outcome: "Already configured", no Start, pick stays visible.
  it("re-derives the active pick on an in-app ledger-changed event (sibling apply, same window, no refocus)", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    await pickChange("test-rec");
    expect(await screen.findByText("Worth testing")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Start experiment/ })).toBeEnabled());

    // A sibling Optimize apply lands in the same window — no focus/visibilitychange, just the event.
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: true }];
    state.sim = { ...WORTH_TESTING_SIM, verdict: "already-configured" };
    fireEvent(window, new Event(LEDGER_CHANGED_EVENT));

    await waitFor(() => expect(screen.getByText("Already configured")).toBeInTheDocument());
    expect(screen.queryByText("Worth testing")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start experiment/ })).toBeNull();
    expect(screen.getByRole("combobox")).toHaveTextContent("Test tweak");
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
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  // #583 lane 2b: the backend reads the baseline and the treatment from its own session store by id.
  // The webview names a session; it never hands over the game or a frame rate to be trusted.
  it("starts against the baseline by session id, never by frame rates it supplies", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
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
    });
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
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
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
        "Judged against Compy's fixed 3% noise floor. In one 25-second calibration on your PC, this game's 1% low varied by ±1.3%. That number isn't used to judge yet, and the game version isn't checked.",
      ),
    ).toBeInTheDocument();
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
    expect(await screen.findByText(line)).toBeInTheDocument();
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
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
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
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
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
      state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
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
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
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
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
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
