import { describe, it, expect, vi } from "vitest";
import type { TFunction } from "i18next";
import type { SessionSummary } from "../types";

// monitor-v2-data imports ./Play (a .tsx surface) which imports the Tauri core at module load.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { monitorVerdict } from "./monitor-v2-data";

// Key-echo TFunction stub: pins the i18n KEY + interpolation args, never English copy.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts === undefined ? key : `${key} ${JSON.stringify(opts)}`) as unknown as TFunction;
const T = (key: string, opts?: Record<string, unknown>) =>
  opts === undefined ? key : `${key} ${JSON.stringify(opts)}`;
const K = "monitor.monitorV2.verdict.";

const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  started_at: "2026-09-01T12:00:00Z",
  duration_secs: 125,
  process_name: "valorant.exe",
  samples: 125,
  avg_fps: 240,
  avg_frametime_ms: 4.17,
  low1_fps_est: 190, // ratio ~0.79 → Smooth
  peak_gpu_temp_c: null,
  peak_gpu_usage_pct: null,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 0,
  ...over,
});

describe("monitorVerdict", () => {
  it("empty list → honest nothing-measured line with sub", () => {
    expect(monitorVerdict([], t)).toEqual({
      headline: T(`${K}noSessionsHeadline`),
      sub: T(`${K}noSessionsSub`),
    });
  });

  it("single smooth session → smoothHeadline with prettified game + rounded avg fps", () => {
    const r = monitorVerdict([session({ avg_fps: 239.6 })], t);
    expect(r.headline).toBe(T(`${K}smoothHeadline`, { game: "valorant", fps: 240 }));
    expect(r.sub).toBe(T(`${K}sub`, { duration: "2m 5s", samples: (125).toLocaleString() }));
  });

  it("ratio in [0.5, 0.7) → someDipsHeadline carries the rounded lows as evidence", () => {
    const r = monitorVerdict([session({ low1_fps_est: 149.6 })], t);
    expect(r.headline).toBe(T(`${K}someDipsHeadline`, { game: "valorant", low: 150, fps: 240 }));
  });

  it("ratio below 0.5 → roughHeadline", () => {
    const r = monitorVerdict([session({ low1_fps_est: 100 })], t);
    expect(r.headline).toBe(T(`${K}roughHeadline`, { game: "valorant", low: 100, fps: 240 }));
  });

  it("boundary: ratio exactly 0.7 is Smooth, exactly 0.5 is Some dips", () => {
    expect(monitorVerdict([session({ avg_fps: 100, low1_fps_est: 70 })], t).headline).toBe(
      T(`${K}smoothHeadline`, { game: "valorant", fps: 100 }),
    );
    expect(monitorVerdict([session({ avg_fps: 100, low1_fps_est: 50 })], t).headline).toBe(
      T(`${K}someDipsHeadline`, { game: "valorant", low: 50, fps: 100 }),
    );
  });

  it("many sessions → grades sessions[0] only (the latest), ignoring the rest", () => {
    const r = monitorVerdict(
      [
        session({ process_name: "Palworld-Win64-Shipping.exe", avg_fps: 90, low1_fps_est: 30, duration_secs: 3725, samples: 3725 }),
        session({ process_name: "valorant.exe" }),
        session({ process_name: "csgo.exe" }),
      ],
      t,
    );
    expect(r.headline).toBe(T(`${K}roughHeadline`, { game: "Palworld", low: 30, fps: 90 }));
    expect(r.sub).toBe(T(`${K}sub`, { duration: "1h 2m", samples: (3725).toLocaleString() }));
  });

  it("empty/blank process name falls back to the translated generic game label (never invented)", () => {
    const r = monitorVerdict([session({ process_name: "" })], t);
    expect(r.headline).toBe(T(`${K}smoothHeadline`, { game: T(`${K}lastGameFallback`), fps: 240 }));
  });

  it("keeps game-name casing as-is and strips .exe case-insensitively", () => {
    const r = monitorVerdict([session({ process_name: "DOOMEternal.EXE" })], t);
    expect(r.headline).toBe(T(`${K}smoothHeadline`, { game: "DOOMEternal", fps: 240 }));
  });

  it("session result always carries a sub (live-estimate framing present)", () => {
    const r = monitorVerdict([session({ duration_secs: 59, samples: 59 })], t);
    expect(r.sub).toBe(T(`${K}sub`, { duration: "0m 59s", samples: (59).toLocaleString() }));
  });
});
