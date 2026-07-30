// Discover every checkout of this repository on the machine — worktrees AND separate clones.
//
// Why a scan and not `git worktree list` (finding 1): that command reports five checkouts while six
// exist. `code\sentinel-work-control-codex` is a separate clone of the same remote and is invisible
// to every worktree-based tool. A launcher that enumerates only worktrees would route into, or fail
// to notice a writer in, a folder it does not know about.
//
// Strictly read-only: `rev-parse`, `remote get-url`, `worktree list`. Nothing here writes, checks
// out, fetches, or touches another lane's working tree.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { canonicalizePath } from "./worktree-field.mjs";

export const DEFAULT_ROOTS = ["C:\\Users\\Kuya\\code"];

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
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

  const commonRaw = git(dir, ["rev-parse", "--git-common-dir"]);
  if (commonRaw === null) return null;
  const gitDirRaw = git(dir, ["rev-parse", "--absolute-git-dir"]);
  const commonDir = canonicalizePath(isAbsolute(commonRaw) ? commonRaw : resolve(dir, commonRaw));

  const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
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
