import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useGpuProfileScope } from "./use-gpu-profile-scope";
import { GPU_SCOPE_KEY } from "../data/profile-store";

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("useGpuProfileScope", () => {
  it("starts at the default scope (global) when nothing is saved", () => {
    const { result } = renderHook(() => useGpuProfileScope());
    expect(result.current.scope).toBe("global");
  });

  it("reads the saved scope on mount", () => {
    localStorage.setItem(GPU_SCOPE_KEY, "per-game");
    const { result } = renderHook(() => useGpuProfileScope());
    expect(result.current.scope).toBe("per-game");
  });

  it("setScope updates state and persists", () => {
    const { result } = renderHook(() => useGpuProfileScope());
    act(() => result.current.setScope("per-game"));
    expect(result.current.scope).toBe("per-game");
    expect(localStorage.getItem(GPU_SCOPE_KEY)).toBe("per-game");
  });

  it("syncs from a cross-window storage event", () => {
    const { result } = renderHook(() => useGpuProfileScope());
    localStorage.setItem(GPU_SCOPE_KEY, "per-game");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: GPU_SCOPE_KEY }));
    });
    expect(result.current.scope).toBe("per-game");
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useGpuProfileScope());
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "something_else" }));
    });
    expect(result.current.scope).toBe("global");
  });
});
