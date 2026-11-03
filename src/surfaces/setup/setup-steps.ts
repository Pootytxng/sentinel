import { railFor, type HomeRailId } from "../../design/homeRail";
import type { RigPart, RigPartKind } from "../rig/rig-parts";
import { fmtGB } from "../hardware-format";

// Step model for the combined "Compy Setup & Tour". Leg 1 (setup) reuses the existing
// first-experience content. Leg 2 (tour) is a HARDWARE fly-through — each real component teaches what
// it does, the metric it drives, the REAL Compy tweaks that touch it, AND names the Compy tab that
// manages those tweaks (so hardware and the app's tabs connect). A final recap maps the rail's rooms.
// Pure + tested so the lessons / tab ties can't silently drift from the parts or the nav.
//
// V2-8 (P6 §4 tour alignment — align, don't add): the recap and the tab ties follow the rail the
// user ACTUALLY has (railFor). Merged (the shipped default) = five rooms in journey order, and the
// recap copy names that journey; the compy_optimize="0" escape hatch keeps the classic six-room
// recap verbatim. No new steps either way.

/**
 * Resolves a locale key with its English fallback (CR-zh-gpu, 2026-11-03): the lessons, the recap
 * and the tab blurbs below are the English source and the keys' fallbacks, and the tour passes
 * i18next's `t` so zh-CN reads whole. Callers that pass nothing get the English, byte for byte.
 */
export type SetupTr = (key: string, fallback: string, vars?: Record<string, string | number>) => string;
const asIs: SetupTr = (_key, fallback) => fallback;

export type SetupLeg = "setup" | "tour";
export type SetupStepKind = "rig" | "seatbelt" | "rules" | "check" | "lesson" | "tabmap";

// One-line "what it's for" per Compy tab, keyed by the persisted nav id (labels come from HOME_RAIL,
// so the rename surface and the tour can't disagree). Used by the lesson tab-chips + the recap.
export const TAB_BLURB: Record<HomeRailId, string> = {
  // "Your dashboard" named a shape, not an answer — the same reason the room stopped being called
  // "Home" (owner rename 2026-08-19). The blurb now states the question the room answers.
  home: "Is your PC OK right now — the verdict, and what is holding you back.",
  check: "Scan game-readiness, then apply the safe fixes it finds for your rig.",
  play: "Watch live FPS, 1% lows and temps — with a debrief after each session.",
  fix: "Apply and undo reversible tweaks — every change logged in the ledger.",
  // Names the Field Guide explicitly (tester Matthew 2026-07-22: he first met the term inside the
  // Logbook tab and was confused — the intro should introduce it).
  learn: "The measured record of what actually works — and the myths that don't. Its library is the Field Guide.",
  lab: "Go deeper: benchmarks, latency and system diagnostics.",
  // Glass redesign (2026-10-30): the two journey doors.
  games: "Every game Compy has measured, and how each one runs — where making a game better starts.",
  problems: "Crashes, freezes and restarts from Windows' own records — find out what went wrong.",
};

// The merged room absorbs Check's diagnose half, so its blurb must cover both (the fix-id blurb
// above only describes the Tune half — wrong for the five-room rail).
export const MERGED_FIX_BLURB =
  "Check what's holding your games back, then apply the safe fixes — every change undoable in the ledger.";

