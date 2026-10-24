import { invoke } from "@tauri-apps/api/core";
import { LEDGER_CHANGED_EVENT } from "../types";

/** Every registered command that writes the Trust Ledger (`history.json`) before it returns.
 *
 *  `ledger-write.test.ts` derives the registered commands that reach `save_history` from `src-tauri`
 *  and holds them to this list plus BACKGROUND_LEDGER_WRITERS, so a new Rust ledger writer that
 *  neither list names turns that test red. Which of the two lists a writer belongs in (does its write
 *  land before the command returns?) is read from the Rust by hand; the test does not derive it. */
export const LEDGER_WRITE_COMMANDS = [
  "apply_recommendation",
  "apply_recommendations_batch",
  "rollback_change",
  "set_startup_entry_enabled",
  "disable_known_bloat_task",
  "remove_known_preload_app",
  "suspend_known_service",
  "restore_leftover",
  "start_experiment",
  "conclude_experiment",
  "restore_experiment",
] as const;

export type LedgerWriteCommand = (typeof LEDGER_WRITE_COMMANDS)[number];

/** Commands whose ledger write lands on a background thread after the command has returned, so an
 *  invoke-level helper has nothing to announce when it resolves. Named here so the Rust-derived set
 *  stays complete; they are not routed through `writeLedger`. */
export const BACKGROUND_LEDGER_WRITERS = ["start_tweak_trial", "start_stack_trial"] as const;

/** Runs one ledger-writing command, then tells every ledger reader, then runs the caller's refresh —
 *  the order App's apply and rollback use.
 *
 *  Ledger readers outside App (the Test room's experiment bench, the Machine Model) re-read only on
 *  LEDGER_CHANGED_EVENT or a window refocus, so a write that skips the announcement leaves them
 *  showing the ledger as it was (#599, #619). Every call of a LEDGER_WRITE_COMMANDS command goes
 *  through here except three still in `surfaces/ExperimentBench.tsx` (start, conclude and restore an
 *  experiment), which #621 moves: `ledger-write.test.ts` pins those three by name and fails on any
 *  other. The two BACKGROUND_LEDGER_WRITERS do not come through here, and nothing here announces
 *  them.
 *
 *  A failed command throws before anything is announced: nothing was recorded, so nothing re-reads.
 *  A refresh that fails throws too, but after the write is recorded and announced, so a rejection
 *  alone does not mean nothing changed. A caller that tells the user which it was (Fix's two armed
 *  rows) passes no refresh and runs its own afterwards.
 *  `changed` lets a caller skip the announcement when the command succeeded but wrote nothing (a
 *  batch that applied zero items); the refresh still runs.
 *
 *  It forwards its `command` to `invoke`, so it is the named wrapper for this file in
 *  `machine-model-reader-guard.test.ts`, and `ledger-write.test.ts` holds every caller to a written-out
 *  command name. */
export const writeLedger = async <T = unknown>(
  command: LedgerWriteCommand,
  args: Record<string, unknown>,
  refresh?: () => Promise<unknown> | void,
  changed: (result: T) => boolean = () => true,
): Promise<T> => {
  const result = await invoke<T>(command, args);
  if (changed(result)) window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT));
  await refresh?.();
  return result;
};
