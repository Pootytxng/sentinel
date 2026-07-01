import { describe, it, expect } from "vitest";
import { gpuSensorVerified, gradeGpuTempForVendor, vendorProfileInsights } from "./gpu-sensor";

// Guard for the LOCKED rule #5 honesty gate the consistency audit caught: the default Home + Play
// grade GPU temperature, but NVIDIA NVML readings aren't hardware-verified — so they must NOT be
// shown as authoritative graded values. This pins the vendor rule so a surface can't silently grade
// an NVIDIA sensor again.
describe("gpuSensorVerified (LOCKED rule #5 — NVIDIA sensor not yet hardware-verified)", () => {
  it("NVIDIA is NOT verified — its GPU temp must not be graded as authoritative", () => {
    expect(gpuSensorVerified("NVIDIA")).toBe(false);
    expect(gpuSensorVerified("nvidia")).toBe(false);
    expect(gpuSensorVerified("NVIDIA GeForce RTX 3060 Ti")).toBe(false);
  });

  it("AMD is verified; unknown/null defaults to graded (vendor detection is reliable)", () => {
    expect(gpuSensorVerified("AMD")).toBe(true);
    expect(gpuSensorVerified("amd")).toBe(true);
    expect(gpuSensorVerified("Radeon RX 9070 XT")).toBe(true);
    expect(gpuSensorVerified(null)).toBe(true);
    expect(gpuSensorVerified(undefined)).toBe(true);
    expect(gpuSensorVerified("any")).toBe(true);
  });
});

// The shared temp-grade helper EVERY surface (SessionDebrief, Play, DashboardV2) routes through, so
// the rule #5 gate can't drift. A hot 90°C reading: graded "bad" on AMD/unknown, forced "neutral" on
// NVIDIA (NVML unverified) — never an authoritative red the user can't trust.
describe("gradeGpuTempForVendor (one source — the gate can't drift across surfaces)", () => {
  it("NVIDIA temp is NEVER graded — neutral even when the reading is alarmingly hot", () => {
    expect(gradeGpuTempForVendor("NVIDIA GeForce RTX 4090", 90)).toBe("neutral");
    expect(gradeGpuTempForVendor("nvidia", 60)).toBe("neutral");
  });

  it("AMD / unknown grade normally (good when cool, bad when hot)", () => {
    expect(gradeGpuTempForVendor("AMD Radeon RX 9070 XT", 60)).toBe("good");
    expect(gradeGpuTempForVendor("AMD", 90)).toBe("bad");
    expect(gradeGpuTempForVendor(undefined, 60)).toBe("good"); // dev/AMD path
    expect(gradeGpuTempForVendor(null, 60)).toBe("good");
  });

  it("a missing reading is neutral for any vendor — never a fabricated grade", () => {
    expect(gradeGpuTempForVendor("AMD", null)).toBe("neutral");
    expect(gradeGpuTempForVendor("NVIDIA", null)).toBe("neutral");
    expect(gradeGpuTempForVendor(undefined, undefined)).toBe("neutral");
  });
});

// A4 (content) — vendor-aware, READ-ONLY advisory badges for AMD. Pure function that derives
// plain-English insight lines from ALREADY-READ profile fields. It changes NOTHING, makes no FPS/perf
// promise, and is vendor-honest: AMD (our hardware-verified vendor) gets tailored Adrenalin-named
// advisories; NVIDIA/Intel/unknown get NO fabricated AMD advice (honesty law + LOCKED rule #5).
describe("vendorProfileInsights (A4 — AMD vendor-aware advisory badges, read-only)", () => {
  it("returns AMD-specific advisories for an AMD GPU, each with a tone + no perf/FPS promise", () => {
    const insights = vendorProfileInsights({
      vendor: "AMD",
      hagsEnabled: true,
      powerModeLabel: "Balanced",
      peakTempC: 70,
    });
    expect(insights.length).toBeGreaterThan(0);
    // Named to the AMD vendor tool so the advice is actionable on THIS rig.
    expect(insights.some((i) => /adrenalin/i.test(i.detail))).toBe(true);
    for (const i of insights) {
      expect(["info", "good", "caution"]).toContain(i.tone);
      expect(i.title.length).toBeGreaterThan(0);
      // Honesty: no fabricated performance/FPS promises anywhere in the advisory copy.
      expect(`${i.title} ${i.detail}`).not.toMatch(/\bfps\b|faster|boost your|guaranteed|will improve/i);
    }
  });

  it("detects a Radeon model string as AMD even without an explicit vendor field", () => {
    const insights = vendorProfileInsights({ vendor: null, model: "Radeon RX 9070 XT", hagsEnabled: false });
    expect(insights.length).toBeGreaterThan(0);
  });

  it("gives NO AMD advisories for NVIDIA (vendor-honest — never mis-advises another vendor)", () => {
    expect(vendorProfileInsights({ vendor: "NVIDIA", hagsEnabled: true })).toEqual([]);
    expect(vendorProfileInsights({ vendor: "NVIDIA GeForce RTX 4090", peakTempC: 80 })).toEqual([]);
  });

  it("gives NO advisories for Intel or an unknown/undetected vendor (AMD-only for now)", () => {
    expect(vendorProfileInsights({ vendor: "Intel Arc A770" })).toEqual([]);
    expect(vendorProfileInsights({ vendor: null, model: null })).toEqual([]);
    expect(vendorProfileInsights({})).toEqual([]);
  });

  it("flags HAGS OFF as an info advisory, and HAGS ON as reassurance — never counts unread state", () => {
    const off = vendorProfileInsights({ vendor: "AMD", hagsEnabled: false });
    expect(off.some((i) => /scheduling/i.test(i.title) && i.tone === "info")).toBe(true);

    const on = vendorProfileInsights({ vendor: "AMD", hagsEnabled: true });
    expect(on.some((i) => /scheduling/i.test(i.title) && i.tone === "good")).toBe(true);

    // hagsEnabled unread (null) → no HAGS advisory fabricated.
    const unread = vendorProfileInsights({ vendor: "AMD", hagsEnabled: null });
    expect(unread.some((i) => /scheduling/i.test(i.title))).toBe(false);
  });

  it("flags a hot peak temp as a caution, a cool one as good, and an unread temp as nothing", () => {
    const hot = vendorProfileInsights({ vendor: "AMD", peakTempC: 90 });
    expect(hot.some((i) => /temp|thermal/i.test(i.title) && i.tone === "caution")).toBe(true);

    const cool = vendorProfileInsights({ vendor: "AMD", peakTempC: 60 });
    expect(cool.some((i) => /temp|thermal/i.test(i.title) && i.tone === "good")).toBe(true);

    const unread = vendorProfileInsights({ vendor: "AMD", peakTempC: null });
    expect(unread.some((i) => /temp|thermal/i.test(i.title))).toBe(false);
  });

  it("is a pure read-only derive — same input yields the same output, no side effects", () => {
    const input = { vendor: "AMD", hagsEnabled: true, powerModeLabel: "Balanced", peakTempC: 70 } as const;
    expect(vendorProfileInsights({ ...input })).toEqual(vendorProfileInsights({ ...input }));
  });
});
