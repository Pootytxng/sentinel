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
import { CREATE_BASE_REF, HOST_DIR, gatherFacts, loadPolicy, readBoard, readProjectIds } from "./gather.mjs";
import { reconcile, selectTask } from "./preflight.mjs";
import { contextLabel } from "./select.mjs";
import { postClaim, planRenew, execPlan } from "./claim.mjs";
import { makeToken, writeToken } from "./session-assert.mjs";
import { pruneDeadOverlay, writeOverlay } from "./overlay.mjs";

const say = (...a) => console.error(...a);
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

class Refused extends Error {
  constructor(payload) {
    super(payload.reason ?? "preflight refused");
    this.payload = payload;
  }
}

// The ref is NOT spelled out here. Preflight verified this train's settings against the snapshot
// named by CREATE_BASE_REF; creating from a different one would mean the folder that opens is not
// the folder that was checked. One constant, both sites (#21).
function createWorktree({ path, branch, hostDir = HOST_DIR, ref = CREATE_BASE_REF }) {
  if (existsSync(path)) throw new Error(`Refusing to create over an existing path: ${path}`);
  say(`  creating worktree ${path} on ${branch}`);
  git(hostDir, ["fetch", "origin", "--quiet"]);
  const base = git(hostDir, ["rev-parse", "--short", ref]);
  say(`  base: ${ref} (${base})`);
  git(hostDir, ["worktree", "add", "-b", branch, path, ref]);
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

  // Say the window out loud before anything is written. A marathon-tier launch that looks like a
  // standard one is the confusion the addendum on #18 closed; the label is not decoration. The tier
  // is accepted (#19), so the line states which tier it is and that it is not the default — it no
  // longer describes an experiment.
  const intended = facts.window.intended;
  const label = contextLabel(intended.window, { marathon: intended.marathon });
  say(`  context window: ${label}${intended.marathon ? "  (accepted tier, scoped to this issue — not the default)" : ""}`);

  if (dryRun) {
    say("  dry run: verdict PASS, stopping before any write.");
    return { dryRun: true, issue: task.number, folder: target.path, branch: target.branch, window: intended.window, contextLabel: label, marathon: intended.marathon, verdict };
  }

  // 1. worktree (only when the verdict said it was safely creatable)
  if (verdict.actions.includes("create-worktree")) {
    createWorktree({ path: target.path, branch: target.branch });
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
    if (o.wrote) say(`  installed the session-root assert into ${o.file}`);
    else if (o.removed) say(`  removed a leftover session-assert overlay from ${o.file} — ${o.reason}`);
    else say(`  session-root assert not installed — ${o.reason}`);
  } else {
    // Opting out of INSTALLING the assert is not opting out of clearing a dead one we left behind.
    const p = pruneDeadOverlay({ dir: target.path });
    if (p.pruned.length > 0) say(`  removed ${p.pruned.length} dead session-assert entr${p.pruned.length === 1 ? "y" : "ies"} from ${p.file}`);
    say("  --no-overlay: the in-session root assert will NOT run for this launch");
  }

  return { issue: task.number, folder: target.path, branch: target.branch, window: intended.window, contextLabel: label, marathon: intended.marathon, verdict };
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
