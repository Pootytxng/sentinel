// The hardware-tailored part list for the 3D Rig Hologram — DERIVED from Compy's real detected
// HardwareInfo, never fabricated. This is the honesty core: we show the user's actual CPU, RAM
// sticks, GPU(s) and physical drives with their real specs; parts Compy genuinely cannot read in
// software (CPU cooler, PSU, case fans) are emitted as honest "ghost" placeholders labelled
// "not software-detectable" — never invented with fake specs. Pure + unit-testable (no three.js).
import type { HardwareInfo } from "../../App";
import { fmtGB, fmtGHz } from "../hardware-format";

export type Vec3 = [number, number, number];
export type RigPartKind = "board" | "cpu" | "ram" | "gpu" | "storage" | "cooler" | "psu";
export interface RigSpec {
  label: string;
  value: string;
}
export interface RigPart {
  id: string;
  name: string;
  category: string;
  kind: RigPartKind;
  /** false = Compy cannot read this part in software → rendered faint + honestly labelled. */
  detected: boolean;
  assembled: Vec3;
  exploded: Vec3;
  rotation?: Vec3;
  tagline: string;
  specs: RigSpec[];
  /** Numeric capacity in bytes (memory modules only) — lets the tour sum the real total/count. */
  capacityBytes?: number;
}

// Lay N items out along a line from `start`, stepping by `step`, so a dynamic count (1–4 RAM sticks,
// 1–N drives) stays tidy without hand-placed coordinates.
function row(start: Vec3, step: Vec3, i: number): Vec3 {
  return [start[0] + step[0] * i, start[1] + step[1] * i, start[2] + step[2] * i];
}

