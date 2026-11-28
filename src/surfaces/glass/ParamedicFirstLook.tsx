// The day-one answer (design M5, slice S1). When the measured Paramedic has no usable history (no game
// recorded, or too few sessions), the card asks ONE question, "When did it start?", then asks the engine
// (`paramedic_first_look`, read-only) what changed on this PC in that window. It shows dated facts newest
// first, says what it could not see, and claims no measurement: nothing here is called a problem or a
// cause, and nothing is ordered by likelihood. Nothing about the answer is stored. The engine returns
// codes and numbers; every sentence is a locale string (`paramedic.firstLook.*`), every key literal.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { AppliedChange, Drift, ParamedicDiagnosis, ParamedicLimit } from "../../types";
import { useDates } from "./GamesRoom";

type T = ReturnType<typeof useTranslation>["t"];
type Dates = ReturnType<typeof useDates>;

export type FirstLookSince = "today" | "this-week" | "this-month" | "always" | "dont-know";

export type FirstLookChange = {
  id: string;
  at: string | null;
  precision: "exact" | "day";
  args: Record<string, string>;
  confidence: string;
  evidence: string;
  how: string;
};

/** The game the user picked, as the command takes it. `name` (Steam picks) is only what the card showed. */
export type FirstLookGame = { kind: "whole-pc" } | { kind: "seen"; process: string } | { kind: "steam"; app_id: number; name: string };

/** A game Compy has recorded, newest first (the Home card passes them from the recorded sessions). */
export type RecordedGame = { process: string; name: string };

/** One thing that looks off on this PC: a code and its numbers (the card words it and its one "how to check" line). */
export type FirstLookFact = { id: string; args: Record<string, string> };

/** A change Compy itself made inside the window (from its change history). */
export type CompyChange = { title: string; at: string; undone: boolean; undone_at: string | null };

/** The game's crash records before and after the earliest dated change: counts and dates only. `gap` is set when
 *  Compy can't say how many came before (`starts-later`: its oldest readable record is not older than the change;
 *  `unread`: some records could not be read, and none of the readable ones is before the change;
 *  `unread-after`: some records could not be read, and none of the readable ones is after the change, so a newer one may be among them). */
export type FirstLookCrashSplit = { before: number; after: number; change: string; oldest_read: string | null; gap: "starts-later" | "unread" | "unread-after" | null; by_name: boolean };

/** Known programs running at this moment (the reviewed allowlist only). `state` other than "listed" and "none" is
 *  a "couldn't read" outcome; only "none" says none. */
export type FirstLookRunning = {
  state: "listed" | "none" | "unread" | "took-too-long" | "reader-failed" | "not-read";
  programs: { id: string; name: string }[];
  more: number;
};

/** How many sessions Compy has recorded. `state` other than "read" is a "couldn't read" outcome: no count is claimed.
 *  `game` is null when no game is picked, the read failed, or the pick couldn't be matched to a recorded game
 *  (`unmatched`); only a successful read can say 0. `need` is the number of sessions of one game the measured answer
 *  needs before it can compare. */
export type FirstLookRecorded = { state: "read" | "unread" | "not-read"; total: number | null; game: number | null; unmatched: boolean; need: number };

export type ParamedicFirstLook = {
  told: { since: FirstLookSince; from: string | null; to: string; hours: number | null };
  /** The picked game's display name; null for the whole PC. */
  game: string | null;
  changes_listed: boolean;
  touch_games: FirstLookChange[];
  other_changes: FirstLookChange[];
  /** Kinds read completely with nothing in the window: "gpu-driver", "windows-update", "programs". */
  none: string[];
  /** Steam's last recorded update of the game when it is older than the window (read completely). */
  game_files_since: string | null;
  /** The game's crash records Compy could read: the measured flow's own args (n, since, partial, byName, versions). */
  crashes: { args: Record<string, string>; signature_module: string | null; signature_before: string | null; change_kind?: string | null; split: FirstLookCrashSplit | null } | null;
  /** Windows' crash records were read completely and none is the game's. */
  crashes_none: boolean;
  /** e13: records of the game's program name that ran from another folder, not counted (n, exe, folder, folders). */
  crashes_elsewhere?: Record<string, string> | null;
  /** Facts with dates or numbers that are not a change in the window (a mod's files outside it). */
  looks_off: FirstLookChange[];
  /** The game's folder was scanned completely and holds no mod Compy knows. */
  mods_none: boolean;
  /** Mods whose settings or data files (not a loader) sit in the game's folder. */
  mods_settings_only: string[];
  /** What looks off on this PC, in the engine's fixed order. */
  facts: FirstLookFact[];
  /** Changes Compy made inside the window, newest first. */
  compy_changes: CompyChange[];
  /** Known programs running right now: a fact about now, not about when the problem happened. */
  running_now: FirstLookRunning;
  /** How many sessions Compy has recorded: what "can't tell yet" rests on. Absent (an older answer) is "couldn't read". */
  recorded?: FirstLookRecorded;
  limits: ParamedicLimit[];
  read_all: boolean;
  method: string;
};

/** Steam's list for the picker: `read: false` is "couldn't read Steam's libraries", never "no games". */
export type SteamGames = {
  read: boolean;
  complete: boolean;
  games: {
    app_id: number;
    name: string;
    last_updated: string | null;
    /** The drive letter of the game's library: tells two games of one name apart. */
    drive?: string | null;
    /** The recorded game (its program name) found in this very folder; a name match never sets it. */
    recorded?: string | null;
  }[];
};

/** The measured answers that leave the user with nothing to look at: the first look takes over from them. */
export function firstLookApplies(d: ParamedicDiagnosis): boolean {
  const s = d.state;
  return s.kind === "needs-more-play" || (s.kind === "cant-tell" && s.why.kind === "no-sessions");
}

/** What the measured answer already said about the one game that has too few sessions (null: no game recorded at all). */
export type FirstLookMeasured = { game: string; have: number; need: number } | null;

/** The card's own `measured` for this diagnosis: only a game with some sessions has counts to name. */
export function firstLookMeasured(d: ParamedicDiagnosis, game: string): FirstLookMeasured {
  const s = d.state;
  return s.kind === "needs-more-play" ? { game, have: s.have, need: s.have + s.sessions_needed } : null;
}

const CHOICES: { since: FirstLookSince }[] = [
  { since: "today" },
  { since: "this-week" },
  { since: "this-month" },
  { since: "always" },
  { since: "dont-know" },
];

function choiceLabel(s: FirstLookSince, t: T): string {
  switch (s) {
    case "today":
      return t("paramedic.firstLook.when.today");
    case "this-week":
      return t("paramedic.firstLook.when.thisWeek");
    case "this-month":
      return t("paramedic.firstLook.when.thisMonth");
    case "always":
      return t("paramedic.firstLook.when.always");
    default:
      return t("paramedic.firstLook.when.dontKnow");
  }
}

/** What the user told Compy, in words, and the window Compy actually read. */
function toldText(a: ParamedicFirstLook, t: T, dates: Dates): string {
  const from = a.told.from ? dates.day(a.told.from) : "";
  switch (a.told.since) {
    case "today":
      return t("paramedic.firstLook.told.today", { from });
    case "this-week":
      return t("paramedic.firstLook.told.thisWeek", { from });
    case "this-month":
      return t("paramedic.firstLook.told.thisMonth", { from });
    case "always":
      return t("paramedic.firstLook.told.always");
    default:
      return t("paramedic.firstLook.told.dontKnow", { from });
  }
}

