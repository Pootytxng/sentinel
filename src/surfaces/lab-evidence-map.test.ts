import { describe, expect, it } from "vitest";
import type { HardwareInfo } from "../App";
import { subsystemForRigPart, subsystemReadings, type LabSubsystem } from "./lab-evidence-map";

// D: listed BEFORE C: on purpose — proves systemVolume() picks the SYSTEM drive, not "whichever
// volume came first".
const RAW = {
  cpu_cores_physical: 8,
  cpu_cores_logical: 16,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [
    {
      name: "Radeon RX 9070 XT",
      vram_bytes: 16 * 1024 ** 3,
      driver_version: "25.5.1",
    },
  ],
  disks: [
    { mount_point: "D:\\", total_bytes: 4096 * 1024 ** 3, available_bytes: 1024 * 1024 ** 3, file_system: "NTFS" },
    { mount_point: "C:\\", total_bytes: 2048 * 1024 ** 3, available_bytes: 512 * 1024 ** 3, file_system: "NTFS" },
  ],
  display: { width: 2560, height: 1440, current_refresh_rate_hz: 144, max_refresh_rate_hz: 165 },
  windows_version: "Windows 11 25H2",
};

const HW = RAW as unknown as HardwareInfo;
const withHw = (over: Record<string, unknown>) => ({ ...RAW, ...over }) as unknown as HardwareInfo;
const ALL_SUBSYSTEMS: LabSubsystem[] = [
  "cpu",
  "gpu",
  "memory",
  "storage",
  "display",
  "network",
  "audio",
  "thermals",
  "system",
];
const keys = (sub: LabSubsystem, hw: HardwareInfo = HW) => subsystemReadings(sub, hw).map((r) => r.key);

