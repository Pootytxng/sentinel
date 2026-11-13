// P4-noise-sf: the bench's measured-band line names the bands the picked goal was judged on, says a
// band at the 3% minimum is that minimum (not a measured swing), and names sessions left out because
// their frame-cap state can't be read.
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en/lab.json";
import zh from "../i18n/locales/zh-CN/lab.json";
import { measuredBandsLine } from "./ExperimentBench";

const t = ((key: string, opts?: Record<string, unknown>) => `${key} ${JSON.stringify(opts ?? {})}`) as never;
const WIDE = { low1_band_pct: 23, avg_band_pct: 18, low1_step_pct: 9.2, avg_step_pct: 7.2, sessions: 9, cap: { state: "uncapped" as const } };

describe("measuredBandsLine", () => {
  it("Recommended names both bands; a wide band is never called the minimum", () => {
    const line = measuredBandsLine(WIDE, "recommended", "ROB RUN.exe", t);
    expect(line).toContain("lab.experimentBench.noiseMeasuredBands ");
    expect(line).toContain('"low":"23"');
    expect(line).toContain('"avg":"18"');
    expect(line).toContain("noiseMeasuredSource");
    expect(line).not.toContain("noiseMeasuredFloor");
    expect(line).not.toContain("noiseMeasuredCapUnread");
  });

  it("Maximum FPS names the one wider band; Smoothest names the 1% low beside its pacing band", () => {
    expect(measuredBandsLine(WIDE, "max-fps", "ROB RUN.exe", t)).toContain('noiseMeasuredBandsMaxFps {"band":"23"}');
    const smooth = measuredBandsLine(WIDE, "smoothest", "ROB RUN.exe", t);
    expect(smooth).toContain('noiseMeasuredBandsSmoothest {"low":"23"}');
    expect(smooth).not.toContain('"avg"');
  });

  it("under a shared cap only the 1% low judged; the other goals weren't judged", () => {
    const capped = { ...WIDE, cap: { state: "capped" as const, at_fps: 240 } };
    expect(measuredBandsLine(capped, null, "ROB RUN.exe", t)).toContain("noiseMeasuredBandsCapped");
    expect(measuredBandsLine(capped, "max-fps", "ROB RUN.exe", t)).toContain("noiseMeasuredCappedUnjudged");
  });

  it("a band at the 3% minimum is said to be the minimum, not how much the game moved", () => {
    const quiet = { ...WIDE, low1_band_pct: 3, avg_band_pct: 3 };
    expect(measuredBandsLine(quiet, "recommended", "cs2.exe", t)).toContain("noiseMeasuredFloor");
    // Only the bands the goal was judged on count: a floored average doesn't floor a 1%-low-only line.
    const lowWide = { ...WIDE, avg_band_pct: 3, cap: { state: "capped" as const, at_fps: 240 } };
    expect(measuredBandsLine(lowWide, "recommended", "cs2.exe", t)).not.toContain("noiseMeasuredFloor");
  });

  it("names how many sessions were left out for an unreadable cap state", () => {
    expect(measuredBandsLine({ ...WIDE, cap_unread: 2 }, "recommended", "ROB RUN.exe", t)).toContain(
      'noiseMeasuredCapUnread {"game":"ROB RUN","count":2}',
    );
  });

  it("every line exists in English and Simplified Chinese", () => {
    const enBench = (en as unknown as { experimentBench: Record<string, string> }).experimentBench;
    const zhBench = (zh as unknown as { experimentBench: Record<string, string> }).experimentBench;
    for (const key of [
      "noiseMeasuredBands",
      "noiseMeasuredBandsCapped",
      "noiseMeasuredBandsMaxFps",
      "noiseMeasuredBandsSmoothest",
      "noiseMeasuredCappedUnjudged",
      "noiseMeasuredSource",
      "noiseMeasuredFloor",
      "noiseMeasuredCapUnread",
    ]) {
      expect(enBench[key], key).toBeTruthy();
      expect(zhBench[key], key).toBeTruthy();
      expect(zhBench[key]).not.toBe(enBench[key]);
    }
  });
});
