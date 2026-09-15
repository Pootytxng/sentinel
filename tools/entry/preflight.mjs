// The reconciler: compare everything that must agree, and produce a VERDICT — never a repair.
//
// A task must not begin until its Work Control issue, current mutation lease, actual session root,
// Git worktree, branch, dirty state, active processes, exact scope, and effective project settings
// agree. REFUSE always precedes the first write.
//
// Pure over injected facts. It never resets, checks out over, stashes, cleans, deletes a worktree, or
// kills a process. An expired lease yields a takeover DRAFT; expiry is an alarm, never permission.

import { BLOCKING_GATES, buildMenu, FALLBACK_POLICY } from "./select.mjs";
import { LOCAL_SETTINGS_PATH } from "./tier.mjs";
import { parseWorktreeField, samePath } from "./worktree-field.mjs";
import { overlapRemediation, scopeOverlapVerdict } from "./scope-overlap.mjs";
import { claimExpiry } from "./claim.mjs";

export const STARTABLE_STATUS = ["Ready", "Active"];
export { BLOCKING_GATES };
export const EXPECTED_SUBAGENT_MODEL = "sonnet";

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "").toLowerCase();

/**
 * Choose which task to run. An explicit issue is honoured so the checks explain any refusal.
 * Without an issue, only an Active lease held by the explicitly supplied executor may auto-resume;
 * Ready work is offered and never silently started.
 */
export function selectTask(items, { issue = null, self = { lane: null }, now = new Date(), policy = null, codeRoot = null } = {}) {
  if (issue !== null) {
    const task = (items ?? []).find((i) => Number(i.number) === Number(issue));
    if (!task) return { kind: "none", reason: `Issue #${issue} is not on the board.` };
    return { kind: "task", task };
  }

  const menu = buildMenu(items ?? [], { self, now, policy: policy ?? FALLBACK_POLICY, codeRoot });

  if (menu.autoResume !== null) {
    const task = (items ?? []).find((i) => Number(i.number) === menu.autoResume);
    return {
      kind: "task",
      task,
      auto: true,
      menu,
      reason: `#${task.number} is already leased to this executor — resuming it.`,
    };
  }

  if (menu.options.length === 0) {
    const why = menu.unavailable.length
      ? `Nothing is available to start. ${menu.unavailable.map((u) => `#${u.number} ${u.reason}`).join("; ")}.`
      : "No task is Ready and no live lease belongs to this executor — nothing to start. (Never invent work.)";
    return { kind: "none", reason: why, menu, options: [], unavailable: menu.unavailable };
  }

  return {
    kind: "choice",
    menu,
    options: menu.options,
    unavailable: menu.unavailable,
    reason: `${menu.options.length} task${menu.options.length === 1 ? " is" : "s are"} on offer. Choose one — the shortcut does not start work you did not ask for.`,
  };
}

const mk = (name, expected, actual, ok, remediation = null, note = null) => ({ name, expected, actual, ok, remediation, note });

export const REMEDIATION_ORDER = [
  "board.reachable",
  "task.status",
  "task.gate",
  "task.claim",
  "folder.writer",
  "scope.overlap",
  "processes",
  "git.clean",
  "git.branchElsewhere",
  "git.commonDir",
  "git.branch",
  "field.canonical",
  "base.pinned",
  "folder.exists",
  "settings.window",
  "settings.subagentModel",
  "board.nextAction",
  "hooks.present",
];

const remediationRank = (name) => {
  const i = REMEDIATION_ORDER.indexOf(name);
  return i === -1 ? REMEDIATION_ORDER.length : i;
};

// GitHub serves SSH on port 443 as ssh.github.com, so an origin spelled that way names github.com.
const SSH_OVER_HTTPS_HOSTS = new Map([["ssh.github.com", "github.com"]]);

// This repository's own server and path, whatever name a checkout's origin reaches it by.
const THIS_REPOSITORY = { host: "github.com", path: "pootytxng/sentinel" };

/**
 * The host and repository path an origin URL names, lowercased with the user, port, a trailing `.git`
 * and stray slashes dropped, so one repository's https, ssh:// and scp-style spellings agree (#421),
 * and whether it is reached over SSH, where the host may be a name from the SSH config.
 * A local path, a file:// URL or anything unparseable names no host, and returns null.
 */
