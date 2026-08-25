// Guard: a missing observation is not a matching one.
//
// The original defect: `readToken` and `readLineage` were `try { JSON.parse } catch { return null }`.
// A truncated or half-written record therefore reached the "nothing to check against" branch and
// printed the cheerful advisory at exit 0. Something wrote that file precisely so this hook could
// verify against it; losing it is a reason to stop, not to shrug.
//
// #216 REBUILT WHAT IS BEING READ, NOT THIS RULE. Verification is now by facts — a work tree of this
// repository, on the board's branch for the issue, with no live competing writer — so the artifacts
// this file is about are the WRITER LEASE and the cached board answer rather than a launch token.
// The property is unchanged and is the reason the file survives the rebuild: unreadable is not
// agreement, and a fact nobody could measure is not a fact that passed.
//
// One check DID leave with the token, and it should be named rather than quietly missing: the assert
// used to hard-refuse a session whose context window was not the tier the launcher established
// (WINDOW_UNOBSERVED / WINDOW_MISMATCH). It cannot, now that any tab in the right folder verifies —
// a tab the owner opens himself has whatever window it has, and refusing it would rebuild the exact
// lockout #216 is about. The window is measured, recorded on the lease and DISCLOSED in a note.
//
// The line that does NOT move: a session with no artifacts at all is an ordinary unverified session
// and stays advisory. Failing closed is for evidence that was supposed to be there and is not.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOARD_CACHE_NAME,
  CORRUPT,
  TOKEN_NAME,
  assertSessionRoot,
  boardFacts,
  lineageFile,
  makeToken,
  readBoardCache,
  readLineage,
  readToken,
  verdictFor,
  writeBoardCache,
  writeLineage,
  writeToken,
} from "./session-assert.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";
const BRANCH = "tooling/entry-acceptance";
const NOW = new Date("2026-08-25T06:00:00.000Z");
const tok = (over = {}) => makeToken({ issue: 23, folder: FOLDER, branch: BRANCH, window: 300000, ...over });

const BOARD = { reachable: true, stale: false, rows: [{ issue: 23, folder: FOLDER, branch: BRANCH }] };
const LIVE = { isWorktree: true, branch: BRANCH, repo: "pootytxng/sentinel" };
const run = (over = {}) =>
  assertSessionRoot({
    board: BOARD,
    live: LIVE,
    env: { CLAUDE_PROJECT_DIR: FOLDER },
    cwd: FOLDER,
    now: NOW,
    hookInput: { session_id: "11111111-1111-1111-1111-111111111111", cwd: FOLDER },
    ...over,
  });

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-unknown-"));
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("a fact nobody measured", () => {
  it("refuses when the folder itself was never observed", () => {
    const r = run({ live: null });
    expect(r.code).toBe("FACTS_UNOBSERVED");
    expect(verdictFor(r).exit).toBe(2);
  });

  it("refuses an unreadable branch rather than assuming it is the board's", () => {
    expect(run({ live: { ...LIVE, branch: null } }).code).toBe("BRANCH_UNREADABLE");
  });

  it("refuses an unreadable origin rather than assuming it is this repository", () => {
    expect(run({ live: { ...LIVE, repo: null } }).code).toBe("REPO_UNREADABLE");
  });

  it("refuses a root nobody observed, because inferring it from the shell is the original defect", () => {
    expect(run({ env: {}, hookInput: null }).code).toBe("ROOT_UNOBSERVED");
  });
});

