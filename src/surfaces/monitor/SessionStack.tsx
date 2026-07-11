import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionSummary } from "../../types";
import { prettyGameName } from "../game-name";
import { fmtDur } from "../Play";
import {
  stackRowsFrom,
  gameFilterAvailable,
  fmtDeltaGlyph,
  relativeDay,
  type StackRow,
} from "./monitor-stack-profile";

// SessionStack — Monitor v5's sessions half (owner pick 2026-07-11: "A's top + B's stack",
// plan 2026-07-11-monitor-v5-deck-stack, T2). Small multiples, dead flat: every session is one
// row — meta | mini timeline | vs-previous chip — and every row's canvas shares ONE 1%-low fps
// axis (the note under the stack states it once), so a taller line is a better session anywhere
// in the stack. The v3→v4 chain law is structural here: no depth, no perspective, no warping —
// plain idioms earn the intuition.
//
// Honesty contract: rows draw the backend's recorded per-second stutter timelines through the
// honest min-per-bucket downsample (every point a REAL sample); a stripped timeline says
// "timeline not kept", never a fake line. The ONE worst-dip pin per row rides a recorded
// stutter_event at its exact moment, its clock time printed in DOM beside the canvas — never
// text over chart ink (owner catch 2026-07-11). Absent aggregates render em-dash, never 0.
//
// Idle discipline (the v4 lesson): rows repaint only when their content changes — the row
// objects come from one useMemo over [sessions, filter], so a same-reference re-render (the
// parent's 1 Hz poll cycle) reaches no canvas.

function readInk(name: string, fb: string): string {
  if (typeof document === "undefined") return fb;
  const got = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return got || fb;
}

const PAD_Y = 3;

function RowCanvas({ row, axisMax, newest }: { row: StackRow; axisMax: number | null; newest: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 640, h: 40 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom — the DOM carries every readable value
    const { w, h } = size;
    if (w <= 0 || h <= 0) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (row.fracs.length < 2 || axisMax == null) return;

    const ink = newest ? readInk("--ix-accent", "#b366ff") : readInk("--ix-text-3", "#8a93a6");
    const warn = readInk("--v2-warn", "#f5c542");
    const grid = readInk("--ix-glass-border", "rgba(160,170,190,0.3)");
    const baseY = h - 1;
    const plotH = h - PAD_Y * 2;
    const px = (xf: number) => 1 + xf * (w - 2);
    const py = (yf: number) => baseY - yf * plotH;

    // Identical tick lines on every row — same fractions of the SAME shared axis.
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.moveTo(0, py(f));
      ctx.lineTo(w, py(f));
      ctx.stroke();
    }

    // The trace + a quiet area fill (newest rides the accent, older rows muted).
    ctx.globalAlpha = newest ? 1 : 0.7;
    ctx.strokeStyle = ink;
    ctx.lineWidth = newest ? 1.5 : 1;
    ctx.beginPath();
    row.fracs.forEach((p, i) => {
      const x = px(p.x);
      const y = py(p.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = newest ? 0.12 : 0.06;
    ctx.fillStyle = ink;
    ctx.lineTo(px(row.fracs[row.fracs.length - 1].x), baseY);
    ctx.lineTo(px(row.fracs[0].x), baseY);
    ctx.closePath();
    ctx.fill();

    // The ONE worst-dip pin — a recorded moment, at its exact x.
    if (row.pin) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = warn;
      ctx.fillStyle = warn;
      ctx.lineWidth = 1;
      const x = px(row.pin.x);
      ctx.beginPath();
      ctx.moveTo(x, py(row.pin.y));
      ctx.lineTo(x, baseY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, py(row.pin.y), 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [row, axisMax, newest, size]);

  return (
    <span className="ss-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="ss-canvas" aria-hidden="true" />
      {(row.fracs.length < 2 || axisMax == null) && (
        <span className="ss-notimeline">timeline not kept</span>
      )}
      {row.pin && (
        <span
          className="ss-pin-label"
          style={{ "--pin-x": `${(row.pin.x * 100).toFixed(1)}%` } as React.CSSProperties}
        >
          ▼ {row.pin.clock}
        </span>
      )}
    </span>
  );
}

const fmtV = (v: number) => (Number.isFinite(v) ? String(Math.round(v)) : "—");

export function SessionStack({
  sessions = [],
  reduced,
}: {
  /** Newest-first session history — the same array the Sessions face lists. */
  sessions?: SessionSummary[];
  reduced: boolean;
}) {
  const [gameOnly, setGameOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const currentGame = sessions[0]?.process_name || null;
  const filterAvail = useMemo(() => gameFilterAvailable(sessions), [sessions]);
  const model = useMemo(
    () => stackRowsFrom(sessions, gameOnly && filterAvail ? currentGame : null),
    [sessions, gameOnly, filterAvail, currentGame],
  );

  if (sessions.length === 0) {
    return <p className="ss-empty">no sessions on record yet — play with capture on</p>;
  }

  const detailLine = (row: StackRow) => {
    const s = row.session;
    const parts = [
      `${fmtV(s.avg_fps)} AVG`,
      `${fmtV(s.low1_fps_est)} 1% LOW`,
      `${row.dipCount} ${row.dipCount === 1 ? "SPIKE" : "SPIKES"}`,
    ];
    if (row.pin) parts.push(`worst dip ${row.pin.clock} — ${row.pin.label}`.trim());
    if (s.compy_changes_active > 0) {
      parts.push(
        `${s.compy_changes_active} ${s.compy_changes_active === 1 ? "COMPY CHANGE" : "COMPY CHANGES"} ON`,
      );
    }
    return parts.join(" · ");
  };

  return (
    <div className="ss" data-motion={reduced ? "reduced" : "full"}>
      {filterAvail && currentGame && (
        <div className="ss-filter" role="group" aria-label="Game filter">
          <button
            type="button"
            className={`ss-filter-btn ${!gameOnly ? "ss-filter-on" : ""}`}
            aria-pressed={!gameOnly}
            onClick={() => setGameOnly(false)}
          >
            All games
          </button>
          <button
            type="button"
            className={`ss-filter-btn ${gameOnly ? "ss-filter-on" : ""}`}
            aria-pressed={gameOnly}
            onClick={() => setGameOnly(true)}
          >
            {prettyGameName(currentGame) || "unknown game"} only
          </button>
        </div>
      )}

      <ol className="ss-rows">
        {model.rows.map((row, i) => {
          const key = `${row.session.started_at}-${i}`;
          const open = expanded === key;
          const s = row.session;
          return (
            <li key={key} className="ss-item">
              <button
                type="button"
                className={`ss-row ${i === 0 ? "ss-row-newest" : ""}`}
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : key)}
              >
                <span className="ss-meta">
                  {[
                    prettyGameName(s.process_name) || "unknown game",
                    relativeDay(s.started_at, now),
                    fmtDur(s.duration_secs),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <RowCanvas row={row} axisMax={model.axisMax} newest={i === 0} />
                {row.delta && (
                  <span className="ss-chip">
                    VS PREVIOUS {fmtDeltaGlyph(row.delta.avgFps)} AVG
                    {!row.delta.sameGame && " · DIFFERENT GAME"}
                  </span>
                )}
              </button>
              {open && <p className="ss-detail">{detailLine(row)}</p>}
            </li>
          );
        })}
      </ol>

      {model.axisMax != null && (
        <p className="ss-axisnote">
          one axis for every row · 0–{Math.round(model.axisMax)} 1% low fps — a taller line is a
          better session
        </p>
      )}
    </div>
  );
}

export default SessionStack;
