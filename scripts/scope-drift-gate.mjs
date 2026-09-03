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
// What it refuses to do is pretend. A folder with no session record has no claim to check against
// and passes with "not measured" on the log; so does a claim it cannot read. A gate that failed
// every unlaunched checkout would be switched off within the day, and a gate that passed them
// silently would be lying about what it checked.
//
//   node scripts/scope-drift-gate.mjs [--issue N] [--cwd DIR] [--base REF] [--refresh] [--offline]
//                                     [--cache-dir DIR] [--json]
//
//   --issue     the claim to compare with; default: this folder's session record
//   --refresh   re-read the issue thread even when the cache is fresh
//   --offline   never touch GitHub; a missing or stale cache is reported, not refreshed
//   exit 1      changed paths outside the claim's scope; 0 otherwise (including "not measured")

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORRUPT, readLineage } from "../.claude/hooks/session-root-assert.mjs";
import { readIssueThread } from "../tools/entry/gather.mjs";
import {
  changedPaths,
  claimCacheDir,
  driftReport,
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
 */
export function resolveClaim({ issue, cacheDir, refresh = false, offline = false, now = new Date(), thread = readIssueThread }) {
  const cached = readClaimCache({ issue, dir: cacheDir });
  const fresh = cached && isFresh(cached, { now });
  if (fresh && !refresh) return { claim: cached, source: "cache", stale: false };
  if (!offline) {
    try {
      const live = thread(issue)?.claim ?? null;
      if (live && typeof live.scope === "string") {
        const record = writeClaimCache(
          { issue, scopeText: live.scope, folder: live.folder ?? null, branch: live.branch ?? null, postedAt: live.postedAt ?? null, source: "thread" },
          { dir: cacheDir, now },
        );
        return { claim: record, source: "thread", stale: false };
      }
      if (!cached) return { claim: null, source: "thread", stale: false };
    } catch {
      // fall through to whatever the cache holds
    }
  }
  if (cached) return { claim: cached, source: "cache", stale: !fresh };
  return { claim: null, source: "none", stale: false };
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
  git = undefined,
} = {}) {
  const root = resolve(cwd);
  let issueNo = Number.isInteger(issue) && issue > 0 ? issue : null;
  if (issueNo === null) {
    const record = lineage({ root });
    if (record && record !== CORRUPT && Number.isInteger(record.issue) && record.issue > 0) issueNo = record.issue;
  }
  if (issueNo === null) {
    return { ok: true, measured: false, reason: "no session record for this folder (launch through tools/entry, or pass --issue)", root };
  }
  const { claim, source, stale } = resolveClaim({ issue: issueNo, cacheDir, refresh, offline, now, thread });
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
  const report = driftReport({ changed: changed.paths, scope: claim.scope });
  if (!report.measured) {
    return { ok: true, measured: false, issue: issueNo, reason: `the claim on #${issueNo} declares no backticked paths in its Write scope; nothing to compare with`, root, claimSource: source };
  }
  return {
    ok: report.outside.length === 0,
    measured: true,
    issue: issueNo,
    root,
    base: changed.base,
    notes: changed.notes,
    claimSource: source,
    stale,
    scope: report.scope,
    changed: changed.paths,
    covered: report.covered,
    outside: report.outside,
  };
}

export function render(result) {
  if (!result.measured) return `scope drift (#356): not measured -- ${result.reason}`;
  const head =
    `scope drift (#356): ${result.changed.length} changed path${result.changed.length === 1 ? "" : "s"} since ` +
    `${result.base ?? "(no base)"} measured against the claim on #${result.issue} (${result.claimSource}${result.stale ? ", stale" : ""})`;
  const notes = result.notes.map((n) => `  note: ${n}`);
  if (result.ok) return [head, ...notes, `OK: every changed path is inside ${result.scope.map((s) => `\`${s}\``).join(", ")}`].join("\n");
  return [head, ...notes, renderDrift({ issue: result.issue, outside: result.outside, scope: result.scope, stale: result.stale })].join("\n");
}

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
  process.exit(result.ok ? 0 : 1);
}
