// CR-footer-ledger-unknown: when App's read of the change ledger (`get_applied_changes`) is rejected,
// the failure is already surfaced (App's error banner) and the footer says it couldn't read the
// ledger. Without a retry, nothing re-reads it until the next refresh, so "Ledger not read yet" could
// stand forever. This re-reads it on a backoff until one read lands; it reads, never writes.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppliedChange } from "../types";

/** Waits before each re-read: quick at first, then once a minute for as long as it keeps failing. */
export const LEDGER_RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

export function ledgerRetryDelay(attempt: number): number {
  return LEDGER_RETRY_MS[Math.min(Math.max(0, attempt), LEDGER_RETRY_MS.length - 1)];
}

/** While `failed`, re-read the ledger on the backoff above; the first read that lands goes to
 *  `onRead` and the loop stops. Turning `failed` off (a refresh read it) or unmounting cancels it. */
export function useLedgerReadRetry(failed: boolean, onRead: (changes: AppliedChange[]) => void): void {
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });
  useEffect(() => {
    if (!failed) return;
    let live = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        Promise.resolve()
          .then(() => invoke<AppliedChange[]>("get_applied_changes"))
          .then((changes) => {
            if (live) onReadRef.current(changes);
          })
          .catch((e) => {
            if (!live) return;
            console.error("[compy] ledger re-read failed", e);
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
