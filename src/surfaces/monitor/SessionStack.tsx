import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionSummary } from "../../types";
import { useRoomIdentityFlag } from "../../design/use-hud";
import { monotoneSegments } from "../../design/console/monotone";
import { prettyGameName } from "../game-name";
import { fmtDur } from "../Play";
import {
  stackRowsFrom,
  gameFilterAvailable,
  fmtDeltaGlyph,
  relativeDay,
  type StackRow,
} from "./monitor-stack-profile";
import { knownFps } from "../../lib/session-metrics";
import "../../i18n";

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

// Resolve a CSS custom property. `from` lets the caller read a ROOM-scoped value instead of the
// document root: when the per-room identity flag is on, the newest-session trace reads --ix-accent
// off the in-room element so it adopts the room hue (teal on Monitor), matching the room chrome
// instead of the theme accent. `from` null/undefined ⇒ documentElement ⇒ today's behaviour.
function readInk(name: string, fb: string, from?: Element | null): string {
  if (typeof document === "undefined") return fb;
  const got = getComputedStyle(from ?? document.documentElement).getPropertyValue(name).trim();
  return got || fb;
}

const PAD_Y = 3;

// Monotone cubic (Fritsch–Carlson) trace — the refinement the owner asked for (2026-07-11):
// the curve passes through EVERY real sample and, being monotone between points, never
// overshoots into an invented dip or peak. It smooths the CORNERS of the min-per-bucket
// sawtooth, never the data. < 3 points falls back to straight segments. The math lives in
// the shared console-kit module (the Oscilloscope's envelope median draws the same curve).
function traceMonotone(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length < 3) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    return;
  }
  for (const s of monotoneSegments(pts)) {
    ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y);
  }
}

