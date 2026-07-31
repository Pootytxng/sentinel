// Guards 1 and 8 — the two failures that only the session itself can see.
//
// Guard 1: claimed `sentinel-feedback` while the session root is `sentinel-rel`. This is the #14
// failure. Everything before launch can agree perfectly and still be wrong, because the launcher's
// word for its own correctness is not evidence.
//
// Guard 8: a launcher that changes shell directories without changing Claude's real project root.
// The `cd` succeeds, the prompt looks right, and every command that uses a relative path lands in
// the intended folder — while settings, hooks and the context window all still come from somewhere
// else. Its tell is precise: cwd matches the claim, the project root does not.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSessionRoot, makeToken, readToken, resolveSessionRoot, writeToken } from "./session-assert.mjs";

const CLAIMED = "C:\\Users\\Kuya\\code\\sentinel-feedback";
const ELSEWHERE = "C:\\Users\\Kuya\\code\\sentinel-rel";
const NOW = new Date("2026-07-30T12:00:00Z");

let store;
const token = (over = {}) => ({
  ...makeToken({ issue: 14, folder: CLAIMED, branch: "feat/user-feedback-lab-recovery", window: 300000, nonce: "n1", expiresAt: "2026-07-30T18:00:00Z" }),
  ...over,
});

beforeAll(() => {
  store = mkdtempSync(join(tmpdir(), "compy-entry-token-"));
});

afterAll(() => {
  try {
    rmSync(store, { recursive: true, force: true });
  } catch {
    /* locked file on Windows must not fail the suite */
  }
});

describe("resolving the REAL session root", () => {
  it("prefers CLAUDE_PROJECT_DIR, which is what a hook actually receives", () => {
    const r = resolveSessionRoot({ env: { CLAUDE_PROJECT_DIR: CLAIMED }, cwd: ELSEWHERE });
    expect(r.root).toBe(CLAIMED);
    expect(r.source).toBe("CLAUDE_PROJECT_DIR");
    expect(r.observed).toBe(true);
  });

  it("uses the hook payload's cwd when the variable is absent", () => {
    const r = resolveSessionRoot({ env: {}, hookInput: { cwd: CLAIMED }, cwd: ELSEWHERE });
    expect(r.root).toBe(CLAIMED);
    expect(r.source).toBe("hook cwd");
  });

  it("marks a process-cwd fallback as NOT observed — inference is not observation", () => {
    // If the real root cannot be observed, the honest answer is "unknown", and unknown must fail
    // closed. Guessing from process.cwd() is exactly how a wrong root passes for a right one.
    const r = resolveSessionRoot({ env: {}, cwd: CLAIMED });
    expect(r.root).toBe(CLAIMED);
    expect(r.observed).toBe(false);
  });
});

describe("guard 1 — claimed one folder, running in another", () => {
  it("refuses when the session root is not the claimed folder", () => {
    const r = assertSessionRoot({ token: token(), env: { CLAUDE_PROJECT_DIR: ELSEWHERE }, cwd: ELSEWHERE, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ROOT_MISMATCH");
    expect(r.expected).toBe(CLAIMED);
    expect(r.actual).toBe(ELSEWHERE);
  });

  // These two are about FOLDER comparison. A launched session also reports the window the launcher
  // established, and an unobserved window is now its own refusal (see the WINDOW_UNOBSERVED cases
  // below), so the fixtures carry what a real launched session carries.
  it("passes when they agree", () => {
    const r = assertSessionRoot({ token: token(), env: { CLAUDE_PROJECT_DIR: CLAIMED, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" }, cwd: CLAIMED, now: NOW });
    expect(r.ok).toBe(true);
  });

  it("compares folders case- and separator-insensitively", () => {
    const r = assertSessionRoot({ token: token(), env: { CLAUDE_PROJECT_DIR: "c:/users/kuya/code/sentinel-feedback", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" }, cwd: CLAIMED, now: NOW });
    expect(r.ok).toBe(true);
  });
});

describe("guard 8 — the shell moved but the project root did not", () => {
  it("refuses, and names the failure precisely rather than as a generic mismatch", () => {
    const r = assertSessionRoot({ token: token(), env: { CLAUDE_PROJECT_DIR: ELSEWHERE }, cwd: CLAIMED, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CD_WITHOUT_ROOT");
    expect(r.reason).toMatch(/shell/i);
    expect(r.reason).toMatch(/project root/i);
  });

  it("is distinguishable from a plain wrong-root run, because the fixes differ", () => {
    const cdOnly = assertSessionRoot({ token: token(), env: { CLAUDE_PROJECT_DIR: ELSEWHERE }, cwd: CLAIMED, now: NOW });
    const plain = assertSessionRoot({ token: token(), env: { CLAUDE_PROJECT_DIR: ELSEWHERE }, cwd: ELSEWHERE, now: NOW });
    expect(cdOnly.code).not.toBe(plain.code);
  });
});

describe("failing closed", () => {
  it("refuses when no token exists — a session with nothing to check is not a verified session", () => {
    const r = assertSessionRoot({ token: null, env: { CLAUDE_PROJECT_DIR: CLAIMED }, cwd: CLAIMED, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NO_TOKEN");
  });

  it("refuses an expired token", () => {
    const r = assertSessionRoot({ token: token({ expiresAt: "2026-07-30T11:00:00Z" }), env: { CLAUDE_PROJECT_DIR: CLAIMED }, cwd: CLAIMED, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("TOKEN_EXPIRED");
  });

  it("refuses a token already claimed by an earlier session, with no lineage to stand on", () => {
    // Claimed once, still once. What a later session in this folder resumes is the FOLDER's lineage
    // (session-lineage.test.mjs); a spent token with no such record verifies nothing on its own.
    const r = assertSessionRoot({ token: token({ claimedAt: "2026-07-30T09:00:00Z" }), lineage: null, env: { CLAUDE_PROJECT_DIR: CLAIMED }, cwd: CLAIMED, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NO_TOKEN");
  });

  it("refuses when the root could not be observed at all", () => {
    const r = assertSessionRoot({ token: token(), env: {}, cwd: CLAIMED, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ROOT_UNOBSERVED");
  });

  it("checks the window the session actually got, not the one the launcher intended", () => {
    const r = assertSessionRoot({
      token: token(),
      env: { CLAUDE_PROJECT_DIR: CLAIMED, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" },
      cwd: CLAIMED,
      now: NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("WINDOW_MISMATCH");
    expect(r.expected).toBe(300000);
    expect(r.actual).toBe(150000);
  });
});

describe("the token on disk", () => {
  it("round-trips", () => {
    const t = token();
    writeToken(t, { dir: store });
    expect(readToken({ dir: store })).toMatchObject({ issue: 14, folder: CLAIMED, nonce: "n1" });
  });

  it("returns null rather than throwing when absent or unreadable", () => {
    expect(readToken({ dir: join(store, "nope") })).toBeNull();
  });

  it("carries a nonce, so a stale token cannot validate a later session", () => {
    expect(makeToken({ issue: 1, folder: CLAIMED, branch: "b", window: 150000 }).nonce).toBeTruthy();
  });
});
