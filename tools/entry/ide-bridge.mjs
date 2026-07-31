// The handoff to the editor — proven, never assumed (#23).
//
// The launcher's last job used to be three grey lines ending "Open Claude there and start." That is
// the chore this program deletes, so the launcher now opens the workspace, brings Claude up in it,
// and then PROVES the session arrived before it exits. This module is the proof, and it is built on
// two records that already exist on this machine rather than on anything invented:
//
//   1. `~/.claude/ide/<port>.lock` — written by the Claude Code VS Code extension when it comes up in
//      a window. It carries `{pid, workspaceFolders, ideName, transport}`, so a lock naming our folder
//      whose pid is ALIVE is the editor telling us the workspace is open and the extension is
//      listening. Liveness is not optional: this machine had four lock files and three of them named
//      windows that had been closed for weeks (7, 11 and 21 July). A stale lock is a lie about
//      readiness, and firing the open-URI at one loses the launch silently.
//   2. `launch.json` + the per-folder lineage record — written by the SessionStart hook when a session
//      actually starts and verifies. `claimedAt` becoming non-null says a session took the launch up;
//      the lineage carrying the SAME `nonce` says it was THIS launch, in THIS folder. An older lineage
//      left in the folder by yesterday's run has a different nonce, so a replayed or unrelated session
//      can never be mistaken for the handoff we are waiting for.
//
// What this can and cannot prove, stated honestly: it proves a verified session started in the right
// folder under this exact launch and was handed the brief. It does not prove Claude replied — nothing
// on disk can, and the acceptance journey (guard 15) is what covers that.
//
// The `authToken` in every lock file is a secret. It is dropped at parse time and never returned,
// logged or printed; nothing here needs it, and a bridge helper that carries credentials around in
// its return values is a leak waiting for its first `--json`.
//
// Pure over injected facts wherever it matters: the clock, the sleep, the pid probe and both
// directories are parameters, so the guards drive the waiting loops without waiting.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { TOKEN_DIR, canonicalizePath, claimedAtOf, readLineage, readToken, samePath } from "./session-assert.mjs";

export const IDE_DIR = join(homedir(), ".claude", "ide");

/** VS Code has to start, restore a window and activate an extension. Generous, and still bounded. */
export const BRIDGE_TIMEOUT_MS = 60_000;
/** Claude's own start: the CLI core boots, runs SessionStart, and writes the lineage. */
export const HANDOFF_TIMEOUT_MS = 120_000;
export const POLL_MS = 500;

/**
 * The one supported way to bring the panel up in a window that is already open, taken from the
 * installed extension's own `handleUri` (2.1.220):
 *
 *   case"/open":{let w=x.get("session")??void 0,E=x.get("prompt")??void 0;
 *                Pe.commands.executeCommand("claude-vscode.primaryEditor.open",w,E);return}
 *
 * `prompt=` only PREFILLS the composer — it is never submitted — which is why the task itself travels
 * in the SessionStart hook's `initialUserMessage` and not in this URI. Nothing is appended here for
 * the same reason: a prefilled box Kuya would have to press Enter on is the chore, wearing a costume.
 */
export const OPEN_URI = "vscode://anthropic.claude-code/open";

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One lock file -> what it says, minus the secret.
 * Returns null for anything unreadable or shapeless: an unparseable lock is not evidence of a live
 * editor, and treating it as one is how a launcher hands off into nowhere.
 */
export function parseLock(text, { file = null } = {}) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const pid = Number(raw.pid);
  const folders = Array.isArray(raw.workspaceFolders)
    ? raw.workspaceFolders.filter((f) => typeof f === "string" && f.trim()).map((f) => canonicalizePath(f))
    : [];
  return {
    file,
    port: file ? Number(basename(String(file)).replace(/\.lock$/i, "")) || null : null,
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    folders,
    ideName: typeof raw.ideName === "string" ? raw.ideName : null,
    transport: typeof raw.transport === "string" ? raw.transport : null,
  };
}

/** Every lock the extension has left behind, live or dead — deciding which is `pickBridge`'s job. */
export function readLocks({ dir = IDE_DIR } = {}) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".lock")) continue;
    const file = join(dir, name);
    let lock = null;
    try {
      lock = parseLock(readFileSync(file, "utf8"), { file });
    } catch {
      lock = null;
    }
    if (lock) out.push(lock);
  }
  return out;
}

