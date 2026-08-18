// bug→guard for issue #16: the usage audit's "compaction failed to fire" red flag used to be the
// literal `peakCtx > 200_000`. Raising CLAUDE_CODE_AUTO_COMPACT_WINDOW to 300000 (#15) made that
// literal fire on healthy sessions, so the trial's own measurement instrument cried wolf.
//
// These cases are the three the owner named. They must keep passing whatever the window becomes.

import { describe, expect, it } from "vitest";
import {
  DOCUMENTED_FALLBACK_WINDOW,
  NATIVE_COMPACT_RESERVE,
  describeWindow,
  flagPeakContext,
  nativeCompactCeiling,
  resolveCompactionWindow,
  usableHeadroom,
} from "./lib/compaction-window.mjs";

const ENV_KEY = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
const at300k = () => resolveCompactionWindow({ env: { [ENV_KEY]: "300000" } });

describe("compaction window resolution", () => {
  it("prefers the live environment over project settings", () => {
    const r = resolveCompactionWindow({
      env: { [ENV_KEY]: "300000" },
      settings: { env: { [ENV_KEY]: "150000" } },
    });
    expect(r).toMatchObject({ window: 300_000, source: "env", configured: true });
  });

  it("falls back to project settings when the environment is silent", () => {
    const r = resolveCompactionWindow({ env: {}, settings: { env: { [ENV_KEY]: "300000" } } });
    expect(r).toMatchObject({ window: 300_000, source: "settings", configured: true });
  });

  it("ignores an unusable value and reports it instead of silently coercing it", () => {
    for (const bad of ["", "   ", "abc", "0", "-200000", "1.5e3.2", "200_000", "NaN"]) {
      const r = resolveCompactionWindow({ env: { [ENV_KEY]: bad } });
      expect(r.window, `bad value ${JSON.stringify(bad)}`).toBe(DOCUMENTED_FALLBACK_WINDOW);
      expect(r.source).toBe("fallback");
      expect(r.configured).toBe(false);
      if (bad.trim() !== "") expect(r.ignored).toEqual([{ from: "env", value: bad }]);
    }
  });
});

describe("peak-context red flag derives from the configured window", () => {
  // CASE 1 — the exact regression this guard exists for.
  it("does NOT flag a 300k-configured session peaking above 200k", () => {
    const resolved = at300k();
    const rows = [
      { date: "2026-07-28", peakCtx: 201_000 },
      { date: "2026-07-29", peakCtx: 284_000 }, // native compaction range at 300k — healthy
      { date: "2026-07-29", peakCtx: 299_999 },
    ];
    const { over, threshold, flag } = flagPeakContext(rows, resolved);
    expect(threshold).toBe(300_000);
    expect(over).toEqual([]);
    expect(flag).toBeNull();
  });

  // CASE 2 — the flag must still do its job.
  it("DOES flag a session that genuinely exceeds its configured window", () => {
    const resolved = at300k();
    const rows = [
      { date: "2026-07-27", peakCtx: 250_000 }, // under the window — must not appear
      { date: "2026-07-28", peakCtx: 310_000 },
      { date: "2026-07-29", peakCtx: 420_000 },
    ];
    const { over, flag } = flagPeakContext(rows, resolved);
    expect(over.map((r) => r.peakCtx)).toEqual([310_000, 420_000]);
    expect(flag).toContain("2/3 sessions");
    expect(flag).toContain("configured window 300k");
    expect(flag).toContain("420k"); // worst first
    expect(flag).not.toContain("250k");
  });

  // CASE 3 — no configuration must be honest about what it is using.
  it("uses the documented fallback and SAYS it is a fallback", () => {
    const resolved = resolveCompactionWindow({ env: {}, settings: null });
    expect(resolved.window).toBe(DOCUMENTED_FALLBACK_WINDOW);
    const { threshold, over, flag } = flagPeakContext(
      [
        { date: "2026-07-28", peakCtx: 249_000 },
        { date: "2026-07-29", peakCtx: 280_000 },
      ],
      resolved,
    );
    expect(threshold).toBe(250_000);
    expect(over.map((r) => r.peakCtx)).toEqual([280_000]);
    expect(flag).toContain("fallback");
    expect(flag).toContain(ENV_KEY);
    expect(flag).not.toContain("configured window");
  });

  it("scales with whatever the window becomes, with no literal of its own", () => {
    const rows = [{ date: "2026-07-29", peakCtx: 500_000 }];
    expect(flagPeakContext(rows, resolveCompactionWindow({ env: { [ENV_KEY]: "1000000" } })).flag).toBeNull();
    expect(flagPeakContext(rows, resolveCompactionWindow({ env: { [ENV_KEY]: "400000" } })).flag).toContain("1/1");
  });

  it("survives missing and malformed rows", () => {
    expect(flagPeakContext([], at300k()).flag).toBeNull();
    expect(flagPeakContext(undefined, at300k()).flag).toBeNull();
    expect(flagPeakContext([{}, { peakCtx: null }], at300k()).flag).toBeNull();
    expect(flagPeakContext([{ peakCtx: 400_000 }], at300k()).flag).toContain("? 400k");
  });
});

