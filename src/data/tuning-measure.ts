import type { SessionSummary, ArmedComparison, ComparisonResult } from "../types";

// THE honest-measurement verdict for a tuning baseline (spec 2026-06-08) — ONE pure source shared by
// the Lab Tuning instrument and the Play debrief so the verdict can't drift. It is a function of
// (baseline, post-tune sessions) only, computed from data the surfaces already hold (zero new IPC).
//
// The honest-measurement law, verbatim and non-negotiable:
//   Stability is a function of TIME, not one run. Compy NEVER flashes a green "STABLE". The verdict is
//   ALWAYS time-and-sample-qualified and reversible:
//     • "Holding up so far" — over the qualifying window: temps down, frames held, no stutters/crashes
//       flagged. "Only your continued play proves it."
//     • "Too aggressive" — 1% low regressed past the noise floor, new stutters, or a user-reported
//       crash → "step back one increment in your tool."
//     • "No measurable change" — inside the noise (an honest null; never invented).
//   Compy can't see a black-screen reset, so the debrief asks once: "Did it crash, hang, or show
//   artifacts?" (a yes lands as crashReported — never fabricated).

// Owner-resolved thresholds.
export const TUNING_NOISE_FLOOR_PCT = 3; // matches comparison.rs DEFAULT_NOISE_FLOOR_PCT (FPS floor)
export const TUNING_MIN_SESSIONS = 3; // "holding up so far" needs ≥ 3 sessions …
export const TUNING_MIN_SECS = 3 * 3600; // … AND ~3 hours of play with no crash
export const TUNING_REAL_TEMP_DROP_C = 3; // a real temp improvement is a ≥3 °C drop (else sensor noise)

// The Check nudge fires only when the GPU has run warm across SUSTAINED recent sessions — never a
// one-off spike, never a standing banner (bathroom law: signpost at the moment of need).
export const TUNING_HOT_THRESHOLD_C = 80;
export const TUNING_HOT_MIN_SESSIONS = 3;
// Recency window: "your GPU's been running warm" is a claim about NOW — sessions older than this
// can't carry it (drivers, ambient, dust, and the games themselves all move on). Mirrors the
// comparison engine's stale-baseline discipline (ARM_MAX_AGE_DAYS = 14 in comparison.rs).
export const TUNING_HOT_WINDOW_DAYS = 14;

/**
 * Sustained-warm signal for the Check nudge: the last `TUNING_HOT_MIN_SESSIONS` sessions that recorded
 * a GPU temp — all started within the last `TUNING_HOT_WINDOW_DAYS` — are ALL at/above the threshold.
 * Returns the worst peak + the count, or null (not warranted — too few RECENT temp'd sessions, or any
 * recent run stayed cool). `sessions` is newest-first; `now` is injectable for tests. A session with
 * an unparseable start time counts as NOT recent (fail-safe: never nudge off bad data).
 */
export function gpuRunningHot(
  sessions: SessionSummary[],
  now: number = Date.now(),
): { peakC: number; sessions: number } | null {
  const windowMs = TUNING_HOT_WINDOW_DAYS * 24 * 3600 * 1000;
  const temps = sessions
    .filter((s) => {
      if (typeof s.peak_gpu_temp_c !== "number") return false;
      const started = Date.parse(s.started_at);
      return Number.isFinite(started) && now - started <= windowMs;
    })
    .slice(0, TUNING_HOT_MIN_SESSIONS)
    .map((s) => s.peak_gpu_temp_c as number);
  if (temps.length < TUNING_HOT_MIN_SESSIONS) return null;
  if (temps.some((t) => t < TUNING_HOT_THRESHOLD_C)) return null; // not sustained
  return { peakC: Math.max(...temps), sessions: temps.length };
}

// Sustained near-limit usage (spec 2026-06-12 §A): the second admissible headroom-pain signal.
// Threshold matches the backend's GPU-limited verdict (priorities.rs GPU_LIMITED_PCT = 95).
export const TUNING_USAGE_LIMIT_PCT = 95;

/**
 * Sustained near-limit GPU usage across the last `TUNING_HOT_MIN_SESSIONS` recent sessions (same
 * window/recency discipline as `gpuRunningHot`). Returns the worst peak + count, or null.
 */
export function gpuSustainedNearLimit(
  sessions: SessionSummary[],
  now: number = Date.now(),
): { peakPct: number; sessions: number } | null {
  const windowMs = TUNING_HOT_WINDOW_DAYS * 24 * 3600 * 1000;
  const usages = sessions
    .filter((s) => {
      if (typeof s.peak_gpu_usage_pct !== "number") return false;
      const started = Date.parse(s.started_at);
      return Number.isFinite(started) && now - started <= windowMs;
    })
    .slice(0, TUNING_HOT_MIN_SESSIONS)
    .map((s) => s.peak_gpu_usage_pct as number);
  if (usages.length < TUNING_HOT_MIN_SESSIONS) return null;
  if (usages.some((u) => u < TUNING_USAGE_LIMIT_PCT)) return null; // not sustained
  return { peakPct: Math.max(...usages), sessions: usages.length };
}

