// PC Paramedic F1: the "Something's wrong" door on Health and the card that answers it. It asks the engine
// (`paramedic_diagnose`) on a tap, shows what the engine returned in plain words, and offers steps the owner does
// in Windows. Its one action (B3, owner decision 2026-11-21) is "Turn it back on" for a setting Compy applied that
// reads off now, and it is the Test room's own path (src/data/turn-back-on.ts: the same confirm, the same audited
// apply, the same undo). B10 (owner decision 2026-11-24, no-admin undos only) adds "Undo this Compy change" on the
// compy-change row: the card only decides what to offer (src/data/compy-undo.ts) and passes ids to App's
// `undoOneRecord`, which re-reads at the click and makes one `rollback_change` through App's own confirm. Nothing else
// here changes the PC. It says what changed before the problem, never that it caused it (Constitution 17). The engine
// returns codes and numbers; every sentence here is a locale string. Keys are literal, one t() call per key (never
// composed).
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { driftShort, stampOf } from "../drift-named";
import { requestCheckFocus } from "../check-focus";
import { roughLine, type RoughGame } from "../home-facts";
import { turnBackOn, type RevertedChange } from "../../data/turn-back-on";
import { compyUndoOffer, type CardUndoResult, type CompyUndoOffer } from "../../data/compy-undo";
import { useConfirmOptional } from "../../design/ConfirmDialog";
import type {
  AppliedChange,
  Drift,
  ParamedicDiagnosis,
  ParamedicEvidence,
  ParamedicFinding,
  ParamedicFix,
  ParamedicLimit,
  ParamedicNow,
  ParamedicRuledOut,
  ParamedicStartRecord,
  ParamedicWhen,
} from "../../types";
import { useDates } from "./GamesRoom";
import { ParamedicFirstLook, firstLookApplies, firstLookMeasured, type RecordedGame } from "./ParamedicFirstLook";

type T = ReturnType<typeof useTranslation>["t"];
type Dates = ReturnType<typeof useDates>;
/** Which sessions have a record of what was running at the start (rough and normal), and the programs that were open
 *  in every recorded rough one. */
type StartRecord = ParamedicStartRecord;
/** What one drift notice can say about its setting: `named` (the live drift is the same notice and has its title),
 *  `notLoaded` (no drift list, an unreadable check, or a live drift that is not the notice the engine found: Compy
 *  couldn't read which setting it was), `notRecorded` (the list is loaded and the setting is not off now, or has no title). */
type DriftState = "named" | "notLoaded" | "notRecorded";
/** `drifts`: the settings Compy watches that read changed now (the same list Home names them from); null/undefined =
 *  the list was not loaded, [] = loaded and nothing drifting. `lang`: the app's language for a stamp. `driftState`: set
 *  while one finding's evidence is worded, for what its drift lines could say about the setting. */
type Ctx = {
  t: T;
  dates: Dates;
  game: string;
  drifts?: Drift[] | null;
  lang?: string;
  startRecord?: StartRecord;
  driftState?: DriftState;
  /** Opens the health check (where the one-press "turn it back on" lives). Absent where the card has no such screen. */
  onOpenCheck?: () => void;
  /** B3: "Turn it back on" in the card, through the Lab's own path. Absent when the card cannot offer it. */
  reapply?: Reapply;
  /** B10: "Undo this Compy change" on the compy-change row. Absent when the card cannot offer it. */
  compyUndo?: CompyUndo;
};

/** B10: the ledger list the card was given (to draw from; App re-reads at the click), the settings the drift list names
 *  (null = not loaded), the record being undone, what each press came back with, and the press handler (ids only). */
type CompyUndo = {
  list: AppliedChange[];
  driftRecs: ReadonlySet<string> | null;
  busy: string | null;
  results: Record<string, CardUndoResult["kind"]>;
  press: (recId: string, id: string) => void;
};

/** B3: the settings this card may turn back on (the ledger says Compy applied them and they read off now, and the live
 *  drift names them), which one is being turned on, which were turned on from this card (with the ledger's time), and
 *  the press handler. */
type Reapply = {
  offer: RevertedChange[];
  busy: string | null;
  done: { rec_id: string; title: string; at: string }[];
  press: (rev: RevertedChange) => void;
};

const RAW = { interpolation: { escapeValue: false } } as const;

const sameInstant = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  const [x, y] = [new Date(a).getTime(), new Date(b).getTime()];
  return Number.isFinite(x) && x === y;
};

/** The live drift for a check, but only when it is the notice the engine's line is about (same `noticed_at`): a setting
 *  that went off later, or came back and went off again, is a different event and is not named as this one. */
function liveDrift(check: string, noticed: string | undefined, ctx: Ctx): Drift | undefined {
  const d = (ctx.drifts ?? []).find((x) => x.id === check);
  return d && sameInstant(d.noticed_at, noticed) ? d : undefined;
}

/** The applied changes now off, named from the drift list Home uses. An unreadable check names none (as drift-named.ts). */
function appliedTitles(ctx: Ctx, noticed: string | undefined): { titles: string[]; appliedAt: string | null } {
  const d = liveDrift("applied-changes", noticed, ctx);
  if (!d || d.unreadable_now === true) return { titles: [], appliedAt: null };
  const titles = (d.titles ?? []).filter((x) => x.trim() !== "");
  // The date is the ledger's own stamp for that change, only when there is exactly one change.
  const appliedAt = titles.length === 1 && d.titles?.length === 1 ? stampOf(d.applied_at?.[0], ctx.lang ?? "en") : null;
  return { titles, appliedAt };
}

/** What a drift notice can say about its setting, from the live drift list Home names it from. */
function driftState(check: string, noticed: string | undefined, ctx: Ctx): DriftState {
  if (check === "power-profile") return "named";
  if (ctx.drifts == null) return "notLoaded";
  const d = (ctx.drifts ?? []).find((x) => x.id === check);
  if (!d) return "notRecorded";
  if (d.unreadable_now === true || !liveDrift(check, noticed, ctx)) return "notLoaded";
  const named = check === "applied-changes" ? appliedTitles(ctx, noticed).titles.length > 0 : !!d.label?.trim();
  return named ? "named" : "notRecorded";
}

/** The drift list's own words for what changed, per the same notice the engine found. */
function driftLine(check: string, noticed: string | undefined, ctx: Ctx, state: DriftState): string {
  const { t } = ctx;
  if (check === "applied-changes") {
    const { titles, appliedAt } = appliedTitles(ctx, noticed);
    if (state !== "named" || titles.length === 0) return t("paramedic.evidence.driftApplied");
    const named = t("paramedic.evidence.driftAppliedNamed", { count: titles.length, titles: titles.join(", "), ...RAW });
    return appliedAt ? `${named} ${t("common.driftNamed.applied.onDate", { when: appliedAt, ...RAW })}` : named;
  }
  if (check === "power-profile") return t("paramedic.evidence.driftPower");
  const d = liveDrift(check, noticed, ctx);
  if (state === "named" && d) return t("paramedic.evidence.driftOtherNamed", { what: driftShort(d, t), ...RAW });
  return t("paramedic.evidence.driftOther");
}

/** The order the records give, as plain facts and only when both stamps exist: last seen as it was, then noticed changed. */
function driftOrder(check: string, a: Record<string, string>, ctx: Ctx): string | null {
  const lang = ctx.lang ?? "en";
  const seen = stampOf(a.ready, lang);
  const noticed = stampOf(a.noticed, lang);
  if (!seen || !noticed) return null;
  return check === "applied-changes"
    ? ctx.t("paramedic.evidence.driftSeenThenOff", { seen, noticed, ...RAW })
    : ctx.t("paramedic.evidence.driftSeenThenChanged", { seen, noticed, ...RAW });
}

const pct = (ratio: number) => Math.round(ratio * 100);
const tenth = (n: number) => String(Math.round(n * 10) / 10);

/** The card's word for a frame-cap state the engine sent as "unknown", "uncapped" or whole fps. */
function capWord(v: string, t: T): string {
  if (v === "uncapped") return t("paramedic.cap.none");
  if (v === "unknown") return t("paramedic.cap.unknown");
  return t("paramedic.cap.at", { fps: v });
}

function whatText(id: string, t: T): string | null {
  switch (id) {
    case "frame-cap-change":
      return t("paramedic.finding.frameCapChange.what");
    case "gpu-driver-change":
      return t("paramedic.finding.gpuDriver.what");
    case "background-load":
      return t("paramedic.finding.backgroundLoad.what");
    case "memory-pressure":
      return t("paramedic.finding.memoryPressure.what");
    case "setting-drift":
      return t("paramedic.finding.settingDrift.what");
    case "compy-change":
      return t("paramedic.finding.compyChange.what");
    case "hardware-change":
      return t("paramedic.finding.hardwareChange.what");
    case "power-plan-change":
      return t("paramedic.finding.powerPlanChange.what");
    case "display-refresh-lower":
      return t("paramedic.finding.displayRefreshLower.what");
    case "windows-build-change":
      return t("paramedic.finding.windowsBuildChange.what");
    case "windows-update":
      return t("paramedic.finding.windowsUpdate.what");
    case "other-driver-change":
      return t("paramedic.finding.otherDriver.what");
    case "gpu-hotter":
      return t("paramedic.finding.gpuHotter.what");
    default:
      return null;
  }
}

/** A finding's heading. A setting that drifted is named for what the records say: Compy-applied only when every notice is. */
function findingTitle(f: ParamedicFinding, { t, dates, game }: Ctx): string | null {
  if (f.id === "setting-drift") {
    const drift = f.evidence.filter((e) => e.code === "drift-noticed");
    // Every setting listed came back on: the heading says it went off and came back, not that it is no longer on.
    // Only the applied-changes row has a "back on" story: any other check that changed and read fine again is said
    // as a dated "seen" line, never as a setting that came back on.
    if (drift.length > 0 && drift.every((e) => !!e.args.restored && e.args.check === "applied-changes")) {
      return t("paramedic.finding.settingDrift.appliedRestored");
    }
    if (drift.length > 0 && drift.every((e) => e.args.check === "applied-changes")) return t("paramedic.finding.settingDrift.applied");
  }
  // Steam's time moves on an update, a file verification or added content: the heading says only that the files changed.
  if (f.id === "game-files-change" && f.since_when.kind === "exact") {
    return t("paramedic.finding.gameFiles.what", { game, when: dates.day(f.since_when.at) });
  }
  // The mod's own name comes from the engine's fixed table, never from a file.
  if (f.id === "graphics-mod" && f.fix.kind === "steps") {
    return t("paramedic.finding.graphicsMod.what", { game, name: f.fix.args.name });
  }
  // When the support is a recorded load figure (not just programs seen starting), the heading says it was measured.
  if (f.id === "background-load" && f.evidence.some((e) => e.code.startsWith("load-") && e.args.how === "high")) {
    return t("paramedic.finding.backgroundLoad.measured");
  }
  // Support in the judged session that is only "already open when the game started" (no start was seen in it; starts
  // seen in other sessions are said on their own lines): the heading says that, not "started".
  if (
    f.id === "background-load" &&
    f.evidence.some((e) => e.code === "already-running") &&
    !f.evidence.some((e) => e.code === "starts-seen")
  ) {
    // The lines under it also say programs were seen starting in a partly measured or another game's session: the
    // heading names both, so it never says only "already open" over lines about starts (or the other way round).
    const partial = f.evidence.some((e) => e.code === "starts-seen-partial") ? 1 : 0;
    const other = f.evidence.filter((e) => e.code === "starts-seen-other").reduce((n, e) => n + (Number(e.args.count) || 1), 0);
    if (partial + other > 0) return t("paramedic.finding.backgroundLoad.openNearby", { count: partial + other });
    return t("paramedic.finding.backgroundLoad.open");
  }
  // Starts seen only in a partly measured session or in another game's sessions, none in the rough session(s)
  // being judged ("starts-seen"): the heading says they were seen in other sessions, not while you played. The
  // count is the sessions those lines name: the partly measured one (one) plus the other game's (their count).
  if (
    f.id === "background-load" &&
    !f.evidence.some((e) => e.code === "starts-seen") &&
    f.evidence.some((e) => e.code === "starts-seen-partial" || e.code === "starts-seen-other")
  ) {
    const partial = f.evidence.some((e) => e.code === "starts-seen-partial") ? 1 : 0;
    const other = f.evidence.filter((e) => e.code === "starts-seen-other").reduce((n, e) => n + (Number(e.args.count) || 1), 0);
    return t("paramedic.finding.backgroundLoad.nearby", { count: partial + other });
  }
  // Installs carry a day, never a time of day: the heading names the day.
  if (f.id === "program-installed") {
    const day = f.evidence.find((e) => e.code === "installed-and-started")?.args.day;
    if (day) return t("paramedic.finding.programInstalled.what", { day: dates.day(day) });
  }
  return whatText(f.id, t);
}

/** The engine's driver class words ("audio", "network", "chipset/system"), in the card's language. */
function driverClasses(list: string, t: T): string {
  return list
    .split(", ")
    .map((c) => {
      if (c === "audio") return t("paramedic.driverClass.audio");
      if (c === "network") return t("paramedic.driverClass.network");
      if (c.startsWith("chipset")) return t("paramedic.driverClass.chipset");
      return c;
    })
    .join(", ");
}

function sinceText(w: ParamedicWhen, { t, dates }: Ctx): string | null {
  switch (w.kind) {
    case "observed-between":
      return t("paramedic.since.between", { a: dates.dayTime(w.from), b: dates.dayTime(w.to) });
    case "exact":
      return t("paramedic.since.exact", { when: dates.dayTime(w.at) });
    case "seen":
      return t("paramedic.since.seen", { when: dates.dayTime(w.at) });
    default:
      return null;
  }
}

/**
 * One recorded figure of how busy everything except the game was, in the sentence for what it says:
 * `high` and `between` give the numbers, `same` says "about the same", and the two one-sided states say
 * which side Compy did not record. Literal keys, one per sentence.
 */
