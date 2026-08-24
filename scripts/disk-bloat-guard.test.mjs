// Guard for the usage audit's build-output bloat flag (scripts/lib/disk-bloat.mjs).
//
// Three properties are worth pinning, and none of them is "does it add up integers":
//
//  1. REPORT-ONLY. The owner asked for a flag, not a cleaner. A later edit that "helpfully" cleaned a
//     20 GB tree would delete an in-flight build with no confirmation, from a Monday scheduled task
//     the owner is not watching. So the source itself is asserted to contain no delete call.
//  2. NO SUBPROCESS. Worktree roots come out of .git by hand rather than from `git worktree list`
//     because that scheduled task runs in the owner's interactive session, where spawning a console
//     program flashes a window across whatever he is doing — the same defect
//     console-window-guard.test.mjs was written for.
//  3. ALL WORKTREES, not just the checkout that runs the script. The bloat is normally sitting in a
//     worktree nobody has opened in weeks, which is exactly the one a REPO-relative scan misses.
//
// Every filesystem case is built in a temp directory, so the test says the same thing on a machine
// with no build output as on the owner's.
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  diskBloatFlags,
  FLEET_BLOAT_BYTES,
  gitCommonDir,
  IDLE_BLOAT_BYTES,
  IDLE_BLOAT_DAYS,
  measureDir,
  TARGET_BLOAT_BYTES,
  worktreeRoots,
} from "./lib/disk-bloat.mjs";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(SCRIPTS, "lib", "disk-bloat.mjs"), "utf8");

const temps = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "disk-bloat-"));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const file = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes));
};

