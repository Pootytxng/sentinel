import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gpuVendor } from "../surfaces/walkthroughs";
import {
  gpuSensorVerified,
  gradeGpuTempForVendor,
  primaryGpu,
  sensorForGpu,
  sessionPeakVendor,
  vendorProfileInsights,
} from "./gpu-sensor";

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

// Codebase review 2026-11-03 (LOCKED rule #5): get_gpu_sensors lists NVML adapters first, hw.gpus is
// DXGI order. Home paired the first of each, so a hybrid laptop printed the RTX's NVML temperature
// under "UHD Graphics" with a verified-sensor colour. The reading now follows the GPU's own name.
describe("sensorForGpu (the reading belongs to the GPU the surface names)", () => {
  const rtx = { vendor: "NVIDIA", name: "NVIDIA GeForce RTX 4060 Laptop GPU", temperature_c: 78 };
  const uhd = { vendor: "AMD", name: "AMD Radeon(TM) Graphics", temperature_c: null };
  const xt = { vendor: "AMD", name: "AMD Radeon RX 9070 XT", temperature_c: 61 };

  it("a hybrid laptop's iGPU never wears the dGPU's NVML reading", () => {
    expect(sensorForGpu([rtx], "Intel(R) UHD Graphics 770")).toBeNull();
    expect(sensorForGpu([rtx, uhd], "AMD Radeon(TM) Graphics")).toBe(uhd);
  });

  it("the named GPU gets its own snapshot, whatever order the SDKs listed them in", () => {
    expect(sensorForGpu([rtx, xt], "AMD Radeon RX 9070 XT")).toBe(xt);
    expect(sensorForGpu([uhd, xt], "AMD Radeon RX 9070 XT")).toBe(xt);
    expect(sensorForGpu([rtx, uhd], "NVIDIA GeForce RTX 4060 Laptop GPU")).toBe(rtx);
  });

  it("case, trademark marks and spacing are one adapter, not two", () => {
    expect(sensorForGpu([uhd], "amd radeon graphics")).toBe(uhd);
    expect(sensorForGpu([xt], "AMD Radeon™ RX 9070 XT ")).toBe(xt);
  });

  it("a name one SDK shortens still matches, but only when exactly one adapter fits", () => {
    const old = { vendor: "NVIDIA", name: "GeForce RTX 3080", temperature_c: 70 };
    expect(sensorForGpu([old], "NVIDIA GeForce RTX 3080")).toBe(old);
    const a = { vendor: "NVIDIA", name: "GeForce RTX 3080", temperature_c: 70 };
    const b = { vendor: "NVIDIA", name: "NVIDIA GeForce RTX 3080", temperature_c: 71 };
    expect(sensorForGpu([a, b], "NVIDIA GeForce RTX 3080")).toBe(b); // exact wins
    // "RTX 4060" is not "RTX 4060 Ti": a word-boundary suffix, never a loose substring.
    const ti = { vendor: "NVIDIA", name: "NVIDIA GeForce RTX 4060 Ti", temperature_c: 66 };
    expect(sensorForGpu([ti], "NVIDIA GeForce RTX 4060")).toBeNull();
  });

  it("no name: a lone snapshot stands, two are a guess and return nothing", () => {
    expect(sensorForGpu([xt], null)).toBe(xt);
    expect(sensorForGpu([xt], "")).toBe(xt);
    expect(sensorForGpu([rtx, xt], undefined)).toBeNull();
  });

  it("one GPU and one snapshot are the same adapter whatever the SDK called it; two GPUs need the name", () => {
    const unnamed = { vendor: "AMD", name: "AMD GPU", temperature_c: 58 }; // ADLX's name read failed
    expect(sensorForGpu([unnamed], "AMD Radeon RX 9070 XT", 1)).toBe(unnamed);
    expect(sensorForGpu([unnamed], "AMD Radeon RX 9070 XT", 2)).toBeNull();
    expect(sensorForGpu([unnamed], "AMD Radeon RX 9070 XT")).toBeNull();
    // A hybrid laptop with its iGPU listed first still never borrows the dGPU's lone NVML snapshot.
    expect(sensorForGpu([rtx], "Intel(R) UHD Graphics 770", 2)).toBeNull();
  });

  it("no snapshots is no reading", () => {
    expect(sensorForGpu([], "AMD Radeon RX 9070 XT")).toBeNull();
    expect(sensorForGpu(null, "AMD Radeon RX 9070 XT")).toBeNull();
  });
});

