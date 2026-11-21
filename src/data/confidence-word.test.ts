import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { confidenceWordKey, wordFromBand, wordFromBench, wordFromFinding, wordFromProvenance } from "./confidence-word";

// P7-confidence (Constitution §25): ONE vocabulary — Known / Measured / Likely / Expected / Unknown —
// mapped from each producer's own field, never a percentage and never a raw high/medium/low on the
// default face. These pin the mapping and that every word has a string in every locale.
describe("confidence vocabulary", () => {
  it("maps an inference band: high and medium are Possible (never Likely: no two independent supports), low and unknown are not enough", () => {
    expect(wordFromBand("high")).toBe("possible");
    expect(wordFromBand("medium")).toBe("possible");
    expect(wordFromBand("low")).toBe("unknown");
    expect(wordFromBand("unknown")).toBe("unknown");
    expect(wordFromBand(null)).toBe("unknown");
  });

  it("maps a bench result through fromBench: an estimate is Expected; a real-play result and a two-session Trial are Measured once; a weak band is Unknown; never Likely or Measured", () => {
    for (const band of ["high", "medium"] as const) {
      expect(wordFromBench("estimate", band)).toBe("expected");
      expect(wordFromBench("real-play", band)).toBe("measuredOnce");
      expect(wordFromBench("measured", band)).toBe("measuredOnce");
    }
    for (const kind of ["estimate", "real-play", "measured"] as const)
      for (const band of ["low", "unknown", null, undefined] as const) expect(wordFromBench(kind, band)).toBe("unknown");
    for (const kind of ["estimate", "real-play", "measured"] as const)
      for (const band of ["high", "medium", "low", null] as const) expect(wordFromBench(kind, band)).not.toMatch(/^(likely|measured)$/);
  });

  it("maps provenance: a fact Compy read is Known, a third-party measurement is Measured, reasoning is Expected", () => {
    expect(wordFromProvenance("verified")).toBe("known");
    expect(wordFromProvenance("measured-signal")).toBe("measured");
    expect(wordFromProvenance("expected-impact")).toBe("expected");
  });

  it("the interview's finding level is already in the vocabulary", () => {
    expect(wordFromFinding("measured")).toBe("measured");
    expect(wordFromFinding("likely")).toBe("likely");
    expect(wordFromFinding("unknown")).toBe("unknown");
  });

  it("every word has a string in every locale, and no locale still ships a raw '{{level}} confidence' tag", () => {
    const locales = join("src", "i18n", "locales");
    for (const loc of ["en", "zh-CN"]) {
      const common = JSON.parse(readFileSync(join(locales, loc, "common.json"), "utf8")) as { confidenceWord: Record<string, string> };
      for (const w of ["known", "measured", "measuredOnce", "possible", "likely", "expected", "unknown"] as const) {
        expect(confidenceWordKey(w)).toBe(`common.confidenceWord.${w}`);
        expect(common.confidenceWord[w]).toBeTruthy();
      }
      for (const file of ["home.json", "optimize.json", "gaming.json", "blackbook.json"]) {
        const text = readFileSync(join(locales, loc, file), "utf8");
        expect(text, `${loc}/${file}`).not.toMatch(/\{\{level\}\}\s*confidence|confidence\s*[:：]?\s*\{\{level\}\}|"confidenceTag"|"confidenceSuffix"|"confidenceLabel"/);
      }
    }
  });
});
