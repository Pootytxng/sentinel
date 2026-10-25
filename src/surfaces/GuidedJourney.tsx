// P5-guided (ROADMAP Phase 5 steps 1, 2, 4; Constitution §4, §10; ENGINE §2): one "Optimize my game"
// button that runs a whole Trial for the owner. It picks the outcome (Recommended, Maximum FPS one tap
// away) and the top-ranked untested change (P4-rank), says the plan and time in one line, then:
//   1. starts measuring, and the owner plays as-is;
//   2. stops when the game's process exits (get_fps_status `game_running`) or on "Done playing";
//   3. starts the Trial with that session as the baseline — the existing audited start_experiment,
//      which applies ONE change through the mutation boundary;
//   4. measures a second session the same way;
//   5. concludes through the existing conclude_experiment, which keeps the change only when it
//      measured Better and restores it otherwise; and shows the verdict.
// Anything that fails after the change went on restores it through the existing restore_experiment
// and says so in plain words. No new mutation path, no overlay, and nothing here brings a window to
// the front. The only thing kept is the running Trial's id in this webview's localStorage, so a
// relaunch can say that Trial was interrupted (the experiment store already holds the Trial itself).
//
// P5-rebaseline (ROADMAP P5 step 3; TRIAL_PROTOCOL §2): session 1 is graded with the backend's own
// rule (baseline-grade.ts, pinned to experiment.rs `grade_baseline`). An uneven or untraced session
// doesn't go to start_experiment: the journey says why in plain words and asks for one more as-is
// session, started with one tap. After MAX_UNEVEN_SESSIONS uneven sessions it offers a choice: test
// anyway on the latest one (with the bench's own uneven warning, which the record keeps) or stop with
// nothing changed. The manual bench keeps its warn-don't-block start (owner, 2026-10-24).
//
// P5-continue (ROADMAP P5 steps 5, 7; ENGINE §4, §7): a concluded journey says what it did in one
// line ("Kept <change>: 1% low up X%" / "Put <change> back: <why>") and offers the next change
// P4-next ranks untested on that game as one tap, until nothing is left ("Nothing else here is worth
// testing on this PC", a success: stopping when nothing more is worth testing is the engine's own
// stop condition). The next journey reuses the last as-is session (after a Kept change, the session
// measured with it on, which is how the PC is now; otherwise the session before the change) when it
// is the same game and grades steady, and lets start_experiment decide whether it is still
// comparable, exactly as the bench does: the start refuses a baseline a Compy change moved after
// (`baseline_is_current`) before changing anything, and then the journey asks for a new as-is
// session. Every start, conclude and restore is the same audited call as above.
//
// Capture starts on the button, not on the game coming to the front: the FPS helper IS the thing that
// sees the game, so it has to run first. Readings taken while another window is in front are already
// left out of the session (P4-comparable).
//
// The journey lives in a module-level store, not component state, so the owner can click around
// Compy while he plays: leaving the room keeps it running, and the panel shows it again on return.
// Only the window really going away (a reload, Compy closing: `pagehide` / `beforeunload`) ends it
// early (`abortJourney`): the capture it started is stopped and nothing is judged. A change already on
// stays on, its Trial Running, until the owner concludes or restores it in Test; the bench says so
// with a banner on its next load.

import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../types";
import { writeLedger } from "../data/ledger-write";
import { prettyGameName } from "./game-name";
import { gradeBaseline, MIN_BASELINE_SAMPLES } from "./baseline-grade";

export type JourneyOutcome = "recommended" | "max-fps";

/** The fields of an experiment record the journey reads. */
type JourneyExperiment = {
  id: string;
  rec_id: string;
  rec_title: string;
  game: string;
  status: string;
  verdict: string | null;
  created_at?: string;
  concluded_at?: string | null;
  outcome?: JourneyOutcome | null;
  /** The after-session's numbers (experiment.rs `Treatment`); null while Running. */
  treatment?: { delta_low1_pct: number; delta_avg_pct?: number | null; session_id?: string | null } | null;
};

