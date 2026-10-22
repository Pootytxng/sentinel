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

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import * as tracked from "../../.claude/hooks/session-root-assert.mjs";
import * as blockerLib from "../../scripts/lib/board-blocker.mjs";
import * as shim from "./session-assert.mjs";
import { canonicalizePath as fieldCanonicalize, samePath as fieldSamePath } from "./worktree-field.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";

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
  // one: session START advises, because a session that only reads is not broken and making it
  // fatal would close windows for nothing. The WRITE path was the half that refused until #368
  // (spec §8, corrected in §9): an UNCLAIMED folder's write now PROCEEDS with one line of context
  // naming the cure the push gate enforces - no objection (context, no decision), not ask, because
  // a hook ask is a real prompt in every mode and this fires on every write - and not a
  // `permissionDecision: "allow"` either, which would skip the prompt and the auto-mode classifier.
  // Deleting the advisory assertion is how the next change
  // silently makes session start fatal, which is exactly what the spec's rollout order (§4 step 5)
  // says not to let happen; deleting the write assertion is how a refusal quietly comes back.
  it("only advises in a folder no issue on the board claims", () => {
    const r = facts({ board: { reachable: true, rows: [] } });
    expect(r.code).toBe("FOLDER_UNCLAIMED");
    expect(verdictOf(r).exit).toBe(0);
  });

  it("and the project write that same unclaimed session makes PROCEEDS, carrying its cure (#368)", async () => {
    const { decide, emit } = await import("../../.claude/hooks/project-write-assert.mjs");
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
    expect(d.allow).toBe(true);
    // No objection, not a decision (spec section 9 as corrected 2026-09-04): the wire carries the context
    // and NO `permissionDecision`, so the normal permission flow still applies to the call.
    expect(d.permission).toBeUndefined();
    let wrote = "";
    emit(d, { write: (s) => (wrote += s) });
    const out = JSON.parse(wrote).hookSpecificOutput;
    expect("permissionDecision" in out).toBe(false);
    // The answer ships with its own cure, or it is just a silent pass (spec §3a, §9).
    expect(d.additionalContext).toContain("FOLDER_UNCLAIMED");
    expect(d.additionalContext).toMatch(/Ownership claim/);
    expect(out.additionalContext).toBe(d.additionalContext);
  });

  it("but still REFUSES that write when the board's claim on the folder contradicts the session", async () => {
    const { decide } = await import("../../.claude/hooks/project-write-assert.mjs");
    const here = join(HERE, "..", "..");
    // A real verdict from the assert with a claim that names a different branch: a contradiction,
    // not an unclaimed folder, so #368's allow does not apply.
    const r = facts({
      board: { reachable: true, rows: [{ issue: 18, folder: here, branch: "somebody-elses-branch" }] },
      env: { CLAUDE_PROJECT_DIR: here },
      hookInput: { session_id: SESSION, cwd: here },
      cwd: here,
    });
    expect(r.ok).toBe(false);
    expect(tracked.ADVISORY_CODES.has(r.code)).toBe(false);
    const d = decide({
      toolName: "Write",
      toolInput: { file_path: join(here, "src", "App.tsx") },
      verdict: r,
      root: here,
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    expect(d.allow).toBe(false);
    expect(d.additionalContext).toBeUndefined();
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

// #368 — the hook's board read stayed at `--limit 100` after #339 raised the launcher's to 1000. On
// a 136-item board every claim past row 100 (every NEW lane) read as FOLDER_UNCLAIMED here while the
// launcher saw it, so the owner's "fixed" claim path was never visible to the guard that refuses.
describe("the board read is not truncated (#368)", () => {
  const item = (n) => ({ id: `I${n}`, content: { number: n }, status: "Active", "worktree / branch": `C:\\Users\\Kuya\\code\\sentinel-${n} @ lane/${n}` });

  it("asks gh for the same limit the launcher does, never the old 100", async () => {
    const { BOARD_READ_LIMIT } = await import("./gather.mjs");
    expect(tracked.BOARD_READ_LIMIT).toBe(BOARD_READ_LIMIT);
    expect(tracked.BOARD_READ_LIMIT).toBeGreaterThanOrEqual(1000);
    let argv = null;
    tracked.fetchBoardRows({ run: (a) => ((argv = a), JSON.stringify({ items: [], totalCount: 0 })) });
    expect(argv.slice(-2)).toEqual(["--limit", String(tracked.BOARD_READ_LIMIT)]);
  });

  it("treats a short read as no read — a truncated board must not turn issue 101+ into 'unclaimed'", () => {
    const short = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => item(i + 1)), totalCount: 136 });
    expect(tracked.fetchBoardRows({ run: () => short })).toBeNull();
    const full = JSON.stringify({ items: Array.from({ length: 136 }, (_, i) => item(i + 1)), totalCount: 136 });
    const rows = tracked.fetchBoardRows({ run: () => full });
    expect(rows.some((r) => r.issue === 136)).toBe(true);
  });
});

// docs/WORK_CONTROL.md "Executor identity" - every executor commits under its own name so the gate's
// mutationAuthors and the reviewer-not-author rule can be read off `git log`. Claude Code sets its
// own at SessionStart, per LINKED worktree, and only where nothing is set yet. The fixtures are real
// (`git init`, a real `git worktree add`, real `git config --worktree`) - the rule being guarded is
// about what git actually stores, so a mock would only reproduce the assumption.
describe("executor identity - the hook sets claude-code on a linked worktree it opens, and nowhere else", () => {
  const git = (cwd, ...args) =>
    execFileSync("git", ["-c", "user.name=guard", "-c", "user.email=guard@test", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const worktreeName = (dir) => {
    try {
      return git(dir, "config", "--worktree", "user.name");
    } catch {
      return null; // exit 1: unset
    }
  };

  let bed = null;
  let host = null;
  const setup = () => {
    if (bed) return;
    bed = mkdtempSync(join(tmpdir(), "compy-entry-identity-"));
    host = join(bed, "host");
    execFileSync("git", ["init", "-q", "-b", "main", host], { stdio: "ignore" });
    git(host, "config", "extensions.worktreeConfig", "true");
    writeFileSync(join(host, "README.md"), "fixture\n");
    git(host, "add", "-A");
    git(host, "commit", "-q", "-m", "fixture");
  };
  afterAll(() => {
    if (!bed) return;
    try {
      rmSync(bed, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows must not fail the suite */
    }
  });

  it("(a) a linked worktree with no --worktree identity gets claude-code, and says so in one line", () => {
    setup();
    const linked = join(bed, "linked-fresh");
    git(host, "worktree", "add", "-q", "-b", "lane/fresh", linked);
    expect(worktreeName(linked)).toBeNull();

    const r = tracked.ensureWorktreeIdentity(linked);
    expect(r.action).toBe("set");
    expect(r.line).toBe("compy-entry: worktree identity set to claude-code");
    expect(worktreeName(linked)).toBe(tracked.WORKTREE_IDENTITY.name);
    expect(git(linked, "config", "--worktree", "user.email")).toBe(tracked.WORKTREE_IDENTITY.email);
    // Per worktree, not per repository: the host's own config did not gain it.
    expect(worktreeName(host)).toBeNull();
    expect(() => git(host, "config", "--local", "user.name")).toThrow();
    // Idempotent: the second session in the same folder keeps what the first set.
    expect(tracked.ensureWorktreeIdentity(linked).action).toBe("kept");
  }, GIT_SPAWN_TIMEOUT_MS);

  it("warns when inherited Git variables make both effective identities codex despite claude-code worktree config", () => {
    setup();
    const linked = join(bed, "linked-inherited-codex");
    git(host, "worktree", "add", "-q", "-b", "lane/inherited-codex", linked);
    git(linked, "config", "--worktree", "user.name", "claude-code");
    git(linked, "config", "--worktree", "user.email", "claude-code@desk.local");
    const env = {
      GIT_AUTHOR_NAME: "codex",
      GIT_AUTHOR_EMAIL: "codex@desk.local",
      GIT_COMMITTER_NAME: "codex",
      GIT_COMMITTER_EMAIL: "codex@desk.local",
    };

    const actual = execFileSync("git", ["var", "GIT_AUTHOR_IDENT"], {
      cwd: linked,
      env: { ...process.env, ...env },
      encoding: "utf8",
    }).trim();
    expect(actual).toMatch(/^codex <codex@desk\.local> /);
    const result = tracked.ensureWorktreeIdentity(linked, { env });
    expect(result.action).toBe("kept");
    expect(result.warning).toMatch(/GIT_AUTHOR_IDENT.*codex/);
    expect(result.warning).toMatch(/GIT_COMMITTER_IDENT.*codex/);
    const shown = tracked.sessionStartMessage({
      verdict: { message: "compy-entry: session verified — #579 on codex/579-no-brief-context" },
      identity: result,
      provisioning: { action: "checked", line: "compy-entry: provisioning check — hooksPath, line endings, branch" },
    });
    expect(shown).toContain("session verified");
    expect(shown).toContain(result.warning);
    expect(shown).toContain("provisioning check");
    writeFileSync(join(bed, "574.json"), JSON.stringify({ text: "launch brief" }));
    const withBrief = tracked.sessionStartOutput(
      { ok: true, issue: 574, briefHash: null },
      { briefDir: bed, source: "startup", extraContext: result.warning },
    );
    expect(withBrief.additionalContext).toContain("launch brief");
    expect(withBrief.additionalContext).toContain(result.warning);
    const withoutBrief = tracked.sessionStartOutput(
      { ok: true, issue: 575, briefHash: null },
      { briefDir: bed, source: "startup", extraContext: result.warning },
    );
    expect(withoutBrief).toBeNull(); // main() must print all three lines as plain stdout to Claude.
    const mismatchedBrief = tracked.sessionStartOutput(
      { ok: true, issue: 574, briefHash: "0".repeat(64) },
      { briefDir: bed, source: "startup", extraContext: result.warning },
    );
    expect(mismatchedBrief).toBeNull();
    const correct = {
      GIT_AUTHOR_NAME: "claude-code",
      GIT_AUTHOR_EMAIL: "claude-code@desk.local",
      GIT_COMMITTER_NAME: "claude-code",
      GIT_COMMITTER_EMAIL: "claude-code@desk.local",
    };
    expect(tracked.ensureWorktreeIdentity(linked, { env: correct }).warning).toBeNull();
    const committerOnly = tracked.ensureWorktreeIdentity(linked, {
      env: { ...correct, GIT_COMMITTER_NAME: "codex", GIT_COMMITTER_EMAIL: "codex@desk.local" },
    });
    expect(committerOnly.warning).toMatch(/GIT_COMMITTER_IDENT.*codex/);
    expect(committerOnly.warning).not.toMatch(/GIT_AUTHOR_IDENT/);
    expect(worktreeName(linked)).toBe("claude-code");
  }, GIT_SPAWN_TIMEOUT_MS);

  it("(b) a linked worktree that already carries a --worktree identity is left exactly as it was", () => {
    setup();
    const linked = join(bed, "linked-owned");
    git(host, "worktree", "add", "-q", "-b", "lane/owned", linked);
    git(linked, "config", "--worktree", "user.name", "codex");
    git(linked, "config", "--worktree", "user.email", "codex@desk.local");

    const r = tracked.ensureWorktreeIdentity(linked);
    expect(r.action).toBe("kept");
    expect(r.line).toBeNull();
    expect(worktreeName(linked)).toBe("codex");
    expect(git(linked, "config", "--worktree", "user.email")).toBe("codex@desk.local");
  }, GIT_SPAWN_TIMEOUT_MS);

  it("(c) the main checkout is never touched, even with nothing set", () => {
    setup();
    expect(worktreeName(host)).toBeNull();
    const r = tracked.ensureWorktreeIdentity(host);
    expect(r.action).toBe("main");
    expect(r.line).toBeNull();
    expect(worktreeName(host)).toBeNull();
    expect(() => git(host, "config", "--local", "user.name")).toThrow();
  }, 30_000);

  it("a folder that is not a checkout, or no root at all, is skipped without a line - never a throw", () => {
    setup();
    const plain = mkdtempSync(join(bed, "not-a-repo-"));
    // Keep git's discovery from walking up into an ancestor repository (the temp dir is not one, but
    // the rule is "skip quietly", so it must hold wherever the temp dir happens to be).
    expect(tracked.ensureWorktreeIdentity(plain, { run: () => ({ ok: false, out: "fatal: not a git repository", status: 128 }) }).action).toBe("skipped");
    expect(tracked.ensureWorktreeIdentity(null).action).toBe("skipped");
    expect(tracked.ensureWorktreeIdentity("").action).toBe("skipped");
  });

  it("a git failure past the checkout test is one logged line, not a write and not a throw", () => {
    const calls = [];
    const run = (_root, args) => {
      calls.push(args.join(" "));
      if (args[0] === "rev-parse") return { ok: true, out: args[1] === "--git-dir" ? "C:\\host\\.git\\worktrees\\x" : "C:\\host\\.git", status: 0 };
      // `git config --worktree` without extensions.worktreeConfig: exit 128, not the "unset" exit 1.
      return { ok: false, out: "fatal: --worktree cannot be used with multiple working trees", status: 128 };
    };
    const r = tracked.ensureWorktreeIdentity("C:\\host\\x", { run });
    expect(r.action).toBe("failed");
    expect(r.line).toMatch(/^compy-entry: worktree identity not set - fatal: --worktree/);
    expect(calls.filter((c) => c.startsWith("config --worktree user.name claude-code"))).toEqual([]);
  });
  // 2026-10-21 (cloud-lane audit): a hosted claude.ai/code session runs in the MAIN checkout of a fresh
  // clone, where (c) above correctly leaves identity alone - so every hosted commit landed as the
  // harness default "Claude <noreply@anthropic.com>", an identity docs/WORK_CONTROL.md "Executor
  // identity" cannot read. The owner patch docs/superpowers/specs/2026-10-21-session-cloud-identity.patch
  // adds ensureCloudIdentity: hosted marker only, main checkout only, --local, never over a real name.
  // Corrected after the PR #679 exact-head review (2026-10-22, P2): it judges the name+email PAIR (a
  // custom email beside a missing or default name is another executor's and is kept), reads both halves
  // before writing either, stops on an unreadable half (unknown is not the harness default), and puts
  // user.name back when the user.email write fails so attribution is never left half-written.
  // Until it is applied the export is absent and this block skips; (c) keeps holding either way.
  describe.skipIf(typeof tracked.ensureCloudIdentity !== "function")("hosted identity - --local claude-code in a hosted main checkout, nowhere else (owner patch)", () => {
    const HOSTED = { CLAUDE_CODE_REMOTE: "true" };
    const localName = (dir) => {
      try {
        return git(dir, "config", "--local", "user.name");
      } catch {
        return null;
      }
    };
    const freshRepo = (name) => {
      setup();
      const dir = join(bed, name);
      execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "ignore" });
      writeFileSync(join(dir, "README.md"), "fixture\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "fixture");
      return dir;
    };

    it("does nothing at all when the harness does not say hosted", () => {
      const dir = freshRepo("cloud-not-hosted");
      const r = tracked.ensureCloudIdentity(dir, { env: {} });
      expect(r.action).toBe("skipped");
      expect(localName(dir)).toBeNull();
    }, GIT_SPAWN_TIMEOUT_MS);

    it("sets --local claude-code in a hosted main checkout, says so once, then keeps it", () => {
      const dir = freshRepo("cloud-main");
      const r = tracked.ensureCloudIdentity(dir, { env: HOSTED });
      expect(r.action).toBe("set");
      expect(r.line).toMatch(/^compy-entry: hosted identity set to claude-code/);
      expect(localName(dir)).toBe(tracked.CLOUD_IDENTITY.name);
      expect(git(dir, "config", "--local", "user.email")).toBe(tracked.CLOUD_IDENTITY.email);
      expect(tracked.ensureCloudIdentity(dir, { env: HOSTED }).action).toBe("kept");
    }, GIT_SPAWN_TIMEOUT_MS);

    it("never overwrites another executor's identity, but does replace the harness default", () => {
      const codex = freshRepo("cloud-codex");
      git(codex, "config", "--local", "user.name", "codex");
      git(codex, "config", "--local", "user.email", "codex@desk.local");
      expect(tracked.ensureCloudIdentity(codex, { env: HOSTED }).action).toBe("kept");
      expect(localName(codex)).toBe("codex");

      const harness = freshRepo("cloud-harness-default");
      git(harness, "config", "--local", "user.name", "Claude");
      git(harness, "config", "--local", "user.email", "noreply@anthropic.com");
      expect(tracked.ensureCloudIdentity(harness, { env: HOSTED }).action).toBe("set");
      expect(localName(harness)).toBe("claude-code");
    }, GIT_SPAWN_TIMEOUT_MS);

    it("leaves a linked worktree to ensureWorktreeIdentity, and skips no-root / not-a-repo quietly", () => {
      const dir = freshRepo("cloud-with-linked");
      git(dir, "config", "extensions.worktreeConfig", "true");
      const linked = join(bed, "cloud-linked");
      git(dir, "worktree", "add", "-q", "-b", "lane/cloud", linked);
      expect(tracked.ensureCloudIdentity(linked, { env: HOSTED }).action).toBe("skipped");
      expect(localName(dir)).toBeNull();
      expect(tracked.ensureCloudIdentity(null, { env: HOSTED }).action).toBe("skipped");
      const plain = mkdtempSync(join(bed, "cloud-not-a-repo-"));
      expect(tracked.ensureCloudIdentity(plain, { env: HOSTED, run: () => ({ ok: false, out: "fatal: not a git repository", status: 128 }) }).action).toBe("skipped");
    }, GIT_SPAWN_TIMEOUT_MS);

    // PR #679 exact-head review, P2 (2026-10-22): the first cut read user.name alone, so a custom email
    // beside a default name was overwritten, and a name-then-email write could stop half way.
    it("a custom email beside a missing or default name is another executor's identity: kept, untouched", () => {
      const dir = freshRepo("cloud-custom-email");
      git(dir, "config", "--local", "user.email", "grok@desk.local");
      const r = tracked.ensureCloudIdentity(dir, { env: HOSTED });
      expect(r.action).toBe("kept");
      expect(localName(dir)).toBeNull();
      expect(git(dir, "config", "--local", "user.email")).toBe("grok@desk.local");
      git(dir, "config", "--local", "user.name", "Claude");
      expect(tracked.ensureCloudIdentity(dir, { env: HOSTED }).action).toBe("kept");
      expect(localName(dir)).toBe("Claude");
      expect(git(dir, "config", "--local", "user.email")).toBe("grok@desk.local");
    }, GIT_SPAWN_TIMEOUT_MS);

    // Injected git: every call except the one under test goes to real git, in gitResult's shape.
    const realRun = (root, args) => {
      try {
        return { ok: true, out: git(root, ...args), status: 0 };
      } catch (err) {
        return {
          ok: false,
          out: String(err?.stderr ?? "").split(/\r?\n/)[0] ?? "",
          status: typeof err?.status === "number" ? err.status : null,
        };
      }
    };

    it("an unreadable local identity is one logged line and no write (unknown is not the harness default)", () => {
      const dir = freshRepo("cloud-unreadable");
      const writes = [];
      const run = (root, args) => {
        if (args[0] === "config" && args.includes("--get") && args.includes("user.email")) {
          return { ok: false, out: "fatal: unable to read config file", status: 128 };
        }
        if (args[0] === "config" && !args.includes("--get")) writes.push(args.join(" "));
        return realRun(root, args);
      };
      const r = tracked.ensureCloudIdentity(dir, { env: HOSTED, run });
      expect(r.action).toBe("failed");
      expect(r.line).toMatch(/^compy-entry: hosted identity not set - local identity unreadable \(fatal: unable to read config file\)/);
      expect(writes).toEqual([]);
      expect(localName(dir)).toBeNull();
    }, GIT_SPAWN_TIMEOUT_MS);

    it("a failed email write puts user.name back: an absent name is unset again, a default one is restored", () => {
      const failEmail = (root, args) => {
        if (args.slice(0, 3).join(" ") === "config --local user.email") {
          return { ok: false, out: "fatal: could not lock config file", status: 255 };
        }
        return realRun(root, args);
      };
      const absent = freshRepo("cloud-email-fails-absent");
      const r1 = tracked.ensureCloudIdentity(absent, { env: HOSTED, run: failEmail });
      expect(r1.action).toBe("failed");
      expect(r1.line).toMatch(/could not lock config file; user\.name restored$/);
      expect(localName(absent)).toBeNull();

      const harness = freshRepo("cloud-email-fails-default");
      git(harness, "config", "--local", "user.name", "Claude");
      const r2 = tracked.ensureCloudIdentity(harness, { env: HOSTED, run: failEmail });
      expect(r2.action).toBe("failed");
      expect(r2.line).toMatch(/user\.name restored$/);
      expect(localName(harness)).toBe("Claude");
      expect(() => git(harness, "config", "--local", "user.email")).toThrow();
    }, GIT_SPAWN_TIMEOUT_MS);
  });
});

// ── #445 option 2 (owner-accepted 2026-10-21): BOARD_UNREACHABLE carries the one structured blocker ──
// The tracked hook gains this through docs/superpowers/specs/2026-10-21-board-unreachable-structured.patch
// (a hook change authored from the hosted lane ships as a patch: docs/WORK_CONTROL.md). Until the patch
// is applied the hook exports no boardUnreachableBlocker and this block skips; once it is, the block
// runs and pins the hook's copy of the contract to scripts/lib/board-blocker.mjs. The hook may import
// nothing but `node:` (tracked-hooks.test.mjs), so it duplicates the contract — and two copies that
// drift would refuse the same unknown board in two different sets of words.
describe.skipIf(typeof tracked.boardUnreachableBlocker !== "function")("BOARD_UNREACHABLE is one structured blocker, in the gate's words (#445 option 2, owner patch)", () => {
  const BOARD_DOWN = { reachable: false, stale: false, fetchedAt: null, rows: [] };
  const FACTS = {
    board: BOARD_DOWN,
    live: { isWorktree: true, branch: "feat/x", repo: "pootytxng/sentinel" },
    env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" },
    cwd: FOLDER,
    hookInput: { session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", cwd: FOLDER },
  };
  const assertWith = (over = {}) => tracked.assertSessionRoot({ ...FACTS, ...over });

  it("duplicates scripts/lib/board-blocker.mjs exactly: transitions, consequences, blocker shape, render", () => {
    expect([...tracked.BOARD_HELD_TRANSITIONS]).toEqual([...blockerLib.BOARD_HELD_TRANSITIONS]);
    expect([...tracked.BOARD_UNREACHABLE_CONSEQUENCES]).toEqual([...blockerLib.BOARD_UNREACHABLE_CONSEQUENCES]);
    for (const args of [undefined, { transition: "merge-pr", why: "gh: HTTP 403" }, { why: 42 }]) {
      const mine = tracked.boardUnreachableBlocker(args);
      expect(mine).toEqual(blockerLib.boardUnreachableBlocker(args));
      expect(tracked.renderBoardUnreachable(mine)).toBe(blockerLib.renderBoardUnreachable(mine));
    }
    // One number for "fresh": the hook's cache TTL is the gate's freshness window.
    expect(blockerLib.BOARD_FRESH_MINUTES).toBe(tracked.BOARD_TTL_MINUTES);
  });

  it("attaches the blocker to the BOARD_UNREACHABLE refusal and to nothing else", () => {
    const r = assertWith();
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BOARD_UNREACHABLE");
    expect(r.advisory).toBe(true);
    expect(r.blocker).toEqual(blockerLib.boardUnreachableBlocker({ why: "Work Control could not be read" }));
    expect(r.blocker.transition).toBeUndefined();
    const unclaimed = assertWith({ board: { ...BOARD_DOWN, reachable: true } });
    expect(unclaimed.code).toBe("FOLDER_UNCLAIMED");
    expect(unclaimed.blocker).toBeUndefined();
  });

  it("prints the advisory line, then the one blocker line — exit 0, still not a wall", () => {
    const v = tracked.verdictFor(assertWith());
    expect(v.exit).toBe(0);
    expect(v.level).toBe("advisory");
    const lines = v.message.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("compy-entry: Work Control could not be read — this session is unverified until it can be.");
    expect(lines[1]).toBe(blockerLib.renderBoardUnreachable(blockerLib.boardUnreachableBlocker()));
    expect(lines[1]).toMatch(/^BOARD_UNREACHABLE: Work Control could not be read\. Consequences: unknown board state is never a PASS and never an exemption; /);
    // The other advisory stays one line.
    expect(tracked.verdictFor({ ok: false, code: "FOLDER_UNCLAIMED" }).message).not.toContain("\n");
  });
});
