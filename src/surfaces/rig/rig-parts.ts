// The hardware-tailored part list for the 3D Rig Hologram — DERIVED from Compy's real detected
// HardwareInfo, never fabricated. This is the honesty core: we show the user's actual CPU, RAM
// sticks, GPU(s) and physical drives with their real specs; parts Compy genuinely cannot read in
// software (CPU cooler, PSU, case fans) are emitted as honest "ghost" placeholders labelled
// "not software-detectable" — never invented with fake specs. Pure + unit-testable (no three.js).
import type { TFunction } from "i18next";
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

// Drive bay. Drives used to sit at [-0.55, -0.4, -0.6] — directly BEHIND and BELOW the graphics
// card, whose slab spans x -1.1..1.3 / y -0.53..0.48 / z -0.66..0.29 once the group offset is
// applied. From the fixed camera the card covered the drives completely, so a real, detected part
// was never hoverable or clickable in the assembled pose (caught in self-review of the Lab evidence
// map, 2026-08-07). They now live in the clear gap between the card and the PSU shroud, which is
// also where drive cages actually are. `unreachableDetectedIds` below is the guard that keeps them
// reachable.
const STORAGE_BAY: Vec3 = [-0.55, -0.82, 0.1];
const STORAGE_STEP: Vec3 = [0, -0.2, 0];

