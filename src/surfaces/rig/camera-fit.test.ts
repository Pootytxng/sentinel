import { describe, it, expect } from "vitest";
import { fitCameraDistance, FIT_REF_ASPECT } from "./camera-fit";

// Guards the hologram scale-to-fit (ask b, 2026-07-03): the rig must stay fully in frame at ANY
// container size/shape — small/minimized window, narrow column — while a normal landscape stage
// keeps the base cameraDist framing exactly.
describe("fitCameraDistance (hologram scale-to-fit)", () => {
  const base = 6.9; // the V2 hero's base distance

  it("keeps the base framing at/above the reference aspect (wide/normal windows unchanged)", () => {
    expect(fitCameraDistance(base, FIT_REF_ASPECT)).toBe(base);
    expect(fitCameraDistance(base, 1.8)).toBe(base);
    expect(fitCameraDistance(base, 3.0)).toBe(base);
  });

  it("pulls the camera back as the container narrows, monotonically", () => {
    const atRef = fitCameraDistance(base, FIT_REF_ASPECT);
    const narrow = fitCameraDistance(base, 0.8);
    const narrower = fitCameraDistance(base, 0.5);
    expect(narrow).toBeGreaterThan(atRef);
    expect(narrower).toBeGreaterThan(narrow); // narrower container → camera further back
  });

  it("holds the horizontal framing constant below the reference (the no-clip guarantee)", () => {
    // Visible horizontal world-extent ∝ dist * aspect; below REF it must stay == base*REF so the
    // rig's WIDTH never falls outside the frame, however narrow the window gets.
    for (const a of [0.4, 0.6, 0.9, 1.1]) {
      expect(fitCameraDistance(base, a) * a).toBeCloseTo(base * FIT_REF_ASPECT, 6);
    }
  });

  it("falls back to the base framing on a degenerate / zero / non-finite size", () => {
    expect(fitCameraDistance(base, 0)).toBe(base);
    expect(fitCameraDistance(base, NaN)).toBe(base);
    expect(fitCameraDistance(base, Infinity)).toBe(base);
    expect(fitCameraDistance(base, -1)).toBe(base);
  });
});
