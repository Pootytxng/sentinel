// bug → guard (review round 4, 2026-10-27): two zh-CN Home strings landed as mojibake ("Compy
// åˆšæ‰æ— æ³•…") when a UTF-8 file was written back through a Latin-1/cp1252 round trip. A shipped
// string the owner can't read is a defect no unit test on logic catches, so every zh-CN locale
// string is checked for the signature: a Latin-1 lead-byte character (Â…ÿ) followed by a
// C1/Latin-1/cp1252 continuation character. Genuine Chinese text never pairs those.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const DIR = join("src", "i18n", "locales", "zh-CN"); // vitest runs from the repo root (as locale-parity-guard)
// Lead: U+00C2–U+00FF (UTF-8 lead bytes misread as Latin-1), minus × and ÷, which legitimate text uses.
// Continuation: C1 controls and the Latin-1 supplement, plus the "smart" punctuation cp1252 decodes 0x80–0x9F to.
const MOJIBAKE =
  /[Â-ÖØ-öø-ÿ][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/;

const stringLeaves = (value: unknown, path: string): [string, string][] => {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => stringLeaves(v, path ? `${path}.${k}` : k));
  }
  return [];
};

describe("zh-CN locale: no mojibake", () => {
  const files: string[] = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  it("has locale files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files)("%s has no UTF-8-read-as-Latin-1 string", (file: string) => {
    const json: unknown = JSON.parse(readFileSync(join(DIR, file), "utf8"));
    const bad = stringLeaves(json, "").filter(([, s]) => MOJIBAKE.test(s));
    expect(bad.map(([p, s]) => `${p}: ${s.slice(0, 40)}`)).toEqual([]);
  });
});
