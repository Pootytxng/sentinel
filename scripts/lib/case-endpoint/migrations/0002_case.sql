-- Tier 3 (Q9b) case evidence — Stage 3 schema. LOCAL ONLY, NOT DEPLOYED.
--
-- Contract: docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md §5, §6, §7, §9.
--
-- THIS DIRECTORY IS NOT A CONFIGURED MIGRATIONS DIRECTORY. wrangler.toml declares exactly two —
-- `migrations` (DB / compy_waitlist) and `migrations-reports` (REPORTS / compy_reports). This file
-- sits under scripts/lib/case-endpoint/migrations/, which is neither, so `wrangler d1 migrations
-- apply` cannot pick it up and no deploy can run it. It is applied by the local fixture in
-- scripts/case-endpoint.test.mjs and nowhere else. Moving it into migrations-reports/ is a
-- deliberate, reviewed act of arming — not a tidy-up. scripts/case-endpoint-isolation.test.mjs
-- fails if it ever lands in either configured directory.
--
-- The `0002_` prefix is the number it would take in migrations-reports/ on the day it is armed
-- (0001 is Tier 2's usage table). It carries no meaning where the file currently lives.

-- The case itself. Note what is NOT here: no ip_hash, no user agent, no session id, no account,
-- no column that could link two cases to one machine (§5). The payload is stored as the exact
-- validated JSON so that what was reviewed on the consent screen is what is at rest.
CREATE TABLE IF NOT EXISTS case_evidence (
  ticket_id         TEXT PRIMARY KEY,
  -- §6: SHA-256(pepper + deletion_secret). The raw secret is returned to the client once and is
  -- never stored, so the server cannot recover it, cannot mail it back, and cannot delete a case
  -- on a user's behalf without it.
  deletion_verifier TEXT NOT NULL,
  received_at       TEXT NOT NULL,
  -- §9: an explicit column, written once at insert as received_at + 30 days. Nothing extends it.
  -- It is a column rather than a computed expression so that a shortened retention policy applies
  -- to rows already at rest by rewriting them deliberately, not by a silent change in behaviour.
  expires_at        TEXT NOT NULL,
  schema_version    INTEGER NOT NULL,
  -- 'comment' | 'incident' | 'both' — derived server-side, never taken from the wire.
  kind              TEXT NOT NULL,
  payload_json      TEXT NOT NULL
);

-- Expiry is swept on every submission, so it is the one column that is scanned by range.
CREATE INDEX IF NOT EXISTS idx_case_evidence_expires ON case_evidence (expires_at);

-- §5: the ONLY place a network identifier exists, and it is a peppered hash used to count. Rows
-- leave the window an hour after they are written, and nothing joins this table to case_evidence.
CREATE TABLE IF NOT EXISTS case_rate (
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_rate_lookup ON case_rate (ip_hash, created_at);

-- §7: a withdrawal has to outlive the provider's own backup horizon, or a restore could quietly
-- resurrect a case the user deleted. The tombstone is the record that says it was withdrawn. It
-- holds the ticket id and nothing else — no payload, no hash, no fragment of the case.
CREATE TABLE IF NOT EXISTS case_tombstones (
  ticket_id  TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_tombstones_deleted ON case_tombstones (deleted_at);
