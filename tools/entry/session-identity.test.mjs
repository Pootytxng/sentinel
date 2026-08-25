// Guard: the folder's record names ONE conversation, not just one folder.
//
// The lineage compared root, branch, repository and window. Every one of those describes the FOLDER.
// None of them says which conversation is running in it — so a brand-new Claude process started in a
// verified folder inherited the whole authorization of the session before it, for a 12-hour TTL that
// slid forward on every sighting. "Same folder" was being read as "same session".
//
// The fix is that the launcher NAMES the session it starts rather than starting one and hoping to
// recognise it later: one id is generated before anything is written, goes to the CLI as
// `--session-id`, into the launch token, and then into the folder's record.
//
// #216 KEPT THE NAME AND CHANGED WHAT IT IS FOR. Naming the session was doing two jobs, and only one
// of them was sound. It is still how the folder's record says WHO holds the folder — that is the
// one-writer rule, and it is load-bearing. It is no longer how a session proves it may work here:
// under the token contract a conversation the launcher had not named was refused outright, which is
// how a launched CLI that died with no process and no transcript kept the folder for twelve hours
// and locked out the owner's own window standing in it. Verification is by facts now (a work tree of
// this repo, on the board's branch, no LIVE competing writer), and the exclusion half is decided by
// liveness — see writer-contention.test.mjs.
//
// What must NOT break: an extension restart that genuinely resumes keeps its id and reads as a
// resume rather than a fresh launch, and a record written before ids existed carries rather than
// breaks.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planClaudeStart } from "./claude-start.mjs";
import { makeToken, normalizeRepo, readLineage, verifySession, writeToken } from "./session-assert.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";
const BRANCH = "tooling/entry-acceptance";
const REPO = "Pootytxng/sentinel";
const WINDOW = 300000;
const OURS = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-session-id-"));
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

const env = { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(WINDOW) };
// `observeLive` normalises the origin URL, so the fixture has to be what it really produces.
const live = { isWorktree: true, branch: BRANCH, repo: normalizeRepo(REPO) };
// The board is injected in every case: this suite is about identity, and a real `gh` call here would
// make it slow, networked, and dependent on what the queue happens to look like today.
const board = { reachable: true, stale: false, rows: [{ issue: 23, folder: FOLDER, branch: BRANCH }] };
const arm = (sessionId) =>
  writeToken(makeToken({ issue: 23, folder: FOLDER, branch: BRANCH, window: WINDOW, repo: REPO, sessionId }), { dir });
const start = (session_id) => verifySession({ dir, env, cwd: FOLDER, live, board, hookInput: { session_id } });

describe("the launcher names the session it starts", () => {
  it("puts the assigned id on the launch token", () => {
    const t = makeToken({ issue: 23, folder: FOLDER, branch: BRANCH, window: WINDOW, sessionId: OURS });
    expect(t.sessionId).toBe(OURS);
  });

  it("writes that conversation, and its pid, onto the folder's record", () => {
    arm(OURS);
    expect(start(OURS).ok).toBe(true);
    const record = readLineage({ root: FOLDER, dir });
    expect(record.sessionId).toBe(OURS);
    // #216: the record has to be able to answer "is that conversation still there", and a record
    // with no pid and no transcript can only be aged out by a clock.
    expect(record.pid).toBe(process.ppid);
  });

  it("carries the launch token's nonce onto the record, so the bridge can still match it", () => {
    arm(OURS);
    const nonce = JSON.parse(JSON.stringify(readLineage({ root: FOLDER, dir }) ?? {})).nonce ?? null;
    expect(nonce).toBe(null); // nothing written yet
    start(OURS);
    expect(readLineage({ root: FOLDER, dir }).nonce).toBeTruthy();
  });
});

describe("a folder verified by facts, and who is holding it", () => {
  it("reads a fresh conversation as a launch and the same one again as a resume", () => {
    arm(OURS);
    expect(start(OURS).mode).toBe("launch");
    expect(start(OURS).mode).toBe("resume");
  });

  // THIS IS THE #216 REVERSAL, and it is the reason this file was rewritten rather than deleted.
  // The same call used to produce SESSION_FOREIGN. A second conversation is now judged on whether
  // the first is still alive, not on whether the launcher happened to name it.
  it("does not refuse a conversation the launcher never named — it asks whether the first is alive", () => {
    arm(OURS);
    start(OURS);
    const r = start(THEIRS);
    expect(r.code).not.toBe("SESSION_FOREIGN");
    // Our own pid was recorded a moment ago and is very much alive, so the folder is held — by a
    // writer that can be proven to exist, which is the whole difference.
    expect(r.code).toBe("WRITER_LIVE");
  });

  // Records written before ids were bound must carry, not break: nothing to compare is not a mismatch.
  it("carries a record that predates session ids", () => {
    arm(null);
    expect(start(undefined).ok).toBe(true);
    expect(readLineage({ root: FOLDER, dir }).sessionId).toBe(null);
  });
});

describe("the CLI is started as that session", () => {
  const base = { folder: FOLDER, exe: "claude.exe", folderExists: true, terminal: true };

  it("passes --session-id on a fresh start", () => {
    const p = planClaudeStart({ ...base, bridge: true, sessionId: OURS });
    expect(p.args).toEqual(["--session-id", OURS, "--ide"]);
    expect(p.sessionId).toBe(OURS);
    expect(p.resume).toBe(false);
  });

  it("passes --resume with the same id when resuming an owned session", () => {
    const p = planClaudeStart({ ...base, bridge: false, sessionId: OURS, resume: true });
    expect(p.args).toEqual(["--resume", OURS]);
    expect(p.resume).toBe(true);
  });

  // A flag with an empty value is worse than no flag.
  it("passes neither when no id was assigned", () => {
    expect(planClaudeStart({ ...base, bridge: true }).args).toEqual(["--ide"]);
    expect(planClaudeStart({ ...base, bridge: false }).args).toEqual([]);
  });
});
