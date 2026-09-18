// The session assertion (spec §4.3), re-exported from where it now lives.
//
// Owner decision 2 (Issue #18, 2026-07-30) made `.claude/hooks/` the single canonical hook source and
// tracked it, so the implementation moved to `.claude/hooks/session-root-assert.mjs`. It has to live
// there rather than here: `--repair` copies that one folder into older branches, and a hook that
// imported `../../tools/entry/…` would fail to load in exactly the folders being repaired.
//
// This file stays because `launch.mjs`, `cli.mjs` and the existing guards import from it. It
// re-exports; it does not copy. Two implementations of the assertion that decides whether a session
// may write are two answers to one question, so session-root-assert.test.mjs pins these identical by
// reference.
//
// #216 (2026-08-25): the assertion now verifies by FACTS — a work tree of this repo, on the board's
// branch for the issue, with no live competing writer — and no longer by a launch token. The token
// exports below survive as the launcher's own handshake; they admit nobody.

export {
  ADVISORY_CODES,
  assertSessionRoot,
  BOARD_CACHE_NAME,
  BOARD_TTL_MINUTES,
  boardFacts,
  boardRows,
  canonicalizePath,
  claimToken,
  claimedAtOf,
  CLAUDE_PROJECTS_DIR,
  CORRUPT,
  DEFAULT_TTL_MINUTES,
  entryStateDir,
  EXPECTED_REPO,
  fetchBoardRows,
  invalidateBoardCache,
  LAPSED_CODES,
  leaseFor,
  LINEAGE_TTL_MINUTES,
  lineageFile,
  LIVE_GRACE_MINUTES,
  LIVE_STALE_MINUTES,
  livenessOf,
  makeToken,
  normalizeRepo,
  observeLive,
  observeLiveness,
  parseWorktreeEntries,
  pidAlive,
  PROJECT,
  readBoardCache,
  readLineage,
  readToken,
  removeLineage,
  REPO,
  resolveSessionRoot,
  rowsFor,
  samePath,
  sweepLineage,
  TOKEN_DIR,
  TOKEN_NAME,
  transcriptSeenAt,
  UNVERIFIABLE_CODES,
  verdictFor,
  verifySession,
  writeBoardCache,
  writeLineage,
  writeToken,
} from "../../.claude/hooks/session-root-assert.mjs";
