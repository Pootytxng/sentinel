import type { SessionSummary } from "../types";
import { computeSessionTrends } from "../data/sessionTrends";
import { ProGate } from "./ProGate";
import "./SessionTrends.css";

// Compy Pro — long-term history & trends over the full retained session set (the free list above shows
// the most recent 20). ProGate-wrapped: inert (shown free) while licensing is disarmed; gated when armed
// + not Pro. Read-only over data `get_session_summaries` already returns — no new IPC, no fabrication
// (no trend arrow until ≥4 sessions, and only when the move clears the noise floor).
export function SessionTrends({ sessions }: { sessions: SessionSummary[] }) {
  const t = computeSessionTrends(sessions);
  if (t.total < 2) return null; // nothing to trend yet
  const arrow =
    t.trend === "up" ? "▲ trending up" : t.trend === "down" ? "▼ trending down" : t.trend === "flat" ? "→ steady" : "";
  return (
    <ProGate feature="Long-term history & trends">
      <section className="strends">
        <header className="strends-head">
          <span className="strends-title">History &amp; trends</span>
          <span className="strends-sub">
            {t.total} sessions kept
            {arrow ? ` · ${arrow}` : ""}
            {t.overallBestFps > 0 ? ` · best ${t.overallBestFps.toFixed(0)} fps` : ""}
          </span>
        </header>
        <ul className="strends-games">
          {t.games.slice(0, 6).map((g) => (
            <li key={g.game} className="strends-game">
              <span className="strends-game-name">{g.game}</span>
              <span className="strends-game-stat">
                {g.sessions} session{g.sessions === 1 ? "" : "s"} · best {g.bestAvgFps.toFixed(0)} fps
              </span>
            </li>
          ))}
        </ul>
      </section>
    </ProGate>
  );
}
