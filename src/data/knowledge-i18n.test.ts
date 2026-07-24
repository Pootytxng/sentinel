import { describe, it, expect } from "vitest";
import { KNOWLEDGE, KNOWLEDGE_BY_ID, knowledgeForLanguage, knowledgeByIdForLanguage } from "./knowledge";

// Simplified Chinese knowledge-overlay guard (i18n, 2026-07-23).
//
// knowledgeForLanguage("zh-CN") deep-merges the zh-CN locale JSON siblings (tweaks/terms/tricks/
// guides.zh-CN.json) onto the frozen English KNOWLEDGE array, entry by entry, matched by id. This
// guard pins the two invariants that make the overlay safe: (1) English stays byte-identical and
// untouched no matter what — every OTHER knowledge test in this directory keeps pinning against
// plain `KNOWLEDGE`/`KNOWLEDGE_BY_ID`, unaffected by this file; (2) the zh-CN view has the SAME ids,
// in the SAME order, with the SAME structural/logic fields (aliases, related, verdict, tier, topic,
// applies, dates) as English — only prose differs — so search, cross-linking, and filtering behave
// identically in either language.
const CJK = /[一-鿿]/;

describe("knowledgeForLanguage — Simplified Chinese overlay", () => {
  it('"en" (and any unrecognized language) returns the frozen KNOWLEDGE array itself, unchanged', () => {
    expect(knowledgeForLanguage("en")).toBe(KNOWLEDGE);
    expect(knowledgeForLanguage("fr")).toBe(KNOWLEDGE);
    expect(knowledgeByIdForLanguage("en")).toBe(KNOWLEDGE_BY_ID);
  });

  it("zh-CN overlay has exactly the same ids, in the same order, as English", () => {
    const zh = knowledgeForLanguage("zh-CN");
    expect(zh.length).toBe(KNOWLEDGE.length);
    expect(zh.map((e) => e.id)).toEqual(KNOWLEDGE.map((e) => e.id));
  });

  it("zh-CN overlay keeps every structural/logic field identical to English (only prose differs)", () => {
    const zh = knowledgeForLanguage("zh-CN");
    KNOWLEDGE.forEach((en, i) => {
      const z = zh[i];
      expect(z.type).toBe(en.type);
      expect(z.topic).toBe(en.topic);
      expect(z.aliases).toEqual(en.aliases);
      expect(z.related).toEqual(en.related);
      expect(z.applies).toEqual(en.applies);
      expect(z.added).toBe(en.added);
      expect(z.updated).toBe(en.updated);
      expect(z.status).toBe(en.status);
      expect(z.supersededBy).toBe(en.supersededBy);
      if (en.type === "tweak" && z.type === "tweak") expect(z.verdict).toBe(en.verdict);
      if (en.type === "guide" && z.type === "guide") expect(z.tier).toBe(en.tier);
    });
  });

  it("translates a known tweak's prose into actual Chinese text", () => {
    const en = KNOWLEDGE_BY_ID.get("xmp-expo")!;
    const zh = knowledgeByIdForLanguage("zh-CN").get("xmp-expo")!;
    expect(zh.type).toBe("tweak");
    if (zh.type !== "tweak" || en.type !== "tweak") throw new Error("expected tweak");
    expect(CJK.test(zh.name)).toBe(true);
    expect(CJK.test(zh.what)).toBe(true);
    expect(CJK.test(zh.why)).toBe(true);
    expect(zh.what).not.toBe(en.what); // actually translated, not a pass-through copy
  });

  it("translates a known term, trick, and guide into actual Chinese text", () => {
    const zhById = knowledgeByIdForLanguage("zh-CN");
    const term = zhById.get("xmp");
    const trick = KNOWLEDGE.find((e) => e.type === "trick");
    const guide = KNOWLEDGE.find((e) => e.type === "guide" && zhById.has(e.id));
    expect(term?.type).toBe("term");
    if (term?.type === "term") expect(CJK.test(term.more)).toBe(true);
    expect(trick).toBeTruthy();
    const zhTrick = trick ? zhById.get(trick.id) : undefined;
    if (zhTrick?.type === "trick") expect(CJK.test(zhTrick.honest_version)).toBe(true);
    expect(guide).toBeTruthy();
    const zhGuide = guide ? zhById.get(guide.id) : undefined;
    if (zhGuide?.type === "guide") {
      expect(zhGuide.steps.length).toBeGreaterThan(0);
      expect(zhGuide.steps.some((s) => CJK.test(s))).toBe(true);
    }
  });

  it("translates the four code-injected entries (no JSON row of their own)", () => {
    const zhById = knowledgeByIdForLanguage("zh-CN");
    for (const id of ["how-we-grade", "freesync-vrb-exclusion", "vendor-monitor-tuning", "monitor-hint-acer-xfa253q"]) {
      const en = KNOWLEDGE_BY_ID.get(id);
      const zh = zhById.get(id);
      expect(en, `English injected entry missing: ${id}`).toBeTruthy();
      expect(zh, `zh-CN injected entry missing: ${id}`).toBeTruthy();
      expect(CJK.test(zh!.name)).toBe(true);
      if (zh!.type === "term" && en!.type === "term") {
        expect(CJK.test(zh!.what)).toBe(true);
        expect(CJK.test(zh!.more)).toBe(true);
        expect(zh!.what).not.toBe(en!.what);
      }
    }
  });

  // bug→guard (self-review 2026-07-23): the tuning-guide-derived entry is a SEPARATE source path
  // from tweaks/terms/tricks/guides.zh-CN.json — it comes from tuning-guides.zh-CN.json folded in via
  // tuningGuideEntriesForLanguage("zh-CN") (knowledge.ts). Before that wiring the entry silently fell
  // back to English. This pins its prose as Chinese while the structural invariant (aliases/related/
  // tier match English) stays enforced, so a future overlay-source regression can't re-Anglicize it.
  it('translates the AMD tuning-guide entry ("amd-gpu-undervolt") — the tuning-guides.zh-CN.json path', () => {
    const en = KNOWLEDGE_BY_ID.get("amd-gpu-undervolt")!;
    const zh = knowledgeByIdForLanguage("zh-CN").get("amd-gpu-undervolt")!;
    expect(en, "English tuning-guide entry missing: amd-gpu-undervolt").toBeTruthy();
    expect(zh, "zh-CN tuning-guide entry missing: amd-gpu-undervolt").toBeTruthy();
    expect(zh.type).toBe("guide");
    if (zh.type !== "guide" || en.type !== "guide") throw new Error("expected guide");
    // prose is actual Chinese, not the English fallback
    expect(CJK.test(zh.name)).toBe(true);
    expect(zh.name).not.toBe(en.name);
    expect(zh.steps.length).toBe(en.steps.length); // step count preserved (index-wise array merge)
    expect(zh.steps.some((s) => CJK.test(s))).toBe(true);
    // structural fields stay English — the overlay invariant this new source path must not break
    expect(zh.aliases).toEqual(en.aliases);
    expect(zh.related).toEqual(en.related);
    expect(zh.tier).toBe(en.tier);
  });

  it("is memoized — repeat calls return the same array/map instance", () => {
    expect(knowledgeForLanguage("zh-CN")).toBe(knowledgeForLanguage("zh-CN"));
    expect(knowledgeByIdForLanguage("zh-CN")).toBe(knowledgeByIdForLanguage("zh-CN"));
  });
});
