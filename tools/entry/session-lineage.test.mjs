// Guards 9 and 10 — a session that keeps going is still the session that was launched.
//
// The defect, observed live and repeatedly in this very program (#23): the launch token was
// single-use. The first SessionStart consumed it, and the SessionStart that fires after compaction —
// same session, same folder, same claim, same work — then read a consumed token and announced
// "this one is unverified". Consumption answers "has this token been used before", when the question
// a resuming session asks is "am I the session that was launched". Those are different questions, and
// only the second one is about correctness.
//
// So the token becomes a two-part record: a PENDING LAUNCH (claimed exactly once, by the first
// session in the right root) and a per-root LINEAGE (which that claim establishes, and which any
// later SessionStart in that same root may resume until it goes stale). Resumability is not a
// loosening: every resume re-verifies root, branch, repository and window against the live machine,
// which is strictly MORE than the old contract checked — `token.branch` was recorded and never
// looked at.
//
// Guard 10 is the other half. Resume must not become a way in: a record belongs to one folder, one
// branch, one repository and one task, and a session that does not match all four is refused, no
// matter how legitimately that record was created.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LINEAGE_TTL_MINUTES,
  lineageFile,
  makeToken,
  readLineage,
  readToken,
  verifySession,
  writeToken,
} from "../../.claude/hooks/session-root-assert.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";
const OTHER = "C:\\Users\\Kuya\\code\\sentinel-rel";
const BRANCH = "tooling/start-work-marathon";
const REPO = "pootytxng/sentinel";
const WINDOW = 300000;

let dir;
const at = (iso) => new Date(iso);
const T0 = "2026-07-31T10:00:00.000Z";

const live = (over = {}) => ({ branch: BRANCH, repo: REPO, ...over });

const launch = (over = {}) =>
  writeToken(
    makeToken({ issue: 23, folder: FOLDER, branch: BRANCH, window: WINDOW, repo: REPO, nonce: "n1", now: at(T0), ...over }),
    { dir },
  );

