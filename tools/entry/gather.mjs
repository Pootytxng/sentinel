// The IO half: read the board, the issue thread, the machine, and the settings, then hand a plain
// facts object to the pure reconciler.
//
// Everything that touches the world lives here so `preflight.mjs` stays testable as data. Every
// read is read-only; the only writer in this toolchain is claim.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverCheckouts } from "./checkouts.mjs";
import { inspectGitState } from "./git-state.mjs";
import { verifyHooks } from "./hooks-verify.mjs";
import { claimExpiry, threadLease } from "./claim.mjs";
import { inspectProcesses } from "./processes.mjs";
import {
  intendedWindow,
  resolveSettings,
  resolveSettingsFromSnapshot,
  resolveWindow,
  resolveWindowFromSnapshot,
} from "./settings-resolve.mjs";
import { envWindowOf, planTier, readLocalLayer, readProjectWindow, readTierRecord } from "./tier.mjs";
import { parseWorktreeField } from "./worktree-field.mjs";
import { declaresNone, parseScopePatterns, scopeTextFromMarkdown } from "../../scripts/lib/claim-scope.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT = { number: 1, owner: "Pootytxng" };
export const REPO = "Pootytxng/sentinel";
export const CODE_ROOT = "C:\\Users\\Kuya\\code";
export const EXPECTED_COMMON_DIR = "C:\\Users\\Kuya\\code\\sentinel\\.git";
/** The checkout that owns the shared .git — every worktree is added from here. */
export const HOST_DIR = join(CODE_ROOT, "sentinel");
/** The NAME a missing worktree's base is looked up under. Nothing is ever created from the name. */
export const CREATE_BASE_REF = "origin/main";

/**
 * How long one `gh` READ may run before execFileSync kills it and throws (#474). Every reader here
 * turns a throw into its unreadable answer, so a GitHub that stops answering reads as unreadable
 * instead of holding the caller -- and the scope-drift gate reads a thread inside every `git push`.
 * Measured 2026-09-18: the slowest read (the board) took 3.7-4.1 s and a thread 0.43-0.85 s, while a
 * proxy that accepts and never answers held `gh` for 61 s before gh gave up on its own. 20 s is also
 * the bound work-control-gate.mjs, adopt.mjs and session-root-assert.mjs put on their own `gh` reads.
 * The writers in claim.mjs stay unbounded: a comment killed mid-flight may already be posted, so a
 * retry posts it twice, and a field edit killed mid-plan leaves the board half-written.
 */
export const GH_READ_TIMEOUT_MS = 20_000;

