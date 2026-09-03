// @vitest-environment node
//
// Tier 3 (Q9b) case receiver — behaviour proof against a real SQL engine.
//
// This does NOT stub the handler's database. It runs the ACTUAL exported handlers against a
// `node:sqlite` database with the actual migration applied, through a D1-shaped shim whose only
// job is to translate D1's prepare/bind/run/first/batch onto SQLite. A hand-written fake would
// have let the SQL itself go unproven, and the SQL is where the rate guard, the expiry sweep and
// the tombstone retention actually live.
//
// `node:sqlite` ships with Node (v22.5+), so this costs the repo no dependency — which the
// ZERO-BUDGET law asks for and which also keeps a security-sensitive path free of supply chain.
//
// STAGE 3 BOUNDARY: nothing here deploys, arms a gate, or touches functions/. Isolation is proved
// separately and mechanically in scripts/case-endpoint-isolation.test.mjs.

import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  onRequestPost,
  onRequestDelete,
  onRequestGet,
} from './lib/case-endpoint/index.ts';

const MIGRATION = fileURLToPath(
  new URL('./lib/case-endpoint/migrations/0002_case.sql', import.meta.url),
);

// ---------------------------------------------------------------------------
// The D1 shim
// ---------------------------------------------------------------------------

function d1(db) {
  const statement = (sql, values) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      db.prepare(sql).run(...values);
      return {};
    },
    first: async () => db.prepare(sql).get(...values) ?? null,
  });
  return {
    prepare: (sql) => statement(sql, []),
    // D1's batch is one transaction: every statement lands or none does.
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        for (const s of statements) await s.run();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

let db;
let env;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(MIGRATION, 'utf8'));
  env = { REPORTS: d1(db), IP_PEPPER: 'fixture-pepper' };
});

const rows = (sql, ...args) => db.prepare(sql).all(...args);
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

function post(body, { ip = '203.0.113.9', contentType = 'application/json', raw = null } = {}) {
  const text = raw ?? JSON.stringify(body);
  return onRequestPost({
    request: new Request('https://example.invalid/api/case', {
      method: 'POST',
      headers: { 'content-type': contentType, 'CF-Connecting-IP': ip },
      body: text,
    }),
    env,
  });
}

function del(body, { ip = '203.0.113.9' } = {}) {
  return onRequestDelete({
    request: new Request('https://example.invalid/api/case', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify(body),
    }),
    env,
  });
}

/** A comment-only case: the minimum the producer will assemble. */
const COMMENT_CASE = {
  schema_version: 1,
  compy_version: '0.9.26',
  user_comment: 'the game froze for about ten seconds and then came back',
};

/** Everything the producer can put on the wire at once. */
const FULL_CASE = {
  schema_version: 1,
  compy_version: '0.9.26',
  user_comment: 'crashed to desktop right after the shader step',
  incident_kind: 'app-crash',
  occurred_at: '2026-06-12T21:42:00+02:00',
  app_family: 'cyberpunk2077',
  module_family: 'nvwgf2umx.dll',
  error_code: '0xc0000005',
  gpu_vendor: 'amd',
  gpu_model: 'amd radeon rx 9070 xt',
  cpu_family: 'zen 5',
  ram_gb_bucket: '25-32',
  windows_build: '26100.1742',
  gpu_driver_version: '25.5.1',
};