// Static-copy translator for this module's `gaming.rigViewer.parts.*` keys. `t` omitted (or the
// `!t` branch, used by every existing caller/test) returns byte-identical English — including
// simple `{{var}}` interpolation, so templated fallbacks (e.g. "Memory · Slot {{n}}") still render
// exactly like the old template literals did. Real hardware-measured values never flow through here.
function tp(
  t: TFunction | undefined,
  key: string,
  defaultValue: string,
  vars?: Record<string, unknown>,
): string {
  if (t) return t(`gaming.rigViewer.parts.${key}`, { defaultValue, ...vars });
  if (!vars) return defaultValue;
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function buildRigParts(hw: HardwareInfo, t?: TFunction): RigPart[] {
  const parts: RigPart[] = [];

  // ── Mainboard — the structural anchor. No fabricated model (Compy doesn't read a board model);
  //    it carries the honest platform/OS identity instead. ──
  parts.push({
    id: "board",
    name: tp(t, "boardName", "Mainboard"),
    category: tp(t, "boardCategory", "Platform"),
    kind: "board",
    detected: true,
    assembled: [0.1, 0.2, -0.72],
    exploded: [-2.9, 0.35, -1.1],
    rotation: [0, 0.5, 0],
    tagline: hw.windows_version?.product_name || `${hw.os_name} ${hw.os_version}`.trim(),
    specs: [
      { label: tp(t, "platformLabel", "Platform"), value: hw.windows_version?.product_name || hw.os_name || "—" },
      {
        label: tp(t, "buildLabel", "Build"),
        value: hw.windows_version
          ? `${hw.windows_version.build}.${hw.windows_version.ubr}`
          : hw.kernel_version || "—",
      },
      { label: tp(t, "hostLabel", "Host"), value: hw.hostname || "—" },
      { label: tp(t, "noteLabel", "Note"), value: tp(t, "boardNoteValue", "Board model isn't software-readable") },
    ],
  });

  // ── CPU — real ──
  const arch = hw.cpu_arch;
  parts.push({
    id: "cpu",
    name: arch?.family_label || hw.cpu_brand || tp(t, "cpuNameFallback", "Processor"),
    category: tp(t, "cpuCategory", "Processor"),
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
              label: tp(t, "architectureLabel", "Architecture"),
              value:
                arch.generation && arch.generation !== arch.architecture
                  ? `${arch.architecture} · ${arch.generation}`
                  : arch.architecture,
            },
          ]
        : []),
      {
        label: tp(t, "coresThreadsLabel", "Cores / Threads"),
        value: `${hw.cpu_cores_physical}C / ${hw.cpu_cores_logical}T`,
      },
      { label: tp(t, "baseClockLabel", "Base clock"), value: fmtGHz(hw.cpu_frequency_mhz) },
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
        name: tp(t, "memorySlotName", "Memory · Slot {{n}}", { n: i + 1 }),
        category: tp(t, "memoryCategory", "Memory"),
        kind: "ram",
        detected: true,
        assembled: row([0.78, 1.05, -0.58], [0.26, 0, 0], i),
        exploded: row([2.4, 2.2, 0.3], [0.34, 0.18, 0], i),
        rotation: [0, -0.5, 0.05],
        capacityBytes: m.capacity_bytes,
        tagline: `${fmtGB(m.capacity_bytes)}${type_ ? ` ${type_}` : ""}`,
        specs: [
          { label: tp(t, "capacityLabel", "Capacity"), value: fmtGB(m.capacity_bytes) },
          ...(type_ ? [{ label: tp(t, "typeLabel", "Type"), value: type_ }] : []),
          ...(speed ? [{ label: tp(t, "speedLabel", "Speed"), value: speed }] : []),
          ...(mfg ? [{ label: tp(t, "makerLabel", "Maker"), value: mfg }] : []),
        ],
      });
    });
  } else {
    parts.push({
      id: "ram",
      name: tp(t, "memoryNameFallback", "Memory"),
      category: tp(t, "memoryCategory", "Memory"),
      kind: "ram",
      detected: true,
      assembled: [0.95, 1.05, -0.58],
      exploded: [2.6, 2.2, 0.3],
      rotation: [0, -0.5, 0.05],
      tagline: fmtGB(hw.ram_total_bytes),
      specs: [
        { label: tp(t, "totalLabel", "Total"), value: fmtGB(hw.ram_total_bytes) },
        { label: tp(t, "inUseLabel", "In use"), value: fmtGB(hw.ram_used_bytes) },
        { label: tp(t, "noteLabel", "Note"), value: tp(t, "perSlotNoteValue", "Per-slot data not reported") },
      ],
    });
  }

  // ── Graphics — one part per REAL adapter ──
  hw.gpus.forEach((g, i) => {
    parts.push({
      id: `gpu-${i}`,
      name: g.name,
      category:
        hw.gpus.length > 1
          ? tp(t, "graphicsCategoryNumbered", "Graphics {{n}}", { n: i + 1 })
          : tp(t, "graphicsCategory", "Graphics"),
      kind: "gpu",
      detected: true,
      assembled: row([0.1, -0.15, -0.18], [0, -0.62, 0], i),
      exploded: row([0.2, -0.5, 2.7], [0, -0.7, 0.2], i),
      rotation: [0.1, 0, 0],
      tagline: g.vram_bytes > 0 ? `${fmtGB(g.vram_bytes)} VRAM` : tp(t, "gpuTaglineFallback", "GPU"),
      specs: [
        ...(g.video_processor && g.video_processor !== g.name
          ? [{ label: tp(t, "processorLabel", "Processor"), value: g.video_processor }]
          : []),
        { label: tp(t, "vramLabel", "VRAM"), value: g.vram_bytes > 0 ? fmtGB(g.vram_bytes) : "—" },
        ...(g.driver_version ? [{ label: tp(t, "driverLabel", "Driver"), value: g.driver_version }] : []),
        ...(g.current_refresh_rate_hz > 0
          ? [{ label: tp(t, "outputLabel", "Output"), value: `${g.current_refresh_rate_hz} Hz` }]
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
        name: d.friendly_name || tp(t, "driveNameFallback", "Drive {{n}}", { n: i + 1 }),
        category: tp(t, "storageCategory", "Storage"),
        kind: "storage",
        detected: true,
        assembled: row(STORAGE_BAY, STORAGE_STEP, i),
        exploded: row([-3.1, -0.5, 0.9], [-0.25, -0.25, 0], i),
        rotation: [0, 0.6, 0.5],
        tagline: `${d.media_type || ""} ${fmtGB(d.size_bytes)}`.trim(),
        specs: [
          { label: tp(t, "sizeLabel", "Size"), value: fmtGB(d.size_bytes) },
          ...(d.bus_type ? [{ label: tp(t, "busLabel", "Bus"), value: d.bus_type }] : []),
          ...(d.media_type ? [{ label: tp(t, "mediaLabel", "Media"), value: d.media_type }] : []),
        ],
      });
    });
  } else {
    (hw.disks ?? []).slice(0, 4).forEach((d, i) => {
      parts.push({
        id: `vol-${i}`,
        name: tp(t, "volumeName", "Volume {{mount}}", { mount: d.mount_point }),
        category: tp(t, "storageCategory", "Storage"),
        kind: "storage",
        detected: true,
        assembled: row(STORAGE_BAY, STORAGE_STEP, i),
        exploded: row([-3.1, -0.5, 0.9], [-0.25, -0.25, 0], i),
        rotation: [0, 0.6, 0.5],
        tagline: `${fmtGB(d.total_bytes)} · ${d.file_system}`,
        specs: [
          { label: tp(t, "totalLabel", "Total"), value: fmtGB(d.total_bytes) },
          { label: tp(t, "freeLabel", "Free"), value: fmtGB(d.available_bytes) },
          { label: tp(t, "fsLabel", "FS"), value: d.file_system },
        ],
      });
    });
  }

  // ── HONEST ghosts — parts Compy cannot read in software. Rendered faint, never with invented
  //    specs. This is on-brand: Compy shows only what it can measure. ──
  parts.push({
    id: "cooler",
    name: tp(t, "coolerName", "CPU Cooler"),
    category: tp(t, "coolerCategory", "Cooling"),
    kind: "cooler",
    detected: false,
    assembled: [0.05, 1.15, -0.16],
    exploded: [0.3, 3.3, 0.7],
    rotation: [0.4, 0, 0.2],
    tagline: tp(t, "notSoftwareDetectableTagline", "Not software-detectable"),
    specs: [
      {
        label: tp(t, "detectionLabel", "Detection"),
        value: tp(t, "coolerNoteValue", "Coolers expose no software identity"),
      },
    ],
  });
  parts.push({
    id: "psu",
    name: tp(t, "psuName", "Power Supply"),
    category: tp(t, "psuCategory", "Power"),
    kind: "psu",
    detected: false,
    assembled: [0.1, -1.85, -0.25],
    exploded: [0.4, -3.1, 0.7],
    rotation: [0, -0.4, 0],
    tagline: tp(t, "notSoftwareDetectableTagline", "Not software-detectable"),
    specs: [
      {
        label: tp(t, "detectionLabel", "Detection"),
        value: tp(t, "psuNoteValue", "PSUs expose no software identity"),
      },
    ],
  });

  return parts;
}

