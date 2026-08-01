// Guard: the console must never pin the folder it was launched from.
//
// Caught on 2026-08-01, right after PR #41 merged. `git worktree remove` on the finished
// sentinel-console worktree failed with ERROR_SHARING_VIOLATION against a directory git had
// already emptied. Nothing in the process table looked responsible — no node, no pwsh, no
// Explorer window. Reading each process's PEB found the holder: eleven Firefox processes whose
// CURRENT DIRECTORY was the worktree. `Start-Process $url` had handed the browser the launching
// shell's cwd, and a browser keeps that handle for its entire lifetime. The only way to free the
// folder was killing the user's browser.
//
// The class of bug matters more than the instance: EVERY worktree the console has ever been
// opened from stays undeletable until the browser closes. That silently breaks the whole
// worktree-per-work-item workflow this repo is built on.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const START_PS1 = readFileSync(join(here, "start.ps1"), "utf8");

/** Every `Start-Process ...` invocation in the script, one entry per line it appears on. */
const invocations = () =>
  START_PS1.split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /^\s*Start-Process\b/.test(line) || /\bStart-Process\b/.test(line))
    .filter(({ line }) => !line.startsWith("#"));

describe("start.ps1 never leaves a process pinning a disposable directory", () => {
  it("finds the launches it is supposed to be checking", () => {
    // A rename or refactor that removes these lines must not turn this suite green by accident.
    expect(invocations().length).toBeGreaterThanOrEqual(2);
  });

  it("EVERY Start-Process names an explicit -WorkingDirectory", () => {
    for (const { line, n } of invocations()) {
      expect(line, `start.ps1:${n} launches a process with an inherited cwd`).toMatch(
        /-WorkingDirectory\s+\S/,
      );
    }
  });

  it("the browser is handed a directory nobody will ever delete — NOT the repo", () => {
    const browser = invocations().filter(({ line }) => /\$url\b/.test(line));
    expect(browser.length, "no browser launch found to check").toBe(1);

    const [{ line, n }] = browser;
    expect(line, `start.ps1:${n} would pin the repo open`).not.toMatch(
      /-WorkingDirectory\s+\$repo\b/,
    );
    expect(line, `start.ps1:${n} must aim the browser somewhere disposable-safe`).toMatch(
      /-WorkingDirectory\s+\$env:USERPROFILE\b/,
    );
  });

  it("the SERVER, by contrast, still runs in the repo — it has to resolve tools/console from there", () => {
    const server = invocations().filter(({ line }) => /server\.mjs/.test(line));
    expect(server.length).toBe(1);
    expect(server[0].line).toMatch(/-WorkingDirectory\s+\$repo\b/);
  });
});

describe("the failure this replaces is described, not just fixed", () => {
  it("start.ps1 records WHY the browser gets its own working directory", () => {
    // A future reader deleting the -WorkingDirectory as noise is exactly how this returns.
    expect(START_PS1).toMatch(/INHERITS the launching shell's working directory/i);
  });
});
