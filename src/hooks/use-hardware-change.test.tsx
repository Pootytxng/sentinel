import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Settable per-test invoke behaviour (vi.mock factories are hoisted — this must be too).
const invokeMock = vi.hoisted(() => ({
  report: {
    changed: false,
    changes: [] as string[],
    baseline_recorded: false,
  },
  ackShouldThrow: false,
  ackCalls: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_hardware_changes") return Promise.resolve(invokeMock.report);
    if (cmd === "acknowledge_hardware_changes") {
      invokeMock.ackCalls += 1;
      return invokeMock.ackShouldThrow
        ? Promise.reject(new Error("write failed"))
        : Promise.resolve(null);
    }
    return Promise.resolve(null);
  }),
}));

import {
  useHardwareChange,
  summarizeHardwareChanges,
  HW_CHANGE_MAX_VISIBLE,
} from "./use-hardware-change";
import { invalidateProbe } from "../data/probe-cache";

beforeEach(() => {
  invokeMock.report = { changed: false, changes: [], baseline_recorded: false };
  invokeMock.ackShouldThrow = false;
  invokeMock.ackCalls = 0;
  invalidateProbe(); // clear the module-level probe cache so each test detects fresh
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- summarizeHardwareChanges (pure overflow handling) --------------------------------

describe("summarizeHardwareChanges (overflow handling)", () => {
  it("returns every change verbatim when under the cap", () => {
    const changes = ["CPU changed: A → B", "RAM changed: 16 GB → 32 GB"];
    const s = summarizeHardwareChanges(changes, 5);
    expect(s.visible).toEqual(changes);
    expect(s.overflow).toBe(0);
    expect(s.overflowLabel).toBeNull();
  });

  it("caps the visible list and reports the overflow count", () => {
    const changes = ["a", "b", "c", "d", "e"];
    const s = summarizeHardwareChanges(changes, 3);
    expect(s.visible).toEqual(["a", "b", "c"]);
    expect(s.overflow).toBe(2);
    expect(s.overflowLabel).toBe("and 2 more changes");
  });

  it("uses singular copy for exactly one overflow item", () => {
    const s = summarizeHardwareChanges(["a", "b", "c", "d"], 3);
    expect(s.overflow).toBe(1);
    expect(s.overflowLabel).toBe("and 1 more change");
  });

  it("is exactly at the cap → no overflow", () => {
    const changes = ["a", "b", "c"];
    const s = summarizeHardwareChanges(changes, 3);
    expect(s.visible).toEqual(changes);
    expect(s.overflow).toBe(0);
    expect(s.overflowLabel).toBeNull();
  });

  it("empty input is safe", () => {
    const s = summarizeHardwareChanges([], 3);
    expect(s.visible).toEqual([]);
    expect(s.overflow).toBe(0);
    expect(s.overflowLabel).toBeNull();
  });

  it("a non-positive cap never divides by zero and shows nothing but the overflow tail", () => {
    const s = summarizeHardwareChanges(["a", "b"], 0);
    expect(s.visible).toEqual([]);
    expect(s.overflow).toBe(2);
    expect(s.overflowLabel).toBe("and 2 more changes");
  });

  it("exposes a sane default cap", () => {
    expect(HW_CHANGE_MAX_VISIBLE).toBeGreaterThan(0);
  });
});

// ---- useHardwareChange (detect + re-baseline flow) ------------------------------------

describe("useHardwareChange", () => {
  it("detects a change on mount", async () => {
    invokeMock.report = {
      changed: true,
      changes: ["GPU changed: X → Y"],
      baseline_recorded: false,
    };
    const { result } = renderHook(() => useHardwareChange());
    await waitFor(() => expect(result.current.report?.changed).toBe(true));
    expect(result.current.report?.changes).toEqual(["GPU changed: X → Y"]);
  });

  it("reports no change when hardware is unchanged", async () => {
    const { result } = renderHook(() => useHardwareChange());
    await waitFor(() => expect(result.current.report).not.toBeNull());
    expect(result.current.report?.changed).toBe(false);
  });

  it("acknowledge() re-baselines and clears the flagged change", async () => {
    invokeMock.report = {
      changed: true,
      changes: ["CPU changed: A → B"],
      baseline_recorded: false,
    };
    const { result } = renderHook(() => useHardwareChange());
    await waitFor(() => expect(result.current.report?.changed).toBe(true));

    await act(async () => {
      await result.current.acknowledge();
    });

    expect(invokeMock.ackCalls).toBe(1);
    expect(result.current.report?.changed).toBe(false);
    expect(result.current.report?.changes).toEqual([]);
  });

  it("acknowledge() leaves the flag up when the re-baseline write fails", async () => {
    invokeMock.report = {
      changed: true,
      changes: ["CPU changed: A → B"],
      baseline_recorded: false,
    };
    invokeMock.ackShouldThrow = true;
    const { result } = renderHook(() => useHardwareChange());
    await waitFor(() => expect(result.current.report?.changed).toBe(true));

    await act(async () => {
      await result.current.acknowledge();
    });

    // write failed → the change is still shown so the user can retry (no false "cleared").
    expect(result.current.report?.changed).toBe(true);
    expect(result.current.acknowledging).toBe(false);
  });
});