/** How close two parts' assembled x/y must be to count as "the same spot on screen". Generous on
 *  purpose: these meshes have real width, so sharing an axis within a part-width is enough to
 *  swallow a click aimed at the one behind. */
const SHADOW_RADIUS = 0.35;

/**
 * Parts that sit directly in FRONT of another part and must hand their clicks to it.
 *
 * Found by the Rig Evidence Map self-review (2026-08-07): the CPU is unselectable in the assembled
 * pose. `cooler` sits at [0.05, 1.15, -0.16] and the CPU at [0.05, 1.15, -0.58] — identical x/y,
 * cooler 0.42 nearer the camera — and every mesh calls `stopPropagation()` in its pointer handlers,
 * so the nearest one wins and the CPU never receives the click. The user can only reach it by
 * manually drag-rotating, and the Ops Console renders `chromeless`, which hides the very orbit and
 * explode controls that would hint at that.
 *
 * The rule is narrow on purpose. A part hands its clicks on only if it is BOTH:
 *   - unable to keep the click usefully — a GHOST (`detected: false`, a placeholder for something
 *     Compy cannot read, whose evidence panel is the empty sentence no matter what), or a FAN,
 *     whose frame is one flat square exactly the size of the thing behind it.
 *   - nearer the camera than a DETECTED part on the same x/y axis — i.e. actually in the way.
 *
 * A ghost standing on its own (the PSU, off on its own axis) stays fully selectable, and no detected
 * NON-FAN part is ever made unclickable. This is deliberately NOT "ghosts are not clickable".
 *
 * FANS ARE INCLUDED EVEN WHEN DETECTED, and that is the whole of the second fix here. The original
 * rule keyed on `detected` alone, so the CPU became reachable only while NOTHING was publishing fan
 * sensors: start HWiNFO and `fan-0` (label matching /cpu/i) is placed on the socket at z 0.08 —
 * detected, therefore never released, and 0.66 nearer the camera than the CPU it covers. The evidence
 * map worked exactly until the user ran the monitor Compy tells them to run. A case fan sits off the
 * CPU axis, shadows nothing, and stays selectable with its own rpm reading; only a fan sitting ON
 * another part gives its clicks up, and there the part behind is what the user was aiming at.
 *
 * A fan is identified the same way `unreachableDetectedIds` identifies one: no `kind` field. Fans
 * are not RigParts, they ride this shape so both rules judge one scene.
 *
 * USER-ADDED PARTS ARE INCLUDED TOO, and that is the third fix (self-review round 2, 2026-08-11).
 * A part the user typed in is drawn as a RigPart with `detected: true` — it has to be, or the model
 * would present the user's own PSU as something Compy failed to find — so neither of the two clauses
 * above could ever release it. Add a cooler by hand and it lands on the socket slot at z -0.16, the
 * same place the ghost cooler stands, 0.42 nearer the camera than the CPU: the CPU stopped being
 * clickable the moment the user helped. `userAdded` is what separates "the user told us this is
 * here" from "we read this off the machine"; the host that builds the manual list sets it, because
 * only that host knows. Like the ghost cooler, it keeps its fin stack (`PASS_THROUGH_REMAINDER`), so
 * releasing the socket face costs the user nothing — their part stays selectable in its own right.
 *
 * Consumed by RigHologram in evidence-map mode only, so the Gaming rig viewer's behaviour is
 * unchanged — there the explode control reaches anything a click cannot. Pure and data-only so
 * `rig-parts.test.ts` can prove it without a WebGL context.
 */
