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
 * Do two remote URLs name the same GitHub repository?
 *
 * The PowerShell pin compared with `-notlike "*$EXPECTED_REMOTE*"`. A substring match accepts
 * `https://github.com/attacker/Pootytxng-sentinel-fork` and any URL that merely mentions the name,
 * and the fetch/merge path here checked the remote not at all. Identity is `<owner>/<repo>`, matched
 * whole, after normalising the two spellings git actually produces.
 *
 * 2026-08-02: that first fix compared ONLY the `<owner>/<repo>` tail — because the pin constant is
 * the bare string `Pootytxng/sentinel` with no host — so `^https?:\/\/[^/]+\/(.+)$` swallowed the
 * whole authority and discarded it. Any host with the right tail passed:
 * `https://github.com.attacker.net/Pootytxng/sentinel` pinned clean, and the launcher would fetch,
 * fast-forward onto it, and run it. Checking the apartment number and ignoring the street. The host
 * is now checked too, taken from where the connection actually goes (userinfo and port stripped, so
 * `https://github.com@evil.net/...` reads as evil.net, which is what a browser would dial).
 */
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

/** The host a URL authority really connects to: anything before the last `@` is userinfo, not host. */
function hostOf(authority) {
  return authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d+$/, "");
}

export function sameRepo(url, expected) {
  const norm = (u) =>
    String(u ?? "")
      .trim()
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "")
      .replace(/^git@([^:]+):/i, "https://$1/")
      .replace(/^ssh:\/\/git@/i, "https://")
      .toLowerCase();
  const parse = (u) => {
    const n = norm(u);
    const m = n.match(/^https?:\/\/([^/]+)\/(.+)$/);
    return m ? { host: hostOf(m[1]), path: m[2] } : { host: null, path: n };
  };
  const a = parse(url);
  const b = parse(expected);
  if (a.path === "" || a.path !== b.path) return false;
  // A remote that names a host must name GitHub's. A bare `<owner>/<repo>` has no host — that is
  // the pin constant itself, and the only reason the tail is what gets compared.
  return [a, b].every((side) => side.host === null || GITHUB_HOSTS.has(side.host));
}

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
 * @param {string}  state.remote    the origin URL it actually has
 * @param {string}  state.expectedRemote the repository it is supposed to be
 *
 * Every refusal carries `fatal: true`. The control folder that cannot vouch for itself is the folder
 * whose launcher code is about to route the owner's work and copy hooks into a worktree, so "refuse
 * the update, run the stale launcher anyway" was the pin defeating itself (spec §8: refuse rather
 * than guess). The PowerShell side is a renderer; the decision lives here, where it is testable.
 */
export function planControlUpdate({ branch, expected, head, upstream, dirty, ancestor, remote = null, expectedRemote = null }) {
  const at = (sha) => (FULL_SHA.test(sha ?? "") ? sha.slice(0, 7) : String(sha ?? "unknown"));

  if (expectedRemote !== null && !sameRepo(remote, expectedRemote)) {
    return {
      action: "refuse",
      fatal: true,
      reason: `the control folder's origin is ${remote ?? "unset"}, which is not ${expectedRemote}. A folder pointing at another repository is not this launcher, whatever its branch is called.`,
    };
  }

  if (branch !== expected) {
    return {
      action: "refuse",
      fatal: true,
      reason: `the control folder is on ${branch}, not ${expected}. Updating would move it further from the branch the shortcut is pinned to, not closer.`,
    };
  }
  if (!FULL_SHA.test(head ?? "")) {
    return { action: "refuse", fatal: true, reason: `the control folder's HEAD is not a commit id (${head ?? "detached or empty"}), so there is nothing to move forward from.` };
  }
  if (!FULL_SHA.test(upstream ?? "")) {
    return { action: "refuse", fatal: true, reason: `${expected} has no upstream commit to catch up to (fetch failed, or the branch does not track a remote).` };
  }
  // Dirty is checked BEFORE "already current", and the order is the whole point. A commit id vouches
  // for the bytes in that commit; it says nothing about a working copy somebody has since edited. A
  // modified compy-entry.ps1, launcher module or hook sitting at the tip commit was previously read
  // as "already running the current launcher" and executed unexamined -- the pin reporting success
  // over exactly the code it was meant to prove.
  if (dirty) {
    return {
      action: "refuse",
      fatal: true,
      reason:
        head === upstream
          ? `the control folder is at ${at(head)} but has uncommitted changes, so the launcher it would run is not the launcher that commit describes. Commit identity does not vouch for modified bytes.`
          : `the control folder has uncommitted changes, so it stays on ${at(head)} rather than moving to ${at(upstream)}. Local work outranks being current.`,
    };
  }

  if (head === upstream) return { action: "none", head, fatal: false, reason: `already running the current launcher (${at(head)})` };
  if (!ancestor) {
    return {
      action: "refuse",
      fatal: true,
      reason: `${expected} has diverged from its upstream (${at(head)} is not an ancestor of ${at(upstream)}). There are commits in the control folder that upstream does not have, and fast-forward is the only move allowed here.`,
    };
  }
  return { action: "fast-forward", fatal: false, from: head, to: upstream, reason: `updating the launcher ${at(head)} -> ${at(upstream)}` };
}

