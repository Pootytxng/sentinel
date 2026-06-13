// Same-origin waitlist endpoint (Pages Function) — spec 2026-06-12-waitlist-wiring.
// The landing form POSTs here (native form OR the page script's fetch — both same-origin;
// the site's zero-THIRD-PARTY invariant is untouched). Writes {email, created_at, ip_hash}
// to D1. Privacy boundary: the raw IP is hashed (SHA-256 + static pepper) before it touches
// storage and is NEVER logged; the email is stored only to send the one launch message.
// Spam posture per spec: hidden honeypot + per-IP-hash rate limit. No Turnstile (it would
// load a third-party script on a page whose pitch is that it loads none).

// Minimal local types — functions/ is bundled by wrangler (workerd runtime), not by the
// app's tsconfig; these declarations keep the file self-contained without adding a dep.
interface D1Result<T> {
  first<U = T>(): Promise<U | null>;
  run(): Promise<unknown>;
}
interface D1Prepared {
  bind(...values: unknown[]): D1Result<unknown> & D1Prepared;
  first<U>(): Promise<U | null>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql: string): D1Prepared;
}
interface Env {
  DB: D1Database;
  /** Pages secret (set via `wrangler pages secret put IP_PEPPER`) — never in the repo. */
  IP_PEPPER?: string;
}
type PagesContext = {
  request: Request;
  env: Env;
};

// Pragmatic shape check (full RFC validation is a lie anyway); hard length caps.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@.]{2,63}$/;
const MAX_PER_HOUR = 5; // per ip_hash — generous for humans, a wall for scripts

// Fallback linkability salt. The REAL pepper is the IP_PEPPER Pages secret (set in the CF
// account, never the repo) — with a secret pepper, a leaked table can't be brute-forced back
// to raw IPv4s. This fallback only exists so a missing secret degrades to hashed-not-raw.
const IP_PEPPER_FALLBACK = "compy-waitlist-v1:";

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const onRequestPost = async (ctx: PagesContext): Promise<Response> => {
  const { request, env } = ctx;
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  const redirect = (flag: string) =>
    new Response(null, { status: 303, headers: { Location: `/?waitlist=${flag}` } });
  const ok = () =>
    wantsJson
      ? Response.json({ ok: true })
      : redirect("ok");
  const bad = (message: string) =>
    wantsJson
      ? Response.json({ ok: false, error: message }, { status: 400 })
      : redirect("invalid");

  let email = "";
  let honeypot = "";
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      email = String(body.email ?? "");
      honeypot = String(body.website ?? "");
    } else {
      const form = await request.formData();
      email = String(form.get("email") ?? "");
      honeypot = String(form.get("website") ?? "");
    }
  } catch {
    return bad("That submission didn't come through — try again.");
  }

  // Honeypot tripped → report success and store nothing (don't teach the bot).
  if (honeypot.trim() !== "") return ok();

  email = email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return bad("That doesn't look like an email address — check it and try again.");
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const ipHash = await sha256Hex((env.IP_PEPPER ?? IP_PEPPER_FALLBACK) + ip);

  try {
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM waitlist WHERE ip_hash = ?1 AND created_at > datetime('now', '-1 hour')",
    )
      .bind(ipHash)
      .first<{ n: number }>();
    // Over the limit → report success, store nothing (same don't-teach-the-bot posture).
    if ((recent?.n ?? 0) >= MAX_PER_HOUR) return ok();

    // Idempotent: a duplicate email is a no-op, and the user still sees the thanks state.
    await env.DB.prepare(
      "INSERT INTO waitlist (email, created_at, ip_hash) VALUES (?1, datetime('now'), ?2) ON CONFLICT(email) DO NOTHING",
    )
      .bind(email, ipHash)
      .run();
  } catch {
    // No internals to the client; nothing PII-bearing is thrown or logged.
    return wantsJson
      ? Response.json({ ok: false, error: "Couldn't save that right now — try again in a minute." }, { status: 500 })
      : redirect("error");
  }

  return ok();
};

// This is a POST-only endpoint (the form POSTs here). A bare GET — a curious visitor or a
// scanner — should get an honest 405, not fall through to the static index. No body, no data,
// no D1: a static method-guard so /api/waitlist never masquerades as a page.
export const onRequestGet = (): Response =>
  new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
