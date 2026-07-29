// check-handoff — the typed, versioned contract that carries a Check's findings into the Lab.
//
// Why this exists (recovery train item 3/4, tester feedback 2026-07-22): a tester finished a Check
// and landed "somewhere" with no idea where to act on what Compy had just found. The first fix
// (2026-07-22) wrote a bare string — `localStorage["compy_lab_open_station"] = "optimize"` — which
// opened the right station but dropped the FINDINGS on the floor: the user arrived at a full
// optimize surface and had to re-find the tweaks Compy had just named for them.
//
// This replaces that string with a real payload. It is a CONTRACT, not a convention:
//   - versioned      — `v` is checked, so a stale/foreign payload is ignored, never half-read
//   - validated      — every field is type-checked on read; anything malformed reads as "no handoff"
//   - consume-once   — read clears it, so revisiting the Lab later is a normal visit (edge case 6)
//   - age-capped     — a handoff older than HANDOFF_MAX_AGE_MS is stale intent, not context
//   - identity-based — it carries catalog rec IDS, never display prose. Nothing downstream may
//                      re-derive which tweak was meant by matching text or querying the DOM.
//
// It carries INTENT ONLY. Arriving with a handoff never applies, changes, or dismisses anything —
// it opens a destination and marks which rows the user was already told about. Every mutation still
// goes through the audited apply/rollback path exactly as if the user had walked here themselves.

export const HANDOFF_KEY = "compy_check_handoff_v1";

/** Older than this and the intent is stale — the user went somewhere else and came back later. */
export const HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;

/** Where a handoff can land. One station today; the union is the extension point. */
export type HandoffStation = "optimize";

/** Which Check produced it — the first-run arc or the in-app Check surface. */
export type HandoffSource = "first-check" | "check";

export type CheckHandoff = {
  v: 1;
  station: HandoffStation;
  /** The exact catalog recommendation ids the Check named. May be empty (nothing actionable). */
  rec_ids: string[];
  source: HandoffSource;
  /** Epoch ms at write time — the age cap's input. */
  at: number;
};

const STATIONS: readonly string[] = ["optimize"];
const SOURCES: readonly string[] = ["first-check", "check"];

/**
 * Record the intent to continue in the Lab with these findings.
 *
 * Must be called BEFORE the Lab face mounts (the reader runs on mount) — that ordering is what
 * makes this race-free. Storage failures are non-fatal: the user still lands in the Lab, just
 * without the carried context.
 */
export function writeHandoff(intent: {
  station: HandoffStation;
  rec_ids: string[];
  source: HandoffSource;
  at?: number;
}): void {
  const payload: CheckHandoff = {
    v: 1,
    station: intent.station,
    rec_ids: intent.rec_ids.filter((id) => typeof id === "string" && id.length > 0),
    source: intent.source,
    at: intent.at ?? Date.now(),
  };
  try {
    localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    /* non-fatal — navigation still happens, the arrival is just uncontextualized */
  }
}

/** Drop any pending handoff. Safe to call when there is none. */
export function clearHandoff(): void {
  try {
    localStorage.removeItem(HANDOFF_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Take the pending handoff, if there is a valid, fresh one. ALWAYS clears what it found — a
 * handoff is consumed exactly once, so a later Lab visit is an ordinary visit (edge case 6).
 *
 * Returns null for: nothing stored · unparseable JSON · wrong version · unknown station/source ·
 * a non-string-array rec_ids · a missing/invalid timestamp · anything older than the age cap.
 * Every one of those is "no context to carry", never a partially-trusted payload.
 */
export function readHandoff(now: number = Date.now()): CheckHandoff | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  clearHandoff();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  if (p.v !== 1) return null;
  if (typeof p.station !== "string" || !STATIONS.includes(p.station)) return null;
  if (typeof p.source !== "string" || !SOURCES.includes(p.source)) return null;
  if (typeof p.at !== "number" || !Number.isFinite(p.at)) return null;
  if (!Array.isArray(p.rec_ids) || p.rec_ids.some((id) => typeof id !== "string")) return null;
  // A clock that jumped backwards shouldn't resurrect an old intent either — |age| is the test.
  if (Math.abs(now - p.at) > HANDOFF_MAX_AGE_MS) return null;

  return {
    v: 1,
    station: p.station as HandoffStation,
    source: p.source as HandoffSource,
    at: p.at,
    rec_ids: (p.rec_ids as string[]).filter((id) => id.length > 0),
  };
}

/**
 * How the carried ids resolve against the catalog the destination actually has RIGHT NOW.
 *
 * The Check that produced the handoff and the Lab that receives it read the catalog at different
 * moments, so the destination must state the truth it can see — not replay what Check said:
 *   - `open`    — still a real, still-pending rec: the rows to lead with
 *   - `done`    — applied between the Check and arrival (edge case: already applied)
 *   - `missing` — no longer in the catalog at all (edge case: stale before arrival)
 * Order follows the carried ids, so the user sees them in the order Compy named them.
 */
export function resolveCarried<T extends { id: string; currently_applied: boolean }>(
  recIds: readonly string[],
  recs: readonly T[] | null,
): { open: T[]; done: T[]; missing: string[] } {
  if (!recs) return { open: [], done: [], missing: [] };
  const byId = new Map(recs.map((r) => [r.id, r]));
  const open: T[] = [];
  const done: T[] = [];
  const missing: string[] = [];
  for (const id of recIds) {
    const rec = byId.get(id);
    if (!rec) missing.push(id);
    else if (rec.currently_applied) done.push(rec);
    else open.push(rec);
  }
  return { open, done, missing };
}
