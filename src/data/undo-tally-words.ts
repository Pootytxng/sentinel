import type { TFunction } from "i18next";
import type { UndoTally } from "./live-changes";

/**
 * What the ledger can undo, in words: how many changes the Applied cards can undo, then each kind
 * that can't be, by count. Nothing absolute.
 *
 * CR-footer-reversible wrote these words for the footer; CR-home-reversible-note moved them here so
 * Home's Active changes card (HomeHud, HomeV2) says exactly what the footer says about the same
 * rows instead of "every one reversible from the ledger". `t` is the caller's, from useTranslation().
 */
export function undoTallyWords(tally: UndoTally, t: TFunction): string {
  return [
    tally.undoable > 0
      ? t("common.shellV2.footerUndoable", { count: tally.undoable })
      : tally.unchecked === 0 && tally.noSavedUndo === 0 && t("common.shellV2.footerNothingToUndo"),
    tally.noSavedUndo > 0 && t("common.shellV2.footerNoSavedUndo", { count: tally.noSavedUndo }),
    tally.offOutside > 0 && t("common.shellV2.footerOffOutside", { count: tally.offOutside }),
    tally.unchecked > 0 && t("common.shellV2.footerUnchecked", { count: tally.unchecked }),
  ]
    .filter(Boolean)
    .join(" · ");
}
