import { describe, it, expect } from "vitest";
import { gpuSensorVerified } from "./gpu-sensor";

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
