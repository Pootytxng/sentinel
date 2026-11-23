// B1 Home truth (owner decision 2026-11-21). Home's headline, dek and count speak only about what is
// actually off-normal: a watched setting that drifted (the readiness `applied-changes` check), a game the
// Paramedic judges as running rougher than usual (`paramedic_home_status`), a check Compy couldn't read.
// An optional tweak the owner has not applied is none of those: it is never counted or shown on Home
// (Constitution §38). It stays where it lives (Lab, Check), unadvertised here.

import type { TFunction } from "i18next";
import type { Priorities } from "../types";

/** Priority rows that only say an optional catalog tweak is not applied. Never Home's to count or show. */
export const OPTIONAL_TWEAK_ROWS: ReadonlySet<string> = new Set(["pending-safe-recs"]);

/** The priorities a Home face may read: the same lists without the optional-tweak rows. */
export function homePriorities(p: Priorities | null): Priorities | null {
  if (!p) return p;
  const keep = (rows: Priorities["limiters"]) => rows.filter((r) => !OPTIONAL_TWEAK_ROWS.has(r.id));
  return { ...p, limiters: keep(p.limiters ?? []), already_fine: keep(p.already_fine ?? []) };
}

/** One game the Paramedic judges as running rougher than usual right now (paramedic/home_status.rs). */
export type RoughGame = {
  game: string;
  game_name: string;
  /** The newest judged sessions in a row that ran rough (unjudged ones never counted). */
  rough_sessions: number;
  newest_rough_at: string;
};

/** pending: not read yet (says nothing either way). unreadable: the read failed, which is never "none".
 *  `judged`: recent games whose newest judged session was compared with a usual range. With 0, "no rough game"
 *  only means nothing was measured, and Home says nothing about how the games ran. */
export type RoughRead =
  | { kind: "pending" }
  | { kind: "read"; games: RoughGame[]; judged: number; back?: BackInRange[] }
  | { kind: "unreadable" };

/** B2: a game back in its usual range after a rough run, as the card judges it (paramedic/home_status.rs):
 *  1 clear session ("Measured once") or 2 (the card's recovery). Percents are the 1% low as a share of the average. */
export type BackInRange = {
  game: string;
  game_name: string;
  sessions: 1 | 2;
  now_pct: number;
  usual_pct: number;
  newest_at: string;
};

function isBackInRange(v: unknown): v is BackInRange {
  if (!v || typeof v !== "object") return false;
  const g = v as Record<string, unknown>;
  const pctOk = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x > 0 && x <= 100;
  return (
    typeof g.game === "string" &&
    typeof g.game_name === "string" &&
    (g.sessions === 1 || g.sessions === 2) &&
    pctOk(g.now_pct) &&
    pctOk(g.usual_pct) &&
    typeof g.newest_at === "string"
  );
}

/** The games back in their usual range (empty when not read, unreadable, or none). */
export function backInRange(r: RoughRead): BackInRange[] {
  return r.kind === "read" ? r.back ?? [] : [];
}

/** Home's quiet line for one game. "Measured once" for one session; never "fixed", "back to normal" or a reason. */
export function backInRangeLine(b: BackInRange, t: TFunction): string {
  const name = b.game_name.trim() || b.game.trim() || t("home.posture.rough.aGame");
  return b.sessions === 2
    ? t("home.glass.backInRange.two", { game: name, nowPct: b.now_pct, usualPct: b.usual_pct })
    : t("home.glass.backInRange.once", { game: name, nowPct: b.now_pct, usualPct: b.usual_pct });
}

function isRoughGame(v: unknown): v is RoughGame {
  if (!v || typeof v !== "object") return false;
  const g = v as Record<string, unknown>;
  return (
    typeof g.game === "string" &&
    typeof g.game_name === "string" &&
    typeof g.rough_sessions === "number" &&
    Number.isInteger(g.rough_sessions) &&
    g.rough_sessions >= 1 &&
    typeof g.newest_rough_at === "string"
  );
}

/** The command's answer, checked. Anything not in the expected shape is a failed read, never "no rough game". */
export function parseHomeStatus(v: unknown): RoughRead {
  if (!v || typeof v !== "object") return { kind: "unreadable" };
  const { rough, games_judged: judged, back_in_range: back } = v as { rough?: unknown; games_judged?: unknown; back_in_range?: unknown };
  if (!Array.isArray(rough) || !rough.every(isRoughGame)) return { kind: "unreadable" };
  if (typeof judged !== "number" || !Number.isInteger(judged) || judged < rough.length) return { kind: "unreadable" };
  if (!Array.isArray(back) || !back.every(isBackInRange)) return { kind: "unreadable" };
  // A game is never both rough and back in its usual range: such an answer is not one Compy can give.
  if (back.some((b) => rough.some((g) => g.game === b.game))) return { kind: "unreadable" };
  return { kind: "read", games: rough, judged, back };
}

/** True only when the sessions were read and at least one game was compared with its usual range. */
export function gamesMeasured(r: RoughRead): boolean {
  return r.kind === "read" && r.judged > 0;
}

/** The day of a session start, in the app's language (the Games room's format), with the year when it is not
 *  this year, so an old rough run never reads as recent. `now` is for tests. */
export function roughDay(iso: string, lang: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(lang || "en", sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function roughGames(r: RoughRead): RoughGame[] {
  return r.kind === "read" ? r.games : [];
}

function gameName(g: RoughGame, t: TFunction): string {
  return g.game_name.trim() || g.game.trim() || t("home.posture.rough.aGame");
}

/** Home's sentence about the rough run(s): the game whose newest rough session is the most recent (the one the
 *  card answers for), with its count and the date of that session, then every other rough game by name (each
 *  one Home counts is named on the page). Empty when there is none (or when the read failed: that has its own
 *  sentence). The count is the judged sessions in a row; the date makes it true however long ago it was. */
export function roughLine(r: RoughRead, t: TFunction, lang = "en"): string {
  const games = roughGames(r);
  if (games.length === 0) return "";
  const first = games[0];
  const name = gameName(first, t);
  const when = roughDay(first.newest_rough_at, lang);
  const main =
    first.rough_sessions === 1
      ? t("home.posture.rough.sentenceOne", { game: name, date: when })
      : t("home.posture.rough.sentenceMany", { game: name, count: first.rough_sessions, date: when });
  if (games.length === 1) return main;
  // B6 (view-1122a finding 8): every other game is named WITH the date of its own newest rough session, so "last
  // time" is never read as today for a game that ran rough days ago.
  const rest = games
    .slice(1)
    .map((g) => t("home.posture.rough.otherGame", { game: gameName(g, t), date: roughDay(g.newest_rough_at, lang) }))
    .join(t("home.posture.rough.otherSeparator"));
  return `${main} ${t("home.posture.rough.others", { games: rest })}`;
}

/** The rough line as a note of its own beside another finding (a drifted setting): "Separately: …", so the two
 *  never read as one cause and its effect. */
export function roughNote(r: RoughRead, t: TFunction, lang = "en"): string {
  const line = roughLine(r, t, lang);
  return line ? t("home.posture.rough.separately", { line }) : "";
}

export function roughHeadline(r: RoughRead, t: TFunction): string {
  const games = roughGames(r);
  return games.length > 0 ? t("home.posture.rough.headline", { game: gameName(games[0], t) }) : "";
}
