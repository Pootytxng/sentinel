import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readMotionPref,
  resolveReduced,
  applyMotionAttribute,
  setMotionPref,
} from "./use-motion";

const KEY = "compy_motion";
const EVENT = "compy:motion";

// Helper: make window.matchMedia return a fixed `matches` value (jsdom doesn't implement it).
const stubMatchMedia = (matches: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-motion");
  // Reset matchMedia to a known-absent baseline; cases that need it stub it explicitly.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("readMotionPref", () => {
  // Direction D gate, 2026-08-01: the default is "system" — Windows is the authority. The
  // 2026-06-19 "full" default (deliberately overriding the OS) was overturned as an
  // accessibility conflict. These three cases are the guard on that flip.
  it("defaults to 'system' when localStorage is unset (Windows is the authority)", () => {
    expect(readMotionPref()).toBe("system");
  });

  it("returns the stored 'full'", () => {
    localStorage.setItem(KEY, "full");
    expect(readMotionPref()).toBe("full");
  });

  it("returns the stored 'system'", () => {
    localStorage.setItem(KEY, "system");
    expect(readMotionPref()).toBe("system");
  });

  it("returns the stored 'reduced'", () => {
    localStorage.setItem(KEY, "reduced");
    expect(readMotionPref()).toBe("reduced");
  });

  it("falls back to 'system' for an invalid stored value", () => {
    localStorage.setItem(KEY, "sideways");
    expect(readMotionPref()).toBe("system");
  });

  it("falls back to 'system' for an empty stored value", () => {
    localStorage.setItem(KEY, "");
    expect(readMotionPref()).toBe("system");
  });
});

describe("resolveReduced", () => {
  it("'full' resolves to false (an explicit user override, honoured)", () => {
    expect(resolveReduced("full")).toBe(false);
  });

  it("'reduced' resolves to true (force calm)", () => {
    expect(resolveReduced("reduced")).toBe(true);
  });

  it("'system' follows matchMedia when the OS asks to reduce", () => {
    stubMatchMedia(true);
    expect(resolveReduced("system")).toBe(true);
  });

  it("'system' follows matchMedia when the OS does not ask to reduce", () => {
    stubMatchMedia(false);
    expect(resolveReduced("system")).toBe(false);
  });

  it("'system' is false when matchMedia throws / is unavailable", () => {
    // matchMedia deleted in beforeEach → calling it throws → module try/catch returns false.
    expect(resolveReduced("system")).toBe(false);
  });

  it("'system' is false when matchMedia itself throws", () => {
    window.matchMedia = vi.fn(() => {
      throw new Error("boom");
    });
    expect(resolveReduced("system")).toBe(false);
  });

  it("default-arg form reads the stored pref ('reduced' → true)", () => {
    localStorage.setItem(KEY, "reduced");
    expect(resolveReduced()).toBe(true);
  });

  it("default-arg form reads the stored pref ('full' → false)", () => {
    localStorage.setItem(KEY, "full");
    expect(resolveReduced()).toBe(false);
  });

  // THE regression this default flip exists to prevent: a user who has never opened Compy's
  // settings, but HAS turned reduce-motion on in Windows, must get calm motion.
  it("an UNSET pref follows Windows when the OS asks to reduce", () => {
    stubMatchMedia(true);
    expect(resolveReduced()).toBe(true);
  });

  it("an UNSET pref leaves motion on when the OS does not ask to reduce", () => {
    stubMatchMedia(false);
    expect(resolveReduced()).toBe(false);
  });

  it("an explicit 'full' still wins over a Windows reduce-motion setting", () => {
    localStorage.setItem(KEY, "full");
    stubMatchMedia(true);
    expect(resolveReduced()).toBe(false);
  });
});

describe("applyMotionAttribute", () => {
  it("sets data-motion='full' on the default pref when the OS is quiet about it", () => {
    stubMatchMedia(false);
    applyMotionAttribute();
    expect(document.documentElement.dataset.motion).toBe("full");
  });

  it("sets data-motion='reduced' on the DEFAULT pref when Windows asks to reduce", () => {
    stubMatchMedia(true);
    applyMotionAttribute();
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("sets data-motion='reduced' when the pref forces calm", () => {
    localStorage.setItem(KEY, "reduced");
    applyMotionAttribute();
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("sets data-motion='reduced' in 'system' mode when the OS asks to reduce", () => {
    localStorage.setItem(KEY, "system");
    stubMatchMedia(true);
    applyMotionAttribute();
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("sets data-motion='full' in 'system' mode when the OS does not ask to reduce", () => {
    localStorage.setItem(KEY, "system");
    stubMatchMedia(false);
    applyMotionAttribute();
    expect(document.documentElement.dataset.motion).toBe("full");
  });

  it("sets data-motion='full' when the user explicitly overrode to full, OS notwithstanding", () => {
    localStorage.setItem(KEY, "full");
    stubMatchMedia(true);
    applyMotionAttribute();
    expect(document.documentElement.dataset.motion).toBe("full");
  });
});

describe("setMotionPref", () => {
  it("writes the pref to localStorage", () => {
    setMotionPref("reduced");
    expect(localStorage.getItem(KEY)).toBe("reduced");
  });

  it("updates the data-motion attribute to match the new pref", () => {
    setMotionPref("reduced");
    expect(document.documentElement.dataset.motion).toBe("reduced");

    setMotionPref("full");
    expect(document.documentElement.dataset.motion).toBe("full");
  });

  it("dispatches a 'compy:motion' CustomEvent", () => {
    const handler = vi.fn();
    window.addEventListener(EVENT, handler);
    try {
      setMotionPref("reduced");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBeInstanceOf(CustomEvent);
      expect((handler.mock.calls[0][0] as CustomEvent).type).toBe(EVENT);
    } finally {
      window.removeEventListener(EVENT, handler);
    }
  });

  it("persists, mirrors, and notifies together for one call", () => {
    const handler = vi.fn();
    window.addEventListener(EVENT, handler);
    try {
      setMotionPref("system");
      expect(localStorage.getItem(KEY)).toBe("system");
      // 'system' with no matchMedia (deleted in beforeEach) → not reduced → "full".
      expect(document.documentElement.dataset.motion).toBe("full");
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(EVENT, handler);
    }
  });
});