export function clickThroughIds(parts: readonly Placed[]): string[] {
  const detected = parts.filter((p) => p.detected);
  const releasable = (p: Placed) => !p.detected || !("kind" in p) || p.userAdded === true;
  return parts
    .filter(
      (front) =>
        releasable(front) &&
        detected.some(
          (real) =>
            real.id !== front.id &&
            Math.abs(real.assembled[0] - front.assembled[0]) <= SHADOW_RADIUS &&
            Math.abs(real.assembled[1] - front.assembled[1]) <= SHADOW_RADIUS &&
            // +z is toward the camera in this scene, so a larger z is in front.
            front.assembled[2] > real.assembled[2],
        ),
    )
    .map((p) => p.id);
}

/**
 * What the user actually clicked, for a host surface that mirrors the hologram's selection.
 *
 * The hologram draws THREE kinds of thing and every one of them is clickable: parts from
 * `buildRigParts`, the user's own manually-added parts, and fans. A host that resolves the emitted
 * id through `buildRigParts` alone therefore has a hole exactly where the other two live — which is
 * what the Lab's evidence panel did: clicking a case fan or a part you added yourself highlighted it
 * in the model and then showed NOTHING, with no sentence saying why. A dead-end click reads as a
 * broken app, and it is the one outcome an evidence surface must never produce.
 *
 * Carried alongside the id rather than replacing it: ids stay exact (`ram-2`, `gpu-1`, `vol-1`), so
 * nothing here can collapse a reading onto the wrong drive or the wrong card.
 */
export type RigSelection =
  | { source: "part"; id: string; name: string; detected: boolean }
  | { source: "manual"; id: string; name: string }
  | { source: "fan"; id: string; name: string; rpm: number | null; detected: boolean };

/** The three lists the hologram draws, in the shapes this module needs. Structural on purpose so
    this file keeps knowing nothing about three.js or FanInfo. */
export interface RigScene {
  parts: readonly { id: string; name: string; detected: boolean }[];
  manual: readonly { id: string; name: string }[];
  fans: readonly { id: string; label: string; rpm: number | null; detected: boolean }[];
}

/** Everything the scene drew that a user may select, in the order a keyboard should walk it.
    ONE list feeds BOTH paths — the pointer (`describeRigSelection`) and the DOM part picker — so a
    part the mouse can reach can never go missing from the keyboard list as the scene grows. */
export function rigInventory(scene: RigScene): RigSelection[] {
  return [
    ...scene.parts.map((p) => ({ source: "part" as const, id: p.id, name: p.name, detected: p.detected })),
    ...scene.manual.map((m) => ({ source: "manual" as const, id: m.id, name: m.name })),
    ...scene.fans.map((f) => ({
      source: "fan" as const,
      id: f.id,
      name: f.label,
      rpm: f.rpm,
      detected: f.detected,
    })),
  ];
}

