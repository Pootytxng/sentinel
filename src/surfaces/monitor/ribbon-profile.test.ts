import { describe, it, expect } from "vitest";
import { ribbonProfile, RIBBON_SPAN_X, RIBBON_MAX_Y } from "./ribbon-profile";

// v3 T3 guards: the ribbon is data — real per-sample geometry, exact-moment spikes, zero-baseline
// proportions, and NOTHING when there is nothing real to draw.

describe("ribbonProfile — real geometry only", () => {
  it("fewer than 2 samples ⇒ null (never a ghost ribbon)", () => {
    expect(ribbonProfile([], 6.06)).toBeNull();
    expect(ribbonProfile([7], 6.06)).toBeNull();
  });

  it("one vertex per sample spanning the full x range, y proportional from a ZERO baseline", () => {
    const p = ribbonProfile([10, 20, 40], undefined)!;
    expect(p.top).toHaveLength(3);
    expect(p.top[0].x).toBeCloseTo(-RIBBON_SPAN_X / 2);
    expect(p.top[2].x).toBeCloseTo(RIBBON_SPAN_X / 2);
    expect(p.top[2].y).toBeCloseTo(RIBBON_MAX_Y); // the max sample tops out
    expect(p.top[0].y).toBeCloseTo(RIBBON_MAX_Y / 4); // 10 is a QUARTER of 40 — honest magnitude
  });

  it("spikes sit at their exact sample x, worst flagged, budget plane scaled the same", () => {
    const p = ribbonProfile([7, 7.1, 41, 6.9, 22, 7], 6.06)!;
    expect(p.spikes.map((s) => s.i)).toEqual([2, 4]);
    expect(p.spikes[0].x).toBeCloseTo((2 / 5) * RIBBON_SPAN_X - RIBBON_SPAN_X / 2);
    expect(p.spikes[0].worst).toBe(true);
    expect(p.spikes[1].worst).toBe(false);
    expect(p.budgetY).toBeCloseTo((6.06 / 41) * RIBBON_MAX_Y);
  });

  it("flat real data ⇒ zero spikes and a full ribbon (a calm session is not an error)", () => {
    const p = ribbonProfile([7, 7.2, 6.9, 7.1], 6.06)!;
    expect(p.spikes).toEqual([]);
    expect(p.top).toHaveLength(4);
  });
});
