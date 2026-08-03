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

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ASSERT_HOOK_MARKER } from "./overlay.mjs";
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
          statusMessage: hook?.statusMessage ?? null,
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
export function verifyHooks({ dir, home = homedir(), env = process.env, canonicalDir = null }) {
  const { files } = resolveSettings({ dir, home, env });
  const settings = { hooks: mergeHookLayers(files.map((f) => f.data?.hooks)) };

  const checked = hookCommandsOf(settings, { dir })
    .filter((c) => c.file !== null)
    .map((c) => ({ ...c, exists: existsSync(c.file) }));
  const dead = checked.filter((c) => !c.exists);

  // Existence was the entire health test. A hook file can exist and be an OLD BRANCH's copy, or one
  // edited by hand -- `.claude/hooks/` is gitignored, so nothing else notices -- and it still runs a
  // real ALLOW/DENY. "The path is there" says nothing about what executes. When the canonical set is
  // known, bytes are compared; a divergent hook is a plain refusal and is never silently overwritten,
  // because it may be somebody's deliberate local change.
  const divergent = canonicalDir
    ? checked.filter((c) => {
        if (!c.exists || !c.name) return false;
        const canon = join(canonicalDir, c.name);
        if (!existsSync(canon)) return false;
        try {
          return !readFileSync(c.file).equals(readFileSync(canon));
        } catch {
          return false;
        }
      })
    : [];

  // Our own leftover is not evidence about this folder. The launcher installs the assert overlay by
  // absolute path into the control folder, so when that folder moves the file, the registration it
  // left behind points at nothing — and the verdict runs BEFORE the overlay step, so counting it
  // would refuse every later launch on a defect the launcher created and clears on the same run.
  // That is a deadlock the owner can only leave by hand-editing settings, which is the one thing the
  // single entrypoint exists to prevent. Forgiveness is narrow: our marker, dead file, and OUTSIDE
  // this folder — anything --repair can fix stays a refusal, and an unmarked hook is never ours.
  const stale = dead.filter((c) => c.statusMessage === ASSERT_HOOK_MARKER && !isUnder(c.file, dir));
  const missing = dead.filter((c) => !stale.includes(c));

  if (missing.length === 0 && divergent.length === 0) return { ok: true, checked, missing: [], divergent: [], stale, remediation: null, dir };

  if (missing.length === 0 && divergent.length > 0) {
    return {
      ok: false,
      checked,
      missing: [],
      divergent,
      stale,
      dir,
      remediation:
        `${divergent.length === 1 ? "1 registered hook does" : `${divergent.length} registered hooks do`} not match the versioned control payload ` +
        `(${divergent.map((c) => c.name).join(", ")}). They exist, so they run — but not the code that was reviewed. ` +
        `Restore them from the control folder, or decide with Kuya which copy is right. The launcher will not overwrite them.`,
    };
  }

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
        `main does not reach into it. The launcher restores the canonical set by itself when this is the ` +
        `only thing wrong; bringing the folder forward (merge, rebase, or recreate it from the new main) ` +
        `is the durable fix.`,
    );
  }
  if (foreign.length > 0) {
    parts.push(
      `${count(foreign.length)}, and ${foreign.length === 1 ? "it is" : "they are"} registered by absolute ` +
        `path from outside ${dir}: ${foreign.map((m) => m.file).join(", ")}. The launcher can only restore ` +
        `hooks that belong to this folder (${join(dir, HOOKS_SUBDIR)}), which is not where that registration ` +
        `points, and it is not the launcher's own overlay either (no "${ASSERT_HOOK_MARKER}" marker). Remove ` +
        `that registration from the settings file that adds it, or restore the file it names.`,
    );
  }

  return { ok: false, checked, missing, stale, dir, remediation: parts.join(" ") };
}

/**
 * Copy the canonical hook set into a target folder.
 *
 * `only` narrows it to named files, which is what the automatic repair uses: it writes the files that
 * are MISSING and nothing else. Copying the whole set would overwrite hook files the folder already
 * has, and a folder that carries a locally-edited hook has user work in it — the one thing automatic
 * repair may never quietly replace. Explicit `--repair` still restores the full set, because there a
 * human asked for exactly that.
 *
 * Returns what it wrote; with `dryRun` it returns what it WOULD write and touches nothing.
 */
