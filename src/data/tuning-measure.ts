import type { SessionSummary, ArmedComparison, ComparisonResult } from "../types";
import { allBackground } from "../lib/session-metrics";

/** comparison.rs `PostComparability` (CR-tuning-comparability). */
export type PostComparability = { started_at: string; comparable: boolean };

// THE honest-measurement verdict for a tuning baseline (spec 2026-06-08) — ONE pure source shared by
// the Lab Tuning instrument and the Play debrief so the verdict can't drift. It is a function of
// (baseline, post-tune sessions), computed from data the surfaces already hold, plus the backend's
// per-session comparability with the baseline session (CR-tuning-comparability, one read).
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
// Measurement item 8: no fixed FPS floor. The frames are judged on this game's measured as-is band
// (comparison.rs `game_noise` on the tune's own result), or not judged at all.
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

// ── CR-tuning-gpu-other-card: sessions on the card in this PC now (P9-session-on-this-hardware's rule) ──
// A GPU signal from a session recorded on another graphics card says nothing about the card fitted
// now, so it is left out. `gpuNow` is this PC's card as App read it (the most-VRAM GPU, `primaryGpu`,
// the pick session fingerprints stamp): `undefined` = the caller passed no card (no filtering, no
// line: as before), `null` or a name that identifies no card = Compy can't identify the card now (every
// session kept, and the line says it can't tie them). A session that recorded no card is kept and
// counted, so the line can say how many can't be tied. Two cards that tie on VRAM (WMI's AdapterRAM caps
// at 4 GB) could be picked in a different order here and at session start: that drops a session (no
// signal), never ties one to the wrong card (review nit; priorities.rs notes the same).

/** Windows' fallback adapters identify no card (mirrors priorities.rs `identifies_a_card`). */
function identifiesACard(name: string | null | undefined): name is string {
  const n = (name ?? "").trim().toLowerCase();
  return n !== "" && n !== "microsoft basic display adapter" && n !== "microsoft basic render driver";
}

/** How the sessions behind a GPU signal tie to the card in this PC now; absent = all on this card. */
export type GpuSignalUntied = { kind: "not-recorded"; count: number } | { kind: "card-unread" };

/** Sessions not recorded on another card than `gpuNow` (order kept). See the block comment above. */
export function sessionsOnThisCard(sessions: SessionSummary[], gpuNow: string | null | undefined): SessionSummary[] {
  if (gpuNow === undefined || !identifiesACard(gpuNow)) return sessions;
  const now = gpuNow.trim().toLowerCase();
  return sessions.filter((s) => {
    const then = s.hw_fingerprint?.gpu;
    return !identifiesACard(then) || then.trim().toLowerCase() === now;
  });
}

/** The tie of the sessions a signal was read from; undefined when every one is on this card (or the
 *  caller passed no card). */
export function untiedSessions(used: SessionSummary[], gpuNow: string | null | undefined): GpuSignalUntied | undefined {
  if (gpuNow === undefined) return undefined;
  if (!identifiesACard(gpuNow)) return used.length > 0 ? { kind: "card-unread" } : undefined;
  const count = used.filter((s) => !identifiesACard(s.hw_fingerprint?.gpu)).length;
  return count > 0 ? { kind: "not-recorded", count } : undefined;
}

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
  gpuNow?: string | null,
): { peakC: number; sessions: number; untied?: GpuSignalUntied } | null {
  const windowMs = TUNING_HOT_WINDOW_DAYS * 24 * 3600 * 1000;
  const used = sessionsOnThisCard(sessions, gpuNow)
    .filter((s) => {
      // P4-show-f1: a session behind another window the whole time is not a monitored play session.
      if (allBackground(s) || typeof s.peak_gpu_temp_c !== "number") return false;
      const started = Date.parse(s.started_at);
      return Number.isFinite(started) && now - started <= windowMs;
    })
    .slice(0, TUNING_HOT_MIN_SESSIONS);
  const temps = used.map((s) => s.peak_gpu_temp_c as number);
  if (temps.length < TUNING_HOT_MIN_SESSIONS) return null;
  if (temps.some((t) => t < TUNING_HOT_THRESHOLD_C)) return null; // not sustained
  const untied = untiedSessions(used, gpuNow);
  return { peakC: Math.max(...temps), sessions: temps.length, ...(untied ? { untied } : {}) };
}

// Sustained near-limit usage (spec 2026-06-12 §A): the second admissible headroom-pain signal.
// Threshold matches the backend's GPU-limited verdict (sessions.rs GPU_LIMITED_PCT = 95).
export const TUNING_USAGE_LIMIT_PCT = 95;

