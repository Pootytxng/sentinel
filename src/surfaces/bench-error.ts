import type { TFunction } from "i18next";
import { backendMessage } from "../data/backend-error";

// B11 (the owner's "no String(e) in the face" law): benchmark_trial.rs writes "Couldn't apply the change: {e}" and
// "Couldn't apply the stack: {e}" into the trial's error, with the backend's raw text after the colon. The card shows
// the mapped sentence when backend-error.ts knows it (in the user's language), otherwise its own line, never that
// text. Any other trial error is one of benchmark_trial.rs's own sentences and is shown as it is.
export const TRIAL_APPLY_PREFIX = "Couldn't apply the change: ";
export const STACK_APPLY_PREFIX = "Couldn't apply the stack: ";

export function trialErrorText(error: string, t: TFunction): string {
  if (error.startsWith(TRIAL_APPLY_PREFIX)) return backendMessage(error, t) ?? t("gaming.benchmark.errors.trialApplyFailed");
  if (error.startsWith(STACK_APPLY_PREFIX)) return backendMessage(error, t) ?? t("gaming.benchmark.errors.stackApplyFailed");
  return error;
}
