// Guards 9 and 10 — a session that keeps going is still the session that was launched.
//
// The defect, observed live and repeatedly in this very program (#23): the launch token was
// single-use. The first SessionStart consumed it, and the SessionStart that fires after compaction —
// same session, same folder, same claim, same work — then read a consumed token and announced
// "this one is unverified". Consumption answers "has this token been used before", when the question
// a resuming session asks is "am I the session that was launched". Those are different questions, and
// only the second one is about correctness.
//
// #216 FINISHED THAT ARGUMENT BY REMOVING ITS SUBJECT. If a session's right to be here is measured
// from the folder rather than handed to it, there is nothing to consume and nothing to run out.
// Verification is now three facts — a work tree of this repository, on the branch Work Control put
// the issue on — and the per-folder record survives with ONE job left: exclusion. It is a WRITER
// LEASE. It says who is writing here so a second conversation does not join them; it admits nobody,
// it authorizes nobody, and losing it makes a session ordinary rather than unverified.
//
// Guard 9 is therefore about continuity: compaction and extension restarts must stay verified and
// keep the same lease rather than starting a new one. Guard 10 is the other half and is the reason
// the lease is not a loophole: it cannot let a session into a folder whose facts disagree, and a
// lease that goes stale is swept rather than left to rot.
//
// Every case here injects the board. Reading it live would make this suite slow, networked, and
// dependent on what the queue happens to look like today.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LINEAGE_TTL_MINUTES,
  assertSessionRoot,
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
const ME = "11111111-1111-4111-8111-111111111111";

let dir;
const at = (iso) => new Date(iso);
const T0 = "2026-07-31T10:00:00.000Z";

const live = (over = {}) => ({ isWorktree: true, branch: BRANCH, repo: REPO, ...over });
const board = (rows = [{ issue: 23, folder: FOLDER, branch: BRANCH }]) => ({ reachable: true, stale: false, rows });

const launch = (over = {}) =>
  writeToken(
    makeToken({ issue: 23, folder: FOLDER, branch: BRANCH, window: WINDOW, repo: REPO, nonce: "n1", now: at(T0), ...over }),
    { dir },
  );

