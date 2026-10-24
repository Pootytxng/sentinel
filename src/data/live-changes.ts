import type { AppliedChange } from "../types";

// live-changes — the ONE TS definition of "a Compy change that is active on this PC now" (#453).
//
// WHY THIS EXISTS: the #453 Phase 2 four-screen check on the owner's PC printed three numbers for
// one question. Health said 13, Optimize and History said 14. Health counted ledger ROWS (Game Mode,
// applied 8 times, counted 8 times) and dropped every change whose row predates rig stamping, even
// though the live check read it On on this very machine. Optimize kept one card per change. History
// counted "on, or not confirmed off" under a sentence that called them all changes to undo.
//
// The rule, decided by the coordinator for #453:
//   - one per change (`rec_id`), never one per ledger row;
//   - active = status "applied" AND the live check on THIS PC reads "on". The read is taken here,
//     so a missing rig stamp does not make a live-On change any less active here;
//   - "unreadable" / "unrecognised" is the separate can't-confirm group, never active;
//   - anything else (a read that came back off, a rolled-back row, a row with no check) is neither.
// The Rust side is `machine_model.rs` `compose_compy_changes` (Health's number). Both are pinned
// to the same fixture by `src/live-changes-parity.test.ts` and the Rust test that reads it.

export type LiveState = { active: boolean; unconfirmed: boolean };

/**
 * One ledger row's live state. Reads `active_check`, the live re-check's own verdict, never the
 * legacy `is_still_active` bool, which stays true for a check that read nothing (#625).
 */
export function changeLiveState(c: Pick<AppliedChange, "status" | "active_check">): LiveState {
  if (c.status !== "applied") return { active: false, unconfirmed: false };
  return {
    active: c.active_check === "on",
    unconfirmed: c.active_check === "unreadable" || c.active_check === "unrecognised",
  };
}

export type LiveChangeGroups = {
  /** One row per change whose live check reads on, newest apply first. */
  active: AppliedChange[];
  /** One row per change Compy cannot confirm either way, newest apply first. */
  cantConfirm: AppliedChange[];
};

const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * The applied changes grouped the way every screen must show them: one row per `rec_id`, the
 * newest apply that is on or can't be confirmed representing it (that is the apply an undo has to
 * target), split into active and can't-confirm.
 */
export function liveChangeGroups(changes: readonly AppliedChange[] | null | undefined): LiveChangeGroups {
  const byRec = new Map<string, { row: AppliedChange; state: LiveState }>();
  for (const c of changes ?? []) {
    const state = changeLiveState(c);
    if (!state.active && !state.unconfirmed) continue;
    const prev = byRec.get(c.rec_id);
    if (!prev || time(c.applied_at) > time(prev.row.applied_at)) byRec.set(c.rec_id, { row: c, state });
  }
  const all = [...byRec.values()].sort((a, b) => time(b.row.applied_at) - time(a.row.applied_at));
  return {
    active: all.filter((g) => g.state.active).map((g) => g.row),
    cantConfirm: all.filter((g) => g.state.unconfirmed).map((g) => g.row),
  };
}
