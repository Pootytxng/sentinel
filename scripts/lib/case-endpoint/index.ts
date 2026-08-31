// Tier 3 (Q9b) case-evidence receiver — Stage 3, LOCAL ONLY, NOT DEPLOYED.
//
// Contract: docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md §5, §6, §7, §9,
// §11. §11 is the boundary this file honours: "Receiver + migration, local/staged ONLY — not
// public, not deployed." Deployment is a later stage and owner territory.
//
// WHY IT LIVES UNDER scripts/lib/ AND NOT functions/. .github/workflows/deploy-site.yml fires on
// site/**, site-app/**, functions/**, src/data/**, scripts/stage-dist-site.mjs and its own file;
// scripts/stage-dist-site.mjs copies only functions/ into the published bundle; and wrangler.toml
// configures exactly two migrations directories, migrations/ and migrations-reports/. This module
// and its migration are outside every one of those. scripts/case-endpoint-isolation.test.mjs
// proves each of those five statements against the real files rather than trusting this comment.
//
// It exports the names the Pages runtime looks for (`onRequestPost`, `onRequestDelete`,
// `onRequestGet`) on purpose: the day this is reviewed and armed, that lane is a file MOVE plus a
// binding, not a rewrite. Until then nothing routes to it — the app cannot even build a request,
// because `case_evidence_gate()` is a literal `false` and no send command exists.
//
// It follows functions/api/usage.ts (Tier 2) closely, and departs where the contract requires:
//
//   1. THE CASE ROW CARRIES NO NETWORK IDENTIFIER (§5). The ip_hash lives only in `case_rate`,
//      counts only, and is deleted when it leaves the rate window. An hour after a submission
//      there is nothing left to link a case to a machine.
//
//   2. A DELETION SECRET THE SERVER CANNOT REPRODUCE (§6). The row stores
//      SHA-256(pepper + secret); the secret itself is returned to the client once and never
//      persisted. Losing it means the case can only expire, never be recalled — which is the
//      point: possession of the secret is the whole authorization.
//
//   3. NOTHING EXTENDS RETENTION (§9). `expires_at` is an explicit column written once at
//      insert. There is no archive, no cold copy, and no code path that moves the date.
//
// Consent is NOT inherited from Tier 2. Storage may be shared; consent and transport never are.

// Minimal local types. This module is deliberately dependency-free — the same reason
// functions/api/usage.ts declares its own: it must be readable and reviewable on its own terms.
interface D1Result {
  results?: unknown[];
}
interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  run(): Promise<D1Result>;
  first(): Promise<Record<string, unknown> | null>;
}
interface D1Database {
  prepare(sql: string): D1Prepared;
  batch(statements: D1Prepared[]): Promise<unknown>;
}
interface Env {
  /** `compy_reports` — Tier 2 receipts and, in its own table, Tier 3 case evidence. */
  REPORTS: D1Database;
  /** Pages secret (`wrangler pages secret put IP_PEPPER`) — never in the repo. */
  IP_PEPPER?: string;
}
export type PagesContext = {
  request: Request;
  env: Env;
};

import {
  CASE_SCHEMA_VERSION,
  MAX_BODY_BYTES,
  caseKind,
  validateCase,
  type CasePayload,
} from './validate';

/**
 * Per ip_hash, per hour. A case is a deliberate human act — write a comment, review the exact
 * bytes on the consent screen, submit. Ten an hour is a wall for a script, not a limit a person
 * can reach.
 */
const MAX_PER_HOUR = 10;

/** §9. Written once at insert; nothing in this file or the migration moves it. */
const RETENTION_DAYS = 30;

/**
 * §7. A tombstone must outlive the provider's own recovery horizon by a real margin, or a
 * "deleted" case could be restored from a backup with nothing left to say it was withdrawn.
 * Thirty-one days is retention + one day and is the floor the contract sets today; it is a
 * number to RE-DERIVE against the provider's verified horizon before this is ever armed, not a
 * constant to trust because it is written down.
 */
const TOMBSTONE_RETENTION_DAYS = 31;

/**
 * Only used when the Pages secret is missing, which on a local fixture is the normal case. It
 * makes the hash useless as a cross-deployment correlator rather than making it absent — an
 * unpeppered hash of an IPv4 address is trivially reversible by enumeration.
 */
const IP_PEPPER_FALLBACK = 'compy-case-local-fixture-pepper';

const JSON_HEADERS = { 'content-type': 'application/json' };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Every refusal that is not a shape error says exactly this and no more. */
function refuse(status: number): Response {
  return json({ ok: false }, status);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * §6. Compares without an early exit on the first differing character.
 *
 * Stated honestly: this removes the per-character differential inside the comparison. It does not
 * make the whole request constant-time — a ticket that exists does a database read a ticket that
 * does not also does, but the row it finds is a different size. Both paths return the identical
 * response, which is the property the contract actually asks for.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? '';
}

async function ipHash(request: Request, env: Env): Promise<string> {
  return sha256Hex(`${env.IP_PEPPER ?? IP_PEPPER_FALLBACK}:${clientIp(request)}`);
}

function isJsonRequest(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  return type.split(';')[0].trim().toLowerCase() === 'application/json';
}

/**
 * Reads the body under BOTH caps: the declared length first, so an oversized upload is refused
 * before it is read, and the actual bytes second, because a declared length is a claim.
 * Returns the text, or the status to refuse with.
 */
async function readBoundedBody(request: Request): Promise<{ text: string } | { status: number }> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return { status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { status: 413 };
  return { text };
}