export function buildRigParts(hw: HardwareInfo): RigPart[] {
  const parts: RigPart[] = [];

  // ── Mainboard — the structural anchor. No fabricated model (Compy doesn't read a board model);
  //    it carries the honest platform/OS identity instead. ──
  parts.push({
    id: "board",
    name: "Mainboard",
    category: "Platform",
    kind: "board",
    detected: true,
    assembled: [0.1, 0.2, -0.72],
    exploded: [-2.9, 0.35, -1.1],
    rotation: [0, 0.5, 0],
    tagline: hw.windows_version?.product_name || `${hw.os_name} ${hw.os_version}`.trim(),
    specs: [
      { label: "Platform", value: hw.windows_version?.product_name || hw.os_name || "—" },
      {
        label: "Build",
        value: hw.windows_version
          ? `${hw.windows_version.build}.${hw.windows_version.ubr}`
          : hw.kernel_version || "—",
      },
      { label: "Host", value: hw.hostname || "—" },
      { label: "Note", value: "Board model isn't software-readable" },
    ],
  });

  // ── CPU — real ──
  const arch = hw.cpu_arch;
  parts.push({
    id: "cpu",
    name: arch?.family_label || hw.cpu_brand || "Processor",
    category: "Processor",
    kind: "cpu",
    detected: true,
    assembled: [0.05, 1.15, -0.58],
    exploded: [-2.4, 2.5, 0.5],
    rotation: [0.3, 0.4, 0],
    tagline: `${hw.cpu_cores_physical}C / ${hw.cpu_cores_logical}T`,
    specs: [
      ...(arch?.architecture && arch.architecture !== "Unknown"
        ? [
            {
              label: "Architecture",
              value:
                arch.generation && arch.generation !== arch.architecture
                  ? `${arch.architecture} · ${arch.generation}`
                  : arch.architecture,
            },
          ]
        : []),
      { label: "Cores / Threads", value: `${hw.cpu_cores_physical}C / ${hw.cpu_cores_logical}T` },
      { label: "Base clock", value: fmtGHz(hw.cpu_frequency_mhz) },
    ],
  });

  // ── Memory — one part per REAL detected module; fall back to a single aggregate when the SMBIOS
  //    module table is empty (some rigs report no per-slot data). ──
  const mods = (hw.memory_modules ?? []).filter((m) => m.capacity_bytes > 0);
  if (mods.length > 0) {
    mods.forEach((m, i) => {
      const type_ = m.type_name && m.type_name !== "Unknown" ? m.type_name : "";
      const speed = m.speed_mhz > 0 ? `${m.speed_mhz} MHz` : "";
      const mfg = m.manufacturer && m.manufacturer !== "Undefined" ? m.manufacturer : "";
      parts.push({
        id: `ram-${i}`,
        name: `Memory · Slot ${i + 1}`,
        category: "Memory",
        kind: "ram",
        detected: true,
        assembled: row([0.78, 1.05, -0.58], [0.26, 0, 0], i),
        exploded: row([2.4, 2.2, 0.3], [0.34, 0.18, 0], i),
        rotation: [0, -0.5, 0.05],
        capacityBytes: m.capacity_bytes,
        tagline: `${fmtGB(m.capacity_bytes)}${type_ ? ` ${type_}` : ""}`,
        specs: [
          { label: "Capacity", value: fmtGB(m.capacity_bytes) },
          ...(type_ ? [{ label: "Type", value: type_ }] : []),
          ...(speed ? [{ label: "Speed", value: speed }] : []),
          ...(mfg ? [{ label: "Maker", value: mfg }] : []),
        ],
      });
    });
  } else {
    parts.push({
      id: "ram",
      name: "Memory",
      category: "Memory",
      kind: "ram",
      detected: true,
      assembled: [0.95, 1.05, -0.58],
      exploded: [2.6, 2.2, 0.3],
      rotation: [0, -0.5, 0.05],
      tagline: fmtGB(hw.ram_total_bytes),
      specs: [
        { label: "Total", value: fmtGB(hw.ram_total_bytes) },
        { label: "In use", value: fmtGB(hw.ram_used_bytes) },
        { label: "Note", value: "Per-slot data not reported" },
      ],
    });
  }

  // ── Graphics — one part per REAL adapter ──
  hw.gpus.forEach((g, i) => {
    parts.push({
      id: `gpu-${i}`,
      name: g.name,
      category: hw.gpus.length > 1 ? `Graphics ${i + 1}` : "Graphics",
      kind: "gpu",
      detected: true,
      assembled: row([0.1, -0.15, -0.18], [0, -0.62, 0], i),
      exploded: row([0.2, -0.5, 2.7], [0, -0.7, 0.2], i),
      rotation: [0.1, 0, 0],
      tagline: g.vram_bytes > 0 ? `${fmtGB(g.vram_bytes)} VRAM` : "GPU",
      specs: [
        ...(g.video_processor && g.video_processor !== g.name
          ? [{ label: "Processor", value: g.video_processor }]
          : []),
        { label: "VRAM", value: g.vram_bytes > 0 ? fmtGB(g.vram_bytes) : "—" },
        ...(g.driver_version ? [{ label: "Driver", value: g.driver_version }] : []),
        ...(g.current_refresh_rate_hz > 0
          ? [{ label: "Output", value: `${g.current_refresh_rate_hz} Hz` }]
          : []),
      ],
    });
  });

  // ── Storage — one part per REAL physical drive (fall back to logical volumes) ──
  const physical = hw.physical_disks ?? [];
  if (physical.length > 0) {
    physical.forEach((d, i) => {
      parts.push({
        id: `disk-${i}`,
        name: d.friendly_name || `Drive ${i + 1}`,
        category: "Storage",
        kind: "storage",
        detected: true,
        assembled: row([-0.55, -0.4, -0.6], [0, -0.22, 0], i),
        exploded: row([-3.1, -0.5, 0.9], [-0.25, -0.25, 0], i),
        rotation: [0, 0.6, 0.5],
        tagline: `${d.media_type || ""} ${fmtGB(d.size_bytes)}`.trim(),
        specs: [
          { label: "Size", value: fmtGB(d.size_bytes) },
          ...(d.bus_type ? [{ label: "Bus", value: d.bus_type }] : []),
          ...(d.media_type ? [{ label: "Media", value: d.media_type }] : []),
        ],
      });
    });
  } else {
    (hw.disks ?? []).slice(0, 4).forEach((d, i) => {
      parts.push({
        id: `vol-${i}`,
        name: `Volume ${d.mount_point}`,
        category: "Storage",
        kind: "storage",
        detected: true,
        assembled: row([-0.55, -0.4, -0.6], [0, -0.22, 0], i),
        exploded: row([-3.1, -0.5, 0.9], [-0.25, -0.25, 0], i),
        rotation: [0, 0.6, 0.5],
        tagline: `${fmtGB(d.total_bytes)} · ${d.file_system}`,
        specs: [
          { label: "Total", value: fmtGB(d.total_bytes) },
          { label: "Free", value: fmtGB(d.available_bytes) },
          { label: "FS", value: d.file_system },
        ],
      });
    });
  }

  // ── HONEST ghosts — parts Compy cannot read in software. Rendered faint, never with invented
  //    specs. This is on-brand: Compy shows only what it can measure. ──
  parts.push({
    id: "cooler",
    name: "CPU Cooler",
    category: "Cooling",
    kind: "cooler",
    detected: false,
    assembled: [0.05, 1.15, -0.16],
    exploded: [0.3, 3.3, 0.7],
    rotation: [0.4, 0, 0.2],
    tagline: "Not software-detectable",
    specs: [{ label: "Detection", value: "Coolers expose no software identity" }],
  });
  parts.push({
    id: "psu",
    name: "Power Supply",
    category: "Power",
    kind: "psu",
    detected: false,
    assembled: [0.1, -1.85, -0.25],
    exploded: [0.4, -3.1, 0.7],
    rotation: [0, -0.4, 0],
    tagline: "Not software-detectable",
    specs: [{ label: "Detection", value: "PSUs expose no software identity" }],
  });

  return parts;
}
