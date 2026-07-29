import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDismissed } from "./dismissed";

const KEY = "compy_dismissed_recs";

describe("useDismissed", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty when nothing is stored", () => {
    const { result } = renderHook(() => useDismissed());
    expect(result.current.dismissed.size).toBe(0);
  });

  it("loads a pre-seeded list from localStorage (coerced to strings)", () => {
    localStorage.setItem(KEY, JSON.stringify(["game-mode", "hags-enable"]));
    const { result } = renderHook(() => useDismissed());
    expect(result.current.dismissed.has("game-mode")).toBe(true);
    expect(result.current.dismissed.has("hags-enable")).toBe(true);
    expect(result.current.dismissed.size).toBe(2);
  });

  it("dismiss adds an id and persists it", () => {
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss("sysmain-disable"));
    expect(result.current.dismissed.has("sysmain-disable")).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toContain("sysmain-disable");
  });

  it("dismiss is idempotent (no duplicate)", () => {
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss("x"));
    act(() => result.current.dismiss("x"));
    expect(result.current.dismissed.size).toBe(1);
  });

  it("restore removes an id and persists the removal (un-dismiss is always offered)", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", "b"]));
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.restore("a"));
    expect(result.current.dismissed.has("a")).toBe(false);
    expect(result.current.dismissed.has("b")).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["b"]);
  });

  // GUARD (self-review round 8): the hook used to be `useState(read)`, so every caller held its OWN
  // set and they desynced the moment one dismissed something. Live symptom: the Lab's safe-stack
  // ring said "1 left to enable below" three lines above Fix's "Nothing waiting" — same screen,
  // same render, two answers. Four surfaces share this state (Check, Fix, LabDeck, OptimizeStation),
  // so "one set per session" is the invariant, not an optimization.
  it("shares ONE set across concurrent callers — a dismiss in one is visible in the others", () => {
    const a = renderHook(() => useDismissed());
    const b = renderHook(() => useDismissed());
    act(() => a.result.current.dismiss("game-mode"));
    expect(a.result.current.dismissed.has("game-mode")).toBe(true);
    expect(b.result.current.dismissed.has("game-mode")).toBe(true);
    // ...and the same for the un-dismiss direction, from the OTHER caller.
    act(() => b.result.current.restore("game-mode"));
    expect(b.result.current.dismissed.has("game-mode")).toBe(false);
    expect(a.result.current.dismissed.has("game-mode")).toBe(false);
  });

  it("degrades to empty on malformed or non-array stored JSON (never throws)", () => {
    localStorage.setItem(KEY, "{not json");
    expect(renderHook(() => useDismissed()).result.current.dismissed.size).toBe(0);
    localStorage.setItem(KEY, JSON.stringify({ not: "an array" }));
    expect(renderHook(() => useDismissed()).result.current.dismissed.size).toBe(0);
  });
});