/** Read the state the planner needs. Fetches; touches nothing else. */
export function readControlState({ dir, expected, git = runGit(dir), fetch = true }) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain"]).length > 0;
  let remote = null;
  try {
    remote = git(["remote", "get-url", "origin"]);
  } catch {
    remote = null;
  }

  let upstream = null;
  let fetched = false;
  if (branch === expected) {
    // A fetch that fails is not a launch that fails. `--no-tags` and an explicit refspec keep this to
    // the one ref the decision is about.
    if (fetch) {
      try {
        git(["fetch", "--no-tags", "--quiet", "origin", expected]);
        fetched = true;
      } catch {
        fetched = false;
      }
    }

    // FETCH_HEAD is only this run's answer when this run's fetch actually succeeded. The file
    // persists between runs and can describe an older fetch, or a different ref entirely -- reading
    // it after a failed fetch silently promoted stale remote state into today's pinned upstream, and
    // `merge --ff-only` would then move the control folder onto it.
    if (fetched) {
      try {
        upstream = git(["rev-parse", "FETCH_HEAD"]);
      } catch {
        upstream = null;
      }
    }

    // Offline, or fetch disabled: the explicitly configured remote-tracking ref is the documented
    // fallback. Never an ambient FETCH_HEAD.
    if (upstream === null) {
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

  return { branch, head, dirty, upstream, ancestor, remote, fetched };
}

/**
 * Catch the control folder up, or say why it did not.
 *
 * Returns `{ updated, head, reason }`. `head` is always the commit the caller is now running, so a
 * launcher can name its own version whether or not anything moved — which is the first half of
 * "the control folder knows the exact launcher commit it runs".
 */
export function updateControl({ dir, expected = "main", git = runGit(dir), dryRun = false, fetch = true, expectedRemote = null }) {
  const state = readControlState({ dir, expected, git, fetch });
  const plan = planControlUpdate({ ...state, expected, expectedRemote });

  if (plan.action !== "fast-forward") {
    return { updated: false, head: state.head, action: plan.action, fatal: Boolean(plan.fatal), reason: plan.reason };
  }
  if (dryRun) return { updated: false, head: state.head, action: "fast-forward", fatal: false, dryRun: true, reason: plan.reason };

  // `--ff-only` against the exact commit id, never a ref name: the ref could resolve differently by
  // now, and this is the same pinning discipline the worktree creation runs under.
  git(["merge", "--ff-only", plan.to]);
  const head = git(["rev-parse", "HEAD"]);
  if (head !== plan.to) {
    return { updated: false, head, action: "refuse", fatal: true, reason: `the fast-forward did not land on ${plan.to.slice(0, 7)} (HEAD is ${head.slice(0, 7)}).` };
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
      expectedRemote: argOf("--remote"),
    });
  } catch (e) {
    // A control folder that cannot even be READ is the strongest reason of all not to run its code.
    r = { updated: false, head: null, action: "refuse", fatal: true, reason: `the control folder could not be read: ${String(e.message ?? e)}` };
  }
  console.log(JSON.stringify({ ...r, short: FULL_SHA.test(r.head ?? "") ? r.head.slice(0, 7) : "unknown" }));
  // 0 = nothing to do, 10 = updated (the launcher restarts into the new code),
  // 1 = did not update but the folder still vouches for itself, 2 = FATAL, do not launch.
  process.exit(r.updated ? 10 : r.action === "none" ? 0 : r.fatal ? 2 : 1);
}
