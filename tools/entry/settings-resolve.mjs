// Resolve the settings a session will ACTUALLY run with, and say where each value came from.
//
// Why provenance is the deliverable (spec §4.4): "150000" is useless on its own. "150000, from
// C:\Users\Kuya\code\sentinel-workflow\.claude\settings.json" is a remediation line. And because
// .claude/settings.json is tracked branch content (finding 3), the folder you open decides the
// value — so the entrypoint must resolve it deliberately from policy and refuse on disagreement,
// rather than inherit whatever the door happened to be.
//
// TWO sources, because a train can begin before its folder does:
//   - an EXISTING folder resolves from its own layers (user < project < local, then the process env);
//   - a folder that does NOT EXIST YET resolves from the tracked settings of the exact commit it
//     will be created from. It may never resolve from the launcher's own directory — see
//     `resolveWindowFromSnapshot` for the first-launch deadlock that produced (#21).
//
// The parsing/validation arithmetic is REUSED from scripts/lib/compaction-window.mjs (#16), not
// rebuilt. This module adds the layering and the provenance around it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DOCUMENTED_FALLBACK_WINDOW,
  resolveCompactionWindow,
} from "../../scripts/lib/compaction-window.mjs";

export const WINDOW_KEY = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";

/** Repo-relative and forward-slashed on purpose: this is half of a `git show <ref>:<path>` argument. */
export const PROJECT_SETTINGS_PATH = ".claude/settings.json";

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** The machine-wide layer. Named once, because both sources below share it. */
export const userSettingsFile = (home = homedir()) => ({
  layer: "user",
  path: join(home, ".claude", "settings.json"),
});

/** Weakest first. Claude Code applies user < project < local; the process env beats all of them. */
export function settingsFiles({ dir, home = homedir() }) {
  return [
    userSettingsFile(home),
    { layer: "project", path: join(dir, ".claude", "settings.json") },
    { layer: "local", path: join(dir, ".claude", "settings.local.json") },
  ];
}

const onDisk = (f) => ({ ...f, exists: existsSync(f.path), data: existsSync(f.path) ? readJson(f.path) : null });

/** The layers a real folder runs with. */
const diskLayers = ({ dir, home }) => settingsFiles({ dir, home }).map(onDisk);

/** One tracked file out of a commit, no working tree involved. Absent/unreadable/unknown ref -> null. */
function showTrackedFile({ hostDir, ref, path }) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: hostDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/** What the settings of a not-yet-created worktree are named after: one commit, or honestly nothing. */
const snapshotPath = (ref) => (ref ? `${ref}:${PROJECT_SETTINGS_PATH}` : "(no pinned base commit)");

/**
 * The layers a worktree that DOES NOT EXIST YET will run with: the machine-wide user layer, plus the
 * tracked project settings of the exact commit the worktree will be created from. There is no local
 * overlay, because there is no folder to hold one.
 *
 * Fail-closed by construction: an unknown ref, an absent file, or unparseable JSON contributes NO
 * project layer, which resolves to the documented fallback with `configured:false` — a refusal, not
 * a pass. `read` is injected so the guards can drive every one of those without a repository.
 */
export function snapshotLayers({ hostDir, ref, home = homedir(), read = showTrackedFile }) {
  // No pinned base commit — nothing to read, and nothing to guess. `git show null:...` is not a
  // question worth asking; the missing project layer is the refusal (#21).
  const raw = ref ? read({ hostDir, ref, path: PROJECT_SETTINGS_PATH }) : null;
  let data = null;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  return [
    onDisk(userSettingsFile(home)),
    { layer: "project", path: snapshotPath(ref), exists: typeof raw === "string", data },
  ];
}

/**
 * Merge the layers and record, per env key, which file supplied the winning value.
 * @returns {{files, merged, envValues: Record<string,{value: string, source: string, layer: string}>}}
 */
function mergeLayers(files, env) {
  const merged = { env: {}, hooks: {} };
  const envValues = {};
  for (const f of files) {
    if (!f.data) continue;
    for (const [k, v] of Object.entries(f.data.env ?? {})) {
      merged.env[k] = v;
      envValues[k] = { value: String(v), source: f.path, layer: f.layer };
    }
    // Hook groups CONCATENATE across layers — Claude Code runs every matching hook from every
    // settings file. Replacing would hide registrations; see mergeHookLayers in hooks-verify.mjs.
    for (const [event, groups] of Object.entries(f.data.hooks ?? {})) {
      merged.hooks[event] = [...(merged.hooks[event] ?? []), ...(groups ?? [])];
    }
  }
  for (const [k, v] of Object.entries(env ?? {})) {
    if (k in merged.env || k.startsWith("CLAUDE_CODE_")) {
      if (v === undefined) continue;
      merged.env[k] = v;
      envValues[k] = { value: String(v), source: "process environment", layer: "env" };
    }
  }

  return { files, merged, envValues };
}

