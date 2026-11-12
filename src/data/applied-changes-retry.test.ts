import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { LEDGER_RETRY_MS, ledgerRetryDelay, useLedgerReadRetry } from "./applied-changes-retry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

// CR-footer-ledger-unknown: a rejected ledger read is re-read on a backoff until one lands.
describe("useLedgerReadRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("backs off, then holds at once a minute", () => {
    expect(LEDGER_RETRY_MS.map((_, i) => ledgerRetryDelay(i))).toEqual([2000, 5000, 15000, 30000, 60000]);
    expect(ledgerRetryDelay(40)).toBe(60000);
    expect(ledgerRetryDelay(-1)).toBe(2000);
  });

  it("re-reads after each failure and hands over the first read that lands, then stops", async () => {
    const rows = [{ id: "c1" }];
    mockInvoke.mockRejectedValueOnce(new Error("ipc")).mockRejectedValueOnce(new Error("ipc")).mockResolvedValue(rows);
    const onRead = vi.fn();
    renderHook(() => useLedgerReadRetry(true, onRead));
    expect(mockInvoke).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenLastCalledWith("get_applied_changes");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith(rows);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it("reads nothing while the read hasn't failed, and stops when unmounted or read elsewhere", async () => {
    mockInvoke.mockRejectedValue(new Error("ipc"));
    const onRead = vi.fn();
    const { rerender, unmount } = renderHook(({ failed }) => useLedgerReadRetry(failed, onRead), {
      initialProps: { failed: false },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    rerender({ failed: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    rerender({ failed: false }); // a refresh read it
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    rerender({ failed: true });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(onRead).not.toHaveBeenCalled();
  });
});
