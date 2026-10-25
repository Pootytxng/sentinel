// P5-enough (ROADMAP P5 step 4; Constitution §10): while the guided journey records a session, one
// quiet line says when Compy has enough: "Play the same area for about N s more" until the session
// has MIN_BASELINE_SAMPLES readings that count, then "Compy has enough; you can stop" once its halves
// are also steady. Steady is the one shared rule (baseline-grade.ts `gradeBaseline`, pinned to
// experiment.rs `grade_baseline`), applied to what the capture has measured so far
// (get_fps_status `progress`: background readings are never counted, sessions.rs `progress`).
//
// Where it shows: the journey panel in Compy's window, and Compy's own in-game overlay when the owner
// has it on (click-through, `focus:false`, `focusable:false`: it can never take focus, so it can't
// turn real play into background time). Nothing here shows, raises or focuses a window; the overlay
// learns that a journey is recording from one localStorage key (the overlay's existing cross-window
// `storage` channel) and reads the progress from its own get_fps_status poll.
import type { SessionSummary } from "../types";
import { gradeBaseline, MIN_BASELINE_SAMPLES } from "./baseline-grade";

/** get_fps_status `progress` (sessions.rs `CaptureProgress`). */
export type CaptureProgress = Pick<SessionSummary, "samples"> & { fps_series: [number, number][] };

export type Enough =
  | { kind: "more"; secs: number }
  /** Enough readings, but the halves aren't steady yet by the shared rule. */
  | { kind: "settling" }
  | { kind: "enough" };

export function enoughState(p: CaptureProgress): Enough {
  const g = gradeBaseline(p);
  if (g.kind === "too-short") return { kind: "more", secs: Math.max(1, MIN_BASELINE_SAMPLES - g.samples) };
  return g.kind === "steady" ? { kind: "enough" } : { kind: "settling" };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The one line, in plain words. About: whole minutes from 2 min up, else rounded up to 10 s. */
export function enoughLine(p: CaptureProgress, t: Translate): string {
  const e = enoughState(p);
  if (e.kind === "enough") return t("lab.experimentBench.journey.enough");
  if (e.kind === "settling") return t("lab.experimentBench.journey.enoughSettling");
  if (e.secs >= 120) return t("lab.experimentBench.journey.enoughMoreMin", { min: Math.ceil(e.secs / 60) });
  return t("lab.experimentBench.journey.enoughMore", { secs: Math.ceil(e.secs / 10) * 10 });
}

/** The cross-window flag: set while a journey session is recording, read by the overlay. */
export const JOURNEY_RECORDING_KEY = "compy.journey.recording";
export function setJourneyRecording(on: boolean) {
  try {
    if (on) localStorage.setItem(JOURNEY_RECORDING_KEY, "1");
    else localStorage.removeItem(JOURNEY_RECORDING_KEY);
  } catch {
    /* storage unavailable: the overlay shows no line; the journey panel still does */
  }
}
export function journeyRecording(): boolean {
  try {
    return localStorage.getItem(JOURNEY_RECORDING_KEY) === "1";
  } catch {
    return false;
  }
}

/** A usable progress payload, or null (older build, nothing measured yet). */
export function asProgress(x: unknown): CaptureProgress | null {
  const p = x as CaptureProgress | null | undefined;
  return p && Number.isFinite(p.samples) && Array.isArray(p.fps_series) ? p : null;
}
