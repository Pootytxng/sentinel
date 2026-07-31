// Guard 11: the control clone must not run a launcher older than the one that was verified.
//
// This was not hypothetical. While this program was being written, `C:\Users\Kuya\code\compy-control`
// — the folder the Desktop shortcut actually executes — sat on `tooling/compy-entry` at a commit two
// merges behind `main`. Every test in this repo was green against code the owner's shortcut did not
// run. That is the failure mode the owner named directly: "do not declare success merely because code
// reached main."
//
// Catching up is the easy half. The hard half is catching up under rules narrow enough that the
// update can never become the thing that loses work or hijacks the launcher, and the rules only stay
// rules if each one is a test:
//
//   * fast-forward or nothing — never merge, rebase, reset, checkout or pull
//   * a dirty clone is never moved, however far behind it is
//   * a diverged branch is never "sorted out"
//   * the pinned branch is the only branch this touches
//   * and a refusal to UPDATE is never a refusal to LAUNCH
//
// That last one is what keeps this from becoming a new chore. Being a commit behind is worth one
// line of disclosure, not a dead shortcut the owner cannot revive from the terminal it appeared in.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planControlUpdate, readControlState, sameRepo, updateControl } from "./control-update.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
/** A readable FETCH_HEAD describing an OLDER fetch — what a real machine has after a fetch fails. */
const STALE = "d".repeat(40);
const C = "c".repeat(40);

/** The state of a clean clone that is one verified commit behind. */
const behind = { branch: "main", expected: "main", head: A, upstream: B, dirty: false, ancestor: true };

describe("what a control folder in this state deserves", () => {
  it("catches up when it is clean, on the pinned branch, and simply behind", () => {
    const plan = planControlUpdate(behind);
    expect(plan.action).toBe("fast-forward");
    expect(plan.from).toBe(A);
    expect(plan.to).toBe(B);
  });

  it("does nothing when it is already running the current launcher", () => {
    expect(planControlUpdate({ ...behind, upstream: A }).action).toBe("none");
  });

  // Local work outranks being current, every time. There is no "but it is only one commit" clause.
  it("refuses to move a dirty clone, and says whose work it is protecting", () => {
    const plan = planControlUpdate({ ...behind, dirty: true });
    expect(plan.action).toBe("refuse");
    expect(plan.reason).toMatch(/uncommitted/i);
  });

  // Rewritten, not extended. This test used to assert `action: "none"` here -- it encoded the belief
  // that a dirty clone with nothing to fetch is a non-event, and so it defended the defect: the
  // launcher read "already running the current launcher", printed nothing, and executed whatever
  // somebody had edited into compy-entry.ps1 or a launcher module. A commit id vouches for the bytes
  // in that commit and for nothing else. Being current is not being unmodified.
  it("refuses a dirty clone that is already current — commit identity does not vouch for edits", () => {
    const plan = planControlUpdate({ ...behind, upstream: A, dirty: true });
    expect(plan.action).toBe("refuse");
    expect(plan.fatal).toBe(true);
    expect(plan.reason).toMatch(/uncommitted/i);
    expect(plan.reason).toMatch(/does not vouch/i);
  });

  // The refusal has to reach the launch. "Refuse the update, run the stale launcher anyway" is the
  // pin defeating itself, so every refusal is fatal and the shell is required to honour it.
  it("marks every refusal fatal, and neither ordinary outcome", () => {
    expect(planControlUpdate({ ...behind, dirty: true }).fatal).toBe(true);
    expect(planControlUpdate({ ...behind, ancestor: false }).fatal).toBe(true);
    expect(planControlUpdate({ ...behind, branch: "tooling/compy-entry" }).fatal).toBe(true);
    expect(planControlUpdate({ ...behind, upstream: null }).fatal).toBe(true);
    expect(planControlUpdate({ ...behind, upstream: A }).fatal).toBe(false);
    expect(planControlUpdate({ ...behind }).fatal).toBe(false);
  });

  // Identity is <owner>/<repo>, matched whole. The old PowerShell pin used `-notlike "*...*"`, and
  // the fetch/merge path checked the remote not at all.
  it("refuses a folder whose origin is a different repository", () => {
    const plan = planControlUpdate({ ...behind, remote: "https://github.com/attacker/Pootytxng-sentinel-fork", expectedRemote: "Pootytxng/sentinel" });
    expect(plan.action).toBe("refuse");
    expect(plan.fatal).toBe(true);
    expect(plan.reason).toMatch(/not Pootytxng\/sentinel/i);
  });

  it("accepts the spellings git really produces for the same repository", () => {
    for (const url of [
      "https://github.com/Pootytxng/sentinel.git",
      "https://github.com/pootytxng/sentinel",
      "git@github.com:Pootytxng/sentinel.git",
      "ssh://git@github.com/Pootytxng/sentinel",
    ]) {
      expect(sameRepo(url, "Pootytxng/sentinel")).toBe(true);
    }
    for (const url of ["https://github.com/attacker/Pootytxng-sentinel-fork", "https://github.com/other/sentinel", "", null]) {
      expect(sameRepo(url, "Pootytxng/sentinel")).toBe(false);
    }
  });

  // Divergence means the folder holds commits upstream does not. Moving the branch would strand them.
  it("refuses a diverged branch instead of resolving it", () => {
    const plan = planControlUpdate({ ...behind, ancestor: false });
    expect(plan.action).toBe("refuse");
    expect(plan.reason).toMatch(/diverged/i);
    expect(plan.reason).toMatch(/fast-forward/i);
  });

  // An "update" that changes which branch the launcher runs is a hijack wearing an update's clothes.
  it("refuses when the folder is on a branch other than the pinned one, and names both", () => {
    const plan = planControlUpdate({ ...behind, branch: "tooling/compy-entry" });
    expect(plan.action).toBe("refuse");
    expect(plan.reason).toContain("tooling/compy-entry");
    expect(plan.reason).toContain("main");
  });

  it("refuses a detached or unreadable HEAD rather than guessing a starting point", () => {
    expect(planControlUpdate({ ...behind, head: "HEAD" }).action).toBe("refuse");
    expect(planControlUpdate({ ...behind, head: null }).action).toBe("refuse");
  });

  // Offline is the ordinary case for this, not an exotic one: the shortcut gets double-clicked on a
  // laptop with no network. It must produce a plain refusal, never an exception.
  it("refuses without an upstream commit — offline is a reason not to update, not to crash", () => {
    const plan = planControlUpdate({ ...behind, upstream: null });
    expect(plan.action).toBe("refuse");
    expect(plan.reason).toMatch(/upstream/i);
  });

  it("will not accept a ref name where a commit id belongs", () => {
    expect(planControlUpdate({ ...behind, upstream: "origin/main" }).action).toBe("refuse");
  });
});

