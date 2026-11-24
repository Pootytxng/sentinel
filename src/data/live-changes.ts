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

/** Whether the Undo on a live change's card can run: false only when history.rs said its stored
 *  history resolves to no undo. An older payload that didn't say keeps the button it always had. */
export function hasUndo(c: Pick<AppliedChange, "undo_contract">): boolean {
  return c.undo_contract !== false;
}

/** Every count here is of SETTINGS (one per `rec_id`), except `records`, which counts ledger rows. */
export type UndoTally = {
  /** Settings with an Undo button that can run: the Applied cards. */
  undoable: number;
  /** Live settings whose stored history resolves to no undo (`undo_contract` false). */
  noSavedUndo: number;
  /** Settings Compy applied that read off now without being undone (changed outside Compy, incl.
   *  a "Keep <plan>" record): no Applied card, so no Undo. */
  offOutside: number;
  /** Settings with an open record and no live-check verdict on any of them (an older payload;
   *  history.rs checks every applied row). Named, so "Nothing in effect to undo" is never said over
   *  a row nobody read. Never also counted in `offOutside`. */
  unchecked: number;
  /** C7: every setting with a record not undone: `undoable + noSavedUndo + offOutside + unchecked`. */
  settings: number;
  /** C7: the records (rows) behind `settings`: every row that is not rolled back. */
  records: number;
};

/**
 * CR-footer-reversible: what the ledger can undo, counted from `liveChangeGroups`, the same groups
 * the Applied cards (and so every Undo button) are drawn from, so the footer and the buttons can't
 * disagree. Rolled-back rows count nowhere: they are already undone.
 *
 * C7: the TS mirror of history.rs `open_settings` (Health and Your data count through it), pinned to
 * the same numbers by `src/test/fixtures/open-settings-parity.json` (`src/open-settings-parity.test.ts`).
 * A setting whose open records are one read off and one never read is changed outside, counted once
 * (it was counted in both `offOutside` and `unchecked` before C7).
 */
export function undoTally(changes: readonly AppliedChange[]): UndoTally {
  const { active, cantConfirm } = liveChangeGroups(changes);
  const live = [...active, ...cantConfirm];
  const liveRecs = new Set(live.map((c) => c.rec_id));
  const undoable = live.filter(hasUndo).length;
  // rec_id -> whether any of its open records read off.
  const open = new Map<string, boolean>();
  let records = 0;
  for (const c of changes) {
    if (c.status === "rolled_back") continue;
    records += 1;
    open.set(c.rec_id, (open.get(c.rec_id) ?? false) || c.active_check === "off");
  }
  let offOutside = 0;
  let unchecked = 0;
  for (const [rec, readOff] of open) {
    if (liveRecs.has(rec)) continue;
    if (readOff) offOutside += 1;
    else unchecked += 1;
  }
  return { undoable, noSavedUndo: live.length - undoable, offOutside, unchecked, settings: open.size, records };
}
