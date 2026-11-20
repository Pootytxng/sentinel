// PC Paramedic F1: the "Something's wrong" door on Health and the card that answers it. READ-ONLY: it
// asks the engine (`paramedic_diagnose`) on a tap, shows what the engine returned in plain words, and
// offers steps the owner does in Windows. It runs no fix, writes nothing, and says what changed before
// the problem, never that it caused it (Constitution 17). The engine returns codes and numbers; every
// sentence here is a locale string. Keys are literal, one t() call per key (never composed).
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type {
  ParamedicDiagnosis,
  ParamedicEvidence,
  ParamedicFinding,
  ParamedicFix,
  ParamedicLimit,
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
    case "program-installed":
      return t("paramedic.finding.programInstalled.what");
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
    case "cross-game":
      // "Never before it" only when every earlier session of that game ran normally.
      return a.neverBefore === "true"
        ? t("paramedic.evidence.crossGame", { games: a.games })
        : t("paramedic.evidence.crossGameAfter", { games: a.games });
    case "install-recorded":
      return t("paramedic.evidence.installRecorded", { when: dates.dayTime(a.when) });
    case "install-not-recorded":
      return t("paramedic.evidence.installNotRecorded", { when: dates.dayTime(a.seenAt) });
    case "install-after-rough":
      return t("paramedic.evidence.installAfterRough", { when: dates.dayTime(a.when) });
    case "update-installed":
      return t("paramedic.evidence.updateInstalled", { kb: a.kb, when: dates.dayTime(a.when) });
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
    case "starts-seen":
      return a.names
        ? t("paramedic.evidence.startsSeen", { names: a.names, count: Number(a.count) })
        : t("paramedic.evidence.startsSeenNoNames", { count: Number(a.count) });
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
    default:
      return null;
  }
}

function badge(e: ParamedicEvidence, t: T): string {
  if (e.against) return t("paramedic.badge.against");
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
    default:
      return null;
  }
}

