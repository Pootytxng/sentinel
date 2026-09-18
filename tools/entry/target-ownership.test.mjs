// Guard for the zone resolver (#278) — spec
// docs/superpowers/specs/2026-08-31-target-ownership-across-tools.md §3.
//
// The claim this file has to earn is "a sibling worktree is not outside protection". That cannot be
// proved against mocks, because the thing being resolved IS git's own notion of which checkouts
// share a repository. So the fixtures are real: `git init`, a real `git worktree add`, a real second
// clone sharing an origin, all under the OS temp dir. Nothing here touches this repository, this
// machine's `~/.claude`, or any live checkout — the home directory is a fixture too.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decide } from "../../.claude/hooks/project-write-assert.mjs";
import { decideShell } from "../../.claude/hooks/shell-ownership-assert.mjs";
import {
  ZONES,
  checkoutRootOf,
  fromPosixDrive,
  isWithin,
  nearestExistingAncestor,
  resolveAbsolute,
  sameRepository,
  toComparable,
  zoneOf,
} from "../../.claude/hooks/target-ownership.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

let base = null;
let MAIN = null;
let LANE = null;
let OTHER = null;
let CLONE = null;
let LOOSE = null;
let HOME = null;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "compy-zones-"));

  MAIN = join(base, "main");
  mkdirSync(join(MAIN, "src"), { recursive: true });
  git(MAIN, "init", "-q", "-b", "main");
  git(MAIN, "config", "user.email", "fixture@example.invalid");
  git(MAIN, "config", "user.name", "fixture");
  git(MAIN, "remote", "add", "origin", "https://example.invalid/pootytxng/fixture.git");
  writeFileSync(join(MAIN, "src", "App.css"), "a{}\n");
  git(MAIN, "add", "-A");
  git(MAIN, "commit", "-qm", "seed");

  LANE = join(base, "lane");
  git(MAIN, "worktree", "add", "-q", "-b", "lane", LANE);

  OTHER = join(base, "other");
  mkdirSync(OTHER, { recursive: true });
  git(OTHER, "init", "-q", "-b", "main");

  CLONE = join(base, "clone");
  git(base, "clone", "-q", MAIN, CLONE);
  git(CLONE, "remote", "set-url", "origin", "https://example.invalid/pootytxng/fixture.git");

  LOOSE = join(base, "loose");
  mkdirSync(LOOSE, { recursive: true });
  writeFileSync(join(LOOSE, "note.txt"), "x");

  HOME = join(base, "home");
  mkdirSync(join(HOME, ".claude"), { recursive: true });
  mkdirSync(join(HOME, ".codex"), { recursive: true });
  writeFileSync(join(HOME, ".claude", "settings.json"), "{}");
});

afterAll(() => {
  if (base) {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows must not fail the suite */
    }
  }
});

const zone = (target, { root = MAIN, cwd = MAIN } = {}) => zoneOf({ target, sessionRoot: root, cwd, deps: { home: HOME } });

