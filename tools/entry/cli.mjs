// The command line the launcher calls. Prints a verdict; writes nothing.
//
//   node tools/entry/cli.mjs preflight [--issue N] [--json]
//   node tools/entry/cli.mjs choose                        (asks which task, prints the answer)
//   node tools/entry/cli.mjs assert                        (runs inside the session)
//   node tools/entry/cli.mjs adopt --issue N --session <id> (verifies a session nobody launched)
//   node tools/entry/cli.mjs bridge  --folder <path>       (waits for a LIVE editor on that folder)
//   node tools/entry/cli.mjs handoff --folder <path>       (waits for the session to take the launch)
//
// Exit 0 = PASS, 1 = REFUSE, 2 = nothing to do / a choice is needed. The launcher branches on that,
// so a refusal can never be mistaken for a launch.
//
// `bridge` and `handoff` are the two waits at the end of the journey, and they live here rather than
// in the shell for one reason: a polling loop written in PowerShell is a polling loop no guard can
// drive. Here the clock, the sleep and the pid probe are injected, so the tests exercise the exact
// code the launcher runs without waiting a single real second.
//
// `choose` is what the no-argument shortcut runs. Its menu and prompts go to stderr and its answer
// — one JSON line — goes to stdout, so the launcher can read the choice off a pipe while Kuya is
// still looking at a live prompt. Cancelling prints nothing on stdout, which is what stops the
// launcher from writing anything at all.

import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gatherFacts, loadPolicy, readBoard, CODE_ROOT } from "./gather.mjs";
import { BRIDGE_TIMEOUT_MS, HANDOFF_TIMEOUT_MS, waitForBridge, waitForHandoff } from "./ide-bridge.mjs";
import { reconcile, selectTask } from "./preflight.mjs";
import { verdictLines } from "./render.mjs";
import { buildMenu, chooseInteractively, renderMenu } from "./select.mjs";
import { adopt } from "./adopt.mjs";
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

  const picked = selectTask(board.items, { issue: issueArg, policy: loadPolicy(), codeRoot: CODE_ROOT });
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

  const menu = buildMenu(theBoard.items, { self, now, policy: policy ?? loadPolicy(), codeRoot: CODE_ROOT });

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

const argOf = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);

/**
 * Verify a session nobody launched (#125 step 2). The write refusal prints this exact command with
 * the session id already filled in, so a stopped session is told how to verify itself at the moment
 * it is stopped — that pairing is the whole design, see adopt.mjs.
 */
export function cmdAdopt(argv, { run = adopt, log = console.log, err = console.error } = {}) {
  const asJson = argv.includes("--json");
  const result = run({
    folder: argOf(argv, "--folder") ?? process.cwd(),
    issue: argOf(argv, "--issue"),
    sessionId: argOf(argv, "--session"),
  });
  if (asJson) {
    log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    const { record } = result;
    log(`  ${C.green}session adopted${C.off}  ${record.folder}  ${C.dim}(#${record.issue}, ${record.branch})${C.off}`);
    for (const note of result.notes ?? []) log(`  ${C.dim}note: ${note}${C.off}`);
  } else {
    err(`\n  ${C.red}REFUSE — ${result.code}${C.off}\n  ${result.reason}\n`);
  }
  return result.ok ? 0 : 1;
}

/** Both waits take the same arguments and report the same way; only the question differs. */
async function waitCommand(argv, { wait, ready, waiting, gaveUp, timeout }) {
  const folder = argOf(argv, "--folder");
  const asJson = argv.includes("--json");
  if (!folder) {
    console.error("  --folder <path> is required — there is no default folder to wait on.");
    return 2;
  }

  // `--now` asks the same question with a zero budget: one look, no sleep, same answer shape. It is
  // how `--details` reports where the journey stands without holding the window open for a minute.
  const timeoutMs = argv.includes("--now") ? 0 : Number(argOf(argv, "--timeout") ?? timeout);
  const r = await wait({ folder, timeoutMs });

  const state = r.state ?? {};
  if (asJson) {
    // Never the whole state: a lock carries no token by construction, but a lineage record is a file
    // we did not write the schema of, and echoing files wholesale is how private fields escape.
    console.log(JSON.stringify({ ok: r.ok, waitedMs: r.waitedMs, reason: state.reason ?? null, folder }));
  } else if (r.ok) {
    console.error(`  ${C.green}${ready}${C.off}  ${C.dim}after ${Math.round((r.waitedMs ?? 0) / 1000)}s${C.off}`);
  } else {
    console.error(`  ${C.yellow}${r.stopped ? gaveUp : waiting}${C.off}  ${state.reason ?? "no reason recorded"}`);
  }
  return r.ok ? 0 : 2;
}

/** Is a VS Code window with the extension live actually open on that folder yet? */
const cmdBridge = (argv) =>
  waitCommand(argv, {
    wait: waitForBridge,
    timeout: BRIDGE_TIMEOUT_MS,
    ready: "the editor is open on this folder",
    waiting: "no live editor window on this folder yet",
    gaveUp: "cannot open on this folder",
  });

/** Did a session start there, verify, and take up THIS launch? Nonce-checked, so replay cannot pass. */
const cmdHandoff = (argv) =>
  waitCommand(argv, {
    wait: waitForHandoff,
    timeout: HANDOFF_TIMEOUT_MS,
    ready: "Claude started and took up the launch",
    waiting: "Claude has not taken up the launch yet",
    gaveUp: "the launch cannot be taken up",
  });

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
  const run = { preflight: cmdPreflight, choose: () => cmdChoose(), assert: cmdAssert, adopt: cmdAdopt, bridge: cmdBridge, handoff: cmdHandoff }[cmd];
  if (!run) {
    console.error(`unknown command "${cmd}" — expected preflight | choose | assert | adopt | bridge | handoff`);
    process.exit(2);
  }
  process.exit(await run(argv.slice(1)));
}
