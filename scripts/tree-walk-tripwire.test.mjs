// #515: the tree-walk tripwire (scripts/lib/tree-walk-tripwire.mjs) — its rule, where it says a path
// lives, and live proof, inside this very runner, that it is armed and fails a walker on the default
// timeout. A tripwire nobody has seen fire is a comment; the last describe watches it fire.
import { execFile, execFileSync, execSync } from "node:child_process";
import fs, { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import { GIT_SPAWN_TIMEOUT_MS, TREE_WALK_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";
import {
  BYTE_READ_FLOOR,
  DIR_LISTING_FLOOR,
  FILE_READ_FLOOR,
  FLEET_CHECKOUT_FLOOR,
  GIT_SPAWN_FLOOR,
  LISTED_PATH_FLOOR,
  createLocator,
  currentObservation,
  emptyObservation,
  enumerates,
  gitInvocations,
  gitSpawnsOf,
  gitSpawnVerdict,
  hookGitVerdict,
  hookRecords,
  measures,
  overlapVerdict,
  parseGit,
  registeredCheckouts,
  shellDialect,
  tripwireVerdict,
  walkReason,
  watchHooks,
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

describe("the git-spawn verdict (#563)", () => {
  const spawns = (n, hookGitSpawns = 0) => obs({ gitSpawns: n + hookGitSpawns, hookGitSpawns });
  const hook = (patch) => ({ kind: "beforeAll", suite: "a fixture repo", timeout: 15_000, gitSpawns: GIT_SPAWN_FLOOR, ...patch });

  it("fails a test at the floor on the 15 s default, not one spawn below it, and names the fix", () => {
    expect(gitSpawnVerdict(15_000, spawns(GIT_SPAWN_FLOOR - 1), GIT_SPAWN_TIMEOUT_MS)).toBeNull();
    const v = gitSpawnVerdict(15_000, spawns(GIT_SPAWN_FLOOR), GIT_SPAWN_TIMEOUT_MS);
    expect(v).toMatch(/git-spawn tripwire \(#563\)/);
    expect(v).toMatch(/\{ timeout: GIT_SPAWN_TIMEOUT_MS \}/);
    expect(v).toMatch(/src\/test\/tree-walk-budget\.ts/);
  });

  it("fails on any timeout short of the budget and passes on the budget or more", () => {
    expect(gitSpawnVerdict(GIT_SPAWN_TIMEOUT_MS - 1, spawns(40), GIT_SPAWN_TIMEOUT_MS)).not.toBeNull();
    expect(gitSpawnVerdict(GIT_SPAWN_TIMEOUT_MS, spawns(40), GIT_SPAWN_TIMEOUT_MS)).toBeNull();
    expect(gitSpawnVerdict(TREE_WALK_TIMEOUT_MS, spawns(40), GIT_SPAWN_TIMEOUT_MS)).toBeNull();
  });

  it("does not charge a test for the git its beforeEach/afterEach started: those run on their own hook timeout", () => {
    expect(gitSpawnVerdict(15_000, spawns(1, 20), GIT_SPAWN_TIMEOUT_MS)).toBeNull();
    expect(gitSpawnVerdict(15_000, spawns(GIT_SPAWN_FLOOR, 20), GIT_SPAWN_TIMEOUT_MS)).not.toBeNull();
  });

  it("fails a before-hook at the floor on its default hook timeout, naming the second argument it needs", () => {
    expect(hookGitVerdict(hook({ gitSpawns: GIT_SPAWN_FLOOR - 1 }), GIT_SPAWN_TIMEOUT_MS)).toBeNull();
    const v = hookGitVerdict(hook({ suite: "a fixture repo" }), GIT_SPAWN_TIMEOUT_MS);
    expect(v).toMatch(/git-spawn tripwire \(#563\): the beforeAll hook of "a fixture repo"/);
    expect(v).toMatch(/beforeAll\(fn, GIT_SPAWN_TIMEOUT_MS\)/);
    expect(hookGitVerdict(hook({ kind: "beforeEach" }), GIT_SPAWN_TIMEOUT_MS)).toMatch(/beforeEach\(fn, GIT_SPAWN_TIMEOUT_MS\)/);
    expect(hookGitVerdict(hook({ timeout: GIT_SPAWN_TIMEOUT_MS }), GIT_SPAWN_TIMEOUT_MS)).toBeNull();
  });

  it("fails an after-hook at the floor whatever it was given, since vitest does not expose its timeout", () => {
    expect(hookGitVerdict(hook({ kind: "afterAll", timeout: undefined }), GIT_SPAWN_TIMEOUT_MS)).toMatch(/does not expose an afterAll hook's timeout/);
    expect(hookGitVerdict(hook({ kind: "afterAll", timeout: undefined, gitSpawns: GIT_SPAWN_FLOOR - 1 }), GIT_SPAWN_TIMEOUT_MS)).toBeNull();
  });

  it("fails a cleanup a before-hook returns on the timeout it takes from that hook, naming the hook's second argument", () => {
    const v = hookGitVerdict(hook({ kind: "beforeEach", cleanup: true }), GIT_SPAWN_TIMEOUT_MS);
    expect(v).toContain(`the cleanup returned by the beforeEach hook of "a fixture repo" starts ${GIT_SPAWN_FLOOR} git processes`);
    expect(v).toMatch(/beforeEach\(fn, GIT_SPAWN_TIMEOUT_MS\)/);
    expect(hookGitVerdict(hook({ cleanup: true, timeout: GIT_SPAWN_TIMEOUT_MS }), GIT_SPAWN_TIMEOUT_MS)).toBeNull();
    expect(hookGitVerdict(hook({ cleanup: true, gitSpawns: GIT_SPAWN_FLOOR - 1 }), GIT_SPAWN_TIMEOUT_MS)).toBeNull();
  });

  it("fails tests or hooks that ran at the same time whatever they started, since neither can be charged", () => {
    expect(overlapVerdict("tests")).toMatch(/tests ran at the same time in one worker \(test\.concurrent/);
    expect(overlapVerdict("hooks")).toMatch(/hooks ran at the same time in one worker \(sequence\.hooks "parallel"/);
    expect(hookGitVerdict(hook({ gitSpawns: 0, overlap: true, timeout: GIT_SPAWN_TIMEOUT_MS }), GIT_SPAWN_TIMEOUT_MS)).toBe(overlapVerdict("hooks"));
  });

  it("is a budget well above the 15 s default and below the whole-tree one", () => {
    expect(GIT_SPAWN_TIMEOUT_MS).toBeGreaterThan(15_000 * 2);
    expect(GIT_SPAWN_TIMEOUT_MS).toBeLessThan(TREE_WALK_TIMEOUT_MS);
  });
});

describe("what counts as a git process (#563)", () => {
  it("counts git, and every git a shell runs: cmd /c, PowerShell -Command, sh -c", () => {
    expect(gitSpawnsOf(["git", "status"])).toBe(1);
    expect(gitSpawnsOf(["C:\\Program Files\\Git\\cmd\\git.exe", "status"])).toBe(1);
    expect(gitSpawnsOf(["env", "GIT_DIR=x", "git", "status"])).toBe(1);
    expect(gitSpawnsOf(["cmd", "/d", "/s", "/c", "git init && git add . && git commit -m x"])).toBe(3);
    expect(gitSpawnsOf(["powershell", "-NoProfile", "-Command", "git status; git log -1"])).toBe(2);
    expect(gitSpawnsOf(["pwsh", "-c", "& 'C:\\Program Files\\Git\\cmd\\git.exe' status"])).toBe(1);
    expect(gitSpawnsOf(["bash", "-lc", "cd x && git init && GIT_AUTHOR_NAME=a git commit -m 'a && b'"])).toBe(2);
  });

  it("reads a script's quotes: git named inside a quoted argument is not a command", () => {
    expect(gitInvocations('git commit -m "fix git; git config"')).toBe(1);
    expect(gitInvocations('cmd /c "git a && git b"')).toBe(2);
    expect(gitInvocations("x=$(git rev-parse HEAD) && git log -1 $x")).toBe(2);
    expect(gitInvocations("echo git && npm run build")).toBe(0);
  });

  it("counts git after the keywords that start a command, and not the same words as arguments", () => {
    expect(gitInvocations("if git diff --quiet; then git commit -m x; fi")).toBe(2);
    expect(gitInvocations("if x; then y; elif git status; then z; fi")).toBe(1);
    expect(gitInvocations("while ! git pull; do sleep 1; done")).toBe(1);
    expect(gitInvocations("until git fetch; do sleep 1; done")).toBe(1);
    expect(gitInvocations("echo if git status")).toBe(0);
    expect(gitInvocations("echo ! git until git")).toBe(0);
  });

  it("counts the git a PowerShell assignment runs, and not git named in the value assigned", () => {
    expect(gitSpawnsOf(["pwsh", "-Command", "$out = git status; $head = git rev-parse HEAD"])).toBe(2);
    expect(gitSpawnsOf(["powershell", "-Command", "$env:GIT_DIR = 'x'; $n = git log -1"])).toBe(1);
    expect(gitSpawnsOf(["pwsh", "-Command", "$out=git status; $a =git log -1; $b= git diff"])).toBe(3);
    expect(gitSpawnsOf(["pwsh", "-Command", "$all += git log -1; $all+=git status; $x ??= git rev-parse HEAD"])).toBe(3);
    expect(gitSpawnsOf(["pwsh", "-Command", '$out = "git status"'])).toBe(0);
    expect(gitSpawnsOf(["pwsh", "-Command", '$out="git status"; $env:X="1"'])).toBe(0);
    expect(gitSpawnsOf(["pwsh", "-Command", "Write-Output $out = git"])).toBe(0);
    expect(gitSpawnsOf(["pwsh", "-Command", "Write-Output $out=git status"])).toBe(0);
    // Only PowerShell assigns this way: sh expands $out, cmd runs the word as a program, and neither runs git.
    expect(gitSpawnsOf(["sh", "-c", "$out=git status; $all += git log -1"])).toBe(0);
    expect(gitSpawnsOf(["cmd", "/c", "$out=git status & $all += git log -1"])).toBe(0);
    expect(gitSpawnsOf(["$out=git", "status"])).toBe(0);
  });

  // Each shell reads only its own words in front of a command. Every rule runs through sh -c,
  // pwsh -Command, cmd /c and a program started with no shell (its words as the argv), and starts git
  // only where the rule belongs. A specimen is the word straight in front of git, as the scanner reads a
  // command position; the scripts each word stands in are pinned above. Measured 2026-09-27: cmd ran
  // git after @, do and else in any case, and PowerShell after none of the sh words. env is a program,
  // not a shell word, so it counts in all four: cmd /c "env X=1 git --version" ran git under Git
  // Bash's PATH, where the push gate runs.
  const READERS = {
    sh: (script) => ["sh", "-c", script],
    powershell: (script) => ["pwsh", "-Command", script],
    cmd: (script) => ["cmd", "/c", script],
    "no shell": (script) => script.split(" "),
  };
  it.each([
    ["VAR=value", "OUT=x git status", ["sh"]],
    ...["exec", "command", "time", "then", "if", "elif", "while", "until", "!"].map((word) => [word, `${word} git status`, ["sh"]]),
    ["do", "do git status", ["sh", "cmd"]],
    ["else", "else git status", ["sh", "cmd"]],
    ["DO, in a case only cmd reads", "DO git status", ["cmd"]],
    ["@", "@git status", ["cmd"]],
    ["@ alone", "@ git status", ["cmd"]],
    ["a PowerShell assignment", "$out = git status", ["powershell"]],
    ["env, a program", "env GIT_DIR=x git status", Object.keys(READERS)],
  ])("reads %s in front of a command only where it belongs: %s", (_rule, specimen, readers) => {
    const counts = Object.fromEntries(Object.entries(READERS).map(([reader, argv]) => [reader, gitSpawnsOf(argv(specimen))]));
    expect(counts).toEqual(Object.fromEntries(Object.keys(READERS).map((reader) => [reader, readers.includes(reader) ? 1 : 0])));
  });

  it("counts the git a double-quoted $(...) runs in sh-family shells and PowerShell; single quotes and cmd are literal", () => {
    expect(gitSpawnsOf(["sh", "-c", 'echo "$(git status)"'])).toBe(1);
    expect(gitInvocations(`sh -c 'echo "head: $(git rev-parse "HEAD") ok"; git log -1'`, "cmd")).toBe(2);
    expect(gitSpawnsOf(["pwsh", "-Command", 'Write-Output "$(git status)"'])).toBe(1);
    expect(gitSpawnsOf(["sh", "-c", "echo '$(git status)'"])).toBe(0);
    expect(gitSpawnsOf(["pwsh", "-Command", "Write-Output '$(git status)'"])).toBe(0);
    expect(gitSpawnsOf(["cmd", "/c", 'echo "$(git status)"'])).toBe(0);
  });

  it("counts the git a double-quoted backtick pair runs in sh-family shells only", () => {
    expect(gitSpawnsOf(["bash", "-c", 'echo "`git status`"'])).toBe(1);
    expect(gitSpawnsOf(["bash", "-c", "echo '`git status`'"])).toBe(0);
    expect(gitSpawnsOf(["powershell", "-Command", 'Write-Output "`git status`"'])).toBe(0);
  });

  it("reads a shell string by the shell it runs in: the one `shell` names, else cmd on Windows and sh elsewhere", () => {
    expect(shellDialect(undefined, "win32")).toBe("cmd");
    expect(shellDialect(true, "linux")).toBe("sh");
    expect(shellDialect("/bin/bash", "win32")).toBe("sh");
    expect(shellDialect("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "linux")).toBe("powershell");
    expect(shellDialect("C:\\Windows\\System32\\cmd.exe", "linux")).toBe("cmd");
    expect(gitInvocations('echo "$(git status)"', shellDialect(undefined, "linux"))).toBe(1);
    expect(gitInvocations('echo "$(git status)"', shellDialect(undefined, "win32"))).toBe(0);
  });

  it("pins what it cannot see: git a child program starts, and a loop's git, counted once", () => {
    expect(gitSpawnsOf(["node", "cli.mjs"])).toBe(0);
    expect(gitSpawnsOf(["npm", "run", "build"])).toBe(0);
    expect(gitSpawnsOf(["powershell", "-File", "x.ps1"])).toBe(0);
    expect(gitSpawnsOf(["sh", "-c", 'eval "git status"'])).toBe(0);
    expect(gitInvocations("for i in 1 2 3; do git commit; done")).toBe(1);
    expect(gitInvocations("f() { git status; }; f; f")).toBe(1);
  });

  // The documented limits, each beside the ordinary form it is mistaken for, so a change to either shows.
  it("pins a stated limit: an escaped quote hides the git after it; a plain one does not", () => {
    expect(gitSpawnsOf(["sh", "-c", 'echo "a\\"b"; git status'])).toBe(0);
    expect(gitSpawnsOf(["pwsh", "-Command", 'Write-Output "a`"b"; git status'])).toBe(0);
    expect(gitSpawnsOf(["sh", "-c", 'echo "a b"; git status'])).toBe(1);
    expect(gitSpawnsOf(["pwsh", "-Command", 'Write-Output "a b"; git status'])).toBe(1);
  });

  it("pins a stated limit: a lone apostrophe in cmd hides the git after it; a paired one quotes the script cmd runs", () => {
    expect(gitSpawnsOf(["cmd", "/c", "echo it's done & git status"])).toBe(0);
    expect(gitSpawnsOf(["cmd", "/c", "echo done & git status"])).toBe(1);
    expect(gitSpawnsOf(["cmd", "/c", "sh -c 'git init; git status'"])).toBe(2);
  });

  it("pins a stated limit: a program named by a substitution is not seen; one named directly is", () => {
    expect(gitSpawnsOf(["sh", "-c", '"$(command -v git)" status'])).toBe(0);
    expect(gitSpawnsOf(["sh", "-c", 'command -v git && git status'])).toBe(1);
  });

  it("pins a stated limit: the command of a cmd for /f is not seen; the command after do is", () => {
    expect(gitSpawnsOf(["cmd", "/c", "for /f %i in ('git rev-parse HEAD') do echo %i"])).toBe(0);
    expect(gitSpawnsOf(["cmd", "/c", "for %i in (a b) do git log %i"])).toBe(1);
  });

  it("pins a stated limit: an escaped separator over-counts, loud; a quoted one does not count", () => {
    expect(gitSpawnsOf(["cmd", "/c", "echo ^& git status"])).toBe(1);
    expect(gitSpawnsOf(["sh", "-c", "echo \\; git status"])).toBe(1);
    expect(gitSpawnsOf(["cmd", "/c", 'echo "&" git status'])).toBe(0);
    expect(gitSpawnsOf(["sh", "-c", "echo ';' git status"])).toBe(0);
  });

  it("pins a stated limit: another shell's separator over-counts, loud; a quoted one does not count", () => {
    expect(gitSpawnsOf(["cmd", "/c", "echo a; git status"])).toBe(1);
    expect(gitSpawnsOf(["cmd", "/c", 'echo "a; git status"'])).toBe(0);
  });

  it("pins a stated limit: a comment or here-document is read as commands, loud; its plain words are not", () => {
    expect(gitSpawnsOf(["sh", "-c", "echo x # ; git status"])).toBe(1);
    expect(gitSpawnsOf(["sh", "-c", "cat <<EOF\ngit status\nEOF"])).toBe(1);
    expect(gitSpawnsOf(["sh", "-c", "echo x # git status"])).toBe(0);
    expect(gitSpawnsOf(["sh", "-c", "cat <<EOF\nsee git status\nEOF"])).toBe(0);
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

  it("counts every git a shell command runs, and none a child node process runs (#563)", () => {
    const before = currentObservation().gitSpawns;
    execSync("git --version && git --version", { cwd: os.tmpdir() });
    expect(currentObservation().gitSpawns - before).toBe(2);
    const [shell, args] =
      process.platform === "win32" ? ["cmd", ["/d", "/s", "/c", "git --version && git --version"]] : ["sh", ["-c", "git --version && git --version"]];
    execFileSync(shell, args, { cwd: os.tmpdir() });
    expect(currentObservation().gitSpawns - before).toBe(4);
    // The stated limit: git a child node process starts is in that process, not this one.
    execFileSync(process.execPath, ["-e", "require('node:child_process').execFileSync('git', ['--version'])"], { cwd: os.tmpdir() });
    expect(currentObservation().gitSpawns - before).toBe(4);
  });

  it("judges a beforeAll's cleanup where it runs, on the timeout it takes from that hook (#563)", { timeout: GIT_SPAWN_TIMEOUT_MS }, async () => {
    const make = (timeout) => {
      const h = () => () => startGit(GIT_SPAWN_FLOOR);
      h[Symbol.for("VITEST_CLEANUP_TIMEOUT")] = timeout;
      return h;
    };
    const hooks = { beforeAll: [make(15_000), make(GIT_SPAWN_TIMEOUT_MS)], beforeEach: [], afterEach: [], afterAll: [] };
    const judged = [];
    const judge = (h) => (judged.push(h), hookGitVerdict(h, GIT_SPAWN_TIMEOUT_MS));
    expect(watchHooks({ tasks: [] }, () => hooks, judge)).toBe(2);
    const onDefault = await hooks.beforeAll[0]();
    await expect(onDefault()).rejects.toThrow(`the cleanup returned by the beforeAll hook of "<file>" starts ${GIT_SPAWN_FLOOR} git processes`);
    const onBudget = await hooks.beforeAll[1]();
    await expect(onBudget()).resolves.toBeUndefined();
    expect(judged).toMatchObject([
      { kind: "beforeAll", cleanup: true, timeout: 15_000, gitSpawns: GIT_SPAWN_FLOOR },
      { kind: "beforeAll", cleanup: true, timeout: GIT_SPAWN_TIMEOUT_MS, gitSpawns: GIT_SPAWN_FLOOR },
    ]);
  });

  it("records hooks that ran at the same time as overlapping, whatever they started, and hooks one at a time as nothing (#563)", async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
    const hooks = { beforeAll: [], beforeEach: [pause, pause], afterEach: [], afterAll: [] };
    expect(watchHooks({ tasks: [] }, () => hooks, () => null)).toBe(2);
    const before = hookRecords().length;
    await Promise.all(hooks.beforeEach.map((h) => h())); // what sequence.hooks "parallel" does
    const overlapped = hookRecords().splice(before);
    expect(overlapped).toMatchObject([
      { kind: "beforeEach", suite: "<file>", gitSpawns: 0, overlap: true },
      { kind: "beforeEach", suite: "<file>", gitSpawns: 0, overlap: true },
    ]);
    for (const h of hooks.beforeEach) await h();
    expect(hookRecords()).toHaveLength(before);
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

// #563: the same live proof for git processes. Each specimen starts GIT_SPAWN_FLOOR of them in
// os.tmpdir(), the way a fixture-repository test does, so none of it is a walk of this tree.
const startGit = (n) => {
  for (let i = 0; i < n; i++) execFileSync("git", ["--version"], { cwd: os.tmpdir() });
};

describe.skipIf(CENSUS)("fails a test that starts many git processes on the default timeout, in the real runner (#563)", () => {
  let caught = "";
  it.fails("specimen: starts the floor's worth of git processes on the default timeout (its failure is the expected outcome)", () => {
    onTestFailed(({ task }) => {
      caught = (task.result?.errors ?? []).map((e) => e.message).join("\n");
    });
    startGit(GIT_SPAWN_FLOOR);
  });

  it("…and the specimen failed on the git-spawn verdict, nothing else", () => {
    expect(caught).toContain(`git-spawn tripwire (#563): this test starts ${GIT_SPAWN_FLOOR} git processes`);
  });

  it("the same work on GIT_SPAWN_TIMEOUT_MS passes", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    startGit(GIT_SPAWN_FLOOR);
    expect(currentObservation().gitSpawns).toBe(GIT_SPAWN_FLOOR);
  });
});

// A hook that crosses the floor fails the FILE, in the setup's afterAll, so these specimens cannot
// use it.fails. Instead the test after them finds each specimen's record, checks it, and claims it
// from the live list, which is what keeps this file's afterAll from failing on them.
describe.skipIf(CENSUS)("fails a hook that starts many git processes on the default hook timeout, in the real runner (#563)", () => {
  describe("specimen beforeAll on the default hook timeout", () => {
    beforeAll(() => startGit(GIT_SPAWN_FLOOR));
    it("runs", () => {});
  });

  describe("specimen beforeEach on the default hook timeout", () => {
    beforeEach(() => startGit(GIT_SPAWN_FLOOR));
    it("is not charged for its beforeEach's git", () => {
      const o = currentObservation();
      expect(o.hookGitSpawns).toBe(GIT_SPAWN_FLOOR);
      expect(gitSpawnVerdict(15_000, o, GIT_SPAWN_TIMEOUT_MS)).toBeNull();
    });
  });

  describe("specimen beforeAll on the budget", () => {
    beforeAll(() => startGit(GIT_SPAWN_FLOOR), GIT_SPAWN_TIMEOUT_MS);
    it("runs", () => {});
  });

  it("…and each hook was recorded against itself, failing on the default and passing on the budget", () => {
    const claim = (suite) => {
      const i = hookRecords().findIndex((h) => h.suite.endsWith(suite));
      expect(i, `no record for "${suite}": did the setup file's beforeAll wrap this file's hooks?`).toBeGreaterThanOrEqual(0);
      return hookRecords().splice(i, 1)[0];
    };
    const all = claim("specimen beforeAll on the default hook timeout");
    expect(all).toMatchObject({ kind: "beforeAll", gitSpawns: GIT_SPAWN_FLOOR });
    expect(hookGitVerdict(all, GIT_SPAWN_TIMEOUT_MS)).toMatch(/beforeAll\(fn, GIT_SPAWN_TIMEOUT_MS\)/);
    const each = claim("specimen beforeEach on the default hook timeout");
    expect(each).toMatchObject({ kind: "beforeEach", gitSpawns: GIT_SPAWN_FLOOR });
    expect(hookGitVerdict(each, GIT_SPAWN_TIMEOUT_MS)).toMatch(/beforeEach\(fn, GIT_SPAWN_TIMEOUT_MS\)/);
    const budgeted = claim("specimen beforeAll on the budget");
    expect(budgeted).toMatchObject({ kind: "beforeAll", timeout: GIT_SPAWN_TIMEOUT_MS, gitSpawns: GIT_SPAWN_FLOOR });
    expect(hookGitVerdict(budgeted, GIT_SPAWN_TIMEOUT_MS)).toBeNull();
  });
});

// A cleanup a beforeEach returns runs after every afterEach, the setup file's included, so the
// setup cannot judge it there: the wrapper judges it when it runs, and that fails the test.
describe.skipIf(CENSUS)("fails a hook's cleanup that starts many git processes, in the real runner (#563)", () => {
  let caught = "";
  let armed = true;
  beforeEach(() => {
    if (!armed) return undefined;
    armed = false;
    return () => startGit(GIT_SPAWN_FLOOR);
  });

  it.fails("specimen: its beforeEach returns a cleanup that starts the floor's worth of git processes (its failure is the expected outcome)", () => {
    onTestFailed(({ task }) => {
      caught = (task.result?.errors ?? []).map((e) => e.message).join("\n");
    });
  });

  it("…and the specimen failed on the cleanup's verdict, nothing else", () => {
    expect(caught).toContain(`the cleanup returned by the beforeEach hook of "`);
    expect(caught).toMatch(/beforeEach\(fn, GIT_SPAWN_TIMEOUT_MS\)/);
  });
});

// Two tests at once in one worker: every git process and read lands in one shared count, so neither
// can be charged. Both must fail, naming why, and the hooks that ran beside each other are recorded
// as overlapping; the test after them claims those records so this file's afterAll does not fail.
describe.skipIf(CENSUS)("fails tests and hooks that run at the same time in one worker, in the real runner (#563)", () => {
  const caught = [];
  describe.concurrent("specimen: two tests at once", () => {
    beforeEach(() => new Promise((resolve) => setTimeout(resolve, 20)));
    for (const n of [1, 2]) {
      it.fails(`specimen ${n}: runs beside the other (its failure is the expected outcome)`, async ({ onTestFailed: failed }) => {
        failed(({ task }) => {
          caught.push((task.result?.errors ?? []).map((e) => e.message).join("\n"));
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
  });

  it("…and both failed on the overlap verdict, and the hooks that overlapped were recorded as such", () => {
    expect(caught).toHaveLength(2);
    for (const c of caught) expect(c).toContain(overlapVerdict("tests"));
    const overlapped = [];
    for (let i = hookRecords().length - 1; i >= 0; i--) if (hookRecords()[i].overlap) overlapped.push(hookRecords().splice(i, 1)[0]);
    expect(overlapped.some((h) => h.suite.endsWith("specimen: two tests at once"))).toBe(true);
    for (const h of overlapped) expect(hookGitVerdict(h, GIT_SPAWN_TIMEOUT_MS)).toBe(overlapVerdict("hooks"));
  });
});