function unknownLine(code: string, { t }: Ctx): string | null {
  switch (code) {
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
function seenLine(s: ParamedicRuledOut, { t, dates }: Ctx): string | null {
  const a = s.args;
  switch (s.id) {
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

function Evidence({ list, ctx }: { list: ParamedicEvidence[]; ctx: Ctx }) {
  const rows = list.map((e) => ({ e, text: evidenceLine(e, ctx) })).filter((r) => r.text);
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

function Problem({ d, ctx }: { d: ParamedicDiagnosis; ctx: Ctx }) {
  const { t, dates, game } = ctx;
  const p = d.problem;
  if (!p) return null;
  const spikes = p.spikes && p.now.p99_ms != null && p.before.p99_ms != null;
  return (
    <>
      <div className="gl-card-top">
        <h2 className="gl-card-title">{t("paramedic.problem.title", { game })}</h2>
        <span className="gl-chip" data-tone="accent">
          {t("paramedic.problem.badge")}
        </span>
      </div>
      <p>
        {t("paramedic.problem.body", {
          game,
          count: p.sessions_affected.length,
          beforePct: pct(p.before.ratio),
          nowPct: pct(p.now.ratio),
        })}
      </p>
      {spikes && (
        <p>{t("paramedic.problem.spikes", { nowMs: tenth(p.now.p99_ms as number), beforeMs: tenth(p.before.p99_ms as number) })}</p>
      )}
      {p.avg_lower && (
        <p>{t("paramedic.problem.average", { nowFps: Math.round(p.now.avg_fps), beforeFps: Math.round(p.before.avg_fps) })}</p>
      )}
      {p.other_games_affected.length > 0 && (
        <p>{t("paramedic.problem.otherGames", { games: p.other_games_affected.join(", ") })}</p>
      )}
      <p>{t("paramedic.problem.since", { date: dates.day(p.last_normal_at) })}</p>
      {p.partial_sessions.length > 0 && (
        <p className="gl-para-note">{t("paramedic.problem.partial", { count: p.partial_sessions.length })}</p>
      )}
    </>
  );
}

/** `plain`: one of several changes Compy cannot yet tell apart, so no ranking chip, no "why first". */
function Leading({ f, d, ctx, plain }: { f: ParamedicFinding; d: ParamedicDiagnosis; ctx: Ctx; plain?: boolean }) {
  const { t } = ctx;
  const eyebrow =
    f.confidence === "likely"
      ? t("paramedic.answer.likely")
      : f.confidence === "measured"
        ? t("paramedic.answer.measured")
        : f.confidence === "mechanism"
          ? t("paramedic.answer.mechanism")
          : t("paramedic.answer.possible");
  const since = sinceText(f.since_when, ctx);
  const why = plain ? null : whyFirst(d, ctx);
  return (
    <div className="gl-para-lead" data-testid={plain ? "paramedic-candidate" : "paramedic-leading"}>
      {!plain && (
        <span className="gl-chip" data-tone="accent">
          {eyebrow}
        </span>
      )}
      <span className="gl-row-title">{findingTitle(f, ctx)}</span>
      {since && <span className="gl-row-sub">{since}</span>}
      <Evidence list={f.evidence} ctx={ctx} />
      {why && <span className="gl-row-sub">{t("paramedic.card.why", { reason: why })}</span>}
      <FixBlock fix={f.fix} ctx={ctx} />
      {!plain && <span className="gl-row-sub">{t("paramedic.card.notProven")}</span>}
    </div>
  );
}

function AlsoPossible({ list, ctx }: { list: ParamedicFinding[]; ctx: Ctx }) {
  if (list.length === 0) return null;
  return (
    <details className="gl-para-fold" data-testid="paramedic-also">
      <summary>{ctx.t("paramedic.alsoPossible.title")}</summary>
      <div className="gl-para-body">
        {list.map((f) => (
          <div className="gl-para-lead" key={f.id}>
            <span className="gl-row-title">{findingTitle(f, ctx)}</span>
            {sinceText(f.since_when, ctx) && <span className="gl-row-sub">{sinceText(f.since_when, ctx)}</span>}
            <Evidence list={f.evidence} ctx={ctx} />
          </div>
        ))}
      </div>
    </details>
  );
}

function Checked({ d, ctx }: { d: ParamedicDiagnosis; ctx: Ctx }) {
  const { t } = ctx;
  const ruled = present(d.not_it.map((n) => ruledOutLine(n, ctx)));
  const seen = present(d.seen.map((s) => seenLine(s, ctx)));
  const unknown = present([...d.unknowns.map((u) => unknownLine(u, ctx)), ...d.limits.map((l) => limitLine(l, ctx))]);
  if (ruled.length === 0 && seen.length === 0 && unknown.length === 0) return null;
  return (
    <details className="gl-para-fold" data-testid="paramedic-checked">
      <summary>{t("paramedic.checked.title")}</summary>
      <div className="gl-para-body">
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
      </div>
    </details>
  );
}

/** One of the four answers the engine can give, in the owner's words. */
function Answer({ d, ctx }: { d: ParamedicDiagnosis; ctx: Ctx }) {
  const { t } = ctx;
  const s = d.state;
  const game = ctx.game;
  if (s.kind === "found" && d.findings.length > 0 && d.why_first === "not-separable") {
    // No change reaches two independent supports: list the ones that line up, rank no winner.
    return (
      <>
        <Problem d={d} ctx={ctx} />
        <h2 className="gl-card-title">{t("paramedic.notSeparable.title")}</h2>
        {d.findings
          .filter((f) => f.in_play)
          .map((f) => (
            <Leading key={f.id} f={f} d={d} ctx={ctx} plain />
          ))}
        {d.findings.some((f) => f.in_play && f.id === "background-load") ? (
          <p className="gl-para-note">{t("paramedic.notSeparable.next", { game })}</p>
        ) : (
          <p className="gl-para-note">{t("paramedic.notSeparable.nextOther", { game })}</p>
        )}
        <AlsoPossible list={d.findings.filter((f) => !f.in_play)} ctx={ctx} />
        <Checked d={d} ctx={ctx} />
      </>
    );
  }
  if (s.kind === "found" && d.findings.length > 0) {
    return (
      <>
        <Problem d={d} ctx={ctx} />
        <Leading f={d.findings[0]} d={d} ctx={ctx} />
        <AlsoPossible list={d.findings.slice(1)} ctx={ctx} />
        <Checked d={d} ctx={ctx} />
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
      {s.kind === "cant-tell" && s.why.kind === "frame-cap-changed" && d.findings[0] && <Leading f={d.findings[0]} d={d} ctx={ctx} />}
    </>
  );
}

type View = { kind: "idle" } | { kind: "busy" } | { kind: "failed" } | { kind: "done"; d: ParamedicDiagnosis };

export function ParamedicCard() {
  const { t } = useTranslation();
  const dates = useDates();
  const [view, setView] = useState<View>({ kind: "idle" });

  const ask = () => {
    setView({ kind: "busy" });
    invoke<ParamedicDiagnosis | null>("paramedic_diagnose", { complaint: "unknown", game: null })
      .then((d) => setView(d ? { kind: "done", d } : { kind: "failed" }))
      .catch(() => setView({ kind: "failed" }));
  };

  const ctx: Ctx | null =
    view.kind === "done" ? { t, dates, game: view.d.game_name ?? view.d.game ?? "" } : null;

  return (
    <section className="gl-card" aria-label={t("paramedic.label")} data-testid="paramedic">
      <div className="gl-card-top">
        <p className="gl-card-sub">{t("paramedic.door.sub")}</p>
        <button type="button" className="gl-cta" onClick={ask} disabled={view.kind === "busy"}>
          {view.kind === "done" || view.kind === "failed" ? t("paramedic.door.again") : t("paramedic.door.button")}
        </button>
      </div>
      {view.kind === "busy" && (
        <p className="gl-card-sub" role="status">
          {t("paramedic.door.looking")}
        </p>
      )}
      {view.kind === "failed" && (
        <p className="gl-card-sub" role="alert">
          {t("paramedic.door.failed")}
        </p>
      )}
      <div className="gl-para-body" aria-live="polite">
        {view.kind === "done" && ctx && (
          <>
            <Answer d={view.d} ctx={ctx} />
            <p className="gl-para-note">{t("paramedic.footer")}</p>
          </>
        )}
      </div>
    </section>
  );
}
