import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "../i18n";
import { LiveCharts } from "../surfaces/LiveCharts";
import { GIB, installedRamGB, ramGB, usableRam, usableRamWhole, usedOfUsableRam } from "./ram-format";

// view-1121b: the same 2 x 16 GB PC read "33.7 GB" on one screen and "31.4 GB" on another. One helper,
// one meaning: GB = 1024^3 (Windows' GB); installed = the module sum; usable = Windows' total, labelled.
const USABLE_BYTES = Math.round(31.4 * GIB); // what Windows left usable on that PC (33.7e9 decimal)
const USED_BYTES = Math.round(19.6 * GIB);

// A screen, not arithmetic: the Monitor's live memory card, fed the sensor read of that PC.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_cpu_sensors") {
      return Promise.resolve({
        usage_overall_pct: 10,
        frequency_mhz: 4500,
        ram_used_bytes: Math.round(19.6 * 1024 ** 3),
        ram_total_bytes: Math.round(31.4 * 1024 ** 3),
      });
    }
    return Promise.resolve([]);
  }),
}));

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("ram-format: one meaning for memory sizes", () => {
  it("a screen that shows the usable total prints 31.4 GB usable (en) and never the decimal 33.7", async () => {
    const { container } = render(<LiveCharts />);
    await screen.findByText("19.6 / 31.4 GB usable");
    expect(container.textContent).not.toMatch(/33\.7|31 GB\b(?! usable)/);
  });

  it("the same screen says it in Chinese, with the total named as the usable total", async () => {
    await i18n.changeLanguage("zh-CN");
    render(<LiveCharts />);
    await screen.findByText("已用 19.6 GB / 可用总量 31.4 GB");
  });

  it("divides by 1024^3, so the usable total is 31.4 and never the decimal 33.7", () => {
    expect(ramGB(USABLE_BYTES)).toBe("31.4");
    expect(ramGB(USABLE_BYTES)).not.toBe("33.7");
    expect(ramGB(32 * GIB)).toBe("32.0");
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

  it("installed memory is null when ANY module is unread, never a partial sum ('16 GB' on a 32 GB PC)", () => {
    expect(installedRamGB([{ capacity_bytes: 16 * GIB }, { capacity_bytes: 0 }])).toBeNull();
    expect(installedRamGB([{ capacity_bytes: 16 * GIB }, { capacity_bytes: -1 }])).toBeNull();
    expect(installedRamGB([{ capacity_bytes: 16 * GIB }, { capacity_bytes: Number.NaN }])).toBeNull();
  });

  it("usable memory is always written 'usable' (en), with or without a translator", async () => {
    await i18n.changeLanguage("en");
    expect(usableRam(i18n.t, USABLE_BYTES)).toBe("31.4 GB usable");
    expect(usedOfUsableRam(i18n.t, USED_BYTES, USABLE_BYTES)).toBe("19.6 / 31.4 GB usable");
    expect(usableRam(undefined, USABLE_BYTES)).toBe("31.4 GB usable");
    expect(usedOfUsableRam(undefined, USED_BYTES, USABLE_BYTES)).toBe("19.6 / 31.4 GB usable");
    expect(usableRamWhole(i18n.t, 31)).toBe("31 GB usable");
    expect(usableRamWhole(undefined, 31)).toBe("31 GB usable");
  });

  it("the Lab evidence memory row names its denominator as the usable total (en + zh)", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("lab.labConsole.evidence.reading.memory")).toBe("In use, of usable");
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("lab.labConsole.evidence.reading.memory")).toContain("可用总量");
  });

  it("says it in Chinese with the same numbers; the total is the 可用总量 (usable total), never a bare 可用 (free)", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(usableRam(i18n.t, USABLE_BYTES)).toBe("可用总量 31.4 GB");
    expect(usedOfUsableRam(i18n.t, USED_BYTES, USABLE_BYTES)).toBe("已用 19.6 GB / 可用总量 31.4 GB");
    expect(usableRamWhole(i18n.t, 31)).toBe("可用总量 31 GB");
  });
});

// The screens cannot drift back to a private divisor: every memory total goes through ram-format.
const SOURCES = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// A byte-to-GB divisor in ANY spelling: decimal (1e9, 1_000_000_000, 1000 ** 3, 1000 * 1000 * 1000) or
// binary (1024 ** 3, 1073741824, 1_073_741_824, 1024 * 1024 * 1024, / 1024 / 1024 / 1024).
const DIVISOR =
  /(1e9\b|1_?000_?000_?000\b|1000\s*\*\*\s*3|1000\s*\*\s*1000\s*\*\s*1000|1024\s*\*\*\s*3|1_?073_?741_?824\b|1024\s*\*\s*1024\s*\*\s*1024|\/\s*1024\s*\/\s*1024\s*\/\s*1024)/;
const MEMORY_WORD = /\b(ram|memory|mem)\w*/i;
// import.meta.glob keys are relative to THIS file (src/data), so the helper itself is "./ram-format.ts".
const ownsMemoryDivisor = (file: string) => file === "./ram-format.ts";

describe("no screen keeps its own memory divisor", () => {
  it("no non-test source outside ram-format.ts divides memory by a GB divisor of its own", () => {
    const hits: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      if (ownsMemoryDivisor(file)) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        if (DIVISOR.test(line) && MEMORY_WORD.test(line)) hits.push(`${file}:${i + 1}`);
      });
    }
    expect(hits, `a private memory GB divisor is back in: ${hits.join(", ")}`).toEqual([]);
  });

  it("the scan itself catches every spelling (it is not vacuous)", () => {
    for (const s of [
      "ram_total_bytes / 1e9",
      "ramBytes / 1_000_000_000",
      "ram / 1000 ** 3",
      "ram / (1000 * 1000 * 1000)",
      "ram / 1024 ** 3",
      "memory / 1073741824",
      "memory / 1_073_741_824",
      "mem / (1024 * 1024 * 1024)",
      "ram / 1024 / 1024 / 1024",
    ]) {
      expect(DIVISOR.test(s) && MEMORY_WORD.test(s), s).toBe(true);
    }
  });

  it("nothing keeps its own GIB constant: they import the one in ram-format", () => {
    const own = Object.entries(SOURCES)
      .filter(([file, text]) => !ownsMemoryDivisor(file) && /\bconst\s+GIB\s*=/.test(text))
      .map(([file]) => file);
    expect(own, `a private GIB constant: ${own.join(", ")}`).toEqual([]);
  });

  it("the Home surfaces use the shared helper, not a local fmtGB1", () => {
    for (const f of ["../surfaces/HomeConsole.tsx", "../surfaces/HomeHud.tsx", "../surfaces/HomeV2.tsx"]) {
      const text = SOURCES[f];
      expect(text, `${f} not scanned`).toBeTruthy();
      expect(text, `${f} has its own RAM formatter`).not.toMatch(/fmtGB1/);
      expect(text, `${f} does not use ram-format`).toMatch(/ram-format/);
    }
  });

  it("the other memory readouts use ram-format too (live card, care step, debrief, stamp label)", () => {
    for (const f of ["../surfaces/LiveCharts.tsx", "../surfaces/CareNextStep.tsx", "../surfaces/SessionDebrief.tsx", "../surfaces/Fix.tsx"]) {
      expect(SOURCES[f], `${f} not scanned`).toBeTruthy();
      expect(SOURCES[f], `${f} does not use ram-format`).toMatch(/ram-format/);
    }
  });
});
