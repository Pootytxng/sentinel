// bug->guard (#21) — the first-launch worktree deadlock.
//
// What Kuya hit, on the very first real launch, before any write: the target folder
// C:\Users\Kuya\code\sentinel-marathon did not exist yet. `gatherFacts()` substituted the launcher's
// OWN directory (tools/entry/) for the absent target. That directory configures nothing, so
// `resolveWindow()` returned the documented 150000 fallback with `configured:false` — and because
// origin/main happens to carry CLAUDE_CODE_AUTO_COMPACT_WINDOW=150000, preflight printed
//
//     settings.window   expected 150000   actual 150000        REFUSE
//
// A safely-creatable worktree was impossible to create through the entrypoint, and the refusal did
// not name a fixable cause. Both halves are guarded here: the numbers were never the bug, the
// PROVENANCE was.
//
// The invariant: a first launch must verify the settings of the exact source snapshot the worktree
// will be created from, and must never treat the launcher's own directory fallback as the future
// worktree's effective settings.
//
// Fail-closed is the other half of the fix. Loosening the deadlock must not loosen the guard, so
// missing / unparseable / smaller / larger all still refuse — a snapshot that cannot be read is not
// a snapshot that agrees.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseClaim, planPostClaim, threadLease } from "./claim.mjs";
import { CREATE_BASE_REF, HERE, HOST_DIR, refreshCreateBase, resolveCreateBase, settingsSourceFor } from "./gather.mjs";
import { createWorktree, refreshAndCreate } from "./launch.mjs";
// By namespace, so the renewal guards below fail one by one on a launcher that has no claim step.
import * as launcher from "./launch.mjs";
import { reconcile } from "./preflight.mjs";
import { DOCUMENTED_FALLBACK_WINDOW } from "../../scripts/lib/compaction-window.mjs";
import {
  PROJECT_SETTINGS_PATH,
  compareWindow,
  intendedWindow,
  resolveSettingsFromSnapshot,
  resolveWindow,
  resolveWindowFromSnapshot,
} from "./settings-resolve.mjs";
import { establishTier } from "./tier.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";

const POLICY = { default: 150000, tiers: [{ window: 300000, issues: [15, 16, 19], note: "the marathon tier" }] };

/** The train Kuya was launching: standard tier, so it intends the policy default. */
const STANDARD = intendedWindow(POLICY, { issue: 21 });
const MARATHON = intendedWindow(POLICY, { issue: 19 });

/** What `git show origin/main:.claude/settings.json` really returns, and the ways it can fail. */
const snapshots = {
  configured: () => JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000", CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" } }),
  marathon: () => JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" } }),
  smaller: () => JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "100000" } }),
  missing: () => null,
  unparseable: () => '{ "env": { "CLAUDE_CODE_AUTO_COMPACT_WINDOW": ',
  typo: () => JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300k" } }),
  // A disagreement the launcher has no business settling: it owns the context window in its own
  // gitignored layer and nothing else. Used by the TOCTOU guard below.
  wrongModel: () => JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000", CLAUDE_CODE_SUBAGENT_MODEL: "opus" } }),
};

let root;
/** A home with no user settings, so the machine's real ~/.claude never colours a guard. */
let emptyHome;

const fromSnapshot = (read, env = {}) =>
  resolveWindowFromSnapshot({ hostDir: "(unused — read is injected)", ref: CREATE_BASE_REF, home: emptyHome, env, read });

