import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SessionWaterfall } from "./SessionWaterfall";
import type { SessionSummary } from "../../types";

// SessionWaterfall guards (plan 2026-07-10-monitor-v4-session-waterfall T2/T3): (a) the
// content-stable redraw guard — a re-render with the SAME window reference paints nothing
// (the v3 idle-canvas bug→guard class, now on 2D canvas); (b) never-mix-units — each mode
// declares exactly one axis; (c) honest empties per mode (stripped timelines excluded);
// (d) fabricated-zero truth-table — absent aggregates read em-dash, never 0; (e) the
// SESSIONS lean-in: layer labels, dip labels on hover, delta strip, same-game toggle,
// compy-context tag; (f) A's drag-zoom + reset; (g) tilt is pointer-driven and dead under
// reduced motion.

// jsdom has no 2D context — install a fake that counts paint calls.
const ctx2d = {
  calls: { clearRect: 0 },
  setTransform: vi.fn(),
  clearRect: vi.fn(() => {
    ctx2d.calls.clearRect++;
  }),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  closePath: vi.fn(),
  arc: vi.fn(),
  fillRect: vi.fn(),
  setLineDash: vi.fn(),
  globalAlpha: 1,
  strokeStyle: "",
  fillStyle: "",
  lineWidth: 1,
};

