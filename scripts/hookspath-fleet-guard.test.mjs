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
import {
  cpSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync as realStat,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_SPAWN_TIMEOUT_MS, TREE_WALK_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";
import {
  gitRaw,
  gitRawAsync,
  inspectFleet,
  inspectWorktree,
  isInside,
  listWorktrees,
  REDIRECTING_GIT_VARS,
  scrubbedEnv,
} from "./lib/hookspath-inspect.mjs";
import { prePushContractViolations, refusesWhenVerifierMissing, shellCode } from "./lib/prepush-hook-contract.mjs";
// #488: which folder a finding may block a push from. This checkout's own unusable hook blocks; a
// peer's is warned with its fix; under fleet mode every one blocks.
import { peerWarning, splitByFolder } from "./lib/fleet-scope.mjs";

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

// #313. This file's cost, DECLARED rather than discovered at someone's push. It walks every
// registered worktree and builds real repositories, so it is one of the few here whose runtime
// tracks the size of the machine's fleet rather than the size of the repo. The budget is asserted
// below on the quantity that is deterministic under any load -- git spawns per fixture -- and NOT
// on the clock. The first cut of this change declared it as `vi.setConfig({ testTimeout: 30_000 })`
// and claimed growth would then fail "as a named breach of a stated budget"; the exact-head review
// of PR #317 measured that it did the opposite: it DOUBLED vitest.config.ts's 15000ms ceiling, per
// test, against a stated budget that was a file total, and the identical blob measured 7.36s on one
// desk and 4.5s on another, so no clock number could be the assertion. Every fixture-side spawn
// goes through `fixtureGit`, so the count below is exhaustive for what this file itself pays.
let gitSpawns = 0;

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

const fixtureGit = (args, cwd) => {
  gitSpawns += 1;
  return execFileSync("git", ["-c", "core.hooksPath=", "-c", "protocol.file.allow=always", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
};

/**
 * #313. The template every fixture below is copied from, seeded once on first use rather than
 * per test.
 *
 * This file spent 7.36s of a 15s default `testTimeout` before any contention, and profiling put
 * only 915ms of that in the live fleet walk. The rest was fixture CONSTRUCTION: some two dozen
 * tests each spawning git six times to build the same two-worktree repo. There was nothing
 * repeated to memoise — the cost was the spawns themselves, which is why #313's proposed fix
 * (borrowed from rule C of `scripts/handoff-worktree-truth.test.mjs`) did not fit and this one
 * does. Measured at N=25 before it was written: 4693ms to build each, 755ms to copy each, 6.2x.
 *
 * Built lazily so a run that filters to the fleet tests never pays for it at all.
 */
let template = null;
function fixtureTemplate() {
  if (template) return template;
  const base = mkdtempSync(join(tmpdir(), "hookspath-template-"));
  temps.push(base);
  const main = join(base, "mainwt");
  mkdirSync(main, { recursive: true });
  fixtureGit(["init", "-q", "-b", "main"], main);
  fixtureGit(["config", "user.email", "fixture@example.invalid"], main);
  fixtureGit(["config", "user.name", "fixture"], main);
  writeFileSync(join(main, "README"), "fixture\n");
  fixtureGit(["add", "README"], main);
  fixtureGit(["commit", "-qm", "seed"], main);
  fixtureGit(["worktree", "add", "-q", "-b", "lane", join(base, "linked")], main);
  template = base;
  return template;
}

/**
 * A throwaway repo with a main working tree and one linked worktree, both real.
 *
 * Isolated under the OS temp dir, never inside this repo and never against real app data. `-c
 * core.hooksPath=` on every fixture command keeps the fixture's own git from picking up anything
 * the developer's environment has set.
 *
 * #313: a COPY of the template above, not a fresh build. Every caller still gets its own directory
 * tree and its own git objects, so no shared mutable state is introduced and no test can reach
 * another's — only the six spawns become one.
 *
 * That one is `git worktree repair`, and it is not optional. A linked worktree is wired by two
 * ABSOLUTE paths — `linked/.git` pointing into `mainwt/.git/worktrees/lane`, and that directory's
 * `gitdir` file pointing back — so a copied fixture is wired to the TEMPLATE until they are
 * rewritten. Repair is what makes the copy sound, and it is the same absolute-path trap this whole
 * guard exists for: an absolute `core.hooksPath` into a different worktree is failure mode 1 above.
 */
function fixture(name) {
  const base = mkdtempSync(join(tmpdir(), `hookspath-${name}-`));
  temps.push(base);
  const main = join(base, "mainwt");
  const linked = join(base, "linked");
  const run = (args, cwd) => fixtureGit(args, cwd);

  cpSync(fixtureTemplate(), base, { recursive: true });
  run(["worktree", "repair", linked], main);

  const armWith = (dir, body) => {
    mkdirSync(join(dir, ".githooks"), { recursive: true });
    writeFileSync(join(dir, ".githooks", "pre-push"), body);
  };

  return { base, main, linked, run, armWith };
}

describe("the fleet guard fails when it cannot PROVE a gate — fixture repositories", () => {
  // #313. The fixtures below are copies of one template, and every verdict in this describe rests
  // on each being a real, self-contained repository. A copy that stayed wired to the template
  // would still LOOK like a working fixture — git commands succeed, tests go green — while every
  // assertion silently judged the same shared checkout. So the copy is falsified here rather than
  // trusted: the pointer must lead home, and two fixtures must not be able to see each other.
  // #313. The budget itself. Before the template a fixture cost six spawns (`init`, `config` x2,
  // `add`, `commit`, `worktree add`); a copy costs one, the `worktree repair` that makes it sound.
  // This is the regression worth catching -- someone re-adding per-fixture construction -- and it
  // fails as a named number the moment that happens, under any load, on any desk. The one-time
  // seed is paid explicitly first so the measurement is of a copy alone.
  it("a fixture costs exactly one git spawn once the template exists: the worktree repair", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    fixtureTemplate();
    const before = gitSpawns;
    fixture("spawn-budget");
    expect(gitSpawns - before).toBe(1);
  });

  it("a copied fixture is its own repository, not a window onto the template", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const a = fixture("independence-a");
    const b = fixture("independence-b");

    // `git worktree repair` rewrites TWO absolute pointers, and it takes one assertion each to
    // cover them. This set used to carry five. A reviewer removed the repair call and ran them:
    // `rev-parse --show-toplevel` PASSED unrepaired from both checkouts — it answers with the
    // directory it ran in, whatever `.git` points at — so those two were never coverage. A third,
    // asserting no registered path sits under the template, is subtler and the first draft of this
    // comment got it wrong: restored with the equality neutralised it FAILS, so it CAN be false.
    // What it can never be is the assertion that REPORTS, because the equality below entails it —
    // that pins the list to exactly two mkdtemp siblings, and two mkdtemp names are equal-length
    // and distinct, so neither can be a string prefix of the other. The implication runs one way,
    // which is also the answer to "what if a later edit loosens the equality": that edit is the one
    // that must re-add this assertion, and it is looking straight at this line when it does.
    // All three are gone. An assertion that cannot report is worse than no assertion: it reads as
    // coverage to anyone counting checks, and the number comes out wrong in the safe direction.

    // Pointer one: mainwt/.git/worktrees/<name>/gitdir, read back out through `worktree list`.
    const registered = a
      .run(["worktree", "list", "--porcelain"], a.main)
      .split(/\r?\n/)
      .filter((l) => l.startsWith("worktree "))
      .map((l) => realpathSync(l.slice("worktree ".length).trim()));
    expect(registered).toEqual([realpathSync(a.main), realpathSync(a.linked)]);

    // Pointer two: linked/.git, which names that administrative directory back in mainwt.
    // Nothing above reads it, and unrepaired it still names the template — so this is the half
    // of the cure that had no assertion at all, not a second way of asking the same question.
    //
    // Proven against the objection that will one day be used to delete it — "redundant with the
    // equality above". Neutralising that equality only shows this pair CAN fire; it does not show
    // the pair reaches a state the equality misses. The separating state does, and it was built
    // rather than argued: hand-write mainwt/.git/worktrees/<dir>/gitdir the way repair writes it and
    // leave linked/.git still naming the template, and the equality PASSES on its own merits while
    // this pair catches it. Partial repair is a real state, not a contrived one — repairing from
    // the main tree and repairing from inside the linked tree fix different pointers. `<dir>` is the
    // linked worktree's DIRECTORY basename, not its branch — reproducing this cost one run to that.
    // (Write that pointer forward-slashed. Git writes it that way on Windows and will not strip
    // its own `/.git` suffix from a backslashed one, which fails the equality for an unrelated
    // reason and looks like a fixture bug.)
    const dotGit = readFileSync(join(a.linked, ".git"), "utf8").trim();
    // A parse precondition for the slice below, NOT a pointer check, and it cannot fail in any
    // state this fixture reaches: a copy still begins with `gitdir:`, and a symlink or nested-clone
    // fixture would hand back a directory and throw EISDIR one line earlier. Kept for the readable
    // failure it gives if that ever stops being true, and labelled so it is never counted as one
    // of the two pointer assertions. The commit above set that standard; it applies here too.
    expect(dotGit.startsWith("gitdir:")).toBe(true);
    const gitdir = resolve(a.linked, dotGit.slice("gitdir:".length).trim());
    expect(realpathSync(gitdir).startsWith(realpathSync(a.base))).toBe(true);

    // Independence, proven by mutation. Measured, against what this comment used to claim: on an
    // unrepaired copy the half that fires is the POSITIVE one — `a.ok` is false, because a.main's
    // registry still points at the template. The negative half is the shared-clone catch. Both
    // stay; deleting either as "the redundant one" removes a case the other does not reach.
    a.armWith(a.linked, GOOD_HOOK);
    a.run(["config", "core.hooksPath", ".githooks"], a.main);
    expect(inspectWorktree(a.linked, a.main).ok).toBe(true);
    expect(inspectWorktree(b.linked, b.main).ok).toBe(false);
  });

  // #512. The live walk below runs through inspectFleet, which exists only to overlap the waits on
  // git. It is allowed to be faster and nothing else, so it is held to inspectWorktree's own verdicts
  // on a fleet that yields both answers, and its cost is asserted as spawn counts, not the clock.
  it("inspectFleet reaches inspectWorktree's verdicts, prefetching exactly its two reads per checkout side by side", { timeout: GIT_SPAWN_TIMEOUT_MS }, async () => {
    const a = fixture("fleet-a");
    a.armWith(a.linked, GOOD_HOOK);
    a.run(["config", "core.hooksPath", ".githooks"], a.main);
    const b = fixture("fleet-b"); // unwired: git init sets no core.hooksPath
    const fleet = [a.main, a.linked, b.main, b.linked, join(b.base, "never-existed")];
    const sequential = fleet.map((wt) => inspectWorktree(wt, a.main));
    // Non-vacuity: a fleet where every verdict agreed could not tell a correct prefetch from one
    // that answered everything the same way.
    expect(sequential.map((r) => r.ok)).toEqual([false, true, false, false, true]);

    let inFlight = 0;
    let peak = 0;
    const asked = [];
    const gitAsync = async (args, cwd) => {
      asked.push(args[0]);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await gitRawAsync(args, cwd);
      } finally {
        inFlight -= 1;
      }
    };
    const blocking = [];
    const gitSync = (args, cwd) => {
      blocking.push(args[0]);
      return gitRaw(args, cwd);
    };

    expect(await inspectFleet(fleet, a.main, { gitAsync, gitSync })).toEqual(sequential);
    // Two reads per checkout that exists, none for the one that does not, and no blocking re-read.
    expect(asked.sort()).toEqual(["config", "config", "config", "config", "rev-parse", "rev-parse", "rev-parse", "rev-parse"]);
    expect(blocking).toEqual([]);
    expect(peak, "the reads must actually overlap, or this is the old walk with extra steps").toBeGreaterThan(1);
  });

  it("a prefetch that yields nothing falls back to the blocking read, never to a verdict", { timeout: GIT_SPAWN_TIMEOUT_MS }, async () => {
    const f = fixture("fleet-miss");
    f.armWith(f.linked, GOOD_HOOK);
    f.run(["config", "core.hooksPath", ".githooks"], f.main);
    const fleet = [f.main, f.linked];
    const sequential = fleet.map((wt) => inspectWorktree(wt, f.main));
    const blocking = [];
    const gitSync = (args, cwd) => {
      blocking.push(args[0]);
      return gitRaw(args, cwd);
    };
    // Not a state gitRawAsync can reach -- it always resolves a result -- but the only way to force
    // every lookup to miss, which is what a checkout whose path moved mid-walk looks like.
    const empty = async () => undefined;
    expect(await inspectFleet(fleet, f.main, { gitAsync: empty, gitSync })).toEqual(sequential);
    expect(sequential.map((r) => r.ok)).toEqual([false, true]);
    // main fails at the missing hook after both reads; linked passes after both.
    expect(blocking.sort()).toEqual(["config", "config", "rev-parse", "rev-parse"]);
  });

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

  // The three below all seed the SAME shape: a stat that fails for a reason other than absence.
  // `sentinel-21`, reviewing PR #277, found two of the four catches reading any such failure as
  // "the file is not there" — the exact "I could not tell" -> "fine" conversion this file's header
  // forbids. They could not be tested before, because provoking EACCES means changing permissions
  // on a real checkout, which is a test that breaks the thing it is testing; hence `deps.stat`.
  const denyingStat = (target) => (p) => {
    if (String(p) === String(target)) {
      const e = new Error(`EACCES: permission denied, stat '${p}'`);
      e.code = "EACCES";
      throw e;
    }
    return realStat(p);
  };

  it("a checkout that cannot be STATTED fails — it is not 'absent' (review round 5)", () => {
    const f = fixture("statdenied");
    f.armWith(f.linked, GOOD_HOOK);
    f.run(["config", "core.hooksPath", ".githooks"], f.linked);

    // Before the fix this returned `{ ok: true, absent: true }` and left the sweep at step 0,
    // before a single hook question was asked.
    const r = inspectWorktree(f.linked, f.main, { stat: denyingStat(realpathSync.native(f.linked)) });
    expect(r.ok).toBe(false);
    expect(r.absent).not.toBe(true);
    expect(r.reason).toMatch(/could not be inspected/i);

    // ...and a checkout that is genuinely gone still reads as absent, which is the case the bare
    // catch was written for and must survive the narrowing.
    const gone = inspectWorktree(join(f.base, "never-existed"), f.main);
    expect(gone).toMatchObject({ ok: true, absent: true });
  });

  it("an own-hook that cannot be STATTED fails, instead of licensing the bridge (review round 5)", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const f = fixture("ownstat");
    // The legitimate bridge: the linked checkout has no hook of its own and points at the main one.
    f.armWith(f.main, GOOD_HOOK);
    f.run(["config", "core.hooksPath", join(f.main, ".githooks")], f.linked);
    expect(inspectWorktree(f.linked, f.main).ok, "the bridge itself is legitimate").toBe(true);

    // Same checkout, but its own .githooks/pre-push cannot be looked at. Before the fix this
    // answered `false` — "it has none" — and the bypass check below it was skipped entirely.
    const own = join(realpathSync.native(f.linked), ".githooks", "pre-push");
    const r = inspectWorktree(f.linked, f.main, { stat: denyingStat(own) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not be inspected|cannot be told/i);
  });

  it("names the reason a hook is unreadable, rather than always saying it is missing", () => {
    const f = fixture("hookstat");
    f.armWith(f.linked, GOOD_HOOK);
    f.run(["config", "core.hooksPath", ".githooks"], f.linked);
    const hook = join(realpathSync.native(f.linked), ".githooks", "pre-push");
    // This branch always failed, so it was never fail-open — but it sent its reader to create a
    // file that is already there.
    const r = inspectWorktree(f.linked, f.main, { stat: denyingStat(hook) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unreadable/i);
    expect(r.reason).not.toMatch(/does not exist/i);
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
  it("resolves against the worktree the hook runs in, NOT the main working tree", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
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

  it("gives the same verdict with GIT_DIR set as without it", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
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

  it("a diagnostic naming the verifier does not move the dead-code anchor (review round 5)", () => {
    // Session `sentinel-21`, reviewing PR #277, found the anchor reading the first textual MENTION
    // rather than the invocation. Both hooks below are the same hook; the first only adds an echo.
    // Measured before the fix: the first returned NO violations, the second returned the `exit 0`
    // one. One ordinary diagnostic line disarmed the rule that catches a forgotten debugging exit.
    const disarmed = [
      "#!/bin/sh",
      "set -e",
      'echo "about to run verify-local.ps1"',
      "exit 0",
      'powershell -File "$repo/scripts/verify-local.ps1"',
    ].join("\n");
    expect(prePushContractViolations(disarmed)).toContainEqual(expect.stringMatching(/unconditional/));

    // The false positive `lastIndexOf` would have introduced instead, pinned so the cheap repair
    // cannot come back: this hook is CORRECT — the gate ran, `set -e` covered it, and the trailing
    // `exit 0` is ordinary. A rule that fails it is a rule an author mutes.
    const trailing = [
      "#!/bin/sh",
      "set -e",
      'powershell -File "$repo/scripts/verify-local.ps1"',
      "exit 0",
      'echo "finished verify-local.ps1"',
    ].join("\n");
    expect(prePushContractViolations(trailing)).toEqual([]);

    // A line is not one command: the leading echo must not speak for the invocation beside it.
    const compound = ["#!/bin/sh", "set -e", 'echo "starting" && sh scripts/verify-local.ps1'].join("\n");
    expect(prePushContractViolations(compound)).toEqual([]);

    // ...and a hook that ONLY prints the name verifies nothing, which is the fail-closed answer.
    const printsOnly = ["#!/bin/sh", "set -e", 'echo "we normally run verify-local.ps1 here"'].join("\n");
    expect(prePushContractViolations(printsOnly)).toContainEqual(expect.stringMatching(/never invokes/));
  });

  it("rejects a hook that arms `set -e` and then turns it back off (review round 5)", () => {
    // The same review. The presence check asks whether the words `set -e` appear, not which toggle
    // ran last, so arming and then disarming above the gate read as armed.
    const disabled = [
      "#!/bin/sh",
      "set -e",
      "set +e",
      'powershell -File "$repo/scripts/verify-local.ps1"',
    ].join("\n");
    expect(prePushContractViolations(disabled)).toContainEqual(expect.stringMatching(/set \+e/));

    // Re-armed before the gate is not a defect, and neither is a scoped suspension inside an `if` —
    // failing either would be failing a hook for being written carefully.
    const rearmed = ["#!/bin/sh", "set -e", "set +e", "set -e", "sh scripts/verify-local.ps1"].join("\n");
    expect(prePushContractViolations(rearmed)).toEqual([]);
    const scoped = ["#!/bin/sh", "set -e", "if x; then", "  set +e", "fi", "sh scripts/verify-local.ps1"].join("\n");
    expect(prePushContractViolations(scoped)).toEqual([]);
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

  it("an exit nested INSIDE the branch is not a refusal either (the fail-open direction)", () => {
    // The mirror image of seed 3, and the one the first repair got wrong: slicing to the next `fi`
    // captured the nested block and read its unreachable `exit 1` as a refusal. Fail-OPEN. Pinned
    // here specifically because a future simplification back to slicing would look harmless and
    // would silently re-certify a hook that never refuses.
    const nested = ["#!/bin/sh", "set -e", "if [ ! -f verify-local.ps1 ]; then if false; then exit 1; fi; fi"].join("\n");
    expect(refusesWhenVerifierMissing(nested)).toBe(false);

    // ...while the flat branch the real hook uses still reads as a refusal.
    const flat = ["#!/bin/sh", "set -e", "if [ ! -f verify-local.ps1 ]; then", "  exit 1", "fi"].join("\n");
    expect(refusesWhenVerifierMissing(flat)).toBe(true);
  });

  it("does not read a diagnostic MESSAGE as shell structure", () => {
    // Round 3 of review found both of these certifying hooks that never refuse. They are the
    // accident case, not the adversarial one: a hook that talks about exiting is ordinary, and a
    // guard that counts the words inside `echo` is counting the wrong thing.
    const talksAboutIt = 'if [ ! -f verify-local.ps1 ]; then echo "will exit 1"; fi; exit 0';
    expect(refusesWhenVerifierMissing(talksAboutIt), "printing the words is not exiting").toBe(false);

    const quotedFi = 'if [ ! -f verify-local.ps1 ]; then if false; then echo "fi"; exit 1; fi; fi';
    expect(refusesWhenVerifierMissing(quotedFi), "a quoted `fi` must not close a block").toBe(false);

    // The real hook's own refusal is three quoted echoes followed by a bare exit — proof the
    // blanking did not go so far that a genuine refusal stopped counting.
    const real = execFileSync("git", ["show", "HEAD:.githooks/pre-push"], { cwd: ROOT, encoding: "utf8" });
    expect(refusesWhenVerifierMissing(real)).toBe(true);
  });

  it("reads a MULTI-LINE diagnostic as one string, not as three lines of code (review round 4)", () => {
    // Round 4 of review, at f82514b5, executed this against the contract and got `true` back: the
    // blanking reset its quote state at every newline, so a hook that only PRINTS the words "exit 1"
    // was certified as one that refuses. Fail-OPEN, and the accident case rather than the
    // adversarial one -- a multi-line message is the ordinary way to write a helpful diagnostic.
    const multiline = ["if [ ! -f verify-local.ps1 ]; then", "  echo 'no verifier here", "exit 1", "'", "fi", "exit 0"].join("\n");
    expect(refusesWhenVerifierMissing(multiline), "a quoted newline does not end the string").toBe(false);

    const doubled = ["if [ ! -f verify-local.ps1 ]; then", '  echo "no verifier here', "exit 1", '"', "fi", "exit 0"].join("\n");
    expect(refusesWhenVerifierMissing(doubled), "the same in double quotes").toBe(false);

    // The other direction, which is what keeps the fix from being "blank everything": a genuine
    // refusal that FOLLOWS a multi-line message still counts. This also proves the blanked view
    // stayed the same length as the code -- if a newline were blanked away or an escape ate one, the
    // offset of the guard test would shift and this slice would start in the wrong place.
    const messageThenExit = [
      "if [ ! -f verify-local.ps1 ]; then",
      "  echo 'no verifier here",
      "so this push cannot be checked",
      "'",
      "  exit 1",
      "fi",
    ].join("\n");
    expect(refusesWhenVerifierMissing(messageThenExit), "a real exit after a real message").toBe(true);

    // An unterminated quote blanks everything after it, so the answer is "does not refuse". That is
    // the conservative direction, and the shell would refuse the file outright anyway.
    expect(refusesWhenVerifierMissing("if [ ! -f verify-local.ps1 ]; then echo 'oops; exit 1; fi")).toBe(false);

    // Same review measured `exit "1"` and `e\xit 1` as "does not refuse". Both really do exit, so
    // both are false NEGATIVES, and that is the direction this guard is allowed to be wrong in.
    // Pinned so a later loosening that flips either one to `true` has to be a deliberate edit here.
    expect(refusesWhenVerifierMissing('if [ ! -f verify-local.ps1 ]; then exit "1"; fi')).toBe(false);
    expect(refusesWhenVerifierMissing("if [ ! -f verify-local.ps1 ]; then e\\xit 1; fi")).toBe(false);
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
    // The hook FILE is deliberately present and valid; ONLY the on-disk core.hooksPath is missing.
    // Re-review caught the first version of this test not proving its own claim: with no hook file
    // the worktree failed for "missing hook", so the test stayed green even if gitRaw() stopped
    // scrubbing entirely. Arming the file makes the injected config the ONLY thing that could
    // certify this worktree, so a green result here would mean the scrub had failed.
    f.armWith(f.linked, GOOD_HOOK);
    const saved = process.env.GIT_CONFIG_COUNT;
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "core.hooksPath";
    process.env.GIT_CONFIG_VALUE_0 = ".githooks";
    try {
      const v = inspectWorktree(f.linked, f.main);
      expect(v.ok, "the environment must not be able to vouch for the disk").toBe(false);
      expect(v.reason, "and it must fail for the UNSET key, not for a missing file").toMatch(/core\.hooksPath/i);
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

  // #515: reaches into every registered checkout, so it rides the tree-walk budget.
  it("proves a usable pre-push gate in every registered worktree — this one blocks, a peer's warns (#488)", { timeout: TREE_WALK_TIMEOUT_MS }, async () => {
    const main = worktrees[0]; // git lists the main working tree first
    // #512: inspectFleet is inspectWorktree per checkout with the git reads run side by side; the
    // fixture describe above proves the verdicts identical.
    const broken = (await inspectFleet(worktrees, main)).filter((r) => !r.ok);
    // #488: a peer's unusable hook is that folder's session's to repoint, or the owner's, and until
    // 2026-09-22 it failed every OTHER lane's push instead (the #456 push, 05:49Z, on a worktree
    // created with an absolute pin). Every worktree is still measured and every finding still
    // printed on every push; it blocks the push FROM the folder that has it, and every push under
    // fleet mode (`npm run fleet:hygiene`). The successor prompt's STEP 1 self-repoint (#405, #466)
    // is what closes the gap the block used to cover.
    const { blocking, warnings } = splitByFolder(broken, { own: ROOT, folderOf: (r) => r.path });
    const describeBroken = (r) => `${r.path}\n      ${r.reason}`;
    const warn = peerWarning({
      check: "hookspath-fleet-guard",
      warnings,
      describe: describeBroken,
      fix: (r) =>
        `git -C "${r.path}" config --worktree core.hooksPath .githooks   (only that folder's session ` +
        `or the owner runs it; if its branch lacks .githooks/, rebase it onto main first)`,
    });
    if (warn) console.warn(warn);
    const lines = blocking.map(describeBroken);

    expect(
      lines,
      `These registered worktrees cannot be proven to run a usable pre-push gate. Git skips a\n` +
        `missing or unrunnable hook with no warning, so a push from one of them is unverified and\n` +
        `looks identical to a pass.\n\n` +
        `  ${lines.join("\n\n  ")}\n\n` +
        `This is a statement about the worktrees registered in this clone at this moment. It is not\n` +
        `a claim about other clones, and a failure here is not evidence about past pushes.`,
    ).toEqual([]);
  });

  it("#488: a PEER worktree with no usable hook warns at the gate and blocks only under fleet mode — on a real fixture", () => {
    // The fixture's linked worktree IS the unwired state (nothing sets core.hooksPath there), so it
    // is a real finding from the real inspector, not a stub. With the fixture's main working tree
    // standing in for the pushing checkout, the linked one is a peer by construction.
    const f = fixture("peer-warns");
    const broken = [f.main, f.linked].map((wt) => inspectWorktree(wt, f.main)).filter((r) => !r.ok);
    expect(broken.map((r) => r.path), "the fixture must produce the finding this test is about").toContain(f.linked);

    const gate = splitByFolder(broken, { own: f.main, folderOf: (r) => r.path, fleet: false });
    expect(gate.blocking.map((r) => r.path), "a peer's finding blocked the push").not.toContain(f.linked);
    expect(gate.warnings.map((r) => r.path)).toContain(f.linked);

    const sweep = splitByFolder(broken, { own: f.main, folderOf: (r) => r.path, fleet: true });
    expect(sweep.blocking.map((r) => r.path), "fleet mode must block on the peer").toContain(f.linked);
    expect(sweep.warnings).toEqual([]);

    // The same finding from the folder that HAS it still blocks that folder's own push.
    const own = splitByFolder(broken, { own: f.linked, folderOf: (r) => r.path, fleet: false });
    expect(own.blocking.map((r) => r.path)).toContain(f.linked);
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
