// D3 vocabulary, slice 3: the screens that tag a conclusion with "Possible" or "Measured" (What changed,
// Hardware, History's patterns, the Home interview, a measured priority row) spell those two words
// through the shared vocabulary (common.strength.possible, common.source.measured). A feature test.
//
// What must hold:
//   - every word a user sees is written out here, in English and Chinese;
//   - no level changed: every band, basis and finding level gets the word it got before this slice;
//   - nothing in scope still asks the older list for a word.
// D3 slice 4 (e5b) moved the last three words to the shared vocabulary and deleted the older list
// (common.confidenceWord.*): Known is now "Read from your PC" (common.source.read), Expected "Not
// measured on your PC" (common.source.general), Unknown "Not enough to say yet" (common.notEnoughYet).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import i18n from "../i18n";
import { ConfidenceWord, PatternConfidence, RowConfidence } from "../design/ConfidenceWord";
import { confidenceWordKey, confidenceWordText, rowHasSourceWord, wordFromBand, wordFromBench, wordFromFinding, wordFromPattern, wordFromRow, type ConfidenceWord as Word } from "./confidence-word";
import { INTERVIEW_FINDINGS, interviewFinding, type InterviewFacts } from "../surfaces/home-interview-data";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

type Lang = "en" | "zh-CN";
const LANGS: Lang[] = ["en", "zh-CN"];
const BANDS = ["high", "medium", "low", "unknown", null, undefined] as const;
const SUPPORTED = (b: (typeof BANDS)[number]) => b === "high" || b === "medium";

/** Every word as it is shown, written out. `likely` is in the type but no screen in scope can produce it. */
const TEXT: Record<Lang, Record<Exclude<Word, "likely">, string>> = {
  en: { possible: "Possible", measured: "Measured", measuredOnce: "Measured once", known: "Read from your PC", expected: "Not measured on your PC", unknown: "Not enough to say yet" },
  "zh-CN": { possible: "有可能", measured: "已实测", measuredOnce: "仅测得一次", known: "从你的电脑读取", expected: "未在你的电脑上实测", unknown: "还不足以下结论" },
};
const NOTE: Record<Lang, string> = { en: "Effect on FPS not measured", "zh-CN": "对 FPS 的影响未实测" };
const TOP: Record<Lang, string> = { en: "Most likely", "zh-CN": "最有可能" };
const common = (loc: Lang) => JSON.parse(readFileSync(join("src", "i18n", "locales", loc, "common.json"), "utf8")) as Record<string, Record<string, string>>;
const src = (...p: string[]) => readFileSync(join("src", ...p), "utf8");

describe("confidenceWordText: one helper spells every shown word", () => {
  for (const loc of LANGS)
    it(`${loc}: each word is the text written out above`, async () => {
      await i18n.changeLanguage(loc);
      for (const [w, text] of Object.entries(TEXT[loc])) expect(confidenceWordText(w as Word, i18n.t), `${loc}/${w}`).toBe(text);
      // The type's "likely" (no band mapper produces it) is the top strength word, never a bare "Likely".
      expect(confidenceWordText("likely", i18n.t), `${loc}/likely`).toBe(TOP[loc]);
    });

  it("every word comes from the shared keys; the older list is gone (e5b)", () => {
    for (const loc of LANGS) {
      const c = common(loc);
      expect(c.strength.possible, loc).toBe(TEXT[loc].possible);
      expect(c.source.measured, loc).toBe(TEXT[loc].measured);
      expect(c.source.measuredOnce, loc).toBe(TEXT[loc].measuredOnce);
      expect(c.source.read, loc).toBe(TEXT[loc].known);
      expect(c.source.general, loc).toBe(TEXT[loc].expected);
      expect(c.notEnoughYet as unknown as string, loc).toBe(TEXT[loc].unknown);
      expect(c.confidenceWord, loc).toBeUndefined();
    }
  });

  // Review r1, F1: BenchWord still calls t(confidenceWordKey(word)); the builder must never hand it a missing key.
  it("the key builder is total: every word's key resolves to a real string, in both languages", async () => {
    const words: Word[] = ["known", "measured", "measuredOnce", "possible", "likely", "expected", "unknown"];
    expect(confidenceWordKey("possible")).toBe("common.strength.possible");
    expect(confidenceWordKey("measured")).toBe("common.source.measured");
    for (const loc of LANGS) {
      await i18n.changeLanguage(loc);
      for (const w of words) {
        const key = confidenceWordKey(w);
        const shown = i18n.t(key);
        expect(shown, `${loc}/${w}`).not.toBe(key);
        expect(shown.trim().length, `${loc}/${w}`).toBeGreaterThan(0);
        if (w !== "likely") expect(shown, `${loc}/${w}`).toBe(TEXT[loc][w]);
      }
    }
  });

  it("the helper calls the shared spellers for the moved words and the older key only for the rest", () => {
    const text = src("data", "confidence-word.ts");
    const body = text.slice(text.indexOf("export function confidenceWordText"), text.indexOf("export const confidenceHintKey"));
    expect(body).toMatch(/case "possible":\s*return strengthWord\("possible", t\);/);
    expect(body).toMatch(/case "measured":\s*return sourceWord\("measured", t\);/);
    expect(body).toMatch(/case "measuredOnce":\s*return sourceWord\("measured-once", t\);/);
    expect(body).toMatch(/case "known":\s*return sourceWord\("read", t\);/);
    expect(body).toMatch(/case "expected":\s*return sourceWord\("general", t\);/);
    expect(body).toMatch(/default:\s*return t\(confidenceWordKey\(w\)\);/);
    expect(text, "the older list is not built any more").not.toMatch(/common\.confidenceWord\./);
  });
});

