// Games (glass redesign, owner decision 2026-10-30) — the MAKE THIS PC BETTER door. Every game Compy
// has measured, from the retained sessions (data/game-library.ts); pick one to see how it runs. All
// numbers are real session readings; an unmeasured value says "Not measured". Changing anything
// still happens where it always did — the Test room's bench — so this room adds no mutation path.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionSummary } from "../../types";
import { gameLibrary, playTime, type GameEntry } from "../../data/game-library";
import { knownFps } from "../../lib/session-metrics";
import { Term } from "../../design/Term";
import { TubeChart, type TubeBar } from "./TubeChart";
import "../glass-rooms.css";

const Arrow = () => (
  <span className="gl-arrow" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  </span>
);

export function useDates() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const lang = i18n.language || "en";
    const day = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" });
    const dayTime = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const safe = (f: Intl.DateTimeFormat, iso: string) => {
      const d = new Date(iso);
      return Number.isFinite(d.getTime()) ? f.format(d) : "—";
    };
    return { day: (iso: string) => safe(day, iso), dayTime: (iso: string) => safe(dayTime, iso) };
  }, [i18n.language]);
}

export function usePlayTime() {
  const { t } = useTranslation();
  return (secs: number) => {
    const { h, m } = playTime(secs);
    return h > 0 ? t("common.games.hm", { h, m }) : t("common.games.m", { m });
  };
}

