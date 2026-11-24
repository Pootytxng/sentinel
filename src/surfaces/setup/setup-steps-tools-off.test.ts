import { describe, it, expect } from "vitest";
import {
  buildSetupSteps,
  GROUND_LAB_BLURB,
  GROUND_LAB_BLURB_TOOLS_OFF,
  GROUND_RECAP_BODY,
  GROUND_RECAP_BODY_TOOLS_OFF,
  TIE_TOOLS_OFF,
} from "./setup-steps";
import type { RigPart, RigPartKind } from "../rig/rig-parts";

// D6 (owner decision 2026-11-24, plan _train/d6-test-room-opt-in-plan-v2.md, census rows "tour"): with Test's
// Tuning tools off, the setup tour never sends the user to a scan or a switch that Test is not showing, and
// its recap and Test blurb say what Test holds then. The rail itself (and its "Test" label) is unchanged.

function part(id: string, kind: RigPartKind, name: string): RigPart {
  return {
    id,
    name,
    category: kind,
    kind,
    detected: true,
    assembled: [0, 0, 0],
    exploded: [0, 0, 0],
    tagline: "",
    specs: [],
  };
}

const PARTS: RigPart[] = [
  part("cpu", "cpu", "Ryzen 7"),
  part("ram-0", "ram", "Memory"),
  part("gpu-0", "gpu", "Radeon"),
  part("disk-0", "storage", "SSD"),
  part("psu", "psu", "Power Supply"),
];

const text = (tools: boolean) => JSON.stringify(buildSetupSteps(PARTS, true, true, undefined, tools));

describe("the ground-rail tour with the tuning tools off", () => {
  // Break check: drop the `!tools &&` tie branch in buildHardwareSteps and "applies the top fix" returns.
  it("ties no lesson to a hidden scan or switch", () => {
    const off = text(false);
    expect(off).not.toContain("scans for CPU limiters and applies the top fix");
    expect(off).not.toContain("Test's Optimize station");
    expect(off).not.toContain("Prove the clocks hold with benchmarks");
    expect(off).toContain(TIE_TOOLS_OFF);
  });

  // Control for the row above: the PSU lesson is in this flow, so its benchmark tie shows with the tools on.
  it("the PSU lesson's benchmark tie is there with the tools on", () => {
    expect(text(true)).toContain("Prove the clocks hold with benchmarks");
  });

  // Break check: make the recap ignore `tools` and GROUND_RECAP_BODY ("Test to check, fix and prove it") returns.
  it("recaps Test as Compy's changes and their undo, and blurbs it the same way", () => {
    const off = text(false);
    expect(off).toContain(GROUND_RECAP_BODY_TOOLS_OFF);
    expect(off).not.toContain(GROUND_RECAP_BODY);
    expect(off).toContain(GROUND_LAB_BLURB_TOOLS_OFF);
    expect(off).not.toContain(GROUND_LAB_BLURB);
  });

  // Control: the default (tools on, or not told) is byte-for-byte the tour it always was.
  it("is unchanged with the tools on", () => {
    expect(text(true)).toBe(JSON.stringify(buildSetupSteps(PARTS, true, true)));
    expect(text(true)).toContain(GROUND_RECAP_BODY);
    expect(text(true)).not.toContain(TIE_TOOLS_OFF);
  });
});
