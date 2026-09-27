import { describe, it, expect } from "vitest";
import { deepMergeLocale } from "./locale-merge";

type Entry = {
  id: string;
  title: string;
  body: string;
  tier: number;
  aliases: string[];
  steps: { label: string; detail: string }[];
  hotspot: { x: number; y: number; caption: string };
};

const en = (): Entry => ({
  id: "power-plan",
  title: "Power plan",
  body: "Controls how the CPU scales clocks.",
  tier: 2,
  aliases: ["power", "plan"],
  steps: [
    { label: "Open settings", detail: "Search for power." },
    { label: "Pick a plan", detail: "Choose balanced." },
  ],
  hotspot: { x: 10, y: 20, caption: "Here" },
});

describe("deepMergeLocale", () => {
  it("overrides translated string fields and keeps untouched keys in English", () => {
    const out = deepMergeLocale(en(), { title: "电源计划", body: "控制 CPU 频率。" });
    expect(out.title).toBe("电源计划");
    expect(out.body).toBe("控制 CPU 频率。");
    expect(out.id).toBe("power-plan");
    expect(out.tier).toBe(2);
    expect(out.aliases).toEqual(["power", "plan"]);
  });

  it("merges nested objects key-by-key (hotspot coordinates survive a caption override)", () => {
    const out = deepMergeLocale(en(), { hotspot: { caption: "这里" } });
    expect(out.hotspot).toEqual({ x: 10, y: 20, caption: "这里" });
  });

  it("merges arrays of objects by index", () => {
    const out = deepMergeLocale(en(), {
      steps: [{ label: "打开设置" }, { detail: "选择平衡。" }],
    });
    expect(out.steps).toEqual([
      { label: "打开设置", detail: "Search for power." },
      { label: "Pick a plan", detail: "选择平衡。" },
    ]);
  });

  it("keeps English tail items when the zh array is shorter", () => {
    const out = deepMergeLocale(["a", "b", "c"], ["甲"]);
    expect(out).toEqual(["甲", "b", "c"]);
  });

  it("ignores extra zh array items beyond the English length", () => {
    const out = deepMergeLocale(["a"], ["甲", "乙", "丙"]);
    expect(out).toEqual(["甲"]);
  });

  it("adds keys that zh supplies but English lacks", () => {
    const out = deepMergeLocale<Record<string, string>>({ a: "A" }, { a: "甲", extra: "额外" });
    expect(out).toEqual({ a: "甲", extra: "额外" });
  });

  it("null or undefined zh values fall back to English at every level", () => {
    expect(deepMergeLocale(en(), null)).toEqual(en());
    expect(deepMergeLocale(en(), undefined)).toEqual(en());
    const out = deepMergeLocale(en(), { title: null, body: undefined, hotspot: { caption: null } });
    expect(out.title).toBe("Power plan");
    expect(out.body).toBe("Controls how the CPU scales clocks.");
    expect(out.hotspot.caption).toBe("Here");
  });

  it("a primitive in zh always wins over the English primitive, even across types", () => {
    expect(deepMergeLocale("en", "zh")).toBe("zh");
    expect(deepMergeLocale(1, 2)).toBe(2);
    expect(deepMergeLocale(true, false)).toBe(false);
    expect(deepMergeLocale<unknown>("text", 0)).toBe(0);
    expect(deepMergeLocale<unknown>("text", "")).toBe("");
  });

  it("does not mutate the English base", () => {
    const base = en();
    const snapshot = JSON.parse(JSON.stringify(base));
    deepMergeLocale(base, { title: "x", steps: [{ label: "y" }], hotspot: { caption: "z" } });
    expect(base).toEqual(snapshot);
  });

  it("an empty zh object returns an equal but distinct copy", () => {
    const base = en();
    const out = deepMergeLocale(base, {});
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });
});
