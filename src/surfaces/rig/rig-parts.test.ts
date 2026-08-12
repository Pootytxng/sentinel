import { describe, it, expect } from "vitest";
import {
  buildRigParts,
  clickThroughIds,
  describeRigSelection,
  rigInventory,
  rigSelectionStatus,
  unreachableDetectedIds,
  passThroughRemainder,
  CPU_FAN_PLACEMENT,
  MEASURED_KINDS,
} from "./rig-parts";
import { manualPlacement } from "./manual-parts";
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
  // nothing is publishing RPM. NOT the worst case for occlusion — a `detected` fan sensor is, and
  // the block below covers it.
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
    const shadowing = clickThroughIds(scene);
    // The cooler and the CPU fan share the CPU's x/y and sit nearer the camera.
    expect(shadowing).toContain("cooler");
    expect(shadowing).toContain("fan-ghost-cpu");
    // The PSU is a ghost too, but it stands alone — it must stay selectable.
    expect(shadowing).not.toContain("psu");
    // No detected part is ever made click-through.
    for (const id of shadowing) expect(parts.find((p) => p.id === id)?.detected ?? false).toBe(false);
  });

  it("leaves every detected part clickable once those ghosts pass clicks through", () => {
    expect(unreachableDetectedIds(scene, { clickThrough: clickThroughIds(scene) })).toEqual([]);
  });

  it("keeps the cooler itself selectable — only its socket face passes clicks through", () => {
    const through = clickThroughIds(scene);
    // It must keep a region of its own — releasing the whole mesh was the round-2 regression, where
    // no click anywhere on the cooler, fin stack included, selected anything.
    expect(passThroughRemainder("cooler")).not.toBeNull();
    // Probe: judge the cooler as if it HAD to be reachable. It is measured on what it keeps (the
    // fin stack towering over the socket), so a remainder buried behind something else fails too.
    const probe = scene.map((p) => (p.id === "cooler" ? { ...p, detected: true } : p));
    expect(unreachableDetectedIds(probe, { clickThrough: through })).not.toContain("cooler");
  });

  // ── The monitored rig: HWiNFO/LHM publishing, so the fans are REAL ───────────────────────────
  // Compy's own copy tells the user to run one of these monitors, and doing so used to break the
  // evidence map: the released-ghost rule keyed on `detected`, so `fan-0` on the CPU socket became
  // a detected, never-released plate 0.66 nearer the camera than the CPU behind it. Every click
  // aimed at the processor hit the fan, and the CPU's readings were unreachable for exactly the
  // users who had followed the app's advice.
  describe("with real fan sensors publishing", () => {
    const monitored = [
      ...parts,
      { id: "fan-0", detected: true, assembled: [...CPU_FAN_PLACEMENT.assembled] as [number, number, number] },
      { id: "fan-1", detected: true, assembled: [-1.36, 0.85, 0.85] as [number, number, number] },
      { id: "fan-2", detected: true, assembled: [1.36, 0.55, 0.85] as [number, number, number] },
    ];

    it("hands a detected CPU fan's clicks to the processor behind it", () => {
      expect(clickThroughIds(monitored)).toContain("fan-0");
    });

    it("keeps case fans selectable — they shadow nothing, and they carry a real rpm reading", () => {
      const through = clickThroughIds(monitored);
      expect(through).not.toContain("fan-1");
      expect(through).not.toContain("fan-2");
    });

    it("leaves every detected part reachable on a monitored rig too", () => {
      expect(unreachableDetectedIds(monitored, { clickThrough: clickThroughIds(monitored) })).toEqual([]);
    });

    it("never releases a detected part that is not a fan", () => {
      const through = new Set(clickThroughIds(monitored));
      for (const p of parts) {
        if (p.detected) expect(through.has(p.id)).toBe(false);
      }
    });

    it("does not let a fan release itself by standing in its own way", () => {
      // `real.id !== front.id` — without it a detected fan matches itself (same x/y, same z is not
      // greater, so this is belt-and-braces) and any future loosening of the depth test would make
      // every fan click-through with nothing behind it to receive the click.
      expect(clickThroughIds([{ id: "fan-solo", detected: true, assembled: [3, 3, 3] }])).toEqual([]);
    });
  });

  // ── The helped rig: the user typed in the parts Compy cannot read ────────────────────────────
  // Self-review round 2, 2026-08-11: the fan half of this rule was fixed and the user-added half was
  // not. A cooler added by hand is drawn `detected: true` (the user said it is there) and lands on
  // the socket slot 0.42 nearer the camera than the CPU, so it swallowed every click aimed at the
  // processor. The evidence map broke for exactly the user who helped it along.
  describe("with a cooler the user added by hand", () => {
    const helped = [
      ...parts,
      {
        id: "manual-1",
        // `kind` is what makes this fixture honest: RigHologram gives every manual part a geometry
        // (`manualGeom`), so a fixture without one would be judged as a FAN by the shape rules and
        // would pass whether the user-added clause exists or not.
        kind: "cooler" as const,
        detected: true,
        userAdded: true,
        assembled: [...manualPlacement("cooler", 0).assembled] as [number, number, number],
      },
    ];

    it("hands a hand-added cooler's clicks to the processor behind it", () => {
      expect(clickThroughIds(helped)).toContain("manual-1");
    });

    it("leaves every detected part reachable on a helped rig too", () => {
      expect(unreachableDetectedIds(helped, { clickThrough: clickThroughIds(helped) })).toEqual([]);
    });

    it("keeps the user's own part selectable — it releases the socket face, not its fin stack", () => {
      // Their part must not vanish as a click target because they were helpful. Judged the way the
      // ghost cooler is: on the remainder it keeps.
      const through = clickThroughIds(helped);
      expect(unreachableDetectedIds(helped, { clickThrough: through })).not.toContain("manual-1");
    });

    it("does not release a hand-added part that stands in nobody's way", () => {
      const offAxis = [
        ...parts,
        {
          id: "manual-2",
          kind: "psu" as const,
          detected: true,
          userAdded: true,
          assembled: [...manualPlacement("psu", 0).assembled] as [number, number, number],
        },
      ];
      expect(clickThroughIds(offAxis)).not.toContain("manual-2");
    });
  });

  it("still finds a part that a nearer solid part swallows (the guard actually bites)", () => {
    const buried = scene.map((p) =>
      p.id === "disk-0" ? { ...p, assembled: [-0.55, -0.4, -0.6] as [number, number, number] } : p,
    );
    expect(unreachableDetectedIds(buried, { clickThrough: clickThroughIds(buried) })).toContain("disk-0");
  });
});

