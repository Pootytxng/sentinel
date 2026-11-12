import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { LEDGER_RETRY_MS, ledgerRetryDelay, settleLedgerRead, useLedgerReadRetry } from "./applied-changes-retry";
import type { AppliedChange } from "../types";

const rows = [{ id: "c1" }] as unknown as AppliedChange[];

// Review r1: App.refresh's ledger read, through App's own `run` semantics (set only when current;
// a rejection resolves undefined). Only the current refresh's rejection starts the retry.
describe("settleLedgerRead", () => {
  const run = (outcome: "ok" | "reject", isCurrent: boolean) => (set: (c: AppliedChange[]) => void) =>
    outcome === "ok"
      ? Promise.resolve(rows).then((v) => {
          if (isCurrent) set(v);
          return v;
        })
      : Promise.resolve(undefined);
  it.each([
    ["current read lands", "ok", true, 1, 0],
    ["current read rejected", "reject", true, 0, 1],
    ["superseded read lands", "ok", false, 0, 0],
    ["superseded read rejected", "reject", false, 0, 0],
  ] as const)("%s", async (_n, outcome, isCurrent, reads, fails) => {
    const onRead = vi.fn();
    const onFailed = vi.fn();
    await settleLedgerRead(run(outcome, isCurrent), () => isCurrent, onRead, onFailed);
    expect(onRead).toHaveBeenCalledTimes(reads);
    expect(onFailed).toHaveBeenCalledTimes(fails);
  });
});

// CR-footer-ledger-unknown: a rejected ledger read is re-read on a backoff until one lands.
describe("useLedgerReadRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("backs off, then holds at once a minute", () => {
    expect(LEDGER_RETRY_MS.map((_, i) => ledgerRetryDelay(i))).toEqual([2000, 5000, 15000, 30000, 60000]);
    expect(ledgerRetryDelay(40)).toBe(60000);
    expect(ledgerRetryDelay(-1)).toBe(2000);
  });

  it("re-reads after each failure and hands over the first read that lands, then stops", async () => {
    const read = vi
      .fn<() => Promise<AppliedChange[]>>()
      .mockRejectedValueOnce(new Error("ipc"))
      .mockRejectedValueOnce(new Error("ipc"))
      .mockResolvedValue(rows);
    const onRead = vi.fn();
    renderHook(() => useLedgerReadRetry(true, read, onRead));
    expect(read).not.toHaveBeenCalled();
    await tick(2000);
    expect(read).toHaveBeenCalledTimes(1);
    await tick(4999);
    expect(read).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(read).toHaveBeenCalledTimes(2);
    await tick(15000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith(rows);
    await tick(120000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("drops a read a refresh overtook (review r2) and keeps waiting, without counting it as a failure", async () => {
    const read = vi
      .fn<() => Promise<AppliedChange[] | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(rows);
    const onRead = vi.fn();
    renderHook(() => useLedgerReadRetry(true, read, onRead));
    await tick(2000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(onRead).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    await tick(2000); // same step of the backoff: superseded is not a failure
    expect(read).toHaveBeenCalledTimes(2);
    expect(onRead).toHaveBeenCalledWith(rows);
  });

  it("reads nothing while the read hasn't failed, and stops when unmounted or read elsewhere", async () => {
    const read = vi.fn<() => Promise<AppliedChange[]>>().mockRejectedValue(new Error("ipc"));
    const onRead = vi.fn();
    const { rerender, unmount } = renderHook(({ failed }) => useLedgerReadRetry(failed, read, onRead), {
      initialProps: { failed: false },
    });
    await tick(60000);
    expect(read).not.toHaveBeenCalled();
    rerender({ failed: true });
    await tick(2000);
    expect(read).toHaveBeenCalledTimes(1);
    rerender({ failed: false }); // a refresh read it
    await tick(120000);
    expect(read).toHaveBeenCalledTimes(1);
    rerender({ failed: true });
    unmount();
    await tick(120000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(onRead).not.toHaveBeenCalled();
  });
});
