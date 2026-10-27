import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { confidenceWordKey, wordFromBand, wordFromFinding, wordFromProvenance } from "./confidence-word";

// P7-confidence (Constitution §25): ONE vocabulary — Known / Measured / Likely / Expected / Unknown —
// mapped from each producer's own field, never a percentage and never a raw high/medium/low on the
// default face. These pin the mapping and that every word has a string in every locale.
describe("confidence vocabulary", () => {
  it("maps an inference band: high and medium are supported inferences, low and unknown are not enough", () => {
    expect(wordFromBand("high")).toBe("likely");
    expect(wordFromBand("medium")).toBe("likely");
    expect(wordFromBand("low")).toBe("unknown");
    expect(wordFromBand("unknown")).toBe("unknown");
    expect(wordFromBand(null)).toBe("unknown");
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
      for (const w of ["known", "measured", "likely", "expected", "unknown"] as const) {
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
