import type { TFunction } from "i18next";
import { backendMessages } from "../data/backend-error";

// B11 (the owner's "no String(e) in the face" law): benchmark_trial.rs writes its rollback / change-history outcomes
// as fixed sentences (BENCH_* consts) followed by the backend's raw text in "( )", and "Couldn't apply the change: {e}"
// / "Couldn't apply the stack: {e}" with the raw text after the colon. The card shows every mapped sentence the error
// carries (in the user's language); an apply failure with none falls back to its own line, never the raw text. Any
// other trial error is one of benchmark_trial.rs's own fixed sentences and is shown as it is.
export const TRIAL_APPLY_PREFIX = "Couldn't apply the change: ";
export const STACK_APPLY_PREFIX = "Couldn't apply the stack: ";

export function trialErrorText(error: string, t: TFunction): string {
  const known = backendMessages(error, t);
  if (known) return known;
  if (error.startsWith(TRIAL_APPLY_PREFIX)) return t("gaming.benchmark.errors.trialApplyFailed");
  if (error.startsWith(STACK_APPLY_PREFIX)) return t("gaming.benchmark.errors.stackApplyFailed");
  return error;
}
