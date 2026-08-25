// Same-origin Tier 2 usage-analytics endpoint (Pages Function) — Q9a, built DARK.
//
// Nothing in the shipped app calls this yet: `receipts_gate()` (src-tauri/src/receipts.rs) is
// hard-false, so the Rust send path refuses before it reaches the network. This endpoint exists
// first on purpose — the arming commit should flip a gate in front of a receiver that has already
// been reviewed, not stand one up in the same breath.
//
// Design record: docs/decisions/2026-08-18-outbound-capability-expansion.md §2 + §3b, and the
// B_land destination decision. It deliberately reuses the posture functions/api/waitlist.ts already
// proves in production (same-origin, no third party, hashed IP, rate-limited) and departs from it in
// exactly two places, both of which make it stricter:
//
//   1. SEPARATE DATABASE AND TABLE. The waitlist lives in `compy_waitlist` (binding DB). This writes
//      to `compy_reports` (binding REPORTS). Tier 3 (Q9b) will land in its own table in that same
//      database — storage may be shared, consent and transport never are, so it gets its own
//      endpoint and its own table and inherits no consent from this one.
//
//   2. THE RECEIPT ROW CARRIES NO NETWORK IDENTIFIER. waitlist.ts stores ip_hash on the row because
//      a waitlist entry is inherently identified (it is an email address). A usage receipt is not,
//      and a per-row ip_hash would quietly re-link every submission from one machine into a profile
//      — which would make the first-run disclosure less true than it claims to be. So the hash lives
//      only in `usage_rate`, is used only to count, and is DELETED once it leaves the rate window.
//      An hour after a submission there is nothing left to link it to.
//
// The scrub is enforced TWICE. src-tauri/src/receipts.rs sanitizes every string into the payload
// (adversarially test-pinned: no hostname, username, path, serial or exact byte count can survive).
// This endpoint re-validates the same invariants and REFUSES a payload that violates them rather
// than storing it. A receiver that trusts its client is not a scrub, it is a hope; and if a future
// build regresses the builder, the wall is here too.

// Minimal local types — functions/ is bundled by wrangler (workerd runtime), not by the app's
// tsconfig; these declarations keep the file self-contained without adding a dep.
interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql: string): D1Prepared;
  batch(statements: D1Prepared[]): Promise<unknown>;
}
interface Env {
  /** `compy_reports` — Tier 2 receipts and (later, separately) Tier 3 case evidence. */
  REPORTS: D1Database;
  /** Pages secret (`wrangler pages secret put IP_PEPPER`) — never in the repo. */
  IP_PEPPER?: string;
}
type PagesContext = {
  request: Request;
  env: Env;
};

/** The only payload version this receiver understands. A newer app is refused, never guessed at. */
const SUPPORTED_SCHEMA_VERSION = 1;

/** Per-ip_hash, per-hour. A machine sends at most one receipt per session; this is a wall for
 *  scripts, not a constraint any real user can reach. */
const MAX_PER_HOUR = 20;

/** Bodies are tiny (a few hundred bytes). Anything larger is not one of our payloads. */
const MAX_BODY_BYTES = 4096;

/** Same fallback posture as waitlist.ts: the REAL pepper is the IP_PEPPER Pages secret, so a leaked
 *  table cannot be brute-forced back to raw IPv4s. This exists only so a missing secret degrades to
 *  hashed-not-raw rather than to raw. */
const IP_PEPPER_FALLBACK = "compy-usage-v1:";

// ---------------------------------------------------------------------------------------------
// Scrub re-validation. These mirror the guarantees src-tauri/src/receipts.rs makes; a payload that
// fails any of them is a bug or an attack, and either way it does not get stored.
// ---------------------------------------------------------------------------------------------

/** A scrubbed token is a lowercase basename: no path separators, no drive colon, no @, no control
 *  characters. `sanitize_token` in receipts.rs cannot produce a string that fails this, which is
 *  exactly why a string that fails it did not come from `sanitize_token`. */
const TOKEN_RE = /^[a-z0-9][a-z0-9 ._+()-]{0,63}$/;

/** Catalog rec ids are machine-generated slugs, never free text. */
const REC_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// Buckets and the vendor token are CLOSED VOCABULARIES, copied from their producers in
// src-tauri/src/receipts.rs (`ram_gb_bucket`, `duration_bucket`, `gpu_vendor_token`). Pinning the
// exact strings rather than pattern-matching them is deliberate on two counts: a free-text bucket
// would be a scrub hole with extra steps, and `duration_bucket` legitimately emits "<15min" and
// "3h+", which no sane token pattern should be widened to admit. `usage-endpoint.test.mjs` pins
// these three sets against the Rust source, so a producer-side edit fails the build here instead of
// silently 400-ing every real payload in production.
const RAM_BUCKETS = new Set(["unknown", "0-8", "9-16", "17-24", "25-32", "33-64", "64+"]);
const DURATION_BUCKETS = new Set([
  "unknown",
  "<15min",
  "15-30min",
  "30-60min",
  "1-3h",
  "3h+",
]);
const GPU_VENDORS = new Set(["amd", "nvidia", "intel", "other"]);

const isToken = (v: unknown): v is string => typeof v === "string" && TOKEN_RE.test(v);

/** Finite, non-negative, and inside a range no real frame counter leaves. NaN/Infinity are refused
 *  rather than coerced — a NaN in the column would silently poison every later average. */
const isFps = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 5000;

