// Guard for owner decision 3 (Issue #18, 2026-07-30): the root assert becomes a TRACKED hook, so it
// runs in every session in every checkout the moment this branch reaches `main`.
//
// That reach is the whole reason this file exists. Today the assert is installed by the launcher
// into one folder at a time and blocks on every refusal code, which is correct for a folder the
// launcher just opened. Tracked, the same hook fires in sessions nobody launched through the
// entrypoint — Kuya's ad-hoc window, Cowork, Codex, a fresh clone — where "no launch token" is the
// normal, correct state and not a fault. Blocking there would break every one of those sessions.
//
// So severity splits, and the split is mechanical:
//
//   STOP (exit 2) — a live, unconsumed token DISAGREES with this session. Something is genuinely
//                   wrong and a write would land in the wrong folder.
//   ADVISE (exit 0) — there is no live token to disagree with. Say so, once, and get out of the way.
//
// Two further properties are load-bearing and easy to lose in a refactor:
//   * unknown codes STOP. A refusal nobody classified must not become a silent pass.
//   * the hook is self-contained (node: imports only, see tracked-hooks.test.mjs), so it duplicates
//     canonicalizePath/samePath. Duplicated path logic that DRIFTS is worse than none — one copy
//     saying two folders match while the other says they differ is precisely a wrong root passing
//     for a right one. This pins the two copies together.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import * as tracked from "../../.claude/hooks/session-root-assert.mjs";
import * as shim from "./session-assert.mjs";
import { canonicalizePath as fieldCanonicalize, samePath as fieldSamePath } from "./worktree-field.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_FILE = join(HERE, "..", "..", ".claude", "hooks", "session-root-assert.mjs");

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-workflow";
const OTHER = "C:\\Users\\Kuya\\code\\sentinel-rel";

