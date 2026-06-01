/** Clamp a value into 0..100 percent across [min,max]; 0 when span is non-positive. */
export function gaugePercent(value: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return 0;
  const pct = ((value - min) / span) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** SVG polyline points spanning [0,width]x[0,height]; higher value = higher (smaller y). */
export function sparkPoints(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const stepX = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = Math.round(i * stepX);
      const y = span === 0 ? height : Math.round(height - ((v - lo) / span) * height);
      return `${x},${y}`;
    })
    .join(" ");
}
