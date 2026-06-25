// Content guard for the driver-update-guide (A4 content lane). Bug->guard, same defect class as the
// shader-cache-guide vendor fix (2026-06-25): a GPU-driver guide that names only some vendors strands
// the rest. driver-update-guide step 1 originally said "AMD's or NVIDIA's own site or app" — an Intel
// GPU owner (Arc discrete cards, or any Intel iGPU) was sent looking in the wrong place. The fix names
// all three makers. This guard pins that "get it from the vendor" guides stay vendor-complete.

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID, entryBody } from "./knowledge";

const ID = "driver-update-guide";

describe("driver-update-guide", () => {
  it("ships as a safe guide", () => {
    const e = KNOWLEDGE_BY_ID.get(ID);
    expect(e, `entry "${ID}" must exist`).toBeTruthy();
    expect(e!.type).toBe("guide");
    if (e!.type !== "guide") throw new Error("expected guide");
    expect(e!.tier).toBe("safe");
  });

  it("names all three GPU makers — doesn't strand Intel (or any vendor)", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    if (e.type !== "guide") throw new Error("expected guide");
    // The "get the driver from the vendor" step applies equally to AMD, NVIDIA, and Intel — naming a
    // subset misdirects the omitted vendor's users. The original bug omitted Intel.
    const steps = e.steps.join(" ");
    expect(steps, "must name AMD").toMatch(/AMD/i);
    expect(steps, "must name NVIDIA").toMatch(/NVIDIA/i);
    expect(steps, "must name Intel").toMatch(/Intel/i);
  });

  it("still steers users away from third-party 'driver updater' tools (the honest core advice)", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    const body = entryBody(e).toLowerCase();
    expect(body).toMatch(/third-party|driver updater/);
    // DDU stays scoped to "something's actually wrong" — it is not a routine step.
    expect(body).toMatch(/ddu|display driver uninstaller/);
  });
});