describe("primaryGpu (the adapter the backend already judges)", () => {
  it("the largest VRAM wins whatever order DXGI listed them in; a tie keeps the last, as max_by_key does", () => {
    const igpu = { name: "Intel(R) UHD Graphics", vram_bytes: 128 };
    const rtx = { name: "NVIDIA GeForce RTX 4060 Laptop GPU", vram_bytes: 8192 };
    expect(primaryGpu([igpu, rtx])).toBe(rtx);
    expect(primaryGpu([rtx, igpu])).toBe(rtx);
    const a = { name: "A", vram_bytes: 16 };
    const b = { name: "B", vram_bytes: 16 };
    expect(primaryGpu([a, b])).toBe(b);
    expect(primaryGpu([])).toBeUndefined();
    expect(primaryGpu(undefined)).toBeUndefined();
  });

  // CR-primary-gpu (2026-11-04): App's walkthrough variant and Home's Tuning station read the vendor
  // of `gpus[0]`, the first DXGI adapter — on a hybrid laptop the iGPU, which runs no game. Both read
  // the primary GPU now, and this pins the two call sites to it: a source scan, because App has no
  // render harness and the Home fact only surfaces deep inside the interview.
  it("the walkthrough and tuning vendor is the primary GPU's, never the first adapter's", () => {
    const igpu = { name: "Intel(R) UHD Graphics 770", vram_bytes: 128 * 1024 ** 2 };
    const radeon = { name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 };
    expect(gpuVendor(primaryGpu([igpu, radeon])?.name)).toBe("amd");
    expect(gpuVendor(igpu.name)).toBe("intel"); // what the old `gpus[0]` read would have said
    for (const file of ["src/App.tsx", "src/surfaces/HomeConsole.tsx"]) {
      const src = readFileSync(resolve(file), "utf8");
      expect(src, `${file} feeds gpuVendor the first adapter`).not.toMatch(/gpuVendor\(\s*hw\??\.gpus\??\.?\[0\]/);
      expect(src, `${file} reads the primary GPU's vendor`).toMatch(/gpuVendor\((primaryGpu\(hw\??\.gpus\)|gpu)\?\.name\)/);
    }
  });
});

// A session's peak is the hottest reading across every adapter, recorded without its adapter, so any
// NVIDIA adapter on the rig makes the peak possibly NVML's — never graded (LOCKED rule #5).
describe("sessionPeakVendor", () => {
  it("any NVIDIA adapter anywhere in the list makes the peak NVIDIA's to keep ungraded", () => {
    expect(sessionPeakVendor(["Intel(R) UHD Graphics 770", "NVIDIA GeForce RTX 4060 Laptop GPU"])).toBe("NVIDIA");
    expect(sessionPeakVendor(["AMD Radeon(TM) Graphics", "GeForce GTX 1650"])).toBe("NVIDIA");
    expect(gradeGpuTempForVendor(sessionPeakVendor(["AMD Radeon(TM) Graphics", "NVIDIA RTX A2000"]), 90)).toBe("neutral");
  });

  it("an all-AMD rig keeps the first adapter, so its peak still grades", () => {
    expect(sessionPeakVendor(["AMD Radeon RX 9070 XT", "AMD Radeon(TM) Graphics"])).toBe("AMD Radeon RX 9070 XT");
    expect(gradeGpuTempForVendor(sessionPeakVendor(["AMD Radeon RX 9070 XT"]), 90)).toBe("bad");
    expect(sessionPeakVendor([])).toBeNull();
    expect(sessionPeakVendor(undefined)).toBeNull();
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
