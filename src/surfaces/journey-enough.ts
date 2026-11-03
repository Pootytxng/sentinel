// P5-enough (ROADMAP P5 step 4; Constitution §10): while the guided journey records a session, one
// quiet line says when Compy has enough: "Play the same area for about N s more" until the session
// has MIN_BASELINE_SAMPLES readings that count, then "Compy has enough; you can stop" once its halves
// are also steady. Steady is the one shared rule (baseline-grade.ts `gradeBaseline`, pinned to
// experiment.rs `grade_baseline`), applied to what the capture has measured so far
// (get_fps_status `progress`: background readings are never counted, sessions.rs `progress`).
//
// P5-enough-f1: the halves of some games never settle (the scene keeps changing), and "hasn't settled
// yet" would then stay up for as long as the owner plays. After SETTLE_CAP_SAMPLES counted readings the
// line says so plainly and offers to stop. Stopping is the journey's own "Done playing": the saved
// session is graded by the same shared rule, so an uneven one lands in the journey's existing uneven
// step (session 1: one more as-is session, then test anyway or stop) or in conclude's own `too-noisy`
// (session 2). Nothing here makes up a verdict.
//
// Where it shows: the journey panel in Compy's window, and Compy's own in-game overlay when the owner
// has it on (click-through, `focus:false`, `focusable:false`: it can never take focus, so it can't
// turn real play into background time). Nothing here shows, raises or focuses a window; the overlay
// learns that a journey is recording from one localStorage key (the overlay's existing cross-window
// `storage` channel) and reads the progress from its own get_fps_status poll.
//
// P5-realplay: a real-play session is judged as a whole against other whole sessions, never by its own
// halves, so in real play the line only counts down to the readings a session needs to count and then
// says it is long enough. No "settling" or "keeps changing" state: an uneven session counts like any
// other. The recording flag carries which kind of session it is, so the overlay says the same.
import type { SessionSummary } from "../types";
import { gradeBaseline, MIN_BASELINE_SAMPLES } from "./baseline-grade";

/** get_fps_status `progress` (sessions.rs `CaptureProgress`). */
export type CaptureProgress = Pick<SessionSummary, "samples"> & { fps_series: [number, number][] };

/** The cap on "hasn't settled yet": twice the minimum, i.e. another MIN_BASELINE_SAMPLES counted
 *  readings (about 10 more minutes of play) past the point the session first had enough. Why this
 *  number: the halves split the session by count, so at twice the minimum each half is on its own as
 *  long as a whole usable session. Two full-length halves that still differ by more than the shared
 *  floor mean the game itself keeps changing; more play mostly adds more of that drift. It is counted
 *  readings, not wall time, so time behind another window never brings the cap closer. */
export const SETTLE_CAP_SAMPLES = 2 * MIN_BASELINE_SAMPLES;

export type Enough =
  | { kind: "more"; secs: number }
  /** Enough readings, but the halves aren't steady yet by the shared rule. */
  | { kind: "settling" }
  /** Past SETTLE_CAP_SAMPLES and still not steady: say so and offer to stop. `untraced`: there is no
   *  trace to check (never called uneven, because nothing was measured swinging). */
  | { kind: "unsettled"; untraced: boolean }
  | { kind: "enough" }
  /** P5-realplay: enough readings for the session to count; its halves are never graded. */
  | { kind: "counts" };

/** Which session the journey records: one of a two-session Trial, or one of real play. */
export type JourneyMode = "pair" | "real-play";

export function enoughState(p: CaptureProgress, mode: JourneyMode = "pair"): Enough {
  const g = gradeBaseline(p);
  if (g.kind === "too-short") return { kind: "more", secs: Math.max(1, MIN_BASELINE_SAMPLES - g.samples) };
  if (mode === "real-play") return { kind: "counts" };
  if (g.kind === "steady") return { kind: "enough" };
  return p.samples >= SETTLE_CAP_SAMPLES ? { kind: "unsettled", untraced: g.kind === "untraced" } : { kind: "settling" };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The one line, in plain words. About: whole minutes from 2 min up, else rounded up to 10 s.
 *  `overlay`: the in-game overlay's shorter wording where the panel's would not fit its 230x150 window
 *  (tools/layout/overlay-enough-layout.test.mjs). `mode` real-play: only the countdown, then "long
 *  enough to count". */
export function enoughLine(p: CaptureProgress, t: Translate, where: "panel" | "overlay" = "panel", mode: JourneyMode = "pair"): string {
  const e = enoughState(p, mode);
  if (e.kind === "counts")
    return t(where === "overlay" ? "lab.experimentBench.journey.realPlay.enoughCountsShort" : "lab.experimentBench.journey.realPlay.enoughCounts");
  if (mode === "real-play" && e.kind === "more") {
    // Time alone never says the session will count, only when it is long enough to (review
    // 2026-11-02); the overlay's shorter form keeps the line inside its window.
    const overlay = where === "overlay";
    if (e.secs >= 120)
      return t(overlay ? "lab.experimentBench.journey.realPlay.enoughMoreMinShort" : "lab.experimentBench.journey.realPlay.enoughMoreMin", {
        min: Math.ceil(e.secs / 60),
      });
    return t(overlay ? "lab.experimentBench.journey.realPlay.enoughMoreShort" : "lab.experimentBench.journey.realPlay.enoughMore", {
      secs: Math.ceil(e.secs / 10) * 10,
    });
  }
  if (e.kind === "enough") return t("lab.experimentBench.journey.enough");
  if (e.kind === "unsettled") {
    const short = where === "overlay";
    if (e.untraced) return t(short ? "lab.experimentBench.journey.enoughUntracedShort" : "lab.experimentBench.journey.enoughUntraced");
    return t(short ? "lab.experimentBench.journey.enoughUnsettledShort" : "lab.experimentBench.journey.enoughUnsettled");
  }
  if (e.kind === "settling")
    return t(where === "overlay" ? "lab.experimentBench.journey.enoughSettlingShort" : "lab.experimentBench.journey.enoughSettling");
  if (e.secs >= 120) return t("lab.experimentBench.journey.enoughMoreMin", { min: Math.ceil(e.secs / 60) });
  return t("lab.experimentBench.journey.enoughMore", { secs: Math.ceil(e.secs / 10) * 10 });
}

/** The cross-window flag: set while a journey session is recording, read by the overlay. "1" is a
 *  two-session Trial's session (what every build before real play wrote); "real-play" one of real play. */
export const JOURNEY_RECORDING_KEY = "compy.journey.recording";
export function setJourneyRecording(on: boolean | JourneyMode) {
  try {
    if (on === false) localStorage.removeItem(JOURNEY_RECORDING_KEY);
    else localStorage.setItem(JOURNEY_RECORDING_KEY, on === "real-play" ? "real-play" : "1");
  } catch {
    /* storage unavailable: the overlay shows no line; the journey panel still does */
  }
}
/** Which kind of journey session is recording, or null when none is. */
export function journeyRecordingMode(): JourneyMode | null {
  try {
    const v = localStorage.getItem(JOURNEY_RECORDING_KEY);
    return v === "1" ? "pair" : v === "real-play" ? "real-play" : null;
  } catch {
    return null;
  }
}
export function journeyRecording(): boolean {
  return journeyRecordingMode() != null;
}

/** A usable progress payload, or null (older build, nothing measured yet). */
export function asProgress(x: unknown): CaptureProgress | null {
  const p = x as CaptureProgress | null | undefined;
  return p && Number.isFinite(p.samples) && Array.isArray(p.fps_series) ? p : null;
}
