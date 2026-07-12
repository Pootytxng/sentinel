import { describe, it, expect, vi, beforeEach } from "vitest";
import { readExpertView, setExpertView } from "./use-expert-view";

// Expert view preference guards (spec 2026-07-11-expert-layer-middle-ground): a genuine user
// preference like Motion — default OFF (the skeptic's face is the default face), persisted,
// live-notifying. The default matters most: shipping this ON would put the full technical panel
// in front of every first-contact user.

const KEY = "compy_expert_view";
const EVENT = "compy:expert-view";

beforeEach(() => localStorage.clear());

describe("readExpertView", () => {
  it("defaults OFF when localStorage is unset (the default face stays the simple one)", () => {
    expect(readExpertView()).toBe(false);
  });

  it("returns true only for the stored '1'", () => {
    localStorage.setItem(KEY, "1");
    expect(readExpertView()).toBe(true);
  });

  it("returns false for the stored '0'", () => {
    localStorage.setItem(KEY, "0");
    expect(readExpertView()).toBe(false);
  });

  it("returns false for any garbage value", () => {
    localStorage.setItem(KEY, "expert");
    expect(readExpertView()).toBe(false);
  });
});

describe("setExpertView", () => {
  it("persists on/off round-trip", () => {
    setExpertView(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(readExpertView()).toBe(true);
    setExpertView(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(readExpertView()).toBe(false);
  });

  it("dispatches the compy:expert-view event so mounted surfaces update live", () => {
    const handler = vi.fn();
    window.addEventListener(EVENT, handler);
    try {
      setExpertView(true);
      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler.mock.calls[0][0] as CustomEvent).type).toBe(EVENT);
    } finally {
      window.removeEventListener(EVENT, handler);
    }
  });
});
