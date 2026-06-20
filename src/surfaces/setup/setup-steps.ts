import type { RigPart, RigPartKind } from "../rig/rig-parts";

// Step model for the combined "Compy Setup & Tour". Leg 1 (setup) reuses the existing
// first-experience content. Leg 2 (tour) is a HARDWARE fly-through: it cycles through the user's real
// components and, for each, teaches what the part does, the metric it drives, and which of Compy's
// REAL tweaks touch it — so the tour educates AND ties every setting to the hardware responsible for
// it. Pure + tested so the lessons can't silently drift from the parts.

export type SetupLeg = "setup" | "tour";
export type SetupStepKind = "rig" | "seatbelt" | "rules" | "check" | "lesson";

export interface HardwareLesson {
  /** Which rig part kind this lesson focuses (the camera flies to the first part of this kind). */
  kind: RigPartKind;
  eyebrow: string;
  /** What the component does. */
  role: string;
  /** The performance metric it most drives. */
  affects: string;
  /** Honest, short descriptions of the REAL Compy tweaks that touch this component. */
  tweaks: string[];
  /** Optional honesty caveat (e.g. the PSU is not software-readable). */
  note?: string;
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
    body: "Every change Compy makes can be undone in one click. Here's how it feels.",
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
// Every tweak named below is a REAL Compy recommendation; advisories are phrased as advisories.
export const HARDWARE_LESSONS: readonly HardwareLesson[] = [
  {
    kind: "psu",
    eyebrow: "POWER DELIVERY",
    role: "Feeds steady power to every part, and your power settings decide how hard they're allowed to push.",
    affects: "Sustained clocks — whether your CPU and GPU hold high speeds instead of dipping mid-game.",
    tweaks: [
      "Ultimate / High-performance power plan — lets parts stay at high clocks",
      "Fast Startup off — a true clean boot, not a half-hibernated state",
      "USB selective-suspend & PCIe power-saving off — no power naps mid-game",
    ],
    note: "Compy can't read your PSU model in software, so it stays a faint ghost — but the power settings above decide how hard everything is allowed to draw.",
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
  },
];

// Build the Leg-2 steps from the user's REAL parts: each lesson focuses the first part of its kind.
// A lesson whose kind isn't present is skipped (cooler/psu ghosts are always emitted, so power shows).
export function buildHardwareSteps(parts: RigPart[]): SetupStep[] {
  return HARDWARE_LESSONS.flatMap((lesson) => {
    const part = parts.find((p) => p.kind === lesson.kind);
    if (!part) return [];
    return [
      {
        id: `tour-${lesson.kind}`,
        leg: "tour" as const,
        kind: "lesson" as const,
        title: part.name, // the user's REAL component name
        body: lesson.role,
        focusId: part.id,
        lesson,
      },
    ];
  });
}

// The ordered flow: the four setup steps, then a hardware lesson per present component.
export function buildSetupSteps(parts: RigPart[]): SetupStep[] {
  return [...SETUP_STEPS, ...buildHardwareSteps(parts)];
}
