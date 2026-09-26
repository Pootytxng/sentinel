// Guard for `compy-entry adopt` (#125 step 2) — the cure that ships with the write refusal.
//
// The refusal in step 3 is only safe because this exists: a session the owner opened by hand can
// prove the same facts a launch proves and carry on, instead of being told to close the window. So
// the properties that matter here are not "does it write a file" — they are the five assertions that
// make an adopted record worth the same as a launched one, and the two places where saying yes would
// be worse than saying no (another conversation holds the folder; the record on disk is unreadable).
//
// Structure: `planAdoption` takes every fact as an argument, so the decision table below is driven
// with fabricated facts and no IO at all. The last block does one real end-to-end adoption in a
// throwaway git repo, because a plan that is never persisted proves nothing about the record shape
// the assert has to accept afterwards.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import * as assert from "../../.claude/hooks/session-root-assert.mjs";
import { EXPECTED_REPO, adopt, planAdoption } from "./adopt.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";

const SESSION = "11111111-2222-3333-4444-555555555555";
const OTHER_SESSION = "99999999-8888-7777-6666-555555555555";
const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-home-room";

/** Every fact a successful adoption needs; each test spoils exactly one of them. */
const facts = (over = {}) => ({
  folder: FOLDER,
  issue: 125,
  sessionId: SESSION,
  isWorktree: true,
  live: { branch: "lane/train-2026-08-22", repo: EXPECTED_REPO },
  issueFacts: { state: "OPEN", labels: ["work-control"], title: "session-root-assert" },
  existing: null,
  window: 1000000,
  now: new Date("2026-08-22T12:00:00Z"),
  ...over,
});

