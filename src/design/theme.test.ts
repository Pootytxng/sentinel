import { describe, it, expect, afterEach } from "vitest";
import {
  readInstrumentTheme,
  applyInstrumentTheme,
  readViewMode,
  applyViewMode,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.itheme;
  delete document.documentElement.dataset.viewMode;
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

describe("basic/advanced view mode", () => {
  it("view mode defaults to basic (answer first), persists, and mirrors onto <html>", () => {
    expect(readViewMode()).toBe("basic");
    localStorage.setItem("compy_view_mode", "ludicrous"); // junk → basic
    expect(readViewMode()).toBe("basic");
    applyViewMode("advanced");
    expect(readViewMode()).toBe("advanced");
    expect(document.documentElement.dataset.viewMode).toBe("advanced");
    applyViewMode("basic");
    expect(document.documentElement.dataset.viewMode).toBe("basic");
  });
});