describe("guard 3 — every reading is a real field of this PC, or there is no reading", () => {
  it("the processor states its real cores/threads and clock", () => {
    expect(subsystemReadings("cpu", HW)).toEqual([
      { kind: "fact", key: "cores", value: "8 · 16" },
      { kind: "fact", key: "clock", value: "5.10 GHz" },
    ]);
  });

  it("a probe that reported no cores or no clock says nothing about them", () => {
    expect(keys("cpu", withHw({ cpu_cores_physical: 0 }))).toEqual(["clock"]);
    expect(keys("cpu", withHw({ cpu_cores_logical: 0 }))).toEqual(["clock"]);
    expect(keys("cpu", withHw({ cpu_frequency_mhz: 0 }))).toEqual(["cores"]);
    expect(subsystemReadings("cpu", withHw({ cpu_cores_physical: 0, cpu_frequency_mhz: 0 }))).toEqual([]);
  });

  it("the graphics card states its real VRAM and driver", () => {
    expect(subsystemReadings("gpu", HW)).toEqual([
      { kind: "fact", key: "vram", value: "16.0 GB" },
      { kind: "fact", key: "driver", value: "25.5.1" },
    ]);
  });

  it("no GPU detected → no GPU readings (never a placeholder card)", () => {
    expect(subsystemReadings("gpu", withHw({ gpus: [] }))).toEqual([]);
  });

  it("a blank driver string or zero VRAM drops that line only", () => {
    const noDriver = withHw({ gpus: [{ ...RAW.gpus[0], driver_version: "   " }] });
    expect(keys("gpu", noDriver)).toEqual(["vram"]);
    const noVram = withHw({ gpus: [{ ...RAW.gpus[0], vram_bytes: 0 }] });
    expect(keys("gpu", noVram)).toEqual(["driver"]);
  });

  it("memory is in-use of installed, as a real ratio", () => {
    expect(subsystemReadings("memory", HW)).toEqual([
      { kind: "gauge", key: "memory", value: "16.0 GB", den: "32.0 GB", pct: 0.5 },
    ]);
  });

  it("no installed total → no memory gauge (a bar over zero is a lie)", () => {
    expect(subsystemReadings("memory", withHw({ ram_total_bytes: 0 }))).toEqual([]);
  });

  it("storage reads the SYSTEM drive's free space, not whichever volume came first", () => {
    expect(subsystemReadings("storage", HW)).toEqual([
      { kind: "gauge", key: "storage", value: "512.0 GB", den: "2048.0 GB", pct: 0.25 },
    ]);
  });

  it("no C: volume → the first reported one, and no volumes at all → nothing", () => {
    const dOnly = withHw({ disks: [RAW.disks[0]] });
    expect(subsystemReadings("storage", dOnly)).toEqual([
      { kind: "gauge", key: "storage", value: "1024.0 GB", den: "4096.0 GB", pct: 0.25 },
    ]);
    expect(subsystemReadings("storage", withHw({ disks: [] }))).toEqual([]);
    expect(subsystemReadings("storage", withHw({ disks: [{ ...RAW.disks[1], total_bytes: 0 }] }))).toEqual([]);
  });

  it("the display states current against max refresh", () => {
    expect(subsystemReadings("display", HW)).toEqual([
      { kind: "gauge", key: "refresh", value: "144 Hz", den: "165 Hz", pct: 144 / 165 },
    ]);
  });

  it("no display, or a refresh rate Windows didn't report, states nothing", () => {
    expect(subsystemReadings("display", withHw({ display: null }))).toEqual([]);
    expect(subsystemReadings("display", withHw({ display: { ...RAW.display, max_refresh_rate_hz: 0 } }))).toEqual([]);
    expect(
      subsystemReadings("display", withHw({ display: { ...RAW.display, current_refresh_rate_hz: 0 } })),
    ).toEqual([]);
  });

  it("cooling, network, sound and system-wide are empty ON PURPOSE, not by omission", () => {
    for (const sub of ["thermals", "network", "audio", "system"] as LabSubsystem[]) {
      expect(subsystemReadings(sub, HW)).toEqual([]);
    }
  });

  it("no reading anywhere is a dash, a placeholder or an unformatted zero", () => {
    const values = ALL_SUBSYSTEMS.flatMap((s) => subsystemReadings(s, HW)).flatMap((r) =>
      r.kind === "gauge" ? [r.value, r.den] : [r.value],
    );
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v.trim()).not.toBe("");
      expect(v).not.toContain("—");
      expect(v).not.toMatch(/^(0|0\.0|N\/A|--|\?+)( |$)/);
    }
  });

  it("every proportion is a real clamped ratio, never a number that overflows its bar", () => {
    const over = withHw({ ram_used_bytes: 64 * 1024 ** 3 });
    const [g] = subsystemReadings("memory", over);
    expect(g.kind).toBe("gauge");
    expect(g.kind === "gauge" && g.pct).toBe(1);
    for (const sub of ALL_SUBSYSTEMS) {
      for (const r of subsystemReadings(sub, HW)) {
        if (r.kind !== "gauge") continue;
        expect(r.pct).toBeGreaterThanOrEqual(0);
        expect(r.pct).toBeLessThanOrEqual(1);
      }
    }
  });

  it("no subsystem invents a grade, verdict or threshold word", () => {
    const shapes = ALL_SUBSYSTEMS.flatMap((s) => subsystemReadings(s, HW)).map((r) =>
      Object.keys(r).sort().join(","),
    );
    for (const shape of shapes) {
      expect(["key,kind,value", "den,key,kind,pct,value"]).toContain(shape);
    }
  });
});

describe("rig part → subsystem mapping", () => {
  it("maps every modelled rig part to a real subsystem", () => {
    expect(subsystemForRigPart("cpu")).toBe("cpu");
    expect(subsystemForRigPart("gpu")).toBe("gpu");
    expect(subsystemForRigPart("ram")).toBe("memory");
    expect(subsystemForRigPart("storage")).toBe("storage");
    expect(subsystemForRigPart("cooler")).toBe("thermals");
  });

  it("board and psu carry no single subsystem's evidence — they read system-wide, never guessed", () => {
    expect(subsystemForRigPart("board")).toBe("system");
    expect(subsystemForRigPart("psu")).toBe("system");
  });
});
