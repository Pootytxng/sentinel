import { useReducedMotion } from "../use-motion";
import { useCountTo } from "../../surfaces/lab/use-count-to";
import "./arc-gauge.css";

export type ArcTone = "accent" | "warn" | "good" | "neutral";
const R = 20;
const CIRC = 2 * Math.PI * R;
const TICKS = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * 2 * Math.PI - Math.PI / 2;
  return { x1: 28 + Math.cos(a) * 25, y1: 28 + Math.sin(a) * 25, x2: 28 + Math.cos(a) * 27.5, y2: 28 + Math.sin(a) * 27.5 };
});

export function ArcGauge({
  label, value, max, unit, tone = "neutral", measured = true,
}: {
  label: string; value: number | null; max: number; unit: string; tone?: ArcTone; measured?: boolean;
}) {
  const reduced = useReducedMotion();
  const shown = useCountTo(value, { reduced });     // null → null (honesty rail); reduced → snaps
  const empty = shown === null;
  const frac = empty ? 0 : Math.min(1, Math.max(0, shown / max));
  const dashoffset = CIRC * (1 - frac);
  return (
    <div className={`arc-gauge ag-${tone} ${empty ? "ag-empty" : ""}`}>
      <svg viewBox="0 0 56 56" aria-hidden="true">
        {TICKS.map((t, i) => <line key={i} className="ag-tick" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />)}
        <circle className="ag-track" cx="28" cy="28" r={R} />
        {!empty && (
          <circle className="ag-fill" cx="28" cy="28" r={R} transform="rotate(-90 28 28)"
            strokeDasharray={CIRC} strokeDashoffset={dashoffset} />
        )}
      </svg>
      <div className="ag-ctr">
        <div className="ag-v">{empty ? "— —" : Math.round(shown!)}</div>
        <div className="ag-u">{empty ? "no reading" : unit}</div>
      </div>
      <div className="ag-label">
        <span>{label}</span>
        {empty ? <span className="ag-tag ag-tag-ny">not yet</span>
               : measured ? <span className="ag-tag">measured</span> : null}
      </div>
    </div>
  );
}
export default ArcGauge;
