import { useEffect, useState } from "react";

// "Expert view" — a genuine user preference (like Motion), NOT a preview flag. Spec:
// docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md (owner GO 2026-07-12).
// Default OFF: the default face stays the recovering-skeptic's — plain, friendly, curated.
// ON un-hides what Compy already knows for the tinkerer: the refused drawer open with reasoning
// inline, technical names + exact targets on rows, raw measured values + true local percentiles,
// and no visual de-emphasis of the long tail. Presentation-only over existing data — the
// preference gates ZERO mutation paths and never touches the barred-refusal tier.

const KEY = "compy_expert_view";
const EVENT = "compy:expert-view";

export function readExpertView(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage unavailable → the default face
  }
}

export function setExpertView(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* ignore */
  }
}

// Reactive hook — live-updates every mounted surface when the Settings toggle flips
// (same event + storage pattern as use-motion.ts, so no reload is needed).
export function useExpertView(): boolean {
  const [on, setOn] = useState<boolean>(() => readExpertView());
  useEffect(() => {
    const update = () => setOn(readExpertView());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return on;
}
