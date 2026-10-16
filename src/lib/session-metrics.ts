// Session frame-rate readings (avg_fps, low1_fps_est) arrive typed `number`, but the sampler's
// "unknown" is 0, an older record can lack the field, and nothing upstream guarantees finiteness.
// The backend only treats a value > 0 as measured (blackbox.rs), and gradeFps/gradeLow1 grade
// anything else "neutral". Honest-measurement law: an unavailable value stays unknown, never a
// number on screen. Every display site asks this one question (#602, #645, #608).

/** The reading when it is a finite number above zero; otherwise null (not measured). */
export function knownFps(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