function GameCard({ game, hot, onOpen }: { game: GameEntry; hot: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const dates = useDates();
  return (
    <button type="button" className="gl-kpi" data-hot={hot} onClick={onOpen} aria-label={t("common.games.open", { name: game.name })}>
      <span className="gl-kpi-label">{game.name}</span>
      <Arrow />
      <span className="gl-kpi-row">
        <span className="gl-kpi-value">
          {game.lastAvg != null ? (
            <>
              <span className="gl-num">{Math.round(game.lastAvg)}</span>
              <small>{t("common.games.fps")}</small>
            </>
          ) : (
            t("common.games.notMeasured")
          )}
        </span>
        <span className="gl-chip">{t("common.games.sessions", { count: game.sessions.length })}</span>
      </span>
      <span className="gl-kpi-note">{t("common.games.lastPlayed", { when: dates.dayTime(game.lastPlayed) })}</span>
    </button>
  );
}

function GameDetail({
  game,
  onBack,
  onOpenLive,
  onOpenTest,
}: {
  game: GameEntry;
  onBack: () => void;
  onOpenLive: () => void;
  onOpenTest: () => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const time = usePlayTime();
  const recent = game.sessions.slice(0, 12).reverse();
  const bars: TubeBar[] = recent.map((s: SessionSummary, i) => {
    const avg = knownFps(s.avg_fps);
    const low = knownFps(s.low1_fps_est);
    return {
      key: `${s.started_at}-${i}`,
      value: avg,
      label: dates.day(s.started_at),
      tip:
        avg == null
          ? t("common.games.tipUnmeasured", { date: dates.dayTime(s.started_at) })
          : low == null
            ? t("common.games.tipAvg", { date: dates.dayTime(s.started_at), avg: Math.round(avg) })
            : t("common.games.tip", { date: dates.dayTime(s.started_at), avg: Math.round(avg), low: Math.round(low) }),
    };
  });

  return (
    <section className="gl-room" data-room="games" aria-labelledby="gl-games-h1">
      <div>
        <button type="button" className="gl-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {t("common.games.back")}
        </button>
      </div>
      <header className="gl-head">
        <div className="gl-head-text">
          <h1 className="gl-h1" id="gl-games-h1">
            {game.name}
          </h1>
          <p className="gl-sub">
            {t("common.games.detailSub", {
              sessions: t("common.games.sessions", { count: game.sessions.length }),
              time: time(game.totalSecs),
              when: dates.dayTime(game.lastPlayed),
            })}
          </p>
        </div>
        <div className="gl-actions">
          <button type="button" className="gl-ghost" onClick={onOpenLive}>
            {t("common.games.liveCta")}
          </button>
          <button type="button" className="gl-cta" onClick={onOpenTest}>
            {t("common.games.testCta")}
          </button>
        </div>
      </header>

      <div className="gl-kpis">
        <div className="gl-kpi" data-hot="true">
          <span className="gl-kpi-label">{t("common.games.kpi.last")}</span>
          <span className="gl-kpi-row">
            <span className="gl-kpi-value" data-size="big">
              {game.lastAvg != null ? (
                <>
                  <span className="gl-num">{Math.round(game.lastAvg)}</span>
                  <small>{t("common.games.fps")}</small>
                </>
              ) : (
                t("common.games.notMeasured")
              )}
            </span>
          </span>
          <span className="gl-kpi-note">{t("common.games.kpi.lastNote")}</span>
        </div>
        <div className="gl-kpi">
          <span className="gl-kpi-label">
            <Term id="one-percent-lows">{t("common.games.kpi.low1")}</Term>
          </span>
          <span className="gl-kpi-row">
            <span className="gl-kpi-value" data-size="big">
              {game.lastLow != null ? (
                <>
                  <span className="gl-num">{Math.round(game.lastLow)}</span>
                  <small>{t("common.games.fps")}</small>
                </>
              ) : (
                t("common.games.notMeasured")
              )}
            </span>
          </span>
          <span className="gl-kpi-note">{t("common.games.kpi.low1Note")}</span>
        </div>
        <div className="gl-kpi">
          <span className="gl-kpi-label">{t("common.games.kpi.sessions")}</span>
          <span className="gl-kpi-row">
            <span className="gl-kpi-value" data-size="big">
              <span className="gl-num">{game.sessions.length}</span>
            </span>
          </span>
          <span className="gl-kpi-note">{t("common.games.kpi.sessionsNote", { time: time(game.totalSecs) })}</span>
        </div>
        <div className="gl-kpi">
          <span className="gl-kpi-label">{t("common.games.kpi.best")}</span>
          <span className="gl-kpi-row">
            <span className="gl-kpi-value" data-size="big">
              {game.bestAvg != null ? (
                <>
                  <span className="gl-num">{Math.round(game.bestAvg)}</span>
                  <small>{t("common.games.fps")}</small>
                </>
              ) : (
                t("common.games.notMeasured")
              )}
            </span>
          </span>
          <span className="gl-kpi-note">{t("common.games.kpi.bestNote")}</span>
        </div>
      </div>

      <div className="gl-lower" data-align="start">
        <section className="gl-card" aria-labelledby="gl-games-chart">
          <h2 className="gl-card-title" id="gl-games-chart">
            {t("common.games.chartTitle")}
          </h2>
          <p className="gl-card-sub">{t("common.games.chartSub")}</p>
          <TubeChart bars={bars} ariaLabel={t("common.games.chartAria", { count: bars.length, name: game.name })} />
        </section>
        <section className="gl-card" aria-labelledby="gl-games-sessions">
          <h2 className="gl-card-title" id="gl-games-sessions">
            {t("common.games.sessionsTitle")}
          </h2>
          <p className="gl-card-sub">{t("common.games.sessionsSub")}</p>
          <div className="gl-rows">
            {game.sessions.slice(0, 8).map((s, i) => {
              const avg = knownFps(s.avg_fps);
              return (
                <div className="gl-row" key={`${s.started_at}-${i}`}>
                  <span>
                    <span className="gl-row-title">{dates.dayTime(s.started_at)}</span>
                    <span className="gl-row-sub">{time(s.duration_secs)}</span>
                  </span>
                  <span className="gl-row-val">
                    {avg != null ? t("common.games.rowFps", { avg: Math.round(avg) }) : t("common.games.notMeasured")}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}

/** The newest measured sessions across every game — what actually ran lately, one click from its game. */
function RecentSessions({ games, onOpen }: { games: GameEntry[]; onOpen: (key: string) => void }) {
  const { t } = useTranslation();
  const dates = useDates();
  const time = usePlayTime();
  const recent = games
    .flatMap((g) => g.sessions.map((s) => ({ s, g })))
    .sort((a, b) => (Date.parse(b.s.started_at) || 0) - (Date.parse(a.s.started_at) || 0))
    .slice(0, 6);
  return (
    <section className="gl-card" aria-labelledby="gl-games-recent">
      <h2 className="gl-card-title" id="gl-games-recent">
        {t("common.games.recentTitle")}
      </h2>
      <p className="gl-card-sub">{t("common.games.recentSub")}</p>
      <div className="gl-rows">
        {recent.map(({ s, g }, i) => {
          const avg = knownFps(s.avg_fps);
          return (
            <button type="button" className="gl-row gl-row-btn" key={`${s.started_at}-${i}`} onClick={() => onOpen(g.key)}>
              <span>
                <span className="gl-row-title">{g.name}</span>
                <span className="gl-row-sub">
                  {dates.dayTime(s.started_at)} · {time(s.duration_secs)}
                </span>
              </span>
              <span className="gl-row-val">
                {avg != null ? t("common.games.rowFps", { avg: Math.round(avg) }) : t("common.games.notMeasured")}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Measured play time per game, as bars — where the hours actually went. */
function PlayTime({ games, onOpen }: { games: GameEntry[]; onOpen: (key: string) => void }) {
  const { t } = useTranslation();
  const time = usePlayTime();
  const ranked = [...games].sort((a, b) => b.totalSecs - a.totalSecs).slice(0, 6);
  const most = Math.max(1, ...ranked.map((g) => g.totalSecs));
  return (
    <section className="gl-card" aria-labelledby="gl-games-playtime">
      <h2 className="gl-card-title" id="gl-games-playtime">
        {t("common.games.playTitle")}
      </h2>
      <p className="gl-card-sub">{t("common.games.playSub")}</p>
      <div className="gl-bars">
        {ranked.map((g) => (
          <button
            type="button"
            className="gl-bars-row gl-row-btn"
            key={g.key}
            onClick={() => onOpen(g.key)}
            aria-label={t("common.games.playRow", { name: g.name, time: time(g.totalSecs) })}
          >
            <span className="gl-bars-name">{g.name}</span>
            <span className="gl-bars-track" aria-hidden="true">
              <span className="gl-bars-fill" style={{ display: "block", width: `${Math.max(3, (100 * g.totalSecs) / most)}%` }} />
            </span>
            <span className="gl-row-val">{time(g.totalSecs)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function GamesRoom({
  sessions,
  focusKey = null,
  onOpenLive,
  onOpenTest,
}: {
  sessions: SessionSummary[];
  /** A game a Health card asked to open (one-time delivery from App). */
  focusKey?: string | null;
  onOpenLive: () => void;
  onOpenTest: () => void;
}) {
  const { t } = useTranslation();
  const games = useMemo(() => gameLibrary(sessions), [sessions]);
  const [openKey, setOpenKey] = useState<string | null>(focusKey);
  useEffect(() => {
    if (focusKey) setOpenKey(focusKey);
  }, [focusKey]);
  const open = openKey ? games.find((g) => g.key === openKey) ?? null : null;

  if (open) {
    return <GameDetail game={open} onBack={() => setOpenKey(null)} onOpenLive={onOpenLive} onOpenTest={onOpenTest} />;
  }

  return (
    <section className="gl-room" data-room="games" aria-labelledby="gl-games-h1">
      <header className="gl-head">
        <div className="gl-head-text">
          <h1 className="gl-h1" id="gl-games-h1">
            {t("common.games.title")}
          </h1>
          <p className="gl-sub">{t("common.games.sub")}</p>
        </div>
        <div className="gl-actions">
          <button type="button" className="gl-cta" onClick={onOpenTest}>
            {t("common.games.testCta")}
          </button>
        </div>
      </header>
      {games.length === 0 ? (
        <div className="gl-empty">
          <p>{t("common.games.empty")}</p>
          <button type="button" className="gl-ghost" onClick={onOpenLive}>
            {t("common.games.emptyCta")}
          </button>
        </div>
      ) : (
        <>
          <div className="gl-grid">
            {games.map((g, i) => (
              <GameCard key={g.key} game={g} hot={i === 0} onOpen={() => setOpenKey(g.key)} />
            ))}
          </div>
          <div className="gl-lower" data-align="start">
            <RecentSessions games={games} onOpen={setOpenKey} />
            <PlayTime games={games} onOpen={setOpenKey} />
          </div>
        </>
      )}
    </section>
  );
}
