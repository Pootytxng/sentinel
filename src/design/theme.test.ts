import { describe, it, expect, afterEach } from "vitest";
import {
  readInstrumentTheme,
  applyInstrumentTheme,
  readAmbiance,
  persistAmbiance,
  readSlimRows,
  applySlimRows,
  readBasicAdvanced,
  applyBasicAdvanced,
  readViewMode,
  applyViewMode,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.itheme;
  delete document.documentElement.dataset.slimRows;
  delete document.documentElement.dataset.basicAdvanced;
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

describe("slim rows (P1 UI slim-down — HARD LINE: default OFF)", () => {
  it("defaults OFF when unset", () => {
    expect(readSlimRows()).toBe(false);
  });

  it('returns true ONLY on the exact "1" opt-in', () => {
    localStorage.setItem("compy_slim_rows", "on"); // junk value ≠ opt-in
    expect(readSlimRows()).toBe(false);
    localStorage.setItem("compy_slim_rows", "1");
    expect(readSlimRows()).toBe(true);
  });

  it("applySlimRows sets/clears data-slim-rows on <html> and persists", () => {
    applySlimRows(true);
    expect(document.documentElement.dataset.slimRows).toBe("on");
    expect(readSlimRows()).toBe(true);
    applySlimRows(false);
    expect(document.documentElement.dataset.slimRows).toBeUndefined();
    expect(readSlimRows()).toBe(false);
  });
});

describe("basic/advanced split (P2 UI slim-down — HARD LINE: default OFF)", () => {
  it("defaults OFF when unset; true ONLY on the exact \"1\" opt-in", () => {
    expect(readBasicAdvanced()).toBe(false);
    localStorage.setItem("compy_basic_advanced", "on"); // junk value ≠ opt-in
    expect(readBasicAdvanced()).toBe(false);
    localStorage.setItem("compy_basic_advanced", "1");
    expect(readBasicAdvanced()).toBe(true);
  });

  it("applyBasicAdvanced sets/clears data-basic-advanced on <html> and persists", () => {
    applyBasicAdvanced(true);
    expect(document.documentElement.dataset.basicAdvanced).toBe("on");
    expect(readBasicAdvanced()).toBe(true);
    applyBasicAdvanced(false);
    expect(document.documentElement.dataset.basicAdvanced).toBeUndefined();
    expect(readBasicAdvanced()).toBe(false);
  });

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

describe("ambiance", () => {
  it("defaults to full", () => {
    expect(readAmbiance()).toBe("full");
  });

  it("persists + reads back a choice", () => {
    persistAmbiance("calm");
    expect(readAmbiance()).toBe("calm");
  });

  it("falls back to full on a junk stored value", () => {
    localStorage.setItem("compy_ambiance", "ludicrous");
    expect(readAmbiance()).toBe("full");
  });
});
