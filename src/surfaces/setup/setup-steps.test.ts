import { describe, it, expect } from "vitest";
import {
  buildSetupSteps,
  buildHardwareSteps,
  buildTabs,
  HARDWARE_LESSONS,
  TAB_BLURB,
  MERGED_FIX_BLURB,
  GROUND_LAB_BLURB,
  JOURNEY_RECAP_BODY,
  GROUND_RECAP_BODY,
} from "./setup-steps";
import { HOME_RAIL, railFor } from "../../design/homeRail";
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

  it("tours hardware in the owner's order, then ends with the rail recap", () => {
    const tour = steps.filter((s) => s.leg === "tour");
    const lessons = tour.filter((s) => s.kind === "lesson");
    expect(lessons.map((s) => s.lesson?.kind)).toEqual(["psu", "storage", "gpu", "cpu", "ram"]);
    const last = steps[steps.length - 1];
    expect(last.kind).toBe("tabmap");
    expect(last.tabs?.length).toBe(railFor(true).length);
  });

  // V2-8 tour alignment (P6 §4): the recap follows the rail the user actually has and, on the
  // merged five-room rail, NAMES the journey in rail order. Align, don't add — same step count.
  it("merged recap = the five journey rooms in rail order, body names the journey", () => {
    const last = steps[steps.length - 1];
    expect(last.tabs?.map((t) => t.id)).toEqual(["home", "games", "problems", "fix", "play", "learn", "lab"]);
    expect(last.body).toBe(JOURNEY_RECAP_BODY);
    // The journey copy names every room in rail order (order is felt — the recap says it once).
    // Room labels renamed by owner decision 2026-08-12 (Monitor→Live, Blackbook→History, Lab→Test).
    for (const label of ["Health", "Games", "Problems", "Optimize", "Live", "History", "Test"]) {
      expect(last.body).toContain(label);
    }
  });

  it("classic escape hatch (merged=false) keeps the six-room recap verbatim", () => {
    const classic = buildSetupSteps(PARTS, false);
    const last = classic[classic.length - 1];
    expect(last.tabs?.length).toBe(HOME_RAIL.length);
    expect(last.body).toBe("Six rooms, one job each. Here's where everything lives.");
    expect(classic.length).toBe(steps.length); // align, don't add: no step count change
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
  it("classic: covers exactly the six rail rooms with a blurb each", () => {
    expect(Object.keys(TAB_BLURB).sort()).toEqual(RAIL_IDS);
    const tabs = buildTabs(false);
    expect(tabs.map((t) => t.id).sort()).toEqual(RAIL_IDS);
    expect(tabs.every((t) => t.label && t.icon && t.blurb.trim().length > 0)).toBe(true);
  });

  it("merged: the five journey rooms from railFor, and Optimize's blurb covers check AND fix", () => {
    const tabs = buildTabs(true);
    expect(tabs.map((t) => t.id)).toEqual(railFor(true).map((r) => r.id));
    const optimize = tabs.find((t) => t.id === "fix")!;
    expect(optimize.label).toBe("Optimize");
    expect(optimize.blurb).toBe(MERGED_FIX_BLURB);
    // Both halves of the merged room are in the blurb: the diagnose half and the undo promise.
    expect(optimize.blurb).toMatch(/check/i);
    expect(optimize.blurb).toMatch(/undoable/i);
  });
});

describe("V2-8 merged tab ties — no lesson may point at a room the rail doesn't show", () => {
  it("remaps the Check-tab tie to the merged Optimize room", () => {
    const cpu = buildHardwareSteps(PARTS, true).find((s) => s.lesson?.kind === "cpu");
    expect(cpu?.lesson?.tab.id).toBe("fix");
    expect(cpu?.lesson?.tab.tie).toBe("Optimize scans for CPU limiters and applies the top fix.");
  });

  it("keeps the classic Check tie under the escape hatch", () => {
    const cpu = buildHardwareSteps(PARTS, false).find((s) => s.lesson?.kind === "cpu");
    expect(cpu?.lesson?.tab.id).toBe("check");
  });

  it("every merged lesson tie targets a room present on the merged rail", () => {
    const mergedIds = new Set(railFor(true).map((r) => r.id));
    for (const s of buildHardwareSteps(PARTS, true)) {
      expect(mergedIds.has(s.lesson!.tab.id), `lesson ${s.lesson!.kind}`).toBe(true);
    }
  });
});

