// One launcher at a time (spec §8, finding 2).
//
// Double-clicking a shortcut twice is a normal thing a person does — the first click looks like it
// did nothing, so you click again. Nothing stopped that. Both runs passed preflight, both posted or
// renewed the same claim, and both wrote `%LOCALAPPDATA%\CompyEntry\launch.json`, which is a
// SINGLETON: the second overwrote the first's nonce. Then both handoff waiters read whichever token
// was current, so one session could take up the other's launch, and the other waited out its whole
// budget for a launch whose record had been replaced.
//
// The lock is held from selection through handoff, because that is the whole span in which the
// singleton is live. A second run must do ZERO writes and say one calm sentence — it is not an error
// that Kuya clicked twice, and treating it as one teaches him to ignore the launcher.
//
// Staleness is proven, never assumed. A crashed run leaves its lock behind, and a lock that outlives
// its process would make the shortcut permanently dead — which is worse than the race it prevents.
// So a lock is stale when its process is gone, or when it is older than any launch could legitimately
// take. Both are measurements, not timeouts hoped to be long enough.

import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, closeSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { entryStateDir } from "./session-assert.mjs";

// The lock lives with the token it protects, resolved by the one resolver that answers for the
// store (#440). This read `join(process.env.LOCALAPPDATA ?? ".", "CompyEntry")`, and on a POSIX
// session with that Windows variable unset the expression is RELATIVE — so the lock's path depended
// on the caller's cwd, which is not a lock at all: two runs started from two folders would each
// create their own, each believe it was first, and overwrite the singleton this file exists to
// protect. Windows is byte-identical to the old expression, so a live lock keeps resolving.
export const LOCK_DIR = entryStateDir();
export const LOCK_NAME = "launcher.lock";
export const lockFile = ({ dir = LOCK_DIR } = {}) => join(dir, LOCK_NAME);

/** Longer than a real launch (worktree + npm-free preflight + a 90s handoff wait), short enough that
 *  a crash does not leave the shortcut dead for the rest of the day. */
export const MAX_LOCK_MINUTES = 10;

/**
 * Is that process still there? Same probe the IDE bridge uses: signal 0 touches nothing, and EPERM
 * means it exists and is not ours to signal — which is still alive. Only ESRCH is dead.
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
 * Pure: given the lock already on disk, may this run proceed?
 *
 * @returns {{action: "take"|"steal"|"wait", reason: string|null, holder: object|null}}
 */
export function planAcquire(existing, { now = new Date(), alive = isAlive, maxMinutes = MAX_LOCK_MINUTES } = {}) {
  if (!existing) return { action: "take", reason: null, holder: null };

  // A lock we cannot read is not a lock we may ignore, but it is also not evidence of a live run.
  // Age is the only fact left, and an unreadable lock has no age — so it is taken, and the taking is
  // recorded. Refusing forever on a corrupt byte would be the dead-shortcut failure again.
  if (typeof existing !== "object" || !Number.isInteger(existing.pid)) {
    return { action: "steal", reason: "the previous lock could not be read, so it cannot describe a running launch", holder: null };
  }

  if (!alive(existing.pid)) {
    return { action: "steal", reason: `the launcher that held it (pid ${existing.pid}) is gone`, holder: existing };
  }

  const startedAt = Date.parse(existing.startedAt ?? "");
  const ageMin = Number.isFinite(startedAt) ? (now.getTime() - startedAt) / 60_000 : Infinity;
  if (ageMin > maxMinutes) {
    return {
      action: "steal",
      reason: `it has been held for ${Math.round(ageMin)} minutes, longer than any launch takes`,
      holder: existing,
    };
  }

  return {
    action: "wait",
    reason: existing.issue ? `Compy is already starting #${existing.issue}.` : "Compy is already starting.",
    holder: existing,
  };
}

export function readLock({ dir = LOCK_DIR } = {}) {
  const file = lockFile({ dir });
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Take the lock, or report who has it. Writes nothing when the answer is "wait".
 *
 * `wx` makes the create-or-fail atomic, so two runs racing for a folder with no lock cannot both
 * believe they created it. The stale path deliberately does NOT use `wx`: it has already proven the
 * previous holder is gone, and re-racing at that point would be the same bug one layer down.
 */
export function acquire({ dir = LOCK_DIR, issue = null, pid = process.pid, now = new Date(), alive = isAlive } = {}) {
  mkdirSync(dir, { recursive: true });
  const record = { pid, issue, startedAt: now.toISOString() };
  const file = lockFile({ dir });

  try {
    const fd = openSync(file, "wx");
    writeFileSync(fd, JSON.stringify(record, null, 2));
    closeSync(fd);
    return { ok: true, stole: false, reason: null, holder: null, record };
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
  }

  const plan = planAcquire(readLock({ dir }), { now, alive });
  if (plan.action === "wait") return { ok: false, stole: false, reason: plan.reason, holder: plan.holder, record: null };

  writeFileSync(file, JSON.stringify(record, null, 2));
  return { ok: true, stole: true, reason: plan.reason, holder: plan.holder, record };
}

/** Give it back. Only ours: a lock another pid now holds is not this run's to remove. */
export function release({ dir = LOCK_DIR, pid = process.pid } = {}) {
  const held = readLock({ dir });
  if (!held || held.pid !== pid) return false;
  rmSync(lockFile({ dir }), { force: true });
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const argOf = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const pid = argOf("--pid") ? Number(argOf("--pid")) : process.pid;

  if (argv[0] === "release") {
    console.log(JSON.stringify({ released: release({ pid }) }));
    process.exit(0);
  }

  const issue = argOf("--issue") ? Number(argOf("--issue")) : null;
  let r;
  try {
    r = acquire({ issue, pid });
  } catch (e) {
    // A lock that cannot be taken for an unexpected reason must not silently license a second run.
    r = { ok: false, reason: `the launcher lock could not be taken: ${String(e.message ?? e)}`, holder: null };
  }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 2);
}
