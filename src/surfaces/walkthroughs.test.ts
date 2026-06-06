import { describe, it, expect } from "vitest";
import { WALKTHROUGHS, KNOWN_VENDORS, walkthroughForKey, gpuVendor, resolveVariant } from "./walkthroughs";
import { ALLOWED_OPEN_URIS } from "./guided";

// Lint discipline for walkthroughs.json — same spirit as the tweaks.json guard. A malformed definition
// fails here, not at runtime.
describe("walkthroughs.json lint", () => {
  it("group ids are unique", () => {
    const ids = WALKTHROUGHS.map((w) => w.group);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each has a title, ≥1 variant, and pairsWith keys", () => {
    for (const w of WALKTHROUGHS) {
      expect(w.title.trim().length, w.group).toBeGreaterThan(0);
      expect(w.variants.length, w.group).toBeGreaterThan(0);
      expect(w.pairsWith.length, w.group).toBeGreaterThan(0);
    }
  });

  it("variants: known vendor, 1–5 steps, captions + labels present, coords in 0–100", () => {
    for (const w of WALKTHROUGHS) {
      for (const v of w.variants) {
        expect(KNOWN_VENDORS as readonly string[], `${w.group} vendor`).toContain(v.vendor);
        expect(v.steps.length, `${w.group}/${v.vendor} step count`).toBeGreaterThanOrEqual(1);
        expect(v.steps.length, `${w.group}/${v.vendor} step count`).toBeLessThanOrEqual(5);
        for (const s of v.steps) {
          expect(s.caption.trim().length, `${w.group} caption`).toBeGreaterThan(0);
          expect(s.label.trim().length, `${w.group} label`).toBeGreaterThan(0);
          expect(s.x, `${w.group} x`).toBeGreaterThanOrEqual(0);
          expect(s.x, `${w.group} x`).toBeLessThanOrEqual(100);
          expect(s.y, `${w.group} y`).toBeGreaterThanOrEqual(0);
          expect(s.y, `${w.group} y`).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it("any deep link is an EXISTING allowlisted ms-settings target (no new allowlist entries)", () => {
    for (const w of WALKTHROUGHS) {
      if (w.deepLink) expect(ALLOWED_OPEN_URIS.has(w.deepLink), w.group).toBe(true);
    }
  });

  it("walkthroughForKey resolves by a pairsWith id (case-insensitive)", () => {
    expect(walkthroughForKey("xmp-expo")?.group).toBe("xmp-expo");
    expect(walkthroughForKey("VRR")?.group).toBe("vrr");
    expect(walkthroughForKey("nope-not-real")).toBeNull();
  });

  it("gpuVendor + resolveVariant pick the right card", () => {
    expect(gpuVendor("AMD Radeon RX 9070 XT")).toBe("amd");
    expect(gpuVendor("NVIDIA GeForce RTX 4080")).toBe("nvidia");
    const vrr = walkthroughForKey("vrr")!;
    expect(resolveVariant(vrr, "nvidia").vendor).toBe("nvidia");
    expect(resolveVariant(vrr, "intel").vendor).toBe("amd"); // falls back to first when no exact/any
  });
});