/** The settings an existing folder runs with. */
export function resolveSettings({ dir, home = homedir(), env = process.env }) {
  return mergeLayers(diskLayers({ dir, home }), env);
}

/** The settings a not-yet-created worktree will run with. Same shape, honest source. */
export function resolveSettingsFromSnapshot({ hostDir, ref, home = homedir(), env = process.env, read }) {
  return mergeLayers(snapshotLayers({ hostDir, ref, home, read }), env);
}

/**
 * The effective auto-compaction window over a set of layers, with the file that set it.
 * @returns {{window, source, configured, ignored, file: string|null, layer: string|null}}
 */
function windowFromLayers(files, env, extra = {}) {
  // Winning FILE layer only — resolveCompactionWindow decides env-vs-settings itself.
  let fileValue;
  let file = null;
  let layer = null;
  for (const f of files) {
    const v = f.data?.env?.[WINDOW_KEY];
    if (v === undefined) continue;
    fileValue = v;
    file = f.path;
    layer = f.layer;
  }

  const resolved = resolveCompactionWindow({
    env: { [WINDOW_KEY]: env?.[WINDOW_KEY] },
    settings: fileValue === undefined ? null : { env: { [WINDOW_KEY]: fileValue } },
  });

  if (resolved.source === "env") {
    return { ...resolved, file: "process environment", layer: "env", ...extra };
  }
  if (resolved.source === "settings") return { ...resolved, file, layer, ...extra };
  // Fallback: still report the file that TRIED, so an ignored typo is traceable.
  return { ...resolved, file: resolved.ignored.length ? file : null, layer: null, ...extra };
}

/** The window an existing folder runs with. */
export function resolveWindow({ dir, home = homedir(), env = process.env }) {
  return windowFromLayers(diskLayers({ dir, home }), env);
}

/**
 * The window a worktree that does not exist yet will run with.
 *
 * Why this exists (bug->guard, #21): the launcher used to substitute its OWN directory for an absent
 * target. `tools/entry/` configures nothing, `origin/main` carries WINDOW_KEY=150000 in tracked
 * settings, and the two collided into "expected 150000, actual 150000" that still REFUSED — because
 * the coincidentally-equal documented fallback is not configuration. A safely-creatable worktree
 * became impossible to create through the entrypoint. The launcher's own directory is not, and never
 * was, the future worktree's effective settings; the commit it will be created from is.
 */
export function resolveWindowFromSnapshot({ hostDir, ref, home = homedir(), env = process.env, read }) {
  return windowFromLayers(snapshotLayers({ hostDir, ref, home, read }), env, { snapshot: snapshotPath(ref) });
}

/**
 * What window this train is supposed to run with — policy, not whichever folder was opened.
 *
 * 300000 is the accepted MARATHON tier (Kuya, 2026-07-31, on #19): accepted, and still not the
 * default. Acceptance renamed the tier and settled its status; it did not widen its scope.
 * @returns {{window: number, reason: string, marathon: boolean}}
 */
export function intendedWindow(policy, { issue }) {
  const tier = (policy?.tiers ?? []).find((t) => (t.issues ?? []).includes(Number(issue)));
  if (tier) {
    return {
      window: tier.window,
      marathon: true,
      reason: `issue #${issue} is scoped to the ${tier.window} marathon tier${tier.note ? ` — ${tier.note}` : ""}`,
    };
  }
  const window = policy?.default ?? DOCUMENTED_FALLBACK_WINDOW;
  return { window, marathon: false, reason: `default policy window for a standard-tier train (#${issue})` };
}

/**
 * Guard 2. Two-sided: too small hides context, too large silently adopts a tier this train was never
 * scoped to. And an UNCONFIGURED value that coincidentally equals the intended one still fails —
 * 150000 by accident is not 150000 by decision.
 */
export function compareWindow(intended, effective) {
  const expected = intended.window;
  const actual = effective.window;
  const where = effective.file ?? "(nothing configures it)";

  if (!effective.configured) {
    const source = effective.snapshot
      ? `${effective.snapshot}, the snapshot this worktree would be created from,`
      : "this folder";
    return {
      ok: false,
      expected,
      actual,
      remediation:
        `${WINDOW_KEY} is not configured in ${source} — the effective ${actual} is the documented ` +
        `fallback, not a decision. Set ${WINDOW_KEY}="${expected}" in ${PROJECT_SETTINGS_PATH} ` +
        `(${intended.reason}).` +
        (effective.ignored?.length
          ? ` An unparseable value was ignored: ${effective.ignored.map((i) => `${i.from}="${i.value}"`).join(", ")}.`
          : ""),
    };
  }

  if (expected === actual) return { ok: true, expected, actual, remediation: null };

  return {
    ok: false,
    expected,
    actual,
    remediation:
      `${WINDOW_KEY} is ${actual} but this train intends ${expected} (${intended.reason}). ` +
      `The value comes from ${where}. Change it there, or route to the folder whose policy matches — ` +
      `do not adopt a different window to make the mismatch go away.`,
  };
}
