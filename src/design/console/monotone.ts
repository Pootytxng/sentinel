// Console kit — monotone cubic (Fritsch–Carlson) interpolation, the ONE shared implementation
// (SessionStack's canvas trace + the Oscilloscope's envelope median line). The curve passes
// through EVERY input point and, being monotone between points, never overshoots into an
// invented dip or peak — it smooths corners, never the data. < 3 points ⇒ straight segments.

export type Pt = { x: number; y: number };

export type CubicSeg = {
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x: number;
  y: number;
};

/** Fritsch–Carlson cubic segments through pts (assumes pts.length >= 2, x ascending). */
export function monotoneSegments(pts: Pt[]): CubicSeg[] {
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x || 1e-6;
    m[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  const out: CubicSeg[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    out.push({
      c1x: pts[i].x + h / 3,
      c1y: pts[i].y + (t[i] * h) / 3,
      c2x: pts[i + 1].x - h / 3,
      c2y: pts[i + 1].y - (t[i + 1] * h) / 3,
      x: pts[i + 1].x,
      y: pts[i + 1].y,
    });
  }
  return out;
}

/** SVG path `d` for the monotone curve through pts (straight lines below 3 points). */
export function monotonePathD(pts: Pt[]): string {
  if (pts.length === 0) return "";
  const f = (v: number) => v.toFixed(1);
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  if (pts.length < 3) {
    for (let i = 1; i < pts.length; i++) d += ` L ${f(pts[i].x)} ${f(pts[i].y)}`;
    return d;
  }
  for (const s of monotoneSegments(pts)) {
    d += ` C ${f(s.c1x)} ${f(s.c1y)}, ${f(s.c2x)} ${f(s.c2y)}, ${f(s.x)} ${f(s.y)}`;
  }
  return d;
}
