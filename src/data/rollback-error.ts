/** The fixed lead of every "undo ran but couldn't be saved" error from `rollback_change` (#631).
 *  Mirrors `ROLLBACK_UNRECORDED_LEAD` in `src-tauri/src/history.rs`; `rollback-error.test.ts` pins
 *  the two equal. */
export const ROLLBACK_UNRECORDED_LEAD =
  "The undo ran on Windows, but Compy couldn't save that to its history";

/** True when a rollback error means the undo DID run on Windows and only the history save failed,
 *  so the surface must not say the undo failed or the change is still on. */
export const isUnrecordedUndo = (err: unknown): boolean =>
  String(err).startsWith(ROLLBACK_UNRECORDED_LEAD);
