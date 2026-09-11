// PreToolUse(Agent) + PostToolUse(Agent) hook -- the shared core.hooksPath stays relative (#362, P0-H).
//
// Measured 2026-09-03 during the parallel pilot: the Claude Code harness, creating a worktree for an
// Agent call with `isolation: "worktree"`, rewrote the SHARED git config's core.hooksPath to an
// ABSOLUTE path (C:\Users\Kuya\code\sentinel\.githooks) -- at 11:27:32Z, in the middle of this lane's
// pre-push gate. scripts/hookspath-fleet-guard.test.mjs then failed in that gate, correctly: an
// absolute hooksPath aims every registered worktree at ONE checkout's hooks, and a worktree whose
// branch lacks that file runs no gate at all. True positive for the guard, false red for the lane
// whose push had nothing to do with it. A second, minimal isolation agent flipped it again after
// the repair, which is what made it a harness behaviour and not a one-off.
//
// Two layers, because the flip happens inside the harness where no hook runs:
//   PreToolUse  -- an Agent call asking for `isolation: "worktree"` is DENIED. Its worktree could
//                  not write anyway (the folder-ownership hooks treat it as a sibling zone), and
//                  its creation reds every concurrent gate on this machine.
//   PostToolUse -- after any Agent call, the shared config is read back; an absolute core.hooksPath
//                  is restored to `.githooks` and the restoration is said out loud. This is the
//                  belt for the harness paths the deny cannot see (EnterWorktree, a future flag).
//
// Fails OPEN on every read error: this hook must never be the reason a legitimate build stalls.
// It is a guard for one narrow, measured mistake.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const RELATIVE_HOOKS = ".githooks";

/** Windows drive paths, UNC paths and POSIX roots all count as absolute; git accepts each. */
export function isAbsoluteHooksPath(value) {
  const v = String(value ?? "").trim();
  if (!v) return false;
  return isAbsolute(v) || /^[A-Za-z]:[\\/]/.test(v) || v.startsWith("\\\\") || v.startsWith("/");
}

/** PreToolUse: only an isolation worktree is refused; every other Agent call is not this hook's. */
export function decideAgent(toolInput) {
  const isolation = String(toolInput?.isolation ?? "").toLowerCase();
  if (isolation !== "worktree") return { deny: false };
  return {
    deny: true,
    reason:
      "Blocked: Agent isolation \"worktree\" makes the harness rewrite the SHARED core.hooksPath to an " +
      "absolute path, which reds scripts/hookspath-fleet-guard.test.mjs in every pre-push gate running on " +
      "this machine (measured 2026-09-03, #362 case 12). The worktree could not write here anyway: the " +
      "ownership hooks treat it as a sibling checkout. Run the agent in this folder without isolation.",
  };
}

/** What the PostToolUse repair should do, from the values the shared config holds right now. */
export function repairPlan(values) {
  const absolute = (values ?? []).filter(isAbsoluteHooksPath);
  return { absolute, fix: absolute.length > 0 };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** Read every core.hooksPath the shared config holds. `[]` when unset; null when git cannot answer. */
export function readSharedHooksPath(cwd) {
  try {
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    const file = `${common}/config`;
    let out = "";
    try {
      out = git(["config", "--file", file, "--get-all", "core.hooksPath"], cwd);
    } catch {
      return { file, values: [] }; // exit 1 = key absent, which is a value, not a failure
    }
    return { file, values: out.split(/\r?\n/).filter(Boolean) };
  } catch {
    return null;
  }
}

/** Restore the shared value to the relative path. Returns what was replaced, or null on failure. */
export function restoreSharedHooksPath(cwd, { read = readSharedHooksPath, run = git } = {}) {
  const shared = read(cwd);
  if (!shared) return null;
  const plan = repairPlan(shared.values);
  if (!plan.fix) return { restored: false, file: shared.file, values: shared.values };
  try {
    run(["config", "--file", shared.file, "--replace-all", "core.hooksPath", RELATIVE_HOOKS], cwd);
    return { restored: true, file: shared.file, was: plan.absolute };
  } catch {
    return null;
  }
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return;
  }
  const event = String(input?.hook_event_name ?? "");
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (event === "PreToolUse") {
    const verdict = decideAgent(input?.tool_input);
    if (!verdict.deny) return;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason },
      }) + "\n",
    );
    return;
  }

  if (event === "PostToolUse") {
    const result = restoreSharedHooksPath(cwd);
    if (!result?.restored) return;
    process.stdout.write(
      JSON.stringify({
        systemMessage:
          `hookspath-guard: the shared core.hooksPath was absolute (${result.was.join(", ")}) after this Agent call ` +
          `and has been restored to ${RELATIVE_HOOKS}. Any pre-push gate that ran meanwhile may have failed ` +
          `scripts/hookspath-fleet-guard.test.mjs for this reason alone -- re-run it.`,
      }) + "\n",
    );
  }
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (entry && import.meta.url.endsWith(entry.slice(entry.lastIndexOf("/")))) main();
