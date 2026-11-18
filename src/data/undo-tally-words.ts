import type { TFunction } from "i18next";
import type { UndoTally } from "./live-changes";

/**
 * What the ledger can undo, in words: how many changes the Applied cards can undo, then each kind
 * that can't be, by count. Nothing absolute.
 *
 * CR-footer-reversible wrote these words for the footer; CR-home-reversible-note moved them here so
 * Home's Active changes card (HomeHud, HomeV2) says exactly what the footer says about the same
 * rows instead of "every one reversible from the ledger". `t` is the caller's, from useTranslation().
 * `uncheckedElsewhere` (CR-home-unchecked-once): an unchecked count is said by the caller from
 * another source, so these words leave theirs out and never claim there is nothing to undo.
 */
export function undoTallyWords(tally: UndoTally, t: TFunction, opts: { uncheckedElsewhere?: boolean } = {}): string {
  const elsewhere = opts.uncheckedElsewhere === true;
  return [
    tally.undoable > 0
      ? t("common.shellV2.footerUndoable", { count: tally.undoable })
      : !elsewhere && tally.unchecked === 0 && tally.noSavedUndo === 0 && t("common.shellV2.footerNothingToUndo"),
    tally.noSavedUndo > 0 && t("common.shellV2.footerNoSavedUndo", { count: tally.noSavedUndo }),
    tally.offOutside > 0 && t("common.shellV2.footerOffOutside", { count: tally.offOutside }),
    !elsewhere && tally.unchecked > 0 && t("common.shellV2.footerUnchecked", { count: tally.unchecked }),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * CR-home-unchecked-once: Home's Active changes note (HomeHud, HomeV2). The Machine Model's "couldn't
 * be checked just now" count (`unknownNow`, the source of the card's number) and the ledger's "not
 * checked" count answer one question from two sources, and side by side they printed two different
 * numbers. When the model has one, it is the only unchecked count on the card; otherwise the ledger's
 * words stand as the footer says them. `lead` replaces the ledger's words (the unvouched-ledger note).
 */
export function activeChangesNote(tally: UndoTally, unknownNow: number, t: TFunction, lead: string | null = null): string {
  const elsewhere = unknownNow > 0;
  return [
    lead ?? undoTallyWords(tally, t, { uncheckedElsewhere: elsewhere }),
    elsewhere && t("common.ledgerHealth.activeUnchecked", { count: unknownNow }),
  ]
    .filter(Boolean)
    .join(" · ");
}
