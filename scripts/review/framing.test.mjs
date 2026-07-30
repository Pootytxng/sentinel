import { describe, it, expect } from "vitest";
import { framingVerdict } from "./framing.mjs";

// GUARD (bug→guard, standing law 2026-06-20 — defect caught by two independent consumer-panel seats,
// round 3, 2026-07-29). The LabDeck capture harness proved the comparison-evidence body was in the
// DOM, called that a successful capture, and shot a frame that actually contained the Optimize list.
// The comparison layer reached the panel unreviewed while the record said it had been captured.
//
// The defect was never in the screenshot code — it was in the ACCEPTANCE RULE. So the rule is what
// gets pinned here. Every case below is a geometry the harness must refuse to shoot.
describe("framingVerdict — a DOM assertion is not a framing assertion", () => {
  const VH = 971; // the owner's real viewport height at 1500x980 outer

  it("frames a tall element that occupies the viewport", () => {
    const v = framingVerdict({ top: 0, height: 800, viewportHeight: VH });
    expect(v.framed).toBe(true);
    expect(v.visible).toBe(800);
    expect(v.required).toBe(160);
  });

  // THE H7 CASE ITSELF. The element is in the DOM and has a real box, but the page is scrolled so
  // that its pixels sit entirely above the top edge. `querySelector` would return it; the camera
  // would not see it. This must be a refusal.
  it("refuses an element scrolled entirely off the top edge (the H7 geometry)", () => {
    const v = framingVerdict({ top: -640, height: 420, viewportHeight: VH });
    expect(v.framed).toBe(false);
    expect(v.visible).toBe(0);
    expect(v.reason).toBe("scrolled off the top edge");
  });

  it("refuses an element sitting entirely below the bottom edge", () => {
    const v = framingVerdict({ top: VH + 120, height: 420, viewportHeight: VH });
    expect(v.framed).toBe(false);
    expect(v.visible).toBe(0);
    expect(v.reason).toBe("below the bottom edge");
  });

  // The collapsed-box hole. `required = min(height, minVisible)` degenerates to 0 for a zero-height
  // element, so a naive `visible >= required` reports 0 >= 0 = "framed" for an element that renders
  // nothing at all. Same false PASS as H7, reached through the arithmetic instead of the DOM.
  it("refuses a zero-height box instead of trivially satisfying itself", () => {
    const v = framingVerdict({ top: 300, height: 0, viewportHeight: VH });
    expect(v.framed).toBe(false);
    expect(v.reason).toBe("zero-height box");
  });

  it("refuses a tall element that is only partially in frame", () => {
    // 100 visible pixels of a 420px row — under the 160px bar.
    const v = framingVerdict({ top: VH - 100, height: 420, viewportHeight: VH });
    expect(v.framed).toBe(false);
    expect(v.visible).toBe(100);
    expect(v.required).toBe(160);
    expect(v.reason).toBe("only partially in frame");
  });

  // A short row can never show 160px of itself, so the bar has to fall back to its own height —
  // otherwise every compact row would be permanently unshootable and the guard would be useless.
  it("holds a short element to full visibility rather than an unsatisfiable bar", () => {
    expect(framingVerdict({ top: 500, height: 40, viewportHeight: VH }).framed).toBe(true);
    const clipped = framingVerdict({ top: VH - 20, height: 40, viewportHeight: VH });
    expect(clipped.framed).toBe(false);
    expect(clipped.required).toBe(40);
    expect(clipped.visible).toBe(20);
  });

  it("pins the boundary in both directions", () => {
    expect(framingVerdict({ top: VH - 160, height: 400, viewportHeight: VH }).framed).toBe(true);
    expect(framingVerdict({ top: VH - 159, height: 400, viewportHeight: VH }).framed).toBe(false);
  });
});
