import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
// Side-effect import, as in BlackBox.tsx: the i18next singleton is ready even when this is the first
// thing a test loads.
import "../i18n";
import type { SessionSummary, WhatChangedOutcome, WhatChangedReport } from "../types";
import type { StutterResult } from "./care-next-step";
import { LESSON_KEY, lessonRuleForVerdict, type LessonRule } from "./test-summary";
import { LessonLine } from "../design/LessonLine";
import { gradeBaseline } from "./baseline-grade";
import { WhatChangedReportView } from "./WhatChangedPanel";
import { prettyGameName } from "./game-name";
import { useIntelligenceFlag } from "../design/use-hud";
import { useExpertView } from "../design/use-expert-view";
import { takeStutterArrival } from "./care-arrival";
import "./StutterCompare.css";

// P6-stutter (ROADMAP Phase 6, Constitution §16/§17): "it stutters / runs slow" on the Care view
// compares the game's LATEST session with its LAST GOOD one, through the existing engine
// (`what_changed_between`) and its existing report view. No hand-off to Monitor or the benchmark.
//
// "Good" is graded only by rules Compy already has, never by a new threshold:
//   * measured   - it has readings (`samples > 0`); a session behind another window the whole time
//                  (P4-show-f1) is skipped here as everywhere else, for "latest" too;
//   * steady     - the Trial's baseline grade says steady (baseline-grade.ts, pinned to
//                  experiment.rs `grade_baseline`);
//   * comparable - the engine's own comparability gate (comparability.rs `derive`) reads the pair as
//                  comparable or partially comparable. A not-comparable or unjudgeable pair is not a
//                  good baseline, and the next steady candidate is tried.
// Whatever the report lists changed between the two; none of it is a proven cause, and the
// section says so.

/** Steady earlier sessions tried, newest first, before Compy says it has no good one. Each try is
 *  one read-only engine call; the cap keeps a long run of steady sessions the engine can't compare
 *  from turning one tap into dozens of reads. */
export const MAX_GOOD_CANDIDATES = 5;

export type StutterPick =
  | { kind: "no-session" }
  | { kind: "pick"; latest: SessionSummary; candidates: SessionSummary[] };

const when = (s: SessionSummary) => Date.parse(s.started_at);
const measured = (s: SessionSummary) =>
  s.samples > 0 && !!s.process_name && Number.isFinite(when(s));

/** Pure: the latest measured session, and the steady, measured, earlier sessions of the same game
 *  that could be its last good one (newest first, capped). Comparability is the engine's to say. */
export function pickStutterPair(sessions: SessionSummary[]): StutterPick {
  const usable = sessions.filter(measured);
  if (usable.length === 0) return { kind: "no-session" };
  const latest = usable.reduce((a, b) => (when(b) > when(a) ? b : a));
  const game = latest.process_name.toLowerCase();
  const candidates = usable
    .filter(
      (s) =>
        s.process_name.toLowerCase() === game &&
        when(s) < when(latest) &&
        gradeBaseline(s).kind === "steady",
    )
    .sort((a, b) => when(b) - when(a))
    .slice(0, MAX_GOOD_CANDIDATES);
  return { kind: "pick", latest, candidates };
}

/** P7-teach: the one lesson this pair of sessions can teach, by the P5-learned rule table over the
 *  engine's stored verdict and the two sessions' stored readings (test-summary.ts). The deltas are
 *  arithmetic over the report's own `baseline` / `current` refs against its `noise_floor_pct`; no new
 *  data. The engine judged the verdict on the 1% low against that floor, so a rule whose 1% low
 *  direction disagrees with the verdict is dropped: the stored verdict wins over a re-derived number,
 *  never the other way (honest measurement). null = no rule, no lesson: inconclusive, confounded
 *  (two or more change families moved, so no single reading is a lesson), a zero or missing baseline
 *  reading, a zero floor, or both deltas inside the floor. A partly comparable pair still teaches:
 *  the report's own comparability banner says how far the pair may be compared. The average is
 *  always compared here, so the "average wasn't compared" rules (steadier / less-steady) and
 *  too-noisy can't fire from this surface. */
export function stutterLessonRule(r: WhatChangedReport): LessonRule | null {
  const b = r.baseline;
  const c = r.current;
  if (r.confounded || !(r.noise_floor_pct > 0)) return null;
  if (!(b.low1_fps > 0) || !(b.avg_fps > 0) || !Number.isFinite(c.low1_fps) || !Number.isFinite(c.avg_fps)) return null;
  const low1Pct = ((c.low1_fps - b.low1_fps) / b.low1_fps) * 100;
  const avgPct = ((c.avg_fps - b.avg_fps) / b.avg_fps) * 100;
  return lessonRuleForVerdict(r.verdict, low1Pct, avgPct, r.noise_floor_pct);
}

/** The engine's comparability verdicts that make an earlier steady session a good baseline. */
const goodPair = (o: WhatChangedOutcome) =>
  o.kind === "report" &&
  (o.comparability.verdict === "comparable" || o.comparability.verdict === "partial");

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error" }
  | { kind: "no-session" }
  | { kind: "no-good"; game: string }
  | {
      kind: "report";
      outcome: WhatChangedOutcome;
      game: string;
      latestAt: string;
      goodAt: string;
      /** P6-next: what the Care view's next-step payoff counts against. */
      processName: string;
      sessions: SessionSummary[];
    };

