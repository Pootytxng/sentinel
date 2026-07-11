import { describe, it, expect } from "vitest";
import { readoutStats } from "./monitor-console-data";

// v3 T2 guards: readouts are pure derivations of the real windows — empty ⇒ null (em-dash in the
// UI, never 0), and the spike count uses the SAME detector as the trace markers (one source).

describe("readoutStats — measured only, null when unmeasured", () => {
  it("empty windows ⇒ all null (nothing fabricated)", () => {
    expect(readoutStats([], [], 6.06)).toEqual({
      maxFps: null,
      avgFps: null,
      lowestLatencyMs: null,
      spikeCount: null,
    });
  });

  it("derives max/avg fps from the fps window, lowest latency + spikes from the frametime window", () => {
    const s = readoutStats([120, 144, 138], [7, 7.2, 41, 6.8], 6.06);
    expect(s.maxFps).toBe(144);
    expect(s.avgFps).toBeCloseTo(134, 0);
    expect(s.lowestLatencyMs).toBeCloseTo(6.8);
    expect(s.spikeCount).toBe(1); // only the 41 ms sample trips 2×median AND budget
  });

  it("flat frametimes ⇒ zero spikes (a count of 0 is a real measurement, not a null)", () => {
    expect(readoutStats([100], [7, 7.1, 6.9], 6.06).spikeCount).toBe(0);
  });
});
