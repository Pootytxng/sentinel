// Guard: a lane session's root is its own lane, not the shared checkout (#637).
//
// Since 2026-09-30 the desktop app hands every hook CLAUDE_PROJECT_DIR = the shared checkout, even
// for a session it opened in `.claude\worktrees\<lane>`. `resolveSessionRoot` believed it, so every
// lane session was bound to the shared checkout: its SessionStart line named the shared checkout,
// its first `git fetch` was refused, and every write into its own lane was refused as another
// checkout's (7 of 7 sessions after the change).
//
// The harness still files each conversation under `projects\<the session's folder, spelled with
// "-">\`, passes that file to every hook as `transcript_path`, and records the folder exactly as the
// `"cwd"` of its lines. A `cd` does not move the file, and the folders it records do not spell the
// filed name, so a `cd` cannot pick a lane. The spelling alone is lossy (`twin.x` and `twin-x` share
// it), and a pointer can lie, so the lane must also be a worktree that git's own store points back
// at (review of PR #642).
//
// Not gated: main carries the change, so a hook that loses `launchWorktree` fails this suite rather
// than skipping it (review of PR #642).

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as hook from "../../.claude/hooks/session-root-assert.mjs";

const BRANCH = "claude/lane-a";
const NOW = new Date("2026-10-02T12:00:00Z");

let base, repo, laneA, laneB;

const fwd = (p) => p.replace(/\\/g, "/");

/**
 * A lane folder the way `git worktree add` leaves one: a `.git` FILE pointing at an entry in the
 * repository's worktree store, whose own `gitdir` file points back at the lane.
 */
function lane(name, { entry = join(repo, ".git", "worktrees", name), pointer = entry, back } = {}) {
  const dir = join(repo, ".claude", "worktrees", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".git"), `gitdir: ${fwd(pointer)}\n`);
  mkdirSync(entry, { recursive: true });
  writeFileSync(join(entry, "gitdir"), `${fwd(back ?? join(dir, ".git"))}\n`);
  return dir;
}

/** The transcript path the harness hands a session filed under `folder`. */
const transcriptOf = (folder, ...tail) =>
  join(base, "home", ".claude", "projects", hook.transcriptFolderFor(folder), ...(tail.length ? tail : ["sid-1.jsonl"]));

/** A line `kb` kilobytes long that records no folder. */
const pad = (kb) => ({ type: "summary", summary: "x".repeat(kb * 1024) });

/** A line recording that the session was in `cwd`. */
const at = (cwd, content = "next step") => ({ parentUuid: null, type: "user", cwd, sessionId: "sid-1", message: { role: "user", content } });

/**
 * Writes the transcript of a session filed under `folder` the way the harness does: a line with no
 * folder, then each of `lines`, where a string is a folder the session was in.
 */
function transcript(folder, { lines = [folder], tail = [] } = {}) {
  const file = transcriptOf(folder, ...tail);
  mkdirSync(dirname(file), { recursive: true });
  const rows = [{ type: "summary", summary: "earlier work" }, ...lines.map((l) => (typeof l === "string" ? at(l) : l))];
  writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  return file;
}

const resolveFor = ({ transcriptPath, cwd, projectDir = repo }) =>
  hook.resolveSessionRoot({
    env: { CLAUDE_PROJECT_DIR: projectDir },
    hookInput: { transcript_path: transcriptPath, cwd },
    cwd,
  });

/** A session filed under `folder` that recorded `lines`, whose shell is now in `cwd`. */
const filedUnder = (folder, cwd = folder, lines = [folder]) => resolveFor({ transcriptPath: transcript(folder, { lines }), cwd });

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

