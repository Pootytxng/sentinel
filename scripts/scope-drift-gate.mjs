#!/usr/bin/env node
// The write-scope backstop, as a gate (#356).
//
// scripts/verify-local.ps1 runs this before the test suite on every push. It compares the paths this
// checkout changed since origin/main -- committed, staged, unstaged, untracked -- with the Write
// scope of the claim this folder holds, and fails the push on any path the claim never covered.
//
// It does not read commands. The shell-ownership hook already guesses, before a command runs, what
// it will touch; that is a warning. This is the measurement, and it is authoritative BECAUSE it
// reads only results: a redirect, a script, a tool the hooks never saw -- whatever wrote the file,
// the file is in the diff.
//
// What it refuses to do is pretend. A folder with no session record is measured only when the board,
// read fresh, names it in exactly one row that the folder agrees with, and that issue's thread, read
// fresh, holds a live claim naming it (#573). Short of that it has no claim to check against and
// passes with "not measured" on the log; so does a claim it cannot read, and so does a claim its
// thread says is over, whatever copy of it the cache still holds (#459). A gate that failed every
// unlaunched checkout would be switched off within the day, and a gate that passed them silently
// would be lying about what it checked.
//
//   node scripts/scope-drift-gate.mjs [--issue N] [--cwd DIR] [--base REF] [--refresh] [--offline]
//                                     [--cache-dir DIR] [--json]
//
//   --issue     the claim to compare with; default: this folder's session record, else the one
//               board row naming this folder (#573)
//   --refresh   re-read the issue thread even when the cache is fresh
//   --offline   never touch GitHub; a missing or stale cache is reported, not refreshed, and the
//               board is not asked
//   exit 1      changed paths outside the claim's scope; 0 otherwise (including "not measured")

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORRUPT, EXPECTED_REPO, fetchBoardRows, observeLive, readLineage, REPO, rowsFor } from "../.claude/hooks/session-root-assert.mjs";
import { readIssueThread } from "../tools/entry/gather.mjs";
import { declaresNone } from "./lib/claim-scope.mjs";
import {
  changedPaths,
  claimCacheDir,
  driftReport,
  dropClaimCache,
  isFresh,
  readClaimCache,
  renderDrift,
  samePath,
  writeClaimCache,
} from "./lib/scope-drift.mjs";

