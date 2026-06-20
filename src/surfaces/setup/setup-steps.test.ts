import { describe, it, expect } from "vitest";
import { buildSetupSteps, buildHardwareSteps, HARDWARE_LESSONS } from "./setup-steps";
import type { RigPart, RigPartKind } from "../rig/rig-parts";

// Minimal stand-in parts (only the fields the step builder reads).
function part(id: string, kind: RigPartKind, name: string): RigPart {
  return {
    id,
    name,
    category: kind,
    kind,
    detected: kind !== "psu" && kind !== "cooler",
    assembled: [0, 0, 0],
    exploded: [0, 0, 0],
    tagline: "",
    specs: [],
  };
}

const PARTS: RigPart[] = [
  part("board", "board", "Mainboard"),
  part("cpu", "cpu", "Ryzen 7 9850X3D"),
  part("ram-0", "ram", "Memory · Slot 1"),
  part("gpu-0", "gpu", "Radeon RX 9070 XT"),
  part("disk-0", "storage", "Samsung 990 Pro"),
  part("psu", "psu", "Power Supply"),
];

describe("buildSetupSteps", () => {
  const steps = buildSetupSteps(PARTS);

  it("leads with the four setup steps in order", () => {
    expect(steps.slice(0, 4).map((s) => s.kind)).toEqual(["rig", "seatbelt", "rules", "check"]);
    expect(steps.slice(0, 4).every((s) => s.leg === "setup")).toBe(true);
  });

  it("then tours hardware in the owner's order: power → storage → graphics → processor → memory", () => {
    const tour = steps.filter((s) => s.leg === "tour");
    expect(tour.map((s) => s.lesson?.kind)).toEqual(["psu", "storage", "gpu", "cpu", "ram"]);
    expect(tour.every((s) => s.kind === "lesson")).toBe(true);
  });

  it("focuses each lesson on the REAL part of its kind, titled with the real name", () => {
    const gpu = steps.find((s) => s.lesson?.kind === "gpu");
    expect(gpu?.focusId).toBe("gpu-0");
    expect(gpu?.title).toBe("Radeon RX 9070 XT");
    const psu = steps.find((s) => s.lesson?.kind === "psu");
    expect(psu?.focusId).toBe("psu");
  });

  it("gives every step a unique id", () => {
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });
});

describe("buildHardwareSteps", () => {
  it("skips lessons whose component kind is absent from the rig", () => {
    const noGpu = PARTS.filter((p) => p.kind !== "gpu");
    const tour = buildHardwareSteps(noGpu);
    expect(tour.some((s) => s.lesson?.kind === "gpu")).toBe(false);
  });

  it("every lesson carries a role, an affected metric and at least one real tweak", () => {
    for (const l of HARDWARE_LESSONS) {
      expect(l.role.trim().length).toBeGreaterThan(0);
      expect(l.affects.trim().length).toBeGreaterThan(0);
      expect(l.tweaks.length).toBeGreaterThan(0);
      expect(l.tweaks.every((t) => t.trim().length > 0)).toBe(true);
    }
  });

  it("the power lesson carries the PSU honesty caveat", () => {
    const psu = HARDWARE_LESSONS.find((l) => l.kind === "psu");
    expect(psu?.note).toMatch(/can't read your PSU/i);
  });
});
