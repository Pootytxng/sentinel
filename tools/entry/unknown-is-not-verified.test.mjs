// Guard: a missing observation is not a matching one.
//
// Two ways the assert turned absent evidence into a green session:
//
//   the window  `Number(undefined)` is NaN, `Number.isFinite(NaN)` is false, so the window check was
//               SKIPPED when the variable was unset — and unlike the branch and repo clauses beside
//               it, it did not even leave a note. The launcher establishes the tier and this hook is
//               the only thing that confirms the session actually got it, so "could not tell" was
//               reported as "verified".
//
//   the records `readToken` and `readLineage` were `try { JSON.parse } catch { return null }`. A
//               truncated or half-written launch.json under an active launch therefore reached the
//               "nothing to check against" branch and printed the cheerful NO_TOKEN advisory at
//               exit 0. The launcher wrote that file so this hook could verify against it; losing it
//               is a reason to stop, not to shrug.
//
// The line that does NOT move: a session with no artifacts at all is an ordinary unverified session
// and stays advisory. Failing closed is for evidence that was supposed to be there and is not.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CORRUPT,
  TOKEN_NAME,
  assertSessionRoot,
  lineageFile,
  makeToken,
  readLineage,
  readToken,
  verdictFor,
  writeToken,
} from "./session-assert.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";
const tok = (over = {}) => makeToken({ issue: 23, folder: FOLDER, branch: "tooling/entry-acceptance", window: 300000, ...over });

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-unknown-"));
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("a window nobody observed", () => {
  const run = (env) => assertSessionRoot({ token: tok(), env: { CLAUDE_PROJECT_DIR: FOLDER, ...env }, cwd: FOLDER });

  it("refuses when the variable is absent", () => {
    const r = run({});
    expect(r.ok).toBe(false);
    expect(r.code).toBe("WINDOW_UNOBSERVED");
    expect(verdictFor(r).exit).toBe(2);
  });

  it("refuses when the variable is there but not a number", () => {
    expect(run({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "wide" }).code).toBe("WINDOW_UNOBSERVED");
    expect(run({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "" }).code).toBe("WINDOW_UNOBSERVED");
  });

  it("passes when the session really does report the established window", () => {
    expect(run({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" }).ok).toBe(true);
  });

  it("still says MISMATCH, not UNOBSERVED, when a different window was observed", () => {
    expect(run({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" }).code).toBe("WINDOW_MISMATCH");
  });

  it("says which window it wanted and what it saw", () => {
    const r = run({});
    expect(r.expected).toBe(300000);
    expect(r.reason).toMatch(/nothing to check it against/i);
  });
});

describe("a record that exists and cannot be read", () => {
  it("is distinguished from a record that is simply absent", () => {
    expect(readToken({ dir })).toBe(null);
    writeFileSync(join(dir, TOKEN_NAME), "{ this is not json");
    expect(readToken({ dir })).toBe(CORRUPT);
  });

  it("treats a non-object payload as corrupt too", () => {
    writeFileSync(join(dir, TOKEN_NAME), '"a string is not a launch record"');
    expect(readToken({ dir })).toBe(CORRUPT);
  });

  it("stops on a damaged launch record instead of calling the session unverified-but-fine", () => {
    const r = assertSessionRoot({ token: CORRUPT, env: { CLAUDE_PROJECT_DIR: FOLDER }, cwd: FOLDER });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("TOKEN_CORRUPT");
    expect(verdictFor(r).exit).toBe(2); // the whole point: not the exit 0 advisory
  });

  it("stops on a damaged lineage record for the same reason", () => {
    const r = assertSessionRoot({ token: null, lineage: CORRUPT, env: { CLAUDE_PROJECT_DIR: FOLDER }, cwd: FOLDER });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("LINEAGE_CORRUPT");
    expect(verdictFor(r).exit).toBe(2);
  });

  it("reads a damaged lineage file off disk as corrupt, not as absent", () => {
    const f = lineageFile({ root: FOLDER, dir });
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "{{{");
    expect(readLineage({ root: FOLDER, dir })).toBe(CORRUPT);
  });
});

describe("what stays advisory", () => {
  // An ordinary window Kuya opened himself has no artifacts to have lost. It was never verified and
  // never claimed to be; making it a hard stop would be the launcher crying wolf in every session.
  it("a session with no token and no lineage at all", () => {
    const r = assertSessionRoot({ token: null, lineage: null, env: { CLAUDE_PROJECT_DIR: FOLDER }, cwd: FOLDER });
    expect(r.code).toBe("NO_TOKEN");
    expect(verdictFor(r).exit).toBe(0);
  });

  it("an absent token file reads as absent, not corrupt", () => {
    writeToken(tok(), { dir });
    expect(readToken({ dir })).not.toBe(CORRUPT);
    rmSync(join(dir, TOKEN_NAME), { force: true });
    expect(readToken({ dir })).toBe(null);
  });
});
