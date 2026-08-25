// Guard: who is allowed to write in a worktree, and how we know.
//
// TWO STRATA, ONE QUESTION. The bottom half of this file is the original guard — the other writer
// the pre-launch PROBE could not see, because `WATCHED` listed builders, installers and Code.exe but
// not claude.exe. The top half is #216: the other writer the IN-SESSION assert could not see, and
// the writer it saw that was not there at all.
//
// WHAT #216 MEASURED (2026-08-24 22:24–22:31). "Compy – Start work" built this worktree, named a
// conversation id in a launch token, spawned a terminal CLI that took the token up — and that CLI
// died with no process and no transcript. The owner then typed the task into a VS Code Claude panel
// in that same folder, on that same branch, for that same issue. It was refused SESSION_FOREIGN,
// and `adopt` — the cure the refusal itself prints — refused with ADOPT_FOLDER_CLAIMED for twelve
// hours, held by a session that did not exist.
//
// Both halves of that are the same design error: verification asked WHO WAS LAUNCHED. That question
// has exactly one right answer, the launcher picks it before the session exists, and nothing about
// it decays when the answer dies. So verification now asks WHAT IS TRUE:
//
//   1. a git work tree of this repository,
//   2. on the board's branch for the issue the board says this folder is working,
//   3. with no LIVE competing writer.
//
// The line stays where it was: presence is not contention. A Claude session in ANOTHER root is
// somebody else's business, an editor or a live IDE bridge is not a writer at all — and now, a
// record whose process is gone is not a writer either.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

