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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CREATE_BASE_REF, HERE, HOST_DIR, settingsSourceFor } from "./gather.mjs";
import { reconcile } from "./preflight.mjs";
import {
  PROJECT_SETTINGS_PATH,
  compareWindow,
  intendedWindow,
  resolveSettingsFromSnapshot,
  resolveWindow,
  resolveWindowFromSnapshot,
} from "./settings-resolve.mjs";

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
  it("REPRODUCTION: the launcher's own directory answers 150000 unconfigured, and is refused", () => {
    // This is the state the old code shipped to preflight. It is still a refusal — correctly so,
    // because an unconfigured coincidence is not a decision. Nothing about the comparison was
    // wrong; asking the wrong folder was.
    const fromLauncher = resolveWindow({ dir: HERE, home: emptyHome, env: {} });
    expect(fromLauncher.configured).toBe(false);
    expect(fromLauncher.window).toBe(150000);

    const check = windowCheck(STANDARD, fromLauncher);
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

  it("an absent folder answers with the commit it will be created from — never the launcher's own", () => {
    const src = settingsSourceFor(target, { exists: false });
    expect(src).toEqual({ kind: "snapshot", hostDir: HOST_DIR, ref: CREATE_BASE_REF });
    expect(Object.values(src)).not.toContain(HERE); // the exact substitution that deadlocked
  });

  it("a task with no worktree field at all is still a snapshot, not a fallback directory", () => {
    expect(settingsSourceFor(null, { exists: false }).kind).toBe("snapshot");
  });

  it("launch.mjs creates from the same constant preflight verified, not its own copy of the ref", () => {
    // If these two ever drift, the folder that opens is not the folder that was checked — and the
    // check would be worthless while still printing green.
    const src = readFileSync(join(HERE, "launch.mjs"), "utf8");
    expect(src).toContain("CREATE_BASE_REF");
    expect(src).not.toMatch(/["']origin\/main["']/);
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
  });

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
