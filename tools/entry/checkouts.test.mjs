// Guard 6 — linked-worktree Git metadata, and the checkout class `git worktree list` cannot see.
//
// Why (spec §2, findings 1 and 10): `git worktree list` reports five checkouts, but there are six.
// `code\sentinel-work-control-codex` is a SEPARATE CLONE of the same remote, invisible to every
// worktree-based tool. And a linked worktree's `.git` is a FILE, not a directory — which is why
// build.rs's `rerun-if-changed=../.git/HEAD` never fires there and cargo re-bundled a stale binary
// in #14.
//
// The fixtures are real: `git init`, a real `git worktree add`, a real `git clone`. Nothing about
// Git's own behaviour is mocked, because finding 10 is precisely a case where Git's real behaviour
// differed from the assumed behaviour — a mock would have reproduced the assumption, not the bug.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverCheckouts, inspectCheckout, listWorktreesOf, relatedCheckouts } from "./checkouts.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";

// TIMEOUT (#542): every case here is real `git` processes, and their wall time is set by machine
// load, not by what the case asserts. One discoverCheckouts over this fixture is 9 spawns (2 per
// checkout x 4 checkouts + 1 `worktree list` for the host; it was 4 per checkout until #549).
// Measured 2026-09-23: 150-600 ms per git spawn standing alone on the dev PC, and in a full native
// gate the tolerant case below (then 35 spawns, two discoveries) took 16.6 s against the global 15 s
// — about 0.47 s a spawn. At the budget of 11 spawns a case, that rate is about 5 s. The 120 s below
// (GIT_SPAWN_TIMEOUT_MS, #563) is headroom for a busier machine, not room to spend: the assertions
// are about which checkouts are found, which do not become truer at 15 s than at 120 s. Speed is
// guarded by SPAWN COUNT instead (afterEach below), which does not vary with load.
vi.setConfig({ testTimeout: GIT_SPAWN_TIMEOUT_MS });