/** The share of a session's GPU readings at or above the limit that counts as "held there" — the
 *  same half-the-session rule as priorities.rs GPU_SUSTAINED_SHARE_PCT (P9-bottleneck-sustained). */
export const TUNING_USAGE_SUSTAINED_SHARE_PCT = 50;

/** A session held near the limit: its recorded GPU-load counts put at least half its readings at or
 *  above the limit. A peak alone (a row an older Compy wrote, with no counts) is one moment, so it
 *  never counts as "held" (P9-bottleneck-sustained). Decided on the counts, never a rounded share. */
export function sessionHeldNearLimit(s: SessionSummary): boolean {
  const load = s.gpu_load;
  if (!load || load.readings <= 0) return false;
  return load.busy * 100 >= load.readings * TUNING_USAGE_SUSTAINED_SHARE_PCT;
}

/**
 * Sustained near-limit GPU usage across the last `TUNING_HOT_MIN_SESSIONS` recent sessions (same
 * window/recency discipline as `gpuRunningHot`): each session must have HELD the limit for at least
 * half its readings, not merely touched it. Returns the worst peak + count, or null.
 */
export function gpuSustainedNearLimit(
  sessions: SessionSummary[],
  now: number = Date.now(),
  gpuNow?: string | null,
): { peakPct: number; sessions: number; untied?: GpuSignalUntied } | null {
  const windowMs = TUNING_HOT_WINDOW_DAYS * 24 * 3600 * 1000;
  const recent = sessionsOnThisCard(sessions, gpuNow)
    .filter((s) => {
      if (allBackground(s) || typeof s.peak_gpu_usage_pct !== "number") return false;
      const started = Date.parse(s.started_at);
      return Number.isFinite(started) && now - started <= windowMs;
    })
    .slice(0, TUNING_HOT_MIN_SESSIONS);
  if (recent.length < TUNING_HOT_MIN_SESSIONS) return null;
  if (!recent.every(sessionHeldNearLimit)) return null; // not sustained
  const untied = untiedSessions(recent, gpuNow);
  return {
    peakPct: Math.max(...recent.map((s) => s.peak_gpu_usage_pct as number)),
    sessions: recent.length,
    ...(untied ? { untied } : {}),
  };
}

// ── Evidence gate for tuning/OC-class OFFERS (spec 2026-06-12 §A — the tailoring law) ──────────
// A tuning push must name WHY this rig qualifies; the receipt IS the recommendation. Knowledge
// stays free in Learn — this gates only the recommending surfaces (Lab card, offers).

export type TuningEvidence =
  | { qualifies: true; reason: string; /** CR-tuning-gpu-other-card */ untied?: GpuSignalUntied }
  | { qualifies: false; reason: string };

/** Vendor-blind measured-headroom verdict (vendor gating stays in tuningGuideForVendor). `gpuNow`:
 *  this PC's card (see `sessionsOnThisCard`); sessions recorded on another card never qualify it. */