/** One SessionStart, as the hook sees it: which root, which live facts, when. */
const sessionStart = (over = {}) =>
  verifySession({
    dir,
    env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(WINDOW) },
    cwd: FOLDER,
    now: at(T0),
    live: live(),
    ...over,
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-lineage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("guard 9 — compaction and extension restarts stay verified", () => {
  it("claims the launch on the first SessionStart and establishes a lineage", () => {
    launch();
    const first = sessionStart();

    expect(first.ok).toBe(true);
    expect(first.mode).toBe("launch");
    expect(first.issue).toBe(23);

    const record = readLineage({ root: FOLDER, dir });
    expect(record).toMatchObject({ issue: 23, branch: BRANCH, window: WINDOW, repo: REPO, seenCount: 1 });
  });

  it("RESUMES the same lineage after compaction instead of calling it unverified", () => {
    launch();
    sessionStart();

    // The SessionStart that fires when the session compacts — minutes later, same everything.
    const resumed = sessionStart({ now: at("2026-07-31T12:34:00.000Z") });

    expect(resumed.ok).toBe(true);
    expect(resumed.mode).toBe("resume");
    expect(resumed.code).toBeUndefined();
    expect(readLineage({ root: FOLDER, dir }).seenCount).toBe(2);
  });

  it("resumes across an extension restart hours later, and slides the expiry forward", () => {
    launch();
    sessionStart();
    const later = sessionStart({ now: at("2026-07-31T19:00:00.000Z") });

    expect(later.ok).toBe(true);
    const record = readLineage({ root: FOLDER, dir });
    expect(record.lastSeenAt).toBe("2026-07-31T19:00:00.000Z");
    expect(new Date(record.expiresAt).getTime()).toBe(at("2026-07-31T19:00:00.000Z").getTime() + LINEAGE_TTL_MINUTES * 60_000);
  });

  it("still marks the token consumed, so an older hook in an unmerged worktree keeps quiet", () => {
    launch();
    sessionStart();

    // Other checkouts still run the single-use hook. It reads `consumedAt`; if a claimed launch left
    // that null, every ad-hoc session in every other folder would hard-STOP on a token that is not
    // theirs. Compatibility here is not politeness — it is not breaking Kuya's other windows.
    const token = readToken({ dir });
    expect(token.claimedAt).toBeTruthy();
    expect(token.consumedAt).toBe(token.claimedAt);
  });

  it("expires deterministically once nothing has been seen for the lineage lifetime", () => {
    launch();
    sessionStart();

    const stale = sessionStart({ now: at("2026-08-02T10:00:00.000Z") });

    expect(stale.ok).toBe(false);
    expect(stale.code).toBe("LINEAGE_EXPIRED");
    expect(stale.advisory).toBe(true);
    expect(readLineage({ root: FOLDER, dir })).toBeNull(); // cleaned up, not left to rot
  });
});

describe("guard 10 — a lineage is not a way in", () => {
  it("refuses a session in another root while the launch is still pending", () => {
    launch();
    const r = sessionStart({ env: { CLAUDE_PROJECT_DIR: OTHER }, cwd: OTHER });

    expect(r.ok).toBe(false);
    expect(r.code).toBe("ROOT_MISMATCH");
    expect(r.advisory).toBe(false);
  });

  it("leaves unrelated sessions alone once the launch has been claimed", () => {
    launch();
    sessionStart();

    // Kuya's ad-hoc window in another checkout. Nothing is pending, nothing is its lineage.
    const r = sessionStart({ env: { CLAUDE_PROJECT_DIR: OTHER }, cwd: OTHER, live: live({ branch: "main" }) });

    expect(r.code).toBe("NO_TOKEN");
    expect(r.advisory).toBe(true);
  });

  it("refuses a lineage record that names a different folder than the session it is verifying", () => {
    launch();
    sessionStart();

    // The record moved — copied into another root's slot, or the folder was renamed underneath it.
    const stolen = readFileSync(lineageFile({ root: FOLDER, dir }), "utf8");
    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(lineageFile({ root: OTHER, dir }), stolen);

    const r = sessionStart({ env: { CLAUDE_PROJECT_DIR: OTHER }, cwd: OTHER });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("LINEAGE_FOREIGN");
  });

  it("refuses a resume whose live branch is not the branch that was launched", () => {
    launch();
    sessionStart();

    const r = sessionStart({ live: live({ branch: "main" }), now: at("2026-07-31T11:00:00.000Z") });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BRANCH_MISMATCH");
    expect(r.reason).toContain("main");
  });

  it("refuses a resume in a different repository", () => {
    launch();
    sessionStart();

    const r = sessionStart({ live: live({ repo: "someone/else" }), now: at("2026-07-31T11:00:00.000Z") });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("REPO_MISMATCH");
  });

  it("refuses a resume whose live context window is not the one the launch resolved", () => {
    launch();
    sessionStart();

    const r = sessionStart({
      env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" },
      now: at("2026-07-31T11:00:00.000Z"),
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("WINDOW_MISMATCH");
  });

  it("lets a new launch supersede an old lineage, and reports the NEW task", () => {
    launch();
    sessionStart();

    launch({ issue: 24, branch: "tooling/next", nonce: "n2", now: at("2026-07-31T11:00:00.000Z") });
    const r = sessionStart({ live: live({ branch: "tooling/next" }), now: at("2026-07-31T11:01:00.000Z") });

    expect(r.ok).toBe(true);
    expect(r.mode).toBe("launch");
    expect(r.issue).toBe(24);
    expect(readLineage({ root: FOLDER, dir })).toMatchObject({ issue: 24, branch: "tooling/next", seenCount: 1 });
  });

  it("does not infer the root it is verifying", () => {
    launch();
    const r = sessionStart({ env: {}, cwd: FOLDER });

    expect(r.ok).toBe(false);
    expect(r.code).toBe("ROOT_UNOBSERVED");
    expect(r.advisory).toBe(false);
  });
});

describe("what cannot be observed is said, not assumed", () => {
  it("passes but says so when the live branch cannot be read", () => {
    launch();
    sessionStart();

    const r = sessionStart({ live: live({ branch: null }), now: at("2026-07-31T11:00:00.000Z") });
    expect(r.ok).toBe(true);
    expect(r.notes.join(" ")).toMatch(/branch/i);
  });

  it("never persists anything when asked not to", () => {
    launch();
    const r = verifySession({
      dir,
      env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(WINDOW) },
      cwd: FOLDER,
      now: at(T0),
      live: live(),
      persist: false,
    });

    expect(r.ok).toBe(true);
    expect(readLineage({ root: FOLDER, dir })).toBeNull();
    expect(readToken({ dir }).claimedAt).toBeNull();
  });
});
