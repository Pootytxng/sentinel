import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// bug -> guard (2026-06-24, honesty). GPU temperature must NEVER be graded authoritatively on NVIDIA:
// NVML sensors are implemented-but-NOT-hardware-verified (LOCKED rule #5). The gate lives in ONE place,
// gradeGpuTempForVendor (src/data/gpu-sensor.ts), which forces "neutral" on NVIDIA. A surface that calls
// gradeGpuTempC DIRECTLY bypasses that gate — which is exactly what kept happening (SessionDebrief, then
// Overlay + LiveCharts, each caught after the fact). This guard makes the class un-repeatable: no .tsx
// surface may call gradeGpuTempC bare — GPU temp grading must route through gradeGpuTempForVendor.
describe("GPU-temp grading is always vendor-gated (LOCKED rule #5)", () => {
  it("no production .tsx surface calls gradeGpuTempC directly (must use gradeGpuTempForVendor)", () => {
    const surfaces = readdirSync("src", { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

    const offenders = surfaces.filter((f) =>
      /gradeGpuTempC\s*\(/.test(readFileSync(join("src", f), "utf8")),
    );

    expect(
      offenders,
      `these surfaces grade GPU temp without the NVIDIA honesty gate — route through ` +
        `gradeGpuTempForVendor(vendor, c): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
