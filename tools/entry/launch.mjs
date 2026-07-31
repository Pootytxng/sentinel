// The launch sequence, in the order that makes a half-finished run recoverable (spec §7):
//
//   preliminary verdict -> [refresh -> final verdict] -> worktree -> claim -> token -> overlay -> (window)
//
// Every prefix of that is a legal state with a printed next command. Nothing before a verdict
// writes anything at all, so a REFUSE leaves the machine exactly as it found it.
//
// The bracketed stage runs ONLY when a worktree is to be created, and only after the preliminary
// verdict passed (spec §5.6, #21). Creating needs a current base, refreshing one is a fetch, and a
// fetch between the check and the use is precisely what let the launcher verify commit A and create
// commit B. So the fetch is staged: it touches remote-tracking refs and the object store only — no
// worktree, no branch, no claim, no file — and preflight then runs AGAIN, in full, against the
// pinned commit that will actually be used. The last verdict before any write is a complete one.
//
// Prints one JSON object on stdout for the launcher to consume. Human-facing narration goes to
// stderr so the two never get mixed up.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  FULL_SHA,
  HOST_DIR,
  REPO,
  gatherFacts,
  loadPolicy,
  readBoard,
  readProjectIds,
  refetchSnapshotFacts,
  refreshCreateBase,
} from "./gather.mjs";
import { reconcile, selectTask } from "./preflight.mjs";
import { contextLabel } from "./select.mjs";
import { postClaim, planRenew, execPlan } from "./claim.mjs";
import { writeBrief } from "./brief.mjs";
import { resolveWindow } from "./settings-resolve.mjs";
import { establishTier } from "./tier.mjs";
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

/**
 * Create the worktree from the COMMIT ID the final verdict was about — never from a ref name.
 *
 * No ref is resolved here and no fetch happens here (#21). Both were the defect: the settings were
 * verified against one resolution of `origin/main` and the worktree was created from a second one
 * taken after a fetch, so "verified" and "created" could name different commits while the launcher
 * printed them as the same thing. This function cannot re-resolve anything — it is handed an id, and
 * it refuses anything that is not one, rather than falling back to a movable name.
 */
export function createWorktree({ path, branch, base, hostDir = HOST_DIR }) {
  if (!base?.ok || !FULL_SHA.test(base.sha ?? "")) {
    throw new Error(`Refusing to create a worktree from an unpinned base (${base?.ref ?? "no ref"}: ${base?.error ?? "no commit id"}).`);
  }
  if (existsSync(path)) throw new Error(`Refusing to create over an existing path: ${path}`);
  say(`  creating worktree ${path} on ${branch}`);
  say(`  base: ${base.sha} (${base.ref}, as verified)`);
  git(hostDir, ["worktree", "add", "-b", branch, path, base.sha]);
  return base.sha;
}

/**
 * STAGE 2 (spec §5.6). Refresh the base, run the FULL preflight again against the refreshed commit,
 * and create only from that exact id.
 *
 * Split out of `launch()` so the sequence a real launch runs is the sequence the guards can drive
 * against a repository whose base actually moves — a source-text assertion that two call sites
 * mention the same constant cannot tell you whether the commit verified is the commit created.
 *
 * Creates nothing on a REFUSE: it returns `created:null` and the verdict that stopped it.
 */
export function refreshAndCreate({ facts, target, base = null, hostDir = HOST_DIR, env = process.env }) {
  const refreshed = refreshCreateBase({ hostDir });
  if (base?.sha && refreshed.sha && refreshed.sha !== base.sha) {
    say(`  ${refreshed.ref} moved ${base.sha.slice(0, 7)} -> ${refreshed.sha.slice(0, 7)} while preflight ran — re-verifying against the commit that will be used`);
  }
  const verdict = reconcile(refetchSnapshotFacts({ facts, base: refreshed, hostDir, env }));
  if (verdict.verdict !== "PASS") return { created: null, verdict, base: refreshed };
  return {
    created: createWorktree({ path: target.path, branch: target.branch, base: refreshed, hostDir }),
    verdict,
    base: refreshed,
  };
}

