import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SessionStack } from "./SessionStack";
import type { SessionSummary } from "../../types";

// SessionStack guards (plan 2026-07-11-monitor-v5-deck-stack, T2): (a) honest empties — 0
// sessions renders the existing no-sessions state, 1 session renders a row with NO delta chip;
// (b) flat small multiples — every row on ONE shared 1%-low axis, note printed once; (c) the
// vs-PREVIOUS chip with cross-game labeling; (d) the ONE worst-dip pin wearing its exact clock
// time in DOM (never text painted over chart ink); (e) expand/collapse detail line (button
// semantics = keyboard for free); (f) the <current game> ONLY filter chip; (g) the idle
// repaint guard — same props re-render paints nothing (the v4 reference-identity lesson);
// (h) header-slop law — no headings in the subtree.

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
    bottom: 40,
    width: 640,
    height: 40,
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

function mount(sessions: SessionSummary[], reduced = true) {
  return render(<SessionStack sessions={sessions} reduced={reduced} />);
}

describe("honest empties (a)", () => {
  it("0 sessions → the existing no-sessions empty state, no rows, no axis note", () => {
    const { container } = mount([]);
    expect(screen.getByText("no sessions on record yet — play with capture on")).toBeTruthy();
    expect(container.querySelectorAll(".ss-row")).toHaveLength(0);
    expect(container.querySelector(".ss-axisnote")).toBeNull();
  });

  it("1 session → one row, NO delta chip", () => {
    const { container } = mount([sess()]);
    expect(container.querySelectorAll(".ss-row")).toHaveLength(1);
    expect(container.querySelector(".ss-chip")).toBeNull();
  });

  it("a stripped timeline still rows up (meta is real) with the honest no-timeline note", () => {
    const { container } = mount([sess(), sess({ stutter_timeline: [] })]);
    expect(container.querySelectorAll(".ss-row")).toHaveLength(2);
    expect(screen.getByText("timeline not kept")).toBeTruthy();
  });
});

describe("flat small multiples on one shared axis (b)", () => {
  it("rows carry meta: game · when · duration; newest row is inked as newest", () => {
    const { container } = mount([sess(), sess({ process_name: "palworld.exe" })]);
    const rows = container.querySelectorAll(".ss-row");
    expect(rows[0].textContent).toContain("valorant");
    expect(rows[0].textContent).toContain("today");
    expect(rows[0].textContent).toContain("42m");
    expect(rows[0].classList.contains("ss-row-newest")).toBe(true);
    expect(rows[1].classList.contains("ss-row-newest")).toBe(false);
  });

  it("the shared-axis note prints ONCE with the global max", () => {
    const a = sess({ stutter_timeline: [[0, 100], [10, 120]] });
    const b = sess({ stutter_timeline: [[0, 200], [10, 240]] });
    const { container } = mount([a, b]);
    const notes = container.querySelectorAll(".ss-axisnote");
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain("0–240");
    expect(notes[0].textContent).toContain("1% low fps");
  });
});

