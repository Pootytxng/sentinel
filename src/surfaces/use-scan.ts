import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GameReadiness, ReadinessCheck, Priorities } from "../types";

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
  for (const c of changes) newestByRec.set(c.rec_id, c); // later entries win
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

export function useScan(): ScanState {
  const [readiness, setReadiness] = useState<GameReadiness | null>(null);
  const [priorities, setPriorities] = useState<Priorities | null>(null);
  const [recs, setRecs] = useState<ScanRecLite[]>([]);
  const [reverted, setReverted] = useState<RevertedChange[]>([]);
  const [running, setRunning] = useState(true);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [shownRows, setShownRows] = useState(0);
  const [phase, setPhase] = useState<"scan" | "verdict">("scan");

  const rerun = useCallback(async () => {
    setRunning(true);
    setPhase("scan");
    setShownRows(0);
    const t0 = performance.now();
    try {
      const [r, p, rc, changes] = await Promise.all([
        invoke<GameReadiness>("get_game_readiness"),
        invoke<Priorities>("get_priorities"),
        invoke<ScanRecLite[]>("get_recommendations"),
        invoke<AppliedChangeLite[]>("get_applied_changes"),
      ]);
      setReadiness(r);
      setPriorities(p);
      setRecs(rc);
      setReverted(deriveReverted(changes));
    } catch {
      /* leave nulls — render guards downstream */
    } finally {
      setElapsed((performance.now() - t0) / 1000);
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    rerun();
  }, [rerun]);

  // Stream the check rows in (legibility), then flip to the verdict/result.
  useEffect(() => {
    if (running || !readiness) return;
    const n = readiness.checks.length;
    const timers: number[] = [];
    for (let i = 0; i < n; i++) {
      timers.push(
        window.setTimeout(() => setShownRows((c) => Math.max(c, i + 1)), i * STAGGER_MS),
      );
    }
    timers.push(window.setTimeout(() => setPhase("verdict"), n * STAGGER_MS + 220));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [running, readiness]);

  return { readiness, priorities, recs, reverted, running, elapsed, shownRows, phase, rerun };
}