beforeEach(() => {
  ctx2d.calls.clearRect = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx2d as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 640,
    bottom: 280,
    width: 640,
    height: 280,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function sess(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    started_at: new Date().toISOString(),
    duration_secs: 2520,
    process_name: "valorant.exe",
    samples: 2520,
    avg_fps: 240,
    avg_frametime_ms: 4.2,
    low1_fps_est: 190,
    peak_gpu_temp_c: 72,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_timeline: [
      [0, 180],
      [1260, 200],
      [2520, 190],
    ],
    stutter_events: [],
    ...over,
  } as SessionSummary;
}

const win = Array.from({ length: 60 }, (_, i) => 7 + (i % 5) * 0.1);

function mount(over: Partial<Parameters<typeof SessionWaterfall>[0]> = {}) {
  const props = {
    ftWin: win,
    live: true,
    budget: 1000 / 144,
    sessions: [] as SessionSummary[],
    reduced: true,
    ...over,
  };
  const utils = render(<SessionWaterfall {...props} />);
  return { ...utils, props };
}

describe("redraw guard — the v3 idle-canvas class on 2D canvas (a)", () => {
  it("re-render with the SAME window reference paints nothing new", () => {
    const { rerender, props } = mount();
    const painted = ctx2d.calls.clearRect;
    expect(painted).toBeGreaterThan(0);
    rerender(<SessionWaterfall {...props} />);
    rerender(<SessionWaterfall {...props} />);
    expect(ctx2d.calls.clearRect).toBe(painted);
  });

  it("a genuinely new window (new reference + values) repaints", () => {
    const { rerender, props } = mount();
    const painted = ctx2d.calls.clearRect;
    rerender(<SessionWaterfall {...props} ftWin={[...win, 9.1]} />);
    expect(ctx2d.calls.clearRect).toBeGreaterThan(painted);
  });
});

describe("units never mix (b)", () => {
  it("LIVE declares the ms axis; SESSIONS the fps axis — one unit per scene", () => {
    const { container } = mount();
    const root = container.querySelector(".sw")!;
    expect(root.getAttribute("data-axis")).toBe("ms");
    expect(container.querySelector(".sw-axis")!.textContent).toMatch(/ms$/);
    expect(container.querySelector(".sw-axis")!.textContent).not.toMatch(/fps/);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(root.getAttribute("data-axis")).toBe("fps");
  });

  it("SESSIONS axis is 1%-low fps, never ms", () => {
    const { container } = mount({ live: false, sessions: [sess()] });
    expect(container.querySelector(".sw")!.getAttribute("data-axis")).toBe("fps");
    expect(container.querySelector(".sw-axis")!.textContent).toMatch(/1% low fps$/);
    expect(container.querySelector(".sw-axis")!.textContent).not.toMatch(/ms/);
  });
});

describe("honest empties (c)", () => {
  it("LIVE with no signal → the honest empty, no axis, nothing painted as data", () => {
    const { container } = mount({ live: false, ftWin: [] });
    expect(screen.getByText("no signal — start capture, then play")).toBeTruthy();
    expect(container.querySelector(".sw-axis")).toBeNull();
  });

  it("0 sessions → 'no sessions on record yet — play with capture on'", () => {
    mount({ live: false, ftWin: [], sessions: [] });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByText("no sessions on record yet — play with capture on")).toBeTruthy();
  });

  it("sessions exist but every timeline was stripped → the retention note, not a fake chart", () => {
    mount({
      live: false,
      ftWin: [],
      sessions: [sess({ stutter_timeline: [] }), sess({ stutter_timeline: undefined })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(
      screen.getByText(
        "no session timelines on record — timelines are kept for your 5 most recent sessions",
      ),
    ).toBeTruthy();
    expect(document.querySelector(".sw-layer-label")).toBeNull();
  });

  it("stripped sessions don't appear as layers among drawable ones", () => {
    const { container } = mount({
      live: false,
      ftWin: [],
      sessions: [sess(), sess({ stutter_timeline: [] }), sess({ process_name: "palworld.exe" })],
    });
    expect(container.querySelectorAll(".sw-layer-label")).toHaveLength(2);
  });

  it("exactly 1 session → single layer + 'one more session unlocks comparison'", () => {
    const { container } = mount({ live: false, ftWin: [], sessions: [sess()] });
    expect(container.querySelectorAll(".sw-layer-label")).toHaveLength(1);
    expect(screen.getByText("one more session unlocks comparison")).toBeTruthy();
    expect(container.querySelector(".sw-delta")).toBeNull();
  });
});

describe("fabricated-zero truth-table (d)", () => {
  it("absent aggregates on the previous session → em-dash deltas, never 0", () => {
    const { container } = mount({
      live: false,
      ftWin: [],
      sessions: [sess(), sess({ avg_fps: NaN, low1_fps_est: NaN })],
    });
    const delta = container.querySelector(".sw-delta")!;
    expect(delta.textContent).toContain("AVG FPS —");
    expect(delta.textContent).toContain("1% LOW —");
    expect(delta.textContent).not.toMatch(/[+-]0(?!\d)|(?<![±\d.])0(?!\d)/);
  });

  it("real aggregates → real signed deltas", () => {
    const { container } = mount({
      live: false,
      ftWin: [],
      sessions: [sess({ avg_fps: 247, low1_fps_est: 194 }), sess()],
    });
    const delta = container.querySelector(".sw-delta")!;
    expect(delta.textContent).toContain("+7");
    expect(delta.textContent).toContain("+4");
  });
});

describe("SESSIONS lean-in: labels · dips · same-game · compy tag (e)", () => {
  it("layer labels carry game · relative day · avg fps", () => {
    mount({ live: false, ftWin: [], sessions: [sess()] });
    const label = document.querySelector(".sw-layer-label")!;
    expect(label.textContent).toContain("valorant");
    expect(label.textContent).toContain("today");
    expect(label.textContent).toContain("240 avg");
  });

  it("hovering a layer shows its readout with the REAL dip label", () => {
    mount({
      live: false,
      ftWin: [],
      sessions: [
        sess({
          stutter_events: [
            { at_secs: 1200, kind: "process-start", label: "OneDrive.exe starting" },
          ],
        }),
      ],
    });
    fireEvent.mouseEnter(document.querySelector(".sw-layer-label")!);
    const scrub = document.querySelector(".sw-scrub")!;
    expect(scrub.textContent).toContain("240 avg fps");
    expect(scrub.textContent).toContain("190 1% low");
    expect(scrub.textContent).toContain("1 dip — OneDrive.exe starting");
  });

  it("same-game toggle appears only with ≥2 layers of one game, and filters to them", () => {
    const { container } = mount({
      live: false,
      ftWin: [],
      sessions: [sess({ process_name: "palworld.exe" }), sess(), sess()],
    });
    expect(container.querySelectorAll(".sw-layer-label")).toHaveLength(3);
    const toggle = screen.getByRole("button", { name: "Same game only" });
    fireEvent.click(toggle);
    const labels = [...container.querySelectorAll(".sw-layer-label")];
    expect(labels).toHaveLength(2);
    expect(labels.every((l) => l.textContent!.includes("valorant"))).toBe(true);
  });

  it("no same-game pair → no toggle", () => {
    mount({
      live: false,
      ftWin: [],
      sessions: [sess(), sess({ process_name: "palworld.exe" })],
    });
    expect(screen.queryByRole("button", { name: "Same game only" })).toBeNull();
  });

  it("a session that ran with Compy changes wears the quiet context tag (recorded fact only)", () => {
    mount({
      live: false,
      ftWin: [],
      sessions: [sess({ compy_changes_active: 2 }), sess()],
    });
    expect(screen.getByText("· 2 COMPY CHANGES ON")).toBeTruthy();
    expect(screen.queryByText(/faster|improved|gain/i)).toBeNull();
  });

  it("auto-parks on SESSIONS when nothing is live but sessions exist (until the user picks)", () => {
    const { container } = mount({ live: false, ftWin: [], sessions: [sess()] });
    expect(container.querySelector(".sw")!.getAttribute("data-mode")).toBe("sessions");
    fireEvent.click(screen.getByRole("button", { name: "Now" }));
    expect(container.querySelector(".sw")!.getAttribute("data-mode")).toBe("live");
  });
});

describe("A's drag-to-segment on the front trace (f)", () => {
  it("drag commits a zoom (Reset zoom appears); double-click resets", () => {
    const { container } = mount();
    const canvas = container.querySelector(".sw-canvas")!;
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 140, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 500, clientY: 140, pointerId: 1 });
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
    fireEvent.doubleClick(canvas);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
  });

  it("hover scrubs an exact-sample readout: ms · fps", () => {
    const { container } = mount();
    const canvas = container.querySelector(".sw-canvas")!;
    fireEvent.pointerMove(canvas, { clientX: 320, clientY: 140 });
    const scrub = container.querySelector(".sw-scrub")!;
    expect(scrub.textContent).toMatch(/^\d+\.\d ms · \d+ fps/);
  });

  it("capture stopping clears zoom and depth layers (never frozen-as-live)", () => {
    const { rerender, props, container } = mount();
    const canvas = container.querySelector(".sw-canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 140, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 500, clientY: 140, pointerId: 1 });
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
    rerender(<SessionWaterfall {...props} live={false} ftWin={[]} />);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
    expect(container.querySelector(".sw")!.getAttribute("data-depth")).toBe("0");
    expect(screen.getByText("no signal — start capture, then play")).toBeTruthy();
  });

  it("the depth buffer pushes a snapshot once the window span elapses", () => {
    let t = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    const { rerender, props, container } = mount();
    expect(container.querySelector(".sw")!.getAttribute("data-depth")).toBe("0");
    t = 1500; // before the interval — no push
    rerender(<SessionWaterfall {...props} ftWin={[...win]} />);
    expect(container.querySelector(".sw")!.getAttribute("data-depth")).toBe("0");
    t = 60_000; // well past the window span
    rerender(<SessionWaterfall {...props} ftWin={[...win]} />);
    expect(container.querySelector(".sw")!.getAttribute("data-depth")).toBe("1");
  });
});

describe("tilt is pointer-driven only; empty scenes never repaint (g)", () => {
  it("reduced: a bare pointer move over an empty scene causes no repaint", () => {
    const { container } = mount({ live: false, ftWin: [], sessions: [], reduced: true });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const before = ctx2d.calls.clearRect;
    const canvas = container.querySelector(".sw-canvas")!;
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 100 });
    expect(ctx2d.calls.clearRect).toBe(before);
  });

  it("FULL motion over an empty LIVE scene also stays paint-free (self-review round-1 catch)", () => {
    const { container } = mount({ live: false, ftWin: [], sessions: [], reduced: false });
    const before = ctx2d.calls.clearRect;
    const canvas = container.querySelector(".sw-canvas")!;
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 100 });
    expect(ctx2d.calls.clearRect).toBe(before);
  });

  it("full motion + depth layers: the same move tilts (repaints) — motion only on pointer", () => {
    const { container } = mount({
      live: false,
      ftWin: [],
      sessions: [sess(), sess({ process_name: "palworld.exe" })],
      reduced: false,
    });
    const before = ctx2d.calls.clearRect;
    const canvas = container.querySelector(".sw-canvas")!;
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 100 });
    expect(ctx2d.calls.clearRect).toBeGreaterThan(before);
  });
});

