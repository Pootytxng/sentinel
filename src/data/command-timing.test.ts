import { describe, it, expect } from "vitest";
import {
  CommandTimings,
  installCommandTiming,
  ipcCommandOf,
  percentile,
} from "./command-timing";

describe("percentile (nearest rank)", () => {
  it("matches hand-computed ranks", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 100)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});

describe("ipcCommandOf", () => {
  it("reads the command from both IPC URL shapes, decoding plugin names", () => {
    expect(ipcCommandOf("http://ipc.localhost/get_hardware_info")).toBe("get_hardware_info");
    expect(ipcCommandOf("ipc://localhost/get_build_stamp")).toBe("get_build_stamp");
    expect(ipcCommandOf("http://ipc.localhost/plugin%3Aevent%7Clisten")).toBe("plugin:event|listen");
  });
  it("ignores everything that is not IPC", () => {
    expect(ipcCommandOf("https://compy.gg/api/waitlist")).toBeNull();
    expect(ipcCommandOf("http://localhost:1420/src/main.tsx")).toBeNull();
    expect(ipcCommandOf("http://ipc.localhost/")).toBeNull();
    expect(ipcCommandOf("not a url")).toBeNull();
  });
});

describe("CommandTimings", () => {
  it("summarises per command, slowest p95 first, counting errors", () => {
    const t = new CommandTimings();
    for (let i = 1; i <= 20; i++) t.record("fast", i, true);
    for (let i = 1; i <= 20; i++) t.record("slow", i * 10, i !== 3);
    const [slow, fast] = t.summary();
    expect(slow).toEqual({ command: "slow", count: 20, p50: 100, p95: 190, max: 200, errors: 1 });
    expect(fast).toMatchObject({ command: "fast", p50: 10, p95: 19, errors: 0 });
    t.reset();
    expect(t.summary()).toEqual([]);
  });

  it("keeps only the newest samples once the cap is reached, but counts every call", () => {
    const t = new CommandTimings(4);
    for (const ms of [1000, 1000, 1, 2, 3, 4]) t.record("c", ms, true);
    const [row] = t.summary();
    expect(row.count).toBe(6);
    expect(row.max).toBe(4); // the two 1000s were overwritten
  });
});

describe("installCommandTiming", () => {
  function host(response: () => Promise<Response>) {
    const calls: string[] = [];
    const h = {
      fetch: (input: RequestInfo | URL) => {
        calls.push(String(input));
        return response();
      },
    };
    return { h, calls };
  }

  it("times IPC calls, passes other requests through untimed, and is idempotent", async () => {
    const { h, calls } = host(() => Promise.resolve(new Response("{}", { status: 200 })));
    const t = new CommandTimings();
    let clock = 0;
    const now = () => (clock += 5);
    expect(installCommandTiming(h, t, now)).toBe(true);
    expect(installCommandTiming(h, t, now)).toBe(false);

    await h.fetch("http://ipc.localhost/get_recommendations");
    await h.fetch("https://example.com/x");
    expect(calls).toEqual(["http://ipc.localhost/get_recommendations", "https://example.com/x"]);
    expect(t.summary()).toEqual([
      { command: "get_recommendations", count: 1, p50: 5, p95: 5, max: 5, errors: 0 },
    ]);
  });

  it("counts a non-ok response and a rejected request as errors, and still propagates", async () => {
    const t = new CommandTimings();
    const bad = host(() => Promise.resolve(new Response("boom", { status: 400 })));
    installCommandTiming(bad.h, t);
    const res = await bad.h.fetch("ipc://localhost/set_license_key");
    expect(res.status).toBe(400);

    const down = host(() => Promise.reject(new Error("offline")));
    installCommandTiming(down.h, t);
    await expect(down.h.fetch("ipc://localhost/set_license_key")).rejects.toThrow("offline");

    expect(t.summary()[0]).toMatchObject({ command: "set_license_key", count: 2, errors: 2 });
  });
});