/**
 * Is that process still there? Signal 0 checks existence without touching the process — on Windows
 * Node maps it to an OpenProcess probe. EPERM means it exists and is not ours to signal, which is
 * still alive; only ESRCH is dead.
 */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/**
 * The live editor bridge for a folder, or a plain reason there is not one yet.
 *
 * Stale locks are reported rather than deleted. They belong to the extension, not to us, and a
 * launcher that quietly prunes another tool's files is exactly the kind of helpfulness this toolchain
 * refuses — the ones on this machine are noted in the details output and left alone.
 */
export function pickBridge(locks, { folder, alive = isAlive } = {}) {
  const want = canonicalizePath(folder);
  const naming = (locks ?? []).filter((l) => l?.folders?.some((f) => samePath(f, want)));
  const live = naming.filter((l) => l.pid !== null && alive(l.pid));
  const stale = naming.filter((l) => !live.includes(l));

  if (live.length > 0) {
    return { ok: true, lock: live[0], live, stale, reason: null };
  }
  return {
    ok: false,
    lock: null,
    live: [],
    stale,
    reason: stale.length
      ? `${stale.length} editor lock${stale.length === 1 ? "" : "s"} name${stale.length === 1 ? "s" : ""} this folder but no window behind ${stale.length === 1 ? "it" : "them"} is running`
      : "no editor window is open on this folder yet",
  };
}

/**
 * Poll a check until it passes or the budget runs out. The clock and the sleep are injected.
 *
 * A check may also answer `stop: true`, meaning "this can never become true by waiting" — a deleted
 * token is not slow, it is gone. Waiting out a two-minute budget for it would turn a clear failure
 * into a hang, which is the same disservice as a wrong success.
 */
export async function waitUntil(check, { timeoutMs, intervalMs = POLL_MS, sleep = sleepReal, clock = () => Date.now() } = {}) {
  const started = clock();
  for (;;) {
    const state = await check();
    const waited = clock() - started;
    if (state?.ok) return { ok: true, waitedMs: waited, state };
    if (state?.stop) return { ok: false, stopped: true, waitedMs: waited, state };
    if (waited >= timeoutMs) return { ok: false, timedOut: true, waitedMs: waited, state };
    await sleep(Math.max(1, Math.min(intervalMs, timeoutMs - waited)));
  }
}

export function bridgeState({ folder, dir = IDE_DIR, alive = isAlive } = {}) {
  return pickBridge(readLocks({ dir }), { folder, alive });
}

export async function waitForBridge({ folder, dir = IDE_DIR, alive = isAlive, timeoutMs = BRIDGE_TIMEOUT_MS, ...rest } = {}) {
  return waitUntil(() => bridgeState({ folder, dir, alive }), { timeoutMs, ...rest });
}

/**
 * Did THIS launch get taken up in THIS folder?
 *
 * Three things have to agree, and the nonce is the one that makes it unfakeable: the token must be
 * claimed, the folder must have a lineage record, and that record must carry the nonce of the token
 * the launcher just wrote. Yesterday's lineage in the same folder has yesterday's nonce, so a resume
 * of some other session cannot pass for the handoff — the same reasoning the assert uses to refuse a
 * replay, applied from the outside.
 */
export function handoffState({ folder, dir = TOKEN_DIR } = {}) {
  const token = readToken({ dir });
  if (!token) {
    return { ok: false, fatal: true, claimedAt: null, lineage: null, reason: "the launch token is gone — something removed it before a session could take it up" };
  }
  const claimedAt = claimedAtOf(token);
  const lineage = readLineage({ root: folder, dir });
  const sameLaunch =
    Boolean(lineage) &&
    Boolean(token.nonce) &&
    lineage.nonce === token.nonce &&
    samePath(lineage.folder ?? "", folder) &&
    Number(lineage.issue) === Number(token.issue);

  if (claimedAt && sameLaunch) {
    return { ok: true, fatal: false, claimedAt, lineage, issue: Number(token.issue), reason: null };
  }
  return {
    ok: false,
    fatal: false,
    claimedAt,
    lineage,
    issue: Number(token.issue),
    reason: !claimedAt
      ? "no session has taken the launch up yet"
      : "a session claimed the launch, but this folder carries no record of it",
  };
}

export async function waitForHandoff({ folder, dir = TOKEN_DIR, timeoutMs = HANDOFF_TIMEOUT_MS, ...rest } = {}) {
  // A missing token can never become present by waiting, so it stops the loop rather than timing out.
  return waitUntil(() => {
    const state = handoffState({ folder, dir });
    return state.fatal ? { ...state, stop: true } : state;
  }, { timeoutMs, ...rest });
}