describe("the session's own folder decides the root (#637)", () => {
  it("is carried by the hook itself, not skipped when missing", () => {
    expect(typeof hook.launchWorktree).toBe("function");
    expect(typeof hook.transcriptFolderFor).toBe("function");
    expect(typeof hook.transcriptCwds).toBe("function");
  });

  it("names the lane a session is filed under, even though CLAUDE_PROJECT_DIR is the shared checkout", () => {
    const r = filedUnder(laneA);
    expect(r.root).toBe(hook.canonicalizePath(laneA));
    expect(r.source).toBe("launch worktree (transcript_path)");
    expect(r.observed).toBe(true);
  });

  it("does not follow a cd: a shell that moved to lane-b still resolves to lane-a", () => {
    expect(filedUnder(laneA, laneB, [laneA, laneB]).root).toBe(hook.canonicalizePath(laneA));
  });

  it("keeps a session filed under the shared checkout there, wherever its shell went", () => {
    const r = filedUnder(repo, laneA, [repo, laneA]);
    expect(r.root).toBe(hook.canonicalizePath(repo));
    expect(r.source).toBe("CLAUDE_PROJECT_DIR");
  });

  it("falls back to CLAUDE_PROJECT_DIR when the payload carries no transcript (a hand-run hook)", () => {
    const r = resolveFor({ transcriptPath: undefined, cwd: laneA });
    expect(r.root).toBe(hook.canonicalizePath(repo));
    expect(r.source).toBe("CLAUDE_PROJECT_DIR");
  });

  it("falls back when the folder is not a lane of this checkout", () => {
    expect(filedUnder(join(base, "somewhere-else")).root).toBe(hook.canonicalizePath(repo));
  });

  it("reads a subagent's folder from its parent's transcript, never its own", () => {
    transcript(laneA);
    // The parent had cd'd to lane-b before it started the subagent, so the subagent's own
    // transcript records only lane-b.
    const own = transcript(laneA, { lines: [laneB], tail: ["sid-1", "subagents", "agent-1.jsonl"] });
    expect(resolveFor({ transcriptPath: own, cwd: laneB }).root).toBe(hook.canonicalizePath(laneA));
  });

  it("names nobody for a subagent whose parent transcript is missing", () => {
    const own = transcript(laneA, { tail: ["sid-9", "subagents", "agent-1.jsonl"] });
    expect(resolveFor({ transcriptPath: own, cwd: laneA }).root).toBe(hook.canonicalizePath(repo));
  });

  it.skipIf(process.platform !== "win32")("matches across drive-letter case and separator spelling", () => {
    const lower = repo[0].toLowerCase() + fwd(repo.slice(1));
    const r = resolveFor({ transcriptPath: transcript(laneA), cwd: laneA, projectDir: lower });
    expect(r.root).toBe(hook.canonicalizePath(laneA));
  });
});

