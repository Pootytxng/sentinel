// The glass redesign's bar chart (owner decision 2026-10-30): one rounded "tube" per real session,
// the newest one lit in the accent with its value printed above it. Drawn at the container's real
// pixel width (measured), so labels stay at the type scale at every window size instead of shrinking
// with a viewBox. A session whose value was not measured draws no bar and says so on hover/focus:
// unknown stays unknown, never a zero-height lie.
import { useEffect, useId, useRef, useState } from "react";

export type TubeBar = {
  key: string;
  /** null = not measured. */
  value: number | null;
  /** Axis label (short date). */
  label: string;
  /** Hover / focus text, already localised. */
  tip: string;
  tone?: "base" | "accent" | "bad";
};

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * exp >= raw) return m * exp;
  }
  return 10 * exp;
}

export function TubeChart({
  bars,
  ariaLabel,
  highlightLast = true,
  format = (v: number) => String(Math.round(v)),
}: {
  bars: TubeBar[];
  ariaLabel: string;
  highlightLast?: boolean;
  format?: (v: number) => string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(260, Math.round(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = width;
  const H = Math.round(Math.min(280, Math.max(200, W * 0.4)));
  const x0 = 40;
  const x1 = W - 6;
  const yT = 34;
  const yB = H - 26;
  const n = Math.max(1, bars.length);
  const slot = (x1 - x0) / n;
  const bw = Math.max(9, Math.min(22, slot * 0.44));
  const known = bars.map((b) => b.value).filter((v): v is number => v != null && Number.isFinite(v));
  // Axis steps a person can read (0 · 50 · 100 · 150), never quarters of an odd ceiling (0 · 38 · 75).
  // At least 1 fps per step: the axis prints whole numbers, and a near-zero range used to round
  // 0 · 0.5 · 1 · 1.5 into "0 1 1 2" (round-2 review, 2026-10-31).
  const step = Math.max(1, niceStep(((known.length ? Math.max(...known) : 1) * 1.12) / 4));
  const max = Math.max(step, Math.ceil(((known.length ? Math.max(...known) : 1) * 1.12) / step) * step);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const Y = (v: number) => yB - (v / max) * (yB - yT);
  const cx = (i: number) => x0 + slot * (i + 0.5);
  const longest = bars.reduce((m, b) => Math.max(m, b.label.length), 0);
  const thin = slot < longest * 7.4 + 8;
  const hi = highlightLast ? bars.length - 1 : -1;

  return (
    <div className="gl-chart" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={`${uid}base`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--v2-text)", stopOpacity: 0.34 }} />
            <stop offset="1" style={{ stopColor: "var(--v2-text)", stopOpacity: 0.05 }} />
          </linearGradient>
          <linearGradient id={`${uid}acc`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--v2-accent-text)" }} />
            <stop offset="0.55" style={{ stopColor: "var(--v2-accent)" }} />
            <stop offset="1" style={{ stopColor: "var(--v2-accent)", stopOpacity: 0.14 }} />
          </linearGradient>
          <linearGradient id={`${uid}bad`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--v2-bad)" }} />
            <stop offset="1" style={{ stopColor: "var(--v2-bad)", stopOpacity: 0.12 }} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="gl-grid-line" x1={x0} x2={x1} y1={Y(t)} y2={Y(t)} />
            <text x={x0 - 8} y={Y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const isHi = i === hi;
          // Two sessions on one day share a date: print it once, on the later bar.
          const sameAsNext = i < n - 1 && bars[i + 1].label === b.label;
          const showLabel = isHi || (!(thin && (n - 1 - i) % 2) && !sameAsNext);
          const tone = b.tone ?? (isHi ? "accent" : "base");
          const fill = `url(#${uid}${tone === "accent" ? "acc" : tone === "bad" ? "bad" : "base"})`;
          const v = b.value;
          const h = v != null ? Math.max(5, yB - Y(v)) : 0;
          const y = yB - h;
          const tipX = Math.min(W - 30, Math.max(30, cx(i)));
          return (
            <g key={b.key}>
              {v != null ? (
                <rect
                  className="gl-bar"
                  tabIndex={0}
                  x={cx(i) - bw / 2}
                  y={y}
                  width={bw}
                  height={h}
                  rx={bw / 2}
                  fill={fill}
                  aria-label={b.tip}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((c) => (c === i ? null : c))}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover((c) => (c === i ? null : c))}
                />
              ) : (
                <circle
                  className="gl-bar"
                  tabIndex={0}
                  cx={cx(i)}
                  cy={yB - 3}
                  r={3}
                  style={{ fill: "var(--v2-faint)" }}
                  aria-label={b.tip}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((c) => (c === i ? null : c))}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover((c) => (c === i ? null : c))}
                />
              )}
              {showLabel && (
                <text x={cx(i)} y={yB + 18} textAnchor="middle" className={isHi ? "gl-ax-hi" : undefined}>
                  {b.label}
                </text>
              )}
              {isHi && v != null && (
                <g aria-hidden="true">
                  <rect
                    x={tipX - 28}
                    y={y - 30}
                    width={56}
                    height={22}
                    rx={11}
                    style={{ fill: "var(--v2-dock-active-bg)" }}
                  />
                  <text x={tipX} y={y - 14.5} textAnchor="middle" className="gl-tip-val">
                    {format(v)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && bars[hover] && (
        <div
          className="gl-chart-tip"
          role="status"
          style={{
            left: `${(Math.min(W - 60, Math.max(60, cx(hover))) / W) * 100}%`,
            top: `${((bars[hover].value != null ? Y(bars[hover].value as number) : yB) / H) * 100}%`,
          }}
        >
          {bars[hover].tip}
        </div>
      )}
    </div>
  );
}
