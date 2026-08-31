// The seam: given a checkout, decide whether it runs a pre-push hook that can actually gate a
// push -- and if not, say exactly why, with the exact path.
//
// Extracted from scripts/hookspath-fleet-guard.test.mjs so the decision can be exercised against
// throwaway fixture repositories. The previous version could only be tested by looking at the real
// fleet, which meant every negative case would have required DISARMING a real worktree to make the
// test go red. That is a test that breaks the thing it is testing, so those cases were simply never
// written, and the fail-open paths below shipped unproven.
//
// The rule this file exists to enforce: a guard must FAIL when it cannot prove protection. Missing
// evidence is not success. Every `return ""` and every `if (!x) continue` in the old version turned
// "I could not tell" into "fine", which is the one answer a safety check may never give.

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { prePushContractViolations, refusesWhenVerifierMissing } from "./prepush-hook-contract.mjs";

/**
 * Run git and report everything: status, stdout, stderr and spawn failure, kept separate.
 *
 * The old helper was `try { execFileSync(...) } catch { return "" }`, which collapsed FOUR distinct
 * outcomes into one empty string: the key is absent (exit 1, benign), the config is unreadable
 * (permission), the config is malformed (parse error), and git did not run at all (not on PATH,
 * cwd gone). Only the first is safe to ignore, and the caller could not tell which it had.
 */
/**
 * The variables git exports to a hook that redirect WHICH repository a command acts on.
 *
 * Identical to the list .githooks/pre-push unsets, and here for the same reason at one more remove.
 * This file's job is to run git IN WORKTREES OTHER than the one it was started from, and these are
 * the variables whose documented purpose is to decide which repository a git command acts on. The
 * hook already scrubs them before invoking the gate and that scrub stays; this is defence in depth,
 * because on 2026-08-11 a leak of exactly these variables wrote core.bare=true into the real
 * repository three times in one session, and "the caller cleaned up for me" is the assumption
 * that cost.
 *
 * Scoped honestly: what was MEASURED here on 2026-08-31 is that a leaked GIT_DIR does NOT redirect
 * the resolution below -- with GIT_DIR aimed at the main working tree and the cwd in a linked one,
 * `rev-parse --git-path hooks/pre-push` still answered about the linked worktree, because a RELATIVE
 * core.hooksPath follows the working tree. The probe that would have measured a leak from an
 * unrelated repository was denied to the session that wrote this, so no claim is made about it. The
 * scrub stays anyway: it costs one object spread, and removing a redirect you have not proven
 * harmless is the cheaper side of that bet.
 */
export const REDIRECTING_GIT_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_QUARANTINE_PATH",
];

/**
 * The second family, and the one that actually mattered here. Independent review of this lane found
 * the list above incomplete: git 2.55 lets the ENVIRONMENT override config files outright, via
 * `GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`, via the pre-parsed
 * `GIT_CONFIG_PARAMETERS`, and via the file selectors `GIT_CONFIG_GLOBAL`/`_SYSTEM`/`_NOSYSTEM`.
 *
 * That is a live fail-open, not a theoretical one: a `core.hooksPath=.githooks` injected through any
 * of them is read by BOTH commands this file runs, so the inspection certifies a value that exists
 * only inside its own process while the checkout on disk stays unwired. The numbered forms are
 * dynamic, so this is a PREFIX rule -- `GIT_CONFIG_KEY_0`, `_KEY_1`, ... cannot be enumerated.
 * Dropping the whole `GIT_CONFIG*` prefix also takes the ancient `GIT_CONFIG`, which is intended.
 */
export const GIT_CONFIG_ENV_PREFIX = "GIT_CONFIG";

/**
 * process.env minus everything that could change which repository is read or what config it reports.
 * Case-insensitive throughout: Windows environment keys are.
 */
export function scrubbedEnv(env = process.env) {
  const drop = new Set(REDIRECTING_GIT_VARS.map((v) => v.toLowerCase()));
  const prefix = GIT_CONFIG_ENV_PREFIX.toLowerCase();
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => {
      const key = String(k).toLowerCase();
      return !drop.has(key) && !key.startsWith(prefix);
    }),
  );
}