// A main checkout with a real `.git` directory, plus `count` linked worktrees recorded the way git
// records them: `.git/worktrees/<name>/gitdir` holds the path of the linked checkout's `.git` FILE.
const fakeRepo = (count = 1) => {
  const base = scratch();
  const main = join(base, "main");
  mkdirSync(join(main, ".git", "worktrees"), { recursive: true });
  const linked = [];
  for (let i = 0; i < count; i += 1) {
    const root = join(base, `linked-${i}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, ".git"), `gitdir: ${join(main, ".git", "worktrees", `lane-${i}`)}\n`);
    mkdirSync(join(main, ".git", "worktrees", `lane-${i}`), { recursive: true });
    writeFileSync(join(main, ".git", "worktrees", `lane-${i}`, "gitdir"), `${join(root, ".git")}\n`);
    linked.push(root);
  }
  return { base, main, linked };
};

describe("report-only, by construction", () => {
  it("contains no call that could delete or rewrite what it measures", () => {
    const destructive = /\b(rmSync|rmdirSync|unlinkSync|writeFileSync|renameSync|truncateSync|rm\()/;
    expect(SOURCE).not.toMatch(destructive);
  });

  it("starts no subprocess, so the weekly task cannot flash a console window", () => {
    expect(SOURCE).not.toMatch(/child_process|execSync|execFileSync|spawnSync|\bspawn\(/);
  });

  it("is wired into the audit's flag list rather than sitting dead", () => {
    const audit = readFileSync(join(SCRIPTS, "usage-audit.mjs"), "utf8");
    expect(audit).toMatch(/import \{ diskBloatFlags \} from "\.\/lib\/disk-bloat\.mjs"/);
    expect(audit).toMatch(/flags\.push\(\.\.\.diskBloatFlags\(REPO\)\)/);
  });

  it("keeps the owner's ~20 GB threshold", () => {
    expect(TARGET_BLOAT_BYTES).toBe(20 * 1024 ** 3);
  });

  // The fleet line is DERIVED from the owner's number rather than picked, so that a later edit
  // cannot quietly retune the report by inventing a second, unrelated constant.
  it("derives the fleet line from the owner's number instead of inventing one", () => {
    expect(FLEET_BLOAT_BYTES).toBe(2 * TARGET_BLOAT_BYTES);
    expect(IDLE_BLOAT_BYTES).toBeLessThan(TARGET_BLOAT_BYTES);
    expect(IDLE_BLOAT_DAYS).toBe(14);
  });
});

describe("worktree discovery without git", () => {
  it("finds the main checkout and every linked worktree", () => {
    const { main, linked } = fakeRepo(2);
    const roots = worktreeRoots(main).map((r) => resolve(r));
    expect(roots).toContain(resolve(main));
    for (const root of linked) expect(roots).toContain(resolve(root));
  });

  it("finds the same set when it starts from a linked worktree, not the main one", () => {
    const { main, linked } = fakeRepo(2);
    const fromLinked = worktreeRoots(linked[0]).map((r) => resolve(r)).sort();
    const fromMain = worktreeRoots(main).map((r) => resolve(r)).sort();
    expect(fromLinked).toEqual(fromMain);
  });

  it("resolves a linked worktree's shared .git through its gitdir pointer", () => {
    const { main, linked } = fakeRepo(1);
    expect(resolve(gitCommonDir(linked[0]))).toBe(resolve(join(main, ".git")));
  });

  it("drops a worktree record whose folder is already gone", () => {
    const { main, linked } = fakeRepo(1);
    rmSync(linked[0], { recursive: true, force: true });
    expect(worktreeRoots(main).map((r) => resolve(r))).not.toContain(resolve(linked[0]));
  });

  it("returns just the given root for a directory that is not a checkout at all", () => {
    const loose = scratch();
    expect(gitCommonDir(loose)).toBeNull();
    expect(worktreeRoots(loose).map((r) => resolve(r))).toEqual([resolve(loose)]);
  });
});

describe("size measurement", () => {
  it("sums nested files exactly", () => {
    const dir = scratch();
    file(join(dir, "a.rlib"), 1000);
    file(join(dir, "debug", "deps", "b.rlib"), 2500);
    file(join(dir, "debug", "incremental", "c", "d.bin"), 500);
    expect(measureDir(dir)).toMatchObject({ bytes: 4000, files: 3, capped: false });
  });

  it("returns null for a checkout that has never been built", () => {
    expect(measureDir(join(scratch(), "src-tauri", "target"))).toBeNull();
  });

  it("stops at the entry cap and says the number is a floor", () => {
    const dir = scratch();
    for (let i = 0; i < 20; i += 1) file(join(dir, `f${i}.bin`), 10);
    const capped = measureDir(dir, 5);
    expect(capped.capped).toBe(true);
    expect(capped.files).toBeLessThan(20);
  });
});

describe("the flag line", () => {
  const targetOf = (root) => join(root, "src-tauri", "target");

  it("says nothing when every build tree is under the threshold", () => {
    const { main } = fakeRepo(1);
    file(join(targetOf(main), "small.rlib"), 4096);
    expect(diskBloatFlags(main, { threshold: 1024 ** 2 })).toEqual([]);
  });

  it("flags a tree over the threshold, names it, and offers a clean the owner runs himself", () => {
    const { main } = fakeRepo(1);
    file(join(targetOf(main), "big.rlib"), 4096);
    const [flag, ...rest] = diskBloatFlags(main, { threshold: 1024 });
    expect(rest).toEqual([]);
    expect(flag).toContain("main/src-tauri/target");
    expect(flag).toContain("report only, nothing was deleted");
    expect(flag).toContain("cargo clean --manifest-path");
  });

  it("flags a linked worktree the running checkout knows nothing about", () => {
    const { main, linked } = fakeRepo(1);
    file(join(targetOf(linked[0]), "big.rlib"), 4096);
    const flags = diskBloatFlags(main, { threshold: 1024 });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("linked-0/src-tauri/target");
  });

  it("reports the biggest offender first", () => {
    const { main, linked } = fakeRepo(2);
    file(join(targetOf(linked[0]), "medium.rlib"), 4096);
    file(join(targetOf(linked[1]), "huge.rlib"), 40960);
    const flags = diskBloatFlags(main, { threshold: 1024 });
    expect(flags).toHaveLength(2);
    expect(flags[0]).toContain("linked-1");
    expect(flags[1]).toContain("linked-0");
  });

  it("marks a capped measurement as a floor rather than an exact size", () => {
    const { main } = fakeRepo(1);
    for (let i = 0; i < 10; i += 1) file(join(targetOf(main), `f${i}.bin`), 4096);
    const [flag] = diskBloatFlags(main, { threshold: 1024, cap: 3 });
    expect(flag).toContain("at least");
    expect(flag).toContain("measurement capped mid-walk");
  });
});

// The class the original flag could not see. Measured 2026-08-24: six trees, 59.08 GB, NONE of them
// over the 20 GB per-tree line — the flag was green while four idle trees held 35.9 GB between them.
// Age is driven by moving `now` forward rather than by rewriting file mtimes, so these cases say the
// same thing on any filesystem and never depend on a clock the test does not own.
describe("idle build output — under the line, and nobody is using it", () => {
  const targetOf = (root) => join(root, "src-tauri", "target");
  const DAY = 24 * 60 * 60 * 1000;
  const laterBy = (days) => Date.now() + days * DAY;

  it("names a tree that is under the threshold but has gone untouched", () => {
    const { main, linked } = fakeRepo(1);
    file(join(targetOf(linked[0]), "cold.rlib"), 8192);
    const flags = diskBloatFlags(main, { threshold: 1024 ** 4, idleThreshold: 1024, now: laterBy(30) });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("linked-0/src-tauri/target");
    // 29 or 30: the file's mtime is written a hair after `now` is read, and some filesystems round
    // it up. The age is a report line, not a gate, so a one-day floor is the honest assertion.
    expect(flags[0]).toMatch(/has not been written to in (29|30) days/);
    expect(flags[0]).toContain("nothing was deleted");
    expect(flags[0]).toContain("cargo clean --manifest-path");
  });

  it("stays quiet while the tree is still being built in", () => {
    const { main } = fakeRepo(1);
    file(join(targetOf(main), "warm.rlib"), 8192);
    expect(diskBloatFlags(main, { threshold: 1024 ** 4, idleThreshold: 1024, now: laterBy(IDLE_BLOAT_DAYS - 1) })).toEqual([]);
  });

  it("does not report the same tree twice when it is oversized AND idle", () => {
    const { main } = fakeRepo(1);
    file(join(targetOf(main), "huge-and-cold.rlib"), 8192);
    const flags = diskBloatFlags(main, { threshold: 1024, idleThreshold: 512, now: laterBy(30) });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("of Rust build output (>");
  });

  it("leaves a tree too small to be worth its rebuild alone", () => {
    const { main } = fakeRepo(1);
    file(join(targetOf(main), "tiny.rlib"), 512);
    expect(diskBloatFlags(main, { threshold: 1024 ** 4, idleThreshold: 4096, now: laterBy(90) })).toEqual([]);
  });

  it("treats a target holding no readable file as unknown age, not as old", () => {
    const { main } = fakeRepo(1);
    mkdirSync(join(targetOf(main), "debug", "incremental"), { recursive: true });
    expect(diskBloatFlags(main, { threshold: 1024 ** 4, idleThreshold: 0, now: laterBy(90) })).toEqual([]);
  });
});

// The number no per-tree rule can produce. This is the line that would have fired on 2026-08-24.
describe("the fleet total", () => {
  const targetOf = (root) => join(root, "src-tauri", "target");

  it("reports the total across worktrees and names the biggest, without flagging any one of them", () => {
    const { main, linked } = fakeRepo(2);
    file(join(targetOf(linked[0]), "a.rlib"), 4096);
    file(join(targetOf(linked[1]), "b.rlib"), 8192);
    const flags = diskBloatFlags(main, { threshold: 1024 ** 4, fleetThreshold: 8192 });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("across 2 worktrees");
    expect(flags[0]).toContain("linked-1");
    expect(flags[0]).toContain("nothing was deleted");
  });

  it("says nothing when the machine's whole build output is within bounds", () => {
    const { main, linked } = fakeRepo(2);
    file(join(targetOf(linked[0]), "a.rlib"), 4096);
    file(join(targetOf(linked[1]), "b.rlib"), 4096);
    expect(diskBloatFlags(main, { threshold: 1024 ** 4, fleetThreshold: 1024 ** 3 })).toEqual([]);
  });

  it("comes last, after the per-tree lines it summarises", () => {
    const { main, linked } = fakeRepo(1);
    file(join(targetOf(linked[0]), "big.rlib"), 8192);
    const flags = diskBloatFlags(main, { threshold: 1024, fleetThreshold: 4096 });
    expect(flags).toHaveLength(2);
    expect(flags[0]).toContain("linked-0/src-tauri/target");
    expect(flags[1]).toContain("across 1 worktrees");
  });
});
