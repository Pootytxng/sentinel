// `--repair`: the ONLY path that writes hook files into a worktree.
//
// The default is verify-and-refuse (owner-approved). Repair exists because a folder whose tracked
// settings register seven hooks, five of which include a real DENY, cannot honestly be launched
// into while none of them exist — but writing into a folder another lane may own is mutation, so it
// takes an explicit flag and it announces every file before writing it.
//
// Kuya took the tracking decision this file used to defer (owner decisions 2 and 4, Issue #18,
// 2026-07-30): `.claude/hooks/` is now the single canonical source AND it is tracked, so the hooks
// travel with the branch. Repair still exists, and both halves matter — every branch that predates
// that commit still carries settings registering hooks it does not have, and merging to `main` does
// not reach into those checkouts. Repair is how they are brought forward, one explicit flag at a time.
//
// The payload copy at tools/entry/hooks/ is gone. Two canonical sources is none: the day they differ,
// repair writes the stale one into a folder and the drift is invisible precisely because a file IS
// present. Repair now copies the same set this branch runs on.
//
// One constraint follows and it is not cosmetic: repairHooks copies FLAT FILES only, so a hook that
// imports from a subdirectory would arrive broken in the folders that most needed repairing. The
// hooks stay self-contained; tracked-hooks.test.mjs enforces it for the assert.

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HERE, readBoard } from "./gather.mjs";
import { repairHooks, verifyHooks } from "./hooks-verify.mjs";
import { parseWorktreeField } from "./worktree-field.mjs";

export const CANONICAL_HOOKS = join(HERE, "..", "..", ".claude", "hooks");

export function main(argv) {
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const issue = Number(arg("--issue"));
  const apply = !argv.includes("--dry-run");

  const board = readBoard();
  if (!board.reachable) {
    console.error(`  Work Control is unreachable (${board.error}). Refusing to guess which folder to repair.`);
    return 1;
  }
  const task = board.items.find((i) => Number(i.number) === issue);
  if (!task) {
    console.error(`  #${issue} is not on the board.`);
    return 1;
  }

  const parsed = parseWorktreeField(task.worktreeBranch, { codeRoot: "C:\\Users\\Kuya\\code" });
  if (!parsed.ok || !parsed.entries.length) {
    console.error(`  #${issue} does not name a single folder: ${parsed.reason ?? "field is empty"}`);
    return 1;
  }
  const dir = parsed.entries[0].path;

  const before = verifyHooks({ dir });
  if (before.ok) {
    console.error(`  Nothing to repair: all ${before.checked.length} registered hooks already exist in ${dir}.`);
    return 0;
  }

  console.error(`\n  ${before.missing.length} registered hook(s) missing in ${dir}:`);
  for (const m of before.missing) console.error(`    - ${m.name}   (${m.event}${m.matcher ? `/${m.matcher}` : ""})`);

  const plan = repairHooks({ dir, canonicalDir: CANONICAL_HOOKS, dryRun: true });
  console.error(`\n  Would write ${plan.planned.length} file(s) into ${plan.target}:`);
  for (const p of plan.planned) console.error(`    ${p.name}`);

  if (!apply) {
    console.error("\n  --dry-run: nothing written.\n");
    return 0;
  }

  const wrote = repairHooks({ dir, canonicalDir: CANONICAL_HOOKS });
  console.error(`\n  wrote ${wrote.wrote.length} file(s).`);

  const after = verifyHooks({ dir });
  console.error(after.ok ? "  All registered hooks now present.\n" : `  Still missing: ${after.missing.map((m) => m.name).join(", ")}\n`);
  return after.ok ? 0 : 1;
}

// Only when invoked directly — importing this module (the guards do) must not exit the process.
const invokedDirectly = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) process.exit(main(process.argv.slice(2)));
