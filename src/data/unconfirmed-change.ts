import type { AppliedChange, BatchApplyReport } from "../types";

/** A5 Part A: a Trust Ledger row recorded although Compy did not get the admin step's own result for it,
 *  and not undone since. Every surface that lists such a row shows the check-and-undo warning
 *  (`optimize.fix.resultUnconfirmed`). A row that was undone no longer needs checking. */
export function recordedWithoutResult(c: Pick<AppliedChange, "status" | "result_unconfirmed">): boolean {
  return c.status === "applied" && c.result_unconfirmed === true;
}

/** A5 Part A: the titles of the batch items recorded without the admin step's own result, in report order. */
export function unconfirmedTitles(report: Pick<BatchApplyReport, "items">): string[] {
  return report.items.filter((i) => i.status === "applied" && i.unconfirmed === true).map((i) => i.rec_title);
}

/** A5 Part A review r1 C: how many batch items Compy KNOWS were made, for "Applied {{count}}" and the Home
 *  receipt. An item recorded without its result is not one of them: it is shown only by name, with the
 *  warning, never counted as applied. */
export function confirmedCount(report: Pick<BatchApplyReport, "items">): number {
  return report.items.filter((i) => i.status === "applied" && i.unconfirmed !== true).length;
}
