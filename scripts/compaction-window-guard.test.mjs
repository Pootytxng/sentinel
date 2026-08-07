// bug→guard for issue #16: the usage audit's "compaction failed to fire" red flag used to be the
// literal `peakCtx > 200_000`. Raising CLAUDE_CODE_AUTO_COMPACT_WINDOW to 300000 (#15) made that
// literal fire on healthy sessions, so the trial's own measurement instrument cried wolf.
//
// These cases are the three the owner named. They must keep passing whatever the window becomes.

import { describe, expect, it } from "vitest";
import {
  DOCUMENTED_FALLBACK_WINDOW,
  describeWindow,
  flagPeakContext,
  resolveCompactionWindow,
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
    // the MEASURED compaction band, 77-80% of 300k (see NATIVE_COMPACT_FRACTION for why not 92-95%)
    expect(describeWindow(at300k())).toMatch(/231k-240k/);
    expect(describeWindow(resolveCompactionWindow({}))).toContain("documented fallback");
    expect(describeWindow(resolveCompactionWindow({ env: { [ENV_KEY]: "oops" } }))).toContain('ignored invalid env="oops"');
  });
});