import {
  ADVISORY_CODES,
  BOARD_CACHE_NAME,
  CORRUPT,
  LIVE_GRACE_MINUTES,
  LIVE_STALE_MINUTES,
  assertSessionRoot,
  boardRows,
  invalidateBoardCache,
  livenessOf,
  parseWorktreeEntries,
  pidAlive,
  transcriptSeenAt,
  verdictFor,
} from "../../.claude/hooks/session-root-assert.mjs";
import { planAdoption } from "./adopt.mjs";
import { WATCHED, classifyProcesses } from "./processes.mjs";
import { parseWorktreeField } from "./worktree-field.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";
const OTHER = "C:\\Users\\Kuya\\code\\sentinel-feedback";
const BRANCH = "lane/marathon-2026-08-25";
const ME = "40375592-aaaa-bbbb-cccc-000000000001";
const THEM = "8fc927ae-dddd-eeee-ffff-000000000002";
const NOW = new Date("2026-08-25T06:00:00.000Z");
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const BOARD = {
  reachable: true,
  stale: false,
  fetchedAt: ago(1),
  rows: [{ issue: 216, folder: FOLDER, branch: BRANCH, status: "Active" }],
};
const LIVE = { isWorktree: true, branch: BRANCH, repo: "pootytxng/sentinel" };
const ENV = { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1000000" };

/** The assertion under the facts it is supposed to be measuring, with only the overrides named. */
const assert_ = (over = {}) =>
  assertSessionRoot({
    board: BOARD,
    live: LIVE,
    env: ENV,
    cwd: FOLDER,
    now: NOW,
    hookInput: { session_id: ME, cwd: FOLDER },
    ...over,
  });

const lease = (over = {}) => ({
  issue: 216,
  folder: FOLDER,
  branch: BRANCH,
  repo: "pootytxng/sentinel",
  sessionId: THEM,
  pid: null,
  firstSeenAt: ago(40),
  lastSeenAt: ago(40),
  seenCount: 1,
  expiresAt: new Date(NOW.getTime() + 600 * 60_000).toISOString(),
  ...over,
});

// ── the folder is verified by what is true of it, not by who was launched ────────────────────────

describe("a Claude tab in the right folder", () => {
  it("verifies with no launch token anywhere in the picture", () => {
    const r = assert_();
    expect(r.ok).toBe(true);
    expect(r.issue).toBe(216);
    expect(r.branch).toBe(BRANCH);
  });

  it("verifies even though the launcher named a DIFFERENT conversation — the #216 lockout", () => {
    // The dead CLI's record is still on disk and still names the launcher's id. Under the old
    // contract this exact input produced SESSION_FOREIGN and refused the owner's real conversation.
    const r = assert_({ lease: lease(), leaseLiveness: "dead" });
    expect(r.ok).toBe(true);
    expect(r.notes.join(" ")).toMatch(/took the folder over from session 8fc927ae/);
  });

  it("is a resume, not a launch, once the folder's lease already names it", () => {
    expect(assert_({ lease: lease({ sessionId: ME }), leaseLiveness: "live" }).mode).toBe("resume");
  });

  it("is a launch the first time, so the brief opens the work", () => {
    expect(assert_().mode).toBe("launch");
  });
});

describe("the three facts, each one of them load-bearing", () => {
  it("refuses a folder that is not a work tree at all", () => {
    expect(assert_({ live: { ...LIVE, isWorktree: false } }).code).toBe("NOT_A_WORKTREE");
  });

  it("refuses a folder pointing at another repository", () => {
    expect(assert_({ live: { ...LIVE, repo: "someone/else" } }).code).toBe("REPO_MISMATCH");
  });

  it("refuses when the origin cannot be read — unreadable is not agreement", () => {
    expect(assert_({ live: { ...LIVE, repo: null } }).code).toBe("REPO_UNREADABLE");
  });

  it("refuses a branch the board did not put this issue on", () => {
    const r = assert_({ live: { ...LIVE, branch: "main" } });
    expect(r.code).toBe("BRANCH_NOT_THE_BOARDS");
    expect(r.expected).toBe(BRANCH);
    expect(r.actual).toBe("main");
  });

  it("refuses a detached HEAD rather than calling an unknown branch verified", () => {
    expect(assert_({ live: { ...LIVE, branch: null } }).code).toBe("BRANCH_UNREADABLE");
  });

  it("refuses when nothing measured the folder at all", () => {
    expect(assert_({ live: null }).code).toBe("FACTS_UNOBSERVED");
  });

  it("refuses when two issues claim the same folder — unknown means locked", () => {
    const rows = [...BOARD.rows, { issue: 99, folder: FOLDER, branch: BRANCH }];
    expect(assert_({ board: { ...BOARD, rows } }).code).toBe("FOLDER_AMBIGUOUS");
  });

  it("refuses a root nobody observed, even when every other fact agrees", () => {
    expect(assert_({ env: {}, hookInput: null }).code).toBe("ROOT_UNOBSERVED");
  });
});

describe("a folder no issue claims is normal, not broken", () => {
  it("says so once, and does not stop the session", () => {
    const r = assert_({ board: { ...BOARD, rows: [] } });
    expect(r.code).toBe("FOLDER_UNCLAIMED");
    expect(ADVISORY_CODES.has(r.code)).toBe(true);
    expect(verdictFor(r).exit).toBe(0);
  });

  it("names the cd-without-root case separately, because the fix is different", () => {
    const r = assert_({
      env: { ...ENV, CLAUDE_PROJECT_DIR: OTHER },
      hookInput: { session_id: ME, cwd: OTHER },
      cwd: FOLDER,
    });
    expect(r.code).toBe("CD_WITHOUT_ROOT");
    expect(verdictFor(r).exit).toBe(2);
  });

  it("asserts nothing either way when the board could not be read", () => {
    const r = assert_({ board: { reachable: false, rows: [] } });
    expect(r.code).toBe("BOARD_UNREACHABLE");
    expect(verdictFor(r).exit).toBe(0);
  });

  it("discloses a cached board answer instead of passing it off as live", () => {
    expect(assert_({ board: { ...BOARD, stale: true } }).notes.join(" ")).toMatch(/cached from/);
  });
});

// ── the one-writer rule, decided by liveness rather than by a clock ──────────────────────────────

describe("a competing writer", () => {
  it("still refuses while it is live", () => {
    const r = assert_({ lease: lease(), leaseLiveness: "live" });
    expect(r.code).toBe("WRITER_LIVE");
    expect(verdictFor(r).exit).toBe(2);
  });

  it("refuses when nothing could measure it, even under an unexpired lease", () => {
    expect(assert_({ lease: lease(), leaseLiveness: "unknown" }).code).toBe("WRITER_UNKNOWN");
  });

  it("lapses once its lease has run out and nothing could be measured", () => {
    expect(assert_({ lease: lease({ expiresAt: ago(1) }), leaseLiveness: "unknown" }).ok).toBe(true);
  });

  it("is not a competing writer when it IS us", () => {
    expect(assert_({ lease: lease({ sessionId: ME }), leaseLiveness: "live" }).ok).toBe(true);
  });

  it("refuses a lease that exists and cannot be read — evidence destroyed is not evidence absent", () => {
    const r = assert_({ lease: CORRUPT });
    expect(r.code).toBe("LEASE_CORRUPT");
    expect(verdictFor(r).exit).toBe(2);
  });
});

describe("liveness — the record must not outlive the process (#216)", () => {
  it("is live while the recorded pid is still there", () => {
    expect(livenessOf(lease({ pid: 4242 }), { alive: true, seenAt: null, now: NOW })).toBe("live");
  });

  it("is live while the conversation is still writing its transcript", () => {
    expect(livenessOf(lease(), { alive: null, seenAt: ago(1), now: NOW })).toBe("live");
  });

  it("is dead once the transcript has gone cold", () => {
    expect(livenessOf(lease(), { alive: null, seenAt: ago(LIVE_STALE_MINUTES + 1), now: NOW })).toBe("dead");
  });

  it("is dead when the claimant never wrote a transcript at all — the #216 claimant exactly", () => {
    expect(livenessOf(lease({ lastSeenAt: ago(LIVE_GRACE_MINUTES + 1) }), { alive: false, seenAt: null, now: NOW })).toBe("dead");
  });

  it("is unknown while the record is younger than the grace period, so a starting session is safe", () => {
    expect(livenessOf(lease({ lastSeenAt: ago(1) }), { alive: null, seenAt: null, now: NOW })).toBe("unknown");
  });

  it("never condemns on a dead pid ALONE — the pid may not be the session's own", () => {
    // MEASURED, not hypothetical. On this machine, 2026-08-25: a lease this very session wrote at
    // 09:16 recorded pid 26224, and fourteen minutes later that pid was GONE while the session was
    // still typing — process.ppid is whatever spawned that one hook run, not the conversation. A
    // pid-only rule would have marked a live session dead and handed its folder away. So the pid may
    // only ever PROMOTE a lease to live; the transcript is the signal that condemns.
    expect(livenessOf(lease({ lastSeenAt: ago(1) }), { alive: false, seenAt: null, now: NOW })).toBe("unknown");
    expect(livenessOf(lease(), { alive: false, seenAt: ago(1), now: NOW })).toBe("live");
  });

  it("has nothing to say about a folder with no lease", () => {
    expect(livenessOf(null, { now: NOW })).toBe("none");
  });
});

describe("the two liveness probes measure the real machine", () => {
  it("finds this very process alive, and a pid nobody could be running dead", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(0)).toBe(null);
    expect(pidAlive("nonsense")).toBe(null);
  });

  const dir = mkdtempSync(join(tmpdir(), "compy-transcripts-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a transcript's mtime, and says null when there is none", () => {
    const project = join(dir, "c--Users-Kuya-code-sentinel-marathon");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, `${ME}.jsonl`), "{}\n");
    const when = new Date("2026-08-25T05:30:00.000Z");
    utimesSync(join(project, `${ME}.jsonl`), when, when);

    expect(transcriptSeenAt(ME, { dir })).toBe(when.toISOString());
    expect(transcriptSeenAt(THEM, { dir })).toBe(null);
    expect(transcriptSeenAt(null, { dir })).toBe(null);
  });
});

