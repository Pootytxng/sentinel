import type { TFunction } from "i18next";
import { BACKEND_SENTENCES, backendMessages } from "../data/backend-error";

// B11 (the owner's "no String(e) in the face" law): what a Trial write that failed says on screen. Every sentence
// backend-error.ts knows in the error is said in the user's language; an error with none gets a line chosen by the
// backend's prefix, never its raw text. A prefix means nothing on the PC was changed: experiment.rs writes these two
// prefixes only on refusals that return before anything is applied or restored (start_experiment's checks before its
// Pending record, after at most a save that resolves a stale Pending record; conclude's and conclude_realplay's
// checks before anything is judged, the Trial still Running), so their lines can say nothing was changed. One case
// does record: mark_failed_apply writes the not-started prefix in front of an apply refusal that wrote nothing, but
// this start's Pending record WAS saved before the apply and is left Aborted, so the bench list shows an aborted row
// for a start the screen calls not started. Pinned to the Rust in no-raw-error-guard.test.ts.
export const NOT_STARTED_PREFIX = "experiment not started — ";
export const NOT_CONCLUDED_PREFIX = "experiment not concluded — ";

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : err === null || err === undefined ? "" : String(err);

/** The line for an error that carries no mapped sentence: by its prefix, else the bench's own "may have stopped
 *  part-way" line (the UI can't know what ran). */
export function trialFallback(err: unknown, t: TFunction): string {
  const raw = errorText(err);
  if (raw.startsWith(NOT_STARTED_PREFIX)) return t("lab.experimentBench.errors.notStarted");
  if (raw.startsWith(NOT_CONCLUDED_PREFIX)) return t("lab.experimentBench.errors.notConcluded");
  return t("lab.experimentBench.errors.writeFailed");
}

/** A failed Trial write (start, conclude, restore) as the screen says it. */
export function trialWriteText(err: unknown, t: TFunction): string {
  return backendMessages(err, t) ?? trialFallback(err, t);
}

/** GuidedJourney (B11 r1): a reason the journey carries, as the screen may say it. One of the journey's own lines
 *  (`own`: already in the user's language, e.g. its "couldn't start measuring") is said as it is; otherwise every
 *  sentence backend-error.ts knows in it; otherwise null, and the caller says its own line without a reason. The
 *  raw reason itself is never returned. */
export function sayableReason(reason: string, t: TFunction, own: readonly string[]): string | null {
  if (reason && own.includes(reason)) return reason;
  return backendMessages(reason, t);
}

/** B11 r2: true when a mapped sentence in `reason` already says nothing was changed (the apply refusals that
 *  mark_failed_apply passes on after the not-started prefix), so the journey says that sentence alone instead
 *  of saying "nothing was changed" twice. Read from the pinned English const, never from the user's language. */
export function saysNothingChanged(reason: string): boolean {
  return BACKEND_SENTENCES.some((s) => /nothing was changed/i.test(s.text) && reason.includes(s.text));
}
