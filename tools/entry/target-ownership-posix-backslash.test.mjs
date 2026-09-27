// #491: on POSIX a `\` is an ordinary filename character, and `zoneOf` read it as a separator.
//
// `toComparable` collapses every `\` to `/`, and the POSIX session-root re-spelling added in #444
// did the same to the root. A session rooted at `<base>/a\b` therefore "owned" the unrelated
// checkout at `<base>/a/b`: a write there came back `own-claim` (a false ALLOW once the session is
// verified). The same re-spelling made a session's write into its OWN checkout read as somebody
// else's whenever `<base>/a/b` was a symlink elsewhere (a false DENY).
//
// Only POSIX can hold a folder named `a\b`, so every fixture here is a real temp directory and the
// block is skipped on Windows. The hook module is owner-hands (#368), so the fix ships as a patch
// that the owner applies: docs/superpowers/specs/2026-09-27-zoneof-posix-backslash-491.patch. Until
// then the "once applied" block is skipped, the "before" block proves the fixture reproduces the
// defect, and the first test proves the patch still applies.
//
// `canonicalizePath` and the board keys it feeds are NOT touched (#491: they are persisted). The
// live hooks hand `zoneOf` the canonical all-`\` spelling, which cannot say which `\` was a
// separator; the patch settles it from what exists and answers `unknown` when two readings exist.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { ZONES, zoneOf } from "../../.claude/hooks/target-ownership.mjs";
import { canonicalizePath } from "../../.claude/hooks/session-root-assert.mjs";
// The whole module too, for an export that exists only once the owner applies the #491 patch.
import * as hook from "../../.claude/hooks/target-ownership.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PATCH = join(REPO, "docs", "superpowers", "specs", "2026-09-27-zoneof-posix-backslash-491.patch");
const applied = typeof hook.posixRootReadings === "function";
const posix = process.platform !== "win32";

const made = [];
const tempBase = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `z491-${tag}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
const checkout = (dir, origin) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  if (origin) git(dir, "remote", "add", "origin", origin);
  return dir;
};
const zone = (target, sessionRoot) => zoneOf({ target, sessionRoot, cwd: sessionRoot, deps: { windows: false } }).zone;

/** The issue's fixture: this session at `<base>/a\b`, an unrelated repository at `<base>/a/b`. */
const collision = () => {
  const base = tempBase("collide");
  const mine = checkout(join(base, "a\\b"), "https://example.invalid/mine.git");
  const theirs = checkout(join(base, "a", "b"), "https://example.invalid/THEIRS.git");
  return { mine, theirs };
};

/** The #444 regression: `<base>/a/b` is a symlink to an unrelated checkout elsewhere. */
const symlinked = () => {
  const base = tempBase("link");
  const mine = checkout(join(base, "a\\b"));
  const other = checkout(join(base, "other"));
  mkdirSync(join(base, "a"));
  symlinkSync(other, join(base, "a", "b"));
  return { base, mine, other };
};

describe("#491: a literal backslash in a POSIX folder name is not a separator", () => {
  it("the owner-hand patch still applies to the hook as it is — and is gone once applied", () => {
    if (applied) {
      expect(existsSync(PATCH), "the patch is spent: delete it in the same commit that applies it").toBe(false);
      return;
    }
    expect(existsSync(PATCH), "the patch this block names must exist until it is applied").toBe(true);
    expect(() => execFileSync("git", ["apply", "--check", PATCH], { cwd: REPO, stdio: "pipe" })).not.toThrow();
  });

  describe.skipIf(!posix || applied)("before the patch: the fixture reproduces the defect", () => {
    it("reads a write into the unrelated checkout at <base>/a/b as own-claim", () => {
      const { mine, theirs } = collision();
      expect(zone(join(theirs, "victim.txt"), mine)).toBe(ZONES.OWN);
    });
  });

  describe.skipIf(!posix || !applied)("once applied", () => {
    it("never reads the unrelated checkout as the session's own, in either root spelling", () => {
      const { mine, theirs } = collision();
      const victim = join(theirs, "victim.txt");
      // The native spelling is exact: an unrelated repository is what it is.
      expect(zone(victim, mine)).toBe(ZONES.UNPROTECTED);
      // The canonical spelling cannot tell the two folders apart, and both exist: `unknown`.
      expect(zone(victim, canonicalizePath(mine))).toBe(ZONES.UNKNOWN);
      expect(zone(victim, canonicalizePath(mine))).not.toBe(ZONES.OWN);
    });

    it("keeps the session's own writes own-claim when <base>/a/b is a symlink elsewhere", () => {
      const { mine, other } = symlinked();
      expect(zone(join(mine, "x.txt"), mine)).toBe(ZONES.OWN);
      // The symlink's target is still somebody else's, not this session's.
      expect(zone(join(other, "x.txt"), mine)).not.toBe(ZONES.OWN);
    });

    it("reads the canonical spelling by what exists: one reading is the root", () => {
      const base = tempBase("one");
      const mine = checkout(join(base, "a\\b"));
      expect(hook.posixRootReadings(canonicalizePath(mine))).toEqual([mine]);
      expect(zone(join(mine, "x.txt"), canonicalizePath(mine))).toBe(ZONES.OWN);
      expect(zone(join(base, "a", "b", "x.txt"), canonicalizePath(mine))).not.toBe(ZONES.OWN);
    });

    it("counts a symlink onto the same folder as one reading, not an ambiguity", () => {
      const base = tempBase("alias");
      const mine = checkout(join(base, "a\\b"));
      mkdirSync(join(base, "a"));
      symlinkSync(mine, join(base, "a", "b"));
      expect(hook.posixRootReadings(canonicalizePath(mine))).toHaveLength(1);
      expect(zone(join(mine, "x.txt"), canonicalizePath(mine))).toBe(ZONES.OWN);
    });

    it("keeps #444: the ordinary canonical root still owns its checkout", () => {
      const base = tempBase("plain");
      const mine = checkout(join(base, "sentinel"));
      const sibling = checkout(join(base, "sentinel-other"));
      git(mine, "remote", "add", "origin", "https://example.invalid/sentinel.git");
      git(sibling, "remote", "add", "origin", "https://example.invalid/sentinel.git");
      expect(hook.posixRootReadings(canonicalizePath(mine))).toEqual([mine]);
      expect(zone(join(mine, "src", "new.ts"), canonicalizePath(mine))).toBe(ZONES.OWN);
      expect(zone(join(sibling, "src", "new.ts"), canonicalizePath(mine))).toBe(ZONES.SIBLING);
    });

    it("returns no reading for a spelling that is not an absolute canonical POSIX path", () => {
      expect(hook.posixRootReadings("relative\\path")).toEqual([]);
      expect(hook.posixRootReadings("C:\\Users\\Kuya\\code\\sentinel")).toEqual([]);
      expect(hook.posixRootReadings("")).toEqual([]);
    });
  });
});
