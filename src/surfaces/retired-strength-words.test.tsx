import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import i18n from "../i18n";
import { ConfidenceWord, RowConfidence } from "../design/ConfidenceWord";
import { wordFromBand, wordFromBench, wordFromFinding, wordFromRow } from "../data/confidence-word";
import { INTERVIEW_FINDINGS, interviewFinding, type InterviewFacts } from "./home-interview-data";

// u3-focus 2026-11-21: History's retired-word scan (blackbook/patterns-tile.test.tsx), extended to
// every screen that went through the shared confidence vocabulary in this change: What changed,
// Hardware, the Test bench's word, Home's limiter row, Check and the First check rows, the Problems
// room (Black Box). "Likely" above "Possible" needs two independent supports; none of these
// producers proves two, so none may say it.
const RETIRED = /\b(likely|most likely|probably|probable|certainly|definitely)\b|较可能|很可能|大概率|最可能|可能性大|多半/i;

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
      const seen = new Set<string>();
      for (const basis of ["fact", "measured", undefined] as const)
        for (const band of ["high", "medium", "low", null] as const) {
          const { container } = render(<RowConfidence basis={basis} band={band} />);
          const text = (container.textContent ?? "").trim();
          // An empty render would pass the retired-word check by saying nothing at all.
          expect(text.length, `${basis}/${band} rendered no word`).toBeGreaterThan(0);
          expect(text, `${basis}/${band}`).not.toMatch(RETIRED);
          seen.add(text);
          cleanup();
        }
      expect(seen.size, [...seen].join(" | ")).toBeGreaterThanOrEqual(2);
    });

    it(`${loc}: Home interview finding chips (wordFromFinding) say Possible, Measured or Unknown`, async () => {
      await i18n.changeLanguage(loc);
      const bare = { recsLoaded: false, safeStackReady: 0, fastPathWired: false, activeChanges: 0, sessionCount: 0, lastSession: null, readiness: null, gpuTempC: null, rooms: ["play", "learn", "lab"] };
      const played = { ...bare, sessionCount: 1, lastSession: { game: "Valorant", avgFps: 142.3, low1: 98.4, peakTempC: 61 } };
      const chips = new Set<string>();
      for (const facts of [bare, played])
        for (const id of INTERVIEW_FINDINGS) {
          const f = interviewFinding(id, facts as unknown as InterviewFacts, i18n.t);
          expect(f.levelLabel.trim().length, `${id}: no chip word`).toBeGreaterThan(0);
          expect(f.levelLabel, id).not.toMatch(RETIRED);
          chips.add(`${f.level}=${f.levelLabel}`);
        }
      // A finding the interview reached by an answer alone is level "likely" internally, and is worded Possible.
      expect([...chips].some((c) => c.startsWith("likely=")), [...chips].join(" | ")).toBe(true);
      for (const c of chips) if (c.startsWith("likely=")) expect(c).toBe(`likely=${i18n.t("common.confidenceWord.possible")}`);
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
    // With two or more completed comparisons the word is Measured, and the bench adds the count ("Measured 3 times").
    expect(wordFromBench("measured", "high", 2)).toBe("measured");
    expect(wordFromBench("real-play", "medium", 3)).toBe("measured");
    expect(wordFromBench("measured", "high", 1)).toBe("measuredOnce");
  });

  it("wordFromFinding (Home interview chip) never says likely", () => {
    for (const level of ["measured", "likely", "unknown"] as const) expect(wordFromFinding(level)).not.toBe("likely");
  });

  // Review r1: the other probability words. No locale string anywhere says "probably" / 大概率; a new one
  // is listed here with its file:line instead of being edited by this test.
  it("no locale string says probably or 大概率", () => {
    const root = join("src", "i18n", "locales");
    const hits: string[] = [];
    for (const loc of readdirSync(root))
      for (const file of readdirSync(join(root, loc)).filter((f) => f.endsWith(".json")))
        readFileSync(join(root, loc, file), "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/\bprobably\b|大概率/i.test(line)) hits.push(`${loc}/${file}:${i + 1}`);
          });
    expect(hits, `probability words in locale files: ${hits.join(", ")}`).toEqual([]);
  });

  // B3b (2026-11-22): the Something's-wrong card's recovery said "Points to it" / "The evidence now points to" on one
  // recovery observation (one support; never above Possible). That is an attribution claim, so it is retired in the
  // card's strings: a row "matches the timing", and the summary says only one listed change is still standing. Only a
  // negated use ("can't point to" / 不能…指向 / 无法…指向) may remain.
  it("no Something's-wrong card string says the evidence points to something, in either language", () => {
    const flat = (o: unknown, at = ""): [string, string][] =>
      typeof o === "string" ? [[at, o]] : o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => flat(v, at ? `${at}.${k}` : k)) : [];
    const AFFIRMED_EN = /(?<!can't |cannot |can not |not )\bpoints? to\b/i;
    // "不指向它" (the old "points away" chip) is caught too: the row chips say what matches, not what points.
    const AFFIRMED_ZH = /(?<!不能|无法|不能单凭这一点|无法单凭这一点)指向/;
    const hits: string[] = [];
    for (const loc of ["en", "zh-CN"]) {
      const strings = flat(JSON.parse(readFileSync(join("src", "i18n", "locales", loc, "paramedic.json"), "utf8")));
      expect(strings.length, `${loc}: paramedic strings not read`).toBeGreaterThan(100);
      for (const [key, s] of strings) if (AFFIRMED_EN.test(s) || AFFIRMED_ZH.test(s)) hits.push(`${loc}:${key}: ${s}`);
    }
    expect(hits, hits.join("\n")).toEqual([]);
    // The two keys that carried it say the mechanism now.
    const en = JSON.parse(readFileSync(join("src", "i18n", "locales", "en", "paramedic.json"), "utf8"));
    const zh = JSON.parse(readFileSync(join("src", "i18n", "locales", "zh-CN", "paramedic.json"), "utf8"));
    expect([en.now.pointsTo, zh.now.pointsTo]).toEqual(["Matches the timing", "时间上吻合"]);
    expect(en.recovered.pointsTo).toMatch(/^Of the changes listed, only one is still standing .*two sessions can't show why it ran better\.$/);
    expect(zh.recovered.pointsTo).toMatch(/只剩一项还没有被排除.*两次运行无法说明它为什么变好。$/);
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