/** A `gh` for reads, killed at `timeout`. `exec` is a seam, so a guard can see what execFileSync is handed. */
export function ghReader({ exec = execFileSync, timeout = GH_READ_TIMEOUT_MS } = {}) {
  return (args) => exec("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout });
}
const gh = ghReader();
const gitIn = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const firstLine = (e) => String(e?.stderr || e?.message || e).split("\n").filter(Boolean)[0] ?? "unknown error";

/** A resolved base is an immutable commit id or it is nothing. Abbreviated ids are rejected. */
export const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Pin `origin/main` to ONE immutable commit id, and hand that id to everything downstream.
 *
 * Why this is not "read the ref twice" (bug->guard, #21): `origin/main` is a MOVABLE name. Preflight
 * read the future worktree's settings through it, `createWorktree()` then ran `git fetch`, and the
 * `git worktree add` that followed resolved the same name a second time — by which point it could
 * name a different commit. The launcher could verify commit A, create commit B, and print the two as
 * identical. Time-of-check and time-of-use must be the same object, so they are given the same
 * 40-character id rather than the same ref name.
 *
 * Fail-closed: an unresolvable ref returns `ok:false` with no sha, which reads no settings and
 * creates nothing. `git` is injected so the guards can drive both outcomes.
 */
export function resolveCreateBase({ hostDir = HOST_DIR, ref = CREATE_BASE_REF, git = gitIn } = {}) {
  try {
    const sha = git(hostDir, ["rev-parse", "--verify", `${ref}^{commit}`]);
    if (!FULL_SHA.test(sha)) return { ref, sha: null, ok: false, error: `${ref} did not resolve to a commit id (got "${sha}")` };
    return { ref, sha, ok: true, error: null };
  } catch (e) {
    return { ref, sha: null, ok: false, error: `could not resolve ${ref} in ${hostDir}: ${firstLine(e)}` };
  }
}

/**
 * Refresh the remote-tracking refs, then pin again — the ONLY place a fetch is allowed to happen.
 *
 * It runs after a passing preliminary verdict and before the final one (§5.6), never inside
 * `createWorktree()`, because a fetch between the check and the use is exactly what made them
 * disagree. A failed fetch is not a licence to create from a stale base: it returns `ok:false`.
 */
export function refreshCreateBase({ hostDir = HOST_DIR, ref = CREATE_BASE_REF, git = gitIn } = {}) {
  try {
    git(hostDir, ["fetch", "origin", "--quiet"]);
  } catch (e) {
    return { ref, sha: null, ok: false, fetched: false, error: `fetch failed in ${hostDir}: ${firstLine(e)}` };
  }
  return { ...resolveCreateBase({ hostDir, ref, git }), fetched: true };
}

export function loadPolicy(file = join(HERE, "context-policy.json")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// `gh project item-list` returns at most `--limit` rows and says nothing when the board has more: the
// read is truncated silently, and every issue past the cut reads as "not on the board" -- a refusal
// with a false reason (#339 on a 135-item board, under the old limit of 100). The limit is generous,
// and the count gh reports alongside the rows is compared to what arrived: a short read is not a read.
export const BOARD_READ_LIMIT = 1000;

/** gh's item-list payload -> rows, or a throw when the payload is a truncated board. */
export function parseBoardItems(raw) {
  const parsed = JSON.parse(raw);
  const items = parsed.items ?? [];
  const total = parsed.totalCount;
  if (Number.isInteger(total) && total > items.length) {
    throw new Error(`board read truncated: ${items.length} of ${total} items arrived (BOARD_READ_LIMIT=${BOARD_READ_LIMIT})`);
  }
  return items;
}

/** Board items in the shape the reconciler expects. `reachable:false` is a verdict input, not a crash. */
export function readBoard({ run = gh } = {}) {
  try {
    const raw = run(["project", "item-list", String(PROJECT.number), "--owner", PROJECT.owner, "--format", "json", "--limit", String(BOARD_READ_LIMIT)]);
    const items = parseBoardItems(raw).map((it) => ({
      number: it.content?.number,
      title: it.title,
      itemId: it.id,
      status: it.status ?? null,
      lane: it.lane ?? null,
      gate: it.gate ?? null,
      worktreeBranch: it["worktree / branch"] ?? "",
      nextAction: it["next action"] ?? null,
      claimExpires: it["claim expires"] ?? null,
      lastVerified: it["last verified"] ?? null,
    }));
    return { reachable: true, items };
  } catch (e) {
    return { reachable: false, items: [], error: String(e.message ?? e).split("\n")[0] };
  }
}

const leaseOf = (issue, comments) => {
  const { claim, handoff } = threadLease(comments ?? []);
  return { claim: claim ? { ...claim, issue } : null, handoff, unreadable: false };
};
const UNREADABLE = Object.freeze({ claim: null, handoff: null, unreadable: true });

/**
 * The issue's live claim, as threadLease folds it, and its newest handoff — the record guard 7 compares to.
 * A thread that could not be read says so (`unreadable: true`): it is not the same fact as a thread with
 * no claim in it, and a reader that needs the difference (collision rule 5) must be able to see it (#414).
 */
export function readIssueThread(issue, { run = gh } = {}) {
  try {
    const raw = run(["issue", "view", String(issue), "--repo", REPO, "--json", "comments"]);
    return leaseOf(issue, JSON.parse(raw).comments);
  } catch {
    return { ...UNREADABLE };
  }
}

/** Aliases per GraphQL request, and comments per thread in it. A longer thread is read on its own. */
export const THREAD_BATCH = 100;
const THREAD_PAGE = 100;

/**
 * Many threads' leases in one GraphQL request per THREAD_BATCH issues, instead of one `gh` process per
 * issue (#414: every item that is not Done is read, about 57 on 2026-09-11). Returns a Map from issue
 * number to readIssueThread's shape. An alias GitHub will not answer (gh exits non-zero, the rest of the
 * data still on stdout) is unreadable for that issue only; a request that returns nothing is unreadable
 * for every issue in it. A thread longer than one page is read whole through readIssueThread, because a
 * claim or a Handoff past the first page is exactly the part that decides the lease.
 */
export function readIssueThreads(numbers, { run = gh } = {}) {
  const out = new Map();
  const wanted = [...new Set((numbers ?? []).map(Number))].filter((n) => Number.isSafeInteger(n) && n > 0);
  const [owner, name] = REPO.split("/");
  const page = `comments(first: ${THREAD_PAGE}) { totalCount nodes { body createdAt } }`;
  for (let i = 0; i < wanted.length; i += THREAD_BATCH) {
    const chunk = wanted.slice(i, i + THREAD_BATCH);
    const aliases = chunk.map((n) => `i${n}: issueOrPullRequest(number: ${n}) { ... on Issue { ${page} } ... on PullRequest { ${page} } }`);
    const query = `query { repository(owner: "${owner}", name: "${name}") { ${aliases.join(" ")} } }`;
    const repositoryOf = (raw) => {
      try {
        return JSON.parse(String(raw ?? "")).data?.repository ?? null;
      } catch {
        return null;
      }
    };
    let repository;
    try {
      repository = repositoryOf(run(["api", "graphql", "-f", `query=${query}`]));
    } catch (e) {
      repository = repositoryOf(e?.stdout);
    }
    for (const n of chunk) {
      const comments = repository?.[`i${n}`]?.comments;
      if (!comments || !Array.isArray(comments.nodes)) out.set(n, { ...UNREADABLE });
      else if (Number(comments.totalCount) > comments.nodes.length) out.set(n, readIssueThread(n, { run }));
      else out.set(n, leaseOf(n, comments.nodes));
    }
  }
  return out;
}

/** The issue body — where a task's Write scope lives before its first claim. Null when unreadable. */
export function readIssueBody(issue) {
  try {
    return JSON.parse(gh(["issue", "view", String(issue), "--repo", REPO, "--json", "body"])).body ?? null;
  } catch {
    return null;
  }
}

/**
 * The facts `scope.overlap` decides over (#358): this task's declared paths (from --scope, else its
 * own live claim, else the issue body's "Write scope" bullet), the declared paths of every OTHER live
 * lease, and the tracked paths of the base commit — the set a glob can claim. `none` marks a scope that
 * declares `Write scope: none` (#554): declared, holding no path, which is not the same as undeclared.
 *
 * A lease lives in the issue thread, not in the board column (#414): a claim held through review sits
 * in Review, and one parked on the owner sits in Needs Kuya. So every item that is not Done is read,
 * whatever its column. Done is skipped because the board's "Item closed" workflow puts a closed issue
 * there, and #411/#413 refuse the close and the merge while a lease is live; reading those threads
 * would only cost time. A thread that cannot be read is an unknown lease, which locks (rule 5). An
 * Active row with no live claim is kept as stale, so the verdict can name the hygiene finding.
 * The readers are injected so the guards can drive this without GitHub or git.
 */
export function gatherScopeFacts({ task, items = [], claim = null, scopeText = null, base = null, now = new Date(), hostDir = HOST_DIR, git = gitIn, run = gh, threads = (ns) => readIssueThreads(ns, { run }), body = readIssueBody }) {
  let text = null;
  let source = null;
  if (scopeText) {
    text = scopeText;
    source = "cli";
  } else if (claim?.scope) {
    text = claim.scope;
    source = "claim";
  } else if (task?.number) {
    const fromBody = scopeTextFromMarkdown(body(task.number));
    if (fromBody) {
      text = fromBody;
      source = "issue";
    }
  }
  const mine = parseScopePatterns(text);
  const read = (items ?? []).filter((i) => {
    const n = Number(i?.number);
    return Number.isSafeInteger(n) && n > 0 && i.status !== "Done" && n !== Number(task?.number);
  });
  let leases;
  try {
    leases = threads(read.map((i) => Number(i.number)));
  } catch {
    leases = null;
  }
  const others = read.flatMap((i) => {
    const column = i.status ?? null;
    const at = { number: i.number, lane: i.lane ?? null, column };
    const t = leases instanceof Map ? leases.get(Number(i.number)) : null;
    if (!t || t.unreadable) return [{ ...at, scope: null, live: true, expired: false, expires: null, unreadable: true }];
    // A released claim already reads as null; an expired one is read as stale here, so the
    // verdict can name it without treating it as a writer (and still refuse if its paths overlap).
    const live = t.claim ?? null;
    if (!live && column !== "Active") return [];
    // Anchored on the posting time, so a bare "12 hours" reads as the writer meant it.
    const expiry = live ? claimExpiry(live.expires, { anchor: live.postedAt }) : null;
    return [
      {
        ...at,
        scope: live ? parseScopePatterns(live.scope) : null,
        none: live ? declaresNone(live.scope) : false,
        live: Boolean(live),
        expired: Boolean(expiry && expiry < now),
        expires: expiry ? expiry.toISOString().slice(0, 10) : (live?.expires ?? null),
      },
    ];
  });
  let files = null;
  try {
    const ref = base?.ok && base.sha ? base.sha : CREATE_BASE_REF;
    files = git(hostDir, ["ls-tree", "-r", "--name-only", ref]).split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    files = null;
  }
  return { mine, none: declaresNone(text), text, source, others, files };
}

/** The field ids claim.mjs needs to write. Read once, passed in, never guessed. */
export function readProjectIds(itemId) {
  const projectId = JSON.parse(gh(["project", "view", String(PROJECT.number), "--owner", PROJECT.owner, "--format", "json"])).id;
  const fields = JSON.parse(gh(["project", "field-list", String(PROJECT.number), "--owner", PROJECT.owner, "--format", "json"])).fields;
  const byName = (name) => fields.find((f) => f.name === name);
  const opts = (f) => Object.fromEntries((f?.options ?? []).map((o) => [o.name, o.id]));
  return {
    projectId,
    itemId,
    fields: {
      status: { id: byName("Status")?.id, options: opts(byName("Status")) },
      lane: { id: byName("Lane")?.id, options: opts(byName("Lane")) },
      gate: { id: byName("Gate")?.id, options: opts(byName("Gate")) },
      worktree: { id: byName("Worktree / branch")?.id },
      nextAction: { id: byName("Next action")?.id },
      claimExpires: { id: byName("Claim expires")?.id },
      lastVerified: { id: byName("Last verified")?.id },
    },
  };
}

/**
 * Where a target's settings come from. An EXISTING folder answers for itself; a folder that does not
 * exist yet answers with the snapshot it will be created from.
 *
 * Never the launcher's own directory (bug->guard, #21). `tools/entry/` configures nothing, so
 * substituting it for an absent target reported the documented 150000 fallback as the future
 * worktree's configuration — "expected 150000, actual 150000" that still refused, because an
 * unconfigured coincidence is not a decision. That made a safely-creatable worktree impossible to
 * create through the entrypoint. The launcher's settings were never the session's settings.
 *
 * The snapshot is named by the PINNED commit id, never by `origin/main` — see `resolveCreateBase`.
 * An unpinned base yields `ref:null`, which reads no project layer and therefore refuses.
 */
export function settingsSourceFor(target, { exists, hostDir = HOST_DIR, base = null } = {}) {
  if (exists && target?.path) return { kind: "folder", dir: target.path };
  return { kind: "snapshot", hostDir, ref: base?.ok ? base.sha : null, base };
}

/**
 * What the launcher would DO about the window, measured the same way `establishTier` will decide it
 * — so the verdict row and the write that follows it cannot disagree.
 *
 * An EXISTING folder is asked directly. A folder that does not exist yet has no local layer to own
 * and no project file to read, so its underlying value is the snapshot's — env excluded, because
 * `planTier` weighs the environment itself and would otherwise count it twice.
 */
export function planTierFor({ dir, exists, intended, effective, env = process.env, stateDir = undefined }) {
  const opts = stateDir === undefined ? {} : { stateDir };
  if (exists && dir) {
    return planTier({
      intended,
      projectWindow: readProjectWindow(dir),
      local: readLocalLayer(dir),
      record: readTierRecord({ dir, ...opts }),
      envWindow: envWindowOf(env),
    });
  }
  const underlying = effective?.configured && effective.layer !== "env" ? effective.window : null;
  return planTier({ intended, projectWindow: underlying, local: { present: false }, record: null, envWindow: envWindowOf(env) });
}

/**
 * Re-measure ONLY what a fetch can change, so the final verdict is about the commit that will
 * actually be used. The board, the claim, the checkouts, the hooks and the processes are untouched
 * by a fetch, so they are carried over rather than re-read — re-reading them would make the final
 * preflight a second full launch with its own new time-of-check.
 */
export function refetchSnapshotFacts({ facts, base, hostDir = HOST_DIR, env = process.env }) {
  const ref = base?.ok ? base.sha : null;
  const resolved = resolveSettingsFromSnapshot({ hostDir, ref, env });
  const effective = resolveWindowFromSnapshot({ hostDir, ref, env });
  const intended = facts.window.intended;
  return {
    ...facts,
    base,
    window: { intended, effective, plan: planTierFor({ dir: null, exists: false, intended, effective, env }) },
    subagentModel: resolved.envValues.CLAUDE_CODE_SUBAGENT_MODEL ?? null,
  };
}

/**
 * Everything `reconcile()` needs, measured.
 * @returns {{facts: object, target: {path, branch}|null, board: object}}
 */
export function gatherFacts({ issue, task, self = { lane: "Claude Code" }, now = new Date(), board = null, policy = null, base = null, scopeText = null }) {
  const theBoard = board ?? readBoard();
  const theTask = task ?? theBoard.items.find((i) => Number(i.number) === Number(issue)) ?? null;

  const parsed = parseWorktreeField(theTask?.worktreeBranch ?? "", { codeRoot: CODE_ROOT });
  const target = parsed.ok ? (parsed.entries[0] ?? null) : null;

  const checkouts = discoverCheckouts({ roots: [CODE_ROOT] });
  const exists = target ? checkouts.some((c) => c.path.toLowerCase() === target.path.toLowerCase()) : false;
  const gitState = exists ? inspectGitState(target.path) : null;

  const thread = readIssueThread(theTask?.number ?? issue);
  const thePolicy = policy ?? loadPolicy();

  // Pin once, here, before a single setting is read. Every later mention of "the base" in this
  // train — the settings snapshot, the verdict row, `git worktree add` — is this one commit id.
  const createBase = exists ? null : (base ?? resolveCreateBase({ hostDir: HOST_DIR }));

  const source = settingsSourceFor(target, { exists, base: createBase });
  const effective =
    source.kind === "folder"
      ? resolveWindow({ dir: source.dir, env: process.env })
      : resolveWindowFromSnapshot({ hostDir: source.hostDir, ref: source.ref, env: process.env });
  const resolved =
    source.kind === "folder"
      ? resolveSettings({ dir: source.dir, env: process.env })
      : resolveSettingsFromSnapshot({ hostDir: source.hostDir, ref: source.ref, env: process.env });
  const intended = intendedWindow(thePolicy, { issue: theTask?.number ?? issue });

  return {
    board: theBoard,
    target,
    base: createBase,
    facts: {
      base: createBase,
      board: { reachable: theBoard.reachable, error: theBoard.error },
      items: theBoard.items,
      task: theTask,
      claim: thread.claim,
      handoff: thread.handoff,
      scope: gatherScopeFacts({ task: theTask, items: theBoard.items, claim: thread.claim, scopeText, base: createBase, now }),
      checkouts,
      gitState,
      expectedCommonDir: EXPECTED_COMMON_DIR,
      codeRoot: CODE_ROOT,
      window: { intended, effective, plan: planTierFor({ dir: target?.path ?? null, exists, intended, effective }) },
      subagentModel: resolved.envValues.CLAUDE_CODE_SUBAGENT_MODEL ?? null,
      hooks: exists ? verifyHooks({ dir: target.path, env: process.env }) : null,
      processes: inspectProcesses({ folder: target?.path ?? "" }),
      self,
      now,
    },
  };
}
