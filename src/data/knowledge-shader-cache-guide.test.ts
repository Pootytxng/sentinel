// Content guard for the shader-cache-guide (A4 content lane). Bug->guard: the honesty corpus audit
// (2026-06-25) flagged that the guide's steps were NVIDIA-Control-Panel-specific — they told every
// user to set a "Shader Cache Size" to Unlimited/10 GB, but AMD Adrenalin (our own dev-rig vendor)
// and Intel expose only an on/off Shader Cache, NOT a size knob (AMD: Graphics -> Advanced, "AMD
// optimized" by default, plus a Reset Shader Cache button — verified against AMD's own support docs).
// An AMD user literally could not find the named setting. This guard pins the vendor-aware fix so the
// steps can never silently regress to a single-vendor instruction that strands AMD/Intel readers.

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID, entryBody } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";

const ID = "shader-cache-guide";

describe("shader-cache-guide", () => {
  it("ships as a safe guide", () => {
    const e = KNOWLEDGE_BY_ID.get(ID);
    expect(e, `entry "${ID}" must exist`).toBeTruthy();
    expect(e!.type).toBe("guide");
    if (e!.type !== "guide") throw new Error("expected guide");
    expect(e!.tier).toBe("safe");
  });

  it("is vendor-aware — names NVIDIA, AMD, and Intel (not NVIDIA-only)", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    const body = entryBody(e);
    // The original bug: the guide mentioned only the NVIDIA "Shader Cache Size" knob. AMD must appear
    // so an AMD reader isn't sent looking for a setting their driver doesn't have.
    expect(body, "must mention NVIDIA").toMatch(/NVIDIA/i);
    expect(body, "must mention AMD").toMatch(/AMD/i);
    expect(body, "must mention Intel").toMatch(/Intel/i);
  });

  it("tells AMD/Intel users there is no size knob (the corrected fact)", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    if (e.type !== "guide") throw new Error("expected guide");
    const steps = e.steps.join(" ");
    // AMD/Intel have an on/off cache, not a size — the guide must say so rather than instruct a size.
    expect(steps, "must state AMD/Intel offer no size").toMatch(/no size|don't offer a size|on\/off/i);
    // The only non-toggle control on AMD is Reset/Clear — the guide should point there, not at a size.
    expect(`${steps} ${e.undo}`, "must name the AMD Reset/Clear control").toMatch(/reset|clear/i);
  });

  it("keeps the NVIDIA size instruction scoped to NVIDIA (no blanket 'set the size')", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    if (e.type !== "guide") throw new Error("expected guide");
    // The "Unlimited / 10 GB" size advice must live in a step that names NVIDIA, so it never reads as a
    // universal instruction again.
    const sizeStep = e.steps.find((s) => /unlimited|10 ?gb/i.test(s));
    expect(sizeStep, "a step must give the NVIDIA size value").toBeTruthy();
    expect(sizeStep!, "the size step must be scoped to NVIDIA").toMatch(/NVIDIA/i);
  });

  it("stays findable by the phrases people search", () => {
    const all = [...KNOWLEDGE_BY_ID.values()];
    expect(searchKnowledge("shader cache", all).map((x) => x.id)).toContain(ID);
    expect(searchKnowledge("fix shader stutter", all).map((x) => x.id)).toContain(ID);
  });
});
