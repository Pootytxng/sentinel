// The Games room's library (glass redesign, owner decision 2026-10-30). There is no games command:
// a "game" here is exactly what Compy has measured, the retained sessions grouped by their process.
// Pure, read-only over `get_session_summaries`. No new IPC, no guessing: a value the sampler could
// not measure stays null (knownFps), and a session that was behind another window the whole time
// (allBackground) is left out because it has no frame rate to show.

import type { SessionSummary } from "../types";
import { prettyGameName } from "../surfaces/game-name";
import { allBackground, knownFps } from "../lib/session-metrics";

export type GameEntry = {
  /** Stable grouping key: the process name, lower-cased. */
  key: string;
  /** Display name (no .exe). */
  name: string;
  /** Measured sessions for this game, newest first. */
  sessions: SessionSummary[];
  /** ISO timestamp of the newest session. */
  lastPlayed: string;
  /** Total measured play time across the retained sessions. */
  totalSecs: number;
  /** The newest session's average FPS, when it was measured. */
  lastAvg: number | null;
  /** The newest session's 1% low, when it was measured. */
  lastLow: number | null;
  /** The best measured session average, when any was measured. */
  bestAvg: number | null;
};

const ts = (s: SessionSummary) => {
  const t = Date.parse(s.started_at);
  return Number.isFinite(t) ? t : 0;
};

export function gameLibrary(all: SessionSummary[]): GameEntry[] {
  const byKey = new Map<string, SessionSummary[]>();
  for (const s of all) {
    const proc = (s.process_name || "").trim();
    if (proc === "" || allBackground(s)) continue;
    const key = proc.toLowerCase();
    const list = byKey.get(key);
    if (list) list.push(s);
    else byKey.set(key, [s]);
  }
  const games: GameEntry[] = [];
  for (const [key, list] of byKey) {
    const sessions = [...list].sort((a, b) => ts(b) - ts(a));
    const newest = sessions[0];
    const avgs = sessions.map((s) => knownFps(s.avg_fps)).filter((v): v is number => v != null);
    games.push({
      key,
      name: prettyGameName(newest.process_name) || newest.process_name,
      sessions,
      lastPlayed: newest.started_at,
      totalSecs: sessions.reduce((sum, s) => sum + (Number.isFinite(s.duration_secs) ? Math.max(0, s.duration_secs) : 0), 0),
      lastAvg: knownFps(newest.avg_fps),
      lastLow: knownFps(newest.low1_fps_est),
      bestAvg: avgs.length ? Math.max(...avgs) : null,
    });
  }
  return games.sort((a, b) => ts(b.sessions[0]) - ts(a.sessions[0]));
}

/** "2 h 05 m" / "47 m" — play time in plain units. */
export function playTime(secs: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(secs / 60));
  return { h: Math.floor(total / 60), m: total % 60 };
}
