import { writeLedger } from "./ledger-write";

/** Turns one startup entry on or off, then tells every ledger reader and re-reads — in the same
 *  order apply and rollback use.
 *
 *  A startup toggle is a recorded Compy change (the command records it in the Trust Ledger), so a
 *  toggle that only flipped its own row left Health and History counting the ledger as it was
 *  before the click (#599). This is the one place the command is named, so a new caller cannot
 *  bring the silent toggle back; `startup-toggle.test.ts` pins both the order and the single owner.
 *  The announcement itself is `writeLedger`'s, the helper the other guarded ledger writes use (#619).
 *
 *  A failed toggle throws before anything is announced: nothing changed, so nothing re-reads. */
export async function setStartupEntryEnabled(
  name: string,
  enabled: boolean,
  refresh: () => Promise<unknown> | void,
): Promise<void> {
  await writeLedger("set_startup_entry_enabled", { name, enabled }, refresh);
}