// ── Evidence gate for tuning/OC-class OFFERS (spec 2026-06-12 §A — the tailoring law) ──────────
// A tuning push must name WHY this rig qualifies; the receipt IS the recommendation. Knowledge
// stays free in Learn — this gates only the recommending surfaces (Lab card, offers).

export type TuningEvidence =
  | { qualifies: true; reason: string }
  | { qualifies: false; reason: string };

/** Vendor-blind measured-headroom verdict (vendor gating stays in tuningGuideForVendor). */
export function tuningEvidence(
  sessions: SessionSummary[],
  now: number = Date.now(),
): TuningEvidence {
  const hot = gpuRunningHot(sessions, now);
  if (hot) {
    return {
      qualifies: true,
      reason: `your GPU peaked at ${hot.peakC}°C across your last ${hot.sessions} monitored sessions`,
    };
  }
  const limit = gpuSustainedNearLimit(sessions, now);
  if (limit) {
    return {
      qualifies: true,
      reason: `your GPU held ≥${TUNING_USAGE_LIMIT_PCT}% usage across your last ${limit.sessions} monitored sessions`,
    };
  }
  return {
    qualifies: false,
    reason:
      "nothing measured on this rig suggests an undervolt would help right now — no sustained heat or near-limit load in your recent monitored sessions",
  };
}

export type TuningVerdict =
  | "holding" // Holding up so far
  | "too-aggressive" // step back one increment
  | "too-early" // too early to call — keep playing
  | "no-change" // honest null
  | "confounded"; // another change landed → can't attribute

export type TuningMeasurement = {
  verdict: TuningVerdict;
  headline: string;
  detail: string;
  /** Same-game sessions played since the tune. */
  sessionsSince: number;
  secsSince: number;
  /** ≥3 sessions AND ~3h AND no crash — the gate for "holding up so far". */
  windowMet: boolean;
  baselinePeakTempC: number | null;
  /** The hottest post-tune peak (worst case) — "even at its hottest, it runs cooler". */
  afterPeakTempC: number | null;
  /** baseline − after (°C); positive = cooler. null when temps are missing. */
  tempDropC: number | null;
  tempReal: boolean; // ≥ 3 °C drop
  /** Latest post-tune 1% low Δ% vs baseline (for display). */
  low1DeltaPct: number | null;
  fpsRegressed: boolean; // any post session's 1% low fell past the floor (= new instability/stutter)
  fpsImproved: boolean; // latest post session's 1% low rose past the floor
  crashReported: boolean;
};

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function fmtPlaytime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Same-game sessions that started strictly after the tune was armed (newest-first preserved). */
export function postTuneSessions(
  baseline: ArmedComparison,
  sessions: SessionSummary[],
): SessionSummary[] {
  const armedAt = Date.parse(baseline.armed_at);
  return sessions.filter(
    (s) =>
      s.process_name === baseline.game &&
      Number.isFinite(Date.parse(s.started_at)) &&
      Date.parse(s.started_at) >= armedAt,
  );
}

/**
 * Compute the time-qualified tuning verdict. `result` (the latest comparison, optional) only feeds the
 * confound/expiry guard — when a Compy fix landed mid-window, we won't attribute the delta to the tune.
 * Returns null when there's no tuning baseline to measure.
 */
