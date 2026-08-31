// Guard: no worktree may be silently disarmed, and this guard may not silently pass either.
//
// bug->guard, 2026-08-30, REPAIRED 2026-08-31 (issue #276). `.githooks/pre-push` runs
// scripts/verify-local.ps1 and is the ONLY automated verification this repo has --
// .github/workflows/ci.yml went workflow_dispatch-only on 2026-08-10, so pull requests carry no
// status checks by design. That makes the hook the whole gate.
//
// Git fails OPEN here, and says nothing while doing it: when core.hooksPath names a directory that
// does not exist, git does not warn and does not error, it simply runs no hook. A push from such a
// worktree is indistinguishable from a push that passed the gate. Two ways in were both measured on
// this machine on 2026-08-30:
//
//   1. An ABSOLUTE core.hooksPath pointing into a DIFFERENT worktree. Three worktrees pointed at
//      sentinel-mission2-live-alignment/.githooks. Removing that unrelated lane -- an ordinary,
//      encouraged cleanup -- would have disarmed all three at once.
//   2. A checkout OLDER than the hook itself. feat/user-feedback-lab-recovery (05990130) and
//      feat/lab-49-parity-port (7e6cd4d7) both predate 670d9b74, the commit that added .githooks.
//      They inherited the correct relative value and still had no hook, because their own checkout
//      has no .githooks directory to find. Both had been pushing with zero verification for weeks.
//
// THE REPAIR, and why the first version was not enough. Every one of these turned "I could not
// tell" into "fine", which is the one answer a safety check may never give:
//
//   - `try { execFileSync } catch { return "" }` collapsed four outcomes into one empty string: key
//     absent (benign), config unreadable, config malformed, git did not run. Only the first was
//     safe to ignore and the caller could not tell which it had. Now every git call reports status,
//     stdout, stderr and spawn failure separately, and only a documented exit-1-with-clean-stderr
//     counts as "absent".
//   - An unset core.hooksPath was SKIPPED. A registered worktree that is not wired runs no hook at
//     all; treating that as out of scope means the guard passes hardest on the checkouts with the
//     least protection.
//   - `existsSync` accepted a DIRECTORY, and accepted any file at all. Git will not execute a
//     directory and will not say so; an empty file it executes happily, with exit 0. The accepted
//     file is now proven to be a regular file AND to satisfy the pre-push contract -- it runs the
//     verifier and refuses when the verifier is missing.
//   - Nothing checked WHERE the hook lived, so case 1 above -- an absolute path into a sibling lane
//     -- was accepted. Containment is now checked segment-wise, which also rejects the
//     sibling-prefix lookalike this machine is full of (~27 checkouts all named "sentinel*").
//
// The negative cases live in throwaway fixture repositories, because the alternative is disarming a
// real worktree to make a test go red -- a test that breaks the thing it tests. That is why they
// were never written the first time, and it is why the fail-open paths shipped unproven.
//
// WHAT THIS GUARD DOES AND DOES NOT CLAIM. It inspects the worktrees registered in THIS clone at
// the moment it runs. It says nothing about other clones, other machines, or pushes that already
// happened -- a red result here is not evidence that historical pushes were unverified, and a green
// one is not a certificate for every copy of this repo in existence.
//
// Dependency-free on purpose, like local-gate-guard and ci-budget-guard: a guard that protects the
// build must not be one `npm install` away from being unable to run.

import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gitRaw,
  inspectWorktree,
  isInside,
  listWorktrees,
  REDIRECTING_GIT_VARS,
  scrubbedEnv,
} from "./lib/hookspath-inspect.mjs";
import { prePushContractViolations, refusesWhenVerifierMissing, shellCode } from "./lib/prepush-hook-contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A hook body that satisfies the contract, kept minimal so a fixture failure is about the case
// under test and not about the fixture's own hook drifting from the real one.
const GOOD_HOOK = [
  "#!/bin/sh",
  "set -eu",
  'repo="$(git rev-parse --show-toplevel)"',
  'if [ ! -f "$repo/scripts/verify-local.ps1" ]; then',
  '  echo "no gate here" >&2',
  "  exit 1",
  "fi",
  'powershell.exe -NoProfile -File "$repo/scripts/verify-local.ps1"',
].join("\n");

