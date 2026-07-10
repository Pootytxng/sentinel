export function Sparkline({
  values, tone = "accent", dot = true, w = 60, h = 18,
}: { values: number[]; tone?: "accent" | "muted"; dot?: boolean; w?: number; h?: number }) {
  if (!values.length) return null;
  const max = Math.max(...values) || 1;
  const n = values.length;
  const pts = values.map(
    (v, i) =>
      `${((i / Math.max(1, n - 1)) * (w - 2) + 1).toFixed(1)},${(h - 1 - (v / max) * (h - 3)).toFixed(1)}`,
  );
  const [lx, ly] = pts[pts.length - 1].split(",");
  const stroke = tone === "muted" ? "var(--ix-text-3)" : "var(--ix-accent)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width={w} height={h} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="1" opacity="0.85" />
      {dot && <circle cx={lx} cy={ly} r="1.6" fill={stroke} />}
    </svg>
  );
}
export default Sparkline;
