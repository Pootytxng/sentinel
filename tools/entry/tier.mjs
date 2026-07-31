// Establish the context tier, instead of only complaining about it (spec §3).
//
// `settings.window` could compare an intended window with an effective one and refuse on
// disagreement — and that is all it could do. A marathon-tier issue in a freshly created worktree
// resolves 150000 from tracked settings (correctly: 150000 is right for every standard train), so
// the launcher refused, forever, and the only way through was for Kuya to set an environment
// variable by hand. Establishment closes that: the launcher writes the intended window into the
// per-machine layer that exists for exactly this purpose.
//
// The whole risk of writing settings is writing over somebody else's. So the launcher only ever
// changes a file it can PROVE it wrote: every write records the exact content hash under
// %LOCALAPPDATA%\CompyEntry\tiers\, and a file whose hash does not match its record is foreign —
// refuse, never overwrite, not even to reach a PASS. `.claude/settings.local.json` is gitignored, so
// this never touches tracked content and never dirties the worktree.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { WINDOW_KEY } from "./settings-resolve.mjs";
import { ASSERT_HOOK_MARKER } from "./overlay.mjs";

export const TIER_STATE_DIR = join(process.env.LOCALAPPDATA ?? ".", "CompyEntry", "tiers");
export const LOCAL_SETTINGS_PATH = ".claude/settings.local.json";

const canonical = (p) => resolve(String(p ?? "")).replace(/[\\/]+$/, "").toLowerCase();
export const hashOf = (text) => createHash("sha256").update(String(text), "utf8").digest("hex");

/** One record per folder, named by the folder — not by the issue: the file belongs to the path. */
export const tierRecordFile = ({ dir, stateDir = TIER_STATE_DIR }) =>
  join(stateDir, `${hashOf(canonical(dir)).slice(0, 32)}.json`);

export const localSettingsFile = (dir) => join(dir, ".claude", "settings.local.json");

