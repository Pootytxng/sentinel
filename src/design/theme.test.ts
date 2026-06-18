import { describe, it, expect, afterEach } from "vitest";
import {
  readInstrumentTheme,
  applyInstrumentTheme,
  readAmbiance,
  persistAmbiance,
} from "./theme";

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
