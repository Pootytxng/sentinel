import type { AppliedChange, ChangedBeforeIncident } from "../types";
import { liveChangeGroups } from "../data/live-changes";
import { isUnrecordedUndo } from "../data/rollback-error";

// P6-restore: "Put back how it was on <date>" for one incident's "Changed before this" block.
//
// Which changes it offers (ROADMAP Phase 6 bullet 7, Constitution §26):
//   - only Compy's own applies INSIDE the window (the backend's "compy-changes" item already holds
//     exactly those), matched to their ledger row by the timeline's deterministic `apply:<row id>`;
//   - and only the rows `liveChangeGroups` says are on now. A row that reads off, was rolled back,
//     can't be confirmed, or was superseded by a newer apply of the same change is not offered.
// Nothing else is offered: a driver, Windows, power-plan, hardware or drift change was not made by
// Compy, so Compy has no recorded "before" to put back.

export type RestorePlan = {
  /** The last good session's start: the "how it was on" date. */
  date: string;
  /** Live ledger rows to undo, newest apply first (the order they run in). */
  offer: AppliedChange[];
  /** Compy changes in the window that are not offered because they are not confirmed on now. */
  notLive: string[];
};

const APPLY_ID = "apply:";

export function restorePlan(
  cb: ChangedBeforeIncident,
  changes: readonly AppliedChange[] | null | undefined,
): RestorePlan | null {
  if (!cb.anchor || !changes) return null;
  const compy = cb.items.find((it) => it.category === "compy-changes" && it.status === "changed");
  const applies = (compy?.events ?? []).filter(
    (e) => e.event_type === "change-applied" && e.id.startsWith(APPLY_ID),
  );
  if (applies.length === 0) return null;
  const inWindow = new Set(applies.map((e) => e.id.slice(APPLY_ID.length)));
  const offer = liveChangeGroups(changes).active.filter((c) => inWindow.has(c.id));
  const offered = new Set(offer.map((c) => c.id));
  const notLive = applies
    .filter((e) => !e.since_rolled_back && !offered.has(e.id.slice(APPLY_ID.length)))
    .map((e) => changes.find((c) => c.id === e.id.slice(APPLY_ID.length))?.rec_title ?? e.summary);
  if (offer.length === 0 && notLive.length === 0) return null;
  return { date: cb.anchor.started_at, offer, notLive };
}

export type RestoreOutcome = "undone" | "unrecorded" | "failed" | "not-tried";
export type RestoreResult = { id: string; title: string; outcome: RestoreOutcome };

/**
 * Undo `offer` one at a time, in the order given (newest first), through `undo` (the audited
 * ledger rollback). Stops at the first undo that did not finish cleanly: the rest are reported
 * "not-tried", never guessed at. An undo that ran on Windows but couldn't be saved (#631) is
 * "unrecorded", not "failed" — the setting is back, only the history save is missing.
 */
export async function runRestore(
  offer: readonly AppliedChange[],
  undo: (c: AppliedChange) => Promise<unknown>,
): Promise<RestoreResult[]> {
  const out: RestoreResult[] = [];
  let stopped = false;
  for (const c of offer) {
    const base = { id: c.id, title: c.rec_title };
    if (stopped) {
      out.push({ ...base, outcome: "not-tried" });
      continue;
    }
    try {
      await undo(c);
      out.push({ ...base, outcome: "undone" });
    } catch (e) {
      out.push({ ...base, outcome: isUnrecordedUndo(e) ? "unrecorded" : "failed" });
      stopped = true;
    }
  }
  return out;
}
