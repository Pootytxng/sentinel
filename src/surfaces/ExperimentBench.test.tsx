// Intelligence Phase 3 — the experiment-bench surface stays DARK while the backend gate is false
// (every shipped build today), and when a future owner-signed build arms it, the honest verdict
// copy + the experiments list render. The dark render-nothing pin is the mechanized guard for
// "FE renders nothing while gated" (mutation-gate item 7).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const gateMock = vi.hoisted(() => ({ enabled: false }));

const EXPERIMENTS = [
  {
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
  },
];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_experiment_gate") return Promise.resolve(gateMock.enabled);
    if (cmd === "get_experiments")
      return gateMock.enabled ? Promise.resolve(EXPERIMENTS) : Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

import ExperimentBench from "./ExperimentBench";

afterEach(() => {
  cleanup();
  gateMock.enabled = false;
});

describe("ExperimentBench (dark)", () => {
  it("renders NOTHING while the backend gate is hard-false (every shipped build today)", async () => {
    const { container } = render(<ExperimentBench />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(screen.queryByTestId("experiment-bench")).toBeNull();
  });

  it("when a future build arms the gate: honest verdict copy + the experiments list render", async () => {
    gateMock.enabled = true;
    render(<ExperimentBench />);
    expect(await screen.findByTestId("experiment-bench")).toBeInTheDocument();
    // Measurement framing, never a promise of gain.
    expect(screen.getByText(/It measures — it never promises a gain\./)).toBeInTheDocument();
    // The kept experiment renders its plain-English honest verdict, not a raw enum string.
    expect(await screen.findByText("Measurably faster — kept")).toBeInTheDocument();
    expect(screen.getByText("Hardware-accelerated GPU scheduling")).toBeInTheDocument();
  });
});
