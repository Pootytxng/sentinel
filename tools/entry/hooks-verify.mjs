// Verify that every hook a folder's settings REGISTER actually exists there. Refuse if not.
//
// The defect this catches (finding 4): `.claude/hooks/` is gitignored as "machine-local, not
// shared" while the tracked `.claude/settings.json` wires seven hooks by `$CLAUDE_PROJECT_DIR`
// path. Five of six checkouts therefore run with every hook missing — including a real DENY — and
// nothing announces it. The #14 marathon ran hookless start to finish.
//
// Verify and refuse (owner-approved). Writing hook files into a folder another lane may own is
// mutation, so only `--repair` copies them, and it prints what it will write first.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { resolveSettings } from "./settings-resolve.mjs";

export const HOOKS_SUBDIR = join(".claude", "hooks");

/**
 * Concatenate hook groups per event across settings layers.
 *
 * Claude Code runs every matching hook from every settings file — a local overlay ADDS to the
 * project's hooks, it does not replace them. Replacing here would under-report missing hooks, which
 * is fail-open, the one direction a guard may never fail in. Measured: replacement made
 * `code\sentinel` report 6 registered hooks when it registers 7.
 */
export function mergeHookLayers(layers) {
  const out = {};
  for (const hooks of layers) {
    for (const [event, groups] of Object.entries(hooks ?? {})) {
      out[event] = [...(out[event] ?? []), ...(groups ?? [])];
    }
  }
  return out;
}

/**
 * Every hook command registered across every event and matcher, with the file it points at.
 * `$CLAUDE_PROJECT_DIR` is resolved against the TARGET folder, never the process environment —
 * it was measured unset there (finding 9), which would resolve every path to nonsense.
 */
export function hookCommandsOf(settings, { dir = "" } = {}) {
  const out = [];
  for (const [event, groups] of Object.entries(settings?.hooks ?? {})) {
    for (const group of groups ?? []) {
      for (const hook of group?.hooks ?? []) {
        const command = String(hook?.command ?? "");
        const interpolated = command
          .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, dir)
          .replace(/\$CLAUDE_PROJECT_DIR/g, dir);
        const m = interpolated.match(/"([^"]+\.(?:mjs|js|cjs|ts|ps1|sh|py))"|(\S+\.(?:mjs|js|cjs|ts|ps1|sh|py))/);
        const raw = m ? (m[1] ?? m[2]) : null;
        out.push({
          event,
          matcher: group?.matcher ?? null,
          command,
          file: raw ? join(raw) : null,
          name: raw ? basename(raw) : null,
        });
      }
    }
  }
  return out;
}

/**
 * @returns {{ok, checked: Array, missing: Array, remediation: string|null, dir: string}}
 */
export function verifyHooks({ dir, home = homedir(), env = process.env }) {
  const { files } = resolveSettings({ dir, home, env });
  const settings = { hooks: mergeHookLayers(files.map((f) => f.data?.hooks)) };

  const checked = hookCommandsOf(settings, { dir })
    .filter((c) => c.file !== null)
    .map((c) => ({ ...c, exists: existsSync(c.file) }));
  const missing = checked.filter((c) => !c.exists);

  if (missing.length === 0) return { ok: true, checked, missing: [], remediation: null, dir };

  const names = [...new Set(missing.map((m) => m.name))];
  return {
    ok: false,
    checked,
    missing,
    dir,
    remediation:
      `${missing.length} registered hook${missing.length === 1 ? "" : "s"} do not exist in ${dir}: ` +
      `${names.join(", ")}. These are registered by tracked settings but .claude/hooks/ is gitignored, ` +
      `so they never travel with a branch. Run the launcher with --repair to copy the canonical set ` +
      `from the control folder, or decide with Kuya whether .claude/hooks/ should be tracked.`,
  };
}

/**
 * Copy the canonical hook set into a target folder. Only ever reached via an explicit --repair.
 * Returns what it wrote; with `dryRun` it returns what it WOULD write and touches nothing.
 */
export function repairHooks({ dir, canonicalDir, dryRun = false }) {
  if (!existsSync(canonicalDir)) {
    throw new Error(`Canonical hook set not found at ${canonicalDir}`);
  }
  const target = join(dir, HOOKS_SUBDIR);
  const planned = readdirSync(canonicalDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => ({ from: join(canonicalDir, e.name), to: join(target, e.name), name: e.name }));

  if (dryRun) return { wrote: [], planned, target };

  mkdirSync(target, { recursive: true });
  for (const p of planned) copyFileSync(p.from, p.to);
  return { wrote: planned, planned, target };
}
