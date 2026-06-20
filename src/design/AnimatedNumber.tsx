import { useEffect, useRef, useState } from "react";
import { resolveReduced } from "./use-motion";

// Ease-out cubic — fast start, gentle settle. Pure (unit-tested).
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

// Lively count-up / value tween for headline telemetry — the numbers feel alive instead of snapping.
// Animates from the currently-displayed value to the target over `durMs` (ease-out) via rAF, and
// re-targets smoothly when the value changes, so live 1 Hz readings GLIDE rather than jump. Honors
// prefers-reduced-motion (jumps straight to the value — no animation). Pure presentational: wrap a
// number; `format` controls rounding/decimals. Reserved keyframe space untouched (no shimmer/sheen).
export function AnimatedNumber({
  value,
  durMs = 650,
  format = (v: number) => String(Math.round(v)),
}: {
  value: number;
  durMs?: number;
  format?: (v: number) => string;
}) {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Respects the app-wide Motion preference (overrides the OS by default).
    const reduce = resolveReduced();
    const from = displayRef.current;
    const to = value;
    if (reduce || from === to || typeof requestAnimationFrame === "undefined") {
      displayRef.current = to;
      setDisplay(to);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const eased = easeOutCubic((now - start) / durMs);
      const cur = from + (to - from) * eased;
      displayRef.current = cur;
      setDisplay(cur);
      if (eased < 1) rafRef.current = requestAnimationFrame(step);
      else displayRef.current = to;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durMs]);

  return <>{format(display)}</>;
}
