// Verify the session root from INSIDE the session (spec §4.3) — guards 1, 8, 9 and 10.
//
// Everything the launcher checks happens before the session exists, so the launcher's word for its
// own correctness is not evidence. #14 is the proof: every pre-launch value can agree and the
// session can still be running somewhere else. This is the only component that observes the session
// from within it, which is why it is a SessionStart hook — that is where CLAUDE_PROJECT_DIR is
// populated and the payload carries `cwd`.
//
// TWO RECORDS, NOT ONE TOKEN (#23, 2026-07-31). The token used to be single-use: the first
// SessionStart consumed it, and the SessionStart that fires after compaction — same session, same
// folder, same claim, same work — then read a consumed token and announced "this one is unverified".
// Consumption answers "has this token been used before"; a resuming session is asking "am I the
// session that was launched". Only the second question is about correctness. So:
//
//   * the LAUNCH (`launch.json`) is a pending intent, claimed exactly once, by the first session in
//     the folder it names;
//   * the LINEAGE (`sessions\<folderhash>.json`) is what that claim establishes — one record per
//     folder, which any later SessionStart in that same folder may resume until it goes stale.
//
// Resume is not a loosening. Every resume re-verifies root, branch, repository and context window
// against the live machine, which is strictly more than the old contract checked: `token.branch` was
// recorded and never once looked at. And a lineage is not a way in — it names one folder, one branch,
// one repository and one task, and a session that does not match all four is refused however
// legitimately that record was created.
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
// So it STOPS only when a live launch or an established lineage DISAGREES with this session, and
// otherwise says its piece in one line and gets out of the way. Codes nobody classified STOP: an
// unclassified refusal must never become a silent pass.

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

export const TOKEN_DIR = join(process.env.LOCALAPPDATA ?? ".", "CompyEntry");
export const TOKEN_NAME = "launch.json";
export const DEFAULT_TTL_MINUTES = 30;

export const LINEAGE_DIR_NAME = "sessions";
/** A marathon runs all day. The lineage slides forward on every sighting, so this is idle time. */
export const LINEAGE_TTL_MINUTES = 720;

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

/** `Pootytxng/sentinel`, however the remote spells it — https, ssh, with or without `.git`. */
export function normalizeRepo(url) {
  if (!url) return null;
  const parts = String(url)
    .trim()
    .replace(/\.git$/i, "")
    .split(/[/:\\]/)
    .filter(Boolean);
  return parts.length < 2 ? null : parts.slice(-2).join("/").toLowerCase();
}

// ── the launch ───────────────────────────────────────────────────────────────────────────────────

