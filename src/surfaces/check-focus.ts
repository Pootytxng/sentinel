// A one-shot, in-memory request to put keyboard focus on one row of the health check when it opens. The
// Paramedic card asks, the health check takes it once. Nothing is stored: a request that is never taken
// (the row is not there) is simply dropped at the next request, and a reload forgets it.
let wanted: string | null = null;

/** Ask for `rowId` (a health-check row, e.g. "applied-changes") to take focus when the check shows it. */
export function requestCheckFocus(rowId: string): void {
  wanted = rowId;
}

/** True once for the row that was asked for; false for every other row and after it was taken. */
export function takeCheckFocus(rowId: string): boolean {
  if (wanted !== rowId) return false;
  wanted = null;
  return true;
}
