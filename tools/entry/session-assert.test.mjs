// Guards 1 and 8 — the two failures that only the session itself can see.
//
// Guard 1: claimed `sentinel-feedback` while the session root is `sentinel-rel`. This is the #14
// failure. Everything before launch can agree perfectly and still be wrong, because the launcher's
// word for its own correctness is not evidence.
//
// Guard 8: a launcher that changes shell directories without changing Claude's real project root.
// The `cd` succeeds, the prompt looks right, and every command that uses a relative path lands in
// the intended folder — while settings, hooks and the context window all still come from somewhere
// else. Its tell is precise: cwd matches the claim, the project root does not.
//
// #216 CHANGED WHAT THE CLAIM IS, NOT WHAT THESE GUARDS CATCH. The claim used to be a launch token:
// one folder, one conversation, handed out once. It is now the Work Control board — the issue's
// `Worktree / branch` field — which is the same claim every human and every agent already reads, and
// which no session can consume. Guard 1 is therefore "the board does not name this folder", and
// guard 8 is unchanged, because the shell-moved-but-root-did-not tell is a property of the session
// rather than of the token that started it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSessionRoot,
  makeToken,
  readToken,
  resolveSessionRoot,
  verdictFor,
  writeToken,
} from "./session-assert.mjs";

const CLAIMED = "C:\\Users\\Kuya\\code\\sentinel-feedback";
const ELSEWHERE = "C:\\Users\\Kuya\\code\\sentinel-rel";
const BRANCH = "feat/user-feedback-lab-recovery";
const NOW = new Date("2026-07-30T12:00:00Z");