// ---------------------------------------------------------------------------
// POST /api/case — submit
// ---------------------------------------------------------------------------

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  if (!isJsonRequest(request)) return refuse(415);

  const body = await readBoundedBody(request);
  if ('status' in body) return refuse(body.status);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return refuse(400);
  }

  const payload = validateCase(parsed);
  if (payload === null) return refuse(400);

  const ticketId = randomHex(16); // §6: 128 bits.
  const deletionSecret = randomHex(32); // §6: 256 bits. Returned once, never stored.

  try {
    const hash = await ipHash(request, env);
    const verifier = await sha256Hex(`${env.IP_PEPPER ?? IP_PEPPER_FALLBACK}:${deletionSecret}`);
    await insertCase(env, { hash, ticketId, verifier, payload });
  } catch {
    return refuse(500);
  }

  // §5, and the reason it reads strangely: an over-limit submission returns exactly this, with a
  // ticket for a row that was never written. Anything else — a 429, a different body, a missing
  // ticket — is an oracle that tells a prober precisely where the wall is. A ticket that names no
  // row behaves like any other unknown ticket at deletion time: the same generic refusal.
  return json({ ok: true, ticket_id: ticketId, deletion_secret: deletionSecret }, 200);
}

async function insertCase(
  env: Env,
  args: { hash: string; ticketId: string; verifier: string; payload: CasePayload },
): Promise<void> {
  const db = env.REPORTS;
  const kind = caseKind(args.payload);
  const payloadJson = JSON.stringify(args.payload);

  // One transaction, and the ORDER IS LOAD-BEARING. The rate window is pruned before it is
  // counted, so the count is the window; expiry and tombstone pruning ride the same write so
  // retention is enforced mechanically on every submission rather than by a schedule that may
  // never have been configured; the insert is guarded by the count; the attempt is recorded last
  // so that an over-limit attempt still costs the sender its slot.
  await db.batch([
    db.prepare("DELETE FROM case_rate WHERE created_at < datetime('now', '-1 hour')"),
    db.prepare("DELETE FROM case_evidence WHERE expires_at <= datetime('now')"),
    db
      .prepare(`DELETE FROM case_tombstones WHERE deleted_at < datetime('now', ?)`)
      .bind(`-${TOMBSTONE_RETENTION_DAYS} days`),
    db
      .prepare(
        `INSERT INTO case_evidence
           (ticket_id, deletion_verifier, received_at, expires_at, schema_version, kind, payload_json)
         SELECT ?, ?, datetime('now'), datetime('now', ?), ?, ?, ?
          WHERE (SELECT COUNT(*) FROM case_rate WHERE ip_hash = ?) < ?`,
      )
      .bind(
        args.ticketId,
        args.verifier,
        `+${RETENTION_DAYS} days`,
        CASE_SCHEMA_VERSION,
        kind,
        payloadJson,
        args.hash,
        MAX_PER_HOUR,
      ),
    db
      .prepare("INSERT INTO case_rate (ip_hash, created_at) VALUES (?, datetime('now'))")
      .bind(args.hash),
  ]);
}

// ---------------------------------------------------------------------------
// DELETE /api/case — withdraw
// ---------------------------------------------------------------------------
//
// Included with the receiver rather than left for a later stage on purpose: `deletion_verifier`
// and `case_tombstones` are in the migration, and schema nothing exercises is schema nobody has
// proved. §7's retention rule in particular is only real if something prunes.

export async function onRequestDelete(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  if (!isJsonRequest(request)) return refuse(415);

  const body = await readBoundedBody(request);
  if ('status' in body) return refuse(body.status);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return refuse(400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return refuse(400);

  const fields = parsed as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (key !== 'ticket_id' && key !== 'deletion_secret') return refuse(400);
  }
  const ticketId = fields.ticket_id;
  const deletionSecret = fields.deletion_secret;
  // The credential never travels in a URL, so it is read from the body and shaped-checked here.
  if (typeof ticketId !== 'string' || !/^[0-9a-f]{32}$/.test(ticketId)) return refuse(400);
  if (typeof deletionSecret !== 'string' || !/^[0-9a-f]{64}$/.test(deletionSecret)) return refuse(400);

  try {
    // Hashed BEFORE the lookup, unconditionally, so a wrong ticket and a wrong secret do the same
    // work in the same order.
    const verifier = await sha256Hex(`${env.IP_PEPPER ?? IP_PEPPER_FALLBACK}:${deletionSecret}`);
    const row = await env.REPORTS.prepare(
      'SELECT deletion_verifier FROM case_evidence WHERE ticket_id = ?',
    )
      .bind(ticketId)
      .first();

    const stored = typeof row?.deletion_verifier === 'string' ? row.deletion_verifier : null;
    // §6: an unknown ticket and a wrong secret return the SAME refusal. Distinguishing them would
    // turn this endpoint into a ticket-existence oracle.
    if (stored === null || !constantTimeEqual(stored, verifier)) return refuse(404);

    await env.REPORTS.batch([
      env.REPORTS.prepare('DELETE FROM case_evidence WHERE ticket_id = ?').bind(ticketId),
      env.REPORTS.prepare(
        "INSERT OR IGNORE INTO case_tombstones (ticket_id, deleted_at) VALUES (?, datetime('now'))",
      ).bind(ticketId),
      env.REPORTS.prepare("DELETE FROM case_tombstones WHERE deleted_at < datetime('now', ?)").bind(
        `-${TOMBSTONE_RETENTION_DAYS} days`,
      ),
    ]);
  } catch {
    return refuse(500);
  }

  return json({ ok: true }, 200);
}

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

/** There is nothing to read here. A case is write-then-withdraw; it is never served back. */
export async function onRequestGet(): Promise<Response> {
  return new Response(JSON.stringify({ ok: false }), {
    status: 405,
    headers: { ...JSON_HEADERS, allow: 'POST, DELETE' },
  });
}
