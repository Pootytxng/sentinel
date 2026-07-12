import { useEffect, useState } from "react";
import { readJarvisMotion } from "../theme";
import { useReducedMotion } from "../use-motion";

// JARVIS motion layer — the one gate every JS effect in the layer mounts through.
// Two stacked conditions, both reactive to mid-session flips:
//   • the flag (compy_jarvis_motion, DEFAULT ON — Settings → Appearance; "0" = static failsafe), and
//   • the app's RESOLVED motion preference (useReducedMotion — Compy's own pref, which
//     overrides the OS per [[motion-on-by-default-override-os]]; reduced always wins).
// Flag off OR reduced ⇒ false ⇒ nothing in the layer mounts and the DOM is byte-identical.

export function useJarvisFlag(): boolean {
  const [on, setOn] = useState<boolean>(() => readJarvisMotion());
  useEffect(() => {
    const update = () => setOn(readJarvisMotion());
    window.addEventListener("compy:jarvis-changed", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("compy:jarvis-changed", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return on;
}

export function useJarvisActive(): boolean {
  const reduced = useReducedMotion();
  const flag = useJarvisFlag();
  return flag && !reduced;
}
