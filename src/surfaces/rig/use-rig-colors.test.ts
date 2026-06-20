import { describe, it, expect } from "vitest";
import { partColor } from "./use-rig-colors";
import type { RigColors } from "./use-rig-colors";

// A small, fully-synthetic RigColors fixture. Distinct hex values per slot so we can
// prove exactly which field/index partColor returns (no real theme tokens involved).
const makeColors = (over: Partial<RigColors> = {}): RigColors => ({
  accent: "#111111",
  palette: ["#aa0000", "#00bb00", "#0000cc"],
  ghost: "#5d6679",
  ...over,
});

describe("partColor", () => {
  it("returns the ghost ink for an undetected part (regardless of index)", () => {
    const c = makeColors();
    expect(partColor(c, false, 0)).toBe(c.ghost);
    expect(partColor(c, false, 1)).toBe(c.ghost);
    expect(partColor(c, false, 999)).toBe(c.ghost);
  });

  it("returns palette[0] for a detected part at index 0", () => {
    const c = makeColors();
    expect(partColor(c, true, 0)).toBe(c.palette[0]);
  });

  it("cycles the palette by index (index % palette.length)", () => {
    const c = makeColors();
    expect(partColor(c, true, 0)).toBe(c.palette[0]);
    expect(partColor(c, true, 1)).toBe(c.palette[1]);
    expect(partColor(c, true, 2)).toBe(c.palette[2]);
  });

  it("wraps around once index reaches palette.length", () => {
    const c = makeColors();
    // palette has 3 entries → index 3 wraps back to slot 0.
    expect(partColor(c, true, 3)).toBe(c.palette[0]);
    expect(partColor(c, true, 4)).toBe(c.palette[1]);
    expect(partColor(c, true, 5)).toBe(c.palette[2]);
  });

  it("wraps a large index correctly (100 % 3 === 1)", () => {
    const c = makeColors();
    expect(partColor(c, true, 100)).toBe(c.palette[1]);
    expect(partColor(c, true, 100)).toBe(c.palette[100 % c.palette.length]);
  });

  it("does not return the accent — detected parts come from the palette, not the accent field", () => {
    // Guard against a regression that picks colors.accent for detected parts.
    const c = makeColors({ accent: "#abcdef" });
    expect(partColor(c, true, 0)).not.toBe(c.accent);
    expect(partColor(c, true, 1)).not.toBe(c.accent);
  });
});
