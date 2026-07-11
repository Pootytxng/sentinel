import { describe, it, expect } from "vitest";
import { TUNING_PRESETS, resolvePresetItems } from "./monitor-view";
import { walkthroughForKey } from "./walkthroughs";

// monitor-view — pure advisory data for the Monitor surface's 3-mode preset GUIDED checklists
// (Max Quality / More FPS / Lower Latency). Each preset is a curated list of EXISTING guided walkthroughs
// (out-of-Compy advisory steps). Read-only/advisory only: nothing here touches Windows, opens a URI,
// or invokes IPC — it just maps a preset to the walkthroughs the user can follow by hand.

describe("monitor-view tuning presets", () => {
  it("defines exactly the three named presets", () => {
    expect(TUNING_PRESETS.map((p) => p.id)).toEqual(["visual-fidelity", "smooth", "clarity"]);
  });

  it("labels use consumer-market terms (owner direction 2026-07-10) — never the abstract trio", () => {
    // Goal-register comparatives, NOT the console readouts' stat terms ("MAX FPS"/"LOWEST LATENCY"
    // render on the same screen; a preset chip must never read as a measured value).
    expect(TUNING_PRESETS.map((p) => p.label)).toEqual(["Max Quality", "More FPS", "Lower Latency"]);
  });

  it("each preset has a label, a plain-English goal, and ≥1 walkthrough key", () => {
    for (const p of TUNING_PRESETS) {
      expect(p.label.trim().length, p.id).toBeGreaterThan(0);
      expect(p.goal.trim().length, p.id).toBeGreaterThan(0);
      expect(p.keys.length, p.id).toBeGreaterThan(0);
    }
  });

  it("preset ids are unique", () => {
    const ids = TUNING_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every walkthrough key in every preset resolves to a real walkthrough", () => {
    for (const p of TUNING_PRESETS) {
      for (const k of p.keys) {
        expect(walkthroughForKey(k), `${p.id} → ${k}`).not.toBeNull();
      }
    }
  });

  it("a preset's keys are unique (no duplicate checklist rows)", () => {
    for (const p of TUNING_PRESETS) {
      expect(new Set(p.keys).size, p.id).toBe(p.keys.length);
    }
  });

  it("resolvePresetItems returns the resolved walkthroughs in declared order", () => {
    const smooth = TUNING_PRESETS.find((p) => p.id === "smooth")!;
    const items = resolvePresetItems(smooth);
    expect(items.length).toBe(smooth.keys.length);
    expect(items.map((i) => i.key)).toEqual(smooth.keys);
    for (const it of items) {
      expect(it.walkthrough.title.length).toBeGreaterThan(0);
    }
  });

  it("resolvePresetItems silently drops a key that no longer resolves (honest, never fabricates)", () => {
    const fake = { id: "x", label: "X", goal: "g", keys: ["vrr", "nope-not-real"] } as const;
    const items = resolvePresetItems(fake);
    expect(items.map((i) => i.key)).toEqual(["vrr"]);
  });
});