let scratch = null;
const tokenDir = () => {
  scratch ??= mkdtempSync(join(tmpdir(), "compy-entry-assert-"));
  return scratch;
};
afterAll(() => {
  if (!scratch) return;
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

const liveToken = (over = {}) =>
  tracked.makeToken({ issue: 18, folder: FOLDER, branch: "feat/single-entry-workflow", window: 150000, ...over });

const verdictOf = (result) => tracked.verdictFor(result);

describe("severity — a tracked hook must block on disagreement and only advise otherwise", () => {
  // Everything that means "a fact about this folder disagrees with this session", plus everything
  // that means "the evidence could not be read". Unreadable is a reason to stop, not to shrug.
  const STOP = [
    "CD_WITHOUT_ROOT",
    "ROOT_UNOBSERVED",
    "FOLDER_AMBIGUOUS",
    "FACTS_UNOBSERVED",
    "NOT_A_WORKTREE",
    "REPO_MISMATCH",
    "REPO_UNREADABLE",
    "BRANCH_UNREADABLE",
    "BRANCH_NOT_THE_BOARDS",
    "WRITER_LIVE",
    "WRITER_UNKNOWN",
    "LEASE_CORRUPT",
  ];
  const ADVISE = ["FOLDER_UNCLAIMED", "BOARD_UNREACHABLE"];

  it("classifies every refusal code the assert can actually produce", () => {
    const produced = [...readFileSync(HOOK_FILE, "utf8").matchAll(/refuse\(\s*"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(produced.length).toBeGreaterThan(0);
    for (const code of new Set(produced)) {
      expect([...STOP, ...ADVISE], `${code} is produced but unclassified`).toContain(code);
    }
  });

  // ── #125 step 1: the advisory half is stored split, and the split is data ────────────────────
  // UNVERIFIABLE ("nothing was ever verified for this folder") and LAPSED ("a launch happened and
  // its clock ran out") are one severity at SessionStart and two different cures at a write
  // refusal — see the hook's comment and the spec's §1b. Exported as data so the write hook reads
  // the classification instead of re-listing the codes, which is how the two copies drift apart.
  it("every advisory code lands in exactly one of UNVERIFIABLE / LAPSED", () => {
    for (const code of ADVISE) {
      const inU = tracked.UNVERIFIABLE_CODES.has(code);
      const inL = tracked.LAPSED_CODES.has(code);
      expect(Number(inU) + Number(inL), `${code} is in ${inU && inL ? "both" : "neither"} set`).toBe(1);
    }
  });

  it("ADVISORY_CODES is exactly the union — no code advises without a classification", () => {
    expect([...tracked.ADVISORY_CODES].sort()).toEqual(
      [...tracked.UNVERIFIABLE_CODES, ...tracked.LAPSED_CODES].sort(),
    );
    // And the split still describes reality: only FOLDER_UNCLAIMED means nothing claims this folder.
    expect([...tracked.UNVERIFIABLE_CODES]).toEqual(["FOLDER_UNCLAIMED"]);
  });

  it("no STOP code leaks into either advisory classification", () => {
    for (const code of STOP) {
      expect(tracked.UNVERIFIABLE_CODES.has(code), `${code} must stop, not advise`).toBe(false);
      expect(tracked.LAPSED_CODES.has(code), `${code} must stop, not advise`).toBe(false);
    }
  });

  for (const code of STOP) {
    it(`stops on ${code} — a fact disagrees with this session`, () => {
      const v = verdictOf({ ok: false, code, reason: "…" });
      expect(v.exit).toBe(2);
      expect(v.level).toBe("stop");
    });
  }

  for (const code of ADVISE) {
    it(`advises on ${code} — there is nothing to disagree with`, () => {
      const v = verdictOf({ ok: false, code, reason: "…" });
      expect(v.exit).toBe(0);
      expect(v.level).toBe("advisory");
      expect(v.message).not.toMatch(/STOP/);
    });
  }

  it("stops on a code nobody classified — an unclassified refusal is not a pass", () => {
    expect(verdictOf({ ok: false, code: "SOMETHING_NEW", reason: "…" }).exit).toBe(2);
  });

  it("passes cleanly when the session agrees", () => {
    const v = verdictOf({ ok: true, root: FOLDER, issue: 18, branch: "feat/single-entry-workflow" });
    expect(v.exit).toBe(0);
    expect(v.level).toBe("ok");
    expect(v.message).toContain(FOLDER);
  });

  it("names the code and the reason when it stops, so the fix is obvious from the message", () => {
    const v = verdictOf({ ok: false, code: "BRANCH_NOT_THE_BOARDS", reason: "claimed A but root is B" });
    expect(v.message).toContain("BRANCH_NOT_THE_BOARDS");
    expect(v.message).toContain("claimed A but root is B");
    expect(v.message).toMatch(/STOP/);
  });

  it("exports the advisory set, so the split is data rather than a buried if-chain", () => {
    for (const code of ADVISE) expect([...tracked.ADVISORY_CODES]).toContain(code);
    for (const code of STOP) expect([...tracked.ADVISORY_CODES]).not.toContain(code);
  });
});

describe("the assert fails closed when a FACT disagrees", () => {
  const BRANCH = "feat/single-entry-workflow";
  const SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const BOARD = {
    reachable: true,
    stale: false,
    fetchedAt: new Date("2026-08-25T06:00:00.000Z").toISOString(),
    rows: [{ issue: 18, folder: FOLDER, branch: BRANCH }],
  };
  const LIVE = { isWorktree: true, branch: BRANCH, repo: "pootytxng/sentinel" };

  const facts = (over = {}) =>
    tracked.assertSessionRoot({
      board: BOARD,
      live: LIVE,
      env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" },
      cwd: FOLDER,
      hookInput: { session_id: SESSION, cwd: FOLDER },
      ...over,
    });

  it("verifies a tab in the folder the board claims, on the branch the board names", () => {
    const r = facts();
    expect(r.ok).toBe(true);
    expect(r.issue).toBe(18);
    expect(verdictOf(r).exit).toBe(0);
  });

  it("blocks when the shell moved but the project root did not", () => {
    const r = facts({ env: { CLAUDE_PROJECT_DIR: OTHER }, hookInput: { session_id: SESSION, cwd: OTHER } });
    expect(r.code).toBe("CD_WITHOUT_ROOT");
    expect(verdictOf(r).exit).toBe(2);
  });

  it("blocks when the live branch is not the one the board put the issue on", () => {
    const r = facts({ live: { ...LIVE, branch: "main" } });
    expect(r.code).toBe("BRANCH_NOT_THE_BOARDS");
    expect(verdictOf(r).exit).toBe(2);
  });

  // #125 step 5 (2026-08-22, the owner armed the write refusal). These two are a PAIR and must stay
  // one: session START still advises, because a session that only reads is not broken and making it
  // fatal would close windows for nothing; the WRITE path is the half that refuses. Deleting the
  // advisory assertion is how the next change silently makes session start fatal, which is exactly
  // what the spec's rollout order (§4 step 5) says not to let happen.
  it("only advises in a folder no issue on the board claims", () => {
    const r = facts({ board: { reachable: true, rows: [] } });
    expect(r.code).toBe("FOLDER_UNCLAIMED");
    expect(verdictOf(r).exit).toBe(0);
  });

  it("but REFUSES the project write that same unverified session tries to make", async () => {
    const { decide } = await import("../../.claude/hooks/project-write-assert.mjs");
    // A root that EXISTS on disk: isInsideRoot canonicalizes both sides, so a fabricated folder
    // resolves to nothing and would make this pass for the wrong reason.
    const here = join(HERE, "..", "..");
    const r = facts({
      board: { reachable: true, rows: [] },
      env: { CLAUDE_PROJECT_DIR: here },
      hookInput: { session_id: SESSION, cwd: here },
      cwd: here,
    });
    const d = decide({
      toolName: "Write",
      toolInput: { file_path: join(here, "src", "App.tsx") },
      verdict: r,
      root: here,
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    expect(d.allow).toBe(false);
    // The refusal ships with its own cure, or it is just a closed window (spec §3a).
    expect(d.reason).toMatch(/adopt/);
  });

  it("and still lets that same session write OUTSIDE the project — the gate is scoped, not total", async () => {
    const { decide } = await import("../../.claude/hooks/project-write-assert.mjs");
    const here = join(HERE, "..", "..");
    const r = facts({
      board: { reachable: true, rows: [] },
      env: { CLAUDE_PROJECT_DIR: here },
      hookInput: { session_id: SESSION, cwd: here },
      cwd: here,
    });
    const d = decide({
      toolName: "Write",
      toolInput: { file_path: join(tmpdir(), "compy-scratch.txt") },
      verdict: r,
      root: here,
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    expect(d.allow).toBe(true);
    expect(d.why).toBe("outside the project root");
  });

  // #216. The token used to BE the verification: written by the launcher, naming one conversation,
  // single-use. A session it did not name was refused; a session it did name held the folder after
  // it died. It is now a launcher-internal handshake and nothing else, and the way that is kept
  // true is that the assert cannot even see it.
  it("no longer consults the launch token, for a pass or for a refusal", () => {
    const dir = tokenDir();
    // A live token naming a DIFFERENT folder and a DIFFERENT conversation. Under the old contract
    // this alone produced a refusal in this folder; under facts it is not an input.
    tracked.writeToken(liveToken({ folder: OTHER, sessionId: "99999999-9999-9999-9999-999999999999" }), { dir });
    expect(facts().ok).toBe(true);

    // And a spent token for THIS folder does not stop the next tab either — the LAUNCH_SPENT and
    // SESSION_FOREIGN refusals that stranded #215 and #216 have no code left to be produced by.
    tracked.writeToken(liveToken({ folder: FOLDER, sessionId: "99999999-9999-9999-9999-999999999999" }), { dir });
    tracked.claimToken({ dir });
    expect(facts().ok).toBe(true);
    const produced = [...readFileSync(HOOK_FILE, "utf8").matchAll(/refuse\(\s*"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(produced).not.toContain("SESSION_FOREIGN");
    expect(produced).not.toContain("LAUNCH_SPENT");
    expect(produced).not.toContain("NO_TOKEN");
  });
});

describe("one implementation, two entry points", () => {
  it("tools/entry/session-assert.mjs re-exports the tracked hook rather than copying it", () => {
    expect(shim.assertSessionRoot).toBe(tracked.assertSessionRoot);
    expect(shim.makeToken).toBe(tracked.makeToken);
    expect(shim.readToken).toBe(tracked.readToken);
    expect(shim.claimToken).toBe(tracked.claimToken);
    expect(shim.verifySession).toBe(tracked.verifySession);
    expect(shim.readLineage).toBe(tracked.readLineage);
    expect(shim.resolveSessionRoot).toBe(tracked.resolveSessionRoot);
    expect(shim.TOKEN_NAME).toBe(tracked.TOKEN_NAME);
  });

  it("the duplicated path helpers agree with worktree-field.mjs, so no root can match in one and differ in the other", () => {
    const cases = [
      "C:\\Users\\Kuya\\code\\sentinel-workflow",
      "c:/Users/Kuya/code/sentinel-workflow",
      "C:\\Users\\Kuya\\code\\sentinel-workflow\\",
      "  C:/Users/Kuya/code/sentinel-rel  ",
      "C:\\Users\\Kuya\\code\\sentinel",
      "",
    ];
    for (const c of cases) expect(tracked.canonicalizePath(c)).toBe(fieldCanonicalize(c));
    for (const a of cases) {
      for (const b of cases) expect(tracked.samePath(a, b)).toBe(fieldSamePath(a, b));
    }
  });
});
