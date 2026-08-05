// Guard: a CLI's "am I the main module?" check must be true on every platform.
//
// Why this exists. Six `tools/entry/*.mjs` CLIs guarded their main block with a
// hand-built file URL:
//
//     import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`
//
// That is correct on Windows and false on POSIX. A Windows path has no leading
// slash, so `file:///` + `C:/x` is right; a POSIX path already starts with one,
// so the template yields `file:////home/...` against Node's `file:///home/...`.
// Four slashes versus three. On Linux the main block simply never ran: the CLI
// printed nothing and exited 0, and the test harness read that empty stdout as a
// mystery rather than a failure. `main` was red for two days behind it.
//
// The idiom is not a matter of taste — `pathToFileURL` is the only form that is
// correct on both platforms, and eight files under `scripts/` already used it.
// This guard pins the whole repo to the form the repo already agreed on, and it
// runs identically on Windows and Linux, which the bug it replaces did not.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["tools", "scripts", ".claude"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target"]);

/** Every .mjs file under the tooling roots, repo-relative, sorted. */
function toolingModules() {
  const found = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs)) {
      if (SKIP_DIRS.has(entry)) continue;
      const childAbs = join(abs, entry);
      const childRel = rel ? `${rel}/${entry}` : entry;
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
      else if (entry.endsWith(".mjs")) found.push(childRel);
    }
  };
  for (const root of ROOTS) {
    const abs = join(repoRoot, root);
    try {
      if (statSync(abs).isDirectory()) walk(abs, root);
    } catch {
      // A root that does not exist is not a failure — the repo may drop one.
    }
  }
  return found.sort();
}

/**
 * The canonical form, and the only one this repo accepts:
 *
 *     import.meta.url === pathToFileURL(process.argv[1]).href
 *
 * A leading `process.argv[1] &&` is allowed (argv[1] is undefined under `node -e`,
 * and pathToFileURL(undefined) throws). Nothing else is.
 */
const CANONICAL = /import\.meta\.url\s*===\s*pathToFileURL\(\s*process\.argv\[1\]\s*\)\.href/;

/** Any comparison against import.meta.url — i.e. "this file decides if it is main". */
const ANY_MAIN_CHECK = /import\.meta\.url\s*={2,3}/;

/**
 * Prose that QUOTES the broken idiom is not the broken idiom.
 *
 * This file's own header shows the bad line so the next reader knows what was wrong, and the first
 * run of this guard duly failed on it. A comment cannot execute, so it cannot be the defect — but
 * the exemption is deliberately narrow: only a line that is comment from its first character. A
 * trailing `// ...` after real code stays scanned, because that is where a genuine one could hide.
 */
const IS_COMMENT_LINE = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

const modules = toolingModules();

describe("main-module detection", () => {
  it("scans a non-trivial set of tooling modules", () => {
    // If the walker silently finds nothing, every assertion below passes
    // vacuously and the guard is decorative. Pin that it actually looked.
    expect(modules.length).toBeGreaterThan(20);
  });

  it.each(modules)("%s uses pathToFileURL, not a hand-built file URL", (rel) => {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    const lines = src.split(/\r?\n/);

    for (const [i, line] of lines.entries()) {
      if (IS_COMMENT_LINE(line)) continue;
      if (!ANY_MAIN_CHECK.test(line)) continue;
      expect(
        CANONICAL.test(line),
        `${rel}:${i + 1} compares import.meta.url without pathToFileURL:\n` +
          `    ${line.trim()}\n` +
          `  Hand-built file URLs are Windows-only. Use:\n` +
          `    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`,
      ).toBe(true);
    }
  });

  it.each(modules)("%s carries the node:url import if it needs one", (rel) => {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    if (!src.includes("pathToFileURL")) return;
    expect(src, `${rel} uses pathToFileURL without importing it`).toMatch(
      /import\s*\{[^}]*\bpathToFileURL\b[^}]*\}\s*from\s*["']node:url["']/,
    );
  });
});

describe("why the old idiom was wrong", () => {
  // These two run the same on both platforms: they compare strings, they do not
  // ask the host OS anything. That is the point — the bug was invisible on
  // Windows precisely because the old check asked the host.
  const handBuilt = (argv1) => `file:///${argv1?.replace(/\\/g, "/")}`;

  it("agrees with Node on a Windows path", () => {
    const argv1 = "C:\\Users\\Kuya\\code\\sentinel\\tools\\entry\\control-update.mjs";
    expect(handBuilt(argv1)).toBe("file:///C:/Users/Kuya/code/sentinel/tools/entry/control-update.mjs");
  });

  it("disagrees with Node on a POSIX path — one slash too many", () => {
    const argv1 = "/home/runner/work/sentinel/sentinel/tools/entry/control-update.mjs";
    const nodeSays = "file:///home/runner/work/sentinel/sentinel/tools/entry/control-update.mjs";
    expect(handBuilt(argv1)).toBe(`file:////home/runner/work/sentinel/sentinel/tools/entry/control-update.mjs`);
    expect(handBuilt(argv1)).not.toBe(nodeSays);
  });

  it("pathToFileURL round-trips this very file on whatever platform is running", () => {
    expect(pathToFileURL(fileURLToPath(import.meta.url)).href).toBe(import.meta.url);
  });
});
