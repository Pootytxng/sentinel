import type { TFunction } from "i18next";

// P9-hz: the rig's display mode travels as the backend's compact "WxH@R" (hardware.rs
// `current_fingerprint`, R = the panel's refresh rate in Hz). Session, Trial, Care and timeline lines
// printed that raw ("1920x1080@250"), so the rate read as a bare number with no unit. This words it
// for the reader ("1920×1080 @ 250 Hz"). A rate the read could not get (0) says "unknown", never a
// guessed number. A mode in any other spelling prints exactly as recorded: never reformatted into a
// guess. Comparisons (same rig? same context?) keep using the raw value; this is display only.
const MODE = /^(\d+)x(\d+)@(\d+)$/;

export function displayModeLabel(mode: string | null | undefined, t: TFunction): string | null {
  if (mode == null) return null;
  const raw = mode.trim();
  if (raw === "") return null;
  const m = MODE.exec(raw);
  if (!m) return raw;
  const [, width, height, rate] = m;
  return Number(rate) > 0
    ? t("common.displayMode.withRate", { width, height, rate })
    : t("common.displayMode.rateUnknown", { width, height });
}

/** The measured refresh rate inside a recorded "WxH@R" mode, or null when it was not read (0) or the
 *  mode is in any other spelling. Never a default rate. */
export function refreshRateOf(mode: string | null | undefined): number | null {
  if (mode == null) return null;
  const m = MODE.exec(mode.trim());
  if (!m) return null;
  const rate = Number(m[3]);
  return rate > 0 ? rate : null;
}

// P9-target (ROADMAP Phase 9 "display target"): an FPS answer compared with the screen it was played
// on — the session's own recorded mode, not today's screen. "About 60% of your 250 Hz screen" is plain
// arithmetic on two measurements; with either one unmeasured there is no line (null), never a guess.
// At or above the rate it says it kept up instead of a percentage over 100 that reads like a score.
export type ScreenTarget = { kind: "under"; pct: number; rate: number } | { kind: "met"; rate: number };

export function screenTarget(avgFps: number | null | undefined, mode: string | null | undefined): ScreenTarget | null {
  const rate = refreshRateOf(mode);
  if (rate == null || avgFps == null || !Number.isFinite(avgFps) || avgFps <= 0) return null;
  if (avgFps >= rate) return { kind: "met", rate };
  // Just under the rate never rounds up into "kept up": 249.6 on 250 Hz reads 99%, not 100%.
  return { kind: "under", pct: Math.min(99, Math.round((avgFps / rate) * 100)), rate };
}

export function screenTargetLine(avgFps: number | null | undefined, mode: string | null | undefined, t: TFunction): string | null {
  const target = screenTarget(avgFps, mode);
  if (target == null) return null;
  return target.kind === "met"
    ? t("monitor.sessionDebrief.screenTargetMet", { rate: target.rate })
    : t("monitor.sessionDebrief.screenTarget", { pct: target.pct, rate: target.rate });
}
