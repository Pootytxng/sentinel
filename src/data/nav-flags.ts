// Guarded readers for the navigation merge flags. A BARE localStorage.getItem in a render body
// throws on WebView2 configurations where storage is disabled or partitioned by policy — and with no
// React error boundary in the app, that throw blanks the whole window with no recovery. Every other
// flag reader (theme.ts, use-motion.ts, main.tsx) already wraps the read in try/catch for exactly
// this reason; these mirror that pattern. Default: merged-ON (the shipped default since 2026-06-21).

/** Optimize merge (Check + Tune → one "Optimize" room). Escape hatch: compy_optimize="0". */
export function readOptimizeMerged(): boolean {
  try {
    return localStorage.getItem("compy_optimize") !== "0";
  } catch {
    return true;
  }
}

/** Monitor restructure (Sessions/Live segments). Escape hatch: compy_monitor="0". */
export function readMonitorMerged(): boolean {
  try {
    return localStorage.getItem("compy_monitor") !== "0";
  } catch {
    return true;
  }
}