function loadLine(code: string, a: Record<string, string>, t: T): string | null {
  const count = Number(a.count ?? 1);
  const { rough, base } = a;
  if (code === "load-cpu") {
    if (a.how === "same") return t("paramedic.evidence.loadCpuSame", { count, rough, base });
    if (a.how === "rough-only") return t("paramedic.evidence.loadCpuRoughOnly", { count, rough });
    if (a.how === "base-only") return t("paramedic.evidence.loadCpuBaseOnly", { base });
    return t("paramedic.evidence.loadCpu", { count, rough, base });
  }
  if (code === "load-gpu3d") {
    if (a.how === "same") return t("paramedic.evidence.loadGpu3dSame", { count, rough, base });
    if (a.how === "rough-only") return t("paramedic.evidence.loadGpu3dRoughOnly", { count, rough });
    if (a.how === "base-only") return t("paramedic.evidence.loadGpu3dBaseOnly", { base });
    return t("paramedic.evidence.loadGpu3d", { count, rough, base });
  }
  if (code === "load-gpuvideo") {
    if (a.how === "same") return t("paramedic.evidence.loadGpuVideoSame", { count, rough, base });
    if (a.how === "rough-only") return t("paramedic.evidence.loadGpuVideoRoughOnly", { count, rough });
    if (a.how === "base-only") return t("paramedic.evidence.loadGpuVideoBaseOnly", { base });
    return t("paramedic.evidence.loadGpuVideo", { count, rough, base });
  }
  return null;
}

function evidenceLine(e: ParamedicEvidence, ctx: Ctx): string | null {
  const { t, dates, game } = ctx;
  const a = e.args;
  switch (e.code) {
    case "driver-changed":
      return t("paramedic.evidence.driverChanged", { from: a.from, to: a.to });
    case "sessions-split":
      return t("paramedic.evidence.sessionsSplit", { game, date: dates.day(a.baselineAt), count: Number(a.count) });
    case "sessions-split-partly":
      return t("paramedic.evidence.sessionsSplitPartly", { game, date: dates.day(a.baselineAt), count: Number(a.count) });
    case "cross-game":
      // "Never before it" only when every earlier session of that game ran normally.
      return a.neverBefore === "true"
        ? t("paramedic.evidence.crossGame", { games: a.games })
        : t("paramedic.evidence.crossGameAfter", { games: a.games });
    case "gpu-temp":
      return t("paramedic.seen.gpuTemp", { count: Number(a.count), rough: a.rough, base: a.base });
    // Dates of files in the game's folder: when they were created or last written, never "installed on".
    case "mod-files-created":
      return t("paramedic.evidence.modFilesCreated", { first_seen: dates.day(a.date) });
    case "mod-settings-changed":
      return t("paramedic.evidence.modSettingsChanged", { date: dates.day(a.date) });
    case "mod-log-written":
      return t("paramedic.evidence.modLogWritten", { date: dates.day(a.date) });
    case "mod-log-before-rough":
      return t("paramedic.evidence.modLogBeforeRough");
    case "cross-game-mod":
      return t("paramedic.evidence.crossGameMod", { otherGame: a.otherGame, name: a.name });
    case "cross-game-mod-unchecked":
      return t("paramedic.evidence.crossGameModUnchecked", { otherGame: a.otherGame });
    case "install-recorded":
      return t("paramedic.evidence.installRecorded", { when: dates.dayTime(a.when) });
    case "install-not-recorded":
      return t("paramedic.evidence.installNotRecorded", { when: dates.dayTime(a.seenAt) });
    case "install-after-rough":
      return t("paramedic.evidence.installAfterRough", { when: dates.dayTime(a.when) });
    case "update-installed":
      return a.kb
        ? t("paramedic.evidence.updateInstalled", { kb: a.kb, when: dates.dayTime(a.when) })
        : t("paramedic.evidence.updateInstalledNoKb", { when: dates.dayTime(a.when) });
    case "delivered-by-update":
      return t("paramedic.evidence.deliveredByUpdate");
    case "reinstall-same-version":
      return t("paramedic.evidence.reinstallSameVersion", { when: dates.dayTime(a.when) });
    case "install-prior-unknown":
      return t("paramedic.evidence.installPriorUnknown", { when: dates.dayTime(a.when) });
    case "update-more":
      return t("paramedic.evidence.updateMore", { count: Number(a.count) });
    case "files-changed":
      return t("paramedic.evidence.filesChanged", { game, when: dates.dayTime(a.when) });
    case "installed-and-started":
      return t("paramedic.evidence.installedAndStarted", { name: a.name, day: dates.day(a.day) });
    case "other-driver-installed":
      return t("paramedic.evidence.otherDriverInstalled", {
        count: Number(a.count),
        classes: driverClasses(a.classes, t),
        when: dates.dayTime(a.when),
      });
    case "install-time-not-read":
      return t("paramedic.evidence.installTimeNotRead", { when: dates.dayTime(a.seenAt) });
    case "rough-on-old-driver":
      // B4: dated and never "still": a rough session on the earlier driver ran after Compy had seen the new one.
      return t("paramedic.evidence.roughOnOldDriver", { count: Number(a.count), from: a.from, date: dates.day(a.date) });
    // Each count says what it counts, and the names belong to the line they came from.
    case "starts-seen":
      return a.names
        ? t("paramedic.evidence.startsSeen", { game, names: a.names, count: Number(a.count) })
        : t("paramedic.evidence.startsSeenNoNames", { game, count: Number(a.count) });
    case "starts-seen-partial":
      return a.names
        ? t("paramedic.evidence.startsSeenPartial", { game, names: a.names, date: dates.day(a.date) })
        : t("paramedic.evidence.startsSeenPartialNoNames", { game, date: dates.day(a.date) });
    case "starts-seen-other":
      return a.names
        ? t("paramedic.evidence.startsSeenOther", { otherGame: a.otherGame, names: a.names, count: Number(a.count), date: dates.day(a.date) })
        : t("paramedic.evidence.startsSeenOtherNoNames", { otherGame: a.otherGame, count: Number(a.count), date: dates.day(a.date) });
    case "gap-change": {
      const when = a.day === "true" ? dates.day(a.when) : dates.dayTime(a.when);
      let what: string;
      if (a.kind === "gpu-driver") {
        what = a.detail ? t("paramedic.evidence.gapGpuDriverVersion", { version: a.detail }) : t("paramedic.evidence.gapGpuDriver");
      } else if (a.kind === "other-driver") what = t("paramedic.evidence.gapOtherDriver");
      else if (a.kind === "windows-update") {
        what = a.detail ? t("paramedic.evidence.gapUpdateKb", { kb: a.detail }) : t("paramedic.evidence.gapUpdate");
      } else if (a.kind === "game-files") what = t("paramedic.evidence.gapFiles", { game });
      else what = a.detail ? t("paramedic.evidence.gapProgramNamed", { name: a.detail }) : t("paramedic.evidence.gapProgram");
      // A day record that only partly lies in the stretch has no time of day: it is not said to be "between".
      if (a.placed === "false") return t("paramedic.evidence.gapDayUnplaced", { what, when });
      return t("paramedic.evidence.gapChange", { what, when });
    }
    case "gap-build":
      return t("paramedic.evidence.gapBuild", { from: a.from, to: a.to });
    case "gap-unread":
      return t("paramedic.evidence.gapUnread");
    case "recovered-ram-rough-lower":
      return t("paramedic.evidence.recoveredRamRoughLower", { peakGb: a.peakGb, totalGb: a.totalGb });
    case "recovery-ram-rough-unread":
      return t("paramedic.evidence.recoveryRamRoughUnread");
    // B5: the start records of the sessions after the newest one the program was open in.
    case "program-not-open-rough":
    case "program-not-open-clear":
    case "program-not-open":
    case "program-start-unread":
      return programLine(e.code, a, ctx);
    // Presence only: the one allowed sentence for a program on its own, and counts across rough and normal sessions.
    case "already-running":
      // True of the rough sessions that were recorded: when some were not, the line says how many were.
      // The program was open in every recorded rough session, so "all n" is exact.
      return Number(a.n) > 0 && Number(a.of) > Number(a.n)
        ? t("paramedic.evidence.alreadyRunningScoped", { count: Number(a.n), name: a.name, game, n: a.n, of: a.of })
        : t("paramedic.evidence.alreadyRunning", { name: a.name, game });
    case "open-counts":
      return t("paramedic.evidence.openCounts", { count: Number(a.rm), r: a.r, rm: a.rm, n: a.n, nm: a.nm });
    case "open-counts-named":
      return t("paramedic.evidence.openCountsNamed", { count: Number(a.rm), name: a.name, r: a.r, rm: a.rm, n: a.n, nm: a.nm });
    case "load-cpu":
    case "load-gpu3d":
    case "load-gpuvideo":
      return loadLine(e.code, a, t);
    case "cross-game-confounded":
      return t("paramedic.evidence.crossGameConfounded", { games: a.games });
    case "normal-on-new-driver":
      return t("paramedic.evidence.normalOnNewDriver", { count: Number(a.count), date: dates.day(a.lastAt) });
    case "partial-rough-on-old-driver":
      return t("paramedic.evidence.partialRoughOnOldDriver", { date: dates.day(a.date) });
    case "cap-changed":
      return t("paramedic.evidence.capChanged", { from: capWord(a.from, t), to: capWord(a.to, t) });
    case "load-not-recorded":
      return t("paramedic.evidence.loadNotRecorded");
    case "figure-scope":
      return t("paramedic.evidence.figureScope");
    case "ram-peak": {
      // Scoped to the rough sessions with a memory record: how many were nearly full, the highest of those peaks and
      // the date of each (never one session's peak for the whole rough run). `percent` is the line the code applies.
      const days = (a.dates ?? "").split(US).filter(Boolean).map((d) => dates.day(d)).join(t("paramedic.firstLook.running.separator"));
      return t("paramedic.evidence.ramPeak", { count: Number(a.count ?? 1), full: a.full ?? "1", percent: a.percent ?? "90", peakGb: a.peakGb, totalGb: a.totalGb, dates: days });
    }
    case "ram-normal-range":
      return t("paramedic.evidence.ramNormalRange", { count: Number(a.count), basePeakGb: a.basePeakGb });
    case "ram-unrecorded":
      return t("paramedic.evidence.ramUnrecorded", { count: Number(a.count) });
    case "ram-baseline":
      return t("paramedic.evidence.ramBaseline", { peakGb: a.peakGb });
    case "ram-warning":
      return t("paramedic.evidence.ramWarning");
    case "ram-lower":
      return t("paramedic.evidence.ramLower", { peakGb: a.peakGb });
    // B8: the newest session after the rough ones, its memory reading, dated. A size, never the reason; one clear
    // session is said as one session; no reading is "no memory reading", never 0 GB.
    // B9: the rough side gets its own usable total when it differs (`roughTotalGb` is sent only then), and one rough
    // session is said in the singular. Literal keys only (zh has no plural forms, so the singular is its own key).
    case "ram-since": {
      // The variables are written at each call (not a shared object) so the locale-parity guard can see them passed.
      const date = dates.day(a.date);
      const single = a.roughCount === "1";
      if (a.roughTotalGb) {
        return single
          ? t("paramedic.evidence.ramSinceTotalsSingle", { game, date, peakGb: a.peakGb, totalGb: a.totalGb, roughGb: a.roughGb, roughTotalGb: a.roughTotalGb })
          : t("paramedic.evidence.ramSinceTotals", { game, date, peakGb: a.peakGb, totalGb: a.totalGb, roughGb: a.roughGb, roughTotalGb: a.roughTotalGb });
      }
      return single
        ? t("paramedic.evidence.ramSinceSingle", { game, date, peakGb: a.peakGb, totalGb: a.totalGb, roughGb: a.roughGb })
        : t("paramedic.evidence.ramSince", { game, date, peakGb: a.peakGb, totalGb: a.totalGb, roughGb: a.roughGb });
    }
    case "ram-since-full":
      return t("paramedic.evidence.ramSinceFull", { game, date: dates.day(a.date), peakGb: a.peakGb, totalGb: a.totalGb });
    case "ram-since-lower-clear": {
      const date = dates.day(a.date);
      const single = a.roughCount === "1";
      if (a.roughTotalGb) {
        return single
          ? t("paramedic.evidence.ramSinceLowerClearTotalsSingle", { game, date, peakGb: a.peakGb, totalGb: a.totalGb, roughGb: a.roughGb, roughTotalGb: a.roughTotalGb })
          : t("paramedic.evidence.ramSinceLowerClearTotals", { game, date, peakGb: a.peakGb, totalGb: a.totalGb, roughGb: a.roughGb, roughTotalGb: a.roughTotalGb });
      }
      return single
        ? t("paramedic.evidence.ramSinceLowerClearSingle", { game, date, peakGb: a.peakGb, totalGb: a.totalGb, roughGb: a.roughGb })
        : t("paramedic.evidence.ramSinceLowerClear", { game, date, peakGb: a.peakGb, totalGb: a.totalGb, roughGb: a.roughGb });
    }
    case "ram-since-full-clear":
      return t("paramedic.evidence.ramSinceFullClear", { game, date: dates.day(a.date), peakGb: a.peakGb, totalGb: a.totalGb });
    case "ram-since-unread":
      return t("paramedic.evidence.ramSinceUnread", { game, date: dates.day(a.date) });
    // B4: the graphics driver read as the earlier version again, and what the sessions since say. Never who changed it.
    case "driver-back":
      return t("paramedic.evidence.driverBack", { from: a.from, back: dates.dayTime(a.back), game });
    case "driver-back-none":
      return t("paramedic.evidence.driverBackNone", { game });
    case "driver-back-unjudged":
      return t("paramedic.evidence.driverBackUnjudged", { game, count: Number(a.count ?? 1) });
    case "driver-back-rough":
      return t("paramedic.evidence.driverBackRough", { game, count: Number(a.count ?? 1), from: a.from, date: dates.day(a.at) });
    case "driver-back-clear":
      return t("paramedic.evidence.driverBackClear", { game, from: a.from, date: dates.day(a.at) });
    case "driver-back-clear-unjudged":
      return t("paramedic.evidence.driverBackClearUnjudged", { game, from: a.from, n: a.count, date: dates.day(a.at) });
    case "driver-back-between":
      return t("paramedic.evidence.driverBackBetween", { game });
    // B10b: what this game's sessions say since the one Compy change in the window was undone (the ledger's own undo
    // time). Dated facts, never "the reason", never that the undo worked; no reading is "no reading", never a number.
    case "compy-undone-rough":
      return t("paramedic.evidence.compyUndoneRough", { title: a.title, undone: dates.dayTime(a.undone), game, count: Number(a.count ?? 1), date: dates.day(a.at), ...RAW });
    case "compy-undone-clear-once":
      return t("paramedic.evidence.compyUndoneClearOnce", { title: a.title, undone: dates.dayTime(a.undone), game, date: dates.day(a.at), ...RAW });
    // b12: two or more clear sessions since the undo, then sessions Compy couldn't judge (as B4's driver-back-clear-
    // unjudged). `n` is the clear count; `count` (the later, unjudged ones) only picks the plural form.
    case "compy-undone-clear-unjudged":
      return t("paramedic.evidence.compyUndoneClearUnjudged", { title: a.title, undone: dates.dayTime(a.undone), game, n: a.count, count: Number(a.later ?? 2), date: dates.day(a.at), ...RAW });
    case "compy-undone-unread":
      return t("paramedic.evidence.compyUndoneUnread", { title: a.title, undone: dates.dayTime(a.undone), game, count: Number(a.count ?? 1), ...RAW });
    case "compy-undone-between":
      return t("paramedic.evidence.compyUndoneBetween", { title: a.title, undone: dates.dayTime(a.undone), game, ...RAW });
    case "drift-restored-none":
      return t("paramedic.evidence.driftRestoredNone", { game });
    case "drift-restored-unjudged":
      return t("paramedic.evidence.driftRestoredUnjudged", { game, count: Number(a.count ?? 1) });
    case "drift-restored-rough":
      return t("paramedic.evidence.driftRestoredRough", { game, count: Number(a.count ?? 1), restored: dates.dayTime(a.restored), date: dates.day(a.at) });
    case "drift-restored-clear":
      return t("paramedic.evidence.driftRestoredClear", { game, date: dates.day(a.at) });
    case "drift-restored-between":
      return t("paramedic.evidence.driftRestoredBetween", { game });
    case "recovered-drift-back":
      return t("paramedic.evidence.recoveredDriftBack", { restored: dates.dayTime(a.restored) });
    // The count of changes that are on came back up to what it was because the setting was turned back on.
    case "compy-changes-restore":
      return t("paramedic.evidence.compyChangesRestore", { from: a.from, to: a.to });
    case "recovered-compy-explained":
      return t("paramedic.evidence.recoveredCompyExplained", { from: a.from, to: a.to });
    case "drift-noticed": {
      // It went off and Compy has since read it on again: the two dates, and nothing about who turned it on.
      if (a.restored) {
        const kept = (a.titles ?? "").split(US).map((x) => x.trim()).filter(Boolean);
        // The first time Compy read each title off, in the same order; a title with no time of its own gets the notice's.
        const seenAt = (a.seen ?? "").split(US);
        // The setting's name was kept when it went off (Compy's own change titles); an older record has none.
        if (kept.length > 0) {
          // Each title carries the time Compy first read it off: they were not all found at one time.
          const items = kept.map((title, i) => t("paramedic.evidence.driftRestoredItem", { title, noticed: dates.dayTime(seenAt[i] || a.noticed), ...RAW }));
          return t("paramedic.evidence.driftRestoredNamed", { count: kept.length, titles: items.join(t("paramedic.firstLook.running.separator")), restored: dates.dayTime(a.restored), ...RAW });
        }
        return t("paramedic.evidence.driftRestored", { noticed: dates.dayTime(a.noticed), restored: dates.dayTime(a.restored) });
      }
      // Named from the same drift list Home names it from (drift-named.ts rules), and only when that list's drift is
      // the notice the engine found (same `noticed_at`): otherwise the line stays general and the next line says why.
      const line = driftLine(a.check, a.noticed, ctx, driftState(a.check, a.noticed, ctx));
      const order = driftOrder(a.check, a, ctx);
      return order ? `${line} ${order}` : line;
    }
    case "which-not-recorded":
      if (ctx.driftState === "named") return t("paramedic.evidence.whichChangedNotRecorded");
      return ctx.driftState === "notLoaded" ? t("paramedic.evidence.whichNotLoaded") : t("paramedic.evidence.whichNotRecorded");
    case "count-changed":
      return t("paramedic.evidence.countChanged", { from: a.from, to: a.to });
    case "value-changed":
      return t("paramedic.evidence.valueChanged", { from: a.from, to: a.to });
    case "hardware-changed":
      return t("paramedic.evidence.hardwareChanged");
    case "power-plan-changed":
      return t("paramedic.evidence.powerPlanChanged");
    case "recovered-same-driver":
      return t("paramedic.evidence.recoveredSameDriver", { game, version: a.version });
    case "recovered-after-driver-change":
      // B4: back to the version it had before the rough sessions (the engine's `back`), said as that.
      if (a.back === "true") {
        return a.exact === "true"
          ? t("paramedic.evidence.recoveredAfterDriverBack", { version: a.version, when: dates.dayTime(a.when) })
          : t("paramedic.evidence.recoveredAfterDriverBackSeen", { version: a.version, when: dates.dayTime(a.when) });
      }
      return a.exact === "true"
        ? t("paramedic.evidence.recoveredAfterDriverChange", { version: a.version, when: dates.dayTime(a.when) })
        : t("paramedic.evidence.recoveredAfterDriverChangeSeen", { version: a.version, when: dates.dayTime(a.when) });
    case "recovered-quiet":
      return t("paramedic.evidence.recoveredQuiet", { pct: a.pct });
    case "recovered-quiet-seen":
      return t("paramedic.evidence.recoveredQuietSeen", { pct: a.pct });
    case "recovery-day-unplaced":
      return t("paramedic.evidence.recoveryDayUnplaced", { when: dates.day(a.when) });
    case "recovered-steam-latest-only":
      return t("paramedic.evidence.recoveredSteamLatestOnly", { game });
    case "rough-load-not-recorded":
      return t("paramedic.evidence.roughLoadNotRecorded");
    case "recovered-busy":
      return t("paramedic.evidence.recoveredBusy");
    case "recovered-few-starts":
      return t("paramedic.evidence.recoveredFewStarts", { starts: a.starts });
    case "recovery-load-not-recorded":
      return t("paramedic.evidence.recoveryLoadNotRecorded");
    case "recovered-ram-lower":
      return t("paramedic.evidence.recoveredRamLower", { peakGb: a.peakGb, totalGb: a.totalGb, roughGb: a.roughGb });
    case "recovered-ram-full":
      return t("paramedic.evidence.recoveredRamFull", { peakGb: a.peakGb, totalGb: a.totalGb });
    case "recovery-ram-not-read":
      return t("paramedic.evidence.recoveryRamNotRead");
    case "recovered-drift-still":
      return t("paramedic.evidence.recoveredDriftStill");
    case "recovery-drift-unknown":
      return t("paramedic.evidence.recoveryDriftUnknown");
    case "recovered-compy-same":
      return t("paramedic.evidence.recoveredCompySame", { count: Number(a.count) });
    case "recovered-compy-back":
      return t("paramedic.evidence.recoveredCompyBack", { from: a.from, to: a.to });
    case "recovered-compy-other":
      return t("paramedic.evidence.recoveredCompyOther", { from: a.from, to: a.to });
    case "recovery-compy-unread":
      return t("paramedic.evidence.recoveryCompyUnread");
    case "recovered-build-same":
      return t("paramedic.evidence.recoveredBuildSame", { build: a.build });
    case "recovered-build-changed":
      return t("paramedic.evidence.recoveredBuildChanged", { from: a.from, to: a.to });
    case "recovery-build-unread":
      return t("paramedic.evidence.recoveryBuildUnread");
    case "recovered-unchanged":
      if (a.what === "windows-update") return t("paramedic.evidence.recoveredUnchangedUpdate");
      if (a.what === "game-files-change") return t("paramedic.evidence.recoveredUnchangedFiles", { game });
      return t("paramedic.evidence.recoveredUnchangedProgram");
    case "recovered-changed-again":
      if (a.what === "windows-update") return t("paramedic.evidence.recoveredChangedAgainUpdate", { when: dates.dayTime(a.when) });
      if (a.what === "game-files-change") return t("paramedic.evidence.recoveredChangedAgainFiles", { game, when: dates.dayTime(a.when) });
      return t("paramedic.evidence.recoveredChangedAgainProgram", { when: dates.dayTime(a.when) });
    case "recovery-records-unread":
      return t("paramedic.evidence.recoveryRecordsUnread");
    case "recovered-driver-record-differs":
      return t("paramedic.evidence.recoveredDriverRecordDiffers", { when: dates.dayTime(a.when) });
    case "recovery-driver-unread":
      return t("paramedic.evidence.recoveryDriverUnread");
    case "compy-changes-differ":
      return t("paramedic.evidence.compyChangesDiffer", { from: a.from, to: a.to });
    default:
      return null;
  }
}