type FpsStatusLite = {
  active: boolean;
  status: string;
  sample: { process_name: string } | null;
  /** monitoring.rs `FpsStatus::game_running`. Absent on older builds = unknown. */
  game_running?: boolean | null;
};

export type JourneyPhase =
  | { kind: "idle" }
  /** `refused`: the next journey's reused as-is session was refused by the start (its reason). */
  | { kind: "as-is"; game: string | null; change: string; again?: boolean; refused?: string }
  /** Session 1 graded uneven or untraced: nothing is on yet. `final` = no more retakes, so the owner
   *  chooses between testing anyway and stopping. */
  | { kind: "uneven"; game: string; change: string; grade: UnfitGrade; final: boolean }
  | { kind: "stopped" }
  | { kind: "reading"; change: string }
  /** `reused`: the before-reading is the last journey's as-is session, so this is the only session. */
  | { kind: "with-change"; game: string; change: string; reused?: boolean }
  | { kind: "judging"; change: string }
  /** `asIs`: the newest session measured as the PC is now, which the next journey may reuse. */
  | { kind: "result"; exp: JourneyExperiment; asIs: string | null }
  | { kind: "too-short"; samples: number | null }
  | { kind: "wrong-game"; played: string; planned: string }
  | { kind: "not-started"; reason: string }
  | { kind: "restored"; change: string; why: "no-reading" | "error"; reason: string }
  | { kind: "restore-failed"; change: string; reason: string };

type UnfitGrade = { kind: "uneven"; first: number; second: number } | { kind: "untraced" };
/** How many uneven as-is sessions the journey takes before it stops asking for another and offers
 *  "test anyway" or "stop": the first asks for one more, the second offers the choice. */
export const MAX_UNEVEN_SESSIONS = 2;
// How often the journey reads capture state, and how long a stopped capture may take to save its
// session (the recorder finishes on its next 1 s tick). Tests shorten both.
let pollMs = 2000;
let saveWaitMs = 8000;

// ── The store ───────────────────────────────────────────────────────────────────────────────────
let phase: JourneyPhase = { kind: "idle" };
const listeners = new Set<() => void>();
let finishPlaying: (() => void) | null = null;
let stopPlaying: ((err: Error) => void) | null = null;
type Decision = "again" | "test" | "stop";
let decide: ((d: Decision) => void) | null = null;
/** Waits for the owner's tap on an uneven session: one more as-is session, test anyway, or stop. */
function waitForDecision(): Promise<Decision> {
  return new Promise((resolve) => {
    decide = (d) => {
      decide = null;
      resolve(d);
    };
  });
}

// The running journey Trial's id, so a relaunch can tell that Trial was interrupted. Per-webview
// convenience only: when storage is unavailable the bench simply shows its usual running panel.
const RUNNING_KEY = "compy.journey.running";
function tagRunning(id: string | null) {
  try {
    if (id) localStorage.setItem(RUNNING_KEY, id);
    else localStorage.removeItem(RUNNING_KEY);
  } catch {
    /* storage unavailable: no banner, nothing else changes */
  }
}
/** The id of the Trial a journey started and never finished, if this webview remembers one. */
export function interruptedJourneyId(): string | null {
  try {
    return localStorage.getItem(RUNNING_KEY);
  } catch {
    return null;
  }
}
const setPhase = (next: JourneyPhase) => {
  phase = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getPhase = () => phase;

/** The journey's current phase; the bench hides its own panels while it isn't idle. */
export function useJourneyPhase(): JourneyPhase {
  return useSyncExternalStore(subscribe, getPhase, getPhase);
}

/** Tests only: back to idle between cases, with short timings. */
export function resetJourneyForTests(timing: { pollMs: number; saveWaitMs: number } = { pollMs: 2000, saveWaitMs: 8000 }) {
  abortJourney();
  finishPlaying = null;
  stopPlaying = null;
  decide = null;
  current = null;
  tagRunning(null);
  pollMs = timing.pollMs;
  saveWaitMs = timing.saveWaitMs;
  setPhase({ kind: "idle" });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// The same reading test the bench applies (ExperimentBench `isUsableReading`, experiment.rs
// `has_frame_reading`).
function usable(s: SessionSummary): boolean {
  return Number.isFinite(s.avg_fps) && s.avg_fps > 0 && Number.isFinite(s.low1_fps_est) && s.low1_fps_est > 0 && s.process_name.trim() !== "";
}

/** Resolves when the measured game's process has closed, when capture ended elsewhere after the game
 *  was seen, or on "Done playing". Rejects if capture ended before any game was seen (a declined
 *  Windows prompt, a helper that didn't start). */
function waitForPlay(captureFailed: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let seen = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      finishPlaying = null;
      stopPlaying = null;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    finishPlaying = () => finish();
    stopPlaying = (err) => finish(err);
    const tick = async () => {
      if (settled) return;
      const st = await invoke<FpsStatusLite>("get_fps_status").catch(() => null);
      if (settled) return;
      if (st) {
        if (st.sample?.process_name || st.game_running === true) seen = true;
        if (seen && st.game_running === false) return finish();
        if (!st.active && st.status !== "starting") return seen ? finish() : finish(new Error(captureFailed));
      }
      timer = setTimeout(tick, pollMs);
    };
    void tick();
  });
}

