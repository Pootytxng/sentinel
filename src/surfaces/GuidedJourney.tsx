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
  | { kind: "as-is"; game: string | null; change: string }
  | { kind: "reading"; change: string }
  | { kind: "with-change"; game: string; change: string }
  | { kind: "judging"; change: string }
  | { kind: "result"; exp: JourneyExperiment }
  | { kind: "too-short"; samples: number | null }
  | { kind: "wrong-game"; played: string; planned: string }
  | { kind: "not-started"; reason: string }
  | { kind: "restored"; change: string; why: "no-reading" | "error"; reason: string }
  | { kind: "restore-failed"; change: string; reason: string };

// The baseline floor start_experiment enforces (experiment.rs `grade_baseline`, MIN_BASELINE_SAMPLES).
// Checked here first so a short first session is said in plain words, with nothing changed.
const MIN_BASELINE_SAMPLES = 600;
// How often the journey reads capture state, and how long a stopped capture may take to save its
// session (the recorder finishes on its next 1 s tick). Tests shorten both.
let pollMs = 2000;
let saveWaitMs = 8000;

// ── The store ───────────────────────────────────────────────────────────────────────────────────
let phase: JourneyPhase = { kind: "idle" };
const listeners = new Set<() => void>();
let finishPlaying: (() => void) | null = null;
let stopPlaying: ((err: Error) => void) | null = null;

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
  if (exp.status === "kept" && exp.verdict === "improved") return say({ kind: "result", exp });
  return say({ kind: "restore-failed", change, reason });
}

async function runJourney(args: RunArgs, game: string | null) {
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
    // ── Session 1: as-is ──
    say({ kind: "as-is", game, change: change.title });
    const t0 = Date.now();
    run.capturing = true;
    await invoke("start_fps_capture");
    await waitForPlay(args.captureFailed);
    await stopCapture();
    if (left()) return;
    say({ kind: "reading", change: change.title });
    const baseline = await waitForSession(t0, null, undefined, left);
    if (left()) return;
    // A session of another game can't be this game's baseline: nothing goes on, and the room can plan
    // for the game actually played (it is now the newest session, so the bench's game).
    if (baseline && game != null && baseline.process_name !== game) {
      await args.refresh().catch(() => {});
      return say({ kind: "wrong-game", played: baseline.process_name, planned: game });
    }
    if (!baseline || baseline.samples < MIN_BASELINE_SAMPLES) {
      return say({ kind: "too-short", samples: baseline ? baseline.samples : null });
    }

    // ── The change goes on, through the audited start ──
    let started: JourneyExperiment;
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
      return recover(args, say, leftOn?.id ?? null, e);
    }
    expId = started.id;
    // Remembered so a relaunch can say this Trial was interrupted (the bench's banner).
    tagRunning(expId);
    if (left()) return;
    const trialGame = started.game || baseline.process_name;

    // ── Session 2: with the change ──
    say({ kind: "with-change", game: trialGame, change: change.title });
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
      return say({ kind: "result", exp: { ...done, status: "restored" } });
    }
    tagRunning(null);
    return say({ kind: "result", exp: done });
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

// ── The panel ───────────────────────────────────────────────────────────────────────────────────
export function GuidedJourney({
  game,
  change,
  canStart,
  outcome,
  onOutcome,
  verdictLabel,
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
  verdictLabel: (verdict: string) => string;
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
  const finished = !playing && p.kind !== "reading" && p.kind !== "judging";
  let line: string;
  switch (p.kind) {
    case "as-is":
      line = p.game ? t(`${k}.asIs`, { game: gameName(p.game) }) : t(`${k}.asIsNoGame`);
      break;
    case "with-change":
      line = t(`${k}.withChange`, { game: gameName(p.game), change: p.change });
      break;
    case "reading":
      line = t(`${k}.reading`);
      break;
    case "judging":
      line = t(`${k}.judging`);
      break;
    case "result":
      line = t(`${k}.result`, { change: p.exp.rec_title, verdict: p.exp.verdict ? verdictLabel(p.exp.verdict) : "" });
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
      {p.kind === "wrong-game" && (
        <button type="button" className="exp-cta-ghost" onClick={() => setPhase({ kind: "idle" })}>
          {t(`${k}.planFor`, { game: gameName(p.played) })}
        </button>
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
