// Guard: a lane session's root is the lane it was LAUNCHED in, not the shared checkout (#637).
//
// Since 2026-09-30 the desktop app hands every hook CLAUDE_PROJECT_DIR = the shared checkout, even
// for a session it opened in `.claude\worktrees\<lane>`. `resolveSessionRoot` believed it, so every
// lane session was bound to the shared checkout: its SessionStart line named the shared checkout,
// its first `git fetch` was refused, and every write into its own lane was refused as another
// checkout's (7 of 7 sessions after the change).
//
// The harness still files each conversation under `projects\<launch folder, spelled with "-">\` and
// passes that file to every hook as `transcript_path`. That is the one fact about the launch folder
// a `cd` cannot move, so it is the only one these tests let pick a lane.
//
// Not gated: main carries the change, so a hook that loses `launchWorktree` fails this suite rather
// than skipping it (review of PR #642).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as hook from "../../.claude/hooks/session-root-assert.mjs";

const BRANCH = "claude/lane-a";
const NOW = new Date("2026-10-02T12:00:00Z");

let base, repo, laneA, laneB;

/** A lane folder the way `git worktree add` leaves one: a `.git` FILE pointing into the repo. */
function lane(name, gitdir = join(repo, ".git", "worktrees", name)) {
  const dir = join(repo, ".claude", "worktrees", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".git"), `gitdir: ${gitdir.replace(/\\/g, "/")}\n`);
  return dir;
}

/** The transcript the harness hands a session launched in `folder`. */
const transcriptOf = (folder, ...tail) =>
  join(base, "home", ".claude", "projects", hook.transcriptFolderFor(folder), ...(tail.length ? tail : ["sid-1.jsonl"]));

const resolveFor = ({ launched, cwd = launched, projectDir = repo }) =>
  hook.resolveSessionRoot({
    env: { CLAUDE_PROJECT_DIR: projectDir },
    hookInput: { transcript_path: launched ? transcriptOf(launched) : undefined, cwd },
    cwd,
  });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "compy-launch-root-"));
  repo = join(base, "sentinel");
  mkdirSync(join(repo, ".git", "worktrees"), { recursive: true });
  laneA = lane("lane-a");
  laneB = lane("lane-b");
});

afterAll(() => {
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("the launch folder decides the root (#637)", () => {
  it("is carried by the hook itself, not skipped when missing", () => {
    expect(typeof hook.launchWorktree).toBe("function");
    expect(typeof hook.transcriptFolderFor).toBe("function");
  });

  it("names the lane a session was launched in, even though CLAUDE_PROJECT_DIR is the shared checkout", () => {
    const r = resolveFor({ launched: laneA });
    expect(r.root).toBe(hook.canonicalizePath(laneA));
    expect(r.source).toBe("launch worktree (transcript_path)");
    expect(r.observed).toBe(true);
  });

  it("does not follow a cd: the shell in lane-b still resolves to lane-a", () => {
    expect(resolveFor({ launched: laneA, cwd: laneB }).root).toBe(hook.canonicalizePath(laneA));
  });

  it("keeps a session launched in the shared checkout there, wherever its shell went", () => {
    const r = resolveFor({ launched: repo, cwd: laneA });
    expect(r.root).toBe(hook.canonicalizePath(repo));
    expect(r.source).toBe("CLAUDE_PROJECT_DIR");
  });

  it("falls back to CLAUDE_PROJECT_DIR when the payload carries no transcript (a hand-run hook)", () => {
    const r = resolveFor({ launched: null, cwd: laneA });
    expect(r.root).toBe(hook.canonicalizePath(repo));
    expect(r.source).toBe("CLAUDE_PROJECT_DIR");
  });

  it("falls back when the launch folder is not a lane of this checkout", () => {
    const r = resolveFor({ launched: join(base, "somewhere-else") });
    expect(r.root).toBe(hook.canonicalizePath(repo));
  });

  it("reads a subagent's transcript the same way as its parent's", () => {
    const r = hook.resolveSessionRoot({
      env: { CLAUDE_PROJECT_DIR: repo },
      hookInput: { transcript_path: transcriptOf(laneA, "sid-1", "subagents", "agent-1.jsonl"), cwd: laneA },
    });
    expect(r.root).toBe(hook.canonicalizePath(laneA));
  });

  it.skipIf(process.platform !== "win32")("matches across drive-letter case and separator spelling", () => {
    const lower = repo[0].toLowerCase() + repo.slice(1).replace(/\\/g, "/");
    expect(resolveFor({ launched: laneA, projectDir: lower }).root).toBe(hook.canonicalizePath(laneA));
  });
});

describe("only a real lane of THIS repository can be named (#637)", () => {
  it("names nobody when two lane folders spell the same transcript name", () => {
    const dash = lane("twin-x");
    lane("twin.x");
    const r = resolveFor({ launched: dash });
    expect(r.root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a folder whose .git points into another repository", () => {
    const foreign = lane("foreign", join(base, "other", ".git", "worktrees", "foreign"));
    expect(resolveFor({ launched: foreign }).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a folder that is its own clone (a .git directory, not a worktree pointer)", () => {
    const clone = join(repo, ".claude", "worktrees", "clone");
    mkdirSync(join(clone, ".git"), { recursive: true });
    expect(resolveFor({ launched: clone }).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a folder with no .git at all", () => {
    const bare = join(repo, ".claude", "worktrees", "bare");
    mkdirSync(bare, { recursive: true });
    expect(resolveFor({ launched: bare }).root).toBe(hook.canonicalizePath(repo));
  });

  it("accepts a relative worktree pointer that lands inside this repository", () => {
    const rel = lane("rel-lane", "../../../.git/worktrees/rel-lane");
    expect(resolveFor({ launched: rel }).root).toBe(hook.canonicalizePath(rel));
  });
});

describe("the assertion runs on the lane, so a claimed lane verifies (#637)", () => {
  const board = () => ({ reachable: true, stale: false, rows: [{ issue: 637, folder: laneA, branch: BRANCH }] });
  const live = { isWorktree: true, branch: BRANCH, repo: "pootytxng/sentinel" };
  const assertFor = (hookInput) =>
    hook.assertSessionRoot({
      board: board(),
      live,
      env: { CLAUDE_PROJECT_DIR: repo, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" },
      hookInput,
      cwd: laneA,
      now: NOW,
    });

  it("verifies a session launched in the lane the board names", () => {
    const r = assertFor({ transcript_path: transcriptOf(laneA), cwd: laneA });
    expect(r.ok).toBe(true);
    expect(r.issue).toBe(637);
    expect(hook.samePath(r.root, laneA)).toBe(true);
  });

  it("still refuses the same shell when the session was launched in the shared checkout", () => {
    const r = assertFor({ transcript_path: transcriptOf(repo), cwd: laneA });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CD_WITHOUT_ROOT");
  });
});
