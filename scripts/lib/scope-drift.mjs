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
import { isAbsolute, join, resolve } from "node:path";

import { normalizePattern, outsideScope, parseScopePatterns } from "./claim-scope.mjs";

/** How long a cached claim is trusted without re-reading the thread. */
export const CACHE_TTL_MS = 10 * 60_000;
export const CACHE_DIR_NAME = "claims";

/**
 * Where the entry toolchain keeps state between runs.
 *
 * This is the SAME resolver as `entryStateDir` in `.claude/hooks/session-root-assert.mjs`, in the
 * same order and for the same reasons (#440): `COMPY_ENTRY_DIR`, then `LOCALAPPDATA` (Windows),
 * then `XDG_STATE_HOME`, then the XDG default under the home directory. A blank or RELATIVE value
 * is absence at every step, because a relative store is a store that means "whichever checkout the
 * process happened to be standing in".
 *
 * Duplicated rather than imported so this library owes nothing to the hook tree, which is how the
 * rest of the entry path is held together. `tools/entry/posix-entry-state-dir.test.mjs` compares the
 * two implementations across an environment matrix, so they cannot drift apart quietly. Change one,
 * change both, or the guard fails.
 *
 * Why the agreement matters HERE rather than being merely tidy: the claim cache is one half of a
 * store whose other half the hook writes. A resolver that answers an AppData-shaped path on Linux
 * while the hook answers the XDG one corrupts nothing — writer and reader simply look at two
 * different folders, so every claim reads back as `null`, which this file spells "not measured".
 * The drift gate then stops measuring without ever reporting a failure, which is the one outcome a
 * guard must never have.
 */
export function entryStateDir({ env = process.env, home = homedir() } = {}) {
  // Asked on Linux about a Windows path, `isAbsolute` says false — so the verdict would depend on
  // the host and a guard could not check the Windows answer from CI. Both spellings are named here
  // so the resolver decides the same way everywhere. A lone leading backslash is deliberately NOT
  // absolute: on POSIX a backslash is an ordinary filename character, so a backslash-led value
  // would resolve against the cwd and put the store straight back in the checkout.
  const rooted = (s) => isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s) || /^\\\\[^\\]/.test(s);
  const named = (value) => {
    const s = typeof value === "string" ? value.trim() : "";
    return s !== "" && rooted(s) ? s : null;
  };

  const explicit = named(env.COMPY_ENTRY_DIR);
  if (explicit) return explicit;
  return join(named(env.LOCALAPPDATA) ?? named(env.XDG_STATE_HOME) ?? join(home, ".local", "state"), "CompyEntry");
}

/** The `claims` folder inside that state directory. */
export function claimCacheDir({ env = process.env } = {}) {
  return join(entryStateDir({ env }), CACHE_DIR_NAME);
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
 * outside": it is "cannot measure", and the caller must say so rather than fail the tree. The one
 * exception is `none` (#554), a claim that declares `Write scope: none`: that IS a scope, one that
 * holds no path, so it is measured and every changed path is outside it.
 */
export function driftReport({ changed = [], scope = [], none = false } = {}) {
  const patterns = scope.map(normalizePattern).filter(Boolean);
  const paths = changed.map(normalizePattern).filter(Boolean);
  if (patterns.length === 0 && !none) return { measured: false, outside: [], covered: [], scope: patterns, none: false };
  const outside = outsideScope(paths, patterns);
  const covered = paths.filter((p) => !outside.includes(p));
  return { measured: true, outside, covered, scope: patterns, none: Boolean(none) };
}

/** The sentence a lane is given. One line per path so a diff of the message is a diff of the drift. */
export function renderDrift({ issue, outside, scope, stale = false, none = false }) {
  const lines = [
    `write-scope drift (#356): ${outside.length} changed path${outside.length === 1 ? "" : "s"} outside the ` +
      `claim on #${issue}${stale ? " (claim read from a stale cache; re-read the thread to be sure)" : ""}:`,
    ...outside.map((p) => `  - ${p}`),
    `claimed: ${none ? "none (`Write scope: none` holds no path)" : scope.map((s) => `\`${s}\``).join(", ") || "(nothing parsed)"}`,
    "cure: widen the claim on the issue (re-post it with the paths added to `Write scope`) and refresh with " +
      "`node scripts/scope-drift-gate.mjs --refresh`, or move the change to the lane that owns those paths.",
  ];
  return lines.join("\n");
}
