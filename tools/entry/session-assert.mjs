// Verify the session root from INSIDE the session (spec §4.3) — guards 1 and 8.
//
// Everything the launcher checks happens before the session exists, so the launcher's word for its
// own correctness is not evidence. #14 is the proof: every pre-launch value can agree and the
// session can still be running somewhere else. This module is the only component that observes the
// session from within it.
//
// Fails CLOSED in every direction: no token, expired token, reused token, or a root that could not
// be OBSERVED (as opposed to inferred) all refuse. Inference is not observation — guessing the root
// from process.cwd() is precisely how a wrong root passes for a right one.
//
// Designed to run as a SessionStart hook, where CLAUDE_PROJECT_DIR is populated and the hook payload
// carries `cwd`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { canonicalizePath, samePath } from "./worktree-field.mjs";

export const TOKEN_DIR = join(process.env.LOCALAPPDATA ?? ".", "CompyEntry");
export const TOKEN_NAME = "launch.json";
export const DEFAULT_TTL_MINUTES = 30;

export function makeToken({ issue, folder, branch, window, nonce = null, expiresAt = null, now = new Date() }) {
  return {
    issue,
    folder: canonicalizePath(folder),
    branch,
    window,
    nonce: nonce ?? randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt ?? new Date(now.getTime() + DEFAULT_TTL_MINUTES * 60_000).toISOString(),
    consumedAt: null,
  };
}

export function writeToken(token, { dir = TOKEN_DIR } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, TOKEN_NAME), JSON.stringify(token, null, 2));
  return join(dir, TOKEN_NAME);
}

export function readToken({ dir = TOKEN_DIR } = {}) {
  try {
    return JSON.parse(readFileSync(join(dir, TOKEN_NAME), "utf8"));
  } catch {
    return null;
  }
}

export function consumeToken({ dir = TOKEN_DIR } = {}, now = new Date()) {
  const t = readToken({ dir });
  if (!t) return null;
  t.consumedAt = now.toISOString();
  writeToken(t, { dir });
  return t;
}

/**
 * Where this session's project root really is.
 * `observed` distinguishes a value we were TOLD from one we GUESSED — only the former can license
 * a pass.
 */
export function resolveSessionRoot({ env = process.env, hookInput = null, cwd = process.cwd() } = {}) {
  if (env?.CLAUDE_PROJECT_DIR) {
    return { root: canonicalizePath(env.CLAUDE_PROJECT_DIR), source: "CLAUDE_PROJECT_DIR", observed: true };
  }
  if (hookInput?.cwd) {
    return { root: canonicalizePath(hookInput.cwd), source: "hook cwd", observed: true };
  }
  return { root: canonicalizePath(cwd), source: "process.cwd() (inferred)", observed: false };
}

const refuse = (code, reason, extra = {}) => ({ ok: false, code, reason, ...extra });

/**
 * @returns {{ok: boolean, code?: string, reason?: string, expected?: any, actual?: any, root?: string}}
 */
export function assertSessionRoot({ token, env = process.env, hookInput = null, cwd = process.cwd(), now = new Date() }) {
  if (!token) {
    return refuse(
      "NO_TOKEN",
      "No launch token. This session was not started through the entrypoint, so nothing verified " +
        "that its folder, branch and settings match a claim. A session with nothing to check is not a verified session.",
    );
  }
  if (token.consumedAt) {
    return refuse(
      "TOKEN_CONSUMED",
      `This launch token was already used at ${token.consumedAt}. A stale token must not validate a later session.`,
    );
  }
  if (token.expiresAt && new Date(token.expiresAt) < now) {
    return refuse("TOKEN_EXPIRED", `The launch token expired at ${token.expiresAt}. Relaunch from the entrypoint.`);
  }

  const resolved = resolveSessionRoot({ env, hookInput, cwd });
  if (!resolved.observed) {
    return refuse(
      "ROOT_UNOBSERVED",
      "The real project root could not be observed (CLAUDE_PROJECT_DIR unset and no hook payload). " +
        "Inferring it from the working directory is the exact mistake this guard exists to catch, so this fails closed.",
      { root: resolved.root },
    );
  }

  if (!samePath(resolved.root, token.folder)) {
    // The shell moved and the root did not: relative paths land correctly while settings, hooks and
    // the context window all still come from the other folder. Different failure, different fix.
    if (samePath(cwd, token.folder)) {
      return refuse(
        "CD_WITHOUT_ROOT",
        `The shell is in the claimed folder but Claude's real project root is ${resolved.root}. ` +
          "Changing directories does not move the project root — settings, hooks and the context window " +
          "still come from the other folder. Reopen the folder as the workspace root instead of cd-ing into it.",
        { expected: token.folder, actual: resolved.root, root: resolved.root },
      );
    }
    return refuse(
      "ROOT_MISMATCH",
      `Claimed ${token.folder} but this session's root is ${resolved.root}. Stop before writing anything.`,
      { expected: token.folder, actual: resolved.root, root: resolved.root },
    );
  }

  const liveWindow = Number(env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (token.window && Number.isFinite(liveWindow) && liveWindow !== token.window) {
    return refuse(
      "WINDOW_MISMATCH",
      `This session is running with a ${liveWindow} context window; the launch resolved ${token.window}. ` +
        "The window a session actually got is the only one that counts.",
      { expected: token.window, actual: liveWindow, root: resolved.root },
    );
  }

  return { ok: true, root: resolved.root, source: resolved.source, issue: token.issue, branch: token.branch };
}
