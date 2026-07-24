import { useTranslation } from "react-i18next";
import type { SessionSummary } from "../types";
import { computeSessionTrends } from "../data/sessionTrends";
import { ProGate } from "./ProGate";
import "../i18n";
import "./SessionTrends.css";

// Compy Pro — long-term history & trends over the full retained session set (the free list above shows
// the most recent 20). ProGate-wrapped: inert (shown free) while licensing is disarmed; gated when armed
// + not Pro. Read-only over data `get_session_summaries` already returns — no new IPC, no fabrication
// (no trend arrow until ≥4 sessions, and only when the move clears the noise floor).
// hideCount (additive — absent = classic byte-identical): the V2 Monitor room's measured line
// already states the sessions-on-record count, so under v2 this header keeps only what it alone
// carries (trend + best) — one screen never states the same fact twice (V2-9 punch j).
export function SessionTrends({
  sessions,
  hideCount = false,
}: {
  sessions: SessionSummary[];
  hideCount?: boolean;
}) {
  const { t: translate } = useTranslation();
  const trends = computeSessionTrends(sessions);
  if (trends.total < 2) return null; // nothing to trend yet
  const arrow =
    trends.trend === "up"
      ? translate("monitor.sessionTrends.trendUp")
      : trends.trend === "down"
        ? translate("monitor.sessionTrends.trendDown")
        : trends.trend === "flat"
          ? translate("monitor.sessionTrends.trendFlat")
          : "";
  const subParts = [
    ...(hideCount ? [] : [translate("monitor.sessionTrends.sessionsKept", { count: trends.total })]),
    ...(arrow ? [arrow] : []),
    ...(trends.overallBestFps > 0
      ? [translate("monitor.sessionTrends.bestFps", { fps: trends.overallBestFps.toFixed(0) })]
      : []),
  ];
  return (
    <ProGate feature={translate("monitor.sessionTrends.proGateFeature")}>
      <section className="strends">
        <header className="strends-head">
          <span className="strends-title">{translate("monitor.sessionTrends.historyAndTrends")}</span>
          <span className="strends-sub">{subParts.join(" · ")}</span>
        </header>
        <ul className="strends-games">
          {trends.games.slice(0, 6).map((g) => (
            <li key={g.game} className="strends-game">
              <span className="strends-game-name">{g.game}</span>
              <span className="strends-game-stat">
                {translate("monitor.sessionTrends.gameStat", {
                  count: g.sessions,
                  fps: g.bestAvgFps.toFixed(0),
                })}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </ProGate>
  );
}
