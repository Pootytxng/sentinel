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
// and says so in plain words. No new mutation path, and nothing here brings a window to the front
// (P5-enough's "enough yet?" line shows in this panel and, when it is on, in the click-through
// overlay; see journey-enough.ts). The only thing kept is the running Trial's id in this webview's localStorage, so a
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
// P5-resume (ROADMAP P5 step 5; ENGINE §7): the journey survives a restart and spans days because
// its progress is derived from the experiments store (journey-resume.ts). While no journey runs, the
// panel says "N of M tested · Next: <change>"; the button continues from there, reusing the newest
// judged Trial's as-is session under P5-continue's rule; "Stop here" ends the journey for that game
// without touching the PC and says what stays on. A Trial left Running is named on that line the same
// way the bench's interrupted banner names it (JourneyProgressLine).
//
// The journey lives in a module-level store, not component state, so the owner can click around
// Compy while he plays: leaving the room keeps it running, and the panel shows it again on return.
// Only the window really going away (a reload, Compy closing: `pagehide` / `beforeunload`) ends it
// early (`abortJourney`): the capture it started is stopped and nothing is judged. A change already on
// stays on, its Trial Running, until the owner concludes or restores it in Test; the bench says so
// with a banner on its next load.
//
// P5-realplay (ROADMAP Phase 5 "Real-play mode"; Constitution §36): the two-session journey above stays
// the default. Beside it, one plain choice, "Test it while I play normally", is offered when real play
// can start (enough recent as-is sessions count: the change goes on at once) or while Compy is still
// collecting them. Real play leaves ONE change on, applied once through the same audited
// start_experiment (`mode: "real-play"`), while the owner plays however he plays, and judges it on
// several whole sessions with it against several without it (realplay.rs). Each tap measures one
// session (`measureOneSession`, shared with the two-session flow): an uneven session is never retaken,
// because whole sessions are compared and no session's halves are graded. After each one the journey
// reads `get_realplay_progress`; when a look has decided it concludes at once through
// conclude_realplay (which keeps only a Likely better and restores everything else), and when the test
// has stopped it waits for the owner's tap. A running real-play Trial's panel (`RealPlayPanel`) is
// derived from its record and that progress read, never from this module, so it reads the same after
// a restart; it says the change is on and since when, how long it may stay on, how to put it back
// (with the button that does, the existing restore_experiment), where the count stands and which
// sessions didn't count and why. Real play never tags RUNNING_KEY: its Trial runs for days by design,
// so it is never "interrupted". Once a real-play Trial has started, nothing here restores its change
// behind the owner's back: a failure judges nothing, leaves it on and says so. (A start that fails is
// handled as the two-session start's is: anything it left on is put back.)

import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../types";
import { allBackground } from "../lib/session-metrics";
import { writeLedger } from "../data/ledger-write";
import { prettyGameName } from "./game-name";
import { gradeBaseline, MIN_BASELINE_SAMPLES } from "./baseline-grade";
import { Depth, ReceiptRow, receiptBand, receiptPct } from "../design/Depth";
import { asProgress, enoughLine, enoughState, setJourneyRecording, type CaptureProgress, type JourneyMode } from "./journey-enough";
import { journeyStopped, pickUpJourney, stopJourneyHere, type JourneyProgress } from "./journey-resume";
import { contextCheckFor, type RetestReason } from "./test-summary";
import {
  asRealPlayProgress,
  collectingBeforeLine,
  isRealPlay,
  notCountedWhy,
  realPlayConfidence,
  realPlayNumbersMissing,
  realPlayOffer,
  realPlayResult,
  realPlayView,
  realPlayWhy,
  type RealPlayEvidence,
  type RealPlayProgress,
  type RealPlayRecord,
} from "./journey-realplay";

export type JourneyOutcome = "recommended" | "max-fps";
/** P8-posture-b's answer to "How far may Compy go on this PC?" (trial_candidates.rs `RiskChoice`). */
export type JourneyRiskChoice = "low-only" | "low-and-moderate";

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
  treatment?: {
    delta_low1_pct: number;
    delta_avg_pct?: number | null;
    session_id?: string | null;
    avg_fps?: number | null;
    low1_fps?: number | null;
    samples?: number | null;
  } | null;
  // P7-depth-verdicts: the record fields the receipt shows verbatim (experiment.rs `ExperimentRecord`).
  // All optional: an older record, or the journey's own lighter copy, simply shows fewer rows.
  baseline_session_id?: string | null;
  baseline_avg_fps?: number | null;
  baseline_low1_fps?: number | null;
  verdict_confidence?: string | null;
  noise_evidence?: { band_pct?: number | null; measured_noise_pct?: number | null } | null;
  noise_floor_pct?: number | null;
  /** P8-dims: what the catalog stated about the change's risk when this Trial started (experiment.rs
   *  `stated_risk`): its one overall word and each dimension it states (null = not stated). Absent on
   *  records started before Compy kept it. */
  stated_risk?: {
    overall?: string | null;
    dimensions?: Partial<Record<RiskDimension, string | null>> | null;
    /** P8-ack: the catalog's own cost words the start read (null = it states none). */
    cost?: string | null;
  } | null;
  /** P8-posture-show: the risk the user allowed when this Trial started (experiment.rs `risk_choice`).
   *  Absent on records started before Compy kept it. */
  risk_choice?: string | null;
  /** P8-ack: whether the user confirmed the change's cost before this Trial started (experiment.rs
   *  `cost_acknowledged`; false = not asked). Absent on records started before Compy kept it. */
  cost_acknowledged?: boolean | null;
  /** P5-realplay: "real-play" for a Trial judged on real play (experiment.rs `TrialMode`); absent on a
   *  two-session Trial. */
  mode?: string | null;
  /** P5-realplay: the real-play sessions and verdict numbers (experiment.rs `real_play`). */
  real_play?: RealPlayEvidence | null;
  /** When the apply returned: the change has been on since then. */
  applied_at?: string | null;
  kept?: boolean;
  stop_reason?: string | null;
};

/** P8-dims (RISK_MODEL §3): the risk dimensions the receipt lists, in its order (trial_candidates.rs
 *  `RiskDimensions`). */
const RISK_DIMENSIONS = ["reversibility", "stability", "compatibility", "security"] as const;
type RiskDimension = (typeof RISK_DIMENSIONS)[number];

