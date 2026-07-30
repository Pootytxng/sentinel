// The launch sequence, in the order that makes a half-finished run recoverable (spec §7):
//
//   verdict -> worktree -> claim -> token -> overlay -> (the shell opens the window)
//
// Every prefix of that is a legal state with a printed next command. Nothing before the verdict
// writes anything at all, so a REFUSE leaves the machine exactly as it found it.
//
// Prints one JSON object on stdout for the launcher to consume. Human-facing narration goes to
// stderr so the two never get mixed up.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { CODE_ROOT, gatherFacts, loadPolicy, readBoard, readProjectIds } from "./gather.mjs";
import { reconcile, selectTask } from "./preflight.mjs";
import { contextLabel } from "./select.mjs";
import { postClaim, planRenew, execPlan } from "./claim.mjs";
import { makeToken, writeToken } from "./session-assert.mjs";
import { writeOverlay } from "./overlay.mjs";

const say = (...a) => console.error(...a);
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

class Refused extends Error {
  constructor(payload) {
    super(payload.reason ?? "preflight refused");
    this.payload = payload;
  }
}

function createWorktree({ path, branch, hostDir }) {
  if (existsSync(path)) throw new Error(`Refusing to create over an existing path: ${path}`);
  say(`  creating worktree ${path} on ${branch}`);
  git(hostDir, ["fetch", "origin", "--quiet"]);
  const base = git(hostDir, ["rev-parse", "--short", "origin/main"]);
  say(`  base: origin/main (${base})`);
  git(hostDir, ["worktree", "add", "-b", branch, path, "origin/main"]);
  return base;
}

export async function launch({ issue = null, dryRun = false, noOverlay = false, controlDir, self = { lane: "Claude Code" } }) {
  const board = readBoard();
  if (!board.reachable) throw new Refused({ verdict: "REFUSE", reason: `Work Control unreachable: ${board.error}` });

  const picked = selectTask(board.items, { issue, self, policy: loadPolicy() });
  if (picked.kind !== "task") throw new Refused({ verdict: picked.kind.toUpperCase(), reason: picked.reason, options: picked.options ?? [], recommended: picked.recommended ?? null });

  const task = picked.task;
  const { facts, target } = gatherFacts({ issue: task.number, task, board, self });
  const verdict = reconcile(facts);

  if (verdict.verdict !== "PASS") {
    throw new Refused({ ...verdict, task, reason: `preflight refused #${task.number}` });
  }
  if (!target) throw new Refused({ verdict: "REFUSE", reason: "No target folder resolved from the board field." });

  // Say the window out loud before anything is written. A 300k trial that looks like a standard
  // 150k launch is the confusion the addendum on #18 closed; the label is not decoration.
  const intended = facts.window.intended;
  const label = contextLabel(intended.window, { trial: intended.trial });
  say(`  context window: ${label}${intended.trial ? "  (trial — not accepted)" : ""}`);

  if (dryRun) {
    say("  dry run: verdict PASS, stopping before any write.");
    return { dryRun: true, issue: task.number, folder: target.path, branch: target.branch, window: intended.window, contextLabel: label, trial: intended.trial, verdict };
  }

  // 1. worktree (only when the verdict said it was safely creatable)
  if (verdict.actions.includes("create-worktree")) {
    createWorktree({ path: target.path, branch: target.branch, hostDir: `${CODE_ROOT}\\sentinel` });
  }

  // 2. claim -- refuses on its own if the verdict is not PASS
  const ids = readProjectIds(task.itemId);
  const expires = new Date(facts.now.getTime() + 12 * 3600_000).toISOString().slice(0, 10);
  if (facts.claim) {
    say("  renewing the existing claim");
    execPlan(planRenew({ issue: task.number, ids, until: expires }), {});
  } else {
    say("  posting the ownership claim");
    postClaim({
      issue: task.number,
      verdict,
      ids,
      facts: {
        lane: self.lane,
        executor: self.executor ?? self.lane,
        repository: "Pootytxng/sentinel",
        folder: target.path,
        branch: target.branch,
        scope: task.title,
        started: facts.now.toISOString().slice(0, 10),
        expires,
        nextAction: task.nextAction ?? "(set by the session)",
        processes: facts.processes,
      },
    });
  }

  // 3. token -- what the in-session assert checks the real root against
  const token = makeToken({
    issue: task.number,
    folder: target.path,
    branch: target.branch,
    window: facts.window.intended.window,
    now: facts.now,
  });
  writeToken(token);
  say(`  launch token written (expires ${token.expiresAt})`);

  // 4. overlay -- Class A only: the assert hook, never behaviour. Skipped entirely when the branch
  //    already registers the assert in its own tracked settings (owner decision 3): two copies would
  //    run the assert twice and the second would refuse the token the first consumed.
  if (!noOverlay) {
    const o = writeOverlay({ dir: target.path, controlDir });
    say(o.wrote ? `  installed the session-root assert into ${o.file}` : `  session-root assert not installed — ${o.reason}`);
  } else {
    say("  --no-overlay: the in-session root assert will NOT run for this launch");
  }

  return { issue: task.number, folder: target.path, branch: target.branch, window: intended.window, contextLabel: label, trial: intended.trial, verdict };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const argv = process.argv.slice(2);
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  try {
    const result = await launch({
      issue: arg("--issue") ? Number(arg("--issue")) : null,
      dryRun: argv.includes("--dry-run"),
      noOverlay: argv.includes("--no-overlay"),
      controlDir: arg("--control") ?? process.cwd(),
    });
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (e) {
    if (e instanceof Refused) {
      console.log(JSON.stringify(e.payload));
      process.exit(1);
    }
    console.log(JSON.stringify({ verdict: "ERROR", reason: String(e.message ?? e) }));
    process.exit(3);
  }
}
