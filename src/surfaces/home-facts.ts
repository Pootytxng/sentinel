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
  | { kind: "read"; games: RoughGame[]; judged: number }
  | { kind: "unreadable" };

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
  const { rough, games_judged: judged } = v as { rough?: unknown; games_judged?: unknown };
  if (!Array.isArray(rough) || !rough.every(isRoughGame)) return { kind: "unreadable" };
  if (typeof judged !== "number" || !Number.isInteger(judged) || judged < rough.length) return { kind: "unreadable" };
  return { kind: "read", games: rough, judged };
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
  const rest = games.slice(1).map((g) => gameName(g, t)).join(", ");
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