/** One dated fact. Installs carry a day, never a time of day; every other row names the day and time Windows recorded. */
/** "graphics driver", or with more than one graphics adapter in the window, "AMD graphics driver" (maker from its PCI vendor id). */
function adapterWord(maker: string | undefined, t: T): string {
  if (!maker) return t("paramedic.firstLook.adapter.plain");
  if (maker === "amd") return t("paramedic.firstLook.adapter.maker", { maker: "AMD" });
  if (maker === "nvidia") return t("paramedic.firstLook.adapter.maker", { maker: "NVIDIA" });
  if (maker === "intel") return t("paramedic.firstLook.adapter.maker", { maker: "Intel" });
  return t("paramedic.firstLook.adapter.other");
}

function changeText(c: FirstLookChange, t: T, dates: Dates, game?: string | null): string {
  const a = c.args;
  const when = c.at ? (c.precision === "day" ? dates.day(c.at) : dates.dayTime(c.at)) : "";
  const adapter = adapterWord(a.maker, t);
  switch (c.id) {
    case "gpu-driver-changed":
      return t("paramedic.firstLook.change.gpuChanged", { adapter, from: a.from, to: a.to, when });
    case "gpu-driver-installed":
      return t("paramedic.firstLook.change.gpuInstalled", { adapter, to: a.to, when });
    case "gpu-driver-installed-bare":
      return t("paramedic.firstLook.change.gpuInstalledBare", { adapter, when });
    case "display-driver-other":
      return t("paramedic.firstLook.change.displayOther", { count: Number(a.count), when });
    case "windows-update":
      return t("paramedic.firstLook.change.windowsUpdate", { kb: a.kb, when });
    case "windows-update-nokb":
      return t("paramedic.firstLook.change.windowsUpdateNoKb", { when });
    case "other-drivers": {
      const count = Number(a.count);
      const classes = a.classes
        .split(", ")
        .map((k) => {
          if (k === "audio") return t("paramedic.driverClass.audio");
          if (k === "network") return t("paramedic.driverClass.network");
          if (k.startsWith("chipset")) return t("paramedic.driverClass.chipset");
          return k;
        })
        .join(", ");
      return t("paramedic.firstLook.change.otherDrivers", { count, classes, when });
    }
    case "programs-installed": {
      const count = Number(a.count);
      const more = Number(a.more);
      if (more > 0) return t("paramedic.firstLook.change.programsMore", { count, names: a.names, more, day: when });
      return t("paramedic.firstLook.change.programs", { count, names: a.names, day: when });
    }
    case "updates-minor":
      return t("paramedic.firstLook.change.updatesMinor", { n: a.n, m: a.m });
    case "updates-unclassified":
      return t("paramedic.firstLook.change.updatesUnclassified", { count: Number(a.n) });
    case "game-files":
      return t("paramedic.firstLook.change.gameFiles", { game: a.game, when });
    case "graphics-mod":
      // The measured flow's own sentence (Compy says the folder contains it; never that it is on or the cause).
      return t("paramedic.finding.graphicsMod.what", { game: game ?? "", name: a.name });
    default:
      return "";
  }
}

/** The lines a row carries under its sentence: the measured flow's own evidence sentences for a mod, a pending-update note for Steam's record. */
function rowNotes(c: FirstLookChange, t: T, dates: Dates): string[] {
  const a = c.args;
  if (c.id === "game-files") return a.pending === "true" ? [t("paramedic.firstLook.change.gameFilesPending", { game: a.game })] : [];
  if (c.id !== "graphics-mod") return [];
  const out: string[] = [];
  if (a.date) out.push(t("paramedic.evidence.modFilesCreated", { first_seen: dates.day(a.date) }));
  if (a.settings) out.push(t("paramedic.evidence.modSettingsChanged", { date: dates.day(a.settings) }));
  out.push(t("paramedic.firstLook.change.modUnknownOn"));
  return out;
}

/** One fact that looks off, as a sentence with its number. The words state a reading; none says why a game runs badly. */
function factText(f: FirstLookFact, t: T, game: string | null, dates: Dates): string {
  const a = f.args;
  switch (f.id) {
    case "monitor-refresh":
      return t("paramedic.firstLook.fact.monitorRefresh", { now: a.now, max: a.max });
    case "memory-speed":
      return t("paramedic.firstLook.fact.memorySpeed", { now: a.now, rated: a.rated });
    case "memory-one-stick":
      return t("paramedic.firstLook.fact.memoryOneStick");
    case "memory-one-channel":
      return t("paramedic.firstLook.fact.memoryOneChannel", { n: Number(a.n) });
    case "drive-health": {
      // The two values Windows' health status gives are translated; any other value is shown as it came.
      const word = a.health === "Warning" ? t("paramedic.firstLook.healthWord.warning") : a.health === "Unhealthy" ? t("paramedic.firstLook.healthWord.unhealthy") : null;
      return word ? t("paramedic.firstLook.fact.driveHealth", { drive: a.drive, health: word }) : t("paramedic.firstLook.fact.driveHealthOther", { drive: a.drive, health: a.health });
    }
    case "game-on-hdd":
      return t("paramedic.firstLook.fact.gameOnHdd", { game: game ?? "", drive: a.drive });
    case "gpu-driver-age":
      return t("paramedic.firstLook.fact.gpuDriverAge", { date: dates.day(a.date), count: Number(a.days) });
    case "freesync-off":
      return t("paramedic.firstLook.fact.freesyncOff");
    case "on-battery":
      return t("paramedic.firstLook.fact.onBattery");
    case "game-drive-full":
      return t("paramedic.firstLook.fact.gameDriveFull", { game: game ?? "", drive: a.drive, free: a.free_gb, total: a.total_gb });
    default:
      return "";
  }
}

/** The one line on how to check a fact by hand. No advice beyond it. */
function factHow(id: string, t: T): string | null {
  switch (id) {
    case "monitor-refresh":
      return t("paramedic.firstLook.factHow.monitorRefresh");
    case "memory-speed":
      return t("paramedic.firstLook.factHow.memorySpeed");
    case "memory-one-stick":
    case "memory-one-channel":
      return t("paramedic.firstLook.factHow.memoryChannels");
    case "drive-health":
      return t("paramedic.firstLook.factHow.driveHealth");
    case "game-on-hdd":
      return t("paramedic.firstLook.factHow.gameOnHdd");
    case "gpu-driver-age":
      return t("paramedic.firstLook.factHow.gpuDriverAge");
    case "freesync-off":
      return t("paramedic.firstLook.factHow.freesyncOff");
    case "on-battery":
      return t("paramedic.firstLook.factHow.onBattery");
    case "game-drive-full":
      return t("paramedic.firstLook.factHow.gameDriveFull");
    default:
      return null;
  }
}

/** A change Compy made: what and when, and (once) where it can be undone. Compy runs nothing from here. */
function compyText(c: CompyChange, t: T, dates: Dates): string {
  const when = dates.dayTime(c.at);
  if (!c.undone) return t("paramedic.firstLook.compy.applied", { title: c.title, when });
  return c.undone_at
    ? t("paramedic.firstLook.compy.undone", { title: c.title, when, undone: dates.dayTime(c.undone_at) })
    : t("paramedic.firstLook.compy.undoneNoDate", { title: c.title, when });
}

const instant = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = new Date(s).getTime();
  return Number.isFinite(n) ? n : null;
};

/** Inside the window the engine read: after `from`, up to `to` (the engine's own `(t0, now]`). */
const inWindow = (at: number | null, from: number, to: number): at is number => at !== null && at > from && at <= to;

/** e6: Compy's own changes made BEFORE the window and undone inside it, from the ledger list the card already has.
 *  The engine lists only changes made inside the window (with their undo); these are the rest. A change the engine
 *  already listed (same title, same time) is not listed twice. Null ledger (not read): none, and nothing is claimed. */
