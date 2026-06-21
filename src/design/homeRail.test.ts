import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { HOME_RAIL, railFor } from "./homeRail";

// Rail-parity guard (one-rail §1, owner condition): the six-home rail is THE single navigation set,
// and both the CommandCenter rail and the app-shell rail must render from it — so they can't drift.
// Fails on any change to the blessed set/order/labels, and if either rail stops sourcing the shared
// rail. Both rails now route through railFor (which is built FROM HOME_RAIL), so the guard accepts
// either name as proof the rail isn't a private second map.
describe("home rail parity", () => {
  it("is the blessed six-home set, in order", () => {
    expect(HOME_RAIL.map((r) => r.id)).toEqual(["home", "check", "play", "fix", "learn", "lab"]);
    // "Monitor" (2026-06-15) + "Tune" + "Blackbook" labels = owner-approved renames; persisted ids
    // unchanged (the id "play" stays the nav key behind the "Monitor" label).
    expect(HOME_RAIL.map((r) => r.label)).toEqual(["Home", "Check", "Monitor", "Tune", "Blackbook", "Lab"]);
  });

  it("BOTH the CommandCenter rail and the app-shell rail render from the shared rail (no second map)", () => {
    const cc = readFileSync(join("src", "surfaces", "CommandCenter.tsx"), "utf8");
    const app = readFileSync(join("src", "App.tsx"), "utf8");
    expect(cc, "CommandCenter must source the shared rail").toMatch(/HOME_RAIL|railFor/);
    expect(app, "the app shell must source the shared rail").toMatch(/HOME_RAIL|railFor/);
  });
});

// railFor — the rendered-rail selector for the Optimize merge (phase 1a, spec
// 2026-06-21-optimize-merge-design). Off → the blessed six-home set verbatim. On → Check + Tune
// collapse into one "Optimize" room (5), ids/routing otherwise untouched.
describe("railFor — Optimize merge collapse", () => {
  it("is the blessed six-home set, unchanged, when the merge is OFF", () => {
    expect(railFor(false)).toBe(HOME_RAIL); // same reference — no copy, no drift
    expect(railFor(false).map((r) => r.id)).toEqual(["home", "check", "play", "fix", "learn", "lab"]);
  });

  it("collapses to 5 rooms with no standalone check when the merge is ON", () => {
    const rail = railFor(true);
    expect(rail.map((r) => r.id)).toEqual(["home", "fix", "play", "learn", "lab"]);
    expect(rail.some((r) => r.id === "check")).toBe(false);
  });

  it("relabels the merged room to 'Optimize' (the id stays 'fix' — the persisted nav key)", () => {
    const merged = railFor(true).find((r) => r.id === "fix");
    expect(merged?.label).toBe("Optimize");
  });

  it("does not mutate HOME_RAIL — the off path stays the blessed source", () => {
    railFor(true);
    expect(HOME_RAIL.find((r) => r.id === "fix")?.label).toBe("Tune");
    expect(HOME_RAIL.some((r) => r.id === "check")).toBe(true);
  });
});
