import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// bug -> guard (2026-06-24, honesty). GPU temperature must NEVER be graded authoritatively on NVIDIA:
// NVML sensors are implemented-but-NOT-hardware-verified (LOCKED rule #5). The gate lives in ONE place,
// gradeGpuTempForVendor (src/data/gpu-sensor.ts), which forces "neutral" on NVIDIA. A surface that calls
// gradeGpuTempC DIRECTLY bypasses that gate — which is exactly what kept happening (SessionDebrief, then
// Overlay + LiveCharts, each caught after the fact). This guard makes the class un-repeatable: no
// production file may call gradeGpuTempC bare — GPU temp grading must route through gradeGpuTempForVendor.
//
// Coverage (hardened 2026-06-25): the original guard scanned only `.tsx` surfaces, leaving a hole — a
// `.ts` data-module helper could grade GPU temp bare and hand a pre-computed grade to a surface, slipping
// past a surfaces-only check. So this now scans every production `.ts` AND `.tsx`, allowing exactly two
// files: metric-grade.ts (which DEFINES gradeGpuTempC) and gpu-sensor.ts (the ONE sanctioned consumer —
// the vendor gate itself). Any other caller, in any layer, fails.

// The only two files permitted to reference gradeGpuTempC: its definition + the vendor gate.
const ALLOWED = new Set(["data/metric-grade.ts", "data/gpu-sensor.ts"]);

describe("GPU-temp grading is always vendor-gated (LOCKED rule #5)", () => {
  it("no production file calls gradeGpuTempC except the gate (must use gradeGpuTempForVendor)", () => {
    const files = readdirSync("src", { recursive: true })
      .map((f) => String(f).replace(/\\/g, "/")) // normalise Windows separators
      .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test."))
      .filter((f) => !ALLOWED.has(f));

    const offenders = files.filter((f) =>
      /gradeGpuTempC\s*\(/.test(readFileSync(join("src", f), "utf8")),
    );

    expect(
      offenders,
      `these files grade GPU temp without the NVIDIA honesty gate — route through ` +
        `gradeGpuTempForVendor(vendor, c): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the two allowlisted files still exist and reference gradeGpuTempC (gate not silently removed)", () => {
    // If someone deletes/renames the gate, the allowlist would mask its absence — assert it's really there
    // so this guard can't rot into a no-op.
    for (const f of ALLOWED) {
      const src = readFileSync(join("src", f), "utf8");
      expect(/gradeGpuTempC/.test(src), `${f} should reference gradeGpuTempC`).toBe(true);
    }
  });
});
