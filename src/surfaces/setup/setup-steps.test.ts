import { describe, it, expect } from "vitest";
import {
  buildSetupSteps,
  buildHardwareSteps,
  buildTabs,
  HARDWARE_LESSONS,
  TAB_BLURB,
} from "./setup-steps";
import { HOME_RAIL } from "../../design/homeRail";
import type { RigPart, RigPartKind } from "../rig/rig-parts";

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

const RAIL_IDS = HOME_RAIL.map((r) => r.id).sort();

describe("buildSetupSteps", () => {
  const steps = buildSetupSteps(PARTS);

  it("leads with the four setup steps in order", () => {
    expect(steps.slice(0, 4).map((s) => s.kind)).toEqual(["rig", "seatbelt", "rules", "check"]);
    expect(steps.slice(0, 4).every((s) => s.leg === "setup")).toBe(true);
  });

  it("tours hardware in the owner's order, then ends with the six-tab recap", () => {
    const tour = steps.filter((s) => s.leg === "tour");
    const lessons = tour.filter((s) => s.kind === "lesson");
    expect(lessons.map((s) => s.lesson?.kind)).toEqual(["psu", "storage", "gpu", "cpu", "ram"]);
    const last = steps[steps.length - 1];
    expect(last.kind).toBe("tabmap");
    expect(last.tabs?.length).toBe(HOME_RAIL.length);
  });

  it("focuses each lesson on the REAL part of its kind, titled with the real name", () => {
    const gpu = steps.find((s) => s.lesson?.kind === "gpu");
    expect(gpu?.focusId).toBe("gpu-0");
    expect(gpu?.title).toBe("Radeon RX 9070 XT");
  });

  it("gives every step a unique id", () => {
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it("titles the memory lesson by REAL total + module count, never a misleading 'Slot 1'", () => {
    const ram = (id: string, gb: number): RigPart => ({
      ...part(id, "ram", `Memory · ${id}`),
      capacityBytes: gb * 1024 ** 3,
    });
    const two = buildHardwareSteps([part("cpu", "cpu", "CPU"), ram("ram-0", 16), ram("ram-1", 16)]);
    expect(two.find((s) => s.lesson?.kind === "ram")?.title).toBe("Memory · 32.0 GB · 2 modules");
    const one = buildHardwareSteps([ram("ram-0", 16)]);
    expect(one.find((s) => s.lesson?.kind === "ram")?.title).toBe("Memory · 16.0 GB");
  });
});

describe("hardware ↔ tab ties", () => {
  it("every lesson names a real Compy tab + a tie phrase", () => {
    for (const l of HARDWARE_LESSONS) {
      expect(RAIL_IDS).toContain(l.tab.id);
      expect(l.tab.tie.trim().length).toBeGreaterThan(0);
    }
  });

  it("the lessons collectively introduce 5 distinct tabs (Blackbook is the recap finale)", () => {
    const tabs = new Set(HARDWARE_LESSONS.map((l) => l.tab.id));
    expect(tabs.size).toBe(5);
    expect(tabs.has("learn")).toBe(false); // learn/Blackbook is covered by the recap, not a lesson
  });

  it("every lesson carries a role, an affected metric and at least one real tweak", () => {
    for (const l of HARDWARE_LESSONS) {
      expect(l.role.trim().length).toBeGreaterThan(0);
      expect(l.affects.trim().length).toBeGreaterThan(0);
      expect(l.tweaks.length).toBeGreaterThan(0);
    }
  });

  it("the power lesson keeps the PSU honesty caveat", () => {
    const psu = HARDWARE_LESSONS.find((l) => l.kind === "psu");
    expect(psu?.note).toMatch(/can't read your PSU/i);
  });
});

describe("buildTabs / TAB_BLURB", () => {
  it("covers exactly the six rail rooms with a blurb each", () => {
    expect(Object.keys(TAB_BLURB).sort()).toEqual(RAIL_IDS);
    const tabs = buildTabs();
    expect(tabs.map((t) => t.id).sort()).toEqual(RAIL_IDS);
    expect(tabs.every((t) => t.label && t.icon && t.blurb.trim().length > 0)).toBe(true);
  });
});

describe("buildHardwareSteps", () => {
  it("skips lessons whose component kind is absent from the rig", () => {
    const noGpu = PARTS.filter((p) => p.kind !== "gpu");
    expect(buildHardwareSteps(noGpu).some((s) => s.lesson?.kind === "gpu")).toBe(false);
  });
});
