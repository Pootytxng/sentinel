import { describe, it, expect } from "vitest";
import { WALKTHROUGHS, walkthroughsForLanguage, walkthroughForKeyForLanguage } from "./walkthroughs";

// Simplified Chinese walkthrough-overlay guard (i18n, 2026-07-23) — same spirit as
// data/knowledge-i18n.test.ts: WALKTHROUGHS/walkthroughForKey stay frozen/English (pinned by
// walkthroughs.test.ts); this pins the additive zh-CN read path instead.
const CJK = /[一-鿿]/;

describe("walkthroughsForLanguage — Simplified Chinese overlay", () => {
  it('"en" returns the frozen WALKTHROUGHS array itself, unchanged', () => {
    expect(walkthroughsForLanguage("en")).toBe(WALKTHROUGHS);
  });

  it("zh-CN overlay has the same groups, in the same order, as English", () => {
    const zh = walkthroughsForLanguage("zh-CN");
    expect(zh.length).toBe(WALKTHROUGHS.length);
    expect(zh.map((w) => w.group)).toEqual(WALKTHROUGHS.map((w) => w.group));
  });

  it("keeps structural fields (pairsWith, vendor, x/y, hotspot label) identical to English", () => {
    const zh = walkthroughsForLanguage("zh-CN");
    WALKTHROUGHS.forEach((en, i) => {
      const z = zh[i];
      expect(z.pairsWith).toEqual(en.pairsWith);
      expect(z.variants.length).toBe(en.variants.length);
      en.variants.forEach((v, j) => {
        expect(z.variants[j].vendor).toBe(v.vendor);
        expect(z.variants[j].steps.length).toBe(v.steps.length);
        v.steps.forEach((s, k) => {
          expect(z.variants[j].steps[k].x).toBe(s.x);
          expect(z.variants[j].steps[k].y).toBe(s.y);
        });
      });
    });
  });

  it("translates the title and step captions into actual Chinese text", () => {
    const en = walkthroughForKeyForLanguage("vrr", "en")!;
    const zh = walkthroughForKeyForLanguage("vrr", "zh-CN")!;
    expect(CJK.test(zh.title)).toBe(true);
    expect(zh.title).not.toBe(en.title);
    expect(zh.variants[0].steps.some((s) => CJK.test(s.caption))).toBe(true);
  });

  it("translates the tuning-guide-derived walkthrough (amd-gpu-undervolt) too", () => {
    const en = walkthroughForKeyForLanguage("amd-gpu-undervolt", "en")!;
    const zh = walkthroughForKeyForLanguage("amd-gpu-undervolt", "zh-CN")!;
    expect(en).toBeTruthy();
    expect(zh).toBeTruthy();
    expect(CJK.test(zh.title)).toBe(true);
    expect(zh.variants[0].steps.length).toBe(en.variants[0].steps.length);
    expect(zh.variants[0].steps.every((s) => CJK.test(s.caption))).toBe(true);
  });

  it("walkthroughForKeyForLanguage falls back to null for an unknown key in either language", () => {
    expect(walkthroughForKeyForLanguage("nope-not-real", "zh-CN")).toBeNull();
    expect(walkthroughForKeyForLanguage(null, "zh-CN")).toBeNull();
  });
});