describe("legend + delta annotation (self-review round-1 catches, bug→guard)", () => {
  it("5 layers with long names all render as stacked legend rows (no per-layer positioning)", () => {
    const games = [
      "sand-a-superbly-long-title.exe",
      "cyberpunk2077.exe",
      "microsoftflightsimulator.exe",
      "valorant.exe",
      "escapefromtarkov.exe",
    ];
    const { container } = mount({
      live: false,
      ftWin: [],
      sessions: games.map((g) => sess({ process_name: g, compy_changes_active: 12 })),
    });
    const legend = container.querySelector(".sw-legend")!;
    expect(legend).not.toBeNull();
    const rows = legend.querySelectorAll(".sw-layer-label");
    expect(rows).toHaveLength(5);
    // Rows are flow-stacked — none carries inline positioning that could collide.
    for (const r of rows) expect(r.getAttribute("style")).toBeNull();
  });

  it("cross-game delta is LABELED, never a bare number that reads as a regression", () => {
    const { container } = mount({
      live: false,
      ftWin: [],
      sessions: [
        sess({ process_name: "valorant.exe", avg_fps: 240 }),
        sess({ process_name: "cyberpunk2077.exe", avg_fps: 90, low1_fps_est: 65 }),
      ],
    });
    const delta = container.querySelector(".sw-delta")!;
    expect(delta.textContent).toContain("DIFFERENT GAME");
    expect(delta.textContent).toContain("cyberpunk2077".toUpperCase());
  });

  it("a same-game prior is preferred over a nearer different-game session", () => {
    const { container } = mount({
      live: false,
      ftWin: [],
      sessions: [
        sess({ avg_fps: 247, low1_fps_est: 194 }),
        sess({ process_name: "palworld.exe", avg_fps: 90 }),
        sess(), // the front's own game, further back
      ],
    });
    const delta = container.querySelector(".sw-delta")!;
    expect(delta.textContent).toContain("VS PREV VALORANT");
    expect(delta.textContent).not.toContain("DIFFERENT GAME");
    expect(delta.textContent).toContain("+7");
  });
});