describe("what it does to a repository, and what it never does", () => {
  /** A git that records every argv it is asked to run and answers from a script. */
  const fakeGit = (answers, log = []) => {
    const run = (args) => {
      log.push(args.join(" "));
      const key = Object.keys(answers).find((k) => args.join(" ").startsWith(k));
      if (!key) throw new Error(`unscripted git: ${args.join(" ")}`);
      const v = answers[key];
      if (v instanceof Error) throw v;
      return typeof v === "function" ? v() : v;
    };
    run.log = log;
    return run;
  };

  const cleanBehind = (extra = {}) => ({
    "rev-parse --abbrev-ref": "main",
    "rev-parse HEAD": A,
    "status --porcelain": "",
    "fetch": "",
    "rev-parse FETCH_HEAD": B,
    "merge-base --is-ancestor": "",
    "merge --ff-only": "",
    ...extra,
  });

  it("fast-forwards to the exact commit id, never to a ref name", () => {
    let head = A;
    const git = fakeGit({ ...cleanBehind(), "rev-parse HEAD": () => head, "merge --ff-only": () => ((head = B), "") });
    const r = updateControl({ dir: "(fake)", git });

    expect(r.updated).toBe(true);
    expect(r.head).toBe(B);
    // The pinning discipline the worktree creation already runs under: a ref could resolve elsewhere
    // between the plan and the move; the commit id cannot.
    expect(git.log).toContain(`merge --ff-only ${B}`);
  });

  // The blast radius, asserted as an allowlist. A test that only checked the happy path would not
  // notice a future `git reset --hard` added to "make the update more reliable".
  it("never runs reset, rebase, checkout, pull, clean or push", () => {
    let head = A;
    const git = fakeGit({ ...cleanBehind(), "rev-parse HEAD": () => head, "merge --ff-only": () => ((head = B), "") });
    updateControl({ dir: "(fake)", git });
    for (const forbidden of ["reset", "rebase", "checkout", "pull", "clean", "push", "switch"]) {
      expect(git.log.some((c) => c.split(" ")[0] === forbidden)).toBe(false);
    }
  });

  it("writes nothing on a dry run, and still reports what it would have done", () => {
    const git = fakeGit(cleanBehind());
    const r = updateControl({ dir: "(fake)", git, dryRun: true });
    expect(r.updated).toBe(false);
    expect(r.action).toBe("fast-forward");
    // `merge-base --is-ancestor` is a read and belongs here; `merge` is the write that must not run.
    expect(git.log.some((c) => c.split(" ")[0] === "merge")).toBe(false);
  });

  it("does not fetch when the folder is on the wrong branch — the refusal needs no network", () => {
    const git = fakeGit({ ...cleanBehind(), "rev-parse --abbrev-ref": "tooling/compy-entry" });
    const r = updateControl({ dir: "(fake)", git });
    expect(r.updated).toBe(false);
    expect(git.log.some((c) => c.startsWith("fetch"))).toBe(false);
  });

  it("survives a failed fetch and refuses on the missing upstream instead", () => {
    const git = fakeGit({
      ...cleanBehind(),
      fetch: new Error("fatal: unable to access ... Could not resolve host"),
      "rev-parse FETCH_HEAD": new Error("unknown revision"),
      "rev-parse origin/main": new Error("unknown revision"),
    });
    const r = updateControl({ dir: "(fake)", git });
    expect(r.updated).toBe(false);
    expect(r.action).toBe("refuse");
  });

  // The previous version of the test above ALSO stubbed FETCH_HEAD to throw, which is not what a real
  // machine does: .git/FETCH_HEAD persists between runs and stays perfectly readable after a fetch
  // fails. So the guard asserted the right outcome with the dangerous condition removed. Here the
  // file reads fine and describes a DIFFERENT, older fetch -- and it must not become the upstream
  // this run merges onto.
  it("never promotes a readable but stale FETCH_HEAD after the fetch failed", () => {
    const git = fakeGit({
      ...cleanBehind(),
      fetch: new Error("fatal: unable to access ... Could not resolve host"),
      "rev-parse FETCH_HEAD": STALE,
      "rev-parse origin/main": new Error("unknown revision"),
    });
    const r = updateControl({ dir: "(fake)", git });
    expect(r.action).toBe("refuse");
    expect(r.updated).toBe(false);
    expect(git.log.some((c) => c.startsWith("merge"))).toBe(false);
  });

  // Offline is allowed to fall back to the explicitly configured remote-tracking ref -- that is the
  // documented policy. It is the ambient FETCH_HEAD that is never allowed to stand in for it.
  it("falls back to origin/<branch>, not to FETCH_HEAD, when the fetch failed", () => {
    const git = fakeGit({
      ...cleanBehind(),
      fetch: new Error("offline"),
      "rev-parse FETCH_HEAD": STALE,
      "rev-parse origin/main": B,
    });
    const r = updateControl({ dir: "(fake)", git, dryRun: true });
    expect(r.action).toBe("fast-forward");
    expect(r.reason).toContain(B.slice(0, 7));
    expect(r.reason).not.toContain(STALE.slice(0, 7));
  });

  // Trust the measurement, not the command's exit status: the launcher is about to run whatever code
  // is in that folder, so "the merge returned 0" is a weaker claim than "HEAD is where I aimed it".
  it("does not report success when HEAD did not actually land on the target", () => {
    const git = fakeGit(cleanBehind()); // merge succeeds, HEAD stubbornly stays at A
    const r = updateControl({ dir: "(fake)", git });
    expect(r.updated).toBe(false);
    expect(r.action).toBe("refuse");
  });

  // The first half of "the control folder knows the exact launcher commit it runs" — true on every
  // path, including the ones that refuse, because the launcher names its own version either way.
  it("always reports the commit the caller is now running", () => {
    for (const answers of [cleanBehind({ "rev-parse HEAD": A, "rev-parse FETCH_HEAD": A }), cleanBehind({ "status --porcelain": " M compy-entry.ps1" })]) {
      expect(updateControl({ dir: "(fake)", git: fakeGit(answers) }).head).toBe(A);
    }
  });
});

