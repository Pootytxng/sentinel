import { afterAll, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../types";
import i18n from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { monitorVerdict } from "./monitor-v2-data";

// bug→guard for #602: the sampler reports an unmeasured 1% low as 0 (or it arrives missing), and
// monitorVerdict used to render it as "1% lows fell to 0 fps". Honest-measurement law: an
// unavailable value stays unknown, never fabricated. The backend only treats low1_fps_est > 0 as
// known (blackbox.rs), and gradeLow1 already grades it "neutral" — the headline must match.

const session = (over: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    started_at: "2026-07-03T00:00:00Z",
    duration_secs: 600,
    process_name: "valorant.exe",
    samples: 600,
    avg_fps: 240,
    avg_frametime_ms: 4.17,
    low1_fps_est: 0,
    peak_gpu_temp_c: null,
    peak_gpu_usage_pct: null,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    ...over,
  }) as SessionSummary;

const unknownLows: Array<[string, Partial<SessionSummary>]> = [
  ["zero (sampler's unknown value)", { low1_fps_est: 0 }],
  ["negative", { low1_fps_est: -1 }],
  ["missing", { low1_fps_est: undefined as unknown as number }],
  ["NaN", { low1_fps_est: Number.NaN }],
  // #656: the rest of the shared knownFps contract (src/lib/session-metrics.ts).
  ["null", { low1_fps_est: null as unknown as number }],
  ["Infinity", { low1_fps_est: Number.POSITIVE_INFINITY }],
  ["-Infinity", { low1_fps_est: Number.NEGATIVE_INFINITY }],
  ["a numeric string", { low1_fps_est: "150" as unknown as number }],
];

describe("monitorVerdict — an unmeasured 1% low stays unknown (#602)", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it.each(unknownLows)("en: %s low states only the measured average", async (_label, over) => {
    await i18n.changeLanguage("en");
    const { headline } = monitorVerdict([session(over)], i18n.t);
    expect(headline).toBe(
      "Last session averaged 240 fps in valorant — 1% lows weren't measured.",
    );
    expect(headline).not.toMatch(/fell to/);
    expect(headline).not.toMatch(/\b0 fps|NaN|-1|Infinity|150/);
  });

  it.each(unknownLows)("zh-CN: %s low states only the measured average", async (_label, over) => {
    await i18n.changeLanguage("zh-CN");
    const { headline } = monitorVerdict([session(over)], i18n.t);
    expect(headline).toContain("240 fps");
    expect(headline).toContain("未测到");
    expect(headline).not.toContain("降到了");
    expect(headline).not.toMatch(/\b0 fps|NaN|-1|Infinity|150/);
  });

  it("a measured low keeps today's wording", async () => {
    await i18n.changeLanguage("en");
    expect(monitorVerdict([session({ low1_fps_est: 150 })], i18n.t).headline).toBe(
      "Last session had some dips — valorant's 1% lows fell to 150 fps against a 240 fps average.",
    );
    expect(monitorVerdict([session({ low1_fps_est: 100 })], i18n.t).headline).toBe(
      "Last session ran rough — valorant's 1% lows fell to 100 fps against a 240 fps average.",
    );
    expect(monitorVerdict([session({ low1_fps_est: 200 })], i18n.t).headline).toBe(
      "Last session ran smooth — valorant at 240 fps average.",
    );
  });
});
