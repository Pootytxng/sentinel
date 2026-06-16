import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { HOME_RAIL } from "./homeRail";

// Rail-parity guard (one-rail §1, owner condition): the six-home rail is THE single navigation set,
// and both the CommandCenter rail and the app-shell rail must render from it — so they can't drift.
// Fails on any change to the blessed set/order/labels, and if either rail stops sourcing HOME_RAIL.
describe("home rail parity", () => {
  it("is the blessed six-home set, in order", () => {
    expect(HOME_RAIL.map((r) => r.id)).toEqual(["home", "check", "play", "fix", "learn", "lab"]);
    // "Monitor" (2026-06-15) + "Tune" + "Blackbook" labels = owner-approved renames; persisted ids
    // unchanged (the id "play" stays the nav key behind the "Monitor" label).
    expect(HOME_RAIL.map((r) => r.label)).toEqual(["Home", "Check", "Monitor", "Tune", "Blackbook", "Lab"]);
  });

  it("BOTH the CommandCenter rail and the app-shell rail render from HOME_RAIL (no second map)", () => {
    const cc = readFileSync(join("src", "surfaces", "CommandCenter.tsx"), "utf8");
    const app = readFileSync(join("src", "App.tsx"), "utf8");
    expect(cc, "CommandCenter must source the shared rail").toMatch(/HOME_RAIL/);
    expect(app, "the app shell must source the shared rail").toMatch(/HOME_RAIL/);
  });
});
