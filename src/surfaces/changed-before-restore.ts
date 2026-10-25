import type { AppliedChange, ChangedBeforeIncident } from "../types";
import { liveChangeGroups } from "../data/live-changes";
import { isUnrecordedUndo } from "../data/rollback-error";

// P6-restore: "Put back how it was on <date>" for one incident's "Changed before this" block.
//
// Which changes it offers (ROADMAP Phase 6 bullet 7, Constitution §26):
//   - only changes whose newest live apply (`liveChangeGroups`) sits INSIDE the window. The
//     backend's "compy-changes" item holds exactly the window's applies, matched to their ledger
//     rows by the timeline's deterministic `apply:<row id>`;
//   - for such a change, EVERY still-"applied" row of it inside the window is undone, newest first.
//     A re-apply snapshots the already-changed setting, so undoing only the newest apply would stop
//     at the middle state. The ledger undo restores each row from that row's own snapshot, so the
//     oldest in-window row's undo lands on how it was before the window.
// Not offered, with the reason said: a change turned on again after the crash (its live apply is
// after the window, and putting it back would undo that later choice too), and a change Compy can't
// confirm is on. A driver, Windows, power-plan, hardware or drift change was not made by Compy, so
// Compy has no recorded "before" to put back.

export type RestoreGroup = {
  recId: string;
  title: string;
  /** Every in-window "applied" row of this change, newest first. */
  rows: AppliedChange[];
  /** What the setting returns to: the oldest in-window row's prior. */
  restoresLabel: string | null;
};

export type RestorePlan = {
  /** The last good session's start: the "how it was on" date. */
  date: string;
  /** One per change, newest live apply first. */
  groups: RestoreGroup[];
  /** Every row to undo, newest apply first: the order they run in. */
  steps: AppliedChange[];
  /** Window changes turned on again after the crash. */
  turnedOnAgain: string[];
  /** Window changes Compy can't confirm are on now. */
  unconfirmed: string[];
};

const APPLY_ID = "apply:";

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};
const newestFirst = (a: AppliedChange, b: AppliedChange) => ms(b.applied_at) - ms(a.applied_at);

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
  const rowOf = new Map(changes.map((c) => [c.id, c]));
  const { active, cantConfirm } = liveChangeGroups(changes);
  const liveByRec = new Map(active.map((c) => [c.rec_id, c]));
  const unsureByRec = new Map(cantConfirm.map((c) => [c.rec_id, c]));

  const groups: RestoreGroup[] = [];
  for (const live of active) {
    if (!inWindow.has(live.id)) continue;
    const rows = changes
      .filter((c) => c.rec_id === live.rec_id && c.status === "applied" && inWindow.has(c.id))
      .sort(newestFirst);
    groups.push({
      recId: live.rec_id,
      title: live.rec_title,
      rows,
      restoresLabel: rows[rows.length - 1]?.restores_label ?? null,
    });
  }
  const offered = new Set(groups.map((g) => g.recId));

  const windowEnd = ms(cb.window_end);
  const turnedOnAgain = new Map<string, string>();
  const unconfirmed = new Map<string, string>();
  for (const e of applies) {
    const row = rowOf.get(e.id.slice(APPLY_ID.length));
    if (!row || offered.has(row.rec_id)) continue;
    const live = liveByRec.get(row.rec_id) ?? unsureByRec.get(row.rec_id);
    if (live && !inWindow.has(live.id) && ms(live.applied_at) > windowEnd) {
      turnedOnAgain.set(row.rec_id, row.rec_title);
    } else if (live && unsureByRec.has(row.rec_id)) {
      unconfirmed.set(row.rec_id, row.rec_title);
    }
    // Otherwise it is off now (read off, or rolled back since): nothing to put back.
  }
  if (groups.length === 0 && turnedOnAgain.size === 0 && unconfirmed.size === 0) return null;
  return {
    date: cb.anchor.started_at,
    groups,
    steps: groups.flatMap((g) => g.rows).sort(newestFirst),
    turnedOnAgain: [...turnedOnAgain.values()],
    unconfirmed: [...unconfirmed.values()],
  };
}

export type RestoreOutcome = "undone" | "unrecorded" | "failed" | "not-tried";
export type RestoreResult = {
  id: string;
  recId: string;
  title: string;
  appliedAt: string;
  outcome: RestoreOutcome;
  /** "unrecorded" only: the backend's live read of the setting after the undo, when it gave one. */
  liveRead?: string;
};

/** The live-read sentence the backend appends to an unrecorded-undo message (history.rs
 *  `rollback_unrecorded_message`), or undefined when there is none. */
export function unrecordedLiveRead(err: unknown): string | undefined {
  const m = /as applied\.\s+(.+)$/s.exec(String(err));
  return m?.[1].trim() || undefined;
}

/**
 * Undo `steps` one at a time, in the order given (newest first), through `undo` (the audited
 * ledger undo). Stops at the first undo that did not finish cleanly: the rest are reported
 * "not-tried", never guessed at. An undo that ran on Windows but couldn't be saved (#631) is
 * "unrecorded": neither failed nor cleanly put back.
 */
export async function runRestore(
  steps: readonly AppliedChange[],
  undo: (c: AppliedChange) => Promise<unknown>,
): Promise<RestoreResult[]> {
  const out: RestoreResult[] = [];
  let stopped = false;
  for (const c of steps) {
    const base = { id: c.id, recId: c.rec_id, title: c.rec_title, appliedAt: c.applied_at };
    if (stopped) {
      out.push({ ...base, outcome: "not-tried" });
      continue;
    }
    try {
      await undo(c);
      out.push({ ...base, outcome: "undone" });
    } catch (e) {
      stopped = true;
      if (isUnrecordedUndo(e)) {
        const liveRead = unrecordedLiveRead(e);
        out.push({ ...base, outcome: "unrecorded", ...(liveRead ? { liveRead } : {}) });
      } else {
        out.push({ ...base, outcome: "failed" });
      }
    }
  }
  return out;
}

/** True when a Trial is in progress (or Compy can't tell): the offer must not run. Same rule as the
 *  bench's outcome switch: any experiment still running, or the guided journey not idle. */
export function trialInProgress(
  experiments: readonly { status: string }[] | null,
  journeyIdle: boolean,
): "none" | "running" | "unknown" {
  if (!journeyIdle) return "running";
  if (!Array.isArray(experiments)) return "unknown";
  return experiments.some((x) => x.status === "running" || x.status === "pending") ? "running" : "none";
}