export function readTierRecord({ dir, stateDir = TIER_STATE_DIR }) {
  const file = tierRecordFile({ dir, stateDir });
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Forget a folder we no longer own. A record with no file is noise, not evidence. */
export function clearTierRecord({ dir, stateDir = TIER_STATE_DIR }) {
  rmSync(tierRecordFile({ dir, stateDir }), { force: true });
}

const windowIn = (data) => {
  const raw = data?.env?.[WINDOW_KEY];
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
};

/** The window pinned in the process environment, which no settings file can override. */
export const envWindowOf = (env = process.env) => windowIn({ env });

/**
 * Write through a temp file in the same directory, then rename.
 *
 * `rename` over an existing path is atomic on both NTFS and POSIX, so a reader never sees a
 * half-written settings file and a crash mid-write leaves the previous content intact rather than a
 * truncated file the next run would call unreadable and refuse on.
 */
function writeFileAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const ourHookGroup = (g) => (g?.hooks ?? []).length > 0 && (g?.hooks ?? []).every((h) => h?.statusMessage === ASSERT_HOOK_MARKER);

/**
 * Is this file nothing but things only the launcher writes?
 *
 * The sidecar hash proves authorship, and it is still the primary proof — but it cannot be the ONLY
 * one, because two legitimate launcher writers share this file. `establishTier` writes
 * `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW`, and `writeOverlay` then rewrites the same file to merge the
 * marked session-root assert into `hooks.SessionStart`. The overlay does not know about the tier
 * record, so after every single launch the recorded hash described a file that no longer existed.
 * The next tier CHANGE in that folder then read its own work as forgery and refused: "was not
 * written by the launcher". Not a crash window -- the ordinary path, every time.
 *
 * The same mismatch stranded the legacy folders: older launcher runs left a local file carrying only
 * the marked overlay and no tier sidecar at all, and "present with no record" was classified foreign.
 *
 * So ownership is also provable from the content. Both launcher-written shapes are recognisable, and
 * a file containing nothing else is ours no matter what any sidecar says. One key of somebody's own
 * -- any other env var, any unmarked hook, any other top-level key -- and this is false, and the
 * refusal it protects stands unchanged.
 */
export function launcherOwnedOnly(text) {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch {
    return false;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;

  for (const key of Object.keys(data)) {
    if (key === "env") {
      const env = data.env;
      if (env === null || typeof env !== "object" || Array.isArray(env)) return false;
      if (Object.keys(env).some((k) => k !== WINDOW_KEY)) return false;
    } else if (key === "hooks") {
      const hooks = data.hooks;
      if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return false;
      // Only the assert overlay's own event, and only groups carrying our marker.
      if (Object.keys(hooks).some((k) => k !== "SessionStart")) return false;
      const groups = hooks.SessionStart;
      if (!Array.isArray(groups) || !groups.every(ourHookGroup)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** What the local layer currently is: present, readable, and what window it sets. */
export function readLocalLayer(dir) {
  const file = localSettingsFile(dir);
  if (!existsSync(file)) return { present: false, text: null, ok: true, window: null, file };
  const text = readFileSync(file, "utf8");
  try {
    return { present: true, text, ok: true, window: windowIn(JSON.parse(text)), file };
  } catch {
    return { present: true, text, ok: false, window: null, file };
  }
}

/** The window the tracked project layer configures, or null when it configures none. */
/**
 * What the tracked project layer configures.
 *
 * Four different situations used to collapse to the same `null`: the file is absent, the file cannot
 * be read, the file is malformed, and the file is fine but sets no window. Only the last is a real
 * "configures nothing". The other three are missing evidence — and `planTier` then treated the folder
 * as unconfigured and authorised a local override on top of settings it had failed to read.
 *
 * @returns {{window: number|null, readable: boolean, reason: string|null}}
 */
export function readProjectSettings(dir) {
  const file = join(dir, ".claude", "settings.json");
  if (!existsSync(file)) return { window: null, readable: true, reason: null };
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { window: null, readable: false, reason: `${file} could not be read (${String(e?.message ?? e)})` };
  }
  try {
    return { window: windowIn(JSON.parse(text)), readable: true, reason: null };
  } catch {
    return { window: null, readable: false, reason: `${file} is not valid JSON` };
  }
}

/** Back-compat: the number alone, for callers that only ever wanted the number. */
export function readProjectWindow(dir) {
  return readProjectSettings(dir).window;
}

/**
 * Pure: what should happen to the local layer, and why.
 * @returns {{action: "keep"|"write"|"refuse", window: number, reason: string}}
 */
export function planTier({ intended, projectWindow = null, local = { present: false }, record = null, envWindow = null, projectReadable = true, projectReason = null }) {
  const want = intended.window;

  // Missing evidence is not evidence of nothing. An unreadable or malformed tracked settings.json
  // was previously indistinguishable from one that simply sets no window, so the launcher wrote a
  // local override on top of a file whose contents it had failed to read -- and the row PASSED.
  if (!projectReadable) {
    return {
      action: "refuse",
      window: want,
      reason: `${projectReason ?? "the tracked project settings could not be read"}, so the launcher cannot tell what this folder already configures. Fix that file before establishing a tier over it.`,
    };
  }

  // The process environment beats every settings file, so a disagreement there is not ours to
  // settle. Writing the local layer anyway would report a PASS the session then contradicts.
  if (envWindow !== null && envWindow !== want) {
    return {
      action: "refuse",
      window: want,
      reason:
        `${WINDOW_KEY} is ${envWindow} in the process environment, which overrules every settings file. ` +
        `This train intends ${want} (${intended.reason}). Clear it from the environment and launch again.`,
    };
  }

  if (local.present && !local.ok) {
    return {
      action: "refuse",
      window: want,
      reason: `${LOCAL_SETTINGS_PATH} could not be read as JSON. The launcher will not replace a file it cannot understand — fix or remove it.`,
    };
  }

  const effective = envWindow ?? (local.present && local.window !== null ? local.window : projectWindow);
  if (effective === want) {
    return {
      action: "keep",
      window: want,
      reason: envWindow !== null
        ? `${WINDOW_KEY} is already ${want} in the process environment`
        : local.present && local.window !== null
          ? `${LOCAL_SETTINGS_PATH} already sets ${want}`
          : `the tracked settings already configure ${want}`,
    };
  }

  if (!local.present) {
    return { action: "write", window: want, reason: `${intended.reason}; the tracked settings configure ${projectWindow ?? "nothing"}` };
  }

  // Authorship, proven three ways -- and the order matters, because each weaker clause has to give
  // up strictly less than the one above it.
  //
  //   1. the exact bytes we recorded. The strongest, and still the usual case.
  //   2. the window we recorded, in a file holding nothing but launcher-written material. The
  //      overlay rewrites this same file after `establishTier` to merge the marked session-root
  //      assert, which changes the bytes and never the window. Byte equality alone therefore called
  //      the launcher's own folder foreign after every launch that installed the assert.
  //   3. no window at all, in a file holding nothing but launcher-written material. That is a
  //      pre-sidecar folder (overlay-only, written before tier records existed) or an empty stub.
  //      Adopting it takes nothing from anybody, because it configures nothing.
  //
  // What none of them give up: a file that sets a window we did not record is NOT ours, whatever
  // else it contains. That is the owner's own pin, and overwriting it to reach a PASS is exactly the
  // thing this record exists to prevent.
  const bytesRecorded = Boolean(record?.hash) && record.hash === hashOf(local.text);
  const windowRecorded = Boolean(record) && local.window !== null && local.window === record.window && launcherOwnedOnly(local.text);
  const configuresNothing = local.window === null && launcherOwnedOnly(local.text);
  const ours = bytesRecorded || windowRecorded || configuresNothing;
  if (ours) {
    return { action: "write", window: want, reason: `the launcher's own ${LOCAL_SETTINGS_PATH} sets ${local.window ?? "nothing"}; ${intended.reason}` };
  }

  return {
    action: "refuse",
    window: want,
    reason:
      `${LOCAL_SETTINGS_PATH} sets ${local.window ?? "no window"} and was not written by the launcher, so it is not the launcher's to change. ` +
      `This train intends ${want} (${intended.reason}). Change that file yourself, or move it aside.`,
  };
}

/**
 * Do it. Writes at most one gitignored file and one record; never touches tracked content.
 * @returns {{action, window, wrote: boolean, file: string, reason: string, disclosure: string|null}}
 */
export function establishTier({ dir, intended, stateDir = TIER_STATE_DIR, home = homedir(), env = process.env }) {
  void home;
  const local = readLocalLayer(dir);
  const project = readProjectSettings(dir);
  const plan = planTier({
    intended,
    projectWindow: project.window,
    projectReadable: project.readable,
    projectReason: project.reason,
    local,
    record: readTierRecord({ dir, stateDir }),
    envWindow: envWindowOf(env),
  });

  if (plan.action !== "write") {
    return { ...plan, wrote: false, file: local.file, disclosure: plan.action === "refuse" ? plan.reason : null };
  }

  const data = local.present && local.ok ? JSON.parse(local.text) : {};
  data.env = { ...(data.env ?? {}), [WINDOW_KEY]: String(plan.window) };
  const text = `${JSON.stringify(data, null, 2)}\n`;

  writeFileAtomic(local.file, text);
  writeFileAtomic(
    tierRecordFile({ dir, stateDir }),
    `${JSON.stringify({ dir, window: plan.window, hash: hashOf(text), wroteAt: new Date().toISOString() }, null, 2)}\n`,
  );

  return {
    ...plan,
    wrote: true,
    file: local.file,
    disclosure: `set the context window to ${plan.window} for this folder (${LOCAL_SETTINGS_PATH}, per-machine, not tracked)`,
  };
}

/**
 * Re-record the hash after another launcher step legitimately rewrote the same file.
 *
 * `writeOverlay` merges the session-root assert into `.claude/settings.local.json` AFTER
 * `establishTier` wrote the window into it. Both are the launcher. Only one of them keeps the
 * record, so without this the sidecar is stale from the moment a launch finishes.
 *
 * `launcherOwnedOnly` already stops that staleness from stranding the owner, but leaving a knowingly
 * wrong hash on disk would mean the strong proof silently degrades to the weak one on every folder.
 * Re-stamping keeps the exact-hash path load-bearing.
 *
 * Narrow on purpose: it re-stamps only a record that already exists for this folder, and only while
 * the window it recorded is still the window on disk. A changed window is not a re-stamp, it is an
 * adoption, and laundering somebody else's edit into our record is the one thing the record exists
 * to prevent.
 */
export function restampTier({ dir, stateDir = TIER_STATE_DIR }) {
  const record = readTierRecord({ dir, stateDir });
  if (!record?.hash) return { restamped: false, reason: "no tier record for this folder" };

  const local = readLocalLayer(dir);
  if (!local.present || !local.ok) return { restamped: false, reason: `${LOCAL_SETTINGS_PATH} is missing or unreadable` };
  if (record.hash === hashOf(local.text)) return { restamped: false, reason: "the record already matches" };
  if (local.window !== record.window) {
    return { restamped: false, reason: `${LOCAL_SETTINGS_PATH} now sets ${local.window ?? "no window"}, not the recorded ${record.window} -- not ours to re-stamp` };
  }

  writeFileAtomic(
    tierRecordFile({ dir, stateDir }),
    `${JSON.stringify({ ...record, hash: hashOf(local.text), restampedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return { restamped: true, reason: null };
}
