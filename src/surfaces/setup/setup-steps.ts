import { HOME_RAIL, type HomeRailId } from "../../design/homeRail";

// Pure step model for the combined "Compy Setup & Tour". Leg 1 (setup) reuses the existing
// first-experience content; Leg 2 (tour) walks every room of the app. Kept pure + tested so the tour
// can never silently drift out of sync with the real navigation (HOME_RAIL is the single source).

export type SetupLeg = "setup" | "tour";
export type SetupStepKind = "rig" | "seatbelt" | "rules" | "check" | "room";

export interface SetupStep {
  id: string;
  leg: SetupLeg;
  kind: SetupStepKind;
  title: string;
  body: string;
  /** Tour steps only: the room being explained — drives the 3D framework focus. */
  room?: HomeRailId;
}

// Plain-English purpose per room, keyed by the PERSISTED nav id (not the label) so it stays correct
// through the label renames (play→"Monitor", fix→"Tune", learn→"Blackbook"). The user-facing title
// comes from HOME_RAIL.label, so the rename surface and the tour can't disagree.
export const ROOM_PURPOSE: Record<HomeRailId, string> = {
  home: "Your dashboard — live CPU and GPU, your last session, and what's holding you back, all at a glance.",
  check: "Scan whether your PC is ready for a game, then apply the safe fixes it finds for your exact hardware.",
  play: "Watch real FPS, 1% lows and temperatures live while you game — and get a plain-English debrief after.",
  fix: "Apply and undo safe, per-rig tweaks. Every change is logged and fully reversible — nothing is permanent.",
  learn: "What actually works, measured — plus the popular myths that don't. Paste any guide to get it graded.",
  lab: "Go deeper when you want to: benchmarks, latency profiling and system diagnostics.",
};

const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: "setup-rig",
    leg: "setup",
    kind: "rig",
    title: "Your rig",
    body: "This is the PC Compy sees — read live from your hardware, no guessing.",
  },
  {
    id: "setup-seatbelt",
    leg: "setup",
    kind: "seatbelt",
    title: "The seatbelt",
    body: "Every change Compy makes can be undone in one click. Here's how it feels.",
  },
  {
    id: "setup-rules",
    leg: "setup",
    kind: "rules",
    title: "House rules",
    body: "No kernel driver. No game injection. No telemetry. These never change.",
  },
  {
    id: "setup-check",
    leg: "setup",
    kind: "check",
    title: "First check",
    body: "Let's see what's holding your games back right now — and fix the top one together.",
  },
];

// The ordered flow: the four setup steps, then one tour step per room in rail order.
export function buildSetupSteps(): SetupStep[] {
  const tour: SetupStep[] = HOME_RAIL.map((r) => ({
    id: `tour-${r.id}`,
    leg: "tour",
    kind: "room",
    title: r.label,
    body: ROOM_PURPOSE[r.id],
    room: r.id,
  }));
  return [...SETUP_STEPS, ...tour];
}