type FpsStatusLite = {
  active: boolean;
  status: string;
  sample: { process_name: string } | null;
  /** monitoring.rs `FpsStatus::game_running`. Absent on older builds = unknown. */
  game_running?: boolean | null;
  /** monitoring.rs `FpsStatus::progress` (P5-enough). Absent on older builds. */
  progress?: unknown;
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
  | { kind: "too-short"; samples: number | null; behind?: boolean }
  | { kind: "wrong-game"; played: string; planned: string }
  | { kind: "not-started"; reason: string }
  /** `asked`: the owner tapped "Restore now" on a real-play Trial. */
  | { kind: "restored"; change: string; why: "no-reading" | "behind" | "error" | "asked"; reason: string }
  | { kind: "restore-failed"; change: string; reason: string }
  /** P5-realplay: one session is being measured; `on` = with the change on, else as-is (nothing on). */
  | { kind: "rp-playing"; game: string; change: string; on: boolean }
  /** P5-realplay: after an as-is session, fewer than the sessions real play needs count yet. Nothing
   *  is on. `costAcknowledged`: the owner already tapped the cost line for this change. */
  | { kind: "rp-before"; game: string; change: { id: string; title: string }; progress: RealPlayProgress; costAcknowledged: boolean }
  /** P5-realplay: judging the sessions (conclude_realplay), or putting the change back (restore_experiment). */
  | { kind: "rp-working"; change: string; what: "judging" | "putting-back" }
  /** P5-realplay: a step failed and judged nothing; the change is still on (that is the test). */
  | { kind: "rp-failed"; change: string; reason: string };

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

// P5-enough: what the session being recorded has measured so far (journey-enough.ts), from the same
// get_fps_status poll that watches for the game closing. Null when nothing is recording.
let progress: CaptureProgress | null = null;
const setProgress = (next: CaptureProgress | null) => {
  if (next === progress) return;
  progress = next;
  for (const l of listeners) l();
};
const getProgress = () => progress;
/** The recording session's progress, or null. */
export function useJourneyProgress(): CaptureProgress | null {
  return useSyncExternalStore(subscribe, getProgress, getProgress);
}

/** The journey's current phase; the bench hides its own panels while it isn't idle. */
export function useJourneyPhase(): JourneyPhase {
  return useSyncExternalStore(subscribe, getPhase, getPhase);
}

/** P5-realplay: what became of the session a real-play run just measured, said once on the panel:
 *  it counts, it doesn't (with the backend's reason, or one the saved session itself shows), or no
 *  session of the game was saved. Cosmetic: the counts themselves always come from the backend. */
type RealPlayNote =
  | { expId: string | null; game: string; kind: "counted" }
  | { expId: string | null; game: string; kind: "not-counted"; reason: string; minReadings: number }
  | { expId: string | null; game: string; kind: "none" };
let realPlayNote: RealPlayNote | null = null;
const setRealPlayNote = (next: RealPlayNote | null) => {
  realPlayNote = next;
  for (const l of listeners) l();
};
const getRealPlayNote = () => realPlayNote;
function useRealPlayNote(): RealPlayNote | null {
  return useSyncExternalStore(subscribe, getRealPlayNote, getRealPlayNote);
}
/** Set while a panel tap's write (see the result, close the test, put it back) is in flight. */
let acting = false;

/** Tests only: back to idle between cases, with short timings. */
export function resetJourneyForTests(timing: { pollMs: number; saveWaitMs: number } = { pollMs: 2000, saveWaitMs: 8000 }) {
  abortJourney();
  finishPlaying = null;
  stopPlaying = null;
  decide = null;
  current = null;
  acting = false;
  realPlayNote = null;
  tagRunning(null);
  setJourneyRecording(false);
  progress = null;
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
 *  Windows prompt, a helper that didn't start). `mode` tells the overlay which kind of session it is. */
function waitForPlay(captureFailed: string, mode: JourneyMode = "pair"): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let seen = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      finishPlaying = null;
      stopPlaying = null;
      setJourneyRecording(false);
      setProgress(null);
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    finishPlaying = () => finish();
    stopPlaying = (err) => finish(err);
    setJourneyRecording(mode);
    setProgress(null);
    const tick = async () => {
      if (settled) return;
      const st = await invoke<FpsStatusLite>("get_fps_status").catch(() => null);
      if (settled) return;
      if (st) {
        setProgress(asProgress(st.progress));
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
          // P4-show-f1: a session behind another window the whole time is returned too, so the
          // journey can say why it has no reading.
          (usable(s) || allBackground(s)) &&
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
 *  a usable reading, graded steady, and recorded under the SAME graphics driver and Windows build as
 *  the game's newest session (P4-exit-truth reviews: reusing an old- or unknown-context as-is session
 *  would keep the next result stale or unverified, run after run). Whether it is otherwise still
 *  comparable is the start's to say. */
export function reusableAsIs(sessions: SessionSummary[], id: string | null, game: string | null): SessionSummary | null {
  const s = id == null ? undefined : sessions.find((x) => x.started_at === id);
  if (!s || !usable(s) || (game != null && s.process_name !== game)) return null;
  // Round 3 review MUST-FIX 1: reuse needs a MATCHING context. An as-is session whose context can't be
  // classified would make the next result unverified too (and keep it so, run after run); a fresh
  // before-session is the only way to a verifiable result.
  if (contextCheckFor(game ?? s.process_name, sessions).matchOf(s.started_at) !== "matching") return null;
  return gradeBaseline(s).kind === "steady" ? s : null;
}
async function reusableSession(id: string, game: string | null): Promise<SessionSummary | null> {
  const ss = await invoke<SessionSummary[]>("get_session_summaries").catch(() => []);
  return reusableAsIs(ss ?? [], id, game);
}

/** The start's refusal is about the before-reading (resolve_baseline / baseline_is_current /
 *  baseline_for_start all name "the baseline session"), not about the change or another Trial. */
export const refusesBaseline = (reason: string) => /baseline/i.test(reason);

type RunArgs = {
  change: { id: string; title: string };
  outcome: JourneyOutcome;
  /** P8-posture-show: the risk allowed when the owner pressed the button; the bench hides its picker
   *  while a journey runs, so it is still the one in force when the change goes on. */
  riskChoice?: JourneyRiskChoice;
  /** P8-ack: the owner tapped "I understand, test it" on the line naming the change's cost. */
  costAcknowledged?: boolean;
  hypothesis: string;
  refresh: () => Promise<void>;
  captureFailed: string;
  /** P5-realplay: what to say when the real-play progress can't be read (already translated). */
  noProgress?: string;
};

/** One run's own flags: whether the room it was started from has gone (`aborted`), and whether it
 *  holds a capture it must stop. */
type Run = { aborted: boolean; capturing: boolean };
let current: Run | null = null;

/** Stops the capture `run` started, when it still holds one. */
async function stopCapture(run: Run) {
  if (!run.capturing) return;
  run.capturing = false;
  await invoke("stop_fps_capture").catch(() => {});
}

/** One measured session, shared by the two-session flow (twice) and real play (once per tap): start
 *  measuring, wait until the game closes or "Done playing", stop, then wait for the saved session (of
 *  `game`, when given; never the one `not` names). `saving` is said while it saves. undefined: the
 *  room went away mid-way and nothing more is to be done; null: no session was saved. */
async function measureOneSession(
  run: Run,
  opts: { captureFailed: string; saving: () => void; game: string | null; not?: string; mode?: JourneyMode },
): Promise<SessionSummary | null | undefined> {
  const t0 = Date.now();
  run.capturing = true;
  await invoke("start_fps_capture");
  await waitForPlay(opts.captureFailed, opts.mode);
  await stopCapture(run);
  if (run.aborted) return undefined;
  opts.saving();
  const s = await waitForSession(t0, opts.game, opts.not, () => run.aborted);
  return run.aborted ? undefined : s;
}

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
          // A retake never reads back the uneven session before it.
          const s = await measureOneSession(run, {
            captureFailed: args.captureFailed,
            saving: () => say({ kind: "reading", change: change.title }),
            game: null,
            not: baseline?.started_at,
          });
          if (s === undefined || left()) return;
          // A session of another game can't be this game's baseline: nothing goes on, and the room can
          // plan for the game actually played (it is now the newest session, so the bench's game).
          if (s && planned != null && s.process_name !== planned) {
            await args.refresh().catch(() => {});
            return say({ kind: "wrong-game", played: s.process_name, planned });
          }
          if (s && allBackground(s)) return say({ kind: "too-short", samples: null, behind: true });
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
            riskChoice: args.riskChoice,
            costAcknowledged: args.costAcknowledged ?? false,
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
    const after = await measureOneSession(run, {
      captureFailed: args.captureFailed,
      saving: () => say({ kind: "judging", change: change.title }),
      game: trialGame,
      not: baseline.started_at,
    });
    if (after === undefined || left()) return;
    if (!after || allBackground(after)) {
      // The game closed before Compy saved a reading, or was behind another window the whole time:
      // nothing to judge, so the change goes back.
      await writeLedger("restore_experiment", { experimentId: expId }, args.refresh);
      tagRunning(null);
      return say({ kind: "restored", change: change.title, why: after ? "behind" : "no-reading", reason: "" });
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
    await stopCapture(run);
    await recover(args, say, expId, e);
    tagRunning(null);
  } finally {
    if (current === run) current = null;
    window.removeEventListener("pagehide", abortJourney);
    window.removeEventListener("beforeunload", abortJourney);
  }
}

// ── P5-realplay ─────────────────────────────────────────────────────────────────────────────────

/** This game's real-play progress (get_realplay_progress, read-only), or why it can't be read. */
async function readRealPlay(game: string): Promise<{ progress: RealPlayProgress | null; error: string | null }> {
  try {
    const progress = asRealPlayProgress(await invoke<unknown>("get_realplay_progress", { game }));
    return { progress, error: null };
  } catch (e) {
    return { progress: null, error: String(e instanceof Error ? e.message : e) };
  }
}

/** What became of the session just measured: the backend's not-counted reason when it lists it, what
 *  the saved session itself shows (behind another window the whole time, too few readings), or that
 *  it counts when the count went up. null when none of these can be said. With no session read back
 *  (the journey reads back only sessions with a frame-rate reading), a session the backend lists as
 *  begun since `since` is that one, with its reason (no frame-rate reading); else nothing was saved. */
function noteFor(
  s: SessionSummary | null,
  counts: { before: number; after: number | null },
  listed: RealPlayProgress | null,
  minReadings: number,
  where: { game: string; expId: string | null },
  since: number,
): RealPlayNote | null {
  if (!s) {
    const unread = listed?.not_counted.find((n) => Date.parse(n.session_id) >= since - 1000);
    return unread ? { ...where, kind: "not-counted", reason: unread.reason, minReadings } : { ...where, kind: "none" };
  }
  const reason =
    listed?.not_counted.find((n) => n.session_id === s.started_at)?.reason ??
    (allBackground(s) ? "behind" : s.samples < minReadings ? "too-short" : null);
  if (reason) return { ...where, kind: "not-counted", reason, minReadings };
  return counts.after != null && counts.after > counts.before ? { ...where, kind: "counted" } : null;
}

/** One tap of "Test it while I play normally" or "Measure my next session". Measures at most ONE
 *  session: real play spans days, and a capture left waiting for a next session would keep measuring
 *  a PC nobody plays on. With no Trial running, an as-is session is measured while fewer than the
 *  sessions real play needs count (never retaken when uneven: whole sessions are compared, no
 *  session's halves are graded), and the change goes on through the audited start once enough count;
 *  with enough already counting, the change goes on at once and the session about to be played is
 *  measured with it. After a session with the change on, a decided look is concluded at once; a
 *  stopped test waits for the owner's tap. A failure judges nothing and leaves the change on. */
async function runRealPlay(args: RunArgs, game: string, progress: RealPlayProgress) {
  const { change } = args;
  const run: Run = { aborted: false, capturing: false };
  current = run;
  window.addEventListener("pagehide", abortJourney);
  window.addEventListener("beforeunload", abortJourney);
  const left = () => run.aborted;
  const say = (p: JourneyPhase) => {
    if (!run.aborted) setPhase(p);
  };
  const saving = () => say({ kind: "reading", change: change.title });
  const noProgress = args.noProgress ?? "";
  setRealPlayNote(null);
  let expId = progress.experiment_id;
  try {
    if (expId == null) {
      let now = progress;
      let startOnly = false;
      if (now.phase === "collecting-before") {
        // ── An as-is session: nothing is on. Whether it counts is the backend's to say. ──
        say({ kind: "rp-playing", game, change: change.title, on: false });
        const since = Date.now();
        const s = await measureOneSession(run, { captureFailed: args.captureFailed, saving, game, mode: "real-play" });
        if (s === undefined) return;
        const read = await readRealPlay(game);
        if (left()) return;
        await args.refresh().catch(() => {});
        if (!read.progress) return say({ kind: "not-started", reason: read.error ?? noProgress });
        if (read.progress.phase !== "ready-to-start") {
          setRealPlayNote(noteFor(s, { before: now.before, after: read.progress.before }, null, now.min_readings, { game, expId: null }, since));
          return say({ kind: "rp-before", game, change, progress: read.progress, costAcknowledged: args.costAcknowledged ?? false });
        }
        // Enough as-is sessions count now: the change goes on, and the next session is the owner's tap.
        now = read.progress;
        startOnly = true;
      }
      if (now.phase !== "ready-to-start" || !now.anchor_session_id) return say({ kind: "not-started", reason: noProgress });
      // ── The change goes on once, through the audited start, and stays on while the owner plays ──
      try {
        const started = await writeLedger<JourneyExperiment>(
          "start_experiment",
          {
            recId: change.id,
            recTitle: change.title,
            baselineSessionId: now.anchor_session_id,
            hypothesis: args.hypothesis,
            outcome: args.outcome,
            riskChoice: args.riskChoice,
            costAcknowledged: args.costAcknowledged ?? false,
            mode: "real-play",
          },
          args.refresh,
        );
        expId = started.id;
      } catch (e) {
        // As the two-session start: refused before anything changed, or the start restored what it
        // applied itself. If it somehow left this change's Trial running, put it back.
        const xs = await invoke<JourneyExperiment[]>("get_experiments").catch(() => []);
        const leftOn = (xs ?? []).find((x) => x.status === "running" && x.rec_id === change.id);
        return await recover(args, say, leftOn?.id ?? null, e);
      }
      if (startOnly || left()) return say({ kind: "idle" });
    }
    // ── One session with the change on ──
    const counted = progress.experiment_id === expId ? progress.with : 0;
    say({ kind: "rp-playing", game, change: change.title, on: true });
    const since = Date.now();
    const s = await measureOneSession(run, { captureFailed: args.captureFailed, saving, game, mode: "real-play" });
    if (s === undefined) return;
    const read = await readRealPlay(game);
    if (left()) return;
    const after = read.progress?.experiment_id === expId ? read.progress : null;
    // Right after a session it measured, a look that decided is recorded at once (the two-session
    // journey concludes after its second session the same way). A stopped test waits for a tap.
    if (after?.phase === "ready") return await concludeRealPlayTrial(args.refresh, say, expId, change.title);
    setRealPlayNote(noteFor(s, { before: counted, after: after?.with ?? null }, after, after?.min_readings ?? progress.min_readings, { game, expId }, since));
    await args.refresh().catch(() => {});
    say({ kind: "idle" });
  } catch (e) {
    if (left()) return;
    await stopCapture(run);
    const reason = String(e instanceof Error ? e.message : e);
    // Nothing is put back behind the owner's back: the change staying on IS the test, and the panel
    // offers to put it back. Before anything went on, nothing was changed.
    say(expId ? { kind: "rp-failed", change: change.title, reason } : { kind: "not-started", reason });
  } finally {
    if (current === run) current = null;
    window.removeEventListener("pagehide", abortJourney);
    window.removeEventListener("beforeunload", abortJourney);
  }
}

/** Records a real-play Trial's result through the audited conclude_realplay, which keeps the change
 *  only when a look judged it Likely better and puts it back otherwise. A refused conclude changed
 *  nothing (the test is still running); one whose restore couldn't be confirmed says so loudly. */
async function concludeRealPlayTrial(refresh: () => Promise<void>, say: (p: JourneyPhase) => void, expId: string, change: string) {
  say({ kind: "rp-working", change, what: "judging" });
  let done: JourneyExperiment;
  try {
    done = await writeLedger<JourneyExperiment>("conclude_realplay", { experimentId: expId, crashed: false }, refresh);
  } catch (e) {
    const reason = String(e instanceof Error ? e.message : e);
    const xs = await invoke<JourneyExperiment[]>("get_experiments").catch(() => null);
    const exp = xs?.find((x) => x.id === expId) ?? null;
    return say(exp?.status === "running" ? { kind: "rp-failed", change, reason } : { kind: "restore-failed", change, reason });
  }
  try {
    if (done.status === "kept" && done.verdict !== "improved") {
      // Never keep a change the verdict didn't call Better.
      await writeLedger("restore_experiment", { experimentId: expId }, refresh);
      return say({ kind: "result", exp: { ...done, status: "restored" }, asIs: done.baseline_session_id ?? null });
    }
  } catch (e) {
    return say({ kind: "restore-failed", change, reason: String(e instanceof Error ? e.message : e) });
  }
  const kept = done.status === "kept" && done.verdict === "improved";
  return say({ kind: "result", exp: done, asIs: (kept ? done.treatment?.session_id : done.baseline_session_id) ?? null });
}

/** "See the result" (a look decided) or "Close this test" (the test stopped), from the owner's tap. */
async function closeRealPlay(expId: string, change: string, refresh: () => Promise<void>) {
  if (current || acting) return;
  acting = true;
  setRealPlayNote(null);
  try {
    await concludeRealPlayTrial(refresh, setPhase, expId, change);
  } finally {
    acting = false;
  }
}

/** "Restore now" (the label the pair panel's undo already wears): the existing audited
 *  restore_experiment, which writes the setting back exactly as it was saved before the test and
 *  reads it back. */
async function putBackRealPlay(expId: string, change: string, refresh: () => Promise<void>) {
  if (current || acting) return;
  acting = true;
  setRealPlayNote(null);
  setPhase({ kind: "rp-working", change, what: "putting-back" });
  try {
    await writeLedger("restore_experiment", { experimentId: expId }, refresh);
    setPhase({ kind: "restored", change, why: "asked", reason: "" });
  } catch (e) {
    setPhase({ kind: "restore-failed", change, reason: String(e instanceof Error ? e.message : e) });
  } finally {
    acting = false;
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
  // P5-realplay: Likely better / Likely worse / No clear difference / Unknown, from the record's own numbers.
  if (isRealPlay(exp)) return realPlayResult(exp, prettyGameName(exp.game) || exp.game, t);
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

/** P7-depth-verdicts (Constitution §13): the result line is the ANSWER; this is its EXPLANATION — the
 *  rule the verdict was judged by (Recommended: the 1% low beyond the band with the average not
 *  falling beyond it; Maximum FPS: the average beyond the band with the 1% low held), and, for an
 *  attempt that judged nothing, that the two sessions could not be compared fairly. */
function resultWhy(exp: JourneyExperiment, t: Translate): string {
  if (isRealPlay(exp)) return realPlayWhy(exp, t);
  const k = "lab.experimentBench.journey.why";
  const measured = exp.verdict === "improved" || exp.verdict === "no-change" || exp.verdict === "regressed";
  if (!measured) return t(`${k}.noResult`);
  // The band figure is named only when the record holds the band it was judged against
  // (`noise_evidence.band_pct`); a legacy record's `noise_floor_pct` is a floor, not that band.
  const band = exp.noise_evidence?.band_pct ?? null;
  // Any pick that is not Maximum FPS was judged by the Recommended rule: experiment.rs reads an
  // unknown or absent pick as Recommended (P4-maxfps-smooth).
  const key = exp.outcome === "max-fps" ? "maxFps" : "recommended";
  return band != null && Number.isFinite(band) ? t(`${k}.${key}Band`, { band: Number(band.toFixed(1)) }) : t(`${k}.${key}`);
}

/** P8-ack (RISK_MODEL §1 Advanced, "explicit user acknowledgement when the cost is not obvious"): a
 *  change the catalog rates moderate, or whose risk it doesn't state, needs one tap on a line naming
 *  its cost before its Trial starts. A low-risk change starts as before, and so does a candidate with
 *  no risk at all (trial_candidates.rs always sends one). Shared by the bench's Start and the journey. */
export function needsCostAck(risk: string | null | undefined): boolean {
  return risk === "moderate" || risk === "unknown";
}

/** P8-ack: the one plain line before such a start: the change's cost in the catalog's own words, or,
 *  when the catalog states none, that it states none (never a cost Compy made up). */
export function costAckLine(change: string, cost: string | null | undefined, t: Translate): string {
  const words = cost?.trim();
  return words
    ? t("lab.experimentBench.costAck.line", { change, cost: words })
    : t("lab.experimentBench.costAck.noCost", { change });
}

/** P8-ack: what a Trial's record says about the cost confirmation. False on a low-risk change is "not
 *  needed"; false otherwise is "not asked"; a record from before is "not recorded". */
function costConfirmedWord(exp: JourneyExperiment, t: Translate): string {
  const k = "lab.experimentBench.journey.receipt";
  if (exp.cost_acknowledged === true) return t(`${k}.costWord.yes`);
  if (exp.cost_acknowledged === false)
    return exp.stated_risk?.overall === "low" ? t(`${k}.costWord.notNeeded`) : t(`${k}.costWord.notAsked`);
  return t(`${k}.riskWord.notRecorded`);
}

/** P8-posture-show: the risk a Trial's record says the user allowed, in the picker's own words; a
 *  record without one (or with one this build doesn't know) is "not recorded", never the default. */
export function riskChoiceWord(choice: string | null | undefined, t: Translate): string {
  if (choice === "low-only") return t("lab.experimentBench.riskChoice.lowOnly");
  if (choice === "low-and-moderate") return t("lab.experimentBench.riskChoice.lowAndModerate");
  return t("lab.experimentBench.journey.receipt.riskWord.notRecorded");
}

/** P8-dims: a risk word the catalog stated, in a form this build knows. */
const isStatedRisk = (word: string | null | undefined): word is "low" | "moderate" | "high" =>
  word === "low" || word === "moderate" || word === "high";

/** P8-dims: one stated risk word as the receipt says it. A word the catalog didn't state, or one this
 *  build doesn't know, is "not stated": never filled in from another dimension or the overall word. */
function riskWord(word: string | null | undefined, t: Translate): string {
  const k = "lab.experimentBench.journey.receipt.riskWord";
  return isStatedRisk(word) ? t(`${k}.${word}`) : t(`${k}.notStated`);
}

/** The RECEIPT: the record's own numbers, verbatim. Rows with nothing recorded are left out. */
function ResultReceipt({ exp }: { exp: JourneyExperiment }) {
  const { t } = useTranslation();
  const rk = (key: string) => t(`lab.experimentBench.journey.receipt.${key}`);
  const fps = (n: number | null | undefined) => (n != null && Number.isFinite(n) ? `${n.toFixed(1)} fps` : null);
  const pct = receiptPct;
  const tr = exp.treatment;
  const risk = exp.stated_risk;
  // P5-realplay: what real play judged on, from the record's own evidence; nothing it didn't record.
  const rp = isRealPlay(exp) ? (exp.real_play ?? null) : null;
  const count = (n: number | undefined) => (n != null ? String(n) : null);
  // Review 2026-11-02: a real-play verdict whose numbers the record doesn't hold reads Unknown above,
  // so its verdict and confidence rows say not judged, never a verdict without its numbers.
  const unjudged = isRealPlay(exp) && realPlayNumbersMissing(exp);
  return (
    <dl className="journey-receipt">
      <ReceiptRow label={rk("change")} value={exp.rec_id} />
      <ReceiptRow label={rk("outcome")} value={exp.outcome ?? null} />
      <ReceiptRow label={rk("mode")} value={rp ? (exp.mode ?? null) : null} />
      <ReceiptRow label={rk("verdict")} value={unjudged ? rk("notJudged") : exp.verdict} />
      {/* Real play never claims High confidence (none is recorded); a stored "high" reads as medium. */}
      <ReceiptRow
        label={rk("confidence")}
        value={unjudged ? rk("notJudged") : rp ? realPlayConfidence(exp.verdict_confidence) : (exp.verdict_confidence ?? null)}
      />
      {rp && (
        <>
          <ReceiptRow label={rk("sessionsBefore")} value={count(rp.before?.length)} />
          <ReceiptRow label={rk("sessionsWith")} value={count(rp.with?.length)} />
          <ReceiptRow label={rk("spreadLow")} value={receiptBand(rp.low1_spread_pct)} />
          <ReceiptRow label={rk("spreadAvg")} value={receiptBand(rp.avg_spread_pct)} />
          <ReceiptRow label={rk("look")} value={rp.look != null ? String(rp.look) : null} />
          <ReceiptRow label={rk("notCounted")} value={rp.not_counted?.length ? String(rp.not_counted.length) : null} />
        </>
      )}
      <ReceiptRow label={rk("baselineAvg")} value={fps(exp.baseline_avg_fps)} />
      <ReceiptRow label={rk("afterAvg")} value={tr ? [fps(tr.avg_fps), pct(tr.delta_avg_pct)].filter(Boolean).join(" ") || null : null} />
      <ReceiptRow label={rk("baselineLow")} value={fps(exp.baseline_low1_fps)} />
      <ReceiptRow label={rk("afterLow")} value={tr ? [fps(tr.low1_fps), pct(tr.delta_low1_pct)].filter(Boolean).join(" ") || null : null} />
      {/* The band the verdict was judged against, when recorded; a legacy record shows its floor AS a floor. */}
      <ReceiptRow label={rk("band")} value={receiptBand(exp.noise_evidence?.band_pct)} />
      <ReceiptRow label={rk("noiseFloor")} value={exp.noise_evidence?.band_pct == null ? receiptBand(exp.noise_floor_pct) : null} />
      <ReceiptRow label={rk("measuredNoise")} value={receiptBand(exp.noise_evidence?.measured_noise_pct)} />
      <ReceiptRow label={rk("samples")} value={tr?.samples != null ? String(tr.samples) : null} />
      <ReceiptRow label={rk("baselineSession")} value={exp.baseline_session_id ?? null} />
      <ReceiptRow label={rk("afterSession")} value={tr?.session_id ?? null} />
      {/* P8-posture-show: how far the user let Compy go when this Trial started. */}
      <ReceiptRow label={rk("riskChoice")} value={riskChoiceWord(exp.risk_choice, t)} />
      {/* P8-dims (RISK_MODEL §3, "do not collapse these into one arbitrary score"): the catalog's one
          overall word, then each dimension it states for the change; one it doesn't state says so. A
          record started before Compy kept the catalog's risk says that instead, never a guess. When
          the catalog states none of the four, one row says so rather than four rows of "not stated". */}
      <ReceiptRow label={rk("riskOverall")} value={risk ? riskWord(risk.overall, t) : rk("riskWord.notRecorded")} />
      {risk &&
        (RISK_DIMENSIONS.some((d) => isStatedRisk(risk.dimensions?.[d])) ? (
          RISK_DIMENSIONS.map((d) => <ReceiptRow key={d} label={rk(`risk.${d}`)} value={riskWord(risk.dimensions?.[d], t)} />)
        ) : (
          <ReceiptRow label={rk("riskDimensions")} value={rk("riskDimensionsNotStated")} />
        ))}
      {/* P8-ack: the catalog's own cost words the start read, and whether the user confirmed them. */}
      {risk && <ReceiptRow label={rk("cost")} value={risk.cost?.trim() ? risk.cost : rk("riskWord.notStated")} />}
      <ReceiptRow label={rk("costConfirmed")} value={costConfirmedWord(exp, t)} />
      <ReceiptRow label={rk("trial")} value={exp.id} />
    </dl>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────────────────────────
export function GuidedJourney({
  game,
  change,
  canStart,
  outcome,
  onOutcome,
  next,
  nextReuses = false,
  refresh,
  riskChoice,
  onFinished,
  progress = null,
  resumeReuses = false,
  stillOn = [],
  realPlay = null,
  heldByRisk = 0,
}: {
  /** The detected / last-played game (the newest usable session's), or null before any session. */
  game: string | null;
  /** The top-ranked change not yet tested on that game (P4-rank), else one worth another run
   *  (`retest` says why: an inconclusive attempt, or a result judged under an older driver or Windows
   *  build), or null when none is left. */
  change: { id: string; title: string; retest?: RetestReason | null; risk?: string | null; cost?: string | null } | null;
  /** False while another Trial runs, the bench is busy, or App's shared busy flag is held. */
  canStart: boolean;
  outcome: JourneyOutcome;
  onOutcome: (o: JourneyOutcome) => void;
  /** After a concluded journey: the next change P4-next ranks untested on that game, else one worth
   *  another run (`retest`), null when nothing is left, undefined while that isn't known yet (the
   *  candidates haven't loaded). */
  next?: { id: string; title: string; retest?: RetestReason | null; risk?: string | null; cost?: string | null } | null;
  /** Whether the finished journey left a reusable as-is session (`reusableAsIs`) for that next change:
   *  one session, about 10 min; otherwise a new before-session first, about 20. */
  nextReuses?: boolean;
  refresh: () => Promise<void>;
  /** P8-posture-show: the bench's answer to "How far may Compy go on this PC?", kept on the record of
   *  every Trial the journey starts. Absent: the start doesn't say, and the record reads not recorded. */
  riskChoice?: JourneyRiskChoice;
  /** Called when the owner closes a finished journey, with the Trial it concluded (if any). */
  onFinished?: (exp: JourneyExperiment | null) => void;
  /** P5-resume: this game's progress, derived from the experiments store (journey-resume.ts). */
  progress?: JourneyProgress | null;
  /** Whether `progress.asIs` is still reusable (`reusableAsIs`): continuing is one session. */
  resumeReuses?: boolean;
  /** The kept changes on that game whose live check reads on (`stillOnFor`). */
  stillOn?: string[];
  /** P5-realplay: where real play stands on that game (get_realplay_progress), while no Trial runs.
   *  null when it couldn't be read: then real play isn't offered, because Compy can't count. */
  realPlay?: RealPlayProgress | null;
  /** P8-posture-note: how many changes on the journey's game (the finished journey's, else `game`)
   *  the chosen risk holds back and were never tested there (the summary's `outsideRisk`). Above 0,
   *  "nothing left" says nothing is left within the risk chosen: the risk choice is never hidden
   *  behind "nothing left". The count itself is the summary's to say, just below. */
  heldByRisk?: number;
}) {
  const { t } = useTranslation();
  // "Stop here" / "Pick up" write only localStorage; this repaints the panel after either.
  const [, repaint] = useState(0);
  const p = useJourneyPhase();
  const recorded = useJourneyProgress();
  const note = useRealPlayNote();
  const k = "lab.experimentBench.journey";
  const gameName = (g: string | null) => (g ? prettyGameName(g) || g : null);
  // P5-realplay: one real-play tap for `c`, from the props this panel was given. `ackd`: the owner
  // tapped the line naming the change's cost (or none was asked).
  const realPlayRun = (c: { id: string; title: string }, ackd: boolean, rp: RealPlayProgress) => {
    if (!canStart) return;
    const hypothesis = t("lab.experimentBench.hypothesisWithBaseline", { metric: t("lab.experimentBench.hypothesisMetricFallback") });
    void runRealPlay(
      {
        change: c,
        outcome,
        riskChoice,
        costAcknowledged: ackd,
        hypothesis,
        refresh,
        captureFailed: t(`${k}.captureFailed`),
        noProgress: t("lab.experimentBench.journey.realPlay.noProgress"),
      },
      rp.game,
      rp,
    );
  };

  // P5-resume: a journey already under way on this game (something tested or tried there).
  const resuming = progress != null && progress.tested + progress.inconclusive + progress.stale + progress.unverified > 0 && progress.unfinished == null;
  const stopLine = (pr: JourneyProgress) =>
    `${t(`${k}.stoppedHere`, { tested: pr.tested, total: pr.total })} ${
      stillOn.length > 0 ? t(`${k}.stillOn`, { changes: stillOn.join(", ") }) : t(`${k}.noneOn`)
    }`;

  if (p.kind === "idle") {
    if (resuming && journeyStopped(progress)) {
      return (
        <div className="exp-order exp-journey" data-testid="journey" data-phase="stopped-here">
          <p className="exp-note" data-testid="journey-progress">
            {stopLine(progress)}
          </p>
          {change && (
            <button
              type="button"
              className="exp-cta-ghost"
              onClick={() => {
                pickUpJourney(progress.game);
                repaint((n) => n + 1);
              }}
            >
              {t(`${k}.pickUp`)}
            </button>
          )}
        </div>
      );
    }
    if (!change) {
      if (!resuming) return null;
      return (
        <div className="exp-order exp-journey" data-testid="journey">
          <p className="exp-note" data-testid="journey-progress">
            {[
              t(heldByRisk > 0 ? `${k}.progressDoneWithinRisk` : `${k}.progressDone`, { tested: progress.tested, total: progress.total }),
              ...progressNotes(progress, t),
            ].join(" ")}
          </p>
        </div>
      );
    }
    const name = gameName(game);
    // Continuing reuses the newest judged Trial's as-is session when it is still reusable.
    const reuseId = resuming && resumeReuses ? progress.asIs : null;
    // P8-ack: a change that isn't low risk starts only from the tap on the line naming its cost.
    const ack = needsCostAck(change.risk);
    const start = () => {
      // P6-restore-f1: refuse here too, not only on the disabled button.
      if (!canStart) return;
      const hypothesis = t("lab.experimentBench.hypothesisWithBaseline", { metric: t("lab.experimentBench.hypothesisMetricFallback") });
      void runJourney(
        { change, outcome, riskChoice, costAcknowledged: ack, hypothesis, refresh, captureFailed: t(`${k}.captureFailed`) },
        game,
        reuseId,
      );
    };
    // P5-realplay: the one plain choice beside the two-session plan, while Compy can count this game's
    // sessions: the change goes on at once when enough as-is sessions count, else Compy collects them.
    const rpHere = realPlay != null && game != null && realPlay.game === game ? realPlay : null;
    const offer = rpHere ? realPlayOffer(rpHere, change.title, name ?? rpHere.game, t) : null;
    // Review 2026-11-02: buttons that sit side by side share one row, so none touches another. "Stop
    // here" joins the idle journey's last row: beside the offer's button, else beside the start.
    const stopHere = resuming ? (
      <button
        type="button"
        className="exp-cta-ghost"
        onClick={() => {
          stopJourneyHere(progress.game);
          repaint((n) => n + 1);
        }}
      >
        {t(`${k}.stopHere`)}
      </button>
    ) : null;
    return (
      <div className="exp-order exp-journey" data-testid="journey">
        {resuming && (
          <p className="exp-note" data-testid="journey-progress">
            {progressLine(progress, change, t)}
          </p>
        )}
        <p className="exp-note" data-testid="journey-plan">
          {reuseId
            ? t(`${k}.planResume`, { game: name ?? t("lab.experimentBench.yourGame"), change: change.title })
            : name
              ? t(`${k}.planGame`, { game: name, change: change.title })
              : t(`${k}.plan`, { change: change.title })}
        </p>
        {change.retest && (
          <p className="exp-fineprint" data-testid="journey-retest-why">
            {t(`${k}.retestWhy.${change.retest}`, { change: change.title })}
          </p>
        )}
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
        {ack && (
          <p className="exp-note exp-journey-cost" data-testid="journey-cost-ack">
            {costAckLine(change.title, change.cost, t)}
          </p>
        )}
        <div className="exp-running-actions">
          <button type="button" className="exp-cta" disabled={!canStart} onClick={start}>
            {ack ? t("lab.experimentBench.costAck.button") : t(`${k}.button`)}
          </button>
          {!(offer && rpHere) && stopHere}
        </div>
        {offer && rpHere && (
          <>
            <p className="exp-fineprint" data-testid="journey-realplay-plan">
              {offer}
            </p>
            <div className="exp-running-actions">
              <button type="button" className="exp-cta-ghost" disabled={!canStart} onClick={() => realPlayRun(change, ack, rpHere)}>
                {t(ack ? "lab.experimentBench.journey.realPlay.startAck" : "lab.experimentBench.journey.realPlay.start")}
              </button>
              {stopHere}
            </div>
          </>
        )}
        <p className="exp-fineprint">{t(`${k}.oneChange`)}</p>
      </div>
    );
  }

  const playing = p.kind === "as-is" || p.kind === "with-change" || p.kind === "rp-playing";
  // P5-realplay: a real-play session only counts down to the readings it needs; no halves are graded.
  const mode: JourneyMode = p.kind === "rp-playing" ? "real-play" : "pair";
  const live = playing ? recorded : null;
  const unsettled = live != null && enoughState(live, mode).kind === "unsettled";
  const finished = !playing && p.kind !== "reading" && p.kind !== "judging" && p.kind !== "uneven" && p.kind !== "rp-working";
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
      line = p.behind
        ? t(`${k}.noReadingBehind`)
        : p.samples == null
          ? t(`${k}.noReading`)
          : t(`${k}.tooShort`, { count: p.samples, min: MIN_BASELINE_SAMPLES });
      break;
    case "wrong-game":
      line = t(`${k}.wrongGame`, { played: gameName(p.played), planned: gameName(p.planned) });
      break;
    case "not-started":
      line = t(`${k}.notStarted`, { reason: p.reason });
      break;
    case "restored":
      line =
        p.why === "asked"
          ? t("lab.experimentBench.journey.realPlay.putBackDone", { change: p.change })
          : p.why === "no-reading"
          ? t(`${k}.restoredNoReading`, { change: p.change })
          : p.why === "behind"
            ? t(`${k}.restoredBehind`, { change: p.change })
            : t(`${k}.restoredError`, { change: p.change, reason: p.reason });
      break;
    case "restore-failed":
      line = t(`${k}.restoreFailed`, { change: p.change, reason: p.reason });
      break;
    case "rp-playing":
      line = p.on
        ? t("lab.experimentBench.journey.realPlay.playingOn", { change: p.change, game: gameName(p.game) })
        : t("lab.experimentBench.journey.realPlay.playingAsIs", { game: gameName(p.game) });
      break;
    case "rp-before":
      line = collectingBeforeLine(p.progress, gameName(p.game) ?? p.game, t);
      break;
    case "rp-working":
      line =
        p.what === "judging"
          ? t("lab.experimentBench.journey.realPlay.judging")
          : t("lab.experimentBench.journey.realPlay.puttingBack", { change: p.change });
      break;
    case "rp-failed":
      line = t("lab.experimentBench.journey.realPlay.failed", { change: p.change, reason: p.reason });
      break;
  }
  const lineEl = (
    <p className="exp-note" data-testid="journey-line" role={finished ? "status" : undefined}>
      {line}
    </p>
  );
  return (
    <div className="exp-order exp-journey" data-testid="journey" data-phase={p.kind}>
      {p.kind === "result" ? (
        // P7-depth-verdicts: the result at three depths; the line itself is unchanged.
        <Depth testId="journey-depth" answer={lineEl} explanation={<p className="exp-fineprint journey-why">{resultWhy(p.exp, t)}</p>} receipt={<ResultReceipt exp={p.exp} />} />
      ) : (
        lineEl
      )}
      {live && (
        // P5-enough: quiet, in place; nothing here moves focus or brings a window forward.
        <p className="exp-fineprint" data-testid="journey-enough" aria-live="polite">
          {enoughLine(live, t, "panel", mode)}
        </p>
      )}
      {playing && (
        // P5-enough-f1: past the settle cap the line offers to stop, and this is that stop: the same
        // "Done playing" path, so the saved session is graded by the journey's usual steps.
        <button type="button" className={unsettled ? "exp-cta" : "exp-cta-ghost"} onClick={() => finishPlaying?.()}>
          {t(unsettled ? `${k}.stopNow` : `${k}.donePlaying`)}
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
      {p.kind === "rp-before" && note && note.expId === null && (
        <p className="exp-fineprint" data-testid="realplay-note">
          {noteText(note, t)}
        </p>
      )}
      {p.kind === "result" &&
        next &&
        !isRealPlay(p.exp) &&
        (() => {
          // P8-ack: the next change, when it isn't low risk, starts only from the tap on its cost line;
          // the plan it would have said on the button is said above it instead.
          const ack = needsCostAck(next.risk);
          const plan = t(nextReuses ? `${k}.next` : `${k}.nextFresh`, { change: next.title });
          const startNext = () => {
            if (!canStart) return;
            const hypothesis = t("lab.experimentBench.hypothesisWithBaseline", { metric: t("lab.experimentBench.hypothesisMetricFallback") });
            void runJourney(
              { change: next, outcome, riskChoice, costAcknowledged: ack, hypothesis, refresh, captureFailed: t(`${k}.captureFailed`) },
              p.exp.game,
              p.asIs,
            );
          };
          return (
            <>
              {ack && (
                <>
                  <p className="exp-note" data-testid="journey-next-plan">
                    {plan}
                  </p>
                  <p className="exp-note exp-journey-cost" data-testid="journey-cost-ack">
                    {costAckLine(next.title, next.cost, t)}
                  </p>
                </>
              )}
              <div className="exp-running-actions">
                <button type="button" className="exp-cta" disabled={!canStart} onClick={startNext}>
                  {ack ? t("lab.experimentBench.costAck.button") : plan}
                </button>
              </div>
            </>
          );
        })()}
      {p.kind === "result" && next?.retest && !isRealPlay(p.exp) && (
        <p className="exp-fineprint" data-testid="journey-retest-why">
          {t(`${k}.retestWhy.${next.retest}`, { change: next.title })}
        </p>
      )}
      {p.kind === "result" && next === null && (
        <p className="exp-note" data-testid="journey-done">
          {[
            t(heldByRisk > 0 ? `${k}.nothingLeftWithinRisk` : `${k}.nothingLeft`),
            ...(progress?.game === p.exp.game ? progressNotes(progress, t) : []),
          ].join(" ")}
        </p>
      )}
      {finished && (
        // Review 2026-11-02: the buttons that end a phase share one row ("Measure my next session"
        // touched "OK", "Stop here" touched it too), 9px under the block above.
        <div className="exp-running-actions">
          {p.kind === "rp-before" && (
            <button type="button" className="exp-cta" disabled={!canStart} onClick={() => realPlayRun(p.change, p.costAcknowledged, p.progress)}>
              {t("lab.experimentBench.journey.realPlay.measureNext")}
            </button>
          )}
          {p.kind === "wrong-game" && (
            <button type="button" className="exp-cta-ghost" onClick={() => setPhase({ kind: "idle" })}>
              {t(`${k}.planFor`, { game: gameName(p.played) })}
            </button>
          )}
          {p.kind === "result" && next && !isRealPlay(p.exp) && (
            // P5-resume: the owner ends the journey here; nothing is undone (ENGINE §7).
            <button
              type="button"
              className="exp-cta-ghost"
              onClick={() => {
                stopJourneyHere(p.exp.game);
                setPhase({ kind: "idle" });
              }}
            >
              {t(`${k}.stopHere`)}
            </button>
          )}
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
        </div>
      )}
    </div>
  );
}

/** P5-resume: "{tested} of {total} tested · Next: X", or "· Retest: X" for a change worth another
 *  run, plus how many attempts judged nothing. Only a measured result counts as tested. */
function progressLine(
  progress: JourneyProgress,
  change: { title: string; retest?: RetestReason | null },
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const k = "lab.experimentBench.journey";
  const line = t(change.retest ? `${k}.progressRetest` : `${k}.progress`, { tested: progress.tested, total: progress.total, change: change.title });
  const notes = progressNotes(progress, t);
  // "… · Next: X" has no full stop, so a note after it ran on ("Next: X 2 tries couldn't be judged.",
  // review 2026-11-02, round 2): the line's own separator comes before the notes.
  return notes.length > 0 ? `${line} · ${notes.join(" ")}` : line;
}

/** What the count line owes besides the count: attempts that judged nothing, results from an older
 *  driver or Windows build, and kept results among those (put back to test again). */
function progressNotes(progress: JourneyProgress, t: (key: string, opts?: Record<string, unknown>) => string): string[] {
  const k = "lab.experimentBench.journey";
  return [
    ...(progress.inconclusive > 0 ? [t(`${k}.progressUnjudged`, { count: progress.inconclusive })] : []),
    ...(progress.stale > 0 ? [t(`${k}.progressStale`, { count: progress.stale })] : []),
    ...(progress.unverified > 0 ? [t(`${k}.progressUnverified`, { count: progress.unverified })] : []),
    ...(progress.staleKept > 0 ? [t(`${k}.progressStaleKept`, { count: progress.staleKept })] : []),
  ];
}

/** P5-realplay: the one line about the session just measured. */
function noteText(note: RealPlayNote, t: Translate): string {
  if (note.kind === "counted") return t("lab.experimentBench.journey.realPlay.noteCounted");
  if (note.kind === "none") return t("lab.experimentBench.journey.realPlay.noteNone", { game: prettyGameName(note.game) || note.game });
  return t("lab.experimentBench.journey.realPlay.noteNotCounted", { why: notCountedWhy(note.reason, note.minReadings, t) });
}

/** P5-realplay: a running real-play Trial, derived from its record and its progress read (never from
 *  this module's state, so it reads the same after a restart). It says the change is on and since
 *  when, how long it may stay on (once the test stopped, only what the stop says about the change),
 *  how to put it back (with "Restore now", the existing restore_experiment; not once a stop says
 *  the change is already off), where the count stands ("Keep playing, Compy is still collecting (N of M
 *  sessions)"), and every session that didn't count, with why. Never an "interrupted" banner: the
 *  change staying on across restarts is the test. Its main button measures the next session, sees a
 *  result a look has decided, or closes a test that can't go on, each through the journey's audited
 *  calls. `progress`: this Trial's progress read; `unread`: why that read failed ("" = no answer);
 *  both null while the first read hasn't answered. */
export function RealPlayPanel({
  exp,
  progress,
  unread = null,
  canAct,
  refresh,
}: {
  exp: RealPlayRecord & { rec_id: string };
  progress: RealPlayProgress | null;
  unread?: string | null;
  /** False while the bench is busy or App's shared busy flag is held. */
  canAct: boolean;
  refresh: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const note = useRealPlayNote();
  const view = realPlayView(exp, progress, t, i18n.language, unread);
  const measure = () => {
    if (!canAct || !progress || view.action !== "measure" || current || acting) return;
    void runRealPlay(
      {
        change: { id: exp.rec_id, title: exp.rec_title },
        outcome: exp.outcome === "max-fps" ? "max-fps" : "recommended",
        hypothesis: "",
        refresh,
        captureFailed: t("lab.experimentBench.journey.captureFailed"),
        noProgress: t("lab.experimentBench.journey.realPlay.noProgress"),
      },
      exp.game,
      progress,
    );
  };
  const conclude = () => {
    if (canAct) void closeRealPlay(exp.id, exp.rec_title, refresh);
  };
  return (
    // Review 2026-11-02: the panel's blocks sat flush (0px). It wears the pair running panel's frame and
    // 9px rhythm (.exp-running, the same slot RunningPanel fills), every block a child of that frame.
    <div
      className="exp-order exp-journey exp-running"
      data-testid="journey"
      data-phase="realplay"
      data-realplay-phase={progress?.phase ?? "unread"}
    >
      <p className="exp-note" data-testid="realplay-on">
        {view.changeOn}
      </p>
      {note && note.expId === exp.id && (
        <p className="exp-fineprint" data-testid="realplay-note">
          {noteText(note, t)}
        </p>
      )}
      {view.status && (
        <p className="exp-note" data-testid="realplay-status" role="status">
          {view.status}
        </p>
      )}
      {view.action == null && unread && (
        // The backend's own words for why the count can't be read, as the bench shows every refusal.
        <p className="exp-fineprint" data-testid="realplay-unread">
          {unread}
        </p>
      )}
      {view.notYet && (
        <p className="exp-fineprint" data-testid="realplay-not-yet">
          {view.notYet}
        </p>
      )}
      {view.closeHow && (
        <p className="exp-fineprint" data-testid="realplay-close-how">
          {view.closeHow}
        </p>
      )}
      {view.seeHow && (
        // Review 2026-11-02: what "See the result" does, said before the tap.
        <p className="exp-fineprint" data-testid="realplay-see-how">
          {view.seeHow}
        </p>
      )}
      {(view.action != null || view.putBackHow != null) && (
        <div className="exp-running-actions">
          {view.action === "measure" && (
            <button type="button" className="exp-cta" disabled={!canAct} onClick={measure}>
              {t("lab.experimentBench.journey.realPlay.measureNext")}
            </button>
          )}
          {view.action === "see-result" && (
            <button type="button" className="exp-cta" disabled={!canAct} onClick={conclude}>
              {t("lab.experimentBench.journey.realPlay.seeResult")}
            </button>
          )}
          {view.action === "close" && (
            <button type="button" className="exp-cta" disabled={!canAct} onClick={conclude}>
              {t("lab.experimentBench.journey.realPlay.closeTest")}
            </button>
          )}
          {/* Review 2026-11-02: once a stop says the change is already off, there is nothing on to put
              back, so neither the button nor its line shows; everywhere else the way back does. */}
          {view.putBackHow != null && (
            <button
              type="button"
              className="exp-cta-ghost"
              disabled={!canAct}
              onClick={() => {
                if (canAct) void putBackRealPlay(exp.id, exp.rec_title, refresh);
              }}
            >
              {/* Review 2026-11-02: the same undo as the pair panel's, so the same label. */}
              {t("lab.experimentBench.restoreNow")}
            </button>
          )}
        </div>
      )}
      {view.putBackHow != null && (
        <p className="exp-fineprint" data-testid="realplay-put-back-how">
          {view.putBackHow}
        </p>
      )}
      {view.notCounted.length > 0 && (
        <div data-testid="realplay-not-counted">
          <p className="exp-fineprint">{t("lab.experimentBench.journey.realPlay.notCounted")}</p>
          <ul className="exp-why-list">
            {view.notCounted.map((line, i) => (
              <li key={i} className="exp-fineprint">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** P5-resume: the progress line while a Trial of the game is still Running, so it says what the
 *  bench's running panel (and, after a restart, its interrupted banner) says: that change is on and
 *  unfinished, never "Next". A stopped real-play test says it stopped, never "Testing now" above a
 *  panel saying the change is no longer on or the test can't go on (review 2026-11-02, round 2). */
export function JourneyProgressLine({
  progress,
  interrupted,
  stopped = false,
}: {
  progress: JourneyProgress | null;
  interrupted: boolean;
  stopped?: boolean;
}) {
  const { t } = useTranslation();
  if (!progress?.unfinished || progress.total === 0) return null;
  const k = "lab.experimentBench.journey";
  return (
    // .exp-journey-progress: 9px above the running panel's frame that follows it (ExperimentBench.css).
    <p className="exp-note exp-journey-progress" data-testid="journey-progress">
      {t(interrupted ? `${k}.progressInterrupted` : stopped ? `${k}.progressStopped` : `${k}.progressTesting`, {
        tested: progress.tested,
        total: progress.total,
        change: progress.unfinished.title,
      })}
    </p>
  );
}
