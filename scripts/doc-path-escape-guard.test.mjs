// A Windows path that lost its separators is a corrupted assertion, not a typo.
//
// THE BUG THIS EXISTS FOR. `docs/BRANCH_DISPOSITIONS.md` shipped a row claiming a lane lived at
// `C:UsersKuyacodesentinel-remote-design-286`. That is not a path on any machine. It was written
// as `C:\Users\...` inside a generator script, the heredoc carrying that script to disk ate one
// backslash level so the file held `C:\Users\...`, and JavaScript then read `\U` as an unknown
// escape and dropped the backslash entirely. Three layers, each individually reasonable, and the
// output was a directory that cannot be opened. A second instance was already sitting in
// `docs/archive/RELEASE_STATE_HISTORY.md` from an earlier session, unnoticed.
//
// WHY A GUARD AND NOT A FIX. Both instances were repaired in the same commit as this file, but the
// escaping chain that produced them is still there and will be used again by the next generator
// script. The repo already carries one memory about heredocs eating a backslash level; prose did
// not stop the second instance, so this is the tier above it. Measured while writing this: a
// quoted heredoc through the agent tool turns `\d` into `\d` and `\\d` into `\d`, so a
// generator must double every backslash it wants to survive.
//
// SCOPE. Every tracked markdown file, archives included. An archive is a point-in-time record of
// what was BELIEVED, which is worth preserving; a path with no separators records nothing, it is
// just broken bytes, and correcting it changes no claim.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// An UPPERCASE drive letter, a colon, then eight or more path-ish characters with NO separator
// among them. Both narrowings are deliberate and both cost coverage: lowercase would swallow CSS
// and prose tokens (`a:blue`, in an archive, was the first false positive this guard produced),
// and a shorter tail would swallow ordinary abbreviations. A mangled `d:temp` slips through. The
// paths these docs actually assert are `C:\Users\Kuya\...`, and this catches those.
// `C:\Users` and `C:/Users` never match: the character class excludes both separators, so a real
// path stops the match dead at its first one.
export const MANGLED_DRIVE_PATH = /\b[A-Z]:[A-Za-z0-9._-]{8,}/g;

/** Every offending line in one file's text, as `{ line, text }`. Reports ALL, never just the first. */
export function mangledPaths(text) {
  const found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const match of line.matchAll(MANGLED_DRIVE_PATH)) {
      found.push({ line: i + 1, text: match[0] });
    }
  });
  return found;
}

function trackedMarkdown() {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
}

describe("a documented Windows path keeps its separators", () => {
  const files = trackedMarkdown();

  it("resolves a corpus — an empty sweep would be a vacuous pass", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("finds no drive-letter path that lost its separators", () => {
    const offenders = files.flatMap((file) =>
      mangledPaths(readFileSync(join(repoRoot, file), "utf8")).map(
        (hit) => `${file}:${hit.line}  ${hit.text}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the guard fires on the bytes that actually shipped", () => {
  it("catches the row that shipped broken", () => {
    expect(mangledPaths("worktree `C:UsersKuyacodesentinel-remote-design-286`")).toEqual([
      { line: 1, text: "C:UsersKuyacodesentinel-remote-design-286" },
    ]);
  });

  it("catches the second instance, which sat in an archive unnoticed", () => {
    expect(mangledPaths("C:UsersKuyacodecompy-data-root-recovery")).toHaveLength(1);
  });

  // The backslash case builds its path from parts rather than writing it as an escaped literal ON
  // PURPOSE. Written as a literal it goes through the SAME chain that caused the bug and silently
  // becomes the mangled string — so the test asserting the guard stays quiet asserts it fires.
  it("stays quiet on both separator styles, which is the whole point", () => {
    const winPath = ["C:", "Users", "Kuya", "code", "sentinel"].join(String.fromCharCode(92));
    expect(mangledPaths(winPath)).toEqual([]);
    expect(mangledPaths("`C:/Users/Kuya/code/sentinel`")).toEqual([]);
  });

  it("reports every offending line, not just the first", () => {
    const two = ["C:UsersKuyaone", "fine", "D:UsersKuyatwo"].join("\n");
    expect(mangledPaths(two).map((hit) => hit.line)).toEqual([1, 3]);
  });
});
