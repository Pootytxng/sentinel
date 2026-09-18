// WHERE IS THIS PATH, AND WHOSE IS IT — the one question both write guards ask (#278).
//
// NOT WIRED, and never will be: this is a LIBRARY, not a hook. It has no stdin contract, no exit
// code and no entrypoint, and `.claude/settings.json` names it nowhere. It sits in this folder
// because both guards that import it must travel with the branch exactly as they do —
// `tools/entry/tracked-hooks.test.mjs` pins that an unregistered file here is imported by a
// registered one, so it cannot quietly become dead weight.
//
// Spec: docs/superpowers/specs/2026-08-31-target-ownership-across-tools.md §3.
//
// The defect this exists to close is that ownership was decided per TOOL. `Write` was guarded and
// `Bash` was not, so `sed -i` reached what `Edit` could not; and "outside the session root" was read
// as "outside protection", so a lane could write into a SIBLING worktree of the same repository —
// the exact collision the one-writer rule exists to prevent. Both hooks now ask this module instead
// of each carrying its own notion of where a path lives, because two notions is how they drift.
//
// FIVE ZONES, AND `unknown` IS NOT `unprotected`. A path shape the resolver cannot answer for is an
// absence of evidence, not a finding of safety. It is reported as `unknown` and the callers route it
// to explicit approval. Treating "I could not tell" as "allow" is the fail-open shape this whole
// train keeps finding.
//
// IT NEVER RUNS GIT UNLESS IT HAS TO. The zone of a path in the session's own checkout, or inside
// the owner's global config, or under no checkout at all, is decided from the filesystem alone.
// `git` is spawned only when the target sits inside SOME OTHER checkout — beside the session root,
// or registered beneath it (#425) — and the question "is that a checkout of this repository" is
// genuinely open. That matters because a PreToolUse hook on the shell runs
// before every command, and a guard that costs two subprocesses per `ls` would be removed within a
// day — which is the same outcome as not having one.
//
// Pure except for the injected seams: `exists`, `real`, `git`. Every branch is reachable from a test
// without a repository, and the real-repository behaviour is proved separately against temp fixtures.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const ZONES = Object.freeze({
  OWN: "own-claim",
  SIBLING: "sibling-checkout",
  GLOBAL: "protected-global",
  UNPROTECTED: "unprotected",
  UNKNOWN: "unknown",
});

/** Zones a write must be authorized for. `unknown` is here on purpose — see the header. */
export const PROTECTED_ZONES = new Set([ZONES.OWN, ZONES.SIBLING, ZONES.GLOBAL, ZONES.UNKNOWN]);

/**
 * One comparable spelling: forward slashes, no trailing separator, lower case.
 *
 * Deliberately NOT the hooks' `canonicalizePath`, which rewrites `/` to `\` unconditionally and so
 * turns `/tmp/x` into `\tmp\x`. That is survivable when both sides are mangled identically, and it
 * is not survivable here, because this module compares a path against an ancestor it walked up with
 * `node:path` on whichever OS the suite is running. Comparison is case-insensitive on both, which
 * over-matches on Linux in the direction of MORE protection, never less.
 */
export function toComparable(p) {
  const s = String(p ?? "").trim().replace(/\\/g, "/");
  const trimmed = s.length > 1 ? s.replace(/\/+$/, "") : s;
  return trimmed.toLowerCase();
}

/** Is `child` the same path as `parent`, or beneath it? A component boundary is required. */
export function isWithin(child, parent) {
  const c = toComparable(child);
  const p = toComparable(parent);
  if (!c || !p) return false;
  return c === p || c.startsWith(`${p}/`);
}

