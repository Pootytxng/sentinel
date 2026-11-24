import type { AppliedChange } from "../types";

// C6: one undo per setting. A setting re-applied N times without an undo between has N open records in the change
// history; each record's undo puts back what Compy saved just before that record's change. Undoing them newest
// first, each through the existing audited `rollback_change` (via `runRestore`), ends on the oldest record's saved
// value. This module only decides WHETHER to offer that walk and in which order; it never calls anything.
//
// Order is the change history's own (file order, last = newest: history.rs `newest_applied_row`), never
// `applied_at`, which a clock set back can make disagree (C6 review MC2).
//
// The walk is NOT offered (the card keeps today's one-record undo) when:
//   - the setting has fewer than two open records (nothing to walk);
//   - an older record of it was undone OUT OF ORDER (review MC1): a rolled-back record earlier in the history than
//     an open one, undone after that open record was applied, or with no undo date (can't tell). The open record's
//     saved value may then be one Compy set, and walking would put Compy's value back;
//   - a Trial is in progress, or Compy can't tell (`trialInProgress`): an undo could take back the running Trial's
//     own apply mid-measurement (the same rule as the changed-before restore);
//   - the change list could not be read: never a walk over a list Compy doesn't have (review MC4).

export type SettingUndo =
  | { kind: "walk"; rows: AppliedChange[] }
  | { kind: "one"; why: "single" | "out_of_order" | "trial" | "list_unread"; open: number };

/** The setting's records that are not rolled back, newest first by change-history order. `changes` must be in
 *  file order, as `get_applied_changes` returns them. */
export function openRecordsNewestFirst(changes: readonly AppliedChange[], recId: string): AppliedChange[] {
  return changes.filter((c) => c.rec_id === recId && c.status !== "rolled_back").reverse();
}

const time = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : Number.NaN;
};

/** True when an older record of `recId` was undone while a newer one was (or may have been) open: a rolled-back
 *  record earlier in the history than an open record, whose `rolled_back_at` is after that open record's
 *  `applied_at`, or either time is missing or unreadable (can't tell, so treated as out of order). */
export function undoneOutOfOrder(changes: readonly AppliedChange[], recId: string): boolean {
  const rows = changes.filter((c) => c.rec_id === recId);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].status !== "rolled_back") continue;
    const undoneAt = time(rows[i].rolled_back_at);
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[j].status === "rolled_back") continue;
      const appliedAt = time(rows[j].applied_at);
      if (Number.isNaN(undoneAt) || Number.isNaN(appliedAt) || undoneAt > appliedAt) return true;
    }
  }
  return false;
}

/** Whether "Undo" on `recId` walks its open records, or stays a one-record undo, and why. `changes` is the list
 *  the walk would use (null when it could not be read); the dialog's count comes from the same list. */
export function settingUndo(
  changes: readonly AppliedChange[] | null,
  recId: string,
  trial: "none" | "running" | "unknown",
): SettingUndo {
  if (!changes) return { kind: "one", why: "list_unread", open: 0 };
  const rows = openRecordsNewestFirst(changes, recId);
  if (rows.length < 2) return { kind: "one", why: "single", open: rows.length };
  if (undoneOutOfOrder(changes, recId)) return { kind: "one", why: "out_of_order", open: rows.length };
  if (trial !== "none") return { kind: "one", why: "trial", open: rows.length };
  return { kind: "walk", rows };
}
