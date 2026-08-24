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

/** One contiguous run of trace samples, already projected into SVG space. */
export type TraceRun = {
  /** `x,y x,y …` for a run of 2+ samples; "" for a lone sample. */
  points: string;
  /** Set only for a run of exactly ONE sample — drawn as a dot so it cannot vanish. */
  dot: { x: number; y: number } | null;
};

export type TraceGeometry = {
  runs: TraceRun[];
  /** Top of the value axis. The trace is anchored at 0, so this is the only value label needed. */
  peak: number;
  /** Seconds the x-axis spans, from the first bucket to the end of the session. */
  spanSecs: number;
  /** How many times capture stopped and resumed inside the session. */
  gaps: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Project a persisted `fps_series` — `(bucket_start_elapsed_secs, mean fps)` pairs — into SVG runs.
 *
 * THREE HONESTY PROPERTIES, each pinned in geometry.test.ts:
 *
 *   1. GAPS STAY GAPS. The Rust side never interpolates a bucket it did not measure
 *      (`sessions.rs` `fps_series_gaps_stay_gaps`), so neither does the drawing: a jump larger than
 *      one bucket ENDS the run and the next sample starts a new one. A single polyline across the
 *      hole would draw a straight line through minutes nobody watched — a measurement Compy never
 *      took, rendered as if it had.
 *   2. A LONE SAMPLE IS A DOT, NOT NOTHING. A bucket with a gap on both sides is a run of one, and
 *      a polyline of one point paints zero pixels. Dropping it would silently delete real measured
 *      data, so a one-sample run carries a `dot` instead.
 *   3. THE VALUE AXIS IS ANCHORED AT 0. Min-max normalisation would stretch a rock-steady 141-144
 *      fps session into a cliff face — a shape the machine never had. Anchoring at zero makes a
 *      flat session look flat and a real halving look halved.
 *
 * @returns null when there is nothing measured to draw — the caller says so in words rather than
 *          drawing a flat line, which would read as "we measured zero".
 */
export function traceGeometry(
  series: readonly (readonly [number, number])[],
  width: number,
  height: number,
  { bucketSecs = 10, durationSecs = 0 }: { bucketSecs?: number; durationSecs?: number } = {},
): TraceGeometry | null {
  const clean = series
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[1] >= 0)
    .map((p) => [p[0], p[1]] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  if (clean.length === 0) return null;

  const bucket = bucketSecs > 0 ? bucketSecs : 10;
  const t0 = clean[0][0];
  const lastT = clean[clean.length - 1][0];
  // The axis runs to the end of the session, not to the last bucket: a session that stopped
  // reporting three minutes before it ended should SHOW those three minutes as empty.
  const spanSecs = Math.max(lastT + bucket, durationSecs) - t0;
  const span = spanSecs > 0 ? spanSecs : bucket;
  // A peak of 0 (or below) cannot scale anything; 1 keeps the whole trace on the baseline, which is
  // the honest picture of a session that measured no frames.
  const peak = Math.max(...clean.map((p) => p[1]), 0) || 1;

  const x = (t: number) => r2(((t - t0) / span) * width);
  const y = (v: number) => r2(height - Math.min(v / peak, 1) * height);

  const runs: TraceRun[] = [];
  let current: [number, number][] = [];
  const flush = () => {
    if (current.length === 0) return;
    runs.push(
      current.length === 1
        ? { points: "", dot: { x: x(current[0][0]), y: y(current[0][1]) } }
        : { points: current.map((p) => `${x(p[0])},${y(p[1])}`).join(" "), dot: null },
    );
    current = [];
  };
  for (const p of clean) {
    // 1.5x, not 1x: the tolerance absorbs float drift on the bucket stride without ever letting a
    // genuinely missing bucket (a 2x stride) read as contiguous.
    if (current.length > 0 && p[0] - current[current.length - 1][0] > bucket * 1.5) flush();
    current.push(p);
  }
  flush();

  return { runs, peak, spanSecs: span, gaps: Math.max(runs.length - 1, 0) };
}