function originIdentity(url) {
  const raw = String(url ?? "").trim();
  let host;
  let path;
  let ssh = true;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (scheme) {
    if (!/^(?:https?|ssh|git|git\+ssh|ssh\+git)$/i.test(scheme[1])) return null;
    ssh = /ssh/i.test(scheme[1]);
    try {
      ({ hostname: host, pathname: path } = new URL(raw));
    } catch {
      return null;
    }
  } else {
    // Git reads `[user@]host:path` as scp-style only when no slash comes before the colon, and one
    // letter before it is a Windows drive.
    const scp = /^(?:[^@/\\]+@)?([^:/\\]+):(.+)$/.exec(raw);
    if (!scp || scp[1].length === 1) return null;
    [, host, path] = scp;
  }
  host = host.toLowerCase().replace(/\.$/, "");
  host = SSH_OVER_HTTPS_HOSTS.get(host) ?? host;
  path = path.split(/[/\\]/).filter(Boolean).join("/").replace(/\.git$/i, "").toLowerCase();
  return /^[a-z0-9._-]+$/.test(host) && path ? { host, path, ssh } : null;
}

// A dotted name ending in an alphabetic label. Anything else, such as `github-work`, `github.com-work`
// or an IP address, may be an SSH config alias whose real host the URL does not name.
const isDnsName = (host) => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
// Over SSH even a DNS name may be an alias (`Host work.example.com` with `HostName github.com`), so
// only a DNS name reached without SSH says which server an origin is on.
const namesItsServer = (origin) => !origin.ssh && isDnsName(origin.host);

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

  checks.push(
    mk(
      "board.reachable",
      "Work Control responds",
      board.reachable ? "reachable" : `unreachable${board.error ? ` — ${board.error}` : ""}`,
      Boolean(board.reachable),
      "Work Control is the mutation-lease ledger. Being offline is not a licence to start unclaimed work.",
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
        : `#${task?.number} is ${status}; a task must be Ready (to start) or Active under this executor's mutation lease (to resume).`,
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

  let claimOk = true;
  let claimActual = "no claim";
  let takeoverDraft = null;
  if (claim) {
    const expiry = claimExpiry(claim.expires, { anchor: claim.postedAt });
    const expired = expiry ? expiry < now : false;
    const unidentified = !String(self?.lane ?? "").trim();
    const otherLane = !unidentified && claim.lane && claim.lane !== self.lane;
    const otherIssue = task && claim.issue && Number(claim.issue) !== Number(task.number);
    claimOk = !expired && !unidentified && !otherLane && !otherIssue;
    claimActual = expired
      ? `expired ${claim.expires} (executor ${claim.lane})`
      : unidentified
        ? `held by ${claim.lane ?? "an executor"}; current executor identity was not supplied`
        : otherLane
          ? `held by ${claim.lane}`
          : otherIssue
            ? `claims #${claim.issue}, not #${task?.number}`
            : `held by this executor until ${claim.expires}`;
    if (expired) {
      takeoverDraft = [
        "### Verified takeover",
        `- Previous lease: ${claim.lane} on ${claim.folder} @ ${claim.branch}, expired ${claim.expires}`,
        "- Worktree/process evidence checked: <fill from the preflight output above>",
        "- Preserved work: <what exists in the folder right now, untouched>",
        "- New executor/worktree/branch/scope:",
        "- New expiry:",
        "- Next action:",
        "",
        "Expiry is an alarm, not a takeover. Post this only after inspecting the real worktree and",
        "processes. No destructive Git as a first move.",
      ].join("\n");
    }
  }
  checks.push(
    mk(
      "task.claim",
      "no live lease, or this explicit executor holds it",
      claimActual,
      claimOk,
      takeoverDraft
        ? "The lease has expired. Inspect the folder and post a Verified takeover — never take over silently."
        : claim && !self?.lane
          ? "Supply the actual executor identity; an unidentified caller may not assume another model's lease."
          : null,
    ),
  );

  const parsed = parseWorktreeField(task?.worktreeBranch ?? "", { codeRoot: facts.codeRoot ?? null });
  const target = parsed.ok ? (parsed.entries[0] ?? null) : null;
  checks.push(
    mk(
      "field.canonical",
      "<folder> @ <branch>",
      parsed.ok ? (target ? `${target.path} @ ${target.branch}` : "none") : `unparseable — ${parsed.code}`,
      parsed.ok && target !== null,
      parsed.ok ? null : parsed.reason,
    ),
  );

  const targetPath = target?.path ?? null;
  const targetBranch = target?.branch ?? null;

  const otherWriter = (items ?? []).find((i) => {
    if (Number(i.number) === Number(task?.number)) return false;
    if (i.status !== "Active") return false;
    const p = parseWorktreeField(i.worktreeBranch ?? "", { codeRoot: facts.codeRoot ?? null });
    return p.ok && p.entries.some((e) => targetPath && samePath(e.path, targetPath));
  });
  checks.push(
    mk(
      "folder.writer",
      "no other Active item in this folder",
      otherWriter ? `#${otherWriter.number} (${otherWriter.lane}) is Active in this folder` : "none",
      !otherWriter,
      otherWriter ? "One folder, one writer. A different branch does not make concurrent writes safe." : null,
    ),
  );

  const scopeFacts = facts?.scope ?? null;
  const overlap = scopeFacts
    ? scopeOverlapVerdict(scopeFacts)
    : { ok: false, reason: "not gathered — unknown means locked", findings: [], unknown: [], undeclared: false };
  checks.push(
    mk(
      "scope.overlap",
      "no path covered by another active mutation lease",
      overlap.reason,
      overlap.ok,
      overlap.ok
        ? null
        : scopeFacts
          ? overlapRemediation(overlap)
          : "Reconcile facts from gatherFacts(), which measures scopes; a verdict without them is not a verdict.",
    ),
  );

  const existing = (checkouts ?? []).find((c) => targetPath && samePath(c.path, targetPath)) ?? null;
  // A branch name means one branch only inside one repository (#421), so another project using the
  // same name is no collision. This repository is the expected common dir and the target folder's
  // own, with every origin a checkout in them reports, so a separate clone of the same remote still
  // counts. Origins compare by host and path, so one repository's https, ssh:// and scp-style
  // spellings agree while the same owner/name on another host is another repository. A checkout is
  // set aside as another repository's only when its common dir and origin are both known, this
  // repository's origin is known too, and neither matches. With the same path on another host, that
  // takes a holder whose origin names its server, and a known server for this repository that differs:
  // its own address, or a checkout's origin that names its server too. A holder at this repository's
  // own address is this repository. Anything less is unknown identity, and unknown stays locked.
  const repoDirs = [expectedCommonDir, existing?.commonDir].filter(Boolean);
  const inRepoDirs = (c) => Boolean(c.commonDir) && repoDirs.some((d) => samePath(c.commonDir, d));
  const repoOrigins = (checkouts ?? []).filter(inRepoDirs).map((c) => originIdentity(c.remote)).filter(Boolean);
  const identity = (c) => {
    const origin = originIdentity(c.remote);
    if (inRepoDirs(c) || (origin && repoOrigins.some((r) => r.host === origin.host && r.path === origin.path))) return "same";
    if (!c.commonDir || !origin || !repoOrigins.length) return "unknown";
    if (!repoOrigins.some((r) => r.path === origin.path)) return "other";
    if (!namesItsServer(origin)) return "alias";
    if (origin.host === THIS_REPOSITORY.host && origin.path === THIS_REPOSITORY.path) return "same";
    const serverKnown = origin.path === THIS_REPOSITORY.path || repoOrigins.some((r) => r.path === origin.path && namesItsServer(r));
    return serverKnown ? "other" : "alias";
  };
  const onBranch = (checkouts ?? []).filter(
    (c) => targetBranch && c.branch === targetBranch && !(targetPath && samePath(c.path, targetPath)),
  );
  const otherRepos = onBranch.filter((c) => identity(c) === "other");
  const holders = onBranch.filter((c) => identity(c) !== "other");
  // A definite conflict is named before an unidentified one, whatever order discovery found them in.
  const branchElsewhere = holders.find((c) => identity(c) === "same") ?? holders[0] ?? null;
  const holderIdentity = branchElsewhere ? identity(branchElsewhere) : null;
  const unidentified = holderIdentity === "unknown" || holderIdentity === "alias";
  // Git refuses a branch only while a worktree of the same common dir holds it: the task folder's
  // own, or the expected one a new folder is created from. A separate clone keeps its own branches,
  // so a conflict with one is this project's rule alone. With either common dir unknown, so is what
  // Git would do.
  const folderCommonDir = existing ? existing.commonDir : expectedCommonDir;
  const commonDirsKnown = holderIdentity === "same" && Boolean(folderCommonDir && branchElsewhere.commonDir);
  const gitRefuses = commonDirsKnown && samePath(branchElsewhere.commonDir, folderCommonDir);

  if (!existing && targetPath && !branchElsewhere) actions.push("create-worktree");
  checks.push(
    mk(
      "folder.exists",
      "exists, or is safely creatable",
      existing ? "exists" : branchElsewhere ? "absent, and its branch is taken" : "absent (creatable)",
      Boolean(existing) || (Boolean(targetPath) && !branchElsewhere),
      existing ? null : "The worktree will be created from the exact commit this verdict names, into a path that does not yet exist.",
    ),
  );

  if (base) {
    const pinned = Boolean(base.ok && /^[0-9a-f]{40}$/.test(base.sha ?? ""));
    checks.push(
      mk(
        "base.pinned",
        "one immutable commit id",
        pinned ? base.sha : `unresolved — ${base.error ?? "no commit id"}`,
        pinned,
        pinned
          ? null
          : `${base.ref ?? "The base ref"} does not resolve to a commit in the host checkout, so there is nothing safe to create from.`,
        pinned ? `${base.ref} pinned at ${base.sha.slice(0, 7)} — settings and creation use this same commit` : null,
      ),
    );
  }

  checks.push(
    mk(
      "git.branchElsewhere",
      "branch checked out nowhere else in this repository",
      branchElsewhere
        ? `${targetBranch} is checked out in ${branchElsewhere.path}${unidentified ? ", a checkout whose repository could not be told apart from this one" : ""}`
        : "nowhere else",
      !branchElsewhere,
      !branchElsewhere
        ? null
        : holderIdentity === "alias"
          ? "Its origin has this repository's path on another host, but a host reached over SSH, or one that does not read as a DNS name, leaves the real server unnamed, so it may be the same server under another name, such as an SSH config alias. It is treated as this repository: unknown identity stays locked."
          : unidentified
            ? "Without a common dir and a hosted origin on both sides to compare, it is treated as this repository: unknown identity stays locked."
            : gitRefuses
              ? "Git would refuse this too, but later and less legibly."
              : commonDirsKnown
                ? "Git itself would not refuse this: a separate clone keeps its own branches. This project does: a branch of this repository is checked out in one folder at a time, across all its clones."
                : "This project refuses it: a branch of this repository is checked out in one folder at a time, across all its clones. Whether Git would too is not known without both common dirs.",
      otherRepos.length
        ? `also on ${targetBranch} in another repository, so not a conflict: ${otherRepos.map((c) => c.path).join(", ")}`
        : null,
    ),
  );

  checks.push(
    mk(
      "git.commonDir",
      expectedCommonDir ?? "(the expected repository)",
      existing ? existing.commonDir : "(folder absent)",
      !existing || !expectedCommonDir || samePath(existing.commonDir, expectedCommonDir),
      "The folder must belong to the repository the task is about.",
    ),
  );

  const branchOk = !existing ? true : Boolean(gitState?.ok) && !gitState.detached && gitState.branch === targetBranch;
  checks.push(
    mk(
      "git.branch",
      targetBranch ?? "(unknown)",
      !existing ? "(folder absent)" : gitState?.detached ? "detached HEAD" : (gitState?.branch ?? "(unreadable)"),
      branchOk,
      branchOk ? null : "The folder is real but is not on the claimed branch. Refuse rather than check out over current state.",
    ),
  );

  const cleanOk = !existing ? true : Boolean(gitState?.clean);
  checks.push(
    mk(
      "git.clean",
      "clean: no modified, untracked, staged, stashed or divergent state",
      !existing ? "(folder absent)" : describeState(gitState),
      cleanOk,
      cleanOk ? null : "Reported, not cleared. Decide what to do with this work before reusing the folder.",
    ),
  );

  if (win) {
    const same = win.effective.window === win.intended.window;
    const configured = win.effective.configured !== false;
    const snapshot = win.effective.snapshot ?? null;
    const plan = win.plan ?? null;
    const establishing = plan?.action === "write";
    const ok = establishing ? true : plan?.action === "refuse" ? false : same && configured;
    const provenance = configured
      ? `${win.effective.window} from ${win.effective.file}`
      : `nothing configures it${snapshot ? ` in ${snapshot}` : ""}, so ${win.effective.window} is the documented fallback`;

    checks.push(
      mk(
        "settings.window",
        win.intended.window,
        win.effective.window,
        ok,
        ok
          ? null
          : plan?.action === "refuse"
            ? plan.reason
            : !configured
              ? `Not configured${snapshot ? ` in ${snapshot}` : ""} — ${win.effective.window} is the documented fallback, not a decision.`
              : `Comes from ${win.effective.file}. Change it there, or route to the folder whose policy matches.`,
        establishing
          ? `${provenance} — the launcher will establish ${win.intended.window} for this folder in ${LOCAL_SETTINGS_PATH} (per-machine, not tracked): ${win.intended.reason}`
          : ok && snapshot
            ? `from ${snapshot} — the folder does not exist yet, so this is the snapshot it will be created from`
            : null,
      ),
    );
  }

  if (subagentModel) {
    checks.push(
      mk(
        "settings.subagentModel",
        EXPECTED_SUBAGENT_MODEL,
        subagentModel.value,
        subagentModel.value === EXPECTED_SUBAGENT_MODEL,
        subagentModel.value === EXPECTED_SUBAGENT_MODEL ? null : `Set in ${subagentModel.source}.`,
      ),
    );
  }

  if (hooks) {
    const staleCount = hooks.stale?.length ?? 0;
    checks.push(
      mk(
        "hooks.present",
        `${hooks.checked?.length ?? 0} registered hooks present`,
        hooks.ok ? "all present" : `${hooks.missing.length} missing`,
        Boolean(hooks.ok),
        hooks.remediation,
        staleCount
          ? `${staleCount} stale overlay entr${staleCount === 1 ? "y" : "ies"} to take back — the launcher removes ${staleCount === 1 ? "it" : "them"} on this run`
          : null,
      ),
    );
  }

  const contending = (processes ?? []).filter((p) => p.contends);
  checks.push(
    mk(
      "processes",
      "nothing contending with this folder",
      (processes ?? []).length
        ? processes.map((p) => `${p.name} ×${p.count}${p.note ? ` (${p.note})` : ""}`).join(", ")
        : "none",
      contending.length === 0,
      contending.length
        ? "Wait for it, or work elsewhere. Never stop another tool's build, helper or session just to clear a lease."
        : null,
    ),
  );

  const boardNext = task?.nextAction ?? null;
  const handoffNext = handoff?.nextAction ?? null;
  checks.push(
    mk(
      "board.nextAction",
      handoffNext ?? "(no handoff yet)",
      boardNext ?? "(empty)",
      handoffNext === null || norm(handoffNext) === norm(boardNext),
      handoffNext === null || norm(handoffNext) === norm(boardNext)
        ? null
        : "The board's Next action has drifted from the newest durable handoff. The handoff is the record; the field is the index.",
    ),
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    verdict: failed.length === 0 ? "PASS" : "REFUSE",
    checks,
    actions,
    takeoverDraft,
    remediation: [...failed]
      .sort((a, b) => remediationRank(a.name) - remediationRank(b.name))
      .map((c) => c.remediation)
      .filter(Boolean),
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
  if (s.stashedElsewhere) parts.push(`${s.stashedElsewhere} stashed on other branches (shared stack, not this folder's)`);
  if (s.ahead || s.behind) parts.push(`ahead ${s.ahead}, behind ${s.behind}`);
  if (s.detached) parts.push("detached HEAD");
  return parts.length ? parts.join(" · ") : "clean";
}
