// Guards 3 and 5 — "correct folder, wrong branch" and "dirty worktree reuse".
//
// Why the five states are counted SEPARATELY (spec §7): collapsing modified / untracked / staged /
// stashed / divergent into one boolean is how work gets lost. A stash is invisible to
// `git status`, and a launcher that reports "clean" over a stashed change invites the next session
// to reset the folder out from under it.
//
// Real repositories, real remotes, real stashes. Each state gets its own clone so no test depends
// on another's leftovers.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branchMatches, describeGitState, inspectGitState } from "./git-state.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=guard", "-c", "user.email=guard@test", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

let root;
let bare;
let seed;
const repos = {};

const clone = (name) => {
  const dir = join(root, name);
  execFileSync("git", ["clone", "--quiet", bare, dir], { stdio: "ignore" });
  git(dir, "config", "user.name", "guard");
  git(dir, "config", "user.email", "guard@test");
  repos[name] = dir;
  return dir;
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-gitstate-"));
  bare = join(root, "remote.git");
  seed = join(root, "seed");

  execFileSync("git", ["init", "--bare", "-b", "main", bare], { stdio: "ignore" });
  execFileSync("git", ["init", "-b", "main", seed], { stdio: "ignore" });
  writeFileSync(join(seed, "tracked.txt"), "one\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "seed");
  git(seed, "remote", "add", "origin", bare);
  git(seed, "push", "-u", "origin", "main");

  clone("clean");
  clone("modified");
  clone("untracked");
  clone("staged");
  clone("stashed");
  clone("ahead");
  clone("behind");
  clone("diverged");
  clone("detached");
  clone("otherBranch");

  appendFileSync(join(repos.modified, "tracked.txt"), "local edit\n");

  writeFileSync(join(repos.untracked, "scratch.md"), "notes\n");

  appendFileSync(join(repos.staged, "tracked.txt"), "staged edit\n");
  git(repos.staged, "add", "-A");

  appendFileSync(join(repos.stashed, "tracked.txt"), "stashed edit\n");
  git(repos.stashed, "stash", "push", "-m", "guard fixture");

  appendFileSync(join(repos.ahead, "tracked.txt"), "local commit\n");
  git(repos.ahead, "commit", "-am", "ahead by one");

  appendFileSync(join(repos.diverged, "tracked.txt"), "divergent commit\n");
  git(repos.diverged, "commit", "-am", "diverged locally");

  // Now move the remote forward so `behind` and `diverged` really are behind it.
  appendFileSync(join(seed, "tracked.txt"), "remote commit\n");
  git(seed, "commit", "-am", "remote moves on");
  git(seed, "push");
  git(repos.behind, "fetch", "--quiet");
  git(repos.diverged, "fetch", "--quiet");

  git(repos.detached, "checkout", "--quiet", "--detach", "HEAD");
  git(repos.otherBranch, "checkout", "--quiet", "-b", "feat/somewhere-else");
}, 120_000);

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("clean is clean, and says so", () => {
  it("reports zero of every state class", () => {
    const s = inspectGitState(repos.clean);
    expect(s).toMatchObject({
      branch: "main",
      detached: false,
      modified: 0,
      untracked: 0,
      staged: 0,
      stashed: 0,
      ahead: 0,
      behind: 0,
      clean: true,
    });
  });

  it("knows its upstream", () => {
    expect(inspectGitState(repos.clean).upstream).toBe("origin/main");
  });
});

describe("guard 5 — every dirty class is detected on its own", () => {
  it("a modified tracked file", () => {
    const s = inspectGitState(repos.modified);
    expect(s.modified).toBe(1);
    expect(s.staged).toBe(0);
    expect(s.clean).toBe(false);
    expect(s.files.modified).toContain("tracked.txt");
  });

  it("an untracked file — counted, never ignored", () => {
    const s = inspectGitState(repos.untracked);
    expect(s.untracked).toBe(1);
    expect(s.modified).toBe(0);
    expect(s.clean).toBe(false);
    expect(s.files.untracked).toContain("scratch.md");
  });

  it("a staged change, distinct from an unstaged one", () => {
    const s = inspectGitState(repos.staged);
    expect(s.staged).toBe(1);
    expect(s.modified).toBe(0);
    expect(s.clean).toBe(false);
  });

  it("a stash made on another branch is another checkout's, not this folder's — the stack is shared", () => {
    // Every worktree of a repository sees the whole stash stack. The entry above was made on main,
    // so a checkout of a different branch is clean — and still told the entry exists.
    const wt = join(root, "stashed-other-branch");
    git(repos.stashed, "worktree", "add", "--quiet", "-b", "other", wt);
    const s = inspectGitState(wt);
    expect(s.stashed).toBe(0);
    expect(s.stashedElsewhere).toBe(1);
    expect(s.clean).toBe(true);
    expect(describeGitState(s)).toBe("clean on other (1 stashed on other branches)");
  });

  it("a stash — invisible to `git status`, and the reason `clean` is not enough", () => {
    const s = inspectGitState(repos.stashed);
    expect(s.stashed).toBe(1);
    expect(s.modified).toBe(0);
    expect(s.untracked).toBe(0);
    // The working tree really is clean. Reusing this folder on that basis would bury the stash.
    expect(s.workingTreeClean).toBe(true);
    expect(s.clean).toBe(false);
  });

  it("divergence in each direction, counted separately", () => {
    expect(inspectGitState(repos.ahead)).toMatchObject({ ahead: 1, behind: 0, clean: false });
    expect(inspectGitState(repos.behind)).toMatchObject({ ahead: 0, behind: 1, clean: false });
    expect(inspectGitState(repos.diverged)).toMatchObject({ ahead: 1, behind: 1, clean: false });
  });

  it("detached HEAD is a state, not a branch", () => {
    const s = inspectGitState(repos.detached);
    expect(s.detached).toBe(true);
    expect(s.branch).toBeNull();
    expect(s.clean).toBe(false);
  });
});

describe("guard 3 — correct folder, wrong branch", () => {
  it("refuses a claimed branch that is not the checked-out branch", () => {
    const s = inspectGitState(repos.otherBranch);
    expect(s.branch).toBe("feat/somewhere-else");
    expect(branchMatches(s, "feat/single-entry-workflow")).toBe(false);
    expect(branchMatches(s, "feat/somewhere-else")).toBe(true);
  });

  it("never matches a branch while HEAD is detached", () => {
    expect(branchMatches(inspectGitState(repos.detached), "main")).toBe(false);
  });
});

describe("the description is the remediation line", () => {
  it("names each state it found, so a refusal tells Kuya what to do", () => {
    expect(describeGitState(inspectGitState(repos.clean))).toMatch(/clean/i);
    expect(describeGitState(inspectGitState(repos.modified))).toMatch(/1 modified/);
    expect(describeGitState(inspectGitState(repos.untracked))).toMatch(/1 untracked/);
    expect(describeGitState(inspectGitState(repos.staged))).toMatch(/1 staged/);
    expect(describeGitState(inspectGitState(repos.stashed))).toMatch(/1 stashed/);
    expect(describeGitState(inspectGitState(repos.diverged))).toMatch(/ahead 1.*behind 1/);
  });
});

describe("inspection never mutates", () => {
  it("leaves the stash and the working tree exactly as they were", () => {
    const before = git(repos.stashed, "stash", "list");
    const status = git(repos.stashed, "status", "--porcelain");
    inspectGitState(repos.stashed);
    expect(git(repos.stashed, "stash", "list")).toBe(before);
    expect(git(repos.stashed, "status", "--porcelain")).toBe(status);
  });
});
