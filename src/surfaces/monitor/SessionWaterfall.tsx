import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionSummary } from "../../types";
import { prettyGameName } from "../game-name";
import { fmtDur } from "../Play";
import {
  AXIS_UNIT,
  type WaterfallMode,
  type ZoomSel,
  zoomWindow,
  pushSnapshot,
  snapshotIntervalMs,
  liveScene,
  sessionLayers,
  sessionsScene,
  sessionDelta,
  fmtDelta,
  comparablePrev,
  sameGameAvailable,
  filterSameGame,
  relativeDay,
  type LayerGeom,
} from "./waterfall-profile";

// SessionWaterfall — Monitor v4's hero (owner-picked concept B + A's drag-segment, plan
// 2026-07-10-monitor-v4-session-waterfall). One waterfall, two modes, units NEVER mixed in a
// scene: LIVE recedes the real capture stream on a ms axis; SESSIONS stacks the last games'
// real stutter timelines on a 1%-low fps axis — the previous-session comparison is the
// feature, not garnish. The v3 root lesson is structural here: 3D is ONLY presentational
// depth offsets BEHIND a flat, axis-anchored front trace — nothing readable is ever warped,
// and the mouse tilt moves depth offsets only, never the front layer's y values.
//
// Rendering is 2D canvas, deliberately NOT r3f: redraws happen only when the data, zoom,
// pointer, or mode actually changes (the draw effect keys on references — the parent's
// content-stable ftWin ref is the idle guard, the v3 bug→guard class). jsdom-safe: a null
// 2D context skips painting; every readable value also lives in the DOM.
//
// Honesty contract: every layer is a REAL measured series. LIVE depth layers are earlier
// snapshots of the SAME capture (buffered client-side, cleared the moment capture stops —
// never frozen-as-live); SESSIONS layers are the backend's recorded per-second timelines,
// stripped sessions simply don't appear. Absent aggregates ⇒ em-dash, never a fabricated 0.

const SCALE_STEP = 0.06; // each depth step narrows the layer
const LIFT = 20; // px each depth step rises
const PAD_X = 16;
const BOTTOM = 26;
const TILT_MAX_PX = 12; // per depth step, at full tilt

type Transform = { scale: number; cx: number; baseY: number; plotH: number };

function transformFor(d: number, w: number, h: number, tilt: number, depthCount: number): Transform {
  const frontY = h - BOTTOM;
  return {
    scale: 1 - d * SCALE_STEP,
    cx: w / 2 + tilt * d * TILT_MAX_PX,
    baseY: frontY - d * LIFT,
    plotH: Math.max(40, frontY - depthCount * LIFT - 18),
  };
}
const px = (t: Transform, w: number, xFrac: number) => t.cx + (xFrac - 0.5) * (w - PAD_X * 2) * t.scale;
const py = (t: Transform, yFrac: number) => t.baseY - yFrac * t.plotH * t.scale;

function readInk(name: string, fb: string): string {
  if (typeof document === "undefined") return fb;
  const got = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return got || fb;
}

