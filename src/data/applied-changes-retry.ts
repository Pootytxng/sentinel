// CR-footer-ledger-unknown: when App's read of the change ledger is rejected, the failure is already
// surfaced (App's error banner) and the footer says it couldn't read the ledger. Without a retry,
// nothing re-reads it until the next refresh, so "Ledger not read yet" could stand forever. This
// re-runs App's own read (passed in, so the command stays named only where App reads it) on a
// backoff until one read lands; it reads, never writes.
import { useEffect, useRef } from "react";
import type { AppliedChange } from "../types";

/** Waits before each re-read: quick at first, then a minute, five minutes, and every fifteen minutes
 *  for as long as it keeps failing (CR-upgrade-area-truth NIT (c): not once a minute forever). */
export const LEDGER_RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 300_000, 900_000] as const;

export function ledgerRetryDelay(attempt: number): number {
  return LEDGER_RETRY_MS[Math.min(Math.max(0, attempt), LEDGER_RETRY_MS.length - 1)];
}

/** While `failed`, call `read` on the backoff above; the first read that lands goes to `onRead` and
 *  the loop stops. Turning `failed` off (a refresh read it) or unmounting cancels it. `read` resolves
 *  null when a refresh began while it was reading (review r2): its rows may be older than the
 *  refresh's, so they are dropped and the loop waits its turn again (the refresh decides `failed`). */
export function useLedgerReadRetry(
  failed: boolean,
  read: () => Promise<AppliedChange[] | null>,
  onRead: (changes: AppliedChange[]) => void,
): void {
  const readRef = useRef(read);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    readRef.current = read;
    onReadRef.current = onRead;
  });
  useEffect(() => {
    if (!failed) return;
    let live = true;
    let attempt = 0;
    // NIT (c): log once per state change (the first failure, or a failure that reads differently
    // from the last one logged), not on every re-read of a ledger that stays unreadable.
    let lastLogged: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        // Review nit: only the READ's failure reschedules; `onRead` runs outside the read's catch.
        Promise.resolve()
          .then(() => readRef.current())
          .then(
            (changes) => ({ ok: true as const, changes }),
            (error: unknown) => ({ ok: false as const, error }),
          )
          .then((r) => {
            if (!live) return;
            if (r.ok) {
              const changes = r.changes;
              if (changes === null) schedule(); // superseded by a refresh: not a failure, not a read
              else onReadRef.current(changes);
              return;
            }
            const said = String(r.error);
            if (said !== lastLogged) {
              lastLogged = said;
              console.error("[compy] ledger re-read failed", r.error);
            }
            attempt += 1;
            schedule();
          });
      }, ledgerRetryDelay(attempt));
    };
    schedule();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [failed]);
}

/** Review r1: App.refresh's ledger read, settled. `read` is App's `run(<the ledger read>, set)`, which
 *  calls `set` only when the refresh is still current and resolves undefined on a rejection. So:
 *  rows landed → `onRead`; nothing landed and the refresh is current → a rejected read → `onFailed`
 *  (start the retry); nothing landed and superseded → nothing (the newer refresh decides). */
export function settleLedgerRead(
  read: (set: (changes: AppliedChange[]) => void) => Promise<unknown>,
  current: () => boolean,
  onRead: (changes: AppliedChange[]) => void,
  onFailed: () => void,
): Promise<void> {
  let landed = false;
  return read((changes) => {
    landed = true;
    onRead(changes);
  }).then(() => {
    if (!landed && current()) onFailed();
  });
}