describe("the zone of a real path in a real repository", () => {
  it("puts the session's own files in its own claim", () => {
    expect(zone(join(MAIN, "src", "App.css")).zone).toBe(ZONES.OWN);
    expect(zone("src/App.css").zone).toBe(ZONES.OWN);
  });

  it("calls a SIBLING WORKTREE of the same repository what it is — the hole this closes", () => {
    const z = zone(join(LANE, "src", "App.css"));
    expect(z.zone).toBe(ZONES.SIBLING);
    expect(toComparable(z.owner)).toBe(toComparable(LANE));
  });

  it("sees a separate CLONE that shares an origin, which `git worktree list` never reports", () => {
    expect(zone(join(CLONE, "src", "App.css")).zone).toBe(ZONES.SIBLING);
  });

  it("leaves an unrelated repository and ordinary folders alone", () => {
    expect(zone(join(OTHER, "readme.md")).zone).toBe(ZONES.UNPROTECTED);
    expect(zone(join(LOOSE, "note.txt")).zone).toBe(ZONES.UNPROTECTED);
    expect(zone(join(tmpdir(), "scratch.txt")).zone).toBe(ZONES.UNPROTECTED);
  });

  it("protects the owner's global configuration, which sits outside every repository guard", () => {
    expect(zone(join(HOME, ".claude", "settings.json")).zone).toBe(ZONES.GLOBAL);
    expect(zone(join(HOME, ".codex", "config.toml")).zone).toBe(ZONES.GLOBAL);
  });

  // The agent's own scratch is not the owner's authority. Measured 2026-09-18: 92 of ~400 prompts
  // in three weeks were a session asking permission to write its OWN memory file. Named subtrees
  // only — the default for anything under `~/.claude` stays GLOBAL, so a directory added later is
  // protected until someone lists it on purpose.
  it("does NOT treat the agent's own scratch under ~/.claude as the owner's configuration", () => {
    expect(zone(join(HOME, ".claude", "projects", "C--Users-Kuya-code-sentinel", "memory", "MEMORY.md")).zone).toBe(ZONES.UNPROTECTED);
    expect(zone(join(HOME, ".claude", "todos", "list.json")).zone).toBe(ZONES.UNPROTECTED);
    expect(zone(join(HOME, ".claude", "plans", "plan.md")).zone).toBe(ZONES.UNPROTECTED);
    expect(zone(join(HOME, ".claude", "file-history", "x.json")).zone).toBe(ZONES.UNPROTECTED);
  });

  it("keeps every OTHER corner of ~/.claude protected, and carves nothing out of ~/.codex", () => {
    for (const rest of ["settings.json", "CLAUDE.md", join("hooks", "global-laws-assert.mjs"), join("skills", "s", "SKILL.md"), join("plugins", "p.json"), ".credentials.json"]) {
      expect(zone(join(HOME, ".claude", rest)).zone).toBe(ZONES.GLOBAL);
    }
    // `~/.codex/worktrees/*` are real checkouts of this repository on the owner's machine; a
    // carve-out there would reopen the sibling hole this module exists to close.
    expect(zone(join(HOME, ".codex", "worktrees", "2e5d", "sentinel", "src", "x.rs")).zone).toBe(ZONES.GLOBAL);
    expect(zone(join(HOME, ".codex", "sessions", "s.json")).zone).toBe(ZONES.GLOBAL);
  });

  it("answers for a file that does not exist yet — a new file in a sibling is still a sibling write", () => {
    const unborn = join(LANE, "src", "deep", "New.tsx");
    expect(existsSync(unborn)).toBe(false);
    expect(zone(unborn).zone).toBe(ZONES.SIBLING);
  });

  it("resolves a relative escape out of the root before deciding, not after", () => {
    expect(zone("../lane/src/App.css").zone).toBe(ZONES.SIBLING);
    expect(zone("./src/../src/App.css").zone).toBe(ZONES.OWN);
  });

  it("does not read a sibling whose NAME starts with the root as a child of it", () => {
    const twin = `${MAIN}-2`;
    mkdirSync(twin, { recursive: true });
    expect(zone(join(twin, "x.md")).zone).not.toBe(ZONES.OWN);
  });

  it("reports a target it cannot place as unknown, never as outside", () => {
    // A drive-relative path names a per-drive working directory this process does not have.
    expect(zone("C:notapath\\x.md").zone).toBe(ZONES.UNKNOWN);
    expect(zone("").zone).toBe(ZONES.UNKNOWN);
  });

  it("still refuses to guess when git will not answer for the target's checkout", () => {
    const z = zoneOf({
      target: join(LANE, "src", "App.css"),
      sessionRoot: MAIN,
      cwd: MAIN,
      deps: { home: HOME, git: (dir) => (toComparable(dir) === toComparable(MAIN) ? "" : null) },
    });
    expect(z.zone).toBe(ZONES.UNKNOWN);
  });
});