const temps = [];
afterAll(() => {
  for (const dir of temps) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a fixture that will not delete is not a test failure; the OS temp dir is swept anyway */
    }
  }
});

/**
 * A throwaway repo with a main working tree and one linked worktree, both real.
 *
 * Isolated under the OS temp dir, never inside this repo and never against real app data. `-c
 * core.hooksPath=` on every fixture command keeps the fixture's own git from picking up anything
 * the developer's environment has set.
 */
function fixture(name) {
  const base = mkdtempSync(join(tmpdir(), `hookspath-${name}-`));
  temps.push(base);
  const main = join(base, "mainwt");
  const linked = join(base, "linked");
  const run = (args, cwd) =>
    execFileSync("git", ["-c", "core.hooksPath=", "-c", "protocol.file.allow=always", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  mkdirSync(main, { recursive: true });
  run(["init", "-q", "-b", "main"], main);
  run(["config", "user.email", "fixture@example.invalid"], main);
  run(["config", "user.name", "fixture"], main);
  writeFileSync(join(main, "README"), "fixture\n");
  run(["add", "README"], main);
  run(["commit", "-qm", "seed"], main);
  run(["worktree", "add", "-q", "-b", "lane", linked], main);

  const armWith = (dir, body) => {
    mkdirSync(join(dir, ".githooks"), { recursive: true });
    writeFileSync(join(dir, ".githooks", "pre-push"), body);
  };

  return { base, main, linked, run, armWith };
}

describe("the fleet guard fails when it cannot PROVE a gate — fixture repositories", () => {
  it("an unset core.hooksPath fails: a registered worktree that is not wired runs no hook", () => {
    // Nothing to unset: `git init` sets no core.hooksPath, so this fixture IS the unwired state.
    const f = fixture("unset");
    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not set/i);
    expect(r.reason).toContain(f.linked); // the exact path, actionable
  });

  it("a malformed config fails as UNINSPECTABLE, and is not mistaken for an absent key", () => {
    const f = fixture("malformed");
    // A real broken config, not a simulated one: git exits 128 with a fatal on stderr, which the
    // old `catch { return "" }` rendered identical to "the key is not set". The shared config is
    // the one a linked worktree reads through, so corrupting it is the realistic shape.
    writeFileSync(join(f.main, ".git", "config"), "[core\nthis is not a config file\n");
    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/uninspectable/i);
    expect(r.reason).not.toMatch(/is not set/i); // the distinction this whole repair is about
  });

  it("a git that will not run at all fails, rather than reading as an absent key", () => {
    const f = fixture("nogit");
    f.armWith(f.linked, GOOD_HOOK);
    f.run(["config", "core.hooksPath", ".githooks"], f.linked);
    const dead = () => ({ ran: false, status: null, stdout: "", stderr: "spawn git ENOENT" });
    const r = inspectWorktree(f.linked, f.main, { git: dead });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not be run/i);
  });

  it("a failed path resolution fails, even when the config itself read cleanly", () => {
    const f = fixture("resolve");
    f.armWith(f.linked, GOOD_HOOK);
    f.run(["config", "core.hooksPath", ".githooks"], f.linked);
    // Injected read: config answers, rev-parse does not. This branch is unreachable with a healthy
    // git, and leaving it untested is how the original shipped four fail-opens.
    const flaky = (args, cwd) =>
      args[0] === "rev-parse"
        ? { ran: true, status: 128, stdout: "", stderr: "fatal: not a git repository" }
        : gitRaw(args, cwd);
    const r = inspectWorktree(f.linked, f.main, { git: flaky });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not be resolved/i);
  });

  it("a missing hook file fails — the original silent case, now caught", () => {
    const f = fixture("missing");
    f.run(["config", "core.hooksPath", ".githooks"], f.linked); // never created
    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not exist/i);
  });

  it("a DIRECTORY at the hook path fails, though existsSync says it is there", () => {
    const f = fixture("dir");
    mkdirSync(join(f.linked, ".githooks", "pre-push"), { recursive: true });
    f.run(["config", "core.hooksPath", ".githooks"], f.linked);
    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/a directory/i);
  });

  it("an EMPTY hook fails: git runs it, it exits 0, and every push is allowed", () => {
    const f = fixture("empty");
    f.armWith(f.linked, "");
    f.run(["config", "core.hooksPath", ".githooks"], f.linked);
    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty/i);
  });

  it("a hook that does not run the verifier fails, at exactly the right path", () => {
    const f = fixture("wrong");
    f.armWith(f.linked, "#!/bin/sh\nset -e\nexit 0\n");
    f.run(["config", "core.hooksPath", ".githooks"], f.linked);
    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/never invokes verify-local\.ps1/);
    // Review it, do not overwrite it: an unexpected hook is evidence about how it got there.
    expect(r.reason).toMatch(/review it rather than overwriting/i);
  });

  it("a hook that runs the verifier but does not refuse when it is missing fails", () => {
    const f = fixture("nofailclosed");
    f.armWith(f.linked, '#!/bin/sh\nset -e\npowershell.exe -File "$repo/scripts/verify-local.ps1"\n');
    f.run(["config", "core.hooksPath", ".githooks"], f.linked);
    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not refuse/i);
  });

  it("a relative path escaping the checkout fails, however real the file it lands on", () => {
    const f = fixture("escape");
    const outside = join(f.base, "elsewhere");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "pre-push"), GOOD_HOOK); // a perfectly valid hook, in the wrong place
    f.run(["config", "core.hooksPath", "../elsewhere"], f.linked);
    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/OUTSIDE this checkout/);
  });

  it("a checkout that HAS its own hook but points past it fails — that is a bypass, not a bridge", () => {
    const f = fixture("bypass");
    f.armWith(f.linked, GOOD_HOOK);
    f.armWith(f.main, GOOD_HOOK);
    f.run(["config", "core.hooksPath", join(f.main, ".githooks")], f.linked);
    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/points past it/i);
  });

  it("a valid own hook PASSES — the guard must not be red on everything", () => {
    const f = fixture("valid");
    f.armWith(f.linked, GOOD_HOOK);
    f.run(["config", "core.hooksPath", ".githooks"], f.linked);
    const r = inspectWorktree(f.linked, f.main);
    expect(r.reason).toBe("");
    expect(r.ok).toBe(true);
  });

  it("the historical fallback PASSES: an old checkout with no .githooks may use main's", () => {
    // This is the bridge sentinel-feedback and sentinel-quietpitwall stand on. It does NOT make
    // them current -- their pushes still fail closed at the hook itself, because they have no
    // scripts/verify-local.ps1 for it to run. The bridge only means the hook RUNS.
    const f = fixture("fallback");
    f.armWith(f.main, GOOD_HOOK);
    f.run(["config", "core.hooksPath", join(f.main, ".githooks")], f.linked);
    const r = inspectWorktree(f.linked, f.main);
    expect(r.reason).toBe("");
    expect(r.ok).toBe(true);
    expect(r.viaMainFallback).toBe(true);
  });
});

