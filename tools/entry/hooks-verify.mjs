// Verify that every hook a folder's settings REGISTER actually exists there. Refuse if not.
//
// The defect this catches (finding 4): `.claude/hooks/` was gitignored as "machine-local, not
// shared" while the tracked `.claude/settings.json` wired seven hooks by `$CLAUDE_PROJECT_DIR`
// path. Five of six checkouts therefore ran with every hook missing — including a real DENY — and
// nothing announced it. The #14 marathon ran hookless start to finish.
//
// Owner decision 2 (Issue #18) fixed the cause: the hooks are tracked now. This check stays anyway,
// and decision 4 says so explicitly — every branch cut before that commit still registers hooks it
// does not have, and merging to `main` does not reach into those checkouts. The class of defect is
// "settings promise a file that is not there", which tracking makes rarer, not impossible.
//
// Verify and refuse (owner-approved). Writing hook files into a folder another lane may own is
// mutation, so only `--repair` copies them, and it prints what it will write first.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { resolveSettings } from "./settings-resolve.mjs";

export const HOOKS_SUBDIR = join(".claude", "hooks");

const norm = (p) => String(p ?? "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** Is this file inside the folder being verified, or does it address somewhere else entirely? */
export function isUnder(file, dir) {
  const f = norm(file);
  const d = norm(dir);
  return f === d || f.startsWith(`${d}\\`);
}

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

  // Two different failures wear the same "hook is missing" face, and they take opposite remedies.
  // A path UNDER this folder means the folder is behind — --repair fixes that. A path outside it is a
  // stale settings.local.json overlay addressed at the control folder, which --repair cannot reach:
  // it writes into <dir>\.claude\hooks\, where that path does not point. Telling the owner to --repair
  // a folder that is already current is a remedy that cannot work, which is worse than none.
  const inside = missing.filter((m) => isUnder(m.file, dir));
  const foreign = missing.filter((m) => !isUnder(m.file, dir));
  const names = (list) => [...new Set(list.map((m) => m.name))].join(", ");
  const count = (n) => `${n} registered hook${n === 1 ? " does" : "s do"} not exist`;

  const parts = [];
  if (inside.length > 0) {
    parts.push(
      `${count(inside.length)} in ${dir}: ${names(inside)}. .claude/hooks/ is tracked now, so a branch ` +
        `that carries this commit carries its hooks — this folder is on an older commit, and merging to ` +
        `main does not reach into it. Run the launcher with --repair to copy the canonical set from the ` +
        `control folder, or bring the folder forward (merge, rebase, or recreate it from the new main).`,
    );
  }
  if (foreign.length > 0) {
    parts.push(
      `${count(foreign.length)}, and ${foreign.length === 1 ? "it is" : "they are"} registered by absolute ` +
        `path from outside ${dir}: ${foreign.map((m) => m.file).join(", ")}. That is a stale ` +
        `.claude\\settings.local.json overlay from an earlier launch, not a folder that is behind — the ` +
        `control folder has since moved the file it points at. Relaunch through the entrypoint, which ` +
        `takes its own overlay back, or delete the "compy-entry:session-assert" block from that file.`,
    );
  }

  return { ok: false, checked, missing, dir, remediation: parts.join(" ") };
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
