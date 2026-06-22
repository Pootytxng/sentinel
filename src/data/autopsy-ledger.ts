// Autopsy record (A3.8) — a local, private rollup of the user's Guide Autopsy history. Each graded
// guide contributes a COMPACT grade summary (verdict counts only — never the pasted text, never a
// URL). Pure stats over a capped localStorage ledger; local-only, like sessions/history — nothing
// leaves the PC (the same promise the autopsy itself makes). Read-only/advisory: no mutation, no
// network, no new IPC. Honest by construction: percentages are of the tweaks Compy actually
// recognized, and an autopsy that recognized nothing is never recorded (it would skew the record).
import type { AutopsyResult } from "./knowledge-autopsy";

const LEDGER_KEY = "compy_autopsy_ledger_v1";
const MAX_ENTRIES = 100; // FIFO cap — a long history rolls forward, never unbounded.

export type AutopsyLedgerEntry = {
  at: number; // ms epoch when the guide was graded
  real: number;
  placebo: number;
  risky: number;
  unknown: number;
  scamFlags: number;
};

export type AutopsyStats = {
  count: number; // guides graded
  real: number;
  placebo: number;
  risky: number;
  unknown: number;
  scamFlags: number;
  gradedTweaks: number; // real + placebo + risky (the verdict-bearing total)
  realPct: number; // % of gradedTweaks (0 when none recognized)
  placeboPct: number;
  riskyPct: number;
  lastAt: number | null;
};

const NUM_KEYS = ["at", "real", "placebo", "risky", "unknown", "scamFlags"] as const;

export function readAutopsyLedger(): AutopsyLedgerEntry[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: keep only well-shaped numeric entries, so a corrupt/old blob never throws or skews
    // the stats — a partially-bad ledger degrades to its valid entries, not an error.
    return parsed.filter(
      (e): e is AutopsyLedgerEntry =>
        !!e && typeof e === "object" && NUM_KEYS.every((k) => typeof e[k] === "number"),
    );
  } catch {
    return [];
  }
}

// Record a graded guide and return the new ledger (also persisted). Skips an autopsy that recognized
// NOTHING (all-zero grade + no scam flags) so the record reflects real gradings, not blank runs. `now`
// is injectable for deterministic tests.
export function recordAutopsy(result: AutopsyResult, now: number = Date.now()): AutopsyLedgerEntry[] {
  const { real, placebo, risky, unknown } = result.grade;
  const current = readAutopsyLedger();
  if (real + placebo + risky + unknown + result.scamFlags <= 0) return current; // nothing recognized
  const entry: AutopsyLedgerEntry = { at: now, real, placebo, risky, unknown, scamFlags: result.scamFlags };
  const next = [...current, entry].slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable/full — the returned array still drives this render */
  }
  return next;
}

export function autopsyStats(entries: AutopsyLedgerEntry[]): AutopsyStats {
  const sum = (k: keyof AutopsyLedgerEntry) => entries.reduce((a, e) => a + e[k], 0);
  const real = sum("real");
  const placebo = sum("placebo");
  const risky = sum("risky");
  const unknown = sum("unknown");
  const scamFlags = sum("scamFlags");
  const gradedTweaks = real + placebo + risky;
  const pct = (n: number) => (gradedTweaks > 0 ? Math.round((n / gradedTweaks) * 100) : 0);
  return {
    count: entries.length,
    real,
    placebo,
    risky,
    unknown,
    scamFlags,
    gradedTweaks,
    realPct: pct(real),
    placeboPct: pct(placebo),
    riskyPct: pct(risky),
    lastAt: entries.length ? Math.max(...entries.map((e) => e.at)) : null,
  };
}
