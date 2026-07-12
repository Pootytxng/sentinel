import { render } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Oscilloscope } from "./Oscilloscope";

// Oscilloscope contract (plan 2026-07-10-console-hud-phase3-monitor, Task 2 — bug→guard tier 1):
// a PURE render of already-real samples (the caller owns buffering + polling). Empty buffer ⇒
// the honest no-signal state — NEVER a flat synthetic line. No self-driven rAF/interval (the
// idle-canvas law: with data unchanged the trace repaints zero times). Token-only ink — the
// vendored gamer-RGB purple can never paint.

afterEach(() => vi.restoreAllMocks());

describe("Oscilloscope — honest no-signal state", () => {
  it("empty samples ⇒ no trace polyline, the no-signal micro-label on the empty grid", () => {
    const { container, getByText } = render(
      <Oscilloscope samples={[]} label="fps" unit="fps" reduced />,
    );
    expect(container.querySelector(".osc-trace")).toBeNull();
    expect(getByText("no signal")).toBeTruthy();
    // The grid still renders (an empty instrument, not a blank hole).
    expect(container.querySelector(".osc-grid")).not.toBeNull();
  });

  it("never renders a synthetic flat line for the empty buffer", () => {
    const { container } = render(<Oscilloscope samples={[]} label="fps" reduced />);
    expect(container.querySelectorAll("polyline").length).toBe(0);
  });
});

describe("Oscilloscope — real samples only, one point per buffered sample", () => {
  it("draws the trace polyline with one point per sample and shows the latest readout", () => {
    const { container, getByText } = render(
      <Oscilloscope samples={[60, 120, 118, 144]} label="fps" unit="fps" reduced />,
    );
    const pts = container
      .querySelector(".osc-trace")
      ?.getAttribute("points")
      ?.trim()
      .split(/\s+/);
    expect(pts).toHaveLength(4);
    expect(getByText(/144\s*fps/)).toBeTruthy();
    expect(container.querySelector(".osc-nosignal")).toBeNull();
  });

  it("windows to the last `cap` samples (rolling scope)", () => {
    const samples = Array.from({ length: 200 }, (_, i) => i);
    const { container } = render(
      <Oscilloscope samples={samples} cap={120} label="fps" reduced />,
    );
    const pts = container
      .querySelector(".osc-trace")
      ?.getAttribute("points")
      ?.trim()
      .split(/\s+/);
    expect(pts).toHaveLength(120);
  });

  it("is a pure render of props — no rAF or interval of its own (the poll drives updates)", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    const interval = vi.spyOn(globalThis, "setInterval");
    render(<Oscilloscope samples={[60, 61, 62]} label="fps" reduced={false} />);
    expect(raf).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });
});

describe("Oscilloscope — full-width window (owner bug 2026-07-10: trace stopped ~halfway)", () => {
  it("a window smaller than cap still spans the full grid width", () => {
    const samples = Array.from({ length: 100 }, (_, i) => 7 + (i % 3));
    const { container } = render(
      <Oscilloscope samples={samples} cap={240} label="frametime" reduced />,
    );
    const pts = container
      .querySelector(".osc-trace")!
      .getAttribute("points")!
      .trim()
      .split(/\s+/);
    expect(pts).toHaveLength(100);
    const lastX = parseFloat(pts[pts.length - 1].split(",")[0]);
    expect(lastX).toBeGreaterThan(230); // W=240 — the trace reaches the right edge
  });
});

