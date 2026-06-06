import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Lab reads benchmark/latency state on mount; mock invoke so it doesn't throw outside Tauri.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Lab from "./Lab";

afterEach(cleanup);

describe("Lab", () => {
  it("renders the two instrument cards with plain-English one-liners", () => {
    render(<Lab onOpenBenchmark={vi.fn()} onOpenLatency={vi.fn()} />);
    expect(screen.getByText("Benchmark")).toBeInTheDocument();
    expect(screen.getByText("Latency")).toBeInTheDocument();
    expect(screen.getByText(/prove it, don't vibe it/)).toBeInTheDocument();
  });

  it("the cards route into the existing benchmark/latency UIs", () => {
    const onOpenBenchmark = vi.fn();
    const onOpenLatency = vi.fn();
    render(<Lab onOpenBenchmark={onOpenBenchmark} onOpenLatency={onOpenLatency} />);
    fireEvent.click(screen.getByRole("button", { name: /Run a baseline/ }));
    fireEvent.click(screen.getByRole("button", { name: /Measure input path/ }));
    expect(onOpenBenchmark).toHaveBeenCalled();
    expect(onOpenLatency).toHaveBeenCalled();
  });
});
