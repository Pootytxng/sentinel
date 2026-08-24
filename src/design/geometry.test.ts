import { describe, it, expect } from "vitest";
import { gaugePercent, sparkPoints, traceGeometry } from "./geometry";

describe("gaugePercent", () => {
  it("returns 0..100 within range", () => {
    expect(gaugePercent(50, 0, 100)).toBe(50);
    expect(gaugePercent(30, 0, 120)).toBe(25);
  });
  it("clamps out-of-range and handles a zero span", () => {
    expect(gaugePercent(-5, 0, 100)).toBe(0);
    expect(gaugePercent(150, 0, 100)).toBe(100);
    expect(gaugePercent(5, 10, 10)).toBe(0);
  });
});

describe("sparkPoints", () => {
  it("maps values to a polyline string across width/height", () => {
    const pts = sparkPoints([0, 5, 10], 100, 40);
    expect(pts).toBe("0,40 50,20 100,0");
  });
  it("returns empty string for <2 values", () => {
    expect(sparkPoints([1], 100, 40)).toBe("");
    expect(sparkPoints([], 100, 40)).toBe("");
  });
  it("flat series renders along the bottom", () => {
    expect(sparkPoints([7, 7, 7], 100, 40)).toBe("0,40 50,40 100,40");
  });
});

// ── traceGeometry — the fps_series honesty properties ────────────────────────────────────────
//
// The trace was persisted for weeks and drawn by nothing (BACKLOG §A2, #49 deviation 3). These are
// the properties that make DRAWING it honest; each one, broken, invents a measurement Compy never
// took, and every one of them is invisible to tsc and to a screenshot of a clean session.
describe("traceGeometry", () => {
  const W = 100;
  const H = 50;

  it("returns null for an empty series — the caller must say so in words, not draw a flat line", () => {
    expect(traceGeometry([], W, H)).toBeNull();
    // A stripped older session persists as an empty vec, not as zeroes (sessions.rs:328).
    expect(traceGeometry([], W, H, { durationSecs: 3600 })).toBeNull();
  });

  it("draws ONE run when every bucket is contiguous", () => {
    const g = traceGeometry([[0, 60], [10, 62], [20, 58]], W, H, { durationSecs: 30 })!;
    expect(g.runs).toHaveLength(1);
    expect(g.gaps).toBe(0);
    expect(g.runs[0].dot).toBeNull();
    expect(g.runs[0].points.split(" ")).toHaveLength(3);
  });

  // THE property. sessions.rs `fps_series_gaps_stay_gaps` keeps the hole in the DATA; this keeps it
  // in the PICTURE. One polyline across it would paint a confident line through 20 seconds nobody
  // measured — the single most misleading thing this component could do.
  it("BREAKS the line at a missing bucket instead of interpolating across it", () => {
    const g = traceGeometry([[0, 100], [30, 200]], W, H, { durationSecs: 40 })!;
    expect(g.runs).toHaveLength(2);
    expect(g.gaps).toBe(1);
    // Neither run may contain both samples — that is what "never interpolated" means here.
    for (const run of g.runs) expect(run.points).toBe("");
  });

  // A lone bucket between two holes is a run of one, and <polyline> with one point paints nothing.
  // Dropping it would silently delete a real measurement.
  it("gives a gap-isolated sample a dot so it cannot vanish", () => {
    const g = traceGeometry([[0, 60], [10, 60], [90, 30]], W, H, { durationSecs: 100 })!;
    expect(g.runs).toHaveLength(2);
    expect(g.runs[0].dot).toBeNull();
    expect(g.runs[1].dot).not.toBeNull();
    expect(g.runs[1].points).toBe("");
  });

  // Min-max normalisation would stretch a rock-steady session into a cliff face. Anchored at 0, a
  // flat session looks flat: 141 and 144 land within a pixel of each other on a 50px box.
  it("anchors the value axis at 0, so a steady session reads as steady", () => {
    const g = traceGeometry([[0, 141], [10, 144], [20, 142]], W, H, { durationSecs: 30 })!;
    expect(g.peak).toBe(144);
    const ys = g.runs[0].points.split(" ").map((p) => Number(p.split(",")[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1.2);
    // …while a real halving still reads as a halving.
    const half = traceGeometry([[0, 144], [10, 72]], W, H, { durationSecs: 20 })!;
    const hy = half.runs[0].points.split(" ").map((p) => Number(p.split(",")[1]));
    expect(hy[0]).toBeCloseTo(0, 5);
    expect(hy[1]).toBeCloseTo(H / 2, 5);
  });

  // The x-axis is real elapsed seconds, not sample index — the whole reason <Sparkline> cannot be
  // reused. Index-stepping would slide the post-gap sample to the middle of the box.
  it("places samples by elapsed seconds, not by index", () => {
    const g = traceGeometry([[0, 60], [80, 60]], W, H, { bucketSecs: 10, durationSecs: 90 })!;
    const xs = g.runs.map((r) => r.dot!.x);
    expect(xs[0]).toBeCloseTo(0, 5);
    expect(xs[1]).toBeCloseTo(88.89, 1); // 80/90 of the width — index-stepping would say 100.
  });

  // A session that stopped reporting long before it ended must SHOW that silence.
  it("runs the axis to the end of the session, not to the last bucket", () => {
    const g = traceGeometry([[0, 60], [10, 60]], W, H, { durationSecs: 600 })!;
    expect(g.spanSecs).toBe(600);
    const lastX = Number(g.runs[0].points.split(" ")[1].split(",")[0]);
    expect(lastX).toBeLessThan(W / 4);
  });

  it("survives junk without inventing a point (non-finite, negative, unsorted)", () => {
    const g = traceGeometry(
      [[20, 50], [0, 60], [10, Number.NaN], [-5, 40], [30, Number.POSITIVE_INFINITY]] as [number, number][],
      W, H, { durationSecs: 40 },
    )!;
    // Only (0,60) and (20,50) are real, and they are one bucket apart — a gap, not a line.
    expect(g.runs).toHaveLength(2);
    expect(g.peak).toBe(60);
  });

  it("keeps an all-zero session on the baseline instead of dividing by zero", () => {
    const g = traceGeometry([[0, 0], [10, 0]], W, H, { durationSecs: 20 })!;
    expect(g.peak).toBe(1);
    for (const p of g.runs[0].points.split(" ")) expect(Number(p.split(",")[1])).toBe(H);
  });
});
