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
  it("defaults to halfway when unset", () => {
    expect(readInstrumentTheme()).toBe("halfway");
  });

  it("applies + persists a theme and sets data-itheme on <html>", () => {
    applyInstrumentTheme("midnight");
    expect(localStorage.getItem("compy_theme")).toBe("midnight");
    expect(document.documentElement.dataset.itheme).toBe("midnight");
    expect(readInstrumentTheme()).toBe("midnight");
  });

  it("falls back to halfway on a junk stored value", () => {
    localStorage.setItem("compy_theme", "synthwave");
    expect(readInstrumentTheme()).toBe("halfway");
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
