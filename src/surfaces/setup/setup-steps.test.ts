import { describe, it, expect } from "vitest";
import { buildSetupSteps, ROOM_PURPOSE } from "./setup-steps";
import { HOME_RAIL } from "../../design/homeRail";

describe("buildSetupSteps", () => {
  const steps = buildSetupSteps();

  it("has the four setup steps first, in order", () => {
    const setup = steps.filter((s) => s.leg === "setup");
    expect(setup.map((s) => s.kind)).toEqual(["rig", "seatbelt", "rules", "check"]);
    // they lead the flow
    expect(steps.slice(0, 4)).toEqual(setup);
  });

  it("covers every room exactly once, in rail order, after the setup leg", () => {
    const tour = steps.filter((s) => s.leg === "tour");
    expect(tour.map((s) => s.room)).toEqual(HOME_RAIL.map((r) => r.id));
    expect(new Set(tour.map((s) => s.room)).size).toBe(HOME_RAIL.length);
  });

  it("uses the live rail labels as tour titles (rename-safe)", () => {
    const tour = steps.filter((s) => s.leg === "tour");
    for (const s of tour) {
      const rail = HOME_RAIL.find((r) => r.id === s.room);
      expect(s.title).toBe(rail?.label);
    }
  });

  it("gives every step a unique id and non-empty body", () => {
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(steps.every((s) => s.body.trim().length > 0)).toBe(true);
  });

  it("ROOM_PURPOSE has exactly one entry per room — no missing, no orphans", () => {
    expect(Object.keys(ROOM_PURPOSE).sort()).toEqual(HOME_RAIL.map((r) => r.id).sort());
  });
});
