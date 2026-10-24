import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// #629: before get_benchmark_state answers (or when it fails), the Benchmark station must not claim
// "no baseline" and must not offer the button that would overwrite the owner's saved baseline.
const mocks = vi.hoisted(() => ({
  mode: "pending" as "pending" | "fail" | "baseline",
}));

const BASELINE = {
  running: false,
  baseline: { fps_avg: 200 },
  baseline_at: "2026-07-23T02:55:39Z",
  latest: null,
  latest_at: null,
  efficacy: null,
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_benchmark_state") {
      if (mocks.mode === "pending") return new Promise(() => {});
      if (mocks.mode === "fail") return Promise.reject(new Error("read failed"));
      return Promise.resolve(BASELINE);
    }
    if (cmd === "get_applied_changes") return Promise.resolve([]);
    if (cmd === "get_recommendations") return Promise.resolve([]);
    if (cmd === "get_appliable_rec_ids") return Promise.resolve([]);
    if (cmd === "get_fps_status") return Promise.resolve({ active: false });
    return Promise.resolve(null);
  }),
}));

import { BenchmarkTab } from "./Benchmark";

afterEach(cleanup);

describe("Benchmark station while the baseline read is outstanding (#629)", () => {
  it("says it is reading, never 'no baseline', and offers no overwrite", async () => {
    mocks.mode = "pending";
    render(<BenchmarkTab provingGround />);
    expect(await screen.findByText("Reading your saved baseline…")).toBeInTheDocument();
    expect(screen.queryByText(/save it as your baseline/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Set latest run as baseline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run benchmark" })).toBeNull();
    const primary = screen.getByRole("button", { name: "Reading your benchmark…" });
    expect((primary as HTMLButtonElement).disabled).toBe(true);
  });

  it("a failed read stays unknown: no 'no baseline' copy, no overwrite button", async () => {
    mocks.mode = "fail";
    render(<BenchmarkTab provingGround />);
    expect(await screen.findByText(/couldn't read your saved baseline/)).toBeInTheDocument();
    expect(screen.queryByText(/save it as your baseline/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Set latest run as baseline" })).toBeNull();
  });

  it("control: once the read answers with a baseline, the saved-baseline card shows", async () => {
    mocks.mode = "baseline";
    render(<BenchmarkTab provingGround />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Re-measure" })).toBeInTheDocument());
    expect(screen.queryByText("Reading your saved baseline…")).toBeNull();
  });
});
