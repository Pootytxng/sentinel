import { BACKEND_SENTENCES } from "../data/backend-error";

// D7 review r1 F2: which aborted Trial rows were refused BEFORE anything was written. experiment.rs
// `mark_failed_apply` stores "start-aborted: {why}: {err}", where every `why` begins "the apply reported an error",
// and `apply_refused_before_write(err)` is true when `err` carries one of APPLY_REFUSALS_BEFORE_WRITE (each refuses
// before any write and says nothing was changed). Only that row may say "nothing was changed"; every other aborted
// row keeps the fixed abortedLine. `saysNothingChanged` (trial-error.ts) is NOT used: it matches more than this list.
// aborted-row.test.ts pins this list equal to the Rust array, name for name.
export const APPLY_REFUSALS_BEFORE_WRITE = [
  "TASK_UNREADABLE_APPLY",
  "TASK_NAME_REFUSED",
  "EEE_UNREADABLE_APPLY",
  "EEE_VALUE_REFUSED_APPLY",
  "TRIAL_HOLDS_SETTING_REFUSAL",
  "TRIAL_START_INTERRUPTED_REFUSAL",
  "PLAN_CLASS_TRIAL_REFUSAL",
  "PLAN_CLASS_BENCH_REFUSAL",
  "PLAN_CLASS_INTERRUPTED_REFUSAL",
  "BENCH_HOLDS_SETTING_REFUSAL",
  "GM_HOLDS_SETTING_REFUSAL",
  "GM_HOLDS_PLAN_REFUSAL",
  "GM_LEFTOVER_HOLDS_PLAN_REFUSAL",
  "GM_LEFTOVER_HOLDS_SETTING_REFUSAL",
  "RESTORE_IN_FLIGHT_REFUSAL",
] as const;

/** The head of every stored reason mark_failed_apply writes. */
export const FAILED_APPLY_HEAD = "start-aborted: the apply reported an error";

/** True only for a stored stop_reason that mark_failed_apply wrote for an apply refused before any write. An older
 *  wording of a refusal (no longer byte-equal to the const) is false: the row then keeps the fixed line. */
export function refusedBeforeWrite(stopReason: string): boolean {
  if (!stopReason.startsWith(FAILED_APPLY_HEAD)) return false;
  return APPLY_REFUSALS_BEFORE_WRITE.some((name) => {
    const s = BACKEND_SENTENCES.find((x) => x.rust === name);
    return s !== undefined && stopReason.includes(s.text);
  });
}
