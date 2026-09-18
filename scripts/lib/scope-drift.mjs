// Write-scope drift, measured on the filesystem (#356).
//
// The shell-ownership hook reads a command BEFORE it runs and guesses what it will touch. That is
// the right place for a warning and the wrong place for a verdict: a command can write through a
// redirect the parser did not model, a script it invoked, or a tool the hook never sees at all, and
// parsing a third shell dialect to close each gap is the treadmill this repo declined. So the
// authoritative check does not read commands. It reads the tree AFTER the fact and asks the only
// question that cannot be dodged: which paths changed, and did the lane's claim cover them?
//
// Everything that decides is a pure function over strings (`driftReport`), so every case below is
// provable without git, GitHub or a disk. The two readers -- the claim (`readClaimCache`, refreshed
// from the issue thread by the callers) and the changed paths (`changedPaths`, from git) -- are the
// only things that touch the world, and each says when it could not.
//
// The claim cache lives beside the entry toolchain's other machine-local state and exists so a hook
// that runs after every tool call never has to ask GitHub on the hot path. It is a copy of the
// thread, never a substitute for it: a stale copy is labelled stale, a missing one is "not measured".

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { normalizePattern, outsideScope, parseScopePatterns } from "./claim-scope.mjs";

/** How long a cached claim is trusted without re-reading the thread. */
export const CACHE_TTL_MS = 10 * 60_000;
export const CACHE_DIR_NAME = "claims";

/** `%LOCALAPPDATA%\CompyEntry\claims`, or under COMPY_ENTRY_DIR when a caller relocates the store. */
export function claimCacheDir({ env = process.env } = {}) {
  const base =
    env.COMPY_ENTRY_DIR || join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "CompyEntry");
  return join(base, CACHE_DIR_NAME);
}

function cacheFile({ issue, dir }) {
  return join(dir, `${Number(issue)}.json`);
}

/**
 * The cached claim for an issue, or null. A file that cannot be parsed is null too: an unreadable
 * cache is "not measured", never "no scope" -- an empty scope would flag every change, and a hook
 * that cries on every write is switched off within the hour.
 */
export function readClaimCache({ issue, dir = claimCacheDir() }) {
  const file = cacheFile({ issue, dir });
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.scope)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Remember a claim. `scopeText` is the raw field from the thread; the parsed patterns are stored
 * beside it so a reader never re-parses, and the text is kept so a human can see what was read.
 */
