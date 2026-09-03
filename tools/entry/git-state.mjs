// Read a checkout's working state — and report it, never repair it (spec §5.5).
//
// Five state classes are counted SEPARATELY on purpose. Collapsing them into one "dirty" flag is
// how work gets lost: a stash does not appear in `git status` at all, so a folder can be
// working-tree-clean and still be holding someone's uncommitted work. `clean` here means "safe to
// reuse", which is a stricter thing than "git status printed nothing".
//
// Read-only: `status`, `stash list`, `rev-parse`. Nothing writes, fetches, resets or stashes.

import { execFileSync } from "node:child_process";

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * @returns {{
 *   ok: boolean, path: string, branch: string|null, detached: boolean, head: string|null,
 *   upstream: string|null, modified: number, untracked: number, staged: number, stashed: number,
 *   ahead: number, behind: number, unmerged: number,
 *   files: {modified: string[], untracked: string[], staged: string[], unmerged: string[]},
 *   workingTreeClean: boolean, clean: boolean
 * }}
 */
export function inspectGitState(dir) {
  const base = {
    ok: false,
    path: dir,
    branch: null,
    detached: false,
    head: null,
    upstream: null,
    modified: 0,
    untracked: 0,
    staged: 0,
    stashed: 0,
    stashedElsewhere: 0,
    ahead: 0,
    behind: 0,
    unmerged: 0,
    files: { modified: [], untracked: [], staged: [], unmerged: [] },
    workingTreeClean: true,
    clean: false,
  };

  const out = git(dir, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"]);
  if (out === null) return base;

  const s = { ...base, ok: true, files: { modified: [], untracked: [], staged: [], unmerged: [] } };

  for (const line of out.split(/\r?\n/)) {
    if (line === "") continue;
    if (line.startsWith("# branch.oid ")) {
      s.head = line.slice("# branch.oid ".length).trim();
    } else if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      if (head === "(detached)") s.detached = true;
      else s.branch = head;
    } else if (line.startsWith("# branch.upstream ")) {
      s.upstream = line.slice("# branch.upstream ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        s.ahead = Number(m[1]);
        s.behind = Number(m[2]);
      }
    } else if (line.startsWith("? ")) {
      s.files.untracked.push(line.slice(2).trim());
    } else if (line.startsWith("u ")) {
      s.files.unmerged.push(line.split(/\s+/).slice(10).join(" "));
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // `<1|2> <XY> ...` — X is the index (staged) state, Y the working-tree state.
      const xy = line.slice(2, 4);
      const path = line.startsWith("2 ")
        ? line.split(/\t/)[0].split(/\s+/).slice(9).join(" ")
        : line.split(/\s+/).slice(8).join(" ");
      if (xy[0] !== ".") s.files.staged.push(path);
      if (xy[1] !== ".") s.files.modified.push(path);
    }
  }

  s.modified = s.files.modified.length;
  s.untracked = s.files.untracked.length;
  s.staged = s.files.staged.length;
  s.unmerged = s.files.unmerged.length;

  // The stash stack is one per repository, shared by every worktree, so an entry made on another
  // branch is another checkout's parked work, not this folder's: it is counted apart and does not
  // make this folder unclean (four ABANDONED entries from other lanes refused every launch here).
  // An entry whose branch cannot be read stays counted against this folder.
  const stashOut = git(dir, ["stash", "list"]);
  const entries = stashOut ? stashOut.split(/\r?\n/).filter((l) => l.trim() !== "") : [];
  const stashBranch = (l) => {
    const m = l.match(/^stash@\{\d+\}:\s*(?:WIP on|On)\s+(.+?):/);
    return m ? m[1].trim() : null;
  };
  s.stashed = entries.filter((l) => {
    const b = stashBranch(l);
    return b === null || s.detached || !s.branch || b === s.branch;
  }).length;
  s.stashedElsewhere = entries.length - s.stashed;

  s.workingTreeClean = s.modified === 0 && s.untracked === 0 && s.staged === 0 && s.unmerged === 0;
  s.clean =
    s.workingTreeClean && s.stashed === 0 && s.ahead === 0 && s.behind === 0 && !s.detached;

  return s;
}

/** True only when the checkout is on exactly this branch. Detached never matches anything. */
export function branchMatches(state, expected) {
  if (!state?.ok || state.detached || !state.branch) return false;
  return state.branch === expected;
}

/** One line naming every state found — this is what a refusal prints, so it must be actionable. */
export function describeGitState(state) {
  if (!state?.ok) return "not a git checkout";
  const parts = [];
  if (state.modified) parts.push(`${state.modified} modified`);
  if (state.staged) parts.push(`${state.staged} staged`);
  if (state.untracked) parts.push(`${state.untracked} untracked`);
  if (state.unmerged) parts.push(`${state.unmerged} unmerged`);
  if (state.stashed) parts.push(`${state.stashed} stashed`);
  if (state.ahead || state.behind) parts.push(`ahead ${state.ahead}, behind ${state.behind}`);
  if (state.detached) parts.push("detached HEAD");
  if (parts.length === 0) return `clean on ${state.branch}${state.stashedElsewhere ? ` (${state.stashedElsewhere} stashed on other branches)` : ""}`;
  return `${state.detached ? "detached" : state.branch}: ${parts.join(" · ")}`;
}
