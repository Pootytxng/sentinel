import { useEffect, useMemo, useState } from "react";
import { Oscilloscope, spikeIndices } from "../../design/console/Oscilloscope";
import type { ArcTone } from "../../design/console/ArcGauge";
import { zoomWindow, type ZoomSel } from "./monitor-stack-profile";

// DeckScope — the Flight Deck's hero (plan 2026-07-11-monitor-v5-deck-stack, T3). The SAME
// Oscilloscope frametime scope MonitorConsole always drew, full-width, wearing the deleted
// waterfall's front-trace interactions: hover scrub (frame → ms → fps chip, SPIKE flagged by
// the same detector the markers use) and drag-zoom (misclick guard, nested composition,
// double-click / Reset zoom). Flat by chain law — the scope IS the face's depth, an axis, not
// perspective. Honesty: every scrubbed value is a REAL backend frame sample; the drawn window's
// true ms span and the rig's frame budget print as plain numbers; capture stop clears the zoom
// with the window (never a stale slice posing as live). Zero new IPC — the caller's existing
// content-stable ftWin is the only input.

const EMPTY: number[] = [];

export function DeckScope({
  ftWin,
  live,
  budget,
  tone = "accent",
  reduced,
  cap = 240,
}: {
  /** The backend's real per-frame window (content-stable reference — the caller's idle guard). */
  ftWin: number[];
  /** Capture running AND a sample present — false clears the scope AND the zoom. */
  live: boolean;
  /** Frame budget in ms (1000/refreshHz) — the dashed line + the spike detector's floor. */
  budget?: number;
  tone?: ArcTone;
  reduced: boolean;
  /** The backend window cap (MAX_FRAMETIME_POINTS) — passed through to the scope. */
  cap?: number;
}) {
  const [zoom, setZoom] = useState<ZoomSel | null>(null);
  const [drag, setDrag] = useState<ZoomSel | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // Capture stopped ⇒ the zoom dies with the window it selected (never frozen-as-live).
  useEffect(() => {
    if (!live) {
      setZoom(null);
      setDrag(null);
      setHover(null);
    }
  }, [live]);

  const base = live ? ftWin : EMPTY;
  const win = useMemo(() => zoomWindow(base, zoom), [base, zoom]);
  const drawable = win.length >= 2;

  // Exact-sample scrub readout: the REAL frame under the crosshair.
  let scrubText: string | null = null;
  if (drawable && hover != null && !drag) {
    const i = Math.round(hover * (win.length - 1));
    const ms = win[i];
    if (typeof ms === "number" && ms > 0) {
      const spike = spikeIndices(win, budget).includes(i);
      scrubText = `frame ${i + 1} · ${ms.toFixed(1)} ms · ${Math.round(1000 / ms)} fps${
        spike ? " · SPIKE" : ""
      }`;
    }
  }

  const span = drawable ? { min: Math.min(...win), max: Math.max(...win) } : null;

  const fracAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return 0;
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const stageProps: React.HTMLAttributes<HTMLDivElement> | undefined = drawable
    ? {
        onPointerDown: (e) => {
          const f = fracAt(e);
          setDrag({ start: f, end: f });
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        },
        onPointerMove: (e) => {
          const f = fracAt(e);
          if (drag) setDrag({ start: drag.start, end: f });
          else setHover(f);
        },
        onPointerUp: () => {
          if (!drag) return;
          const a = Math.min(drag.start, drag.end);
          const b = Math.max(drag.start, drag.end);
          if (b - a > 0.02) {
            // Compose into absolute window fractions so zooming inside a zoom nests correctly.
            const z = zoom ?? { start: 0, end: 1 };
            const s = z.end - z.start;
            setZoom({ start: z.start + a * s, end: z.start + b * s });
          }
          setDrag(null);
        },
        onPointerLeave: () => {
          setHover(null);
          setDrag(null);
        },
        onDoubleClick: () => setZoom(null),
      }
    : undefined;

  return (
    <div className="deck-scope" data-zoomed={zoom ? "true" : undefined}>
      <Oscilloscope
        samples={win}
        cap={cap}
        label="frametime"
        unit="ms"
        tone={tone}
        reduced={reduced}
        budget={budget}
        spikes
        envelope
        scrub={!drag ? hover : null}
        sel={drag}
        stageProps={stageProps}
      />
      <div className="deck-bar">
        {scrubText ? (
          <span className="deck-scrub">{scrubText}</span>
        ) : drawable ? (
          <span className="deck-hint">drag to zoom · double-click to reset</span>
        ) : null}
        {zoom && (
          <button type="button" className="deck-zoomreset" onClick={() => setZoom(null)}>
            Reset zoom
          </button>
        )}
        {span && (
          <span className="deck-axis">
            {span.min.toFixed(1)}–{span.max.toFixed(1)} ms window
            {budget != null && ` · budget ${budget.toFixed(1)} ms`}
          </span>
        )}
      </div>
    </div>
  );
}

export default DeckScope;
