// P5-realplay (ROADMAP Phase 5 "Real-play mode"; Constitution §36): the words for a Trial that leaves
// its ONE change on while the owner plays however he plays, judged on several whole sessions with it
// against several without it, instead of one session against one. Pure: every line is read from the
// backend's own record (experiment.rs `ExperimentRecord::real_play`) or its progress read
// (`get_realplay_progress`, realplay.rs `RealPlayProgress`). Nothing here counts a session, judges
// one or estimates a number; a value the backend didn't send is left out, never filled in.
//
// The verdicts are the Trial's existing ones, said the real-play way: improved = Likely better,
// regressed = Likely worse, no-change = No clear difference, anything that judged nothing = Unknown.
// Real play never records High confidence (experiment.rs `conclude_realplay`), and nothing here shows
// it either (`realPlayConfidence`).

/** realplay.rs `RealPlayPhase`, serde names. */
export type RealPlayPhase = "collecting-before" | "ready-to-start" | "collecting" | "ready" | "stopped";
/** realplay.rs `RealPlayStop`: why a running real-play Trial can't go on as it is. `change-off` and
 *  `unreadable` describe the setting right now and clear on their own when it reads on again. */
export type RealPlayStop =
  | "change-off"
  | "put-back-in-history"
  | "unreadable"
  | "other-change"
  | "conditions"
  | "window-over"
  | "before-missing";
/** realplay.rs `NotCountedReason`. A reason a newer Compy writes arrives as a string this build
 *  doesn't know and is said as "a reason this version doesn't know", never dropped. */
export type NotCounted = { session_id: string; reason: string };

/** realplay.rs `RealPlayProgress`: where a game's real play stands. Every count is a count of real
 *  records. */
export type RealPlayProgress = {
  phase: RealPlayPhase;
  game: string;
  /** The running real-play Trial, in the running phases. */
  experiment_id: string | null;
  /** Before a start: the as-is session a start would pin as its newest. */
  anchor_session_id: string | null;
  /** As-is sessions counted: pinned ones while running, available ones before a start. */
  before: number;
  /** With-change sessions counted so far. */
  with: number;
  /** What the next step needs (before a start: as-is sessions; running: the next look's count). */
  need: number;
  min_sessions: number;
  max_sessions: number;
  /** Readings (about one a second) a session needs to count. */
  min_readings: number;
  window_days: number;
  /** The band at the newest look, in %, once a look was made. */
  band_pct: number | null;
  applied_at: string | null;
  until: string | null;
  /** A `RealPlayStop`, or one a newer Compy wrote (said as "can't go on as it is"). */
  stop: string | null;
  not_counted: NotCounted[];
};

/** realplay.rs `RealPlaySession`: one session's numbers, copied onto the record. */
export type RealPlaySessionNumbers = { session_id: string; low1_fps: number; avg_fps: number; samples: number };

/** realplay.rs `RealPlayEvidence` (experiment.rs `ExperimentRecord::real_play`). `before` is pinned at
 *  start; the rest is written at conclude, and only what was measured is written. */
export type RealPlayEvidence = {
  before?: RealPlaySessionNumbers[];
  with?: RealPlaySessionNumbers[];
  low1_spread_pct?: number | null;
  avg_spread_pct?: number | null;
  band_pct?: number | null;
  delta_low1_pct?: number | null;
  delta_avg_pct?: number | null;
  look?: number | null;
  not_counted?: NotCounted[];
  stop?: string | null;
};

