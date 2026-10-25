// Session frame-rate readings (avg_fps, low1_fps_est) arrive typed `number`, but the sampler's
// "unknown" is 0, an older record can lack the field, and nothing upstream guarantees finiteness.
// The backend only treats a value > 0 as measured (blackbox.rs), and gradeFps/gradeLow1 grade
// anything else "neutral". Honest-measurement law: an unavailable value stays unknown, never a
// number on screen. Every display site asks this one question (#602, #645, #608).

/** The reading when it is a finite number above zero; otherwise null (not measured). */
export function knownFps(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** P4-comparable-show: the seconds a session left out because another window was in front, when
 *  there are any. `null`/absent (focus wasn't recorded) and 0 both mean there is nothing to say. */
export function leftOutSecs(s: { background_secs_excluded?: number | null }): number | null {
  const v = s.background_secs_excluded;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** A session that measured nothing because the game was behind another window the whole time:
 *  no readings, and focus was recorded with time left out. Its empty numbers have a reason. */
export function allBackground(s: {
  samples: number;
  background_secs_excluded?: number | null;
}): boolean {
  return !(s.samples > 0) && leftOutSecs(s) != null;
}

/** "24 s" / "2 min 36 s" in the viewer's language (keys under monitor.leftOut). */
export function leftOutSpan(secs: number, t: Translate): string {
  return secs < 60
    ? t("monitor.leftOut.seconds", { seconds: secs })
    : t("monitor.leftOut.minutes", { minutes: Math.floor(secs / 60), seconds: secs % 60 });
}
