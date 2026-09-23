import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { LEDGER_CHANGED_EVENT, type Fact, type MachineModel } from "../types";
import { invalidateProbe } from "./probe-cache";
import wire from "../test/fixtures/machine-model.wire.json";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  MODEL_UNREADABLE_REASON,
  factText,
  inEffectCounts,
  readMachineModel,
  useMachineModel,
} from "./machine-model";

const MODEL = wire as unknown as MachineModel;

beforeEach(() => {
  invokeMock.mockReset();
  invalidateProbe();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readMachineModel", () => {
  it("gives null when the backend call is rejected — never a default model", async () => {
    invokeMock.mockRejectedValue(new Error("ipc down"));
    await expect(readMachineModel()).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("get_machine_model");
  });

  it("does not cache a failed read", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ipc down")).mockResolvedValueOnce(MODEL);
    await expect(readMachineModel()).resolves.toBeNull();
    await expect(readMachineModel()).resolves.toBe(MODEL);
  });

  it("goes back to the backend after invalidateProbe()", async () => {
    invokeMock.mockResolvedValue(MODEL);
    await readMachineModel();
    await readMachineModel();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    invalidateProbe();
    await readMachineModel();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});

describe("useMachineModel", () => {
  it("a rejected read gives null, with no zeroed model and no timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    invokeMock.mockRejectedValue(new Error("ipc down"));
    const { result } = renderHook(() => useMachineModel());
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBeNull());
    expect(vi.getTimerCount()).toBe(0);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("re-reads when the refresh token changes", async () => {
    invokeMock.mockResolvedValue(MODEL);
    const { result, rerender } = renderHook(({ t }) => useMachineModel(t), {
      initialProps: { t: 0 },
    });
    await waitFor(() => expect(result.current).toBe(MODEL));
    invalidateProbe(); // App.refresh() clears the cache before bumping its counter
    rerender({ t: 1 });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
  });

  it("re-reads after LEDGER_CHANGED_EVENT, bypassing the cache", async () => {
    invokeMock.mockResolvedValue(MODEL);
    const { result } = renderHook(() => useMachineModel());
    await waitFor(() => expect(result.current).toBe(MODEL));
    act(() => {
      window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT));
    });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
  });
});

describe("factText", () => {
  const base = { class: "unavailable", source: "hardware", freshness: "not-applicable" } as const;

  it("shows the value when known", () => {
    const f: Fact<number> = { ...base, value: 32 };
    expect(factText(f, (gb) => `${gb} GB`)).toBe("32 GB");
  });

  it("shows the unknown reason, never a zero", () => {
    const f: Fact<number> = { ...base, value: null, unknown_reason: "RAM total could not be read" };
    expect(factText(f, (gb) => `${gb} GB`)).toBe("RAM total could not be read");
  });

  it("shows the not-applicable reason", () => {
    const f: Fact<string> = { ...base, value: null, not_applicable_reason: "never rolled back" };
    expect(factText(f)).toBe("never rolled back");
  });

  it("keeps a false boolean as a value", () => {
    const f: Fact<boolean> = { ...base, value: false };
    expect(factText(f)).toBe("false");
  });

  it("uses the unknown fact from the wire fixture as-is", () => {
    expect(factText(MODEL.identity.windows)).toBe(MODEL.identity.windows.unknown_reason);
  });
});

describe("inEffectCounts — the one number a screen may print as 'in effect on this PC'", () => {
  it("not read yet → pending, never a stand-in zero", () => {
    expect(inEffectCounts(undefined)).toEqual({ kind: "pending" });
  });

  it("a failed read → unreadable with a reason, never counted", () => {
    expect(inEffectCounts(null)).toEqual({ kind: "unreadable", reason: MODEL_UNREADABLE_REASON });
  });

  it("a model whose own ledger read failed → unreadable with the model's reason, counts ignored", () => {
    const m: MachineModel = {
      ...MODEL,
      compy_changes: { ...MODEL.compy_changes, ledger_unreadable: "history.json is locked" },
    };
    expect(inEffectCounts(m)).toEqual({ kind: "unreadable", reason: "history.json is locked" });
  });

  it("a readable model → active_now, the live-check unknowns and the total, straight off the wire", () => {
    expect(inEffectCounts(MODEL)).toEqual({
      kind: "counted",
      activeNow: 1,
      unknown: 0,
      totalRecorded: 2,
    });
  });
});

describe("one read in flight is shared — surfaces mounting together cost one IPC (#452)", () => {
  it("concurrent readMachineModel() calls resolve off one backend call", async () => {
    let release!: (m: MachineModel) => void;
    invokeMock.mockImplementation(() => new Promise((r) => (release = r)));
    const a = readMachineModel();
    const b = readMachineModel();
    await Promise.resolve(); // the fetcher starts on the next tick
    expect(invokeMock).toHaveBeenCalledTimes(1);
    release(MODEL);
    await expect(a).resolves.toBe(MODEL);
    await expect(b).resolves.toBe(MODEL);
  });

  it("two hooks mounted in the same tick share the read", async () => {
    invokeMock.mockResolvedValue(MODEL);
    const h1 = renderHook(() => useMachineModel());
    const h2 = renderHook(() => useMachineModel());
    await waitFor(() => expect(h1.result.current).toBe(MODEL));
    await waitFor(() => expect(h2.result.current).toBe(MODEL));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("a shared failure is not cached: the next call goes back to the backend", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ipc down")).mockResolvedValueOnce(MODEL);
    const [a, b] = await Promise.all([readMachineModel(), readMachineModel()]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await expect(readMachineModel()).resolves.toBe(MODEL);
  });

  it("invalidateProbe() while a read is in flight: that read's result is never cached as fresh", async () => {
    const STALE = { ...MODEL, built_at: "stale" } as MachineModel;
    let releaseStale!: (m: MachineModel) => void;
    let releaseFresh!: (m: MachineModel) => void;
    invokeMock
      .mockImplementationOnce(() => new Promise((r) => (releaseStale = r)))
      .mockImplementationOnce(() => new Promise((r) => (releaseFresh = r)));
    const stale = readMachineModel();
    await Promise.resolve();
    invalidateProbe(); // App.refresh() after an apply: the caller wants a read that saw the write
    const fresh = readMachineModel();
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(2);
    releaseStale(STALE);
    await expect(stale).resolves.toBe(STALE);
    releaseFresh(MODEL);
    await expect(fresh).resolves.toBe(MODEL);
    // The cache holds the fresh read, and proving it costs no third IPC.
    await expect(readMachineModel()).resolves.toBe(MODEL);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
