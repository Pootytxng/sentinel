import { useSyncExternalStore } from "react";

// A5 applicability override ("My hardware supports this") — the user's deliberate, reversible
// assertion that Compy's hardware READ was wrong for a capability-gated rec (e.g. a dock's wired
// NIC the probe missed). Mirrors dismissed.ts: a PREFERENCE, not a receipt — frontend localStorage
// durability, zero IPC. Scope is honest by construction: only capability-gated recs ever reach the
// "Not for this rig" pile (relevance-gated recs are omitted by the backend and can't be
// overridden), and an overridden rec applies through the SAME audited apply/rollback path with the
// same snapshot + ledger receipt — the override changes which list a rec sits in, never what an
// apply does. The way back ("Not for this rig after all") is always offered.
const OVERRIDE_KEY = "compy_eligibility_overrides";

function read(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function persist(s: Set<string>): void {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify([...s]));
  } catch {
    /* localStorage unavailable — degrade to in-memory only for this session */
  }
}

// ONE set per session, not one per caller — the store shape dismissed.ts was rebuilt into in
// self-review round 8, here for the same reason.
//
// THE BUG (self-review round 11, 2026-07-29): this was `useState(read)` with exactly one caller
// (Fix), so the override existed nowhere else in the app. Press "My hardware supports this" and the
// row rejoins Fix's own list while the safe-stack gauge three lines above it — which derives its
// stack in OptimizeStation from `eligible !== false` — never hears about it, so the caption goes on
// saying "Nothing waiting" over a list with a row in it. Home's one-tap band and the room verdicts
// were blind to it too. A module-level store read through useSyncExternalStore makes the drift
// unrepresentable: one set, and every subscriber re-renders together.
let current: Set<string> = read();
const listeners = new Set<() => void>();

function emit(): void {
  // Copy first: a listener that unsubscribes while we notify must not reshape the set mid-iteration.
  for (const notify of [...listeners]) notify();
}

function commit(next: Set<string>): void {
  current = next;
  persist(next);
  emit();
}

function subscribe(notify: () => void): () => void {
  // Nobody was watching, so nothing has been keeping `current` honest — another window (or a test
  // seeding localStorage directly) may have written since the last unmount. Re-read as the first
  // watcher arrives; React re-checks the snapshot immediately after subscribing, so a change here
  // is picked up rather than swallowed.
  if (listeners.size === 0) current = read();
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

// Compy runs a second webview (the FPS overlay). If anything there ever writes this key, the same
// one-truth rule has to hold across windows — `storage` only fires in the OTHER document, so this
// costs the writing window nothing.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== OVERRIDE_KEY) return;
    current = read();
    emit();
  });
}

/// THE ONE ANSWER to "does this rec apply to this rig?" — Compy's hardware read, corrected by the
/// user's assertion. Any surface that COUNTS, CAPTIONS or LISTS recs must ask through this rather
/// than testing `r.eligible !== false` on the raw catalog, or it will contradict the screen it is
/// sitting on.
///
/// Returns the input array UNCHANGED when nothing is overridden (the overwhelmingly common case),
/// so callers' memos stay referentially stable and threading this everywhere costs nothing.
///
/// It corrects `eligible` rather than adding a parallel set on purpose: every predicate downstream
/// (safeFixesReadyList, optimizeVerdict, nextBestMove) already asks `r.eligible !== false`, so they
/// all become correct without each growing a parameter.
///
/// NOT for `Fix`. Fix owns the override CONTROL, so it needs Compy's original read to render the
/// "Not for this rig" pile, the reason line, and the way back — hand it corrected recs and the
/// user's assertion becomes a one-way door. Fix does its own override-aware derivation instead.
/// Everything else is a counter or a lister and wants the corrected view.
export function withOverrides<T extends { id: string; eligible?: boolean }>(
  recs: T[],
  overridden: ReadonlySet<string>,
): T[] {
  if (overridden.size === 0) return recs;
  return recs.map((r) =>
    r.eligible === false && overridden.has(r.id) ? { ...r, eligible: true } : r,
  );
}

export function useEligibilityOverrides() {
  const overridden = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  const override = (id: string) => {
    if (current.has(id)) return; // idempotent — and no pointless re-render storm
    const next = new Set(current);
    next.add(id);
    commit(next);
  };
  const clearOverride = (id: string) => {
    if (!current.has(id)) return;
    const next = new Set(current);
    next.delete(id);
    commit(next);
  };
  return { overridden, override, clearOverride };
}
