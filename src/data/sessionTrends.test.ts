import { describe, it, expect } from "vitest";
import { computeSessionTrends } from "./sessionTrends";
import type { SessionSummary } from "../types";

function s(game: string, avg: number, when = "2026-06-01T00:00:00Z"): SessionSummary {
  return {
    started_at: when,
    duration_secs: 600,
    process_name: game,
    samples: 10,
    avg_fps: avg,
    avg_frametime_ms: 1000 / avg,
    low1_fps_est: avg * 0.8,
    peak_gpu_temp_c: 70,
    peak_gpu_usage_pct: 95,
    peak_ram_used_bytes: 8e9,
    ram_total_bytes: 32e9,
    compy_changes_active: 0,
    hw_fingerprint: null,
    stutter_insight: null,
    stutter_timeline: [],
    stutter_events: [],
  } as unknown as SessionSummary;
}

describe("computeSessionTrends", () => {
  it("empty history → zeros, no fabricated trend", () => {
    const t = computeSessionTrends([]);
    expect(t.total).toBe(0);
    expect(t.games).toEqual([]);
    expect(t.overallBestFps).toBe(0);
    expect(t.trend).toBeNull();
  });

  it("groups per game, keeps the best avg and the most-recent (first) avg", () => {
    // newest-first
    const t = computeSessionTrends([s("game.exe", 150), s("game.exe", 120), s("other.exe", 90)]);
    const g = t.games.find((x) => x.game === "game")!;
    expect(g.sessions).toBe(2);
    expect(g.bestAvgFps).toBe(150);
    expect(g.lastAvgFps).toBe(150); // newest-first → first seen is most recent
    expect(t.overallBestFps).toBe(150);
    expect(t.games[0].game).toBe("game"); // sorted by session count desc
  });

  it("ignores sessions with no detected game for per-game, still counts total", () => {
    const t = computeSessionTrends([s("", 100), s("game.exe", 120)]);
    expect(t.total).toBe(2);
    expect(t.games).toHaveLength(1);
  });

  it("flags an upward trend when the recent half is clearly higher", () => {
    // newest-first: recent half high, earlier half low
    const t = computeSessionTrends([s("g.exe", 160), s("g.exe", 158), s("g.exe", 120), s("g.exe", 118)]);
    expect(t.trend).toBe("up");
  });

  it("calls it flat when the move is within noise (never a fabricated arrow)", () => {
    const t = computeSessionTrends([s("g.exe", 121), s("g.exe", 120), s("g.exe", 120), s("g.exe", 119)]);
    expect(t.trend).toBe("flat");
  });

  it("needs ≥4 sessions to claim a trend at all", () => {
    expect(computeSessionTrends([s("g.exe", 160), s("g.exe", 100)]).trend).toBeNull();
  });

  it("game rows carry the pretty name, never the raw shipping binary (bug→guard 2026-07-17)", () => {
    // Self-review caught "Palworld-Win64-Shipping" in .strends-game-name while every neighboring
    // surface showed "Palworld" — the local prettifier only stripped ".exe". Rows must group AND
    // display via prettyGameName; the two binaries of one game aggregate as one row.
    const t = computeSessionTrends([
      s("Palworld-Win64-Shipping.exe", 140),
      s("Palworld.exe", 120),
    ]);
    expect(t.games).toHaveLength(1);
    expect(t.games[0].game).toBe("Palworld");
    expect(t.games[0].sessions).toBe(2);
    expect(t.games[0].bestAvgFps).toBe(140);
  });
});
