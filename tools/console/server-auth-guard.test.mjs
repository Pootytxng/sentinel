// bug->guard: every /api/* request carries the session token and a trusted origin, whatever its casing
//
// Caught 2026-08-02 (review of merged PRs #48/#52). The origin guard read
// `url.pathname.startsWith("/api/chats")` — case-sensitive — while the transcript route matched
// `/^\/api\/chats\/(claude|codex)\/([0-9a-f-]+)$/i` — case-insensitive. `pathname` was never
// normalized, so `GET /API/chats/CLAUDE/<uuid>` slipped past the guard and still hit the route:
// full transcript returned, trustedOrigin() never called.
//
// The casing bug was the instance. The class was the guard's shape: an ALLOW-list of paths, so
// every new route was unguarded until someone remembered to add it, and one typo reopened the hole.
// These tests pin the replacement contract — deny by default, allow only an explicit public set —
// so a route added next year is guarded before its author thinks about it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createConsoleServer } from "./server.mjs";

const TOKEN = "test-token-not-a-real-secret";
const UUID = "2594b1c6-c069-4949-8c79-bddea3f7832c";

let server;
let base;

beforeAll(async () => {
  server = createConsoleServer({
    token: TOKEN,
    // Stubbed so the guard is what is under test, not the filesystem behind these routes.
    chatStore: { list: () => [], get: () => ({ id: UUID, messages: [] }) },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const get = (path, headers = {}) => fetch(`${base}${path}`, { headers });

describe("console session-token guard", () => {
  it("refuses an /api/ request that carries no token", async () => {
    const res = await get("/api/meta");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("NO_SESSION");
  });

  it("refuses an /api/ request whose token is wrong", async () => {
    const res = await get("/api/meta", { "x-compy-console-token": "wrong" });
    expect(res.status).toBe(403);
  });

  it("refuses a wrong token of the SAME LENGTH as the real one", async () => {
    // Mutation testing 2026-08-02 caught this gap: `tokenMatches` short-circuits on a length
    // mismatch, so a short wrong token is refused by the length check and never reaches the
    // comparison. Replacing the comparison with `return true` left every other test green.
    // This one is the only thing standing between a broken compare and an accepted token.
    const sameLength = "XXXX-token-not-a-real-secret";
    expect(sameLength).toHaveLength(TOKEN.length);
    expect(sameLength).not.toBe(TOKEN);
    const res = await get("/api/meta", { "x-compy-console-token": sameLength });
    expect(res.status).toBe(403);
  });

  it("accepts the token from the cookie the page was served with", async () => {
    const res = await get("/api/meta", { cookie: `compy_console=${TOKEN}` });
    expect(res.status).toBe(200);
  });

  it("accepts the token from a header, so non-browser local scripts still work", async () => {
    const res = await get("/api/meta", { "x-compy-console-token": TOKEN });
    expect(res.status).toBe(200);
  });
});

describe("the casing bypass itself", () => {
  it("refuses the mixed-case transcript path that used to slip past the guard", async () => {
    const res = await get(`/API/chats/CLAUDE/${UUID}`, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("still refuses the correctly-cased transcript path from a foreign origin", async () => {
    const res = await get(`/api/chats/claude/${UUID}`, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("serves the transcript to a request that is both same-origin and tokened", async () => {
    const res = await get(`/api/chats/claude/${UUID}`, { cookie: `compy_console=${TOKEN}` });
    expect(res.status).toBe(200);
  });

  it("still ROUTES a mixed-case path once authenticated, so the normalization stays load-bearing", async () => {
    // Mutation testing 2026-08-02: deleting `.toLowerCase()` left every security test green,
    // because deny-by-default refuses an unrecognized mixed-case path either way. That makes the
    // normalization look like dead code to the next person who tidies this file. It is not — it is
    // what stops a guard and a route from ever disagreeing about the same URL again. Pinned here.
    const res = await get("/API/meta", { "x-compy-console-token": TOKEN });
    expect(res.status).toBe(200);
    expect((await res.json()).revision).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("deny by default", () => {
  it("guards a route that does not exist yet — an unknown /api/ path is 403, not 404", async () => {
    // The point of the whole change: a route invented tomorrow inherits the guard. If this ever
    // returns 404 the guard has gone back to being an allow-list and the class of bug is back.
    const res = await get("/api/some-route-added-next-year");
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown /api/ path once the caller is authenticated", async () => {
    const res = await get("/api/some-route-added-next-year", { "x-compy-console-token": TOKEN });
    expect(res.status).toBe(404);
  });
});

describe("the public bootstrap surface stays reachable", () => {
  it("serves the page without a token and hands back the session cookie", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("compy_console=");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("HttpOnly");
  });

  it("serves journey.mjs without a token — the page imports it as a module and cannot set headers", async () => {
    expect((await get("/journey.mjs")).status).toBe(200);
  });

  it("serves a bundled font without a token", async () => {
    expect((await get("/fonts/GeistVF.woff2")).status).toBe(200);
  });

  it("still refuses a font that is not one of the two bundled faces", async () => {
    // The strict allowlist, not the guard, is what holds here — /fonts/ is public by design.
    expect((await get("/fonts/evil.woff2")).status).toBe(404);
  });

  it("does not let a traversal escape via the public /fonts/ prefix", async () => {
    // `new URL` normalizes this to /secrets.txt, which is not public — so it meets the guard, not
    // the font handler. Either refusal is correct; what matters is that it never reads the file.
    const res = await get("/fonts/../../secrets.txt");
    expect([403, 404]).toContain(res.status);
  });
});
