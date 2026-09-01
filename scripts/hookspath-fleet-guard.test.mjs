// Guard: no worktree may be silently disarmed. Every checkout wired to the local gate must
// resolve hooks/pre-push to a file that actually exists.
//
// bug->guard, 2026-08-30. `.githooks/pre-push` runs scripts/verify-local.ps1 and is the ONLY
// automated verification this repo has -- .github/workflows/ci.yml went workflow_dispatch-only on
// 2026-08-10, so pull requests carry no status checks by design. That makes the hook the whole gate.
//
// Git fails OPEN here, and says nothing while doing it: when core.hooksPath names a directory that
// does not exist, git does not warn and does not error, it simply runs no hook. A push from such a
// worktree is indistinguishable from a push that passed the gate. Two ways in were both measured on
// this machine on the same day:
//
//   1. An ABSOLUTE core.hooksPath pointing into a DIFFERENT worktree. Three worktrees
//      (q9b-tier3-contract, serene-torvalds-9e495e, test-design-visual-fixes-fec3ec) pointed at
//      sentinel-mission2-live-alignment/.githooks. Removing that unrelated lane -- an ordinary,
//      encouraged cleanup -- would have disarmed all three at once.
//   2. A checkout OLDER than the hook itself. feat/user-feedback-lab-recovery (05990130,
//      2026-07-30) and feat/lab-49-parity-port (7e6cd4d7, 2026-08-07) both predate 670d9b74, the
//      commit that added .githooks. They inherited the correct relative value and still had no
//      hook, because their own checkout has no .githooks directory to find. Both had been pushing
//      with zero verification for weeks.
//
// Neither case is visible to anyone. The first symptom of either is ungated code on origin. This
// file is the thing that notices, and it is the reason the repair is not just prose in a handoff.
//
// Dependency-free on purpose, like local-gate-guard and ci-budget-guard: a guard that protects the
// build must not be one `npm install` away from being unable to run.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const git = (args, cwd = ROOT) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

/**
 * Registered worktrees, skipping any whose path has gone missing (a pending `git worktree prune`
 * is bookkeeping, not a disarmed gate -- git will not run a hook from a directory that is not there
 * and no push can originate from it either).
 */
const worktrees = git(["worktree", "list", "--porcelain"])
  .split(/\r?\n/)
  .filter((line) => line.startsWith("worktree "))
  .map((line) => line.slice("worktree ".length).trim())
  .filter((path) => path && existsSync(path));

describe("pre-push hook reaches every worktree", () => {
  it("finds at least this checkout", () => {
    // Sanity floor. If `git worktree list` returns nothing the checks below would all vacuously
    // pass, which is exactly the silent-green shape this file exists to prevent.
    expect(worktrees.length).toBeGreaterThan(0);
  });

  it("resolves hooks/pre-push to a real file in every wired worktree", () => {
    const disarmed = [];

    for (const wt of worktrees) {
      // An UNSET core.hooksPath means this clone was never wired to the local gate at all --
      // scripts/setup-local-ci.ps1 has not been run here. That is a visible, expected state for a
      // fresh clone and is covered by local-gate-guard; it is not the silent failure. Only a
      // worktree that CLAIMS to be wired can be silently lying about it.
      if (!git(["config", "--get", "core.hooksPath"], wt)) continue;

      const hook = git(["rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-push"], wt);
      if (!hook || !existsSync(hook)) disarmed.push(`${wt}\n      resolves to: ${hook || "(unresolvable)"}`);
    }

    expect(
      disarmed,
      `These worktrees are wired to the local gate but run NO pre-push hook. Git skips a missing\n` +
        `hooks path with no warning, so pushes from them are unverified and look identical to a pass.\n\n` +
        `  ${disarmed.join("\n  ")}\n\n` +
        `Fix each one by pointing it at a .githooks directory that exists:\n` +
        `  git -C <worktree> config --worktree core.hooksPath <worktree>\\.githooks\n` +
        `If that worktree's checkout predates 670d9b74 it has no .githooks of its own -- point it at\n` +
        `the MAIN checkout's .githooks instead (the main working tree cannot be removed by\n` +
        `\`git worktree remove\`, so it is the one safe absolute anchor), or rebase it onto main.`,
    ).toEqual([]);
  });

  it("keeps the shared core.hooksPath relative, so each worktree finds its own", () => {
    // The shared value in .git/config is inherited by every worktree that has no override. Relative
    // ('.githooks') resolves against each worktree's own root, which is self-healing: a new worktree
    // is armed the moment it is created, with no per-worktree setup. An ABSOLUTE value here would
    // aim all ~25 worktrees at ONE checkout, and removing that checkout would disarm the entire
    // fleet in a single stroke, silently. That is case 1 above, scaled to everything.
    const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (!common) return;

    const shared = git(["config", "--file", `${common}/config`, "--get", "core.hooksPath"]);
    if (!shared) return;

    expect(
      shared.replace(/\\/g, "/"),
      `The SHARED core.hooksPath in ${common}/config is absolute ("${shared}"). Every worktree with\n` +
        `no override inherits it, so all of them depend on that one directory surviving. Set it back\n` +
        `to a relative path so each worktree resolves its own:  git config core.hooksPath .githooks`,
    ).not.toMatch(/^([a-zA-Z]:|\/|\\)/);
  });
});