export function SessionWaterfall({
  ftWin,
  live,
  budget,
  sessions = [],
  reduced,
}: {
  /** The backend's real per-frame window (content-stable reference — the parent's idle guard). */
  ftWin: number[];
  /** Capture running AND a sample present — false clears every live layer (never frozen-as-live). */
  live: boolean;
  /** Frame budget in ms (1000/refreshHz) — the dashed line + the spike detector's floor. */
  budget?: number;
  /** Newest-first session history (the same array the Sessions face lists). */
  sessions?: SessionSummary[];
  reduced: boolean;
}) {
  const [mode, setMode] = useState<WaterfallMode>("live");
  const userChose = useRef(false);
  const [sameGameOnly, setSameGameOnly] = useState(false);
  const [zoom, setZoom] = useState<ZoomSel | null>(null);
  const [drag, setDrag] = useState<ZoomSel | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null); // x fraction on the front trace
  const [hoverLayer, setHoverLayer] = useState<number | null>(null); // SESSIONS layer index
  const [tilt, setTilt] = useState(0);
  const [snaps, setSnaps] = useState<number[][]>([]);
  const [size, setSize] = useState({ w: 640, h: 280 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastPush = useRef<number | null>(null);

  // Park on the mode that has something real to show until the user picks one themselves.
  const anyLayers = useMemo(() => sessionLayers(sessions).length, [sessions]);
  useEffect(() => {
    if (userChose.current) return;
    if (live) setMode("live");
    else if (anyLayers > 0) setMode("sessions");
  }, [live, anyLayers]);
  const choose = (m: WaterfallMode) => {
    userChose.current = true;
    setMode(m);
  };

  // LIVE depth buffer: every ~window-span the current front window pushes back one step.
  // Same measured stream, no synthesis; capture stop clears everything (the v2 contract).
  useEffect(() => {
    if (!live || ftWin.length < 2) {
      setSnaps([]);
      setZoom(null);
      setDrag(null);
      lastPush.current = null;
      return;
    }
    const now = performance.now();
    if (lastPush.current == null) {
      lastPush.current = now;
      return;
    }
    if (now - lastPush.current >= snapshotIntervalMs(ftWin)) {
      setSnaps((s) => pushSnapshot(s, ftWin));
      lastPush.current = now;
    }
  }, [live, ftWin]);

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

  // ── Scenes (pure math; references only change when the DATA changes) ────────────────────
  const baseLayers = useMemo(() => sessionLayers(sessions), [sessions]);
  const layers = useMemo(
    () => (sameGameOnly ? filterSameGame(baseLayers) : baseLayers),
    [baseLayers, sameGameOnly],
  );
  const sScene = useMemo(() => sessionsScene(layers), [layers]);
  const zoomed = useMemo(() => zoomWindow(ftWin, zoom), [ftWin, zoom]);
  const lScene = useMemo(
    () => (live ? liveScene(zoomed, snaps, budget) : null),
    [live, zoomed, snaps, budget],
  );

  const scene = mode === "live" ? lScene : sScene;
  // Back-to-front draw order: [deepest … front]; front is always LAST (drawn on top, flat).
  const orderedGeoms: LayerGeom[] = useMemo(() => {
    if (mode === "live") {
      if (!lScene) return [];
      return [...lScene.layers.slice().reverse(), lScene.front];
    }
    if (!sScene) return [];
    return sScene.layers.slice().reverse();
  }, [mode, lScene, sScene]);

  // ── The draw (2D canvas, token inks only) ────────────────────────────────────────────────
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
    if (orderedGeoms.length === 0) return;

    const accent = readInk("--ix-accent", "#b366ff");
    const warn = readInk("--v2-warn", "#f5c542");
    const grid = readInk("--ix-glass-border", "rgba(160,170,190,0.3)");
    const depthCount = orderedGeoms.length - 1;
    const effTilt = reduced ? 0 : tilt;

    orderedGeoms.forEach((g, oi) => {
      const d = depthCount - oi; // depth: front = 0
      const isFront = d === 0;
      const hovered =
        mode === "sessions" && hoverLayer != null && sScene
          ? sScene.layers[hoverLayer] === (g as (typeof sScene.layers)[number])
          : false;
      const t = transformFor(d, w, h, isFront ? 0 : effTilt, depthCount);
      const alpha = isFront ? 1 : hovered ? 1 : Math.max(0.16, 0.5 - d * 0.07);

      // Baseline
      ctx.globalAlpha = isFront ? 0.5 : alpha * 0.5;
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px(t, w, 0), t.baseY);
      ctx.lineTo(px(t, w, 1), t.baseY);
      ctx.stroke();

      // Area fill + trace
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = accent;
      ctx.lineWidth = isFront ? 1.6 : 1;
      ctx.beginPath();
      g.fracs.forEach((p, i) => {
        const x = px(t, w, p.x);
        const y = py(t, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (isFront || hovered) {
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = accent;
        ctx.lineTo(px(t, w, 1), t.baseY);
        ctx.lineTo(px(t, w, 0), t.baseY);
        ctx.closePath();
        ctx.fill();
      }

      // Exact-moment pins (spikes in LIVE, dips in SESSIONS) — persist on receding layers.
      ctx.globalAlpha = Math.min(1, alpha + 0.2);
      ctx.strokeStyle = warn;
      ctx.fillStyle = warn;
      ctx.lineWidth = 1;
      for (const pin of g.pins) {
        const x = px(t, w, pin.x);
        const y = py(t, pin.y);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, t.baseY);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, isFront ? 2.5 : 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Front-only chrome: the dashed budget line + drag selection + scrub crosshair.
      if (isFront && mode === "live" && lScene) {
        if (lScene.budgetFrac != null) {
          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = warn;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(px(t, w, 0), py(t, lScene.budgetFrac));
          ctx.lineTo(px(t, w, 1), py(t, lScene.budgetFrac));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (drag) {
          const a = Math.min(drag.start, drag.end);
          const b = Math.max(drag.start, drag.end);
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = accent;
          ctx.fillRect(px(t, w, a), t.baseY - t.plotH, (b - a) * (w - PAD_X * 2) * t.scale, t.plotH);
        }
        if (hoverX != null && !drag) {
          const win = zoomed;
          const i = Math.round(hoverX * (win.length - 1));
          const x = px(t, w, i / Math.max(1, win.length - 1));
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = grid;
          ctx.beginPath();
          ctx.moveTo(x, t.baseY - t.plotH);
          ctx.lineTo(x, t.baseY);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(x, py(t, lScene.front.fracs[i]?.y ?? 0), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    ctx.globalAlpha = 1;
  }, [orderedGeoms, mode, lScene, sScene, zoomed, drag, hoverX, hoverLayer, tilt, reduced, size]);

  // ── Pointer layer: scrub · drag-zoom · tilt (depth offsets ONLY, reduced ⇒ none) ─────────
  const fracAt = useCallback((e: { clientX: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const r = canvas.getBoundingClientRect();
    if (r.width <= 0) return 0;
    const t = transformFor(0, r.width, r.height, 0, 0);
    const inner = (e.clientX - r.left - (t.cx - (r.width - PAD_X * 2) / 2)) / (r.width - PAD_X * 2);
    return Math.min(1, Math.max(0, inner));
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "live" || !lScene) return;
    const f = fracAt(e);
    setDrag({ start: f, end: f });
    canvasRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Nothing drawn ⇒ a bare pointer move must not repaint (self-review round-1 catch:
    // hovering an empty stage re-fired the draw effect, even under reduced motion).
    if (orderedGeoms.length === 0) return;
    const r = canvas.getBoundingClientRect();
    // Tilt is presentational depth offset — it only exists when depth layers exist.
    if (!reduced && r.width > 0 && orderedGeoms.length > 1) {
      setTilt(((e.clientX - r.left) / r.width - 0.5) * 2);
    }
    if (mode === "live") {
      const f = fracAt(e);
      if (drag) setDrag({ start: drag.start, end: f });
      else setHoverX(f);
    } else if (sScene && r.height > 0) {
      // Nearest layer under the pointer (within 20px vertically) lifts to full opacity.
      const xf = fracAt(e);
      const yPx = e.clientY - r.top;
      const depthCount = sScene.layers.length - 1;
      let best: number | null = null;
      let bestDy = 20;
      sScene.layers.forEach((g, i) => {
        // layers[] is front-first; depth of layers[i] is i
        const ti = transformFor(i, r.width, r.height, 0, depthCount);
        let nearest = g.fracs[0];
        for (const p of g.fracs) if (Math.abs(p.x - xf) < Math.abs(nearest.x - xf)) nearest = p;
        const dy = Math.abs(py(ti, nearest.y) - yPx);
        if (dy < bestDy) {
          bestDy = dy;
          best = i;
        }
      });
      setHoverLayer(best);
    }
  };
  const onPointerUp = () => {
    if (drag) {
      const a = Math.min(drag.start, drag.end);
      const b = Math.max(drag.start, drag.end);
      if (b - a > 0.02) {
        // Compose into absolute window fractions so zooming inside a zoom nests correctly.
        const z = zoom ?? { start: 0, end: 1 };
        const span = z.end - z.start;
        setZoom({ start: z.start + a * span, end: z.start + b * span });
      }
      setDrag(null);
    }
  };
  const onPointerLeave = () => {
    setTilt(0);
    setHoverX(null);
    setHoverLayer(null);
    setDrag(null);
  };
  const onDoubleClick = () => setZoom(null);

  // ── DOM readouts (every readable value lives here, not only on canvas) ───────────────────
  const now = useMemo(() => new Date(), []);
  const axisLabel = scene
    ? mode === "live"
      ? `0–${Math.ceil(scene.scaleMax)} ${AXIS_UNIT.live}`
      : `0–${Math.round(scene.scaleMax)} 1% low ${AXIS_UNIT.sessions}`
    : null;

  // LIVE scrub readout: exact sample under the crosshair — ms · fps · SPIKE.
  let scrub: string | null = null;
  if (mode === "live" && lScene && hoverX != null) {
    const i = Math.round(hoverX * (zoomed.length - 1));
    const ms = zoomed[i];
    if (typeof ms === "number" && ms > 0) {
      const isSpike = lScene.front.pins.some((p) => Math.round(p.x * (zoomed.length - 1)) === i);
      scrub = `${ms.toFixed(1)} ms · ${Math.round(1000 / ms)} fps${isSpike ? " · SPIKE" : ""}`;
    }
  }

  // SESSIONS delta strip: front vs the previous COMPARABLE session — same game when one
  // exists; a cross-game fallback is labeled so a genre gap never reads as a regression.
  const front = layers[0]?.session ?? null;
  const cmp = comparablePrev(layers);
  const delta = sessionDelta(front, cmp.prev?.session ?? null);
  const deltaVs = cmp.prev
    ? cmp.sameGame
      ? `VS PREV ${(prettyGameName(cmp.prev.session.process_name) || "unknown game").toUpperCase()}`
      : `VS ${(prettyGameName(cmp.prev.session.process_name) || "unknown game").toUpperCase()} (DIFFERENT GAME)`
    : null;
  const hovered = hoverLayer != null ? layers[hoverLayer] : null;

  const layerLabel = (s: SessionSummary) => {
    const when = relativeDay(s.started_at, now);
    return [prettyGameName(s.process_name) || "unknown game", when, `${Math.round(s.avg_fps)} avg`]
      .filter(Boolean)
      .join(" · ");
  };

  const depthCount = mode === "sessions" ? Math.max(0, layers.length - 1) : 0;

  return (
    <div
      className="sw"
      data-mode={mode}
      data-axis={AXIS_UNIT[mode]}
      data-depth={mode === "live" ? snaps.length : depthCount}
    >
      <div className="sw-bar">
        <div className="sw-modes" role="group" aria-label="Waterfall mode">
          <button
            type="button"
            className={`sw-mode-btn ${mode === "live" ? "sw-mode-on" : ""}`}
            aria-pressed={mode === "live"}
            onClick={() => choose("live")}
          >
            Live
          </button>
          <button
            type="button"
            className={`sw-mode-btn ${mode === "sessions" ? "sw-mode-on" : ""}`}
            aria-pressed={mode === "sessions"}
            onClick={() => choose("sessions")}
          >
            Sessions
          </button>
        </div>
        {mode === "sessions" && sameGameAvailable(baseLayers) && (
          <button
            type="button"
            className={`sw-samegame ${sameGameOnly ? "sw-samegame-on" : ""}`}
            aria-pressed={sameGameOnly}
            onClick={() => setSameGameOnly((v) => !v)}
          >
            Same game only
          </button>
        )}
        {mode === "live" && zoom && (
          <button type="button" className="sw-zoomreset" onClick={() => setZoom(null)}>
            Reset zoom
          </button>
        )}
        {axisLabel && <span className="sw-axis">{axisLabel}</span>}
      </div>

      <div className="sw-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="sw-canvas"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onDoubleClick={onDoubleClick}
        />

        {/* SESSIONS layer legend — a stacked column (front layer first) that can NEVER
            overlap, whatever the layer count or game-name length (self-review round-1 catch:
            per-layer absolute offsets collided at the real 5-session history). Hovering a row
            lifts its layer on the canvas — that hover IS the row↔layer association. */}
        {mode === "sessions" && sScene && (
          <div className="sw-legend">
            {layers.map((l, i) => (
              <button
                type="button"
                key={`${l.session.started_at}-${i}`}
                className={`sw-layer-label ${hoverLayer === i ? "sw-layer-label-on" : ""}`}
                onMouseEnter={() => setHoverLayer(i)}
                onMouseLeave={() => setHoverLayer(null)}
                onFocus={() => setHoverLayer(i)}
                onBlur={() => setHoverLayer(null)}
              >
                {layerLabel(l.session)}
                {l.session.compy_changes_active > 0 && (
                  <span className="sw-compy-tag">
                    {l.session.compy_changes_active}{" "}
                    {l.session.compy_changes_active === 1 ? "COMPY CHANGE" : "COMPY CHANGES"} ON
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Honest empties — nothing measured, nothing drawn. */}
        {mode === "live" && !lScene && (
          <p className="sw-empty">no signal — start capture, then play</p>
        )}
        {mode === "sessions" && !sScene && (
          <p className="sw-empty">
            {sessions.length === 0
              ? "no sessions on record yet — play with capture on"
              : "no session timelines on record — timelines are kept for your 5 most recent sessions"}
          </p>
        )}
      </div>

      <div className="sw-readout">
        {mode === "live" ? (
          scrub ? (
            <span className="sw-scrub">{scrub}</span>
          ) : lScene ? (
            <span className="sw-hint">drag to zoom · double-click to reset</span>
          ) : null
        ) : hovered ? (
          <span className="sw-scrub">
            {Math.round(hovered.session.avg_fps)} avg fps · {Math.round(hovered.session.low1_fps_est)}{" "}
            1% low · {fmtDur(hovered.session.duration_secs)} · {hovered.events.length}{" "}
            {hovered.events.length === 1 ? "dip" : "dips"}
            {hovered.events.length > 0 && ` — ${hovered.events[0].label}`}
          </span>
        ) : sScene && layers.length >= 2 && deltaVs ? (
          <span className="sw-delta">
            {deltaVs} · AVG FPS <b>{fmtDelta(delta.avgFps)}</b> · 1% LOW <b>{fmtDelta(delta.low1)}</b>
          </span>
        ) : sScene ? (
          <span className="sw-hint">one more session unlocks comparison</span>
        ) : null}
      </div>
    </div>
  );
}

export default SessionWaterfall;