describe("Oscilloscope — budget line + exact-moment spike markers (v3 T1)", () => {
  const flat = [7, 7.2, 6.9, 7.1, 7, 7.3, 7.1, 6.8];
  const spiky = [7, 7.2, 6.9, 41, 7, 7.3, 22, 6.8];

  it("spikeIndices (pure): >= 2× window median AND >= budget; flat data ⇒ none", async () => {
    const { spikeIndices } = await import("./Oscilloscope");
    expect(spikeIndices(flat, 6.06)).toEqual([]);
    expect(spikeIndices(spiky, 6.06)).toEqual([3, 6]);
    // Below budget never marks, even when 2× median trips (a fast rig's noise isn't a spike).
    expect(spikeIndices([2, 2, 2, 5], 6.06)).toEqual([]);
  });

  it("draws the budget line when given, none otherwise", () => {
    const { container: withB } = render(
      <Oscilloscope samples={flat} label="frametime" budget={6.06} reduced />,
    );
    expect(withB.querySelector(".osc-budget")).not.toBeNull();
    const { container: without } = render(
      <Oscilloscope samples={flat} label="frametime" reduced />,
    );
    expect(without.querySelector(".osc-budget")).toBeNull();
  });

  it("spikes ⇒ per-sample markers at the exact moment; the worst spike gets a ms callout", () => {
    const { container, getByText } = render(
      <Oscilloscope samples={spiky} label="frametime" unit="ms" budget={6.06} spikes reduced />,
    );
    const markers = container.querySelectorAll(".osc-spike");
    expect(markers.length).toBe(2);
    // Marker x sits at the spike's own sample position (index 3 of 8 → x ≈ 3/7 of the width).
    const worst = container.querySelector(".osc-spike-worst")!;
    const wx = parseFloat(worst.getAttribute("x1")!);
    expect(Math.abs(wx - (3 / 7) * 238 - 1)).toBeLessThan(2);
    expect(getByText(/worst spike/i).textContent).toMatch(/41\s*ms/);
  });

  it("flat real data ⇒ zero markers, no callout (never a fabricated spike)", () => {
    const { container, queryByText } = render(
      <Oscilloscope samples={flat} label="frametime" unit="ms" budget={6.06} spikes reduced />,
    );
    expect(container.querySelectorAll(".osc-spike").length).toBe(0);
    expect(queryByText(/worst spike/i)).toBeNull();
  });
});