export function makeToken({ issue, folder, branch, window, repo = null, nonce = null, expiresAt = null, now = new Date() }) {
  return {
    issue,
    folder: canonicalizePath(folder),
    branch,
    window,
    repo: normalizeRepo(repo),
    nonce: nonce ?? randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt ?? new Date(now.getTime() + DEFAULT_TTL_MINUTES * 60_000).toISOString(),
    claimedAt: null,
    // Older checkouts still run the single-use hook, which gates on `consumedAt`. Leaving it null on
    // a claimed launch would make every ad-hoc session in every other folder hard-STOP on a token
    // that was never theirs. Kept in step with claimedAt for exactly that reason.
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

/** When this launch was taken up, reading a token an older launcher wrote as well as our own. */
export const claimedAtOf = (token) => token?.claimedAt ?? token?.consumedAt ?? null;

export function claimToken({ dir = TOKEN_DIR } = {}, now = new Date()) {
  const t = readToken({ dir });
  if (!t) return null;
  t.claimedAt = now.toISOString();
  t.consumedAt = t.claimedAt;
  writeToken(t, { dir });
  return t;
}

// ── the lineage ──────────────────────────────────────────────────────────────────────────────────

/** Named by the folder, because the record belongs to the folder — not to the issue or the session. */
export function lineageFile({ root, dir = TOKEN_DIR }) {
  const key = createHash("sha256").update(canonicalizePath(root).toLowerCase(), "utf8").digest("hex");
  return join(dir, LINEAGE_DIR_NAME, `${key.slice(0, 32)}.json`);
}

export function readLineage({ root, dir = TOKEN_DIR }) {
  try {
    return JSON.parse(readFileSync(lineageFile({ root, dir }), "utf8"));
  } catch {
    return null;
  }
}

export function writeLineage(record, { dir = TOKEN_DIR } = {}) {
  const file = lineageFile({ root: record.folder, dir });
  mkdirSync(join(dir, LINEAGE_DIR_NAME), { recursive: true });
  writeFileSync(file, JSON.stringify(record, null, 2));
  return file;
}

export function removeLineage({ root, dir = TOKEN_DIR }) {
  rmSync(lineageFile({ root, dir }), { force: true });
}

/** Deterministic cleanup: a record nobody has been seen under for the lifetime is gone, not lingering. */
export function sweepLineage({ dir = TOKEN_DIR, now = new Date() } = {}) {
  const folder = join(dir, LINEAGE_DIR_NAME);
  if (!existsSync(folder)) return 0;
  let removed = 0;
  for (const name of readdirSync(folder)) {
    if (!name.endsWith(".json")) continue;
    const file = join(folder, name);
    try {
      const record = JSON.parse(readFileSync(file, "utf8"));
      if (record?.expiresAt && new Date(record.expiresAt) < now) {
        rmSync(file, { force: true });
        removed += 1;
      }
    } catch {
      // Unreadable is not the same as expired. Leave it: readLineage already treats it as absent.
    }
  }
  return removed;
}

const lineageFromLaunch = ({ token, root, now }) => ({
  issue: token.issue,
  folder: canonicalizePath(root),
  branch: token.branch,
  window: token.window,
  repo: token.repo ?? null,
  nonce: token.nonce ?? null,
  launchedAt: token.issuedAt ?? null,
  firstSeenAt: now.toISOString(),
  lastSeenAt: now.toISOString(),
  seenCount: 1,
  expiresAt: new Date(now.getTime() + LINEAGE_TTL_MINUTES * 60_000).toISOString(),
});

const touchLineage = (record, now) => ({
  ...record,
  lastSeenAt: now.toISOString(),
  seenCount: (record.seenCount ?? 0) + 1,
  expiresAt: new Date(now.getTime() + LINEAGE_TTL_MINUTES * 60_000).toISOString(),
});

// ── live facts ───────────────────────────────────────────────────────────────────────────────────

const git = (root, args) => {
  try {
    const out = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
};

/**
 * What the folder actually is right now. Null means "could not be observed" — which is disclosed,
 * never assumed to agree.
 */
export function observeLive(root) {
  if (!root) return { branch: null, repo: null };
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return {
    // A detached HEAD has no branch name to compare; mid-rebase is not a wrong folder.
    branch: branch === "HEAD" ? null : branch,
    repo: normalizeRepo(git(root, ["remote", "get-url", "origin"])),
  };
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

const refuse = (code, reason, extra = {}) => ({ ok: false, code, reason, advisory: ADVISORY_CODES.has(code), ...extra });

/** Root, branch, repository and window against one claimed identity. Shared by launch and resume. */
function checkIdentity({ claim, resolved, cwd, env, live, what }) {
  if (!samePath(resolved.root, claim.folder)) {
    // The shell moved and the root did not: relative paths land correctly while settings, hooks and
    // the context window all still come from the other folder. Different failure, different fix.
    if (samePath(cwd, claim.folder)) {
      return refuse(
        "CD_WITHOUT_ROOT",
        `The shell is in the claimed folder but Claude's real project root is ${resolved.root}. ` +
          "Changing directories does not move the project root — settings, hooks and the context window " +
          "still come from the other folder. Reopen the folder as the workspace root instead of cd-ing into it.",
        { expected: claim.folder, actual: resolved.root, root: resolved.root },
      );
    }
    return refuse(
      "ROOT_MISMATCH",
      `${what} ${claim.folder} but this session's root is ${resolved.root}. Stop before writing anything.`,
      { expected: claim.folder, actual: resolved.root, root: resolved.root },
    );
  }

  const liveWindow = Number(env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (claim.window && Number.isFinite(liveWindow) && liveWindow !== claim.window) {
    return refuse(
      "WINDOW_MISMATCH",
      `This session is running with a ${liveWindow} context window; ${what.toLowerCase()} ${claim.window}. ` +
        "The window a session actually got is the only one that counts.",
      { expected: claim.window, actual: liveWindow, root: resolved.root },
    );
  }

  const notes = [];
  if (claim.branch && live?.branch && live.branch !== claim.branch) {
    return refuse(
      "BRANCH_MISMATCH",
      `${what} branch ${claim.branch}, but ${resolved.root} is on ${live.branch}. ` +
        "The branch under the session is the branch the work lands on.",
      { expected: claim.branch, actual: live.branch, root: resolved.root },
    );
  }
  if (claim.branch && !live?.branch) notes.push(`the live branch could not be read (expected ${claim.branch})`);

  if (claim.repo && live?.repo && live.repo !== claim.repo) {
    return refuse(
      "REPO_MISMATCH",
      `${what} the ${claim.repo} repository, but ${resolved.root} points at ${live.repo}.`,
      { expected: claim.repo, actual: live.repo, root: resolved.root },
    );
  }
  if (claim.repo && !live?.repo) notes.push(`the live repository could not be read (expected ${claim.repo})`);

  return { ok: true, notes };
}

/**
 * @returns {{ok: boolean, mode?: "launch"|"resume", code?: string, reason?: string, advisory?: boolean,
 *            expected?: any, actual?: any, root?: string, issue?: any, branch?: any, notes?: string[]}}
 */
export function assertSessionRoot({
  token,
  lineage = null,
  env = process.env,
  hookInput = null,
  cwd = process.cwd(),
  now = new Date(),
  live = null,
}) {
  const resolved = resolveSessionRoot({ env, hookInput, cwd });
  const expiredAt = (iso) => Boolean(iso) && new Date(iso) < now;

  const ours = lineage && resolved.observed && samePath(lineage.folder, resolved.root) && !expiredAt(lineage.expiresAt);
  const pending = Boolean(token) && !claimedAtOf(token) && !expiredAt(token.expiresAt);

  // A launch pending for ANOTHER folder is not this session's business when this folder already has
  // its own established lineage — Kuya starting a second task must not STOP the first one's window.
  // Without a lineage to stand on, a pending launch elsewhere is still a wrong-root refusal.
  const answerToLaunch = pending && (samePath(resolved.root, token.folder) || !ours);

  // ── a launch waiting to be taken up ────────────────────────────────────────────────────────────
  if (answerToLaunch) {
    if (!resolved.observed) {
      return refuse(
        "ROOT_UNOBSERVED",
        "The real project root could not be observed (CLAUDE_PROJECT_DIR unset and no hook payload). " +
          "Inferring it from the working directory is the exact mistake this guard exists to catch, so this fails closed.",
        { root: resolved.root },
      );
    }
    const verdict = checkIdentity({ claim: token, resolved, cwd, env, live, what: "The launch claimed" });
    if (!verdict.ok) return verdict;
    return {
      ok: true,
      mode: "launch",
      root: resolved.root,
      source: resolved.source,
      issue: token.issue,
      branch: token.branch,
      window: token.window,
      repo: token.repo ?? null,
      notes: verdict.notes,
    };
  }

  // ── an established lineage carrying on ─────────────────────────────────────────────────────────
  if (lineage && resolved.observed) {
    if (!samePath(lineage.folder, resolved.root)) {
      return refuse(
        "LINEAGE_FOREIGN",
        `The session record found for ${resolved.root} says it belongs to ${lineage.folder}. ` +
          "A record that has been moved, copied or renamed underneath a folder verifies nothing.",
        { expected: resolved.root, actual: lineage.folder, root: resolved.root },
      );
    }
    if (expiredAt(lineage.expiresAt)) {
      return refuse(
        "LINEAGE_EXPIRED",
        `This folder's session record lapsed at ${lineage.expiresAt} (last seen ${lineage.lastSeenAt}). ` +
          "Relaunch from the entrypoint to verify the folder, branch and claim again.",
        { root: resolved.root },
      );
    }
    const verdict = checkIdentity({ claim: lineage, resolved, cwd, env, live, what: "This folder's session was launched on" });
    if (!verdict.ok) return verdict;
    return {
      ok: true,
      mode: "resume",
      root: resolved.root,
      source: resolved.source,
      issue: lineage.issue,
      branch: lineage.branch,
      window: lineage.window,
      repo: lineage.repo ?? null,
      notes: verdict.notes,
    };
  }

  // ── nothing to check against ───────────────────────────────────────────────────────────────────
  if (token && !claimedAtOf(token) && expiredAt(token.expiresAt)) {
    return refuse("TOKEN_EXPIRED", `The launch token expired at ${token.expiresAt}. Relaunch from the entrypoint.`);
  }
  return refuse(
    "NO_TOKEN",
    "No launch pending for this folder and no session record in it, so nothing verified that its " +
      "folder, branch and settings match a claim. A session with nothing to check is not a verified session.",
  );
}

/**
 * The IO shell: read the records, take the verdict, then persist exactly what the verdict earned.
 * `persist: false` makes it a pure diagnostic — `compy-entry assert` must not claim a launch.
 */
export function verifySession({
  dir = TOKEN_DIR,
  env = process.env,
  hookInput = null,
  cwd = process.cwd(),
  now = new Date(),
  live = null,
  persist = true,
} = {}) {
  const resolved = resolveSessionRoot({ env, hookInput, cwd });
  const token = readToken({ dir });
  const lineage = resolved.observed ? readLineage({ root: resolved.root, dir }) : null;
  const facts = live ?? observeLive(resolved.observed ? resolved.root : null);

  const result = assertSessionRoot({ token, lineage, env, hookInput, cwd, now, live: facts });
  if (!persist) return result;

  if (result.ok && result.mode === "launch") {
    writeLineage(lineageFromLaunch({ token, root: result.root, now }), { dir });
    claimToken({ dir }, now);
  } else if (result.ok && result.mode === "resume") {
    writeLineage(touchLineage(lineage, now), { dir });
  } else if (result.code === "LINEAGE_EXPIRED") {
    removeLineage({ root: resolved.root, dir });
  }
  sweepLineage({ dir, now });

  return result;
}

// ── severity ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Refusals that mean "there is nothing live to disagree with" rather than "something is wrong".
 * A session that was never launched through the entrypoint is a normal session, not a broken one.
 */
export const ADVISORY_CODES = new Set(["NO_TOKEN", "TOKEN_EXPIRED", "LINEAGE_EXPIRED"]);

/** One line each — this prints on every session that has no token, so it must not be a wall of text. */
const ADVISORY_LINES = {
  NO_TOKEN: "compy-entry: no launch token — this session was not started through the entrypoint, so its folder, branch and claim are unverified.",
  TOKEN_EXPIRED: "compy-entry: the launch token has expired — this session is unverified.",
  LINEAGE_EXPIRED: "compy-entry: this folder's session record has lapsed — this session is unverified until you relaunch from the entrypoint.",
};

/**
 * @returns {{exit: 0|2, level: "ok"|"advisory"|"stop", message: string}}
 */
export function verdictFor(result) {
  if (result?.ok) {
    const verb = result.mode === "resume" ? "resumed" : "verified";
    const notes = result.notes?.length ? ` — ${result.notes.join("; ")}` : "";
    return {
      exit: 0,
      level: "ok",
      message: `compy-entry: session ${verb} — #${result.issue} on ${result.branch} in ${result.root}${notes}`,
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

// ── the launch brief ─────────────────────────────────────────────────────────────────────────────
// Reading only. The brief is COMPOSED by tools/entry/brief.mjs, which the launcher runs and which
// re-exports these two; this file is copied alone into folders where tools/entry does not exist, so
// it carries the text rather than deciding what it says.

export const BRIEF_DIR = join(TOKEN_DIR, "briefs");

export function briefFile({ issue, dir = BRIEF_DIR }) {
  return join(dir, `${Number(issue)}.json`);
}

export function readBrief({ issue, dir = BRIEF_DIR }) {
  if (issue === null || issue === undefined) return null;
  try {
    const parsed = JSON.parse(readFileSync(briefFile({ issue, dir }), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * What this SessionStart hands the session — the mechanism that means Kuya never pastes a prompt.
 *
 * `additionalContext` carries the brief and is supplied on EVERY start, so compaction costs the
 * conversation and not the task. `initialUserMessage` opens the work, and only on `startup`: the
 * other sources (compact, resume, clear, fork) are a live conversation restarting, where an injected
 * instruction would arrive as a fresh order from Kuya and throw away what the session was doing.
 *
 * Both fields are the CLI's own documented SessionStart output (validated by 2.1.220), not a
 * side-channel. A refused session gets nothing at all.
 */
export function sessionStartOutput(result, { briefDir = BRIEF_DIR, source = null } = {}) {
  if (!result?.ok) return null;
  const brief = readBrief({ issue: result.issue, dir: briefDir });
  if (!brief?.text) return null;

  const out = { hookEventName: "SessionStart", additionalContext: brief.text };
  if (brief.sessionTitle) out.sessionTitle = brief.sessionTitle;
  const opening = brief.opening?.[result.mode === "resume" ? "resume" : "launch"];
  if (source === "startup" && opening) out.initialUserMessage = opening;
  return out;
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
  const result = verifySession({ env: process.env, hookInput, cwd: process.cwd() });
  const verdict = verdictFor(result);

  if (verdict.exit !== 0) {
    console.error(verdict.message);
    return verdict.exit;
  }

  const payload = sessionStartOutput(result, { source: hookInput?.source ?? null });
  // Plain text when there is no brief: stdout alone is still added to the session, and a folder with
  // no launch of its own must not be handed someone else's instructions.
  if (payload) console.log(JSON.stringify({ systemMessage: verdict.message, hookSpecificOutput: payload }));
  else console.log(verdict.message);

  return 0;
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
