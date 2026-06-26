import { describe, it, expect, beforeEach } from "vitest";
import { peekProbe, cachedProbe, invalidateProbe } from "./data/probe-cache";

describe("probe-cache", () => {
  beforeEach(() => invalidateProbe());

  it("peek is undefined before anything is cached", () => {
    expect(peekProbe("k")).toBeUndefined();
  });

  it("cachedProbe fetches once and serves the cache within the TTL", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };
    const a = await cachedProbe("k", fetcher, 100_000);
    const b = await cachedProbe("k", fetcher, 100_000);
    expect(a).toBe(1);
    expect(b).toBe(1); // served from cache, fetcher not re-run
    expect(calls).toBe(1);
    expect(peekProbe<number>("k")).toBe(1);
  });

  it("a 0ms TTL always refetches (stale immediately)", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };
    await cachedProbe("k", fetcher, 0);
    const second = await cachedProbe("k", fetcher, 0);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it("invalidate(key) drops just that key; invalidate() clears everything", async () => {
    await cachedProbe("a", async () => "A", 100_000);
    await cachedProbe("b", async () => "B", 100_000);
    invalidateProbe("a");
    expect(peekProbe("a")).toBeUndefined();
    expect(peekProbe("b")).toBe("B");
    invalidateProbe();
    expect(peekProbe("b")).toBeUndefined();
  });

  it("caches falsy/empty values (empty array won't trigger a re-fetch loop)", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return [] as string[];
    };
    await cachedProbe("empty", fetcher, 100_000);
    expect(peekProbe<string[]>("empty")).toEqual([]);
    await cachedProbe("empty", fetcher, 100_000);
    expect(calls).toBe(1);
  });
});
