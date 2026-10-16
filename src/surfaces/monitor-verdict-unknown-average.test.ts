import { afterAll, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../types";
import i18n from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { monitorVerdict } from "./monitor-v2-data";

// bug→guard for #645: monitorVerdict rendered an unmeasured session average as a number —
// `{ avg_fps: 0, low1_fps_est: 0 }` read "Last session averaged 0 fps …". #607 fixed the same
// breach for the 1% low; this is the average, one field over. Honest-measurement law: an
// unavailable value stays unknown, never fabricated, so no headline may state an average that is
// not a finite number above zero.

const session = (over: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    started_at: "2026-07-03T00:00:00Z",
    duration_secs: 600,
    process_name: "valorant.exe",
    samples: 600,
    avg_fps: 240,
    avg_frametime_ms: 4.17,
    low1_fps_est: 150,
    peak_gpu_temp_c: null,
    peak_gpu_usage_pct: null,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    ...over,
  }) as SessionSummary;

const unknownAverages: Array<[string, unknown]> = [
  ["zero (sampler's unknown value)", 0],
  ["missing", undefined],
  ["null", null],
  ["negative", -1],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["a numeric string", "240"],
];

const verdictFor = (avg: unknown, low: unknown) =>
  monitorVerdict(
    [session({ avg_fps: avg as number, low1_fps_est: low as number })],
    i18n.t,
  ).headline;

describe("monitorVerdict — an unmeasured average stays unknown (#645)", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it.each(unknownAverages)(
    "en: %s average with a measured 1% low states only the low",
    async (_label, avg) => {
      await i18n.changeLanguage("en");
      const headline = verdictFor(avg, 150);
      expect(headline).toBe(
        "Last session's 1% lows were 150 fps in valorant — the average wasn't measured.",
      );
      // The numeric-string case carries "240"; it is not a measurement, so it must not surface.
      expect(headline).not.toContain("240");
    },
  );

  it.each(unknownAverages)(
    "en: %s average with an unmeasured 1% low states no number at all",
    async (_label, avg) => {
      await i18n.changeLanguage("en");
      const headline = verdictFor(avg, 0);
      expect(headline).toBe("Last session's frame rate in valorant wasn't measured.");
      expect(headline).not.toMatch(/\d|NaN|Infinity/);
    },
  );

  it.each(unknownAverages)(
    "zh-CN: %s average with a measured 1% low states only the low",
    async (_label, avg) => {
      await i18n.changeLanguage("zh-CN");
      const headline = verdictFor(avg, 150);
      expect(headline).toBe("上一局valorant的 1% 最低帧为 150 fps——未测到平均帧率。");
      expect(headline).not.toContain("240");
    },
  );

  it.each(unknownAverages)(
    "zh-CN: %s average with an unmeasured 1% low states no number at all",
    async (_label, avg) => {
      await i18n.changeLanguage("zh-CN");
      const headline = verdictFor(avg, 0);
      expect(headline).toBe("上一局valorant未测到帧率。");
      expect(headline).not.toMatch(/\d|NaN|Infinity/);
    },
  );

  it("a measured average keeps today's wording when the low is unmeasured (#607 control)", async () => {
    await i18n.changeLanguage("en");
    expect(verdictFor(240, 0)).toBe(
      "Last session averaged 240 fps in valorant — 1% lows weren't measured.",
    );
  });
});
