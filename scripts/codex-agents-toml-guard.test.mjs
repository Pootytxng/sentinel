// The .codex/agents/*.toml files carry their whole prompt inside a TOML **basic** multi-line string
// (`"""..."""`), where a backslash is an ESCAPE CHARACTER. `%LOCALAPPDATA%\Compy\compy.exe` written
// straight into one is `\C`, which is not a valid TOML escape — the file stops parsing and the agent
// silently stops loading.
//
// Found 2026-08-21, one minute after writing it: mirroring a new rubric item from
// .claude/agents/self-reviewer.md into .codex/agents/self-reviewer.toml carried a Windows path
// across. The .md is markdown and did not care; the .toml would have broken. Nothing in the repo had
// ever put a backslash in one of these files, so there was no precedent to copy and nothing to catch
// it — the whole class was one careless mirror away, in a file no test opened.
//
// The fix in the file was to write the path with forward slashes. The fix in the repo is this.
//
// Checked here and deliberately nothing else: these are prompts, so their PROSE is free to change.
// What is not free is a byte sequence that stops the file being TOML.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS = join(repoRoot, ".codex", "agents");

const files = readdirSync(AGENTS).filter((f) => f.endsWith(".toml"));

/**
 * Every escape TOML allows inside a basic string, plus multi-line's line-ending backslash (a
 * backslash whose rest-of-line is only whitespace, which folds the newline away).
 * @see https://toml.io/en/v1.0.0#string
 */
const VALID_ESCAPE = /^[btnfr"\\]|^u[0-9a-fA-F]{4}|^U[0-9a-fA-F]{8}|^[ \t]*\r?\n/;

/** Byte ranges covered by `"""` … `"""` pairs — the only place escapes are interpreted. */
const basicMultilineRanges = (text) => {
  const ranges = [];
  let from = text.indexOf('"""');
  while (from !== -1) {
    const to = text.indexOf('"""', from + 3);
    if (to === -1) return { ranges, unterminated: true };
    ranges.push([from + 3, to]);
    from = text.indexOf('"""', to + 3);
  }
  return { ranges, unterminated: false };
};

const invalidEscapes = (text) => {
  const { ranges } = basicMultilineRanges(text);
  const bad = [];
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i += 1) {
      if (text[i] !== "\\") continue;
      const rest = text.slice(i + 1, i + 12);
      if (VALID_ESCAPE.test(rest)) {
        i += 1; // a valid escape consumes its next char; do not re-read it as a new backslash
        continue;
      }
      const line = text.slice(0, i).split("\n").length;
      bad.push(`line ${line}: \\${text[i + 1] ?? "<end of file>"}`);
    }
  }
  return bad;
};

describe(".codex/agents/*.toml stay parseable as TOML", () => {
  it("has agent files to check at all", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const text = readFileSync(join(AGENTS, file), "utf8");

    it(`${file}: every """ block is closed`, () => {
      expect(basicMultilineRanges(text).unterminated, `${file} opens a """ it never closes`).toBe(
        false,
      );
    });

    it(`${file}: no invalid escape inside a basic multi-line string`, () => {
      expect(
        invalidEscapes(text),
        `${file} contains a backslash TOML cannot read. Windows paths are the usual cause — write ` +
          `%LOCALAPPDATA%/Compy/compy.exe with forward slashes, or double the backslash.`,
      ).toEqual([]);
    });
  }
});

// ── Falsification ────────────────────────────────────────────────────────────────────────────────
describe("the escape check actually fires", () => {
  it("catches the exact line that was almost committed", () => {
    const almost = 'x = """\nrelaunch `%LOCALAPPDATA%\\Compy\\compy.exe` plainly\n"""';
    expect(invalidEscapes(almost)).toEqual(["line 2: \\C", "line 2: \\c"]);
  });

  it("accepts a doubled backslash, which is how a path may be written", () => {
    expect(invalidEscapes('x = """\n%LOCALAPPDATA%\\\\Compy\\\\compy.exe\n"""')).toEqual([]);
  });

  it("accepts the escapes TOML defines, including the line-ending fold", () => {
    expect(invalidEscapes('x = """\na\\tb\\nc\\"d\\u00e9e\\\nf\n"""')).toEqual([]);
  });

  it("ignores a backslash outside any \"\"\" block", () => {
    expect(invalidEscapes('# a comment about C:\\Windows\nname = "plain"')).toEqual([]);
  });

  it("catches an unterminated block", () => {
    expect(basicMultilineRanges('x = """\nnever closed\n').unterminated).toBe(true);
  });
});
