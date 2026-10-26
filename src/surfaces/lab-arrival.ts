// P7-route (ROADMAP Phase 7 bullet 1, Constitution §27): what the user came to the Test room with,
// so the answer lands on the journey that answers it rather than on a bare station. Same one-shot
// pattern as care-arrival.ts: the interview writes the key right before it navigates, and the one
// surface that answers it reads and clears it on mount, so a later visit starts clean.
//
// Two keys, one per reader, so each is always consumed by the surface that mounts with it:
//   - BENCH_ARRIVAL_KEY, read by ExperimentBench (the Test room overview): "journey" brings the
//     guided "Find what helps my game" journey into view with its button focused; "tested" brings "What Compy
//     tested" into view. The bench mounts its hooks even while its gate is dark, so the key is
//     consumed then too, and nothing is shown that the gate hides.
//   - SINCE_ARRIVAL_KEY, read by SinceLastWorked (the Care view): brings "Since it last worked"
//     into view once the scan has produced it. Its own key, not care-arrival's, because
//     StutterCompare reads and clears that one in the same view.
export const BENCH_ARRIVAL_KEY = "compy_bench_arrival";
export const SINCE_ARRIVAL_KEY = "compy_since_arrival";

export type BenchArrival = "journey" | "tested";

export function markBenchArrival(a: BenchArrival): void {
  try {
    localStorage.setItem(BENCH_ARRIVAL_KEY, a);
  } catch {
    /* no storage: the user still lands in the room and can scroll to it */
  }
}

export function takeBenchArrival(): BenchArrival | null {
  try {
    const v = localStorage.getItem(BENCH_ARRIVAL_KEY);
    if (v != null) localStorage.removeItem(BENCH_ARRIVAL_KEY);
    return v === "journey" || v === "tested" ? v : null;
  } catch {
    return null;
  }
}

export function markSinceArrival(): void {
  try {
    localStorage.setItem(SINCE_ARRIVAL_KEY, "since");
  } catch {
    /* no storage: the user still lands on the Care view, where the section is on the page */
  }
}

export function takeSinceArrival(): boolean {
  try {
    const v = localStorage.getItem(SINCE_ARRIVAL_KEY);
    if (v != null) localStorage.removeItem(SINCE_ARRIVAL_KEY);
    return v === "since";
  } catch {
    return false;
  }
}