describe("against two real repositories", () => {
  let root;
  let origin;
  let clone;
  let seq = 0;
  const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  /** A verified launcher change lands upstream. The clone does not see it until it fetches. */
  const advanceOrigin = () => {
    seq += 1;
    writeFileSync(join(origin, "compy-entry.ps1"), `# launcher revision ${seq}\n`);
    git(origin, ["add", "-A"]);
    git(origin, ["commit", "-q", "-m", `launcher ${seq}`]);
    return git(origin, ["rev-parse", "HEAD"]);
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "compy-control-update-"));
    origin = join(root, "origin");
    clone = join(root, "clone");
    mkdirSync(origin, { recursive: true });
    git(root, ["-c", "init.defaultBranch=main", "init", "-q", origin]);
    git(origin, ["config", "user.email", "guard@example.invalid"]);
    git(origin, ["config", "user.name", "guard"]);
    // A bare-less origin cannot be pushed to on its checked-out branch, and nothing here pushes.
    advanceOrigin();
    git(root, ["clone", "-q", origin, clone]);
    git(clone, ["config", "user.email", "guard@example.invalid"]);
    git(clone, ["config", "user.name", "guard"]);
  });
  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows must not fail the suite */
    }
  });

  it("brings a clone that is behind up to the exact upstream commit", () => {
    const target = advanceOrigin();
    const r = updateControl({ dir: clone, expected: "main" });
    expect(r.updated).toBe(true);
    expect(r.head).toBe(target);
    expect(git(clone, ["rev-parse", "HEAD"])).toBe(target);
  });

  it("reports nothing to do on the second run", () => {
    expect(updateControl({ dir: clone, expected: "main" }).action).toBe("none");
  });

  // The one that protects a human. An edit sitting in the control folder is somebody's work in
  // progress, and no amount of being behind licenses overwriting it.
  it("leaves a dirty clone exactly where it is, edit intact", () => {
    const before = git(clone, ["rev-parse", "HEAD"]);
    writeFileSync(join(clone, "compy-entry.ps1"), "# a human was editing this\n");
    advanceOrigin();

    const r = updateControl({ dir: clone, expected: "main" });
    expect(r.updated).toBe(false);
    expect(r.reason).toMatch(/uncommitted/i);
    expect(git(clone, ["rev-parse", "HEAD"])).toBe(before);
    expect(git(clone, ["status", "--porcelain"])).toContain("compy-entry.ps1");

    git(clone, ["checkout", "--", "compy-entry.ps1"]);
  });

  it("refuses a clone that has committed something of its own, and strands nothing", () => {
    writeFileSync(join(clone, "local-only.txt"), "a commit upstream does not have\n");
    git(clone, ["add", "-A"]);
    git(clone, ["commit", "-q", "-m", "local work"]);
    const local = git(clone, ["rev-parse", "HEAD"]);

    const r = updateControl({ dir: clone, expected: "main" });
    expect(r.updated).toBe(false);
    expect(r.reason).toMatch(/diverged/i);
    expect(git(clone, ["rev-parse", "HEAD"])).toBe(local);

    git(clone, ["reset", "-q", "--hard", "HEAD~1"]);
  });

  it("refuses when the clone is on a different branch, without touching it", () => {
    git(clone, ["checkout", "-q", "-b", "tooling/compy-entry"]);
    const head = git(clone, ["rev-parse", "HEAD"]);

    const r = updateControl({ dir: clone, expected: "main" });
    expect(r.updated).toBe(false);
    expect(git(clone, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("tooling/compy-entry");
    expect(git(clone, ["rev-parse", "HEAD"])).toBe(head);

    git(clone, ["checkout", "-q", "main"]);
  });

  it("reads state without a fetch when asked, so a plan can be formed offline", () => {
    const state = readControlState({ dir: clone, expected: "main", fetch: false });
    expect(state.branch).toBe("main");
    expect(state.head).toMatch(/^[0-9a-f]{40}$/);
    expect(state.dirty).toBe(false);
  });
});
