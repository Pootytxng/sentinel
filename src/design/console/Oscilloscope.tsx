import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ArcTone } from "./ArcGauge";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../../i18n";
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

// Zero-anchored scale (owner direction 2026-07-11, after rejecting an envelope/median attempt:
// "go do some research on some clean and comprehensive looking frametime graphs or just match
// riva tuners"). RTSS and CapFrameX draw frametimes against a STABLE ms scale anchored at 0
// (RTSS "graph max"; CapFrameX fixed y-axis range) — a smooth game is a calm, near-flat line
// low on the chart and a real spike towers against it. Window-min/max normalization (the old
// default, still used for fps) was the "erratic" root cause: it stretched a few ms of ordinary
// jitter to the full chart height. The line stays RAW per-frame — accuracy untouched; only the
// y mapping changes. Nice caps step through frame-budget landmarks so the scale doesn't jitter
// frame-to-frame.
const NICE_CAPS = [8.3, 16.7, 25, 33.3, 50, 100, 250];

/** Smallest stable "nice" ms cap that contains the window's max (and the budget line). */
export function niceCap(needed: number): number {
  for (const c of NICE_CAPS) if (needed <= c) return c;
  return Math.ceil(needed / 100) * 100;
}

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
  scale = "window",
  scrub = null,
  sel = null,
  span = null,
  stageProps,
  emptyHint,
}: {
  /** Already-real values, newest last — the caller buffers from its existing poll. */
  samples: number[];
  /** Rolling window length; the trace draws at most the last `cap` samples. */
  cap?: number;
  /** Trace label — a string, or a ReactNode so a caller can wrap jargon in an inline <Term>
   *  gloss (the DeckScope hero glosses "frametime", matching the Play/Deep-Monitoring faces). */
  label: ReactNode;
  unit?: string;
  tone?: ArcTone;
  reduced: boolean;
  /** Frame budget in the samples' own unit (e.g. 1000/refreshHz ms) — draws the budget line. */
  budget?: number;
  /** Mark exact-moment spikes (>= 2× window median AND >= budget) + worst-spike ms callout. */
  spikes?: boolean;
  /** y mapping: "window" normalizes to the window's own min–max (fps-style relative trace);
   *  "zero" anchors at 0 with a stable niceCap ms scale + labeled gridlines — the RTSS/
   *  CapFrameX frametime convention (smooth = flat and low, spikes tower). */
  scale?: "window" | "zero";
  /** Scrub crosshair at this x-fraction of the drawn window (snaps to the nearest REAL sample);
   *  the CALLER owns the readout — this stays a pure render. */
  scrub?: number | null;
  /** Drag-selection band as x-fractions (order-free) — the caller's zoom-in-progress. */
  sel?: { start: number; end: number } | null;
  /** The plotted window's time range, drawn under the plot as "<start> … <end>" — the
   *  approved Live comp captions its trace "13m ago" / "now". The CALLER owns both strings
   *  because only it knows what one sample means (Live polls at 1 Hz; the deck buffers
   *  frametimes), and because an instrument that guessed a duration would be fabricating one.
   *  Omitted, or with an empty window, nothing is drawn — no window, no time range. */
  span?: { start: ReactNode; end: ReactNode } | null;
  /** Escape hatch for interactive callers (the Monitor deck): spread onto the stage div so
   *  pointer math shares the exact drawn geometry. The component itself stays stateless. */
  stageProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Plain one-liner rendered UNDER "no signal" while the window is empty — the caller says what
   *  the next press is ("Press Start capture, then play — the line draws here."). The bare
   *  "NO SIGNAL" read as a fault to a first-time user (intimidation pass 2026-08-20). Omit it and
   *  the empty state is unchanged. */
  emptyHint?: ReactNode;
}) {
  const { t } = useTranslation();
  const win = samples.length > cap ? samples.slice(-cap) : samples;
  const empty = win.length === 0;

  // y mapping. "window": normalize to the window's own span (including the budget line, so it
  // always plots inside the grid); a constant window (range 0) draws mid-band — a real flat
  // signal. "zero": anchor at 0 with a stable niceCap — the RTSS/CapFrameX frametime look.
  let pts = "";
  let latest: number | null = null;
  let toY: (v: number) => number = () => H / 2;
  let toX: (i: number) => number = () => 1;
  let spikeIdx: number[] = [];
  let worstIdx = -1;
  let msCap: number | null = null; // the zero-scale ms ceiling (stated by the caller's axis line)
  let yTicks: number[] = [];
  if (!empty) {
    const zero = scale === "zero";
    const hi = Math.max(...win, budget ?? -Infinity);
    const min = zero ? 0 : Math.min(...win, budget ?? Infinity);
    if (zero) msCap = niceCap(hi);
    const range = (zero ? (msCap as number) : hi - min) || 1;
    // Full-width law (v3): scale to the DRAWN window, never the cap — the trace always
    // reaches the right edge of the grid.
    const denom = Math.max(1, win.length - 1);
    toX = (i: number) => (i / denom) * (W - 2) + 1;
    toY = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);
    pts = win.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
    latest = win[win.length - 1];
    // Value-anchored gridlines at quarter-cap steps, labeled in ms — the "comprehensive"
    // half of the convention (a real axis, not decoration).
    // 0 included (2026-08-23, comp fidelity): the approved Live trace labels 0 / 80 / 160 / 240,
    // and the baseline is the one tick that tells the reader the axis is anchored rather than
    // auto-ranged. Without it a calm trace and a collapsed one look alike.
    // THIRDS, SO THE TOP TICK IS THE CAP. Quarters left the ceiling unlabelled, which is the
    // one number a reader needs to judge everything else on the plot: without it a trace at
    // 60% of the box means nothing until you work out what the box holds. The approved trace
    // reads 0 / 80 / 160 / 240 against a 240 ceiling — four evenly spaced ticks, top included.
    if (zero) yTicks = [0, 1, 2, 3].map((q) => (q / 3) * (msCap as number));
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
            {t("common.oscilloscope.worstSpike", { value: Math.round(win[worstIdx]), unit: unit ?? "" })}
          </span>
        )}
        {latest !== null && (
          <span className="osc-read">
            {Math.round(latest)}
            {unit ? ` ${unit}` : ""}
          </span>
        )}
      </figcaption>
      {/* THE AXIS GUTTER (comp fidelity 2026-08-23). The approved trace puts its tick values
          OUTSIDE the plot, left of a vertical baseline rule, not floated over the signal. So the
          labels moved into a sibling column and `.osc-stage` kept its exact box — the deck's
          scrub/drag pointer math reads that box, and moving the labels must not move the math. */}
      <div className="osc-plot">
        {yTicks.length > 0 && (
          <div className="osc-axis" aria-hidden="true">
            {yTicks.map((v) => (
              <span
                key={`yl${v}`}
                className="osc-ylab"
                style={{ top: `${((toY(v) / H) * 100).toFixed(1)}%` }}
              >
                {v === 0 ? "0" : v.toFixed(v < 10 ? 1 : 0)}
              </span>
            ))}
          </div>
        )}
      <div className="osc-stage" {...stageProps}>
        <svg
          className="osc-grid"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Column rules belong to the UNLABELLED window scale only. Once the axis gutter is
              drawn, the horizontal ticks carry the meaning and a grid of verticals divides the
              time axis into eighths that stand for nothing — the approved comp draws none. */}
          {msCap == null &&
            GRID_X.map((x) => (
              <line key={`x${x}`} className="osc-gridline" x1={x} y1="0" x2={x} y2={H} />
            ))}
          {msCap == null &&
            GRID_Y.map((y) => (
              <line key={`y${y}`} className="osc-gridline" x1="0" y1={y} x2={W} y2={y} />
            ))}
          {yTicks.map((v) => (
            <line
              key={`t${v}`}
              className="osc-gridline osc-tickline"
              x1="0"
              y1={toY(v).toFixed(1)}
              x2={W}
              y2={toY(v).toFixed(1)}
            />
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
        {empty && (
          <span className="osc-nosignal">
            <span className="osc-nosignal-k">{t("common.oscilloscope.noSignal")}</span>
            {emptyHint != null && <span className="osc-nosignal-hint">{emptyHint}</span>}
          </span>
        )}
      </div>
        {span && !empty && (
          <div className="osc-span" aria-hidden="true">
            <span>{span.start}</span>
            <span>{span.end}</span>
          </div>
        )}
      </div>
    </figure>
  );
}

export default Oscilloscope;
