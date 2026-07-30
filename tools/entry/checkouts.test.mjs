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
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverCheckouts, inspectCheckout, listWorktreesOf, relatedCheckouts } from "./checkouts.mjs";

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
}, 60_000);

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

  it("discovery finds all of them, so the separate clone cannot be missed", () => {
    const found = discoverCheckouts({ roots: [root] });
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
    const found = discoverCheckouts({ roots: [root] });
    const me = found.find((c) => c.path.toLowerCase() === linked.toLowerCase());
    const related = relatedCheckouts(me, found).map((c) => c.path.toLowerCase());
    expect(related).toContain(host.toLowerCase());
    expect(related).toContain(clone.toLowerCase());
    expect(related).not.toContain(unrelated.toLowerCase());
  });

  it("relates the clone to the same repository by origin, not by folder name", () => {
    const found = discoverCheckouts({ roots: [root] });
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
  it("ignores directories that are not checkouts and never throws on them", () => {
    const stray = join(root, "not-a-repo");
    execFileSync("git", ["init", "--quiet", join(root, "ignored-scratch")], { stdio: "ignore" });
    rmSync(join(root, "ignored-scratch"), { recursive: true, force: true });
    writeFileSync(join(root, "loose-file.txt"), "x");
    expect(() => discoverCheckouts({ roots: [root, stray] })).not.toThrow();
    expect(discoverCheckouts({ roots: [root] }).map((c) => c.path)).not.toContain(stray);
  });

  it("leaves every discovered checkout's state untouched", () => {
    const before = git(linked, "status", "--porcelain");
    discoverCheckouts({ roots: [root] });
    expect(git(linked, "status", "--porcelain")).toBe(before);
  });
});