describe("reading the transcript's record (#637)", () => {
  it("takes the payload's cwd when there is no transcript yet, as at startup", () => {
    const r = resolveFor({ transcriptPath: transcriptOf(laneA, "fresh.jsonl"), cwd: laneA });
    expect(r.root).toBe(hook.canonicalizePath(laneA));
  });

  it("takes the payload's cwd when the transcript is still empty", () => {
    const file = transcriptOf(laneA, "empty.jsonl");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
    expect(resolveFor({ transcriptPath: file, cwd: laneA }).root).toBe(hook.canonicalizePath(laneA));
  });

  it("never takes a payload cwd that spells a different folder", () => {
    const r = resolveFor({ transcriptPath: transcriptOf(laneA, "fresh.jsonl"), cwd: laneB });
    expect(r.root).toBe(hook.canonicalizePath(repo));
  });

  it("finds the folder at the end of a transcript that moved there with its session", () => {
    // As three real lanes' transcripts do: begun in the shared checkout, then moved into the lane.
    const lines = [repo, pad(100), { type: "relocated" }, laneA];
    expect(filedUnder(laneA, laneA, lines).root).toBe(hook.canonicalizePath(laneA));
  });

  it("finds the folder at the start after the shell has spent more than the last 1 MB elsewhere", () => {
    const lines = [laneA, repo, pad(600), repo, pad(600), repo];
    expect(filedUnder(laneA, repo, lines).root).toBe(hook.canonicalizePath(laneA));
  });

  it("reads only the first 64 KB and the last 1 MB, so a folder recorded only between them is not found", () => {
    const file = transcript(laneA, { lines: [pad(70), laneA, pad(1100)], tail: ["middle.jsonl"] });
    expect(hook.transcriptCwds(file)).toEqual({ fresh: false, cwds: [] });
    expect(resolveFor({ transcriptPath: file, cwd: laneA }).root).toBe(hook.canonicalizePath(repo));
  });

  it("reads folders from the record, never from message text", () => {
    const twin = join(dirname(laneA), "lane.a");
    expect(hook.transcriptFolderFor(twin)).toBe(hook.transcriptFolderFor(laneA));
    const lines = [at(laneA, JSON.stringify({ cwd: twin }))];
    expect(filedUnder(laneA, laneA, lines).root).toBe(hook.canonicalizePath(laneA));
  });

  it("names nobody when the transcript records two folders that spell its name", () => {
    const dash = lane("duo-x");
    const dot = lane("duo.x");
    expect(filedUnder(dash, dash, [dot, dash]).root).toBe(hook.canonicalizePath(repo));
  });

  it("tells same-spelled lanes apart by the exact folder the transcript records", () => {
    const dash = lane("pair-x");
    const dot = lane("pair.x");
    expect(filedUnder(dot).root).toBe(hook.canonicalizePath(dot));
    expect(filedUnder(dash).root).toBe(hook.canonicalizePath(dash));
  });

  it("names nobody when the transcript records no folder spelled like the one it is filed under", () => {
    expect(filedUnder(laneA, laneB, [laneB]).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a recorded folder that is a relative path, wherever the hook happens to run", () => {
    expect(filedUnder(laneA, laneA, [relative(process.cwd(), laneA)]).root).toBe(hook.canonicalizePath(repo));
  });
});

describe("only a real lane of THIS repository can be named (#637)", () => {
  it("never names a same-spelled sibling once the session's folder is gone", () => {
    const dash = lane("twin-x");
    const gone = join(repo, ".claude", "worktrees", "twin.x");
    expect(hook.transcriptFolderFor(gone)).toBe(hook.transcriptFolderFor(dash));
    expect(filedUnder(gone, dash, [gone]).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a worktree of this repository that lives outside .claude\\worktrees", () => {
    const outside = join(base, "outside-lane");
    const entry = join(repo, ".git", "worktrees", "outside-lane");
    mkdirSync(outside, { recursive: true });
    mkdirSync(entry, { recursive: true });
    writeFileSync(join(outside, ".git"), `gitdir: ${fwd(entry)}\n`);
    writeFileSync(join(entry, "gitdir"), `${fwd(join(outside, ".git"))}\n`);
    expect(filedUnder(outside).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a folder whose .git points into another repository", () => {
    const foreign = lane("foreign", { entry: join(base, "other", ".git", "worktrees", "foreign") });
    expect(filedUnder(foreign).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses an absolute pointer whose .. segments climb out of this repository's store", () => {
    const entry = join(base, "other", ".git", "worktrees", "climb");
    const pointer = `${join(repo, ".git", "worktrees")}\\..\\..\\..\\other\\.git\\worktrees\\climb`;
    const climb = lane("climb", { entry, pointer });
    expect(filedUnder(climb).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a store entry that is a link to somewhere outside the store", () => {
    const elsewhere = join(base, "elsewhere", "linked-entry");
    const inStore = join(repo, ".git", "worktrees", "linked-entry");
    const linked = lane("linked-entry", { entry: elsewhere, pointer: inStore });
    symlinkSync(elsewhere, inStore, "junction");
    expect(filedUnder(linked).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a store entry that names another folder as its worktree", () => {
    const liar = lane("liar", { back: join(laneA, ".git") });
    expect(filedUnder(liar).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a folder that is a link, even one git's store points back at", () => {
    const target = join(base, "moved-lane");
    const link = join(repo, ".claude", "worktrees", "moved-lane");
    const entry = join(repo, ".git", "worktrees", "moved-lane");
    mkdirSync(target, { recursive: true });
    mkdirSync(entry, { recursive: true });
    writeFileSync(join(target, ".git"), `gitdir: ${fwd(entry)}\n`);
    writeFileSync(join(entry, "gitdir"), `${fwd(join(link, ".git"))}\n`);
    symlinkSync(target, link, "junction");
    expect(filedUnder(link).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a folder below a lane", () => {
    const below = join(laneA, "src");
    mkdirSync(below, { recursive: true });
    expect(filedUnder(below).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a folder that is its own clone (a .git directory, not a worktree pointer)", () => {
    const clone = join(repo, ".claude", "worktrees", "clone");
    mkdirSync(join(clone, ".git"), { recursive: true });
    expect(filedUnder(clone).root).toBe(hook.canonicalizePath(repo));
  });

  it("refuses a folder with no .git at all", () => {
    const bare = join(repo, ".claude", "worktrees", "bare");
    mkdirSync(bare, { recursive: true });
    expect(filedUnder(bare).root).toBe(hook.canonicalizePath(repo));
  });

  it("accepts relative pointers both ways, as `worktree.useRelativePaths` writes them", () => {
    const rel = lane("rel-lane", { pointer: "../../../.git/worktrees/rel-lane", back: "../../../.claude/worktrees/rel-lane/.git" });
    expect(filedUnder(rel).root).toBe(hook.canonicalizePath(rel));
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

  it("verifies a session filed under the lane the board names", () => {
    const r = assertFor({ transcript_path: transcript(laneA), cwd: laneA });
    expect(r.ok).toBe(true);
    expect(r.issue).toBe(637);
    expect(hook.samePath(r.root, laneA)).toBe(true);
  });

  it("still refuses the same shell when the session is filed under the shared checkout", () => {
    const r = assertFor({ transcript_path: transcript(repo, { lines: [repo, laneA] }), cwd: laneA });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CD_WITHOUT_ROOT");
  });
});
