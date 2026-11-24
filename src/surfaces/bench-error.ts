import type { TFunction } from "i18next";
import { backendMessages } from "../data/backend-error";

// B11 (the owner's "no String(e) in the face" law): benchmark_trial.rs writes its rollback / change-history outcomes
// as fixed sentences (BENCH_* consts) followed by the backend's raw text in "( )", and "Couldn't apply the change: {e}"
// / "Couldn't apply the stack: {e}" with the raw text after the colon. The card shows every mapped sentence the error
// carries (in the user's language); an apply failure with none falls back to its own line, never the raw text.
// D7: every other fixed error benchmark_trial.rs writes is now a mapped const too (BENCH_*_NO_FRAMES,
// BENCH_STACK_NOTHING_*), so anything still unmapped is not one of them: it gets one fixed line, never its English.
export const TRIAL_APPLY_PREFIX = "Couldn't apply the change: ";
export const STACK_APPLY_PREFIX = "Couldn't apply the stack: ";

export function trialErrorText(error: string, t: TFunction): string {
  const known = backendMessages(error, t);
  if (known) return known;
  if (error.startsWith(TRIAL_APPLY_PREFIX)) return t("gaming.benchmark.errors.trialApplyFailed");
  if (error.startsWith(STACK_APPLY_PREFIX)) return t("gaming.benchmark.errors.stackApplyFailed");
  return t("gaming.benchmark.errors.trialUnmapped");
}

// D7: the live trial's progress line. While it runs, benchmark_trial.rs sets `status` to one of the fixed phase
// literals in the switch below, or to "{label}: window {got}/{n}" (collect_game_windows) with `label` one of
// WINDOW_LABELS. The card already prints `collected/target` beside it, so a window status maps to its phase alone (no
// number is parsed out of the English). Anything else ("No frames." while the guard rolls back, a status a later build
// adds) is the fixed "Working…" line, never the raw English. D7 r1 F3: every key is a literal inside its own t() (no
// key from a table); bench-status-words.test.ts holds the status list that pins each literal to the Rust source.

/** The labels benchmark_trial.rs passes to collect_windows / collect_game_windows ("{label}: window {got}/{n}"). */
export const WINDOW_LABELS = ["Calibrating", "Baseline", "Settling", "Treatment"] as const;

/** "Rolling back the {applied_n}-tweak stack…": the one phase with a number inside; matched by its two ends. */
export const STACK_ROLLBACK_HEAD = "Rolling back the ";
export const STACK_ROLLBACK_TAIL = "-tweak stack…";

// D8: a Trial verdict's metric (Verdict::Keep / Revert `metric`, also stored in each scoreboard award) is the `name`
// benchmark_verdict.rs passes to eval_metric: "1% low" or "0.1% low", the only two since that file was written (git
// history read 2026-11-24). Each is said through its own literal t(); anything else (a later build's name, an edited
// file) is the fixed "the measured value" line, never the raw English. bench-metric-words.test.ts pins the two names to the
// Rust.
export function verdictMetricText(metric: string, t: TFunction): string {
  switch (metric) {
    case "1% low":
      return t("gaming.benchmark.verdictMetric.onePercentLow");
    case "0.1% low":
      return t("gaming.benchmark.verdictMetric.pointOnePercentLow");
  }
  return t("gaming.benchmark.verdictMetric.unknown");
}

export function trialStatusText(status: string, kind: string, t: TFunction): string {
  switch (status) {
    case "Starting…":
      return t("gaming.benchmark.trialStatus.starting");
    case "Measuring baseline (change off)…":
      return t("gaming.benchmark.trialStatus.baselineChangeOff");
    case "Measuring baseline (stack off)…":
      return t("gaming.benchmark.trialStatus.baselineStackOff");
    case "Applying the change…":
      return t("gaming.benchmark.trialStatus.applyingChange");
    case "Applying the starter stack…":
      return t("gaming.benchmark.trialStatus.applyingStack");
    case "Letting it settle…":
      return t("gaming.benchmark.trialStatus.settling");
    case "Measuring with the change…":
      return t("gaming.benchmark.trialStatus.measuringChangeOn");
    case "Measuring with the stack on…":
      return t("gaming.benchmark.trialStatus.measuringStackOn");
    case "Rolling the change back…":
      return t("gaming.benchmark.trialStatus.rollingBackChange");
  }
  if (status.startsWith(STACK_ROLLBACK_HEAD) && status.endsWith(STACK_ROLLBACK_TAIL))
    return t("gaming.benchmark.trialStatus.rollingBackStack");
  const stack = kind === "stack";
  if (status.startsWith("Calibrating: window ")) return t("gaming.benchmark.trialStatus.calibrating");
  if (status.startsWith("Baseline: window "))
    return stack ? t("gaming.benchmark.trialStatus.baselineStackOff") : t("gaming.benchmark.trialStatus.baselineChangeOff");
  if (status.startsWith("Settling: window ")) return t("gaming.benchmark.trialStatus.settling");
  if (status.startsWith("Treatment: window "))
    return stack ? t("gaming.benchmark.trialStatus.measuringStackOn") : t("gaming.benchmark.trialStatus.measuringChangeOn");
  return t("gaming.benchmark.trialStatus.working");
}
