import { describe, it, expect, afterEach } from "vitest";
import { readInstrumentTheme, applyInstrumentTheme } from "./theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.itheme;
});

describe("instrument theme", () => {
  it("defaults to violet when unset", () => {
    expect(readInstrumentTheme()).toBe("violet");
  });

  it("applies + persists a theme and sets data-itheme on <html>", () => {
    applyInstrumentTheme("violet");
    expect(localStorage.getItem("compy_theme")).toBe("violet");
    expect(document.documentElement.dataset.itheme).toBe("violet");
    expect(readInstrumentTheme()).toBe("violet");
  });

  it("falls back to violet on a junk stored value", () => {
    localStorage.setItem("compy_theme", "ludicrous");
    expect(readInstrumentTheme()).toBe("violet");
  });
});

// (The basic/advanced ViewMode cases were retired with the mode itself in the 2026-08-20
// comprehensibility sweep, issue #180 — see monitor-one-face-guard.test.tsx.)
