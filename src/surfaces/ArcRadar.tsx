import { useEffect, useState } from "react";

// M2 radar (arc-redress spec §2). DATA-BEARING + honest: one blip per REAL readiness check, colored
// by its real verdict (accent = fine, amber = worth fixing, muted = unknown), revealed in lockstep
// with the streaming rows (shownCount). The sweep is the scan-in-progress indicator — it animates
// only while scanning and only when motion is allowed; under prefers-reduced-motion it's a static
// end-state with all revealed blips placed. Blip POSITION is deterministic layout (a stable spiral),
// never an invented metric — only count + color carry meaning.

export type RadarBlip = { id: string; verdict: "ok" | "fix" | "unknown" };

const C = 100; // center
const R = 92; // outer radius

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

// Stable spiral layout (golden angle) so blip positions are deterministic + spread, never random.
function blipPos(i: number): { x: number; y: number } {
  const a = i * 2.399963; // golden angle (radians)
  const r = 28 + ((i * 0.61803) % 1) * (R - 36);
  return { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r };
}

// A ~34° sweep wedge from straight up.
const A0 = -Math.PI / 2;
const A1 = A0 + (34 * Math.PI) / 180;
const WEDGE = `M${C} ${C} L${(C + R * Math.cos(A0)).toFixed(1)} ${(C + R * Math.sin(A0)).toFixed(1)} A${R} ${R} 0 0 1 ${(C + R * Math.cos(A1)).toFixed(1)} ${(C + R * Math.sin(A1)).toFixed(1)} Z`;

export function ArcRadar({
  blips,
  shownCount,
  scanning,
}: {
  blips: RadarBlip[];
  shownCount: number;
  scanning: boolean;
}) {
  const reduced = useReducedMotion();
  const sweepOn = scanning && !reduced;
  return (
    <div className="fc-radar" aria-hidden="true">
      <svg viewBox="0 0 200 200" className="fc-radar-svg">
        {[30, 56, 82].map((r) => (
          <circle key={r} cx={C} cy={C} r={r} className="fc-radar-ring" />
        ))}
        <line x1={C} y1="10" x2={C} y2="190" className="fc-radar-cross" />
        <line x1="10" y1={C} x2="190" y2={C} className="fc-radar-cross" />
        <g className={`fc-radar-sweep ${sweepOn ? "fc-radar-sweep-on" : ""}`}>
          <path d={WEDGE} className="fc-radar-wedge" />
        </g>
        {blips.slice(0, shownCount).map((b, i) => {
          const p = blipPos(i);
          return (
            <circle
              key={b.id}
              cx={p.x}
              cy={p.y}
              r="3.4"
              className={`fc-radar-blip fc-radar-blip-${b.verdict}`}
            />
          );
        })}
      </svg>
    </div>
  );
}