/** The newest usable session (of `game`, when given) that started at or after `since`, once saved —
 *  never the session `not` names (session 2 must never read back the baseline). */
async function waitForSession(
  since: number,
  game: string | null,
  not?: string,
  gone: () => boolean = () => false,
): Promise<SessionSummary | null> {
  const tries = Math.max(1, Math.ceil(saveWaitMs / pollMs));
  for (let i = 0; i < tries && !gone(); i++) {
    const ss = await invoke<SessionSummary[]>("get_session_summaries").catch(() => []);
    const found = (ss ?? [])
      .filter(
        (s) =>
          usable(s) &&
          s.started_at !== not &&
          Date.parse(s.started_at) >= since - 1000 &&
          (game == null || s.process_name === game),
      )
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
    if (found) return found;
    await sleep(pollMs);
  }
  return null;
}

/** The session a next journey may reuse as its before-reading: still in the store, the same game,
 *  a usable reading and graded steady. Whether it is still comparable is the start's to say. */
async function reusableSession(id: string, game: string | null): Promise<SessionSummary | null> {
  const ss = await invoke<SessionSummary[]>("get_session_summaries").catch(() => []);
  const s = (ss ?? []).find((x) => x.started_at === id);
  if (!s || !usable(s) || (game != null && s.process_name !== game)) return null;
  return gradeBaseline(s).kind === "steady" ? s : null;
}

/** The start's refusal is about the before-reading (resolve_baseline / baseline_is_current /
 *  baseline_for_start all name "the baseline session"), not about the change or another Trial. */
const refusesBaseline = (reason: string) => /baseline/i.test(reason);

type RunArgs = {
  change: { id: string; title: string };
  outcome: JourneyOutcome;
  hypothesis: string;
  refresh: () => Promise<void>;
  captureFailed: string;
};

/** One run's own flags: whether the room it was started from has gone (`aborted`), and whether it
 *  holds a capture it must stop. */
type Run = { aborted: boolean; capturing: boolean };
let current: Run | null = null;

/** The window went away mid-journey (a reload, Compy closing): stop the capture this journey started
 *  and end the flow without judging anything. A change already on stays on, its Trial Running, and
 *  the bench says so on its next load (`interruptedJourneyId`); nothing is restored behind the owner's
 *  back and nothing is concluded from a session he didn't finish. */
export function abortJourney() {
  const run = current;
  if (!run || run.aborted) return;
  run.aborted = true;
  current = null;
  stopPlaying?.(new Error("journey-left"));
  decide?.("stop");
  if (run.capturing) {
    run.capturing = false;
    void invoke("stop_fps_capture").catch(() => {});
  }
  setPhase({ kind: "idle" });
}

