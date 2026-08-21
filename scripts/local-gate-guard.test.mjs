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
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { windows, WINDOWS_ONLY } from "./lib/windows-only.mjs";

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

  // #171 (2026-08-20): Node 24 on Windows can abort inside process.exit() (nodejs/node#56645) and
  // report 0xC0000409 instead of the check's own verdict. The gate re-runs a Node-hosted check ONCE
  // on exactly that code. These pins keep that from ever widening into retry-until-green.
  describe("the Node-runtime-abort re-run stays narrow", () => {
    const invokeCheck = gateCode.slice(gateCode.indexOf("function Invoke-Check"), gateCode.indexOf("function Resolve-RequiredCommand"));

    it("re-runs only on the 0xC0000409 abort code, in both the Int32 and unsigned spellings", () => {
      expect(gateCode).toMatch(/\$NodeRuntimeAbortCodes = @\(-1073740791, 3221226505\)/);
      expect(invokeCheck).toMatch(/\$NodeRuntimeAbortCodes -contains \$LASTEXITCODE/);
    });

    it("re-runs at most once: exactly two invocations of the command exist, and the throw follows the second", () => {
      const invocations = invokeCheck.match(/& \$Command @Arguments/g) ?? [];
      expect(invocations).toHaveLength(2);
      expect(invokeCheck.indexOf("throw")).toBeGreaterThan(invokeCheck.lastIndexOf("& $Command @Arguments"));
      // No loop may wrap the re-run.
      expect(invokeCheck).not.toMatch(/\b(while|for|do)\b/);
    });

    it("is opt-in per check and only the two npm checks opt in; cargo never does", () => {
      expect(invokeCheck).toMatch(/\$NodeHosted -and/);
      const calls = gateCode.split(/\r?\n/).filter((l) => l.trimStart().startsWith("Invoke-Check "));
      const nodeHosted = calls.filter((l) => l.includes("-NodeHosted"));
      expect(nodeHosted.map((l) => l.match(/-Name "([^"]+)"/)[1]).sort()).toEqual(["frontend tests", "frontend type-check and build"]);
      for (const line of calls.filter((l) => l.includes("$cargo"))) expect(line).not.toContain("-NodeHosted");
    });

    it("says out loud that it happened, naming the upstream cause, so a repeat is never silent", () => {
      expect(invokeCheck).toMatch(/LOCAL CHECK WARN: .*0xC0000409.*nodejs\/node#56645/);
    });

    // The source pins above say what the text looks like; this says what it DOES. The real
    // Invoke-Check is lifted out of verify-local.ps1 by PowerShell's own parser (so the gate's
    // top-level checks never run) and driven against a node child that exits with a scripted code
    // per call. Windows PowerShell 5.1, because that is what .githooks/pre-push invokes.
    it.runIf(windows)(`re-runs the abort exactly once, and nothing else, when actually executed ${WINDOWS_ONLY}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "compy-gate-rerun-"));
      try {
        const stub = join(dir, "stub.js");
        writeFileSync(
          stub,
          [
            'const fs = require("fs");',
            "const [plan, counter] = process.argv.slice(2);",
            'let n = 0; try { n = Number(fs.readFileSync(counter, "utf8")); } catch {}',
            "fs.writeFileSync(counter, String(n + 1));",
            "process.exitCode = plan.split(\",\").map(Number)[n] ?? 99;",
          ].join("\n"),
        );
        const probe = join(dir, "probe.ps1");
        writeFileSync(
          probe,
          [
            '$ErrorActionPreference = "Stop"',
            `$ast = [System.Management.Automation.Language.Parser]::ParseFile(${JSON.stringify(join(ROOT, "scripts", "verify-local.ps1"))}, [ref]$null, [ref]$null)`,
            '$fn = $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $args[0].Name -eq "Invoke-Check" }, $true)[0]',
            "$codes = $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.AssignmentStatementAst] -and $args[0].Left.Extent.Text -eq '$NodeRuntimeAbortCodes' }, $true)[0]",
            "Invoke-Expression $codes.Extent.Text",
            "Invoke-Expression $fn.Extent.Text",
            `$node = ${JSON.stringify(process.execPath)}`,
            `$stub = ${JSON.stringify(stub)}`,
            "function Run-Case($name, $plan, [switch]$NodeHosted) {",
            `  $counter = Join-Path ${JSON.stringify(dir)} "calls-$name.txt"`,
            "  $threw = ''",
            "  try {",
            "    if ($NodeHosted) { Invoke-Check -Name $name -Command $node -Arguments @($stub, $plan, $counter) -NodeHosted }",
            "    else { Invoke-Check -Name $name -Command $node -Arguments @($stub, $plan, $counter) }",
            "  } catch { $threw = $_.Exception.Message }",
            '  Write-Output ("RESULT " + $name + " calls=" + [int](Get-Content $counter) + " threw=" + $threw)',
            "}",
            'Run-Case "abort-then-pass" "-1073740791,0" -NodeHosted',
            'Run-Case "abort-then-abort" "-1073740791,-1073740791" -NodeHosted',
            'Run-Case "real-failure" "1,0" -NodeHosted',
            'Run-Case "abort-not-node-hosted" "-1073740791,0"',
            'Run-Case "pass-first-time" "0,0" -NodeHosted',
          ].join("\n"),
        );
        const run = spawnSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", probe],
          { cwd: ROOT, encoding: "utf8", shell: false, windowsHide: true },
        );
        const out = run.stdout || "";
        expect(run.status, `probe failed: ${run.stderr}\n${out}`).toBe(0);
        const results = Object.fromEntries(
          [...out.matchAll(/^RESULT (\S+) calls=(\d+) threw=(.*)$/gm)].map((m) => [m[1], { calls: Number(m[2]), threw: m[3].trim() }]),
        );
        expect(results["abort-then-pass"]).toEqual({ calls: 2, threw: "" });
        expect(results["abort-then-abort"]).toEqual({ calls: 2, threw: "abort-then-abort failed with exit code -1073740791." });
        expect(results["real-failure"]).toEqual({ calls: 1, threw: "real-failure failed with exit code 1." });
        expect(results["abort-not-node-hosted"]).toEqual({ calls: 1, threw: "abort-not-node-hosted failed with exit code -1073740791." });
        expect(results["pass-first-time"]).toEqual({ calls: 1, threw: "" });
        // The WARN is printed once per abort that was re-run, and names the cause.
        expect(out.match(/LOCAL CHECK WARN: .*0xC0000409.*nodejs\/node#56645/g)).toHaveLength(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);
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

  it("skips the gate ONLY for a push that is entirely deletions", () => {
    // bug->guard, 2026-08-18, and the bug was this gate deadlocking itself. `git push origin
    // --delete <merged-branch>` runs this hook, which runs the disposition audit, which fails
    // BECAUSE that ref still exists on origin — the gate blocking the push that would satisfy it.
    // Two lanes hit it in one session and paid five commits of disposition-row churn to get out.
    //
    // The skip is safe for exactly one reason: a deletion cannot introduce code. So the guard's
    // job is to keep it that narrow. It must key off the all-zero LOCAL sha git puts on a delete
    // line, and it must require EVERY line to be one — a mixed push (delete + update) runs the
    // full gate. A skip that widened to "any push containing a deletion" would be a hole.
    const code = hook.split(/\r?\n/).filter((l) => !l.trimStart().startsWith("#")).join("\n");
    expect(code, "the deletion skip must read the ref lines git sends on stdin").toMatch(
      /refs="\$\(cat\)"/,
    );
    expect(code, "the skip must key off the all-zero local sha, not a branch name or a flag").toMatch(
      /0\\{40\\}/,
    );
    // `grep -qv <not-a-delete>` negated: skip only when NO line fails the delete shape.
    expect(code, "the skip must require every line to be a deletion").toMatch(/!\s*printf[^|]*\|\s*grep -qv/);
    // And it has to be decided before the gate is spent, not after.
    expect(code.indexOf('refs="$(cat)"')).toBeLessThan(code.indexOf("verify-local.ps1"));
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
