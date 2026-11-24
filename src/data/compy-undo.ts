import type { AppliedChange } from "../types";
import { hasUndo, liveChangeGroups } from "./live-changes";
import { undoneOutOfOrder } from "./undo-setting";

// B10 (owner decision 2026-11-24: the coordinator's recommendation, no-admin undos only): "Undo this Compy change" on
// the Something's-wrong card's compy-change row. PURE: what the card may offer for one finding, and the rule App's
// `undoOneRecord` re-checks on a list read at the click. Nothing here reads, writes or calls the backend; the card
// never holds the undo, App does (one `rollback_change` through its own confirm, busy flag and error mapping).
//
// docs/product/ROADMAP.md Phase 3: "Fixes needing no admin rights may land after slice 1; a fix needing admin rights
// lands only as an operation in slice 4's closed set." So only an undo that needs no administrator rights is offered.

/**
 * The record's undo needs no administrator rights: its `rollback_action` variant is one whose undo (actions.rs
 * `dispatch_rollback`) writes only the user's own registry (HKCU). Pinned against the Rust dispatch by
 * compy-undo.test.ts. Left out on purpose: `reinstall-preload-app` (no admin, but its undo can close the record when
 * the reinstall failed). Any variant not listed, and a record with no typed action (a legacy row), counts as admin.
 */
export const NO_ADMIN_UNDO_KINDS: ReadonlySet<string> = new Set([
  "restore-game-mode-from-snapshot",
  "restore-game-bar-from-snapshot",
  "restore-mouse-accel-from-snapshot",
  "restore-visual-effects-from-snapshot",
  "restore-startup-approval-from-snapshot",
]);

export function undoNeedsNoAdmin(c: Pick<AppliedChange, "rollback_action">): boolean {
  const kind = c.rollback_action?.kind;
  return typeof kind === "string" && NO_ADMIN_UNDO_KINDS.has(kind);
}

const ms = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : Number.NaN;
};

/** The setting's newest record that is not rolled back, by change-history (file) order: the last one. */
export function newestOpenRecord(list: readonly AppliedChange[], recId: string): AppliedChange | null {
  const open = list.filter((c) => c.rec_id === recId && c.status !== "rolled_back");
  return open[open.length - 1] ?? null;
}

/**
 * The record rules, checked when the card is drawn AND again by App on the list read at the click: it is the
 * setting's newest open record, the one the live check confirms on (never "can't confirm"), it has a saved undo, its
 * result was received (not `result_unconfirmed`), no Trial is tied to it (`justified_by_experiment`: its undo belongs to
 * the Trial bench), and its undo needs no administrator rights.
 */
export function recordUndoableFromCard(list: readonly AppliedChange[], rec: AppliedChange): boolean {
  if (newestOpenRecord(list, rec.rec_id)?.id !== rec.id) return false;
  if (liveChangeGroups(list).active.find((c) => c.rec_id === rec.rec_id)?.id !== rec.id) return false;
  // B10 review r1 F1: an older record of the setting undone after this one was applied (or with no undo date) means
  // this record's saved value may be one Compy set, and one undo would write Compy's own value back (C6 MC1).
  if (undoneOutOfOrder(list, rec.rec_id)) return false;
  return hasUndo(rec) && !rec.result_unconfirmed && !rec.justified_by_experiment && undoNeedsNoAdmin(rec);
}

/** The compy-change finding's own window (`since_when` observed-between) and its count evidence (from/to as text). */
export type CompyChangeWindow = { from: string; to: string; countFrom?: string; countTo?: string };

export type CompyUndoOffer =
  /** No Compy record was applied in the window: the row says what it says today. */
  | { kind: "none" }
  /** One button: undo exactly this record (App re-checks at the click). */
  | { kind: "button"; recId: string; id: string; title: string }
  /** One record, but the card doesn't offer its undo (it is in Test → Applied & history). */
  | { kind: "noUndoHere"; title: string }
  /** The one in-window record is undone; the date is the ledger's `rolled_back_at`, never the click's. */
  | { kind: "undone"; title: string; at: string }
  /** Two or more records: listed, never "undo all". */
  | { kind: "several"; count: number; titles: string[] };

/**
 * What the card may offer for a compy-change finding. A button only when all hold: the count went from N to exactly
 * N+1; exactly one record was applied in [from, to); nothing was undone in that window; the setting is not one the
 * drift list names (`driftRecs`; null = the drift list is not loaded, so Compy can't tell, and no button); and the
 * record rules above. Otherwise one record is named with no button, and two or more are listed.
 */
export function compyUndoOffer(w: CompyChangeWindow, list: readonly AppliedChange[], driftRecs: ReadonlySet<string> | null): CompyUndoOffer {
  const from = ms(w.from);
  const to = ms(w.to);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return { kind: "none" };
  const inside = (iso: string | null | undefined) => {
    const t = ms(iso);
    return !Number.isNaN(t) && t >= from && t < to;
  };
  const applied = list.filter((c) => inside(c.applied_at));
  if (applied.length === 0) return { kind: "none" };
  if (applied.length > 1) {
    // B10 review r1 F4: the count is of settings (the titles listed), never records. Diff read: only records still
    // open are listed (an undone one is never "to undo"): none open, nothing; one setting open, named, not offered
    // here (exactly one apply only); more, listed.
    const titles = [...new Set(applied.filter((c) => c.status !== "rolled_back").map((c) => c.rec_title))];
    if (titles.length === 0) return { kind: "none" };
    if (titles.length === 1) return { kind: "noUndoHere", title: titles[0] };
    return { kind: "several", count: titles.length, titles };
  }
  const rec = applied[0];
  if (rec.status === "rolled_back") {
    // Undone after the window: the ledger's own date. Undone inside it, or with no readable undo date: it is already
    // undone, so nothing is offered or named here (review r1 F2: never "undo it if you choose" over an undone record).
    const at = rec.rolled_back_at ?? "";
    return ms(at) >= to ? { kind: "undone", title: rec.rec_title, at } : { kind: "none" };
  }
  const a = Number(w.countFrom);
  const b = Number(w.countTo);
  const plusOne = w.countFrom?.trim() !== "" && w.countTo?.trim() !== "" && Number.isInteger(a) && Number.isInteger(b) && b === a + 1;
  const undoneInWindow = list.some((c) => c.status === "rolled_back" && inside(c.rolled_back_at));
  if (!plusOne || undoneInWindow || driftRecs === null || driftRecs.has(rec.rec_id) || !recordUndoableFromCard(list, rec)) {
    return { kind: "noUndoHere", title: rec.rec_title };
  }
  return { kind: "button", recId: rec.rec_id, id: rec.id, title: rec.rec_title };
}

/** What App's `undoOneRecord` did with one press from the card. */
export type CardUndoResult =
  | { kind: "done" }
  /** It ran on Windows but Compy couldn't save it: never called undone, no dated line. */
  | { kind: "unrecorded" }
  /** Refused (a mapped sentence), a declined prompt or a failure: App's banner says which; the record stays open. */
  | { kind: "failed" }
  | { kind: "cancelled" }
  /** A Trial is running or Compy can't tell: no call. */
  | { kind: "trial" }
  /** The setting's newest open record is not the one the card offered, or it no longer passes: no call. */
  | { kind: "changed" }
  /** The change list could not be read at the click: no call. */
  | { kind: "unread" }
  /** Another ledger write is running: no call. */
  | { kind: "busy" };