// ── adopt: the cure the refusal prints has to actually work (#216) ───────────────────────────────

describe("adopt, against a record whose session is gone", () => {
  const facts = {
    folder: FOLDER,
    issue: 216,
    sessionId: ME,
    isWorktree: true,
    live: { branch: BRANCH, repo: "pootytxng/sentinel" },
    issueFacts: { state: "OPEN", labels: ["work-control"], title: "entry" },
    now: NOW,
  };

  it("still refuses while the other conversation is live", () => {
    const r = planAdoption({ ...facts, existing: lease(), liveness: "live" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ADOPT_FOLDER_CLAIMED");
  });

  it("adopts once that conversation's process is gone", () => {
    const r = planAdoption({ ...facts, existing: lease(), liveness: "dead" });
    expect(r.ok).toBe(true);
    expect(r.record.sessionId).toBe(ME);
    expect(r.notes.join(" ")).toMatch(/whose process is gone/);
  });

  it("does not inherit the dead record's history — a takeover is not a refresh", () => {
    const r = planAdoption({ ...facts, existing: lease({ seenCount: 9 }), liveness: "dead" });
    expect(r.record.seenCount).toBe(1);
    expect(r.record.firstSeenAt).toBe(NOW.toISOString());
  });

  it("refuses when liveness could not be measured — unknown means locked", () => {
    expect(planAdoption({ ...facts, existing: lease(), liveness: "unknown" }).code).toBe("ADOPT_FOLDER_CLAIMED");
  });

  it("records no pid, because the CLI process is not the conversation", () => {
    expect(planAdoption({ ...facts, existing: null, liveness: "none" }).record.pid).toBe(null);
  });
});

// ── the board grammar this file duplicates must not drift from the one it copied ─────────────────

describe("the hook's copy of the Worktree / branch grammar", () => {
  const CASES = [
    `${FOLDER} @ ${BRANCH}`,
    `${FOLDER} / ${BRANCH}`,
    `${FOLDER} \u00B7 ${BRANCH}`,
    `${FOLDER} @ ${BRANCH} ; ${OTHER} @ feat/other`,
    "none",
    "",
  ];

  for (const raw of CASES) {
    it(`agrees with tools/entry/worktree-field.mjs on ${JSON.stringify(raw)}`, () => {
      const mine = parseWorktreeEntries(raw);
      const theirs = parseWorktreeField(raw, { codeRoot: "C:\\Users\\Kuya\\code" });
      expect(theirs.ok).toBe(true);
      expect(mine).toEqual(theirs.entries.map((e) => ({ folder: e.path, branch: e.branch })));
    });
  }

  it("strips a trailing board parenthetical rather than reading it as part of the branch", () => {
    expect(parseWorktreeEntries(`${FOLDER} @ ${BRANCH} (paused)`)).toEqual([{ folder: FOLDER, branch: BRANCH }]);
  });

  it("flattens board items into one row per folder the item names", () => {
    expect(
      boardRows([
        { number: 216, "worktree / branch": `${FOLDER} @ ${BRANCH}`, status: "Active" },
        { number: 215, "worktree / branch": "none" },
        { number: null, "worktree / branch": `${OTHER} @ feat/x` },
      ]),
    ).toEqual([{ issue: 216, folder: FOLDER, branch: BRANCH, status: "Active" }]);
  });
});

// ── the pre-launch probe: the original guard, unchanged ──────────────────────────────────────────

const of = (name) => (rows) => classifyProcesses(rows, { folder: FOLDER }).find((g) => g.name === name);

describe("a Claude session in the folder we are about to claim", () => {
  it("is watched at all", () => {
    expect(WATCHED).toContain("claude.exe");
  });

  it("contends when it is rooted in this folder", () => {
    const g = of("claude.exe")([{ name: "claude.exe", commandLine: `claude --ide ${FOLDER}` }]);
    expect(g.contends).toBe(true);
    expect(g.note).toMatch(/already working in this folder/i);
  });

  it("does not contend from another root — that is somebody else's claim, not ours to refuse", () => {
    expect(of("claude.exe")([{ name: "claude.exe", commandLine: `claude --ide ${OTHER}` }]).contends).toBe(false);
  });

  it("is still listed when it does not contend, because disclosure is the default", () => {
    expect(of("claude.exe")([{ name: "claude.exe", commandLine: `claude --ide ${OTHER}` }]).count).toBe(1);
  });
});

describe("what is still not a writer", () => {
  it("an editor open on this folder", () => {
    expect(of("Code.exe")([{ name: "Code.exe", commandLine: `Code.exe ${FOLDER}` }]).contends).toBe(false);
  });

  it("the installed app running, which has nothing to do with this folder", () => {
    expect(of("compy.exe")([{ name: "compy.exe", commandLine: "compy.exe" }]).contends).toBe(false);
  });
});

describe("what still is", () => {
  it("a build against this folder", () => {
    expect(of("cargo.exe")([{ name: "cargo.exe", commandLine: `cargo build --manifest-path ${FOLDER}\\src-tauri` }]).contends).toBe(true);
  });

  it("an installer, wherever it is running", () => {
    expect(of("msiexec.exe")([{ name: "msiexec.exe", commandLine: "msiexec /i compy.msi" }]).contends).toBe(true);
  });
});


// The board answer is CACHED for ten minutes, machine-wide, because the write guard asks the same
// question on every single Write and a `gh` call per keystroke is not a guard, it is an outage. That
// cache has one dangerous moment, and it is the launcher's: it posts the claim that puts a brand-new
// worktree on the board and then starts a session in that worktree seconds later. Read against a
// cache written before the claim, the session's own folder comes back unclaimed — the launcher
// building a folder no session can verify, which is #216 wearing a different hat.
describe("the cached board answer, at the one moment it is dangerous", () => {
  it("is thrown away on demand, and a missing cache is not an error", () => {
    const dir = mkdtempSync(join(tmpdir(), "compy-board-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, BOARD_CACHE_NAME), JSON.stringify({ fetchedAt: "2026-08-25T00:00:00.000Z", rows: [] }));
    expect(invalidateBoardCache({ dir })).toBe(true);
    expect(existsSync(join(dir, BOARD_CACHE_NAME))).toBe(false);
    expect(invalidateBoardCache({ dir })).toBe(true); // absent is the desired state, not a failure
    rmSync(dir, { recursive: true, force: true });
  });

  it("is thrown away by the launcher AFTER it claims, not before", () => {
    const src = readFileSync(join(HERE, "launch.mjs"), "utf8");
    const claimed = src.indexOf('effects.record("posted the ownership claim"');
    const cleared = src.indexOf("invalidateBoardCache(");
    const started = src.indexOf("planClaudeStart");
    expect(claimed).toBeGreaterThan(-1);
    expect(cleared).toBeGreaterThan(claimed);
    // …and before the window it is about to open reads the board for the first time.
    if (started > -1) expect(cleared).toBeLessThan(started);
  });
});

// The repository this guard is written against — asserted, not assumed, so a fork or a moved remote
// makes this file fail rather than silently verify sessions into the wrong repository.
describe("the repository these facts are about", () => {
  it("is the one the assert expects", () => {
    const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    expect(origin.toLowerCase()).toMatch(/pootytxng\/sentinel/);
  });
});