export function undoneInWindow(changes: AppliedChange[] | null | undefined, a: ParamedicFirstLook): CompyChange[] {
  const from = instant(a.told.from);
  const to = instant(a.told.to);
  if (!changes || from === null || to === null || !a.changes_listed) return [];
  // The engine's stamps are whole seconds (`told.from` too), so a change is matched to the second, and one made in
  // the second `from` names is checked against the engine's list rather than dropped by both.
  const sec = (n: number) => Math.floor(n / 1000);
  const listed = new Set(a.compy_changes.map((c) => `${c.title}\u0000${sec(instant(c.at) ?? NaN)}`));
  return changes
    .filter((c) => c.status === "rolled_back" && c.rec_title.trim() !== "" && inWindow(instant(c.rolled_back_at), from, to))
    .filter((c) => {
      const applied = instant(c.applied_at);
      return applied !== null && sec(applied) <= sec(from) && !listed.has(`${c.rec_title.trim()}\u0000${sec(applied)}`);
    })
    .map((c) => ({ title: c.rec_title.trim(), at: c.applied_at, undone: true, undone_at: c.rolled_back_at ?? null }));
}

/** e6: the notice that settings Compy applied read off now, from the live drift list Home names them from, when Compy
 *  noticed it inside the window. ONE row per notice: its two times are the notice's (the first check that flagged one
 *  off, and the last check that flagged none: a setting the user kept as set outside Compy is off but never flagged,
 *  readiness.rs), not any one title's, because a title can go off later on a standing notice and the list the card
 *  reads has no time per title (review r1 F1, r2 M1). The titles are listed with no time each; none kept is the
 *  unnamed row. A notice whose last unflagged check is before the window is not listed as a change in it, by the same
 *  rule the diagnosis uses (paramedic.rs `ambiguous`): `offNowAmbiguous` says so in one line instead. An unreadable
 *  check is not listed. */
export type OffNow = { titles: string[]; seen: string | null; noticed: string };

/** The applied-changes notices the first look may speak of: readable, and flagged inside the window. */
function offNowNotices(drifts: Drift[] | null | undefined, a: ParamedicFirstLook): { d: Drift; ready: number | null; from: number }[] {
  const from = instant(a.told.from);
  const to = instant(a.told.to);
  if (!drifts || from === null || to === null || !a.changes_listed) return [];
  return drifts
    .filter((d) => d.id === "applied-changes" && d.unreadable_now !== true && inWindow(instant(d.noticed_at), from, to))
    .map((d) => ({ d, ready: instant(d.last_ready_at), from }));
}

/** r2 S1: a notice flagged inside the window whose last unflagged check is before it: when it changed isn't known. */
export function offNowAmbiguous(drifts: Drift[] | null | undefined, a: ParamedicFirstLook): boolean {
  return offNowNotices(drifts, a).some((n) => n.ready !== null && n.ready < n.from);
}

export function offNowInWindow(drifts: Drift[] | null | undefined, a: ParamedicFirstLook): OffNow[] {
  return offNowNotices(drifts, a)
    .filter((n) => n.ready === null || n.ready >= n.from)
    .map((n) => n.d)
    .map((d) => ({
      titles: (d.titles ?? []).map((x) => x.trim()).filter(Boolean),
      seen: instant(d.last_ready_at) !== null ? (d.last_ready_at as string) : null,
      noticed: d.noticed_at,
    }));
}

function offNowText(o: OffNow, t: T, dates: Dates): string {
  const noticed = dates.dayTime(o.noticed);
  const seen = o.seen ? dates.dayTime(o.seen) : null;
  const when = seen ? t("paramedic.firstLook.compy.offNowSeen", { seen, noticed }) : t("paramedic.firstLook.compy.offNowNoticed", { noticed });
  const which =
    o.titles.length > 0
      ? t("paramedic.firstLook.compy.offNowTitles", {
          count: o.titles.length,
          titles: o.titles.map((title) => t("paramedic.firstLook.compy.offNowItem", { title })).join(t("paramedic.firstLook.running.separator")),
        })
      : t("paramedic.firstLook.compy.offNowUnnamed");
  return t("paramedic.firstLook.compy.offNowLine", { when, which });
}

/** The readings a "couldn't read" line can name. */
function factsUnreadWords(list: string, t: T): string {
  return list
    .split(",")
    .map((k) => {
      switch (k) {
        case "monitor-refresh":
          return t("paramedic.firstLook.unreadWhat.monitorRefresh");
        case "memory-speed":
          return t("paramedic.firstLook.unreadWhat.memorySpeed");
        case "memory-channels":
          return t("paramedic.firstLook.unreadWhat.memoryChannels");
        case "drive-health":
          return t("paramedic.firstLook.unreadWhat.driveHealth");
        case "gpu-driver":
          return t("paramedic.firstLook.unreadWhat.gpuDriver");
        case "power-source":
          return t("paramedic.firstLook.unreadWhat.powerSource");
        case "game-drive":
          return t("paramedic.firstLook.unreadWhat.gameDrive");
        default:
          return k;
      }
    })
    .join(", ");
}

/** The one line on how to check or undo it by hand. Compy runs none of them. */
function howText(code: string, t: T): string | null {
  switch (code) {
    case "gpu-driver":
      return t("paramedic.firstLook.how.gpuDriver");
    case "windows-update":
      return t("paramedic.firstLook.how.windowsUpdate");
    case "programs":
      return t("paramedic.firstLook.how.programs");
    case "other-drivers":
      return t("paramedic.firstLook.how.otherDrivers");
    default:
      return null;
  }
}

function limitWhat(kind: ParamedicLimit["kind"], t: T, game?: string | null): string {
  switch (kind) {
    case "game-update":
      return game ? t("paramedic.firstLook.limit.what.steamRecord", { game }) : t("paramedic.firstLook.limit.what.gameFiles");
    case "facts":
      return t("paramedic.firstLook.limit.what.facts");
    case "history":
      return t("paramedic.firstLook.limit.what.history");
    case "driver":
      return t("paramedic.firstLook.limit.what.driver");
    case "windows-update":
      return t("paramedic.firstLook.limit.what.windowsUpdate");
    case "programs":
      return t("paramedic.firstLook.limit.what.programs");
    default:
      return t("paramedic.firstLook.limit.what.gameFiles");
  }
}

function limitWhy(l: ParamedicLimit, t: T, dates: Dates): string {
  const from = l.args.from ? dates.day(l.args.from) : "";
  switch (l.code) {
    case "access-denied":
      return t("paramedic.firstLook.limit.why.accessDenied");
    case "log-empty":
      return t("paramedic.firstLook.limit.why.logEmpty");
    case "log-missing":
      return t("paramedic.firstLook.limit.why.logMissing");
    case "read-failed":
      return t("paramedic.firstLook.limit.why.readFailed");
    case "timed-out":
      return t("paramedic.firstLook.limit.why.timedOut");
    case "records-unreadable":
      return t("paramedic.firstLook.limit.why.recordsUnreadable", { n: l.args.n });
    case "registry":
      return t("paramedic.firstLook.limit.why.registry");
    case "not-read":
      return t("paramedic.firstLook.limit.why.notRead");
    case "took-too-long":
      return t("paramedic.firstLook.limit.why.tookTooLong");
    case "reader-failed":
      return t("paramedic.firstLook.limit.why.readerFailed");
    case "partial-timed-out":
      return t("paramedic.firstLook.limit.why.partialTimedOut");
    case "partial-row-cap":
      return t("paramedic.firstLook.limit.why.partialRowCap");
    case "partial-unparsed":
      return t("paramedic.firstLook.limit.why.partialUnparsed", { n: l.args.n });
    case "partial-output-capped":
      return t("paramedic.firstLook.limit.why.partialOutputCapped");
    case "partial-registry":
      return t("paramedic.firstLook.limit.why.partialRegistry", { n: l.args.n });
    case "partial-coverage":
      return t("paramedic.firstLook.limit.why.partialCoverage", { from });
    case "not-steam":
      return t("paramedic.firstLook.limit.why.notSteam");
    case "steam-unreadable":
      return t("paramedic.firstLook.limit.why.steamUnreadable");
    case "steam-no-record":
      return t("paramedic.firstLook.limit.why.steamNoRecord");
    case "steam-no-time":
      return t("paramedic.firstLook.limit.why.steamNoTime");
    case "partial-steam-libraries":
      return t("paramedic.firstLook.limit.why.partialSteamLibraries", { n: l.args.n });
    default:
      return t("paramedic.firstLook.limit.why.other");
  }
}