// The proving-ground Lab absorbs the whole Optimize room (2026-07-10 flip: no standalone Optimize
// tab), so ITS blurb must cover check + fix + prove — the lab-id blurb above only describes the
// instruments half.
export const GROUND_LAB_BLURB =
  "Check what's holding your games back and apply the safe fixes — every change undoable — then prove it with benchmarks, latency and diagnostics.";

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
    // Body is data-only (StepSeatbelt renders its own copy, naming the live rail's ledger room via
    // fixLabel) — kept tab-neutral so it can never name a room the rail doesn't show.
    title: "One click to apply. One click to take it back.",
    body: "Every change Compy makes is logged in its ledger and undoes in one click.",
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
    tab: { id: "lab", tie: "Prove the clocks hold with benchmarks in the Test tab." },
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
    tab: { id: "fix", tie: "Apply or undo these in the Optimize tab — all in the ledger." },
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
    tab: { id: "play", tie: "Watch the frames these earn you, live, in the Live tab." },
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
    // C-19 — this note used to say CPU temperature "needs a kernel driver to read, and this build
    // ships none", full stop. That is only half the truth: Compy reads it out of a monitor app's
    // published shared memory (HWiNFO) or WMI namespace (LibreHardwareMonitor) when one is running,
    // which is driver-free and is what cpu_temp.rs actually does. Stating the gap without stating
    // the working path taught the user a dead end. Worded without "kernel driver" (the rules step's
    // "Nothing installed deep inside Windows", plain-language guard) since the copy moved to i18n.
    note: "One honest gap: reading CPU temperature directly needs something installed deep inside Windows, and Compy ships nothing of the kind. If you run HWiNFO or LibreHardwareMonitor, Compy reads the temperature they already publish — Health shows you how.",
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
    tab: { id: "home", tie: "Your memory headroom shows on Health." },
  },
];

// The recap tabs — labels/icons from the SAME rail selector the app renders (railFor, single
// source), blurbs from TAB_BLURB. Merged = the five journey rooms; ground = the four-room
// proving-ground rail (the Lab's blurb covers the absorbed Optimize). The recap can never show
// a room the rail doesn't have.
export function buildTabs(merged: boolean, ground = false, tr: SetupTr = asIs): TabInfo[] {
  return railFor(merged, ground).map((r) => ({
    id: r.id,
    // The label resolves the way the rendered rail resolves it (`ShellV2.railLabel`: the relabeled
    // Optimize entry keys `common.rail.optimize`, every other room `common.rail.<id>`), English as
    // the fallback, so a zh-CN recap names 健康/游戏/问题/实时/历史/测试 like the rail beside it
    // (desk review 2026-11-03). The pure callers pass no resolver and read the English as before.
    label: tr(r.label === "Optimize" ? "common.rail.optimize" : `common.rail.${r.id}`, r.label),
    icon: r.icon,
    blurb:
      ground && r.id === "lab"
        ? tr("home.setupTour.tabBlurb.groundLab", GROUND_LAB_BLURB)
        : merged && r.id === "fix"
          ? tr("home.setupTour.tabBlurb.mergedFix", MERGED_FIX_BLURB)
          : tr(`home.setupTour.tabBlurb.${r.id}`, TAB_BLURB[r.id]),
  }));
}

