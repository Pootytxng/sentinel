// R3 Lane D — local KPI counters: best-effort, corruption-proof, honest line.
import { describe, it, expect, beforeEach } from "vitest";
import { readLocalStats, bumpLocalStat, statsLine } from "./local-stats";

beforeEach(() => localStorage.clear());

describe("local-stats", () => {
  it("starts at zeros and bumps individually", () => {
    expect(readLocalStats()).toEqual({ reportsExported: 0, shareCardsCopied: 0, walkthroughsOpened: 0 });
    bumpLocalStat("reportsExported");
    bumpLocalStat("walkthroughsOpened");
    bumpLocalStat("walkthroughsOpened");
    expect(readLocalStats()).toEqual({ reportsExported: 1, shareCardsCopied: 0, walkthroughsOpened: 2 });
  });

  it("corrupt or foreign-shaped storage degrades to zeros, never throws", () => {
    localStorage.setItem("compy_local_stats_v1", "{not json");
    expect(readLocalStats()).toEqual({ reportsExported: 0, shareCardsCopied: 0, walkthroughsOpened: 0 });
    localStorage.setItem("compy_local_stats_v1", JSON.stringify({ reportsExported: -5, shareCardsCopied: "9", walkthroughsOpened: 2.7 }));
    // Negative → 0, string → 0, fraction → floored: counters are honest integers or nothing.
    expect(readLocalStats()).toEqual({ reportsExported: 0, shareCardsCopied: 0, walkthroughsOpened: 2 });
  });

  it("statsLine is null at all zeros (no noise) and pluralizes honestly", () => {
    expect(statsLine({ reportsExported: 0, shareCardsCopied: 0, walkthroughsOpened: 0 })).toBeNull();
    const line = statsLine({ reportsExported: 1, shareCardsCopied: 2, walkthroughsOpened: 0 });
    expect(line).toContain("1 report exported");
    expect(line).toContain("2 share cards copied");
    expect(line).toContain("0 walkthroughs opened");
    expect(line).toContain("only on this PC");
  });
});
