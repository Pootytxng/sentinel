import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEligibilityOverrides } from "./eligibility-override";

const KEY = "compy_eligibility_overrides";

describe("useEligibilityOverrides", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("starts empty when nothing is stored", () => {
    const { result } = renderHook(() => useEligibilityOverrides());
    expect(result.current.overridden.size).toBe(0);
  });

  it("loads a stored list, coercing entries to strings", () => {
    localStorage.setItem(KEY, JSON.stringify(["nic-offload", 42]));
    const { result } = renderHook(() => useEligibilityOverrides());
    expect([...result.current.overridden].sort()).toEqual(["42", "nic-offload"]);
  });

  it("degrades to empty on malformed JSON or a non-array payload", () => {
    localStorage.setItem(KEY, "{not json");
    expect(renderHook(() => useEligibilityOverrides()).result.current.overridden.size).toBe(0);
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(renderHook(() => useEligibilityOverrides()).result.current.overridden.size).toBe(0);
  });

  it("override adds an id, persists it, and is idempotent", () => {
    const { result } = renderHook(() => useEligibilityOverrides());
    act(() => result.current.override("rec-a"));
    act(() => result.current.override("rec-a"));
    expect(result.current.overridden.has("rec-a")).toBe(true);
    expect(result.current.overridden.size).toBe(1);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["rec-a"]);
  });

  it("clearOverride removes an id and persists the removal (set aside again)", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", "b"]));
    const { result } = renderHook(() => useEligibilityOverrides());
    act(() => result.current.clearOverride("a"));
    expect([...result.current.overridden]).toEqual(["b"]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["b"]);
  });

  it("clearing an unknown id is a harmless no-op", () => {
    localStorage.setItem(KEY, JSON.stringify(["a"]));
    const { result } = renderHook(() => useEligibilityOverrides());
    act(() => result.current.clearOverride("missing"));
    expect([...result.current.overridden]).toEqual(["a"]);
  });

  it("returns a new Set identity on change (React re-render contract)", () => {
    const { result } = renderHook(() => useEligibilityOverrides());
    const before = result.current.overridden;
    act(() => result.current.override("x"));
    expect(result.current.overridden).not.toBe(before);
  });

  it("keeps working in memory when localStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useEligibilityOverrides());
    act(() => result.current.override("y"));
    expect(result.current.overridden.has("y")).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