/** One SessionStart, as the hook sees it: which root, which live facts, when, and whose. */
const sessionStart = (over = {}) =>
  verifySession({
    dir,
    env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(WINDOW) },
    cwd: FOLDER,
    now: at(T0),
    live: live(),
    board: board(),
    hookInput: { session_id: ME },
    ...over,
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-lineage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("guard 9 — compaction and extension restarts stay verified", () => {
  it("verifies the first start and takes the folder's writer lease", () => {
    launch();
    const first = sessionStart();

    expect(first.ok).toBe(true);
    expect(first.mode).toBe("launch");
    expect(first.issue).toBe(23);

    const record = readLineage({ root: FOLDER, dir });
    expect(record).toMatchObject({ issue: 23, branch: BRANCH, window: WINDOW, repo: REPO, seenCount: 1 });
  });

  it("RESUMES the same lease after compaction instead of calling it unverified", () => {
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

  it("still marks the launch token consumed, so an older hook in an unmerged worktree keeps quiet", () => {
    launch();
    sessionStart();

    // Other checkouts still run the single-use hook. It reads `consumedAt`; if a claimed launch left
    // that null, every ad-hoc session in every other folder would hard-STOP on a token that is not
    // theirs. Compatibility here is not politeness — it is not breaking Kuya's other windows.
    const token = readToken({ dir });
    expect(token.claimedAt).toBeTruthy();
    expect(token.consumedAt).toBe(token.claimedAt);
  });

  // The reversal that closes #216. A lease that has gone stale used to END the session's
  // verification (LINEAGE_EXPIRED); it now ends the session's HOLD on the folder and nothing else,
  // because the facts that verify the session are still true and were never in the lease.
  it("stays verified once the lease goes stale — the hold lapses, the session does not", () => {
    launch();
    sessionStart();

    const stale = sessionStart({ now: at("2026-08-02T10:00:00.000Z") });

    expect(stale.ok).toBe(true);
    expect(stale.issue).toBe(23);
    // The same conversation simply retakes the folder and its record continues; expiry is about who
    // may hold the folder, and an expired hold no longer excludes anyone.
    const record = readLineage({ root: FOLDER, dir });
    expect(new Date(record.expiresAt) > at("2026-08-02T10:00:00.000Z")).toBe(true);
  });

  it("sweeps a lease that expired in a folder nothing came back to", () => {
    launch();
    sessionStart();
    // A different folder's start, long after: the sweep runs on every verify, not only on its own.
    sessionStart({
      env: { CLAUDE_PROJECT_DIR: OTHER },
      cwd: OTHER,
      live: live({ branch: "main" }),
      now: at("2026-08-02T10:00:00.000Z"),
    });
    expect(readLineage({ root: FOLDER, dir })).toBeNull();
  });
});

describe("guard 10 — the lease is not a way in", () => {
  it("does not verify a session in a folder no issue on the board claims", () => {
    launch();
    const r = sessionStart({ env: { CLAUDE_PROJECT_DIR: OTHER }, cwd: OTHER, live: live({ branch: "main" }) });

    expect(r.ok).toBe(false);
    expect(r.code).toBe("FOLDER_UNCLAIMED");
    expect(r.advisory).toBe(true); // Kuya's ad-hoc window in another checkout is not an error
  });

  it("a lease copied into another folder's slot admits nothing, because it was never the authority", () => {
    launch();
    sessionStart();

    // The record moved — copied into another root's slot, or the folder was renamed underneath it.
    const stolen = readFileSync(lineageFile({ root: FOLDER, dir }), "utf8");
    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(lineageFile({ root: OTHER, dir }), stolen);

    const r = sessionStart({ env: { CLAUDE_PROJECT_DIR: OTHER }, cwd: OTHER });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("FOLDER_UNCLAIMED");
  });

  it("refuses when the live branch is not the branch the board put the issue on", () => {
    launch();
    sessionStart();

    const r = sessionStart({ live: live({ branch: "main" }), now: at("2026-07-31T11:00:00.000Z") });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BRANCH_NOT_THE_BOARDS");
    expect(r.reason).toContain("main");
  });

  it("refuses a folder pointing at a different repository", () => {
    launch();
    sessionStart();

    const r = sessionStart({ live: live({ repo: "someone/else" }), now: at("2026-07-31T11:00:00.000Z") });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("REPO_MISMATCH");
  });

  it("records a changed context window rather than refusing over it (#216)", () => {
    launch();
    sessionStart();

    const r = sessionStart({
      env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" },
      now: at("2026-07-31T11:00:00.000Z"),
    });
    expect(r.ok).toBe(true);
    expect(r.window).toBe(150000);
    expect(readLineage({ root: FOLDER, dir }).window).toBe(150000);
  });

  it("follows the board when the board moves the folder to another issue", () => {
    launch();
    sessionStart();

    const r = sessionStart({
      board: board([{ issue: 24, folder: FOLDER, branch: "tooling/next" }]),
      live: live({ branch: "tooling/next" }),
      now: at("2026-07-31T11:01:00.000Z"),
    });

    expect(r.ok).toBe(true);
    expect(r.issue).toBe(24);
    expect(readLineage({ root: FOLDER, dir })).toMatchObject({ issue: 24, branch: "tooling/next" });
  });

  it("does not infer the root it is verifying", () => {
    launch();
    const r = sessionStart({ env: {}, cwd: FOLDER, hookInput: null });

    expect(r.ok).toBe(false);
    expect(r.code).toBe("ROOT_UNOBSERVED");
    expect(r.advisory).toBe(false);
  });
});

describe("what cannot be observed is said, not assumed", () => {
  // REWRITTEN, not extended. This asserted `ok: true` with a note — a green verified session whose
  // branch nobody could read. But the header of this very file, and the issue's own acceptance text,
  // both say the branch under the session is checked, and a note under a pass does not check
  // anything. Unknown identity is not verified identity: the session is about to write, and the
  // branch it would write on is the thing that could not be read.
  //
  // The distinction that survives is between "looked and failed" and "did not look". A real
  // observation that came back empty is a refusal; no observation at all is its own refusal too now
  // (FACTS_UNOBSERVED) — under the facts contract there is no verdict left to reach without them.
  it("refuses when a real observation of the live branch comes back empty", () => {
    launch();
    sessionStart();

    const r = sessionStart({ live: live({ branch: null }), now: at("2026-07-31T11:00:00.000Z") });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BRANCH_UNREADABLE");
    expect(r.reason).toMatch(/not a verified one/i);
  });

  it("refuses when the live repository comes back empty for the same reason", () => {
    launch();
    sessionStart();

    const r = sessionStart({ live: live({ repo: null }), now: at("2026-07-31T11:00:00.000Z") });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("REPO_UNREADABLE");
  });

  it("refuses when nothing measured the folder at all", () => {
    const r = assertSessionRoot({
      board: board(),
      live: null,
      env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(WINDOW) },
      cwd: FOLDER,
      now: at(T0),
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("FACTS_UNOBSERVED");
  });

  it("never persists anything when asked not to", () => {
    launch();
    const r = verifySession({
      dir,
      env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(WINDOW) },
      cwd: FOLDER,
      now: at(T0),
      live: live(),
      board: board(),
      hookInput: { session_id: ME },
      persist: false,
    });

    expect(r.ok).toBe(true);
    expect(readLineage({ root: FOLDER, dir })).toBeNull();
    expect(readToken({ dir }).claimedAt).toBeNull();
  });
});
