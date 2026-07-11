import type { ArcTone } from "./ArcGauge";
import "./oscilloscope.css";

// Console kit — Oscilloscope (plan 2026-07-10-console-hud-phase3-monitor, Task 2). A rolling
// trace of REAL samples only: a pure render of props — the CALLER owns buffering and the poll
// cadence, this component holds no timer/rAF of its own (the idle-canvas law: unchanged data ⇒
// zero repaints). Empty buffer ⇒ the honest no-signal state on the empty grid, NEVER a flat
// synthetic line. Tone maps to the same graded token inks ArcGauge uses; reduced ⇒ the CSS
// sweep/glow never animates (a still polyline, still updated at poll cadence).

const W = 240;
const H = 64;
const PAD = 6;

// Graph-grid geometry (module-level like ArcGauge's TICKS): 4 rows × 8 columns.
const GRID_X = Array.from({ length: 7 }, (_, i) => ((i + 1) / 8) * W);
const GRID_Y = Array.from({ length: 3 }, (_, i) => ((i + 1) / 4) * H);

export function Oscilloscope({
  samples,
  cap = 120,
  label,
  unit,
  tone = "accent",
  reduced,
}: {
  /** Already-real values, newest last — the caller buffers from its existing poll. */
  samples: number[];
  /** Rolling window length; the trace draws at most the last `cap` samples. */
  cap?: number;
  label: string;
  unit?: string;
  tone?: ArcTone;
  reduced: boolean;
}) {
  const win = samples.length > cap ? samples.slice(-cap) : samples;
  const empty = win.length === 0;

  let pts = "";
  let latest: number | null = null;
  if (!empty) {
    // Normalize to the window's own span so the trace fills the instrument; a constant
    // window (range 0) draws mid-band — a real flat signal, not a synthetic one.
    const max = Math.max(...win);
    const min = Math.min(...win);
    const range = max - min || 1;
    const denom = Math.max(1, cap - 1);
    pts = win
      .map((v, i) => {
        const x = (i / denom) * (W - 2) + 1;
        const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    latest = win[win.length - 1];
  }

  return (
    <figure
      className={`oscilloscope osc-${tone} ${empty ? "osc-empty" : ""}`}
      data-reduced={reduced ? "true" : undefined}
    >
      <figcaption className="osc-label">
        <span>{label}</span>
        {latest !== null && (
          <span className="osc-read">
            {Math.round(latest)}
            {unit ? ` ${unit}` : ""}
          </span>
        )}
      </figcaption>
      <div className="osc-stage">
        <svg
          className="osc-grid"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {GRID_X.map((x) => (
            <line key={`x${x}`} className="osc-gridline" x1={x} y1="0" x2={x} y2={H} />
          ))}
          {GRID_Y.map((y) => (
            <line key={`y${y}`} className="osc-gridline" x1="0" y1={y} x2={W} y2={y} />
          ))}
          {!empty && <polyline className="osc-trace" points={pts} fill="none" />}
        </svg>
        {empty && <span className="osc-nosignal">no signal</span>}
      </div>
    </figure>
  );
}

export default Oscilloscope;