describe("adopt — the five assertions a launch makes, made by hand", () => {
  it("adopts when every fact holds, and binds folder + branch + session + issue", () => {
    const r = planAdoption(facts());
    expect(r.ok).toBe(true);
    expect(r.record).toMatchObject({
      issue: 125,
      folder: FOLDER,
      branch: "lane/train-2026-08-22",
      sessionId: SESSION,
      repo: EXPECTED_REPO,
      window: 1000000,
    });
    expect(r.record.adoptedAt).toBe("2026-08-22T12:00:00.000Z");
    expect(r.record.expiresAt > r.record.lastSeenAt).toBe(true);
  });

  it("never invents the session id", () => {
    const r = planAdoption(facts({ sessionId: null }));
    expect(r.code).toBe("ADOPT_NO_SESSION");
  });

  it("refuses a folder that is not a work tree", () => {
    expect(planAdoption(facts({ isWorktree: false })).code).toBe("ADOPT_NOT_A_WORKTREE");
  });

  it("refuses another repository, and an unreadable one separately", () => {
    expect(planAdoption(facts({ live: { branch: "main", repo: "someone/else" } })).code).toBe(
      "ADOPT_REPO_MISMATCH",
    );
    expect(planAdoption(facts({ live: { branch: "main", repo: null } })).code).toBe(
      "ADOPT_REPO_UNREADABLE",
    );
  });

  it("refuses a detached HEAD — the branch is read, never chosen", () => {
    const r = planAdoption(facts({ live: { branch: null, repo: EXPECTED_REPO } }));
    expect(r.code).toBe("ADOPT_BRANCH_UNREADABLE");
  });

  it("refuses a closed issue, and an unreadable one separately", () => {
    expect(planAdoption(facts({ issueFacts: { state: "CLOSED", labels: [], title: "x" } })).code).toBe(
      "ADOPT_ISSUE_CLOSED",
    );
    expect(planAdoption(facts({ issueFacts: null })).code).toBe("ADOPT_ISSUE_UNREADABLE");
  });

  it("refuses a folder a different conversation still holds (one writer per worktree)", () => {
    const r = planAdoption(
      facts({
        // #216: it is the LIVENESS of that conversation that refuses, not its clock — a record whose
        // process is gone lapses however long it had left. writer-contention.test.mjs owns that pair.
        liveness: "live",
        existing: {
          folder: FOLDER,
          sessionId: OTHER_SESSION,
          issue: 143,
          expiresAt: "2026-08-22T18:00:00Z",
        },
      }),
    );
    expect(r.code).toBe("ADOPT_FOLDER_CLAIMED");
    expect(r.reason).toContain("One writer per worktree");
  });

  it("allows adoption once that other record has lapsed", () => {
    const r = planAdoption(
      facts({
        existing: {
          folder: FOLDER,
          sessionId: OTHER_SESSION,
          issue: 143,
          expiresAt: "2026-08-21T00:00:00Z", // before `now`
        },
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("refreshes rather than duplicates when the same conversation re-adopts", () => {
    const r = planAdoption(
      facts({
        existing: {
          folder: FOLDER,
          sessionId: SESSION,
          issue: 125,
          firstSeenAt: "2026-08-22T09:00:00Z",
          seenCount: 4,
          expiresAt: "2026-08-22T18:00:00Z",
        },
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.record.firstSeenAt).toBe("2026-08-22T09:00:00Z"); // history not rewritten
    expect(r.record.seenCount).toBe(5);
    expect(r.notes.join(" ")).toContain("refreshed");
  });

  it("refuses to overwrite a record it cannot read", () => {
    expect(planAdoption(facts({ existing: assert.CORRUPT })).code).toBe("ADOPT_RECORD_CORRUPT");
  });
});

describe("adopt — the two measured deviations from the spec, pinned so they cannot drift back silently", () => {
  it("an unlabelled issue is adopted, with the missing label reported as a note", () => {
    // Spec §3a wanted `work-control` as a gate. 6 of 13 open issues carry it, #125 included in the
    // 7 that do not — a gate that refuses its own issue is an outage, not a safety property.
    const r = planAdoption(facts({ issueFacts: { state: "OPEN", labels: [], title: "x" } }));
    expect(r.ok).toBe(true);
    expect(r.notes.join(" ")).toContain("not labelled work-control");
  });

  it("claims no context window when this process cannot see one", () => {
    // A record claiming a tier the session cannot prove would refuse that session at its very next
    // SessionStart — checkIdentity treats a claimed window as a hard check.
    const r = planAdoption(facts({ window: null }));
    expect(r.ok).toBe(true);
    expect(r.record.window).toBeNull();
    expect(r.notes.join(" ")).toContain("no context window observed");
  });
});

// ── end to end, on a real repository ─────────────────────────────────────────────────────────────
describe("adopt — a real adoption in a throwaway worktree is accepted by the assert afterwards", () => {
  let repo = null;
  let store = null;
  afterAll(() => {
    for (const dir of [repo, store]) {
      if (!dir) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* a locked file on Windows must not fail the suite */
      }
    }
  });

  it("writes a record the assert then verifies as a resume", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    repo = mkdtempSync(join(tmpdir(), "compy-adopt-repo-"));
    store = mkdtempSync(join(tmpdir(), "compy-adopt-store-"));
    const git = (...args) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    git("init", "-b", "lane/adopt-fixture");
    git("remote", "add", "origin", "https://github.com/Pootytxng/sentinel.git");
    writeFileSync(join(repo, "README.md"), "fixture\n");
    git("add", "-A");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", "fixture");

    const now = new Date("2026-08-22T12:00:00Z");
    const r = adopt({
      folder: repo,
      issue: 125,
      sessionId: SESSION,
      dir: store,
      now,
      env: {}, // no window to observe — the honest case on this machine
      lookupIssue: () => ({ state: "OPEN", labels: ["work-control"], title: "fixture" }),
    });
    expect(r.ok, r.reason).toBe(true);

    // The point of the whole exercise: with the board naming this folder for #125, the assert reads
    // the adopted lease as this conversation resuming rather than as a stranger arriving.
    const board = { reachable: true, rows: [{ issue: 125, folder: assert.canonicalizePath(repo), branch: "lane/adopt-fixture" }] };
    const verdict = assert.assertSessionRoot({
      board,
      lease: assert.readLineage({ root: repo, dir: store }),
      env: { CLAUDE_PROJECT_DIR: repo },
      hookInput: { session_id: SESSION },
      cwd: repo,
      now: new Date("2026-08-22T13:00:00Z"),
      live: assert.observeLive(repo),
      leaseLiveness: "live",
    });
    expect(verdict.ok, verdict.reason).toBe(true);
    expect(verdict.mode).toBe("resume");
    expect(verdict.issue).toBe(125);
    expect(assert.verdictFor(verdict).exit).toBe(0);
  });

  it("and a DIFFERENT conversation in that same folder is still refused while this one is live", () => {
    const board = { reachable: true, rows: [{ issue: 125, folder: assert.canonicalizePath(repo), branch: "lane/adopt-fixture" }] };
    const verdict = assert.assertSessionRoot({
      board,
      lease: assert.readLineage({ root: repo, dir: store }),
      env: { CLAUDE_PROJECT_DIR: repo },
      hookInput: { session_id: OTHER_SESSION },
      cwd: repo,
      now: new Date("2026-08-22T13:00:00Z"),
      live: assert.observeLive(repo),
      leaseLiveness: "live",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("WRITER_LIVE");
    expect(assert.verdictFor(verdict).exit).toBe(2); // adoption does not weaken the one-writer rule
  });
});
