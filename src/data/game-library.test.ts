import { describe, it, expect } from "vitest";
import type { SessionSummary } from "../types";
import { gameLibrary, playTime } from "./game-library";

const session = (over: Partial<SessionSummary>): SessionSummary =>
  ({
    started_at: "2026-10-20T20:00:00Z",
    duration_secs: 3600,
    process_name: "game.exe",
    samples: 3500,
    avg_fps: 120,
    avg_frametime_ms: 8.3,
    low1_fps_est: 90,
    peak_gpu_temp_c: null,
    peak_gpu_usage_pct: null,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: null,
    ...over,
  }) as SessionSummary;

describe("gameLibrary — a game is what Compy measured (glass redesign)", () => {
  it("groups sessions by process, case-insensitively, newest session first", () => {
    const games = gameLibrary([
      session({ process_name: "EldenRing.exe", started_at: "2026-10-20T20:00:00Z", avg_fps: 130 }),
      session({ process_name: "eldenring.exe", started_at: "2026-10-28T20:00:00Z", avg_fps: 141 }),
    ]);
    expect(games).toHaveLength(1);
    expect(games[0].sessions.map((s) => s.avg_fps)).toEqual([141, 130]);
    expect(games[0].lastAvg).toBe(141);
    expect(games[0].bestAvg).toBe(141);
    expect(games[0].totalSecs).toBe(7200);
  });

  it("orders games by when they were last played", () => {
    const games = gameLibrary([
      session({ process_name: "old.exe", started_at: "2026-10-01T20:00:00Z" }),
      session({ process_name: "new.exe", started_at: "2026-10-29T20:00:00Z" }),
    ]);
    expect(games.map((g) => g.key)).toEqual(["new.exe", "old.exe"]);
  });

  it("keeps an unmeasured reading unknown — never a zero on screen", () => {
    const [g] = gameLibrary([session({ avg_fps: 0, low1_fps_est: 0 })]);
    expect(g.lastAvg).toBeNull();
    expect(g.lastLow).toBeNull();
    expect(g.bestAvg).toBeNull();
  });

  it("leaves out a session that was behind another window the whole time, and nameless ones", () => {
    const games = gameLibrary([
      session({ process_name: "bg.exe", samples: 0, background_secs_excluded: 900 } as Partial<SessionSummary>),
      session({ process_name: "   " }),
      session({ process_name: "real.exe" }),
    ]);
    expect(games.map((g) => g.key)).toEqual(["real.exe"]);
  });

  it("splits play time into hours and minutes", () => {
    expect(playTime(7500)).toEqual({ h: 2, m: 5 });
    expect(playTime(59)).toEqual({ h: 0, m: 1 });
    expect(playTime(-5)).toEqual({ h: 0, m: 0 });
  });
});