export function tuningEvidence(
  sessions: SessionSummary[],
  now: number = Date.now(),
  gpuNow?: string | null,
): TuningEvidence {
  const hot = gpuRunningHot(sessions, now, gpuNow);
  if (hot) {
    return {
      qualifies: true,
      reason: `your GPU peaked at ${hot.peakC}°C across your last ${hot.sessions} monitored sessions`,
      ...(hot.untied ? { untied: hot.untied } : {}),
    };
  }
  const limit = gpuSustainedNearLimit(sessions, now, gpuNow);
  if (limit) {
    return {
      qualifies: true,
      reason: `your GPU held ≥${TUNING_USAGE_LIMIT_PCT}% usage for at least half of each of your last ${limit.sessions} monitored sessions`,
      ...(limit.untied ? { untied: limit.untied } : {}),
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
  | "confounded" // another change landed → can't attribute
  | "unmeasured"; // item 8: this game's noise isn't measured, so the frames are shown, not called

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
  /** Item 8: no measured band for this game (or no post session it can judge): frames not called. */
  fpsUnmeasured: boolean;
  crashReported: boolean;
};

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function fmtPlaytime(secs: number): string {
  // Round to whole minutes FIRST, then split — rounding the minute remainder on its own can carry to
  // 60 and print "3h 60m" (e.g. 3h 59m 45s → round(59.75)=60). Rounding the total avoids the carry.
  const totalMin = Math.round(secs / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Same-game sessions that started strictly after the tune was armed (newest-first preserved). A
 *  session behind another window the whole time (P4-show-f1) is left out: its 1% low of 0 means
 *  "not measured", and read as a reading it would be a -100% regression. */
export function postTuneSessions(
  baseline: ArmedComparison,
  sessions: SessionSummary[],
): SessionSummary[] {
  const armedAt = Date.parse(baseline.armed_at);
  return sessions.filter(
    (s) =>
      !allBackground(s) &&
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
  /** CR-tuning-comparability: `get_tuning_comparability` (comparison.rs `post_comparability`): each
   *  later session and whether it can be judged against the tune's baseline session. A session not
   *  listed as comparable (or no list at all) is never judged: its frames are "can't call it". */
  postComparability?: readonly PostComparability[] | null,
): TuningMeasurement | null {
  if (!baseline || baseline.kind !== "tuning") return null;

  const post = postTuneSessions(baseline, sessions);
  const sessionsSince = post.length;
  const secsSince = post.reduce((sum, s) => sum + s.duration_secs, 0);
  const crashReported = baseline.crash_reported === true;
  const baselinePeakTempC = baseline.baseline_peak_temp_c ?? null;

  // Only the tune's OWN result may confound it: it must be a TUNING result for THIS baseline's game.
  // A stale fix result — or another game's tuning result — left un-dismissed must never flip this
  // measurement (Lab passes the unfiltered latest comparison; the filter lives here so no caller can
  // get it wrong). Fix-era results without a kind field count as fix → filtered out.
  const ownResult =
    result != null && result.kind === "tuning" && result.game === baseline.game ? result : null;

  // FPS held? Measurement item 8: every post session's 1% low is judged against the baseline on this
  // game's MEASURED as-is band: the band comparison.rs measured for this tune's baseline session (the
  // one source Trials judge on), carried on the tune's own result written since this arm. A drop past
  // its matching fall is the measurable form of "new stutters / instability"; a rise past the band an
  // improvement. Only sessions that read uncapped, like the band, are judged here (a capped game is
  // judged on the Rust side, never by a second cap rule here). No band: the frames aren't called.
  const band =
    ownResult?.at != null &&
    Date.parse(ownResult.at) >= Date.parse(baseline.armed_at) &&
    ownResult.game_noise != null &&
    ownResult.noise_fall_pct != null
      ? { ...ownResult.game_noise, fall_pct: ownResult.noise_fall_pct }
      : null;
  // CR-tuning-comparability: and only sessions the backend's comparability check (the one the tune's
  // first comparison is judged on: GPU, rig, driver, game build and the rest of `comparability.rs`)
  // reads as comparable with the baseline session. Any other session is not judged, never "too aggressive".
  // `started_at` is the session's id on both sides (the same recorded field); never normalise one side.
  const conditionsComparable = (s: SessionSummary) =>
    postComparability?.some((p) => p.started_at === s.started_at && p.comparable) === true;
  const comparable = (s: SessionSummary) =>
    band != null && band.cap?.state === "uncapped" && s.frame_cap?.state === "uncapped" && conditionsComparable(s);
  const fallPct = band?.fall_pct ?? null;
  const baseLow1 = baseline.baseline_low1_fps;
  const deltaPct = (low1: number): number | null =>
    baseLow1 > 0 ? round1(((low1 - baseLow1) / baseLow1) * 100) : null;
  const judged = post.filter(comparable);
  const fpsRegressed =
    fallPct != null &&
    judged.some((s) => {
      const d = deltaPct(s.low1_fps_est);
      return d != null && d < -fallPct;
    });
  const latest = post[0] ?? null;
  const low1DeltaPct = latest ? deltaPct(latest.low1_fps_est) : null;
  const fpsImproved =
    band != null && latest != null && comparable(latest) && low1DeltaPct != null && low1DeltaPct > band.low1_band_pct;
  // Frames "held" only when every post session was judged on the band (opus r1).
  const fpsUnmeasured = band == null || judged.length < post.length;
  const bandText = band != null ? `+${band.low1_band_pct}% / −${band.fall_pct}%` : "";
  const fallText = band != null ? `−${band.fall_pct}%` : "";
  // CR-tuning-comparability (opus r1): why frames went unjudged, in plain words. No band at all, or a
  // band with some sessions left out (another GPU, driver, game build, or frame cap).
  const unjudgedWhy =
    band == null
      ? "this game's noise between sessions isn't measured"
      : "some sessions since the tune can't be compared with your baseline: another GPU, driver, game build or frame cap";

  // Thermal payoff: compare the baseline peak to the WORST (hottest) post-tune peak — honest "it runs
  // cooler even at its hottest". A ≥3 °C drop clears sensor/ambient noise.
  const postPeaks = post
    .map((s) => s.peak_gpu_temp_c)
    .filter((t): t is number => typeof t === "number");
  const afterPeakTempC = postPeaks.length > 0 ? Math.max(...postPeaks) : null;
  const tempDropC =
    baselinePeakTempC != null && afterPeakTempC != null ? baselinePeakTempC - afterPeakTempC : null;
  const tempReal = tempDropC != null && tempDropC >= TUNING_REAL_TEMP_DROP_C;
  // The mirror of tempReal: the peak came in HOTTER by at least the real threshold. A tune whose whole
  // point was to run cooler landing here is a measured miss — the verdict must say so, never bury it
  // under "no measurable change" while the stat row shows the jump (honest-measurement law).
  const tempRose = tempDropC != null && tempDropC <= -TUNING_REAL_TEMP_DROP_C;

  const windowMet =
    sessionsSince >= TUNING_MIN_SESSIONS && secsSince >= TUNING_MIN_SECS && !crashReported;

  const progress = `${sessionsSince} session${sessionsSince === 1 ? "" : "s"}, ${fmtPlaytime(
    secsSince,
  )}`;
  const tempLine =
    tempDropC == null
      ? "Temps will show once a monitored session reports a peak."
      : tempReal
        ? `Peak GPU temp ${baselinePeakTempC}°C → ${afterPeakTempC}°C (−${tempDropC}°C) — a real drop.`
        : tempRose
          ? `Peak GPU temp ${baselinePeakTempC}°C → ${afterPeakTempC}°C (+${-tempDropC}°C) — hotter, not cooler.`
          : `Peak GPU temp ${baselinePeakTempC}°C → ${afterPeakTempC}°C — within sensor noise so far.`;

  // Precedence (honest): a reported crash is real regardless of anything else; then a confound voids
  // attribution; then a measured regression; then an improvement (gated on the window); else a null.
  let verdict: TuningVerdict;
  let headline: string;
  let detail: string;

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
    detail = `Your 1% low dropped past the ${fallText} this game moves between your sessions with nothing changed — new stutters. Step back up one increment in your tool.`;
  } else if (tempReal || fpsImproved) {
    if (windowMet) {
      verdict = "holding";
      headline = "Holding up so far";
      detail = `${tempLine} ${fpsUnmeasured ? `Frames not judged (${unjudgedWhy}), no` : "Frames held, no"} crashes flagged across ${progress}. Only your continued play proves it — keep playing and tell Compy if anything resets.`;
    } else {
      verdict = "too-early";
      headline = "Too early to call — keep playing";
      detail = `${tempLine} Looking good, but stability shows over time: ${progress} so far (needs ≥${TUNING_MIN_SESSIONS} sessions and ~3h with no crash).`;
    }
  } else if (tempRose) {
    // Frames held (no regression above), but the peak measured HOTTER — the opposite of what a cooling
    // tune is for. Lead with that truth; keep the neutral no-change verdict because the *stability*
    // axis (frames/crashes) didn't move, and peak-to-peak across sessions carries load/ambient swing
    // so this is a flag to watch, not proof the tune caused it (never over-claim causation either).
    verdict = "no-change";
    headline = fpsUnmeasured ? "Running warmer — frames not judged" : "Frames held — but it's running warmer";
    detail = `${tempLine} ${fpsUnmeasured ? `Compy can't call your 1% lows (${unjudgedWhy})` : `Your 1% lows stayed inside this game's measured ${bandText} band`}, but the hottest peak came in higher this window. Peak-to-peak swings with load and ambient, so watch it across another session or two rather than reading it as the tune backfiring — ${progress} so far.`;
  } else if (fpsUnmeasured) {
    // Item 8: nothing to call the frames on. Show them; never a null invented from a fixed floor.
    verdict = "unmeasured";
    headline = "Can't call the frames";
    detail = `${tempLine} ${band == null ? "Compy hasn't measured how much this game moves between your sessions with nothing changed" : "Compy can't compare every session since the tune with your baseline (another GPU, driver, game build or frame cap)"}, so it won't call the frames better or worse${low1DeltaPct != null ? ` (latest 1% low ${low1DeltaPct > 0 ? "+" : ""}${low1DeltaPct}% vs your baseline)` : ""} — ${progress} so far.`;
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
    fpsUnmeasured,
    crashReported,
  };
}
