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
  // WINDOW_UNOBSERVED, TOKEN_CORRUPT and LINEAGE_CORRUPT all mean "the evidence this hook verifies
  // against is not there", which is a reason to stop rather than a reason to shrug. Only a session
  // with NO artifacts at all is an ordinary unverified session.
  const STOP = [
    "ROOT_MISMATCH",
    "CD_WITHOUT_ROOT",
    "WINDOW_MISMATCH",
    "WINDOW_UNOBSERVED",
    "ROOT_UNOBSERVED",
    "BRANCH_MISMATCH",
    "REPO_MISMATCH",
    "LINEAGE_FOREIGN",
    "TOKEN_CORRUPT",
    "LINEAGE_CORRUPT",
    "BRANCH_UNREADABLE",
    "REPO_UNREADABLE",
    "SESSION_FOREIGN",
  ];
  const ADVISE = ["NO_TOKEN", "TOKEN_EXPIRED", "LINEAGE_EXPIRED", "LAUNCH_SPENT"];

  it("classifies every refusal code the assert can actually produce", () => {
    const produced = [...readFileSync(HOOK_FILE, "utf8").matchAll(/refuse\(\s*"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(produced.length).toBeGreaterThan(0);
    for (const code of new Set(produced)) {
      expect([...STOP, ...ADVISE], `${code} is produced but unclassified`).toContain(code);
    }
  });

  for (const code of STOP) {
    it(`stops on ${code} — a live token disagrees with this session`, () => {
      const v = verdictOf({ ok: false, code, reason: "…" });
      expect(v.exit).toBe(2);
      expect(v.level).toBe("stop");
    });
  }

  for (const code of ADVISE) {
    it(`advises on ${code} — there is no live token to disagree with`, () => {
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
    const v = verdictOf({ ok: false, code: "ROOT_MISMATCH", reason: "claimed A but root is B" });
    expect(v.message).toContain("ROOT_MISMATCH");
    expect(v.message).toContain("claimed A but root is B");
    expect(v.message).toMatch(/STOP/);
  });

  it("exports the advisory set, so the split is data rather than a buried if-chain", () => {
    for (const code of ADVISE) expect([...tracked.ADVISORY_CODES]).toContain(code);
    for (const code of STOP) expect([...tracked.ADVISORY_CODES]).not.toContain(code);
  });
});

describe("the assert itself still fails closed on a real disagreement", () => {
  it("blocks when the session root is not the claimed folder", () => {
    const r = tracked.assertSessionRoot({
      token: liveToken(),
      env: { CLAUDE_PROJECT_DIR: OTHER },
      cwd: OTHER,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ROOT_MISMATCH");
    expect(verdictOf(r).exit).toBe(2);
  });

  it("blocks when the shell moved but the project root did not", () => {
    const r = tracked.assertSessionRoot({
      token: liveToken(),
      env: { CLAUDE_PROJECT_DIR: OTHER },
      cwd: FOLDER,
    });
    expect(r.code).toBe("CD_WITHOUT_ROOT");
    expect(verdictOf(r).exit).toBe(2);
  });

  it("blocks when the live context window is not the one the launch resolved", () => {
    const r = tracked.assertSessionRoot({
      token: liveToken(),
      env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" },
      cwd: FOLDER,
    });
    expect(r.code).toBe("WINDOW_MISMATCH");
    expect(verdictOf(r).exit).toBe(2);
  });

  it("only advises in a session that was never launched through the entrypoint", () => {
    const r = tracked.assertSessionRoot({ token: null, env: { CLAUDE_PROJECT_DIR: OTHER }, cwd: OTHER });
    expect(r.code).toBe("NO_TOKEN");
    expect(verdictOf(r).exit).toBe(0);
  });

  it("claims the launch once, so the token alone cannot verify a later session", () => {
    // The launch is still single-use. What changed is what a later session leans on: its FOLDER's
    // lineage, established by that claim (session-lineage.test.mjs), not the spent token. A session
    // with neither is unverified — advisory, exactly as an ad-hoc window is.
    const dir = tokenDir();
    tracked.writeToken(liveToken(), { dir });

    const first = tracked.assertSessionRoot({
      token: tracked.readToken({ dir }),
      // A launched session reports the window the launcher established; an unobserved one is now its
      // own refusal, so the fixture carries what the real thing carries.
      env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" },
      cwd: FOLDER,
    });
    expect(first.ok).toBe(true);
    expect(first.mode).toBe("launch");
    tracked.claimToken({ dir });

    const second = tracked.assertSessionRoot({
      token: tracked.readToken({ dir }),
      lineage: null,
      env: { CLAUDE_PROJECT_DIR: FOLDER, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" },
      cwd: FOLDER,
    });
    expect(second.ok).toBe(false);
    // A launch that WAS made for this folder and taken up now says exactly that, instead of denying
    // the entrypoint ever launched it. Still advisory, still exit 0.
    expect(second.code).toBe("LAUNCH_SPENT");
    expect(verdictOf(second).exit).toBe(0);
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