describe("no level changed: every input gets the word it got before", () => {
  it("an inference band (What changed, Hardware): high and medium are possible, everything else unknown", () => {
    for (const b of [...BANDS, "nonsense" as never]) expect(wordFromBand(b), String(b)).toBe(SUPPORTED(b) ? "possible" : "unknown");
  });

  it("a pattern (History): high and medium are measured, everything else unknown", () => {
    for (const b of [...BANDS, "nonsense" as never]) expect(wordFromPattern(b), String(b)).toBe(SUPPORTED(b) ? "measured" : "unknown");
  });

  it("a priority row: a fact (or a row with no basis) is known whatever its band; a measured row takes the band's word", () => {
    for (const b of BANDS) {
      expect(wordFromRow("fact", b), String(b)).toBe("known");
      expect(wordFromRow(undefined, b), String(b)).toBe("known");
      expect(wordFromRow("measured", b), String(b)).toBe(SUPPORTED(b) ? "possible" : "unknown");
    }
  });

  it("a Home interview finding: measured, likely (worded Possible) and unknown", () => {
    expect([wordFromFinding("measured"), wordFromFinding("likely"), wordFromFinding("unknown")]).toEqual(["measured", "possible", "unknown"]);
  });

  it("no input to any of these reaches a word above Possible", () => {
    for (const b of BANDS) {
      const words: Word[] = [wordFromBand(b), wordFromPattern(b), wordFromRow("fact", b), wordFromRow("measured", b), wordFromRow(undefined, b)];
      for (const w of words) expect(w, String(b)).not.toBe("likely");
    }
    for (const l of ["measured", "likely", "unknown"] as const) expect(wordFromFinding(l)).not.toBe("likely");
  });

  it("the Test bench (not part of this slice) never asks the older list for a moved word", () => {
    // BenchWord still calls confidenceWordKey(word). That is only right while its word is never "possible",
    // and "measured" only when it shows the count ("Measured 3 times") instead of the bare word.
    for (const kind of ["estimate", "real-play", "measured"] as const)
      for (const b of BANDS)
        for (const n of [1, 2, 3]) {
          const w = wordFromBench(kind, b, n);
          expect(w, `${kind}/${b}/${n}`).not.toBe("possible");
          if (w === "measured") expect(n, `${kind}/${b}`).toBeGreaterThanOrEqual(2);
        }
  });
});