describe("a context window nobody observed", () => {
  it("is DISCLOSED rather than refused — a tab the owner opened has the window it has", () => {
    const r = run({ env: { CLAUDE_PROJECT_DIR: FOLDER } });
    expect(r.ok).toBe(true);
    expect(r.window).toBe(null);
    expect(r.notes.join(" ")).toMatch(/no context window observed/);
  });

  it("is recorded when the session really does report one", () => {
    const r = run({ env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" } });
    expect(r.window).toBe(300000);
    expect(r.notes.join(" ")).not.toMatch(/window/);
  });

  it("treats a non-numeric value as unobserved, not as a window of zero", () => {
    for (const value of ["wide", "", "   "]) {
      expect(run({ env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: value } }).window).toBe(null);
    }
  });
});

describe("a record that exists and cannot be read", () => {
  it("is distinguished from a record that is simply absent", () => {
    expect(readToken({ dir })).toBe(null);
    writeFileSync(join(dir, TOKEN_NAME), "{ this is not json");
    expect(readToken({ dir })).toBe(CORRUPT);
  });

  it("treats a non-object payload as corrupt too", () => {
    writeFileSync(join(dir, TOKEN_NAME), '"a string is not a launch record"');
    expect(readToken({ dir })).toBe(CORRUPT);
  });

  it("stops on a damaged writer lease instead of calling the session unverified-but-fine", () => {
    const r = run({ lease: CORRUPT });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("LEASE_CORRUPT");
    expect(verdictFor(r).exit).toBe(2); // the whole point: not the exit 0 advisory
  });

  it("reads a damaged lease file off disk as corrupt, not as absent", () => {
    const f = lineageFile({ root: FOLDER, dir });
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "{{{");
    expect(readLineage({ root: FOLDER, dir })).toBe(CORRUPT);
  });

  it("reads a damaged board cache as absent, so the next read measures instead of trusting it", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, BOARD_CACHE_NAME), "{{{");
    expect(readBoardCache({ dir })).toBe(null);

    // …and with no usable cache and no reachable board, nothing is asserted either way.
    const r = boardFacts({ dir, now: NOW, fetch: () => null });
    expect(r.reachable).toBe(false);
    expect(verdictFor(run({ board: r })).exit).toBe(0);
  });
});

describe("the board cache tells the truth about its own age", () => {
  it("serves a fresh answer without asking again", () => {
    writeBoardCache({ fetchedAt: new Date(NOW.getTime() - 60_000).toISOString(), rows: BOARD.rows }, { dir });
    let asked = 0;
    const r = boardFacts({ dir, now: NOW, fetch: () => { asked += 1; return []; } });
    expect(asked).toBe(0);
    expect(r.stale).toBe(false);
    expect(r.rows).toEqual(BOARD.rows);
  });

  it("re-reads once the answer is older than the TTL", () => {
    writeBoardCache({ fetchedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(), rows: [] }, { dir });
    const r = boardFacts({ dir, now: NOW, fetch: () => BOARD.rows });
    expect(r.rows).toEqual(BOARD.rows);
    expect(readBoardCache({ dir }).rows).toEqual(BOARD.rows);
  });

  it("uses a stale answer when the live read fails, and SAYS it is stale", () => {
    writeBoardCache({ fetchedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(), rows: BOARD.rows }, { dir });
    const r = boardFacts({ dir, now: NOW, fetch: () => null });
    expect(r.reachable).toBe(true);
    expect(r.stale).toBe(true);
    expect(run({ board: r }).notes.join(" ")).toMatch(/cached from/);
  });
});

describe("what stays advisory", () => {
  // An ordinary window Kuya opened himself in a folder no issue claims has no artifacts to have
  // lost. It was never verified and never claimed to be; making it a hard stop would be the
  // entrypoint crying wolf in every session on the machine.
  it("a session in a folder the board does not name", () => {
    const r = run({ board: { reachable: true, rows: [] } });
    expect(r.code).toBe("FOLDER_UNCLAIMED");
    expect(verdictFor(r).exit).toBe(0);
  });

  it("a session whose board could not be reached at all", () => {
    const r = run({ board: { reachable: false, rows: [] } });
    expect(r.code).toBe("BOARD_UNREACHABLE");
    expect(verdictFor(r).exit).toBe(0);
  });

  it("an absent token file reads as absent, not corrupt", () => {
    writeToken(tok(), { dir });
    expect(readToken({ dir })).not.toBe(CORRUPT);
    rmSync(join(dir, TOKEN_NAME), { force: true });
    expect(readToken({ dir })).toBe(null);
  });

  it("an absent lease reads as absent, and a written one round-trips", () => {
    expect(readLineage({ root: FOLDER, dir })).toBe(null);
    writeLineage({ folder: FOLDER, issue: 23, branch: BRANCH, sessionId: "s", pid: 4242 }, { dir });
    expect(readLineage({ root: FOLDER, dir }).pid).toBe(4242);
  });
});
