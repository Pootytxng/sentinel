// A Windows path that lost its separators is a corrupted assertion, not a typo.
//
// THE BUG THIS EXISTS FOR. `docs/BRANCH_DISPOSITIONS.md` shipped a row claiming a lane lived at
// `C:UsersKuyacodesentinel-remote-design-286`. That is not a path on any machine. It was written
// as `C:\\Users\\...` inside a generator script; the heredoc carrying that script to disk ate one
// backslash level so the file held `C:\Users\...`, and JavaScript then read `\U` as an unknown
// escape and dropped the backslash entirely. Three layers, each individually reasonable, and the
// output was a directory that cannot be opened. A second instance was already sitting in
// `docs/archive/RELEASE_STATE_HISTORY.md` from an earlier session, unnoticed.
//
// WHY A GUARD AND NOT A FIX. Both instances were repaired in the same commit as this file, but the
// escaping chain that produced them is still there and will be used again by the next generator
// script. The repo already carries one memory about heredocs eating a backslash level; prose did
// not stop the second instance, so this is the tier above it. Measured while writing this: a
// quoted heredoc through the agent tool turns `\\` into `\` and `\\\\` into `\\`, so a
// generator must double every backslash it wants to survive.
//
// THIS HEADER SHIPPED CORRUPTED, in the commit that added the guard. Both lines above were
// written as escaped literals and went through the very chain they describe, so the rule came
// out as `\d` into `\d` — nonsense, and nonsense that reads as an explanation. They are
// built from String.fromCharCode(92) now, which is the only construction that survives. Third
// instance of this class in one session, twice while actively thinking about it.
//
// SCOPE. Every tracked markdown file, archives included. An archive is a point-in-time record of
// what was BELIEVED, which is worth preserving; a path with no separators records nothing, it is
// just broken bytes, and correcting it changes no claim. Markdown ONLY, and measured rather than
// assumed: the exact-head review of PR #317 swept all 1616 tracked text files with the pattern
// below and found eight further hits, every one deliberate -- a hook and three tests that quote
// the mangled string as the documented example of the bug, `C:notapath` fixtures, and a receipt's
// honest note about a path a heredoc had mangled. Widening the corpus would need an allowance
// idiom for those, and "fixing" them would corrupt three accurate bug reports and a merge receipt.
//
// THE PATTERN MUST STAY A REGEX LITERAL. Assembled from a string it goes through the very chain
// this guard exists for: the reviewer's first `new RegExp("\\b...")` reached node as a BACKSPACE
// character, matched nothing, and reported a clean corpus. A vacuous pass is the failure mode.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A path ROOT -- an UPPERCASE drive letter and colon, a `%VAR%` or a `$env:VAR` for the
// environment variables these docs actually root paths in -- followed by eight or more path-ish
// characters with NO separator among them. The narrowings are deliberate and cost coverage: a
// lowercase drive letter would swallow CSS and prose tokens (`a:blue`, in an archive, was the
// first false positive this guard produced), and a shorter tail would swallow ordinary
// abbreviations. A mangled `d:temp` slips through. `C:\Users`, `C:/Users`, `%LOCALAPPDATA%\Compy`
// and `$env:LOCALAPPDATA\Compy` never match: the character class excludes both separators, so a
// real path stops the match dead at its first one, and a bare `$env:LOCALAPPDATA` in prose has
// no tail at all.
//
// The env roots are not decoration. The first cut of this guard was anchored on a drive letter
// alone, and the exact-head review of PR #317 found four instances of the SAME corruption sitting
// in the file it already read -- `$env:LOCALAPPDATACompycompy.exe`, three of them inside the
// PowerShell verification commands of the release-state archive, where a reader who copies the
// line silently checks the wrong thing. Those lines were repaired on main under #318 before this
// widening landed, so with the drive-only pattern this guard would have gone green on a corpus
// that still contained its own target: passing because it could not see, not because the corpus
// was clean. Falsified against the bytes: at the parent of that repair the drive-only pattern
// finds 0 of the last three and this one finds all 3.
export const MANGLED_PATH =
  /(?:\b[A-Z]:|%(?:LOCALAPPDATA|APPDATA|USERPROFILE|SYSTEMROOT|PROGRAMFILES|TEMP)%|\$env:(?:LOCALAPPDATA|APPDATA|USERPROFILE|SYSTEMROOT|TEMP))[A-Za-z0-9._-]{8,}/g;

/** Every offending line in one file's text, as `{ line, text }`. Reports ALL, never just the first. */
export function mangledPaths(text) {
  const found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const match of line.matchAll(MANGLED_PATH)) {
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

  it("finds no path, drive-rooted or env-rooted, that lost its separators", () => {
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

  // The four the drive-only pattern could not see (review of PR #317 at 19f458d4, finding 1):
  // env-rooted, and three of them inside a Select-String command a reader would copy to verify a
  // build. Both spellings shipped on the same archive row.
  it("catches an env-rooted path that lost its separators, in both spellings", () => {
    const row = 'Select-String -Path "$env:LOCALAPPDATACompycompy.exe" -Pattern 7c1e ... %LOCALAPPDATA%Compycompy.exe';
    expect(mangledPaths(row).map((hit) => hit.text)).toEqual([
      "$env:LOCALAPPDATACompycompy.exe",
      "%LOCALAPPDATA%Compycompy.exe",
    ]);
  });

  // Built from parts, like the drive-letter case below and for the same reason.
  it("stays quiet on every correct env-rooted form these docs use", () => {
    const bs = String.fromCharCode(92);
    const correct = [
      ["%LOCALAPPDATA%", "Compy", "compy.exe"].join(bs),
      ["$env:LOCALAPPDATA", "Compy", "compy.exe"].join(bs),
      ["%APPDATA%", "Compy", "runtime"].join(bs) + bs,
      ["%APPDATA%", "Sentinel"].join(bs),
      "%LOCALAPPDATA%/Compy/compy.exe",
      "the data root under $env:LOCALAPPDATA is not the IPC directory",
    ].join("\n");
    expect(mangledPaths(correct)).toEqual([]);
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
