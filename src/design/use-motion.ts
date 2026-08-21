import { useEffect, useState } from "react";

// App-wide motion preference. OWNER DECISION (2026-06-19): Compy's "living instrument" motion is ON
// BY DEFAULT and overrides the OS "reduce motion" setting — with an explicit opt-out for users who
// want it calm. So the default is "full" (ignore the OS); "system" defers to the OS; "reduced" forces
// calm. The resolved state is mirrored onto <html data-motion="full|reduced"> so BOTH JS animations
// (via useReducedMotion) and CSS (via :root[data-motion="reduced"]) read one source of truth.

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
  return "full"; // default: motion on, override the OS
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
  return false; // "full"
}

// Mirror the resolved state onto <html> so CSS keys off it (:root[data-motion="reduced"]).
// data-jarvis rides along since the 2026-08-20 fold (issue #180): the JARVIS layer's separate
// flag is retired — Motion=Full IS the layer on, so its CSS scope derives from the same resolve.
export function applyMotionAttribute(): void {
  try {
    const reduced = resolveReduced();
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
    if (reduced) delete document.documentElement.dataset.jarvis;
    else document.documentElement.dataset.jarvis = "on";
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