/** After a failure: if the journey's change is still on (its Trial is still running), restore it
 *  through restore_experiment and say so; a Trial that already ended says how it ended. */
async function recover(args: RunArgs, say: (p: JourneyPhase) => void, expId: string | null, err: unknown) {
  const reason = String(err instanceof Error ? err.message : err);
  const change = args.change.title;
  if (expId == null) return say({ kind: "not-started", reason });
  const xs = await invoke<JourneyExperiment[]>("get_experiments").catch(() => null);
  const exp = xs?.find((x) => x.id === expId) ?? null;
  // Unknown (the read failed) is treated as still running: the restore refuses harmlessly if it isn't.
  if (exp == null || exp.status === "running") {
    try {
      await writeLedger("restore_experiment", { experimentId: expId }, args.refresh);
      return say({ kind: "restored", change, why: "error", reason });
    } catch (e) {
      return say({ kind: "restore-failed", change, reason: String(e) });
    }
  }
  if (exp.status === "restored") return say({ kind: "restored", change, why: "error", reason });
  if (exp.status === "kept" && exp.verdict === "improved")
    return say({ kind: "result", exp, asIs: exp.treatment?.session_id ?? null });
  return say({ kind: "restore-failed", change, reason });
}

async function runJourney(args: RunArgs, game: string | null, reuseId: string | null = null) {
  const { change } = args;
  const run: Run = { aborted: false, capturing: false };
  current = run;
  // Only a real unload ends the journey early; a room switch unmounts the panel and nothing else.
  window.addEventListener("pagehide", abortJourney);
  window.addEventListener("beforeunload", abortJourney);
  const left = () => run.aborted;
  // Every phase this run sets goes through here, so an aborted run never repaints the room.
  const say = (p: JourneyPhase) => {
    if (!run.aborted) setPhase(p);
  };
  let expId: string | null = null;
  const stopCapture = async () => {
    if (!run.capturing) return;
    run.capturing = false;
    await invoke("stop_fps_capture").catch(() => {});
  };
  try {
    // P5-continue: a next journey starts from the last as-is session when it can be reused.
    let baseline: SessionSummary | null = reuseId ? await reusableSession(reuseId, game) : null;
    let reused = baseline != null;
    let refused: string | undefined;
    let planned = game;
    let started: JourneyExperiment | null = null;
    while (!started) {
      // ── Session 1: as-is, retaken while it grades uneven (P5-rebaseline) ──
      let unevenSessions = 0;
      if (!baseline)
        for (;;) {
          say({ kind: "as-is", game: planned, change: change.title, again: unevenSessions > 0, refused });
          const t0 = Date.now();
          run.capturing = true;
          await invoke("start_fps_capture");
          await waitForPlay(args.captureFailed);
          await stopCapture();
          if (left()) return;
          say({ kind: "reading", change: change.title });
          // A retake never reads back the uneven session before it.
          const s = await waitForSession(t0, null, baseline?.started_at, left);
          if (left()) return;
          // A session of another game can't be this game's baseline: nothing goes on, and the room can
          // plan for the game actually played (it is now the newest session, so the bench's game).
          if (s && planned != null && s.process_name !== planned) {
            await args.refresh().catch(() => {});
            return say({ kind: "wrong-game", played: s.process_name, planned });
          }
          if (!s || s.samples < MIN_BASELINE_SAMPLES) {
            return say({ kind: "too-short", samples: s ? s.samples : null });
          }
          baseline = s;
          planned = s.process_name;
          const grade = gradeBaseline(s);
          if (grade.kind === "steady" || grade.kind === "too-short") break;
          unevenSessions += 1;
          const final = unevenSessions >= MAX_UNEVEN_SESSIONS;
          say({ kind: "uneven", game: s.process_name, change: change.title, grade, final });
          const d = await waitForDecision();
          if (left()) return;
          if (d === "stop") return say({ kind: "stopped" });
          if (d === "test") break;
        }
      if (left() || !baseline) return;

      // ── The change goes on, through the audited start ──
      try {
        started = await writeLedger<JourneyExperiment>(
          "start_experiment",
          {
            recId: change.id,
            recTitle: change.title,
            baselineSessionId: baseline.started_at,
            hypothesis: args.hypothesis,
            outcome: args.outcome,
          },
          args.refresh,
        );
      } catch (e) {
        // The start refuses before changing anything, or restores what it applied itself; either way it
        // says which. If it somehow left this change's Trial running, put it back.
        const xs = await invoke<JourneyExperiment[]>("get_experiments").catch(() => []);
        const leftOn = (xs ?? []).find((x) => x.status === "running" && x.rec_id === change.id);
        const reason = String(e instanceof Error ? e.message : e);
        // A reused as-is session the start won't compare against: nothing went on, so ask for a new one.
        if (reused && !leftOn && refusesBaseline(reason)) {
          reused = false;
          baseline = null;
          refused = reason;
          continue;
        }
        return recover(args, say, leftOn?.id ?? null, e);
      }
    }
    if (!baseline) return;
    expId = started.id;
    // Remembered so a relaunch can say this Trial was interrupted (the bench's banner).
    tagRunning(expId);
    if (left()) return;
    const trialGame = started.game || baseline.process_name;

    // ── Session 2: with the change ──
    say({ kind: "with-change", game: trialGame, change: change.title, reused });
    const t1 = Date.now();
    run.capturing = true;
    await invoke("start_fps_capture");
    await waitForPlay(args.captureFailed);
    await stopCapture();
    if (left()) return;
    say({ kind: "judging", change: change.title });
    const after = await waitForSession(t1, trialGame, baseline.started_at, left);
    if (left()) return;
    if (!after) {
      // The game closed before Compy saved a reading: nothing to judge, so the change goes back.
      await writeLedger("restore_experiment", { experimentId: expId }, args.refresh);
      tagRunning(null);
      return say({ kind: "restored", change: change.title, why: "no-reading", reason: "" });
    }

    // ── Verdict: conclude keeps only Better and restores everything else ──
    const done = await writeLedger<JourneyExperiment>(
      "conclude_experiment",
      { experimentId: expId, treatmentSessionId: after.started_at, crashed: false },
      args.refresh,
    );
    if (done.status === "kept" && done.verdict !== "improved") {
      // Never keep a change the verdict didn't call Better.
      await writeLedger("restore_experiment", { experimentId: expId }, args.refresh);
      tagRunning(null);
      return say({ kind: "result", exp: { ...done, status: "restored" }, asIs: baseline.started_at });
    }
    tagRunning(null);
    // The PC as it is now: with a kept change, the session measured with it; otherwise the one before.
    const kept = done.status === "kept" && done.verdict === "improved";
    return say({ kind: "result", exp: done, asIs: kept ? after.started_at : baseline.started_at });
  } catch (e) {
    if (left()) return;
    await stopCapture();
    await recover(args, say, expId, e);
    tagRunning(null);
  } finally {
    if (current === run) current = null;
    window.removeEventListener("pagehide", abortJourney);
    window.removeEventListener("beforeunload", abortJourney);
  }
}

