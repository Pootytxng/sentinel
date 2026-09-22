// #488: which folder is a fleet-walking check allowed to BLOCK a push from?
//
// Three resident checks walk every registered worktree on this machine
// (work-control-receipt-preservation, handoff-worktree-truth rule C, hookspath-fleet-guard). Until
// 2026-09-22 a finding in ANY folder failed the push from EVERY lane: on 2026-09-18 that happened
// three times in one hour, from three different worktrees, each one a folder the pushing lane could
// not touch -- a peer's folder belongs to that session, or to the owner (docs/WORK_CONTROL.md, one
// folder one writer). The pre-push gate was machine-wide mutable state, and one lane could take the
// whole repository offline without meaning to.
//
// The rule, in one place so the three checks cannot drift apart on it:
//
//   - a finding in the pushing worktree's OWN folder blocks, exactly as before;
//   - a finding in a PEER folder is a WARN that names the folder and the one-line fix, and the push
//     proceeds. The finding is still measured and still printed on every push -- it is not silenced,
//     it is addressed to the folder that can act on it;
//   - under FLEET MODE (COMPY_FLEET_HYGIENE=1, set by scripts/fleet-hygiene.mjs) every finding in
//     every folder blocks again. The fleet-wide sweep still exists; it runs on purpose, not as a tax
//     on every push.
//
// What this does NOT change: anything a check asserts about the SHARED repository (the common
// .git/config, origin reachability, its own counters). Those are fixable from any folder and stay
// blocking everywhere. The line-endings check walks nothing at the gate and never did; it joins the
// fleet sweep only under fleet mode (see scripts/worktree-line-endings.test.mjs).

import { realpathSync } from "node:fs";

export const FLEET_MODE_VAR = "COMPY_FLEET_HYGIENE";
export const FLEET_MODE_ON = "1";
/** The npm script that runs the fleet-wide blocking sweep; named in every WARN so the reader knows where blocking still lives. */
export const FLEET_HYGIENE_COMMAND = "npm run fleet:hygiene";

/** Fleet mode is one exact value of one variable. Anything else -- unset, "true", "0" -- is the gate. */
export function fleetMode(env = process.env) {
  return env?.[FLEET_MODE_VAR] === FLEET_MODE_ON;
}

/**
 * One comparable key per folder. `git worktree list` prints forward slashes; `process.cwd()` and
 * `import.meta.url` give whatever spelling the launcher used (a lowercase drive letter, a trailing
 * separator, `scripts/..`). Real on-disk casing is read where the folder exists, the spelling is
 * kept as given where it does not, and Windows folds case because git itself does there.
 */
export function folderKey(folder, { platform = process.platform, realpath = realpathSync.native } = {}) {
  let s = String(folder ?? "");
  try {
    s = realpath(s);
  } catch {
    // Not on disk (a pruned worktree, a fixture path in a test): compare the spelling as given.
  }
  s = s.replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? s.toLowerCase() : s;
}

export function sameFolder(a, b, opts) {
  return folderKey(a, opts) === folderKey(b, opts);
}

/**
 * Split a check's findings into the set that fails THIS run and the set that is only reported.
 *
 * `folderOf(finding)` names the folder a finding is about; `own` is the pushing worktree. Both are
 * required and the throws are the point: a caller that forgets either would otherwise get an
 * empty blocking set, which is the silent-green shape every guard in this repo exists to prevent.
 */
export function splitByFolder(findings, { own, folderOf, fleet = fleetMode(), platform, realpath } = {}) {
  if (typeof folderOf !== "function") throw new Error("splitByFolder needs folderOf(finding)");
  if (!own) throw new Error("splitByFolder needs the pushing worktree's own folder");
  if (!Array.isArray(findings)) throw new Error("splitByFolder needs an array of findings, not " + typeof findings);
  const blocking = [];
  const warnings = [];
  for (const finding of findings) {
    if (fleet || sameFolder(folderOf(finding), own, { platform, realpath })) blocking.push(finding);
    else warnings.push(finding);
  }
  return { blocking, warnings, fleet: Boolean(fleet) };
}

/**
 * For a check that must ENTER a folder to judge it (line endings reads every file): which folders
 * does this run judge? Only its own at the gate; every registered one under fleet mode, where an
 * empty list is a broken measurement rather than an empty fleet.
 */
export function foldersToJudge({ own, worktrees, fleet = fleetMode() } = {}) {
  if (!own) throw new Error("foldersToJudge needs the pushing worktree's own folder");
  if (!fleet) return [own];
  if (!Array.isArray(worktrees) || worktrees.length === 0) {
    throw new Error("fleet mode was asked to judge every worktree and was handed none -- a broken measurement, not an empty fleet");
  }
  return [...worktrees];
}

/**
 * The WARN block a check prints for its peer findings, returned as text so a test can read it. Every
 * line a reader needs is here: the check, the folder, the finding, the exact fix, and where the
 * blocking version of the same check lives. Empty when there is nothing to warn about, so a caller
 * can `if (text) console.warn(text)` without printing a header over nothing.
 */
export function peerWarning({ check, warnings, describe, fix = () => "" } = {}) {
  if (!check) throw new Error("peerWarning needs the check's name");
  if (typeof describe !== "function") throw new Error("peerWarning needs describe(finding)");
  if (!Array.isArray(warnings) || warnings.length === 0) return "";
  const lines = [
    `WARN ${check}: ${warnings.length} finding(s) in OTHER worktrees. This push is not blocked by them (#488):`,
  ];
  for (const w of warnings) {
    lines.push(`  ${describe(w)}`);
    const remedy = fix(w);
    if (remedy) lines.push(`      fix: ${remedy}`);
  }
  lines.push(`  Every folder blocks under:  ${FLEET_HYGIENE_COMMAND}`);
  return lines.join("\n");
}
