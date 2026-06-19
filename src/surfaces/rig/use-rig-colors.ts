import { useEffect, useState } from "react";

// Resolve the active instrument theme's colours from CSS custom properties into plain hex strings
// that three.js materials can consume (three can't read `var(--ix-*)`). This is what makes the 3D
// hologram THEME-AWARE: it follows Midnight/Violet/Crimson/Emerald/Hearth via the same `--ix-streak`
// palette the ambient backdrop uses, and re-resolves live when the user switches themes.

export interface RigColors {
  /** Controls/active accent. */
  accent: string;
  /** A small theme palette to vary parts without leaving the theme (streak-1/2/3). */
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
  const s = getComputedStyle(document.documentElement);
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
    update(); // resolve once mounted (CSS is now applied)
    // Re-resolve when the instrument theme attribute flips (Settings → Appearance).
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-itheme"] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

// Pick a theme colour for a part: detected parts cycle the palette for lively variety; honest
// ghosts (undetectable hardware) take the faint ink so they read as "present but unreadable".
export function partColor(colors: RigColors, detected: boolean, index: number): string {
  if (!detected) return colors.ghost;
  return colors.palette[index % colors.palette.length];
}
