// Guard: the folder's record names ONE conversation, not just one folder.
//
// The lineage compared root, branch, repository and window. Every one of those describes the FOLDER.
// None of them says which conversation is running in it — so a brand-new Claude process started in a
// verified folder inherited the whole authorization of the session before it, for a 12-hour TTL that
// slid forward on every sighting. "Same folder" was being read as "same session".
//
// The fix is that the launcher NAMES the session it starts rather than starting one and hoping to
// recognise it later: one id is generated before anything is written, goes to the CLI as
// `--session-id`, into the launch token, and then into the lineage. After that "is this the session I
// launched" has an answer.
//
// Two things this must NOT break: an extension restart that genuinely resumes keeps its id and still
// passes, and a record written before ids existed carries rather than breaks.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planClaudeStart } from "./claude-start.mjs";
import { assertSessionRoot, makeToken, normalizeRepo, readLineage, verifySession, writeToken } from "./session-assert.mjs";

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
const live = { branch: BRANCH, repo: normalizeRepo(REPO) };
const arm = (sessionId) =>
  writeToken(makeToken({ issue: 23, folder: FOLDER, branch: BRANCH, window: WINDOW, repo: REPO, sessionId }), { dir });
const start = (session_id) => verifySession({ dir, env, cwd: FOLDER, live, hookInput: { session_id } });

describe("the launcher names the session it starts", () => {
  it("puts the assigned id on the launch token", () => {
    const t = makeToken({ issue: 23, folder: FOLDER, branch: BRANCH, window: WINDOW, sessionId: OURS });
    expect(t.sessionId).toBe(OURS);
  });

  it("carries it into the folder's record when the launch is taken up", () => {
    arm(OURS);
    expect(start(OURS).ok).toBe(true);
    expect(readLineage({ root: FOLDER, dir }).sessionId).toBe(OURS);
  });

  it("refuses a different conversation answering the launch", () => {
    arm(OURS);
    const r = start(THEIRS);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SESSION_FOREIGN");
  });
});

describe("a verified folder is not a verified session", () => {
  // The defect, exactly: same folder, same branch, same repo, same window — different conversation.
  it("refuses a new conversation trying to resume the folder's record", () => {
    arm(OURS);
    expect(start(OURS).mode).toBe("launch");

    const r = start(THEIRS);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SESSION_FOREIGN");
    expect(r.reason).toMatch(/does not inherit/i);
  });

  it("lets the same conversation resume — an extension restart keeps its id", () => {
    arm(OURS);
    start(OURS);
    const r = start(OURS);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("resume");
  });

  // Records written before ids were bound must carry, not break: nothing to compare is not a mismatch.
  it("carries a record that predates session ids", () => {
    arm(null);
    expect(start(undefined).ok).toBe(true);
    expect(readLineage({ root: FOLDER, dir }).sessionId).toBe(null);
    expect(start(THEIRS).ok).toBe(true);
  });

  it("does not refuse when the hook reports no session id at all", () => {
    arm(OURS);
    const r = assertSessionRoot({ token: { ...makeToken({ issue: 23, folder: FOLDER, branch: BRANCH, window: WINDOW, sessionId: OURS }) }, env, cwd: FOLDER, live });
    expect(r.ok).toBe(true);
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
