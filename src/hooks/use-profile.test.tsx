import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useProfile } from "./use-profile";
import { PROFILE_KEY } from "../data/profile-store";

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("useProfile", () => {
  it("starts at the default profile when nothing is saved", () => {
    const { result } = renderHook(() => useProfile());
    expect(result.current.profile).toBe("idle");
  });

  it("reads the saved profile on mount", () => {
    localStorage.setItem(PROFILE_KEY, "gaming");
    const { result } = renderHook(() => useProfile());
    expect(result.current.profile).toBe("gaming");
  });

  it("setProfile updates state and persists", () => {
    const { result } = renderHook(() => useProfile());
    act(() => result.current.setProfile("creation"));
    expect(result.current.profile).toBe("creation");
    expect(localStorage.getItem(PROFILE_KEY)).toBe("creation");
  });

  it("syncs from a cross-window storage event", () => {
    const { result } = renderHook(() => useProfile());
    localStorage.setItem(PROFILE_KEY, "streaming");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROFILE_KEY }));
    });
    expect(result.current.profile).toBe("streaming");
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useProfile());
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "something_else" }));
    });
    expect(result.current.profile).toBe("idle");
  });
});