/** The one row this whole file is about, produced by the real reconciler. */
const windowCheck = (intended, effective) =>
  reconcile({ window: { intended, effective } }).checks.find((c) => c.name === "settings.window");

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-first-launch-"));
  emptyHome = join(root, "no-home");
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("the deadlock itself", () => {
  it("REPRODUCTION: the launcher's own directory answers the fallback unconfigured, and is refused", () => {
    // This is the state the old code shipped to preflight. It is still a refusal — correctly so,
    // because an unconfigured coincidence is not a decision. Nothing about the comparison was
    // wrong; asking the wrong folder was.
    const fromLauncher = resolveWindow({ dir: HERE, home: emptyHome, env: {} });
    expect(fromLauncher.configured).toBe(false);
    // The documented fallback, not a literal — what is being reproduced is "unconfigured", and the
    // 150000 literal that used to sit here made this a version pin instead of a guard.
    expect(fromLauncher.window).toBe(DOCUMENTED_FALLBACK_WINDOW);

    // Reconstruct the coincidence the reproduction is about — a policy default that happens to equal
    // the unconfigured fallback — instead of relying on the two literals staying equal by luck.
    const coincident = intendedWindow({ ...POLICY, default: DOCUMENTED_FALLBACK_WINDOW }, { issue: 21 });
    const check = windowCheck(coincident, fromLauncher);
    expect(check.ok).toBe(false);
    expect(check.expected).toBe(check.actual); // the confusing part of the report Kuya saw
    expect(check.remediation).toMatch(/not configured/i);
  });

  it("THE FIX: an absent target resolves from the snapshot it will be created from, and passes", () => {
    const effective = fromSnapshot(snapshots.configured);
    expect(effective).toMatchObject({ window: 150000, configured: true, layer: "project" });
    expect(effective.snapshot).toBe(`${CREATE_BASE_REF}:${PROJECT_SETTINGS_PATH}`);

    const check = windowCheck(STANDARD, effective);
    expect(check.ok).toBe(true);
  });

  it("a PASSING first-launch row discloses that it measured a snapshot, not a folder", () => {
    // Provenance was the bug. A green row that silently measured something other than the folder
    // being opened would be the same defect with a friendlier face.
    const check = windowCheck(STANDARD, fromSnapshot(snapshots.configured));
    expect(check.ok).toBe(true);
    expect(check.note).toContain(`${CREATE_BASE_REF}:${PROJECT_SETTINGS_PATH}`);
    expect(check.note).toMatch(/does not exist yet/i);
  });

  it("the refusal names the snapshot, so it is fixable without guessing which file to edit", () => {
    const c = compareWindow(STANDARD, fromSnapshot(snapshots.missing));
    expect(c.ok).toBe(false);
    expect(c.remediation).toContain(`${CREATE_BASE_REF}:${PROJECT_SETTINGS_PATH}`);
    expect(c.remediation).toContain("CLAUDE_CODE_AUTO_COMPACT_WINDOW");
  });

  it("resolves the rest of the snapshot's settings too, not just the window", () => {
    const s = resolveSettingsFromSnapshot({ hostDir: "x", ref: CREATE_BASE_REF, home: emptyHome, env: {}, read: snapshots.configured });
    expect(s.envValues.CLAUDE_CODE_SUBAGENT_MODEL).toMatchObject({ value: "sonnet", layer: "project" });
    // No local overlay can exist for a folder that does not exist.
    expect(s.files.map((f) => f.layer)).toEqual(["user", "project"]);
  });
});