/** What the picker says about an item next to its name — the "value" half of name/role/value, and
    the honest-unavailable states in list form. A fan that IS reporting carries its rpm instead. */
export type RigSelectionStatus = "detected" | "unavailable" | "userAdded" | "unread";

export function rigSelectionStatus(item: RigSelection): RigSelectionStatus {
  if (item.source === "manual") return "userAdded";
  // A fan whose sensor exists but published no number is NOT the same as no sensor at all, and the
  // list must not flatten the two — "no reading" and "no sensor" send the user to different fixes.
  if (item.source === "fan" && item.detected && item.rpm === null) return "unread";
  return item.detected ? "detected" : "unavailable";
}

/** Resolve a clicked id against everything the scene actually drew. `null` for an empty id (the
    click-away that clears the selection) or an id from none of the three lists. */
export function describeRigSelection(id: string, scene: RigScene): RigSelection | null {
  if (!id) return null;
  return rigInventory(scene).find((item) => item.id === id) ?? null;
}

/** The minimum a part needs — anything at all, so `id` and a place in the scene. Lets the fan
    ghosts (which are not RigParts) ride the same tested rules as the parts. */
export interface Placed {
  id: string;
  detected: boolean;
  assembled: Vec3;
  /** Set by the host for a part the USER typed in. Such a part is `detected: true` (it is really
      there — the user said so), which is exactly why the shadowing rule cannot infer it. */
  userAdded?: boolean;
}

/** Local-space bounds of each geometry kind, as the union of the boxes/cylinders
    `RigPartGeometry.tsx` actually draws for it. Keep in step with that file — `rig-parts.test.ts`
    fails if a kind is missing here, so a NEW kind cannot silently skip the reachability guard. */
const KIND_BOUNDS: Record<RigPartKind, { min: Vec3; max: Vec3 }> = {
  board: { min: [-1.3, -1.6, -0.03], max: [1.3, 1.6, 0.23] },
  cpu: { min: [-0.28, -0.34, -0.03], max: [0.28, 0.28, 0.08] },
  ram: { min: [-0.07, -0.5, -0.23], max: [0.07, 0.62, 0.23] },
  gpu: { min: [-1.2, -0.45, -0.48], max: [1.2, 0.28, 0.48] },
  storage: { min: [-0.55, -0.03, -0.21], max: [0.55, 0.11, 0.21] },
  cooler: { min: [-0.95, -0.31, -0.17], max: [0.95, 1.28, 0.17] },
  psu: { min: [-1.2, -0.44, -0.66], max: [1.2, 0.48, 0.68] },
};

/** What is still solid to the pointer once a part passes clicks through. `RigPartGeometry` only
    releases the geometry that actually covers the part behind, so a cooler keeps its fin stack —
    which is how it stays selectable in its own right. A kind absent here releases everything. */
const PASS_THROUGH_REMAINDER: Partial<Record<RigPartKind, { min: Vec3; max: Vec3 }>> = {
  cooler: { min: [-0.95, 0.725, -0.17], max: [0.95, 1.275, 0.17] },
};

/** What a pass-through part of this kind keeps, or null if it releases its whole mesh. Releasing
    everything is only right where the part has no clickable area worth keeping — a fan ghost is one
    flat square sitting on the CPU. A cooler is not, which is why it has an entry. */
export function passThroughRemainder(kind: RigPartKind): { min: Vec3; max: Vec3 } | null {
  return PASS_THROUGH_REMAINDER[kind] ?? null;
}

/** Square fan frame from `RigFan.tsx` (0.92 × 0.92 × 0.16), for fans fed in as `Placed`. */
const FAN_BOUNDS = { min: [-0.46, -0.46, -0.08] as Vec3, max: [0.46, 0.46, 0.08] as Vec3 };

/** Where the CPU fan sits. Lives here, not in `RigHologram`, so the reachability guard measures the
    same coordinates the scene draws instead of a copy that can drift away from them. */
export const CPU_FAN_PLACEMENT = { assembled: [0.05, 1.15, 0.08] as Vec3, exploded: [0.3, 3.3, 0.7] as Vec3 };