export function parseArgs(argv) {
  const out = { issue: null, cwd: process.cwd(), base: "origin/main", refresh: false, offline: false, cacheDir: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--issue") out.issue = Number(argv[++i]);
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a === "--base") out.base = argv[++i];
    else if (a === "--cache-dir") out.cacheDir = argv[++i];
    else if (a === "--refresh") out.refresh = true;
    else if (a === "--offline") out.offline = true;
    else if (a === "--json") out.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

/**
 * The claim to measure against, and where it came from. Cache first; the thread when the cache is
 * missing, stale, or a refresh was asked for and the caller allowed the network; the stale cache
 * again when the thread could not be read -- labelled stale, because a verdict from a claim that
 * may have been widened since is a verdict with a caveat.
 *
 * A thread that WAS read and holds no live claim is a different fact (#459): a Handoff released the
 * lease, or none was taken. The cache is only a copy of that thread, so it cannot outvote it. The
 * copy is dropped and the answer is `vacant`, with the thread's newest Handoff, for the gate to
 * report as not measured.
 */
export function resolveClaim({ issue, cacheDir, refresh = false, offline = false, now = new Date(), thread = readIssueThread }) {
  const cached = readClaimCache({ issue, dir: cacheDir });
  const fresh = cached && isFresh(cached, { now });
  if (fresh && !refresh) return { claim: cached, source: "cache", stale: false };
  if (!offline) {
    try {
      const read = thread(issue);
      const live = read?.claim ?? null;
      if (live && typeof live.scope === "string") {
        const record = writeClaimCache(
          { issue, scopeText: live.scope, folder: live.folder ?? null, branch: live.branch ?? null, postedAt: live.postedAt ?? null, source: "thread" },
          { dir: cacheDir, now },
        );
        return { claim: record, source: "thread", stale: false };
      }
      // readIssueThread never throws; a thread it could not read comes back `unreadable: true`.
      if (!live && read && read.unreadable !== true) {
        dropClaimCache({ issue, dir: cacheDir });
        return { claim: null, source: "thread", stale: false, vacant: true, handoff: read.handoff ?? null };
      }
      if (!cached) return { claim: null, source: "thread", stale: false };
    } catch {
      // fall through to whatever the cache holds
    }
  }
  if (cached) return { claim: cached, source: "cache", stale: !fresh };
  return { claim: null, source: "none", stale: false };
}

/** The folder as git sees it right now: top-level, origin, branch. A field it cannot read is null. */
export function liveFolder(root) {
  let toplevel = null;
  try {
    toplevel = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    toplevel = null;
  }
  return { ...observeLive(root), toplevel };
}

/**
 * The issue a folder with no session record serves, when the board and the thread agree on it (#573).
 *
 * A receipts carrier started by hand has no session record, so the gate measured nothing even while
 * the carrier's claim sat live on its issue. Nothing here is taken from a copy:
 *   1. the board is read fresh, never from board.json; a failed or truncated read is no answer;
 *   2. exactly one row names this folder. Board status and issue state are not filters: a closed,
 *      Done carrier issue with a live claim is the case this exists for;
 *   3. this folder is its git top-level, its origin is this repository, and its branch is the row's;
 *   4. the thread is read fresh, and only a live claim read from it counts, one naming this folder.
 *      Its Branch line is not compared: real ones carry prose ("claude/x (at main …)").
 *
 * Returns `{ issue, claim, source, stale }` to measure against, or `{ reason }` for "not measured".
 */
export function boardFallback({ root, board = fetchBoardRows, live = liveFolder, thread = readIssueThread, cacheDir, now = new Date() }) {
  const lead = "no session record for this folder";
  const rows = board();
  if (!Array.isArray(rows)) return { reason: `${lead}, and the board could not be read (a failed or truncated read; board.json is never used here)` };
  const mine = rowsFor(rows, root);
  if (mine.length === 0) return { reason: `${lead}, and no board row names this folder` };
  if (mine.length > 1) {
    const named = mine.map((r) => `#${r.issue} on ${r.branch}${r.status ? ` (${r.status})` : ""}`).join("; ");
    return { reason: `${lead}, and ${mine.length} board rows name this folder (${named}); more than one is no answer` };
  }
  const [row] = mine;
  const onRow = `${lead}; the board row naming it is #${row.issue} on ${row.branch}`;
  const seen = live(root) ?? {};
  if (!seen.toplevel || !samePath(seen.toplevel, root)) {
    return { reason: `${onRow}, but this folder is not the git top-level (${seen.toplevel ?? "no repository read"})` };
  }
  if (seen.repo !== EXPECTED_REPO) return { reason: `${onRow}, but this folder's origin is ${seen.repo ?? "unreadable"}, not ${REPO}` };
  if (!seen.branch) return { reason: `${onRow}, but this folder's branch cannot be read (a detached HEAD)` };
  if (seen.branch !== row.branch) return { reason: `${onRow}, but this folder is on ${seen.branch}` };

  const { claim, source, vacant, handoff } = resolveClaim({ issue: row.issue, cacheDir, refresh: true, now, thread });
  if (source !== "thread" || !claim) {
    if (vacant && handoff?.released) {
      return { reason: `${onRow}, but its claim was released by a Handoff${handoff.postedAt ? ` (${handoff.postedAt})` : ""}` };
    }
    if (vacant) return { reason: `${onRow}, but the thread on #${row.issue} was read and holds no live claim` };
    return { reason: `${onRow}, but the thread on #${row.issue} could not be read, and no cached claim counts here` };
  }
  if (!claim.folder) return { reason: `${onRow}, but the live claim on #${row.issue} names no Worktree folder` };
  if (!samePath(claim.folder, root)) return { reason: `${onRow}, but the live claim on #${row.issue} names another folder (${claim.folder})` };
  return { issue: row.issue, claim, source, stale: false };
}

/** The whole verdict as data, so a test can read it and `--json` can print it. */
export function gate({
  issue = null,
  cwd = process.cwd(),
  base = "origin/main",
  refresh = false,
  offline = false,
  cacheDir = claimCacheDir(),
  now = new Date(),
  lineage = readLineage,
  thread = readIssueThread,
  board = fetchBoardRows,
  live = liveFolder,
  git = undefined,
} = {}) {
  const root = resolve(cwd);
  let issueNo = Number.isInteger(issue) && issue > 0 ? issue : null;
  let fromBoard = null;
  if (issueNo === null) {
    const record = lineage({ root });
    if (record && record !== CORRUPT && Number.isInteger(record.issue) && record.issue > 0) issueNo = record.issue;
    else if (record === null && !offline) {
      // No record at all (not a corrupt one, not one without an issue) and the network is allowed.
      fromBoard = boardFallback({ root, board, live, thread, cacheDir, now });
      if (!fromBoard.claim) return { ok: true, measured: false, reason: fromBoard.reason, root };
      issueNo = fromBoard.issue;
    }
  }
  if (issueNo === null) {
    return { ok: true, measured: false, reason: "no session record for this folder (launch through tools/entry, or pass --issue)", root };
  }
  const issueSource = fromBoard ? { issueSource: "board" } : {};
  const { claim, source, stale, vacant, handoff } = fromBoard ?? resolveClaim({ issue: issueNo, cacheDir, refresh, offline, now, thread });
  if (vacant) {
    const reason = handoff?.released
      ? `claim released: a Handoff on #${issueNo}${handoff.postedAt ? ` (${handoff.postedAt})` : ""} ended its lease, and a released claim's scope vouches for nothing`
      : `no live claim: the thread on #${issueNo} was read and holds none`;
    return { ok: true, measured: false, issue: issueNo, reason, root };
  }
  if (!claim) {
    return { ok: true, measured: false, issue: issueNo, reason: `no claim readable for #${issueNo} (thread ${offline ? "not consulted" : "unreadable or claim-less"}, no cache)`, root };
  }
  if (claim.folder && !samePath(claim.folder, root)) {
    return {
      ok: true,
      measured: false,
      issue: issueNo,
      reason: `the live claim on #${issueNo} names another folder (${claim.folder}); this checkout is not that lane's writer, so its scope does not apply here`,
      root,
    };
  }
  const changed = changedPaths({ cwd: root, base, ...(git ? { git } : {}) });
  // `Write scope: none` is a declared scope that holds no path (#554): measured, not skipped.
  const report = driftReport({ changed: changed.paths, scope: claim.scope, none: declaresNone(claim.scopeText) });
  if (!report.measured) {
    return { ok: true, measured: false, issue: issueNo, ...issueSource, reason: `the claim on #${issueNo} declares no backticked paths in its Write scope; nothing to compare with`, root, claimSource: source };
  }
  return {
    ok: report.outside.length === 0,
    measured: true,
    issue: issueNo,
    ...issueSource,
    root,
    base: changed.base,
    notes: changed.notes,
    claimSource: source,
    stale,
    scope: report.scope,
    none: report.none,
    changed: changed.paths,
    covered: report.covered,
    outside: report.outside,
  };
}

export function render(result) {
  if (!result.measured) return `scope drift (#356): not measured -- ${result.reason}`;
  const head =
    `scope drift (#356): ${result.changed.length} changed path${result.changed.length === 1 ? "" : "s"} since ` +
    `${result.base ?? "(no base)"} measured against the claim on #${result.issue} (${result.claimSource}${result.stale ? ", stale" : ""}` +
    `${result.issueSource === "board" ? "; issue from the board row naming this folder, no session record" : ""})`;
  const notes = result.notes.map((n) => `  note: ${n}`);
  if (result.ok && result.none) return [head, ...notes, "OK: the claim declares `Write scope: none`, and nothing changed"].join("\n");
  if (result.ok) return [head, ...notes, `OK: every changed path is inside ${result.scope.map((s) => `\`${s}\``).join(", ")}`].join("\n");
  return [head, ...notes, renderDrift({ issue: result.issue, outside: result.outside, scope: result.scope, stale: result.stale, none: result.none })].join("\n");
}

/** The CLI's exit status for a verdict: 1 only for measured drift; "not measured" passes. */
export const exitCode = (result) => (result.ok ? 0 : 1);

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  const result = gate({
    issue: args.issue,
    cwd: args.cwd,
    base: args.base,
    refresh: args.refresh,
    offline: args.offline,
    ...(args.cacheDir ? { cacheDir: args.cacheDir } : {}),
  });
  process.stdout.write(`${args.json ? JSON.stringify(result, null, 2) : render(result)}\n`);
  process.exit(exitCode(result));
}
