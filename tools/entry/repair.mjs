// `--repair`: the ONLY path that writes hook files into a worktree.
//
// The default is verify-and-refuse (owner-approved). Repair exists because a folder whose tracked
// settings register seven hooks, five of which include a real DENY, cannot honestly be launched
// into while none of them exist — but writing into a folder another lane may own is mutation, so it
// takes an explicit flag and it announces every file before writing it.
//
// The canonical payload lives at tools/entry/hooks/ and is TRACKED, so a fresh clone of the control
// folder can repair. That path is deliberately not .claude/hooks/: nothing auto-activates anywhere,
// and materialization stays explicit. Whether .claude/hooks/ itself should be tracked -- which
// would make the hooks live in every checkout with no verification step at all -- is Kuya's
// decision, and this deliberately does not take it.

import { join } from "node:path";
import { HERE, readBoard } from "./gather.mjs";
import { repairHooks, verifyHooks } from "./hooks-verify.mjs";
import { parseWorktreeField } from "./worktree-field.mjs";

export const CANONICAL_HOOKS = join(HERE, "hooks");

function main(argv) {
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

process.exit(main(process.argv.slice(2)));
