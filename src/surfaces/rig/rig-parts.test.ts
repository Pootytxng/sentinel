import { describe, it, expect } from "vitest";
import {
  buildRigParts,
  shadowingGhostIds,
  unreachableDetectedIds,
  passThroughRemainder,
  CPU_FAN_PLACEMENT,
  MEASURED_KINDS,
} from "./rig-parts";
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

// ── Pointer reachability in the assembled pose ────────────────────────────────────────────────
// Guard for the 2026-08-07 self-review FAIL: the Lab evidence map reads whichever part the user
// clicks, and two detected parts could not be clicked at all — the CPU sat behind the cooler and
// CPU-fan ghosts, the drives sat behind the graphics card. Correct code the user cannot trigger is
// not a shipped feature, so the arrangement is now pinned by a test instead of by eyeballing it.
describe("assembled-pose reachability", () => {
  const parts = buildRigParts(hw);
  // The scene as RigHologram draws it: the parts, plus the three honest fan ghosts it adds when
  // nothing is publishing RPM (the worst case for occlusion — real fan sensors are `detected`).
  const scene = [
    ...parts,
    { id: "fan-ghost-cpu", detected: false, assembled: CPU_FAN_PLACEMENT.assembled },
    { id: "fan-ghost-front", detected: false, assembled: [-1.36, 0.85, 0.85] as const },
    { id: "fan-ghost-rear", detected: false, assembled: [1.36, 0.55, 0.85] as const },
  ].map((p) => ({ ...p, assembled: [...p.assembled] as [number, number, number] }));

  it("measures every geometry kind buildRigParts can emit", () => {
    for (const p of parts) expect(MEASURED_KINDS).toContain(p.kind);
  });

  it("lets clicks through the ghosts that stand in front of a detected part", () => {
    const shadowing = shadowingGhostIds(scene);
    // The cooler and the CPU fan share the CPU's x/y and sit nearer the camera.
    expect(shadowing).toContain("cooler");
    expect(shadowing).toContain("fan-ghost-cpu");
    // The PSU is a ghost too, but it stands alone — it must stay selectable.
    expect(shadowing).not.toContain("psu");
    // No detected part is ever made click-through.
    for (const id of shadowing) expect(parts.find((p) => p.id === id)?.detected ?? false).toBe(false);
  });

  it("leaves every detected part clickable once those ghosts pass clicks through", () => {
    expect(unreachableDetectedIds(scene, { clickThrough: shadowingGhostIds(scene) })).toEqual([]);
  });

  it("keeps the cooler itself selectable — only its socket face passes clicks through", () => {
    const through = shadowingGhostIds(scene);
    // It must keep a region of its own — releasing the whole mesh was the round-2 regression, where
    // no click anywhere on the cooler, fin stack included, selected anything.
    expect(passThroughRemainder("cooler")).not.toBeNull();
    // Probe: judge the cooler as if it HAD to be reachable. It is measured on what it keeps (the
    // fin stack towering over the socket), so a remainder buried behind something else fails too.
    const probe = scene.map((p) => (p.id === "cooler" ? { ...p, detected: true } : p));
    expect(unreachableDetectedIds(probe, { clickThrough: through })).not.toContain("cooler");
  });

  it("still finds a part that a nearer solid part swallows (the guard actually bites)", () => {
    const buried = scene.map((p) =>
      p.id === "disk-0" ? { ...p, assembled: [-0.55, -0.4, -0.6] as [number, number, number] } : p,
    );
    expect(unreachableDetectedIds(buried, { clickThrough: shadowingGhostIds(buried) })).toContain("disk-0");
  });
});
