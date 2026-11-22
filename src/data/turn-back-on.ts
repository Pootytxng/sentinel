// B3 (owner decision 2026-11-21): "Turn it back on" for a setting Compy applied that is now off. The ONE path both
// the Test room's health check (Check.tsx) and the Something's-wrong card call: the same confirm dialog, the same
// audited `apply_recommendation` (through writeLedger, so every ledger reader re-reads), the same failure notice.
// No new command, no new privilege: the backend's own refusals (a Trial or the benchmark measuring the setting, a
// Gaming Mode session holding it, a declined UAC prompt) come back as the error and are shown in its own words. The
// ledger row, its receipt and its undo (Test → Applied) are the ones every apply makes.
import type { TFunction } from "i18next";
import type { ConfirmOpts } from "../design/ConfirmDialog";
import type { AppliedChange } from "../types";
import { writeLedger } from "./ledger-write";

/** A change Compy applied that reads off now (use-scan.ts `deriveReverted`): its ledger id and title. */
export type RevertedChange = { rec_id: string; title: string };

export type TurnBackOnResult =
  | { kind: "done"; change: AppliedChange | null }
  | { kind: "cancelled" }
  | { kind: "failed" };

/** Confirm, apply through the ledger, then `after` (the caller's refresh). A refusal or failure is shown in the
 *  backend's own words and nothing claims it happened. A refresh that fails after a recorded apply does not turn the
 *  apply into "couldn't turn that back on": the apply is recorded, so the result is still `done`. `extraBody` is one
 *  more sentence for the confirm (the card's "two changes before you play" warning). */
export async function turnBackOn(
  rev: RevertedChange,
  opts: {
    confirm: (o: ConfirmOpts) => Promise<boolean>;
    t: TFunction;
    after?: () => Promise<unknown> | unknown;
    extraBody?: string;
  },
): Promise<TurnBackOnResult> {
  const { confirm, t, after, extraBody } = opts;
  const body = t("optimize.check.snapshotConfirmBody");
  const ok = await confirm({
    title: t("optimize.check.turnOnTitle", { title: rev.title }),
    body: extraBody ? `${body} ${extraBody}` : body,
    confirmLabel: t("optimize.check.turnItOn"),
  });
  if (!ok) return { kind: "cancelled" };
  let change: AppliedChange | null;
  try {
    change = (await writeLedger<AppliedChange>("apply_recommendation", { recId: rev.rec_id, recTitle: rev.title })) ?? null;
  } catch (e) {
    // Don't fail silently: a declined UAC prompt or a refused apply must TELL the user it didn't happen.
    await confirm({
      title: t("optimize.check.turnOnFailedTitle"),
      body: String(e),
      confirmLabel: t("optimize.check.ok"),
      acknowledge: true,
    });
    return { kind: "failed" };
  }
  try {
    await after?.();
  } catch {
    // The apply is recorded and announced; the caller's own screen re-reads on the ledger event.
  }
  return { kind: "done", change };
}
