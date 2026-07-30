// LabDeck copy contract — the guards for defects that live in the locale files, where neither a
// type error nor a render test can see them.
//
// BUG → GUARD (consumer panel + contract audit, 2026-07-29):
//
//   G6  REGISTER COLLISION. The comparison instrument said "captures a baseline" while the benchmark
//       instrument said "Baseline saved" — two different mechanisms wearing one word. 2/5 seats
//       believed they had already done the thing the other instrument was asking for. The fix split
//       the vocabulary: comparison speaks "before half" / "之前", baseline stays the benchmark's own
//       word. A split only holds while BOTH sides hold, so both sides are asserted.
//   G7  A MISSING KEY IS NOT A CRASH. `labDeck.map.whole` never existed in zh-CN, and
//       `fallbackLng: "en"` (src/i18n/index.ts) turned that into a full English sentence rendered
//       inside a Chinese UI. Silent, shippable, and invisible to tsc. Parity is now mechanical.
//   G12 UNMEASURED SUPERLATIVE. The catalog reason claimed "the safest change left for your rig" on
//       a recommendation whose own trade-off section names a real security regression. Two seats
//       caught the contradiction. Superlatives are a measured claim; this string is not measured.
//
// The two `stations.reading.*` singular forms below are PRE-EXISTING gaps outside this train's
// scope. They are named rather than filtered by pattern so that adding a third gap fails here.
import { describe, expect, it } from "vitest";
import enLab from "../../i18n/locales/en/lab.json";
import zhLab from "../../i18n/locales/zh-CN/lab.json";

const KNOWN_ZH_GAPS = [
  "stations.reading.blackboxIncidents_one",
  "stations.reading.optimizeReady_one",
];

const flatten = (value: unknown, prefix = "", out = new Map<string, string>()) => {
  if (typeof value === "string") {
    out.set(prefix, value);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
};

const en = flatten(enLab);
const zh = flatten(zhLab);
const under = (map: Map<string, string>, path: string) =>
  Array.from(map).filter(([k]) => k.startsWith(`${path}.`));

describe("LabDeck copy contract", () => {
  it("every key the deck can render exists in both locales", () => {
    // If the guard ever passed on an empty set it would be worthless.
    expect(en.size).toBeGreaterThan(200);
    const missingInZh = Array.from(en.keys()).filter(
      (k) => !zh.has(k) && !KNOWN_ZH_GAPS.includes(k),
    );
    const extraInZh = Array.from(zh.keys()).filter((k) => !en.has(k));
    expect(missingInZh).toEqual([]);
    expect(extraInZh).toEqual([]);
    // The named exceptions must still BE exceptions — once translated, delete them from the list.
    for (const k of KNOWN_ZH_GAPS) expect(en.has(k)).toBe(true);
  });

  it("the comparison instrument does not borrow the benchmark instrument's word", () => {
    const compare = under(en, "labDeck.compare");
    expect(compare.length).toBeGreaterThan(10);
    expect(compare.filter(([, v]) => /baseline/i.test(v)).map(([k]) => k)).toEqual([]);

    const zhCompare = under(zh, "labDeck.compare");
    expect(zhCompare.length).toBe(compare.length);
    // 基线 was the literal collision; 基准 is the benchmark lane's own word in zh and must not be
    // borrowed here either, or the split exists in English only.
    expect(zhCompare.filter(([, v]) => /基线|基准/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it("…and the benchmark instrument still owns it, so the two are actually distinguishable", () => {
    // Renaming the word everywhere would satisfy the ban above while destroying the distinction it
    // exists to create. One-sided guards are how a split quietly collapses.
    expect(Array.from(en).filter(([, v]) => /baseline/i.test(v)).length).toBeGreaterThan(0);
    expect(Array.from(zh).filter(([, v]) => /基准/.test(v)).length).toBeGreaterThan(0);
  });

  it("the catalog reason claims no superlative it has not measured", () => {
    const claims = ["labDeck.move.whyCatalog", "labDeck.move.whyMeasured", "labDeck.move.why"];
    const present = claims.filter((k) => en.has(k));
    expect(present.length).toBeGreaterThan(0);
    for (const k of present) {
      expect(en.get(k)).not.toMatch(/\b(safest|best|most safe|optimal|guaranteed)\b/i);
      if (zh.has(k)) expect(zh.get(k)).not.toMatch(/最安全|最好|最佳|保证/);
    }
  });

  it("the whole-machine marker stays a marker, and the sentence stays a sentence", () => {
    // G2's fix is a chip drawn ON the render. If it grows into prose it stops being readable at a
    // glance and starts duplicating `map.whole`, which is the line that explains itself.
    for (const map of [en, zh]) {
      const tag = map.get("labDeck.map.wholeTag");
      const whole = map.get("labDeck.map.whole");
      expect(tag).toBeTruthy();
      expect(whole).toBeTruthy();
      expect(tag!.length).toBeLessThanOrEqual(24);
      expect(tag).not.toMatch(/[.。]/);
      expect(whole!.length).toBeGreaterThan(tag!.length);
    }
  });
});