/**
 * A Git-Bash / MSYS / Cygwin drive path spelled the way a POSIX shell on Windows spells it.
 *
 * `/c/Users/Kuya/code/sentinel/README.md` IS `C:\Users\Kuya\code\sentinel\README.md` on this
 * machine, and it is the spelling the Bash tool uses by default. Handing it to `path.resolve` on
 * Windows produces `C:\c\Users\…` — a path under no checkout, which this module then answered
 * `unprotected`, which the shell checker then ALLOWED. Measured 2026-08-31 against the shipped hook:
 * a write into a sibling checkout and a write into `~/.claude` were both allowed silently in the
 * one spelling most likely to be used. It is the exact hole this whole module exists to close, and
 * the unit tests could not see it because they inject a fake resolver.
 *
 * Only the drive forms translate. `/dev/null`, `/tmp/x` and `/etc/x` have no drive to name and are
 * left alone; they resolve to the current drive and land in `unprotected`, which is what they are.
 */
export function fromPosixDrive(t, windows) {
  if (!windows) return null;
  const m = /^\/(?:cygdrive\/)?([A-Za-z])(\/.*)?$/.exec(t);
  return m ? `${m[1].toUpperCase()}:${(m[2] ?? "/").replace(/\//g, "\\")}` : null;
}

/**
 * Absolute form of a target, with `..` collapsed BEFORE anything compares it. A relative target
 * resolves against the session cwd, which is the only place a shell or a tool call would have meant.
 * @returns {string|null} null when there is nothing to resolve against.
 */
export function resolveAbsolute(target, cwd, { windows = process.platform === "win32" } = {}) {
  const t = String(target ?? "").trim();
  if (!t) return null;
  const drive = fromPosixDrive(t, windows);
  if (drive) return resolve(drive);
  if (isAbsolute(t)) return resolve(t);
  // A bare Windows drive-relative form (`C:foo`) names a per-drive cwd this process does not have.
  // It is unresolvable, not relative-to-here; saying so is the difference between an honest
  // `unknown` and a confident wrong answer.
  if (/^[A-Za-z]:(?![\\/])/.test(t)) return null;
  if (!cwd) return null;
  // A `cd /c/Users/…` earlier in the chain leaves the cwd in the same POSIX spelling, so it needs
  // the same translation — otherwise a relative target resolves against `C:\c\Users\…` and lands
  // in `unprotected` for exactly the reason above.
  const base = String(cwd).trim();
  return resolve(fromPosixDrive(base, windows) ?? base, t);
}

/**
 * The deepest ancestor of `abs` that exists, plus the segments still missing.
 *
 * A file that does not exist yet still has a home: `…\sentinel-other\src\New.tsx` is a write into a
 * sibling checkout before anyone creates it. Canonicalizing the ancestor with the real path is what
 * makes a junction, a reparse point or a substituted drive collapse onto the folder it truly is,
 * so `J:\lane\file` and `C:\Users\Kuya\code\sentinel-other\file` cannot get different answers.
 */
export function nearestExistingAncestor(abs, { exists = existsSync, real = realpathSync } = {}) {
  let dir = abs;
  const missing = [];
  for (;;) {
    if (exists(dir)) {
      let canonical = dir;
      try {
        canonical = real(dir);
      } catch {
        /* a path that exists but cannot be realpath'd keeps its literal form */
      }
      return { base: canonical, missing: missing.reverse() };
    }
    const parent = dirname(dir);
    if (!parent || parent === dir) return { base: null, missing: [] };
    missing.push(dir.slice(parent.length).replace(/^[\\/]+/, ""));
    dir = parent;
  }
}

/** `abs`, with its deepest existing ancestor replaced by that ancestor's real path. */
export function canonicalTarget(abs, deps = {}) {
  const { base, missing } = nearestExistingAncestor(abs, deps);
  if (!base) return abs;
  return missing.length ? join(base, ...missing) : base;
}

/**
 * Walk up for a `.git`. A LINKED worktree's `.git` is a file, not a directory, so the test is
 * existence and nothing else — checking for a directory is how a tool ends up blind to exactly the
 * checkouts this guard is about.
 * @returns {string|null} the checkout root, or null if the path is under no checkout at all.
 */