describe("report basis line", () => {
  it("names the source so a reader never has to guess the threshold", () => {
    expect(describeWindow(at300k())).toContain("300k");
    expect(describeWindow(at300k())).toContain("in the environment");
    // the MEASURED compaction point: window − 33k reserve (see NATIVE_COMPACT_RESERVE for why the
    // old 77-80% fraction was wrong — it was fitted at one window and missed by 24k at the next).
    expect(describeWindow(at300k())).toMatch(/≈267k/);
    expect(describeWindow(resolveCompactionWindow({}))).toContain("documented fallback");
    expect(describeWindow(resolveCompactionWindow({ env: { [ENV_KEY]: "oops" } }))).toContain('ignored invalid env="oops"');
  });
});

// ---------------------------------------------------------------------------------------------
// 2026-08-18 — the compaction point is ADDITIVE, not proportional.
//
// Evidence: every transcript under ~/.claude/projects with >=20 assistant turns, split at the
// 2026-08-07 window change. Under the live 250000 window, 12+ independent sessions pin their peak
// turn at 216-217k (+/-1k). The retired 0.77-0.80 fraction predicted 192.5-200k and was short by
// ~24k. These cases fail if anyone reintroduces a proportional model.
describe("native compaction point is window − a fixed reserve", () => {
  it("reproduces the measured 250k ceiling", () => {
    // the number that was actually observed, 12+ times, in a +/-1k band
    expect(nativeCompactCeiling(250_000)).toBe(250_000 - NATIVE_COMPACT_RESERVE);
    expect(nativeCompactCeiling(250_000)).toBeGreaterThanOrEqual(216_000);
    expect(nativeCompactCeiling(250_000)).toBeLessThanOrEqual(218_000);
  });

  it("is additive: doubling the window adds the whole difference, it does not scale the reserve", () => {
    const a = nativeCompactCeiling(250_000);
    const b = nativeCompactCeiling(500_000);
    expect(b - a).toBe(250_000); // additive. a proportional model would give 250_000 * f.
  });

  it("REJECTS the retired proportional model at the live window", () => {
    // 0.77-0.80 of 250000 = 192.5k-200k. If a future edit restores the fraction, this goes red.
    expect(nativeCompactCeiling(250_000)).toBeGreaterThan(200_000);
  });

  it("never returns a negative ceiling for a tiny window", () => {
    expect(nativeCompactCeiling(1_000)).toBe(0);
  });

  it("headroom is computed from the corrected ceiling, not the old fraction", () => {
    const r = resolveCompactionWindow({ env: { [ENV_KEY]: "250000" } });
    const h = usableHeadroom(r, 59_000); // measured canonical-checkout floor, 2026-08-18
    expect(h.ceiling).toBe(217_000);
    expect(h.headroom).toBe(158_000); // the old model said 133_500 — 24.5k of phantom pressure
    expect(h.ok).toBe(true);
  });
});

// The flag must not re-raise sessions that predate the setting it is checking.
describe("peak flag ignores sessions from before the window was configured", () => {
  const rows = [
    { date: "2026-07-07", peakCtx: 378_000 }, // ran on the model default; no window was set
    { date: "2026-08-04", peakCtx: 514_000 }, // same
    { date: "2026-08-11", peakCtx: 217_000 }, // healthy under the 250k window
  ];
  const at250k = () => resolveCompactionWindow({ env: { [ENV_KEY]: "250000" } });

  it("still flags everything when no cutoff is given (unchanged behaviour)", () => {
    const { over, flag } = flagPeakContext(rows, at250k());
    expect(over).toHaveLength(2);
    expect(flag).toContain("2/3 sessions");
  });

  it("goes green once the pre-setting sessions are excluded", () => {
    const { over, flag, excluded, note } = flagPeakContext(rows, at250k(), { configuredSince: "2026-08-07" });
    expect(over).toEqual([]);
    expect(flag).toBeNull();
    expect(excluded).toBe(2);
    expect(note).toContain("0/1 sessions since 2026-08-07");
    expect(note).toContain("2 older sessions predate the setting");
  });

  it("still fires for a genuine post-setting breach", () => {
    const bad = [...rows, { date: "2026-08-15", peakCtx: 300_000 }];
    const { flag } = flagPeakContext(bad, at250k(), { configuredSince: "2026-08-07" });
    expect(flag).toContain("1/2 sessions");
    expect(flag).toContain("2026-08-15 300k");
  });

  it("keeps undated rows rather than silently dropping them", () => {
    const { over } = flagPeakContext([{ peakCtx: 400_000 }], at250k(), { configuredSince: "2026-08-07" });
    expect(over).toHaveLength(1);
  });
});
