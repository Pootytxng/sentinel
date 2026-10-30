// Health, the front page of the glass redesign (owner decision 2026-10-30). It answers "is my PC
// OK?" in one line, then shows how the games actually ran — every number from real readings, an
// unread check left out of the ratio, an unmeasured value said as such. The deeper console (every
// panel the Health room had) stays one click away: "Open the full health check".
//
// It never assumes something is wrong (DIR-1a): a problem card appears only when the Care observer
// found real evidence (pendingCare), and its two buttons are the same "Find out why" / "Not now"
// handlers the console's card used. This page adds no mutation path; "Run a check" is the same
// read-only FirstCheck the console opens.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { GameReadiness, PendingCareIncident, Priorities, SessionSummary } from "../../types";
import { gameLibrary } from "../../data/game-library";
import { knownFps } from "../../lib/session-metrics";
import { wordFromBand, confidenceWordKey } from "../../data/confidence-word";
import { TubeChart, type TubeBar } from "./TubeChart";
import { useDates } from "./GamesRoom";
import "../glass-rooms.css";

const Arrow = () => (
  <span className="gl-arrow" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  </span>
);

function greetingKey(now: Date): string {
  const h = now.getHours();
  return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 18 ? "afternoon" : "evening";
}

export function HomeGlass({
  readiness,
  priorities,
  sessions,
  pendingCare,
  onOpenCareIncident,
  onDismissCareIncident,
  onOpenGame,
  onOpenProblems,
  onOpenLive,
  onRunCheck,
  onSeeChecks,
  onOpenDetails,
  latestChange,
}: {
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  sessions: SessionSummary[];
  pendingCare: PendingCareIncident | null;
  onOpenCareIncident: (incidentId: string) => void;
  onDismissCareIncident: (incidentId: string) => void;
  /** Opens Games; a key opens that game's page. */
  onOpenGame: (key: string | null) => void;
  onOpenProblems: () => void;
  onOpenLive: () => void;
  onRunCheck: () => void;
  onSeeChecks: () => void;
  onOpenDetails: () => void;
  /** FirstWin's follow-through on the user's first live change (App owns it). */
  latestChange?: ReactNode;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const games = useMemo(() => gameLibrary(sessions), [sessions]);
  const [chartKey, setChartKey] = useState<string | null>(games[0]?.key ?? null);
  useEffect(() => {
    if (!games.some((g) => g.key === chartKey)) setChartKey(games[0]?.key ?? null);
  }, [games, chartKey]);

  // Same arithmetic as the console's readiness ring (P7-score): an unread check is left out.
  const readinessKnown = !!readiness && readiness.checks.length > 0;
  const unread = readinessKnown ? readiness!.unknown_count : 0;
  const readable = readinessKnown ? Math.max(0, readiness!.checks.length - unread) : 0;
  const attention = readinessKnown ? readiness!.attention_count : 0;
  const good = readinessKnown ? Math.max(0, readable - attention) : 0;
  const checksKnown = readinessKnown && readable > 0;
  const worthNames = readinessKnown
    ? readiness!.checks.filter((c) => c.status === "attention").map((c) => c.label)
    : [];

  const answer = !checksKnown
    ? t("home.glass.answer.unknown")
    : attention > 0
      ? t("home.glass.answer.worth", { count: attention })
      : t("home.glass.answer.allRight");
  const sub = checksKnown
    ? t("home.glass.sub.known", { good, total: readable })
    : t("home.glass.sub.unknown");

  const newest = sessions.find((s) => knownFps(s.avg_fps) != null) ?? null;
  const newestGame = newest ? games.find((g) => g.key === newest.process_name.trim().toLowerCase()) : undefined;
  const newestAvg = newest ? knownFps(newest.avg_fps) : null;
  const newestLow = newest ? knownFps(newest.low1_fps_est) : null;

  const topLimiter = priorities?.limiters?.[0] ?? null;

  const chartGame = games.find((g) => g.key === chartKey) ?? null;
  const bars: TubeBar[] = chartGame
    ? chartGame.sessions
        .slice(0, 10)
        .reverse()
        .map((s, i) => {
          const avg = knownFps(s.avg_fps);
          return {
            key: `${s.started_at}-${i}`,
            value: avg,
            label: dates.day(s.started_at),
            tip:
              avg == null
                ? t("common.games.tipUnmeasured", { date: dates.dayTime(s.started_at) })
                : t("common.games.tipAvg", { date: dates.dayTime(s.started_at), avg: Math.round(avg) }),
          };
        })
    : [];

  const gameCards = games.slice(0, pendingCare ? 3 : 4);

  return (
    <section className="gl-room" data-room="home" aria-labelledby="gl-home-h1">
      <header className="gl-head">
        <div className="gl-head-text">
          <p className="gl-eyebrow">{t(`home.glass.greeting.${greetingKey(new Date())}`)}</p>
          <h1 className="gl-h1" id="gl-home-h1">
            {answer}
          </h1>
          <p className="gl-sub">{sub}</p>
        </div>
        <div className="gl-actions">
          <button type="button" className="gl-ghost" onClick={onOpenProblems}>
            {t("home.glass.actions.problem")}
          </button>
          <button type="button" className="gl-cta" onClick={() => onOpenGame(null)}>
            {t("home.glass.actions.improve")}
          </button>
        </div>
      </header>

      <div className="gl-kpis">
        {pendingCare && (
          <div className="gl-kpi" data-hot="true" role="group" aria-label={t("home.glass.care.label")}>
            <span className="gl-kpi-label">{t("home.glass.care.label")}</span>
            <span className="gl-kpi-row">
              <span className="gl-kpi-value">{pendingCare.app_label ?? pendingCare.kind}</span>
              <span className="gl-chip">{pendingCare.kind}</span>
            </span>
            <span className="gl-kpi-note">{pendingCare.occurred_display}</span>
            <span className="gl-care-actions">
              <button type="button" className="gl-care-go" onClick={() => onOpenCareIncident(pendingCare.incident_id)}>
                {t("home.glass.care.find")}
              </button>
              <button type="button" className="gl-care-later" onClick={() => onDismissCareIncident(pendingCare.incident_id)}>
                {t("home.glass.care.later")}
              </button>
            </span>
          </div>
        )}
        {gameCards.map((g, i) => (
          <button
            key={g.key}
            type="button"
            className="gl-kpi"
            data-hot={!pendingCare && i === 0}
            onClick={() => onOpenGame(g.key)}
            aria-label={t("common.games.open", { name: g.name })}
          >
            <span className="gl-kpi-label">{g.name}</span>
            <Arrow />
            <span className="gl-kpi-row">
              <span className="gl-kpi-value">
                {g.lastAvg != null ? (
                  <>
                    <span className="gl-num">{Math.round(g.lastAvg)}</span>
                    <small>{t("common.games.fps")}</small>
                  </>
                ) : (
                  t("common.games.notMeasured")
                )}
              </span>
              <span className="gl-chip">{t("common.games.sessions", { count: g.sessions.length })}</span>
            </span>
            <span className="gl-kpi-note">{t("common.games.lastPlayed", { when: dates.dayTime(g.lastPlayed) })}</span>
          </button>
        ))}
        {games.length === 0 && (
          <button type="button" className="gl-kpi" onClick={onOpenLive}>
            <span className="gl-kpi-label">{t("home.glass.noGames")}</span>
            <Arrow />
            <span className="gl-kpi-row">
              <span className="gl-kpi-value">{t("home.glass.noGamesValue")}</span>
            </span>
            <span className="gl-kpi-note">{t("home.glass.noGamesNote")}</span>
          </button>
        )}
      </div>

      <div className="gl-lower">
        <section className="gl-card" aria-labelledby="gl-home-chart">
          <div className="gl-card-top">
            <div>
              <h2 className="gl-card-title" id="gl-home-chart">
                {t("common.games.chartTitle")}
              </h2>
              <p className="gl-card-sub">
                {chartGame ? t("home.glass.chartSub", { name: chartGame.name }) : t("home.glass.chartEmpty")}
              </p>
            </div>
            {games.length > 1 && (
              <div className="gl-pill-seg" role="group" aria-label={t("home.glass.chartPick")}>
                {games.slice(0, 4).map((g) => (
                  <button key={g.key} type="button" aria-pressed={g.key === chartKey} onClick={() => setChartKey(g.key)}>
                    {g.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {chartGame && (
            <TubeChart bars={bars} ariaLabel={t("common.games.chartAria", { count: bars.length, name: chartGame.name })} />
          )}
        </section>

        <div className="gl-stack">
          <div className="gl-pair">
            <button type="button" className="gl-kpi" onClick={onOpenLive}>
              <span className="gl-kpi-label">{t("home.glass.live.title")}</span>
              <Arrow />
              <span className="gl-kpi-row">
                <span className="gl-kpi-value" data-size="big">
                  {newestAvg != null ? (
                    <>
                      <span className="gl-num">{Math.round(newestAvg)}</span>
                      <small>{t("home.glass.live.unit")}</small>
                    </>
                  ) : (
                    t("home.glass.live.none")
                  )}
                </span>
              </span>
              <span className="gl-kpi-note">
                {newest
                  ? newestLow != null
                    ? t("home.glass.live.note", {
                        game: newestGame?.name ?? newest.process_name,
                        when: dates.dayTime(newest.started_at),
                        low: Math.round(newestLow),
                      })
                    : t("home.glass.live.noteNoLow", {
                        game: newestGame?.name ?? newest.process_name,
                        when: dates.dayTime(newest.started_at),
                      })
                  : t("home.glass.live.noneNote")}
              </span>
            </button>
            <button type="button" className="gl-kpi" onClick={checksKnown ? onSeeChecks : onRunCheck}>
              <span className="gl-kpi-label">{t("home.glass.checks.title")}</span>
              <Arrow />
              <span className="gl-kpi-row">
                <span className="gl-kpi-value" data-size="big">
                  {checksKnown ? (
                    <>
                      <span className="gl-num">{good}</span>
                      <small>{t("home.glass.checks.of", { total: readable })}</small>
                    </>
                  ) : (
                    t("home.glass.checks.run")
                  )}
                </span>
              </span>
              <span className="gl-kpi-note">
                {!checksKnown
                  ? t("home.glass.checks.unknownNote")
                  : worthNames.length > 0
                    ? t("home.glass.checks.worth", { names: worthNames.slice(0, 2).join(", ") })
                    : unread > 0
                      ? t("home.glass.checks.unread", { count: unread })
                      : t("home.glass.checks.allGood")}
              </span>
            </button>
          </div>

          <section className="gl-card" aria-labelledby="gl-home-limiter">
            <h2 className="gl-card-title" id="gl-home-limiter">
              {t("home.glass.limiter.title")}
            </h2>
            {topLimiter ? (
              <div className="gl-rows">
                <div className="gl-row">
                  <span>
                    <span className="gl-row-title">{topLimiter.title}</span>
                    <span className="gl-row-sub">{topLimiter.reason}</span>
                  </span>
                  <span className="gl-chip" data-tone="accent">
                    {t(confidenceWordKey(wordFromBand(topLimiter.confidence)))}
                  </span>
                </div>
              </div>
            ) : (
              <p className="gl-card-sub">
                {priorities ? t("home.glass.limiter.none") : t("home.glass.limiter.unknown")}
              </p>
            )}
            <div className="gl-card-foot">
              <button type="button" className="gl-ghost" onClick={onOpenDetails}>
                {t("home.glass.details")}
              </button>
            </div>
          </section>
        </div>
      </div>
      {latestChange}
    </section>
  );
}
