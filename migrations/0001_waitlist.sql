-- D1 schema for the compy_waitlist database (binding DB in wrangler.toml).
-- Committed so the schema is reproducible from the repo: apply with
--   npx wrangler d1 migrations apply compy_waitlist
-- The email PRIMARY KEY is the constraint functions/api/waitlist.ts's
-- `INSERT ... ON CONFLICT(email) DO NOTHING` targets — without a matching unique/PK
-- index, every signup 500s ("ON CONFLICT clause does not match ..."). ip_hash is the
-- SHA-256(pepper+IP) the per-IP-hour rate limit counts over; created_at is an ISO string
-- from datetime('now'). This mirrors the table the live DB was hand-created with; running
-- it against that DB is a no-op (IF NOT EXISTS), and recreates it faithfully anywhere else.
CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ip_hash    TEXT NOT NULL
);

-- The rate-limit query filters by ip_hash + created_at window; index it so the COUNT stays
-- cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_waitlist_ip_hash_created_at ON waitlist (ip_hash, created_at);