export function writeClaimCache(
  { issue, scopeText, folder = null, branch = null, postedAt = null, source = "thread" },
  { dir = claimCacheDir(), now = new Date() } = {},
) {
  const record = {
    issue: Number(issue),
    scopeText: String(scopeText ?? ""),
    scope: parseScopePatterns(scopeText),
    folder,
    branch,
    postedAt,
    source,
    cachedAt: now.toISOString(),
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(cacheFile({ issue, dir }), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * Forget a claim the thread no longer holds (#459). True when no copy is left. It never throws: the
 * caller's verdict comes from the thread, and a copy that would not go must not change it.
 */
export function dropClaimCache({ issue, dir = claimCacheDir() }) {
  try {
    rmSync(cacheFile({ issue, dir }), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function isFresh(record, { now = new Date(), ttlMs = CACHE_TTL_MS } = {}) {
  const at = Date.parse(record?.cachedAt ?? "");
  return Number.isFinite(at) && now.getTime() - at >= 0 && now.getTime() - at <= ttlMs;
}

/** readIssueThread's answer for a thread it could not read. */
const UNREADABLE_READ = Object.freeze({ claim: null, handoff: null, unreadable: true });

const holdsScopedClaim = (read) => typeof read?.claim?.scope === "string";

function threadMemoFile({ issue, dir }) {
  return join(dir, `thread-${Number(issue)}.json`);
}

/** A memo this module wrote, or null. It never holds a scoped claim, so one that does is not ours. */
function readThreadMemo({ issue, dir }) {
  try {
    const memo = JSON.parse(readFileSync(threadMemoFile({ issue, dir }), "utf8"));
    const read = memo?.read;
    if (!read || typeof read !== "object" || Array.isArray(read) || holdsScopedClaim(read)) return null;
    return memo;
  } catch {
    return null;
  }
}

function writeThreadMemo({ issue, dir, now, read }) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(threadMemoFile({ issue, dir }), `${JSON.stringify({ issue: Number(issue), askedAt: now.toISOString(), read })}\n`);
  } catch {
    // a memo that will not write costs one more round trip, never a different answer
  }
}

function dropThreadMemo({ issue, dir }) {
  try {
    rmSync(threadMemoFile({ issue, dir }), { force: true });
  } catch {
    // an undeletable memo expires with its TTL like any other
  }
}

/**
 * `read`, asked at most once per issue per `ttlMs`, whatever the thread answers (#468).
 *
 * The claim cache keeps one kind of answer: a live claim with a scope. A released claim, an issue
 * never claimed, a claim with no scope and a GitHub that does not answer all left nothing behind,
 * so a reader that asks whenever the cache is missing asked again on the next call. For the
 * PostToolUse hook that meant every tool call: about 0.4 s and one GraphQL request each, or the
 * hook's full 10 s timeout while GitHub hangs (measured on #468).
 *
 * Those answers are kept here for the claim cache's own TTL, so the copy is never older than a cached
 * claim can be. A scoped claim is never kept: the caller caches it, and two copies can disagree
 * (#459). The memo is marked unreadable BEFORE the thread is asked, so a reader killed mid-ask
 * leaves "unreadable" behind, and the next call does not wait again. A throw propagates and leaves
 * that mark.
 *
 * Only the hook's hot path wants this. The gate reads the thread raw, once per push, because it is
 * the verdict.
 */
export function boundedThread(read, { dir = claimCacheDir(), now = new Date(), ttlMs = CACHE_TTL_MS } = {}) {
  return (issue) => {
    const memo = readThreadMemo({ issue, dir });
    if (memo && isFresh({ cachedAt: memo.askedAt }, { now, ttlMs })) return memo.read;
    writeThreadMemo({ issue, dir, now, read: UNREADABLE_READ });
    const answer = read(issue);
    const shaped = answer && typeof answer === "object" && !Array.isArray(answer);
    if (holdsScopedClaim(answer)) dropThreadMemo({ issue, dir });
    else writeThreadMemo({ issue, dir, now, read: shaped ? answer : UNREADABLE_READ });
    return answer;
  };
}

/** Case- and separator-insensitive: the same folder spelled by two tools is the same folder. */
export function samePath(a, b) {
  const norm = (p) =>
    String(p ?? "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .toLowerCase();
  return Boolean(a) && Boolean(b) && norm(resolve(a)) === norm(resolve(b));
}

const defaultGit = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });

/** `git status --porcelain -z` entries as repo-relative paths; a rename contributes both names. */
export function parseStatusZ(raw) {
  const parts = String(raw ?? "").split("\0");
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (path) paths.push(path);
    if (/[RC]/.test(code)) {
      const origin = parts[++i];
      if (origin) paths.push(origin);
    }
  }
  return paths;
}

/**
 * Every path this checkout has changed relative to its base: the working tree and the index
 * (`git status`, untracked files included, because a new file is a write) plus everything
 * committed since the base (`git diff base...HEAD`). Reported with the base that was actually
 * used, because "no committed drift" against a base that does not exist is not a measurement.
 */
export function changedPaths({ cwd = process.cwd(), base = "origin/main", git = defaultGit } = {}) {
  const found = new Set();
  const notes = [];
  for (const p of parseStatusZ(git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]))) {
    found.add(normalizePattern(p));
  }
  let usedBase = null;
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
    usedBase = base;
  } catch {
    notes.push(`base ${base} is not a commit here; committed drift not measured`);
  }
  if (usedBase) {
    const raw = git(cwd, ["diff", "--name-only", "-z", `${usedBase}...HEAD`]);
    for (const p of raw.split("\0")) if (p) found.add(normalizePattern(p));
  }
  return { paths: [...found].filter(Boolean).sort(), base: usedBase, notes };
}

/**
 * The decision. `changed` and `scope` are strings; the answer is the changed paths the scope does
 * not cover, plus the ones it does, so a report can show its work. No scope at all is not "all
 * outside": it is "cannot measure", and the caller must say so rather than fail the tree.
 */
export function driftReport({ changed = [], scope = [] } = {}) {
  const patterns = scope.map(normalizePattern).filter(Boolean);
  const paths = changed.map(normalizePattern).filter(Boolean);
  if (patterns.length === 0) return { measured: false, outside: [], covered: [], scope: patterns };
  const outside = outsideScope(paths, patterns);
  const covered = paths.filter((p) => !outside.includes(p));
  return { measured: true, outside, covered, scope: patterns };
}

/** The sentence a lane is given. One line per path so a diff of the message is a diff of the drift. */
export function renderDrift({ issue, outside, scope, stale = false }) {
  const lines = [
    `write-scope drift (#356): ${outside.length} changed path${outside.length === 1 ? "" : "s"} outside the ` +
      `claim on #${issue}${stale ? " (claim read from a stale cache; re-read the thread to be sure)" : ""}:`,
    ...outside.map((p) => `  - ${p}`),
    `claimed: ${scope.map((s) => `\`${s}\``).join(", ") || "(nothing parsed)"}`,
    "cure: widen the claim on the issue (re-post it with the paths added to `Write scope`) and refresh with " +
      "`node scripts/scope-drift-gate.mjs --refresh`, or move the change to the lane that owns those paths.",
  ];
  return lines.join("\n");
}