describe("fail-closed — loosening the deadlock did not loosen the guard", () => {
  it("refuses when the snapshot has no settings file at all", () => {
    const e = fromSnapshot(snapshots.missing);
    expect(e.configured).toBe(false);
    expect(windowCheck(STANDARD, e).ok).toBe(false);
  });

  it("refuses when the snapshot's settings file is unparseable", () => {
    const e = fromSnapshot(snapshots.unparseable);
    expect(e.configured).toBe(false);
    expect(windowCheck(STANDARD, e).ok).toBe(false);
  });

  it("refuses an unparseable VALUE, and says which one it ignored", () => {
    const e = fromSnapshot(snapshots.typo);
    expect(e.configured).toBe(false);
    expect(e.ignored.map((i) => i.value)).toContain("300k");
    expect(compareWindow(STANDARD, e).remediation).toContain("300k");
  });

  it("refuses a snapshot configured SMALLER than the train intends", () => {
    const c = compareWindow(STANDARD, fromSnapshot(snapshots.smaller));
    expect(c).toMatchObject({ ok: false, expected: 150000, actual: 100000 });
  });

  it("refuses a snapshot configured LARGER than the train intends", () => {
    // The marathon tier must not leak into a standard train just because the branch it forks from
    // carries it. Accepted is not default, on a folder that does not exist yet either.
    const c = compareWindow(STANDARD, fromSnapshot(snapshots.marathon));
    expect(c).toMatchObject({ ok: false, expected: 150000, actual: 300000 });
  });

  it("still passes a marathon train whose snapshot really is configured for the tier", () => {
    expect(compareWindow(MARATHON, fromSnapshot(snapshots.marathon)).ok).toBe(true);
  });

  it("the process environment still wins, because that is what a live session runs on", () => {
    // How the deadlock was actually broken: one process-scoped override for the creation run only.
    // It must remain visible as an env value, never laundered into looking like configuration.
    const e = fromSnapshot(snapshots.missing, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" });
    expect(e).toMatchObject({ window: 150000, configured: true, source: "env", file: "process environment" });
    expect(windowCheck(STANDARD, e).ok).toBe(true);
  });
});

describe("the source of the settings is chosen, never defaulted to whatever is nearest", () => {
  const target = { path: join("C:\\Users\\Kuya\\code", "sentinel-marathon"), branch: "tooling/marathon-tier" };

  it("an existing folder answers for itself", () => {
    expect(settingsSourceFor(target, { exists: true })).toEqual({ kind: "folder", dir: target.path });
  });

  it("an absent folder answers with the COMMIT it will be created from — never a movable name", () => {
    const base = { ref: CREATE_BASE_REF, sha: "a".repeat(40), ok: true, error: null };
    const src = settingsSourceFor(target, { exists: false, base });
    expect(src).toMatchObject({ kind: "snapshot", hostDir: HOST_DIR });
    // The id, not the name it was looked up under. `origin/main` here IS the TOCTOU defect: a name
    // resolved once for the settings and again for `git worktree add` is two different questions.
    expect(src.ref).toBe(base.sha);
    expect(src.ref).not.toBe(CREATE_BASE_REF);
    expect(Object.values(src)).not.toContain(HERE); // the exact substitution that deadlocked
  });

  it("an unpinned base reads no settings at all, rather than falling back to the name", () => {
    const src = settingsSourceFor(target, { exists: false, base: { ref: CREATE_BASE_REF, sha: null, ok: false, error: "no remote" } });
    expect(src.ref).toBe(null);
    // `read` would happily answer — it is never asked, because there is no commit to ask about.
    const e = resolveWindowFromSnapshot({ hostDir: "(unused)", ref: src.ref, home: emptyHome, env: {}, read: snapshots.configured });
    expect(e.configured).toBe(false);
    expect(windowCheck(STANDARD, e).ok).toBe(false);
  });

  it("a task with no worktree field at all is still a snapshot, not a fallback directory", () => {
    expect(settingsSourceFor(null, { exists: false }).kind).toBe("snapshot");
  });
});

describe("against a real repository — the argv form of `git show` survives Windows", () => {
  // Git Bash rewrites `origin/main:.claude/settings.json` into a Windows path when it goes through a
  // shell. execFileSync passes argv straight to git, which is why this works; this test is what
  // stops anyone "simplifying" it back into a shell string.
  let repo;
  let head;
  const git = (args, cwd = repo) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  beforeAll(() => {
    repo = join(root, "repo");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    git(["-c", "init.defaultBranch=main", "init", "-q", repo], root);
    git(["config", "user.email", "guard@example.invalid"]);
    git(["config", "user.name", "guard"]);
    writeFileSync(join(repo, ".claude", "settings.json"), snapshots.configured());
    git(["add", PROJECT_SETTINGS_PATH]);
    git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "settings"]);
    head = git(["rev-parse", "--short", "HEAD"]);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("reads tracked settings out of a commit with no working tree involved", () => {
    const e = resolveWindowFromSnapshot({ hostDir: repo, ref: "HEAD", home: emptyHome, env: {} });
    expect(head).toMatch(/^[0-9a-f]{7,}$/);
    expect(e).toMatchObject({ window: 150000, configured: true, source: "settings", layer: "project" });
    expect(e.file).toBe(`HEAD:${PROJECT_SETTINGS_PATH}`);
  });

  it("fails closed on an unknown ref instead of throwing at the owner", () => {
    const e = resolveWindowFromSnapshot({ hostDir: repo, ref: "origin/nope", home: emptyHome, env: {} });
    expect(e.configured).toBe(false);
    expect(windowCheck(STANDARD, e).ok).toBe(false);
  });
});

// bug->guard (#21, second finding) — time of check must be time of USE.
//
// The first fix read the future worktree's settings through `origin/main`, then `createWorktree()`
// ran `git fetch`, then `git worktree add` resolved `origin/main` a SECOND time. Both call sites
// named the same constant, so a source-text assertion was green — and the launcher could still
// verify commit A, create commit B, and print the two as identical.
//
// A movable ref cannot be raced with injected data, so this fixture is real: a bare upstream, the
// host checkout that the launcher runs in, and a SECOND clone that pushes mid-launch. Pushing from
// `host` would update its own remote-tracking ref and destroy the very staleness being tested.
describe("time of check == time of use — the base is pinned to one commit", () => {
  let bed;
  let upstream;
  let author;
  let host;
  let seq = 0;
  const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  /** A second writer lands a commit on the upstream. The host does not see it until it fetches. */
  const advance = (settings = snapshots.configured()) => {
    seq += 1;
    writeFileSync(join(author, ".claude", "settings.json"), JSON.stringify({ ...JSON.parse(settings), _seq: seq }, null, 2));
    git(author, ["add", "-A"]);
    git(author, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", `upstream moves (${seq})`]);
    git(author, ["push", "-q", "origin", "main"]);
    return git(author, ["rev-parse", "HEAD"]);
  };

  /** The facts of a first launch: the target folder does not exist, so a create is authorized. */
  const worldFor = (target, base) => ({
    board: { reachable: true },
    self: { lane: "Claude Code" },
    now: new Date("2026-07-30T12:00:00Z"),
    task: {
      number: 21, title: "One owner-facing Compy entrypoint", status: "Active", lane: "Claude Code", gate: "None",
      worktreeBranch: `${target.path} @ ${target.branch}`, nextAction: "Create the worktree.", claimExpires: "2026-07-31",
    },
    items: [{ number: 21, status: "Active", lane: "Claude Code", worktreeBranch: `${target.path} @ ${target.branch}` }],
    claim: { issue: 21, lane: "Claude Code", folder: target.path, branch: target.branch, expires: "2026-07-31" },
    handoff: null,
    checkouts: [{ path: host, branch: "main", kind: "host", commonDir: join(host, ".git"), remote: upstream }],
    gitState: null,
    expectedCommonDir: join(host, ".git"),
    base,
    window: { intended: STANDARD, effective: null },
    subagentModel: null,
    hooks: null,
    processes: [],
    scope: { mine: ["tools/entry"], text: "`tools/entry/`", source: "claim", others: [], files: [] },
  });

  beforeAll(() => {
    bed = join(root, "toctou");
    upstream = join(bed, "upstream.git");
    author = join(bed, "author");
    host = join(bed, "host");
    mkdirSync(bed, { recursive: true });
    git(bed, ["-c", "init.defaultBranch=main", "init", "-q", "--bare", upstream]);
    git(bed, ["clone", "-q", upstream, author]);
    git(author, ["config", "user.email", "guard@example.invalid"]);
    git(author, ["config", "user.name", "guard"]);
    git(author, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    mkdirSync(join(author, ".claude"), { recursive: true });
    advance();
    git(bed, ["clone", "-q", upstream, host]);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("REPRODUCTION: resolving the NAME twice verifies one commit and creates another", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    // The exact sequence that shipped. Kept permanently, because this is what the fix prevents —
    // and it is a property of a movable ref, not of any one version of our code.
    const verified = git(host, ["rev-parse", CREATE_BASE_REF]);
    const readAt = resolveWindowFromSnapshot({ hostDir: host, ref: CREATE_BASE_REF, home: emptyHome, env: {} });
    expect(readAt.configured).toBe(true);
    expect(readAt.snapshot).toBe(`${CREATE_BASE_REF}:${PROJECT_SETTINGS_PATH}`); // names the ref, not a commit

    const moved = advance(); // a second writer pushes while preflight is running
    git(host, ["fetch", "origin", "--quiet"]); // what createWorktree() used to do, mid-launch
    const wt = join(bed, "wt-repro");
    git(host, ["worktree", "add", "-b", "repro/movable-name", wt, CREATE_BASE_REF]);

    expect(git(wt, ["rev-parse", "HEAD"])).toBe(moved);
    expect(moved).not.toBe(verified); // verified A, created B — and the report said neither
  });

  it("THE FIX: the commit whose settings were verified IS the commit the worktree is created from", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const preliminary = resolveCreateBase({ hostDir: host }); // stage 1 — read-only, no fetch
    expect(preliminary.ok).toBe(true);
    expect(preliminary.sha).toBe(git(host, ["rev-parse", CREATE_BASE_REF]));

    const moved = advance(); // the race, again
    expect(moved).not.toBe(preliminary.sha);

    const target = { path: join(bed, "wt-pinned"), branch: "fix/pinned-base" };
    const out = refreshAndCreate({ facts: worldFor(target, preliminary), target, base: preliminary, hostDir: host, env: {} });

    expect(out.verdict.verdict).toBe("PASS");
    expect(out.created).toBe(moved); // the refreshed commit, not the one preflight first saw
    expect(git(target.path, ["rev-parse", "HEAD"])).toBe(out.created);

    // The identity that matters: the settings this verdict passed on were read from that same id.
    const window = out.verdict.checks.find((c) => c.name === "settings.window");
    expect(window.ok).toBe(true);
    expect(window.note).toContain(`${out.created}:${PROJECT_SETTINGS_PATH}`);
    expect(out.verdict.checks.find((c) => c.name === "base.pinned").actual).toBe(out.created);
  });

  it("a base that moves to a DISAGREEING commit refuses, and creates nothing", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    // Re-verifying after the fetch is only worth anything if the second verdict can still say no.
    //
    // The disagreement used to be the window. It no longer can be: #23 gave the launcher the power to
    // ESTABLISH the window in its own gitignored layer, so a window mismatch is now settled rather
    // than refused (the test below proves it, end to end). The TOCTOU property is unchanged and is
    // proven here with a disagreement the launcher has no business settling — the subagent model,
    // which it neither owns nor writes.
    const preliminary = resolveCreateBase({ hostDir: host });
    advance(snapshots.wrongModel());
    const target = { path: join(bed, "wt-refused"), branch: "fix/refused-base" };
    const out = refreshAndCreate({ facts: worldFor(target, preliminary), target, base: preliminary, hostDir: host, env: {} });

    expect(out.verdict.verdict).toBe("REFUSE");
    expect(out.verdict.checks.find((c) => c.name === "settings.subagentModel")).toMatchObject({ ok: false, actual: "opus" });
    expect(out.created).toBe(null);
    expect(existsSync(target.path)).toBe(false);
  });

  // Guard 7, end to end and at the worst possible moment: the base moves to a commit whose TRACKED
  // settings carry the marathon tier while this train is standard. Refusing was the old answer and it
  // left Kuya with a folder he could not create; adopting 300000 would be worse. The launcher creates
  // from the refreshed commit, says on the row what it will establish, and then establishes it — the
  // session runs at the window its policy names, not the one its branch happened to carry.
  it("a base that moves to a window this train does not intend is ESTABLISHED, never adopted", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const preliminary = resolveCreateBase({ hostDir: host });
    const moved = advance(snapshots.marathon());
    const target = { path: join(bed, "wt-established"), branch: "fix/established-base" };
    const out = refreshAndCreate({ facts: worldFor(target, preliminary), target, base: preliminary, hostDir: host, env: {} });

    expect(out.verdict.verdict).toBe("PASS");
    expect(out.created).toBe(moved);
    const row = out.verdict.checks.find((c) => c.name === "settings.window");
    expect(row.ok).toBe(true);
    expect(row.note).toMatch(/establish 150000/);
    expect(resolveWindow({ dir: target.path, home: emptyHome, env: {} }).window).toBe(300000); // as created

    const established = establishTier({ dir: target.path, intended: STANDARD, stateDir: join(root, "toctou-tiers"), home: emptyHome, env: {} });
    expect(established.wrote).toBe(true);
    expect(resolveWindow({ dir: target.path, home: emptyHome, env: {} }).window).toBe(150000);
  });

  it("createWorktree refuses anything that is not a pinned commit id, rather than falling back", () => {
    const path = join(bed, "wt-never");
    const branch = "never/created";
    const unpinned = [
      null,
      { ref: CREATE_BASE_REF, sha: null, ok: false, error: "no remote" },
      { ref: CREATE_BASE_REF, sha: CREATE_BASE_REF, ok: true }, // the movable name itself
      { ref: CREATE_BASE_REF, sha: git(host, ["rev-parse", "--short", "HEAD"]), ok: true }, // an abbreviation is not an id
    ];
    for (const base of unpinned) {
      expect(() => createWorktree({ path, branch, base, hostDir: host })).toThrow(/unpinned/i);
    }
    expect(existsSync(path)).toBe(false);
  });

  it("refreshCreateBase is the only fetch, and it re-pins to what it just fetched", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const moved = advance();
    expect(resolveCreateBase({ hostDir: host }).sha).not.toBe(moved); // stale until something fetches
    expect(refreshCreateBase({ hostDir: host })).toMatchObject({ ok: true, fetched: true, sha: moved });
  });

  it("an unresolvable base fails closed, and the verdict names it as the cause", () => {
    const b = resolveCreateBase({ hostDir: host, ref: "origin/nope" });
    expect(b).toMatchObject({ ok: false, sha: null });
    expect(b.error).toContain("origin/nope");
    const row = reconcile({ base: b }).checks.find((c) => c.name === "base.pinned");
    expect(row.ok).toBe(false);
    // Fails closed and says why: the ref, and that nothing is created from a guess.
    expect(row.remediation).toMatch(/origin\/nope does not resolve to a commit .*nothing safe to create from/i);
  });

  it("the passing base row says which commit out loud, so a green report cannot hide it", () => {
    const b = resolveCreateBase({ hostDir: host });
    const row = reconcile({ base: b }).checks.find((c) => c.name === "base.pinned");
    expect(row.ok).toBe(true);
    expect(row.actual).toBe(b.sha);
    expect(row.note).toContain(b.sha.slice(0, 7));
  });
});