function badge(e: ParamedicEvidence, t: T): string {
  if (e.against) return t("paramedic.badge.against");
  if (e.kind === "supported-inference") return t("paramedic.badge.supports");
  if (e.kind === "known") return t("paramedic.badge.known");
  if (e.kind === "unknown") return t("paramedic.badge.unknown");
  return t("paramedic.badge.measured");
}

function stepLines(fix: ParamedicFix, ctx: Ctx, restored?: string, appliedOnly?: boolean): string[] {
  const { t, game, dates } = ctx;
  if (fix.kind !== "steps") return [];
  const a = fix.args;
  switch (fix.code) {
    case "gpu-driver-change":
      // B4: Compy already reads the earlier version again: nothing left to roll back, only a session to play.
      if (a.back) return [t("paramedic.fix.gpuDriver.stepBack", { from: a.from, back: dates.dayTime(a.back), game })];
      return [
        t("paramedic.fix.gpuDriver.step1"),
        t("paramedic.fix.gpuDriver.step2"),
        t("paramedic.fix.gpuDriver.step3", { from: a.from }),
        t("paramedic.fix.gpuDriver.step4", { from: a.from }),
        t("paramedic.fix.gpuDriver.step5", { game }),
      ];
    case "background-load":
      // B5: a recorder the step named was not open when the last session started (its own start record, read): no
      // "close it" step for it (Compy doesn't know who closed it, and closes nothing itself), only another session
      // played the same way. A named one still open keeps its "Close" step (`programs`); an unnamed program never
      // reaches `notOpen`.
      if (a.notOpen) {
        return present([
          a.names ? t("paramedic.fix.backgroundLoad.step1", { names: a.names }) : null,
          a.programs ? t("paramedic.fix.backgroundLoad.stepProgram", { name: a.programs }) : null,
          t("paramedic.fix.backgroundLoad.stepNotOpen", { name: a.notOpen, game, count: Number(a.count ?? 1) }),
        ]);
      }
      // A recorder or overlay that was open at the start of the rough sessions and of none of the normal ones is named;
      // that step already says to play once and press the button again.
      if (a.programs) {
        return present([
          a.names ? t("paramedic.fix.backgroundLoad.step1", { names: a.names }) : null,
          t("paramedic.fix.backgroundLoad.stepProgram", { name: a.programs }),
        ]);
      }
      return [
        a.names ? t("paramedic.fix.backgroundLoad.step1", { names: a.names }) : t("paramedic.fix.backgroundLoad.step1NoNames"),
        t("paramedic.fix.backgroundLoad.step2", { game }),
      ];
    case "frame-cap-change":
      return [t("paramedic.fix.frameCapChange.step1", { from: capWord(a.from, t) }), t("paramedic.fix.frameCapChange.step2", { game })];
    case "memory-pressure":
      return [
        t("paramedic.fix.memoryPressure.step1", { peakGb: a.peakGb, totalGb: a.totalGb }),
        t("paramedic.fix.memoryPressure.step2", { game }),
      ];
    case "setting-drift":
      // Already read back on: there is nothing left to turn on, only a session to play.
      if (restored) return [t("paramedic.fix.settingDrift.stepBackOn", { game, restored: dates.dayTime(restored) })];
      // Only the applied-changes row can be turned back on, and only in the Test room (where Compy asks first).
      // Any other setting keeps the plain advice: there is no one-press turn-on for it anywhere.
      // B3: when the card can turn it back on itself (the Lab's own path), the step says both places and what Compy does first.
      if (appliedOnly && (ctx.reapply?.offer.length ?? 0) > 0) {
        return [
          t("paramedic.fix.settingDrift.stepTurnOnHere", { room: t("common.rail.lab") }),
          t("paramedic.fix.settingDrift.step2", { game }),
        ];
      }
      if (appliedOnly) return [t("paramedic.fix.settingDrift.stepTurnOn", { room: t("common.rail.lab") }), t("paramedic.fix.settingDrift.step2", { game })];
      return [t("paramedic.fix.settingDrift.step1"), t("paramedic.fix.settingDrift.step2", { game })];
    case "compy-change":
      return [t("paramedic.fix.compyChange.step1", { room: t("common.rail.lab") }), t("paramedic.fix.compyChange.step2", { game })];
    case "windows-update":
      // Uninstalling is the owner's choice in Settings, offered for a quality update only. There is no button.
      return present([
        t("paramedic.fix.windowsUpdate.step1"),
        a.quality === "true" && a.kb ? t("paramedic.fix.windowsUpdate.stepUninstall", { kb: a.kb }) : null,
        t("paramedic.fix.windowsUpdate.step2", { game }),
      ]);
    case "game-files-change":
      return [
        t("paramedic.fix.gameFiles.step1", { game }),
        t("paramedic.fix.gameFiles.step2", { game }),
        t("paramedic.fix.gameFiles.step3", { game }),
      ];
    case "program-installed":
      return [t("paramedic.fix.programInstalled.step1", { names: a.names }), t("paramedic.fix.programInstalled.step2", { game })];
    case "graphics-mod":
      return [t("paramedic.fix.graphicsMod.step1", { name: a.name }), t("paramedic.fix.graphicsMod.step2")];
    case "gpu-hotter":
      return [t("paramedic.fix.gpuHotter.step1"), t("paramedic.fix.gpuHotter.step2"), t("paramedic.fix.gpuHotter.step3", { game })];
    default:
      return [];
  }
}

/** The engine joins a list inside one argument (titles, dates) with this unit separator. */
const US = "\u001f";