// The one line a concluded journey says: what it kept, or what it put back and why, in plain words.
// Only a Better that stayed on reads as kept; every other ending put the change back (conclude restores
// it, or the journey did above).
const PUT_BACK_WHY: Record<string, string> = {
  "no-change": "noChange",
  regressed: "regressed",
  confounded: "confounded",
  expired: "expired",
  "insufficient-evidence": "insufficientEvidence",
  "not-comparable": "notComparable",
  "too-noisy": "tooNoisy",
};
type Translate = (key: string, options?: Record<string, unknown>) => string;
function resultLine(exp: JourneyExperiment, t: Translate): string {
  const k = "lab.experimentBench.journey";
  const change = exp.rec_title;
  if (exp.status === "kept" && exp.verdict === "improved") {
    // Maximum FPS is judged on the average, Recommended on the 1% low: the line says the one it won on.
    const maxFps = exp.outcome === "max-fps";
    const d = maxFps ? exp.treatment?.delta_avg_pct : exp.treatment?.delta_low1_pct;
    if (d == null || !Number.isFinite(d) || d <= 0) return t(`${k}.kept`, { change });
    return t(maxFps ? `${k}.keptAvg` : `${k}.keptLow`, { change, pct: Math.round(d * 10) / 10 });
  }
  const why = PUT_BACK_WHY[exp.verdict ?? ""] ?? "other";
  return t(`${k}.putBack`, { change, reason: t(`${k}.putBackWhy.${why}`) });
}