// ── What the user actually clicked ────────────────────────────────────────────────────────────
// The Lab's evidence panel resolved the hologram's emitted id through `buildRigParts` alone, so a
// click on a fan or on a part the user added himself highlighted it in the model and then showed
// NOTHING — no reading, no reason, no panel. Two of the three clickable lists had no answer.
describe("describeRigSelection", () => {
  const scene = {
    parts: [
      { id: "cpu", name: "Ryzen 7 9850X3D", detected: true },
      { id: "gpu-0", name: "AMD Radeon RX 9070 XT", detected: true },
    ],
    manual: [{ id: "manual-1", name: "Corsair RM850x" }],
    fans: [
      { id: "fan-0", label: "CPU fan", rpm: 1180, detected: true },
      { id: "fan-ghost-front", label: "Front intake", rpm: null, detected: false },
    ],
  };

  it("resolves a detected part to the builder's own list", () => {
    expect(describeRigSelection("gpu-0", scene)).toEqual({
      source: "part",
      id: "gpu-0",
      name: "AMD Radeon RX 9070 XT",
      detected: true,
    });
  });

  it("names a part the user added himself instead of dropping the click", () => {
    expect(describeRigSelection("manual-1", scene)).toEqual({
      source: "manual",
      id: "manual-1",
      name: "Corsair RM850x",
    });
  });

  it("carries a fan's real rpm so the panel states a measurement, not a guess", () => {
    expect(describeRigSelection("fan-0", scene)).toEqual({
      source: "fan",
      id: "fan-0",
      name: "CPU fan",
      rpm: 1180,
      detected: true,
    });
  });

  it("keeps a ghost fan's null rpm null — the surface says why, it does not invent a number", () => {
    expect(describeRigSelection("fan-ghost-front", scene)).toMatchObject({ rpm: null, detected: false });
  });

  it("returns null for the click-away that clears the selection, and for an unknown id", () => {
    expect(describeRigSelection("", scene)).toBeNull();
    expect(describeRigSelection("nothing-here", scene)).toBeNull();
  });

  // ── The keyboard's list ──────────────────────────────────────────────────────────────────────
  // The hologram is a WebGL canvas: its parts are meshes, so a pointer was the only way to select
  // one and every reading behind a selection was unreachable by keyboard (#49's a11y acceptance).
  // The DOM picker fixes that, and these pin the property that makes it honest — it is built from
  // the SAME list the meshes are, so a part that can be clicked is always in it.
  describe("rigInventory", () => {
    it("offers every clickable thing the scene drew, in scene order", () => {
      expect(rigInventory(scene).map((i) => i.id)).toEqual([
        "cpu",
        "gpu-0",
        "manual-1",
        "fan-0",
        "fan-ghost-front",
      ]);
    });

    it("resolves each entry to exactly what a click on it resolves to", () => {
      for (const item of rigInventory(scene)) {
        expect(describeRigSelection(item.id, scene)).toEqual(item);
      }
    });

    it("carries a name for every entry — a nameless button is an unusable one", () => {
      for (const item of rigInventory(scene)) expect(item.name.length).toBeGreaterThan(0);
    });

    it("is empty for an empty scene rather than inventing a placeholder row", () => {
      expect(rigInventory({ parts: [], manual: [], fans: [] })).toEqual([]);
    });
  });

  describe("rigSelectionStatus", () => {
    const statusOf = (id: string) => rigSelectionStatus(describeRigSelection(id, scene)!);

    it("separates a fan with no sensor from a sensor with no number", () => {
      // Both look like "no rpm" to a naive check, and they send the user to different fixes:
      // install a monitor, versus a monitor that is running but hasn't published this fan.
      expect(statusOf("fan-ghost-front")).toBe("unavailable");
      expect(
        rigSelectionStatus({ source: "fan", id: "fan-2", name: "Rear", rpm: null, detected: true }),
      ).toBe("unread");
    });

    it("reports a measuring fan and a detected part as detected, never as a guess", () => {
      expect(statusOf("fan-0")).toBe("detected");
      expect(statusOf("cpu")).toBe("detected");
    });

    it("never calls a user-added part detected — the user typed it, Compy did not read it", () => {
      expect(statusOf("manual-1")).toBe("userAdded");
    });

    it("calls an undetected part unavailable, so the list states why it is empty", () => {
      expect(
        rigSelectionStatus({ source: "part", id: "psu", name: "Power supply", detected: false }),
      ).toBe("unavailable");
    });
  });

  it("keeps ids exact — an indexed part never collapses onto its kind", () => {
    // Reducing `gpu-1` to `gpu` would relabel the second card's readings as the first card's.
    expect(describeRigSelection("gpu-1", scene)).toBeNull();
  });
});
