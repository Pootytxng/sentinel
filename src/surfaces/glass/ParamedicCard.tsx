// PC Paramedic F1: the "Something's wrong" door on Health and the card that answers it. READ-ONLY: it
// asks the engine (`paramedic_diagnose`) on a tap, shows what the engine returned in plain words, and
// offers steps the owner does in Windows. It runs no fix, writes nothing, and says what changed before
// the problem, never that it caused it (Constitution 17). The engine returns codes and numbers; every
// sentence here is a locale string. Keys are literal, one t() call per key (never composed).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type {
  ParamedicDiagnosis,
  ParamedicEvidence,
  ParamedicFinding,
  ParamedicFix,
  ParamedicLimit,
  ParamedicNow,
  ParamedicRuledOut,
  ParamedicWhen,
} from "../../types";
import { useDates } from "./GamesRoom";

type T = ReturnType<typeof useTranslation>["t"];
type Dates = ReturnType<typeof useDates>;
type Ctx = { t: T; dates: Dates; game: string };

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
    default:
      return null;
  }
}

/** A finding's heading. A setting that drifted is named for what the records say: Compy-applied only when every notice is. */
function findingTitle(f: ParamedicFinding, { t, dates, game }: Ctx): string | null {
  if (f.id === "setting-drift") {
    const drift = f.evidence.filter((e) => e.code === "drift-noticed");
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

function evidenceLine(e: ParamedicEvidence, { t, dates, game }: Ctx): string | null {
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
      return t("paramedic.evidence.roughOnOldDriver", { count: Number(a.count) });
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
    case "load-measured":
      return t("paramedic.evidence.loadMeasured", { count: Number(a.count) });
    case "load-quiet":
      return t("paramedic.evidence.loadQuiet", { count: Number(a.count) });
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
    case "ram-peak":
      return t("paramedic.evidence.ramPeak", { peakGb: a.peakGb, totalGb: a.totalGb });
    case "ram-baseline":
      return t("paramedic.evidence.ramBaseline", { peakGb: a.peakGb });
    case "ram-warning":
      return t("paramedic.evidence.ramWarning");
    case "ram-lower":
      return t("paramedic.evidence.ramLower", { peakGb: a.peakGb });
    case "drift-noticed":
      if (a.check === "applied-changes") return t("paramedic.evidence.driftApplied");
      if (a.check === "power-profile") return t("paramedic.evidence.driftPower");
      return t("paramedic.evidence.driftOther");
    case "which-not-recorded":
      return t("paramedic.evidence.whichNotRecorded");
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

function stepLines(fix: ParamedicFix, { t, game }: Ctx): string[] {
  if (fix.kind !== "steps") return [];
  const a = fix.args;
  switch (fix.code) {
    case "gpu-driver-change":
      return [
        t("paramedic.fix.gpuDriver.step1"),
        t("paramedic.fix.gpuDriver.step2"),
        t("paramedic.fix.gpuDriver.step3", { from: a.from }),
        t("paramedic.fix.gpuDriver.step4", { from: a.from }),
        t("paramedic.fix.gpuDriver.step5", { game }),
      ];
    case "background-load":
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
      return [t("paramedic.fix.settingDrift.step1"), t("paramedic.fix.settingDrift.step2", { game })];
    case "compy-change":
      return [t("paramedic.fix.compyChange.step1"), t("paramedic.fix.compyChange.step2", { game })];
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
    default:
      return [];
  }
}

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
      return t("paramedic.checked.backgroundLoad");
    case "memory-pressure":
      return t("paramedic.checked.memoryPressure", { percent: a.percent });
    case "memory-as-full":
      return t("paramedic.checked.memoryAsFull", { peakGb: a.peakGb, totalGb: a.totalGb, basePeakGb: a.basePeakGb });
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
    default:
      return null;
  }
}

function unknownLine(code: string, { t, game }: Ctx): string | null {
  switch (code) {
    case "mods-no-folder":
      return t("paramedic.unknown.modsNoFolder", { game });
    case "mods-folder-unreadable":
      return t("paramedic.unknown.modsFolderUnreadable", { game });
    case "mods-partial":
      return t("paramedic.unknown.modsPartial", { game });
    case "mods-unavailable":
      return t("paramedic.unknown.modsUnavailable", { game });
    case "startup-programs":
      return t("paramedic.unknown.startupPrograms");
    case "overlays":
      return t("paramedic.unknown.overlays");
    case "other-load":
      return t("paramedic.unknown.otherLoad");
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

/** One line of "also looked at": things found that Compy does not treat as findings. */
function seenLine(s: ParamedicRuledOut, { t, dates, game }: Ctx): string | null {
  const a = s.args;
  switch (s.id) {
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
function Evidence({ list, ctx, hideInstallAt }: { list: ParamedicEvidence[]; ctx: Ctx; hideInstallAt?: string }) {
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

/** The steps for one candidate; they sit inside its row, which opens on a tap. */
function FixBlock({ fix, ctx }: { fix: ParamedicFix; ctx: Ctx }) {
  const steps = stepLines(fix, ctx);
  if (steps.length > 0) {
    return (
      <div>
        <p className="gl-row-title">{ctx.t("paramedic.fix.title")}</p>
        <ol className="gl-para-lines gl-para-steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    );
  }
  return fix.kind === "none" ? <p className="gl-para-note">{ctx.t("paramedic.fix.none")}</p> : null;
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

/** A disclosure: a button with aria-expanded; nothing inside is rendered until it is opened. */
function Fold({ title, testid, children }: { title: string; testid: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="gl-para-fold" data-testid={testid}>
      <button type="button" className="gl-para-fold-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true" className="gl-para-caret">
          {open ? "▾" : "▸"}
        </span>
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

function chipFor(f: ParamedicFinding, recovered: boolean, t: T): { text: string; tone?: string } {
  if (recovered && f.now) {
    return { text: nowText(f.now, t), tone: f.now === "points-to" ? "accent" : f.now === "points-away" ? "ok" : undefined };
  }
  if (f.confidence === "likely") return { text: t("paramedic.answer.likely"), tone: "accent" };
  if (f.confidence === "measured") return { text: t("paramedic.answer.measured"), tone: "accent" };
  if (f.confidence === "mechanism") return { text: t("paramedic.answer.mechanism") };
  return { text: t("paramedic.answer.possible") };
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
        <span aria-hidden="true" className="gl-para-caret">
          {open ? "▾" : "▸"}
        </span>
        <span className="gl-para-row-name" title={name ?? undefined}>
          {name}
        </span>
        {since && (
          <span className="gl-para-row-when" title={since}>
            {since}
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
          {!recovered && <FixBlock fix={f.fix} ctx={ctx} />}
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
  const ruled = present(d.not_it.map((n) => ruledOutLine(n, ctx)));
  const seen = present(d.seen.map((s) => seenLine(s, ctx)));
  if (ruled.length === 0 && seen.length === 0) return null;
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
  if (s.kind === "points-to") verdict = t("paramedic.recovered.pointsTo", { what: nameOfId(s.id, byId, ctx) });
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
    return (
      <>
        <Problem d={d} ctx={ctx} />
        <p className="gl-card-title" data-testid="paramedic-verdict">
          {verdict}
        </p>
        <Candidates rows={rows} rest={rest} d={d} ctx={ctx} recovered={false} />
        <p className="gl-para-note">{next}</p>
        <Checked d={d} ctx={ctx} />
        <CantSee d={d} ctx={ctx} />
      </>
    );
  }
  if (s.kind === "cant-tell" && s.why.kind === "recovery-unclear") {
    // The problem line, then what Compy can't tell yet, then the candidates as collapsed rows.
    const w = s.why;
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
  return (
    <>
      <h2 className="gl-card-title">{t("paramedic.cantTell.title")}</h2>
      <p>{body}</p>
      {s.kind === "cant-tell" && s.why.kind === "frame-cap-changed" && d.findings[0] && (
        <Candidates rows={[d.findings[0]]} rest={[]} d={d} ctx={ctx} recovered={false} />
      )}
    </>
  );
}

/** `still`: another diagnosis kept running past every retry. That is "still checking", never a failed read. */
type View = { kind: "idle" } | { kind: "busy" } | { kind: "still" } | { kind: "failed" } | { kind: "done"; d: ParamedicDiagnosis };

export function ParamedicCard() {
  const { t } = useTranslation();
  const dates = useDates();
  const [view, setView] = useState<View>({ kind: "idle" });
  const doorRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const refocus = useRef(false);

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
    setView({ kind: "busy" });
    invoke<ParamedicDiagnosis | null>("paramedic_diagnose", { complaint: "unknown", game: null })
      .then((d) => {
        if (alive.current) setView(d ? { kind: "done", d } : { kind: "failed" });
      })
      .catch((e: unknown) => {
        if (!alive.current) return;
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
    refocus.current = true;
    setView({ kind: "idle" });
  };

  const ctx: Ctx | null = view.kind === "done" ? { t, dates, game: view.d.game_name ?? view.d.game ?? "" } : null;
  const open = view.kind === "done";

  return (
    <section className="gl-card gl-para-card" aria-label={t("paramedic.label")} data-testid="paramedic" data-open={open ? "true" : "false"}>
      <div className="gl-card-top">
        <p className="gl-card-sub">{t("paramedic.door.sub")}</p>
        <div className="gl-para-actions">
          {/* Busy: aria-disabled, not disabled, so keyboard focus is not lost; a click while busy is ignored. */}
          <button
            ref={doorRef}
            type="button"
            className="gl-cta"
            aria-disabled={view.kind === "busy"}
            onClick={() => {
              if (view.kind !== "busy") ask(0);
            }}
          >
            {view.kind === "done" || view.kind === "failed" || view.kind === "still" ? t("paramedic.door.again") : t("paramedic.door.button")}
          </button>
          {open && (
            <button type="button" className="gl-ghost" onClick={close}>
              {t("paramedic.door.close")}
            </button>
          )}
        </div>
      </div>
      {view.kind === "busy" && (
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
      {view.kind === "done" && ctx && (
        <div className="gl-para-scroll" role="region" aria-label={t("paramedic.card.scrollLabel")} tabIndex={0}>
          <div className="gl-para-body" aria-live="polite">
            <Answer d={view.d} ctx={ctx} />
            {view.d.mixed_sessions.length > 0 && (
              <p className="gl-para-note" data-testid="paramedic-mixed">
                {t("paramedic.problem.mixed", { count: view.d.mixed_sessions.length, dates: view.d.mixed_sessions.map((s) => dates.day(s)).join(", ") })}
              </p>
            )}
            <p className="gl-para-note">{t("paramedic.footer")}</p>
          </div>
        </div>
      )}
    </section>
  );
}
