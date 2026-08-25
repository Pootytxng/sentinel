// Verify this session from INSIDE it, against FACTS about the folder it is in (#216, 2026-08-25).
//
// Everything the launcher checks happens before the session exists, so the launcher's word for its
// own correctness is not evidence. This is the only component that observes the session from within
// it, which is why it is a SessionStart hook — that is where CLAUDE_PROJECT_DIR is populated and the
// payload carries `cwd`.
//
// WHAT CHANGED, AND WHY (#216). Verification used to run on a LAUNCH TOKEN: the launcher wrote a
// record naming one folder, one branch and one conversation id, and only that conversation could
// take it up. Two failures follow from that design and both happened on 2026-08-24:
//
//   * the owner opened his real conversation in the right folder, on the right branch, for the right
//     issue — and was refused SESSION_FOREIGN, because the launcher had named a different id;
//   * the session the launcher DID name then died without writing a line, and its record held the
//     folder for twelve hours. `adopt`, the cure the refusal itself printed, refused too.
//
// A token is a thing the launcher HANDED OUT, so it can only ever admit the one session it was
// handed to, and it keeps admitting nobody after that session is gone. So verification no longer
// asks who was launched. It asks what is true:
//
//   1. this folder is a git work tree of THIS repository;
//   2. Work Control names it as the worktree for an issue, and the live branch is the board's
//      branch for that issue;
//   3. no OTHER conversation is live in it.
//
// Any Claude tab in the right folder therefore verifies, with no token and no relaunch. The
// launcher's remaining job is CREATING the folder, not admitting sessions.
//
// THE LEASE IS NOT AN AUTHORIZATION. The per-folder record (`sessions\<folderhash>.json`) survives,
// with exactly one job left: exclusion. It names the conversation currently writing here and the pid
// holding it, so a second writer does not join, and — this is the #216 fix — so a record whose
// process is gone reads as LAPSED instead of as an owner. It admits nobody; it only excludes.
//
// The launch token file survives too, demoted to a launcher-internal handshake: the launcher writes
// it so `compy-entry wait` can learn that a window came up, and so the brief digest reaches the
// session. It cannot verify anyone and it cannot refuse anyone.
//
// WHY IT LIVES HERE (owner decision 2, Issue #18, 2026-07-30). `.claude/hooks/` is the single
// canonical hook source and it is tracked, so this file travels with the branch instead of existing
// on one machine in one folder. Two constraints follow, and both are enforced by
// tools/entry/tracked-hooks.test.mjs rather than by anyone remembering them:
//
//   * It imports `node:` builtins ONLY. `--repair` copies flat files into older branches, so a
//     `lib/` subdirectory would silently not travel and the hook would fail to load in exactly the
//     folders that needed repairing. canonicalizePath/samePath and the board field grammar are
//     therefore duplicated from tools/entry/, and pinned equal to those copies by test — duplicated
//     logic that DRIFTS is one copy calling two folders the same while the other calls them
//     different, which is a wrong root passing for a right one.
//   * tools/entry/session-assert.mjs re-exports this module rather than copying it. One
//     implementation, two entry points.
//
// SEVERITY (owner decision 3). Tracked, this runs in every session in every checkout — including
// sessions in folders no issue claims: an ad-hoc window, Cowork, Codex, a fresh clone, the main
// checkout. There, "no issue claims this folder" is the normal state, not a fault, and blocking
// would break all of them. So it STOPS only when a FACT disagrees with this session, and otherwise
// says its piece in one line and gets out of the way. Codes nobody classified STOP: an unclassified
// refusal must never become a silent pass.

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

