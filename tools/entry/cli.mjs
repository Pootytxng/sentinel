// The command line the launcher calls. Prints a verdict; writes nothing.
//
//   node tools/entry/cli.mjs preflight [--issue N] [--json]
//   node tools/entry/cli.mjs choose                        (asks which task, prints the answer)
//   node tools/entry/cli.mjs assert                        (runs inside the session)
//
// Exit 0 = PASS, 1 = REFUSE, 2 = nothing to do / a choice is needed. The launcher branches on that,
// so a refusal can never be mistaken for a launch.
//
// `choose` is what the no-argument shortcut runs. Its menu and prompts go to stderr and its answer
// — one JSON line — goes to stdout, so the launcher can read the choice off a pipe while Kuya is
// still looking at a live prompt. Cancelling prints nothing on stdout, which is what stops the
// launcher from writing anything at all.

import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gatherFacts, loadPolicy, readBoard } from "./gather.mjs";
import { reconcile, selectTask } from "./preflight.mjs";
import { verdictLines } from "./render.mjs";
import { buildMenu, chooseInteractively, renderMenu } from "./select.mjs";
import { assertSessionRoot, readToken } from "./session-assert.mjs";

const C = { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", bold: "\x1b[1m", off: "\x1b[0m" };

const printVerdict = (task, result) => console.log(verdictLines(task, result).join("\n"));

function cmdPreflight(argv) {
  const issueArg = argv.includes("--issue") ? Number(argv[argv.indexOf("--issue") + 1]) : null;
  const asJson = argv.includes("--json");

  const board = readBoard();
  if (!board.reachable) {
    const out = { verdict: "REFUSE", reason: `Work Control is unreachable: ${board.error}`, checks: [] };
    console.log(asJson ? JSON.stringify(out, null, 2) : `\n  ${C.red}REFUSE${C.off}  ${out.reason}\n  Offline is not a licence to start unclaimed work.\n`);
    return 1;
  }

  const picked = selectTask(board.items, { issue: issueArg, policy: loadPolicy() });
  if (picked.kind !== "task") {
    if (asJson) console.log(JSON.stringify(picked, null, 2));
    else {
      console.log(`\n  ${picked.reason}\n`);
      for (const o of picked.options ?? []) {
        const gate = o.gate && o.gate !== "None" ? `, gate ${o.gate}` : "";
        console.log(`   ${o.number}. ${o.action ?? "Start"} ${o.title}  ${C.dim}(${o.lane}${gate}) — context ${o.contextLabel}${C.off}`);
      }
      if (picked.options?.length) console.log(`\n  Re-run with --issue <n>, or run the shortcut with no argument to choose.\n`);
    }
    return 2;
  }

  const { facts } = gatherFacts({ issue: picked.task.number, task: picked.task, board });
  const result = reconcile(facts);
  if (asJson) console.log(JSON.stringify({ task: picked.task, ...result }, null, 2));
  else printVerdict(picked.task, result);
  return result.verdict === "PASS" ? 0 : 1;
}

/** One question at a time, on stderr, and never when there is no terminal to answer it. */
async function terminalAsk(question) {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return await rl.question(question);
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

/**
 * Ask which task to run. Everything it needs is injectable, so the guards drive it with a fixture
 * board and a scripted answer instead of a real terminal.
 * Exit 0 with `{"issue":N,...}` on stdout; exit 2 and an empty stdout for cancel, refusal or an
 * empty board — the launcher treats anything but 0 as "stop, write nothing".
 */
export async function cmdChoose({
  board = null,
  self = { lane: "Claude Code" },
  now = new Date(),
  policy = null,
  ask = terminalAsk,
  say = (...a) => console.error(...a),
  out = (...a) => console.log(...a),
} = {}) {
  const theBoard = board ?? readBoard();
  if (!theBoard.reachable) {
    say(`\n  ${C.red}REFUSE${C.off}  Work Control is unreachable: ${theBoard.error}`);
    say("  Offline is not a licence to start unclaimed work.\n");
    return 2;
  }

  const menu = buildMenu(theBoard.items, { self, now, policy: policy ?? loadPolicy() });

  // One task, already ours, still claimed: there is no question to ask. Say what is happening and
  // why in one line — resuming without a word would be the same silence, just pointed the right way.
  if (menu.autoResume !== null) {
    const o = menu.options.find((x) => x.number === menu.autoResume);
    say(`\n  ${C.bold}Resuming #${o.number}${C.off} — ${o.label}`);
    say(`  ${C.dim}it is still yours and still claimed, so there is nothing to choose. Context ${o.contextLabel}.${C.off}\n`);
    out(JSON.stringify({ issue: o.number, action: "Resume", auto: true, title: o.title, window: o.window, marathon: o.marathon, contextLabel: o.contextLabel }));
    return 0;
  }

  if (menu.options.length === 0) {
    say(renderMenu(menu));
    say("  Nothing is Ready and nothing you own is resumable — there is nothing to start.\n");
    return 2;
  }

  const chosen = await chooseInteractively({ menu, ask, say });
  if (chosen.kind !== "task") {
    say(`\n  ${chosen.reason ?? "cancelled — nothing was written."}\n`);
    return 2;
  }

  const o = chosen.option;
  say(`\n  ${C.bold}${o.action} #${o.number}${C.off} — ${o.label}   ${C.dim}context ${o.contextLabel}${C.off}\n`);
  out(JSON.stringify({ issue: o.number, action: o.action, auto: false, title: o.title, window: o.window, marathon: o.marathon, contextLabel: o.contextLabel }));
  return 0;
}

function cmdAssert(argv) {
  const asJson = argv.includes("--json");
  const result = assertSessionRoot({ token: readToken(), env: process.env, cwd: process.cwd() });
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`  ${C.green}session root verified${C.off}  ${result.root}  ${C.dim}(#${result.issue}, ${result.branch}, via ${result.source})${C.off}`);
  else console.log(`\n  ${C.red}STOP — ${result.code}${C.off}\n  ${result.reason}\n`);
  return result.ok ? 0 : 1;
}

// Only dispatch when this file IS the program. Importing it (the guards do) must not exit the
// process out from under the test runner.
const invokedDirectly = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "preflight";
  const run = { preflight: cmdPreflight, choose: () => cmdChoose(), assert: cmdAssert }[cmd];
  if (!run) {
    console.error(`unknown command "${cmd}" — expected preflight | choose | assert`);
    process.exit(2);
  }
  process.exit(await run(argv.slice(1)));
}