/** The record fields these lines read (experiment.rs `ExperimentRecord`). */
export type RealPlayRecord = {
  id: string;
  rec_title: string;
  game: string;
  status: string;
  verdict: string | null;
  kept?: boolean;
  outcome?: string | null;
  applied_at?: string | null;
  stop_reason?: string | null;
  mode?: string | null;
  real_play?: RealPlayEvidence | null;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A record of a real-play Trial (experiment.rs `TrialMode::RealPlay`; a pair record has no mode). */
export const isRealPlay = (x: { mode?: string | null } | null | undefined): boolean => x?.mode === "real-play";

const PHASES: ReadonlySet<string> = new Set(["collecting-before", "ready-to-start", "collecting", "ready", "stopped"]);
const STOPS: ReadonlySet<string> = new Set([
  "change-off",
  "put-back-in-history",
  "unreadable",
  "other-change",
  "conditions",
  "window-over",
  "before-missing",
]);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A progress answer this build can read, or null: nothing answered, an older build, or a phase this
 *  build doesn't know. Never a guessed phase. A stop this build doesn't know stays stopped. */
export function asRealPlayProgress(x: unknown): RealPlayProgress | null {
  const p = x as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object" || typeof p.phase !== "string" || !PHASES.has(p.phase)) return null;
  const counts = ["before", "with", "need", "min_sessions", "max_sessions", "min_readings", "window_days"] as const;
  if (!counts.every((k) => finite(p[k]))) return null;
  const notCounted = Array.isArray(p.not_counted)
    ? (p.not_counted as unknown[]).filter(
        (n): n is NotCounted => !!n && typeof n === "object" && typeof (n as NotCounted).session_id === "string",
      )
    : [];
  return {
    phase: p.phase as RealPlayPhase,
    game: text(p.game) ?? "",
    experiment_id: text(p.experiment_id),
    anchor_session_id: text(p.anchor_session_id),
    before: p.before as number,
    with: p.with as number,
    need: p.need as number,
    min_sessions: p.min_sessions as number,
    max_sessions: p.max_sessions as number,
    min_readings: p.min_readings as number,
    window_days: p.window_days as number,
    band_pct: finite(p.band_pct) ? p.band_pct : null,
    applied_at: text(p.applied_at),
    until: text(p.until),
    stop: text(p.stop),
    not_counted: notCounted.map((n) => ({ session_id: n.session_id, reason: String(n.reason ?? "other") })),
  };
}

/** A moment as the panel says it: day and time in the reader's language and time zone. "" when the
 *  record holds no readable time (then the line has nothing to name, and says nothing made up). */
export function whenText(iso: string | null | undefined, lang: string): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  }
}

/** One decimal, as the record rounds its percentages (realplay.rs `round1`). */
const one = (v: number) => String(Math.round(v * 10) / 10);

const STOP_KEY: Record<RealPlayStop, string> = {
  "change-off": "changeOff",
  "put-back-in-history": "putBackInHistory",
  unreadable: "unreadable",
  "other-change": "otherChange",
  conditions: "conditions",
  "window-over": "windowOver",
  "before-missing": "beforeMissing",
};
const REASON_KEY: Record<string, string> = {
  "too-short": "tooShort",
  behind: "behind",
  "before-change": "beforeChange",
  "conditions-changed": "conditionsChanged",
  "change-not-on": "changeNotOn",
  "other-compy-change": "otherCompyChange",
  "gaming-mode-differs": "gamingModeDiffers",
  "after-window": "afterWindow",
  "no-reading": "noReading",
  other: "other",
};

/** Why one session wasn't counted, in a few words. `minReadings` names how much play counts (about
 *  one reading a second). */
export function notCountedWhy(reason: string, minReadings: number, t: Translate): string {
  return t(`lab.experimentBench.journey.realPlay.reason.${REASON_KEY[reason] ?? "other"}`, {
    minutes: Math.max(1, Math.round(minReadings / 60)),
  });
}

/** What a running real-play Trial's panel says, from its record and its progress read now. */
export type RealPlayView = {
  /** That the change is on, since when, and how long it may stay on (max sessions, until when). */
  changeOn: string;
  /** Where it stands: still collecting N of M, a result is ready, why it stopped, or that its
   *  progress can't be read right now. null while the first read hasn't answered. */
  status: string | null;
  /** While still collecting after a look: how much the sessions vary, so a few more are needed. */
  notYet: string | null;
  /** How to put it back (always said). */
  putBackHow: string;
  /** When stopped: what closing the test does. */
  closeHow: string | null;
  /** Each session not counted, with when and why. */
  notCounted: string[];
  /** The panel's one main action: measure the next session, see the result, or close the test. */
  action: "measure" | "see-result" | "close" | null;
};

