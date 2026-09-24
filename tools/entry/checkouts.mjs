// Discover every checkout of this repository on the machine — worktrees AND separate clones.
//
// Why a scan and not `git worktree list` (finding 1): that command reports five checkouts while six
// exist. `code\sentinel-work-control-codex` is a separate clone of the same remote and is invisible
// to every worktree-based tool. A launcher that enumerates only worktrees would route into, or fail
// to notice a writer in, a folder it does not know about.
//
// Strictly read-only: `rev-parse`, `remote get-url`, `worktree list`. Nothing here writes, checks
// out, fetches, or touches another lane's working tree.
//
// Cost: 2 git processes per checkout plus 1 `worktree list` per host. The scan covers every checkout
// under C:\Users\Kuya\code: 62 on 2026-09-23, so each git call added per checkout costs 62 more
// processes per scan (#549). `checkouts.test.mjs` counts them per case.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { canonicalizePath } from "./worktree-field.mjs";

export const DEFAULT_ROOTS = ["C:\\Users\\Kuya\\code"];

const GIT_OPTS = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, ...GIT_OPTS }).trim();
  } catch {
    return null;
  }
}

/**
 * Like `git`, but keeps the lines printed before a failure. `rev-parse` prints one line per option,
 * in order, so an option that fails late does not undo the lines before it.
 */
function gitLines(cwd, args) {
  try {
    return { ok: true, lines: execFileSync("git", args, { cwd, ...GIT_OPTS }).trim().split(/\r?\n/) };
  } catch (e) {
    return { ok: false, lines: typeof e?.stdout === "string" ? e.stdout.trim().split(/\r?\n/) : [] };
  }
}

function dotGitKind(dir) {
  const dotGit = resolve(dir, ".git");
  if (!existsSync(dotGit)) return null;
  return statSync(dotGit).isDirectory() ? "dir" : "file";
}

/**
 * Inspect one directory as a checkout.
 * @returns {{path, dotGit, kind, commonDir, gitDir, branch, detached, remote}|null} null if not a checkout.
 */
export function inspectCheckout(dir) {
  const dotGit = dotGitKind(dir);
  if (!dotGit) return null;

  // Two git processes per checkout, not four (#549): this scan runs over every checkout on the
  // machine, and one git process costs 150-600 ms on the dev PC (#542). One rev-parse answers three
  // questions, one line each. On an unborn HEAD it still prints both dirs and a bare `HEAD`, then
  // exits 128, so a failed run keeps the dirs and drops the branch. That is what the separate
  // `rev-parse --abbrev-ref HEAD` returned there: no branch, and not detached.
  const revParse = gitLines(dir, ["rev-parse", "--git-common-dir", "--absolute-git-dir", "--abbrev-ref", "HEAD"]);
  const [commonRaw, gitDirRaw, branchRaw] = revParse.lines;
  if (!commonRaw) return null;
  const commonDir = canonicalizePath(isAbsolute(commonRaw) ? commonRaw : resolve(dir, commonRaw));

  const branch = revParse.ok ? (branchRaw ?? null) : null;
  const detached = branch === "HEAD";

  // A linked worktree's `.git` is a file pointing at the host — the same fact that keeps
  // build.rs's `rerun-if-changed=../.git/HEAD` from ever firing there (finding 10).
  // A `.git` directory that hosts registered worktrees is the host; one that does not is a
  // standalone clone, the class `git worktree list` omits.
  const hostsWorktrees = dotGit === "dir" && existsSync(resolve(commonDir, "worktrees"));
  const kind = dotGit === "file" ? "linked" : hostsWorktrees ? "host" : "clone";

  return {
    path: canonicalizePath(dir),
    dotGit,
    kind,
    commonDir,
    gitDir: gitDirRaw ? canonicalizePath(gitDirRaw) : null,
    branch: detached ? null : branch,
    detached,
    remote: git(dir, ["remote", "get-url", "origin"]),
  };
}

/** Paths `git worktree list` reports for a host. Never sees separate clones — that is the point. */
export function listWorktreesOf(hostDir) {
  const out = git(hostDir, ["worktree", "list", "--porcelain"]);
  if (!out) return [];
  return out
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => canonicalizePath(l.slice("worktree ".length)));
}

/**
 * Every checkout under the given roots, plus every worktree registered by any host found there
 * (a linked worktree can live outside the scanned roots; its host still names it).
 */
export function discoverCheckouts({ roots = DEFAULT_ROOTS } = {}) {
  const found = new Map();

  const add = (dir) => {
    const key = canonicalizePath(dir).toLowerCase();
    if (found.has(key)) return found.get(key);
    const info = inspectCheckout(dir);
    if (info) found.set(key, info);
    return info;
  };

  for (const root of roots) {
    let entries = [];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue; // a root that does not exist is not an error — the machine simply lacks it
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      add(resolve(root, e.name));
    }
  }

  for (const info of [...found.values()]) {
    if (info.kind !== "host") continue;
    for (const wt of listWorktreesOf(info.path)) add(wt);
  }

  return [...found.values()];
}

/** Checkouts that share a repository with `info`, by common dir (worktrees) or origin (clones). */
export function relatedCheckouts(info, all) {
  const origin = info.remote?.toLowerCase() ?? null;
  return all.filter(
    (c) =>
      c.path !== info.path &&
      (c.commonDir.toLowerCase() === info.commonDir.toLowerCase() ||
        (origin !== null && c.remote?.toLowerCase() === origin)),
  );
}