describe("the pieces, so a failure names itself", () => {
  it("requires a component boundary rather than a string prefix", () => {
    expect(isWithin("C:/a/b/c", "C:/a/b")).toBe(true);
    expect(isWithin("C:/a/b", "C:/a/b")).toBe(true);
    expect(isWithin("C:/a/bb", "C:/a/b")).toBe(false);
    expect(isWithin("C:\\a\\b\\c", "C:/A/B")).toBe(true);
  });

  it("collapses `..` before comparing, and refuses a drive-relative shape", () => {
    expect(resolveAbsolute("../x", resolve("/a/b"))).toBe(resolve("/a/x"));
    expect(resolveAbsolute("C:rel", resolve("/a"))).toBeNull();
    expect(resolveAbsolute("", resolve("/a"))).toBeNull();
  });

  it("finds the deepest ancestor that exists and keeps the rest", () => {
    const { base: b, missing } = nearestExistingAncestor(join(LANE, "no", "such", "file.txt"));
    expect(toComparable(b)).toContain("lane");
    expect(missing).toEqual(["no", "such", "file.txt"]);
  });

  it("finds a LINKED worktree's checkout root, whose `.git` is a file and not a directory", () => {
    expect(toComparable(checkoutRootOf(join(LANE, "src")))).toBe(toComparable(LANE));
    expect(checkoutRootOf(join(base, "definitely", "not", "here"))).toBeNull();
  });

  it("treats a shared common dir OR a shared origin as one repository, and neither as none", () => {
    expect(sameRepository({ commonDir: "c:/r/.git", origin: null }, { commonDir: "c:/r/.git", origin: null })).toBe(true);
    expect(sameRepository({ commonDir: "a", origin: "https://x" }, { commonDir: "b", origin: "https://x" })).toBe(true);
    expect(sameRepository({ commonDir: "a", origin: null }, { commonDir: "b", origin: null })).toBe(false);
    expect(sameRepository(null, { commonDir: "a", origin: null })).toBe(false);
  });
});

// REGRESSION (found 2026-08-31 by running the SHIPPED hook against this machine, after the whole
// suite was green). The unit matrix injects a fake resolver, so it proved what the checker decides
// once a zone is known and could not see that the zone itself was wrong. Against the real
// filesystem, `echo x > /c/Users/Kuya/code/sentinel/README.md` was ALLOWED: `path.resolve` read the
// Git-Bash drive spelling as `C:\c\Users\…`, a folder under no checkout, so a write into a sibling
// checkout — and one into `~/.claude` — came back `unprotected`. That is the exact hole this module
// exists to close, reachable in the spelling the Bash tool uses by default on this machine.
describe("a Git-Bash drive path names the same place a Windows one does", () => {
  const windows = process.platform === "win32";
  const msys = (p) => (windows ? p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, "/") : p);

  it("translates the drive forms, and only those", () => {
    expect(fromPosixDrive("/c/Users/Kuya/x.md", true)).toBe("C:\\Users\\Kuya\\x.md");
    expect(fromPosixDrive("/cygdrive/d/tmp/x", true)).toBe("D:\\tmp\\x");
    expect(fromPosixDrive("/c", true)).toBe("C:\\");
    // No drive to name: these are ordinary POSIX-rooted paths and must be left exactly alone, or a
    // guard starts inventing a `C:\dev\null`.
    expect(fromPosixDrive("/dev/null", true)).toBeNull();
    expect(fromPosixDrive("/tmp/x", true)).toBeNull();
    expect(fromPosixDrive("/cc/x", true)).toBeNull();
    expect(fromPosixDrive("relative/x", true)).toBeNull();
    // Off Windows the same text IS a real path and translating it would be the fabrication.
    expect(fromPosixDrive("/c/Users/Kuya/x.md", false)).toBeNull();
  });

  it("gives a sibling checkout the same zone in either spelling", () => {
    const target = join(LANE, "src", "App.css");
    expect(zone(target).zone).toBe(ZONES.SIBLING);
    expect(zone(msys(target)).zone).toBe(ZONES.SIBLING);
  });

  it("leaves an unrelated repository unprotected in either spelling — translation is not promotion", () => {
    const target = join(OTHER, "readme.md");
    expect(zone(target).zone).toBe(ZONES.UNPROTECTED);
    expect(zone(msys(target)).zone).toBe(ZONES.UNPROTECTED);
  });

  it("gives the session's own root the same zone in either spelling", () => {
    const target = join(MAIN, "src", "App.css");
    expect(zone(target).zone).toBe(ZONES.OWN);
    expect(zone(msys(target)).zone).toBe(ZONES.OWN);
  });

  it("resolves a relative target against a cwd spelled that way too", () => {
    // `cd /c/…/sibling && rm -f package.json` is the reachable form: the destination is the write
    // target one operand later, so reading it loosely loses the target itself.
    expect(zone("App.css", { cwd: msys(join(LANE, "src")) }).zone).toBe(ZONES.SIBLING);
  });
});