/** The panel of a running real-play Trial. `progress` must be this Trial's own (a progress read of
 *  another Trial, or of the game before a start, is no progress of this one). `unread`: the read
 *  failed, with the backend's reason. */
export function realPlayView(
  exp: RealPlayRecord,
  progress: RealPlayProgress | null,
  t: Translate,
  lang: string,
  unread: string | null = null,
): RealPlayView {
  const change = exp.rec_title;
  const own = progress && progress.experiment_id === exp.id && !["collecting-before", "ready-to-start"].includes(progress.phase) ? progress : null;
  const since = whenText(own?.applied_at ?? exp.applied_at, lang);
  const until = whenText(own?.until, lang);
  const changeOn =
    own && until
      ? t("lab.experimentBench.journey.realPlay.changeOn", { change, since, max: own.max_sessions, until })
      : t("lab.experimentBench.journey.realPlay.changeOnShort", { change, since });
  const putBackHow = t("lab.experimentBench.journey.realPlay.putBackHow");
  if (!own) {
    const answered = unread != null || progress != null;
    return {
      changeOn,
      status: answered ? t("lab.experimentBench.journey.realPlay.progressUnread", { change }) : null,
      notYet: null,
      putBackHow,
      closeHow: null,
      notCounted: [],
      action: null,
    };
  }
  const notCounted = own.not_counted.map((n) =>
    t("lab.experimentBench.journey.realPlay.notCountedItem", {
      when: whenText(n.session_id, lang) || n.session_id,
      why: notCountedWhy(n.reason, own.min_readings, t),
    }),
  );
  if (own.phase === "stopped") {
    const stop = own.stop && STOPS.has(own.stop) ? STOP_KEY[own.stop as RealPlayStop] : "other";
    return {
      changeOn,
      status: t(`lab.experimentBench.journey.realPlay.stop.${stop}`, { change, days: own.window_days }),
      notYet: null,
      putBackHow,
      closeHow: t("lab.experimentBench.journey.realPlay.closeHow", { change }),
      notCounted,
      action: "close",
    };
  }
  if (own.phase === "ready") {
    return { changeOn, status: t("lab.experimentBench.journey.realPlay.ready"), notYet: null, putBackHow, closeHow: null, notCounted, action: "see-result" };
  }
  return {
    changeOn,
    status: t("lab.experimentBench.journey.realPlay.collecting", { have: own.with, need: own.need }),
    notYet: own.band_pct != null ? t("lab.experimentBench.journey.realPlay.notYet", { band: one(own.band_pct) }) : null,
    putBackHow,
    closeHow: null,
    notCounted,
    action: "measure",
  };
}

/** The real-play choice the idle journey offers beside its two-session plan: when enough as-is sessions
 *  already count (the change goes on at once), or while Compy is still collecting them. null in any
 *  other phase, and with no progress read (then the choice isn't offered: Compy can't count). */
export function realPlayOffer(progress: RealPlayProgress | null, change: string, game: string, t: Translate): string | null {
  if (progress?.phase === "ready-to-start")
    return t("lab.experimentBench.journey.realPlay.planReady", {
      change,
      game,
      max: progress.max_sessions,
      days: progress.window_days,
      before: progress.before,
    });
  if (progress?.phase === "collecting-before")
    return t("lab.experimentBench.journey.realPlay.planCollecting", { change, game, need: progress.need, have: progress.before });
  return null;
}

/** After an as-is session, while fewer than the sessions real play needs count: nothing is on yet. */
export function collectingBeforeLine(progress: RealPlayProgress, game: string, t: Translate): string {
  return t("lab.experimentBench.journey.realPlay.collectingBefore", { have: progress.before, need: progress.need, game });
}

