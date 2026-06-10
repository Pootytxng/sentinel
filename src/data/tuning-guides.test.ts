import { describe, it, expect } from "vitest";
import {
  TUNING_GUIDES,
  TUNING_GUIDE_ENTRIES,
  TUNING_GUIDE_BY_ID,
  isTuningGuideId,
  tuningGuideForVendor,
  toGuideEntry,
} from "./tuning-guides";
import { KNOWLEDGE_BY_ID } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";
import { walkthroughForKey } from "../surfaces/walkthroughs";

// The single-source contract (spec 2026-06-08): the guide copy lives ONCE in tuning-guides.json; the
// Learn entry is derived/injected from it and the walkthrough registers from the same object — they
// can't drift. Plus the v1 locked-scope guarantees (AMD-only, advisory, no appliable catalog growth).

describe("tuning-guides — single source", () => {
  it("ships exactly the AMD GPU undervolt guide in v1 (no NVIDIA/Intel/CPU yet)", () => {
    expect(TUNING_GUIDES.map((g) => g.id)).toEqual(["amd-gpu-undervolt"]);
    const g = TUNING_GUIDE_BY_ID.get("amd-gpu-undervolt")!;
    expect(g.vendor).toBe("amd");
    expect(g.kind).toBe("undervolt"); // not overclock — OC is a heavier-banner follow-up
  });

  it("injects a derived guide entry into the knowledge index, searchable by alias", () => {
    const entry = KNOWLEDGE_BY_ID.get("amd-gpu-undervolt");
    expect(entry?.type).toBe("guide");
    // Findable by the search terms the spec names.
    for (const q of ["undervolt", "adrenalin", "radeon tuning", "quieter gpu"]) {
      expect(searchKnowledge(q).some((e) => e.id === "amd-gpu-undervolt")).toBe(true);
    }
  });

  it("registers the walkthrough so it resolves by the entry id", () => {
    const w = walkthroughForKey("amd-gpu-undervolt");
    expect(w).not.toBeNull();
    expect(w!.group).toBe("tuning");
    expect(w!.variants.some((v) => v.vendor === "amd")).toBe(true);
    // Our own schematic — never a vendor screenshot/logo (all-original law): steps are plain labels.
    for (const v of w!.variants) for (const s of v.steps) expect(s.label.length).toBeGreaterThan(0);
  });

  it("the derived entry can't drift — its body fields are exactly the source object's", () => {
    for (const g of TUNING_GUIDES) {
      const e = toGuideEntry(g);
      expect(e.goal).toBe(g.goal);
      expect(e.steps).toEqual(g.steps);
      expect(e.undo).toBe(g.undo);
      expect(e.tier).toBe("safe");
      // The injected KNOWLEDGE copy is value-equal to the freshly derived one (one source).
      expect(KNOWLEDGE_BY_ID.get(g.id)).toEqual(e);
    }
    expect(TUNING_GUIDE_ENTRIES).toHaveLength(TUNING_GUIDES.length);
  });

  it("helpers resolve a guide by id and by GPU vendor", () => {
    expect(isTuningGuideId("amd-gpu-undervolt")).toBe(true);
    expect(isTuningGuideId("power-ultimate")).toBe(false);
    expect(isTuningGuideId(null)).toBe(false);
    expect(tuningGuideForVendor("amd")?.id).toBe("amd-gpu-undervolt");
    expect(tuningGuideForVendor("nvidia")).toBeNull(); // v1 is AMD-only
  });
});