// bug->guard (#648) — the launcher's renewal posted no claim.
//
// With a claim already on the thread the launcher posted "Claim renewed until DATE." and moved the
// board's date. That line has no claim header, so the thread kept the old expiry while the board
// showed the new one. A renewal now re-posts the full claim through the writer a first claim uses.
//
// `launch()` reads GitHub and this machine, and a module mock does not reach a natively loaded .mjs
// (see gh-read-bound.test.mjs), so the claim step is driven on its own with the writer injected and
// its place in `launch()` is pinned by source text.

const RENEW_NOW = new Date("2026-10-13T10:00:00Z");
const LEASED = { path: "C:\\Users\\Kuya\\code\\sentinel-renew", branch: "claude/renew-holder-648" };
const LEASE_SCOPE = "`tools/entry/preflight.mjs`, `tools/entry/launch.mjs`";
const SELF = { lane: "Claude Code" };
const TASK_648 = { number: 648, itemId: "PVTI_x", nextAction: "Renew the lease, then carry on." };
const PASSED = {
  verdict: "PASS",
  checks: [{ name: "task.claim", expected: "a thread-live lease held by this exact executor", actual: "held by this executor until 2026-10-12", ok: true }],
};
const IDS = {
  projectId: "PVT_x",
  itemId: "PVTI_x",
  fields: {
    status: { id: "F_status", options: { Active: "o_active" } },
    lane: { id: "F_lane", options: { "Claude Code": "o_cc" } },
    worktree: { id: "F_wt" },
    nextAction: { id: "F_next" },
    claimExpires: { id: "F_exp" },
    lastVerified: { id: "F_ver" },
  },
};
const HELD = { lane: "Claude Code", executor: "Claude Code", folder: LEASED.path, branch: LEASED.branch, scope: LEASE_SCOPE, expires: "2026-10-12", postedAt: "2026-10-12T07:59:55Z" };
const OLD_CLAIM = [
  "### Ownership claim",
  "",
  "- Lane: Claude Code",
  "- Executor/tool: Claude Code",
  `- Worktree folder: ${LEASED.path}`,
  `- Branch: ${LEASED.branch}`,
  `- Write scope: ${LEASE_SCOPE}`,
  "- Claim expires: 2026-10-12",
].join("\n");

