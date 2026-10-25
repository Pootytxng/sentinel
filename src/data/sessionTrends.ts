// Compy Pro — long-term session trends (pure). Aggregates the retained session history (up to 100,
// raised from the free view's most-recent 20) into per-game bests + an overall trend direction. Read-only
// over the data `get_session_summaries` already returns (newest-first). No new IPC, no OS call.

import type { SessionSummary } from "../types";
import { prettyGameName } from "../surfaces/game-name";
import { allBackground } from "../lib/session-metrics";

export type GameTrend = {
  game: string; // pretty name (no .exe)
  sessions: number;
  bestAvgFps: number;
  lastAvgFps: number; // the most recent session's avg for this game
};

export type SessionTrendsData = {
  total: number;
  games: GameTrend[];
  overallBestFps: number;
  /** recent-half vs earlier-half average of avg_fps; null when too few sessions to compare honestly. */
  trend: "up" | "down" | "flat" | null;
};

// Display grouping key = the pretty name (prettyGameName also strips Unreal/GDK
// "-Win64-Shipping" wrappers, so the same game's binaries aggregate as one row).

export function computeSessionTrends(all: SessionSummary[]): SessionTrendsData {
  // P4-show-f1: a session behind another window the whole time has no frame rate to trend.
  const sessions = all.filter((s) => !allBackground(s));
  const total = sessions.length;
  // Per game (sessions are newest-first, so the first one seen per game is the most recent).
  const byGame = new Map<string, GameTrend>();
  for (const s of sessions) {
    if ((s.process_name || "").trim() === "") continue;
    const g = prettyGameName(s.process_name) || "Unknown";
    const cur = byGame.get(g);
    if (!cur) {
      byGame.set(g, { game: g, sessions: 1, bestAvgFps: s.avg_fps, lastAvgFps: s.avg_fps });
    } else {
      cur.sessions += 1;
      cur.bestAvgFps = Math.max(cur.bestAvgFps, s.avg_fps);
      // lastAvgFps keeps the newest (first-seen) value.
    }
  }
  const games = [...byGame.values()].sort(
    (a, b) => b.sessions - a.sessions || b.bestAvgFps - a.bestAvgFps,
  );
  const overallBestFps = sessions.reduce((m, s) => Math.max(m, s.avg_fps), 0);

  // Trend: compare the recent half vs the earlier half (need ≥4 sessions to be meaningful, and a
  // ≥3%/≥2fps move to count as up/down rather than noise — honest, not a fabricated arrow).
  let trend: SessionTrendsData["trend"] = null;
  if (total >= 4) {
    const half = Math.floor(total / 2);
    const avg = (arr: SessionSummary[]) => arr.reduce((a, s) => a + s.avg_fps, 0) / arr.length;
    const recent = avg(sessions.slice(0, half));
    const earlier = avg(sessions.slice(total - half));
    const delta = recent - earlier;
    trend = Math.abs(delta) < Math.max(2, earlier * 0.03) ? "flat" : delta > 0 ? "up" : "down";
  }
  return { total, games, overallBestFps, trend };
}