describe('POST /api/case — accepting a case', () => {
  it('stores a comment-only case and hands back a ticket and a one-time secret', async () => {
    const res = await post(COMMENT_CASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ticket_id).toMatch(/^[0-9a-f]{32}$/); // §6: 128 bits.
    expect(body.deletion_secret).toMatch(/^[0-9a-f]{64}$/); // §6: 256 bits.

    const stored = rows('SELECT * FROM case_evidence');
    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe('comment');
    expect(stored[0].schema_version).toBe(1);
    expect(JSON.parse(stored[0].payload_json)).toEqual(COMMENT_CASE);
  });

  it('derives the kind server-side rather than taking it from the wire', async () => {
    await post(FULL_CASE);
    expect(rows('SELECT kind FROM case_evidence')[0].kind).toBe('both');

    const { user_comment: _dropped, ...incidentOnly } = FULL_CASE;
    db.exec('DELETE FROM case_evidence');
    await post(incidentOnly);
    expect(rows('SELECT kind FROM case_evidence')[0].kind).toBe('incident');
  });

  it('round-trips the full payload byte-for-byte', async () => {
    await post(FULL_CASE);
    expect(JSON.parse(rows('SELECT payload_json FROM case_evidence')[0].payload_json)).toEqual(
      FULL_CASE,
    );
  });

  it('never stores the deletion secret anywhere', async () => {
    const body = await (await post(COMMENT_CASE)).json();
    const everything = JSON.stringify([
      rows('SELECT * FROM case_evidence'),
      rows('SELECT * FROM case_rate'),
      rows('SELECT * FROM case_tombstones'),
    ]);
    expect(everything).not.toContain(body.deletion_secret);
  });

  it('§5: the case row carries no network identifier at all', async () => {
    await post(COMMENT_CASE);
    const columns = db
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all('case_evidence')
      .map((c) => c.name);
    expect(columns).toEqual([
      'ticket_id',
      'deletion_verifier',
      'received_at',
      'expires_at',
      'schema_version',
      'kind',
      'payload_json',
    ]);
    // The hash exists in exactly one place, and only to count.
    expect(count('case_rate')).toBe(1);
  });

  it('§9: expiry is thirty days after receipt, written at insert', async () => {
    await post(COMMENT_CASE);
    const row = rows(
      "SELECT expires_at = datetime(received_at, '+30 days') AS matches FROM case_evidence",
    )[0];
    expect(row.matches).toBe(1);
  });
});

describe('POST /api/case — refusing a case', () => {
  const refused = async (body, options) => {
    const res = await post(body, options);
    expect(count('case_evidence')).toBe(0);
    return res;
  };

  it('refuses a non-JSON content type with 415', async () => {
    expect((await refused(COMMENT_CASE, { contentType: 'text/plain' })).status).toBe(415);
  });

  it('refuses malformed JSON with 400', async () => {
    expect((await refused(null, { raw: '{not json' })).status).toBe(400);
  });

  it('refuses a body past 16 KiB with 413', async () => {
    const oversized = 'x'.repeat(17000);
    expect((await refused(null, { raw: oversized })).status).toBe(413);
  });

  it('refuses an unknown field rather than ignoring it', async () => {
    const res = await refused({ ...COMMENT_CASE, extra_field: 'anything' });
    expect(res.status).toBe(400);
    // §5: no reason is returned. A validator that explains itself is a probe's field guide.
    expect(await res.json()).toEqual({ ok: false });
  });

  it('refuses a schema version it does not understand', async () => {
    expect((await refused({ ...COMMENT_CASE, schema_version: 2 })).status).toBe(400);
  });

  it('refuses a shapeless case — neither comment nor incident', async () => {
    expect((await refused({ schema_version: 1, compy_version: '0.9.26' })).status).toBe(400);
  });

  it('refuses an incident kind without its time, and a time without its kind', async () => {
    const { occurred_at: _t, ...noTime } = FULL_CASE;
    expect((await refused(noTime)).status).toBe(400);
    const { incident_kind: _k, ...noKind } = FULL_CASE;
    expect((await refused(noKind)).status).toBe(400);
  });

  it('refuses an incident detail that arrived without the incident it comes from', async () => {
    expect(
      (await refused({ ...COMMENT_CASE, app_family: 'cyberpunk2077' })).status,
    ).toBe(400);
  });

  it('refuses a partial hardware block — the producer emits four or none', async () => {
    const { ram_gb_bucket: _r, ...threeOfFour } = FULL_CASE;
    expect((await refused(threeOfFour)).status).toBe(400);
  });

  it('refuses a timestamp carrying seconds, or a bare Z', async () => {
    expect(
      (await refused({ ...FULL_CASE, occurred_at: '2026-06-12T21:42:37+02:00' })).status,
    ).toBe(400);
    expect((await refused({ ...FULL_CASE, occurred_at: '2026-06-12T21:42:00Z' })).status).toBe(400);
  });

  it('refuses an unknown incident kind, vendor or RAM bucket', async () => {
    expect((await refused({ ...FULL_CASE, incident_kind: 'disk-failure' })).status).toBe(400);
    expect((await refused({ ...FULL_CASE, gpu_vendor: 'matrox' })).status).toBe(400);
    expect((await refused({ ...FULL_CASE, ram_gb_bucket: '17' })).status).toBe(400);
  });

  it('refuses a token the producer would have sanitized', async () => {
    expect((await refused({ ...FULL_CASE, app_family: 'Cyberpunk2077' })).status).toBe(400);
    expect((await refused({ ...FULL_CASE, app_family: 'c:\\games\\x' })).status).toBe(400);
    expect((await refused({ ...FULL_CASE, app_family: 'user@host' })).status).toBe(400);
    expect((await refused({ ...FULL_CASE, error_code: '0xC0000005' })).status).toBe(400);
    expect((await refused({ ...FULL_CASE, windows_build: '26100.beta' })).status).toBe(400);
    expect((await refused({ ...FULL_CASE, gpu_model: 'x'.repeat(65) })).status).toBe(400);
  });

  it('refuses a full-width separator smuggled into a family token', async () => {
    // `sanitize_token` does not fold full-width, so `＼` would sail past a naive `\` check.
    expect((await refused({ ...FULL_CASE, app_family: 'games＼x' })).status).toBe(400);
  });

  it('refuses a full-width identifier inside a token, where folding is load-bearing', async () => {
    // Full-width is ALLOWED in these fields — `sanitize_token` does not fold, so a game named in
    // full-width characters is legitimate. That is exactly why the detectors must fold before
    // they look: unfolded, `１９２.１６８.１.４４` is four unrecognized runs and travels intact.
    // The comment field never reaches this path (a comment carrying full-width is refused
    // outright), so a token is the only place this fold can be proved.
    expect((await refused({ ...FULL_CASE, app_family: '１９２.１６８.１.４４' })).status).toBe(400);
    expect((await refused({ ...FULL_CASE, gpu_model: '５ＣＤ１２３４ＡＢＣＤＥ９８７６' })).status).toBe(400);
  });

  it('refuses full-width capitals, which the producer would have lowercased', async () => {
    expect((await refused({ ...FULL_CASE, app_family: 'ＧＡＭＥ' })).status).toBe(400);
  });
});

