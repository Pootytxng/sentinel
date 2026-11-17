import { describe, it, expect } from "vitest";
import {
  measureTuning,
  postTuneSessions,
  gpuRunningHot,
  gpuSustainedNearLimit,
  sessionHeldNearLimit,
  tuningEvidence,
  TUNING_MIN_SECS,
  TUNING_USAGE_LIMIT_PCT,
} from "./tuning-measure";
import { tuningGuideForVendor } from "./tuning-guides";
import type { SessionSummary, ArmedComparison, ComparisonResult } from "../types";

// Honest-measurement law coverage: every verdict path, the time-qualification gate (≥3 sessions AND
// ~3h no-crash), the ≥3 °C real-temp-drop threshold, the FPS noise floor, the crash self-check, the
// confound guard — and the invariant that we NEVER emit a bare "stable".

const ARMED_AT = "2026-06-08T12:00:00Z";

function baseline(over: Partial<ArmedComparison> = {}): ArmedComparison {
  return {
    rec_id: "amd-gpu-undervolt",
    rec_title: "Undervolt (Adrenalin)",
    game: "game.exe",
    baseline_avg_fps: 138,
    baseline_low1_fps: 138,
    armed_at: ARMED_AT,
    kind: "tuning",
    baseline_peak_temp_c: 84,
    crash_reported: false,
    ...over,
  };
}

function sess(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    started_at: "2026-06-08T13:00:00Z",
    duration_secs: 3600,
    process_name: "game.exe",
    samples: 100,
    avg_fps: 140,
    avg_frametime_ms: 7.1,
    low1_fps_est: 138,
    peak_gpu_temp_c: 71,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_insight: null,
    frame_cap: { state: "uncapped" },
    ...over,
  };
}

// Measurement item 8: the tune's own result, written after the arm, carrying this game's measured
// as-is band (comparison.rs `game_noise`). The frames are judged on it, never on a fixed 3%.
function measured(low1_band_pct = 3): ComparisonResult {
  return {
    verdict: "no-change",
    kind: "tuning",
    game: "game.exe",
    at: "2026-06-08T19:00:00Z",
    game_noise: { low1_band_pct, sessions: 6, cap: { state: "uncapped" } },
    // noise_floor::fall_pct, as the Rust result carries it: 3 -> 3, 10 -> 9.0, 20.6 -> 17.0.
    noise_fall_pct: low1_band_pct <= 3 ? low1_band_pct : Math.floor(((100 * low1_band_pct) / (100 + low1_band_pct)) * 10) / 10,
  } as ComparisonResult;
}

// CR-tuning-comparability: every listed session read comparable with the baseline session.
const ok = (ss: SessionSummary[]) => ss.map((s) => ({ started_at: s.started_at, comparable: true }));

// Three same-game, post-tune sessions of ~1h each → clears both the ≥3 and ~3h gates.
function threeGoodSessions(): SessionSummary[] {
  return [
    sess({ started_at: "2026-06-08T18:00:00Z", peak_gpu_temp_c: 71 }),
    sess({ started_at: "2026-06-08T16:00:00Z", peak_gpu_temp_c: 70 }),
    sess({ started_at: "2026-06-08T14:00:00Z", peak_gpu_temp_c: 71 }),
  ];
}

