// The session-root assertion (spec §4.3), re-exported from where it now lives.
//
// Owner decision 2 (Issue #18, 2026-07-30) made `.claude/hooks/` the single canonical hook source and
// tracked it, so the implementation moved to `.claude/hooks/session-root-assert.mjs`. It has to live
// there rather than here: `--repair` copies that one folder into older branches, and a hook that
// imported `../../tools/entry/…` would fail to load in exactly the folders being repaired.
//
// This file stays because `launch.mjs`, `cli.mjs` and the existing guards import from it — and
// because "the launch token" is an entrypoint concern even though "the SessionStart hook" is not. It
// re-exports; it does not copy. Two implementations of the assertion that decides whether a session
// may write are two answers to one question, so session-root-assert.test.mjs pins these identical by
// reference.

export {
  ADVISORY_CODES,
  assertSessionRoot,
  canonicalizePath,
  claimToken,
  claimedAtOf,
  CORRUPT,
  DEFAULT_TTL_MINUTES,
  LINEAGE_TTL_MINUTES,
  lineageFile,
  makeToken,
  normalizeRepo,
  observeLive,
  readLineage,
  readToken,
  removeLineage,
  resolveSessionRoot,
  samePath,
  sweepLineage,
  TOKEN_DIR,
  TOKEN_NAME,
  verdictFor,
  verifySession,
  writeLineage,
  writeToken,
} from "../../.claude/hooks/session-root-assert.mjs";