describe("where a RELATIVE core.hooksPath actually resolves — the claim two docs now rest on", () => {
  // scripts/setup-local-ci.ps1 said, in a comment and in the advice it prints when the gate is not
  // armed, that a relative core.hooksPath resolves against the MAIN worktree. It does not, and the
  // consequence was not academic: anyone who hit that warning was sent to repair the wrong checkout.
  //
  // Both docs were corrected in this commit, so the corrected claim needs to be the thing that goes
  // red if it is ever wrong again -- on a future git, or on another platform. A comment cannot do
  // that. This can: one shared relative value, two worktrees, and an assertion about which .githooks
  // each one lands in. Measured here on git 2.55.0.windows.3.
  it("resolves against the worktree the hook runs in, NOT the main working tree", () => {
    const f = fixture("resolution");
    f.armWith(f.main, GOOD_HOOK);
    f.armWith(f.linked, GOOD_HOOK);
    // Written ONCE, in the shared config, exactly as setup-local-ci.ps1 writes it.
    f.run(["config", "core.hooksPath", ".githooks"], f.main);

    const resolved = (wt) => {
      const r = gitRaw(["rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-push"], wt);
      expect(r.ran && r.status === 0, `rev-parse failed in ${wt}: ${r.stderr}`).toBe(true);
      return r.stdout.replace(/\\/g, "/").toLowerCase();
    };

    const fromLinked = resolved(f.linked);
    const inLinked = join(f.linked, ".githooks", "pre-push").replace(/\\/g, "/").toLowerCase();
    const inMain = join(f.main, ".githooks", "pre-push").replace(/\\/g, "/").toLowerCase();

    expect(
      fromLinked,
      "a relative core.hooksPath resolved somewhere other than the pushing worktree; " +
        "scripts/setup-local-ci.ps1's guidance and this guard's design both assume it does not",
    ).toBe(inLinked);
    expect(fromLinked).not.toBe(inMain);
    expect(resolved(f.main)).toBe(inMain);

    // And the consequence that makes it matter: the same one setting arms BOTH, each on its own
    // file. That is why the shared value must stay relative (pinned against the live clone below).
    expect(inspectWorktree(f.linked, f.main).ok).toBe(true);
    expect(inspectWorktree(f.main, f.main).ok).toBe(true);
  });

  it("leaves a worktree whose branch lacks .githooks/ silently unarmed", () => {
    // The corollary, and the reason the fleet guard has to walk every checkout rather than trust one
    // successful setup run. Same shared relative value, but this worktree carries no hook file: git
    // finds nothing, says nothing, and allows the push.
    const f = fixture("nohooks");
    f.armWith(f.main, GOOD_HOOK);
    f.run(["config", "core.hooksPath", ".githooks"], f.main);

    const r = inspectWorktree(f.linked, f.main);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/runs NO pre-push hook/);
    // Not mistaken for the unset case: the key IS set here, and the repair is different.
    expect(r.reason).not.toMatch(/is not set/i);
  });
});

