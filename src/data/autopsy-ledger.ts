// Autopsy record (A3.8) — a local, private rollup of the user's Guide Autopsy history. Each graded
// guide contributes a COMPACT grade summary (verdict counts only — never the pasted text, never a
// URL). Pure stats over a capped localStorage ledger; local-only, like sessions/history — nothing
// leaves the PC (the same promise the autopsy itself makes). Read-only/advisory: no mutation, no
// network, no new IPC. Honest by construction: percentages are of the tweaks Compy actually
// recognized, and an autopsy that recognized nothing is never recorded (it would skew the record).
import type { AutopsyResult } from "./knowledge-autopsy";

const LEDGER_KEY = "compy_autopsy_ledger_v1";
const MAX_ENTRIES = 100; // FIFO cap — a long history rolls forward, never unbounded.

// Schema version of the persisted ENVELOPE. Bump this whenever `AutopsyLedgerEntry`'s shape changes
// AND add the matching upgrade step in `migrateLedger` so old localStorage data is carried forward
// instead of silently dropped. The localStorage KEY stays fixed (changing it would orphan existing
// data) — the version lives INSIDE the payload, exactly where a migration can read and upgrade it.
export const AUTOPSY_SCHEMA_VERSION = 1;

export type AutopsyLedgerEntry = {
  at: number; // ms epoch when the guide was graded
  real: number;
  placebo: number;
  risky: number;
  unknown: number;
  scamFlags: number;
};

// The persisted form: a versioned envelope wrapping the entries. Older builds (pre-versioning) wrote a
// BARE ARRAY with no envelope — that legacy shape is migrated forward on read (see `migrateLedger`).
type StoredEnvelope = { v: number; entries: unknown[] };

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

// Keep only well-shaped numeric entries, so a corrupt/old blob never throws or skews the stats — a
// partially-bad ledger degrades to its valid entries, not an error.
function sanitizeEntries(raw: unknown): AutopsyLedgerEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is AutopsyLedgerEntry =>
      !!e &&
      typeof e === "object" &&
      NUM_KEYS.every((k) => typeof (e as Record<string, unknown>)[k] === "number"),
  );
}

function isEnvelope(raw: unknown): raw is StoredEnvelope {
  return (
    !!raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).v === "number" &&
    Array.isArray((raw as Record<string, unknown>).entries)
  );
}

// Migrate ANY historically-persisted blob → current-version entries. Forward-only, idempotent, and
// lossless for valid entries. Handles three shapes:
//   1. Legacy pre-envelope BARE ARRAY — implicitly v1 entries; wrapped on the next write.
//   2. A versioned envelope — today only v1 exists. When `AutopsyLedgerEntry` later gains/changes a
//      field, add the per-version upgrade here (e.g. `if (raw.v < 2) entries = upgradeTo2(entries)`)
//      so older envelopes are carried forward field-by-field.
//   3. An envelope from a NEWER build (v > current, e.g. after a downgrade) — entries are still read
//      defensively (`sanitizeEntries` drops unknown shapes) rather than nuked, so history survives.
// Anything else (object without v/entries, primitive, null) → [].
export function migrateLedger(raw: unknown): AutopsyLedgerEntry[] {
  if (Array.isArray(raw)) return sanitizeEntries(raw); // (1) legacy bare array
  if (isEnvelope(raw)) return sanitizeEntries(raw.entries); // (2) + (3) versioned envelope
  return [];
}

export function readAutopsyLedger(): AutopsyLedgerEntry[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return [];
    return migrateLedger(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persist(entries: AutopsyLedgerEntry[]): void {
  try {
    const envelope: StoredEnvelope = { v: AUTOPSY_SCHEMA_VERSION, entries };
    localStorage.setItem(LEDGER_KEY, JSON.stringify(envelope));
  } catch {
    /* storage unavailable/full — the returned array still drives this render */
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
  persist(next); // writes the versioned envelope (upgrading any legacy bare-array form on disk)
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
