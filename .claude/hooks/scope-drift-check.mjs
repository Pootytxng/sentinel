// PostToolUse — the after-the-fact half of write ownership (#356). Warn-only.
//
// shell-ownership-assert.mjs guesses, before a Bash or PowerShell command runs, which paths it will
// touch, and refuses the ones another lane owns. Guessing is bounded by the parser: a redirect it did
// not model, a script the command invokes, a tool the matcher never sees, and the write lands
// unjudged. This hook does not guess. After every tool that can change the tree it reads what the
// tree actually is -- `git status` plus the commits since origin/main -- and compares that with the
// Write scope of the claim this folder holds. A changed path the claim never covered is reported
// into the session's context, with the cure, while the session can still act on it.
//
// It is a warning and nothing more. PostToolUse cannot undo a write, and a lane that has drifted
// needs to know, not to be blocked from its next command. The verdict lives in
// scripts/scope-drift-gate.mjs, which verify-local.ps1 runs on every push and which FAILS on the
// same measurement. Same library, same claim, same question; this one is early and that one is
// final.
//
// It is quiet by design. No session record for this folder, no claim readable for the issue, a claim
// that names another folder, a scope with no backticked paths: silence, because "cannot measure" is
// not a finding. And a finding is repeated only when the set of drifting paths changes or ten
// minutes pass -- a reminder after every tool call teaches the reader to skip it.
//
// The claim comes from a local cache written by tools/entry/claim.mjs when it posts, refreshed here
// from the issue thread when it is older than ten minutes and GitHub answers. The thread is the
// record; the cache saves the round trip on the hot path. COMPY_SCOPE_DRIFT_OFF=1 silences the hook.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CORRUPT, TOKEN_DIR, readLineage, resolveSessionRoot } from "./session-root-assert.mjs";
import {
  changedPaths,
  claimCacheDir,
  driftReport,
  isFresh,
  readClaimCache,
  renderDrift,
  samePath,
  writeClaimCache,
} from "../../scripts/lib/scope-drift.mjs";

export const OFF_SWITCH = "COMPY_SCOPE_DRIFT_OFF";
/** A finding already reported is repeated after this long, or as soon as the drifting set changes. */
export const REMIND_EVERY_MS = 10 * 60_000;

/**
 * The decision, over facts only. `memo` is what this folder was last told (the drifting paths and
 * when); the returned `memo` is what to remember now.
 */
export function decide({ issue, claim, changed = [], memo = null, now = new Date() }) {
  if (!claim) return { emit: false, reason: "no claim", memo: null };
  const report = driftReport({ changed, scope: claim.scope ?? [] });
  if (!report.measured) return { emit: false, reason: "scope declares no paths", memo: null };
  if (report.outside.length === 0) return { emit: false, reason: "inside scope", memo: null };
  const same = memo && Array.isArray(memo.outside) && memo.outside.join("\n") === report.outside.join("\n");
  const recent = memo && Number.isFinite(Date.parse(memo.at)) && now.getTime() - Date.parse(memo.at) < REMIND_EVERY_MS;
  if (same && recent) return { emit: false, reason: "already reported", memo, outside: report.outside };
  return {
    emit: true,
    reason: "outside scope",
    outside: report.outside,
    message: renderDrift({ issue, outside: report.outside, scope: report.scope, stale: Boolean(claim.stale) }),
    memo: { outside: report.outside, at: now.toISOString() },
  };
}

function memoFile({ issue, cacheDir }) {
  return join(cacheDir, `drift-${Number(issue)}.json`);
}

export function readMemo({ issue, cacheDir }) {
  const file = memoFile({ issue, cacheDir });
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeMemo({ issue, cacheDir }, memo) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(memoFile({ issue, cacheDir }), `${JSON.stringify(memo)}\n`);
}

/** Cache when fresh; the thread when not and the caller can reach it; the stale cache otherwise. */
export function claimFor({ issue, cacheDir, now = new Date(), thread = null }) {
  const cached = readClaimCache({ issue, dir: cacheDir });
  if (cached && isFresh(cached, { now })) return cached;
  if (thread) {
    try {
      const live = thread(issue)?.claim ?? null;
      if (live && typeof live.scope === "string") {
        return writeClaimCache(
          { issue, scopeText: live.scope, folder: live.folder ?? null, branch: live.branch ?? null, postedAt: live.postedAt ?? null, source: "thread" },
          { dir: cacheDir, now },
        );
      }
    } catch {
      // the thread is unreachable; the stale cache is still the best fact available
    }
  }
  return cached ? { ...cached, stale: true } : null;
}

/** The IO shell: the folder, its record, its claim, its diff, one decision. Injectable end to end. */
export function run({
  hookInput,
  env = process.env,
  dir = TOKEN_DIR,
  cacheDir = claimCacheDir({ env }),
  now = new Date(),
  git = undefined,
  thread = null,
} = {}) {
  if (env[OFF_SWITCH] === "1") return null;
  const cwd = hookInput?.cwd ?? process.cwd();
  const resolved = resolveSessionRoot({ env, hookInput, cwd });
  const root = resolved?.root ? resolve(resolved.root) : null;
  if (!root) return null;
  const record = readLineage({ root, dir });
  if (!record || record === CORRUPT || !Number.isInteger(record.issue) || record.issue <= 0) return null;
  const issue = record.issue;
  const claim = claimFor({ issue, cacheDir, now, thread });
  if (!claim) return null;
  if (claim.folder && !samePath(claim.folder, root)) return null;
  const changed = changedPaths({ cwd: root, ...(git ? { git } : {}) }).paths;
  const verdict = decide({ issue, claim, changed, memo: readMemo({ issue, cacheDir }), now });
  if (verdict.emit) writeMemo({ issue, cacheDir }, verdict.memo);
  else if (verdict.memo === null && readMemo({ issue, cacheDir })) writeMemo({ issue, cacheDir }, { outside: [], at: now.toISOString() });
  return verdict.emit ? verdict.message : null;
}

/** The wire format PostToolUse understands: context for the session, never a block. */
export function emit(message, { write = (s) => process.stdout.write(s) } = {}) {
  if (!message) return 0;
  write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: message } })}\n`);
  return 0;
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && resolve(process.argv[1]).toLowerCase().endsWith("scope-drift-check.mjs");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0); // unreadable stdin is this hook's problem, not the session's
  }
  try {
    // The thread is consulted lazily, only past the cache's TTL, so a hook that runs after every
    // tool call costs one `gh` round trip per ten minutes at most -- and none when GitHub is down.
    const { readIssueThread } = await import("../../tools/entry/gather.mjs");
    process.exit(emit(run({ hookInput: input, thread: readIssueThread })));
  } catch {
    process.exit(0); // a warning hook that crashes must not become the outage it warns about
  }
}
