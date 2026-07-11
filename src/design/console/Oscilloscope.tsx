import type { ArcTone } from "./ArcGauge";
import "./oscilloscope.css";

// Console kit — Oscilloscope (plan 2026-07-10-console-hud-phase3-monitor Task 2; v3 upgrade per
// plan 2026-07-10-monitor-v3-ribbon Task 1). A rolling trace of REAL samples only: a pure render
// of props — the CALLER owns buffering and the poll cadence, this component holds no timer/rAF of
// its own (the idle-canvas law: unchanged data ⇒ zero repaints). Empty buffer ⇒ the honest
// no-signal state on the empty grid, NEVER a flat synthetic line. Tone maps to the same graded
// token inks ArcGauge uses; reduced ⇒ the CSS sweep/glow never animates.
//
// v3 (owner direction 2026-07-10, UI_VISION_BACKLOG §A0): the drawn window always spans the FULL
// grid (the v2 bug scaled x to the fixed cap, so a sub-cap window stopped short); an optional
// frame-budget line; optional exact-moment SPIKE markers — a sample marks only when it is BOTH
// >= 2× the window median AND >= the budget (a fast rig's noise is not a spike), and the worst
// spike gets a measured ms callout in the caption. Markers are geometry at the spike's own x —
// the exact moment — never approximations, never fabricated.

const W = 240;
const H = 64;
const PAD = 6;

// Graph-grid geometry (module-level like ArcGauge's TICKS): 4 rows × 8 columns.
const GRID_X = Array.from({ length: 7 }, (_, i) => ((i + 1) / 8) * W);
const GRID_Y = Array.from({ length: 3 }, (_, i) => ((i + 1) / 4) * H);

/** Exact-moment spike detection (pure, exported for tests): indices of samples that are both
 *  >= 2× the window median and >= the frame budget (when given). */
export function spikeIndices(win: number[], budget?: number): number[] {
  if (win.length === 0) return [];
  const sorted = [...win].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = 2 * median;
  const out: number[] = [];
  win.forEach((v, i) => {
    if (v >= threshold && (budget == null || v >= budget)) out.push(i);
  });
  return out;
}

export function Oscilloscope({
  samples,
  cap = 120,
  label,
  unit,
  tone = "accent",
  reduced,
  budget,
  spikes = false,
  scrub = null,
  sel = null,
  stageProps,
}: {
  /** Already-real values, newest last — the caller buffers from its existing poll. */
  samples: number[];
  /** Rolling window length; the trace draws at most the last `cap` samples. */
  cap?: number;
  label: string;
  unit?: string;
  tone?: ArcTone;
  reduced: boolean;
  /** Frame budget in the samples' own unit (e.g. 1000/refreshHz ms) — draws the budget line. */
  budget?: number;
  /** Mark exact-moment spikes (>= 2× window median AND >= budget) + worst-spike ms callout. */
  spikes?: boolean;
  /** Scrub crosshair at this x-fraction of the drawn window (snaps to the nearest REAL sample);
   *  the CALLER owns the readout — this stays a pure render. */
  scrub?: number | null;
  /** Drag-selection band as x-fractions (order-free) — the caller's zoom-in-progress. */
  sel?: { start: number; end: number } | null;
  /** Escape hatch for interactive callers (the Monitor deck): spread onto the stage div so
   *  pointer math shares the exact drawn geometry. The component itself stays stateless. */
  stageProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const win = samples.length > cap ? samples.slice(-cap) : samples;
  const empty = win.length === 0;

  // Normalize to the window's own span (including the budget line when given, so it always
  // plots inside the grid); a constant window (range 0) draws mid-band — a real flat signal.
  let pts = "";
  let latest: number | null = null;
  let toY: (v: number) => number = () => H / 2;
  let toX: (i: number) => number = () => 1;
  let spikeIdx: number[] = [];
  let worstIdx = -1;
  if (!empty) {
    const max = Math.max(...win, budget ?? -Infinity);
    const min = Math.min(...win, budget ?? Infinity);
    const range = max - min || 1;
    // Full-width law (v3): scale to the DRAWN window, never the cap — the trace always
    // reaches the right edge of the grid.
    const denom = Math.max(1, win.length - 1);
    toX = (i: number) => (i / denom) * (W - 2) + 1;
    toY = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);
    pts = win.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
    latest = win[win.length - 1];
    if (spikes) {
      spikeIdx = spikeIndices(win, budget);
      for (const i of spikeIdx) if (worstIdx < 0 || win[i] > win[worstIdx]) worstIdx = i;
    }
  }

  return (
    <figure
      className={`oscilloscope osc-${tone} ${empty ? "osc-empty" : ""}`}
      data-reduced={reduced ? "true" : undefined}
    >
      <figcaption className="osc-label">
        <span>{label}</span>
        {worstIdx >= 0 && (
          <span className="osc-worst">
            worst spike {Math.round(win[worstIdx])} {unit ?? ""}
          </span>
        )}
        {latest !== null && (
          <span className="osc-read">
            {Math.round(latest)}
            {unit ? ` ${unit}` : ""}
          </span>
        )}
      </figcaption>
      <div className="osc-stage" {...stageProps}>
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
          {!empty && budget != null && (
            <line
              className="osc-budget"
              x1="0"
              y1={toY(budget).toFixed(1)}
              x2={W}
              y2={toY(budget).toFixed(1)}
            />
          )}
          {!empty && <polyline className="osc-trace" points={pts} fill="none" />}
          {!empty && sel != null && (
            <rect
              className="osc-sel"
              x={(Math.min(sel.start, sel.end) * W).toFixed(1)}
              y="0"
              width={(Math.abs(sel.end - sel.start) * W).toFixed(1)}
              height={H}
            />
          )}
          {!empty &&
            scrub != null &&
            (() => {
              const i = Math.round(Math.min(1, Math.max(0, scrub)) * (win.length - 1));
              return (
                <g className="osc-cursor-g">
                  <line className="osc-cursor" x1={toX(i)} y1="0" x2={toX(i)} y2={H} />
                  <circle className="osc-cursor-dot" cx={toX(i)} cy={toY(win[i])} r="2.5" />
                </g>
              );
            })()}
          {spikeIdx.map((i) => (
            <line
              key={`s${i}`}
              className={`osc-spike${i === worstIdx ? " osc-spike-worst" : ""}`}
              x1={toX(i).toFixed(1)}
              y1={toY(win[i]).toFixed(1)}
              x2={toX(i).toFixed(1)}
              y2={H}
            />
          ))}
        </svg>
        {empty && <span className="osc-nosignal">no signal</span>}
      </div>
    </figure>
  );
}

export default Oscilloscope;
