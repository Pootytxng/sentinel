// Guard: the local pre-push gate must not be weaker than the hosted gate it replaced.
//
// bug->guard, 2026-08-10. GitHub's free Actions allowance was exhausted twice. The second time,
// July's per-run cost-cutting was already in place and `scripts/ci-budget-guard.test.mjs` was green
// -- because it projected cost from a hard-coded RUNS_PER_MONTH = 122 while reality ran ~570. So
// .github/workflows/ci.yml became manual-only and verification moved to scripts/verify-local.ps1,
// run from .githooks/pre-push on the owner's machine for zero minutes.
//
// That move is only safe while the local gate actually proves what CI proved. Nothing structural
// stops someone deleting a line from a PowerShell script, and the failure would be silent in the
// worst possible way: a green push, from a gate that stopped checking. This file is the thing that
// notices. It derives its expectations from ci.yml itself, so the two cannot drift apart by edit.
//
// Deliberately dependency-free, for the same reason ci-budget-guard is: a guard that protects the
// build must not be one `npm install` away from being unable to run.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const exists = (rel) => existsSync(join(ROOT, ...rel.split("/")));

const gate = read("scripts/verify-local.ps1");
const setup = read("scripts/setup-local-ci.ps1");
const hook = read(".githooks/pre-push");
const ci = read(".github/workflows/ci.yml");
const pkg = JSON.parse(read("package.json"));

/**
 * PowerShell comment lines stripped. Borrowed from gate-residency-guard: a check that appears only
 * in a comment is prose, and prose does not fail a build. Every assertion about what the gate RUNS
 * is made against this, never against the raw text.
 */
const psCode = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

const gateCode = psCode(gate);

/** Does the gate run this command? Compared token-wise, because ci.yml writes shell strings and the
 *  PowerShell gate writes argument arrays -- `cargo test --manifest-path x` vs @("test", ...). */
const gateRuns = (command) =>
  command
    .trim()
    .split(/\s+/)
    .every((token) => gateCode.includes(token));

describe("the local gate proves everything the hosted gate proved", () => {
  // The four checks CI existed to run. Each is asserted BOTH ways below: present in the local gate,
  // and present in ci.yml -- so this list cannot quietly become a description of one file only.
  const CHECKS = [
    "npm test",
    "npm run build",
    "cargo test --manifest-path src-tauri/Cargo.toml",
    "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets",
  ];

  it.each(CHECKS)("verify-local.ps1 runs %s", (command) => {
    expect(gateRuns(command)).toBe(true);
  });

  it.each(CHECKS)("ci.yml still names %s, so the list above is not a fiction", (command) => {
    // If CI's steps are ever rewritten, this goes red and someone re-derives CHECKS deliberately
    // rather than discovering months later that the local gate was pinned to a ghost.
    expect(command.split(/\s+/).every((token) => ci.includes(token))).toBe(true);
  });

  it("denies clippy warnings, which is the whole point of running clippy", () => {
    // `-D warnings` is one token pair away from being a lint that reports and passes.
    expect(gateCode).toMatch(/-D/);
    expect(gateCode).toMatch(/warnings/);
  });

  it("fails the run when any single check fails, rather than reporting the last one", () => {
    // Without this, four checks run and only the exit code of the last is believed.
    expect(gateCode).toMatch(/\$LASTEXITCODE -ne 0/);
    expect(gateCode).toMatch(/throw/);
  });

  it("covers every verification step ci.yml runs — including ones added after this was written", () => {
    // The drift catcher. Anything in ci.yml's `run:` steps that is not declared setup below must be
    // covered by the local gate. Add a check to CI and forget the desk, and this goes red.
    const runs = [...ci.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1].trim()).filter((c) => c !== "|");
    const SETUP = [/^rustc --version/, /^npm ci/, /^git config/, /^git fetch/, /^npm run stage:site/];
    const uncovered = runs.filter((c) => !SETUP.some((re) => re.test(c))).filter((c) => !gateRuns(c));
    expect(uncovered).toEqual([]);
  });
});

describe("the differences from hosted CI are declared, not accidental", () => {
  // Honest parity beats fake parity. Where the local gate deliberately does something else, the
  // reason lives here, in a diff, rather than in someone's memory.
  it("does not silently skip the site staging step", () => {
    // ci.yml ran `npm run stage:site`; the local gate does not. Guard B of
    // dist-site-staleness-guard only runs when dist-site/ exists, and dist-site/ is gitignored, so
    // locally it skips rather than fails. The three site guards themselves DO run either way --
    // they build site-app on their own, which is why the gate installs site-app's dependencies.
    // Staging on every push would add an Astro build to every push for one conditional guard.
    // Recorded as a known gap, checked by verify-release.ps1 at release time instead.
    expect(gate).toMatch(/site-app/);
    expect(gateCode).toMatch(/--prefix/);
  });

  it("installs dependencies rather than trusting a parent directory's node_modules", () => {
    // The worktree trap: Node walks UP to find node_modules, so a worktree runs against the main
    // checkout's tree and every guard that checks a RELATIVE path invents a failure. That is how
    // canvas-a11y-guard reported a moved r3f declaration file that had never moved.
    //
    // The bootstrap asks scripts/deps-satisfied.ps1 whether the tree satisfies the manifest, rather
    // than whether a directory exists -- that weaker question let the same phantom through again on
    // 2026-08-11. What the bootstrap must DO lives here; what "installed" means, and the proof that
    // a partial tree triggers a reinstall, live in scripts/deps-bootstrap-guard.test.mjs.
    expect(gateCode).toMatch(/Test-DependenciesSatisfied/);
    expect(gateCode).toMatch(/\bci\b/);
    expect(exists("scripts/deps-satisfied.ps1")).toBe(true);
  });
});

