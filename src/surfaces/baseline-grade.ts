// Trial Protocol §2 — the backend's baseline grade (experiment.rs `grade_baseline`), mirrored once
// here so the bench and the guided journey grade a session the same way, and pinned to the Rust by
// baseline-grade.test.ts so the two can't drift. The bench uses it to say why a too-short baseline
// can't be used and to warn before starting on an uneven or untraced one (owner decision 2026-10-24:
// warn, don't block); the guided journey uses it to ask for one more as-is session instead
// (P5-rebaseline). The halves floor is the fixed 3% default (experiment.rs `halves_floor_pct`,
// comparison.rs DEFAULT_NOISE_FLOOR_PCT), not the verdict band, which P4-noise measures per game; the
// halves split the 10 s fps buckets by count, and a session without its trace is unknown, never steady.
import type { SessionSummary } from "../types";

/** experiment.rs MIN_BASELINE_SAMPLES (= MIN_TREATMENT_SAMPLES): about 10 minutes of play. */
export const MIN_BASELINE_SAMPLES = 600;
/** experiment.rs MIN_TREATMENT_SAMPLES: fewer measured readings than this and a Trial's after-session
 *  concludes "insufficient evidence". Pinned to the Rust value by baseline-grade.test.ts. */
export const MIN_TREATMENT_SAMPLES = MIN_BASELINE_SAMPLES;

/** Order candidate after-sessions best first: a row with at least MIN_TREATMENT_SAMPLES readings before
 *  any shorter one, newest first within each group. A game that crashes and is relaunched in one sitting
 *  leaves a full row and a short relaunch fragment; the fragment is newer but must not be the one a
 *  Trial concludes on. When no row reaches the floor the order is plain newest first, as it always was. */
export function fullAfterSessionsFirst<T extends { samples: number; started_at: string }>(rows: T[]): T[] {
  const full = (s: T) => (s.samples >= MIN_TREATMENT_SAMPLES ? 1 : 0);
  return [...rows].sort((a, b) => full(b) - full(a) || Date.parse(b.started_at) - Date.parse(a.started_at));
}
/** comparison.rs DEFAULT_NOISE_FLOOR_PCT: halves differing by more than this are uneven. */
export const BASELINE_HALVES_FLOOR_PCT = 3;

export type BaselineGrade =
  | { kind: "steady" }
  | { kind: "too-short"; samples: number }
  | { kind: "uneven"; first: number; second: number }
  | { kind: "untraced" };

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Reads only the reading count and the fps buckets, so a capture still running (get_fps_status
 *  `progress`, P5-enough) is graded by this same rule. */
export function gradeBaseline(s: Pick<SessionSummary, "samples" | "fps_series">): BaselineGrade {
  if (s.samples < MIN_BASELINE_SAMPLES) return { kind: "too-short", samples: s.samples };
  const fps = (s.fps_series ?? []).map(([, f]) => f).filter((f) => Number.isFinite(f) && f > 0);
  const half = Math.floor(fps.length / 2);
  if (half < 2) return { kind: "untraced" };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const first = mean(fps.slice(0, half));
  const second = mean(fps.slice(half));
  if ((Math.abs(second - first) / first) * 100 > BASELINE_HALVES_FLOOR_PCT)
    // The same 1-decimal halves the backend stores (experiment.rs `round1`), so the start warning and
    // the receipt round the same numbers and can't read 259 on one screen and 260 on the other.
    return { kind: "uneven", first: round1(first), second: round1(second) };
  return { kind: "steady" };
}
