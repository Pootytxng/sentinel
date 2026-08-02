import { useEffect, useState } from "react";

// App-wide motion preference.
//
// HISTORY — read both entries before changing this default again.
//   2026-06-19 (superseded): Compy's "living instrument" motion was ON BY DEFAULT and deliberately
//     OVERRODE the OS "reduce motion" setting, with an explicit opt-out. The default was "full".
//   2026-08-01 (current, Direction D gate, issue #49): overturned. Windows is the DEFAULT
//     AUTHORITY. The redesign brief lists the old behaviour under conflicts as "contradicts
//     accessibility direction; fix", and WCAG 2.2 requires that unnecessary motion be disableable
//     through the operating-system preference. An explicit user override still exists in both
//     directions — "full" forces motion on even when the OS asks for calm, "reduced" forces calm
//     even when it doesn't — but Compy may never SILENTLY ignore the system setting. So the
//     default is "system".
//
// Migration note: users who never touched the setting had no stored value, so they move from
// "full" to "system" automatically. The only visible change is for someone who has Windows
// reduce-motion turned ON — which is exactly the person this fix is for. Anyone who explicitly
// chose "full" keeps it; the stored value wins over the default.
//
// The resolved state is mirrored onto <html data-motion="full|reduced"> so BOTH JS animations
// (via useReducedMotion) and CSS (via :root[data-motion="reduced"], and the Quiet Pit Wall
// contract in tokens-qpw.css) read one source of truth.

export type MotionPref = "full" | "system" | "reduced";

const KEY = "compy_motion";
const EVENT = "compy:motion";

export function readMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "full" || v === "system" || v === "reduced") return v;
  } catch {
    /* localStorage unavailable */
  }
  return "system"; // default: follow the Windows setting — never silently override it
}

function systemReduced(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Resolve the effective "should we reduce motion?" boolean from a pref.
export function resolveReduced(pref: MotionPref = readMotionPref()): boolean {
  if (pref === "reduced") return true;
  if (pref === "system") return systemReduced();
  return false; // "full" — an explicit user override, honoured
}

// Mirror the resolved state onto <html> so CSS keys off it (:root[data-motion="reduced"]).
export function applyMotionAttribute(): void {
  try {
    document.documentElement.dataset.motion = resolveReduced() ? "reduced" : "full";
  } catch {
    /* no document */
  }
}

export function setMotionPref(pref: MotionPref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  applyMotionAttribute();
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* ignore */
  }
}

// Reactive hook for JS-driven animations. Tracks the pref + (in "system" mode) the OS media query.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => resolveReduced());
  useEffect(() => {
    const update = () => setReduced(resolveReduced());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener?.("change", update);
    } catch {
      /* no matchMedia */
    }
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
      mq?.removeEventListener?.("change", update);
    };
  }, []);
  return reduced;
}