const MEASURED = new Set(["improved", "no-change", "regressed"]);
/** The pair journey's own words for a verdict that judged nothing (journey.putBackWhy.*). */
const PUT_BACK_WHY: Record<string, string> = {
  "no-change": "noChange",
  regressed: "regressed",
  confounded: "confounded",
  expired: "expired",
  "insufficient-evidence": "insufficientEvidence",
  "not-comparable": "notComparable",
  "too-noisy": "tooNoisy",
};
/** The stop reasons a conclude records (experiment.rs), each to its few words. Checked in order. */
const BECAUSE_TAG: [string, string][] = [
  ["crash-during-treatment", "crashed"],
  ["target-reverted-during-treatment", "reverted"],
  ["target-unreadable-at-conclude", "unreadable"],
  ["other-change-unverified-at-conclude", "unverified"],
  ["other-compy-change-during-trial", "otherChange"],
  ["conditions-changed-between-sessions", "conditions"],
  ["real-play-window-over", "windowOver"],
  ["real-play-before-missing", "beforeMissing"],
  ["real-play-change-off", "changeOff"],
  ["real-play-put-back-in-history", "putBackInHistory"],
  ["real-play-smoothest-unsupported", "smoothest"],
];

/** Why a real-play Trial judged nothing, in a few words: its recorded stop, else its stop reason,
 *  else the pair journey's words for its verdict. */
function because(exp: RealPlayRecord, t: Translate): string {
  const stop = exp.real_play?.stop;
  if (stop && STOPS.has(stop)) return t(`lab.experimentBench.journey.realPlay.because.${STOP_KEY[stop as RealPlayStop]}`);
  const reason = exp.stop_reason ?? "";
  const tag = BECAUSE_TAG.find(([s]) => reason.includes(s));
  if (tag) return t(`lab.experimentBench.journey.realPlay.because.${tag[1]}`);
  return t(`lab.experimentBench.journey.putBackWhy.${PUT_BACK_WHY[exp.verdict ?? ""] ?? "other"}`);
}

/** Its own change was put back in Test → Applied & history: the record keeps its measured verdict,
 *  never keeps the change, and says who put it back. */
const putBackInHistory = (exp: { stop_reason?: string | null; real_play?: RealPlayEvidence | null }): boolean =>
  exp.real_play?.stop === "put-back-in-history" || (exp.stop_reason ?? "").includes("real-play-put-back-in-history");

/** The one line a concluded real-play Trial says: Likely better, Likely worse, No clear difference or
 *  Unknown, then what became of the change (Compy kept it, Compy put it back, or it was put back in
 *  Test → Applied & history; only a Likely better Compy kept is ever "kept"), then the evidence.
 *  Every number is the record's own; a measured verdict whose numbers the record doesn't hold says
 *  Unknown and that the record doesn't hold them, never a number filled in. */
