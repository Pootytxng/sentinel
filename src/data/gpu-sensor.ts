import { gradeGpuTempC, type Grade } from "./metric-grade";

// Honesty gate — LOCKED rule #5. NVIDIA GPU sensor readings come from NVML and are NOT yet
// hardware-verified (AMD = verified; Intel = planned). So an NVIDIA GPU TEMPERATURE must never be
// presented as an authoritative green/amber/red graded value until a monitored NVIDIA session
// proves the sensor. The classic Monitoring tab already acknowledges this with a per-card
// "unverified" pill + a coverage line; the default Home (DashboardV2) and Play surfaces grade GPU
// temp too, so they must apply the SAME rule. One source of truth so it can't drift across surfaces.
//
// Returns true when this vendor's GPU sensor is trustworthy enough to grade (AMD, or unknown — GPU
// vendor detection is reliable, so an unknown vendor is the dev/AMD path), false for NVIDIA.
export function gpuSensorVerified(vendor: string | null | undefined): boolean {
  return !(vendor ?? "").toLowerCase().includes("nvidia");
}

// THE one vendor-honest GPU-temperature grade (LOCKED rule #5). NVIDIA NVML temp is implemented but
// NOT hardware-verified → never graded authoritatively (returns "neutral"); AMD/unknown grade normally.
// Every surface that shows a graded GPU temp (SessionDebrief, Play, DashboardV2) MUST route through
// this — so the gate can never drift across surfaces (the bug this consolidated: SessionDebrief once
// graded NVIDIA temp bare). Pure → unit-tested in gpu-sensor.test.ts.
export function gradeGpuTempForVendor(
  vendor: string | null | undefined,
  c: number | null | undefined,
): Grade {
  return gpuSensorVerified(vendor) ? gradeGpuTempC(c) : "neutral";
}