function ruledOutLine(n: ParamedicRuledOut, { t, dates, game }: Ctx): string | null {
  const a = n.args;
  switch (n.id) {
    case "gpu-driver-change":
      // Windows' own record is added only when it was read completely and showed no graphics driver install.
      return a.windows === "none"
        ? t("paramedic.checked.gpuDriverNoInstall", { driver: a.driver })
        : t("paramedic.checked.gpuDriverChange", { driver: a.driver });
    case "windows-update":
      return t("paramedic.checked.windowsUpdate");
    case "game-files-change":
      return t("paramedic.checked.gameFiles", { game, when: dates.day(a.since) });
    case "background-load":
      // Only a recorded figure that was about the same as in the normal sessions is listed here, with its numbers.
      return loadLine(a.kind, { ...a, how: "same" }, t);
    case "memory-pressure":
      // B11: zh has only the "other" plural form, so one rough session is its own key (as B9 did for ramSince*).
      return Number(a.count ?? 1) === 1
        ? t("paramedic.checked.memoryPressureSingle", { percent: a.percent })
        : t("paramedic.checked.memoryPressure", { percent: a.percent, count: Number(a.count ?? 1) });
    case "memory-as-full":
      // B8: the measurement and Compy's rule, not a conclusion: how many rough sessions were nearly full, of how many,
      // the normal sessions' highest share of their own usable memory, and the line the rule applies.
      return t("paramedic.checked.memoryAsFull", {
        count: Number(a.count ?? 1),
        full: a.full ?? "1",
        peakGb: a.peakGb,
        totalGb: a.totalGb,
        basePercent: a.basePercent,
        baseLine: a.baseLine,
      });
    case "setting-drift":
      return t("paramedic.checked.settingDrift");
    case "compy-change":
      return t("paramedic.checked.compyChange", { count: Number(a.count) });
    case "hardware-change":
      return t("paramedic.checked.hardwareChange");
    case "power-plan-change":
      return t("paramedic.checked.powerPlanChange");
    case "display-refresh-lower":
      return t("paramedic.checked.displayRefreshLower", { hz: a.hz });
    case "windows-build-change":
      return t("paramedic.checked.windowsBuildChange", { build: a.build });
    case "graphics-mod":
      // Only for a complete scan: "no KNOWN mod", never "no mods".
      return t("paramedic.checked.graphicsMod", { game });
    case "gpu-temp":
      // The same one sentence as everywhere else: both numbers, said once.
      return t("paramedic.seen.gpuTemp", { count: Number(a.count), rough: a.rough, base: a.base });
    default:
      return null;
  }
}

function unknownLine(code: string, { t, game, startRecord }: Ctx): string | null {
  switch (code) {
    case "mods-no-folder":
      return t("paramedic.unknown.modsNoFolder", { game });
    case "mods-folder-unreadable":
      return t("paramedic.unknown.modsFolderUnreadable", { game });
    case "mods-partial":
      return t("paramedic.unknown.modsPartial", { game });
    case "mods-unavailable":
      return t("paramedic.unknown.modsUnavailable", { game });
    case "gpu-temp":
      return t("paramedic.unknown.gpuTemp");
    case "crashes-unavailable":
      return t("paramedic.unknown.crashesUnavailable", { game });
    case "crashes-unreadable":
      return t("paramedic.unknown.crashesUnreadable", { game });
    case "crashes-partial":
      return t("paramedic.unknown.crashesPartial", { game });
    case "compy-ledger-unreadable":
      return t("paramedic.unknown.compyLedger");
    case "startup-programs":
      return t("paramedic.unknown.startupPrograms");
    case "overlays":
      return t("paramedic.unknown.overlays");
    case "running-at-start":
      // Not recorded is about the sessions that have no record, not "nothing was running": with several rough
      // sessions the line says how many, so it can sit beside "was already running" for the ones that were recorded.
      if (startRecord && startRecord.rough > 1) {
        return startRecord.recorded > 0
          ? t("paramedic.unknown.runningAtStartSome", { missing: startRecord.rough - startRecord.recorded, rough: startRecord.rough, game })
          : t("paramedic.unknown.runningAtStartNone", { rough: startRecord.rough, game });
      }
      return t("paramedic.unknown.runningAtStart");
    case "running-at-start-normal": {
      // "Was already running" is about the rough sessions only: say what the normal sessions' record leaves unknown.
      const names = startRecord?.open ?? [];
      if (!startRecord || names.length === 0) return null;
      const name = names.join(", ");
      return startRecord.normal_recorded > 0
        ? t("paramedic.unknown.runningAtStartNormalSome", { count: names.length, n: startRecord.normal_recorded, of: startRecord.normal, name, game, ...RAW })
        : t("paramedic.unknown.runningAtStartNormalNone", { count: names.length, name, game, ...RAW });
    }
    case "start-list-only":
      return t("paramedic.unknown.startListOnly");
    case "other-load":
      return t("paramedic.unknown.otherLoad");
    case "other-load-rough-only":
      return t("paramedic.unknown.otherLoadRoughOnly");
    case "other-load-base-only":
      return t("paramedic.unknown.otherLoadBaseOnly");
    case "gpu-driver":
      return t("paramedic.unknown.gpuDriver");
    case "hardware":
      return t("paramedic.unknown.hardware");
    case "memory":
      return t("paramedic.unknown.memory");
    case "compy-changes":
      return t("paramedic.unknown.compyChanges");
    case "power-plan":
      return t("paramedic.unknown.powerPlan");
    case "power-plan-timing":
      return t("paramedic.unknown.powerPlanTiming");
    case "display":
      return t("paramedic.unknown.display");
    case "drift-timing":
      return t("paramedic.unknown.driftTiming");
    // The setting record keeps 30 days: a stretch that opened before that cannot be called free of setting changes.
    case "drift-horizon":
      return t("paramedic.unknown.driftHorizon");
    case "drift-unreadable":
      return t("paramedic.unknown.driftUnreadable");
    case "identity-unreadable":
      return t("paramedic.unknown.identityUnreadable");
    case "windows-build":
      return t("paramedic.unknown.windowsBuild");
    default:
      return null;
  }
}

/** B5: a program open when the rough sessions started, and what the later sessions' START records say. Start of a
 *  session only; never who closed it, never that its absence helped. Shared by the row and "What Compy checked". */
function programLine(code: string, a: Record<string, string>, { t, dates, game }: Ctx): string | null {
  // Called for every "What Compy checked" line: anything else is not one of these.
  if (!["program-not-open-rough", "program-not-open-clear", "program-not-open", "program-start-unread"].includes(code)) return null;
  // Programs with exactly the same start records share one line (`programs` = how many names it carries).
  const many = Number(a.programs ?? 1) > 1;
  const date = dates.day(a.date);
  switch (code) {
    case "program-not-open-rough":
      return many
        ? t("paramedic.evidence.programsNotOpenRough", { name: a.name, game, date, count: Number(a.count ?? 1), r: a.r, rm: a.rm })
        : t("paramedic.evidence.programNotOpenRough", { name: a.name, game, date, count: Number(a.count ?? 1), r: a.r, rm: a.rm });
    case "program-not-open-clear":
      return many
        ? t("paramedic.evidence.programsNotOpenClear", { name: a.name, game, date })
        : t("paramedic.evidence.programNotOpenClear", { name: a.name, game, date });
    case "program-not-open":
      return many ? t("paramedic.evidence.programsNotOpen", { name: a.name, game, date }) : t("paramedic.evidence.programNotOpen", { name: a.name, game, date });
    case "program-start-unread":
      return t("paramedic.evidence.programStartUnread", { game, date: dates.day(a.date) });
    default:
      return null;
  }
}

/** One line of "also looked at": things found that Compy does not treat as findings. */
function seenLine(s: ParamedicRuledOut, ctx: Ctx): string | null {
  const { t, dates, game } = ctx;
  const a = s.args;
  const program = programLine(s.id, a, ctx);
  if (program) return program;
  switch (s.id) {
    case "gpu-temp":
      return t("paramedic.seen.gpuTemp", { count: Number(a.count), rough: a.rough, base: a.base });
    case "setting-drift-moved":
      // A setting went off, or came back on, after the rough sessions began: said as dates, never "no changes".
      // Only the applied-changes row can say "back on"; any other check only read as before again.
      if (a.restored) {
        return a.check === "applied-changes"
          ? t("paramedic.seen.settingMovedBack", { noticed: dates.dayTime(a.noticed), restored: dates.dayTime(a.restored) })
          : t("paramedic.seen.settingMovedReadAgain", { noticed: dates.dayTime(a.noticed), restored: dates.dayTime(a.restored) });
      }
      return t("paramedic.seen.settingMoved", { noticed: dates.dayTime(a.noticed) });
    case "game-crashes": {
      // A partial read says "at least" in the line itself. The program name is always matched; when the
      // install folder or the report's path was not there to check, the line says it went by name only.
      const count = Number(a.n);
      const since = dates.day(a.since);
      const base =
        a.partial === "true"
          ? t("paramedic.seen.gameCrashesPartial", { game, count, since })
          : t("paramedic.seen.gameCrashes", { game, count, since });
      const byName = a.byName === "true" ? t("paramedic.seen.crashesByName") : "";
      const versions = a.versions ? t("paramedic.seen.crashesVersions", { n: Number(a.versions) }) : "";
      return `${base}${byName}${versions}`;
    }
    case "starts-dropped":
      return t("paramedic.seen.startsDropped", { n: Number(a.n) });
    case "starts-skipped":
      return t("paramedic.seen.startsSkipped");
    case "load-seen":
      return loadLine(a.kind, a, t);
    case "sitting-merged":
      return t("paramedic.seen.sittingMerged", { count: Number(a.count) });
    case "game-crash-signature": {
      const date = dates.day(a.before);
      // Compy couldn't read its own record of changes: the date is a change Windows recorded, and the sentence does not
      // say "earliest" (a Compy change may have come first).
      if (a.ledger === "unreadable") {
        return t("paramedic.seen.gameCrashSignature", { module: a.module, what: t("paramedic.seen.crashBeforeWindowsOnly", { date }) });
      }
      // What kind of change it was, and which Compy change(s) when the ledger names them. A missing kind is left out,
      // never defaulted to "a change Windows recorded".
      const titles = (a.titles ?? "").split(US).filter(Boolean);
      const sep = t("paramedic.firstLook.running.separator");
      const kind =
        a.kind === "compy"
          ? titles.length === 0
            ? t("paramedic.seen.changeKind.compy")
            : t("paramedic.seen.changeKind.compyNamed", { count: titles.length, title: titles[0], titles: titles.slice(0, 3).map((x) => `“${x}”`).join(sep) + (titles.length > 3 ? "…" : "") })
          : a.kind === "windows"
            ? t("paramedic.seen.changeKind.windows")
            : null;
      return t("paramedic.seen.gameCrashSignature", {
        module: a.module,
        what: kind ? t("paramedic.seen.crashBeforeWhat", { date, kind }) : t("paramedic.seen.crashBeforeWhatNoKind", { date }),
      });
    }
    case "mod-settings-only":
      // Files of a mod's own are not proof it is installed: said exactly so.
      return t("paramedic.seen.modSettingsOnly", { game, name: a.name });
    case "updates-minor":
      return t("paramedic.seen.updatesMinor", { n: Number(a.n), m: Number(a.m) });
    case "programs-installed": {
      const day = !a.last || a.last === a.day ? dates.day(a.day) : t("paramedic.seen.dayRange", { a: dates.day(a.day), b: dates.day(a.last) });
      const count = Number(a.count);
      const more = Number(a.more);
      return more > 0
        ? t("paramedic.seen.programsInstalledMore", { count, names: a.names, more, day })
        : t("paramedic.seen.programsInstalled", { count, names: a.names, day });
    }
    case "programs-none":
      return t("paramedic.seen.programsNone");
    case "other-drivers":
      return t("paramedic.seen.otherDrivers", { count: Number(a.count), classes: driverClasses(a.classes, t) });
    case "driver-install-same-stamp":
      return t("paramedic.seen.driverInstallSameStamp", { when: dates.dayTime(a.when) });
    case "driver-reinstall-same":
      return t("paramedic.evidence.reinstallSameVersion", { when: dates.dayTime(a.when) });
    case "driver-install-prior-unknown":
      return t("paramedic.evidence.installPriorUnknown", { when: dates.dayTime(a.when) });
    case "driver-other-install":
      return t("paramedic.seen.driverOtherInstall", { when: dates.dayTime(a.when) });
    case "updates-unclassified":
      return a.kbs
        ? t("paramedic.seen.updatesUnclassifiedKb", { count: Number(a.n), kbs: a.kbs })
        : t("paramedic.seen.updatesUnclassified", { count: Number(a.n) });
    default:
      return null;
  }
}

/** Why a kind of Windows record could not be read, in words. One literal key per reason. */
function whyText(code: string, a: Record<string, string>, { t, dates }: Ctx): string | null {
  switch (code) {
    case "access-denied":
      return t("paramedic.limit.why.accessDenied");
    case "log-empty":
      return t("paramedic.limit.why.logEmpty");
    case "log-missing":
      return t("paramedic.limit.why.logMissing");
    case "read-failed":
      return t("paramedic.limit.why.readFailed");
    case "timed-out":
      return t("paramedic.limit.why.timedOut");
    case "records-unreadable":
      return t("paramedic.limit.why.recordsUnreadable", { n: Number(a.n) });
    case "registry":
      return t("paramedic.limit.why.registry");
    case "steam-unreadable":
      return t("paramedic.limit.why.steamUnreadable");
    case "steam-no-record":
      return t("paramedic.limit.why.steamNoRecord");
    case "steam-no-time":
      return t("paramedic.limit.why.steamNoTime");
    case "not-read":
      return t("paramedic.limit.why.notRead");
    case "took-too-long":
      return t("paramedic.limit.why.tookTooLong");
    case "no-window":
      return t("paramedic.limit.why.noWindow");
    case "reader-failed":
      return t("paramedic.limit.why.readerFailed");
    case "partial-timed-out":
      return t("paramedic.limit.why.partialTimedOut");
    case "partial-row-cap":
      return t("paramedic.limit.why.partialRowCap");
    case "partial-unparsed":
      return t("paramedic.limit.why.partialUnparsed", { n: Number(a.n) });
    case "partial-output-capped":
      return t("paramedic.limit.why.partialOutputCapped");
    case "partial-registry":
      return t("paramedic.limit.why.partialRegistry", { n: Number(a.n) });
    case "partial-steam-libraries":
      return t("paramedic.limit.why.partialSteamLibraries", { n: Number(a.n) });
    case "partial-coverage":
      return t("paramedic.limit.why.partialCoverage", { from: dates.day(a.from) });
    default:
      return null;
  }
}

function whatKind(kind: ParamedicLimit["kind"], { t, game }: Ctx): string {
  switch (kind) {
    case "driver":
      return t("paramedic.limit.what.driver");
    case "windows-update":
      return t("paramedic.limit.what.windowsUpdate");
    case "game-update":
      return t("paramedic.limit.what.gameUpdate", { game });
    default:
      return t("paramedic.limit.what.programs");
  }
}

