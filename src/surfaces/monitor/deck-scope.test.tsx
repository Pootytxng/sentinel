import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DeckScope } from "./DeckScope";

// DeckScope guards (plan 2026-07-11-monitor-v5-deck-stack, T3): the Flight Deck's hero — the
// SAME Oscilloscope frametime scope, full-width, with the deleted waterfall's front-trace
// interactions ported: (a) hover scrub → an exact-sample readout chip (frame → ms → fps, SPIKE
// flagged by the same detector the markers use); (b) drag-zoom with the micro-drag misclick
// guard, nested composition, Reset zoom + double-click reset; (c) capture stop clears the zoom
// (never a stale window posing as live); (d) honest empty — no signal, no chip, no handlers'
// output; (e) the ms window span + frame budget stated in DOM (real axis, plain numbers).

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 600,
    bottom: 64,
    width: 600,
    height: 64,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// 60 real-ish frametimes around 7 ms with one obvious spike at index 30.
const win = Array.from({ length: 60 }, (_, i) => (i === 30 ? 41 : 7 + (i % 5) * 0.1));

function mount(over: Partial<Parameters<typeof DeckScope>[0]> = {}) {
  const props = {
    ftWin: win,
    live: true,
    budget: 1000 / 144,
    reduced: true,
    ...over,
  };
  const utils = render(<DeckScope {...props} />);
  return { ...utils, props };
}

const stage = (c: HTMLElement) => c.querySelector(".osc-stage")!;

describe("hover scrub — exact-sample readout chip (a)", () => {
  it("hovering prints frame → ms → fps from the REAL sample under the cursor", () => {
    const { container } = mount();
    fireEvent.pointerMove(stage(container), { clientX: 300, clientY: 30 });
    const chip = container.querySelector(".deck-scrub")!;
    expect(chip.textContent).toMatch(/^frame \d+ · \d+\.\d ms · \d+ fps/);
  });

  it("scrubbing the spike sample flags it SPIKE (same detector as the markers)", () => {
    const { container } = mount();
    // index 30 of 60 → fraction ~30/59
    fireEvent.pointerMove(stage(container), { clientX: (30 / 59) * 600, clientY: 30 });
    expect(container.querySelector(".deck-scrub")!.textContent).toContain("41.0 ms");
    expect(container.querySelector(".deck-scrub")!.textContent).toContain("SPIKE");
  });

  it("pointer leave clears the chip back to the hint", () => {
    const { container } = mount();
    fireEvent.pointerMove(stage(container), { clientX: 300, clientY: 30 });
    expect(container.querySelector(".deck-scrub")).not.toBeNull();
    fireEvent.pointerLeave(stage(container));
    expect(container.querySelector(".deck-scrub")).toBeNull();
    expect(screen.getByText("drag to zoom · double-click to reset")).toBeTruthy();
  });
});

describe("drag-zoom (b)", () => {
  it("a drag commits a zoom (Reset zoom appears; fewer frames drawn); double-click resets", () => {
    const { container } = mount();
    const s = stage(container);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
    const fullPts = container.querySelector(".osc-trace")!.getAttribute("points")!.split(" ").length;
    fireEvent.pointerDown(s, { clientX: 100, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 500, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(s, { clientX: 500, clientY: 30, pointerId: 1 });
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
    const zoomedPts = container.querySelector(".osc-trace")!.getAttribute("points")!.split(" ").length;
    expect(zoomedPts).toBeLessThan(fullPts);
    fireEvent.doubleClick(s);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
    expect(container.querySelector(".osc-trace")!.getAttribute("points")!.split(" ")).toHaveLength(
      fullPts,
    );
  });

  it("a micro-drag is a misclick, not a zoom", () => {
    const { container } = mount();
    const s = stage(container);
    fireEvent.pointerDown(s, { clientX: 300, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 304, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(s, { clientX: 304, clientY: 30, pointerId: 1 });
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
  });

  it("the drag selection band renders while dragging", () => {
    const { container } = mount();
    const s = stage(container);
    fireEvent.pointerDown(s, { clientX: 100, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 400, clientY: 30, pointerId: 1 });
    expect(container.querySelector(".osc-sel")).not.toBeNull();
    fireEvent.pointerUp(s, { clientX: 400, clientY: 30, pointerId: 1 });
    expect(container.querySelector(".osc-sel")).toBeNull();
  });
});

describe("capture stop clears the zoom (c) + honest empty (d)", () => {
  it("live → stopped clears zoom and draws the no-signal state", () => {
    const { container, rerender, props } = mount();
    const s = stage(container);
    fireEvent.pointerDown(s, { clientX: 100, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 500, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(s, { clientX: 500, clientY: 30, pointerId: 1 });
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
    rerender(<DeckScope {...props} live={false} ftWin={[]} />);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
    expect(container.querySelector(".osc-nosignal")).not.toBeNull();
    expect(container.querySelector(".deck-scrub")).toBeNull();
  });

  it("no signal → no hint, no axis chip, no scrub on hover", () => {
    const { container } = mount({ live: false, ftWin: [] });
    expect(screen.queryByText("drag to zoom · double-click to reset")).toBeNull();
    expect(container.querySelector(".deck-axis")).toBeNull();
    fireEvent.pointerMove(stage(container), { clientX: 300, clientY: 30 });
    expect(container.querySelector(".deck-scrub")).toBeNull();
  });
});

describe("the real ms axis + budget, stated plainly (e)", () => {
  it("states the drawn window's true ms span and the rig's frame budget", () => {
    const { container } = mount();
    const axis = container.querySelector(".deck-axis")!;
    expect(axis.textContent).toContain("7.0–41.0 ms window");
    expect(axis.textContent).toContain("budget 6.9 ms");
    // The dashed budget line itself rides the scope (same Oscilloscope contract).
    expect(container.querySelector(".osc-budget")).not.toBeNull();
  });

  it("no budget known → no budget claim (never invented)", () => {
    const { container } = mount({ budget: undefined });
    expect(container.querySelector(".deck-axis")!.textContent).not.toContain("budget");
  });
});