/** A limit as one sentence. An unread source is "couldn't see", a partly read one "saw only part"; never "nothing changed". */
function limitLine(l: ParamedicLimit, t: T, dates: Dates, game?: string | null): string {
  if (l.code === "classes") return t("paramedic.firstLook.limit.classes");
  if (l.code === "no-install-date") return t("paramedic.firstLook.limit.noInstallDate", { n: l.args.n });
  if (l.code === "not-picked") return t("paramedic.firstLook.limit.gameNotPicked");
  if (l.kind === "facts" && l.code === "no-game-folder") return t("paramedic.firstLook.limit.gameLocation", { game: game ?? "" });
  if (l.kind === "facts" && l.code === "hardware-not-ready") return t("paramedic.firstLook.limit.hardwareNotReady");
  if (l.kind === "facts" && l.code === "unread") return t("paramedic.firstLook.limit.factsUnread", { list: factsUnreadWords(l.args.list ?? "", t) });
  if (l.kind === "history" && l.code === "unreadable") return t("paramedic.firstLook.limit.historyUnreadable");
  if (l.code === "steam-newest-only") return t("paramedic.firstLook.limit.steamNewestOnly", { game: game ?? "" });
  // A graphics-mod or crash-record limit is the measured flow's own "Compy couldn't see" sentence.
  if (l.kind === "mods") {
    const g = game ?? "";
    switch (l.code) {
      case "no-folder":
        return t("paramedic.unknown.modsNoFolder", { game: g });
      case "folder-unreadable":
        return t("paramedic.unknown.modsFolderUnreadable", { game: g });
      case "partial":
        // A mod already found: what is unknown is whether there are other mods.
        return l.args.other === "true" ? t("paramedic.firstLook.limit.modsPartialOther", { game: g }) : t("paramedic.unknown.modsPartial", { game: g });
      case "reader-failed":
        return t("paramedic.firstLook.limit.modsReaderFailed", { game: g });
      default:
        return t("paramedic.unknown.modsUnavailable", { game: g });
    }
  }
  if (l.kind === "crashes") {
    const g = game ?? "";
    switch (l.code) {
      case "unreadable":
        return t("paramedic.unknown.crashesUnreadable", { game: g });
      case "partial":
        return t("paramedic.unknown.crashesPartial", { game: g });
      // e13 r2: beside records of the program name from another folder: no "found none for the game".
      case "partial-elsewhere":
        return t("paramedic.unknown.crashesPartialElsewhere");
      case "no-folder":
        return t("paramedic.firstLook.limit.crashesNoFolder", { game: g });
      case "reader-failed":
        return t("paramedic.firstLook.limit.crashesReaderFailed", { game: g });
      default:
        return t("paramedic.unknown.crashesUnavailable", { game: g });
    }
  }
  const what = limitWhat(l.kind, t, game);
  const why = limitWhy(l, t, dates);
  return l.code.startsWith("partial-") ? t("paramedic.firstLook.limit.partial", { what, why }) : t("paramedic.firstLook.limit.cantSee", { what, why });
}

/** Limits that are always true of a source that WAS read stay in the fold; every other limit hides some or all of a kind, so it is said in its own group. */
const ALWAYS_TRUE = ["classes", "no-install-date", "not-picked", "steam-newest-only"];
const inGroup = (l: ParamedicLimit) => !ALWAYS_TRUE.includes(l.code);

function Chevron() {
  return (
    <span aria-hidden="true" className="gl-para-caret">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </span>
  );
}

/** A disclosure: a button with aria-expanded; nothing inside is rendered until it is opened. */
function Fold({ title, testid, defaultOpen = false, children }: { title: string; testid: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="gl-para-fold" data-testid={testid}>
      <button type="button" className="gl-para-fold-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Chevron />
        {title}
      </button>
      {open && (
        <div id={id} className="gl-para-body">
          {children}
        </div>
      )}
    </div>
  );
}

/** Rows of the group that stay open before the rest wait behind one fold. */
const ROWS_OPEN = 3;

