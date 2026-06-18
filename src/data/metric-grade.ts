// Hardware-tailored metric grading (owner 2026-06-17: "color-code metrics green/yellow/red, with the
// ranges tailored to the user's specific hardware so it's unique per rig" — the 'tailored to your
// hardware' motto). Pure functions; no IPC, no fabrication — they only INTERPRET real measured values
// against thresholds derived from the rig (the monitor's refresh rate, RAM total, GPU thermals).
//
// HONESTY: only metrics with a genuine good→bad quality range are graded. Raw UTILISATION (CPU%/GPU%)
// is deliberately left NEUTRAL — high utilisation is workload-dependent and is GOOD while gaming, so
// red/green there would mislead. We grade FPS, 1% low, frametime, GPU temperature and RAM pressure.

export type Grade = "good" | "ok" | "bad" | "neutral";

export type RigContext = {
  /** Monitor refresh rate (Hz) — tailors FPS + frametime: "good FPS" means hitting YOUR display. */
  refreshHz?: number | null;
};

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Effective refresh for grading: the real value when known (clamped to sane bounds), else 60 Hz. */
function refresh(ctx: RigContext): number {
  const r = num(ctx.refreshHz);
  if (r == null) return 60;
  return Math.min(1000, Math.max(24, r));
}

/**
 * Average FPS, graded against the rig's refresh rate. "good" = ~hitting your display (so 60 fps is
 * great on a 60 Hz panel but only "ok" on a 240 Hz one — the grade is unique to the user's display).
 */
export function gradeFps(avg: number | null | undefined, ctx: RigContext): Grade {
  const a = num(avg);
  if (a == null || a <= 0) return "neutral";
  const r = refresh(ctx);
  const ratio = a / r;
  if (ratio >= 0.85) return "good";
  if (ratio >= 0.45 || a >= 55) return "ok";
  return "bad";
}

/** 1% low FPS, graded by consistency vs the session's own average (how much it dips on the worst 1%). */
export function gradeLow1(
  low1: number | null | undefined,
  avg: number | null | undefined,
  _ctx?: RigContext,
): Grade {
  const l = num(low1);
  const a = num(avg);
  if (l == null || a == null || a <= 0 || l <= 0) return "neutral";
  const ratio = l / a;
  if (ratio >= 0.7) return "good";
  if (ratio >= 0.5) return "ok";
  return "bad";
}

/** Average frametime (ms), graded against the rig's frame budget (1000 / refresh). */
export function gradeFrametimeMs(ms: number | null | undefined, ctx: RigContext): Grade {
  const m = num(ms);
  if (m == null || m <= 0) return "neutral";
  const budget = 1000 / refresh(ctx);
  if (m <= budget * 1.2) return "good";
  if (m <= budget * 2.5) return "ok";
  return "bad";
}

/** GPU temperature (°C). Generic-but-sane thermal ramp (vendor-specific tuning is a future refinement). */
export function gradeGpuTempC(c: number | null | undefined): Grade {
  const t = num(c);
  if (t == null) return "neutral";
  if (t < 75) return "good";
  if (t < 85) return "ok";
  return "bad";
}

/** RAM pressure (% used). High pressure is the invisible stutter cause; the % is already per-rig. */
export function gradeRamPct(pct: number | null | undefined): Grade {
  const p = num(pct);
  if (p == null) return "neutral";
  if (p < 75) return "good";
  if (p < 90) return "ok";
  return "bad";
}

/** Map a grade to a status color token for inline `style={{ color }}` — "" for neutral (inherit). */
export function gradeColor(g: Grade): string {
  switch (g) {
    case "good":
      return "var(--ready, #46d98a)";
    case "ok":
      return "var(--attention, #f5b740)";
    case "bad":
      return "var(--danger, #f3716f)";
    default:
      return "";
  }
}