export function measureTuning(
  baseline: ArmedComparison | null | undefined,
  sessions: SessionSummary[],
  result?: ComparisonResult | null,
): TuningMeasurement | null {
  if (!baseline || baseline.kind !== "tuning") return null;

  const post = postTuneSessions(baseline, sessions);
  const sessionsSince = post.length;
  const secsSince = post.reduce((sum, s) => sum + s.duration_secs, 0);
  const crashReported = baseline.crash_reported === true;
  const baselinePeakTempC = baseline.baseline_peak_temp_c ?? null;

  // FPS held? Judge every post session's 1% low against the baseline on the existing noise floor.
  // A drop past the floor is the measurable form of "new stutters / instability".
  const baseLow1 = baseline.baseline_low1_fps;
  const deltaPct = (low1: number): number | null =>
    baseLow1 > 0 ? round1(((low1 - baseLow1) / baseLow1) * 100) : null;
  const fpsRegressed = post.some((s) => {
    const d = deltaPct(s.low1_fps_est);
    return d != null && d < -TUNING_NOISE_FLOOR_PCT;
  });
  const latest = post[0] ?? null;
  const low1DeltaPct = latest ? deltaPct(latest.low1_fps_est) : null;
  const fpsImproved = low1DeltaPct != null && low1DeltaPct > TUNING_NOISE_FLOOR_PCT;

  // Thermal payoff: compare the baseline peak to the WORST (hottest) post-tune peak — honest "it runs
  // cooler even at its hottest". A ≥3 °C drop clears sensor/ambient noise.
  const postPeaks = post
    .map((s) => s.peak_gpu_temp_c)
    .filter((t): t is number => typeof t === "number");
  const afterPeakTempC = postPeaks.length > 0 ? Math.max(...postPeaks) : null;
  const tempDropC =
    baselinePeakTempC != null && afterPeakTempC != null ? baselinePeakTempC - afterPeakTempC : null;
  const tempReal = tempDropC != null && tempDropC >= TUNING_REAL_TEMP_DROP_C;

  const windowMet =
    sessionsSince >= TUNING_MIN_SESSIONS && secsSince >= TUNING_MIN_SECS && !crashReported;

  const progress = `${sessionsSince} session${sessionsSince === 1 ? "" : "s"}, ${fmtPlaytime(
    secsSince,
  )}`;
  const tempLine =
    tempDropC != null
      ? tempReal
        ? `Peak GPU temp ${baselinePeakTempC}°C → ${afterPeakTempC}°C (−${tempDropC}°C) — a real drop.`
        : `Peak GPU temp ${baselinePeakTempC}°C → ${afterPeakTempC}°C — within sensor noise so far.`
      : "Temps will show once a monitored session reports a peak.";

  // Precedence (honest): a reported crash is real regardless of anything else; then a confound voids
  // attribution; then a measured regression; then an improvement (gated on the window); else a null.
  let verdict: TuningVerdict;
  let headline: string;
  let detail: string;

  // Only the tune's OWN result may confound it: it must be a TUNING result for THIS baseline's game.
  // A stale fix result — or another game's tuning result — left un-dismissed must never flip this
  // measurement (Lab passes the unfiltered latest comparison; the filter lives here so no caller can
  // get it wrong). Fix-era results without a kind field count as fix → filtered out.
  const ownResult =
    result != null && result.kind === "tuning" && result.game === baseline.game ? result : null;
  const confounded =
    ownResult != null && (ownResult.verdict === "confounded" || ownResult.verdict === "expired");

  if (crashReported) {
    verdict = "too-aggressive";
    headline = "Too aggressive";
    detail =
      "You reported a crash, hang, or artifacts — that's the limit. Step back up one increment in your tool, then keep measuring.";
  } else if (sessionsSince === 0) {
    // Honest-measurement law: with ZERO measured sessions there is nothing to call — claiming
    // "no measurable change" here would be a null verdict invented from no data.
    verdict = "too-early";
    headline = "Nothing measured yet";
    detail =
      "Compy hasn't seen a session of this game since the tune. Play one and the comparison starts — temps and frames against your baseline.";
  } else if (confounded) {
    verdict = "confounded";
    headline = "Can't cleanly attribute this";
    detail =
      ownResult?.verdict === "expired"
        ? "This tune baseline is too old to compare fairly — drivers and games have moved on. Re-arm a fresh baseline after your next session."
        : "Another change landed between sessions, so Compy won't credit the tune for this delta. Re-arm after things settle.";
  } else if (fpsRegressed) {
    verdict = "too-aggressive";
    headline = "Too aggressive";
    detail = `Your 1% low dropped past the ±${TUNING_NOISE_FLOOR_PCT}% noise floor — new stutters. Step back up one increment in your tool.`;
  } else if (tempReal || fpsImproved) {
    if (windowMet) {
      verdict = "holding";
      headline = "Holding up so far";
      detail = `${tempLine} Frames held, no crashes flagged across ${progress}. Only your continued play proves it — keep playing and tell Compy if anything resets.`;
    } else {
      verdict = "too-early";
      headline = "Too early to call — keep playing";
      detail = `${tempLine} Looking good, but stability shows over time: ${progress} so far (needs ≥${TUNING_MIN_SESSIONS} sessions and ~3h with no crash).`;
    }
  } else {
    verdict = "no-change";
    headline = "No measurable change";
    detail = `Inside this rig's own session-to-session noise — temps and frames are where they were. That's an honest null across ${progress}, not a failure.`;
  }

  return {
    verdict,
    headline,
    detail,
    sessionsSince,
    secsSince,
    windowMet,
    baselinePeakTempC,
    afterPeakTempC,
    tempDropC,
    tempReal,
    low1DeltaPct,
    fpsRegressed,
    fpsImproved,
    crashReported,
  };
}
