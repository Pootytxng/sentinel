import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import type { GameReadiness, ReadinessCheck, Priorities } from "../types";
import { peekProbe, putProbe } from "../data/probe-cache";

// buildSetupSummary (A5): turn the settled scan into a plain-English, paste-ready block the user can
// copy anywhere (a friend, a forum, a build note). PURE + read-only — it only restates what Compy
// already measured, never a new claim, never a promise ("advisory only · measured on this rig"), and
// never fabricates a limiter on a clean rig. Zero IPC; the caller copies the string to the clipboard.
//
// i18n note: `t` is threaded through as the LAST param (this is a plain data module, not a
// component — it can't call useTranslation() itself) — both call sites (Check.tsx, OptimizeV2.tsx)
// pass their own `t` from useTranslation(). Its new keys live under the shared
// optimize.setupSummary.* sub-namespace (optimize.json) since this builder serves two rooms.
// Mirrors ago()/smoothness() elsewhere in this codebase. `l.title` stays untranslated — it's
// already-localized data from the priorities engine, not a literal string in this module.
export function buildSetupSummary(
  readiness: GameReadiness | null,
  priorities: Priorities | null,
  t: TFunction,
): string {
  if (!readiness) return "";
  const lines: string[] = [t("optimize.setupSummary.title"), ""];

  // Readiness breakdown — only the non-zero buckets, so a clean rig reads "N checks · N ready".
  const total = readiness.checks.length;
  const parts: string[] = [];
  // "look good" not "ready" (one word per meaning — "ready" belongs to appliable fixes), and
  // branch-proper counts (never "1 need attention") — the V2-9 punch (e)/(f) laws, applied to
  // the shareable summary too so pasted text reads as well as the screen.
  if (readiness.ready_count > 0)
    parts.push(t("optimize.setupSummary.readinessLooksGood", { count: readiness.ready_count }));
  if (readiness.attention_count > 0)
    parts.push(
      t("optimize.setupSummary.readinessNeedsAttention", { count: readiness.attention_count }),
    );
  if (readiness.advisory_count > 0)
    parts.push(t("optimize.setupSummary.readinessAdvisoryCount", { count: readiness.advisory_count }));
  if (readiness.unknown_count > 0)
    parts.push(t("optimize.setupSummary.readinessUnknownCount", { count: readiness.unknown_count }));
  lines.push(
    parts.length > 0
      ? t("optimize.setupSummary.checksTotalWithBreakdown", {
          count: total,
          breakdown: parts.join(", "),
        })
      : t("optimize.setupSummary.checksTotal", { count: total }),
  );
  lines.push("");

  // What's worth a look — the ranked limiters, named. Never invented: a clean rig says so plainly.
  const limiters = priorities?.limiters ?? [];
  if (limiters.length > 0) {
    lines.push(t("optimize.setupSummary.worthALookHeader"));
    for (const l of limiters) lines.push(`- ${l.title}`);
  } else {
    lines.push(t("optimize.setupSummary.nothingWorthChangingToday"));
  }

  const fine = priorities?.already_fine ?? [];
  if (fine.length > 0) {
    lines.push("");
    lines.push(t("optimize.setupSummary.checksMeasuredFineAlready", { count: fine.length }));
  }

  lines.push("");
  lines.push(t("optimize.setupSummary.advisoryOnlyFooter"));
  return lines.join("\n");
}

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

/** The priorities from the last cached scan, read synchronously with no IPC (P9-settings-done).
 *  undefined = no scan cached this session; null = the scan ran but its priorities read failed. */
export function peekScanPriorities(): Priorities | null | undefined {
  return peekProbe<ScanResult>(SCAN_KEY)?.priorities;
}

export function rowVerdict(s: ReadinessCheck["status"]): "ok" | "fix" | "unknown" {
  if (s === "attention") return "fix";
  if (s === "ready" || s === "advisory") return "ok";
  return "unknown";
}

// The ledger is append-only, so collapse to the NEWEST entry per rec first (a re-applied setting
// must count once, not once per historical apply — mirrors summarize_history), then name the ones
// that drifted off (we applied them, the live system no longer matches). Pure → unit-tested; it's
// the core of the flag-class "name the drifted setting + fix it inline" behavior.
//
// Startup-app, bloat-task and service rows are not catalog recs: `apply_recommendation` has no
// apply for them, so an inline "turn it back on" would fail. Since #620 their live read can say
// they drifted; that still shows in History and the readiness row, with rollback, just not here.
const NOT_REAPPLIABLE_INLINE = ["startup-entry:", "bloat-task:", "service-suspend:"];
export function deriveReverted(changes: AppliedChangeLite[]): RevertedChange[] {
  const newestByRec = new Map<string, AppliedChangeLite>();
  for (const c of changes ?? []) newestByRec.set(c.rec_id, c); // later entries win (null-safe)
  return [...newestByRec.values()]
    .filter((c) => c.status === "applied" && !c.is_still_active)
    .filter((c) => !NOT_REAPPLIABLE_INLINE.some((prefix) => c.rec_id.startsWith(prefix)))
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
  /** Fast-forward the row reveal straight to the verdict (presentation only — the scan already
   *  finished; a no-op while the real commands are still running). */
  skip: () => void;
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

export function useScan(opts?: { cache?: boolean; staggerMs?: number }): ScanState {
  const useCache = opts?.cache ?? false;
  // Reveal pacing override (legibility only, same never-sleep rule): FirstCheck's boot theater
  // runs a tighter 200ms/row so 16 checks land inside the ~3–4s ceiling; Check keeps the default.
  const stagger = opts?.staggerMs ?? STAGGER_MS;
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
        window.setTimeout(() => setShownRows((c) => Math.max(c, i + 1)), i * stagger),
      );
    }
    timers.push(window.setTimeout(() => setPhase("verdict"), n * stagger + 220));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // deps are [running, readiness] (NOT phase): the `phase === "verdict"` guard above reads the
    // closure value — on a cache seed the effect runs once on mount with phase already "verdict" and
    // returns; during a real scan phase is "scan" when running flips, so the reveal proceeds. Adding
    // `phase` to deps would re-fire the effect when it flips to "verdict" and the cleanup would clear
    // the row timers mid-reveal.
  }, [running, readiness, stagger]);

  // Skip-to-verdict (boot-theater affordance): reveal everything and land the verdict NOW.
  // Presentation only — the real commands already returned (no-op while running). Straggler
  // row timers stay harmless (Math.max) and the final phase timer is idempotent.
  const skip = useCallback(() => {
    if (running || !readiness) return;
    setShownRows(readiness.checks.length);
    setPhase("verdict");
  }, [running, readiness]);

  return { readiness, priorities, recs, reverted, running, elapsed, shownRows, phase, rerun, skip };
}
