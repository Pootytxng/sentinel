import { useSyncExternalStore } from "react";

// User dismissal ("Not for me", eligibility train) — deliberate, reversible declines of advisory/
// applicable recs. PREFERENCES, not receipts: frontend localStorage is the right durability (survives
// restarts + the runtime-dir reinstall policy; ledger-grade persistence is NOT required). Zero IPC.
// Dismissal NEVER hides truth — the counts stay honest one tap away, and un-dismiss is always offered.
const DISMISSED_KEY = "compy_dismissed_recs";

function read(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function persist(s: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s]));
  } catch {
    /* localStorage unavailable — degrade to in-memory only for this session */
  }
}

// ONE set per session, not one per caller.
//
// THE BUG (self-review round 8, 2026-07-29): this hook used to be `useState(read)`, which handed
// every caller its OWN copy of the set. Four surfaces ask for it — Check, Fix, LabDeck and (now)
// OptimizeStation — and they drifted apart the instant any ONE of them dismissed something: the
// mutating instance re-rendered, the others kept a stale snapshot and went on counting a set-aside
// rec as outstanding. Live proof on a single screen: the Lab's safe-stack ring read "1 left to
// enable below", three lines above Fix's "Nothing waiting — no changes to make on this rig right
// now", with that same rec sitting in its own "Dismissed (1)" pile. Three contradictory answers to
// "what should I do next?" in one render — precisely the disorientation this train exists to kill.
//
// A module-level store read through useSyncExternalStore makes it unrepresentable: one set, and
// every subscriber re-renders together. Guarded by dismissed.test.ts + the live-journey assertion
// in optimize-gauge-dock-guard.test.tsx.
let current: Set<string> = read();
const listeners = new Set<() => void>();
// Non-React observers, kept in their OWN set on purpose: `subscribe` below treats "no listeners" as
// "nobody has been keeping `current` honest, re-read it", and a permanent module-level subscriber
// would silently disable that. These fire on every change and never unsubscribe.
const observers = new Set<() => void>();

function emit(): void {
  // Copy first: a listener that unsubscribes while we notify must not reshape the set mid-iteration.
  for (const notify of [...listeners]) notify();
  for (const notify of [...observers]) notify();
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
    if (e.key !== null && e.key !== DISMISSED_KEY) return;
    current = read();
    emit();
  });
}

/// Run `fn` whenever the set changes, from outside React. Used to drop derived caches that were
/// computed against the old set — see `use-scan.ts`, where a stale cached scan would otherwise keep
/// re-seeding a limiter the user had just set aside.
export function onDismissedChange(fn: () => void): void {
  observers.add(fn);
}

/// The same one set, for the non-React callers (`fetchScan`, which runs outside any component and
/// has to hand the set-asides to the priorities ranker). Never snapshot this into a variable that
/// outlives a tick — read it at the moment you need it.
export function dismissedIdList(): string[] {
  // No subscriber may exist yet (fetchScan can run before any surface mounts), so `current` could
  // be stale from a previous mount cycle — re-read for the same reason `subscribe` does.
  if (listeners.size === 0) current = read();
  return [...current];
}

export function useDismissed() {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  const dismiss = (id: string) => {
    if (current.has(id)) return; // idempotent — and no pointless re-render storm
    const next = new Set(current);
    next.add(id);
    commit(next);
  };
  const restore = (id: string) => {
    if (!current.has(id)) return;
    const next = new Set(current);
    next.delete(id);
    commit(next);
  };
  return { dismissed, dismiss, restore };
}
