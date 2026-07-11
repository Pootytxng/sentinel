import { spikeIndices } from "../design/console/Oscilloscope";

// Monitor console v3 readout derivations (plan 2026-07-10-monitor-v3-ribbon, Task 2). PURE — the
// values come from the SAME real buffers the traces draw (the caller's polled fps window + the
// backend's per-frame frametime window). Empty window ⇒ null (the UI renders an honest em-dash,
// never a fabricated 0). Labels use the owner's consumer-market terms (UI_VISION_BACKLOG §A0
// item 6): MAX FPS · AVG FPS · LOWEST LATENCY · SPIKES — terms label MEASURED values only.

export type ReadoutStats = {
  maxFps: number | null;
  avgFps: number | null;
  /** Best (minimum) frametime in the window, ms — the "LOWEST LATENCY" readout. */
  lowestLatencyMs: number | null;
  /** Exact-moment spike count in the frametime window (same detector the trace markers use). */
  spikeCount: number | null;
};

export function readoutStats(
  fpsWin: number[],
  ftWin: number[],
  budget?: number,
): ReadoutStats {
  return {
    maxFps: fpsWin.length ? Math.max(...fpsWin) : null,
    avgFps: fpsWin.length ? fpsWin.reduce((a, b) => a + b, 0) / fpsWin.length : null,
    lowestLatencyMs: ftWin.length ? Math.min(...ftWin) : null,
    spikeCount: ftWin.length ? spikeIndices(ftWin, budget).length : null,
  };
}