function Rows({ rows, t, dates, game }: { rows: FirstLookChange[]; t: T; dates: Dates; game?: string | null }) {
  // The by-hand line is said once per kind of row in a list, under its newest row, not under every row.
  const said = new Set<string>();
  return (
    <ul className="gl-para-lines" data-testid="first-look-rows">
      {rows.map((c, i) => {
        const first = !said.has(c.how);
        said.add(c.how);
        const how = first ? howText(c.how, t) : null;
        return (
          <li key={`${c.id}-${c.at ?? ""}-${i}`}>
            <p>{changeText(c, t, dates, game)}</p>
            {rowNotes(c, t, dates).map((n, k) => (
              <p key={k} className="gl-para-note">
                {n}
              </p>
            ))}
            {c.args.via_update === "true" && <p className="gl-para-note">{t("paramedic.firstLook.change.viaUpdate")}</p>}
            {how && <p className="gl-para-note">{how}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function noneLine(code: string, t: T, dates: Dates, touch: FirstLookChange[]): string | null {
  switch (code) {
    case "gpu-driver":
      return t("paramedic.firstLook.none.gpuDriver");
    case "windows-update": {
      // "none" is only sent when the Windows Update history was read completely and holds no matching entry. Beside a
      // graphics driver change in the same period the two would read as a contradiction, so the line says that Windows
      // Update's record has no entry for it: that is all Compy saw (not that the driver came another way). With two or
      // more driver changes it names each date or their number, never only one of them. Never when the history couldn't
      // be read: that is a limit, not "none".
      const drivers = touch.filter((c) => c.id.startsWith("gpu-driver") && c.at);
      if (drivers.length === 1 && drivers[0].at) {
        return t("paramedic.firstLook.none.windowsUpdateDriverNoEntry", { when: dates.day(drivers[0].at) });
      }
      return drivers.length > 1
        ? t("paramedic.firstLook.none.windowsUpdateDriversNoEntry", { n: drivers.length })
        : t("paramedic.firstLook.none.windowsUpdate");
    }
    case "programs":
      return t("paramedic.firstLook.none.programs");
    default:
      return null;
  }
}

/** `BUSY`: what the engine answers while another diagnosis or first look is still running ("still checking", never a failure). */
const BUSY = "paramedic-busy";
const BUSY_RETRY_MS = 1200;
const BUSY_RETRIES = 8;

/** Games listed before the rest wait behind "Show more". */
const GAMES_OPEN = 8;

/** The game the user picked. `name` is what the picker showed; the engine returns its own display name. */
type Pick = { kind: "whole-pc" } | { kind: "seen"; process: string; name: string } | { kind: "steam"; app_id: number; name: string };

type Step =
  | { kind: "pick" }
  | { kind: "ask"; chosen: FirstLookSince | null }
  | { kind: "busy"; chosen: FirstLookSince }
  | { kind: "still"; chosen: FirstLookSince }
  | { kind: "failed"; chosen: FirstLookSince }
  | { kind: "done"; chosen: FirstLookSince; a: ParamedicFirstLook };

type Listing = "loading" | "failed" | SteamGames;

/** Two names for one game compare equal when their letters and digits do. */
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function toGame(p: Pick): FirstLookGame {
  if (p.kind === "seen") return { kind: "seen", process: p.process };
  if (p.kind === "steam") return { kind: "steam", app_id: p.app_id, name: p.name };
  return { kind: "whole-pc" };
}

/** "What Compy can't tell yet": rests on how many sessions Compy has recorded. "None" is said only when the read
 *  succeeded and found none; a failed read or a pick Compy couldn't match to a recorded game is "can't tell". */
function cantTellBody(a: ParamedicFirstLook, measured: FirstLookMeasured, t: T): string {
  if (measured) return t("paramedic.firstLook.cantTell.bodyFew", { game: measured.game });
  const r = a.recorded;
  const game = a.game;
  if (!r || r.state !== "read") {
    return game ? t("paramedic.firstLook.cantTell.unreadGame", { game }) : t("paramedic.firstLook.cantTell.unreadPc");
  }
  if (game == null) return r.total ? t("paramedic.firstLook.cantTell.pcRecorded", { count: r.total }) : t("paramedic.firstLook.cantTell.body");
  // The read worked and found sessions, but none under this game's name: "can't tell", said as what it is.
  if (r.unmatched || r.game == null) return t("paramedic.firstLook.cantTell.unmatched", { game });
  if (r.game >= r.need) return t("paramedic.firstLook.cantTell.recorded", { count: r.game, game });
  if (r.game > 0) return t("paramedic.firstLook.cantTell.bodyFew", { game });
  // The read worked and none of the recorded sessions (maybe none at all) belongs to this game.
  return t("paramedic.firstLook.cantTell.noneOfGame", { game });
}

/** The "start a capture and play" line belongs only where more sessions would change the answer. */
function cantTellMeasures(a: ParamedicFirstLook, measured: FirstLookMeasured): boolean {
  if (measured) return true;
  const r = a.recorded;
  if (!r || r.state !== "read") return false;
  if (a.game == null) return !r.total;
  // A pick Compy couldn't match to a recorded game keeps the line: playing it with a capture is what would make it matchable.
  if (r.unmatched || r.game == null) return true;
  return r.game < r.need;
}

/** The picked game's crash records, in the measured flow's own sentences (same keys, same arguments). */
function crashSentence(c: NonNullable<ParamedicFirstLook["crashes"]>, game: string, t: T, dates: Dates): string[] {
  const a = c.args;
  const count = Number(a.n);
  const since = dates.day(a.since);
  const base = a.partial === "true" ? t("paramedic.seen.gameCrashesPartial", { game, count, since }) : t("paramedic.seen.gameCrashes", { game, count, since });
  const byName = a.byName === "true" ? t("paramedic.seen.crashesByName") : "";
  const versions = a.versions ? t("paramedic.seen.crashesVersions", { n: Number(a.versions) }) : "";
  const out = [`${base}${byName}${versions}`];
  if (c.signature_module && c.signature_before) {
    const kind = changeKindText(c.change_kind, t);
    const date = dates.day(c.signature_before);
    // The group titles are the headings the list shows, by their own keys, so the sentence can't drift from them.
    const touch = t("paramedic.firstLook.group.touch");
    const compy = t("paramedic.firstLook.group.compy");
    const what = kind
      ? t("paramedic.firstLook.crash.signatureWhat", { touch, compy, date, kind })
      : t("paramedic.firstLook.crash.signatureWhatNoKind", { touch, compy, date });
    out.push(t("paramedic.seen.gameCrashSignature", { module: c.signature_module, what }));
  }
  return out;
}

/** e13: the measured flow's own sentence for records of the same program name from another folder (one folder shown;
 *  never called the same game or another game). */
function elsewhereSentence(a: Record<string, string>, t: T): string {
  const where = a.folders
    ? t("paramedic.seen.crashesElsewhereFolders", { n: Number(a.folders), folder: a.folder })
    : t("paramedic.seen.crashesElsewhereFolder", { folder: a.folder });
  const count = Number(a.n);
  // A partial read says "at least", as the count line does.
  return a.partial === "true"
    ? t("paramedic.seen.crashesElsewherePartial", { count, exe: a.exe, where })
    : t("paramedic.seen.crashesElsewhere", { count, exe: a.exe, where });
}

/** What kind of change the earliest change is: one Compy applied, or one Windows recorded. The engine sends it with
 *  every date it names; when it is missing the kind is left out, never defaulted. */
function changeKindText(kind: string | null | undefined, t: T): string | null {
  return kind === "compy" ? t("paramedic.seen.changeKind.compy") : kind === "windows" ? t("paramedic.seen.changeKind.windows") : null;
}

/** Counts and dates only: how many readable records fall before and after the earliest dated change. Every count is
 *  "at least". When Compy can't see back past the change it says so instead of saying none. */
function splitSentence(s: FirstLookCrashSplit, kind: string | null | undefined, t: T, dates: Dates): string {
  const date = dates.dayTime(s.change);
  const kindText = changeKindText(kind, t);
  const touch = t("paramedic.firstLook.group.touch");
  const compy = t("paramedic.firstLook.group.compy");
  const what = kindText ? t("paramedic.firstLook.crash.splitWhat", { touch, compy, kind: kindText }) : t("paramedic.firstLook.crash.splitWhatNoKind", { touch, compy });
  // Matched by program name only: the count may include another program of the same name (the measured flow's own hedge).
  const hedge = s.by_name ? t("paramedic.seen.crashesByName") : "";
  return `${splitBody(s, t, dates, date, what)}${hedge}`;
}

function splitBody(s: FirstLookCrashSplit, t: T, dates: Dates, date: string, what: string): string {
  if (s.gap === "starts-later") {
    // Rust always sends the oldest read date with this gap; without it say only what is known (the count after), never that records couldn't be read.
    return s.oldest_read
      ? t("paramedic.firstLook.crash.split.startsLater", { count: s.after, date, what, oldest: dates.dayTime(s.oldest_read) })
      : t("paramedic.firstLook.crash.split.startsLaterNoOldest", { count: s.after, date, what });
  }
  if (s.gap === "unread-after") return t("paramedic.firstLook.crash.split.beforeUnread", { count: s.before, date, what });
  if (s.gap) return t("paramedic.firstLook.crash.split.unread", { count: s.after, date, what });
  if (s.before === 0) return t("paramedic.firstLook.crash.split.afterOnly", { count: s.after, date, what });
  if (s.after === 0) return t("paramedic.firstLook.crash.split.beforeOnly", { count: s.before, date, what });
  return t("paramedic.firstLook.crash.split.both", { count: s.before, after: s.after, date, what });
}

/** Known programs running now, as a fact about now. Never "none" unless the listing was read and held none. */
function RunningNow({ r, game, t }: { r: FirstLookRunning; game: string | null; t: T }) {
  if (r.state === "not-read") return null;
  let body: ReactNode;
  if (r.state === "listed") {
    const names = r.programs.map((p) => p.name).join(t("paramedic.firstLook.running.separator"));
    body = (
      <>
        <p data-testid="first-look-running-list">{r.more > 0 ? t("paramedic.firstLook.running.listedMore", { names, more: r.more }) : t("paramedic.firstLook.running.listed", { names })}</p>
        <p className="gl-para-note" data-testid="first-look-running-now">
          {game ? t("paramedic.firstLook.running.nowGame", { game }) : t("paramedic.firstLook.running.nowPc")}
        </p>
      </>
    );
  } else if (r.state === "none") {
    body = <p data-testid="first-look-running-none">{t("paramedic.firstLook.running.none")}</p>;
  } else {
    const key = r.state === "took-too-long" ? "tookTooLong" : r.state === "reader-failed" ? "readerFailed" : "unread";
    body = (
      <p data-testid="first-look-running-unread">{key === "tookTooLong" ? t("paramedic.firstLook.running.tookTooLong") : key === "readerFailed" ? t("paramedic.firstLook.running.readerFailed") : t("paramedic.firstLook.running.unread")}</p>
    );
  }
  return (
    <div role="group" aria-label={t("paramedic.firstLook.running.title")} data-testid="first-look-running">
      <p>
        <strong>{t("paramedic.firstLook.running.title")}</strong>
      </p>
      {body}
    </div>
  );
}

/** `elsewhere`: opened from a card that already has a measured answer, so the lead does not say there are no earlier sessions.
 */
export function ParamedicFirstLook({
  measured = null,
  games = [],
  elsewhere = false,
  onAsking,
  drifts,
  changes,
}: {
  measured?: FirstLookMeasured;
  games?: RecordedGame[];
  elsewhere?: boolean;
  /** e6: the card's live drift list (null/undefined = not loaded: nothing is said from it). */
  drifts?: Drift[] | null;
  /** e6: the card's ledger list (null/undefined = not read: nothing is said from it). */
  changes?: AppliedChange[] | null;
  /** Told whether the card is still asking ("Which game?", "When did it start?") or has an answer or an outcome to show. */
  onAsking?: (asking: boolean) => void;
} = {}) {
  const { t } = useTranslation();
  const dates = useDates();
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [game, setGame] = useState<Pick | null>(null);
  const [steam, setSteam] = useState<Listing>("loading");
  const [showAll, setShowAll] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const listTimer = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  const headingId = useId();
  const gamesId = useId();

  useEffect(() => {
    alive.current = true;
    // Steam's installed games, read once for the picker. A read that failed is "couldn't read", never "no games".
    const ask = (attempt: number) =>
      invoke<SteamGames | null>("paramedic_list_games", { recorded: games.map((g) => g.process).filter(Boolean) })
        .then((r) => {
          if (alive.current) setSteam(r && Array.isArray(r.games) ? r : "failed");
        })
        .catch((e: unknown) => {
          if (!alive.current) return;
          if (String(e) === BUSY && attempt < BUSY_RETRIES) listTimer.current = window.setTimeout(() => ask(attempt + 1), BUSY_RETRY_MS);
          else setSteam("failed");
        });
    ask(0);
    return () => {
      window.clearTimeout(listTimer.current);
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);
  // Each step's heading takes keyboard focus, so a screen reader starts at the new step. When the measured answer
  // is already on screen above (a game with too few sessions), the first look does not take focus past it on mount.
  const mounted = useRef(false);
  const asking = step.kind === "pick" || step.kind === "ask";
  // Before paint, so the card's green button never flashes while the questions are showing.
  useLayoutEffect(() => {
    onAsking?.(asking);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the step only
  }, [asking]);
  useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (first && measured) return;
    if (step.kind === "pick" || step.kind === "ask" || step.kind === "done") headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the step only
  }, [step.kind]);

  const look = (pick: Pick, since: FirstLookSince, attempt: number) => {
    setStep({ kind: "busy", chosen: since });
    invoke<ParamedicFirstLook | null>("paramedic_first_look", { game: toGame(pick), since })
      .then((a) => {
        if (alive.current) setStep(a ? { kind: "done", chosen: since, a } : { kind: "failed", chosen: since });
      })
      .catch((e: unknown) => {
        if (!alive.current) return;
        if (String(e) !== BUSY) setStep({ kind: "failed", chosen: since });
        else if (attempt < BUSY_RETRIES) timer.current = window.setTimeout(() => look(pick, since, attempt + 1), BUSY_RETRY_MS);
        else setStep({ kind: "still", chosen: since });
      });
  };

  const footer = <p className="gl-para-note">{t("paramedic.firstLook.footer")}</p>;
  const privacy = <p className="gl-para-note" data-testid="first-look-privacy">{t("paramedic.firstLook.privacy")}</p>;
  const choose = (p: Pick) => {
    setGame(p);
    setStep({ kind: "ask", chosen: null });
  };

  if (step.kind === "pick") {
    const recorded = games.filter((g) => g.process && g.name);
    const recordedProcs = new Set(recorded.map((g) => g.process));
    const listed = steam !== "loading" && steam !== "failed" && steam.read ? steam.games : [];
    // A Steam entry is one of the recorded games only when the engine found that recorded game in that very
    // folder. A name alone never merges two games: two of one name stay two, told apart by their drive.
    const installed = listed.filter((g) => !(g.recorded && recordedProcs.has(g.recorded)));
    const nameCount = new Map<string, number>();
    for (const n of [...recorded.map((g) => g.name), ...installed.map((g) => g.name)]) nameCount.set(normName(n), (nameCount.get(normName(n)) ?? 0) + 1);
    const labelOf = (name: string, drive?: string | null) => ((nameCount.get(normName(name)) ?? 0) > 1 && drive ? t("paramedic.firstLook.game.withDrive", { name, drive }) : name);
    type Entry = { key: string; label: string; pick: Exclude<Pick, { kind: "whole-pc" }> };
    const seenAll: Entry[] = recorded.map((g) => ({ key: `seen-${g.process}`, label: g.name, pick: { kind: "seen" as const, process: g.process, name: g.name } }));
    const steamAll: Entry[] = installed.map((g) => ({ key: `steam-${g.app_id}`, label: labelOf(g.name, g.drive), pick: { kind: "steam" as const, app_id: g.app_id, name: g.name } }));
    // At least three Steam games show before "Show more", however many games Compy has recorded.
    const steamFloor = Math.min(3, steamAll.length);
    const seenShown = showAll ? seenAll : seenAll.slice(0, Math.max(0, GAMES_OPEN - steamFloor));
    const steamShown = showAll ? steamAll : steamAll.slice(0, Math.max(0, GAMES_OPEN - seenShown.length));
    const total = seenAll.length + steamAll.length;
    const shownCount = seenShown.length + steamShown.length;
    const isPicked = (p: Pick) => !!game && game.kind === p.kind && (p.kind === "seen" ? game.kind === "seen" && game.process === p.process : p.kind === "steam" ? game.kind === "steam" && game.app_id === p.app_id : true);
    const section = (group: "seen" | "steam", title: string, items: Entry[]) => {
      if (items.length === 0) return null;
      return (
        <div role="group" aria-label={title} data-testid={`first-look-games-${group}`}>
          <p>
            <strong>{title}</strong>
          </p>
          <div className="gl-para-actions">
            {items.map((x) => (
              <button key={x.key} type="button" className="gl-ghost" aria-pressed={isPicked(x.pick)} onClick={() => choose(x.pick)}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
      );
    };
    return (
      <div className="gl-para-body" data-testid="first-look">
        <p data-testid="first-look-lead">
          {measured ? t("paramedic.firstLook.measured.lead", { game: measured.game, have: measured.have, need: measured.need }) : elsewhere ? t("paramedic.firstLook.leadElsewhere") : t("paramedic.firstLook.lead")}
        </p>
        <div role="group" aria-labelledby={headingId} className="gl-para-lead" data-testid="first-look-picker">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="gl-card-title">
            {t("paramedic.firstLook.game.title")}
          </h2>
          {/* e8 r1: the list "Show more" grows and shrinks, named by its aria-controls, so Escape from a game in it
              (the card's rule for an open disclosure) closes the list first and puts focus back on the toggle. */}
          {shownCount > 0 && (
            <div id={gamesId} className="gl-para-lead" data-testid="first-look-games">
              {section("seen", t("paramedic.firstLook.game.seen"), seenShown)}
              {section("steam", t("paramedic.firstLook.game.steam"), steamShown)}
            </div>
          )}
          {steam === "loading" && (
            <p className="gl-card-sub" role="status">
              {t("paramedic.firstLook.game.loadingSteam")}
            </p>
          )}
          {(steam === "failed" || (steam !== "loading" && !steam.read)) && (
            <p className="gl-para-note" data-testid="first-look-steam-unread">
              {t("paramedic.firstLook.game.steamUnread")}
            </p>
          )}
          {steam !== "loading" && steam !== "failed" && steam.read && !steam.complete && (
            <p className="gl-para-note" data-testid="first-look-steam-partial">
              {t("paramedic.firstLook.game.steamPartial")}
            </p>
          )}
          {total > shownCount || (showAll && total > GAMES_OPEN) ? (
            <div>
              <button type="button" className="gl-ghost" aria-expanded={showAll} aria-controls={gamesId} onClick={() => setShowAll((s) => !s)}>
                {showAll ? t("paramedic.firstLook.game.fewer") : t("paramedic.firstLook.game.more", { n: total - shownCount })}
              </button>
            </div>
          ) : null}
          <div className="gl-para-actions">
            <button type="button" className="gl-ghost" aria-pressed={game?.kind === "whole-pc"} onClick={() => choose({ kind: "whole-pc" })}>
              {t("paramedic.firstLook.game.other")}
            </button>
          </div>
        </div>
        {footer}
        {privacy}
      </div>
    );
  }

  if (step.kind !== "done") {
    const busy = step.kind === "busy";
    const pick = game ?? { kind: "whole-pc" as const };
    const name = game && game.kind !== "whole-pc" ? game.name : null;
    return (
      <div className="gl-para-body" data-testid="first-look">
        <p data-testid="first-look-lead">
          {measured ? t("paramedic.firstLook.measured.lead", { game: measured.game, have: measured.have, need: measured.need }) : elsewhere ? t("paramedic.firstLook.leadElsewhere") : t("paramedic.firstLook.lead")}
        </p>
        <p data-testid="first-look-chosen">{name ? t("paramedic.firstLook.game.chosen", { game: name }) : t("paramedic.firstLook.game.chosenWhole")}</p>
        <div role="group" aria-labelledby={headingId} className="gl-para-lead">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="gl-card-title">
            {t("paramedic.firstLook.when.title")}
          </h2>
          <div className="gl-para-actions">
            {CHOICES.map(({ since }) => (
              <button
                key={since}
                type="button"
                className="gl-ghost"
                aria-pressed={step.chosen === since}
                // Busy: aria-disabled, not disabled, so keyboard focus is not lost; a tap while busy is ignored.
                aria-disabled={busy}
                onClick={() => {
                  if (!busy) look(pick, since, 0);
                }}
              >
                {choiceLabel(since, t)}
              </button>
            ))}
          </div>
        </div>
        {busy && (
          <p className="gl-card-sub" role="status">
            {t("paramedic.firstLook.looking")}
          </p>
        )}
        {step.kind === "still" && (
          <p className="gl-card-sub" role="status">
            {t("paramedic.door.stillChecking")}
          </p>
        )}
        {step.kind === "failed" && (
          <p className="gl-card-sub" role="alert">
            {t("paramedic.door.failed")}
          </p>
        )}
        <div>
          <button type="button" className="gl-ghost" data-testid="first-look-change-game" onClick={() => setStep({ kind: "pick" })}>
            {t("paramedic.firstLook.game.change")}
          </button>
        </div>
        {footer}
        {privacy}
      </div>
    );
  }

  const { a } = step;
  const gameName = a.game;
  // Definition and Store-app updates are daily routine: they are counted inside the limits fold, not listed.
  const minor = a.other_changes.find((c) => c.id === "updates-minor");
  const otherRows = a.other_changes.filter((c) => c.id !== "updates-minor");
  // e6: Compy's own changes, with those made before the window and undone inside it (from the card's ledger list),
  // newest first by the time that falls inside the window; and its settings noticed off inside the window.
  const eventAt = (c: CompyChange, early: boolean) => instant(early ? c.undone_at : c.at) ?? 0;
  const compyAll = [...a.compy_changes.map((c) => ({ c, at: eventAt(c, false) })), ...undoneInWindow(changes, a).map((c) => ({ c, at: eventAt(c, true) }))]
    .sort((x, y) => y.at - x.at)
    .map((x) => x.c);
  const offNow = offNowInWindow(drifts, a);
  // r2 S1: flagged in the window, but when it changed isn't known: neither listed as a change nor "no dated change".
  const offAmbiguous = offNowAmbiguous(drifts, a);
  const empty = a.touch_games.length === 0 && otherRows.length === 0 && compyAll.length === 0 && offNow.length === 0 && !offAmbiguous;
  const touchLimits = a.limits.filter((l) => inGroup(l) && (l.kind === "driver" || l.kind === "windows-update" || l.kind === "game-update"));
  const programLimits = a.limits.filter((l) => inGroup(l) && l.kind === "programs");
  const open = a.touch_games.slice(0, ROWS_OPEN);
  const rest = a.touch_games.slice(ROWS_OPEN);
  const noneTouch = a.none.filter((n) => n === "gpu-driver" || n === "windows-update");
  const nonePrograms = a.none.includes("programs");
  const touchNotes = !!gameName && (a.game_files_since !== null || a.mods_none);
  // "Still reading this PC's hardware" is said in the block it empties, not only in the limits fold.
  const waiting = a.limits.find((l) => l.kind === "facts" && l.code === "hardware-not-ready");
  const foldLimits = a.limits.filter((l) => l !== waiting);
  const offBlock = a.crashes !== null || a.crashes_none || !!a.crashes_elsewhere || a.looks_off.length > 0 || a.facts.length > 0 || !!waiting;
  // A settings or data file of a mod is not something "off": it is said beside what Compy also looked at.
  const settingsOnly = gameName ? a.mods_settings_only : [];
  const factsOpen = a.facts.slice(0, ROWS_OPEN);
  const factsRest = a.facts.slice(ROWS_OPEN);
  const compyOpen = compyAll.slice(0, ROWS_OPEN);
  const compyRest = compyAll.slice(ROWS_OPEN);
  const offOpen = offNow.slice(0, ROWS_OPEN);
  const offRest = offNow.slice(ROWS_OPEN);
  // The shared words beside a list of changes: listed by time only, none of them shown to be the cause.
  const notCause = <span className="gl-row-sub" data-testid="first-look-not-cause">{t("gaming.blackBox.changedBefore.notProven")}</span>;
  const offRows = (rows: OffNow[]) => (
    <ul className="gl-para-lines" data-testid="first-look-off-now-rows">
      {rows.map((o, i) => (
        <li key={`${o.noticed}-${i}`}>
          <p>{offNowText(o, t, dates)}</p>
        </li>
      ))}
    </ul>
  );
  const factRows = (rows: FirstLookFact[]) => (
    <ul className="gl-para-lines" data-testid="first-look-facts">
      {rows.map((f, i) => {
        const how = factHow(f.id, t);
        return (
          <li key={`${f.id}-${i}`}>
            <p>{factText(f, t, gameName, dates)}</p>
            {how && <p className="gl-para-note">{how}</p>}
          </li>
        );
      })}
    </ul>
  );
  const compyRows = (rows: CompyChange[]) => (
    <ul className="gl-para-lines" data-testid="first-look-compy-rows">
      {rows.map((c, i) => (
        <li key={`${c.at}-${i}`}>
          <p>{compyText(c, t, dates)}</p>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="gl-para-body" data-testid="first-look">
      <h2 ref={headingRef} tabIndex={-1} className="gl-card-title">
        {gameName ? t("paramedic.firstLook.game.found", { game: gameName }) : t("paramedic.firstLook.title")}
      </h2>
      {measured && !gameName && <p data-testid="first-look-scope">{t("paramedic.firstLook.measured.scope")}</p>}
      <div role="group" aria-label={t("paramedic.firstLook.told.title")}>
        <p>
          <strong>{t("paramedic.firstLook.told.title")}</strong>
        </p>
        <p data-testid="first-look-told">{toldText(a, t, dates)}</p>
      </div>
      {!a.changes_listed && <p data-testid="first-look-always">{t("paramedic.firstLook.alwaysBody")}</p>}
      {!a.changes_listed && gameName && a.mods_none && (
        <p className="gl-para-note" data-testid="first-look-mods-none">
          {t("paramedic.checked.graphicsMod", { game: gameName })}
        </p>
      )}
      {offBlock && (
            <div role="group" aria-label={t("paramedic.firstLook.group.looksOff")} data-testid="first-look-off">
              <p>
                <strong>{t("paramedic.firstLook.group.looksOff")}</strong>
              </p>
              {gameName && a.crashes && (
                <div data-testid="first-look-crashes">
                  {crashSentence(a.crashes, gameName, t, dates).map((s, i) => (
                    <p key={i} className={i === 0 ? undefined : "gl-para-note"}>
                      {s}
                    </p>
                  ))}
                  {a.crashes.split && (
                    <p className="gl-para-note" data-testid="first-look-crash-split">
                      {splitSentence(a.crashes.split, a.crashes.change_kind, t, dates)}
                    </p>
                  )}
                </div>
              )}
              {/* e13: never "no crash record for the game" beside records of its program name from another folder. */}
              {gameName && a.crashes_none && !a.crashes_elsewhere && (
                <p className="gl-para-note" data-testid="first-look-crashes-none">
                  {t("paramedic.firstLook.crash.none", { game: gameName })}
                </p>
              )}
              {gameName && a.crashes_elsewhere && (
                <p className="gl-para-note" data-testid="first-look-crashes-elsewhere">
                  {elsewhereSentence(a.crashes_elsewhere, t)}
                </p>
              )}
              {gameName && a.looks_off.length > 0 && <Rows rows={a.looks_off} t={t} dates={dates} game={gameName} />}
              {a.facts.length > 0 && factRows(factsOpen)}
              {factsRest.length > 0 && (
                <Fold title={t("paramedic.firstLook.group.more", { n: factsRest.length })} testid="first-look-facts-more">
                  {factRows(factsRest)}
                </Fold>
              )}
              {a.facts.length > 0 && (
                <p className="gl-para-note" data-testid="first-look-facts-note">
                  {t("paramedic.firstLook.group.looksOffNote")}
                </p>
              )}
              {waiting && (
                <p className="gl-para-note" data-testid="first-look-facts-waiting">
                  {limitLine(waiting, t, dates, gameName)}
                </p>
              )}
            </div>
          )}
      <RunningNow r={a.running_now} game={gameName} t={t} />
      {a.changes_listed && (
        <>
          {compyAll.length > 0 && (
            <div role="group" aria-label={t("paramedic.firstLook.group.compy")} data-testid="first-look-compy">
              <p>
                <strong>{t("paramedic.firstLook.group.compy")}</strong> {notCause}
              </p>
              {compyRows(compyOpen)}
              {compyRest.length > 0 && (
                <Fold title={t("paramedic.firstLook.group.more", { n: compyRest.length })} testid="first-look-compy-more">
                  {compyRows(compyRest)}
                </Fold>
              )}
              {compyAll.some((c) => !c.undone) && <p className="gl-para-note">{t("paramedic.firstLook.compy.undoHint")}</p>}
            </div>
          )}
          {(offNow.length > 0 || offAmbiguous) && (
            <div role="group" aria-label={t("paramedic.firstLook.group.offNow")} data-testid="first-look-off-now">
              <p>
                <strong>{t("paramedic.firstLook.group.offNow")}</strong> {notCause}
              </p>
              {offNow.length > 0 && offRows(offOpen)}
              {offRest.length > 0 && (
                <Fold title={t("paramedic.firstLook.group.more", { n: offRest.length })} testid="first-look-off-now-more">
                  {offRows(offRest)}
                </Fold>
              )}
              {offAmbiguous && (
                <p className="gl-para-note" data-testid="first-look-off-now-ambiguous">
                  {t("paramedic.firstLook.compy.offNowAmbiguous")}
                </p>
              )}
            </div>
          )}
          {(open.length > 0 || noneTouch.length > 0 || touchLimits.length > 0 || touchNotes) && (
            <div role="group" aria-label={t("paramedic.firstLook.group.touch")} data-testid="first-look-touch">
              <p>
                <strong>{t("paramedic.firstLook.group.touch")}</strong>
              </p>
              {open.length > 0 && <Rows rows={open} t={t} dates={dates} game={gameName} />}
              {rest.length > 0 && (
                <Fold title={t("paramedic.firstLook.group.more", { n: rest.length })} testid="first-look-touch-more">
                  <Rows rows={rest} t={t} dates={dates} game={gameName} />
                </Fold>
              )}
              {noneTouch.map((n) => (
                <p key={n} className="gl-para-note">
                  {noneLine(n, t, dates, a.touch_games)}
                </p>
              ))}
              {gameName && a.game_files_since && (
                <p className="gl-para-note" data-testid="first-look-game-files-since">
                  {t("paramedic.firstLook.change.gameFilesSince", { game: gameName, when: dates.day(a.game_files_since) })}
                </p>
              )}
              {gameName && a.mods_none && (
                <p className="gl-para-note" data-testid="first-look-mods-none">
                  {t("paramedic.checked.graphicsMod", { game: gameName })}
                </p>
              )}
              {touchLimits.map((l, i) => (
                <p key={`${l.kind}-${l.code}-${i}`} className="gl-para-note" data-testid="first-look-group-limit">
                  {limitLine(l, t, dates, gameName)}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {a.changes_listed && (
        <>
          {(otherRows.length > 0 || nonePrograms || programLimits.length > 0) && (
            <Fold title={t("paramedic.firstLook.group.other")} testid="first-look-other">
              {otherRows.length > 0 && <Rows rows={otherRows} t={t} dates={dates} game={gameName} />}
              {nonePrograms && <p className="gl-para-note">{noneLine("programs", t, dates, a.touch_games)}</p>}
              {programLimits.map((l, i) => (
                <p key={`${l.kind}-${l.code}-${i}`} className="gl-para-note" data-testid="first-look-group-limit">
                  {limitLine(l, t, dates, gameName)}
                </p>
              ))}
            </Fold>
          )}
          {empty && a.read_all && !minor && <p data-testid="first-look-nothing">{t("paramedic.firstLook.nothing")}</p>}
          {empty && !a.read_all && <p data-testid="first-look-unread">{t("paramedic.firstLook.unread")}</p>}
        </>
      )}
      {(foldLimits.length > 0 || (a.changes_listed && minor) || settingsOnly.length > 0) && (
        <Fold title={t("paramedic.firstLook.limit.title")} testid="first-look-limits" defaultOpen={a.changes_listed && empty && !a.read_all}>
          <ul className="gl-para-lines">
            {a.changes_listed && minor && <li>{changeText(minor, t, dates)}</li>}
            {settingsOnly.map((name) => (
              <li key={`settings-${name}`} data-testid="first-look-mod-settings-only">
                {t("paramedic.seen.modSettingsOnly", { game: gameName, name })}
              </li>
            ))}
            {foldLimits.map((l, i) => (
              <li key={`${l.kind}-${l.code}-${i}`}>{limitLine(l, t, dates, gameName)}</li>
            ))}
          </ul>
        </Fold>
      )}
      <div role="group" aria-label={t("paramedic.firstLook.cantTell.title")} data-testid="first-look-cant-tell">
        <p>
          <strong>{t("paramedic.firstLook.cantTell.title")}</strong>
        </p>
        <p data-testid="first-look-cant-tell-body">{cantTellBody(a, measured, t)}</p>
        {cantTellMeasures(a, measured) && <p>{t("paramedic.firstLook.cantTell.measure")}</p>}
      </div>
      <div className="gl-para-actions">
        <button type="button" className="gl-ghost" onClick={() => setStep({ kind: "ask", chosen: step.chosen })}>
          {t("paramedic.firstLook.changeWhen")}
        </button>
        <button type="button" className="gl-ghost" data-testid="first-look-change-game" onClick={() => setStep({ kind: "pick" })}>
          {t("paramedic.firstLook.game.change")}
        </button>
      </div>
      {footer}
      {privacy}
    </div>
  );
}