const BOARD = { reachable: true, stale: false, rows: [{ issue: 14, folder: CLAIMED, branch: BRANCH }] };
const LIVE = { isWorktree: true, branch: BRANCH, repo: "pootytxng/sentinel" };
const facts = (over = {}) =>
  assertSessionRoot({
    board: BOARD,
    live: LIVE,
    env: { CLAUDE_PROJECT_DIR: CLAIMED, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" },
    cwd: CLAIMED,
    now: NOW,
    ...over,
  });

let store;
const token = (over = {}) => ({
  ...makeToken({
    issue: 14,
    folder: CLAIMED,
    branch: BRANCH,
    window: 300000,
    nonce: "n1",
    expiresAt: "2026-07-30T18:00:00Z",
  }),
  ...over,
});

beforeAll(() => {
  store = mkdtempSync(join(tmpdir(), "compy-entry-token-"));
});

afterAll(() => {
  try {
    rmSync(store, { recursive: true, force: true });
  } catch {
    /* locked file on Windows must not fail the suite */
  }
});

describe("resolving the REAL session root", () => {
  it("prefers CLAUDE_PROJECT_DIR, which is what a hook actually receives", () => {
    const r = resolveSessionRoot({ env: { CLAUDE_PROJECT_DIR: CLAIMED }, cwd: ELSEWHERE });
    expect(r.root).toBe(CLAIMED);
    expect(r.source).toBe("CLAUDE_PROJECT_DIR");
    expect(r.observed).toBe(true);
  });

  it("uses the hook payload's cwd when the variable is absent", () => {
    const r = resolveSessionRoot({ env: {}, hookInput: { cwd: CLAIMED }, cwd: ELSEWHERE });
    expect(r.root).toBe(CLAIMED);
    expect(r.source).toBe("hook cwd");
  });

  it("marks a process-cwd fallback as NOT observed — inference is not observation", () => {
    // If the real root cannot be observed, the honest answer is "unknown", and unknown must fail
    // closed. Guessing from process.cwd() is exactly how a wrong root passes for a right one.
    const r = resolveSessionRoot({ env: {}, cwd: CLAIMED });
    expect(r.root).toBe(CLAIMED);
    expect(r.observed).toBe(false);
  });
});

describe("guard 1 — running in a folder the board does not claim", () => {
  it("does not verify a session whose root no issue names", () => {
    const r = facts({ env: { CLAUDE_PROJECT_DIR: ELSEWHERE }, cwd: ELSEWHERE });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("FOLDER_UNCLAIMED");
    expect(r.root).toBe(ELSEWHERE);
  });

  it("passes when the board's folder and the session's root are the same folder", () => {
    const r = facts();
    expect(r.ok).toBe(true);
    expect(r.issue).toBe(14);
  });

  it("compares folders case- and separator-insensitively", () => {
    const r = facts({
      env: { CLAUDE_PROJECT_DIR: "c:/users/kuya/code/sentinel-feedback", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" },
    });
    expect(r.ok).toBe(true);
  });
});

describe("guard 8 — the shell moved but the project root did not", () => {
  it("refuses, and names the failure precisely rather than as a generic mismatch", () => {
    const r = facts({ env: { CLAUDE_PROJECT_DIR: ELSEWHERE }, cwd: CLAIMED });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CD_WITHOUT_ROOT");
    expect(r.reason).toMatch(/shell/i);
    expect(r.reason).toMatch(/project root/i);
  });

  it("is distinguishable from a plain unclaimed folder, because the fixes differ", () => {
    const cdOnly = facts({ env: { CLAUDE_PROJECT_DIR: ELSEWHERE }, cwd: CLAIMED });
    const plain = facts({ env: { CLAUDE_PROJECT_DIR: ELSEWHERE }, cwd: ELSEWHERE });
    expect(cdOnly.code).not.toBe(plain.code);
    // And the difference is not cosmetic: one is a live contradiction inside a claimed folder, the
    // other is an ordinary window somewhere nobody claimed.
    expect(verdictFor(cdOnly).exit).toBe(2);
    expect(verdictFor(plain).exit).toBe(0);
  });
});

describe("failing closed", () => {
  it("does not verify a folder no issue on the board claims", () => {
    const r = facts({ board: { reachable: true, rows: [] } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("FOLDER_UNCLAIMED");
  });

  it("refuses when the board itself could not be measured", () => {
    const r = facts({ board: { reachable: false, rows: [] } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BOARD_UNREACHABLE");
  });

  it("refuses a folder that is not a work tree of this repository", () => {
    expect(facts({ live: { ...LIVE, isWorktree: false } }).code).toBe("NOT_A_WORKTREE");
    expect(facts({ live: { ...LIVE, repo: "someone-else/fork" } }).code).toBe("REPO_MISMATCH");
  });

  it("refuses when the live branch is not the branch the board put the issue on", () => {
    const r = facts({ live: { ...LIVE, branch: "main" } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BRANCH_NOT_THE_BOARDS");
    expect(r.expected).toBe(BRANCH);
    expect(r.actual).toBe("main");
  });

  it("refuses when the root could not be observed at all", () => {
    const r = facts({ env: {}, hookInput: null });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ROOT_UNOBSERVED");
  });

  it("records the window the session actually got, and no longer refuses over it (#216)", () => {
    // Under the token contract a session whose window was not the launcher's tier was REFUSED. A tab
    // the owner opened himself has whatever window it has; refusing it would rebuild the lockout.
    const r = facts({ env: { CLAUDE_PROJECT_DIR: CLAIMED, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" } });
    expect(r.ok).toBe(true);
    expect(r.window).toBe(150000);
  });
});

describe("the token on disk", () => {
  // The token survives as a LAUNCHER HANDSHAKE — it carries the nonce the IDE bridge waits on and
  // the brief digest — and nothing in the assert reads it any more. These tests keep that shape
  // honest; writer-contention.test.mjs is what proves the assert ignores it.
  it("round-trips", () => {
    const t = token();
    writeToken(t, { dir: store });
    expect(readToken({ dir: store })).toMatchObject({ issue: 14, folder: CLAIMED, nonce: "n1" });
  });

  it("returns null rather than throwing when absent or unreadable", () => {
    expect(readToken({ dir: join(store, "nope") })).toBeNull();
  });

  it("carries a nonce, so the bridge can tell one launch from the next", () => {
    expect(makeToken({ issue: 1, folder: CLAIMED, branch: "b", window: 150000 }).nonce).toBeTruthy();
  });
});
