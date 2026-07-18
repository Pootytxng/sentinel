// Intelligence Phase 3 — the experiment-bench surface. While the backend gate is false it renders
// NOTHING (mutation-gate item 7 — mechanized "FE renders nothing while gated"). When an owner-signed
// build arms the gate the interactive bench renders: a change picker → honest simulator read →
// start-against-a-real-baseline, a running panel (conclude / restore), and the honest history list.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const state = vi.hoisted(() => ({
  gate: false,
  experiments: [] as unknown[],
  recs: [] as unknown[],
  sessions: [] as unknown[],
  sim: null as unknown,
  simHang: false, // when true, simulate_optimization stays pending → lets a test observe the in-flight lock
}));

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
        return Promise.resolve(state.gate ? state.experiments : []);
      case "get_recommendations":
        return Promise.resolve(state.recs);
      case "get_session_summaries":
        return Promise.resolve(state.sessions);
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
});

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
    // Measurement framing, never a promise of gain.
    expect(screen.getByText(/It measures — it never promises a gain\./)).toBeInTheDocument();
    // The kept experiment renders its plain-English honest verdict, not a raw enum string.
    expect(await screen.findByText("Measurably faster — kept")).toBeInTheDocument();
    expect(screen.getByText("Hardware-accelerated GPU scheduling")).toBeInTheDocument();
  });

  it("picking a change runs the simulator and offers Start against the real baseline", async () => {
    state.gate = true;
    state.recs = [{ id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false }];
    state.sessions = [VALORANT_SESSION];
    state.sim = WORTH_TESTING_SIM;
    render(<ExperimentBench />);
    await screen.findByTestId("experiment-bench");

    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "test-rec" } });

    // Honest simulator card renders the verdict label + the disproof + the real baseline numbers.
    expect(await screen.findByText("Worth testing")).toBeInTheDocument();
    // The card names the exact change under test — the mutation target the Start button will apply.
    expect(document.querySelector(".exp-sim-rec")?.textContent).toBe("Test tweak");
    expect(screen.getByText(/Disproved if:/)).toBeInTheDocument();
    expect(screen.getByText(/244/)).toBeInTheDocument(); // baseline avg fps
    const start = screen.getByRole("button", { name: /Start experiment/ });
    expect(start).toBeEnabled();
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

    const select = await screen.findByRole("combobox");
    expect(select).toBeEnabled();
    fireEvent.change(select, { target: { value: "test-rec" } });

    await waitFor(() => expect(screen.getByRole("combobox")).toBeDisabled());
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
