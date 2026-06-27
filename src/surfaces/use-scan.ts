import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GameReadiness, ReadinessCheck, Priorities } from "../types";
import { peekProbe, putProbe } from "../data/probe-cache";

// The readiness/priorities scan — the shared core behind FirstCheck (the first-run arc) and Check
// (the permanent consolidation surface). One source of truth for the scan choreography: real
// commands only (zero new IPC), honest elapsed, display-stagger streaming (never a fake sleep).

export type ScanRecLite = { id: string; title: string; currently_applied: boolean };

// A Compy-applied change the live system no longer matches (drifted off outside Compy). Named, so a
// flag can say WHICH setting + offer its inline fix instead of "1 setting(s) — go to another tab".
export type RevertedChange = { rec_id: string; title: string };
export type AppliedChangeLite = {
  rec_id: string;
  rec_title: string;
  status: string;
  is_still_active: boolean;
};

const STAGGER_MS = 280; // legibility only (spec: ≤~350ms/row, never sleep for drama)

// What we cache so a cached caller (Optimize/Fixes) re-opens INSTANTLY instead of re-running the scan
// + replaying the row-by-row reveal. Cleared on any apply/rollback (App.refresh → invalidateProbe).
type ScanResult = {
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  recs: ScanRecLite[];
  reverted: RevertedChange[];
  elapsed: number | null;
};
const SCAN_KEY = "readiness-scan";

export function rowVerdict(s: ReadinessCheck["status"]): "ok" | "fix" | "unknown" {
  if (s === "attention") return "fix";
  if (s === "ready" || s === "advisory") return "ok";
  return "unknown";
}

// The ledger is append-only, so collapse to the NEWEST entry per rec first (a re-applied setting
// must count once, not once per historical apply — mirrors summarize_history), then name the ones
// that drifted off (we applied them, the live system no longer matches). Pure → unit-tested; it's
// the core of the flag-class "name the drifted setting + fix it inline" behavior.
export function deriveReverted(changes: AppliedChangeLite[]): RevertedChange[] {
  const newestByRec = new Map<string, AppliedChangeLite>();
  for (const c of changes ?? []) newestByRec.set(c.rec_id, c); // later entries win (null-safe)
  return [...newestByRec.values()]
    .filter((c) => c.status === "applied" && !c.is_still_active)
    .map((c) => ({ rec_id: c.rec_id, title: c.rec_title }));
}

export type ScanState = {
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  recs: ScanRecLite[];
  /** Compy-applied changes that have since drifted off (named) — drives inline "turn it back on". */
  reverted: RevertedChange[];
  running: boolean;
  elapsed: number | null;
  shownRows: number;
  phase: "scan" | "verdict";
  rerun: () => Promise<void>;
};

// The scan's fetch+compute core — shared by the live rerun and the idle pre-warm so the cached
// result is byte-identical to a real scan. Real read-only commands only (zero new IPC);
// priorities_from is a pure pass-through, so it does NOT re-run the readiness+recs probes (P4).
async function fetchScan(): Promise<ScanResult> {
  const t0 = performance.now();
  const [r, rc, changes, startup, sessions] = await Promise.all([
    invoke<GameReadiness>("get_game_readiness"),
    invoke<ScanRecLite[]>("get_recommendations"),
    invoke<AppliedChangeLite[]>("get_applied_changes"),
    invoke<unknown>("get_startup_entries"),
    invoke<unknown>("get_session_summaries"),
  ]);
  const p = await invoke<Priorities>("priorities_from", {
    readiness: r,
    recommendations: rc,
    startup,
    sessions,
  });
  return {
    readiness: r,
    priorities: p,
    recs: rc,
    reverted: deriveReverted(changes),
    elapsed: (performance.now() - t0) / 1000,
  };
}

