// Keep the folder that runs the launcher on the launcher that was verified.
//
// The defect this closes is guard 11, and it was live on this machine while the program that fixes
// it was being written: `compy-control` sat on `tooling/compy-entry` at a commit two merges behind
// `main`, pinned to a branch that would never receive the finished work. Every proof in the repo was
// about code the Desktop shortcut did not run. Reaching `main` is not the same as reaching the owner
// — that was the whole point of the owner's line, "do not declare success merely because code
// reached main."
//
// So the control folder catches itself up, and the rules it does that under are narrow on purpose:
//
//   fast-forward only     never a merge, a rebase or a reset. If history diverged, something is in
//                         that folder that upstream does not have, and moving the branch would
//                         destroy it. Diverged means STOP, not "sort it out."
//   never over local work a dirty clone is somebody mid-edit. Their work outranks our currency.
//   the pinned branch     an update that changes which branch the launcher runs is not an update.
//   fail open on LAUNCH   a refusal here refuses the UPDATE, never the launch. Being one commit
//                         behind is a reason to say so in one line, not a reason to hand the owner
//                         a dead shortcut — that would be a chore he cannot fix from the terminal
//                         it appeared in.
//
// The planner takes facts and returns a decision, so every one of those rules is a guard rather than
// a paragraph. Only `updateControl` touches a repository.

import { execFileSync } from "node:child_process";

export const FULL_SHA = /^[0-9a-f]{40}$/;

const runGit = (dir) => (args) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * What should happen to a control folder in this state?
 *
 * @param {object} state
 * @param {string} state.branch    the branch it is on
 * @param {string} state.expected  the branch it is pinned to
 * @param {string} state.head      its current commit
 * @param {string} state.upstream  the commit its tracking ref now points at (null if there is none)
 * @param {boolean} state.dirty    does it have uncommitted work
 * @param {boolean} state.ancestor is `head` an ancestor of `upstream` — i.e. can this fast-forward
 */
export function planControlUpdate({ branch, expected, head, upstream, dirty, ancestor }) {
  const at = (sha) => (FULL_SHA.test(sha ?? "") ? sha.slice(0, 7) : String(sha ?? "unknown"));

  if (branch !== expected) {
    return {
      action: "refuse",
      reason: `the control folder is on ${branch}, not ${expected}. Updating would move it further from the branch the shortcut is pinned to, not closer.`,
    };
  }
  if (!FULL_SHA.test(head ?? "")) {
    return { action: "refuse", reason: `the control folder's HEAD is not a commit id (${head ?? "detached or empty"}), so there is nothing to move forward from.` };
  }
  if (!FULL_SHA.test(upstream ?? "")) {
    return { action: "refuse", reason: `${expected} has no upstream commit to catch up to (fetch failed, or the branch does not track a remote).` };
  }
  if (head === upstream) return { action: "none", head, reason: `already running the current launcher (${at(head)})` };

  // Dirty is checked AFTER "already current" on purpose: a clean-tree complaint about a folder that
  // has nothing to catch up to is noise about a non-event.
  if (dirty) {
    return {
      action: "refuse",
      reason: `the control folder has uncommitted changes, so it stays on ${at(head)} rather than moving to ${at(upstream)}. Local work outranks being current.`,
    };
  }
  if (!ancestor) {
    return {
      action: "refuse",
      reason: `${expected} has diverged from its upstream (${at(head)} is not an ancestor of ${at(upstream)}). There are commits in the control folder that upstream does not have, and fast-forward is the only move allowed here.`,
    };
  }
  return { action: "fast-forward", from: head, to: upstream, reason: `updating the launcher ${at(head)} -> ${at(upstream)}` };
}

/** Read the state the planner needs. Fetches; touches nothing else. */
export function readControlState({ dir, expected, git = runGit(dir), fetch = true }) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain"]).length > 0;

  let upstream = null;
  if (branch === expected) {
    // A fetch that fails is not a launch that fails. `--no-tags` and an explicit refspec keep this to
    // the one ref the decision is about.
    if (fetch) {
      try {
        git(["fetch", "--no-tags", "--quiet", "origin", expected]);
      } catch {
        /* offline: the plan then refuses on a missing upstream, and the launch carries on */
      }
    }
    try {
      upstream = git(["rev-parse", "FETCH_HEAD"]);
    } catch {
      try {
        upstream = git(["rev-parse", `origin/${expected}`]);
      } catch {
        upstream = null;
      }
    }
  }

  let ancestor = false;
  if (FULL_SHA.test(head) && FULL_SHA.test(upstream ?? "")) {
    try {
      git(["merge-base", "--is-ancestor", head, upstream]);
      ancestor = true;
    } catch {
      ancestor = false;
    }
  }

  return { branch, head, dirty, upstream, ancestor };
}

/**
 * Catch the control folder up, or say why it did not.
 *
 * Returns `{ updated, head, reason }`. `head` is always the commit the caller is now running, so a
 * launcher can name its own version whether or not anything moved — which is the first half of
 * "the control folder knows the exact launcher commit it runs".
 */
export function updateControl({ dir, expected = "main", git = runGit(dir), dryRun = false, fetch = true }) {
  const state = readControlState({ dir, expected, git, fetch });
  const plan = planControlUpdate({ ...state, expected });

  if (plan.action !== "fast-forward") {
    return { updated: false, head: state.head, action: plan.action, reason: plan.reason };
  }
  if (dryRun) return { updated: false, head: state.head, action: "fast-forward", dryRun: true, reason: plan.reason };

  // `--ff-only` against the exact commit id, never a ref name: the ref could resolve differently by
  // now, and this is the same pinning discipline the worktree creation runs under.
  git(["merge", "--ff-only", plan.to]);
  const head = git(["rev-parse", "HEAD"]);
  if (head !== plan.to) {
    return { updated: false, head, action: "refuse", reason: `the fast-forward did not land on ${plan.to.slice(0, 7)} (HEAD is ${head.slice(0, 7)}).` };
  }
  return { updated: true, head, from: plan.from, action: "fast-forward", reason: plan.reason };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const argv = process.argv.slice(2);
  const argOf = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  // Even total failure leaves the launcher a sentence and a shape, never a stack trace: the caller
  // is a shortcut the owner double-clicked, and it has to be able to carry on and say why.
  let r;
  try {
    r = updateControl({
      dir: argOf("--dir") ?? process.cwd(),
      expected: argOf("--branch") ?? "main",
      dryRun: argv.includes("--dry-run"),
      fetch: !argv.includes("--no-fetch"),
    });
  } catch (e) {
    r = { updated: false, head: null, action: "refuse", reason: `the control folder could not be read: ${String(e.message ?? e)}` };
  }
  console.log(JSON.stringify({ ...r, short: FULL_SHA.test(r.head ?? "") ? r.head.slice(0, 7) : "unknown" }));
  // 0 = nothing to do, 10 = updated (the launcher restarts into the new code), 1 = did not update.
  process.exit(r.updated ? 10 : r.action === "none" ? 0 : 1);
}
