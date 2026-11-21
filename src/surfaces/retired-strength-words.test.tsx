import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import i18n from "../i18n";
import { ConfidenceWord, RowConfidence } from "../design/ConfidenceWord";
import { wordFromBand, wordFromBench, wordFromRow } from "../data/confidence-word";

// u3-focus 2026-11-21: History's retired-word scan (blackbook/patterns-tile.test.tsx), extended to
// every screen that went through the shared confidence vocabulary in this change: What changed,
// Hardware, the Test bench's word, Home's limiter row, Check and the First check rows, the Problems
// room (Black Box). "Likely" above "Possible" needs two independent supports; none of these
// producers proves two, so none may say it.
const RETIRED = /\b(likely|most likely|probably|probable|certainly|definitely)\b|较可能|很可能|大概率/i;

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("shared confidence words never say a retired strength word", () => {
  for (const loc of ["en", "zh-CN"]) {
    it(`${loc}: ConfidenceWord (What changed, Hardware) says Possible or Unknown for every band`, async () => {
      await i18n.changeLanguage(loc);
      const seen = new Set<string>();
      for (const band of ["high", "medium", "low", "unknown", null, undefined] as const) {
        const { container } = render(<ConfidenceWord band={band} />);
        expect(container.textContent, String(band)).not.toMatch(RETIRED);
        seen.add(container.textContent ?? "");
        cleanup();
      }
      expect([...seen].sort()).toEqual(loc === "en" ? ["Possible", "Unknown"] : ["有可能", "未知"].sort());
    });

    it(`${loc}: RowConfidence (Home, Check, First check rows) says Known, Possible or Unknown`, async () => {
      await i18n.changeLanguage(loc);
      for (const basis of ["fact", "measured", undefined] as const)
        for (const band of ["high", "medium", "low", null] as const) {
          const { container } = render(<RowConfidence basis={basis} band={band} />);
          expect(container.textContent, `${basis}/${band}`).not.toMatch(RETIRED);
          cleanup();
        }
    });

    it(`${loc}: the Black Box strength labels and the new group lines carry no retired word`, () => {
      const gaming = JSON.parse(readFileSync(join("src", "i18n", "locales", loc, "gaming.json"), "utf8")) as {
        blackBox: { strengthLabel: Record<string, string>; group: Record<string, string> };
      };
      const texts = [
        ...Object.values(gaming.blackBox.strengthLabel),
        gaming.blackBox.group.apartCrash_other,
        gaming.blackBox.group.apartHang_other,
      ];
      for (const s of texts) expect(s).not.toMatch(RETIRED);
    });
  }

  it("the Test bench word is Expected, Measured once or Unknown: never Likely, never plain Measured", () => {
    const words = new Set<string>();
    for (const kind of ["estimate", "real-play", "measured"] as const)
      for (const band of ["high", "medium", "low", null] as const) words.add(wordFromBench(kind, band));
    expect([...words].sort()).toEqual(["expected", "measuredOnce", "unknown"]);
  });

  it("no band or row can produce the word 'likely'", () => {
    for (const band of ["high", "medium", "low", "unknown", null, undefined] as const) {
      expect(wordFromBand(band as never)).not.toBe("likely");
      for (const basis of ["fact", "measured", undefined] as const) expect(wordFromRow(basis, band as never)).not.toBe("likely");
    }
  });

  // The sources of the screens this change touched. A screen that maps a band to "likely" by hand
  // (as BenchWord did) would slip past the render checks above, so the literal is scanned for.
  const SOURCES = import.meta.glob(
    [
      "./WhatChangedPanel.tsx",
      "./HardwareGrid.tsx",
      "./ExperimentBench.tsx",
      "./Check.tsx",
      "./FirstCheck.tsx",
      "./RerunCheckBand.tsx",
      "./BlackBox.tsx",
      "./blackbox-group.ts",
      "./glass/ProblemsRoom.tsx",
      "./glass/HomeGlass.tsx",
      "../data/confidence-word.ts",
    ],
    { query: "?raw", import: "default", eager: true },
  ) as Record<string, string>;

  it("no touched screen maps to the word 'likely' by hand", () => {
    const files = Object.entries(SOURCES);
    expect(files.length, "touched screens not scanned").toBeGreaterThanOrEqual(9);
    const hits = files
      .filter(([f]) => !f.endsWith("confidence-word.ts"))
      .filter(([, text]) => /["'`]likely["'`]/.test(text))
      .map(([f]) => f);
    expect(hits, `a screen names the retired word 'likely': ${hits.join(", ")}`).toEqual([]);
  });
});