// Warm the scan cache during app idle so the FIRST open of Optimize/Fixes seeds the verdict
// instantly (no cold scan, no replayed row-by-row reveal) instead of paying the full scan on the
// click. No-op if a real scan already cached (or wins the race); best-effort — a failure just lets
// the normal on-open scan run. App.tsx schedules this via requestIdleCallback after first paint.
export async function prewarmScan(): Promise<void> {
  if (peekProbe(SCAN_KEY)) return;
  try {
    const result = await fetchScan();
    if (!peekProbe(SCAN_KEY)) putProbe<ScanResult>(SCAN_KEY, result);
  } catch {
    /* leave it — Optimize will scan on open as usual */
  }
}

export function useScan(opts?: { cache?: boolean }): ScanState {
  const useCache = opts?.cache ?? false;
  // Seed synchronously from the cache so a cached caller (Optimize/Fixes) paints the LAST verdict
  // instantly — no re-fetch, no replayed row-by-row reveal — when re-opening the tab.
  const seed = useCache ? peekProbe<ScanResult>(SCAN_KEY) : undefined;

  const [readiness, setReadiness] = useState<GameReadiness | null>(seed?.readiness ?? null);
  const [priorities, setPriorities] = useState<Priorities | null>(seed?.priorities ?? null);
  const [recs, setRecs] = useState<ScanRecLite[]>(seed?.recs ?? []);
  const [reverted, setReverted] = useState<RevertedChange[]>(seed?.reverted ?? []);
  const [running, setRunning] = useState(!seed);
  const [elapsed, setElapsed] = useState<number | null>(seed?.elapsed ?? null);
  const [shownRows, setShownRows] = useState(seed?.readiness?.checks.length ?? 0);
  const [phase, setPhase] = useState<"scan" | "verdict">(seed ? "verdict" : "scan");

  const rerun = useCallback(async () => {
    setRunning(true);
    setPhase("scan");
    setShownRows(0);
    const t0 = performance.now();
    try {
      const result = await fetchScan();
      setReadiness(result.readiness);
      setPriorities(result.priorities);
      setRecs(result.recs);
      setReverted(result.reverted);
      // Always cache the fresh result (even from FirstCheck/Tour) so the next cached caller paints
      // instantly. The cache is cleared after every mutation, so it can't outlive a real state change.
      putProbe<ScanResult>(SCAN_KEY, result);
    } catch {
      /* leave nulls — render guards downstream */
    } finally {
      setElapsed((performance.now() - t0) / 1000);
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    // Skip the auto-scan when a cached caller already has scan data — re-opening the tab must NOT
    // replay scan+stagger. The cache is cleared after any apply/rollback (App.refresh →
    // invalidateProbe) and "Re-run check" (rerun) always does a fresh full scan, so this never serves
    // a stale verdict past a real change. Non-cached callers (FirstCheck / SetupTour) always scan.
    if (useCache && peekProbe(SCAN_KEY)) return;
    rerun();
  }, [rerun, useCache]);

  // Stream the check rows in (legibility), then flip to the verdict/result. Skipped entirely when
  // seeded from cache (phase already "verdict") so a re-visit shows the full result immediately.
  useEffect(() => {
    if (running || !readiness || phase === "verdict") return;
    const n = readiness.checks.length;
    const timers: number[] = [];
    for (let i = 0; i < n; i++) {
      timers.push(
        window.setTimeout(() => setShownRows((c) => Math.max(c, i + 1)), i * STAGGER_MS),
      );
    }
    timers.push(window.setTimeout(() => setPhase("verdict"), n * STAGGER_MS + 220));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // deps are [running, readiness] (NOT phase): the `phase === "verdict"` guard above reads the
    // closure value — on a cache seed the effect runs once on mount with phase already "verdict" and
    // returns; during a real scan phase is "scan" when running flips, so the reveal proceeds. Adding
    // `phase` to deps would re-fire the effect when it flips to "verdict" and the cleanup would clear
    // the row timers mid-reveal.
  }, [running, readiness]);

  return { readiness, priorities, recs, reverted, running, elapsed, shownRows, phase, rerun };
}