// Git counts its own processes: with GIT_TRACE2_EVENT set to a directory, every git process writes
// one file there. That count includes checkouts.mjs's calls, which JS-side wrappers did not see
// under vitest: a `vi.mock` pass-through and a patched builtin export were tried first, and both
// counted 0 for checkouts.mjs. The last case in this file proves this counter is not blind.
// Tracing changes no git behaviour.
const traceDir = mkdtempSync(join(tmpdir(), "compy-entry-checkouts-trace2-"));
const priorTrace = process.env.GIT_TRACE2_EVENT;
process.env.GIT_TRACE2_EVENT = traceDir;
const gitSpawns = () => readdirSync(traceDir).length;
afterAll(() => {
  // The worker outlives this file, and so does its environment.
  if (priorTrace === undefined) delete process.env.GIT_TRACE2_EVENT;
  else process.env.GIT_TRACE2_EVENT = priorTrace;
  try {
    rmSync(traceDir, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

// One discovery (9) plus two reads of the case's own. A case over this is paying for a second
// discovery or a new git call per checkout. Either one reopens #542 and #549, so fix the spend or
// re-derive the budget above. Do not just raise this number.
const CASE_SPAWN_BUDGET = 11;
let spawnsBefore;
beforeEach(() => {
  spawnsBefore = gitSpawns();
});
afterEach(() => {
  expect(gitSpawns() - spawnsBefore, "git processes this case started").toBeLessThanOrEqual(CASE_SPAWN_BUDGET);
});

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=guard", "-c", "user.email=guard@test", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

let root;
let host;
let linked;
let clone;
let unrelated;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-checkouts-"));
  host = join(root, "host");
  linked = join(root, "linked");
  clone = join(root, "clone");
  unrelated = join(root, "unrelated");

  // Mirror the real topology: a shared remote, one host checkout with a linked worktree, and a
  // second SEPARATE CLONE of the same remote. Cloning the host directly would have given the host
  // no origin at all, which is not how `code\sentinel` and `sentinel-work-control-codex` relate.
  const bare = join(root, "remote.git");
  execFileSync("git", ["init", "--bare", "-b", "main", bare], { stdio: "ignore" });
  execFileSync("git", ["init", "-b", "main", host], { stdio: "ignore" });
  writeFileSync(join(host, "README.md"), "fixture\n");
  git(host, "add", "-A");
  git(host, "commit", "-m", "fixture");
  git(host, "remote", "add", "origin", bare);
  git(host, "push", "-u", "origin", "main");
  git(host, "worktree", "add", "-b", "feat/linked", linked);
  execFileSync("git", ["clone", "--quiet", bare, clone], { stdio: "ignore" });

  // A different project living beside them. The real machine has two (holoforge, sister-site).
  execFileSync("git", ["init", "-b", "main", unrelated], { stdio: "ignore" });
  writeFileSync(join(unrelated, "README.md"), "other project\n");
  git(unrelated, "add", "-A");
  git(unrelated, "commit", "-m", "other");
}, GIT_SPAWN_TIMEOUT_MS);

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("linked-worktree metadata", () => {
  it("a linked worktree's .git is a FILE, not a directory", () => {
    expect(statSync(join(host, ".git")).isDirectory()).toBe(true);
    expect(statSync(join(linked, ".git")).isFile()).toBe(true);
    expect(inspectCheckout(linked).dotGit).toBe("file");
    expect(inspectCheckout(host).dotGit).toBe("dir");
  });

  it("resolves a linked worktree's common dir back to its host, as an absolute path", () => {
    const info = inspectCheckout(linked);
    expect(info.kind).toBe("linked");
    expect(info.commonDir.toLowerCase()).toBe(join(host, ".git").toLowerCase());
    expect(info.branch).toBe("feat/linked");
  });

  it("classifies the checkout that hosts linked worktrees as the host", () => {
    const info = inspectCheckout(host);
    expect(info.kind).toBe("host");
    expect(info.branch).toBe("main");
  });
});

describe("the HEAD states one rev-parse reads", () => {
  it("an unborn HEAD has no branch and is NOT detached; a detached HEAD is detached", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    // One rev-parse reads all three facts (#549). On an unborn HEAD it prints both dirs and a bare
    // `HEAD`, then exits 128. Read naively, that `HEAD` would report a fresh `git init` as detached.
    // Outside `root`, so the discovery cases below still see exactly the four fixture checkouts.
    const fresh = mkdtempSync(join(tmpdir(), "compy-entry-checkouts-unborn-"));
    try {
      execFileSync("git", ["init", "--quiet", "-b", "main", fresh], { stdio: "ignore" });
      const unborn = inspectCheckout(fresh);
      expect(unborn.kind).toBe("clone");
      expect(unborn.commonDir.toLowerCase()).toBe(join(fresh, ".git").toLowerCase());
      expect(unborn.gitDir.toLowerCase()).toBe(join(fresh, ".git").toLowerCase());
      expect(unborn.branch).toBeNull();
      expect(unborn.detached).toBe(false);

      git(fresh, "commit", "--quiet", "--allow-empty", "-m", "first");
      git(fresh, "checkout", "--quiet", "--detach");
      const detached = inspectCheckout(fresh);
      expect(detached.branch).toBeNull();
      expect(detached.detached).toBe(true);
    } finally {
      try {
        rmSync(fresh, { recursive: true, force: true });
      } catch {
        /* a locked file on Windows must not fail the suite */
      }
    }
  });
});

// The three read-only cases below all read one discovery of the untouched fixture. Discovery is
// read-only ("leaves every discovered checkout's state untouched" proves it), so running it three
// times would buy 18 more spawns and no more evidence.
let fixtureDiscovery;
const discovered = () => (fixtureDiscovery ??= discoverCheckouts({ roots: [root] }));

describe("the checkout class git worktree list omits", () => {
  it("classifies a separate clone as a clone, with its common dir inside itself", () => {
    const info = inspectCheckout(clone);
    expect(info.kind).toBe("clone");
    expect(info.commonDir.toLowerCase()).toBe(join(clone, ".git").toLowerCase());
  });

  it("git worktree list does NOT report the separate clone — this is the whole reason for a scan", () => {
    const listed = listWorktreesOf(host).map((p) => p.toLowerCase());
    expect(listed).toContain(host.toLowerCase());
    expect(listed).toContain(linked.toLowerCase());
    expect(listed).not.toContain(clone.toLowerCase());
  });

  it("discovery finds all of them, so the separate clone cannot be missed", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const found = discovered();
    const byPath = Object.fromEntries(found.map((c) => [c.path.toLowerCase(), c]));
    expect(Object.keys(byPath)).toHaveLength(4);
    expect(byPath[host.toLowerCase()].kind).toBe("host");
    expect(byPath[linked.toLowerCase()].kind).toBe("linked");
    expect(byPath[clone.toLowerCase()].kind).toBe("clone");
  });

  it("does NOT treat a different project beside it as a competing writer", () => {
    // The real machine keeps holoforge and sister-site next to the Compy checkouts. Refusing a
    // launch because an unrelated repo is dirty would be a false alarm, and a launcher that cries
    // wolf gets bypassed — which is how the invariant dies.
    const found = discovered();
    const me = found.find((c) => c.path.toLowerCase() === linked.toLowerCase());
    const related = relatedCheckouts(me, found).map((c) => c.path.toLowerCase());
    expect(related).toContain(host.toLowerCase());
    expect(related).toContain(clone.toLowerCase());
    expect(related).not.toContain(unrelated.toLowerCase());
  });

  it("relates the clone to the same repository by origin, not by folder name", () => {
    const found = discovered();
    const info = found.find((c) => c.kind === "clone" && c.path.toLowerCase() === clone.toLowerCase());
    const host_ = found.find((c) => c.kind === "host");
    expect(info.remote).toBeTruthy();
    expect(info.remote.toLowerCase().replace(/\//g, "\\")).toBe(
      host_.remote.toLowerCase().replace(/\//g, "\\"),
    );
    // ...and NOT by common dir, which is exactly why `git worktree list` cannot see it.
    expect(info.commonDir.toLowerCase()).not.toBe(host_.commonDir.toLowerCase());
  });
});

describe("discovery is read-only and tolerant", () => {
  it("ignores directories that are not checkouts and never throws on them", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const stray = join(root, "not-a-repo");
    // A plain directory and a loose file beside the checkouts, plus a root that does not exist.
    // (This used to `git init` the directory and then delete it, which paid a spawn and left
    // nothing on disk to ignore. The bare `remote.git` is already a non-checkout directory.)
    mkdirSync(join(root, "ignored-scratch"));
    writeFileSync(join(root, "loose-file.txt"), "x");
    // ONE discovery, asserted on twice. A second walk of the same root doubled this case's spawns,
    // and that is what ran it past 15 s in the full gate (#542).
    let found;
    expect(() => {
      found = discoverCheckouts({ roots: [root, stray] });
    }).not.toThrow();
    expect(found.map((c) => c.path)).not.toContain(stray);
    expect(found.map((c) => c.path.toLowerCase()).sort()).toEqual(
      [host, linked, clone, unrelated].map((p) => p.toLowerCase()).sort(),
    );
  });

  it("leaves every discovered checkout's state untouched", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const before = git(linked, "status", "--porcelain");
    discoverCheckouts({ roots: [root] });
    expect(git(linked, "status", "--porcelain")).toBe(before);
  });
});

describe("the per-case spawn budget (#542)", () => {
  it("counts checkouts.mjs's own git processes, so the budget is not vacuous", () => {
    const start = gitSpawns();
    inspectCheckout(host);
    // 2 per checkout (one rev-parse, one remote get-url) is the arithmetic the 9-per-discovery budget
    // above rests on (#549). Zero means the counter went blind and every case passes its budget
    // unmeasured.
    expect(gitSpawns() - start).toBeGreaterThan(0);
    expect(gitSpawns() - start).toBeLessThanOrEqual(2);
  });
});
