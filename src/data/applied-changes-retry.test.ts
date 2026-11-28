import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { LEDGER_RETRY_MS, ledgerReadState, ledgerRetryDelay, settleLedgerRead, settleListRead, useLedgerReadRetry, useListReadRetry } from "./applied-changes-retry";
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

// e3 review r1 F2: App's session-list read goes through settleListRead (same `run` semantics) and
// still hands the list on to the priority ranking. This drives App's own two flags through it and
// reads them back with ledgerReadState, so the state the session views get is pinned end to end.
// Break check: make settleListRead skip `onFailed` (or call it on a superseded refresh) and the
// "rejected" rows fail; make it drop the resolved value and the "hands the list on" check fails.
describe("settleListRead (App's session-list read)", () => {
  const list = [{ started_at: "s1" }];
  const run = (outcome: "ok" | "reject", isCurrent: boolean) => (set: (v: typeof list) => void): Promise<typeof list | undefined> =>
    outcome === "ok"
      ? Promise.resolve(list).then((v) => {
          if (isCurrent) set(v);
          return v;
        })
      : Promise.resolve(undefined);
  // App's flags, as App sets them: a landed list → read, not failed; a current rejection → failed.
  const app = () => {
    const s = { read: false, failed: false };
    const settle = (outcome: "ok" | "reject", isCurrent: boolean) =>
      settleListRead(run(outcome, isCurrent), () => isCurrent, () => {
        s.read = true;
        s.failed = false;
      }, () => {
        s.failed = true;
      });
    return { s, settle, state: () => ledgerReadState(s) };
  };
  it("before any read: pending", () => {
    expect(app().state()).toBe("pending");
  });
  it("a current read lands: read (undefined), and the list is handed on", async () => {
    const a = app();
    await expect(a.settle("ok", true)).resolves.toBe(list);
    expect(a.state()).toBeUndefined();
  });
  it("a current read rejected: failed, and the ranking gets undefined", async () => {
    const a = app();
    await expect(a.settle("reject", true)).resolves.toBeUndefined();
    expect(a.state()).toBe("failed");
  });
  it("a superseded read, landed or rejected, changes nothing", async () => {
    const a = app();
    await a.settle("reject", false);
    await a.settle("ok", false);
    expect(a.state()).toBe("pending");
  });
  it("rejected after an earlier good read: failed; a later good read clears it", async () => {
    const a = app();
    await a.settle("ok", true);
    await a.settle("reject", true);
    expect(a.state()).toBe("failed");
    await a.settle("ok", true);
    expect(a.state()).toBeUndefined();
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

  // CR-upgrade-area-truth NIT (c): a minute, five minutes, then every fifteen (was once a minute forever).
  it("backs off to a minute, five minutes, then holds at every fifteen minutes", () => {
    expect(LEDGER_RETRY_MS.map((_, i) => ledgerRetryDelay(i))).toEqual([2000, 5000, 15000, 30000, 60000, 300000, 900000]);
    expect(ledgerRetryDelay(40)).toBe(900000);
    expect(ledgerRetryDelay(-1)).toBe(2000);
  });

  it("logs a ledger that stays unreadable once, and again only when the failure reads differently", async () => {
    const read = vi
      .fn<() => Promise<AppliedChange[]>>()
      .mockRejectedValueOnce(new Error("ipc"))
      .mockRejectedValueOnce(new Error("ipc"))
      .mockRejectedValueOnce(new Error("ipc"))
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValue(rows);
    renderHook(() => useLedgerReadRetry(true, read, vi.fn()));
    await tick(2000 + 5000 + 15000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledTimes(1);
    await tick(30000);
    expect(read).toHaveBeenCalledTimes(4);
    expect(console.error).toHaveBeenCalledTimes(2);
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

// e2 review r1 F1: App passes ledgerReadState({ read: changesRead, failed: changesReadFailed }) to the
// Lab's ledger views. Named fields so the two booleans cannot be swapped at the call site (review r2).
// Break check: make "pending" win over "failed" (or return undefined while unread) and a row here fails.
// Not covered: deleting the prop in App.tsx (no source guard, by the no-new-guards rule).
// First-run follow-up (e3 review r1 F3): App's session-list read had no retry, so a failed read said
// "couldn't read" until the next refresh. App now re-reads it through useListReadRetry.
// Break check: make useListReadRetry stop after one failure and the "re-reads" case fails; drop the
// null rule and the "refresh overtook" case fails; hard-code "ledger" in the log and the name case fails.
describe("useListReadRetry (App's session-list re-read)", () => {
  const sessions = [{ started_at: "s1" }];
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

  it("re-reads on the ledger's backoff and hands over the first list that lands, then stops", async () => {
    const read = vi
      .fn<() => Promise<typeof sessions>>()
      .mockRejectedValueOnce(new Error("ipc"))
      .mockResolvedValue(sessions);
    const onRead = vi.fn();
    renderHook(() => useListReadRetry(true, read, onRead, "session list"));
    await tick(2000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(onRead).not.toHaveBeenCalled();
    await tick(5000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(onRead).toHaveBeenCalledWith(sessions);
    await tick(900000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("names the list it failed to read in the console line", async () => {
    const read = vi.fn<() => Promise<typeof sessions>>().mockRejectedValue(new Error("ipc"));
    renderHook(() => useListReadRetry(true, read, vi.fn(), "session list"));
    await tick(2000);
    expect(console.error).toHaveBeenCalledWith("[compy] session list re-read failed", expect.any(Error));
  });

  it("drops a list a refresh overtook and keeps waiting", async () => {
    const read = vi
      .fn<() => Promise<typeof sessions | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(sessions);
    const onRead = vi.fn();
    renderHook(() => useListReadRetry(true, read, onRead, "session list"));
    await tick(2000);
    expect(onRead).not.toHaveBeenCalled();
    await tick(2000);
    expect(onRead).toHaveBeenCalledWith(sessions);
  });

  it("reads nothing while the read hasn't failed", async () => {
    const read = vi.fn<() => Promise<typeof sessions>>().mockResolvedValue(sessions);
    renderHook(() => useListReadRetry(false, read, vi.fn(), "session list"));
    await tick(900000);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("ledgerReadState", () => {
  it("unread → pending; read → undefined; failed → failed, before or after a good read", () => {
    expect(ledgerReadState({ read: false, failed: false })).toBe("pending");
    expect(ledgerReadState({ read: true, failed: false })).toBeUndefined();
    expect(ledgerReadState({ read: false, failed: true })).toBe("failed");
    expect(ledgerReadState({ read: true, failed: true })).toBe("failed");
  });
});