describe("buildHardwareSteps", () => {
  it("skips lessons whose component kind is absent from the rig", () => {
    const noGpu = PARTS.filter((p) => p.kind !== "gpu");
    expect(buildHardwareSteps(noGpu).some((s) => s.lesson?.kind === "gpu")).toBe(false);
  });
});

// The proving-ground tour (2026-07-10 flip: no standalone Optimize tab — the Lab's Optimize
// station is the one door). Same law as the merged alignment: no lesson or recap may name a
// room the rail doesn't show.
describe("proving-ground tour alignment (ground=true)", () => {
  const steps = buildSetupSteps(PARTS, true, true);

  it("recap = the four ground rooms in rail order, body names that journey", () => {
    const last = steps[steps.length - 1];
    expect(last.kind).toBe("tabmap");
    expect(last.tabs?.map((t) => t.id)).toEqual(["home", "games", "problems", "play", "learn", "lab"]);
    expect(last.body).toBe(GROUND_RECAP_BODY);
    for (const label of ["Health", "Games", "Problems", "Live", "History", "Test"]) {
      expect(last.body).toContain(label);
    }
    // The dead room never appears in the recap copy.
    expect(last.body).not.toContain("Optimize");
  });

  it("the Lab's recap blurb covers the absorbed Optimize: check + fix + undo + prove", () => {
    const lab = buildTabs(true, true).find((t) => t.id === "lab")!;
    expect(lab.blurb).toBe(GROUND_LAB_BLURB);
    expect(lab.blurb).toMatch(/check/i);
    expect(lab.blurb).toMatch(/undoable/i);
    expect(lab.blurb).toMatch(/prove/i);
  });

  it("every ground lesson tie targets a room present on the ground rail", () => {
    const groundIds = new Set(railFor(true, true).map((r) => r.id));
    for (const s of buildHardwareSteps(PARTS, true, true)) {
      expect(groundIds.has(s.lesson!.tab.id), `lesson ${s.lesson!.kind}`).toBe(true);
    }
  });

  it("re-ties the Check and Optimize lessons to the Lab", () => {
    const ground = buildHardwareSteps(PARTS, true, true);
    const cpu = ground.find((s) => s.lesson?.kind === "cpu");
    expect(cpu?.lesson?.tab.id).toBe("lab");
    expect(cpu?.lesson?.tab.tie).toBe("Test scans for CPU limiters and applies the top fix.");
    const storage = ground.find((s) => s.lesson?.kind === "storage");
    expect(storage?.lesson?.tab.id).toBe("lab");
    expect(storage?.lesson?.tab.tie).toBe(
      "Apply or undo these at Test's Optimize station — all in the ledger.",
    );
  });

  it("align, don't add: same step count as the merged tour", () => {
    expect(steps.length).toBe(buildSetupSteps(PARTS, true, false).length);
  });

  it("ground=false leaves the merged and classic tours byte-identical to before", () => {
    expect(buildSetupSteps(PARTS, true, false)).toEqual(buildSetupSteps(PARTS, true));
    expect(buildSetupSteps(PARTS, false, false)).toEqual(buildSetupSteps(PARTS, false));
  });
});

// 2026-07-23 (tester Matthew: "the last tab is the best for clarity" — orientation must not wait
// until the END): the FIRST step carries the mode's rail line; the closing recap still repeats it.
describe("orientation on the first step (2026-07-23)", () => {
  it("ground: the setup-rig body carries the ground rail line AND the recap keeps it", () => {
    const steps = buildSetupSteps(PARTS, true, true);
    expect(steps[0].id).toBe("setup-rig");
    expect(steps[0].body).toContain(GROUND_RECAP_BODY);
    expect(steps[steps.length - 1].body).toBe(GROUND_RECAP_BODY);
  });

  it("merged: the journey line rides the first step", () => {
    const steps = buildSetupSteps(PARTS, true, false);
    expect(steps[0].body).toContain(JOURNEY_RECAP_BODY);
  });

  it("classic six-room: the first step stays untouched (no line to preview)", () => {
    const steps = buildSetupSteps(PARTS, false, false);
    expect(steps[0].body).not.toContain("The rail reads top to bottom");
  });
});
