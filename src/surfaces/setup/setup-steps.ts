import { HOME_RAIL, type HomeRailId } from "../../design/homeRail";
import type { RigPart, RigPartKind } from "../rig/rig-parts";
import { fmtGB } from "../hardware-format";

// Step model for the combined "Compy Setup & Tour". Leg 1 (setup) reuses the existing
// first-experience content. Leg 2 (tour) is a HARDWARE fly-through — each real component teaches what
// it does, the metric it drives, the REAL Compy tweaks that touch it, AND names the Compy tab that
// manages those tweaks (so hardware and the app's tabs connect). A final recap maps all six tabs.
// Pure + tested so the lessons / tab ties can't silently drift from the parts or the nav.

export type SetupLeg = "setup" | "tour";
export type SetupStepKind = "rig" | "seatbelt" | "rules" | "check" | "lesson" | "tabmap";

// One-line "what it's for" per Compy tab, keyed by the persisted nav id (labels come from HOME_RAIL,
// so the rename surface and the tour can't disagree). Used by the lesson tab-chips + the recap.
export const TAB_BLURB: Record<HomeRailId, string> = {
  home: "Your dashboard — live CPU/GPU and what's limiting you, at a glance.",
  check: "Scan game-readiness, then apply the safe fixes it finds for your rig.",
  play: "Watch live FPS, 1% lows and temps — with a debrief after each session.",
  fix: "Apply and undo reversible tweaks — every change logged in the ledger.",
  learn: "The measured library of what actually works — and the myths that don't.",
  lab: "Go deeper: benchmarks, latency and system diagnostics.",
};

export interface HardwareLesson {
  /** Which rig part kind this lesson focuses (the showcase shows the first part of this kind). */
  kind: RigPartKind;
  eyebrow: string;
  /** What the component does. */
  role: string;
  /** The performance metric it most drives. */
  affects: string;
  /** Honest, short descriptions of the REAL Compy tweaks that touch this component. */
  tweaks: string[];
  /** The Compy tab that manages those tweaks, + a one-line tie phrase (connects hardware ↔ tab). */
  tab: { id: HomeRailId; tie: string };
  /** Optional honesty caveat (e.g. the PSU is not software-readable). */
  note?: string;
}

export interface TabInfo {
  id: HomeRailId;
  label: string;
  icon: string;
  blurb: string;
}

export interface SetupStep {
  id: string;
  leg: SetupLeg;
  kind: SetupStepKind;
  title: string;
  body: string;
  /** Lesson steps: the rig part id to focus, and the lesson content. */
  focusId?: string;
  lesson?: HardwareLesson;
  /** Tabmap step: all six tabs to recap. */
  tabs?: TabInfo[];
}

// Leg 1 — guided setup (existing content).
const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: "setup-rig",
    leg: "setup",
    kind: "rig",
    title: "Compy just read your machine",
    body: "This is the PC Compy sees — read live from your hardware, no guessing.",
  },
  {
    id: "setup-seatbelt",
    leg: "setup",
    kind: "seatbelt",
    title: "One click to apply. One click to take it back.",
    body: "Every change Compy makes is logged in the Tune tab's ledger and undoes in one click.",
  },
  {
    id: "setup-rules",
    leg: "setup",
    kind: "rules",
    title: "What Compy refuses to do",
    body: "No kernel driver. No game injection. No telemetry. These never change.",
  },
  {
    id: "setup-check",
    leg: "setup",
    kind: "check",
    title: "Your first check",
    body: "Let's see what's holding your games back right now — and fix the top one together.",
  },
];