describe("a checkout registered INSIDE another checkout answers to itself (#425)", () => {
  // The lanes this repository runs sit at `.claude/worktrees/<lane>`, inside the main checkout's own
  // folder. Distance from the root is not ownership in either direction: a lane nested under the root
  // is another writer's checkout, and the checkout a lane sits inside is another owner to that lane.
  // A fixture of its own, so the one above keeps the flat layout its cases were written against.
  const windows = process.platform === "win32";
  const msys = (p) => (windows ? p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).split(sep).join("/") : p);
  const same = (a, b) => Boolean(a) && toComparable(a) === toComparable(b);

  let nest = null;
  let NMAIN = null;
  let LANE_A = null;
  let LANE_B = null;
  let CHILD = null;
  let TOP = null;
  let VENDOR = null;
  let STALE = null;
  let NHOME = null;

  beforeAll(() => {
    nest = mkdtempSync(join(tmpdir(), "compy-nested-"));
    NHOME = join(nest, "home");
    mkdirSync(join(NHOME, ".claude"), { recursive: true });
    writeFileSync(join(NHOME, ".claude", "settings.json"), "{}");

    const seed = (dir, origin) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      git(dir, "init", "-q", "-b", "main");
      git(dir, "config", "user.email", "fixture@example.invalid");
      git(dir, "config", "user.name", "fixture");
      git(dir, "remote", "add", "origin", origin);
      writeFileSync(join(dir, "src", "App.css"), "a{}");
      git(dir, "add", "-A");
      git(dir, "commit", "-qm", "seed");
    };

    NMAIN = join(nest, "main");
    seed(NMAIN, "https://example.invalid/pootytxng/nested.git");
    LANE_A = join(NMAIN, ".claude", "worktrees", "laneA");
    LANE_B = join(NMAIN, ".claude", "worktrees", "laneB");
    TOP = join(nest, "main-top");
    git(NMAIN, "worktree", "add", "-q", "-b", "laneA", LANE_A);
    git(NMAIN, "worktree", "add", "-q", "-b", "laneB", LANE_B);
    git(NMAIN, "worktree", "add", "-q", "-b", "top", TOP);
    CHILD = join(LANE_A, "nested-child");
    git(NMAIN, "worktree", "add", "-q", "-b", "child", CHILD);

    // Not a lane: an unrelated repository that happens to sit inside the root.
    VENDOR = join(NMAIN, "vendor", "other");
    seed(VENDOR, "https://example.invalid/someone/other.git");

    // A lane whose registration is gone: its `.git` file names a git dir that no longer exists.
    STALE = join(NMAIN, ".claude", "worktrees", "stale");
    mkdirSync(STALE, { recursive: true });
    writeFileSync(join(STALE, ".git"), `gitdir: ${join(nest, "missing", "worktrees", "stale")}`);

    // Reparse points, which the resolver follows before anything is decided. Every one of them
    // points inside this fixture.
    symlinkSync(LANE_A, join(NMAIN, "link-laneA"), "junction");
    symlinkSync(TOP, join(NMAIN, "link-top"), "junction");
    symlinkSync(join(NMAIN, "src"), join(LANE_A, "link-main-src"), "junction");
    symlinkSync(LANE_B, join(LANE_A, "link-peer"), "junction");
    symlinkSync(TOP, join(LANE_A, "link-top"), "junction");
  });

  afterAll(() => {
    if (nest) {
      try {
        rmSync(nest, { recursive: true, force: true });
      } catch {
        /* a locked file on Windows must not fail the suite */
      }
    }
  });

  const nz = (target, { root = NMAIN, cwd = root } = {}) => zoneOf({ target, sessionRoot: root, cwd, deps: { home: NHOME } });

  it("from the main checkout, a file in a registered nested lane is the lane's, however it is spelled", () => {
    const file = join(LANE_A, "src", "App.css");
    for (const target of [file, LANE_A, join(LANE_A, ".git"), ".claude/worktrees/laneA/src/App.css", msys(file), join(NMAIN, "link-laneA", "src", "App.css")]) {
      const z = nz(target);
      expect(z.zone, target).toBe(ZONES.SIBLING);
      expect(same(z.owner, LANE_A), target).toBe(true);
    }
  });

  it("from the main checkout, a file that does not exist yet inside the lane is still the lane's", () => {
    const unborn = join(LANE_A, "src", "deep", "New.tsx");
    expect(existsSync(unborn)).toBe(false);
    expect(nz(unborn).zone).toBe(ZONES.SIBLING);
  });

  it("from the main checkout, its own files, its unborn files and the folder that holds the lanes stay its own", () => {
    for (const target of [join(NMAIN, "src", "App.css"), join(NMAIN, "src", "new", "deep.css"), "src/App.css", join(NMAIN, ".claude", "worktrees"), NMAIN]) {
      expect(nz(target).zone, target).toBe(ZONES.OWN);
    }
  });

  it("protects registered descendants only for operations that can act on a whole directory (#428)", () => {
    let gitCalls = 0;
    const counted = (target) => zoneOf({ target, sessionRoot: NMAIN, cwd: NMAIN, descendants: true,
      deps: { home: NHOME, git: () => { gitCalls += 1; throw new Error("ordinary ancestor check must not spawn git"); } } });
    for (const target of [".claude/worktrees", join(NMAIN, ".claude"), NMAIN]) {
      const result = counted(target);
      expect(result.zone, target).toBe(ZONES.SIBLING);
      expect([LANE_A, LANE_B, CHILD].some((lane) => same(result.owner, lane)), target).toBe(true);
    }
    expect(counted(join(NMAIN, "src")).zone).toBe(ZONES.OWN);
    expect(counted(join(NMAIN, "src", "App.css")).zone).toBe(ZONES.OWN);
    const wildcard = (target) => zoneOf({ target, sessionRoot: NMAIN, cwd: NMAIN, descendants: true, wildcard: true,
      deps: { home: NHOME, git: () => { gitCalls += 1; throw new Error("wildcard prefix must not spawn git"); } } });
    expect(wildcard(".claude/worktrees/").zone).toBe(ZONES.UNKNOWN);
    expect(wildcard("src/").zone).toBe(ZONES.OWN);
    expect(gitCalls).toBe(0);
    // An ordinary file write does not inspect the descendant registry.
    expect(nz(join(NMAIN, ".claude", "worktrees")).zone).toBe(ZONES.OWN);
  });

  it("reads the common registration from a linked root and locks unreadable registrations (#428)", () => {
    const child = zoneOf({ target: LANE_A, sessionRoot: LANE_A, cwd: LANE_A, descendants: true, deps: { home: NHOME } });
    expect(child.zone).toBe(ZONES.SIBLING);
    expect(same(child.owner, CHILD)).toBe(true);
    const deniedRead = () => { throw Object.assign(new Error("fixture denied"), { code: "EACCES" }); };
    const q = { target: join(NMAIN, "src"), sessionRoot: NMAIN, cwd: NMAIN, deps: { home: NHOME, list: deniedRead } };
    expect(zoneOf({ ...q, descendants: true }).zone).toBe(ZONES.UNKNOWN);
    expect(zoneOf({ ...q, descendants: true, wildcard: true }).zone).toBe(ZONES.UNKNOWN);
    expect(zoneOf(q).zone).toBe(ZONES.OWN);
  });

  it("from a nested lane, its peer, the checkout it sits inside and a top-level sibling all belong to someone else", () => {
    // Each owner is reached directly, relatively where that applies, and through a junction that sits
    // inside the lane itself.
    const cases = [
      [LANE_B, [join(LANE_B, "src", "App.css"), "../laneB/src/App.css", join(LANE_A, "link-peer", "src", "App.css")]],
      [NMAIN, [join(NMAIN, "src", "App.css"), "../../../src/App.css", join(LANE_A, "link-main-src", "App.css")]],
      [TOP, [join(TOP, "src", "App.css"), join(LANE_A, "link-top", "src", "App.css")]],
    ];
    for (const [owner, targets] of cases) {
      for (const target of targets) {
        const z = nz(target, { root: LANE_A });
        expect(z.zone, target).toBe(ZONES.SIBLING);
        expect(same(z.owner, owner), target).toBe(true);
      }
    }
    expect(nz(join(LANE_A, "src", "App.css"), { root: LANE_A }).zone).toBe(ZONES.OWN);
    expect(nz(join(LANE_A, "src", "deep", "New.tsx"), { root: LANE_A }).zone).toBe(ZONES.OWN);
  });

  it("does not guess at a lane whose registration is gone: it is unknown, not the root's", () => {
    const z = nz(join(STALE, "notes.md"));
    expect(z.zone).toBe(ZONES.UNKNOWN);
    expect(same(z.owner, STALE)).toBe(true);
  });

  it("keeps an unrelated repository inside the root under the root's own protection, not outside it", () => {
    // Outside the root an unrelated checkout is unprotected. Inside it, dropping to unprotected would
    // open a hole this repair has no business opening, so it stays with the checkout that holds it.
    const z = nz(join(VENDOR, "src", "App.css"));
    expect(z.zone).toBe(ZONES.OWN);
    expect(same(z.owner, NMAIN)).toBe(true);
  });

  it("spawns git only once a checkout other than the session's own is found", () => {
    let calls = 0;
    const counting = (cwd, args) => {
      calls += 1;
      try {
        return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        return null;
      }
    };
    const counted = (target) => zoneOf({ target, sessionRoot: NMAIN, cwd: NMAIN, deps: { home: NHOME, git: counting } });
    for (const target of [join(NMAIN, "src", "App.css"), join(NMAIN, "src", "new", "deep.css"), join(NMAIN, ".claude", "worktrees"), NMAIN]) {
      expect(counted(target).zone, target).toBe(ZONES.OWN);
    }
    expect(calls).toBe(0);
    expect(counted(join(LANE_A, "src", "App.css")).zone).toBe(ZONES.SIBLING);
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(4);
  });

  describe("through the entry points that consume the decision", () => {
    // Each guard gets the verdict shape its own suite uses; an unclaimed folder reads the same to both.
    const VERIFIED = { ok: true, mode: "launch" };
    const UNCLAIMED = { ok: false, code: "FOLDER_UNCLAIMED", reason: "fixture" };
    const shell = (command, { root = NMAIN, verdict = null } = {}) =>
      decideShell({
        toolName: "Bash",
        toolInput: { command },
        sessionRoot: root,
        cwd: root,
        verify: () => verdict ?? { ok: true, root, issue: 425, branch: "lane/fixture-425" },
        home: NHOME,
        env: {},
      });
    const write = (file_path, { root = NMAIN, verdict = VERIFIED } = {}) =>
      decide({ toolName: "Write", toolInput: { file_path, content: "x" }, verdict, root, cwd: root, zone: (q) => zoneOf({ ...q, deps: { home: NHOME } }) });

    it("refuses deleting the container of registered lanes, but allows an ordinary folder (#428)", () => {
      for (const target of [".claude/worktrees", ".claude", msys(join(NMAIN, ".claude", "worktrees"))]) {
        expect(shell(`rm -rf "${target}"`), target).toMatchObject({ permission: "deny", zone: ZONES.SIBLING });
      }
      expect(shell("rm -rf src").permission).toBe("allow");
      expect(shell('mv ".claude/worktrees" staging')).toMatchObject({ permission: "deny", zone: ZONES.SIBLING });
      const ps = decideShell({ toolName: "PowerShell", toolInput: { command: 'Remove-Item -LiteralPath ".claude/worktrees" -Recurse -Force' },
        sessionRoot: NMAIN, cwd: NMAIN, verify: () => VERIFIED, home: NHOME, env: {} });
      expect(ps).toMatchObject({ permission: "deny", zone: ZONES.SIBLING });
    });
    it.each([
      ["rm -rf .claude/worktrees/*", "ask"],
      ["rm -rf .cla*/worktrees/*", "ask"],
      ["rm -rf .claude/worktrees/lane?", "ask"],
      ["mv .claude/worktrees/* staging", "ask"],
      ["rm -rf .claude/worktrees/laneA/*", "deny"],
      ["rm -rf src/*.tmp", "allow"],
      ['rm -rf ".claude/worktrees/*"', "allow"],
      ["rm -rf '.claude/worktrees/*'", "allow"],
      ["rm -rf .claude/worktrees/\\*", "allow"],
      ['rm -rf ".claude"/worktrees/*', "ask"],
    ])("preserves wildcard ownership and literal controls: %s (#428)", (command, permission) => {
      expect(shell(command).permission).toBe(permission);
    });

    it("denies an absolute wildcard whose static prefix is already in a sibling (#428)", () => {
      expect(shell('rm -rf ' + msys(LANE_A) + '/*').permission).toBe("deny");
    });

    it.each([
      ["rm -rf .claude/work{trees,}", "ask"],
      ["rm -rf .claude/{worktrees,nothing}", "ask"],
      ["rm -rf .claude/worktrees/{laneA,laneB}", "ask"],
      ["rm -rf .claude/worktrees/laneA/{1..3}", "deny"],
      ['rm -rf .claude/work{tr"ee"s,}', "ask"],
      ["rm -rf .claude/{unused,{worktrees,other}}", "ask"],
      ["mv .claude/work{trees,} staging", "ask"],
      ["rm -rf src/{one,two}.tmp", "allow"],
      ['rm -rf ".claude/work{trees,}"', "allow"],
      ["rm -rf .claude/work\\{trees,\\}", "allow"],
      ["rm -rf .claude/work{trees}", "allow"],
      ["rm -rf .claude/work{}", "allow"],
      ["rm -rf ~+/.claude/worktrees", "ask"],
      ["rm -rf ~-/.claude/worktrees", "ask"],
      ["rm -rf ~somebody/.claude/worktrees", "ask"],
      ['rm -rf "~+/.claude/worktrees"', "allow"],
      ["rm -rf \\~+/.claude/worktrees", "allow"],
    ])("guards shell expansions without expanding literals: %s (#428 review)", (command, permission) => {
      expect(shell(command).permission).toBe(permission);
    });

    it.each([
      ["Remove-Item -Path '.claude/worktrees/*' -Recurse", "ask"],
      ['Remove-Item -Path ".claude/worktrees/*" -Recurse', "ask"],
      ['Remove-Item -LiteralPath ".claude/worktrees/*" -Recurse', "allow"],
      ["Remove-Item -LiteralPath .claude/worktrees/* -Recurse", "allow"],
      ["Move-Item -Path '.claude/worktrees/*' -Destination staging", "ask"],
      ["Rename-Item -Path '.claude/worktrees/*' -NewName staging", "ask"],
      ["Remove-Item -Path 'src/*.tmp'", "allow"],
      ["Remove-Item -LiteralPath '.claude/worktrees/laneA' -Recurse", "deny"],
    ])("distinguishes PowerShell provider wildcards from LiteralPath: %s (#428)", (command, permission) => {
      const result = decideShell({ toolName: "PowerShell", toolInput: { command },
        sessionRoot: NMAIN, cwd: NMAIN, verify: () => VERIFIED, home: NHOME, env: {} });
      expect(result.permission).toBe(permission);
    });

    it("the shell guard refuses a main-rooted command that reaches into a nested lane, verified or not", () => {
      for (const verdict of [null, UNCLAIMED]) {
        for (const command of [
          `rm "${msys(join(LANE_A, "src", "App.css"))}"`,
          `rm -rf "${msys(LANE_A)}"`,
          `git -C "${msys(LANE_A)}" checkout -- src/App.css`,
          `cd "${msys(LANE_A)}" && git checkout -- src/App.css`,
        ]) {
          const d = shell(command, { verdict });
          expect(d.permission, command).toBe("deny");
          expect(d.zone, command).toBe(ZONES.SIBLING);
        }
      }
      expect(shell(`rm "${msys(join(STALE, "notes.md"))}"`).permission).toBe("ask");
      expect(shell(`rm "${msys(join(NMAIN, "src", "App.css"))}"`).permission).toBe("allow");
    });

    it("the shell guard, from a nested lane, refuses its peer, its parent checkout and a top-level sibling, and not its own files", () => {
      for (const target of [join(LANE_B, "src", "App.css"), join(NMAIN, "src", "App.css"), join(TOP, "src", "App.css")]) {
        expect(shell(`rm "${msys(target)}"`, { root: LANE_A }).permission, target).toBe("deny");
      }
      expect(shell(`rm "${msys(join(LANE_A, "src", "App.css"))}"`, { root: LANE_A }).permission).toBe("allow");
    });

    it("the direct-write guard refuses a Write into a nested lane, verified or not, and asks about a stale one", () => {
      for (const verdict of [VERIFIED, UNCLAIMED]) {
        for (const target of [join(LANE_A, "src", "App.css"), join(LANE_A, "src", "deep", "New.tsx"), join(NMAIN, "link-top", "src", "App.css")]) {
          const d = write(target, { verdict });
          expect(d.allow, target).toBe(false);
          expect(d.code, target).toBe("TARGET_NOT_OURS");
        }
      }
      const stale = write(join(STALE, "notes.md"));
      expect(stale.permission).toBe("ask");
      expect(stale.code).toBe("TARGET_UNRESOLVED");
    });

    it("the direct-write guard leaves the main checkout's own files, new ones included, to the normal verdict", () => {
      for (const target of [join(NMAIN, "src", "App.css"), join(NMAIN, "src", "new", "deep.css"), join(VENDOR, "src", "App.css")]) {
        expect(write(target).allow, target).toBe(true);
      }
    });

    it("the direct-write guard, from a nested lane, refuses its peer, its parent checkout and a top-level sibling, and not its own files", () => {
      // The junctions are the spellings this guard used to wave through: lexically, they are inside the lane.
      for (const target of [
        join(LANE_B, "src", "App.css"),
        join(NMAIN, "src", "App.css"),
        join(TOP, "src", "App.css"),
        join(LANE_A, "link-peer", "src", "App.css"),
        join(LANE_A, "link-main-src", "App.css"),
        join(LANE_A, "link-top", "src", "App.css"),
      ]) {
        expect(write(target, { root: LANE_A }).code, target).toBe("TARGET_NOT_OURS");
      }
      expect(write(join(LANE_A, "src", "App.css"), { root: LANE_A }).allow).toBe(true);
    });
  });
});
