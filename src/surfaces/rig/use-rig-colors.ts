import { useEffect, useState } from "react";
import type { RigPartKind } from "./rig-parts";
import { readRoomIdentity } from "../../design/theme";

// Resolve the active instrument theme's colours from CSS custom properties into plain hex strings
// that three.js materials can consume (three can't read `var(--ix-*)`). The theme paints the BAY
// (shell, case wireframe, floor grid, rim light) and re-resolves live when the user switches
// themes — but NOT the parts: part colours are the fixed identity palette below.

export interface RigColors {
  /** Controls/active accent. */
  accent: string;
  /** Theme streak trio (streak-1/2/3) — paints the floor grid; parts stopped using it
      (they wear PART_KIND_COLORS below). */
  palette: [string, string, string];
  /** Faint ink for honest "not detected" ghost parts. */
  ghost: string;
}

const FALLBACK: RigColors = {
  accent: "#b366ff",
  palette: ["#b366ff", "#ff77c8", "#9d7bff"],
  ghost: "#5d6679",
};

function read(): RigColors {
  if (typeof document === "undefined") return FALLBACK;
  // When per-room identity is on, resolve the BAY accent from the active room element so the Lab's
  // hologram cage/ring/grid adopt the room hue (emerald) instead of the base theme accent — the
  // room chrome and the hologram then read as one. Off ⇒ documentElement (today's behaviour). Home
  // takes no --ix-accent re-point, so reading its room element yields the same value as the root.
  const scope =
    (readRoomIdentity() ? document.querySelector<HTMLElement>(".v2-room") : null) ??
    document.documentElement;
  const s = getComputedStyle(scope);
  const v = (name: string, fb: string) => {
    const got = s.getPropertyValue(name).trim();
    return got || fb;
  };
  const accent = v("--ix-accent", FALLBACK.accent);
  return {
    accent,
    palette: [
      v("--ix-streak-1", accent),
      v("--ix-streak-2", FALLBACK.palette[1]),
      v("--ix-streak-3", accent),
    ],
    ghost: v("--faint", FALLBACK.ghost),
  };
}

export function useRigColors(): RigColors {
  const [colors, setColors] = useState<RigColors>(read);
  useEffect(() => {
    const update = () => setColors(read());
    update(); // resolve once mounted (CSS is now applied, and the room element exists)
    // Re-resolve when the instrument theme OR the per-room identity flag flips (Settings →
    // Appearance). Room navigation is covered by remount — the rig unmounts/remounts per room.
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-itheme", "data-room-identity"],
    });
    window.addEventListener("compy:room-identity-changed", update);
    return () => {
      obs.disconnect();
      window.removeEventListener("compy:room-identity-changed", update);
    };
  }, []);
  return colors;
}

// Fixed part-identity palette (owner directive 2026-07-07): every component KIND keeps its own
// distinct hue in EVERY theme so the parts are instantly tellable apart. The old rule tinted all
// parts from the 3-hue theme palette — near-identical hues made the model read as one blob.
// Deliberately theme-INDEPENDENT: these never follow the accent.
export const PART_KIND_COLORS: Record<RigPartKind, string> = {
  board: "#8f9bb8", // slate — the structural slab stays quiet behind everything
  cpu: "#ffb84d", // amber
  ram: "#c77dff", // violet
  gpu: "#3fd9c2", // teal
  storage: "#7ee08a", // green
  cooler: "#9adcff", // ice (visible when user-added; the auto ghost stays faint)
  psu: "#ff8a5c", // copper (same: user-added shows it, the ghost stays faint)
};

// Fans aren't RigParts (they're live-RPM meshes) but follow the same fixed-identity rule.
export const FAN_COLOR = "#58a6ff"; // sky

// Pick a part's colour: detected parts wear their kind's fixed identity hue; honest ghosts
// (undetectable hardware) keep the theme's faint ink so they read as "present but unreadable".
export function partColor(colors: RigColors, detected: boolean, kind: RigPartKind): string {
  if (!detected) return colors.ghost;
  return PART_KIND_COLORS[kind];
}