describe("a leaked GIT_DIR cannot redirect the inspection", () => {
  // This suite runs under `npm test`, which runs under scripts/verify-local.ps1, which runs under
  // .githooks/pre-push -- and git exports GIT_DIR to every hook. The hook scrubs it before invoking
  // the gate and that scrub stays, but this file exists to run git in OTHER worktrees, so trusting
  // the caller to have cleaned up is precisely the assumption that wrote core.bare=true into the
  // real repository three times on 2026-08-11.
  it("removes every redirecting variable from the git child's environment", () => {
    // The list is the same one .githooks/pre-push unsets. Asserted case-insensitively because
    // Windows environment keys are, and a scrub that missed `Git_Dir` would be no scrub at all.
    const dirty = { PATH: process.env.PATH, KEEP_ME: "1" };
    for (const v of REDIRECTING_GIT_VARS) dirty[v] = "C:/somewhere/else/.git";
    dirty.Git_Dir = "C:/somewhere/else/.git";

    const clean = scrubbedEnv(dirty);
    expect(Object.keys(clean).filter((k) => /^git_/i.test(k))).toEqual([]);
    expect(clean.KEEP_ME, "the scrub must not strip unrelated variables").toBe("1");
    expect(clean.PATH, "stripping PATH would stop git being found at all").toBeDefined();
  });

  it("gives the same verdict with GIT_DIR set as without it", () => {
    // What this does NOT claim: that a leaked GIT_DIR would otherwise flip this verdict. MEASURED on
    // 2026-08-31, it would not -- pointed at the main working tree it left the resolution alone,
    // because a RELATIVE core.hooksPath follows the working tree, not GIT_DIR. That measurement is
    // why the assertion below is an equality rather than a caught near-miss, and saying so here
    // keeps the next reader from believing this file proved a redirect it did not.
    const f = fixture("gitdir-set");
    f.armWith(f.main, GOOD_HOOK); // main armed and valid; the linked worktree carries no hook
    f.run(["config", "core.hooksPath", ".githooks"], f.main);

    const before = inspectWorktree(f.linked, f.main);
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = join(f.main, ".git");
    try {
      const during = inspectWorktree(f.linked, f.main);
      expect(during.ok).toBe(before.ok);
      expect(during.reason).toBe(before.reason);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
    expect(before.ok, "an unarmed worktree must fail whatever the environment says").toBe(false);
    expect(before.reason).toMatch(/runs NO pre-push hook/);
  });
});

describe("containment is segment-wise, because every checkout here is named sentinel*", () => {
  it("rejects a sibling whose path merely starts with the same characters", () => {
    expect(isInside("C:/Users/Kuya/code/sentinel-css-separators", "C:/Users/Kuya/code/sentinel")).toBe(false);
    expect(isInside("C:/Users/Kuya/code/sentinel/.githooks/pre-push", "C:/Users/Kuya/code/sentinel")).toBe(true);
    expect(isInside("C:/Users/Kuya/code/sentinel", "C:/Users/Kuya/code/sentinel")).toBe(true);
  });
});

describe("the pre-push contract", () => {
  it("passes this repo's real hook", () => {
    const real = execFileSync("git", ["show", "HEAD:.githooks/pre-push"], { cwd: ROOT, encoding: "utf8" });
    expect(prePushContractViolations(real)).toEqual([]);
  });

  it("is not satisfiable by a comment", () => {
    const commented = ["#!/bin/sh", "set -e", "# powershell.exe -File verify-local.ps1", "exit 0"].join("\n");
    expect(prePushContractViolations(commented).length).toBeGreaterThan(0);
  });

  // The three below are not invented cases. Independent review of this lane at dba3c79c EXECUTED
  // each one against the contract as it stood and got zero violations back, which is the whole
  // defect restated: a hook that runs no gate, certified as a gate. They are pinned here by the
  // bug -> guard law so the hardening cannot be undone by a later simplification.
  it("is not satisfiable by a TRAILING comment either (review seed 1)", () => {
    // The whole-line stripper kept this line, so the substring search found the verifier's name
    // inside a comment attached to `:`, a command whose entire behaviour is to succeed.
    const seed = ["#!/bin/sh", "set -e", ": # verify-local.ps1"].join("\n");
    expect(prePushContractViolations(seed)).toContainEqual(expect.stringMatching(/never invokes/));
  });

  it("rejects a verifier whose failure is swallowed (review seed 2)", () => {
    // `set -e` cannot fire here: `cmd || :` is a pipeline that SUCCEEDED. Running the gate and
    // ignoring its answer is indistinguishable from not running it.
    const seed = ["#!/bin/sh", "set -e", 'powershell.exe -File "$repo/scripts/verify-local.ps1" || :'].join("\n");
    expect(prePushContractViolations(seed)).toContainEqual(expect.stringMatching(/swallows a failure/));
    const backgrounded = ["#!/bin/sh", "set -e", 'powershell.exe -File "$repo/verify-local.ps1" &'].join("\n");
    expect(prePushContractViolations(backgrounded)).toContainEqual(expect.stringMatching(/backgrounds/));
  });

  it("rejects an UNREACHABLE refusal branch (review seed 3)", () => {
    // Both halves of the old two-question test are true here and neither is connected to the other.
    const seed = [
      "#!/bin/sh",
      "set -e",
      "if [ ! -f verify-local.ps1 ]; then :; fi",
      "if false; then exit 1; fi",
      "exit 0",
    ].join("\n");
    expect(refusesWhenVerifierMissing(seed), "an exit 1 outside the branch is not a refusal").toBe(false);

    const real = execFileSync("git", ["show", "HEAD:.githooks/pre-push"], { cwd: ROOT, encoding: "utf8" });
    expect(refusesWhenVerifierMissing(real), "the real hook DOES refuse, inside the branch").toBe(true);
  });

  it("does not truncate code at a `#` that is not a comment", () => {
    // The cost of tightening the stripper is the opposite failure: cutting real code at `$#` or
    // `${#x}` would delete the verifier invocation and turn a green hook red — or worse, hide it.
    expect(shellCode('echo "$# args" # tail').trim()).toBe('echo "$# args"');
    expect(shellCode("run 'a # b' # tail").trim()).toBe("run 'a # b'");
    expect(shellCode("sha#1").trim()).toBe("sha#1");
  });
});

describe("git config can be injected through the ENVIRONMENT, not just a file", () => {
  // Found by independent review at dba3c79c: the original scrub covered the variables that redirect
  // WHICH repo, and missed the family that overrides WHAT ITS CONFIG SAYS. `GIT_CONFIG_COUNT` with
  // a key/value pair is read by both commands this guard runs, so an injected core.hooksPath would
  // have been certified while the checkout on disk stayed unwired.
  it("strips every GIT_CONFIG* form, including the numbered ones", () => {
    const dirty = {
      PATH: process.env.PATH,
      KEEP_ME: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: ".githooks",
      GIT_CONFIG_PARAMETERS: "'core.hooksPath=.githooks'",
      GIT_CONFIG_GLOBAL: "C:/nowhere/.gitconfig",
      git_config_nosystem: "1", // lower-case: Windows env keys are case-insensitive
    };
    const clean = scrubbedEnv(dirty);
    expect(Object.keys(clean).filter((k) => /^git/i.test(k))).toEqual([]);
    expect(clean.KEEP_ME).toBe("1");
  });

  it("an injected core.hooksPath cannot make an unwired worktree pass", () => {
    const f = fixture("config-env-injection");
    // Nothing is armed: no hooksPath is set anywhere, and no .githooks exists in the linked tree.
    const saved = process.env.GIT_CONFIG_COUNT;
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "core.hooksPath";
    process.env.GIT_CONFIG_VALUE_0 = ".githooks";
    try {
      const v = inspectWorktree(f.linked, f.main);
      expect(v.ok, "the environment must not be able to vouch for the disk").toBe(false);
    } finally {
      if (saved === undefined) delete process.env.GIT_CONFIG_COUNT;
      else process.env.GIT_CONFIG_COUNT = saved;
      delete process.env.GIT_CONFIG_KEY_0;
      delete process.env.GIT_CONFIG_VALUE_0;
    }
  });
});

describe("the live fleet, as registered in THIS clone right now", () => {
  const worktrees = listWorktrees(ROOT); // throws rather than returning [] — see listWorktrees

  it("finds at least this checkout", () => {
    // Sanity floor. An empty list would make the check below pass vacuously, which is exactly the
    // silent-green shape this file exists to prevent.
    expect(worktrees.length).toBeGreaterThan(0);
  });

  it("proves a usable pre-push gate in every registered worktree", () => {
    const main = worktrees[0]; // git lists the main working tree first
    const broken = worktrees
      .map((wt) => inspectWorktree(wt, main))
      .filter((r) => !r.ok)
      .map((r) => `${r.path}\n      ${r.reason}`);

    expect(
      broken,
      `These registered worktrees cannot be proven to run a usable pre-push gate. Git skips a\n` +
        `missing or unrunnable hook with no warning, so a push from one of them is unverified and\n` +
        `looks identical to a pass.\n\n` +
        `  ${broken.join("\n\n  ")}\n\n` +
        `This is a statement about the worktrees registered in this clone at this moment. It is not\n` +
        `a claim about other clones, and a failure here is not evidence about past pushes.`,
    ).toEqual([]);
  });

  it("keeps the shared core.hooksPath relative, so each worktree finds its own", () => {
    // The shared value in .git/config is inherited by every worktree that has no override. Relative
    // ('.githooks') resolves against the worktree the push runs from -- MEASURED in fixture repos
    // on 2026-08-31, and the reason scripts/setup-local-ci.ps1's comment was corrected in the same
    // commit as this. That is self-healing: a new worktree is armed the moment it is created. An
    // ABSOLUTE value here would aim all ~27 worktrees at ONE checkout, and removing that checkout
    // would disarm the entire fleet in a single stroke, silently. That is case 1 above, scaled.
    const common = gitRaw(["rev-parse", "--path-format=absolute", "--git-common-dir"], ROOT);
    expect(common.ran && common.status === 0, "could not locate the shared git dir").toBe(true);

    const shared = gitRaw(["config", "--file", `${common.stdout}/config`, "--get", "core.hooksPath"], ROOT);
    if (shared.status === 1 && !shared.stderr) return; // genuinely unset: covered per-worktree above
    expect(shared.status, `the shared config could not be read: ${shared.stderr}`).toBe(0);

    expect(
      shared.stdout.replace(/\\/g, "/"),
      `The SHARED core.hooksPath in ${common.stdout}/config is absolute ("${shared.stdout}"). Every\n` +
        `worktree with no override inherits it, so all of them depend on that one directory\n` +
        `surviving. Set it back to a relative path:  git config core.hooksPath .githooks`,
    ).not.toMatch(/^([a-zA-Z]:|\/|\\)/);
  });
});
