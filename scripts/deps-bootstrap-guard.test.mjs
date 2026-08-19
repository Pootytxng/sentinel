// @vitest-environment node
//
// Guard: the pre-push gate's dependency bootstrap must decide from the TREE, not from a directory.
//
// bug->guard, 2026-08-11, and it is the second guard for one bug because the first fix stopped one
// step short. On 2026-08-10 scripts/verify-local.ps1 gained a bootstrap so that a git worktree would
// stop running its guards against the MAIN checkout's node_modules -- Node walks UP to resolve
// node_modules, so a worktree with none of its own runs happily against the parent's, and every
// guard that checks a RELATIVE path then invents a failure. The one that fired was
// src/canvas-a11y-guard.test.ts: "@react-three/fiber/dist/declarations/src/web/Canvas.d.ts moved".
// It had not moved.
//
// The bootstrap gated on `Test-Path node_modules`. A directory existing is not the same fact as
// dependencies being installed, so on 2026-08-11, in worktree .claude/worktrees/admiring-lumiere-648403,
// a node_modules that existed and did not contain @react-three/fiber (a later `npm install` added
// 489 packages) skipped `npm ci` and produced THE SAME FAILURE, naming the same package, blocking a
// push whose diff had nothing to do with r3f.
//
// What this file pins, and why each half is here:
//
//   BEHAVIOURAL   scripts/deps-satisfied.ps1 is run against real fixture trees, including the exact
//                 shape that got through -- a finished-looking node_modules with a declared package
//                 missing. Static text assertions could not have caught the original bug either:
//                 `Test-Path node_modules` reads as a perfectly good dependency check. Only running
//                 it against a partial tree says otherwise.
//   STATIC        verify-local.ps1 actually delegates to it, and no longer decides from existence.
//                 A correct helper nothing calls is the same gate hole with more files.
//
// The behavioural half needs Windows PowerShell; the static half does not and runs everywhere.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

// GATE RELIABILITY (2026-08-19): every behavioural test below spawns powershell.exe, which runs
// `npm ls` against a real fixture tree. That is seconds of process + disk work per test even on an
// idle machine, and the pre-push gate runs this file alongside 341 others at full parallelism --
// where it blew the 15s default twice in a row and failed a push that had nothing wrong with it.
// The timeout is not the assertion; raising it changes nothing about what these tests prove.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
import { windows, WINDOWS_ONLY } from "./lib/windows-only.mjs";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = join(ROOT, "scripts", "deps-satisfied.ps1");
const read = (rel) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");

/** PowerShell comments stripped: a check that lives in a comment is prose, and prose does not fail a
 *  build. Same idiom as local-gate-guard and gate-residency-guard. */
const psCode = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

// ------------------------------------------------------------------------------------------------
// Fixtures. Each is a minimal npm project; the differences between them are the whole point.
// ------------------------------------------------------------------------------------------------
let sandbox;
beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "compy-deps-bootstrap-"));
});
afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

const OLDER = new Date("2026-08-01T00:00:00Z");
const NEWER = new Date("2026-08-09T00:00:00Z");

/**
 * A minimal but REALISTIC npm project. Realistic matters more than minimal here: npm's own tree
 * reader consults node_modules/.package-lock.json, so a stub hidden lockfile makes `npm ls` report
 * a package that IS on disk as unmet. A fixture that lies in a way npm never would would have
 * proven nothing about the case this guard is for.
 *
 * @param tree       "none" (no node_modules) | "unfinished" (no hidden lockfile) |
 *                   "partial" (hidden lockfile claims the package; the directory is absent) |
 *                   "complete"
 * @param staleLock  package-lock.json has moved since the install wrote its marker
 */
const fixture = (name, { tree, staleLock = false } = {}) => {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `fixture-${name}`, version: "1.0.0", dependencies: { "fixture-dep": "^1.0.0" } }),
  );
  const lock = {
    name: `fixture-${name}`,
    lockfileVersion: 3,
    packages: { "node_modules/fixture-dep": { version: "1.2.3", resolved: "https://example.invalid/fixture-dep-1.2.3.tgz" } },
  };
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));

  if (tree !== "none") {
    const modules = join(dir, "node_modules");
    mkdirSync(modules, { recursive: true });

    if (tree === "complete") {
      const dep = join(modules, "fixture-dep");
      mkdirSync(dep, { recursive: true });
      writeFileSync(join(dep, "package.json"), JSON.stringify({ name: "fixture-dep", version: "1.2.3" }));
    }
    if (tree !== "unfinished") {
      // npm writes this hidden lockfile as its last act, so its presence is the tree's claim to have
      // been installed by a completed `npm ci` / `npm install`. In the "partial" fixture that claim
      // is false, which is exactly the shape that got through on 2026-08-11.
      const marker = join(modules, ".package-lock.json");
      writeFileSync(marker, JSON.stringify(lock));
      if (staleLock) utimesSync(marker, OLDER, OLDER);
    }
  }
  // The declared lock predates the install marker, unless a fixture is testing the lock having moved
  // since. Both dates are in the past: a marker mtime in the future changes how npm reads the tree.
  const lockAt = staleLock ? NEWER : OLDER;
  utimesSync(join(dir, "package-lock.json"), lockAt, lockAt);
  return dir;
};

