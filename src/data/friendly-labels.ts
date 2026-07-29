// Friendly-label layer (owner direction 2026-06-15: "fewer, plainer, spoon-fed for Caleb/Sarah").
// A FRONTEND-ONLY display map: rec id → a plain-language, benefit-first headline + a quiet technical
// tag. The backend catalog (baseline-rules-v1.json / recommendations.rs) is UNTOUCHED — exports,
// history, and the Trust Ledger keep the exact technical titles. This only changes what the everyday
// user READS in the Tune list when the Living Instrument preview is on; the full technical title +
// measured detail stay one tap away under "What's this?".
//
// VOICE (owner-picked): friendly-first, technical-name kept quiet-but-visible (lean simple). So a card
// reads "Smoother online play" big, with "Nagle's Algorithm · advanced" muted beneath — Caleb gets the
// benefit, the power user still spots the real name without tapping.
//
// HONESTY: headlines describe the ACTION or the kind of benefit, never an unmeasured promise (no "+30
// FPS", no "guaranteed faster"). The MEASURED/EXPECTED chip + What's-this carry the evidence. A lint
// test (friendly-labels.test.ts) guards against banned hype words and empty headlines.

export type FriendlyLabel = {
  /** Plain, benefit-first headline shown to everyday users. */
  headline: string;
  /** The real technical name, shown quiet + muted beside the headline (not hidden). */
  tech?: string;
};

// Only the jargon-heavy / unclear recs are remapped. Recs whose catalog title is already plain
// (e.g. "Free up space on C:", "Update your graphics driver", "Upgrade to an SSD") are intentionally
// ABSENT → they fall back to their original title with no tech tag.
export const FRIENDLY_LABELS: Record<string, FriendlyLabel> = {
  "nagle-disable": { headline: "Smoother online play", tech: "Nagle's Algorithm · advanced" },
  "windows-search-disable": { headline: "Free up an older hard drive", tech: "Search indexer · HDD only" },
  "game-mode": { headline: "Help Windows focus on your game", tech: "Game Mode" },
  "visual-effects": { headline: "Trim Windows animations for speed", tech: "Visual effects" },
  "mouse-accel-off": { headline: "Keep your aim consistent", tech: "Mouse acceleration off" },
  "game-bar-disable": { headline: "Stop the Xbox overlay & background recording", tech: "Game Bar & DVR" },
  "diagtrack-disable": { headline: "Stop background data collection", tech: "Windows telemetry · DiagTrack" },
  "usb-selective-suspend-off": { headline: "Keep your USB gear awake", tech: "USB Selective Suspend" },
  "pcie-aspm-off": { headline: "Stop your GPU link from power-napping", tech: "PCIe power management" },
  "eee-disable": { headline: "Steady your wired connection", tech: "Energy Efficient Ethernet" },
  // Decision framing, not a nudge to weaken security (consumer-panel Phase 1: the old "may be
  // costing you frames" headline read as a request to turn a protection off).
  "memory-integrity-vbs-advisory": {
    headline: "Your call: extra security or extra frames",
    tech: "Memory Integrity / VBS",
  },
  "defender-game-folder-exclusions-advisory": {
    headline: "Stop antivirus from scanning games mid-play",
    tech: "Defender folder exclusions",
  },
  "vrr-advisory": { headline: "Turn on tear-free gaming", tech: "VRR · G-SYNC / FreeSync" },
  "audio-enhancements-advisory": { headline: "Clean up your game audio", tech: "Audio enhancements off" },
  "hdr-advisory": { headline: "Decide HDR game by game", tech: "Auto HDR" },
  "power-ultimate": { headline: "Stop your PC from throttling itself", tech: "Ultimate Performance plan" },
  "reserved-storage-off": { headline: "Reclaim ~7–10 GB on your C: drive", tech: "Reserved Storage" },
  "fast-startup-off": { headline: "Fix odd restart & shutdown glitches", tech: "Fast Startup off" },
  "nvidia-telemetry": { headline: "Stop NVIDIA's background reporting", tech: "NVIDIA Container telemetry" },
  "nvidia-low-latency": { headline: "Cut input lag on NVIDIA", tech: "Low Latency Mode · Ultra" },
  "amd-uxp": { headline: "Opt out of AMD's data collection", tech: "AMD User Experience Program" },
  "gpu-prefer-discrete": { headline: "Force games onto your real GPU", tech: "Prefer discrete GPU" },
  "sysmain-disable": { headline: "Calm constant background disk activity", tech: "SysMain · Superfetch" },
  "hags-enable": { headline: "Let your GPU schedule its own work", tech: "Hardware-accelerated GPU Scheduling" },
};

/** The friendly label for a rec, or null if it has none (caller falls back to the original title). */
export function friendlyLabel(id: string): FriendlyLabel | null {
  return FRIENDLY_LABELS[id] ?? null;
}

/** Whether the Living Instrument preview is on. DOM-read: surfaces re-render fresh on navigation,
 *  so a Settings toggle is reflected when you come back. */
export function livingLabelsOn(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.living === "on";
}

export type RecDisplayLabel = {
  /** What the user reads as the name of this tweak. */
  headline: string;
  /** The real technical name, quiet beside the headline — null when the headline IS the real name. */
  tech: string | null;
  /** True when a friendly headline replaced the catalog title (callers style the pair differently). */
  friendly: boolean;
};

// ONE NAME PER REC (product-recovery train, 2026-07-28 — self-review FAIL). A recommendation used to
// be named three different ways in a single scroll: the deck's "next best move" card and the
// carried-arrival banner printed the raw catalog title while the row directly beneath printed the
// friendly headline. A non-technical gamer cannot tell those are the same tweak, which is exactly the
// orientation failure this train exists to fix (recovery items 2/4/9). Every surface that names a rec
// resolves it HERE, so the name is decided in one place instead of per-component.
export function recDisplayLabel(id: string, title: string): RecDisplayLabel {
  const f = livingLabelsOn() ? friendlyLabel(id) : null;
  if (!f) return { headline: title, tech: null, friendly: false };
  return { headline: f.headline, tech: f.tech ?? null, friendly: true };
}
