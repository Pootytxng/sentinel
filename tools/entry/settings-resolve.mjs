// Resolve the settings a session will ACTUALLY run with, and say where each value came from.
//
// Why provenance is the deliverable (spec §4.4): "150000" is useless on its own. "150000, from
// C:\Users\Kuya\code\sentinel-workflow\.claude\settings.json" is a remediation line. And because
// .claude/settings.json is tracked branch content (finding 3), the folder you open decides the
// value — so the entrypoint must resolve it deliberately from policy and refuse on disagreement,
// rather than inherit whatever the door happened to be.
//
// The parsing/validation arithmetic is REUSED from scripts/lib/compaction-window.mjs (#16), not
// rebuilt. This module adds the layering and the provenance around it.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DOCUMENTED_FALLBACK_WINDOW,
  resolveCompactionWindow,
} from "../../scripts/lib/compaction-window.mjs";

export const WINDOW_KEY = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** Weakest first. Claude Code applies user < project < local; the process env beats all of them. */
export function settingsFiles({ dir, home = homedir() }) {
  return [
    { layer: "user", path: join(home, ".claude", "settings.json") },
    { layer: "project", path: join(dir, ".claude", "settings.json") },
    { layer: "local", path: join(dir, ".claude", "settings.local.json") },
  ];
}

/**
 * Merge the layers and record, per env key, which file supplied the winning value.
 * @returns {{files, merged, envValues: Record<string,{value: string, source: string, layer: string}>}}
 */
export function resolveSettings({ dir, home = homedir(), env = process.env }) {
  const files = settingsFiles({ dir, home }).map((f) => ({
    ...f,
    exists: existsSync(f.path),
    data: existsSync(f.path) ? readJson(f.path) : null,
  }));

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

/**
 * The effective auto-compaction window, with the file that set it.
 * @returns {{window, source, configured, ignored, file: string|null, layer: string|null}}
 */
export function resolveWindow({ dir, home = homedir(), env = process.env }) {
  const { files, envValues } = resolveSettings({ dir, home, env });

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
    return { ...resolved, file: "process environment", layer: "env" };
  }
  if (resolved.source === "settings") return { ...resolved, file, layer };
  // Fallback: still report the file that TRIED, so an ignored typo is traceable.
  return { ...resolved, file: resolved.ignored.length ? file : null, layer: null, envValues };
}

/**
 * What window this train is supposed to run with — policy, not whichever folder was opened.
 * @returns {{window: number, reason: string, trial: boolean}}
 */
export function intendedWindow(policy, { issue }) {
  const trial = (policy?.trials ?? []).find((t) => (t.issues ?? []).includes(Number(issue)));
  if (trial) {
    return {
      window: trial.window,
      trial: true,
      reason: `issue #${issue} is in the ${trial.window} trial${trial.note ? ` — ${trial.note}` : ""}`,
    };
  }
  const window = policy?.default ?? DOCUMENTED_FALLBACK_WINDOW;
  return { window, trial: false, reason: `default policy window for a non-trial train (#${issue})` };
}

/**
 * Guard 2. Two-sided: too small hides context, too large silently adopts the unaccepted trial
 * window. And an UNCONFIGURED value that coincidentally equals the intended one still fails —
 * 150000 by accident is not 150000 by decision.
 */
export function compareWindow(intended, effective) {
  const expected = intended.window;
  const actual = effective.window;
  const where = effective.file ?? "(nothing configures it)";

  if (!effective.configured) {
    return {
      ok: false,
      expected,
      actual,
      remediation:
        `${WINDOW_KEY} is not configured for this folder — the effective ${actual} is the documented ` +
        `fallback, not a decision. Set ${WINDOW_KEY}="${expected}" in .claude/settings.json ` +
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
