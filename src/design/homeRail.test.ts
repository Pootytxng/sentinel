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
    expect(HOME_RAIL.map((r) => r.label)).toEqual(["Home", "Check", "Play", "Fix", "Learn", "Lab"]);
  });

  it("the CommandCenter rail renders from HOME_RAIL (single source)", () => {
    const cc = readFileSync(join("src", "surfaces", "CommandCenter.tsx"), "utf8");
    expect(cc, "CommandCenter must source the shared rail").toMatch(/HOME_RAIL/);
    // §1b (shell-rail swap): extend this to also assert App.tsx sources HOME_RAIL, so the two rails
    // are parity-locked once the shell adopts it. Held until the coupled re-homing (Diagnostics→Lab,
    // ledger→Fix) lands in the same unit, so removing legacy rail items never strands content.
  });
});