function RowCanvas({
  row,
  axisMax,
  newest,
  roomIdentityOn,
  accentTick,
  inkFor,
}: {
  row: StackRow;
  axisMax: number | null;
  newest: boolean;
  roomIdentityOn: boolean;
  /** Bumped by the parent when a per-room accent pick changes — re-runs the draw (owner 2026-07-12b). */
  accentTick: number;
  /** The stack-shared ink resolver — see the cache note in SessionStack. */
  inkFor: (name: string, fb: string, from?: Element | null) => string;
}) {
  const { t } = useTranslation();
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

    // When per-room identity is on, read the room-scoped accent (via this row's in-room element)
    // so the newest trace matches the Monitor chrome hue; off ⇒ documentElement (today's value).
    const inkFrom = roomIdentityOn ? wrapRef.current : null;
    const ink = newest
      ? inkFor("--ix-accent", "#b366ff", inkFrom)
      : inkFor("--ix-text-3", "#8a93a6", inkFrom);
    const warn = inkFor("--v2-warn", "#f5c542", inkFrom);
    const grid = inkFor("--ix-glass-border", "rgba(160,170,190,0.3)", inkFrom);
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

    // The trace + a quiet area fill (newest rides the accent, older rows muted). Drawn as a
    // monotone curve with round joins — refined line, untouched samples.
    const pts = row.fracs.map((p) => ({ x: px(p.x), y: py(p.y) }));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = newest ? 1 : 0.7;
    ctx.strokeStyle = ink;
    ctx.lineWidth = newest ? 1.5 : 1;
    ctx.beginPath();
    traceMonotone(ctx, pts);
    ctx.stroke();
    ctx.globalAlpha = newest ? 0.12 : 0.06;
    ctx.fillStyle = ink;
    ctx.beginPath();
    traceMonotone(ctx, pts);
    ctx.lineTo(pts[pts.length - 1].x, baseY);
    ctx.lineTo(pts[0].x, baseY);
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
  }, [row, axisMax, newest, size, roomIdentityOn, accentTick, inkFor]);

  return (
    <span className={`ss-canvas-wrap ${row.partial ? "ss-canvas-partial" : ""}`} ref={wrapRef}>
      <canvas ref={canvasRef} className="ss-canvas" aria-hidden="true" />
      {(row.fracs.length < 2 || axisMax == null) && (
        <span className="ss-notimeline">{t("monitor.sessionStack.timelineNotKept")}</span>
      )}
      {/* A capped recording must SAY so — the trace spans what was RECORDED, and this states
          it, so a full-width line never claims hours it doesn't show (bug→guard). */}
      {row.partial && row.coveredSecs != null && (
        <span className="ss-coverage">
          {t("monitor.sessionStack.coverageNote", { duration: fmtDur(row.coveredSecs) })}
        </span>
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

// An unmeasured reading (knownFps: 0, negative, non-finite or missing) is the em dash, never "0".
const fmtV = (v: unknown) => {
  const k = knownFps(v);
  return k == null ? "—" : String(Math.round(k));
};

export function SessionStack({
  sessions = [],
  reduced,
}: {
  /** Newest-first session history — the same array the Sessions face lists. */
  sessions?: SessionSummary[];
  reduced: boolean;
}) {
  const { t } = useTranslation();
  const [gameOnly, setGameOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const roomIdentityOn = useRoomIdentityFlag();
  // Repaint every row when a per-room accent PICK changes --ix-accent in place (owner 2026-07-12b).
  // Lives here (not per-row) so the stack registers ONE listener, and so the ink cache below can
  // key on it — the tokens change exactly when this bumps.
  const [accentTick, setAccentTick] = useState(0);
  useEffect(() => {
    const bump = () => setAccentTick((t) => t + 1);
    window.addEventListener("compy:room-identity-changed", bump);
    return () => window.removeEventListener("compy:room-identity-changed", bump);
  }, []);
  const now = useMemo(() => new Date(), []);
  const currentGame = sessions[0]?.process_name || null;
  const filterAvail = useMemo(() => gameFilterAvailable(sessions), [sessions]);
  const model = useMemo(
    () => stackRowsFrom(sessions, gameOnly && filterAvail ? currentGame : null),
    [sessions, gameOnly, filterAvail, currentGame],
  );
  // Stack-shared ink cache. Each row's draw effect used to call readInk (= getComputedStyle) three
  // times, and getComputedStyle forces a style recalc — 5 rows paid up to 15 recalcs on every
  // Monitor nav-in (nav-mount follow-up, BACKLOG cycle 2026-07-15d). All rows sit in the same room,
  // so the four tokens resolve identically across rows: cache by token name and the whole stack
  // pays at most four reads per paint generation. Reset on exactly the signals that re-run the
  // draws for token-relevant reasons — accent pick / identity flag / a new row model (the old
  // per-draw read picked up e.g. a theme switch on the next data repaint; keying on the model
  // reference preserves that).
  const inkCache = useRef<{ key: string; model: unknown; map: Map<string, string> }>({
    key: "",
    model: null,
    map: new Map(),
  });
  const inkCacheKey = `${roomIdentityOn ? "room" : "root"}:${accentTick}`;
  if (inkCache.current.key !== inkCacheKey || inkCache.current.model !== model) {
    inkCache.current = { key: inkCacheKey, model, map: new Map() };
  }
  const inkFor = useCallback((name: string, fb: string, from?: Element | null): string => {
    const hit = inkCache.current.map.get(name);
    if (hit !== undefined) return hit;
    const got = readInk(name, fb, from);
    inkCache.current.map.set(name, got);
    return got;
  }, []);

  if (sessions.length === 0) {
    return <p className="ss-empty">{t("monitor.sessionStack.noSessionsEmpty")}</p>;
  }

  const detailLine = (row: StackRow) => {
    const s = row.session;
    const parts = [
      t("monitor.sessionStack.avgTag", { value: fmtV(s.avg_fps) }),
      t("monitor.sessionStack.oneLowTag", { value: fmtV(s.low1_fps_est) }),
      t("monitor.sessionStack.spikeCount", { count: row.dipCount }),
    ];
    if (row.pin) {
      parts.push(
        t("monitor.sessionStack.worstDip", { clock: row.pin.clock, label: row.pin.label }).trim(),
      );
    }
    if (row.partial && row.coveredSecs != null) {
      parts.push(
        t("monitor.sessionStack.timelineCoversFirst", { duration: fmtDur(row.coveredSecs) }),
      );
    }
    if (s.compy_changes_active > 0) {
      parts.push(
        t("monitor.sessionStack.changesOn", { count: s.compy_changes_active }),
      );
    }
    return parts.join(" · ");
  };

  return (
    <div className="ss" data-motion={reduced ? "reduced" : "full"}>
      {filterAvail && currentGame && (
        <div className="ss-filter" role="group" aria-label={t("monitor.sessionStack.gameFilterAria")}>
          <button
            type="button"
            className={`ss-filter-btn ${!gameOnly ? "ss-filter-on" : ""}`}
            aria-pressed={!gameOnly}
            onClick={() => setGameOnly(false)}
          >
            {t("monitor.sessionStack.allGames")}
          </button>
          <button
            type="button"
            className={`ss-filter-btn ${gameOnly ? "ss-filter-on" : ""}`}
            aria-pressed={gameOnly}
            onClick={() => setGameOnly(true)}
          >
            {t("monitor.sessionStack.gameOnlyButton", {
              game: prettyGameName(currentGame) || t("monitor.sessionStack.unknownGame"),
            })}
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
                {/* Name and when/how-long are separate boxes (#677): only the NAME truncates, so a
                    long game label can never clip the age and duration behind it. */}
                <span className="ss-meta">
                  <span className="ss-meta-name">
                    {prettyGameName(s.process_name) || t("monitor.sessionStack.unknownGame")}
                  </span>
                  <span className="ss-meta-when">
                    {[relativeDay(s.started_at, now, t), fmtDur(s.duration_secs)]
                      .filter(Boolean)
                      .map((part) => ` · ${part}`)
                      .join("")}
                  </span>
                </span>
                <RowCanvas
                  row={row}
                  axisMax={model.axisMax}
                  newest={i === 0}
                  roomIdentityOn={roomIdentityOn}
                  accentTick={accentTick}
                  inkFor={inkFor}
                />
                {row.delta && (
                  <span className="ss-chip">
                    {t("monitor.sessionStack.vsPrevious", { glyph: fmtDeltaGlyph(row.delta.avgFps) })}
                    {!row.delta.sameGame && t("monitor.sessionStack.differentGameTag")}
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
          {t("monitor.sessionStack.axisNote", { max: Math.round(model.axisMax) })}
        </p>
      )}
    </div>
  );
}

export default SessionStack;
