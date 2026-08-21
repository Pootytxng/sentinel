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
        return Promise.resolve({});
      default:
        return Promise.resolve(null);
    }
  }),
}));

import ExperimentBench from "./ExperimentBench";

afterEach(() => {
  cleanup();
  state.gate = false;
  state.experiments = [];
  state.recs = [];
  state.sessions = [];
  state.sim = null;
  state.simHang = false;
  state.loadGate = null;
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
    expect(await screen.findByText("Different game — not comparable, restored")).toBeInTheDocument();
    expect(screen.queryByText("not-comparable")).toBeNull();
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
});
