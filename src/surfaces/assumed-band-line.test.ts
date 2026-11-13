// P4-judge-noisy (e): a Trial verdict judged on the assumed ±3% band, before Compy measured each
// game's own noise, is labelled — never rewritten — with that game's noise as measured now.
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en/lab.json";
import zh from "../i18n/locales/zh-CN/lab.json";
import { assumedBandLine } from "./ExperimentBench";

const t = ((key: string, opts?: Record<string, unknown>) => `${key} ${JSON.stringify(opts ?? {})}`) as never;

describe("assumedBandLine", () => {
  it("names the assumed band and the game's wider measured noise", () => {
    const line = assumedBandLine({ assumed_pct: 3, measured_low1_pct: 20.6, measured_sessions: 9, claimed_change: true }, "ROB RUN.exe", t);
    expect(line).toContain("lab.experimentBench.assumedBandWider ");
    expect(line).toContain('"assumed":"3"');
    expect(line).toContain('"measured":"20.6"');
    expect(line).toContain('"sessions":9');
  });

  it("a 'no change' judged on the narrower assumed band is not said to have over-claimed", () => {
    const line = assumedBandLine({ assumed_pct: 3, measured_low1_pct: 20.6, measured_sessions: 9, claimed_change: false }, "ROB RUN.exe", t);
    expect(line).toContain("lab.experimentBench.assumedBandWiderNoClaim");
  });

  it("says so when the game's noise still isn't measured, never filling a number in", () => {
    const line = assumedBandLine({ assumed_pct: 3, measured_low1_pct: null, measured_sessions: null }, "ROB RUN.exe", t);
    expect(line).toContain("lab.experimentBench.assumedBandUnmeasured");
    expect(line).not.toContain("measured\":");
  });

  it("a narrower measured noise is said as narrower", () => {
    const line = assumedBandLine({ assumed_pct: 3, measured_low1_pct: 3, measured_sessions: 8 }, "cs2.exe", t);
    expect(line).toContain("lab.experimentBench.assumedBandNarrower");
  });

  it("every new line exists in English and Simplified Chinese", () => {
    for (const key of ["noiseMeasuredBands", "assumedBandUnmeasured", "assumedBandWider", "assumedBandWiderNoClaim", "assumedBandNarrower"]) {
      const enBench = (en as unknown as { experimentBench: Record<string, string> }).experimentBench;
      const zhBench = (zh as unknown as { experimentBench: Record<string, string> }).experimentBench;
      expect(enBench[key], key).toBeTruthy();
      expect(zhBench[key], key).toBeTruthy();
      expect(zhBench[key]).not.toBe(enBench[key]);
    }
  });
});