// The bay's camera never moves on its own: `RigHologram` mounts it at [0.6, 1.5, cameraDist]
// looking at the origin. Everything below projects along that fixed view direction — a parallel
// approximation, which at ~9.5 units from a ~5-unit model is close enough to catch a part being
// swallowed whole (the failure this guards), and is pure arithmetic, so it runs without WebGL.
const VIEW: Vec3 = (() => {
  const [x, y, z] = [0.6, 1.5, 9.5];
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
})();
const RIGHT: Vec3 = (() => {
  // up × view, normalised — the screen-x axis.
  const [vx, , vz] = VIEW;
  const len = Math.hypot(vz, vx) || 1;
  return [vz / len, 0, -vx / len];
})();
const UP: Vec3 = [
  VIEW[1] * RIGHT[2] - VIEW[2] * RIGHT[1],
  VIEW[2] * RIGHT[0] - VIEW[0] * RIGHT[2],
  VIEW[0] * RIGHT[1] - VIEW[1] * RIGHT[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  depth: number;
}

function screenRect(at: Vec3, bounds: { min: Vec3; max: Vec3 }): Rect {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const cx of [bounds.min[0], bounds.max[0]]) {
    for (const cy of [bounds.min[1], bounds.max[1]]) {
      for (const cz of [bounds.min[2], bounds.max[2]]) {
        const p: Vec3 = [at[0] + cx, at[1] + cy, at[2] + cz];
        const sx = dot(p, RIGHT);
        const sy = dot(p, UP);
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
    }
  }
  return { x0, x1, y0, y1, depth: dot(at, VIEW) };
}

/**
 * Detected parts that the user cannot actually reach with the pointer in the assembled pose,
 * because nearer INTERACTIVE geometry covers almost all of their silhouette.
 *
 * This is the reachability guard behind the 2026-08-07 self-review FAIL: correct code that the user
 * can never trigger is not a shipped feature. It is about the pointer, not the pixels — a part that
 * is merely half-hidden but still clickable passes, and ids listed in `clickThrough` (see
 * `clickThroughIds`) are excluded as occluders because clicks pass straight through them.
 *
 * A part is "reachable" if at least `MIN_EXPOSED` of its projected area is free of nearer rects.
 * Coverage is sampled on a grid rather than computed analytically — the counts here are tiny and a
 * sampler cannot get union-of-rectangles arithmetic subtly wrong.
 */
const MIN_EXPOSED = 0.2;
const SAMPLES = 24;

export function unreachableDetectedIds(
  parts: readonly Placed[],
  opts: { clickThrough?: readonly string[] } = {},
): string[] {
  const pass = new Set(opts.clickThrough ?? []);
  const rects = parts.flatMap((p) => {
    // Anything carrying a `kind` is a RigPart and measures by its geometry; everything else in the
    // scene is a fan, whose frame is one fixed square.
    const kind = "kind" in p ? (p as RigPart).kind : null;
    const through = pass.has(p.id);
    const bounds = through
      ? kind
        ? PASS_THROUGH_REMAINDER[kind] ?? null
        : null
      : kind
        ? KIND_BOUNDS[kind]
        : FAN_BOUNDS;
    // A part that passes clicks through entirely simply is not in the way of anything.
    return bounds ? [{ part: p, through, rect: screenRect(p.assembled, bounds) }] : [];
  });

  return rects
    // A fully pass-through part has no rect at all and already dropped out above; one that kept a
    // remainder is still judged on it, so "released the whole mesh" cannot slip by unnoticed.
    .filter(({ part }) => part.detected)
    .filter(({ part, rect }) => {
      const occluders = rects
        .filter((o) => o.part.id !== part.id && o.rect.depth > rect.depth)
        .map((o) => o.rect);
      let exposed = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const sx = rect.x0 + ((i + 0.5) / SAMPLES) * (rect.x1 - rect.x0);
        for (let j = 0; j < SAMPLES; j++) {
          const sy = rect.y0 + ((j + 0.5) / SAMPLES) * (rect.y1 - rect.y0);
          if (!occluders.some((o) => sx >= o.x0 && sx <= o.x1 && sy >= o.y0 && sy <= o.y1)) exposed++;
        }
      }
      return exposed / (SAMPLES * SAMPLES) < MIN_EXPOSED;
    })
    .map(({ part }) => part.id);
}

/** Every kind the guard knows how to measure — asserted complete by `rig-parts.test.ts`. */
export const MEASURED_KINDS = Object.keys(KIND_BOUNDS) as RigPartKind[];
