import { describe, it, expect } from "vitest";
import {
  componentLabel,
  verdictLabel,
  verdictTone,
  fmtDelta,
  trialVerdictLabel,
  trialVerdictTone,
  trialReasonText,
} from "./benchmark-view";
import type { TrialVerdict } from "../types";

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
  it("tones: improved=ready, regressed=danger, no-change=neutral(info)", () => {
    expect(verdictTone("improved")).toBe("ready");
    expect(verdictTone("regressed")).toBe("danger");
    expect(verdictTone("no-measurable-change")).toBe("info");
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

describe("trial verdict", () => {
  const keep: TrialVerdict = { verdict: "keep", effect_pct: 6, ci_lo_pct: 4, ci_hi_pct: 8, metric: "1% low" };
  const revert: TrialVerdict = { verdict: "revert", effect_pct: -7, ci_lo_pct: -9, ci_hi_pct: -5, metric: "0.1% low" };
  const noChange: TrialVerdict = { verdict: "inconclusive", reason: "within-noise" };
  it("labels + tones each verdict", () => {
    expect(trialVerdictLabel(keep)).toBe("Helped");
    expect(trialVerdictTone(keep)).toBe("ready");
    expect(trialVerdictLabel(revert)).toBe("Hurt — reverted");
    expect(trialVerdictTone(revert)).toBe("danger");
    expect(trialVerdictLabel(noChange)).toBe("No measurable change");
    expect(trialVerdictTone(noChange)).toBe("info");
  });
  it("explains inconclusive reasons", () => {
    expect(trialReasonText("within-noise")).toMatch(/noise/);
    expect(trialReasonText("invalid-trial")).toMatch(/invalid/);
  });
});
