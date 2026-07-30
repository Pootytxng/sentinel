// Verify the session root from INSIDE the session (spec §4.3) — guards 1 and 8.
//
// Everything the launcher checks happens before the session exists, so the launcher's word for its
// own correctness is not evidence. #14 is the proof: every pre-launch value can agree and the
// session can still be running somewhere else. This is the only component that observes the session
// from within it, which is why it is a SessionStart hook — that is where CLAUDE_PROJECT_DIR is
// populated and the payload carries `cwd`.
//
// WHY IT LIVES HERE (owner decision 2, Issue #18, 2026-07-30). `.claude/hooks/` is the single
// canonical hook source and it is tracked, so this file travels with the branch instead of existing
// on one machine in one folder. Two constraints follow, and both are enforced by
// tools/entry/tracked-hooks.test.mjs rather than by anyone remembering them:
//
//   * It imports `node:` builtins ONLY. `--repair` copies flat files into older branches, so a
//     `lib/` subdirectory would silently not travel and the hook would fail to load in exactly the
//     folders that needed repairing. canonicalizePath/samePath are therefore duplicated from
//     tools/entry/worktree-field.mjs, and pinned equal to it by test — duplicated path logic that
//     DRIFTS is one copy calling two folders the same while the other calls them different, which
//     is a wrong root passing for a right one.
//   * tools/entry/session-assert.mjs re-exports this module rather than copying it. One
//     implementation, two entry points.
//
// SEVERITY (owner decision 3). Tracked, this runs in every session in every checkout — including
// sessions nobody launched through the entrypoint: an ad-hoc window, Cowork, Codex, a fresh clone.
// There, "no launch token" is the normal state, not a fault, and blocking would break all of them.
// So it STOPS only when a live, unconsumed token DISAGREES with this session, and otherwise says
// its piece in one line and gets out of the way. Codes nobody classified STOP: an unclassified
// refusal must never become a silent pass.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

export const TOKEN_DIR = join(process.env.LOCALAPPDATA ?? ".", "CompyEntry");
export const TOKEN_NAME = "launch.json";
export const DEFAULT_TTL_MINUTES = 30;

// ── path helpers ─────────────────────────────────────────────────────────────────────────────────
// Duplicated from tools/entry/worktree-field.mjs so this file stays self-contained; held equal to it
// by tools/entry/session-root-assert.test.mjs. Change one, change both, or the guard fails.

export function canonicalizePath(p) {
  let out = String(p ?? "")
    .trim()
    .replace(/\//g, "\\");
  out = out.replace(/\\+$/, "");
  if (/^[a-z]:/.test(out)) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

export function samePath(a, b) {
  return canonicalizePath(a).toLowerCase() === canonicalizePath(b).toLowerCase();
}

// ── the launch token ─────────────────────────────────────────────────────────────────────────────

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

// ── the assertion ────────────────────────────────────────────────────────────────────────────────

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

// ── severity ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Refusals that mean "there is no live token to disagree with" rather than "something is wrong".
 * A session that was never launched through the entrypoint is a normal session, not a broken one.
 */
export const ADVISORY_CODES = new Set(["NO_TOKEN", "TOKEN_CONSUMED", "TOKEN_EXPIRED"]);

/** One line each — this prints on every session that has no token, so it must not be a wall of text. */
const ADVISORY_LINES = {
  NO_TOKEN: "compy-entry: no launch token — this session was not started through the entrypoint, so its folder, branch and claim are unverified.",
  TOKEN_CONSUMED: "compy-entry: the launch token was already used by an earlier session — this one is unverified.",
  TOKEN_EXPIRED: "compy-entry: the launch token has expired — this session is unverified.",
};

/**
 * @returns {{exit: 0|2, level: "ok"|"advisory"|"stop", message: string}}
 */
export function verdictFor(result) {
  if (result?.ok) {
    return {
      exit: 0,
      level: "ok",
      message: `compy-entry: session root verified — ${result.root} (#${result.issue}, ${result.branch})`,
    };
  }

  if (ADVISORY_CODES.has(result?.code)) {
    return { exit: 0, level: "advisory", message: ADVISORY_LINES[result.code] ?? `compy-entry: ${result.code}` };
  }

  // Everything else — including a code added later and never classified — blocks.
  return {
    exit: 2,
    level: "stop",
    message: [
      "",
      `compy-entry: STOP — ${result?.code ?? "UNKNOWN"}`,
      result?.reason ?? "",
      "",
      "This session does not match the claim it was launched under. Do not write anything.",
      "Close this window and relaunch from the Compy entrypoint.",
      "",
    ].join("\n"),
  };
}

// ── hook entry point ─────────────────────────────────────────────────────────────────────────────

const readStdin = async () => {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export async function main() {
  const hookInput = await readStdin();
  const result = assertSessionRoot({ token: readToken(), env: process.env, hookInput, cwd: process.cwd() });
  const verdict = verdictFor(result);

  if (verdict.level === "ok") consumeToken();
  if (verdict.exit === 0) console.log(verdict.message);
  else console.error(verdict.message);

  return verdict.exit;
}

// Only when invoked directly. Imported — by the shim, by the guards — it must stay inert.
const invokedDirectly = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) process.exit(await main());
