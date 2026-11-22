import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequestPost } from "../functions/api/waitlist";

// The waitlist endpoint's latency readout: a Server-Timing header plus one structured log line that
// carries route, status and duration ONLY (the file's privacy boundary: no email, IP or IP hash).
function ctx(body: Record<string, string>, db: { run: () => Promise<unknown> }) {
  const prepared = { bind: () => prepared, run: db.run, first: async () => null };
  return {
    request: new Request("https://compy.gg/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "cf-connecting-ip": "203.0.113.9" },
      body: JSON.stringify(body),
    }),
    env: { DB: { prepare: () => prepared } },
  } as unknown as Parameters<typeof onRequestPost>[0];
}

afterEach(() => vi.restoreAllMocks());

describe("waitlist latency readout", () => {
  it("adds Server-Timing and logs one PII-free api_timing line on success", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await onRequestPost(ctx({ email: "someone@example.com" }, { run: async () => ({}) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toMatch(/^app;dur=\d+$/);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({ evt: "api_timing", route: "/api/waitlist", status: 200, ms: expect.any(Number) });
    expect(line).not.toMatch(/someone|example\.com|203\.0\.113/);
  });

  it("times the failure paths too (bad input, storage error)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = await onRequestPost(ctx({ email: "nope" }, { run: async () => ({}) }));
    const down = await onRequestPost(ctx({ email: "a@example.com" }, { run: async () => { throw new Error("d1"); } }));
    expect([bad.status, down.status]).toEqual([400, 500]);
    expect(bad.headers.get("Server-Timing")).toMatch(/^app;dur=/);
    expect(log.mock.calls.map((c) => JSON.parse(String(c[0])).status)).toEqual([400, 500]);
  });
});
