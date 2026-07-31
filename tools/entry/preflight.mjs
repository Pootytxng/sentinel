// The reconciler: compare everything that must agree, and produce a VERDICT — never a repair.
//
// The governing invariant (spec §1): a task must not begin until its Work Control issue, active
// claim, actual session root, Git worktree, branch, dirty state, active processes, and effective
// project settings agree. REFUSE always precedes the first write.
//
// Pure over injected facts. Every check is a named comparison with an `expected` and an `actual`,
// which is the property that makes the guards mechanizable: a check that cannot state what it
// expected cannot be reproduced by a test.
//
// It never resets, checks out over, stashes, cleans, deletes a worktree, or kills a process. An
// expired claim yields a takeover DRAFT for a human to post — collision rule 5, expiry is an alarm,
// not a takeover.

import { buildMenu, FALLBACK_POLICY } from "./select.mjs";
import { LOCAL_SETTINGS_PATH } from "./tier.mjs";
import { parseWorktreeField, samePath } from "./worktree-field.mjs";

export const STARTABLE_STATUS = ["Ready", "Active"];
export const BLOCKING_GATES = ["Kuya", "Security / System", "Release / Distribution", "External / Account"];
export const EXPECTED_SUBAGENT_MODEL = "sonnet";

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "").toLowerCase();

/**
 * Choose which task to run.
 * An explicit issue is always honoured, even when unstartable, so the CHECKS explain the refusal
 * instead of the selector silently reporting "no task found".
 *
 * WITHOUT an explicit issue this returns a CHOICE and never a task — not even when only one task
 * is on offer (owner addendum on #18: one Ready #13 was enough for the old code to start it while
 * our own Active #18 sat unread). Killing the silent path here covers every caller, not just the
 * menu. The recommendation, the ordering and the context labels live in select.mjs.
 */
export function selectTask(items, { issue = null, self = { lane: "Claude Code" }, now = new Date(), policy = null } = {}) {
  if (issue !== null) {
    const task = (items ?? []).find((i) => Number(i.number) === Number(issue));
    if (!task) return { kind: "none", reason: `Issue #${issue} is not on the board.` };
    return { kind: "task", task };
  }

  const menu = buildMenu(items ?? [], { self, now, policy: policy ?? FALLBACK_POLICY });
  if (menu.options.length === 0) {
    return { kind: "none", reason: "No task is Ready and nothing you own is resumable — nothing to start. (Never invent work.)" };
  }
  return {
    kind: "choice",
    menu,
    options: menu.options,
    recommended: menu.recommended,
    reason: menu.recommended
      ? `#${menu.recommended} is yours and resumable. Confirm it, or choose another — the shortcut does not pick for you.`
      : `${menu.options.length} task${menu.options.length === 1 ? " is" : "s are"} on offer. Choose one — there is deliberately no default.`,
  };
}

// `note` is the one thing a PASSING check may still say out loud. `actual` is not: the renderer shows
// it only under a FAIL, so anything a green row needs the owner to see has to travel separately.
const mk = (name, expected, actual, ok, remediation = null, note = null) => ({ name, expected, actual, ok, remediation, note });

/**
 * @returns {{verdict: "PASS"|"REFUSE", checks: Array, remediation: string[], actions: string[], takeoverDraft: string|null}}
 */