export function gitRaw(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: scrubbedEnv() });
  if (r.error) return { ran: false, status: null, stdout: "", stderr: String(r.error.message ?? r.error) };
  return {
    ran: true,
    status: r.status,
    stdout: String(r.stdout ?? "").trim(),
    stderr: String(r.stderr ?? "").trim(),
  };
}

/**
 * Registered worktrees, main first (git lists the main working tree first, and it is the only one
 * `git worktree remove` cannot delete -- which is what makes it the one safe absolute anchor).
 *
 * Throws rather than returning [] when git cannot answer. An empty list would make every check
 * below pass vacuously, which is the silent-green shape this whole file exists to prevent.
 */
export function listWorktrees(root) {
  const r = gitRaw(["worktree", "list", "--porcelain"], root);
  if (!r.ran || r.status !== 0) {
    throw new Error(
      `cannot enumerate worktrees from ${root}: git ${r.ran ? `exited ${r.status}` : "did not run"}` +
        `${r.stderr ? ` — ${r.stderr}` : ""}`,
    );
  }
  return r.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

const slashes = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");
/** Windows compares paths case-insensitively; POSIX does not. Nothing else about the key changes. */
const key = (p) => (process.platform === "win32" ? slashes(p).toLowerCase() : slashes(p));

/**
 * Is `child` at or below `parent`?
 *
 * The trailing separator is the whole point: a plain `startsWith` says
 * C:/Users/Kuya/code/sentinel-css-separators is inside C:/Users/Kuya/code/sentinel, because one
 * string is a prefix of the other. This repo has ~27 sibling checkouts whose names all begin
 * "sentinel", so that lookalike is not hypothetical here, it is the default case.
 */
export function isInside(child, parent) {
  const c = key(child);
  const p = key(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** Resolve reparse points, junctions and symlinks; fall back to a plain resolve if it is not there. */
const canonical = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
};

const readable = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
};

/**
 * Inspect ONE checkout. Returns `{ path, ok, reason }`; `reason` is empty when ok.
 *
 * `mainRoot` is the main working tree, the only permitted fallback anchor for a checkout that
 * predates .githooks. Pass it canonicalized or not -- it is canonicalized here.
 *
 * `deps.git` exists so a fixture can inject a git that fails on one specific call. Two branches
 * below -- git not running at all, and a resolution failure after a clean config read -- cannot be
 * produced by a healthy git on a healthy repo, and leaving them untested is precisely how the
 * previous version shipped four fail-open paths that nothing had ever exercised.
 */
export function inspectWorktree(wt, mainRoot, deps = {}) {
  const git = deps.git ?? gitRaw;
  const fail = (reason) => ({ path: wt, ok: false, reason });

  const here = canonical(wt);
  const main = canonical(mainRoot);

  // The checkout itself has to be there and be a directory. A registered worktree whose directory
  // is gone is bookkeeping (a pending `git worktree prune`), and no push can originate from it.
  let stat;
  try {
    stat = statSync(here);
  } catch {
    return { path: wt, ok: true, reason: "", absent: true };
  }
  if (!stat.isDirectory()) return fail(`registered as a worktree but is not a directory`);

  // ---- 1. The effective core.hooksPath, with "absent" told apart from "could not read". --------
  const cfg = git(["config", "--get", "core.hooksPath"], here);
  if (!cfg.ran) {
    return fail(`git could not be run here to read core.hooksPath — ${cfg.stderr}`);
  }
  if (cfg.status === 1 && !cfg.stderr) {
    // Exit 1 with nothing on stderr is git's documented "key not found". Every OTHER non-zero exit
    // is a real failure and is handled below.
    return fail(
      `core.hooksPath is not set, so this checkout runs NO pre-push hook.\n` +
        `      wire it:  git -C "${wt}" config --worktree core.hooksPath .githooks`,
    );
  }
  if (cfg.status !== 0) {
    return fail(
      `core.hooksPath is UNINSPECTABLE here — git exited ${cfg.status}${cfg.stderr ? `: ${cfg.stderr}` : ""}.\n` +
        `      a config this guard cannot read is a gate this guard cannot vouch for.`,
    );
  }
  if (!cfg.stdout) {
    return fail(`core.hooksPath is set to an EMPTY value — git will find no hook and say nothing`);
  }

  // ---- 2. Where that actually lands, asked of git rather than recomputed. ----------------------
  const res = git(["rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-push"], here);
  if (!res.ran || res.status !== 0 || !res.stdout) {
    return fail(
      `core.hooksPath is "${cfg.stdout}" but the pre-push path could not be resolved` +
        `${res.stderr ? ` — ${res.stderr}` : ""}`,
    );
  }
  const hook = canonical(res.stdout);

  // ---- 3. A regular file, not merely something that exists. ------------------------------------
  let hookStat;
  try {
    hookStat = statSync(hook);
  } catch {
    return fail(
      `wired to the local gate but runs NO pre-push hook.\n` +
        `      core.hooksPath: ${cfg.stdout}\n` +
        `      resolves to:    ${res.stdout}  (does not exist)`,
    );
  }
  if (!hookStat.isFile()) {
    // existsSync() says yes to a directory. Git will not execute one, and will not say so.
    return fail(
      `pre-push resolves to something that is not a file, so no hook runs.\n` +
        `      resolves to: ${hook}  (${hookStat.isDirectory() ? "a directory" : "not a regular file"})`,
    );
  }

  // ---- 4. Inside a checkout we are entitled to trust. -------------------------------------------
  // Its own tree, or the main working tree as the historical fallback. Anything else is case 1 of
  // this guard's own history: an absolute path into a SIBLING lane, where an ordinary cleanup of an
  // unrelated worktree silently disarms this one.
  const ownHook = join(here, ".githooks", "pre-push");
  const usesOwn = isInside(hook, here);
  const usesMain = isInside(hook, main);
  if (!usesOwn && !usesMain) {
    return fail(
      `pre-push resolves OUTSIDE this checkout and outside the main working tree.\n` +
        `      core.hooksPath: ${cfg.stdout}\n` +
        `      resolves to:    ${hook}\n` +
        `      a hook that lives somewhere else vanishes when that somewhere else does.`,
    );
  }
  if (!usesOwn && usesMain) {
    // The bridge is only legitimate for a checkout that HAS no hook of its own. A checkout that has
    // one and points past it has been redirected, and that is not a bridge, it is a bypass.
    let ownExists = false;
    try {
      ownExists = statSync(ownHook).isFile();
    } catch {
      ownExists = false;
    }
    if (ownExists) {
      return fail(
        `this checkout HAS its own .githooks/pre-push, but core.hooksPath points past it.\n` +
          `      core.hooksPath: ${cfg.stdout}\n` +
          `      resolves to:    ${hook}\n` +
          `      point it at its own:  git -C "${wt}" config --worktree core.hooksPath .githooks`,
      );
    }
  }

  // ---- 5. The right bytes, not merely the right path. -------------------------------------------
  const text = readable(hook);
  if (typeof text !== "string") {
    return fail(`pre-push at ${hook} could not be read — ${text.error}`);
  }
  const violations = prePushContractViolations(text);

  // The fail-closed refusal is required ONLY here: a checkout with no verifier of its own is the
  // exact situation .githooks/pre-push:77-82 was written for. Demanding it everywhere failed 22
  // safe worktrees for being old -- see the note in prepush-hook-contract.mjs.
  let hasVerifier = false;
  try {
    hasVerifier = statSync(join(here, "scripts", "verify-local.ps1")).isFile();
  } catch {
    hasVerifier = false;
  }
  if (!hasVerifier && !refusesWhenVerifierMissing(text)) {
    violations.push(
      `this checkout has no scripts/verify-local.ps1, and the hook does not refuse when it is ` +
        `missing — it needs the \`[ ! -f ... ]\` check and a non-zero exit, so the push is turned ` +
        `away with a sentence instead of a powershell path error`,
    );
  }

  if (violations.length) {
    return fail(
      `the pre-push hook at ${hook} is not a usable gate:\n` +
        violations.map((v) => `        - ${v}`).join("\n") +
        `\n      review it rather than overwriting it — an unexpected hook is evidence, not litter.`,
    );
  }

  return { path: wt, ok: true, reason: "", viaMainFallback: !usesOwn, hasVerifier };
}
