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
// literals below, or to "{label}: window {got}/{n}" (collect_game_windows) with `label` one of WINDOW_LABELS. The card
// already prints `collected/target` beside it, so a window status maps to its phase alone (no number is parsed out of
// the English). Anything else ("No frames." while the guard rolls back, a status a later build adds) is the fixed
// "Working…" line, never the raw English. bench-status-words.test.ts pins every literal here to the Rust source.
export const TRIAL_PHASES: ReadonlyArray<{ status: string; key: string }> = [
  { status: "Starting…", key: "gaming.benchmark.trialStatus.starting" },
  { status: "Measuring baseline (change off)…", key: "gaming.benchmark.trialStatus.baselineChangeOff" },
  { status: "Measuring baseline (stack off)…", key: "gaming.benchmark.trialStatus.baselineStackOff" },
  { status: "Applying the change…", key: "gaming.benchmark.trialStatus.applyingChange" },
  { status: "Applying the starter stack…", key: "gaming.benchmark.trialStatus.applyingStack" },
  { status: "Letting it settle…", key: "gaming.benchmark.trialStatus.settling" },
  { status: "Measuring with the change…", key: "gaming.benchmark.trialStatus.measuringChangeOn" },
  { status: "Measuring with the stack on…", key: "gaming.benchmark.trialStatus.measuringStackOn" },
  { status: "Rolling the change back…", key: "gaming.benchmark.trialStatus.rollingBackChange" },
];

/** The labels benchmark_trial.rs passes to collect_windows / collect_game_windows ("{label}: window {got}/{n}"). */
export const WINDOW_LABELS = ["Calibrating", "Baseline", "Settling", "Treatment"] as const;

/** "Rolling back the {applied_n}-tweak stack…": the one phase with a number inside; matched by its two ends. */
export const STACK_ROLLBACK_HEAD = "Rolling back the ";
export const STACK_ROLLBACK_TAIL = "-tweak stack…";

export function trialStatusText(status: string, kind: string, t: TFunction): string {
  const phase = TRIAL_PHASES.find((p) => p.status === status);
  if (phase) return t(phase.key);
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
