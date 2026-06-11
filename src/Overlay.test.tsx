import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The overlay polls sensor commands on mount; mock invoke so it doesn't throw outside Tauri. Data
// resolves to null (handlers catch) — these tests assert STRUCTURE (the flag switch + densities).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Overlay, { Frametimeline, frametimeScale } from "./Overlay";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Overlay", () => {
  it("renders the v2 inverted-rule pill when compy_overlay_v2 is on", () => {
    localStorage.setItem("compy_overlay_v2", "1");
    const { container } = render(<Overlay />);
    expect(container.querySelector(".ovl2")).toBeTruthy();
    expect(screen.getByText("fps")).toBeTruthy(); // the accent unit label
    expect(container.querySelector(".ovl")).toBeFalsy(); // classic not rendered
  });

  it("renders the classic overlay when the flag is off", () => {
    localStorage.setItem("compy_overlay_v2", "0");
    const { container } = render(<Overlay />);
    expect(container.querySelector(".ovl2")).toBeFalsy();
    expect(container.querySelector(".ovl")).toBeTruthy();
  });

  it("minimal density renders FPS only (no metric row, no frametime line)", () => {
    localStorage.setItem("compy_overlay_v2", "1");
    localStorage.setItem("compy_overlay_density", "minimal");
    const { container } = render(<Overlay />);
    expect(container.querySelector(".ovl2-row")).toBeFalsy();
    expect(container.querySelector(".ovl2-ft")).toBeFalsy();
  });

  it("standard density shows the '1% low' / temp / gpu row — and NO cpu (full-only)", () => {
    localStorage.setItem("compy_overlay_v2", "1");
    localStorage.setItem("compy_overlay_density", "standard");
    const { container } = render(<Overlay />);
    expect(container.querySelector(".ovl2-row")).toBeTruthy();
    expect(screen.getByText(/1% low/)).toBeTruthy(); // labeled metric, not a bare "1%"
    expect(screen.queryByText(/cpu/)).toBeNull(); // CPU usage is full-density only
  });

  it("full density adds cpu usage to the row (1% low · temp · cpu · gpu)", () => {
    localStorage.setItem("compy_overlay_v2", "1");
    localStorage.setItem("compy_overlay_density", "full");
    render(<Overlay />);
    expect(screen.getByText(/1% low/)).toBeTruthy();
    expect(screen.getByText(/cpu/)).toBeTruthy(); // usage % only — never CPU temp
    expect(screen.getByText(/gpu/)).toBeTruthy();
  });
});

// The frametime graph's FIXED scale (owner/tester honesty fix, 2026-06-10): stable frametimes
// must read as a near-flat line LOW in the graph — the old min/max auto-scale stretched ±0.2 ms
// jitter to full height, rendering rock-steady pacing as jagged noise (the opposite of RTSS).
describe("Frametimeline — fixed scale + frame-budget reference", () => {
  const H = 18; // the component's viewBox height (SVG y grows DOWNWARD: bottom = fast = good)

  function polylineYs(container: HTMLElement): number[] {
    const pts = container.querySelector("polyline")!.getAttribute("points")!;
    return pts.split(" ").map((p) => Number(p.split(",")[1]));
  }

  it("frametimeScale anchors the ceiling to the frame budget, bounded 20–50 ms", () => {
    expect(frametimeScale(null)).toEqual({ ceilingMs: 50, budgetMs: null }); // unknown refresh
    expect(frametimeScale(1000 / 60).ceilingMs).toBe(50); // 16.7 × 3.5 ≈ 58 → capped
    expect(frametimeScale(1000 / 144).ceilingMs).toBeCloseTo(24.3, 1);
    expect(frametimeScale(1000 / 240).ceilingMs).toBe(20); // floor — never a microscopic window
  });

  it("STABLE frametimes render near-flat and LOW — never stretched into full-height noise", () => {
    // 7 ms ± 0.2 jitter (a healthy ~144 fps cadence) on a 144 Hz monitor (ceiling ≈ 24.3 ms).
    const stable = Array.from({ length: 40 }, (_, i) => 7 + (i % 2 ? 0.2 : -0.2));
    const { container } = render(<Frametimeline samples={stable} refreshHz={144} />);
    const ys = polylineYs(container);
    const spread = Math.max(...ys) - Math.min(...ys);
    // ±0.2 ms jitter must stay visually flat, and a fast cadence sits in the LOWER half.
    expect(spread).toBeLessThan(1.5);
    expect(Math.min(...ys)).toBeGreaterThan(H / 2);
  });

  it("a genuine spike rises while the stable baseline stays put; past-ceiling pins to the top", () => {
    const withSpike = [...Array.from({ length: 20 }, () => 7), 30, ...Array.from({ length: 19 }, () => 7)];
    const { container } = render(<Frametimeline samples={withSpike} refreshHz={144} />);
    const ys = polylineYs(container);
    const spikeY = Math.min(...ys); // smallest y = highest point
    const baselineY = ys[0];
    // The spike must visibly tower over the stable baseline.
    expect(baselineY - spikeY).toBeGreaterThan(H / 2);
    expect(spikeY).toBeCloseTo(1, 1); // 30 ms > 24.3 ceiling → pinned to the top inset
  });

  it("draws the faint frame-budget line when the refresh is known, and NO line when it isn't", () => {
    const samples = Array.from({ length: 10 }, () => 7);
    const known = render(<Frametimeline samples={samples} refreshHz={144} />);
    expect(known.container.querySelector(".ovl2-ft-budget")).toBeTruthy();
    cleanup();
    // Unknown refresh: an honest absence — never a guessed budget line.
    const unknown = render(<Frametimeline samples={samples} refreshHz={null} />);
    expect(unknown.container.querySelector(".ovl2-ft-budget")).toBeFalsy();
  });
});
