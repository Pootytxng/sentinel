// Guard for the zone resolver (#278) — spec
// docs/superpowers/specs/2026-08-31-target-ownership-across-tools.md §3.
//
// The claim this file has to earn is "a sibling worktree is not outside protection". That cannot be
// proved against mocks, because the thing being resolved IS git's own notion of which checkouts
// share a repository. So the fixtures are real: `git init`, a real `git worktree add`, a real second
// clone sharing an origin, all under the OS temp dir. Nothing here touches this repository, this
// machine's `~/.claude`, or any live checkout — the home directory is a fixture too.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
