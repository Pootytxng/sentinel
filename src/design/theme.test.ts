import { describe, it, expect, afterEach } from "vitest";
import {
  readInstrumentTheme,
  applyInstrumentTheme,
  readAmbiance,
  persistAmbiance,
  readAmbianceChoice,
  readSlimRows,
  applySlimRows,
  readBasicAdvanced,
  applyBasicAdvanced,
  readViewMode,
  applyViewMode,
  readHomeV3,
  applyHomeV3,
  readCalmChrome,
  applyCalmChrome,
  readGmDoor,
  applyGmDoor,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.itheme;
  delete document.documentElement.dataset.slimRows;
  delete document.documentElement.dataset.basicAdvanced;
  delete document.documentElement.dataset.viewMode;
  delete document.documentElement.dataset.homeV3;
  delete document.documentElement.dataset.calmChrome;
  delete document.documentElement.dataset.gmDoor;
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

describe("slim rows (P1 UI slim-down — DEFAULT ON, owner call 2026-07-02)", () => {
  it("defaults ON when unset; OFF only on the exact \"0\" opt-out", () => {
    expect(readSlimRows()).toBe(true);
    localStorage.setItem("compy_slim_rows", "junk"); // junk value ≠ opt-out
    expect(readSlimRows()).toBe(true);
    localStorage.setItem("compy_slim_rows", "0");
    expect(readSlimRows()).toBe(false);
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

describe("basic/advanced split (P2 UI slim-down — DEFAULT ON, owner call 2026-07-02)", () => {
  it("defaults ON when unset; OFF only on the exact \"0\" opt-out", () => {
    expect(readBasicAdvanced()).toBe(true);
    localStorage.setItem("compy_basic_advanced", "junk"); // junk value ≠ opt-out
    expect(readBasicAdvanced()).toBe(true);
    localStorage.setItem("compy_basic_advanced", "0");
    expect(readBasicAdvanced()).toBe(false);
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

  it("readAmbianceChoice distinguishes an explicit pick from the default", () => {
    expect(readAmbianceChoice()).toBeNull(); // never chose → null (lets P3 re-default to calm)
    localStorage.setItem("compy_ambiance", "ludicrous"); // junk ≠ a choice
    expect(readAmbianceChoice()).toBeNull();
    persistAmbiance("off");
    expect(readAmbianceChoice()).toBe("off"); // explicit choice always wins
  });
});

describe("answer-first Home (P3 UI slim-down — DEFAULT ON, owner call 2026-07-02)", () => {
  it('defaults ON when unset; OFF only on the exact "0" opt-out', () => {
    expect(readHomeV3()).toBe(true);
    localStorage.setItem("compy_home_v3", "junk"); // junk value ≠ opt-out
    expect(readHomeV3()).toBe(true);
    localStorage.setItem("compy_home_v3", "0");
    expect(readHomeV3()).toBe(false);
  });

  it("applyHomeV3 sets/clears data-home-v3 on <html> and persists", () => {
    applyHomeV3(true);
    expect(document.documentElement.dataset.homeV3).toBe("on");
    expect(readHomeV3()).toBe(true);
    applyHomeV3(false);
    expect(document.documentElement.dataset.homeV3).toBeUndefined();
    expect(readHomeV3()).toBe(false);
  });
});

describe("calm chrome (P5 UI slim-down — DEFAULT ON, owner call 2026-07-02)", () => {
  it('defaults ON when unset; OFF only on the exact "0" opt-out', () => {
    expect(readCalmChrome()).toBe(true);
    localStorage.setItem("compy_calm_chrome", "junk"); // junk value ≠ opt-out
    expect(readCalmChrome()).toBe(true);
    localStorage.setItem("compy_calm_chrome", "0");
    expect(readCalmChrome()).toBe(false);
  });

  it("applyCalmChrome sets/clears data-calm-chrome on <html> and persists", () => {
    applyCalmChrome(true);
    expect(document.documentElement.dataset.calmChrome).toBe("on");
    expect(readCalmChrome()).toBe(true);
    applyCalmChrome(false);
    expect(document.documentElement.dataset.calmChrome).toBeUndefined();
    expect(readCalmChrome()).toBe(false);
  });
});

describe("Gaming Mode door (P5.5 — DEFAULT ON, calm-chrome flag family)", () => {
  it('defaults ON when unset; OFF only on the exact "0" opt-out', () => {
    expect(readGmDoor()).toBe(true);
    localStorage.setItem("compy_gm_door", "junk"); // junk value ≠ opt-out
    expect(readGmDoor()).toBe(true);
    localStorage.setItem("compy_gm_door", "0");
    expect(readGmDoor()).toBe(false);
  });

  it("applyGmDoor sets/clears data-gm-door on <html> and persists", () => {
    applyGmDoor(true);
    expect(document.documentElement.dataset.gmDoor).toBe("on");
    expect(readGmDoor()).toBe(true);
    applyGmDoor(false);
    expect(document.documentElement.dataset.gmDoor).toBeUndefined();
    expect(readGmDoor()).toBe(false);
  });
});
