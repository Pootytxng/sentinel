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
import { NavGlyph } from "../../design/NavGlyph";
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

  // A crash or freeze Windows recorded is a thing worth a look too, so the answer counts it; with
  // nothing recorded and every readable check fine, the answer is the plain "set up right".
  const worthCount = attention + (pendingCare ? 1 : 0);
  const answer =
    worthCount > 0
      ? t("home.glass.answer.worth", { count: worthCount })
      : !checksKnown
        ? t("home.glass.answer.unknown")
        : t("home.glass.answer.allRight");
  // No sub line under the answer (title-header law): the checks ratio lives on the Windows setup
  // card and the "nothing changes until you choose" promise beside the band's buttons.

  // The newest measured session. Its average is already on the lit game card and the chart, so the
  // Last session card shows what neither does: its 1% low.
  const newest = sessions.find((s) => knownFps(s.avg_fps) != null) ?? null;
  const newestGame = newest ? games.find((g) => g.key === newest.process_name.trim().toLowerCase()) : undefined;
  const newestLow = newest ? knownFps(newest.low1_fps_est) : null;
  // The headline is Black Box's own sentence for the record, the one the full check prints, so a
  // freeze reads "stopped responding" and a crash "closed unexpectedly". The fallback names no kind.
  const careSummary = pendingCare ? pendingCare.summary.trim() : "";
  const careHeadline = pendingCare
    ? careSummary || t("home.glass.care.headline", { what: pendingCare.app_label ?? pendingCare.kind })
    : "";
  // Black Box's sentence already carries what happened and when ("… — Sep 28, 11:57 AM"), so the
  // line under it says only where the record came from; the fallback headline keeps kind and time.
  const careDetail = pendingCare
    ? careSummary
      ? t("home.glass.care.detailRecorded")
      : t("home.glass.care.detail", { kind: pendingCare.kind, when: pendingCare.occurred_display })
    : "";

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

  // One row of four: the care card (when Windows recorded something), the most recent games, and
  // an "All games" door whenever there are more games than fit or a slot would sit empty.
  const slots = 4;
  const showAll = games.length > 0 && games.length !== slots;
  const gameCards = games.slice(0, showAll ? Math.min(games.length, slots - 1) : slots);

  return (
    <section className="gl-room" data-room="home" aria-labelledby="gl-home-h1">
      <header className="gl-head">
        <div className="gl-head-text">
          <p className="gl-eyebrow">{t(`home.glass.greeting.${greetingKey(new Date())}`)}</p>
          <h1 className="gl-h1" id="gl-home-h1">
            {answer}
          </h1>
        </div>
        <div className="gl-actions">
          {/* The two flagship journeys, as equals (Constitution): same weight, each with its door's
              own glyph from the dock. */}
          <button type="button" className="gl-ghost" onClick={onOpenProblems}>
            <NavGlyph name="problems" />
            {t("home.glass.actions.problem")}
          </button>
          <button type="button" className="gl-ghost" onClick={() => onOpenGame(null)}>
            <NavGlyph name="games" />
            {t("home.glass.actions.improve")}
          </button>
        </div>
      </header>

      {/* What Windows recorded (the Care observer's pointer). Its own band in the attention colour —
          never the accent fill, which on this page means "your most recent game". */}
      {pendingCare && (
        <div className="gl-banner" data-tone="warn" role="group" aria-label={t("home.glass.care.label")}>
          <span className="gl-banner-text">
            <b>{careHeadline}</b>
            <span>{careDetail}</span>
          </span>
          <span className="gl-banner-actions">
            <button type="button" className="gl-ghost" onClick={() => onDismissCareIncident(pendingCare.incident_id)}>
              {t("home.glass.care.later")}
            </button>
            <button type="button" className="gl-cta" onClick={() => onOpenCareIncident(pendingCare.incident_id)}>
              {t("home.glass.care.find")}
            </button>
          </span>
        </div>
      )}

      <div className="gl-kpis">
        {gameCards.map((g) => (
          <button
            key={g.key}
            type="button"
            className="gl-kpi"
            // The lit card is the game the chart below is showing — one meaning for the one fill.
            data-hot={g.key === chartKey}
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
        {showAll ? (
          <button type="button" className="gl-kpi" onClick={() => onOpenGame(null)}>
            <span className="gl-kpi-label">{t("home.glass.allGames")}</span>
            <Arrow />
            <span className="gl-kpi-row">
              <span className="gl-kpi-value">
                <span className="gl-num">{games.length}</span>
                <small>{t("home.glass.allGamesUnit", { count: games.length })}</small>
              </span>
            </span>
            <span className="gl-kpi-note">{t("home.glass.allGamesNote")}</span>
          </button>
        ) : null}
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
                  {!newest ? (
                    t("home.glass.live.none")
                  ) : newestLow != null ? (
                    <>
                      <span className="gl-num">{Math.round(newestLow)}</span>
                      <small>{t("home.glass.live.lowUnit")}</small>
                    </>
                  ) : (
                    t("common.games.notMeasured")
                  )}
                </span>
              </span>
              <span className="gl-kpi-note">
                {newest
                  ? t(newestLow != null ? "home.glass.live.lowNote" : "home.glass.live.lowNoneNote", {
                      game: newestGame?.name ?? newest.process_name,
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