export function reconcile(facts) {
  const {
    board = { reachable: true },
    task = null,
    claim = null,
    handoff = null,
    checkouts = [],
    gitState = null,
    base = null,
    expectedCommonDir = null,
    window: win = null,
    subagentModel = null,
    hooks = null,
    processes = [],
    items = [],
    self = { lane: null },
    now = new Date(),
  } = facts ?? {};

  const checks = [];
  const actions = [];

  // --- Work Control -------------------------------------------------------
  checks.push(
    mk(
      "board.reachable",
      "Work Control responds",
      board.reachable ? "reachable" : `unreachable${board.error ? ` — ${board.error}` : ""}`,
      Boolean(board.reachable),
      "Work Control is the claim ledger. Being offline is not a licence to start unclaimed work.",
    ),
  );

  const status = task?.status ?? null;
  checks.push(
    mk(
      "task.status",
      STARTABLE_STATUS.join(" or "),
      status ?? "(no task)",
      STARTABLE_STATUS.includes(status),
      status === "Needs Kuya" || status === "Blocked"
        ? `#${task?.number} is ${status} — only Kuya can move it. Nothing here is startable.`
        : `#${task?.number} is ${status}; a task must be Ready (to start) or Active under our own claim (to resume).`,
    ),
  );

  const gate = task?.gate ?? "None";
  checks.push(
    mk(
      "task.gate",
      "None",
      gate,
      !BLOCKING_GATES.includes(gate),
      BLOCKING_GATES.includes(gate) ? `#${task?.number} carries the ${gate} gate — the next step is owner territory.` : null,
    ),
  );

  // --- The claim ----------------------------------------------------------
  let claimOk = true;
  let claimActual = "no claim";
  let takeoverDraft = null;
  if (claim) {
    const expired = claim.expires ? new Date(`${claim.expires}T23:59:59Z`) < now : false;
    const otherLane = self.lane && claim.lane && claim.lane !== self.lane;
    const otherIssue = task && claim.issue && Number(claim.issue) !== Number(task.number);
    claimOk = !expired && !otherLane && !otherIssue;
    claimActual = expired
      ? `expired ${claim.expires} (lane ${claim.lane})`
      : otherLane
        ? `held by ${claim.lane}`
        : otherIssue
          ? `claims #${claim.issue}, not #${task?.number}`
          : `ours, until ${claim.expires}`;
    if (expired) {
      takeoverDraft = [
        "### Verified takeover",
        `- Previous claim: ${claim.lane} on ${claim.folder} @ ${claim.branch}, expired ${claim.expires}`,
        "- Worktree/process evidence checked: <fill from the preflight output above>",
        "- Preserved work: <what exists in the folder right now, untouched>",
        "- New executor/worktree/branch/scope:",
        "- New expiry:",
        "- Next action:",
        "",
        "Expiry is an alarm, not a takeover (collision rule 5). Post this only after inspecting the",
        "real worktree and processes. No destructive Git as a first move.",
      ].join("\n");
    }
  }
  checks.push(
    mk("task.claim", "no other writer, claim unexpired", claimActual, claimOk,
      takeoverDraft ? "The claim has expired. Inspect the folder and post a Verified takeover — never take over silently." : null),
  );

  // --- The worktree field -------------------------------------------------
  const parsed = parseWorktreeField(task?.worktreeBranch ?? "", { codeRoot: facts.codeRoot ?? null });
  const target = parsed.ok ? (parsed.entries[0] ?? null) : null;
  checks.push(
    mk("field.canonical", "<folder> @ <branch>", parsed.ok ? (target ? `${target.path} @ ${target.branch}` : "none") : `unparseable — ${parsed.code}`,
      parsed.ok && target !== null, parsed.ok ? null : parsed.reason),
  );

  const targetPath = target?.path ?? null;
  const targetBranch = target?.branch ?? null;

  // --- Folder ownership ---------------------------------------------------
  const otherWriter = (items ?? []).find((i) => {
    if (Number(i.number) === Number(task?.number)) return false;
    if (i.status !== "Active") return false;
    const p = parseWorktreeField(i.worktreeBranch ?? "", { codeRoot: facts.codeRoot ?? null });
    return p.ok && p.entries.some((e) => targetPath && samePath(e.path, targetPath));
  });
  checks.push(
    mk("folder.writer", "no other Active item in this folder",
      otherWriter ? `#${otherWriter.number} (${otherWriter.lane}) is Active in this folder` : "none",
      !otherWriter,
      otherWriter ? "One folder, one writer (collision rule 2). A different branch does not make concurrent writes safe." : null),
  );

  // --- The checkout -------------------------------------------------------
  const existing = (checkouts ?? []).find((c) => targetPath && samePath(c.path, targetPath)) ?? null;
  const branchElsewhere = (checkouts ?? []).find(
    (c) => targetBranch && c.branch === targetBranch && !(targetPath && samePath(c.path, targetPath)),
  );

  if (!existing && targetPath && !branchElsewhere) actions.push("create-worktree");
  checks.push(
    mk("folder.exists", "exists, or is safely creatable",
      existing ? "exists" : branchElsewhere ? "absent, and its branch is taken" : "absent (creatable)",
      Boolean(existing) || (Boolean(targetPath) && !branchElsewhere),
      existing ? null : "The worktree will be created from the exact commit this verdict names, into a path that does not yet exist."),
  );

  // --- The base commit ----------------------------------------------------
  // Present only when a worktree is to be created. `origin/main` is a MOVABLE name: reading the
  // future worktree's settings through it and then creating through it are two resolutions of the
  // same name, and a fetch in between makes them two different commits (TOCTOU, #21). So the verdict
  // is about ONE commit id, and this row states which — the settings rows below were read from it,
  // and `git worktree add` is given the same id.
  if (base) {
    const pinned = Boolean(base.ok && /^[0-9a-f]{40}$/.test(base.sha ?? ""));
    checks.push(
      mk("base.pinned", "one immutable commit id", pinned ? base.sha : `unresolved — ${base.error ?? "no commit id"}`, pinned,
        pinned
          ? null
          : `${base.ref ?? "The base ref"} does not resolve to a commit in the host checkout, so there is nothing to verify the settings against and nothing safe to create from. Repair the checkout's remote first — the launcher will not guess a base.`,
        pinned ? `${base.ref} pinned at ${base.sha.slice(0, 7)} — every settings row below was read from this commit, and the worktree is created from it` : null),
    );
  }

  checks.push(
    mk("git.branchElsewhere", "branch checked out nowhere else",
      branchElsewhere ? `${targetBranch} is checked out in ${branchElsewhere.path}` : "nowhere else",
      !branchElsewhere,
      branchElsewhere ? "Git would refuse this too, but later and less legibly." : null),
  );

  checks.push(
    mk("git.commonDir", expectedCommonDir ?? "(the expected repository)",
      existing ? existing.commonDir : "(folder absent)",
      !existing || !expectedCommonDir || samePath(existing.commonDir, expectedCommonDir),
      "The folder must belong to the repository the task is about."),
  );

  const branchOk = !existing ? true : Boolean(gitState?.ok) && !gitState.detached && gitState.branch === targetBranch;
  checks.push(
    mk("git.branch", targetBranch ?? "(unknown)",
      !existing ? "(folder absent)" : gitState?.detached ? "detached HEAD" : (gitState?.branch ?? "(unreadable)"),
      branchOk,
      branchOk ? null : "The folder is real but is not on the claimed branch. Checking it out over the current state is mutation — refuse instead."),
  );

  const cleanOk = !existing ? true : Boolean(gitState?.clean);
  checks.push(
    mk("git.clean", "clean: no modified, untracked, staged, stashed or divergent state",
      !existing ? "(folder absent)" : describeState(gitState),
      cleanOk,
      cleanOk ? null : "Reported, not cleared. Decide what to do with this work before reusing the folder."),
  );

  // --- Settings -----------------------------------------------------------
  if (win) {
    const same = win.effective.window === win.intended.window;
    const configured = win.effective.configured !== false;
    // A folder that does not exist yet was measured against the snapshot it will be created from,
    // not against any folder on disk. The passing row says so — where a value came from is the
    // whole point of this check, and a green row that hides its source is the drift it prevents.
    const snapshot = win.effective.snapshot ?? null;

    // Comparing was all this row could ever do, and a launcher that can only complain is the chore
    // #23 exists to delete: the marathon tier is never in tracked settings (correctly — 150000 is
    // right for every standard train), so the row refused forever and Kuya set an environment
    // variable by hand. `tier.mjs` decides whether the disagreement is one the launcher may settle
    // in its own gitignored layer; this row reports that decision and never makes it.
    const plan = win.plan ?? null;
    const establishing = plan?.action === "write";
    const ok = establishing ? true : plan?.action === "refuse" ? false : same && configured;
    const provenance = configured
      ? `${win.effective.window} from ${win.effective.file}`
      : `nothing configures it${snapshot ? ` in ${snapshot}` : ""}, so ${win.effective.window} is the documented fallback`;

    checks.push(
      mk("settings.window", win.intended.window, win.effective.window, ok,
        ok
          ? null
          : plan?.action === "refuse"
            ? plan.reason
            : !configured
              ? `Not configured${snapshot ? ` in ${snapshot}` : ""} — ${win.effective.window} is the documented fallback, not a decision.`
              : `Comes from ${win.effective.file}. Change it there, or route to the folder whose policy matches — do not adopt a different window to make the mismatch go away.`,
        // A green row must never hide a pending write, so establishment states what it found and
        // what it will do about it — the same disclosure a stale hook overlay gets below.
        establishing
          ? `${provenance} — the launcher will establish ${win.intended.window} for this folder in ${LOCAL_SETTINGS_PATH} (per-machine, not tracked): ${win.intended.reason}`
          : ok && snapshot
            ? `from ${snapshot} — the folder does not exist yet, so this is the snapshot it will be created from`
            : null),
    );
  }
  if (subagentModel) {
    checks.push(
      mk("settings.subagentModel", EXPECTED_SUBAGENT_MODEL, subagentModel.value,
        subagentModel.value === EXPECTED_SUBAGENT_MODEL,
        subagentModel.value === EXPECTED_SUBAGENT_MODEL ? null : `Set in ${subagentModel.source}.`),
    );
  }
  if (hooks) {
    // A leftover of our own is disclosed on the row, never hidden behind a green "all present" — it
    // is not a refusal, because the launcher clears it on this same run, but a launcher that quietly
    // repairs itself is a launcher accumulating state nobody knows about.
    const staleCount = hooks.stale?.length ?? 0;
    checks.push(
      mk("hooks.present", `${hooks.checked?.length ?? 0} registered hooks present`,
        hooks.ok ? "all present" : `${hooks.missing.length} missing`, Boolean(hooks.ok), hooks.remediation,
        staleCount ? `${staleCount} stale overlay entr${staleCount === 1 ? "y" : "ies"} to take back — the launcher removes ${staleCount === 1 ? "it" : "them"} on this run` : null),
    );
  }

  // --- Processes ----------------------------------------------------------
  const contending = (processes ?? []).filter((p) => p.contends);
  checks.push(
    mk("processes", "nothing contending with this folder",
      (processes ?? []).length ? processes.map((p) => `${p.name} ×${p.count}${p.note ? ` (${p.note})` : ""}`).join(", ") : "none",
      contending.length === 0,
      contending.length
        ? "Wait for it, or work elsewhere. Never stop another tool's build, helper or session to clear a claim (collision rule 6)."
        : null),
  );

  // --- The handoff (guard 7) ---------------------------------------------
  const boardNext = task?.nextAction ?? null;
  const handoffNext = handoff?.nextAction ?? null;
  checks.push(
    mk("board.nextAction", handoffNext ?? "(no handoff yet)", boardNext ?? "(empty)",
      handoffNext === null || norm(handoffNext) === norm(boardNext),
      handoffNext === null || norm(handoffNext) === norm(boardNext)
        ? null
        : "The board's Next action has drifted from the newest durable handoff. The handoff is the record; the field is the index."),
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    verdict: failed.length === 0 ? "PASS" : "REFUSE",
    checks,
    actions,
    takeoverDraft,
    remediation: failed.map((c) => c.remediation).filter(Boolean),
  };
}

function describeState(s) {
  if (!s?.ok) return "(unreadable)";
  const parts = [];
  if (s.modified) parts.push(`${s.modified} modified`);
  if (s.staged) parts.push(`${s.staged} staged`);
  if (s.untracked) parts.push(`${s.untracked} untracked`);
  if (s.unmerged) parts.push(`${s.unmerged} unmerged`);
  if (s.stashed) parts.push(`${s.stashed} stashed`);
  if (s.ahead || s.behind) parts.push(`ahead ${s.ahead}, behind ${s.behind}`);
  if (s.detached) parts.push("detached HEAD");
  return parts.length ? parts.join(" · ") : "clean";
}
