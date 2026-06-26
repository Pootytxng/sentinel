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

/** Serve the cached value if younger than ttlMs, else run fetcher and cache the result. */
export async function cachedProbe<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fetcher();
  store.set(key, { value, at: Date.now() });
  return value;
}

/** Drop one key, or the whole cache when called with no argument (after any mutation). */
export function invalidateProbe(key?: string): void {
  if (key === undefined) store.clear();
  else store.delete(key);
}
