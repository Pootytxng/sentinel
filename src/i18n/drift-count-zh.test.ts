import { describe, expect, it } from "vitest";
import en from "./locales/en/home.json";
import zh from "./locales/zh-CN/home.json";

// CR-zh-drift-count: the English drift count was reworded to "changed since they were last good"
// (8d855c05: a drift whose check now reads unknown stays, so "drifted" overclaimed); the Chinese
// still said "已漂移" (drifted). Every driftCount in both files says the same thing.
function driftCounts(node: unknown, path = ""): Array<[string, string]> {
  if (!node || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "string" ? (k.startsWith("driftCount") ? [[`${path}.${k}`, v] as [string, string]] : []) : driftCounts(v, `${path}.${k}`),
  );
}

describe("the zh-CN drift count matches the reworded English", () => {
  it("English says changed since last good; Chinese says the same, never drifted", () => {
    const enCounts = driftCounts(en);
    const zhCounts = driftCounts(zh);
    expect(enCounts.length).toBeGreaterThan(0);
    for (const [, v] of enCounts) expect(v).toMatch(/since (it was|they were) last good/);
    expect(zhCounts.map(([p]) => p)).toEqual(enCounts.filter(([p]) => p.endsWith("_other")).map(([p]) => p));
    for (const [p, v] of zhCounts) {
      expect(v, p).toContain("自上次正常以来已改变");
      expect(v, p).not.toContain("漂移");
    }
  });
});
