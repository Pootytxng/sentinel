// P4-noise-sf: the bench's measured-band line names the bands the picked goal was judged on, says a
// band at the 3% minimum is that minimum (not a measured swing), and names sessions left out because
// their frame-cap state can't be read.
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en/lab.json";
import zh from "../i18n/locales/zh-CN/lab.json";
import { fallPct, measuredBandsLine, notComparableNote } from "./ExperimentBench";

const t = ((key: string, opts?: Record<string, unknown>) => `${key} ${JSON.stringify(opts ?? {})}`) as never;
const WIDE = { model: 3, low1_band_pct: 23, avg_band_pct: 18, low1_step_pct: 9.2, avg_step_pct: 7.2, sessions: 9, cap: { state: "uncapped" as const } };

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
    expect(measuredBandsLine(WIDE, "max-fps", "ROB RUN.exe", t)).toContain('noiseMeasuredBandsMaxFps {"band":"23","bandFall":"18.6"}');
    const smooth = measuredBandsLine(WIDE, "smoothest", "ROB RUN.exe", t);
    expect(smooth).toContain('noiseMeasuredBandsSmoothest {"low":"23","lowFall":"18.6"}');
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

  it("says the typical move and the band apart, a band from few sessions is wide for that, and what Compy can't read", () => {
    const line = measuredBandsLine(WIDE, "recommended", "ROB RUN.exe", t);
    expect(line).toContain('"lowStep":"9.2"');
    expect(line).toContain('"avgStep":"7.2"');
    expect(line).not.toContain("noiseMeasuredFewSessions");
    // Opus r1: what Compy can't read is said once under the list, not in every row's line.
    expect(line).not.toContain("noiseMeasuredCantRead");
    const three = measuredBandsLine({ ...WIDE, sessions: 3, low1_band_pct: 58 }, "recommended", "ROB RUN.exe", t);
    expect(three).toContain('noiseMeasuredFewSessions {"sessions":3}');
    // Every named band at the 3% minimum: the "wide because few sessions" line would contradict it.
    const floored = measuredBandsLine({ ...WIDE, sessions: 3, low1_band_pct: 3, avg_band_pct: 3 }, "recommended", "cs2.exe", t);
    expect(floored).not.toContain("noiseMeasuredFewSessions");
  });

  it("says the fall each band matches, as the backend judges it", () => {
    expect([fallPct(25), fallPct(23), fallPct(3), fallPct(3.05)]).toEqual([20, 18.6, 3, 3]);
    expect(measuredBandsLine(WIDE, "recommended", "ROB RUN.exe", t)).toContain('"lowFall":"18.6"');
    // Opus r2: a verdict judged under an older noise model was judged on the same band both ways.
    expect(measuredBandsLine({ ...WIDE, model: 2 }, "recommended", "ROB RUN.exe", t)).toContain(
      'noiseMeasuredBandsSameBothWays {"low":"23","avg":"18"}',
    );
    expect(measuredBandsLine({ ...WIDE, model: 2 }, "max-fps", "ROB RUN.exe", t)).toContain('"band":"23","bandFall":"23"');
  });

  it("a Trial not judged for the gap between its sessions says so in the user's language", () => {
    const x = { stop_reason: "gap-past-band", verdict_note: "English from the backend", game_noise: { ...WIDE, max_gap_mins: 446 } };
    expect(notComparableNote(x, t)).toContain('lab.experimentBench.gapPastBand {"max":"7.4"}');
    expect(notComparableNote({ ...x, stop_reason: "frame-cap-changed" }, t)).toBe("English from the backend");
    expect(notComparableNote({ ...x, game_noise: { ...WIDE } }, t)).toBe("English from the backend");
  });

  it("every line exists in English and Simplified Chinese", () => {
    const enBench = (en as unknown as { experimentBench: Record<string, string> }).experimentBench;
    const zhBench = (zh as unknown as { experimentBench: Record<string, string> }).experimentBench;
    for (const key of [
      "noiseMeasuredBands",
      "noiseMeasuredBandsCapped",
      "noiseMeasuredBandsSameBothWays",
      "noiseMeasuredBandsMaxFps",
      "noiseMeasuredBandsSmoothest",
      "noiseMeasuredCappedUnjudged",
      "noiseMeasuredSource",
      "noiseMeasuredFloor",
      "noiseMeasuredCapUnread_other",
      "gapPastBand",
      "noiseMeasuredFewSessions",
      "noiseMeasuredCantRead",
    ]) {
      expect(enBench[key], key).toBeTruthy();
      expect(zhBench[key], key).toBeTruthy();
      expect(zhBench[key]).not.toBe(enBench[key]);
    }
  });
});
