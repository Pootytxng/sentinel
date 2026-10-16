import { afterAll, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../types";
import i18n from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { monitorVerdict } from "./monitor-v2-data";

// The Monitor verdict headline across every pairing of a measured / unmeasured average and 1% low
// (#602, #645). The specific wording of each unknown case is pinned in the two
// monitor-verdict-unknown-*.test.ts files; this file pins the PROPERTY that holds for all of them
// — the only numbers a headline may state are the measurements that were actually taken — and
// that today's measured wording survives unchanged in both shipped locales.

const session = (over: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    started_at: "2026-07-03T00:00:00Z",
    duration_secs: 600,
    process_name: "valorant.exe",
    samples: 600,
    avg_fps: 240,
    avg_frametime_ms: 4.17,
    low1_fps_est: 200,
    peak_gpu_temp_c: null,
    peak_gpu_usage_pct: null,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    ...over,
  }) as SessionSummary;

const UNKNOWN: unknown[] = [
  0,
  -0,
  undefined,
  null,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  "240",
  "150",
];
const AVERAGES: unknown[] = [240, 59.6, ...UNKNOWN];
const LOWS: unknown[] = [200, 150, 100, 41.4, ...UNKNOWN];

const measured = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Every reading a headline states. "1%" names the metric, it is not a reading. */
const readings = (headline: string) =>
  (headline.replace(/1%/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

const label = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));

describe("monitorVerdict — a headline states only measured numbers (#602, #645)", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  for (const lng of ["en", "zh-CN"] as const) {
    it(`${lng}: every average × 1% low pairing`, async () => {
      await i18n.changeLanguage(lng);
      for (const avg of AVERAGES) {
        for (const low of LOWS) {
          const { headline } = monitorVerdict(
            [session({ avg_fps: avg as number, low1_fps_est: low as number })],
            i18n.t,
          );
          const where = `${lng} avg=${label(avg)} low=${label(low)} → "${headline}"`;
          const allowed = [avg, low].filter(measured).map(Math.round);

          expect(headline, where).not.toMatch(/NaN|Infinity|undefined|null|monitor\.monitorV2/);
          expect(headline.trim().length, where).toBeGreaterThan(0);
          for (const n of readings(headline)) expect(allowed, where).toContain(n);
          // A measured average is always stated; with no average, a measured low is. (A smooth
          // grade states only the average — today's wording — so a low may go unstated there.)
          if (measured(avg)) expect(readings(headline), where).toContain(Math.round(avg));
          else if (measured(low)) expect(readings(headline), where).toContain(Math.round(low));
        }
      }
    });
  }
});

describe("monitorVerdict — measured sessions keep today's wording", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("en", async () => {
    await i18n.changeLanguage("en");
    const headline = (low: number) => monitorVerdict([session({ low1_fps_est: low })], i18n.t).headline;
    expect(headline(200)).toBe("Last session ran smooth — valorant at 240 fps average.");
    expect(headline(150)).toBe(
      "Last session had some dips — valorant's 1% lows fell to 150 fps against a 240 fps average.",
    );
    expect(headline(100)).toBe(
      "Last session ran rough — valorant's 1% lows fell to 100 fps against a 240 fps average.",
    );
  });

  it("zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    const headline = (low: number) => monitorVerdict([session({ low1_fps_est: low })], i18n.t).headline;
    expect(headline(200)).toBe("上一局很流畅——valorant平均 240 fps。");
    expect(headline(150)).toBe(
      "上一局偶有掉帧——valorant的 1% 最低帧降到了 150 fps,平均帧率为 240 fps。",
    );
    expect(headline(100)).toBe(
      "上一局明显卡顿——valorant的 1% 最低帧降到了 100 fps,平均帧率为 240 fps。",
    );
  });
});