export function realPlayResult(exp: RealPlayRecord, game: string, t: Translate): string {
  const rp = exp.real_play ?? {};
  const change = exp.rec_title;
  const before = rp.before?.length ?? 0;
  const counted = rp.with?.length ?? 0;
  const band = rp.band_pct;
  const low = rp.delta_low1_pct;
  const avg = rp.delta_avg_pct;
  const maxFps = exp.outcome === "max-fps";
  const metric = (avgSide: boolean) =>
    t(avgSide ? "lab.experimentBench.journey.realPlay.metric.avg" : "lab.experimentBench.journey.realPlay.metric.low");
  const inHistory = putBackInHistory(exp);
  const kept = !inHistory && exp.status === "kept" && exp.verdict === "improved";
  const action = t(
    inHistory
      ? "lab.experimentBench.journey.realPlay.actionPutBackInHistory"
      : kept
        ? "lab.experimentBench.journey.realPlay.actionKept"
        : "lab.experimentBench.journey.realPlay.actionPutBack",
    { change },
  );
  if (finite(band) && finite(low) && finite(avg)) {
    if (exp.verdict === "improved") {
      // Maximum FPS is judged on the average, Recommended on the 1% low: the line names the one it won on.
      const d = maxFps ? avg : low;
      return t("lab.experimentBench.journey.realPlay.likelyBetter", { action, metric: metric(maxFps), pct: one(d), with: counted, before, band: one(band) });
    }
    if (exp.verdict === "regressed") {
      // Maximum FPS is put back when the average OR the 1% low fell beyond the band: name the one that did.
      const avgSide = maxFps && avg < -band;
      return t("lab.experimentBench.journey.realPlay.likelyWorse", {
        action,
        metric: metric(avgSide),
        pct: one(Math.abs(avgSide ? avg : low)),
        with: counted,
        before,
        band: one(band),
      });
    }
    if (exp.verdict === "no-change") {
      // Recommended's "no clear win": the 1% low rose beyond the band but the average fell beyond it.
      if (!maxFps && low > band && avg < -band)
        return t("lab.experimentBench.journey.realPlay.noClearWin", { action, low: one(low), avg: one(Math.abs(avg)) });
      return t("lab.experimentBench.journey.realPlay.noClearDifference", { action, metric: metric(maxFps), with: counted, before, band: one(band) });
    }
  }
  if (exp.verdict === "too-noisy" && finite(band))
    return t("lab.experimentBench.journey.realPlay.unknown", { action, game, band: one(band), with: counted });
  // A measured verdict whose numbers the record doesn't hold: never filled in, and never "not judged".
  if (MEASURED.has(exp.verdict ?? "")) return t("lab.experimentBench.journey.realPlay.unknownNoNumbers", { action });
  // No look decided (the test stopped before enough sessions counted): say how few counted.
  if (rp.look == null) {
    if (inHistory) return t("lab.experimentBench.journey.realPlay.unknownShortHistory", { change, count: counted });
    return t("lab.experimentBench.journey.realPlay.unknownShort", { action, count: counted, why: because(exp, t) });
  }
  return t("lab.experimentBench.journey.realPlay.unknownStopped", { action, why: because(exp, t) });
}

/** The explanation under the line: the rule the verdict was judged by, or that nothing was judged. */
export function realPlayWhy(exp: RealPlayRecord, t: Translate): string {
  if (!MEASURED.has(exp.verdict ?? "")) return t("lab.experimentBench.journey.realPlay.rule.noResult");
  return t(exp.outcome === "max-fps" ? "lab.experimentBench.journey.realPlay.rule.maxFps" : "lab.experimentBench.journey.realPlay.rule.recommended");
}

/** A real-play row's face in a history list: Likely better / Likely worse / No clear difference /
 *  Unknown, and whether the change was kept. null before any verdict (a Trial put back early). A
 *  change put back in Test → Applied & history is never "kept". */
export function realPlayFace(
  exp: { verdict: string | null; status?: string; kept?: boolean; stop_reason?: string | null; real_play?: RealPlayEvidence | null },
  t: Translate,
): string | null {
  switch (exp.verdict) {
    case null:
    case undefined:
      return null;
    case "improved":
      return t(
        (exp.status === "kept" || exp.kept === true) && !putBackInHistory(exp)
          ? "lab.experimentBench.journey.realPlay.face.likelyBetterKept"
          : "lab.experimentBench.journey.realPlay.face.likelyBetter",
      );
    case "regressed":
      return t("lab.experimentBench.journey.realPlay.face.likelyWorse");
    case "no-change":
      return t("lab.experimentBench.journey.realPlay.face.noClearDifference");
    default:
      return t("lab.experimentBench.journey.realPlay.face.unknown");
  }
}

/** The band line of a real-play result: the band came from this Trial's own sessions, never from
 *  older history. null when the record holds no band (the verdict never reached one). */
export function realPlayNoiseLine(band: number | null | undefined, counts: { before: number; with: number }, game: string, t: Translate): string | null {
  if (!finite(band)) return null;
  return t("lab.experimentBench.journey.realPlay.noise", { band: one(band), game, before: counts.before, with: counts.with });
}

/** The session counts a real-play record judged on. */
export const realPlayCounts = (exp: { real_play?: RealPlayEvidence | null }): { before: number; with: number } => ({
  before: exp.real_play?.before?.length ?? 0,
  with: exp.real_play?.with?.length ?? 0,
});

/** Real play never claims High confidence: a stored "high" (none is written) reads as medium. */
export function realPlayConfidence(c: string | null | undefined): string | null {
  return c === "high" ? "medium" : (c ?? null);
}
