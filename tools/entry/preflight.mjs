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
import { normalizePattern, outsideScope, parseScopePatterns } from "../../scripts/lib/claim-scope.mjs";

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

// ── the continuing holder (#648) ─────────────────────────────────────────────────────────────────
//
// `reconcile` asks whether a session may BEGIN in a folder, and a session already working there fails
// it twice by doing its job: its alarm may have passed, and a folder being worked in is never clean.
// On #552 that left the one session allowed to write in its folder with no way to renew its lease.
//
// `reconcileHolder` asks the other question: is this the same executor and the same live session, in
// the same folder, on the same branch, with the same scope. It is asked beside `reconcile`, never
// instead of it. Every row a holder does not change is carried over exactly as `reconcile` measured
// it, and the caller measures the holder and hands it in, so an observation that is missing refuses.

export const HOLDER_REMEDIATION_ORDER = [
  "board.reachable",
  "task.status",
  "task.gate",
  "task.claim",
  "holder.session",
  "holder.caller",
  "holder.folder",
  "holder.branch",
  "scope.unchanged",
  "folder.writer",
  "scope.overlap",
  "processes",
  "git.withinLease",
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

const holderRank = (name) => {
  const i = HOLDER_REMEDIATION_ORDER.indexOf(name);
  return i === -1 ? HOLDER_REMEDIATION_ORDER.length : i;
};

const DIRTY_KINDS = ["modified", "staged", "untracked"];
const shown = (value) => value || "(none)";
const shortId = (id) => String(id ?? "").slice(0, 8) || "(none)";
const listed = (patterns) => (patterns.length ? patterns.join(", ") : "(no path)");
/** A scope as a set: order, case and a trailing slash do not make it a different scope. */
const patternSet = (patterns) => [...new Set(patterns.map((p) => normalizePattern(p).toLowerCase()).filter(Boolean))].sort();
/** One line of plain text. Whatever a process, a session or a folder calls itself, it cannot break the table a verdict is posted as. */
const plain = (text) => String(text ?? "").replace(/[|`\r\n]+/g, " ").trim();

/** How many processes a command's ancestry is read through, the command and its session program both counted. */
export const CALLER_MAX_HOPS = 12;
/** The native list stamps a session a moment after its program is created. One stamped earlier than this before it is some other process. */
const START_SKEW_MS = 5000;
/** The session program, by its exact name. The name only finds it: the file it runs from is what is compared. */
export const isSessionProgram = (name) => /^claude\.exe$/i.test(String(name ?? ""));
/** A program that installs, by the sweep classifier's own rule. An install is machine-wide, so one is never set aside. */
export const isInstallerProgram = (name) => /setup\.exe$|installer\.exe$|^msiexec\.exe$/i.test(String(name ?? ""));

const INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
/** An ISO instant as milliseconds and the nanoseconds past them, or null. `Date.parse` alone reads far looser text. */
function instant(text) {
  const m = typeof text === "string" ? INSTANT.exec(text) : null;
  if (!m) return null;
  const digits = (m[2] ?? "").padEnd(9, "0");
  const ms = Date.parse(`${m[1]}.${digits.slice(0, 3)}${m[3]}`);
  return Number.isFinite(ms) ? { ms, ns: Number(digits.slice(3)) } : null;
}
const isAfter = (a, b) => (a.ms !== b.ms ? a.ms > b.ms : a.ns > b.ns);
/** One process, as itself: a process id is reused, a process id with its creation instant is not. */
const identityOf = (p) => `${p.pid}@${p.created}`;
/**
 * A process a by-process reading identified: an id, a creation instant and a name. Short of any one
 * it cannot be told from another process, so the check refuses a reading that holds one, and the
 * observer never folds one into a count.
 */
export const isIdentified = (p) =>
  Boolean(p) && typeof p === "object" && Number.isInteger(p.pid) && p.pid > 0 && instant(p.created) !== null && typeof p.name === "string" && p.name.trim() !== "";

/**
 * Who is asking (#648). A renewal is admitted on what the command MEASURED about itself, and this is
 * the one place that decides whether the measurement holds. Nothing here is taken on the command's
 * word: not a session id, not a root, not a flag that says it was verified.
 *
 * Established only when all of this is read from the machine and agrees:
 *   - the command's own process chain, whole and unbroken, each process started by the next and
 *     created after it, ending at the first session program it reaches;
 *   - that session program running from the native program's own file;
 *   - the native session list naming exactly one session for that one process, and it being the
 *     interactive session the command was handed, listed once, started no earlier than its program.
 *
 * The root is the one the native list gives that session. `own` is the chain, each process by its id
 * and creation instant, command first and session program last: the only processes ever set aside.
 *
 * @param {object} holder `{ sessionId, caller: { pid, cli, chain: { ok, rows }, sessions: { ok, entries } } }`
 * @returns {{verified: boolean, why: string|null, host: object|null, session: object|null, root: string|null, own: string[], pids: number[], installers: string[], identity: string|null}}
 */
export function callerWitness(holder) {
  const no = (why) => ({ verified: false, why, host: null, session: null, root: null, own: [], pids: [], installers: [], identity: null });

  const caller = holder?.caller;
  if (!caller || typeof caller !== "object") return no("nothing was measured about the command that asked");
  const pid = caller.pid;
  if (!Number.isInteger(pid) || pid <= 0) return no("the command's own process id was not measured");

  const rows = caller.chain?.ok === true && Array.isArray(caller.chain.rows) ? caller.chain.rows : [];
  if (rows.length === 0) return no("its process chain could not be read");
  if (rows.length > CALLER_MAX_HOPS) {
    return no(`its process chain is ${rows.length} processes long, past the ${CALLER_MAX_HOPS} a command's ancestry is read to`);
  }
  const whole = (p) =>
    Boolean(p) &&
    typeof p === "object" &&
    Number.isInteger(p.pid) &&
    p.pid > 0 &&
    Number.isInteger(p.parentPid) &&
    p.parentPid >= 0 &&
    instant(p.created) !== null &&
    typeof p.name === "string" &&
    p.name.trim() !== "";
  const unread = rows.findIndex((p) => !whole(p));
  if (unread !== -1) return no(`its process chain has a process that was not read in full (step ${unread + 1})`);

  const pids = rows.map((p) => p.pid);
  const twice = pids.find((id, i) => pids.indexOf(id) !== i);
  if (twice !== undefined) return no(`its process chain names process ${twice} twice`);
  if (rows[0].pid !== pid) return no(`its process chain starts at process ${rows[0].pid}, not at the command (${pid})`);
  for (let i = 0; i + 1 < rows.length; i++) {
    const [child, parent] = [rows[i], rows[i + 1]];
    if (child.parentPid !== parent.pid) {
      return no(`its process chain breaks: process ${child.pid} was started by ${child.parentPid}, and the next one read is ${parent.pid}`);
    }
    // A parent outlives the moment it starts a child. One created later is another process under a reused id.
    if (isAfter(instant(parent.created), instant(child.created))) {
      return no(`process ${parent.pid} was created after process ${child.pid}, which it is said to have started; a process id was reused`);
    }
  }
  const early = rows.slice(0, -1).find((p) => isSessionProgram(p.name));
  if (early) return no(`its process chain runs through session program ${early.pid} and on past it`);
  const host = rows[rows.length - 1];
  if (!isSessionProgram(host.name)) return no(`its process chain reaches no session program: it ends at ${plain(host.name)} ${host.pid}`);
  if (rows.length < 2) return no("the command is itself the session program, where a renewal is a command run under one");

  // The name found it. Which program it is, is the file it runs from.
  if (typeof caller.cli !== "string" || caller.cli.trim() === "") return no("no native session program was found on this machine to compare against");
  if (typeof host.executable !== "string" || host.executable.trim() === "") return no(`the file session program ${host.pid} runs from was not read`);
  if (!samePath(host.executable, caller.cli)) return no(`session program ${host.pid} runs from a file that is not the native one`);

  const entries = caller.sessions?.ok === true && Array.isArray(caller.sessions.entries) ? caller.sessions.entries : null;
  if (entries === null) return no("the native session list could not be read");
  const hosted = entries.filter((e) => e && typeof e === "object" && e.pid === host.pid);
  if (hosted.length === 0) return no(`the native session list names no session for process ${host.pid}`);
  if (hosted.length > 1) return no(`the native session list names ${hosted.length} sessions for process ${host.pid}`);
  const session = hosted[0];
  // The id the command was handed is only ever checked against the list. It selects nothing.
  const handed = typeof holder?.sessionId === "string" ? holder.sessionId.trim() : "";
  if (!handed) return no("the command was handed no session id to check against the native session list");
  if (session.sessionId !== handed) return no(`process ${host.pid} is session ${plain(shortId(session.sessionId))}, not ${plain(shortId(handed))}`);
  const named = entries.filter((e) => e && typeof e === "object" && e.sessionId === handed).length;
  if (named !== 1) return no(`the native session list names session ${plain(shortId(handed))} ${named} times`);
  if (session.kind !== "interactive") {
    const kind = typeof session.kind === "string" ? plain(session.kind) : "";
    return no(`session ${plain(shortId(handed))} is ${kind ? `a ${kind} session` : "of no stated kind"}, not an interactive one`);
  }
  if (typeof session.cwd !== "string" || session.cwd.trim() === "") return no("the native session list gives that session no folder");
  if (typeof session.startedAt !== "number" || !Number.isFinite(session.startedAt)) return no("the native session list gives that session no start time");
  if (session.startedAt < instant(host.created).ms - START_SKEW_MS) {
    return no("the native session list says that session started before its own program was created; a process id was reused");
  }

  const own = rows.map(identityOf);
  return {
    verified: true,
    why: null,
    host: { pid: host.pid, created: host.created, name: host.name },
    session: { sessionId: handed, kind: session.kind, pid: session.pid, cwd: session.cwd },
    root: session.cwd,
    own,
    pids,
    installers: rows.filter((p) => isInstallerProgram(p.name)).map((p) => `${plain(p.name)} ${p.pid}`),
    // Everything a second measurement must find unchanged: the same chain, under the same session, in the same folder.
    identity: [...own, handed, session.kind, session.cwd].join(" "),
  };
}

/**
 * May the session that holds this lease renew it? Admitted only when every one of these is measured:
 * the lease's own executor, this exact live session, a command measured to run under that session
 * (`callerWitness`), the same folder as that session's native root, the same branch, an unchanged
 * scope, every dirty path inside that scope, and nothing contending for the folder but that command's
 * own process chain. Expiry is disclosed and never gates: it is an alarm, and the holder is who it
 * rings for. Nothing is created and no takeover is drafted, because a holder renewing its own lease
 * takes nothing over.
 *
 * Nothing the command was handed admits it. A session id is only checked against the native list, a
 * root it was given is only shown, and a process is set aside by its id and creation instant on the
 * measured chain: never by a name, a count or who started it, and never when it is an installer.
 *
 * No row's `expected` or `actual` carries a backtick, a pipe or a newline: a passing verdict is posted
 * as the claim's table, and one broken cell hides every row after it.
 *
 * @param {object} facts everything `reconcile` reads, plus `holder`: what the renewing command
 *        measured about itself (`observeHolder` in launch.mjs) —
 *        `{ sessionId, caller: { pid, cli, chain: { ok, rows }, sessions: { ok, entries },
 *        snapshot: { ok, takenAt, rows, others } }, root: { path, source }, record, recordState,
 *        liveness, sweeper, since }`. `since` is the witness identity a first measurement admitted;
 *        a second one, taken immediately before the write, must match it.
 * @returns {{verdict: "PASS"|"REFUSE", checks: Array, remediation: string[], actions: string[], takeoverDraft: null}}
 */
export function reconcileHolder(facts) {
  const {
    task = null,
    claim = null,
    holder = null,
    checkouts = [],
    gitState = null,
    processes = [],
    self = { lane: null },
    now = new Date(),
  } = facts ?? {};
  const fresh = reconcile(facts);

  // The folder and branch the board names, resolved exactly as `reconcile` resolves them.
  const parsed = parseWorktreeField(task?.worktreeBranch ?? "", { codeRoot: facts?.codeRoot ?? null });
  const target = parsed.ok ? (parsed.entries[0] ?? null) : null;
  const targetPath = target?.path ?? null;
  const targetBranch = target?.branch ?? null;
  const existing = (checkouts ?? []).find((c) => targetPath && samePath(c.path, targetPath)) ?? null;

  const status = task?.status ?? null;
  const statusRow = mk(
    "task.status",
    "Active",
    status ?? "(no task)",
    status === "Active",
    status === "Active"
      ? null
      : `#${task?.number} is ${status ?? "not on the board"}; only an Active lease is renewed. Ready work starts through the launcher, and work that has left Active is no longer this session's to extend.`,
  );

  // A lane names a seat, not who sits in it, so a lane alone never admits: the lease must record an
  // executor, and it must be this one.
  const lane = String(self?.lane ?? "").trim();
  const executor = String(self?.executor ?? self?.lane ?? "").trim();
  const leaseLane = String(claim?.lane ?? "").trim();
  const leaseExecutor = String(claim?.executor ?? "").trim();
  const identified = lane !== "" && executor !== "";
  const otherIssue = Boolean(claim && task && claim.issue && Number(claim.issue) !== Number(task.number));
  const sameExecutor = identified && leaseLane === lane && leaseExecutor !== "" && leaseExecutor === executor;
  const leaseOk = Boolean(claim) && !otherIssue && sameExecutor;
  // Read to be disclosed, never to gate.
  const expiry = claim ? claimExpiry(claim.expires, { anchor: claim.postedAt }) : null;
  const alarmPassed = expiry ? expiry < now : false;
  const claimRow = mk(
    "task.claim",
    "a thread-live lease held by this exact executor",
    !claim
      ? "no thread-live lease to renew"
      : otherIssue
        ? `the lease that was read is for #${claim.issue}, not #${task?.number}`
        : !identified
          ? `held by ${leaseExecutor || leaseLane || "an executor"}; this caller's executor identity was not supplied`
          : !sameExecutor
            ? `held by executor ${leaseExecutor || "(none recorded)"} in lane ${leaseLane || "(none)"}, not by ${executor} in lane ${lane}`
            : alarmPassed
              ? `held by this executor; its alarm passed ${claim.expires} — an alarm, not a release`
              : `held by this executor until ${claim.expires}`,
    leaseOk,
    leaseOk
      ? null
      : !claim
        ? "There is no live lease on this thread to renew: it was released, or never posted. A renewal restates a lease that exists; a new one starts through the launcher."
        : otherIssue
          ? "The lease that was read belongs to another issue. Renew on the issue this folder's lease is posted on."
          : !identified
            ? "Supply the actual executor identity; an unidentified caller may not renew another executor's lease."
            : "Only the executor that holds a lease renews it, and a lane name alone never admits. A lease changes hands by its holder's own handoff, never by a renewal.",
  );

  // The folder keeps one session record, so the record naming this session is what says no other
  // session holds the folder. Liveness is measured for that record; anything short of live is unknown.
  const sessionId = typeof holder?.sessionId === "string" ? holder.sessionId.trim() : "";
  const record = holder?.record && typeof holder.record === "object" ? holder.record : null;
  const liveness = holder?.liveness ?? "none";
  const sameSession = Boolean(sessionId) && Boolean(record) && record.sessionId === sessionId;
  const sameIssue = Boolean(record) && Boolean(task) && Number(record.issue) === Number(task.number);
  const sessionOk = sameSession && sameIssue && liveness === "live";
  const sessionRow = mk(
    "holder.session",
    "this exact session holds the folder's own record for this issue, and is measured live",
    !holder
      ? "not observed"
      : !sessionId
        ? "no session id was supplied"
        : !record
          ? holder.recordState === "corrupt"
            ? "this folder's session record could not be read"
            : "this folder has no session record"
          : record.sessionId !== sessionId
            ? `this folder's record names session ${shortId(record.sessionId)}, not ${shortId(sessionId)}`
            : !sameIssue
              ? `session ${shortId(sessionId)} is recorded on #${record.issue ?? "(none)"}, not #${task?.number}`
              : liveness !== "live"
                ? `session ${shortId(sessionId)} holds the record but was not measured live (${liveness})`
                : `session ${shortId(sessionId)} holds this folder's record and is live`,
    sessionOk,
    sessionOk
      ? null
      : "Renew from the session that holds this folder, under its own session id. A session nobody launched is adopted first (cli.mjs adopt). A session that cannot be measured live stays locked: unknown is not live.",
  );

  // Who is asking. Where the command is rooted, and which processes are its own, are both read from
  // this witness and from nothing the command was handed. A second measurement, taken immediately
  // before the write, must find the very witness the first one admitted.
  const witness = callerWitness(holder);
  const stable = holder?.since === undefined || witness.identity === holder.since;
  const callerOk = witness.verified && stable;
  const steps = witness.own.length - 1;
  const callerRow = mk(
    "holder.caller",
    "this command is measured to run under the session it names: its own process chain reaches the native session program, and the native session list names that one process as this session",
    !witness.verified
      ? `not established: ${witness.why}`
      : !stable
        ? "not stable: what this command measured about itself changed between the check and the write"
        : `command ${witness.pids[0]} reaches ${plain(witness.host.name)} ${witness.host.pid} in ${steps} ${steps === 1 ? "step" : "steps"}, and the native session list names that process as ${plain(witness.session.kind)} session ${plain(shortId(witness.session.sessionId))}`,
    callerOk,
    callerOk
      ? null
      : !witness.verified
        ? "A renewal is admitted only when this command is measured to be running under the session that holds the lease. Its own process chain, read from the machine, must reach the native session program, and the native session list must name that one process as this session. A session id, a folder or an environment setting handed to the command shows none of that, and setting one by hand is not a way through. Run the renewal from inside the session itself; if the machine cannot be read, the lease stays locked until it can."
        : "The command, its session or its process chain changed between the check and the write, so nothing was posted. Run the renewal again from inside the session itself.",
  );

  // The root that counts is the folder the native session list gives the session this command is
  // measured to run under. One it was handed, or worked out from where it ran, is a guess: any shell
  // can stand in a leased folder and hand over the session id recorded there. A guess is shown as
  // one, beside what it agrees with, and is never read to decide.
  const handed = holder?.root ?? null;
  const rootPath = witness.verified ? witness.root : null;
  const sameFolder = Boolean(targetPath) && [rootPath, claim?.folder, record?.folder].every((f) => f && samePath(f, targetPath));
  const folderOk = witness.verified && sameFolder;
  const rootShown = witness.verified
    ? `${plain(witness.root)} (native session list, for the session this command runs under; observed)`
    : handed?.path
      ? `${plain(handed.path)} (${plain(handed.source) || "source not stated"}; not observed)`
      : "(none)";
  const folderRow = mk(
    "holder.folder",
    targetPath ? `the native root of the session this command runs under, the lease and the session record all name ${targetPath}` : "(no folder on the board)",
    `root ${rootShown} · lease ${shown(claim?.folder)} · record ${shown(record?.folder)}`,
    folderOk,
    folderOk
      ? null
      : !witness.verified
        ? "The folder this command runs under was not measured: the one shown was worked out from where the command ran, or handed in. Any shell can stand in a leased folder and name the session recorded there, so a guess never admits. The root that counts is the one the native session list gives for the session this command is measured to run under (see holder.caller). Do not name or set one by hand: that is still a guess, and it is not a way through."
        : "Run the renewal from inside the leased folder, as the session recorded there. A root, a lease or a session record that names another folder is a different lease, and renewing moves none.",
  );

  // The checkout is read whether or not the folder was found among the checkouts: a branch nobody
  // could read is not the board's branch.
  const checkedOut = !gitState?.ok ? "(unreadable)" : gitState.detached ? "detached HEAD" : shown(gitState.branch);
  const branchOk =
    Boolean(targetBranch) &&
    claim?.branch === targetBranch &&
    record?.branch === targetBranch &&
    Boolean(gitState?.ok) &&
    !gitState.detached &&
    gitState.branch === targetBranch;
  const branchRow = mk(
    "holder.branch",
    targetBranch ? `the lease, the session record and the checkout are all on ${targetBranch}` : "(no branch on the board)",
    `lease ${shown(claim?.branch)} · record ${shown(record?.branch)} · checked out ${checkedOut}`,
    branchOk,
    branchOk
      ? null
      : "The lease, the session record and the checkout must already be on the board's branch. A renewal checks out nothing and moves no lease to another branch.",
  );

  // Compared as parsed paths, and printed that way: the raw scope text carries backticks.
  const scopeFacts = facts?.scope ?? null;
  const leasePatterns = parseScopePatterns(claim?.scope);
  const measured = Array.isArray(scopeFacts?.mine) ? scopeFacts.mine.map(normalizePattern).filter(Boolean) : null;
  const leaseSet = patternSet(leasePatterns);
  const measuredSet = patternSet(measured ?? []);
  const scopeOk = Boolean(claim) && measured !== null && leaseSet.length === measuredSet.length && leaseSet.every((p, i) => p === measuredSet[i]);
  const scopeRow = mk(
    "scope.unchanged",
    claim ? `the lease's own scope, restated unchanged: ${listed(leasePatterns)}` : "the lease's own scope, restated unchanged",
    !claim
      ? "no lease to compare against"
      : measured === null
        ? "not gathered — unknown means locked"
        : scopeOk
          ? `unchanged: ${listed(measured)}`
          : `this run measured ${listed(measured)}`,
    scopeOk,
    scopeOk ? null : "A renewal restates the lease's scope and never widens or narrows it. A different scope is a different claim, not a renewal.",
  );

  const existsRow = mk(
    "folder.exists",
    "exists",
    existing ? "exists" : "absent",
    Boolean(existing),
    existing ? null : "A renewal creates nothing. A folder that is not there is a fresh launch, not a renewal.",
  );

  // A working folder is never clean, so the question is where the work is: every dirty path, by the
  // list git gave, inside the lease being restated. A count with no list behind it cannot be checked.
  const pathsOf = (kind) => (Array.isArray(gitState?.files?.[kind]) ? gitState.files[kind] : []);
  const dirty = [...new Set(DIRTY_KINDS.flatMap(pathsOf))];
  const unlisted = DIRTY_KINDS.filter((kind) => Number(gitState?.[kind] ?? 0) !== pathsOf(kind).length);
  const unmerged = Math.max(Number(gitState?.unmerged ?? 0), pathsOf("unmerged").length);
  const outside = outsideScope(dirty, leasePatterns);
  const readable = Boolean(existing) && Boolean(gitState?.ok);
  const withinOk = readable && !gitState.detached && !gitState.stashed && unmerged === 0 && unlisted.length === 0 && outside.length === 0;
  const state = [];
  if (readable) {
    for (const kind of DIRTY_KINDS) if (pathsOf(kind).length) state.push(`${kind}: ${pathsOf(kind).join(", ")}`);
    for (const kind of unlisted) state.push(`${gitState[kind] ?? 0} ${kind} counted but ${pathsOf(kind).length} listed, so they cannot be checked`);
    if (outside.length) state.push(`outside the lease scope: ${outside.join(", ")}`);
    if (unmerged) state.push(`${unmerged} unmerged${pathsOf("unmerged").length ? `: ${pathsOf("unmerged").join(", ")}` : ""}`);
    if (gitState.detached) state.push("detached HEAD");
    if (gitState.stashed) state.push(`${gitState.stashed} stashed on this branch`);
    if (gitState.stashedElsewhere) state.push(`${gitState.stashedElsewhere} stashed on other branches (shared stack, not this folder's)`);
    if (gitState.ahead || gitState.behind) state.push(`ahead ${gitState.ahead ?? 0}, behind ${gitState.behind ?? 0}`);
  }
  const withinRow = mk(
    "git.withinLease",
    "every dirty path listed and inside the lease scope; nothing unmerged, detached or stashed on this branch",
    !existing ? "(folder absent)" : !gitState?.ok ? "(unreadable)" : state.length ? state.join(" · ") : "clean",
    withinOk,
    withinOk
      ? null
      : "Reported, not cleared. Every dirty path must be listed and sit inside the lease being restated; unmerged paths, a detached head, a stash on this branch and git state that cannot be read all refuse. Settle those first: a renewal never widens the scope to fit the folder.",
  );

  // The sweep names programs, never owners: it counts the renewing command against the folder it runs
  // from, and cannot say that a build, a session or an installer is the holder's own. It must be
  // known to have run (one that ran lists the program that ran it; an empty one is a probe that did
  // not answer), and an entry nobody classified refuses as it always did. An install is machine-wide
  // here as in the by-process reading: an installer the sweep lists refuses however the sweep judged
  // it, called quiet included. The stock classifier never calls one quiet, and nothing leans on that.
  const sweep = processes ?? [];
  const sweeper = plain(holder?.sweeper);
  const answered = sweeper !== "" && sweep.some((p) => String(p?.name ?? "").toLowerCase() === sweeper.toLowerCase());
  const standing = (p) => (p.note ? ` (${plain(p.note)})` : p.contends === false ? "" : p.contends === true ? " (contending)" : " (not classified)");
  const sweptInstallers = sweep.filter((p) => isInstallerProgram(p?.name));
  const found =
    sweep.map((p) => `${plain(p.name)} ×${p.count}${standing(p)}`).join(", ") +
    (sweptInstallers.length ? `; an installer is never set aside, and the sweep lists one: ${sweptInstallers.map((p) => `${plain(p.name)} ×${p.count}`).join(", ")}` : "");
  const loose = sweep.filter((p) => typeof p?.contends !== "boolean");

  // What sets a process aside is the by-process reading, and only this: the process is on the
  // command's own measured chain, by its id AND its creation instant, shown once and as the program
  // the chain names there. Not its name, not how many there are, not who started it, and never an
  // installer, on the chain or anywhere in the reading. Everything else that contends, or that could
  // not be judged, refuses a holder as it refuses a fresh entry.
  const reading = holder?.caller?.snapshot ?? null;
  const taken = reading?.ok === true;
  const seen = (p) => isIdentified(p) && (typeof p.contends === "boolean" || p.contends === null);
  const whole =
    taken && Array.isArray(reading.rows) && instant(reading.takenAt) !== null && Number.isInteger(reading.others) && reading.others >= 0 && reading.rows.every(seen);
  const rows = whole ? reading.rows : [];
  const isOwn = (p) => witness.own.includes(identityOf(p));
  const onChain = (p) => witness.pids.includes(p.pid);
  const label = (p) => `${plain(p.name)} ${p.pid}${p.contends === false ? "" : ` (${plain(p.note) || (p.contends === true ? "contending" : "not classified")})`}`;
  // One reading names a process once. A process id it names twice, under one creation instant or two,
  // one name or two, is a reading that contradicts itself, and neither row is taken at its word.
  const times = new Map();
  for (const p of rows) times.set(p.pid, (times.get(p.pid) ?? 0) + 1);
  const repeated = rows.filter((p) => times.get(p.pid) > 1);
  // The chain and the reading name one process by its id and creation instant, so they name one
  // program, letter for letter. Where they do not, one of the two measurements is wrong.
  const chainNames = new Map(witness.verified ? holder.caller.chain.rows.map((p) => [identityOf(p), p.name]) : []);
  const renamed = rows.filter((p) => isOwn(p) && p.name !== chainNames.get(identityOf(p)));
  // An install is machine-wide. An installer the reading shows refuses whichever process it is, whoever
  // it belongs to and however it was judged: on the chain or off it, contending or called quiet.
  const installing = rows.filter((p) => isInstallerProgram(p.name));
  const unsound = (p) => times.get(p.pid) > 1 || renamed.includes(p) || isInstallerProgram(p.name);
  // In chain order, command first: a watched program that is not on the chain's list is simply not shown.
  // Only a row that stands is set aside. One that is repeated, misnamed or an installer is named below instead.
  const mine = witness.own.map((id) => rows.find((p) => identityOf(p) === id && !unsound(p))).filter(Boolean);
  const commandShown = witness.verified && rows.some((p) => identityOf(p) === witness.own[0]);
  const hostShown = witness.verified && rows.some((p) => identityOf(p) === witness.own[witness.own.length - 1]);
  // A chain process id under another creation instant is another process: the chain is no longer what was read.
  const reused = rows.filter((p) => onChain(p) && !isOwn(p));
  const foreign = rows.filter((p) => !onChain(p) && p.contends !== false);
  const quiet = rows.filter((p) => !onChain(p) && p.contends === false && !unsound(p)).length + (whole ? reading.others : 0);
  // Whatever the sweep counts against this folder, a process of this command's own must account for.
  const unexplained = sweep.filter(
    (p) => p?.contends === true && !mine.some((m) => m.contends === true && m.name.toLowerCase() === String(p.name ?? "").toLowerCase()),
  );
  const parts = [];
  if (!witness.verified) parts.push("the command that asked was not measured, so nothing here is known to be its own");
  if (mine.length) parts.push(`this command's own ${mine.map(label).join(", ")}`);
  if (witness.verified && !commandShown) parts.push("this command's own process is not in it");
  if (witness.verified && !hostShown) parts.push("its session program is not in it");
  if (witness.installers.length) parts.push(`an installer is never set aside, and this command runs under one: ${witness.installers.join(", ")}`);
  if (installing.length) parts.push(`an installer is never set aside, and the reading shows one: ${installing.map((p) => `${plain(p.name)} ${p.pid}`).join(", ")}`);
  if (repeated.length) parts.push(`named more than once, where one reading names a process once: ${repeated.map(label).join(", ")}`);
  if (renamed.length) {
    parts.push(`not the program the chain names for that process: ${renamed.map((p) => `${label(p)} against ${plain(chainNames.get(identityOf(p)))}`).join(", ")}`);
  }
  if (reused.length) parts.push(`process id reused since the chain was read: ${reused.map(label).join(", ")}`);
  if (foreign.length) parts.push(`not this command's own: ${foreign.map(label).join(", ")}`);
  if (unexplained.length) {
    parts.push(`the sweep counts ${unexplained.map((p) => plain(p.name)).join(", ")} against this folder and no process of this command's own accounts for it`);
  }
  if (quiet) parts.push(`${quiet} ${quiet === 1 ? "other" : "others"}, none contending`);
  const byProcess = !taken
    ? "by process: not read"
    : !whole
      ? "by process: read, but not in full"
      : `by process at ${reading.takenAt} (one moment; read again just before the write): ${parts.join("; ")}`;
  // A reading that contradicts itself or the chain ties nothing to this command, whatever else it shows.
  const tied = witness.verified && whole && commandShown && hostShown && reused.length === 0 && repeated.length === 0 && renamed.length === 0;
  const processOk =
    answered &&
    tied &&
    loose.length === 0 &&
    sweptInstallers.length === 0 &&
    witness.installers.length === 0 &&
    installing.length === 0 &&
    foreign.length === 0 &&
    unexplained.length === 0;
  const processRow = mk(
    "processes",
    "a process sweep that answered, and a by-process reading in which nothing contends for this folder but this command's own process chain",
    `${answered ? found : `${found || "nothing listed"} — the sweep does not list ${sweeper || "the program that ran it"}, so it is not known to have answered`} — ${byProcess}`,
    processOk,
    processOk
      ? null
      : !answered
        ? "The process sweep did not answer, so what is running against this folder is unknown, and unknown stays locked. Re-run once it answers. Never stop another tool's build, helper or session to clear a lease."
        : !tied || loose.length
          ? "What is running against this folder was not read in full, or cannot be tied to this command, so it is unknown, and unknown stays locked. Re-run once it answers. Never stop another tool's build, helper or session to clear a lease."
          : "Something other than this command's own process chain contends for this folder. Only the exact processes measured between this command and its session are set aside, each by its process id and creation time: never a program name, a count, another helper of the same session, or an installer. Wait for it to finish, then re-run. Never stop another tool's build, helper or session to clear a lease.",
  );

  const replaced = new Map([
    ["task.status", statusRow],
    ["task.claim", claimRow],
    ["folder.exists", existsRow],
    ["git.clean", withinRow],
    ["processes", processRow],
  ]);
  const checks = fresh.checks.flatMap((c) => {
    const row = replaced.get(c.name) ?? c;
    return c.name === "task.claim" ? [row, sessionRow, callerRow, folderRow, branchRow, scopeRow] : [row];
  });

  const failed = checks.filter((c) => !c.ok);
  return {
    verdict: failed.length === 0 ? "PASS" : "REFUSE",
    checks,
    // A renewal creates nothing and takes nothing over, whatever a fresh entry would have planned.
    actions: [],
    takeoverDraft: null,
    remediation: [...failed]
      .sort((a, b) => holderRank(a.name) - holderRank(b.name))
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
