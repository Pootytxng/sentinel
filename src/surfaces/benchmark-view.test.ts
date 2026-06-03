import { describe, it, expect } from "vitest";
import { componentLabel, verdictLabel, verdictTone, fmtDelta } from "./benchmark-view";

describe("componentLabel", () => {
  it("maps each component to a friendly label", () => {
    expect(componentLabel("cpu")).toBe("CPU");
    expect(componentLabel("ram")).toBe("Memory");
    expect(componentLabel("gpu")).toBe("GPU");
    expect(componentLabel("disk")).toBe("Disk");
  });
});

describe("verdict", () => {
  it("labels each verdict honestly", () => {
    expect(verdictLabel("improved")).toBe("Improved");
    expect(verdictLabel("no-measurable-change")).toBe("No measurable change");
    expect(verdictLabel("regressed")).toBe("Regressed");
  });
  it("tones: improved=ready, regressed=danger, no-change=neutral(unknown)", () => {
    expect(verdictTone("improved")).toBe("ready");
    expect(verdictTone("regressed")).toBe("danger");
    expect(verdictTone("no-measurable-change")).toBe("unknown");
  });
});

describe("fmtDelta", () => {
  it("signs non-zero deltas and rounds to 1 decimal", () => {
    expect(fmtDelta(4.21)).toBe("+4.2%");
    expect(fmtDelta(-1.14)).toBe("-1.1%");
    expect(fmtDelta(0)).toBe("0%");
    expect(fmtDelta(0.04)).toBe("0%");
  });
});
