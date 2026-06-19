import { describe, it, expect } from "vitest";
import { buildRigParts } from "./rig-parts";
import type { HardwareInfo } from "../../App";

// Minimal fixture exercising the fields buildRigParts reads (cast — the real type is much larger).
const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: {
    family_label: "Ryzen 7 9850X3D",
    architecture: "Zen 5",
    generation: "9000 series",
  },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  swap_total_bytes: 0,
  memory_modules: [
    { capacity_bytes: 16 * 1024 ** 3, speed_mhz: 6000, type_name: "DDR5", manufacturer: "G.Skill" },
    { capacity_bytes: 16 * 1024 ** 3, speed_mhz: 6000, type_name: "DDR5", manufacturer: "G.Skill" },
  ],
  gpus: [
    {
      name: "AMD Radeon RX 9070 XT",
      vram_bytes: 16 * 1024 ** 3,
      driver_version: "25.5.1",
      driver_date: "",
      driver_age_days: 20,
      video_processor: "AMD Radeon Graphics Processor",
      current_refresh_rate_hz: 165,
    },
  ],
  physical_disks: [
    { friendly_name: "Samsung SSD 990 PRO 2TB", media_type: "SSD", bus_type: "NVMe", size_bytes: 2 * 1024 ** 4 },
  ],
  disks: [],
  windows_version: { product_name: "Windows 11 Pro", build: "26200", ubr: "1" },
  os_name: "Windows",
  os_version: "11",
  kernel_version: "10.0.26200",
  hostname: "DESKTOP-X",
} as unknown as HardwareInfo;

describe("buildRigParts — real hardware, honest ghosts", () => {
  const parts = buildRigParts(hw);

  it("maps the real CPU with its name + core count", () => {
    const cpu = parts.find((p) => p.kind === "cpu");
    expect(cpu?.detected).toBe(true);
    expect(cpu?.name).toContain("Ryzen 7 9850X3D");
    expect(cpu?.specs.some((s) => s.value.includes("8C") && s.value.includes("16T"))).toBe(true);
  });

  it("makes one part per REAL detected RAM module", () => {
    expect(parts.filter((p) => p.kind === "ram").length).toBe(2);
  });

  it("makes one part per REAL GPU and physical drive", () => {
    expect(parts.filter((p) => p.kind === "gpu").length).toBe(1);
    expect(parts.filter((p) => p.kind === "storage").length).toBe(1);
    expect(parts.find((p) => p.kind === "gpu")?.name).toBe("AMD Radeon RX 9070 XT");
  });

  it("emits cooler + PSU as honest, undetected ghosts (no invented specs)", () => {
    const cooler = parts.find((p) => p.id === "cooler");
    const psu = parts.find((p) => p.id === "psu");
    expect(cooler?.detected).toBe(false);
    expect(psu?.detected).toBe(false);
    expect(cooler?.tagline.toLowerCase()).toContain("not software-detectable");
  });

  it("NEVER fabricates a GPU when none is detected", () => {
    const none = buildRigParts({ ...hw, gpus: [] } as unknown as HardwareInfo);
    expect(none.filter((p) => p.kind === "gpu").length).toBe(0);
  });

  it("falls back to a single aggregate RAM part when no modules are reported", () => {
    const noMods = buildRigParts({ ...hw, memory_modules: [] } as unknown as HardwareInfo);
    expect(noMods.filter((p) => p.kind === "ram").length).toBe(1);
  });
});
