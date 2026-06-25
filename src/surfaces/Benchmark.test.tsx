import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Benchmark polls several commands on mount; keyed mock with settable benchmark/fps state.
const mocks = vi.hoisted(() => ({
  benchState: { running: false, baseline: null, baseline_at: null, latest: null, latest_at: null, efficacy: null } as unknown,
  fpsActive: false,
  // Measured specs for the A2 rig-tier band: 16 GB VRAM · 8 cores · 32 GB RAM → High.
  hw: {
    gpus: [{ vram_bytes: 16 * 1024 ** 3 }],
    cpu_cores_physical: 8,
    ram_total_bytes: 32 * 1024 ** 3,
  } as unknown,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    switch (cmd) {
      case "get_benchmark_state":
        return Promise.resolve(mocks.benchState);
      case "get_applied_changes":
        return Promise.resolve([]);
      case "get_trial_state":
      case "get_scoreboard":
        return Promise.resolve(null);
      case "get_recommendations":
        return Promise.resolve([
          { id: "game-mode", title: "Enable Game Mode", currently_applied: false },
        ]);
      case "get_appliable_rec_ids":
        return Promise.resolve(["game-mode"]);
      case "get_fps_status":
        return Promise.resolve({ active: mocks.fpsActive });
      case "get_hardware_info":
        return Promise.resolve(mocks.hw);
      default:
        return Promise.resolve(null);
    }
  }),
}));

import { BenchmarkTab } from "./Benchmark";

afterEach(cleanup);

describe("BenchmarkTab (audit M1)", () => {
  it("first run offers 'Run benchmark' (no baseline yet) and the Baseline section", async () => {
    mocks.benchState = { running: false, baseline: null, baseline_at: null, latest: null, latest_at: null, efficacy: null };
    render(<BenchmarkTab />);
    expect(await screen.findByRole("button", { name: "Run benchmark" })).toBeInTheDocument();
    expect(screen.getByText("Baseline")).toBeInTheDocument();
  });

  it("a run in flight is honest about the wait and not re-clickable", async () => {
    mocks.benchState = { running: true, baseline: null, baseline_at: null, latest: null, latest_at: null, efficacy: null };
    render(<BenchmarkTab />);
    const btn = await screen.findByRole("button", { name: /Measuring… \(~10s — leave it alone\)/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("inline dependency (wayfinding §2): offers to start FPS monitoring right on the card", async () => {
    mocks.benchState = { running: false, baseline: null, baseline_at: null, latest: null, latest_at: null, efficacy: null };
    mocks.fpsActive = false;
    render(<BenchmarkTab />);
    // The live-game measurement needs monitoring; the switch comes to the need — no page trip.
    expect(await screen.findByRole("button", { name: "Start monitoring" })).toBeInTheDocument();
  });

  it("A2: segments the surface by hardware tier from measured specs (like-to-like framing)", async () => {
    mocks.benchState = { running: false, baseline: null, baseline_at: null, latest: null, latest_at: null, efficacy: null };
    render(<BenchmarkTab />);
    // The band names the tier + the exact specs it read, and frames comparison as same-class only.
    expect(await screen.findByText("Your rig tier")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText(/16 GB VRAM · 8 cores · 32 GB RAM/)).toBeInTheDocument();
    expect(screen.getByText(/like-to-like/)).toBeInTheDocument();
  });
});
