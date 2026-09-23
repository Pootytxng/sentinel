// #515: the tree-walk tripwire (scripts/lib/tree-walk-tripwire.mjs) — its rule, where it says a path
// lives, and live proof, inside this very runner, that it is armed and fails a walker on the default
// timeout. A tripwire nobody has seen fire is a comment; the last describe watches it fire.
import { execFile, execFileSync } from "node:child_process";
import fs, { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, onTestFailed } from "vitest";
import { TREE_WALK_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";
import {
  BYTE_READ_FLOOR,
  DIR_LISTING_FLOOR,
  FILE_READ_FLOOR,
  FLEET_CHECKOUT_FLOOR,
  LISTED_PATH_FLOOR,
  createLocator,
  currentObservation,
  emptyObservation,
  enumerates,
  measures,
  parseGit,
  registeredCheckouts,
  tripwireVerdict,
  walkReason,
} from "./lib/tree-walk-tripwire.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CENSUS = Boolean(process.env.COMPY_TREE_WALK_CENSUS);
const obs = (patch) => ({ ...emptyObservation(), ...patch });
const gitCall = (sub, entries, where = "tree") => ({ sub, rest: [], where, enumerates: enumerates({ sub, rest: [] }), entries });
const checkouts = (n) => new Set(Array.from({ length: n }, (_, i) => `c:/fleet/${i}`));
const paths = (n) => new Set(Array.from({ length: n }, (_, i) => `c:/tree/${i}`));

describe("what counts as a walk", () => {
  it("reads where a git command runs and what it runs through the global options", () => {
    const g = parseGit(["-C", "a", "-C", "b", "-c", "core.quotepath=off", "--no-pager", "ls-files", "-z"], path.resolve("/r"));
    expect(g).toEqual({ dir: path.resolve("/r", "a", "b"), sub: "ls-files", rest: ["-z"] });
    expect(parseGit(["--git-dir", "x/.git", "status"], "/r").sub).toBe("status");
  });

  it("calls ls-files, grep and a RECURSIVE ls-tree enumerations, and nothing else", () => {
    expect(enumerates({ sub: "ls-files", rest: [] })).toBe(true);
    expect(enumerates({ sub: "grep", rest: ["-l", "x"] })).toBe(true);
    expect(enumerates({ sub: "ls-tree", rest: ["-rz", "HEAD"] })).toBe(true);
    expect(enumerates({ sub: "ls-tree", rest: ["--name-only", "-r", "HEAD"] })).toBe(true);
    expect(enumerates({ sub: "ls-tree", rest: ["HEAD"] })).toBe(false);
    expect(enumerates({ sub: "ls-tree", rest: ["--full-tree", "HEAD"] })).toBe(false);
    expect(enumerates({ sub: "status", rest: [] })).toBe(false);
  });

  it("names a walk at each measured floor and not one step below it", () => {
    const cases = [
      [(n) => obs({ fleetCheckouts: checkouts(n) }), FLEET_CHECKOUT_FLOOR],
      [(n) => obs({ git: [gitCall("ls-files", n)] }), LISTED_PATH_FLOOR],
      [(n) => obs({ recursivePaths: paths(n) }), LISTED_PATH_FLOOR],
      [(n) => obs({ listedDirs: paths(n) }), DIR_LISTING_FLOOR],
      [(n) => obs({ readFiles: paths(n) }), FILE_READ_FLOOR],
      [(n) => obs({ bytesRead: n }), BYTE_READ_FLOOR],
    ];
    for (const [make, floor] of cases) {
      expect(walkReason(make(floor - 1))).toBeNull();
      expect(walkReason(make(floor))).toEqual(expect.any(String));
    }
  });

  it("counts `git grep` over this tree as a walk however little it prints, since git reads every file", () => {
    expect(walkReason(obs({ git: [gitCall("grep", 0)] }))).toMatch(/git grep/);
  });

  it("does not count git that ran in another checkout toward listing THIS tree", () => {
    expect(walkReason(obs({ git: [gitCall("ls-files", 5000, "fleet")] }))).toBeNull();
  });
});

describe("the verdict", () => {
  const walker = obs({ git: [gitCall("ls-files", 2015)] });

  it("fails a walker on vitest's 15 s default and names the fix", () => {
    const v = tripwireVerdict(15_000, walker, TREE_WALK_TIMEOUT_MS);
    expect(v).toMatch(/tree-walk tripwire \(#515\)/);
    expect(v).toMatch(/TREE_WALK_TIMEOUT_MS/);
    expect(v).toMatch(/src\/test\/tree-walk-budget\.ts/);
  });

  it("fails a walker on any timeout short of the budget, not only the default", () => {
    expect(tripwireVerdict(TREE_WALK_TIMEOUT_MS - 1, walker, TREE_WALK_TIMEOUT_MS)).not.toBeNull();
  });

  it("passes a walker on the budget or more, and a non-walker on the default", () => {
    expect(tripwireVerdict(TREE_WALK_TIMEOUT_MS, walker, TREE_WALK_TIMEOUT_MS)).toBeNull();
    expect(tripwireVerdict(2 * TREE_WALK_TIMEOUT_MS, walker, TREE_WALK_TIMEOUT_MS)).toBeNull();
    expect(tripwireVerdict(15_000, obs({ readFiles: paths(3) }), TREE_WALK_TIMEOUT_MS)).toBeNull();
  });

  it("is a budget well above the 15 s default it replaces", () => {
    expect(TREE_WALK_TIMEOUT_MS).toBeGreaterThan(15_000 * 2);
  });
});

describe("where a path lives", () => {
  const base = path.resolve("/compy-locator");
  const main = path.join(base, "sentinel");
  const me = path.join(main, ".claude", "worktrees", "me");
  const sibling = path.join(main, ".claude", "worktrees", "sibling");
  const outside = path.join(base, "sentinel-codex-1");
  const tmp = path.join(base, "tmp");
  let loads = 0;
  const fleet = () => {
    loads++;
    return [main, me, sibling, outside];
  };

  it("puts this checkout in the tree, whatever the case or slash direction", () => {
    const at = createLocator(me, fleet, tmp);
    expect(at(path.join(me, "src", "x.ts"))).toBe("tree");
    expect(at(path.join(me, "SRC", "X.ts").replace(/\\/g, "/").toUpperCase())).toBe("tree");
    expect(at(me)).toBe("tree");
  });

  it("never counts node_modules or os.tmpdir(), and never loads the fleet to decide that", () => {
    loads = 0;
    const at = createLocator(me, fleet, tmp);
    expect(at(path.join(me, "node_modules", "vitest", "index.js"))).toBeNull();
    expect(at(path.join(tmp, "fixture-repo", "a.txt"))).toBeNull();
    expect(loads).toBe(0);
  });

  it("names the other checkout a path belongs to: the main one, a sibling, one outside the main folder", () => {
    const at = createLocator(me, fleet, tmp);
    expect(at(path.join(main, "src", "x.ts"))).toEqual({ fleet: main.replace(/\\/g, "/").toLowerCase() });
    expect(at(path.join(sibling, "src"))).toEqual({ fleet: sibling.replace(/\\/g, "/").toLowerCase() });
    expect(at(path.join(outside, ".git"))).toEqual({ fleet: outside.replace(/\\/g, "/").toLowerCase() });
    expect(at(path.join(base, "unrelated", "x"))).toBeNull();
  });

  it("from the main checkout, a registered worktree under .claude/worktrees is fleet, an unregistered folder is tree", () => {
    const at = createLocator(main, fleet, tmp);
    expect(at(path.join(sibling, "src"))).toEqual({ fleet: sibling.replace(/\\/g, "/").toLowerCase() });
    expect(at(path.join(main, ".claude", "worktrees", "wf_stale", "x"))).toBe("tree");
  });
});

describe("the registry it reads the fleet from", () => {
  it("is git's own: the main checkout plus every linked worktree", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tree-walk-fleet-"));
    try {
      const repo = path.join(dir, "repo");
      const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
      fs.mkdirSync(repo);
      git("init", "-q");
      writeFileSync(path.join(repo, "a.txt"), "a\n", "utf8");
      git("add", ".");
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
      git("worktree", "add", "-q", path.join(dir, "wt"));
      const norm = (p) => fs.realpathSync(p).replace(/\\/g, "/").toLowerCase();
      const want = [norm(repo), norm(path.join(dir, "wt"))].sort();
      expect(registeredCheckouts(path.join(dir, "wt"), fs).map(norm).sort()).toEqual(want);
      expect(registeredCheckouts(repo, fs).map(norm).sort()).toEqual(want);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("armed in this run", () => {
  it(
    "records a real `git ls-files` of this tree, made through a plain ESM import of child_process",
    () => {
      expect(
        currentObservation(),
        "no observation: scripts/lib/tree-walk-tripwire-setup.mjs did not run — is it still in vitest.config.ts setupFiles?",
      ).not.toBeNull();
      execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 28 });
      expect(walkReason(currentObservation())).toMatch(/listed \d+ paths of this tree/);
    },
    TREE_WALK_TIMEOUT_MS,
  );

  it("counts this tree's files once however often they are read, with their bytes, through a named fs import", () => {
    const pkg = path.join(ROOT, "package.json");
    const lib = path.join(ROOT, "scripts", "lib");
    const before = measures(currentObservation());
    readFileSync(pkg);
    readFileSync(pkg, "utf8");
    readdirSync(lib, { recursive: true });
    const after = measures(currentObservation());
    expect(after.fileReads - before.fileReads).toBe(1);
    expect(after.bytesRead - before.bytesRead).toBeGreaterThanOrEqual(2 * fs.statSync(pkg).size);
    expect(after.recursivePaths - before.recursivePaths).toBe(readdirSync(lib, { recursive: true }).length);
  });

  it("counts an async read and an async recursive listing against the test that asked", async () => {
    const lib = path.join(ROOT, "scripts", "lib");
    const before = measures(currentObservation());
    const [text, entries] = await Promise.all([
      fs.promises.readFile(path.join(ROOT, "vitest.config.ts"), "utf8"),
      fs.promises.readdir(lib, { recursive: true }),
    ]);
    const after = measures(currentObservation());
    expect(after.fileReads - before.fileReads).toBe(1);
    expect(after.bytesRead - before.bytesRead).toBe(text.length);
    expect(after.recursivePaths).toBeGreaterThanOrEqual(entries.length);
  });

  // Found by the census: hookspath-fleet-guard calls fs.realpathSync.native, which a bare wrapper lost.
  it("leaves what hangs off a wrapped function in place: realpathSync.native, promisify(execFile)", async () => {
    expect(typeof fs.realpathSync.native).toBe("function");
    expect(fs.realpathSync.native(ROOT)).toBeTruthy();
    const { stdout } = await promisify(execFile)("git", ["--version"]);
    expect(stdout).toMatch(/^git version/);
  });

  it("does not count a fixture in os.tmpdir()", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tree-walk-fixture-"));
    try {
      writeFileSync(path.join(dir, "a.txt"), "a\n", "utf8");
      const before = measures(currentObservation());
      readFileSync(path.join(dir, "a.txt"));
      readdirSync(dir, { recursive: true });
      expect(measures(currentObservation())).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The specimen below walks the tree on the 15 s default, so the tripwire must fail it. `it.fails`
// turns that failure into this file's pass, and the test after it checks the failure was the
// tripwire's own message and not some other error that `it.fails` would equally have swallowed.
// Census mode switches failures off, so the specimen would "unexpectedly pass" there: skip it.
describe.skipIf(CENSUS)("fails a walker on the default timeout, in the real runner", () => {
  let caught = "";
  it.fails("specimen: lists this tree on the default timeout (its failure is the expected outcome)", () => {
    onTestFailed(({ task }) => {
      caught = (task.result?.errors ?? []).map((e) => e.message).join("\n");
    });
    execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 28 });
  });

  it("…and the specimen failed on the tripwire's verdict, nothing else", () => {
    expect(caught).toMatch(/tree-walk tripwire \(#515\)/);
    expect(caught).toMatch(/git ls-files` listed \d+ paths/);
  });
});
