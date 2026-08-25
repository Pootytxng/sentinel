-- D1 schema for the compy_reports database (binding REPORTS in wrangler.toml).
-- Apply with:  npx wrangler d1 migrations apply compy_reports
--
-- This database is deliberately SEPARATE from compy_waitlist: a waitlist row is an identified
-- record (it is an email address) and a usage receipt is not, so they never share a table and never
-- share a query. Tier 3 case evidence (Q9b) will add its own tables here later; storage may be
-- shared, consent and transport never are.
--
-- Written for Q9a while the feature is DARK. The database is empty on purpose — receipts_gate()
-- in src-tauri/src/receipts.rs is hard-false, so nothing sends until the owner arms it.

-- The receipt itself. Note what is NOT here: no ip_hash, no machine id, no install id, no
-- account, no free-text column of any kind. Every value is either a closed-vocabulary bucket or a
-- token that src-tauri/src/receipts.rs `sanitize_token` reduced to a lowercase basename, and
-- functions/api/usage.ts re-validates all of it before this INSERT runs. There is no column here
-- that two receipts from the same PC could be joined on, which is what makes the first-run
-- disclosure literally true rather than merely well-intentioned.
CREATE TABLE IF NOT EXISTS usage_receipts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at       TEXT    NOT NULL,  -- ISO string from datetime('now'), server-side
  schema_version    INTEGER NOT NULL,
  gpu_vendor        TEXT    NOT NULL,  -- amd | nvidia | intel | other
  gpu_model         TEXT    NOT NULL,  -- retail class name, shared by thousands of rigs
  cpu_family        TEXT    NOT NULL,
  ram_gb_bucket     TEXT    NOT NULL,  -- bucketed, never an exact byte count
  outcome_kind      TEXT    NOT NULL,
  game              TEXT    NOT NULL,  -- basename only; a path cannot survive sanitize_token
  avg_fps           REAL    NOT NULL,
  low1_fps_est      REAL    NOT NULL,
  duration_bucket   TEXT    NOT NULL,
  active_change_ids TEXT    NOT NULL   -- JSON array of catalog rec ids — ids only, never values
);

-- The two questions this table exists to answer are "what hardware is Compy actually running on"
-- and "which catalog changes are actually active", both sliced by time. Index for those rather
-- than for the primary key nobody will query by.
CREATE INDEX IF NOT EXISTS idx_usage_receipts_received_at ON usage_receipts (received_at);
CREATE INDEX IF NOT EXISTS idx_usage_receipts_gpu_vendor ON usage_receipts (gpu_vendor);

-- Rate-limit ledger, and NOTHING else. It holds SHA-256(pepper + IP) only so functions/api/usage.ts
-- can count recent attempts from one source; it is never joined to usage_receipts and there is no
-- key to join it on.
--
-- Retention is enforced by the WRITE PATH, not by a policy someone has to remember: every POST
-- begins by deleting rows past the one-hour window, inside the same transaction as the insert. So
-- the table self-empties, and an hour after a submission there is no stored value that could link
-- it to a network address. That property is what the privacy text is allowed to claim.
CREATE TABLE IF NOT EXISTS usage_rate (
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_rate_ip_hash_created_at ON usage_rate (ip_hash, created_at);