async function compare(): Promise<State> {
  const sessions = await invoke<SessionSummary[]>("get_session_summaries");
  const all = Array.isArray(sessions) ? sessions : [];
  const pick = pickStutterPair(all);
  if (pick.kind === "no-session") return { kind: "no-session" };
  const game = prettyGameName(pick.latest.process_name);
  for (const good of pick.candidates) {
    const outcome = await invoke<WhatChangedOutcome>("what_changed_between", {
      baselineStartedAt: good.started_at,
      currentStartedAt: pick.latest.started_at,
    });
    if (outcome && goodPair(outcome)) {
      return {
        kind: "report",
        outcome,
        game,
        latestAt: pick.latest.started_at,
        goodAt: good.started_at,
        processName: pick.latest.process_name,
        sessions: all,
      };
    }
  }
  return { kind: "no-good", game };
}

function fmtWhen(iso: string, lang: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function StutterCompare({
  onResult,
  hideNextAction = false,
}: {
  /** P6-next: hands the report up so the Care view can pick its one next step. null = no report. */
  onResult?: (r: StutterResult | null) => void;
  /** P6-next: the report's next test is the step shown at the top of the view; don't repeat it. */
  hideNextAction?: boolean;
} = {}) {
  const { t, i18n } = useTranslation();
  const on = useIntelligenceFlag();
  const expert = useExpertView();
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (!onResult) return;
    onResult(
      on && state.kind === "report" && state.outcome.kind === "report"
        ? { report: state.outcome, game: state.game, processName: state.processName, sessions: state.sessions }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report changes only
  }, [state, on]);

  const run = () => {
    setState({ kind: "busy" });
    compare()
      .then(setState)
      .catch(() => setState({ kind: "error" })); // never a fabricated comparison
  };

  // Arrived from the interview's stutter answer: the user already asked, so run it once on mount.
  // The flag is spent on every mount, even when the comparison is switched off, so it can never
  // fire on some later visit.
  useEffect(() => {
    const arrived = takeStutterArrival();
    if (arrived && on) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount by design
  }, []);

  // compy_intelligence "0" (the devtools failsafe) switches the engine's surfaces off. Say so in one
  // line rather than leave a stutter arrival with nothing.
  if (!on) {
    return (
      <section className="bb-stutter" aria-label={t("gaming.blackBox.stutter.title")}>
        <p className="bb-stutter-line">{t("gaming.blackBox.stutter.off")}</p>
      </section>
    );
  }

  const lessonRule =
    state.kind === "report" && state.outcome.kind === "report" ? stutterLessonRule(state.outcome) : null;

  return (
    <section className="bb-stutter" aria-label={t("gaming.blackBox.stutter.title")}>
      <div className="bb-stutter-head">
        <span className="bb-stutter-title">{t("gaming.blackBox.stutter.title")}</span>
        <span className="bb-stutter-tag">{t("gaming.blackBox.changedBefore.notProven")}</span>
      </div>

      {(state.kind === "idle" || state.kind === "error") && (
        <button type="button" className="bb-stutter-run" onClick={run}>
          {t("gaming.blackBox.stutter.runButton")}
        </button>
      )}
      {state.kind === "busy" && <p className="bb-stutter-line">{t("gaming.blackBox.stutter.comparing")}</p>}
      {state.kind === "error" && <p className="bb-stutter-line">{t("gaming.blackBox.stutter.readError")}</p>}
      {state.kind === "no-session" && (
        <p className="bb-stutter-line">{t("gaming.blackBox.stutter.noSession")}</p>
      )}
      {state.kind === "no-good" && (
        <p className="bb-stutter-line">{t("gaming.blackBox.stutter.noGood", { game: state.game })}</p>
      )}
      {state.kind === "report" && (
        <>
          <p className="bb-stutter-line">
            {/* No comparability claim here: the report's own banner says how comparable the pair is
                (comparable, or partly). */}
            {t("gaming.blackBox.stutter.compared", {
              game: state.game,
              latest: fmtWhen(state.latestAt, i18n.language),
              good: fmtWhen(state.goodAt, i18n.language),
            })}
          </p>
          <WhatChangedReportView
            outcome={state.outcome}
            expert={expert}
            headline={t("gaming.blackBox.stutter.headline", { game: state.game })}
            causeTag={t("gaming.blackBox.changedBefore.notProven")}
            hideNextAction={hideNextAction}
          />
          {/* P7-teach: one lesson from this pair's own readings, worded for two sessions of one game
              (no change was tried here). The rule table and the Library link are shared with the Trial
              summary and the Debrief. No rule = nothing. */}
          {lessonRule && (
            <LessonLine
              rule={lessonRule}
              testId="stutter-lesson"
              sentence={t(`common.lesson.sessions.${LESSON_KEY[lessonRule]}`, { game: state.game })}
            />
          )}
        </>
      )}
    </section>
  );
}
