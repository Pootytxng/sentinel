import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { safeFixesReadyList, safeFixesReady, optimizeVerdict } from "./optimize-v2-data";
import type { Recommendation } from "../types";

// Key-echo stub: assertions pin i18n keys + interpolation args, never English copy.
const t = ((k: string, o?: Record<string, unknown>) =>
  o ? `${k}:${JSON.stringify(o)}` : k) as unknown as TFunction;
const K = "optimize.optimizeV2.verdict.";
const withCount = (key: string, count: number) => `${K}${key}:${JSON.stringify({ count })}`;

const rec = (id: string, p: Partial<Recommendation> = {}): Recommendation => ({
  id,
  title: id,
  category: "gaming",
  severity: "safe",
  description: "",
  impact: "",
  downside: null,
  applies_to: "",
  currently_applied: false,
  provenance: "expected-impact",
  ...p,
});
const all = () => true;

describe("safeFixesReadyList / safeFixesReady", () => {
  it("keeps only safe, appliable, not-applied, eligible, not-reverted recs", () => {
    const recs = [
      rec("ok"),
      rec("eligible-true", { eligible: true }),
      rec("moderate", { severity: "moderate" }),
      rec("advanced", { severity: "advanced" }),
      rec("applied", { currently_applied: true }),
      rec("ineligible", { eligible: false }),
      rec("not-appliable"),
      rec("reverted"),
    ];
    const list = safeFixesReadyList(recs, (id) => id !== "not-appliable", new Set(["reverted"]));
    expect(list.map((r) => r.id)).toEqual(["ok", "eligible-true"]);
    expect(safeFixesReady(recs, (id) => id !== "not-appliable", new Set(["reverted"]))).toBe(2);
  });

  it("treats a missing eligible field as eligible and a missing revertedIds as none", () => {
    expect(safeFixesReady([rec("a")], all)).toBe(1);
  });

  it("is zero for an empty list or an all-moderate/advanced catalog", () => {
    expect(safeFixesReady([], all)).toBe(0);
    expect(safeFixesReady([rec("m", { severity: "moderate" }), rec("x", { severity: "advanced" })], all)).toBe(0);
  });

  it("count always equals the list length (one predicate)", () => {
    const recs = [rec("a"), rec("b", { currently_applied: true }), rec("c")];
    expect(safeFixesReady(recs, all)).toBe(safeFixesReadyList(recs, all).length);
  });
});

describe("optimizeVerdict", () => {
  it("is unsettled while recs are loading", () => {
    expect(optimizeVerdict(null, all, 5, [], t)).toEqual({
      settled: false,
      allClear: false,
      headline: `${K}checkingHeadline`,
    });
  });

  it("one ready fix: singular headline + undo sub, not all-clear", () => {
    expect(optimizeVerdict([rec("a")], all, 0, [], t)).toEqual({
      settled: true,
      allClear: false,
      headline: withCount("readyHeadline", 1),
      sub: `${K}undoSub`,
    });
  });

  it("several ready fixes with drift: count + drift clause appended to the sub", () => {
    const v = optimizeVerdict([rec("a"), rec("b"), rec("c")], all, 2, [{ rec_id: "z" }, { rec_id: "y" }], t);
    expect(v.headline).toBe(withCount("readyHeadline", 3));
    expect(v.sub).toBe(`${K}undoSub${withCount("driftClauseSuffix", 2)}`);
    expect(v.allClear).toBe(false);
  });

  it("a reverted rec is never counted as ready (drifted-only branch)", () => {
    const v = optimizeVerdict([rec("a")], all, 0, [{ rec_id: "a" }], t);
    expect(v).toEqual({
      settled: true,
      allClear: false,
      headline: withCount("driftedOnlyHeadline", 1),
      sub: withCount("driftedOnlySub", 1),
    });
  });

  it("drifted-only plural", () => {
    const v = optimizeVerdict([], all, 4, [{ rec_id: "a" }, { rec_id: "b" }, { rec_id: "c" }], t);
    expect(v.headline).toBe(withCount("driftedOnlyHeadline", 3));
    expect(v.sub).toBe(withCount("driftedOnlySub", 3));
    expect(v.allClear).toBe(false);
  });

  it("all safe fixes active: all-clear with the active count (singular and plural)", () => {
    const applied = [rec("a", { currently_applied: true })];
    expect(optimizeVerdict(applied, all, 1, [], t)).toEqual({
      settled: true,
      allClear: true,
      headline: withCount("allSafeActiveHeadline", 1),
      sub: `${K}undoSub`,
    });
    expect(optimizeVerdict(applied, all, 7, [], t).headline).toBe(withCount("allSafeActiveHeadline", 7));
  });

  it("nothing to apply and nothing active: all-clear nothing-to-apply copy", () => {
    // Mixed tiers where no safe one-click fix exists (moderate rec, un-appliable safe rec).
    const recs = [rec("m", { severity: "moderate" }), rec("s")];
    expect(optimizeVerdict(recs, () => false, 0, [], t)).toEqual({
      settled: true,
      allClear: true,
      headline: `${K}nothingToApplyHeadline`,
      sub: `${K}nothingToApplySub`,
    });
  });
});
