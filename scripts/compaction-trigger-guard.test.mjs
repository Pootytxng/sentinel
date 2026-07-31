// bug→guard for issue #19: the documented native-compaction trigger point was an ESTIMATE that
// measurement disproved, and the model behind it was wrong in shape, not merely in value.
//
// `.claude/USAGE_ECONOMICS.md` and `NATIVE_COMPACT_FRACTION = [0.92, 0.95]` both claimed compaction
// fires at 92-95% of the window: "≈276-285k at 300000, ~140k at 150000". Neither was ever observed.
//
// Measured from real transcripts (the #19 trial, 2026-07-31) — every `compact_boundary` record with
// its `preTokens`, from two sessions that differed ONLY in the configured window:
//
//   window 300000, 3 boundaries: 269363, 268124, 270085   (mean 269191)
//   window 150000, 10 boundaries: 120028, 119774, 116698, 118352, 117320,
//                                 117694, 118077, 117462, 117099, 117145  (mean 117965)
//
// The fraction is NOT constant: 0.894-0.900 at 300k, 0.778-0.800 at 150k. The RESERVE is:
// 300000-269191 = 30809, 150000-117965 = 32035. Compaction fires a roughly fixed ~31k below the
// window, wherever the window is set.
//
// This is not a cosmetic correction. The fixed reserve is why a 150k window yields only ~79% usable
// context while 300k yields ~90% — the single largest term in the #19 verdict.
//
// These bands are evidence, not preference. Widening one to make a failure go away would restore
// exactly the defect this guard exists to prevent.

import { describe, expect, it } from "vitest";
import { NATIVE_COMPACT_RESERVE, nativeCompactPoint } from "./lib/compaction-window.mjs";

/** Observed `compact_boundary.preTokens`, grouped by the window the session actually ran under. */
const MEASURED = [
  { window: 300_000, points: [269_363, 268_124, 270_085] },
  { window: 150_000, points: [120_028, 119_774, 116_698, 118_352, 117_320, 117_694, 118_077, 117_462, 117_099, 117_145] },
];

describe("native compaction trigger point", () => {
  it("predicts every measured boundary within its band", () => {
    for (const { window, points } of MEASURED) {
      const { min, max } = nativeCompactPoint(window);
      for (const p of points) {
        expect(p, `window ${window}: measured boundary ${p} outside predicted ${min}-${max}`).toBeGreaterThanOrEqual(min);
        expect(p, `window ${window}: measured boundary ${p} outside predicted ${min}-${max}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it("rejects the disproven 92-95% fraction model at both windows", () => {
    // The old model's prediction, reconstructed. If a future edit reinstates a fraction, the
    // measured boundaries must fall outside it — that is what made the doc wrong.
    for (const { window, points } of MEASURED) {
      const lo = window * 0.92;
      const observedMax = Math.max(...points);
      expect(observedMax, `window ${window}: fraction model predicted >= ${lo}, measured max was ${observedMax}`).toBeLessThan(lo);
    }
  });

  it("holds the reserve roughly fixed rather than proportional", () => {
    // The load-bearing claim: doubling the window does not double the reserve.
    const reserves = MEASURED.map(({ window, points }) => window - points.reduce((a, b) => a + b, 0) / points.length);
    const [at300k, at150k] = reserves;
    expect(Math.abs(at300k - at150k)).toBeLessThan(5_000);
    for (const r of reserves) {
      expect(r).toBeGreaterThanOrEqual(NATIVE_COMPACT_RESERVE.min);
      expect(r).toBeLessThanOrEqual(NATIVE_COMPACT_RESERVE.max);
    }
  });

  it("makes the usable-context ratio between the two windows explicit", () => {
    // 269k usable vs 118k usable = 2.28x, not the 2.00x the window ratio suggests. The #19 verdict
    // rests on this number, so it is pinned rather than recomputed in prose.
    const usable = (w) => nativeCompactPoint(w).mean;
    const ratio = usable(300_000) / usable(150_000);
    expect(ratio).toBeGreaterThan(2.2);
    expect(ratio).toBeLessThan(2.35);
  });
});