/** One thing Compy could not see: never "nothing changed". */
function limitLine(l: ParamedicLimit, ctx: Ctx): string | null {
  const { t, game } = ctx;
  if (l.code === "not-steam") return t("paramedic.limit.notSteam", { game });
  if (l.code === "classes") return t("paramedic.limit.classes");
  if (l.code === "no-install-date") return t("paramedic.limit.noInstallDate", { n: Number(l.args.n) });
  const why = whyText(l.code, l.args, ctx);
  if (!why) return null;
  const what = whatKind(l.kind, ctx);
  return l.code.startsWith("partial-") ? t("paramedic.limit.partial", { what, why }) : t("paramedic.limit.cantSee", { what, why });
}

const present = (xs: (string | null)[]): string[] => xs.filter((x): x is string => !!x);

/** `hideInstallAt`: the exact time the heading already shows, so "Windows recorded the install" is not said twice. */
function Evidence({ list, ctx: base, hideInstallAt }: { list: ParamedicEvidence[]; ctx: Ctx; hideInstallAt?: string }) {
  // "Which setting it was isn't recorded" is said only while a drift line here could not name its setting.
  const drift = list.filter((e) => e.code === "drift-noticed");
  // A restored notice that kept its titles names its own setting (the dated line prints them), whatever the live list now holds.
  const states = drift.map((e) => (e.args.restored && (e.args.titles ?? "").trim() !== "" ? "named" : driftState(e.args.check, e.args.noticed, base)));
  // "What changed it isn't recorded" only after every drift line named its setting; "couldn't read" when any could not be matched.
  const driftAll: DriftState | undefined = states.length === 0 ? undefined : states.every((s) => s === "named") ? "named" : states.includes("notLoaded") ? "notLoaded" : "notRecorded";
  const ctx: Ctx = driftAll ? { ...base, driftState: driftAll } : base;
  const rows = list
    .filter((e) => !(hideInstallAt && e.code === "install-recorded" && e.args.when === hideInstallAt))
    .map((e) => ({ e, text: evidenceLine(e, ctx) }))
    .filter((r) => r.text);
  if (rows.length === 0) return null;
  return (
    <ul className="gl-para-lines">
      {rows.map(({ e, text }, i) => (
        <li key={`${e.code}-${i}`}>
          <span className="gl-chip" data-tone={e.against ? "warn" : undefined}>
            {badge(e, ctx.t)}
          </span>
          {text}
        </li>
      ))}
    </ul>
  );
}

/** True when every setting the row lists is the applied-changes check: the only one with a turn-it-back-on in the Test room. */
function appliedOnly(f: ParamedicFinding): boolean {
  const drift = f.evidence.filter((e) => e.code === "drift-noticed");
  return drift.length > 0 && drift.every((e) => e.args.check === "applied-changes");
}

/** When Compy read the setting back on, when every setting the row lists came back (the latest of them); else undefined. */
function restoredAt(f: ParamedicFinding): string | undefined {
  const drift = f.evidence.filter((e) => e.code === "drift-noticed");
  if (drift.length === 0 || !drift.every((e) => !!e.args.restored)) return undefined;
  const all = drift.map((e) => e.args.restored).sort();
  return all[all.length - 1];
}

/** The steps for one candidate; they sit inside its row, which opens on a tap. */
function FixBlock({
  fix,
  ctx,
  possible,
  restored,
  appliedOnly,
  finding,
}: {
  fix: ParamedicFix;
  ctx: Ctx;
  possible: boolean;
  restored?: string;
  appliedOnly?: boolean;
  finding?: ParamedicFinding;
}) {
  const offer = fix.kind === "steps" && fix.code === "compy-change" && finding ? compyOfferFor(finding, ctx) : null;
  // B10 review r1 F3: once the row's change is undone, its "undo the newest one" and "play once" steps go: the undone
  // line carries the one next step, and step 1 would point at a different, unnamed change.
  // B10b: once a session of the game was played after the undo, the evidence line above says when it was undone and
  // what was read since, so neither the steps nor the "Undone on ... play once, then press again" line (whose next
  // step is already done) is repeated. With no session since, the "Undone on" line stays: it is the one next step.
  const readSince = fix.kind === "steps" && fix.code === "compy-change" && !!finding?.evidence.some((e) => e.code.startsWith("compy-undone-"));
  if (readSince) return null;
  const steps = offer?.kind === "undone" ? [] : stepLines(fix, ctx, restored, appliedOnly);
  const undo = offer ? <CompyUndoRow offer={offer} ctx={ctx} /> : null;
  if (offer?.kind === "undone") return undo;
  if (steps.length > 0) {
    // Navigation only: the one-press "turn it back on" lives in the Test room's check, with its own confirm. The
    // button is shown only for the applied-changes setting; nothing else has a turn-on there.
    const toCheck = fix.kind === "steps" && fix.code === "setting-drift" && !restored && appliedOnly && ctx.onOpenCheck;
    // B3: the card's own "Turn it back on", for each setting the ledger says reads off now (the Lab's apply path).
    const re = fix.kind === "steps" && fix.code === "setting-drift" && !restored && appliedOnly ? ctx.reapply : undefined;
    return (
      <div>
        {/* Under a suspect that is only possible the steps are a way to find out, not a fix to make on a maybe. */}
        <p className="gl-row-title">{possible ? ctx.t("paramedic.fix.titleTest") : ctx.t("paramedic.fix.title")}</p>
        <ol className="gl-para-lines gl-para-steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {re?.offer.map((rev) => {
          const done = re.done.find((x) => x.rec_id === rev.rec_id);
          if (done) {
            // The ledger's own time, never the clock's: what was recorded, and the one next step.
            return (
              <p className="gl-para-note" data-testid="paramedic-turned-on" key={rev.rec_id}>
                {done.at
                  ? ctx.t("paramedic.fix.settingDrift.turnedOn", { title: rev.title, when: ctx.dates.dayTime(done.at), game: ctx.game })
                  : ctx.t("paramedic.fix.settingDrift.turnedOnNoTime", { title: rev.title, game: ctx.game })}
              </p>
            );
          }
          const busy = re.busy === rev.rec_id;
          return (
            <button
              key={rev.rec_id}
              type="button"
              className="gl-ghost"
              data-testid="paramedic-turn-on"
              aria-disabled={re.busy != null}
              onClick={() => {
                if (re.busy == null) re.press(rev);
              }}
            >
              {busy ? ctx.t("paramedic.fix.settingDrift.turningOn") : ctx.t("paramedic.fix.settingDrift.turnOn", { title: rev.title })}
            </button>
          );
        })}
        {toCheck && (
          <button type="button" className="gl-ghost" data-testid="paramedic-open-check" onClick={toCheck}>
            {ctx.t("paramedic.fix.settingDrift.openCheck", { room: ctx.t("common.rail.lab") })}
          </button>
        )}
        {undo}
      </div>
    );
  }
  return fix.kind === "none" ? <p className="gl-para-note">{ctx.t("paramedic.fix.none")}</p> : null;
}

/** B10: what the compy-change row offers, from the ledger list the card was given and the finding's own window and
 *  count (src/data/compy-undo.ts). A button only for one record that passes every rule; one record otherwise is named
 *  with where to undo it; several are listed, never "undo all"; an undone one gets the ledger's own date. */
function compyOfferFor(f: ParamedicFinding, ctx: Ctx): CompyUndoOffer | null {
  const cu = ctx.compyUndo;
  if (!cu || f.since_when.kind !== "observed-between") return null;
  const count = f.evidence.find((e) => e.code === "count-changed")?.args;
  return compyUndoOffer({ from: f.since_when.from, to: f.since_when.to, countFrom: count?.from, countTo: count?.to }, cu.list, cu.driftRecs);
}

function CompyUndoRow({ offer, ctx }: { offer: CompyUndoOffer; ctx: Ctx }) {
  const { t } = ctx;
  const cu = ctx.compyUndo;
  if (!cu) return null;
  switch (offer.kind) {
    case "none":
      return null;
    case "several":
      return (
        <p className="gl-para-note" data-testid="paramedic-undo-compy-several">
          {t("paramedic.fix.compyChange.several", { count: offer.count, titles: offer.titles.join(", "), ...RAW })}
        </p>
      );
    case "noUndoHere":
      return (
        <p className="gl-para-note" data-testid="paramedic-undo-compy-none">
          {t("paramedic.fix.compyChange.noUndoHere", { title: offer.title, ...RAW })}
        </p>
      );
    case "undone":
      // The date is the ledger's rolled_back_at, never the click's.
      return (
        <p className="gl-para-note" data-testid="paramedic-undo-compy-done">
          {t("paramedic.fix.compyChange.undone", { date: ctx.dates.dayTime(offer.at), title: offer.title, game: ctx.game, ...RAW })}
        </p>
      );
    case "button": {
      const result = cu.results[offer.id];
      const line =
        result === "unrecorded"
          ? t("common.undoUnrecorded")
          : result === "trial"
            ? t("paramedic.fix.compyChange.trialRunning")
            : result === "changed"
              ? t("paramedic.fix.compyChange.changedSinceDrawn")
              : result === "unread"
                ? t("paramedic.fix.compyChange.listUnread")
                : null;
      // Done: the button goes; the dated line comes from the ledger's next list (rolled_back_at), never from the press.
      // Unrecorded: it ran on Windows but isn't saved, so it is never called undone and is not offered again here.
      const showButton = result !== "done" && result !== "unrecorded";
      return (
        <>
          {showButton && (
            <button
              type="button"
              className="gl-ghost"
              data-testid="paramedic-undo-compy"
              aria-disabled={cu.busy != null}
              onClick={() => {
                if (cu.busy == null) cu.press(offer.recId, offer.id);
              }}
            >
              {t("paramedic.fix.compyChange.undoButton", { title: offer.title, ...RAW })}
            </button>
          )}
          {line && (
            <p className="gl-para-note" data-testid="paramedic-undo-compy-result">
              {line}
            </p>
          )}
        </>
      );
    }
  }
}

function whyFirst(d: ParamedicDiagnosis, ctx: Ctx): string | null {
  if (d.why_first === "tie") return ctx.t("paramedic.why.tie");
  if (d.why_first !== "cross-game" && d.why_first !== "cross-game-lead") return null;
  const games = d.findings[0]?.evidence.find((e) => e.code === "cross-game")?.args.games;
  if (!games) return null;
  return d.why_first === "cross-game"
    ? ctx.t("paramedic.why.crossGame", { game: ctx.game, games })
    : ctx.t("paramedic.why.crossGameLead", { game: ctx.game, games });
}

/** How many candidates the default open card lists as one-line rows. The rest wait under "Also possible". */
const ROWS_SHOWN = 3;
/** The card asks again this often (ms) while another diagnosis is still running, up to `BUSY_RETRIES` times. */
const BUSY_RETRY_MS = 1200;
const BUSY_RETRIES = 8;
/** What `paramedic_diagnose` answers while another call is still running: "still checking", never a failure. */
const BUSY = "paramedic-busy";

function nowText(n: ParamedicNow, t: T): string {
  if (n === "points-to") return t("paramedic.now.pointsTo");
  if (n === "points-away") return t("paramedic.now.pointsAway");
  return t("paramedic.now.cantTell");
}

/** The disclosure caret: one 18 px chevron that rotates open off its button's aria-expanded (see glass-rooms.css). */
function Chevron() {
  return (
    <span aria-hidden="true" className="gl-para-caret">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </span>
  );
}

