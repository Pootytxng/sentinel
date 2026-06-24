import { describe, it, expect } from "vitest";
import { gpuSensorVerified, gradeGpuTempForVendor } from "./gpu-sensor";

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
