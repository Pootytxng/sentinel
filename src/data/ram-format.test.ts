import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { GIB, installedRamGB, ramGB, usableRam, usedOfUsableRam } from "./ram-format";

// view-1121b: the same 2 x 16 GB PC read "33.7 GB" on one screen and "31.4 GB" on another. One helper,
// one meaning: GB = 1024^3 (Windows' GB); installed = the module sum; usable = Windows' total, labelled.
const USABLE_BYTES = Math.round(31.4 * GIB); // what Windows left usable on that PC (33.7e9 decimal)

describe("ram-format: one meaning for memory sizes", () => {
  it("divides by 1024^3, so the usable total is 31.4 and never the decimal 33.7", () => {
    expect(ramGB(USABLE_BYTES)).toBe("31.4");
    expect((USABLE_BYTES / 1e9).toFixed(1)).toBe("33.7"); // the number the card printed
    expect(ramGB(USABLE_BYTES)).not.toBe("33.7");
  });

  it("installed memory is the sum of the modules as a whole number: 2 x 16 GB is 32", () => {
    expect(installedRamGB([{ capacity_bytes: 16 * GIB }, { capacity_bytes: 16 * GIB }])).toBe(32);
    expect(installedRamGB([{ capacity_bytes: 8 * GIB }])).toBe(8);
  });

  it("installed memory is null when no module size was read (never 0 GB)", () => {
    expect(installedRamGB([])).toBeNull();
    expect(installedRamGB(null)).toBeNull();
    expect(installedRamGB([{ capacity_bytes: 0 }])).toBeNull();
  });

  it("usable memory is always written 'usable' (en), with or without a translator", async () => {
    await i18n.changeLanguage("en");
    expect(usableRam(i18n.t, USABLE_BYTES)).toBe("31.4 GB usable");
    expect(usedOfUsableRam(i18n.t, Math.round(19.6 * GIB), USABLE_BYTES)).toBe("19.6 / 31.4 GB usable");
    expect(usableRam(undefined, USABLE_BYTES)).toBe("31.4 GB usable");
    expect(usedOfUsableRam(undefined, Math.round(19.6 * GIB), USABLE_BYTES)).toBe("19.6 / 31.4 GB usable");
  });

  it("says it in Chinese with the same numbers", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      expect(usableRam(i18n.t, USABLE_BYTES)).toBe("可用 31.4 GB");
      expect(usedOfUsableRam(i18n.t, Math.round(19.6 * GIB), USABLE_BYTES)).toBe("已用 19.6 / 可用 31.4 GB");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// The screens cannot drift back to a private divisor: every RAM total goes through ram-format.
const SOURCES = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("no screen keeps its own memory divisor", () => {
  it("no non-test source divides a byte count by a decimal gigabyte", () => {
    const hits = Object.entries(SOURCES)
      .filter(([, text]) => /\/\s*(1e9|1_000_000_000|1000\s*\*\*\s*3|1000\s*\*\s*1000\s*\*\s*1000)\b/.test(text))
      .map(([file]) => file);
    expect(hits, `a decimal GB divisor is back in: ${hits.join(", ")}`).toEqual([]);
  });

  it("the Home surfaces use the shared helper, not a local fmtGB1", () => {
    for (const f of ["../surfaces/HomeConsole.tsx", "../surfaces/HomeHud.tsx", "../surfaces/HomeV2.tsx"]) {
      const text = SOURCES[f];
      expect(text, `${f} not scanned`).toBeTruthy();
      expect(text, `${f} has its own RAM formatter`).not.toMatch(/fmtGB1/);
      expect(text, `${f} does not use ram-format`).toMatch(/ram-format/);
    }
  });
});
