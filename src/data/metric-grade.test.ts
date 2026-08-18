import { describe, it, expect } from "vitest";
import {
  gradeFps,
  gradeLow1,
  gradeFrametimeMs,
  gradeGpuTempC,
  gradeCpuTempC,
  gradeRamPct,
  gradeColor,
} from "./metric-grade";

describe("metric-grade — FPS is tailored to the rig's refresh", () => {
  it("same 60 fps grades differently per display (the per-rig motto)", () => {
    expect(gradeFps(60, { refreshHz: 60 })).toBe("good"); // maxing a 60 Hz panel
    expect(gradeFps(60, { refreshHz: 144 })).toBe("ok"); // leaving a 144 Hz panel on the table
    expect(gradeFps(60, { refreshHz: 240 })).toBe("ok");
  });

  it("hitting ~your refresh is good; well under is bad", () => {
    expect(gradeFps(230, { refreshHz: 240 })).toBe("good");
    expect(gradeFps(140, { refreshHz: 144 })).toBe("good");
    expect(gradeFps(30, { refreshHz: 144 })).toBe("bad");
    expect(gradeFps(25, { refreshHz: 60 })).toBe("bad");
  });

  it("falls back to 60 Hz when refresh is unknown, and stays sane", () => {
    expect(gradeFps(58, { refreshHz: null })).toBe("good");
    expect(gradeFps(40, {})).toBe("ok");
  });

  it("non-values are neutral", () => {
    expect(gradeFps(0, { refreshHz: 60 })).toBe("neutral");
    expect(gradeFps(null, { refreshHz: 60 })).toBe("neutral");
    expect(gradeFps(undefined, { refreshHz: 60 })).toBe("neutral");
  });
});

describe("metric-grade — 1% low by consistency vs average", () => {
  it("tight lows are good, deep dips are bad", () => {
    expect(gradeLow1(180, 200)).toBe("good"); // 90%
    expect(gradeLow1(120, 200)).toBe("ok"); // 60%
    expect(gradeLow1(80, 200)).toBe("bad"); // 40%
  });
  it("needs both values", () => {
    expect(gradeLow1(120, null)).toBe("neutral");
    expect(gradeLow1(null, 200)).toBe("neutral");
  });
});

describe("metric-grade — frametime vs the rig's frame budget", () => {
  it("at/under budget is good; far over is bad", () => {
    expect(gradeFrametimeMs(4.1, { refreshHz: 240 })).toBe("good"); // budget 4.17
    expect(gradeFrametimeMs(16, { refreshHz: 60 })).toBe("good"); // budget 16.7
    expect(gradeFrametimeMs(30, { refreshHz: 60 })).toBe("ok");
    expect(gradeFrametimeMs(60, { refreshHz: 60 })).toBe("bad");
  });
});

describe("metric-grade — GPU temp + RAM ramps", () => {
  it("temp ramp", () => {
    expect(gradeGpuTempC(54)).toBe("good");
    expect(gradeGpuTempC(80)).toBe("ok");
    expect(gradeGpuTempC(88)).toBe("bad");
    expect(gradeGpuTempC(null)).toBe("neutral");
  });
  it("cpu temp ramp is looser than the GPU's, on purpose", () => {
    expect(gradeCpuTempC(62)).toBe("good");
    expect(gradeCpuTempC(84)).toBe("ok");
    expect(gradeCpuTempC(93)).toBe("bad");
    expect(gradeCpuTempC(null)).toBe("neutral");
    // The regression this pins: an 82°C X3D under sustained load is BEHAVING, and a ramp copied
    // from the GPU's would have called it "bad" and sent a healthy machine to a fix it does not
    // need. Compy has no user-mode read of this CPU's real Tjmax, so the ramp stays conservative.
    expect(gradeGpuTempC(82)).toBe("ok");
    expect(gradeCpuTempC(82)).toBe("ok");
    expect(gradeCpuTempC(88)).toBe("ok");
    expect(gradeGpuTempC(88)).toBe("bad");
  });
  it("ram pressure ramp", () => {
    expect(gradeRamPct(56)).toBe("good");
    expect(gradeRamPct(82)).toBe("ok");
    expect(gradeRamPct(94)).toBe("bad");
    expect(gradeRamPct(null)).toBe("neutral");
  });
});

describe("metric-grade — gradeColor", () => {
  it("maps grades to status tokens, neutral to empty", () => {
    expect(gradeColor("good")).toContain("--ready");
    expect(gradeColor("ok")).toContain("--attention");
    expect(gradeColor("bad")).toContain("--danger");
    expect(gradeColor("neutral")).toBe("");
  });
});
