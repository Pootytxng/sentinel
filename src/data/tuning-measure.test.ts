import { describe, it, expect } from "vitest";
import {
  measureTuning,
  postTuneSessions,
  gpuRunningHot,
  gpuSustainedNearLimit,
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
    ...over,
  };
}

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

  it("HOLDING: ≥3 sessions, ~3h, temp dropped ≥3 °C, frames held, no crash", () => {
    const m = measureTuning(baseline(), threeGoodSessions())!;
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
    const m = measureTuning(baseline(), [sess({ started_at: "2026-06-08T14:00:00Z" })])!;
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
    const m = measureTuning(baseline(), short)!;
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
    const m = measureTuning(baseline(), sessions)!;
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
    const m = measureTuning(baseline(), sessions)!;
    expect(m.verdict).toBe("no-change");
    expect(m.tempReal).toBe(false);
    expect(m.headline).toBe("No measurable change");
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
    expect(measureTuning(baseline(), threeGoodSessions(), staleFix)!.verdict).toBe("holding");
    // A fix-era result without a kind field counts as fix → also filtered out.
    const fixEra = { verdict: "expired", game: "game.exe" } as ComparisonResult;
    expect(measureTuning(baseline(), threeGoodSessions(), fixEra)!.verdict).toBe("holding");
    // Another game's tuning result — no flip either.
    const otherGame = { verdict: "confounded", kind: "tuning", game: "other.exe" } as ComparisonResult;
    expect(measureTuning(baseline(), threeGoodSessions(), otherGame)!.verdict).toBe("holding");
  });

  it("HOLDING via an FPS gain even without a temp drop, once the window is met", () => {
    const sessions = [
      sess({ started_at: "2026-06-08T18:00:00Z", low1_fps_est: 150, peak_gpu_temp_c: 84 }),
      sess({ started_at: "2026-06-08T16:00:00Z", low1_fps_est: 150, peak_gpu_temp_c: 84 }),
      sess({ started_at: "2026-06-08T14:00:00Z", low1_fps_est: 150, peak_gpu_temp_c: 84 }),
    ];
    const m = measureTuning(baseline(), sessions)!;
    expect(m.fpsImproved).toBe(true);
    expect(m.tempReal).toBe(false);
    expect(m.verdict).toBe("holding");
  });
});

describe("gpuRunningHot — the Check nudge signal (bathroom law)", () => {
  it("fires only on SUSTAINED warmth — the last 3 temp'd sessions all at/over the threshold", () => {
    const hot = gpuRunningHot([sess({ peak_gpu_temp_c: 84 }), sess({ peak_gpu_temp_c: 82 }), sess({ peak_gpu_temp_c: 81 })]);
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
    sess({ started_at: "2026-06-08T18:00:00Z", peak_gpu_temp_c: 65, peak_gpu_usage_pct: 99 }),
    sess({ started_at: "2026-06-08T16:00:00Z", peak_gpu_temp_c: 64, peak_gpu_usage_pct: 97 }),
    sess({ started_at: "2026-06-08T14:00:00Z", peak_gpu_temp_c: 66, peak_gpu_usage_pct: 96 }),
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
    mixed[1] = sess({ ...mixed[1], peak_gpu_usage_pct: 80 });
    expect(gpuSustainedNearLimit(mixed, NOW)).toBeNull();
    const stale = nearLimitSessions.map((s) => ({ ...s, started_at: "2026-05-01T12:00:00Z" }));
    expect(gpuSustainedNearLimit(stale, NOW)).toBeNull();
  });

  it("NVIDIA rigs get NO tuning surface at all (vendor-honesty rule #5 — pinned)", () => {
    // v1 ships only the hardware-verified AMD guide; the evidence gate composes BEHIND this.
    expect(tuningGuideForVendor("nvidia")).toBeNull();
    expect(tuningGuideForVendor("intel")).toBeNull();
    expect(tuningGuideForVendor("amd")).not.toBeNull();
  });
});