export async function launch({ issue = null, dryRun = false, noOverlay = false, controlDir, self = { lane: "Claude Code" } }) {
  const board = readBoard();
  if (!board.reachable) throw new Refused({ verdict: "REFUSE", reason: `Work Control unreachable: ${board.error}` });

  const picked = selectTask(board.items, { issue, self, policy: loadPolicy() });
  if (picked.kind !== "task") {
    throw new Refused({ verdict: picked.kind.toUpperCase(), reason: picked.reason, options: picked.options ?? [], unavailable: picked.unavailable ?? [] });
  }

  const task = picked.task;
  // No issue was named and one was already ours — say which, and why nobody was asked (#23).
  if (picked.auto) say(`  resuming #${task.number} — it is already yours and still claimed, so there was nothing to choose`);
  // STAGE 1 — the preliminary verdict. Read-only: no fetch, no writes, and it already names the
  // exact commit an absent worktree would be created from.
  const { facts, target, base } = gatherFacts({ issue: task.number, task, board, self });
  let verdict = reconcile(facts);

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
    say("  dry run: preliminary verdict PASS, stopping before any write.");
    if (verdict.actions.includes("create-worktree")) {
      say("  (a real launch would refresh origin and re-run preflight against the refreshed commit before creating anything.)");
    }
    return { dryRun: true, issue: task.number, folder: target.path, branch: target.branch, window: intended.window, contextLabel: label, marathon: intended.marathon, verdict };
  }

  // 1. worktree — refresh, RE-VERIFY, then create from the commit that final verdict was about.
  let createdFrom = null;
  if (verdict.actions.includes("create-worktree")) {
    // The only fetch in the toolchain, and it is followed by a full second preflight; the
    // preliminary verdict above authorized the fetch, never the creation.
    const staged = refreshAndCreate({ facts, target, base });
    verdict = staged.verdict;
    if (!staged.created) {
      throw new Refused({ ...verdict, task, reason: `preflight refused #${task.number} against the refreshed base — nothing was created` });
    }
    createdFrom = staged.created;
  }

  // 2. tier -- keep the promise the `settings.window` row made.
  //
  // The row may now PASS on an intended window nothing configures yet, because this step is what
  // configures it (#23): the launcher writes the tier into its own gitignored layer, in a file it can
  // prove it wrote, and refuses anybody else's. That is a stronger guarantee than the old comparison,
  // not a weaker one — but only if the write is CHECKED. So the effective window is resolved again
  // from disk afterwards, and a launch that did not actually get its tier stops here, before the
  // claim is posted and before VS Code opens on a session the root assert would hard-stop.
  const tier = establishTier({ dir: target.path, intended });
  if (tier.action === "refuse") {
    throw new Refused({ ...verdict, verdict: "REFUSE", task, reason: tier.reason, remediation: [tier.reason] });
  }
  if (tier.wrote) say(`  ${tier.disclosure}`);
  const settled = resolveWindow({ dir: target.path });
  if (settled.window !== intended.window) {
    const from = settled.configured ? settled.file : "nothing — that is the documented fallback";
    throw new Refused({
      ...verdict,
      verdict: "REFUSE",
      task,
      reason: `This train intends ${intended.window} (${intended.reason}), but ${target.path} still resolves ${settled.window} from ${from}. Refusing to start a session at a window the launch did not establish.`,
    });
  }

  // 3. claim -- refuses on its own if the verdict is not PASS
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
        repository: REPO,
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

  // 4. brief -- the durable instructions, written BEFORE the token that admits a session.
  //
  // The token is what lets a session start; the brief is what the session starts with. Written in
  // this order, a session can never be admitted to a task whose instructions are not on disk yet —
  // and that is the whole point of the brief, because the thing it replaces is Kuya pasting a prompt.
  const brief = writeBrief({
    issue: task.number,
    title: task.title,
    lane: self.lane,
    folder: target.path,
    branch: target.branch,
    base: createdFrom,
    window: intended.window,
    marathon: intended.marathon,
    claimExpires: expires,
    nextAction: task.nextAction ?? null,
  });
  say(`  launch brief written to ${brief}`);

  // 5. token -- what the in-session assert checks the real root against
  const token = makeToken({
    issue: task.number,
    repo: REPO,
    folder: target.path,
    branch: target.branch,
    window: intended.window,
    now: facts.now,
  });
  writeToken(token);
  say(`  launch token written (expires ${token.expiresAt})`);

  // 6. overlay -- Class A only: the assert hook, never behaviour. Skipped entirely when the branch
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

  return { issue: task.number, folder: target.path, branch: target.branch, base: createdFrom, window: intended.window, contextLabel: label, marathon: intended.marathon, verdict };
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
