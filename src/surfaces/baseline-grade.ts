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
/** comparison.rs DEFAULT_NOISE_FLOOR_PCT: halves differing by more than this are uneven. */
export const BASELINE_HALVES_FLOOR_PCT = 3;

export type BaselineGrade =
  | { kind: "steady" }
  | { kind: "too-short"; samples: number }
  | { kind: "uneven"; first: number; second: number }
  | { kind: "untraced" };

const round1 = (x: number) => Math.round(x * 10) / 10;

export function gradeBaseline(s: SessionSummary): BaselineGrade {
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