const leaseFacts = (over = {}) => ({ now: RENEW_NOW, claim: HELD, scope: { text: LEASE_SCOPE, source: "claim" }, processes: [], ...over });
/** The comment the real plan builder would post for what the claim step handed the writer. */
const bodyOf = (posted) => {
  const [comment] = planPostClaim(posted);
  return comment.argv[comment.argv.indexOf("--body") + 1];
};

function claimStep({ facts = leaseFacts(), verdict = PASSED, effects = new launcher.Effects(), post = null } = {}) {
  const posted = [];
  const out = launcher.postLeaseClaim({
    task: TASK_648,
    target: LEASED,
    facts,
    verdict,
    self: SELF,
    effects,
    projectIds: () => IDS,
    // `post: undefined` is the real writer. It is only ever reached here with a verdict it refuses.
    ...(post === "real" ? {} : { post: post ?? ((claim) => void posted.push(claim)) }),
  });
  return { out, posted, effects };
}

describe("#648: the launcher's renewal posts a claim the thread can read", () => {
  it("the line the old renewal posted is not a claim, so the thread kept the old expiry", () => {
    const thread = [
      { body: OLD_CLAIM, createdAt: HELD.postedAt },
      { body: "Claim renewed until 2026-10-13.", createdAt: RENEW_NOW.toISOString() },
    ];
    expect(parseClaim(thread[1].body)).toBeNull();
    expect(threadLease(thread).claim.expires).toBe("2026-10-12");
  });

  it("a renewal re-posts the full claim, and the thread reads the new expiry from it", () => {
    const { out, posted, effects } = claimStep();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ issue: 648, verdict: PASSED, ids: IDS });

    const body = bodyOf(posted[0]);
    expect(body).not.toContain("Claim renewed until");
    expect(body).toContain("#### Preflight verdict: PASS");
    expect(parseClaim(body)).toMatchObject({ lane: "Claude Code", executor: "Claude Code", folder: LEASED.path, branch: LEASED.branch, expires: "2026-10-13" });

    const lease = threadLease([
      { body: OLD_CLAIM, createdAt: HELD.postedAt },
      { body, createdAt: RENEW_NOW.toISOString() },
    ]);
    expect(lease.claim.expires).toBe("2026-10-13");
    // It restates the lease rather than starting another: both claims are one run.
    expect(lease.run).toHaveLength(2);

    expect(out).toEqual({ expires: "2026-10-13", renewing: true });
    expect(effects.done).toEqual([{ what: "renewed the ownership claim", detail: "#648 until 2026-10-13" }]);
  });

  it("a renewal restates the lease's own scope, whatever scope this run was handed", () => {
    const { posted } = claimStep({ facts: leaseFacts({ scope: { text: "`tools/entry/` `docs/`", source: "cli" } }) });
    expect(posted[0].facts.scope).toBe(LEASE_SCOPE);
    expect(parseClaim(bodyOf(posted[0])).scope).toBe(LEASE_SCOPE);
  });

  it("the comment is the first step and the board follows it", () => {
    const plan = planPostClaim(claimStep().posted[0]);
    expect(plan[0].argv.slice(0, 2)).toEqual(["issue", "comment"]);
    expect(plan.slice(1).every((step) => step.argv[0] === "project")).toBe(true);
    expect(plan.find((step) => step.argv.includes("F_exp")).argv).toContain("2026-10-13");
  });

  it("a comment that fails records nothing, so nothing downstream acts on a claim that is not there", () => {
    const effects = new launcher.Effects();
    const failed = () => {
      throw new Error("gh: the comment was not posted");
    };
    expect(() => claimStep({ effects, post: failed })).toThrow(/the comment was not posted/);
    expect(effects.wroteAnything).toBe(false);
  });

  it("the writer still refuses an absent or a non-PASS verdict, on a renewal as on a first claim", () => {
    for (const verdict of [null, { verdict: "REFUSE", checks: [] }]) {
      for (const facts of [leaseFacts(), leaseFacts({ claim: null })]) {
        const effects = new launcher.Effects();
        expect(() => claimStep({ facts, verdict, effects, post: "real" })).toThrow(/Refusing to post a claim on #648: preflight verdict is/);
        expect(effects.wroteAnything).toBe(false);
      }
    }
  });

  it("a first claim still posts, with the scope measured at launch", () => {
    const { out, posted, effects } = claimStep({ facts: leaseFacts({ claim: null, scope: { text: "`tools/entry/cli.mjs`", source: "issue" } }) });
    expect(out).toEqual({ expires: "2026-10-13", renewing: false });
    expect(posted[0].facts).toMatchObject({ lane: "Claude Code", executor: "Claude Code", folder: LEASED.path, branch: LEASED.branch, scope: "`tools/entry/cli.mjs`", started: "2026-10-13" });
    expect(effects.done).toEqual([{ what: "posted the ownership claim", detail: "#648 until 2026-10-13" }]);
    // No scope measured is said in the claim itself, never filled in from the title (#358).
    expect(claimStep({ facts: leaseFacts({ claim: null, scope: null }) }).posted[0].facts.scope).toMatch(/not declared at launch/);
  });

  it("`launch()` posts through that step, and still asks the fresh-entry question", () => {
    const src = readFileSync(join(HERE, "launch.mjs"), "utf8").replace(/\r\n/g, "\n");
    // The unparseable renewal and the two names that posted it are gone from the launcher.
    expect(src).not.toMatch(/planRenew|execPlan/);
    expect(src).not.toContain("Claim renewed until");
    const start = src.indexOf("export async function launch(");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).toContain("postLeaseClaim({");
    expect(body).toContain("reconcile(facts)");
    // The holder path is the `--renew` entry's alone: a launch never borrows its leniency.
    expect(body).not.toContain("reconcileHolder");
    // Nor the holder's measurements: what a renewing command establishes about itself admits no fresh entry.
    expect(body).not.toContain("observeHolder");
    expect(body).not.toContain("callerWitness");
    // And the renewal's own witness is real: the launcher has one, and `renew` re-measures with it.
    expect(src).toContain("callerWitness(");
  });

  it("a fresh launch into an expired or dirty folder still refuses", () => {
    const world = {
      task: { number: 648, status: "Active", worktreeBranch: `${LEASED.path} @ ${LEASED.branch}` },
      self: SELF,
      claim: HELD,
      now: new Date("2026-10-14T10:00:00Z"),
      checkouts: [{ path: LEASED.path, branch: LEASED.branch }],
      gitState: { ok: true, branch: LEASED.branch, detached: false, clean: false, modified: 1 },
    };
    const rows = Object.fromEntries(reconcile(world).checks.map((c) => [c.name, c.ok]));
    expect(rows["task.claim"]).toBe(false);
    expect(rows["git.clean"]).toBe(false);
  });
});