describe('POST /api/case — the second redaction wall', () => {
  const comment = (text) => ({ ...COMMENT_CASE, user_comment: text });
  const refuses = async (text) => {
    const res = await post(comment(text));
    expect(count('case_evidence')).toBe(0);
    return res.status;
  };

  it('refuses a Windows path, a UNC path, an environment path and a unix path', async () => {
    expect(await refuses('it died at C:\\Users\\kuya\\game.exe')).toBe(400);
    expect(await refuses('the share \\\\fileserver\\builds went away')).toBe(400);
    expect(await refuses('check %APPDATA%\\Compy for it')).toBe(400);
    expect(await refuses('logs in /home/kuya/logs')).toBe(400);
  });

  it('refuses an address, a key and a serial', async () => {
    expect(await refuses('cannot reach 192.168.1.44 any more')).toBe(400);
    expect(await refuses('key ABCD-EFGH-IJKL-MNOP rejected')).toBe(400);
    expect(await refuses('board serial 5CD1234ABCDE9876 in the bios')).toBe(400);
  });

  it('refuses a full-width path — the fold runs before detection, as it does in the app', async () => {
    expect(await refuses('it died at Ｃ：＼Users＼kuya')).toBe(400);
  });

  it('refuses invisible format characters, which no honest comment carries', async () => {
    expect(await refuses('perfectly\u202Enormal text')).toBe(400); // bidi override
    expect(await refuses('zero\u200Bwidth')).toBe(400);
    expect(await refuses('control\u0007char')).toBe(400);
  });

  it('refuses an over-long or empty comment', async () => {
    expect(await refuses('x'.repeat(2001))).toBe(400);
    expect(await refuses('')).toBe(400);
  });

  it('accepts the masks the app leaves behind — they are not identifiers', async () => {
    const res = await post(comment('crashed launching <path>, <user> saw it on <host>'));
    expect(res.status).toBe(200);
    expect(count('case_evidence')).toBe(1);
  });

  it('accepts ordinary prose that merely looks technical', async () => {
    // A single colon is a clock, not an address; a lone `/v` is a switch, not a path. The producer
    // deliberately leaves both readable, so the wall must not refuse them either.
    const res = await post(comment('it froze at 12:30 after I ran it with /v enabled'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/case — the rate wall', () => {
  it('stops storing past the cap and reports success anyway, so there is no oracle', async () => {
    const bodies = [];
    for (let i = 0; i < 12; i++) {
      const res = await post(COMMENT_CASE);
      expect(res.status).toBe(200);
      bodies.push(await res.json());
    }
    expect(bodies.every((b) => b.ok === true && /^[0-9a-f]{32}$/.test(b.ticket_id))).toBe(true);
    // Ten stored, twelve acknowledged, twelve counted against the window.
    expect(count('case_evidence')).toBe(10);
    expect(count('case_rate')).toBe(12);
  });

  it('counts per ip_hash, so one sender cannot exhaust another', async () => {
    for (let i = 0; i < 11; i++) await post(COMMENT_CASE, { ip: '198.51.100.7' });
    expect(count('case_evidence')).toBe(10);
    await post(COMMENT_CASE, { ip: '203.0.113.9' });
    expect(count('case_evidence')).toBe(11);
  });

  it('releases the window an hour later, and the hash is gone with it', async () => {
    for (let i = 0; i < 10; i++) await post(COMMENT_CASE);
    db.exec("UPDATE case_rate SET created_at = datetime('now', '-2 hours')");
    await post(COMMENT_CASE);
    expect(count('case_evidence')).toBe(11);
    expect(count('case_rate')).toBe(1); // the ten aged rows were deleted, not just ignored
  });
});

describe('POST /api/case — retention sweeps', () => {
  it('§9: deletes an expired case on the next submission', async () => {
    await post(COMMENT_CASE);
    db.exec("UPDATE case_evidence SET expires_at = datetime('now', '-1 day')");
    await post(COMMENT_CASE);
    expect(count('case_evidence')).toBe(1); // the new one only
  });

  it('§7: keeps a tombstone past retention and drops it past its own horizon', async () => {
    const body = await (await post(COMMENT_CASE)).json();
    await del({ ticket_id: body.ticket_id, deletion_secret: body.deletion_secret });
    expect(count('case_tombstones')).toBe(1);

    db.exec("UPDATE case_tombstones SET deleted_at = datetime('now', '-30 days')");
    await post(COMMENT_CASE);
    expect(count('case_tombstones')).toBe(1); // 30 days is inside the 31-day horizon

    db.exec("UPDATE case_tombstones SET deleted_at = datetime('now', '-32 days')");
    await post(COMMENT_CASE);
    expect(count('case_tombstones')).toBe(0);
  });
});

describe('DELETE /api/case — withdrawing a case', () => {
  it('deletes the case and leaves a tombstone when the secret matches', async () => {
    const body = await (await post(COMMENT_CASE)).json();
    const res = await del({ ticket_id: body.ticket_id, deletion_secret: body.deletion_secret });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(count('case_evidence')).toBe(0);
    expect(rows('SELECT ticket_id FROM case_tombstones')[0].ticket_id).toBe(body.ticket_id);
  });

  it('§6: a wrong secret and an unknown ticket are indistinguishable', async () => {
    const body = await (await post(COMMENT_CASE)).json();
    const wrongSecret = await del({
      ticket_id: body.ticket_id,
      deletion_secret: 'f'.repeat(64),
    });
    const unknownTicket = await del({
      ticket_id: '0'.repeat(32),
      deletion_secret: body.deletion_secret,
    });
    expect(wrongSecret.status).toBe(unknownTicket.status);
    expect(await wrongSecret.json()).toEqual(await unknownTicket.json());
    expect(wrongSecret.status).toBe(404);
    // Neither refusal touched the stored case.
    expect(count('case_evidence')).toBe(1);
    expect(count('case_tombstones')).toBe(0);
  });

  it('a ticket from a rate-suppressed submission behaves exactly like an unknown one', async () => {
    let suppressed;
    for (let i = 0; i < 11; i++) suppressed = await (await post(COMMENT_CASE)).json();
    const res = await del({
      ticket_id: suppressed.ticket_id,
      deletion_secret: suppressed.deletion_secret,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false });
  });

  it('refuses a malformed ticket or secret without looking anything up', async () => {
    expect((await del({ ticket_id: 'nope', deletion_secret: 'f'.repeat(64) })).status).toBe(400);
    expect((await del({ ticket_id: '0'.repeat(32), deletion_secret: 'short' })).status).toBe(400);
    expect(
      (await del({ ticket_id: '0'.repeat(32), deletion_secret: 'f'.repeat(64), extra: 1 })).status,
    ).toBe(400);
  });
});

describe('the endpoint serves nothing back', () => {
  it('answers GET with 405 and names the methods that exist', async () => {
    const res = await onRequestGet();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST, DELETE');
  });
});
