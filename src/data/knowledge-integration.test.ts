// Integration self-QA (chapter step 7): exercises search + autopsy against the REAL shipped
// datasets (no fixtures), so a content edit that breaks findability or grading fails here.

import { describe, it, expect } from "vitest";
import { searchKnowledge } from "./knowledge-search";
import { autopsyScan } from "./knowledge-autopsy";

describe("knowledge integration (real datasets)", () => {
  // Ten representative entries across all four types, including the deep-linkable glossary terms.
  const probes: [string, string][] = [
    ["xmp", "xmp-expo"],
    ["1% low", "one-percent-lows"],
    ["deep scan", "fake-deep-scan"],
    ["sync stack", "vrr-sync-stack-guide"],
    ["frame generation", "frame-gen"],
    ["testimonials", "testimonial-wall"],
    ["fan curve", "fan-curve-guide"],
    ["placebo", "placebo-effect"],
    ["driver update", "driver-updates"],
    ["clear cmos", "clear-cmos"],
  ];

  it.each(probes)("search %s finds %s", (query, id) => {
    expect(searchKnowledge(query).map((e) => e.id)).toContain(id);
  });

  it("autopsies a realistic 'ultimate FPS' guide into honest buckets", () => {
    const guide = [
      "Ultimate FPS Boost Guide 2026!!!",
      "1. Enable XMP in your BIOS for free RAM speed",
      "2. Turn on Resizable BAR",
      "3. Set your power plan to Ultimate Performance",
      "4. Disable C-States for consistency",
      "5. Force HPET with bcdedit",
      "6. Run our deep scan to find hundreds of issues",
      "7. Set timer resolution to 0.5ms",
      "8. Frobnicate the flux capacitor until it shimmers",
    ].join("\n");

    const r = autopsyScan(guide);
    const ids = r.hits.map((h) => h.id);

    // Real wins (ReBAR + power plan), real refusals (HPET / C-states), a placebo, a scam, an unknown.
    expect(ids).toContain("rebar-sam");
    expect(ids).toContain("power-plan");
    expect(ids).toContain("useplatformclock");
    expect(ids).toContain("timer-resolution");
    expect(ids).toContain("fake-deep-scan");

    expect(r.grade.real).toBeGreaterThanOrEqual(2);
    expect(r.grade.risky).toBeGreaterThanOrEqual(1);
    expect(r.grade.placebo).toBeGreaterThanOrEqual(1);
    expect(r.grade.unknown).toBeGreaterThanOrEqual(1); // the "flux capacitor" line
    expect(r.scamFlags).toBeGreaterThanOrEqual(1); // the deep scan
    expect(r.truncated).toBe(false);
  });

  it("returns the honest empty result for a guide with nothing we recognize", () => {
    const r = autopsyScan("frobnicate the doohickey\nwiggle the flux capacitor");
    expect(r.hits).toEqual([]);
    expect(r.grade).toEqual({ real: 0, placebo: 0, risky: 0, unknown: 2 });
  });
});
