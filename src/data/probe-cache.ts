// Probe cache — a tiny module-level store so re-visiting a tab paints instantly from the last value
// instead of cold-re-scanning the backend on every mount. Surfaces unmount on tab-leave (conditional
// render), which destroys their local useState; without this, returning to Optimize/Advanced re-fires
// the same slow probes (NIC-driver WMI enum, latency MSI/timer scan, hardware-change fingerprint,
// benchmark state) seconds after the last visit. Each entry holds the resolved value + when it was
// fetched; reads within the TTL serve the cache, older reads refetch.
//
// SCOPE: read-only convenience for SLOW, RARELY-CHANGING advisory probes ONLY. It never caches
// mutation/snapshot/rollback reads — the apply/rollback path always reads live Windows state. Mutations
// invalidate the whole cache (App.refresh() calls invalidateProbe()) so nothing goes stale after a
// change. Honest-freshness: TTLs are short and a mutation clears everything.

type Entry<T> = { value: T; at: number };

const store = new Map<string, Entry<unknown>>();

/** Synchronous peek — use to seed useState so a re-visit paints instantly. undefined if absent. */
export function peekProbe<T>(key: string): T | undefined {
  return (store.get(key) as Entry<T> | undefined)?.value;
}

// Reads in flight, by key. Several hooks mounting in the same tick (App plus the Home face it
// renders, both reading the Machine Model) would otherwise each fire the same IPC before the first
// result lands; later callers join the first read instead of repeating it (#452).
const inflight = new Map<string, Promise<unknown>>();

/** Serve the cached value if younger than ttlMs, else run fetcher and cache the result. A read
 *  already in flight for the key is shared, not repeated; a failed read is never cached. */
export function cachedProbe<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  const joined = inflight.get(key) as Promise<T> | undefined;
  if (joined) return joined;
  // Started through a resolved promise so a fetcher that throws synchronously still rejects
  // AFTER the read is registered — a rejection registered before its own cleanup ran would sit in
  // the map and hand every later caller the same failure.
  const read: Promise<T> = Promise.resolve().then(fetcher);
  inflight.set(key, read);
  const settle = () => {
    if (inflight.get(key) === read) inflight.delete(key);
  };
  // Only the read that is still registered may fill the cache: an invalidateProbe() while it was
  // running means the caller wants a fresh read, not this one stored as if it were fresh.
  read.then((value) => {
    if (inflight.get(key) === read) store.set(key, { value, at: Date.now() });
    settle();
  }, settle);
  return read;
}

/** Store a directly-computed value (not invoke-wrapped) — e.g. a multi-call scan result. */
export function putProbe<T>(key: string, value: T): void {
  store.set(key, { value, at: Date.now() });
}

/** Drop one key, or the whole cache when called with no argument (after any mutation). */
export function invalidateProbe(key?: string): void {
  if (key === undefined) {
    store.clear();
    inflight.clear();
  } else {
    store.delete(key);
    inflight.delete(key);
  }
}