// Leg 2 — the hardware tour, in the owner's order: power → storage → graphics → processor → memory.
// Every tweak named is a REAL Compy recommendation; advisories are phrased as advisories. Each lesson
// names the tab that manages its tweaks (the hardware ↔ tab tie).
export const HARDWARE_LESSONS: readonly HardwareLesson[] = [
  {
    kind: "psu",
    eyebrow: "POWER DELIVERY",
    role: "Feeds steady power to every part, and your power settings decide how hard they can push.",
    affects: "Sustained clocks — whether your CPU and GPU hold high speeds instead of dipping mid-game.",
    tweaks: [
      "Ultimate / High-performance power plan — lets parts stay at high clocks",
      "Fast Startup off — a true clean boot, not a half-hibernated state",
      "USB selective-suspend & PCIe power-saving off — no power naps mid-game",
    ],
    tab: { id: "lab", tie: "Prove the clocks hold with benchmarks in the Lab tab." },
    note: "Compy can't read your PSU model in software, so it stays a faint placeholder — but the power settings above decide how hard everything is allowed to draw.",
  },
  {
    kind: "storage",
    eyebrow: "STORAGE",
    role: "Holds Windows and your games, and streams level data to the game as you play.",
    affects: "Load times and texture/streaming hitches when the game pulls data from the drive.",
    tweaks: [
      "SysMain (Superfetch) tuned so it isn't churning the disk in the background",
      "Reserved storage & free-space cleanup — keep the system drive breathing room",
      "On an HDD, Compy flags an SSD upgrade as the single biggest win (advisory)",
    ],
    tab: { id: "fix", tie: "Apply or undo these in the Tune tab — all in the ledger." },
  },
  {
    kind: "gpu",
    eyebrow: "GRAPHICS",
    role: "Renders every frame you see — the heart of your frame rate.",
    affects: "FPS and frame consistency, especially at higher resolutions and settings.",
    tweaks: [
      "Hardware-accelerated GPU Scheduling — lets the GPU manage its own work",
      "Vendor background/telemetry services off (NVIDIA Container · AMD UXP)",
      "Force games onto your discrete GPU, and keep the driver current",
    ],
    tab: { id: "play", tie: "Watch the frames these earn you, live, in the Monitor tab." },
  },
  {
    kind: "cpu",
    eyebrow: "PROCESSOR",
    role: "Runs game logic, physics, and the draw calls that feed your GPU.",
    affects: "1% lows and frametime smoothness — steady vs. stuttery, even at the same average FPS.",
    tweaks: [
      "A power plan that lets cores boost instead of idling low",
      "Fewer startup apps fighting for CPU time (Compy's startup review)",
    ],
    tab: { id: "check", tie: "The Check tab scans for CPU limiters and applies the top fix." },
  },
  {
    kind: "ram",
    eyebrow: "MEMORY",
    role: "Keeps the game and Windows instantly on hand while you play.",
    affects: "Stutter and alt-tab hitches when free memory runs low.",
    tweaks: [
      "Compy watches memory headroom and flags heavy background apps",
      "More capacity is the real fix when a game wants more than you have (advisory)",
    ],
    tab: { id: "home", tie: "Your memory headroom shows on the Home dashboard." },
  },
];

// The six tabs, for the recap — labels/icons from HOME_RAIL (single source), blurbs from TAB_BLURB.
export function buildTabs(): TabInfo[] {
  return HOME_RAIL.map((r) => ({ id: r.id, label: r.label, icon: r.icon, blurb: TAB_BLURB[r.id] }));
}

// Build the Leg-2 steps from the user's REAL parts: each lesson focuses the first part of its kind.
// A lesson whose kind isn't present is skipped (cooler/psu placeholders are always emitted).
export function buildHardwareSteps(parts: RigPart[]): SetupStep[] {
  return HARDWARE_LESSONS.flatMap((lesson) => {
    const part = parts.find((p) => p.kind === lesson.kind);
    if (!part) return [];
    // Memory: title by the REAL config (total capacity + module count), never the first slot — a lone
    // "Memory · Slot 1" misleads (implies only one module is read). Every other kind uses the part name.
    let title = part.name;
    if (lesson.kind === "ram") {
      const rams = parts.filter((p) => p.kind === "ram");
      const total = rams.reduce((sum, p) => sum + (p.capacityBytes ?? 0), 0);
      const n = rams.length;
      const count = n > 1 ? ` · ${n} modules` : "";
      title = total > 0 ? `Memory · ${fmtGB(total)}${count}` : n > 1 ? `Memory${count}` : "Memory";
    }
    return [
      {
        id: `tour-${lesson.kind}`,
        leg: "tour" as const,
        kind: "lesson" as const,
        title,
        body: lesson.role,
        focusId: part.id,
        lesson,
      },
    ];
  });
}

// The ordered flow: setup steps → a hardware lesson per present component → the six-tab recap.
export function buildSetupSteps(parts: RigPart[]): SetupStep[] {
  return [
    ...SETUP_STEPS,
    ...buildHardwareSteps(parts),
    {
      id: "tour-tabmap",
      leg: "tour",
      kind: "tabmap",
      title: "Your way around Compy",
      body: "Six rooms, one job each. Here's where everything lives.",
      tabs: buildTabs(),
    },
  ];
}