/** Runs the helper standalone. Exit 0 = satisfied, 1 = needs install; stdout carries the reason. */
const probe = (dir) => {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", HELPER, "-Path", dir],
    { cwd: ROOT, encoding: "utf8", shell: false, windowsHide: true },
  );
  return { needsInstall: result.status !== 0, reason: (result.stdout || "").trim(), stderr: result.stderr };
};

describe.runIf(windows)(`the bootstrap reinstalls a tree that does not satisfy its manifest ${WINDOWS_ONLY}`, () => {
  it("THE 2026-08-11 CASE: a finished-looking node_modules missing a declared package", () => {
    // This is the shape that got through. node_modules exists, npm's own marker is present and
    // newer than package-lock.json, and the declared dependency is simply not there -- which is
    // what canvas-a11y-guard then reported as a moved declaration file.
    const verdict = probe(fixture("partial", { tree: "partial" }));
    expect(verdict.needsInstall, `partial tree reported as satisfied: ${verdict.reason} ${verdict.stderr}`).toBe(true);
    expect(verdict.reason).toMatch(/npm ls/i);
  });

  it("a node_modules that no install ever finished writing", () => {
    const verdict = probe(fixture("unfinished", { tree: "unfinished" }));
    expect(verdict.needsInstall).toBe(true);
    expect(verdict.reason).toMatch(/\.package-lock\.json/);
  });

  it("no node_modules at all -- the case the old check did get right", () => {
    const verdict = probe(fixture("absent", { tree: "none" }));
    expect(verdict.needsInstall).toBe(true);
    expect(verdict.reason).toMatch(/absent/i);
  });

  it("a satisfied tree whose package-lock.json has moved since the install", () => {
    const verdict = probe(fixture("stale", { tree: "complete", staleLock: true }));
    expect(verdict.needsInstall).toBe(true);
    expect(verdict.reason).toMatch(/newer/i);
  });

  it("leaves a genuinely satisfied tree alone, so the gate does not reinstall on every push", () => {
    // The other direction matters too. A check that always says "install" would pass every test
    // above while adding a minute to every push, and the first person to notice would delete it.
    const verdict = probe(fixture("complete", { tree: "complete" }));
    expect(verdict.needsInstall, `satisfied tree reported as needing install: ${verdict.reason} ${verdict.stderr}`).toBe(false);
    expect(verdict.reason).toMatch(/satisfies/i);
  });

  it("says nothing needs installing where there is no package.json", () => {
    const dir = join(sandbox, "not-a-project");
    mkdirSync(dir, { recursive: true });
    expect(probe(dir).needsInstall).toBe(false);
  });
});

describe("the gate actually asks that question", () => {
  const gateCode = psCode(read("scripts/verify-local.ps1"));

  it("delegates to the shared probe rather than carrying its own idea of installed", () => {
    expect(gateCode).toMatch(/deps-satisfied\.ps1/);
    expect(gateCode).toMatch(/Test-DependenciesSatisfied/);
  });

  it("never decides from a directory existing, which is the bug this file is named after", () => {
    // The original line was `if (-not (Test-Path (Join-Path $repo "node_modules")))`. Any Test-Path
    // whose argument is a node_modules path is that same decision wearing different parentheses.
    const existenceChecks = gateCode
      .split(/\r?\n/)
      .filter((line) => /Test-Path/.test(line) && /node_modules/.test(line));
    expect(existenceChecks, `directory-existence bootstrap is back: ${existenceChecks.join(" | ")}`).toEqual([]);
  });

  it("bootstraps site-app on the same terms as the root, not on weaker ones", () => {
    // site-app was the second half of the original bug: without its dependencies the three site
    // guards fail with "site-app dependencies missing", which is a setup step wearing the costume of
    // a broken test. It must be probed, not merely mentioned.
    const probed = [...gateCode.matchAll(/Test-DependenciesSatisfied[^\n]*|Confirm-Dependencies[^\n]*/g)].map((m) => m[0]);
    expect(probed.some((line) => /site-app/.test(line))).toBe(true);
  });

  it("still installs with `npm ci`, so the tree matches the lock rather than drifting from it", () => {
    expect(gateCode).toMatch(/"ci"/);
    expect(gateCode).toMatch(/--prefix/);
  });
});

describe("the probe cannot quietly become an answer that is always yes", () => {
  const helper = psCode(read("scripts/deps-satisfied.ps1"));

  it("consults npm itself, which is the only probe that knows about optional packages", () => {
    // A hand-rolled walk of package-lock.json would flag every @rollup/rollup-linux-* entry as
    // missing on Windows and reinstall forever. npm ls applies npm's own rules.
    expect(helper).toMatch(/"ls"/);
    // The exit code is the answer, and it has to be read from npm rather than inferred.
    expect(helper).toMatch(/\$LASTEXITCODE/);
    expect(helper).toMatch(/-ne 0/);
  });

  it("does not let npm's stderr become a terminating error under the gate's ErrorActionPreference", () => {
    // verify-local.ps1 runs with "Stop". npm ls writes to stderr exactly when it is answering the
    // question, so a throw there would abort the gate instead of triggering an install.
    expect(helper).toMatch(/ErrorActionPreference = "Continue"/);
    expect(helper).toMatch(/finally/);
  });
});