export function makeToken({ issue, folder, branch, window, repo = null, nonce = null, sessionId = null, briefHash = null, expiresAt = null, now = new Date() }) {
  return {
    issue,
    folder: canonicalizePath(folder),
    branch,
    window,
    repo: normalizeRepo(repo),
    nonce: nonce ?? randomUUID(),
    // The digest of the brief this launch wrote. `sessionStartOutput` refuses to hand over a brief
    // whose bytes are not these, so a stale or edited file cannot become instructions for a session
    // this record vouches for.
    briefHash,
    // The conversation id the launcher ASSIGNED to the session it is about to start (`--session-id`),
    // so "is this the session I launched" is a question with an answer. Without it, lineage could only
    // ask "is this the same folder", and any later Claude process rooted there inherited the
    // authorization of the one before it.
    sessionId,
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

/**
 * A record that exists but cannot be read is NOT the same as no record.
 *
 * Both used to collapse to null, so a truncated or half-written launch.json under an active launch
 * reached the "nothing to check against" branch and printed the cheerful NO_TOKEN advisory — exit 0,
 * session carries on. The launcher wrote that file precisely so this hook would verify against it;
 * losing it is a reason to stop, not to shrug. `CORRUPT` is returned so the caller can tell the two
 * apart, and every read site treats it as evidence destroyed rather than evidence absent.
 */
export const CORRUPT = Symbol("corrupt-record");

export function readToken({ dir = TOKEN_DIR } = {}) {
  const file = join(dir, TOKEN_NAME);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : CORRUPT;
  } catch {
    return CORRUPT;
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
  const file = lineageFile({ root, dir });
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : CORRUPT;
  } catch {
    return CORRUPT;
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

// ── the board ────────────────────────────────────────────────────────────────────────────────────
// The board is the FACT that says which issue a folder is working, and on which branch. It replaces
// the launch token as the source of that answer, which is the whole of #216: a token is a thing the
// launcher wrote, so only the session the launcher started could ever hold it, and a session that
// died still held it. The board is a thing that is TRUE about the folder, so any session in that
// folder can read it and none of them can consume it.
//
// Read through a short-lived cache because this runs on every SessionStart AND on every project
// write (project-write-assert.mjs asks the same judge). One `gh` call per BOARD_TTL_MINUTES for the
// whole machine is affordable; one per write is not.

export const BOARD_CACHE_NAME = "board.json";
export const BOARD_TTL_MINUTES = 10;
export const PROJECT = { number: 1, owner: "Pootytxng" };
export const REPO = "Pootytxng/sentinel";
export const EXPECTED_REPO = normalizeRepo(REPO);

/**
 * The `Worktree / branch` field grammar, in the subset this file needs: `path @ branch`, several
 * entries joined by ` ; `. Duplicated from tools/entry/worktree-field.mjs on purpose (this file is
 * copied flat by `--repair` and may import nothing but `node:`), and pinned equal to it by
 * tools/entry/writer-contention.test.mjs.
 *
 * The canonical separator is split on LAST so a path containing "@" cannot steal it; the two legacy
 * separators are split on FIRST because a branch routinely contains "/" and a Windows path never
 * contains " / ".
 */
export function parseWorktreeEntries(field) {
  const out = [];
  for (const raw of String(field ?? "").split(" ; ")) {
    const entry = raw.trim();
    if (entry === "" || entry.toLowerCase() === "none") continue;
    let halves = null;
    const at = entry.lastIndexOf(" @ ");
    if (at >= 0) halves = [entry.slice(0, at), entry.slice(at + 3)];
    for (const sep of [" / ", " · "]) {
      if (halves) break;
      const k = entry.indexOf(sep);
      if (k >= 0) halves = [entry.slice(0, k), entry.slice(k + sep.length)];
    }
    if (!halves) continue;
    const folder = canonicalizePath(halves[0]);
    // A trailing parenthetical is board metadata, not part of the branch name.
    const branch = halves[1].trim().replace(/\s*\([^)]*\)$/, "");
    if (!folder || !branch) continue;
    out.push({ folder, branch });
  }
  return out;
}

/** Every (issue, folder, branch) the board currently asserts, flattened out of the items. */
export function boardRows(items) {
  const rows = [];
  for (const item of items ?? []) {
    const issue = Number(item?.number);
    if (!Number.isInteger(issue) || issue <= 0) continue;
    for (const e of parseWorktreeEntries(item["worktree / branch"] ?? item.worktreeBranch ?? "")) {
      rows.push({ issue, folder: e.folder, branch: e.branch, status: item.status ?? null });
    }
  }
  return rows;
}

/** The rows that name THIS folder. More than one is ambiguity, and ambiguity is refused. */
export const rowsFor = (rows, root) => (rows ?? []).filter((r) => samePath(r.folder, root));

const boardCacheFile = ({ dir = TOKEN_DIR } = {}) => join(dir, BOARD_CACHE_NAME);

export function readBoardCache({ dir = TOKEN_DIR } = {}) {
  try {
    const parsed = JSON.parse(readFileSync(boardCacheFile({ dir }), "utf8"));
    return parsed && Array.isArray(parsed.rows) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBoardCache(cache, { dir = TOKEN_DIR } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(boardCacheFile({ dir }), JSON.stringify(cache, null, 2));
  return boardCacheFile({ dir });
}

/**
 * Throw the cached answer away, because something just changed what the answer IS.
 *
 * The cache exists so the write guard can ask the same question on every Write without a `gh` call
 * per keystroke, and ten minutes of staleness is harmless for a board nobody is editing. It is NOT
 * harmless for the launcher: it posts the claim that puts the new worktree on the board and then
 * starts a session in that worktree seconds later. Against a cache written before the claim, that
 * session reads its own brand-new folder as unclaimed. Whoever writes the board clears this.
 */
export function invalidateBoardCache({ dir = TOKEN_DIR } = {}) {
  try {
    rmSync(boardCacheFile({ dir }), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** One `gh` call. Returns null when the board could not be read — which is never "empty board". */
export function fetchBoardRows() {
  try {
    const raw = execFileSync(
      "gh",
      ["project", "item-list", String(PROJECT.number), "--owner", PROJECT.owner, "--format", "json", "--limit", "100"],
      { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const items = JSON.parse(raw).items ?? [];
    return boardRows(items.map((it) => ({ ...it, number: it.content?.number })));
  } catch {
    return null;
  }
}

/**
 * The board, cached. A stale cache is USED and disclosed when the fetch fails — the board saying
 * something ten minutes ago is a fact; having no answer is not, and refusing every write on the
 * machine because GitHub blipped is the outage this guard is supposed to prevent.
 */
export function boardFacts({ dir = TOKEN_DIR, now = new Date(), maxAgeMinutes = BOARD_TTL_MINUTES, fetch = fetchBoardRows } = {}) {
  const cached = readBoardCache({ dir });
  const ageMs = cached?.fetchedAt ? now.getTime() - new Date(cached.fetchedAt).getTime() : null;
  if (cached && ageMs !== null && ageMs >= 0 && ageMs < maxAgeMinutes * 60_000) {
    return { reachable: true, rows: cached.rows, fetchedAt: cached.fetchedAt, stale: false };
  }
  const rows = fetch();
  if (rows) {
    const fresh = { fetchedAt: now.toISOString(), rows };
    try {
      writeBoardCache(fresh, { dir });
    } catch {
      /* a cache that cannot be written is a slow path, not a failure */
    }
    return { reachable: true, rows, fetchedAt: fresh.fetchedAt, stale: false };
  }
  if (cached) return { reachable: true, rows: cached.rows, fetchedAt: cached.fetchedAt ?? null, stale: true };
  return { reachable: false, rows: [], fetchedAt: null, stale: false };
}

// ── liveness ─────────────────────────────────────────────────────────────────────────────────────
// #216: a record must not outlive its process. The lease below records the claiming pid and the
// conversation id; this decides whether the writer that took the folder is still there.
//
// TWO SIGNALS, AND ONLY ONE OF THEM CAN CONDEMN.
//
//   pid       — `process.ppid` at the moment the lease was written, i.e. the Claude process that
//               spawned this hook (settings.json runs it as `node <file>`, so the parent IS the CLI).
//               It can only ever promote a lease to "live". It is never allowed to condemn on its
//               own: if that assumption about the parent were ever wrong, a live session would look
//               dead the instant it was recorded, and the one-writer rule would quietly stop working.
//   transcript— `~/.claude/projects/<mangled folder>/<sessionId>.jsonl`. A conversation that is
//               running writes to it. This is what condemns: cold, or never written at all.
//
// #216's dead claimant had no process AND no transcript. It reads dead here in ~5 minutes instead
// of holding the folder for twelve hours.

export const LIVE_STALE_MINUTES = 30;
/** A session that just started has not flushed a transcript yet. Below this, absence proves nothing. */
export const LIVE_GRACE_MINUTES = 5;
export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

/** @returns {true|false|null} null = no pid to ask about. EPERM means it exists and is not ours. */
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/**
 * When this conversation last wrote to its transcript, or null if it has none.
 * The project folder name is a mangling of the path, so this scans rather than reconstructs it —
 * a reconstruction that drifts with the CLI would silently report every session as dead.
 */
export function transcriptSeenAt(sessionId, { dir = CLAUDE_PROJECTS_DIR } = {}) {
  if (!sessionId || !existsSync(dir)) return null;
  let newest = null;
  for (const name of readdirSync(dir)) {
    try {
      const st = statSync(join(dir, name, `${sessionId}.jsonl`));
      if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      /* not this folder */
    }
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/**
 * @returns {"none"|"live"|"dead"|"unknown"} — "unknown" is not "dead": it falls back to the lease's
 * own clock, which is exactly the pre-#216 behaviour, applied only where nothing could be measured.
 */
export function livenessOf(lease, { alive = null, seenAt = null, now = new Date(), staleMinutes = LIVE_STALE_MINUTES, graceMinutes = LIVE_GRACE_MINUTES } = {}) {
  if (!lease || lease === CORRUPT) return "none";
  const since = seenAt ? now.getTime() - new Date(seenAt).getTime() : null;
  if (since !== null && since < staleMinutes * 60_000) return "live";
  if (alive === true) return "live";
  if (since !== null) return "dead";
  const age = (() => {
    const at = lease.lastSeenAt ?? lease.firstSeenAt ?? lease.adoptedAt ?? null;
    return at ? now.getTime() - new Date(at).getTime() : null;
  })();
  if (age !== null && age > graceMinutes * 60_000) return "dead";
  return "unknown";
}

/** The IO half: measure the two signals for a lease. */
export function observeLiveness(lease, { now = new Date(), projectsDir = CLAUDE_PROJECTS_DIR } = {}) {
  if (!lease || lease === CORRUPT) return { liveness: "none", alive: null, seenAt: null };
  const alive = pidAlive(lease.pid);
  const seenAt = transcriptSeenAt(lease.sessionId, { dir: projectsDir });
  return { liveness: livenessOf(lease, { alive, seenAt, now }), alive, seenAt };
}

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
  if (!root) return { branch: null, repo: null, isWorktree: null };
  const isWorktree = git(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return {
    isWorktree,
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

/**
 * VERIFICATION BY FACTS (#216, owner instruction 2026-08-25).
 *
 * A session is verified when three things are true of the folder it is actually rooted in, and none
 * of them is a thing the launcher handed it:
 *
 *   1. it is a git work tree of THIS repository;
 *   2. the board names it as the worktree for an issue, and the live branch is the board's branch
 *      for that issue;
 *   3. no OTHER conversation is live in it.
 *
 * That is the whole contract. There is no launch token in it, which is the point: a token can only
 * be held by the one session the launcher started, so the owner's own tab — same folder, same
 * branch, same issue — was refused as SESSION_FOREIGN and then locked out for twelve hours by a
 * claimant that had already died. Facts do not have that failure mode. Any Claude tab in the right
 * folder verifies; the launcher's remaining job is creating the folder, not admitting sessions.
 *
 * @returns {{ok: boolean, mode?: "launch"|"resume", code?: string, reason?: string, advisory?: boolean,
 *            expected?: any, actual?: any, root?: string, issue?: any, branch?: any, notes?: string[]}}
 */
export function assertSessionRoot({
  board,
  lease = null,
  live = null,
  env = process.env,
  hookInput = null,
  cwd = process.cwd(),
  now = new Date(),
  leaseLiveness = "unknown",
  sessionId = null,
}) {
  const resolved = resolveSessionRoot({ env, hookInput, cwd });
  const me = sessionId ?? hookInput?.session_id ?? null;
  const notes = [];

  if (lease === CORRUPT) {
    return refuse(
      "LEASE_CORRUPT",
      `${resolved.root} has a writer lease that exists and cannot be read, so there is no way to tell ` +
        "which conversation holds it. Delete it deliberately if it is yours; guessing would be adoption by demolition.",
      { root: resolved.root },
    );
  }

  if (!board || board.reachable === false) {
    return refuse(
      "BOARD_UNREACHABLE",
      "Work Control could not be read, so there is no fact saying which issue this folder is working " +
        "or on which branch. Unreachable is not the same as unclaimed, so nothing is asserted either way.",
      { root: resolved.root },
    );
  }
  if (board.stale) notes.push(`the board answer is cached from ${board.fetchedAt} (the live read failed)`);

  const here = rowsFor(board.rows, resolved.root);

  if (here.length === 0) {
    // The shell moved and the root did not: relative paths land correctly while settings, hooks and
    // the context window all still come from the other folder. Different failure, different fix.
    if (resolved.observed && !samePath(cwd, resolved.root) && rowsFor(board.rows, cwd).length > 0) {
      return refuse(
        "CD_WITHOUT_ROOT",
        `The shell is in a folder the board claims, but Claude's real project root is ${resolved.root}. ` +
          "Changing directories does not move the project root — settings, hooks and the context window " +
          "still come from the other folder. Reopen the folder as the workspace root instead of cd-ing into it.",
        { expected: canonicalizePath(cwd), actual: resolved.root, root: resolved.root },
      );
    }
    return refuse(
      "FOLDER_UNCLAIMED",
      `No issue on Work Control names ${resolved.root} as its worktree, so there is no claim, branch or ` +
        "task to check this session against. A session with nothing to check is not a verified session.",
      { root: resolved.root },
    );
  }

  if (!resolved.observed) {
    return refuse(
      "ROOT_UNOBSERVED",
      "The real project root could not be observed (CLAUDE_PROJECT_DIR unset and no hook payload). " +
        "Inferring it from the working directory is the exact mistake this guard exists to catch, so this fails closed.",
      { root: resolved.root },
    );
  }

  if (here.length > 1) {
    return refuse(
      "FOLDER_AMBIGUOUS",
      `Work Control names ${resolved.root} on more than one issue (#${here.map((r) => r.issue).join(", #")}). ` +
        "Collision rule 4 — unknown means locked: one folder answers to one issue, so fix the board before writing.",
      { actual: here.map((r) => r.issue), root: resolved.root },
    );
  }

  const row = here[0];

  if (!live) {
    return refuse(
      "FACTS_UNOBSERVED",
      `The board says ${resolved.root} is the worktree for #${row.issue}, but nothing measured what the ` +
        "folder actually is. An unmeasured folder is not a verified one.",
      { root: resolved.root, issue: row.issue },
    );
  }
  if (live.isWorktree === false) {
    return refuse(
      "NOT_A_WORKTREE",
      `The board names ${resolved.root} as the worktree for #${row.issue}, but git does not call it a work ` +
        "tree at all — so it has no branch and no remote, and nothing here can be verified.",
      { root: resolved.root, issue: row.issue },
    );
  }
  if (!live.repo) {
    return refuse(
      "REPO_UNREADABLE",
      `The origin of ${resolved.root} could not be read. A folder that cannot say which repository it ` +
        "belongs to has not been verified as this one.",
      { expected: EXPECTED_REPO, actual: null, root: resolved.root, issue: row.issue },
    );
  }
  if (live.repo !== EXPECTED_REPO) {
    return refuse(
      "REPO_MISMATCH",
      `Work Control claims ${resolved.root} for #${row.issue} in ${EXPECTED_REPO}, but that folder points ` +
        `at ${live.repo}.`,
      { expected: EXPECTED_REPO, actual: live.repo, root: resolved.root, issue: row.issue },
    );
  }
  if (!live.branch) {
    return refuse(
      "BRANCH_UNREADABLE",
      `The board puts #${row.issue} on ${row.branch} in ${resolved.root}, but the live branch there could ` +
        "not be read (a detached HEAD, or a rebase in progress). An unknown branch is not a verified one, " +
        "and this session would be writing on it.",
      { expected: row.branch, actual: null, root: resolved.root, issue: row.issue },
    );
  }
  if (live.branch !== row.branch) {
    return refuse(
      "BRANCH_NOT_THE_BOARDS",
      `Work Control puts #${row.issue} on ${row.branch}, but ${resolved.root} is on ${live.branch}. ` +
        "The branch under the session is the branch the work lands on — move the branch, or move the board.",
      { expected: row.branch, actual: live.branch, root: resolved.root, issue: row.issue },
    );
  }

  // ── the one-writer rule ────────────────────────────────────────────────────────────────────────
  // The lease is no longer an authorization — it authorizes nobody and admits nobody. Its only job
  // is exclusion: it names the conversation currently writing here so a second one does not join it.
  const foreign = lease && lease.sessionId && lease.sessionId !== me;
  if (foreign && leaseLiveness === "live") {
    return refuse(
      "WRITER_LIVE",
      `${resolved.root} is already being written by another conversation ` +
        `(session ${String(lease.sessionId).slice(0, 8)}…, still live). One writer per worktree — use a ` +
        "different worktree, or close that one.",
      { expected: me, actual: lease.sessionId, root: resolved.root, issue: row.issue },
    );
  }
  if (foreign && leaseLiveness === "unknown" && !(lease.expiresAt && new Date(lease.expiresAt) < now)) {
    return refuse(
      "WRITER_UNKNOWN",
      `${resolved.root} has a lease held by another conversation (session ${String(lease.sessionId).slice(0, 8)}…) ` +
        "and nothing could measure whether it is still running. Collision rule 4 — unknown means locked.",
      { expected: me, actual: lease.sessionId, root: resolved.root, issue: row.issue },
    );
  }
  if (foreign && leaseLiveness === "dead") {
    notes.push(`took the folder over from session ${String(lease.sessionId).slice(0, 8)}…, whose process is gone`);
  }

  const rawWindow = String(env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? "").trim();
  const window = rawWindow === "" || !Number.isFinite(Number(rawWindow)) ? null : Number(rawWindow);
  if (window === null) notes.push("no context window observed, so none is recorded");

  return {
    ok: true,
    // "launch" is the first start of this conversation in this folder; "resume" is any later one.
    // The distinction only chooses which opening line the brief hands over.
    mode: lease && me && lease.sessionId === me ? "resume" : "launch",
    root: resolved.root,
    source: resolved.source,
    issue: row.issue,
    branch: live.branch,
    window,
    repo: live.repo,
    briefHash: lease && lease.issue === row.issue ? (lease.briefHash ?? null) : null,
    sessionId: me,
    notes,
  };
}

/** The writer lease this verdict earns — the exclusion record, carrying the pid that holds it. */
export function leaseFor(result, { lease = null, now = new Date(), pid = process.ppid, token = null }) {
  const same = lease && lease.sessionId && lease.sessionId === result.sessionId;
  return {
    issue: result.issue,
    folder: canonicalizePath(result.root),
    branch: result.branch,
    window: result.window ?? null,
    repo: result.repo ?? null,
    sessionId: result.sessionId ?? null,
    // #216: the record must not outlive the process. This is what makes a dead claim readable AS dead.
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    // Carried from the launcher's handshake when this start took one up, so the brief digest and the
    // ide-bridge's "did my window come up" question both keep working. Neither admits a session.
    nonce: token?.nonce ?? (same ? (lease.nonce ?? null) : null),
    briefHash: token?.briefHash ?? (same ? (lease.briefHash ?? null) : null),
    launchedAt: token?.issuedAt ?? (same ? (lease.launchedAt ?? null) : null),
    firstSeenAt: same ? (lease.firstSeenAt ?? now.toISOString()) : now.toISOString(),
    lastSeenAt: now.toISOString(),
    seenCount: same ? (lease.seenCount ?? 0) + 1 : 1,
    expiresAt: new Date(now.getTime() + LINEAGE_TTL_MINUTES * 60_000).toISOString(),
  };
}

/**
 * The IO shell: measure the facts, take the verdict, then record exactly what the verdict earned.
 * `persist: false` makes it a pure diagnostic — the write guard asks this on every single write and
 * must not take the folder just by asking about it.
 */
export function verifySession({
  dir = TOKEN_DIR,
  env = process.env,
  hookInput = null,
  cwd = process.cwd(),
  now = new Date(),
  live = null,
  board = null,
  persist = true,
} = {}) {
  const resolved = resolveSessionRoot({ env, hookInput, cwd });
  const lease = resolved.observed ? readLineage({ root: resolved.root, dir }) : null;
  const facts = live ?? observeLive(resolved.observed ? resolved.root : null);
  const rows = board ?? boardFacts({ dir, now });
  const { liveness } = observeLiveness(lease, { now });

  const result = assertSessionRoot({
    board: rows,
    lease,
    live: facts,
    env,
    hookInput,
    cwd,
    now,
    leaseLiveness: liveness,
  });
  if (!persist) return result;

  if (result.ok) {
    // The launch handshake, if one is pending for this folder. It admits nobody — it only lets the
    // launcher's own `wait` learn that a window came up, and carries the brief digest across.
    const token = readToken({ dir });
    const pending =
      token && token !== CORRUPT && !claimedAtOf(token) && samePath(token.folder ?? "", result.root) && !(token.expiresAt && new Date(token.expiresAt) < now)
        ? token
        : null;
    writeLineage(leaseFor(result, { lease: lease === CORRUPT ? null : lease, now, token: pending }), { dir });
    if (pending) claimToken({ dir }, now);
  }
  sweepLineage({ dir, now });

  return result;
}

// ── severity ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Refusals that mean "there is nothing to disagree with" rather than "something is wrong".
 * A folder no issue claims is a normal folder, not a broken one — the main checkout is one.
 *
 * The set stays SPLIT (#125 step 1) because the two halves are not one case and the write guard's
 * cure differs:
 *
 *   UNVERIFIABLE — nothing says what this folder is for. There is no issue and no branch to check
 *                  anything against; the session is not wrong, it is unknown.
 *   LAPSED       — a fact existed and could not be read this time. Retrying is the cure, not adopting.
 */
export const UNVERIFIABLE_CODES = new Set(["FOLDER_UNCLAIMED"]);
export const LAPSED_CODES = new Set(["BOARD_UNREACHABLE"]);
export const ADVISORY_CODES = new Set([...UNVERIFIABLE_CODES, ...LAPSED_CODES]);

/** One line each — this prints on every session in an unclaimed folder, so it must not be a wall. */
const ADVISORY_LINES = {
  FOLDER_UNCLAIMED: "compy-entry: no issue on Work Control claims this folder — its branch and task are unverified.",
  BOARD_UNREACHABLE: "compy-entry: Work Control could not be read — this session is unverified until it can be.",
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
      "This session does not match the facts of the folder it is in. Do not write anything.",
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

  // The brief becomes authoritative context on every start, so it is exactly the kind of file that
  // must not be trusted for merely existing. When the launch bound a digest, the bytes have to match
  // it: a stale brief from an older launch, a half-written one, or an edited one would otherwise
  // arrive as instructions inside a session this record has already vouched for. Nothing bound (a
  // record from before hashes existed) is carried, because there is no claim to contradict.
  // Re-derived from the TEXT, never read off the record. A `hash` field sitting inside the same file
  // it describes is a claim the file makes about itself: edit the text, leave the field, and a
  // stored-field comparison waves it through. The digest has to be computed from the bytes that are
  // about to become context.
  if (result.briefHash && createHash("sha256").update(String(brief.text), "utf8").digest("hex") !== result.briefHash) return null;

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
