import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GameReadiness, ReadinessCheck, Priorities } from "../types";
import type { RadarBlip } from "./ArcRadar";

// The readiness/priorities scan — the shared core behind FirstCheck (the first-run arc) and Check
// (the permanent consolidation surface). One source of truth for the scan choreography: real
// commands only (zero new IPC), honest elapsed, display-stagger streaming (never a fake sleep).

export type ScanRecLite = { id: string; title: string; currently_applied: boolean };

const STAGGER_MS = 280; // legibility only (spec: ≤~350ms/row, never sleep for drama)

export function rowVerdict(s: ReadinessCheck["status"]): "ok" | "fix" | "unknown" {
  if (s === "attention") return "fix";
  if (s === "ready" || s === "advisory") return "ok";
  return "unknown";
}

export type ScanState = {
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  recs: ScanRecLite[];
  running: boolean;
  elapsed: number | null;
  shownRows: number;
  phase: "scan" | "verdict";
  radarBlips: RadarBlip[];
  rerun: () => Promise<void>;
};

export function useScan(): ScanState {
  const [readiness, setReadiness] = useState<GameReadiness | null>(null);
  const [priorities, setPriorities] = useState<Priorities | null>(null);
  const [recs, setRecs] = useState<ScanRecLite[]>([]);
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
      const [r, p, rc] = await Promise.all([
        invoke<GameReadiness>("get_game_readiness"),
        invoke<Priorities>("get_priorities"),
        invoke<ScanRecLite[]>("get_recommendations"),
      ]);
      setReadiness(r);
      setPriorities(p);
      setRecs(rc);
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

  const checks = readiness?.checks ?? [];
  const radarBlips: RadarBlip[] = checks.map((c) => ({ id: c.id, verdict: rowVerdict(c.status) }));

  return { readiness, priorities, recs, running, elapsed, shownRows, phase, radarBlips, rerun };
}