describe("measureTuning", () => {
  it("returns null when there's no tuning baseline", () => {
    expect(measureTuning(null, [])).toBeNull();
    expect(measureTuning(baseline({ kind: "fix" }), threeGoodSessions())).toBeNull();
  });

  it("only counts same-game sessions started after the tune", () => {
    const sessions = [
      sess({ started_at: "2026-06-08T14:00:00Z" }), // after, same game ✓
      sess({ started_at: "2026-06-08T11:00:00Z" }), // BEFORE the tune ✗
      sess({ started_at: "2026-06-08T15:00:00Z", process_name: "other.exe" }), // other game ✗
    ];
    expect(postTuneSessions(baseline(), sessions)).toHaveLength(1);
  });

  it("skips a session behind another window the whole time: its 0 is not a regression (P4-show-f1)", () => {
    const behind = sess({ started_at: "2026-06-08T19:00:00Z", samples: 0, avg_fps: 0, low1_fps_est: 0, background_secs_excluded: 3500 });
    const sessions = [behind, ...threeGoodSessions()];
    expect(postTuneSessions(baseline(), sessions)).toHaveLength(3);
    expect(measureTuning(baseline(), sessions)!.fpsRegressed).toBe(false);
    const hot = (t: number, extra = {}) => sess({ peak_gpu_temp_c: t, peak_gpu_usage_pct: 99, ...extra });
    const now = Date.parse("2026-06-08T20:00:00Z");
    const behindHot = hot(90, { samples: 0, background_secs_excluded: 3500 });
    expect(gpuRunningHot([behindHot, hot(84), hot(82)], now)).toBeNull();
    expect(gpuSustainedNearLimit([behindHot, hot(84), hot(82)], now)).toBeNull();
  });

  it("HOLDING: ≥3 sessions, ~3h, temp dropped ≥3 °C, frames held, no crash", () => {
    const m = measureTuning(baseline(), threeGoodSessions(), null, ok(threeGoodSessions()))!;
    expect(m.verdict).toBe("holding");
    expect(m.headline).toBe("Holding up so far");
    expect(m.windowMet).toBe(true);
    expect(m.tempDropC).toBe(13); // 84 → worst post peak 71
    expect(m.tempReal).toBe(true);
    expect(m.detail).toMatch(/Only your continued play proves it/i);
    // Law: never a bare "stable" / "stable ✓".
    expect(`${m.headline} ${m.detail}`.toLowerCase()).not.toMatch(/\bstable\b/);
  });

  it("TOO EARLY: temp dropped but the window isn't met yet (only 1 session)", () => {
    const m = measureTuning(baseline(), [sess({ started_at: "2026-06-08T14:00:00Z" })], null, ok([sess({ started_at: "2026-06-08T14:00:00Z" })]))!;
    expect(m.verdict).toBe("too-early");
    expect(m.headline).toMatch(/Too early to call/i);
    expect(m.windowMet).toBe(false);
    expect(m.sessionsSince).toBe(1);
  });

  it("TOO EARLY: 3 sessions but under ~3h of play", () => {
    const short = [
      sess({ started_at: "2026-06-08T18:00:00Z", duration_secs: 1200 }),
      sess({ started_at: "2026-06-08T16:00:00Z", duration_secs: 1200 }),
      sess({ started_at: "2026-06-08T14:00:00Z", duration_secs: 1200 }),
    ];
    const m = measureTuning(baseline(), short, null, ok(short))!;
    expect(m.sessionsSince).toBe(3);
    expect(m.secsSince).toBeLessThan(TUNING_MIN_SECS);
    expect(m.verdict).toBe("too-early");
  });

  it("TOO AGGRESSIVE: a 1% low regression past the noise floor", () => {
    const sessions = [
      sess({ started_at: "2026-06-08T18:00:00Z", low1_fps_est: 120 }), // 138→120 = −13% < −3%
      sess({ started_at: "2026-06-08T16:00:00Z" }),
      sess({ started_at: "2026-06-08T14:00:00Z" }),
    ];
    const m = measureTuning(baseline(), sessions, measured(), ok(sessions))!;
    expect(m.verdict).toBe("too-aggressive");
    expect(m.fpsRegressed).toBe(true);
    expect(m.detail).toMatch(/step back up one increment/i);
  });

  it("TOO AGGRESSIVE: a user-reported crash overrides everything (even a great temp drop)", () => {
    const m = measureTuning(baseline({ crash_reported: true }), threeGoodSessions())!;
    expect(m.verdict).toBe("too-aggressive");
    expect(m.crashReported).toBe(true);
    expect(m.windowMet).toBe(false); // a crash voids the qualifying window
    expect(m.detail).toMatch(/crash, hang, or artifacts/i);
  });

  it("NO MEASURABLE CHANGE: frames held, temp drop under 3 °C (sensor noise) — an honest null", () => {
    const sessions = [
      sess({ started_at: "2026-06-08T18:00:00Z", peak_gpu_temp_c: 82 }), // 84→82 = 2 °C, sub-threshold
      sess({ started_at: "2026-06-08T16:00:00Z", peak_gpu_temp_c: 82 }),
      sess({ started_at: "2026-06-08T14:00:00Z", peak_gpu_temp_c: 83 }),
    ];
    const m = measureTuning(baseline(), sessions, measured(), ok(sessions))!;
    expect(m.verdict).toBe("no-change");
    expect(m.tempReal).toBe(false);
    expect(m.headline).toBe("No measurable change");
  });

  it("RUNNING WARMER: frames held but the peak rose ≥3 °C — never buried under 'no measurable change'", () => {
    // A cooling tune (undervolt) whose measured peak came in HOTTER. The old code fell to the
    // no-change branch and told the user "temps are where they were" while the stat row showed the
    // jump — the exact honest-measurement lie this module exists to prevent.
    const sessions = [
      sess({ started_at: "2026-06-08T18:00:00Z", peak_gpu_temp_c: 90 }), // 84 → 90 = +6 °C
      sess({ started_at: "2026-06-08T16:00:00Z", peak_gpu_temp_c: 89 }),
      sess({ started_at: "2026-06-08T14:00:00Z", peak_gpu_temp_c: 90 }),
    ];
    const m = measureTuning(baseline(), sessions, measured(), ok(sessions))!;
    expect(m.tempReal).toBe(false);
    expect(m.tempDropC).toBe(-6); // 84 → worst post peak 90
    expect(m.headline).toBe("Frames held — but it's running warmer");
    expect(m.headline).not.toMatch(/no measurable change/i);
    expect(m.detail).toMatch(/hotter, not cooler/i);
    expect(m.detail).not.toMatch(/where they were|within sensor noise/i);
  });

  it("fmtPlaytime never carries the minute remainder to '60m' (rounds total minutes first)", () => {
    // 3585 s = 59 m 45 s → the old `round((secs % 3600) / 60)` printed "60m"; rounding the total
    // first carries it to "1h". Progress copy is where the user sees this.
    const m = measureTuning(baseline(), [sess({ started_at: "2026-06-08T14:00:00Z", duration_secs: 3585 })])!;
    expect(m.detail).toMatch(/\b1h\b/);
    expect(m.detail).not.toMatch(/60m/);
  });

  it("CONFOUNDED: a Compy fix landed mid-window → no attribution (but not when a crash is real)", () => {
    const confound = { verdict: "confounded", kind: "tuning", game: "game.exe" } as ComparisonResult;
    const m = measureTuning(baseline(), threeGoodSessions(), confound)!;
    expect(m.verdict).toBe("confounded");
    expect(m.headline).toMatch(/Can't cleanly attribute/i);
    // A real crash still wins over a confound.
    const crashed = measureTuning(baseline({ crash_reported: true }), threeGoodSessions(), confound)!;
    expect(crashed.verdict).toBe("too-aggressive");
  });

  it("EXPIRED baseline is surfaced honestly via the confounded branch copy", () => {
    const expired = { verdict: "expired", kind: "tuning", game: "game.exe" } as ComparisonResult;
    const m = measureTuning(baseline(), threeGoodSessions(), expired)!;
    expect(m.verdict).toBe("confounded");
    expect(m.detail).toMatch(/too old to compare/i);
  });

  it("only the tune's OWN result confounds — a stale fix result or another game's never does", () => {
    // A stale, un-dismissed FIX result (Lab passes the unfiltered latest comparison) — no flip.
    const staleFix = { verdict: "confounded", kind: "fix", game: "game.exe" } as ComparisonResult;
    expect(measureTuning(baseline(), threeGoodSessions(), staleFix, ok(threeGoodSessions()))!.verdict).toBe("holding");
    // A fix-era result without a kind field counts as fix → also filtered out.
    const fixEra = { verdict: "expired", game: "game.exe" } as ComparisonResult;
    expect(measureTuning(baseline(), threeGoodSessions(), fixEra, ok(threeGoodSessions()))!.verdict).toBe("holding");
    // Another game's tuning result — no flip either.
    const otherGame = { verdict: "confounded", kind: "tuning", game: "other.exe" } as ComparisonResult;
    expect(measureTuning(baseline(), threeGoodSessions(), otherGame, ok(threeGoodSessions()))!.verdict).toBe("holding");
  });

  it("HOLDING via an FPS gain even without a temp drop, once the window is met", () => {
    const sessions = [
      sess({ started_at: "2026-06-08T18:00:00Z", low1_fps_est: 150, peak_gpu_temp_c: 84 }),
      sess({ started_at: "2026-06-08T16:00:00Z", low1_fps_est: 150, peak_gpu_temp_c: 84 }),
      sess({ started_at: "2026-06-08T14:00:00Z", low1_fps_est: 150, peak_gpu_temp_c: 84 }),
    ];
    const m = measureTuning(baseline(), sessions, measured(), ok(sessions))!;
    expect(m.fpsImproved).toBe(true);
    expect(m.tempReal).toBe(false);
    expect(m.verdict).toBe("holding");
  });

  it("item 8: with no measured band the frames are shown, never called on a fixed 3%", () => {
    // A −13% 1% low was "too aggressive" past ±3%; a +9% was a gain. No band: neither is called.
    const drop = [
      sess({ started_at: "2026-06-08T18:00:00Z", low1_fps_est: 120 }),
      sess({ started_at: "2026-06-08T16:00:00Z" }),
      sess({ started_at: "2026-06-08T14:00:00Z" }),
    ];
    const d = measureTuning(baseline(), drop, null, ok(drop))!;
    expect(d.fpsRegressed).toBe(false);
    expect(d.fpsUnmeasured).toBe(true);
    expect(d.verdict).toBe("holding"); // the real temp drop still stands on its own
    expect(d.detail).toMatch(/Frames not judged/);
    const gain = [84, 84, 84].map((t, i) =>
      sess({ started_at: `2026-06-08T1${4 + 2 * i}:00:00Z`, low1_fps_est: 150, peak_gpu_temp_c: t }),
    );
    const g = measureTuning(baseline(), gain, null, ok(gain))!;
    expect(g.fpsImproved).toBe(false);
    expect(g.verdict).toBe("unmeasured");
    expect(g.headline).toBe("Can't call the frames");
    expect(g.detail).toMatch(/\+8\.7% vs your baseline/);
    expect(g.detail).not.toMatch(/noise floor|±3%/);
    // A result written before this arm (an older tune's) carries no band for this one.
    const old = { ...measured(), at: "2026-06-08T11:00:00Z" } as ComparisonResult;
    expect(measureTuning(baseline(), gain, old)!.verdict).toBe("unmeasured");
  });

  it("item 8: judged on the game's measured band, both ways, and only sessions that read uncapped", () => {
    const drop = [
      sess({ started_at: "2026-06-08T18:00:00Z", low1_fps_est: 120 }), // −13%
      sess({ started_at: "2026-06-08T16:00:00Z" }),
      sess({ started_at: "2026-06-08T14:00:00Z" }),
    ];
    // Inside a measured ±20.6% band (its matching fall is −17.1%): not too aggressive.
    expect(measureTuning(baseline(), drop, measured(20.6), ok(drop))!.fpsRegressed).toBe(false);
    expect(measureTuning(baseline(), drop, measured(10), ok(drop))!.fpsRegressed).toBe(true);
    // The matching fall is noise_floor::fall_pct's B/(1+B): +20.6% ↔ −17.08% (the Rust test's numbers).
    const at = (low1: number) => [sess({ started_at: "2026-06-08T18:00:00Z", low1_fps_est: low1 })];
    expect(measureTuning(baseline(), at(138 * 0.828), measured(20.6), ok(at(138 * 0.828)))!.fpsRegressed).toBe(true); // −17.2%
    expect(measureTuning(baseline(), at(138 * 0.83), measured(20.6), ok(at(138 * 0.83)))!.fpsRegressed).toBe(false); // −17.0%
    // At a 3% band the fall is 3% too (MIN_CLAIM_PCT): a −2.9% drop is not "too aggressive".
    expect(measureTuning(baseline(), at(138 * 0.971), measured(3), ok(at(138 * 0.971)))!.fpsRegressed).toBe(false);
    // A result without the Rust fall carries no band for the frames.
    const noFall = { ...measured(20.6), noise_fall_pct: null } as ComparisonResult;
    expect(measureTuning(baseline(), drop, noFall, ok(drop))!.fpsUnmeasured).toBe(true);
    // One unjudged session means the frames aren't "held".
    const mixed = [drop[1], { ...drop[2], frame_cap: null }];
    const mm = measureTuning(baseline(), mixed, measured(20.6), ok(mixed))!;
    expect(mm.fpsUnmeasured).toBe(true);
    expect(mm.detail).not.toMatch(/Frames held/);
    // A session whose cap state isn't read uncapped isn't judged here.
    const capped = drop.map((s) => ({ ...s, frame_cap: { state: "capped" as const, at_fps: 144 } }));
    const c = measureTuning(baseline(), capped, measured(10), ok(capped))!;
    expect(c.fpsRegressed).toBe(false);
    expect(c.fpsUnmeasured).toBe(true);
  });
  it("CR-tuning-comparability: a later session that can't be compared with the baseline is never 'too aggressive'", () => {
    const drop = [
      sess({ started_at: "2026-06-08T18:00:00Z", low1_fps_est: 120 }), // −13%, past a measured 10% band's fall
      sess({ started_at: "2026-06-08T16:00:00Z" }),
      sess({ started_at: "2026-06-08T14:00:00Z" }),
    ];
    expect(measureTuning(baseline(), drop, measured(10), ok(drop))!.verdict).toBe("too-aggressive");
    // The dropping session was on another GPU / driver / build (the backend's comparability check).
    const notComparable = ok(drop).map((p, i) => (i === 0 ? { ...p, comparable: false } : p));
    const m = measureTuning(baseline(), drop, measured(10), notComparable)!;
    expect(m.fpsRegressed).toBe(false);
    expect(m.fpsUnmeasured).toBe(true);
    expect(m.verdict).not.toBe("too-aggressive");
    // The reason given is the real one: the noise IS measured; a session couldn't be compared.
    expect(m.detail).toMatch(/can't be compared with your baseline: another GPU, driver, game build or frame cap/);
    expect(m.detail).not.toMatch(/isn't measured/);
    // A session the list doesn't name, or no list at all: not judged either.
    expect(measureTuning(baseline(), drop, measured(10), ok(drop.slice(1)))!.fpsRegressed).toBe(false);
    expect(measureTuning(baseline(), drop, measured(10), null)!.fpsUnmeasured).toBe(true);
  });

  // CR-tuning-temp-comparability: the temperature claim reads peaks only from sessions the same
  // comparability list marks comparable; a peak from any other session is never compared.
  it("CR-tuning-temp-comparability: a non-comparable session's peak makes no temperature claim", () => {
    const cool = threeGoodSessions(); // 84 → 71: a real drop when every session is comparable
    expect(measureTuning(baseline(), cool, null, ok(cool))!.tempReal).toBe(true);
    // Every session on another GPU / driver / build: no drop is claimed and the line says why.
    const none = ok(cool).map((p) => ({ ...p, comparable: false }));
    const m = measureTuning(baseline(), cool, null, none)!;
    expect(m).toMatchObject({ afterPeakTempC: null, tempDropC: null, tempReal: false });
    expect(m.verdict).not.toBe("holding");
    expect(m.detail).toMatch(/Temps not compared: the sessions since the tune can't be compared with your baseline/);
    expect(m.detail).not.toMatch(/a real drop/);
    // No list at all: nothing is comparable, so nothing is claimed either.
    expect(measureTuning(baseline(), cool, null, null)!.tempReal).toBe(false);
  });

  it("CR-tuning-temp-comparability: the hottest peak and a 'hotter' claim come only from comparable sessions", () => {
    // The 95 °C session ran on another driver: it is neither the worst peak nor a 'hotter' claim.
    const ss = [sess({ started_at: "2026-06-08T18:00:00Z", peak_gpu_temp_c: 95 }), ...threeGoodSessions().slice(1)];
    const list = ok(ss).map((p, i) => (i === 0 ? { ...p, comparable: false } : p));
    const m = measureTuning(baseline(), ss, null, list)!;
    expect(m.afterPeakTempC).toBe(71);
    expect(m.tempDropC).toBe(13);
    expect(m.detail).not.toMatch(/hotter/);
    expect(m.detail).toMatch(/Sessions that can't be compared with your baseline are left out/);
    // The same hot session counted as comparable would be a real rise.
    const rose = measureTuning(baseline(), ss, null, ok(ss))!;
    expect(rose.afterPeakTempC).toBe(95);
    expect(rose.detail).toMatch(/hotter, not cooler/);
  });
});

describe("gpuRunningHot — the Check nudge signal (bathroom law)", () => {
  it("fires only on SUSTAINED warmth — the last 3 temp'd sessions all at/over the threshold", () => {
    // `now` pinned just after the 2026-06-08 fixtures so the 14-day window always includes them.
    // Without it (relying on Date.now()) this positive-result test rots — it silently aged out once
    // real time passed 14 days beyond the hardcoded fixture date.
    const hot = gpuRunningHot(
      [sess({ peak_gpu_temp_c: 84 }), sess({ peak_gpu_temp_c: 82 }), sess({ peak_gpu_temp_c: 81 })],
      Date.parse("2026-06-08T20:00:00Z"),
    );
    expect(hot).toEqual({ peakC: 84, sessions: 3 });
  });

  it("stays silent when a recent session ran cool (not sustained)", () => {
    expect(
      gpuRunningHot([sess({ peak_gpu_temp_c: 84 }), sess({ peak_gpu_temp_c: 68 }), sess({ peak_gpu_temp_c: 82 })]),
    ).toBeNull();
  });

  it("stays silent with too few temp'd sessions (not enough evidence)", () => {
    expect(gpuRunningHot([sess({ peak_gpu_temp_c: 90 }), sess({ peak_gpu_temp_c: 90 })])).toBeNull();
    // Sessions without a recorded GPU temp don't count toward the window.
    expect(
      gpuRunningHot([
        sess({ peak_gpu_temp_c: 90 }),
        sess({ peak_gpu_temp_c: null }),
        sess({ peak_gpu_temp_c: 90 }),
      ]),
    ).toBeNull();
  });

  it("stays silent when the hot sessions are STALE — warmth is a claim about now (recency window)", () => {
    const NOW = Date.parse("2026-07-15T12:00:00Z"); // > 14 days after the fixture sessions
    // Three hot sessions, all older than the window → no nudge off month-old history.
    expect(gpuRunningHot([sess({ peak_gpu_temp_c: 90 }), sess({ peak_gpu_temp_c: 90 }), sess({ peak_gpu_temp_c: 90 })], NOW)).toBeNull();
    // Two recent hot + one stale hot → the stale one can't complete the evidence window.
    expect(
      gpuRunningHot(
        [
          sess({ started_at: "2026-07-14T12:00:00Z", peak_gpu_temp_c: 90 }),
          sess({ started_at: "2026-07-13T12:00:00Z", peak_gpu_temp_c: 90 }),
          sess({ started_at: "2026-05-01T12:00:00Z", peak_gpu_temp_c: 90 }),
        ],
        NOW,
      ),
    ).toBeNull();
    // Three recent hot → fires.
    expect(
      gpuRunningHot(
        [
          sess({ started_at: "2026-07-14T12:00:00Z", peak_gpu_temp_c: 90 }),
          sess({ started_at: "2026-07-13T12:00:00Z", peak_gpu_temp_c: 88 }),
          sess({ started_at: "2026-07-12T12:00:00Z", peak_gpu_temp_c: 86 }),
        ],
        NOW,
      ),
    ).toEqual({ peakC: 90, sessions: 3 });
  });

  it("an unparseable session start time counts as NOT recent (never nudge off bad data)", () => {
    expect(
      gpuRunningHot([
        sess({ peak_gpu_temp_c: 90, started_at: "not a date" }),
        sess({ peak_gpu_temp_c: 90 }),
        sess({ peak_gpu_temp_c: 90 }),
      ]),
    ).toBeNull();
  });
});

describe("measureTuning — zero-session honesty (honest-measurement law)", () => {
  it("ZERO measured sessions is 'nothing measured yet', never an invented null verdict", () => {
    const m = measureTuning(baseline(), [])!;
    expect(m.sessionsSince).toBe(0);
    expect(m.verdict).toBe("too-early");
    expect(m.headline).toBe("Nothing measured yet");
    expect(m.headline).not.toMatch(/no measurable change/i);
  });

  it("a reported crash still wins over the empty window (real data beats no data)", () => {
    const m = measureTuning(baseline({ crash_reported: true }), [])!;
    expect(m.verdict).toBe("too-aggressive");
    expect(m.crashReported).toBe(true);
  });
});

// ── §A tailoring gate (spec 2026-06-12) — evidence verdicts, pure + pinned ──

describe("tuningEvidence", () => {
  const NOW = Date.parse("2026-06-08T20:00:00Z");
  const hotSessions = [
    sess({ started_at: "2026-06-08T18:00:00Z", peak_gpu_temp_c: 92, peak_gpu_usage_pct: 70 }),
    sess({ started_at: "2026-06-08T16:00:00Z", peak_gpu_temp_c: 85, peak_gpu_usage_pct: 70 }),
    sess({ started_at: "2026-06-08T14:00:00Z", peak_gpu_temp_c: 88, peak_gpu_usage_pct: 70 }),
  ];
  const nearLimitSessions = [
    sess({ started_at: "2026-06-08T18:00:00Z", peak_gpu_temp_c: 65, peak_gpu_usage_pct: 99, gpu_load: { readings: 600, busy: 540 } }),
    sess({ started_at: "2026-06-08T16:00:00Z", peak_gpu_temp_c: 64, peak_gpu_usage_pct: 97, gpu_load: { readings: 600, busy: 300 } }),
    sess({ started_at: "2026-06-08T14:00:00Z", peak_gpu_temp_c: 66, peak_gpu_usage_pct: 96, gpu_load: { readings: 600, busy: 480 } }),
  ];
  const coolQuietSessions = [
    sess({ started_at: "2026-06-08T18:00:00Z", peak_gpu_temp_c: 65, peak_gpu_usage_pct: 70 }),
    sess({ started_at: "2026-06-08T16:00:00Z", peak_gpu_temp_c: 64, peak_gpu_usage_pct: 72 }),
    sess({ started_at: "2026-06-08T14:00:00Z", peak_gpu_temp_c: 66, peak_gpu_usage_pct: 68 }),
  ];

  it("sustained heat qualifies, and the reason quotes the measured signal", () => {
    const e = tuningEvidence(hotSessions, NOW);
    expect(e.qualifies).toBe(true);
    expect(e.reason).toContain("92°C");
    expect(e.reason).toContain("last 3 monitored sessions");
  });

  it("sustained near-limit usage qualifies when temps don't", () => {
    expect(gpuRunningHot(hotSessions.map((s) => ({ ...s, peak_gpu_temp_c: 60 })), NOW)).toBeNull();
    const e = tuningEvidence(nearLimitSessions, NOW);
    expect(e.qualifies).toBe(true);
    expect(e.reason).toContain(`≥${TUNING_USAGE_LIMIT_PCT}% usage`);
  });

  it("no evidence → does NOT qualify, with an honest reason (never a generic push)", () => {
    const e = tuningEvidence(coolQuietSessions, NOW);
    expect(e.qualifies).toBe(false);
    expect(e.reason).toContain("nothing measured on this rig");
    // No sessions at all is the same honest answer.
    expect(tuningEvidence([], NOW).qualifies).toBe(false);
  });

  it("near-limit usage needs the SUSTAINED window — one cool/old session breaks it", () => {
    expect(gpuSustainedNearLimit(nearLimitSessions.slice(0, 2), NOW)).toBeNull();
    const mixed = [...nearLimitSessions];
    mixed[1] = sess({ ...mixed[1], peak_gpu_usage_pct: 80, gpu_load: { readings: 600, busy: 0 } });
    expect(gpuSustainedNearLimit(mixed, NOW)).toBeNull();
    const stale = nearLimitSessions.map((s) => ({ ...s, started_at: "2026-05-01T12:00:00Z" }));
    expect(gpuSustainedNearLimit(stale, NOW)).toBeNull();
  });

  // P9-bottleneck-sustained: "held ≥95%" was read off each session's PEAK, so one loading-screen
  // spike per session made three sessions "sustained". A session counts only when its recorded GPU
  // load puts at least half its readings at the limit; a peak with no counts is one moment.
  it("a peak alone never counts as held — the session's own readings must sit at the limit for half of it", () => {
    const peaksOnly = nearLimitSessions.map((s) => ({ ...s, gpu_load: undefined }));
    expect(gpuSustainedNearLimit(peaksOnly, NOW)).toBeNull();
    expect(tuningEvidence(peaksOnly, NOW).qualifies).toBe(false);
    const brief = [...nearLimitSessions];
    brief[2] = sess({ ...brief[2], gpu_load: { readings: 600, busy: 299 } }); // just under half
    expect(gpuSustainedNearLimit(brief, NOW)).toBeNull();
    expect(sessionHeldNearLimit(sess({ gpu_load: { readings: 600, busy: 300 } }))).toBe(true);
    expect(sessionHeldNearLimit(sess({ gpu_load: { readings: 0, busy: 0 } }))).toBe(false);
    expect(tuningEvidence(nearLimitSessions, NOW).reason).toContain("for at least half of each");
  });

  it("NVIDIA rigs get NO tuning surface at all (vendor-honesty rule #5 — pinned)", () => {
    // v1 ships only the hardware-verified AMD guide; the evidence gate composes BEHIND this.
    expect(tuningGuideForVendor("nvidia")).toBeNull();
    expect(tuningGuideForVendor("intel")).toBeNull();
    expect(tuningGuideForVendor("amd")).not.toBeNull();
  });
});

// CR-tuning-gpu-other-card (P9-session-on-this-hardware review SHOULD-FIX): a GPU signal from sessions
// recorded on another graphics card never qualifies the card in this PC now; sessions that can't be
// tied (no card recorded, or this PC's card unidentified) still count, and say so.
describe("CR-tuning-gpu-other-card: GPU signals read only sessions on this card", () => {
  const NOW = Date.parse("2026-06-08T20:00:00Z");
  const THIS = "AMD Radeon RX 9070 XT";
  const OTHER = "NVIDIA GeForce GTX 1060";
  const on = (gpu: string | null, over: Partial<SessionSummary>): SessionSummary =>
    sess({ ...over, ...(gpu ? { hw_fingerprint: { hash: "h", gpu, gpu_driver: "1", ram_gb: 32, display: "" } } : {}) });
  const held = (gpu: string | null, hour: number) =>
    on(gpu, {
      started_at: `2026-06-08T${String(hour).padStart(2, "0")}:00:00Z`,
      peak_gpu_temp_c: 65,
      peak_gpu_usage_pct: 99,
      gpu_load: { readings: 600, busy: 540 },
    });
  const warm = (gpu: string | null, hour: number) =>
    on(gpu, { started_at: `2026-06-08T${String(hour).padStart(2, "0")}:00:00Z`, peak_gpu_temp_c: 90, peak_gpu_usage_pct: 70 });

  it("another card's sessions never make this card 'held near the limit' or 'running warm'", () => {
    const heldElsewhere = [held(OTHER, 18), held(OTHER, 16), held(OTHER, 14)];
    expect(gpuSustainedNearLimit(heldElsewhere, NOW, THIS)).toBeNull();
    const warmElsewhere = [warm(OTHER, 18), warm(OTHER, 16), warm(OTHER, 14)];
    expect(gpuRunningHot(warmElsewhere, NOW, THIS)).toBeNull();
    expect(tuningEvidence([...heldElsewhere], NOW, THIS).qualifies).toBe(false);
    expect(tuningEvidence([...warmElsewhere], NOW, THIS).qualifies).toBe(false);
  });

  it("this card's sessions decide past newer ones from another card; names compare trimmed, case-folded", () => {
    const sessions = [held(OTHER, 19), warm(OTHER, 18), held(` ${THIS.toLowerCase()} `, 16), held(THIS, 14), held(THIS, 12)];
    const limit = gpuSustainedNearLimit(sessions, NOW, THIS);
    expect(limit).toMatchObject({ sessions: 3 });
    expect(limit?.untied).toBeUndefined();
    const e = tuningEvidence(sessions, NOW, THIS);
    expect(e.qualifies).toBe(true);
    expect(e.qualifies && e.untied).toBeFalsy();
  });

  it("sessions that recorded no card count, and say how many can't be tied", () => {
    const sessions = [held(null, 18), held(THIS, 16), held(null, 14)];
    expect(gpuSustainedNearLimit(sessions, NOW, THIS)?.untied).toEqual({ kind: "not-recorded", count: 2 });
    const e = tuningEvidence(sessions, NOW, THIS);
    expect(e.qualifies && e.untied).toEqual({ kind: "not-recorded", count: 2 });
  });

  it.each([null, "Microsoft Basic Display Adapter", "  "])(
    "this PC's card unidentified (%j): every session kept, and the signal says it can't tie them",
    (now) => {
      const sessions = [warm(OTHER, 18), warm(THIS, 16), warm(null, 14)];
      expect(gpuRunningHot(sessions, NOW, now)).toMatchObject({ sessions: 3, untied: { kind: "card-unread" } });
    },
  );

  it("no card passed (an older caller): as before, nothing filtered and no tie line", () => {
    const sessions = [held(OTHER, 18), held(OTHER, 16), held(OTHER, 14)];
    const limit = gpuSustainedNearLimit(sessions, NOW);
    expect(limit).toMatchObject({ sessions: 3 });
    expect(limit?.untied).toBeUndefined();
  });
});
