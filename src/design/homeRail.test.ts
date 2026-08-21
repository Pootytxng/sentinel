import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { HOME_RAIL, railFor, railGroups } from "./homeRail";

// Rail-parity guard (one-rail §1, owner condition): the six-home rail is THE single navigation set,
// and the app-shell rail must render from it — so a private second map can't drift. Fails on any
// change to the blessed set/order/labels, and if the rail stops sourcing the shared list. (The
// guard's second rail, the CommandCenter Home, was deleted with the dead-surface cleanup 2026-07-11
// — the shell rail is the ONE rail now.)
describe("home rail parity", () => {
  it("is the blessed six-home set, in order", () => {
    expect(HOME_RAIL.map((r) => r.id)).toEqual(["home", "check", "play", "fix", "learn", "lab"]);
    // "Live" + "History" + "Test" labels = owner-approved renames (2026-08-12; earlier rounds
    // 2026-06-12/15); persisted ids unchanged (the id "play" stays the nav key behind "Live").
    expect(HOME_RAIL.map((r) => r.label)).toEqual(["Health", "Check", "Live", "Tune", "History", "Test"]);
  });

  it("the app-shell rail renders from the shared rail (no second map)", () => {
    const app = readFileSync(join("src", "App.tsx"), "utf8");
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

// The proving-ground rail (owner decision 2026-07-10, ships WITH the compy_lab_ground default-ON
// flip): the standalone Optimize room drops from the rail entirely — the Lab's Optimize station
// is the ONE door to the safe-tweak toggles. Four rooms, relative order preserved (the Lab stays
// the last chapter). compy_lab_ground="0" restores the classic rails above.
describe("railFor — proving ground drops the standalone Optimize room", () => {
  it("ground: Home · Live · History · Test — no check, no fix, order preserved", () => {
    const rail = railFor(true, true);
    expect(rail.map((r) => r.id)).toEqual(["home", "play", "learn", "lab"]);
    expect(rail.map((r) => r.label)).toEqual(["Health", "Live", "History", "Test"]);
  });

  it("ground wins over the merge flag (same rail either way)", () => {
    expect(railFor(false, true)).toEqual(railFor(true, true));
  });

  it("ground=false keeps both classic shapes untouched", () => {
    expect(railFor(false, false)).toBe(HOME_RAIL);
    expect(railFor(true, false).map((r) => r.id)).toEqual(["home", "fix", "play", "learn", "lab"]);
  });

  it("does not mutate HOME_RAIL", () => {
    railFor(true, true);
    expect(HOME_RAIL.map((r) => r.id)).toEqual(["home", "check", "play", "fix", "learn", "lab"]);
  });
});

// Design foundation ⑤ — instruments behind a door (docs/decisions/2026-08-11-design-foundation.md
// decision 6). Health is the one front door; everything else on the rail is an instrument under its
// own sign. Grouping, not hiding: the two groups together are the rail, nothing dropped, rail order
// kept — a "door" that removed a room from the rail would be the hide-behind-a-toggle the
// 2026-08-06 directive bars.
describe("railGroups — the front door and the instruments", () => {
  it("the shipped rail: Health alone at the door, Live · History · Test under the sign, in rail order", () => {
    const rail = railFor(true, true);
    const g = railGroups(rail);
    expect(g.door.map((r) => r.id)).toEqual(["home"]);
    expect(g.instruments.map((r) => r.id)).toEqual(["play", "learn", "lab"]);
  });

  it("never drops or reorders a room: door + instruments is the rail itself, whatever the rail is", () => {
    for (const rail of [HOME_RAIL, railFor(true), railFor(true, true)]) {
      const g = railGroups(rail);
      expect([...g.door, ...g.instruments]).toEqual(rail);
    }
  });
});