describe("the gate is wired to something that runs it", () => {
  it("is exposed as an npm script", () => {
    expect(pkg.scripts?.["verify:local"]).toBeDefined();
    expect(pkg.scripts["verify:local"]).toContain("scripts/verify-local.ps1");
  });

  it("has a pre-push hook that invokes it", () => {
    expect(exists(".githooks/pre-push")).toBe(true);
    expect(hook).toContain("verify-local.ps1");
  });

  it("has a setup script that points git at the tracked hooks directory", () => {
    // setup-local-ci.ps1 is the one-time wiring. Without core.hooksPath the hook file is inert, and
    // an inert hook is indistinguishable from a passing one.
    expect(psCode(setup)).toMatch(/core\.hooksPath/);
    expect(psCode(setup)).toMatch(/\.githooks/);
  });

  it("pre-flights core.bare before spending four minutes on the gate", () => {
    expect(hook).toMatch(/core\.bare/);
  });

  it("scrubs git's hook environment before running anything", () => {
    // bug->guard, 2026-08-11, and the bug was this hook's own. Git exports GIT_DIR to every hook and
    // every descendant inherits it. The gate's first step is `npm test`, and this suite builds REAL
    // git fixtures -- `git init --bare`, `git worktree add`, `git checkout main` against temp dirs.
    // Those all take GIT_DIR over their own cwd and arguments, so under the hook they retargeted the
    // developer's actual repository: core.bare=true written into the real .git/config, and the real
    // worktree checked out onto main with its work staged. Three times in one session.
    //
    // The variables asserted here are the ones that redirect WHICH repo a command acts on or WHERE
    // it writes. Anything less than all of them leaves a hole of exactly the same shape.
    const scrub = hook.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#")).join("\n");
    for (const varName of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_COMMON_DIR",
      "GIT_INDEX_FILE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_QUARANTINE_PATH",
    ]) {
      expect(scrub, `pre-push must unset ${varName} before invoking the gate`).toContain(varName);
    }
    expect(scrub).toMatch(/^unset /m);

    // Order is load-bearing: the repo root has to be resolved while the hook environment is still
    // intact, and the gate has to be invoked after it is gone.
    expect(scrub.indexOf("--show-toplevel")).toBeLessThan(scrub.indexOf("unset "));
    expect(scrub.indexOf("unset ")).toBeLessThan(scrub.indexOf("verify-local.ps1"));
  });

  it("keeps the hook bypassable only on purpose", () => {
    // `git push --no-verify` exists and always will. What must not exist is a hook that passes by
    // accident: the shell script has to stop on the first error rather than run on.
    expect(hook).toMatch(/set -e/);
  });
});

describe("the checkout the gate runs in is one git will actually operate on", () => {
  // bug->guard, 2026-08-11. `core.bare = true` appeared three times in one session in the SHARED
  // .git/config. Git then refuses every work-tree operation repo-wide -- main checkout and all ~12
  // worktrees at once -- and each time the acting worktree also came back on `main`.
  //
  // The emitter WAS this repo's own pre-push hook leaking GIT_DIR into the test suite; that is fixed
  // at the source in .githooks/pre-push and pinned by the scrub test above. This detector stays
  // anyway, for two reasons. A corrupted .git/config is worth catching however it got that way --
  // the very first occurrence followed `gh pr merge --squash --delete-branch` failing its local
  // branch deletion, a path that has nothing to do with hooks (which is why that flag is now
  // banned). And the diagnosis only became possible once something asserted the condition by name:
  // the run that finally isolated it was the one where this test went red instead of the seven
  // unrelated files that had been going red for two cycles.
  //
  // What makes it worth a guard rather than a note: it is silent and it lies. `git worktree list`
  // and the .git pointer files all look correct, so it reads as worktree damage. Downstream it
  // surfaces as a scatter of unrelated red: tools/entry/tracked-hooks.test.mjs claimed
  // `.claude/settings.local.json` was no longer gitignored, when .gitignore contained it all along
  // and `git check-ignore` was simply exiting 128. Every one of those failures names the wrong
  // thing. This one names the right thing, and carries its repair (flags-name-it-and-fix-it-inline).
  //
  // DO NOT re-prove this by toggling core.bare on. It was proven RED once, deliberately, on
  // 2026-08-11 and the assertion message below is that run's actual output. Every time core.bare
  // went true here, the acting worktree also came back on `main` with its work staged -- which is
  // how a `git reset --hard` once landed on local main instead of a feature branch. The repair is
  // `git checkout <branch>`, but the cheap way to keep it is to not run the experiment.
  const git = (...args) => {
    try {
      return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };

  it("is not marked bare", () => {
    expect(
      git("config", "--get", "core.bare"),
      "core.bare is true in the shared .git/config, so git refuses every work-tree operation here " +
        "and in every other worktree. Repair with:  git config core.bare false",
    ).not.toBe("true");
  });

  it("can answer work-tree questions, which half the repo's guards shell out to ask", () => {
    expect(git("rev-parse", "--is-inside-work-tree")).toBe("true");
  });
});
