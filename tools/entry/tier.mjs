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

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { WINDOW_KEY } from "./settings-resolve.mjs";

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
export function readProjectWindow(dir) {
  const file = join(dir, ".claude", "settings.json");
  if (!existsSync(file)) return null;
  try {
    return windowIn(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Pure: what should happen to the local layer, and why.
 * @returns {{action: "keep"|"write"|"refuse", window: number, reason: string}}
 */
export function planTier({ intended, projectWindow = null, local = { present: false }, record = null }) {
  const want = intended.window;

  if (local.present && !local.ok) {
    return {
      action: "refuse",
      window: want,
      reason: `${LOCAL_SETTINGS_PATH} could not be read as JSON. The launcher will not replace a file it cannot understand — fix or remove it.`,
    };
  }

  const effective = local.present && local.window !== null ? local.window : projectWindow;
  if (effective === want) {
    return {
      action: "keep",
      window: want,
      reason: local.present && local.window !== null
        ? `${LOCAL_SETTINGS_PATH} already sets ${want}`
        : `the tracked settings already configure ${want}`,
    };
  }

  if (!local.present) {
    return { action: "write", window: want, reason: `${intended.reason}; the tracked settings configure ${projectWindow ?? "nothing"}` };
  }

  const ours = Boolean(record?.hash) && record.hash === hashOf(local.text);
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
export function establishTier({ dir, intended, stateDir = TIER_STATE_DIR, home = homedir() }) {
  void home;
  const local = readLocalLayer(dir);
  const plan = planTier({
    intended,
    projectWindow: readProjectWindow(dir),
    local,
    record: readTierRecord({ dir, stateDir }),
  });

  if (plan.action !== "write") {
    return { ...plan, wrote: false, file: local.file, disclosure: plan.action === "refuse" ? plan.reason : null };
  }

  const data = local.present && local.ok ? JSON.parse(local.text) : {};
  data.env = { ...(data.env ?? {}), [WINDOW_KEY]: String(plan.window) };
  const text = `${JSON.stringify(data, null, 2)}\n`;

  mkdirSync(dirname(local.file), { recursive: true });
  writeFileSync(local.file, text);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
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