describe("Oscilloscope — motion + ink discipline", () => {
  it("reduced ⇒ the still marker (CSS gates sweep/glow off it)", () => {
    const { container: r } = render(<Oscilloscope samples={[1, 2]} label="fps" reduced />);
    expect(r.querySelector(".oscilloscope")?.getAttribute("data-reduced")).toBe("true");
    const { container: m } = render(
      <Oscilloscope samples={[1, 2]} label="fps" reduced={false} />,
    );
    expect(m.querySelector(".oscilloscope")?.getAttribute("data-reduced")).toBeNull();
  });

  it("tone maps to a class, ink stays token-only — the vendor purple can never paint", () => {
    const { container } = render(
      <Oscilloscope samples={[1, 2, 3]} label="fps" tone="warn" reduced />,
    );
    expect(container.querySelector(".osc-warn")).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/132\s*,\s*0\s*,\s*255/);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('Oscilloscope — scale="zero" (owner direction 2026-07-11: match the RTSS/CapFrameX frametime convention)', () => {
  // Real-density window: ordinary alternation + one spike. Under window-normalization the
  // alternation stretched to full chart height (the rejected "erratic" look); zero-anchored
  // it must hug the floor while the spike towers.
  const dense: number[] = Array.from({ length: 240 }, (_, i) => (i % 2 ? 8.4 : 5.6));
  dense[120] = 41;

  it("niceCap (pure): smallest stable frame-budget landmark that contains the data", async () => {
    const { niceCap } = await import("./Oscilloscope");
    expect(niceCap(7.9)).toBe(8.3);
    expect(niceCap(8.4)).toBe(16.7);
    expect(niceCap(41)).toBe(50);
    expect(niceCap(90)).toBe(100);
    expect(niceCap(600)).toBe(600); // beyond the table: ceils to the next 100
  });

  it("zero scale: ordinary jitter stays low and calm, the spike towers — raw line, no smoothing", () => {
    const { container } = render(
      <Oscilloscope samples={dense} cap={240} label="frametime" unit="ms" budget={6.9} spikes scale="zero" reduced />,
    );
    const trace = container.querySelector(".osc-trace")!;
    expect(trace.tagName.toLowerCase()).toBe("polyline"); // RAW per-frame — accuracy untouched
    const pts = trace.getAttribute("points")!.trim().split(/\s+/);
    expect(pts).toHaveLength(240);
    // cap = niceCap(41) = 50: the 5.6–8.4 alternation spans <6% of the plot height
    // (was 100% under window normalization) while the 41 ms spike reaches ~82% up.
    const ys = pts.map((p) => parseFloat(p.split(",")[1]));
    const plotH = 64 - 12; // H - 2*PAD
    const calmAmp = Math.max(...ys.filter((_, i) => i !== 120)) - Math.min(...ys.filter((_, i) => i !== 120));
    expect(calmAmp).toBeLessThan(plotH * 0.1);
    expect(Math.min(...ys)).toBeLessThan(64 - 6 - plotH * 0.75); // the spike's y climbs high
    // Spike marker still anchors at the RAW sample's exact x (index 120 of 240).
    const worst = container.querySelector(".osc-spike-worst")!;
    expect(Math.abs(parseFloat(worst.getAttribute("x1")!) - ((120 / 239) * 238 + 1))).toBeLessThan(0.2);
  });

  it("zero scale: labeled ms gridlines at quarter-cap steps (a real axis, not decoration)", () => {
    const { container } = render(
      <Oscilloscope samples={dense} cap={240} label="frametime" unit="ms" scale="zero" reduced />,
    );
    const labels = [...container.querySelectorAll(".osc-ylab")].map((el) => el.textContent);
    expect(labels).toEqual(["13", "25", "38"]); // cap 50 → 12.5/25/37.5, rounded ints ≥10
  });

  it('default scale="window" is unchanged — fps traces keep the relative mapping, no ms labels', () => {
    const { container } = render(<Oscilloscope samples={dense} cap={240} label="fps" reduced />);
    expect(container.querySelector(".osc-trace")!.tagName.toLowerCase()).toBe("polyline");
    expect(container.querySelectorAll(".osc-ylab").length).toBe(0);
  });
});

describe("Oscilloscope — line discipline (owner-caught 2026-07-11: bloom + fat strokes)", () => {
  // bug→guard: the trace wore a drop-shadow (blooming theme violet around graded ink) and the
  // stretched viewBox fattened strokes non-uniformly. Sharp, sleek lines are the pinned contract.
  it("no bloom: the stylesheet never drop-shadows the trace; strokes are non-scaling", async () => {
    const { readFileSync } = await import("fs");
    // Comments may name the banned filter (history); only live declarations count.
    const css = readFileSync("src/design/console/oscilloscope.css", "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).not.toMatch(/drop-shadow/);
    // The non-scaling rule must cover EVERY stroke element type the scope draws — a new
    // element type escaping the selector rendered fat (self-reviewer catch 2026-07-11: the
    // envelope median <path> regressed the exact class f2acb23 fixed; a bare substring match
    // let it through green).
    const nsRule = css.match(/([^{}]+)\{[^}]*vector-effect:\s*non-scaling-stroke/);
    expect(nsRule).not.toBeNull();
    for (const el of ["line", "polyline", "path"]) {
      expect(nsRule![1]).toMatch(new RegExp(`\\.osc-grid\\s+${el}`));
    }
    // Sleek stroke: the trace never grows past 1.5px (screen px under non-scaling-stroke).
    const trace = css.match(/\.osc-trace\s*\{[^}]*stroke-width:\s*([\d.]+)/);
    expect(trace).not.toBeNull();
    expect(parseFloat(trace![1])).toBeLessThanOrEqual(1.5);
  });
});
