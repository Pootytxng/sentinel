import type { ArmedComparison, SessionSummary } from "../types";
import { MIN_BASELINE_SAMPLES } from "./baseline-grade";
import { allBackground } from "../lib/session-metrics";

// CR-cmp-wait: comparison.rs `on_session_finalized_at` leaves an armed comparison waiting, with no
// line saying why, when a same-game session is under MIN_TREATMENT_SAMPLES or has no frame reading.
// This names that case for the debrief. Mirrors the Rust checks; a session that started before the
// comparison was armed is its baseline, not its test, so it says nothing. An all-background session
// already has its own line.
export type ComparisonWait =
  | { reason: "short"; readings: number; min: number }
  | { reason: "no-reading" };

const reading = (n: number) => Number.isFinite(n) && n > 0;

export function comparisonWait(
  s: SessionSummary,
  armed: ArmedComparison | null | undefined,
): ComparisonWait | null {
  if (!armed) return null;
  if (armed.game.toLowerCase() !== s.process_name.toLowerCase()) return null;
  const started = Date.parse(s.started_at);
  const armedAt = Date.parse(armed.armed_at);
  if (!Number.isFinite(started) || !Number.isFinite(armedAt) || started < armedAt) return null;
  if (allBackground(s)) return null;
  if (s.samples < MIN_BASELINE_SAMPLES) {
    return { reason: "short", readings: s.samples, min: MIN_BASELINE_SAMPLES };
  }
  if (!reading(s.avg_fps) || !reading(s.low1_fps_est)) return { reason: "no-reading" };
  return null;
}