/** The scroll hint's chevron: the same size, pointing down. */
function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** A disclosure: a button with aria-expanded; nothing inside is rendered until it is opened. */
function Fold({ title, testid, children }: { title: string; testid: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
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

/** The measured problem: the title and two lines. The rest of the numbers wait behind "Show the numbers". */
function Problem({ d, ctx, skipLater }: { d: ParamedicDiagnosis; ctx: Ctx; skipLater?: boolean }) {
  const { t, dates, game } = ctx;
  const [open, setOpen] = useState(false);
  const id = useId();
  const p = d.problem;
  if (!p) return null;
  const count = p.sessions_affected.length;
  // "It last ran normally" only when that session was fully measured and ran normally; otherwise the
  // newest session that was is named for what it is, and with none the line is left out.
  const fullAt = p.last_full_normal_at;
  let lasted: string | null = null;
  if (fullAt && fullAt === p.last_normal_at) lasted = t("paramedic.problem.sinceLasted", { date: dates.day(fullAt), count });
  else if (fullAt) lasted = t("paramedic.problem.sinceLastedFull", { date: dates.day(fullAt), count });
  const spikes = p.spikes && p.now.p99_ms != null && p.before.p99_ms != null;
  const hasMore = spikes || p.avg_lower || p.other_games_affected.length > 0 || p.partial_sessions.length > 0;
  return (
    <>
      <div className="gl-card-top">
        <h2 className="gl-card-title">{t("paramedic.problem.title", { game, count })}</h2>
        <span className="gl-chip" data-tone="accent">
          {t("paramedic.problem.badge")}
        </span>
      </div>
      <p>{t("paramedic.problem.body", { game, count, beforePct: pct(p.before.ratio), nowPct: pct(p.now.ratio) })}</p>
      {lasted && <p>{lasted}</p>}
      {/* One rough session is enough to say it ran rough, not enough to say it is a pattern. */}
      {count === 1 && <p className="gl-para-note">{t("paramedic.problem.oneSession")}</p>}
      {p.later_unjudged > 0 && !skipLater && <p className="gl-para-note">{t("paramedic.cantTell.backToNormal", { game })}</p>}
      {d.earlier_episode && (
        <p className="gl-para-note">
          {t("paramedic.problem.earlier", { from: dates.day(d.earlier_episode.from), to: dates.day(d.earlier_episode.to) })}
        </p>
      )}
      {hasMore && (
        <div>
          <button type="button" className="gl-ghost" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
            {open ? t("paramedic.numbers.hide") : t("paramedic.numbers.show")}
          </button>
          {open && (
            <div id={id} className="gl-para-body">
              {spikes && (
                <p>{t("paramedic.problem.spikes", { nowMs: tenth(p.now.p99_ms as number), beforeMs: tenth(p.before.p99_ms as number) })}</p>
              )}
              {p.avg_lower && (
                <p>{t("paramedic.problem.average", { nowFps: Math.round(p.now.avg_fps), beforeFps: Math.round(p.before.avg_fps) })}</p>
              )}
              {p.other_games_affected.length > 0 && <p>{t("paramedic.problem.otherGames", { games: p.other_games_affected.join(", ") })}</p>}
              {p.partial_sessions.length > 0 && (
                <p className="gl-para-note">{t("paramedic.problem.partial", { count: p.partial_sessions.length })}</p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function certaintyChip(f: ParamedicFinding, t: T): { text: string; tone?: string } {
  if (f.confidence === "likely") return { text: t("paramedic.answer.likely"), tone: "accent" };
  if (f.confidence === "measured") return { text: t("paramedic.answer.measured"), tone: "accent" };
  if (f.confidence === "mechanism") return { text: t("paramedic.answer.mechanism") };
  return { text: t("paramedic.answer.possible") };
}

/** B3b: "Matches the timing" is one recovery observation, never a strength of its own, so the row's certainty word
 *  (Possible) stays beside it and the chip carries no accent tone. */
function chipFor(f: ParamedicFinding, recovered: boolean, t: T): { text: string; tone?: string; certainty?: { text: string; tone?: string } } {
  if (recovered && f.now) {
    if (f.now === "points-to") return { text: nowText(f.now, t), certainty: certaintyChip(f, t) };
    // Neutral, like the timing chip: one recovery observation weakens a row, it never marks it cleared (no green).
    return { text: nowText(f.now, t) };
  }
  return certaintyChip(f, t);
}

/** One candidate as ONE line (name, when, a short chip). Its evidence and steps open on a tap. */
function Row({ f, d, ctx, recovered }: { f: ParamedicFinding; d: ParamedicDiagnosis; ctx: Ctx; recovered: boolean }) {
  const { t } = ctx;
  const [open, setOpen] = useState(false);
  const id = useId();
  const since = sinceText(f.since_when, ctx);
  const name = findingTitle(f, ctx);
  const chip = chipFor(f, recovered, t);
  const why = recovered ? null : whyFirst(d, ctx);
  return (
    <div className="gl-para-row" data-testid="paramedic-candidate">
      <button type="button" className="gl-para-row-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Chevron />
        <span className="gl-para-row-name" title={name ?? undefined}>
          {name}
        </span>
        {since && (
          <span className="gl-para-row-when" title={since}>
            {since}
          </span>
        )}
        {chip.certainty && (
          <span className="gl-chip" data-tone={chip.certainty.tone} data-testid="paramedic-row-certainty">
            {chip.certainty.text}
          </span>
        )}
        <span className="gl-chip" data-tone={chip.tone}>
          {chip.text}
        </span>
      </button>
      {open && (
        <div id={id} className="gl-para-row-body">
          <Evidence list={f.evidence} ctx={ctx} hideInstallAt={f.since_when.kind === "exact" ? f.since_when.at : undefined} />
          {recovered && f.now_evidence.length > 0 && (
            <div>
              <p className="gl-row-title">{t("paramedic.row.nowTitle")}</p>
              <Evidence list={f.now_evidence} ctx={ctx} />
            </div>
          )}
          {why && <span className="gl-row-sub">{t("paramedic.card.why", { reason: why })}</span>}
          {!recovered && <FixBlock fix={f.fix} ctx={ctx} possible={f.confidence === "possible"} restored={restoredAt(f)} appliedOnly={appliedOnly(f)} finding={f} />}
          {!recovered && f === d.findings[0] && f.confidence !== "possible" && <span className="gl-row-sub">{t("paramedic.card.notProven")}</span>}
        </div>
      )}
    </div>
  );
}

function AlsoPossible({ list, d, ctx, recovered }: { list: ParamedicFinding[]; d: ParamedicDiagnosis; ctx: Ctx; recovered: boolean }) {
  if (list.length === 0) return null;
  return (
    <Fold title={ctx.t("paramedic.alsoPossible.title")} testid="paramedic-also">
      {list.map((f, i) => (
        <Row key={`${f.id}-${i}`} f={f} d={d} ctx={ctx} recovered={recovered} />
      ))}
    </Fold>
  );
}

function Checked({ d, ctx }: { d: ParamedicDiagnosis; ctx: Ctx }) {
  const { t } = ctx;
  // B8 review r1: a line that is measured but kept out by Compy's own rule (memory nearly full in a rough session while
  // the normal sessions were already high) is not "unchanged": it gets its own group right after the unchanged list.
  // B9: "Memory: never reached 90% full in the rough sessions" is a level measured in the rough sessions against the
  // rule's own line, not a comparison with the normal sessions, so it is not "unchanged" either: same group.
  const notALeadIds = ["memory-as-full", "memory-pressure"];
  const ruled = present(d.not_it.filter((n) => !notALeadIds.includes(n.id)).map((n) => ruledOutLine(n, ctx)));
  const notALead = present(d.not_it.filter((n) => notALeadIds.includes(n.id)).map((n) => ruledOutLine(n, ctx)));
  const seen = present(d.seen.map((s) => seenLine(s, ctx)));
  if (ruled.length === 0 && notALead.length === 0 && seen.length === 0) return null;
  return (
    <Fold title={t("paramedic.checked.title")} testid="paramedic-checked">
      {ruled.length > 0 && (
        <div>
          <p className="gl-row-title">{t("paramedic.checked.ruledOut")}</p>
          <ul className="gl-para-lines">
            {ruled.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {notALead.length > 0 && (
        <div data-testid="paramedic-not-a-lead">
          <p className="gl-row-title">{t("paramedic.checked.notALead")}</p>
          <ul className="gl-para-lines">
            {notALead.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {seen.length > 0 && (
        <div>
          <p className="gl-row-title">{t("paramedic.checked.seen")}</p>
          <ul className="gl-para-lines">
            {seen.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </Fold>
  );
}

/** What Compy could not read this time, and what it never reads. Never "nothing changed". */
function CantSee({ d, ctx }: { d: ParamedicDiagnosis; ctx: Ctx }) {
  const { t } = ctx;
  const always = (l: ParamedicLimit) => l.code === "classes" || l.code === "no-install-date";
  const unknown = present([...d.unknowns.map((u) => unknownLine(u, ctx)), ...d.limits.filter((l) => !always(l)).map((l) => limitLine(l, ctx))]);
  const fixed = present(d.limits.filter(always).map((l) => limitLine(l, ctx)));
  if (unknown.length === 0 && fixed.length === 0) return null;
  return (
    <Fold title={t("paramedic.checked.cantSeeFold")} testid="paramedic-limits">
      {unknown.length > 0 && (
        <div>
          <p className="gl-row-title">{t("paramedic.checked.unknown")}</p>
          <ul className="gl-para-lines">
            {unknown.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {fixed.length > 0 && (
        <ul className="gl-para-lines">
          {fixed.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </Fold>
  );
}

const NOW_ORDER: Record<ParamedicNow, number> = { "points-to": 0, "cant-tell": 1, "points-away": 2 };

/** Candidates in the order the card lists them: the recovery re-orders by what it says, then the engine's ranking. */
function ordered(list: ParamedicFinding[], recovered: boolean): ParamedicFinding[] {
  if (!recovered) return list;
  return list
    .map((f, i) => ({ f, i }))
    .sort((a, b) => NOW_ORDER[a.f.now ?? "cant-tell"] - NOW_ORDER[b.f.now ?? "cant-tell"] || a.i - b.i)
    .map((x) => x.f);
}

/** Candidates as one-line rows (at most `ROWS_SHOWN`), the rest under "Also possible". */
function Candidates({ rows, rest, d, ctx, recovered }: { rows: ParamedicFinding[]; rest: ParamedicFinding[]; d: ParamedicDiagnosis; ctx: Ctx; recovered: boolean }) {
  return (
    <>
      <div className="gl-para-rows">
        {rows.map((f, i) => (
          <Row key={`${f.id}-${i}`} f={f} d={d} ctx={ctx} recovered={recovered} />
        ))}
      </div>
      <AlsoPossible list={rest} d={d} ctx={ctx} recovered={recovered} />
    </>
  );
}

/** A candidate's name, or for a recorded change in the stretch that has no row of its own, a short plain name. */
function nameOfId(id: string, byId: (id: string) => ParamedicFinding | undefined, ctx: Ctx): string {
  const f = byId(id);
  const own = f ? findingTitle(f, ctx) : null;
  if (own) return own;
  if (id === "game-files-change") return ctx.t("paramedic.recovered.gapGameFiles", { game: ctx.game });
  if (id === "program-installed") return ctx.t("paramedic.recovered.gapProgram");
  return whatText(id, ctx.t) ?? "";
}

/** Lines of the stretch between the rough sessions and the normal ones that say a record could not be read (no change is named by them). */
const UNREAD_GAP = new Set(["gap-unread", "recovery-build-unread", "recovery-compy-unread"]);

function RecoveredAnswer({ d, ctx }: { d: ParamedicDiagnosis; ctx: Ctx }) {
  const { t, game } = ctx;
  const r = d.recovery;
  if (!r) return null;
  const list = ordered(d.findings, true);
  const rows = list.slice(0, ROWS_SHOWN);
  const rest = list.slice(ROWS_SHOWN);
  const byId = (id: string) => d.findings.find((f) => f.id === id);
  const s = r.summary;
  let verdict: string;
  // A setting read back on is never named as the reason: two sessions in the usual range show the game is back to
  // usual, and that nothing else recorded changed in that stretch, not that this setting did it.
  if (s.kind === "points-to" && s.id === "setting-drift") {
    // One setting or several: how many titles the notice kept. What it searched is named in the sentence itself.
    const kept = (byId("setting-drift")?.evidence ?? [])
      .filter((e) => e.code === "drift-noticed")
      .flatMap((e) => (e.args.titles ?? "").split(US).map((x) => x.trim()).filter(Boolean));
    verdict = t("paramedic.recovered.settingBack", { count: Math.max(1, kept.length) });
  } else if (s.kind === "points-to") verdict = t("paramedic.recovered.pointsTo", { what: nameOfId(s.id, byId, ctx) });
  else if (s.kind === "between") {
    verdict = t("paramedic.recovered.between", {
      list: s.ids
        .map((id) => nameOfId(id, byId, ctx))
        .filter((x) => x)
        .join(", "),
    });
  } else verdict = t("paramedic.recovered.nothing");
  const also = r.also_changed.map((e) => evidenceLine(e, ctx)).filter((x): x is string => !!x);
  return (
    <>
      <div className="gl-card-top">
        <h2 className="gl-card-title">{t("paramedic.recovered.title", { game })}</h2>
        <span className="gl-chip" data-tone="ok">
          {t("paramedic.problem.badge")}
        </span>
      </div>
      <p>{t("paramedic.recovered.numbers", { beforePct: pct(r.before.ratio), roughPct: pct(r.rough.ratio), nowPct: pct(r.now.ratio) })}</p>
      <p className="gl-card-title" data-testid="paramedic-verdict">
        {verdict}
      </p>
      {/* Said only when the stretch itself recorded another change: a "between" made only of rows still standing, or of
          a stamp Compy could not read, is not "more than one change was recorded". */}
      {s.kind === "between" && s.ids.includes("setting-drift") && r.also_changed.some((e) => !UNREAD_GAP.has(e.code)) && (
        <p className="gl-para-note" data-testid="paramedic-between-cant-tell">
          {t("paramedic.recovered.betweenCantTell")}
        </p>
      )}
      <Candidates rows={rows} rest={rest} d={d} ctx={ctx} recovered />
      {also.map((l) => (
        <p className="gl-para-note" key={l}>
          {l}
        </p>
      ))}
      <p className="gl-para-note">{t("paramedic.recovered.next")}</p>
      <p className="gl-para-note">{t("paramedic.recovered.notProven")}</p>
      <Checked d={d} ctx={ctx} />
      <CantSee d={d} ctx={ctx} />
    </>
  );
}

/** B2 (owner decision 2026-11-21): exactly one clear session since the rough ones. It is said, labelled "Measured
 *  once", with its numbers; it raises no candidate (the rows stay as they were, all Possible), it ends with "Still
 *  between: …" when two or more are still standing, and with "can't tell which one mattered" when more than one change
 *  was recorded in that stretch. */
function MeasuredOnceAnswer({ d, m, ctx }: { d: ParamedicDiagnosis; m: NonNullable<ParamedicDiagnosis["measured_once"]>; ctx: Ctx }) {
  const { t, game } = ctx;
  const byId = (id: string) => d.findings.find((f) => f.id === id);
  const names = m.between.map((id) => nameOfId(id, byId, ctx)).filter((x) => x);
  const also = m.also_changed.map((e) => evidenceLine(e, ctx)).filter((x): x is string => !!x);
  const list = d.findings.slice(0, ROWS_SHOWN);
  return (
    <>
      <Problem d={d} ctx={ctx} skipLater />
      <div className="gl-card-top">
        <h2 className="gl-card-title">{t("paramedic.measuredOnce.title", { game })}</h2>
        <span className="gl-chip" data-testid="paramedic-measured-once-chip">
          {t("common.confidenceWord.measuredOnce")}
        </span>
      </div>
      <p>
        {t("paramedic.measuredOnce.numbers", {
          beforePct: pct(m.before.ratio),
          roughPct: pct(m.rough.ratio),
          nowPct: pct(m.now.ratio),
          date: ctx.dates.day(m.session.started_at),
        })}
      </p>
      <p data-testid="paramedic-unclear">{t("paramedic.measuredOnce.notYet", { game })}</p>
      {m.cant_attribute && (
        <p className="gl-para-note" data-testid="paramedic-measured-once-cant-attribute">
          {t("paramedic.measuredOnce.cantAttribute")}
        </p>
      )}
      <Candidates rows={list} rest={d.findings.slice(ROWS_SHOWN)} d={d} ctx={ctx} recovered={false} />
      {also.map((l) => (
        <p className="gl-para-note" key={l}>
          {l}
        </p>
      ))}
      {names.length >= 2 && (
        <p className="gl-card-title" data-testid="paramedic-verdict">
          {t("paramedic.recovered.between", { list: names.join(", ") })}
        </p>
      )}
      <Checked d={d} ctx={ctx} />
      <CantSee d={d} ctx={ctx} />
    </>
  );
}

/** One of the answers the engine can give, in the owner's words. */
function Answer({ d, ctx }: { d: ParamedicDiagnosis; ctx: Ctx }) {
  const { t } = ctx;
  const s = d.state;
  const game = ctx.game;
  if (s.kind === "recovered" && d.recovery) return <RecoveredAnswer d={d} ctx={ctx} />;
  if (s.kind === "found" && d.findings.length > 0) {
    const separable = d.why_first !== "not-separable";
    const inPlay = d.findings.filter((f) => f.in_play);
    // Not separable: the changes that line up, no winner. Otherwise the engine's lead and what lines up behind it.
    const rowsAll = separable ? [d.findings[0], ...inPlay.filter((f) => f !== d.findings[0])] : inPlay;
    const rows = rowsAll.slice(0, ROWS_SHOWN);
    const rest = d.findings.filter((f) => !rows.includes(f));
    const lead = d.findings[0];
    let verdict: string;
    if (!separable) verdict = t("paramedic.notSeparable.title");
    else if (lead.confidence === "likely") verdict = t("paramedic.verdict.likely");
    // "Lines up with when it started" is said only when something in play has timing. A finding that rests on
    // a measured figure alone (no start, no dated change) says what was measured and that it is not tied to a time.
    else if (!inPlay.length && lead.id !== "graphics-mod") verdict = t("paramedic.verdict.possibleMeasured");
    else verdict = t("paramedic.verdict.possible");
    let next: string;
    if (!separable) {
      next = inPlay.some((f) => f.id === "background-load")
        ? t("paramedic.notSeparable.next", { game })
        : t("paramedic.notSeparable.nextOther", { game });
    } else if (lead.confidence === "likely") {
      next = t("paramedic.next.likely", { game });
    } else {
      next = t("paramedic.next.possible", { game });
    }
    const endsWithReplay = separable && lead.id === "background-load" && lead.fix.kind === "steps";
    return (
      <>
        <Problem d={d} ctx={ctx} />
        <p className="gl-card-title" data-testid="paramedic-verdict">
          {verdict}
        </p>
        <Candidates rows={rows} rest={rest} d={d} ctx={ctx} recovered={false} />
        {/* Two things to test: change one before the next session, never both. */}
        {inPlay.filter((f) => stepLines(f.fix, ctx, restoredAt(f), appliedOnly(f)).length > 0).length >= 2 && (
          <p className="gl-para-note" data-testid="paramedic-test-one">
            {t("paramedic.verdict.testOne")}
          </p>
        )}
        {/* The lead's own last step already says "play once, then press the button again": not said twice. */}
        {!endsWithReplay && <p className="gl-para-note">{next}</p>}
        <Checked d={d} ctx={ctx} />
        <CantSee d={d} ctx={ctx} />
      </>
    );
  }
  if (s.kind === "cant-tell" && s.why.kind === "recovery-unclear") {
    const w = s.why;
    if (w.one_clear && d.measured_once) return <MeasuredOnceAnswer d={d} m={d.measured_once} ctx={ctx} />;
    // The problem line, then what Compy can't tell yet, then the candidates as collapsed rows.
    const body = w.cap_changed
      ? t("paramedic.cantTell.recoveryCap", { game })
      : w.one_clear
        ? t("paramedic.cantTell.oneClear", { game })
        : t("paramedic.cantTell.backToNormal", { game });
    const list = d.findings.slice(0, ROWS_SHOWN);
    return (
      <>
        <Problem d={d} ctx={ctx} skipLater />
        <h2 className="gl-card-title">{t("paramedic.cantTell.title")}</h2>
        <p data-testid="paramedic-unclear">{body}</p>
        <Candidates rows={list} rest={d.findings.slice(ROWS_SHOWN)} d={d} ctx={ctx} recovered={false} />
        <Checked d={d} ctx={ctx} />
        <CantSee d={d} ctx={ctx} />
      </>
    );
  }
  if (s.kind === "cant-tell" && s.why.kind === "nothing-changed") {
    return (
      <>
        <Problem d={d} ctx={ctx} />
        <h2 className="gl-card-title">{t("paramedic.nothingChanged.title")}</h2>
        <p className="gl-para-note">{t("paramedic.nothingChanged.next")}</p>
        <Checked d={d} ctx={ctx} />
        <CantSee d={d} ctx={ctx} />
      </>
    );
  }
  if (s.kind === "nothing-wrong") {
    return (
      <>
        <h2 className="gl-card-title">{t("paramedic.nothingWrong.title")}</h2>
        <p>{t("paramedic.nothingWrong.body", { game, count: s.sessions_checked })}</p>
      </>
    );
  }
  let body: string;
  if (s.kind === "needs-more-play") {
    body = t("paramedic.cantTell.needsMore", { game, have: s.have, total: s.have + s.sessions_needed });
  } else if (s.kind === "cant-tell" && s.why.kind === "partial-measure") {
    body = s.why.looked_rough
      ? t("paramedic.cantTell.partialRough", { game, percent: s.why.percent })
      : t("paramedic.cantTell.partial", { game, percent: s.why.percent });
  } else if (s.kind === "cant-tell" && s.why.kind === "frame-cap-changed") {
    body = t("paramedic.cantTell.frameCap", { game });
  } else if (s.kind === "cant-tell" && s.why.kind === "crash-not-covered") {
    body = t("paramedic.cantTell.crash");
  } else if (d.game) {
    body = t("paramedic.cantTell.noGame", { game });
  } else {
    body = t("paramedic.cantTell.noSessions");
  }
  // B7 (b5 plan slice 3): on "needs more sessions", the sessions Compy holds that don't count are named with
  // their reason (only when there are any), and the card says what it can't say without the rest. Counts
  // only, no likelihood word, and no promise that more sessions bring a verdict.
  const notCounted = s.kind === "needs-more-play" ? (s.not_counted ?? 0) : 0;
  return (
    <>
      <h2 className="gl-card-title">{t("paramedic.cantTell.title")}</h2>
      <p>{body}</p>
      {s.kind === "needs-more-play" && notCounted > 0 && (
        <p data-testid="paramedic-needs-more-not-counted">
          {t("paramedic.cantTell.needsMoreNotCounted", { game, count: notCounted })}
        </p>
      )}
      {s.kind === "needs-more-play" && (
        <p data-testid="paramedic-needs-more-without">
          {t("paramedic.cantTell.needsMoreWithout", { game, total: s.have + s.sessions_needed })}
        </p>
      )}
      {s.kind === "cant-tell" && s.why.kind === "frame-cap-changed" && d.findings[0] && (
        <Candidates rows={[d.findings[0]]} rest={[]} d={d} ctx={ctx} recovered={false} />
      )}
    </>
  );
}

/** B4: the answer's state as a short label for "The answer went from … to …". */
function stateLabel(d: ParamedicDiagnosis, t: T): string {
  const s = d.state;
  if (s.kind === "found") return t("paramedic.sinceLast.stateLabel.rough");
  if (s.kind === "recovered") return t("paramedic.sinceLast.stateLabel.recovered");
  if (s.kind === "nothing-wrong") return t("paramedic.sinceLast.stateLabel.nothingWrong");
  if (s.kind === "needs-more-play") return t("paramedic.sinceLast.stateLabel.needsMore");
  if (s.why.kind === "recovery-unclear" && s.why.one_clear) return t("paramedic.sinceLast.stateLabel.once");
  if (s.why.kind === "nothing-changed") return t("paramedic.sinceLast.stateLabel.rough");
  return t("paramedic.sinceLast.stateLabel.cantTell");
}

/** B4: a row's chip as one string (the certainty word first when the timing chip sits beside it). */
function chipText(f: ParamedicFinding, d: ParamedicDiagnosis, t: T): string {
  const c = chipFor(f, d.state.kind === "recovered", t);
  return c.certainty ? `${c.certainty.text}, ${c.text}` : c.text;
}

/** B4 ("what changed since last time"): after "Check again" in the same open, what differs between the answer that
 *  was on screen and the new one. Both answers are held in memory only; closing the card forgets them. The session
 *  count comes from the engine's own `recorded` (never from the rows shown), so "no new session" is a count. */
function SinceLast({ prev, d, ctx }: { prev: ParamedicDiagnosis; d: ParamedicDiagnosis; ctx: Ctx }) {
  const { t, game, dates } = ctx;
  if (prev.game !== d.game) {
    return (
      <p className="gl-para-note" data-testid="paramedic-since">
        {t("paramedic.sinceLast.otherGame", { game, prev: prev.game_name ?? prev.game ?? "" })}
      </p>
    );
  }
  const counts: string[] = [];
  let noNew = false;
  const a = prev.recorded;
  const b = d.recorded;
  if (a && b) {
    // The newest start first: at the store's session cap a new session can leave the count equal (or lower).
    const newer = Date.parse(b.newest_at) > Date.parse(a.newest_at);
    if (newer && b.sessions > a.sessions) counts.push(t("paramedic.sinceLast.newSessions", { count: b.sessions - a.sessions, game, date: dates.day(b.newest_at) }));
    else if (newer) counts.push(t("paramedic.sinceLast.newSessionsCapped", { game, date: dates.day(b.newest_at) }));
    else if (b.sessions < a.sessions) counts.push(t("paramedic.sinceLast.fewer", { game }));
    else if (b.newest_at === a.newest_at && b.sessions === a.sessions) noNew = true;
  }
  // Review r1 F1: something read last time and not this time (an unknown or a limit that is new) means a row can
  // drop out, or nothing differ, only because it wasn't read: never "nothing changed" then, and it is said first.
  const readKeys = (x: ParamedicDiagnosis) => new Set([...x.unknowns, ...x.limits.map((l) => `${l.kind}:${l.code}`)]);
  const readBefore = readKeys(prev);
  const lessRead = [...readKeys(d)].some((k) => !readBefore.has(k));
  const changes: string[] = [];
  const was = stateLabel(prev, t);
  const now = stateLabel(d, t);
  if (was !== now) changes.push(t("paramedic.sinceLast.state", { from: was, to: now }));
  for (const f of d.findings) {
    const name = findingTitle(f, ctx) ?? f.id;
    const before = prev.findings.find((x) => x.id === f.id);
    if (!before) changes.push(t("paramedic.sinceLast.rowNew", { name }));
    else if (chipText(before, prev, t) !== chipText(f, d, t)) changes.push(t("paramedic.sinceLast.row", { name, from: chipText(before, prev, t), to: chipText(f, d, t) }));
  }
  for (const f of prev.findings) {
    // With less read this time, a row that is gone may only be unread: "not shown", never "no longer listed".
    if (!d.findings.some((x) => x.id === f.id)) {
      const name = findingTitle(f, ctx) ?? f.id;
      changes.push(lessRead ? t("paramedic.sinceLast.rowNotShown", { name }) : t("paramedic.sinceLast.rowGone", { name }));
    }
  }
  const sessions = noNew ? [t("paramedic.sinceLast.noNew", { game })] : counts;
  const lines = lessRead
    ? [t("paramedic.sinceLast.lessRead"), ...sessions, ...changes]
    : changes.length === 0
      ? noNew
        ? [t("paramedic.sinceLast.unchangedNoNew", { game })]
        : [...counts, t("paramedic.sinceLast.unchanged")]
      : [...sessions, ...changes];
  return (
    <div data-testid="paramedic-since">
      <p className="gl-row-title">{t("paramedic.sinceLast.title")}</p>
      <ul className="gl-para-lines">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/** `still`: another diagnosis kept running past every retry. That is "still checking", never a failed read.
 *  `busy.prev`: the answer on screen when "Check again" was pressed. It stays mounted (dimmed, aria-busy) until the new one arrives. */
type View =
  | { kind: "idle" }
  | { kind: "busy"; prev: ParamedicDiagnosis | null }
  | { kind: "still" }
  | { kind: "failed" }
  | { kind: "done"; d: ParamedicDiagnosis; prev?: ParamedicDiagnosis | null };

const LAYER_ROLES = new Set(["dialog", "alertdialog", "menu", "listbox", "tooltip", "combobox"]);

/** A popover-like layer: an element that is one (by role) or a toggle that opened one (`aria-haspopup`, expanded). */
function isLayer(n: HTMLElement): boolean {
  const role = n.getAttribute("role");
  if (role && LAYER_ROLES.has(role)) return true;
  const popup = n.getAttribute("aria-haspopup");
  return !!popup && popup !== "false" && n.getAttribute("aria-expanded") === "true";
}

/** The answer region counts as "more below" when more than this many px are still hidden under its bottom edge. */
const MORE_SLACK_PX = 4;

/** `drifts`: null/undefined while the readiness scan has not loaded (no default: "not loaded" is not "no drift").
 *  `rough` (B1 Home truth): the games Home's sessions-only read found running rougher than usual. While the card is
 *  idle its line names them, so Home's count always points at something on the page. `roughUnread`: that read
 *  failed; idle, the line says so instead of staying silent. */
export function ParamedicCard({
  noGames = false,
  games = [],
  drifts,
  rough = [],
  roughUnread = false,
  onOpenCheck,
  reverted = null,
  onChanged,
  changes = null,
  undoCompyChange,
}: {
  noGames?: boolean;
  games?: RecordedGame[];
  drifts?: Drift[] | null;
  rough?: RoughGame[];
  roughUnread?: boolean;
  onOpenCheck?: () => void;
  /** B3: the ledger's changes Compy applied that read off now (use-scan `deriveReverted`); null = not read, no button. */
  reverted?: RevertedChange[] | null;
  /** Run after a turn-on, like after any apply (App's refresh). */
  onChanged?: () => Promise<unknown> | void;
  /** B10: the ledger's records (null = not read: no undo offered). Used to DRAW the offer only; App re-reads at the click. */
  changes?: AppliedChange[] | null;
  /** B10: App's `undoOneRecord`: ids and one sentence in, one `rollback_change` (or a refusal with no call) out. */
  undoCompyChange?: (recId: string, expectedId: string, extraBody: string) => Promise<CardUndoResult>;
} = {}) {
  const { t, i18n } = useTranslation();
  // B3: the Lab's confirm dialog. Without one (an isolated mount) the card offers no turn-on at all.
  const confirm = useConfirmOptional();
  const [turning, setTurning] = useState<string | null>(null);
  const [turnedOn, setTurnedOn] = useState<{ rec_id: string; title: string; at: string }[]>([]);
  const pressing = useRef(false);
  // B10: the record whose undo App is running, and what each press came back with (memory only, this mount).
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoResults, setUndoResults] = useState<Record<string, CardUndoResult["kind"]>>({});
  const undoPressing = useRef(false);
  const dates = useDates();
  const [view, setView] = useState<View>({ kind: "idle" });
  const [more, setMore] = useState(false);
  const [scrolls, setScrolls] = useState(false);
  // Every press of the door starts the first look over (its question, not an answer from before the user played).
  const [round, setRound] = useState(0);
  // "Something else? Answer a few questions": the first-look questions open in the card, in place of the measured
  // answer (which "Back" and "Check again" bring back). Nothing here is stored.
  const [questions, setQuestions] = useState(false);
  const [lookAsking, setLookAsking] = useState(false);
  // Bumped when the card is closed or asks anew, so an answer to an earlier ask is dropped.
  const gen = useRef(0);
  const doorRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // Focus is waiting on the card while the check runs (see the effect on `dim`).
  const parked = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const refocus = useRef(false);
  // "Back to the answer": focus goes to the answer, so the keyboard (and Escape) still works inside the card.
  const backFocus = useRef(false);

  // After unmount nothing may run again: the retry timer is cleared and a late answer is dropped.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);
  // After "Close" the card is its small bar again: keyboard focus goes to the bar's button, not to nowhere.
  useEffect(() => {
    if (view.kind === "idle" && refocus.current) {
      refocus.current = false;
      doorRef.current?.focus();
    }
  }, [view.kind]);

  const ask = (attempt: number) => {
    if (attempt === 0) {
      setRound((r) => r + 1);
      setQuestions(false);
      gen.current += 1;
    }
    const mine = gen.current;
    // Pressing "Check again" keeps the answer on screen (dimmed) so the card does not collapse and jump the page.
    setView((v) => ({ kind: "busy", prev: v.kind === "done" ? v.d : v.kind === "busy" ? v.prev : null }));
    invoke<ParamedicDiagnosis | null>("paramedic_diagnose", { complaint: "unknown", game: null })
      .then((d) => {
        // B4: the answer that was on screen when "Check again" was pressed stays beside the new one (memory only), so
        // the card can say what changed since then.
        if (alive.current && mine === gen.current) setView((v) => (d ? { kind: "done", d, prev: v.kind === "busy" ? v.prev : null } : { kind: "failed" }));
      })
      .catch((e: unknown) => {
        if (!alive.current || mine !== gen.current) return;
        if (String(e) !== BUSY) {
          setView({ kind: "failed" });
        } else if (attempt < BUSY_RETRIES) {
          // Another diagnosis is still running: keep saying "still checking" and ask again shortly.
          timer.current = window.setTimeout(() => ask(attempt + 1), BUSY_RETRY_MS);
        } else {
          setView({ kind: "still" });
        }
      });
  };

  const close = () => {
    window.clearTimeout(timer.current);
    gen.current += 1;
    refocus.current = true;
    setQuestions(false);
    setView({ kind: "idle" });
    doorRef.current?.focus();
  };

  const answer = view.kind === "done" ? view.d : view.kind === "busy" ? view.prev : null;
  // Idle with a rough game: the line names it (Home counted it). Once the card answers, the answer speaks.
  const idleRough =
    view.kind !== "idle"
      ? ""
      : rough.length > 0
        ? roughLine({ kind: "read", games: rough, judged: rough.length }, t, i18n.language)
        : roughUnread
          ? t("home.posture.rough.unread")
          : "";
  // B3: the settings the card may turn back on: ones the ledger says Compy applied and that read off now (the Lab's own
  // list), that the live drift names too. A setting turned on from this card keeps its dated line after the refresh
  // takes it out of both lists. No ledger list, no drift names or no confirm dialog: nothing is offered.
  // B3b: matched by the ledger's rec id the drift carries per title; a title is used only for a drift title that has
  // no id recorded (a scan from a build that sent none), so a renamed catalog title can't hide or swap a button.
  const live = (drifts ?? []).find((d) => d.id === "applied-changes");
  const liveTitles = live?.titles ?? [];
  const liveRecs: string[] = live?.recs && live.recs.length === liveTitles.length ? live.recs : [];
  const liveIds = new Set(liveRecs.filter((id) => id !== ""));
  const titlesWithoutId = new Set(liveTitles.filter((_, i) => !liveRecs[i]));
  const isLive = (r: RevertedChange) => liveIds.has(r.rec_id) || titlesWithoutId.has(r.title);
  const offer: RevertedChange[] = [
    ...(confirm && reverted ? reverted.filter(isLive) : []),
    ...turnedOn.filter((x) => !(reverted ?? []).some((r) => r.rec_id === x.rec_id && isLive(r))),
  ];
  const press = (rev: RevertedChange) => {
    if (!confirm || pressing.current) return;
    pressing.current = true;
    // One change at a time is advised, never enforced: a second turn-on in the same open says so in its confirm.
    const other = turnedOn[turnedOn.length - 1];
    void turnBackOn(rev, {
      confirm: async (o) => {
        const ok = await confirm(o);
        if (ok && !o.acknowledge && alive.current) setTurning(rev.rec_id);
        return ok;
      },
      t,
      after: onChanged,
      extraBody: other ? t("paramedic.fix.settingDrift.secondChange", { other: other.title }) : undefined,
    })
      .then((res) => {
        if (!alive.current) return;
        if (res.kind === "done") setTurnedOn((prev) => [...prev, { rec_id: rev.rec_id, title: rev.title, at: res.change?.applied_at ?? "" }]);
      })
      .finally(() => {
        pressing.current = false;
        if (alive.current) setTurning(null);
      });
  };
  const reapply: Reapply | undefined = offer.length > 0 ? { offer, busy: turning, done: turnedOn, press } : undefined;
  const game = answer ? (answer.game_name ?? answer.game ?? "") : "";
  // B10: one press at a time; the card passes ids and the confirm's extra sentence, App does the rest.
  const pressUndo = (recId: string, id: string) => {
    if (!undoCompyChange || undoPressing.current) return;
    undoPressing.current = true;
    setUndoing(id);
    void undoCompyChange(recId, id, t("paramedic.fix.compyChange.undoExtra", { game, ...RAW }))
      .then((r) => {
        if (alive.current) setUndoResults((prev) => ({ ...prev, [id]: r.kind }));
      })
      .catch(() => {
        if (alive.current) setUndoResults((prev) => ({ ...prev, [id]: "failed" }));
      })
      .finally(() => {
        undoPressing.current = false;
        if (alive.current) setUndoing(null);
      });
  };
  // The settings the live drift list names (by rec id, or by title for a drift title with no id). Not loaded: null.
  const driftRecs: ReadonlySet<string> | null =
    drifts == null ? null : new Set([...liveIds, ...(changes ?? []).filter((c) => titlesWithoutId.has(c.rec_title)).map((c) => c.rec_id)]);
  const compyUndo: CompyUndo | undefined =
    changes && undoCompyChange ? { list: changes, driftRecs, busy: undoing, results: undoResults, press: pressUndo } : undefined;
  const ctx: Ctx | null = answer
    ? {
          t,
          dates,
          game,
          drifts,
          lang: i18n.language,
          startRecord: answer.start_record,
          reapply,
          compyUndo,
          // Opening the health check asks for the "turn it back on" row to take focus there.
          onOpenCheck: onOpenCheck ? () => { requestCheckFocus("applied-changes"); onOpenCheck(); } : undefined,
        }
    : null;
  const showQuestions = questions;
  const open = answer != null || showQuestions;
  const busy = view.kind === "busy";
  // While the card is still asking ("Which game?", "When did it start?") there is nothing to check again: the
  // green button waits until an answer, measured or first-look, is showing.
  const hideCheck = lookAsking && (showQuestions || (answer != null && firstLookApplies(answer)));
  // The questions are open over a check that is still running: nothing there is dimmed or inert.
  const dim = busy && !showQuestions;
  // Escape closes the open card from anywhere inside it, exactly when "Close" is offered (an answer, the open
  // questions) and also after a failed or slow check; and not while "Check again" is running over an answer.
  // An open row, fold or "Show more" is an inline section, not a layer on top: Escape still closes the card from
  // inside it (focus stays on its toggle, so the old rule made Escape dead once anything was opened). Only a
  // popover-like layer (a dialog, menu, listbox, tooltip or a toggle that opens one) keeps the key for itself, so it
  // closes first.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (!(view.kind === "done" || view.kind === "failed" || view.kind === "still" || showQuestions)) return;
    for (let n = e.target as HTMLElement | null; n && n !== e.currentTarget; n = n.parentElement) {
      if (isLayer(n)) return;
    }
    e.preventDefault();
    close();
  };

  // Whether the answer region has more below its bottom edge: drives the fade and the "More below" row.
  const measure = useCallback(() => {
    const el = scrollRef.current;
    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > MORE_SLACK_PX);
    // A region that never scrolls has no hint to reserve room for.
    setScrolls(!!el && el.scrollHeight - el.clientHeight > MORE_SLACK_PX);
  }, []);
  useEffect(() => {
    if (!questions && backFocus.current) {
      backFocus.current = false;
      scrollRef.current?.focus();
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [questions]);
  // The button that was just pressed leaves while the questions are asked: if focus was on it, it moves into the
  // card (the first question's heading takes it when it can; otherwise the answer region), never to the page.
  // While a check runs the answer region is inert and cannot take focus: the card itself (never inert) holds it,
  // and it moves to the question's heading once the region is usable again.
  useEffect(() => {
    if (!hideCheck) return;
    const a = document.activeElement;
    // Focus the question's own heading took inside the inert region does not count: a browser refuses it there.
    if (a && a !== document.body && !(dim && scrollRef.current?.contains(a))) return;
    if (dim) {
      parked.current = true;
      sectionRef.current?.focus();
    } else {
      scrollRef.current?.focus();
    }
  }, [hideCheck]);
  useEffect(() => {
    if (dim || !parked.current) return;
    parked.current = false;
    const heading = scrollRef.current?.querySelector<HTMLElement>("h2");
    (heading ?? scrollRef.current)?.focus();
  }, [dim]);
  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [answer, measure]);

  return (
    <section ref={sectionRef} tabIndex={-1} onKeyDown={onKeyDown} className="gl-card gl-para-card" aria-label={t("paramedic.label")} data-testid="paramedic" data-open={open ? "true" : "false"}>
      <div className="gl-card-top">
        <p className="gl-card-sub" data-testid={idleRough ? "paramedic-rough" : undefined}>
          {idleRough || (noGames ? t("paramedic.firstLook.door.sub") : t("paramedic.door.sub"))}
        </p>
        <div className="gl-para-actions">
          {/* Busy: aria-disabled, not disabled, so keyboard focus is not lost; a click while busy is ignored. */}
          {!hideCheck && (
            <button
              ref={doorRef}
              type="button"
              className="gl-cta"
              aria-disabled={busy}
              onClick={() => {
                if (view.kind !== "busy") ask(0);
              }}
            >
              {view.kind === "done" || view.kind === "failed" || view.kind === "still" || (busy && view.prev) ? t("paramedic.door.again") : t("paramedic.door.button")}
            </button>
          )}
          {(view.kind === "done" || questions) && (
            <button type="button" className="gl-ghost" onClick={close}>
              {t("paramedic.door.close")}
            </button>
          )}
        </div>
      </div>
      {busy && !view.prev && (
        <p className="gl-card-sub" role="status">
          {t("paramedic.door.looking")}
        </p>
      )}
      {view.kind === "still" && (
        <p className="gl-card-sub" role="status">
          {t("paramedic.door.stillChecking")}
        </p>
      )}
      {view.kind === "failed" && (
        <p className="gl-card-sub" role="alert">
          {t("paramedic.door.failed")}
        </p>
      )}
      {(showQuestions || (answer && ctx)) && (
        <div className="gl-para-answer">
          <div
            ref={scrollRef}
            className="gl-para-scroll"
            role="region"
            aria-label={t("paramedic.card.scrollLabel")}
            aria-busy={dim}
            // The old answer is not interactive or focusable while "Check again" is running: it is dimmed,
            // announced as busy, and out of reach until the new one replaces it. The questions are not the old
            // answer: they stay usable while a check runs.
            inert={dim}
            data-busy={dim ? "true" : undefined}
            tabIndex={0}
            onScroll={measure}
          >
            <div className="gl-para-body" aria-live="polite">
              {showQuestions ? (
                <ParamedicFirstLook key={`questions-${round}`} games={games} elsewhere onAsking={setLookAsking} />
              ) : answer && ctx ? (
                <>
                  {view.kind === "done" && view.prev && <SinceLast prev={view.prev} d={answer} ctx={ctx} />}
                  {/* No usable history: with no game recorded the first look is the whole answer; with a game that
                      has too few sessions it follows the measured "can't tell yet". */}
                  {!(answer.state.kind === "cant-tell" && answer.state.why.kind === "no-sessions") && <Answer d={answer} ctx={ctx} />}
                  {firstLookApplies(answer) && <ParamedicFirstLook key={round} measured={firstLookMeasured(answer, ctx.game)} games={games} onAsking={setLookAsking} />}
                  {answer.mixed_sessions.length > 0 && (
                    <p className="gl-para-note" data-testid="paramedic-mixed">
                      {t("paramedic.problem.mixed", { count: answer.mixed_sessions.length, dates: answer.mixed_sessions.map((s) => dates.day(s)).join(", ") })}
                    </p>
                  )}
                  {!firstLookApplies(answer) && <p className="gl-para-note">{t("paramedic.footer")}</p>}
                </>
              ) : null}
            </div>
          </div>
          {dim && (
            <p className="gl-para-status" role="status">
              {t("paramedic.door.looking")}
            </p>
          )}
          {/* The hint is its own strip under the scroll region, never over its last row. At the end of the region it
              is hidden, not removed: its space stays reserved so nothing moves when the last row is reached. */}
          {!showQuestions && scrolls && (
            <div className="gl-para-more" aria-hidden="true" data-testid="paramedic-more" data-shown={more ? "true" : "false"} style={more ? undefined : { visibility: "hidden" }}>
              <ChevronDown />
              <span>{t("paramedic.card.moreBelow")}</span>
            </div>
          )}
        </div>
      )}
      {/* In every state but the idle one (a first check still running, an answer, a failed or a slow one): the
          way out to the questions is never hidden behind the check. */}
      {questions && answer && (
        <div className="gl-para-foot">
          <button type="button" className="gl-ghost" onClick={() => {
              backFocus.current = true;
              setQuestions(false);
            }}>
            {t("paramedic.card.back")}
          </button>
        </div>
      )}
      {!questions && view.kind !== "idle" && !(answer && firstLookApplies(answer)) && (
        <div className="gl-para-foot">
          <button
            type="button"
            className="gl-ghost"
            onClick={() => {
              setRound((r) => r + 1);
              setQuestions(true);
            }}
          >
            {t("paramedic.card.somethingElse")}
          </button>
        </div>
      )}
    </section>
  );
}
