// The command line the launcher calls. Prints a verdict; writes nothing.
//
//   node tools/entry/cli.mjs preflight [--issue N] [--json]
//   node tools/entry/cli.mjs assert                       (runs inside the session)
//
// Exit 0 = PASS, 1 = REFUSE, 2 = nothing to do / a choice is needed. The launcher branches on that,
// so a refusal can never be mistaken for a launch.

import { gatherFacts, readBoard } from "./gather.mjs";
import { reconcile, selectTask } from "./preflight.mjs";
import { assertSessionRoot, readToken } from "./session-assert.mjs";

const C = { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", bold: "\x1b[1m", off: "\x1b[0m" };

function printVerdict(task, result) {
  const head = result.verdict === "PASS" ? `${C.green}PASS${C.off}` : `${C.red}REFUSE${C.off}`;
  console.log(`\n  ${C.bold}#${task?.number} ${task?.title ?? ""}${C.off}`);
  console.log(`  preflight: ${head}\n`);
  const width = Math.max(...result.checks.map((c) => c.name.length));
  for (const c of result.checks) {
    const mark = c.ok ? `${C.green}ok  ${C.off}` : `${C.red}FAIL${C.off}`;
    console.log(`  ${mark} ${c.name.padEnd(width)}  ${C.dim}expected${C.off} ${c.expected}`);
    if (!c.ok) console.log(`       ${" ".repeat(width)}  ${C.dim}actual  ${C.off} ${C.yellow}${c.actual}${C.off}`);
  }
  if (result.remediation.length) {
    console.log(`\n  ${C.bold}What to do${C.off}`);
    for (const r of result.remediation) console.log(`   · ${r}`);
  }
  if (result.actions.length) console.log(`\n  ${C.dim}actions on launch: ${result.actions.join(", ")}${C.off}`);
  if (result.takeoverDraft) console.log(`\n${result.takeoverDraft}\n`);
  console.log("");
}

function cmdPreflight(argv) {
  const issueArg = argv.includes("--issue") ? Number(argv[argv.indexOf("--issue") + 1]) : null;
  const asJson = argv.includes("--json");

  const board = readBoard();
  if (!board.reachable) {
    const out = { verdict: "REFUSE", reason: `Work Control is unreachable: ${board.error}`, checks: [] };
    console.log(asJson ? JSON.stringify(out, null, 2) : `\n  ${C.red}REFUSE${C.off}  ${out.reason}\n  Offline is not a licence to start unclaimed work.\n`);
    return 1;
  }

  const picked = selectTask(board.items, { issue: issueArg });
  if (picked.kind !== "task") {
    if (asJson) console.log(JSON.stringify(picked, null, 2));
    else {
      console.log(`\n  ${picked.reason}\n`);
      for (const o of picked.options ?? []) console.log(`   ${o.number}. ${o.title}  ${C.dim}(${o.lane}${o.gate && o.gate !== "None" ? `, gate ${o.gate}` : ""})${C.off}`);
      if (picked.options?.length) console.log(`\n  Re-run with --issue <n>.\n`);
    }
    return 2;
  }

  const { facts } = gatherFacts({ issue: picked.task.number, task: picked.task, board });
  const result = reconcile(facts);
  if (asJson) console.log(JSON.stringify({ task: picked.task, ...result }, null, 2));
  else printVerdict(picked.task, result);
  return result.verdict === "PASS" ? 0 : 1;
}

function cmdAssert(argv) {
  const asJson = argv.includes("--json");
  const result = assertSessionRoot({ token: readToken(), env: process.env, cwd: process.cwd() });
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`  ${C.green}session root verified${C.off}  ${result.root}  ${C.dim}(#${result.issue}, ${result.branch}, via ${result.source})${C.off}`);
  else console.log(`\n  ${C.red}STOP — ${result.code}${C.off}\n  ${result.reason}\n`);
  return result.ok ? 0 : 1;
}

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "preflight";
const run = { preflight: cmdPreflight, assert: cmdAssert }[cmd];
if (!run) {
  console.error(`unknown command "${cmd}" — expected preflight | assert`);
  process.exit(2);
}
process.exit(run(argv.slice(1)));
