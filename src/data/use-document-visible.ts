import { useEffect, useState } from "react";

// Tiny shared hook: is THIS window's document currently visible (not minimized/occluded/backgrounded)?
// Used to pause main-window work — the orbiting 3D rig render loop and the live sensor charts — when
// the user can't see it, so Compy isn't burning CPU/GPU on hidden animation/polling. Universally safe
// for main-window surfaces: worst case the work pauses while hidden and resumes on focus, with no
// data-blanking risk. NOT for the in-game overlay HUD (a wrong "hidden" read there could blank the HUD
// over a fullscreen game — that surface must gate on its explicit show/hide signal instead).
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}
