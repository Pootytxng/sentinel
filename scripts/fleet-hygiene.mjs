// #488: the fleet-wide sweep, run on purpose.
//
// The pre-push gate judges the pushing worktree and only WARNS about the others (scripts/lib/
// fleet-scope.mjs has the rule and the reason). This is where the blocking version of the same four
// checks lives: it runs exactly those test files with COMPY_FLEET_HYGIENE=1, under which every
// finding in every registered worktree fails, and exits with vitest's status. A lane runs it before
// a handoff, the owner runs it when the machine feels cluttered, the weekly coordination audit may
// run it read-only -- nobody pays for it on every push.
//
//   node scripts/fleet-hygiene.mjs        (or: npm run fleet:hygiene)
//
// It is deliberately a thin wrapper and not a fifth implementation: the checks stay the tests, so
// the sweep and the gate cannot disagree about what a finding is. What this file owns is the LIST
// of checks, the environment that flips them, and the exit code -- and scripts/fleet-hygiene.test.mjs
// pins that every listed check actually reads the flag, so one cannot quietly fall out of the sweep.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FLEET_MODE_ON, FLEET_MODE_VAR } from "./lib/fleet-scope.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The four checks the sweep runs. Order is the issue's order; it carries no meaning. */
export const FLEET_CHECKS = Object.freeze([
  "scripts/work-control-receipt-preservation.test.mjs",
  "scripts/worktree-line-endings.test.mjs",
  "scripts/handoff-worktree-truth.test.mjs",
  "scripts/hookspath-fleet-guard.test.mjs",
]);

/** The exact command: the repo's own vitest runner (drive-letter casing and NODE_ENV handled there), the four files, nothing else. */
export function hygieneArgv({ node = process.execPath } = {}) {
  return { command: node, args: ["scripts/run-vitest.mjs", "run", ...FLEET_CHECKS] };
}

/** The child's environment: the caller's, plus the one flag. Nothing is removed and nothing else is added. */
export function hygieneEnv(env = process.env) {
  return { ...env, [FLEET_MODE_VAR]: FLEET_MODE_ON };
}

/** Run the sweep; returns the exit status. A spawn that produced no status (signal, ENOENT) is a failure, never a pass. */
export function runHygiene({ cwd = ROOT, env = process.env, spawn = spawnSync, node } = {}) {
  const { command, args } = hygieneArgv({ node });
  const result = spawn(command, args, { cwd, env: hygieneEnv(env), stdio: "inherit" });
  if (result?.error) {
    console.error(`fleet-hygiene: could not start ${command}: ${result.error.message ?? result.error}`);
    return 1;
  }
  return typeof result?.status === "number" ? result.status : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`fleet-hygiene: ${FLEET_MODE_VAR}=${FLEET_MODE_ON} -- every finding in every registered worktree blocks.`);
  process.exit(runHygiene());
}