// ── The panel ───────────────────────────────────────────────────────────────────────────────────
export function GuidedJourney({
  game,
  change,
  canStart,
  outcome,
  onOutcome,
  next,
  refresh,
  onFinished,
}: {
  /** The detected / last-played game (the newest usable session's), or null before any session. */
  game: string | null;
  /** The top-ranked change not yet tested on that game (P4-rank), or null when none is left. */
  change: { id: string; title: string } | null;
  /** False while another Trial runs or the bench is busy. */
  canStart: boolean;
  outcome: JourneyOutcome;
  onOutcome: (o: JourneyOutcome) => void;
  /** After a concluded journey: the next change P4-next ranks untested on that game, null when
   *  nothing is left, undefined while that isn't known yet (the candidates haven't loaded). */
  next?: { id: string; title: string } | null;
  refresh: () => Promise<void>;
  /** Called when the owner closes a finished journey, with the Trial it concluded (if any). */
  onFinished?: (exp: JourneyExperiment | null) => void;
}) {
  const { t } = useTranslation();
  const p = useJourneyPhase();
  const k = "lab.experimentBench.journey";
  const gameName = (g: string | null) => (g ? prettyGameName(g) || g : null);

  if (p.kind === "idle") {
    if (!change) return null;
    const name = gameName(game);
    const start = () => {
      const hypothesis = t("lab.experimentBench.hypothesisWithBaseline", { metric: t("lab.experimentBench.hypothesisMetricFallback") });
      void runJourney({ change, outcome, hypothesis, refresh, captureFailed: t(`${k}.captureFailed`) }, game);
    };
    return (
      <div className="exp-order exp-journey" data-testid="journey">
        <p className="exp-note" data-testid="journey-plan">
          {name ? t(`${k}.planGame`, { game: name, change: change.title }) : t(`${k}.plan`, { change: change.title })}
        </p>
        <div className="exp-running-actions" role="group" aria-label={t(`${k}.aim`)}>
          {(["recommended", "max-fps"] as const).map((o) => (
            <button
              key={o}
              type="button"
              className={o === outcome ? "exp-cta-ghost exp-journey-aim-on" : "exp-cta-ghost"}
              aria-pressed={o === outcome}
              onClick={() => onOutcome(o)}
            >
              {t(`lab.experimentBench.outcome.${o === "max-fps" ? "maxFps" : "recommended"}`)}
            </button>
          ))}
        </div>
        <button type="button" className="exp-cta" disabled={!canStart} onClick={start}>
          {t(`${k}.button`)}
        </button>
        <p className="exp-fineprint">{t(`${k}.oneChange`)}</p>
      </div>
    );
  }

  const playing = p.kind === "as-is" || p.kind === "with-change";
  const finished = !playing && p.kind !== "reading" && p.kind !== "judging" && p.kind !== "uneven";
  let line: string;
  switch (p.kind) {
    case "as-is":
      if (p.again && p.game) line = t(`${k}.asIsAgain`, { game: gameName(p.game) });
      else line = p.game ? t(`${k}.asIs`, { game: gameName(p.game) }) : t(`${k}.asIsNoGame`);
      if (p.refused) line = `${t(`${k}.reuseRefused`, { reason: p.refused })} ${line}`;
      break;
    case "uneven": {
      const why =
        p.grade.kind === "uneven"
          ? t(`${k}.unevenWhy`, { first: Math.round(p.grade.first), second: Math.round(p.grade.second) })
          : t(`${k}.untracedWhy`);
      line = `${why} ${p.final ? t(`${k}.unevenFinal`, { change: p.change }) : t(`${k}.unevenAgain`, { game: gameName(p.game) })}`;
      break;
    }
    case "stopped":
      line = t(`${k}.stopped`);
      break;
    case "with-change":
      line = t(p.reused ? `${k}.withChangeReused` : `${k}.withChange`, { game: gameName(p.game), change: p.change });
      break;
    case "reading":
      line = t(`${k}.reading`);
      break;
    case "judging":
      line = t(`${k}.judging`);
      break;
    case "result":
      line = resultLine(p.exp, t);
      break;
    case "too-short":
      line = p.samples == null ? t(`${k}.noReading`) : t(`${k}.tooShort`, { count: p.samples, min: MIN_BASELINE_SAMPLES });
      break;
    case "wrong-game":
      line = t(`${k}.wrongGame`, { played: gameName(p.played), planned: gameName(p.planned) });
      break;
    case "not-started":
      line = t(`${k}.notStarted`, { reason: p.reason });
      break;
    case "restored":
      line = p.why === "no-reading" ? t(`${k}.restoredNoReading`, { change: p.change }) : t(`${k}.restoredError`, { change: p.change, reason: p.reason });
      break;
    case "restore-failed":
      line = t(`${k}.restoreFailed`, { change: p.change, reason: p.reason });
      break;
  }
  return (
    <div className="exp-order exp-journey" data-testid="journey" data-phase={p.kind}>
      <p className="exp-note" data-testid="journey-line" role={finished ? "status" : undefined}>
        {line}
      </p>
      {playing && (
        <button type="button" className="exp-cta-ghost" onClick={() => finishPlaying?.()}>
          {t(`${k}.donePlaying`)}
        </button>
      )}
      {p.kind === "uneven" && !p.final && (
        <button type="button" className="exp-cta" onClick={() => decide?.("again")}>
          {t(`${k}.playAgain`)}
        </button>
      )}
      {p.kind === "uneven" && p.final && (
        <>
          {/* The bench's own start warning: testing anyway starts on this session, and the record says so. */}
          <p className="exp-bench-warn" data-testid="journey-warn">
            {p.grade.kind === "uneven"
              ? t("lab.experimentBench.baselineUneven", { first: Math.round(p.grade.first), second: Math.round(p.grade.second) })
              : t("lab.experimentBench.baselineUntraced")}
          </p>
          <div className="exp-running-actions">
            <button type="button" className="exp-cta-ghost" onClick={() => decide?.("test")}>
              {t(`${k}.testAnyway`)}
            </button>
            <button type="button" className="exp-cta-ghost" onClick={() => decide?.("stop")}>
              {t(`${k}.stop`)}
            </button>
          </div>
        </>
      )}
      {p.kind === "wrong-game" && (
        <button type="button" className="exp-cta-ghost" onClick={() => setPhase({ kind: "idle" })}>
          {t(`${k}.planFor`, { game: gameName(p.played) })}
        </button>
      )}
      {p.kind === "result" && next && (
        <button
          type="button"
          className="exp-cta"
          disabled={!canStart}
          onClick={() => {
            const hypothesis = t("lab.experimentBench.hypothesisWithBaseline", { metric: t("lab.experimentBench.hypothesisMetricFallback") });
            void runJourney({ change: next, outcome, hypothesis, refresh, captureFailed: t(`${k}.captureFailed`) }, p.exp.game, p.asIs);
          }}
        >
          {t(`${k}.next`, { change: next.title })}
        </button>
      )}
      {p.kind === "result" && next === null && (
        <p className="exp-note" data-testid="journey-done">
          {t(`${k}.nothingLeft`)}
        </p>
      )}
      {finished && (
        <button
          type="button"
          className="exp-cta-ghost"
          onClick={() => {
            const exp = p.kind === "result" ? p.exp : null;
            setPhase({ kind: "idle" });
            onFinished?.(exp);
          }}
        >
          {t(`${k}.close`)}
        </button>
      )}
    </div>
  );
}