export function checkoutRootOf(abs, { exists = existsSync } = {}) {
  let dir = abs;
  for (;;) {
    try {
      if (exists(join(dir, ".git"))) return dir;
    } catch {
      return null;
    }
    const parent = dirname(dir);
    if (!parent || parent === dir) return null;
    dir = parent;
  }
}

const runGit = (cwd, args) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

/**
 * Repository identity for a checkout root: the common git dir (which every worktree of one
 * repository shares) and the origin url (which every CLONE of one repository shares).
 *
 * Both, because `git worktree list` cannot see a separate clone — `tools/entry/checkouts.mjs` exists
 * for that finding — and a sibling clone of this repo is as much someone else's checkout as a
 * sibling worktree is.
 */
export function repoIdentity(root, { git = runGit } = {}) {
  if (!root) return null;
  const commonRaw = git(root, ["rev-parse", "--git-common-dir"]);
  if (commonRaw === null) return null;
  const common = isAbsolute(commonRaw) ? commonRaw : resolve(root, commonRaw);
  return { commonDir: toComparable(common), origin: (git(root, ["remote", "get-url", "origin"]) || "").toLowerCase() || null };
}

/** Two checkout roots belong to one repository when they share a common git dir or an origin. */
export function sameRepository(a, b) {
  if (!a || !b) return false;
  if (a.commonDir && b.commonDir && a.commonDir === b.commonDir) return true;
  return Boolean(a.origin && b.origin && a.origin === b.origin);
}

/**
 * How the checkout at `owner` stands to the session's at `root`: "unreadable" when git will not
 * report the owner's identity, "sessionless" when the session is in no checkout, else "same" or
 * "unrelated". Up to four git subprocesses, so it is asked only once a checkout other than the
 * session's own has been found.
 */
function identityRelation(root, owner, { git }) {
  const mine = repoIdentity(root, { git });
  const theirs = repoIdentity(owner, { git });
  if (!theirs) return "unreadable";
  if (!mine) return "sessionless";
  return sameRepository(mine, theirs) ? "same" : "unrelated";
}

/**
 * The owner's configuration, which lives outside every repository and therefore outside every
 * repository-shaped guard. `~/.claude` holds the settings and hooks that decide what agents may do
 * on this machine; `~/.codex` is the same thing for the other tool, and is already recorded as
 * sitting outside every guard.
 */
export function protectedGlobals({ home = homedir() } = {}) {
  return [join(home, ".claude"), join(home, ".codex")];
}

/**
 * Subtrees INSIDE a protected global that are the AGENT'S OWN SCRATCH, not the owner's authority.
 *
 * `protectedGlobals` names two whole directories, and that was right when the question was "does
 * this path decide what agents may do on this machine". But `~/.claude` is not only that. It is
 * also where Claude Code keeps its own per-project working notes, todo lists, plans and file
 * history — state the agent writes as a matter of course, several times a turn, about the very
 * project it is working on. Measured 2026-09-18 across three weeks of transcripts: 92 of ~400
 * permission prompts were a session being asked whether it might write its own memory file at
 * `~/.claude/projects/<slug>/memory/*.md`. A prompt that frequent and that uninformative is not a
 * guard; it is a tax on every turn, and the owner presses accept every time, which is the shape
 * that trains him to stop reading prompts that DO matter.
 *
 * So the carve-out is by NAME, never by pattern: the four scratch directories are listed here and
 * everything else under `~/.claude` — `settings.json`, `hooks/`, `CLAUDE.md`, `skills/`,
 * `plugins/`, `.credentials.json`, and anything added later — keeps its GLOBAL answer by default.
 * A new directory under `~/.claude` is protected until someone adds it to this list on purpose,
 * which is the correct direction for a list that can be wrong.
 *
 * `~/.codex` gets NOTHING here. It holds `worktrees/`, which are real checkouts of this very
 * repository (`~/.codex/worktrees/2e5d/sentinel` on this machine), and a carve-out there would
 * reopen the sibling-checkout hole this module exists to close.
 *
 * THIS LIST IS NOT CONSULTED BY `zoneOf`, AND MUST NOT BE. It names DIRECTORIES, and `isWithin` is
 * true for equality, so consulting it in the shared zone answer made the roots themselves exempt —
 * `rm -rf ~/.claude/projects` through the shell guard, which is every lane's memory and every
 * lane's transcripts, none of it in git. `project-write-assert.mjs` is the single consumer, it
 * requires a STRICT descendant, and it only ever answers for Write/Edit/NotebookEdit: one named
 * file at a time. Any future consumer must satisfy both of those conditions or it is a hole.
 */