// Build the Leg-2 steps from the user's REAL parts: each lesson focuses the first part of its kind.
// A lesson whose kind isn't present is skipped (cooler/psu placeholders are always emitted).
// Under the merged rail the standalone Check room doesn't exist, so a lesson tied to it re-ties to
// the merged Optimize room (same diagnose-first meaning, the room the rail actually shows).
// Under the proving-ground rail (2026-07-10 flip) neither Check nor Optimize exists — both re-tie
// to the Lab, whose Optimize station now holds the toggles and the scan.
export function buildHardwareSteps(
  parts: RigPart[],
  merged = true,
  ground = false,
  tr: SetupTr = asIs,
): SetupStep[] {
  return HARDWARE_LESSONS.flatMap((rawLesson) => {
    const k = `home.setupTour.lessons.${rawLesson.kind}`;
    // The tab tie re-points by rail; each tie is its own key so a translation never has to carry
    // three rails in one string.
    const tab: HardwareLesson["tab"] = ground
      ? rawLesson.tab.id === "check"
        ? { id: "lab", tie: tr(`${k}.tieGround`, "Test scans for CPU limiters and applies the top fix.") }
        : rawLesson.tab.id === "fix"
          ? {
              id: "lab",
              tie: tr(`${k}.tieGround`, "Apply or undo these at Test's Optimize station — all in the ledger."),
            }
          : { id: rawLesson.tab.id, tie: tr(`${k}.tie`, rawLesson.tab.tie) }
      : merged && rawLesson.tab.id === "check"
        ? { id: "fix", tie: tr(`${k}.tieMerged`, "Optimize scans for CPU limiters and applies the top fix.") }
        : { id: rawLesson.tab.id, tie: tr(`${k}.tie`, rawLesson.tab.tie) };
    const lesson: HardwareLesson = {
      ...rawLesson,
      eyebrow: tr(`${k}.eyebrow`, rawLesson.eyebrow),
      role: tr(`${k}.role`, rawLesson.role),
      affects: tr(`${k}.affects`, rawLesson.affects),
      tweaks: rawLesson.tweaks.map((tw, i) => tr(`${k}.tweaks.${i}`, tw)),
      tab,
      ...(rawLesson.note ? { note: tr(`${k}.note`, rawLesson.note) } : {}),
    };
    const part = parts.find((p) => p.kind === lesson.kind);
    if (!part) return [];
    // Memory: title by the REAL config (total capacity + module count), never the first slot — a lone
    // "Memory · Slot 1" misleads (implies only one module is read). Every other kind uses the part name.
    let title = part.name;
    if (lesson.kind === "ram") {
      const rams = parts.filter((p) => p.kind === "ram");
      const total = rams.reduce((sum, p) => sum + (p.capacityBytes ?? 0), 0);
      const n = rams.length;
      const gb = total > 0 ? fmtGB(total) : "";
      title =
        total > 0
          ? n > 1
            ? tr(`${k}.titleModules`, `Memory · ${gb} · ${n} modules`, { total: gb, count: n })
            : tr(`${k}.title`, `Memory · ${gb}`, { total: gb })
          : n > 1
            ? tr(`${k}.titleBareModules`, `Memory · ${n} modules`, { count: n })
            : tr(`${k}.titleBare`, "Memory");
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

// The recap body names the journey (P6 §4: order is felt, never taught — but the recap may SAY
// it): the rail reads top to bottom in story order. Only the merged five-room rail IS that
// journey; the classic six-room escape hatch keeps its original copy.
export const JOURNEY_RECAP_BODY =
  "The rail reads top to bottom: Health for the glance, Games to make a game run better, Problems to find out what went wrong, Optimize to check and fix, Live to watch the frames as they happen, History for what actually works, Test to go deeper.";

// The proving-ground recap (2026-07-10 flip) — the four-room rail in ITS order, the Lab as the
// workshop at the end of the row.
export const GROUND_RECAP_BODY =
  "The rail reads top to bottom: Health for the glance, Games to make a game run better, Problems to find out what went wrong, Live to watch the frames as they happen, History for what actually works, Test to check, fix and prove it.";

// The ordered flow: setup steps → a hardware lesson per present component → the rail recap.
// 2026-07-23 (tester Matthew: "the last tab is the best for clarity" — orientation must not wait
// until the END): the FIRST step now also carries the mode's rail-orientation line, so the user
// holds the map from minute zero; the closing recap still repeats it with the tab cards (repeating
// a MAP is good pedagogy, not overload).
export function buildSetupSteps(
  parts: RigPart[],
  merged = true,
  ground = false,
  tr: SetupTr = asIs,
): SetupStep[] {
  const groundRecap = tr("home.setupTour.recap.ground", GROUND_RECAP_BODY);
  const journeyRecap = tr("home.setupTour.recap.journey", JOURNEY_RECAP_BODY);
  const orientation = ground ? groundRecap : merged ? journeyRecap : null;
  const setupSteps = SETUP_STEPS.map((s) =>
    s.id === "setup-rig" && orientation ? { ...s, body: `${s.body} ${orientation}` } : s,
  );
  return [
    ...setupSteps,
    ...buildHardwareSteps(parts, merged, ground, tr),
    {
      id: "tour-tabmap",
      leg: "tour",
      kind: "tabmap",
      title: tr("home.setupTour.recap.title", "Your way around Compy"),
      body: ground
        ? groundRecap
        : merged
          ? journeyRecap
          : tr("home.setupTour.recap.classic", "Six rooms, one job each. Here's where everything lives."),
      tabs: buildTabs(merged, ground, tr),
    },
  ];
}