describe("vs-PREVIOUS delta chips (c)", () => {
  it("each row chips against the next-older row; the oldest has none", () => {
    const { container } = mount([
      sess({ avg_fps: 247 }),
      sess({ avg_fps: 240 }),
      sess({ avg_fps: 250 }),
    ]);
    const chips = container.querySelectorAll(".ss-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain("VS PREVIOUS");
    expect(chips[0].textContent).toContain("▲7 AVG");
    expect(chips[1].textContent).toContain("▼10 AVG");
  });

  it("cross-game chips are LABELED, never a bare regression-looking number", () => {
    const { container } = mount([
      sess({ avg_fps: 240 }),
      sess({ process_name: "cyberpunk2077.exe", avg_fps: 90 }),
    ]);
    expect(container.querySelector(".ss-chip")!.textContent).toContain("DIFFERENT GAME");
  });
});

describe("the ONE worst-dip pin with its exact clock time (d)", () => {
  it("the pin's clock time renders in DOM, positioned by the dip's own moment", () => {
    const start = new Date(2026, 6, 9, 21, 30, 0);
    const expected = new Date(2026, 6, 9, 21, 35, 0).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    const { container } = mount([
      sess({
        started_at: start.toISOString(),
        duration_secs: 600,
        stutter_timeline: [[0, 100], [300, 20], [600, 90]],
        stutter_events: [
          { at_secs: 300, kind: "process-start", label: "OneDrive.exe starting" },
          { at_secs: 500, kind: "process-start", label: "harmless" },
        ],
      }),
      sess(),
    ]);
    const pins = container.querySelectorAll(".ss-pin-label");
    expect(pins).toHaveLength(1); // one worst dip per row, second session has no events
    expect(pins[0].textContent).toContain(expected);
  });

  it("no recorded events → no pin label", () => {
    const { container } = mount([sess()]);
    expect(container.querySelector(".ss-pin-label")).toBeNull();
  });
});

describe("partial timeline coverage is STATED (self-review round-1 catch, bug→guard)", () => {
  // A 10.5-hour real session whose timeline caps at ~2h drew as a sliver; now the trace spans
  // the recorded window and the row says so — in the strip AND the detail line.
  const capped = () =>
    sess({
      duration_secs: 37_696,
      stutter_timeline: [
        [0, 100],
        [3600, 60],
        [7200, 80],
      ],
      stutter_events: [],
    });

  it("a capped recording wears the coverage note; a full one doesn't", () => {
    const { container } = mount([capped(), sess()]);
    const notes = container.querySelectorAll(".ss-coverage");
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe("first 2h 0m recorded");
    expect(container.querySelectorAll(".ss-canvas-partial")).toHaveLength(1);
  });

  it("the expanded detail states the coverage too", () => {
    const { container } = mount([capped()]);
    fireEvent.click(container.querySelector(".ss-row")!);
    expect(container.querySelector(".ss-detail")!.textContent).toContain(
      "timeline covers the first 2h 0m only",
    );
  });
});

describe("expand/collapse detail line (e)", () => {
  it("click expands the inline detail: AVG · 1% LOW · SPIKES · worst dip · changes tag; click again collapses", () => {
    const start = new Date(2026, 6, 9, 21, 30, 0);
    const clock = new Date(2026, 6, 9, 21, 35, 0).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    const { container } = mount([
      sess({
        started_at: start.toISOString(),
        duration_secs: 600,
        avg_fps: 238,
        low1_fps_est: 181,
        compy_changes_active: 2,
        stutter_timeline: [[0, 100], [300, 20], [600, 90]],
        stutter_events: [{ at_secs: 300, kind: "process-start", label: "OneDrive.exe starting" }],
      }),
    ]);
    const row = container.querySelector(".ss-row")!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".ss-detail")).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const detail = container.querySelector(".ss-detail")!;
    expect(detail.textContent).toContain("238 AVG");
    expect(detail.textContent).toContain("181 1% LOW");
    expect(detail.textContent).toContain("1 SPIKE");
    expect(detail.textContent).toContain(`worst dip ${clock} — OneDrive.exe starting`);
    expect(detail.textContent).toContain("2 COMPY CHANGES ON");
    fireEvent.click(row);
    expect(container.querySelector(".ss-detail")).toBeNull();
  });

  it("a session with no dips and no changes keeps the detail honest (no invented facts)", () => {
    const { container } = mount([sess()]);
    fireEvent.click(container.querySelector(".ss-row")!);
    const detail = container.querySelector(".ss-detail")!;
    expect(detail.textContent).toContain("0 SPIKES");
    expect(detail.textContent).not.toContain("worst dip");
    expect(detail.textContent).not.toContain("COMPY CHANGES");
  });
});

describe("the <current game> ONLY filter (f)", () => {
  it("mixed games → chip renders; filtering keeps only the current game's rows", () => {
    const { container } = mount([
      sess(),
      sess({ process_name: "palworld.exe" }),
      sess(),
    ]);
    expect(container.querySelectorAll(".ss-row")).toHaveLength(3);
    const only = screen.getByRole("button", { name: /valorant only/i });
    fireEvent.click(only);
    const rows = [...container.querySelectorAll(".ss-row")];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.textContent!.includes("valorant"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /all games/i }));
    expect(container.querySelectorAll(".ss-row")).toHaveLength(3);
  });

  it("all one game → no chip (a filter that does nothing earns no chrome)", () => {
    mount([sess(), sess()]);
    expect(screen.queryByRole("button", { name: /only/i })).toBeNull();
  });
});

describe("idle repaint guard (g) + header-slop law (h)", () => {
  it("re-render with the SAME sessions reference paints nothing new", () => {
    const sessions = [sess(), sess({ process_name: "palworld.exe" })];
    const { rerender } = mount(sessions);
    const painted = ctx2d.calls.clearRect;
    expect(painted).toBeGreaterThan(0);
    rerender(<SessionStack sessions={sessions} reduced />);
    rerender(<SessionStack sessions={sessions} reduced />);
    expect(ctx2d.calls.clearRect).toBe(painted);
  });

  it("genuinely new session data repaints", () => {
    const sessions = [sess()];
    const { rerender } = mount(sessions);
    const painted = ctx2d.calls.clearRect;
    rerender(<SessionStack sessions={[sess({ avg_fps: 100 })]} reduced />);
    expect(ctx2d.calls.clearRect).toBeGreaterThan(painted);
  });

  it("no headings or lede strips inside the stack subtree", () => {
    const { container } = mount([sess(), sess()]);
    expect(container.querySelectorAll("h1, h2, h3").length).toBe(0);
  });
});