type Payload = {
  schema_version: number;
  hw_class: { gpu_vendor: string; gpu_model: string; cpu_family: string; ram_gb_bucket: string };
  outcome: {
    kind: string;
    game: string;
    avg_fps: number;
    low1_fps_est: number;
    duration_bucket: string;
    active_change_ids: string[];
  };
};

/** Returns the validated payload, or null. Deliberately returns no reason to the client: a probing
 *  caller learns nothing about which field it got wrong. The app's own preview surface is where a
 *  user inspects the payload, and it never needs this endpoint to explain itself. */
function validate(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const p = body as Record<string, unknown>;

  if (p.schema_version !== SUPPORTED_SCHEMA_VERSION) return null;

  const hw = p.hw_class as Record<string, unknown> | undefined;
  if (typeof hw !== "object" || hw === null) return null;
  if (typeof hw.gpu_vendor !== "string" || !GPU_VENDORS.has(hw.gpu_vendor)) return null;
  if (!isToken(hw.gpu_model) || !isToken(hw.cpu_family)) return null;
  if (typeof hw.ram_gb_bucket !== "string" || !RAM_BUCKETS.has(hw.ram_gb_bucket)) return null;

  const out = p.outcome as Record<string, unknown> | undefined;
  if (typeof out !== "object" || out === null) return null;
  if (out.kind !== "session") return null;
  if (!isToken(out.game)) return null;
  if (typeof out.duration_bucket !== "string" || !DURATION_BUCKETS.has(out.duration_bucket)) {
    return null;
  }
  if (!isFps(out.avg_fps) || !isFps(out.low1_fps_est)) return null;

  const ids = out.active_change_ids;
  if (!Array.isArray(ids) || ids.length > 64) return null;
  if (!ids.every((id) => typeof id === "string" && REC_ID_RE.test(id))) return null;

  return {
    schema_version: SUPPORTED_SCHEMA_VERSION,
    hw_class: {
      gpu_vendor: hw.gpu_vendor,
      gpu_model: hw.gpu_model,
      cpu_family: hw.cpu_family,
      ram_gb_bucket: hw.ram_gb_bucket,
    },
    outcome: {
      kind: "session",
      game: out.game,
      avg_fps: out.avg_fps,
      low1_fps_est: out.low1_fps_est,
      duration_bucket: out.duration_bucket,
      active_change_ids: ids as string[],
    },
  };
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const onRequestPost = async (ctx: PagesContext): Promise<Response> => {
  const { request, env } = ctx;

  // JSON only. This endpoint is spoken to by the Rust client, never by a browser form, so there is
  // no form-encoded path and no redirect behaviour to maintain.
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ ok: false }, { status: 415 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json({ ok: false }, { status: 413 });
  }

  // Read as text first so an oversized body with no/lying content-length is capped too, and a
  // truncated or non-JSON body fails here rather than inside the parser.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) return Response.json({ ok: false }, { status: 413 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const payload = validate(parsed);
  if (!payload) return Response.json({ ok: false }, { status: 400 });

  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const ipHash = await sha256Hex((env.IP_PEPPER ?? IP_PEPPER_FALLBACK) + ip);

  try {
    // One batch = one D1 transaction, and the order is load-bearing:
    //
    //   1. Prune `usage_rate` past the window. This is what keeps the hash short-lived — the table
    //      is self-emptying, so retention is a property of the write path rather than a promise in
    //      a document somebody has to remember to honour.
    //   2. Insert the receipt, guarded by a correlated COUNT over the (now-pruned) rate rows. Same
    //      idiom waitlist.ts uses and for the same reason: a separate SELECT-then-INSERT let N
    //      concurrent POSTs each read count < limit before any sibling committed.
    //   3. Record the attempt. It lands whether or not step 2 stored anything, so a caller hammering
    //      a rejected payload still burns its own budget instead of retrying for free.
    await env.REPORTS.batch([
      env.REPORTS.prepare("DELETE FROM usage_rate WHERE created_at <= datetime('now', '-1 hour')"),
      env.REPORTS.prepare(
        "INSERT INTO usage_receipts " +
          "(received_at, schema_version, gpu_vendor, gpu_model, cpu_family, ram_gb_bucket, " +
          " outcome_kind, game, avg_fps, low1_fps_est, duration_bucket, active_change_ids) " +
          "SELECT datetime('now'), ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 " +
          "WHERE (SELECT COUNT(*) FROM usage_rate WHERE ip_hash = ?12) < ?13",
      ).bind(
        payload.schema_version,
        payload.hw_class.gpu_vendor,
        payload.hw_class.gpu_model,
        payload.hw_class.cpu_family,
        payload.hw_class.ram_gb_bucket,
        payload.outcome.kind,
        payload.outcome.game,
        payload.outcome.avg_fps,
        payload.outcome.low1_fps_est,
        payload.outcome.duration_bucket,
        JSON.stringify(payload.outcome.active_change_ids),
        ipHash,
        MAX_PER_HOUR,
      ),
      env.REPORTS.prepare(
        "INSERT INTO usage_rate (ip_hash, created_at) VALUES (?1, datetime('now'))",
      ).bind(ipHash),
    ]);
  } catch {
    // No internals to the client, and nothing PII-bearing is thrown or logged.
    return Response.json({ ok: false }, { status: 500 });
  }

  // Over-limit is reported as success on purpose: the client has nothing useful to do about it,
  // and a distinguishable "you are rate limited" reply is a free oracle for probing the limit.
  return Response.json({ ok: true });
};

// POST-only. A bare GET — a curious visitor or a scanner — gets an honest 405 rather than falling
// through to the static site, so /api/usage can never masquerade as a page.
export const onRequestGet = (): Response =>
  new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
