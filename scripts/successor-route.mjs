#!/usr/bin/env node
// successor-route — #466: which way does this machine launch the next session?
//
// WHY THIS EXISTS. The owner ordered sessions to stop pasting a HANDOFF BLOCK for him to carry into
// a fresh tab and instead launch the successor themselves. Two routes exist and were measured
// working during #466's own research:
//   - a scheduled-tasks launcher routine (mcp__scheduled-tasks__run_scheduled_task against a
//     manually-created "compy-successor-a"/"-b" task) — a genuinely zero-click new session, success
//     text matching "dispatched as session";
//   - a one-click spawn_task chip (mcp__ccd_session__spawn_task) — the owner still has to click it,
//     but nothing is pasted; success text matches "task_id".
// start_session/hand_off_to_session exist but are gated off for this account today.
//
// A launcher routine is ARMED only when the owner has both created it AND turned on useWorktree.
// That toggle is what makes EACH RUN of the routine start in its own fresh worktree of the repo —
// leave it off and the routine runs in its configured folder, the shared main checkout, where every
// write is refused (SUCCESSOR_PREAMBLE STEP 0 below is what a launched session uses to notice this
// and stop cleanly instead of failing on its first write). enabled defaults to true (a routine the
// owner did not explicitly disable is presumed live); useWorktree defaults to false (a routine the
// owner did not explicitly arm for a worktree cannot write and is therefore not a usable route here).
//
// Pure decision logic (pickRoute) is separated from disk I/O (readLauncherTasks) so the routing
// rules are unit-testable without a real scheduled-tasks store — this machine does not have one yet,
// so the live CLI run recorded in the #466 report is expected to print "chip", not "routine".

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The two routines the owner would name "compy-successor-a"/"-b" if he creates them; anything else
// in a scheduled-tasks.json is a different routine (e.g. a daily digest) and must be ignored here.
const LAUNCHER_IDS = ["compy-successor-a", "compy-successor-b"];

function defaultRoot() {
  return process.env.COMPY_ROUTINE_STORE_ROOT || join(process.env.APPDATA || "", "Claude");
}

/**
 * Read every scheduled task named like a #466 launcher, across every org/project folder under the
 * store root. Fail-safe at every level (missing root, missing org/project dir, unreadable or
 * malformed scheduled-tasks.json): a launcher store that does not exist yet is the EXPECTED state on
 * a machine that has not been provisioned, not an error — it degrades to "no tasks found", which
 * pickRoute turns into the chip route.
 * @param {{root?: string}} [opts] - root defaults to %APPDATA%\Claude, override via
 *   COMPY_ROUTINE_STORE_ROOT (used by tests, and by anyone running this from a non-default profile).
 * @returns {Array<object>} raw task objects for compy-successor-a/-b only
 */
export function readLauncherTasks({ root = defaultRoot() } = {}) {
  const found = [];
  const sessionsDir = join(root, "claude-code-sessions");
  let orgDirs;
  try {
    orgDirs = readdirSync(sessionsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return found; // no store on this machine yet
  }
  for (const org of orgDirs) {
    let projectDirs;
    try {
      projectDirs = readdirSync(join(sessionsDir, org.name), { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const project of projectDirs) {
      const file = join(sessionsDir, org.name, project.name, "scheduled-tasks.json");
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue; // missing or malformed — skip, never throw
      }
      // Real shape (2026-09-18): { scheduledTasks: [...], recordedSkips: {...}, ... } — not a bare
      // array. `.tasks` tolerance is kept in case a differently-shaped store ever uses that key.
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.scheduledTasks)
          ? parsed.scheduledTasks
          : Array.isArray(parsed?.tasks)
            ? parsed.tasks
            : [];
      for (const task of list) {
        if (task && LAUNCHER_IDS.includes(task?.id)) found.push(task);
      }
    }
  }
  return found;
}

// enabled defaults true (absence is not a disable); useWorktree must be explicitly true (absence is
// not an aim). Asymmetric on purpose — see the header comment.
function isArmed(task) {
  return !!task && task.enabled !== false && task.useWorktree === true;
}

/**
 * Pure routing decision: given the tasks a store lookup returned (already filtered to the two known
 * launcher ids, or anything array-shaped with an `id`), which route should this turn take?
 * @param {Array<object>} tasks
 * @returns {{route: "routine"|"chip", routine: string[], why: string}}
 *   routine lists the armed launcher ids, in the fixed a-then-b order, regardless of input order.
 */
export function pickRoute(tasks) {
  const byId = new Map();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (t && typeof t?.id === "string" && !byId.has(t.id)) byId.set(t.id, t);
  }
  const armed = LAUNCHER_IDS.filter((id) => isArmed(byId.get(id)));
  if (armed.length === 0) {
    const present = LAUNCHER_IDS.filter((id) => byId.has(id));
    return {
      route: "chip",
      routine: [],
      why:
        (present.length
          ? `${present.join(", ")} exist but none is armed (enabled, worktree toggle on). Turning the ` +
            "toggle on is owner-only: Routines, the launcher, Edit"
          : "no compy-successor launcher routine exists on this machine") +
        " — spawn_task a one-click chip instead",
    };
  }
  return {
    route: "routine",
    routine: armed,
    why: `${armed.join(", ")} armed — dispatch via mcp__scheduled-tasks__run_scheduled_task`,
  };
}

// The prompt a launched successor actually starts from — it IS the handoff, so it has to say the
// things a pasted block used to say, without anyone pasting it. #466 review: a routine can land a
// successor in the shared main checkout (useWorktree off) where every write is refused, so STEP 0 is
// a self-check the session runs BEFORE trusting anything else here, not after.
export const SUCCESSOR_PREAMBLE = `You are a Compy successor session, launched by a session that finished its part. This prompt IS the handoff; nobody pasted it. If a routine started you, nobody is watching the run: do not stop to ask questions, stop only at owner-bound steps.

STEP 0 — check your folder: run \`git rev-parse --show-toplevel\`. If it prints the shared checkout C:/Users/Kuya/code/sentinel, every write is refused there (the launcher routine's worktree toggle is off). Write nothing: call spawn_task with this whole prompt so the owner gets a one-click worktree session, say that in one line, and stop.
STEP 1 — you inherit no lease. Re-derive state (git, the issue, docs/WORK_CONTROL.md) before trusting anything below, and post your own Ownership claim before any write. Right after it, if \`git config --get core.hooksPath\` prints an absolute path, repoint your own folder: \`git config --worktree core.hooksPath .githooks\`. New app worktrees arrive pinned, and the pin reds every lane's push (#405). Anything owner-bound stops at the owner.
STEP 2 — do the task below.
LAST — end by launching your own successor the same way (\`node scripts/successor-route.mjs\`; if your own launcher routine is still running, use the other one), or write \`Successor: none — <why>\`.

TASK:`;

function main() {
  const { route, routine, why } = pickRoute(readLauncherTasks({}));
  console.log(`route: ${route}`);
  console.log(`why: ${why}`);
  if (routine.length) console.log(`routine: ${routine.join(", ")}`);
  console.log("");
  console.log(SUCCESSOR_PREAMBLE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