export function repairHooks({ dir, canonicalDir, dryRun = false, only = null }) {
  if (!existsSync(canonicalDir)) {
    throw new Error(`Canonical hook set not found at ${canonicalDir}`);
  }
  const wanted = only ? new Set(only) : null;
  const target = join(dir, HOOKS_SUBDIR);
  const planned = readdirSync(canonicalDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .filter((e) => !wanted || wanted.has(e.name))
    .map((e) => ({ from: join(canonicalDir, e.name), to: join(target, e.name), name: e.name }));

  if (dryRun) return { wrote: [], planned, target };

  mkdirSync(target, { recursive: true });
  for (const p of planned) copyFileSync(p.from, p.to);
  return { wrote: planned, planned, target };
}

const defaultGit = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Is this file part of the control folder's committed payload, or just something sitting there? */
export function isTracked(file, { git = defaultGit } = {}) {
  try {
    git(dirname(file), ["ls-files", "--error-unmatch", "--", basename(file)]);
    // `ls-files --error-unmatch` answers "is this PATH in the index", and repair then copies whatever
    // bytes are on disk. A tracked file somebody has edited passes that test and its uncommitted
    // content becomes the "versioned control payload" installed into a worktree -- an unreviewed hook
    // running a real ALLOW/DENY, which is the exact thing the tracked-source rule exists to stop.
    // Tracked is not versioned. The working copy has to equal the commit as well.
    git(dirname(file), ["diff", "--quiet", "HEAD", "--", basename(file)]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Can the launcher fix these missing hooks by itself, right now, without touching anything else?
 *
 * The owner's line is "repair missing canonical hooks when provably the versioned control payload and
 * the target are safe to write", and every clause of that is a separate refusal here:
 *
 *   - a hook registered from OUTSIDE the folder is not this folder's to fix (an absolute-path overlay
 *     somebody else installed); copying into `.claude/hooks/` would not even satisfy the registration
 *   - a hook inside the folder but not at `.claude/hooks/<name>` has the same problem: the file we
 *     would write is not the file the settings name, so the repair would "succeed" and change nothing
 *   - a name the canonical set does not carry cannot be restored from it — inventing one is not repair
 *   - a canonical file that is UNTRACKED is not the versioned payload, it is a stray file in the
 *     control folder, and copying strays into a worktree is how an unreviewed hook starts running
 *
 * Anything that fails a clause makes the WHOLE repair refuse rather than repairing the rest. A partial
 * repair leaves the folder still failing verification and the owner still reading a wall of text, with
 * writes already done — worse than the honest refusal, and it spends the one thing refusals protect.
 */
export function hookRepairPlan({ verify, canonicalDir, tracked = isTracked }) {
  const dir = verify?.dir ?? "";
  const missing = verify?.missing ?? [];
  if (missing.length === 0) return { ok: false, needed: false, files: [], reason: "nothing is missing" };

  const foreign = missing.filter((m) => !isUnder(m.file, dir));
  if (foreign.length > 0) {
    return {
      ok: false,
      needed: true,
      files: [],
      reason:
        `${foreign.length === 1 ? "a hook is" : `${foreign.length} hooks are`} registered by absolute path from outside ` +
        `${dir} (${foreign.map((m) => m.file).join(", ")}). That registration is not this folder's to repair, and ` +
        `copying files into ${join(dir, HOOKS_SUBDIR)} would not satisfy it.`,
    };
  }

  const misplaced = missing.filter((m) => !m.name || norm(m.file) !== norm(join(dir, HOOKS_SUBDIR, m.name)));
  if (misplaced.length > 0) {
    return {
      ok: false,
      needed: true,
      files: [],
      reason:
        `${misplaced.map((m) => m.file).join(", ")} ${misplaced.length === 1 ? "is" : "are"} registered from somewhere ` +
        `other than ${join(dir, HOOKS_SUBDIR)}. Repair writes the canonical set into that folder, so it would not put ` +
        `the file where the settings look for it.`,
    };
  }

  if (!existsSync(canonicalDir)) {
    return { ok: false, needed: true, files: [], reason: `the canonical hook set is not at ${canonicalDir}, so there is nothing proven to copy from.` };
  }

  const names = [...new Set(missing.map((m) => m.name))];
  const have = new Set(readdirSync(canonicalDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name));
  const unknown = names.filter((n) => !have.has(n));
  if (unknown.length > 0) {
    return {
      ok: false,
      needed: true,
      files: [],
      reason: `the canonical set in ${canonicalDir} does not carry ${unknown.join(", ")}, so this cannot be repaired from it.`,
    };
  }

  const stray = names.filter((n) => !tracked(join(canonicalDir, n)));
  if (stray.length > 0) {
    return {
      ok: false,
      needed: true,
      files: [],
      reason: `${stray.join(", ")} in ${canonicalDir} ${stray.length === 1 ? "is" : "are"} not tracked by git, so ${stray.length === 1 ? "it is" : "they are"} not the versioned control payload.`,
    };
  }

  return {
    ok: true,
    needed: true,
    files: names,
    reason: null,
    disclosure: `${names.length} hook${names.length === 1 ? " was" : "s were"} missing from ${dir} — copied the versioned ${names.join(", ")} from the control folder.`,
  };
}