export function globalScratchSubtrees({ home = homedir() } = {}) {
  const claude = join(home, ".claude");
  return [join(claude, "projects"), join(claude, "todos"), join(claude, "plans"), join(claude, "file-history")];
}

// A destructive directory operand can own its spelling while containing somebody else's lane.
// Read Git's registration files rather than spawning git or walking the target's whole subtree.
// Missing registration means none; unreadable registration means unknown, never permission.
function containedWorktree(abs, root, { exists, real, stat = statSync, read = readFileSync, list = readdirSync }) {
  try {
    try { if (!stat(abs).isDirectory()) return null; }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const checkout = checkoutRootOf(root, { exists });
    if (!checkout) return null;
    let admin = join(checkout, ".git");
    if (!stat(admin).isDirectory()) {
      const pointer = /^gitdir:\s*(.+)\s*$/i.exec(read(admin, "utf8").trim());
      if (!pointer) throw new Error("invalid gitdir pointer");
      admin = resolve(checkout, pointer[1]);
    }
    const commonFile = join(admin, "commondir");
    const common = exists(commonFile) ? resolve(admin, read(commonFile, "utf8").trim()) : admin;
    const registry = join(common, "worktrees");
    let entries;
    try { entries = list(registry); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    for (const entry of entries) {
      const registration = join(registry, entry);
      const pointer = read(join(registration, "gitdir"), "utf8").trim();
      if (!pointer) throw new Error("empty worktree pointer");
      const owner = canonicalTarget(dirname(resolve(registration, pointer)), { exists, real });
      if (toComparable(owner) !== toComparable(root) && isWithin(owner, abs)) {
        return { zone: ZONES.SIBLING, abs, owner, why: "contains another registered worktree" };
      }
    }
    return null;
  } catch {
    return { zone: ZONES.UNKNOWN, abs, owner: null, why: "contained worktree registrations could not be read" };
  }
}

/**
 * @param {object} q
 * @param {string} q.target        as written by the tool or the command
 * @param {string} q.sessionRoot   the resolved session root
 * @param {string|null} q.cwd      for a relative target
 * @returns {{zone: string, abs: string|null, owner: string|null, why: string}}
 */
export function zoneOf({ target, sessionRoot, cwd = null, descendants = false, wildcard = false, deps = {} } = {}) {
  const { exists = existsSync, real = realpathSync, git = runGit, home = homedir(), windows = process.platform === "win32" } = deps;

  const raw = resolveAbsolute(target, cwd, { windows });
  if (!raw) return { zone: ZONES.UNKNOWN, abs: null, owner: null, why: "the target could not be resolved to an absolute path" };

  let abs;
  try {
    abs = canonicalTarget(raw, { exists, real });
  } catch {
    return { zone: ZONES.UNKNOWN, abs: raw, owner: null, why: "the target's real path could not be read" };
  }

  // The session root gets the same real-path treatment, or a junctioned root and a literal target
  // compare unequal and every write reads as somebody else's.
  let root = null;
  if (sessionRoot) {
    try {
      root = canonicalTarget(resolve(sessionRoot), { exists, real });
    } catch {
      root = resolve(sessionRoot);
    }
  }

  if (descendants && wildcard) {
    // The caller supplies the static directory prefix, not a literal filename containing '*'.
    // A prefix already inside a sibling is a definite refusal. A prefix containing lanes only
    // proves a possible match: do not guess shell matching rules or allow the destructive command.
    const prefix = zoneOf({ target, sessionRoot, cwd, deps });
    if (prefix.zone !== ZONES.OWN) return prefix;
    const contained = containedWorktree(abs, root, { ...deps, exists, real });
    return contained ? { ...contained, zone: ZONES.UNKNOWN,
      why: "wildcard prefix contains registered worktrees or unreadable registration; matching is unresolved" } : prefix;
  }

  if (root && isWithin(abs, root)) {
    if (descendants) {
      const contained = containedWorktree(abs, root, { ...deps, exists, real });
      if (contained) return contained;
    }
    // Inside the root is not the same as inside this checkout (#425). A lane registered beneath the
    // root (`.claude/worktrees/<lane>`) is a checkout of its own, so the target answers to the
    // nearest checkout that holds it. Git runs only when that checkout sits strictly inside the
    // root; every other target here costs a walk of existence checks and no subprocess.
    const inner = checkoutRootOf(abs, { exists });
    if (!inner || !isWithin(inner, root) || isWithin(root, inner)) {
      return { zone: ZONES.OWN, abs, owner: root, why: "inside the session root" };
    }
    const relation = identityRelation(root, inner, { git });
    if (relation === "unreadable") {
      return { zone: ZONES.UNKNOWN, abs, owner: inner, why: "a checkout inside the session root whose identity git would not report" };
    }
    if (relation === "unrelated") {
      // Not a lane of this repository: it stays under the root's protection and its verification,
      // rather than dropping to `unprotected` the way an unrelated checkout outside the root does.
      return { zone: ZONES.OWN, abs, owner: root, why: "inside the session root, in a checkout of an unrelated repository" };
    }
    return {
      zone: ZONES.SIBLING,
      abs,
      owner: inner,
      why: relation === "same" ? "another checkout of this repository, nested inside the session root" : "a checkout inside the session root, from a session that is in none",
    };
  }

  // NOTHING IS CARVED OUT HERE, ON PURPOSE (2026-09-18 review). `globalScratchSubtrees` exists,
  // but this module is the SHARED answer consumed by the shell guard as well as the write guard,
  // and the shell guard decides `rm -rf <dir>`. A first draft of that carve-out lived here and an
  // independent review broke it in one line: `isWithin` is true for equality, so the scratch roots
  // were exempt themselves and `rm -rf ~/.claude/projects` came back `unprotected` — one unprompted
  // command destroying the transcripts, memory and plans of EVERY lane on the machine, none of it
  // under git and so none of it recoverable. The carve-out now lives in `project-write-assert.mjs`
  // alone, where the tool is Write/Edit/NotebookEdit: one named file, no recursion, no directory.
  // Keep it that way. A path-ownership answer must not depend on how gently the caller intends to
  // use it, and this is the module that cannot know.
  for (const g of protectedGlobals({ home })) {
    if (isWithin(abs, g)) return { zone: ZONES.GLOBAL, abs, owner: g, why: "inside the owner's global configuration" };
  }

  let owner = null;
  try {
    owner = checkoutRootOf(abs, { exists });
  } catch {
    return { zone: ZONES.UNKNOWN, abs, owner: null, why: "the target's checkout could not be determined" };
  }
  if (!owner) return { zone: ZONES.UNPROTECTED, abs, owner: null, why: "under no checkout, and outside the session root" };

  // Only now is git worth a subprocess: the target is inside SOME checkout that is not this one.
  const relation = identityRelation(root, owner, { git });
  if (relation === "unreadable") return { zone: ZONES.UNKNOWN, abs, owner, why: "a checkout whose identity git would not report" };
  if (relation === "sessionless") {
    // This session is not in a checkout at all, so "sibling" has no meaning — but the target IS in
    // somebody's repository, and this session has no claim on it.
    return { zone: ZONES.SIBLING, abs, owner, why: "a checkout, from a session that is in none" };
  }
  return relation === "same"
    ? { zone: ZONES.SIBLING, abs, owner, why: "another checkout of this repository" }
    : { zone: ZONES.UNPROTECTED, abs, owner, why: "a checkout of an unrelated repository" };
}