describe("on the screens, in both languages", () => {
  for (const loc of LANGS) {
    /** The row's word: everything it renders except the note. */
    const word = (el: HTMLElement) => (el.textContent ?? "").replace(NOTE[loc], "").trim();

    it(`${loc}: ConfidenceWord (What changed, Hardware) says Possible for a supported band and Unknown otherwise`, async () => {
      await i18n.changeLanguage(loc);
      for (const b of BANDS) {
        const { container } = render(<ConfidenceWord band={b} />);
        expect(container.textContent, String(b)).toBe(SUPPORTED(b) ? TEXT[loc].possible : TEXT[loc].unknown);
        expect(container.textContent, String(b)).not.toContain(TOP[loc]);
        cleanup();
      }
    });

    it(`${loc}: PatternConfidence (History) says Measured for a supported trend and Unknown otherwise`, async () => {
      await i18n.changeLanguage(loc);
      for (const b of BANDS) {
        const { container } = render(<PatternConfidence band={b} />);
        expect(container.textContent, String(b)).toBe(SUPPORTED(b) ? TEXT[loc].measured : TEXT[loc].unknown);
        cleanup();
      }
    });

    it(`${loc}: RowConfidence says Known with the not-measured note for a fact, and the band's word alone for a measured row`, async () => {
      await i18n.changeLanguage(loc);
      for (const b of BANDS) {
        for (const basis of ["fact", undefined] as const) {
          const { container } = render(<RowConfidence basis={basis} band={b} />);
          expect(word(container), `${basis}/${b}`).toBe(TEXT[loc].known);
          expect(container.querySelector(".confidence-note")?.textContent, `${basis}/${b}`).toBe(NOTE[loc]);
          cleanup();
        }
        const { container } = render(<RowConfidence basis="measured" band={b} />);
        expect(container.textContent, `measured/${b}`).toBe(SUPPORTED(b) ? TEXT[loc].possible : TEXT[loc].unknown);
        expect(container.querySelector(".confidence-note"), `measured/${b}`).toBeNull();
        cleanup();
      }
    });

    // e5b review r1 F3: "N tweaks not applied" counts tweaks Compy could not read as not applied
    // (priorities.rs ~697), so no source word is true for the whole row: it shows none, only the note.
    it(`${loc}: the pending-tweaks row carries no source word; any other fact row still does`, async () => {
      await i18n.changeLanguage(loc);
      expect(rowHasSourceWord("pending-safe-recs")).toBe(false);
      expect(rowHasSourceWord("power-profile")).toBe(true);
      expect(rowHasSourceWord(undefined)).toBe(true);
      for (const basis of ["fact", undefined] as const) {
        const { container } = render(<RowConfidence basis={basis} band="high" rowId="pending-safe-recs" />);
        expect(container.textContent, `${basis}`).not.toContain(TEXT[loc].known);
        expect(container.textContent?.trim(), `${basis}`).toBe(NOTE[loc]);
        cleanup();
        const other = render(<RowConfidence basis={basis} band="high" rowId="power-profile" />);
        expect(word(other.container), `${basis}`).toBe(TEXT[loc].known);
        cleanup();
      }
    });

    it(`${loc}: every Home interview chip is the word for its level`, async () => {
      await i18n.changeLanguage(loc);
      const bare = { recsLoaded: false, safeStackReady: 0, fastPathWired: false, activeChanges: 0, sessionCount: 0, lastSession: null, readiness: null, gpuTempC: null, rooms: ["play", "learn", "lab"] };
      const played = { ...bare, sessionCount: 1, lastSession: { game: "Valorant", avgFps: 142.3, low1: 98.4, peakTempC: 61 } };
      const want = { measured: TEXT[loc].measured, likely: TEXT[loc].possible, unknown: TEXT[loc].unknown };
      const levels = new Set<string>();
      for (const facts of [bare, played])
        for (const id of INTERVIEW_FINDINGS) {
          const f = interviewFinding(id, facts as unknown as InterviewFacts, i18n.t);
          expect(f.levelLabel, `${id}/${f.level}`).toBe(want[f.level]);
          levels.add(f.level);
        }
      // Not vacuous: the fixtures reach more than one level.
      expect(levels.size, [...levels].join(",")).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("no surface in scope still asks the older list for a moved word", () => {
  const SCOPE: [string, string[]][] = [
    ["design/ConfidenceWord.tsx", ["design", "ConfidenceWord.tsx"]],
    ["surfaces/glass/HomeGlass.tsx", ["surfaces", "glass", "HomeGlass.tsx"]],
    ["surfaces/home-interview-data.ts", ["surfaces", "home-interview-data.ts"]],
    ["surfaces/HomeInterview.tsx", ["surfaces", "HomeInterview.tsx"]],
    ["surfaces/WhatChangedPanel.tsx", ["surfaces", "WhatChangedPanel.tsx"]],
    ["surfaces/HardwareGrid.tsx", ["surfaces", "HardwareGrid.tsx"]],
    ["surfaces/blackbook/PatternsTile.tsx", ["surfaces", "blackbook", "PatternsTile.tsx"]],
  ];

  for (const [name, path] of SCOPE)
    it(`${name} names no older word key and does not build one`, () => {
      const text = src(...path);
      expect(text.length, name).toBeGreaterThan(500);
      expect(text, name).not.toMatch(/confidenceWordKey/);
      expect(text, name).not.toMatch(/common\.confidenceWord\./);
    });

  it("the three callers spell their word through confidenceWordText", () => {
    expect(src("design", "ConfidenceWord.tsx").match(/\{confidenceWordText\(word, t\)\}/g)?.length).toBe(3);
    expect(src("surfaces", "glass", "HomeGlass.tsx")).toMatch(/\{confidenceWordText\(wordFromRow\(topLimiter\.basis, topLimiter\.confidence\), t\)\}/);
    expect(src("surfaces", "home-interview-data.ts")).toMatch(/levelLabel: confidenceWordText\(wordFromFinding\(level\), t\),/);
  });
});
