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
import { parseClaim, parseHandoff } from "./claim.mjs";
import { inspectProcesses } from "./processes.mjs";
import {
  intendedWindow,
  resolveSettings,
  resolveSettingsFromSnapshot,
  resolveWindow,
  resolveWindowFromSnapshot,
} from "./settings-resolve.mjs";
import { parseWorktreeField } from "./worktree-field.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT = { number: 1, owner: "Pootytxng" };
export const REPO = "Pootytxng/sentinel";
export const CODE_ROOT = "C:\\Users\\Kuya\\code";
export const EXPECTED_COMMON_DIR = "C:\\Users\\Kuya\\code\\sentinel\\.git";
/** The checkout that owns the shared .git — every worktree is added from here. */
export const HOST_DIR = join(CODE_ROOT, "sentinel");
/** The NAME a missing worktree's base is looked up under. Nothing is ever created from the name. */
export const CREATE_BASE_REF = "origin/main";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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

/** Board items in the shape the reconciler expects. `reachable:false` is a verdict input, not a crash. */
export function readBoard() {
  try {
    const raw = gh(["project", "item-list", String(PROJECT.number), "--owner", PROJECT.owner, "--format", "json", "--limit", "100"]);
    const items = JSON.parse(raw).items.map((it) => ({
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

/** The newest claim and the newest handoff on an issue — the durable record guard 7 compares to. */
export function readIssueThread(issue) {
  try {
    const raw = gh(["issue", "view", String(issue), "--repo", REPO, "--json", "comments"]);
    const comments = JSON.parse(raw).comments ?? [];
    let claim = null;
    let handoff = null;
    for (const c of comments) {
      const asClaim = parseClaim(c.body);
      if (asClaim) claim = { ...asClaim, issue, postedAt: c.createdAt };
      const asHandoff = parseHandoff(c.body);
      if (asHandoff) handoff = { ...asHandoff, postedAt: c.createdAt };
    }
    // A released claim is not a live claim.
    if (handoff?.released && claim && new Date(handoff.postedAt) > new Date(claim.postedAt)) claim = null;
    return { claim, handoff };
  } catch {
    return { claim: null, handoff: null };
  }
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
 * Re-measure ONLY what a fetch can change, so the final verdict is about the commit that will
 * actually be used. The board, the claim, the checkouts, the hooks and the processes are untouched
 * by a fetch, so they are carried over rather than re-read — re-reading them would make the final
 * preflight a second full launch with its own new time-of-check.
 */
export function refetchSnapshotFacts({ facts, base, hostDir = HOST_DIR, env = process.env }) {
  const ref = base?.ok ? base.sha : null;
  const resolved = resolveSettingsFromSnapshot({ hostDir, ref, env });
  return {
    ...facts,
    base,
    window: { intended: facts.window.intended, effective: resolveWindowFromSnapshot({ hostDir, ref, env }) },
    subagentModel: resolved.envValues.CLAUDE_CODE_SUBAGENT_MODEL ?? null,
  };
}

/**
 * Everything `reconcile()` needs, measured.
 * @returns {{facts: object, target: {path, branch}|null, board: object}}
 */
export function gatherFacts({ issue, task, self = { lane: "Claude Code" }, now = new Date(), board = null, policy = null, base = null }) {
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
      checkouts,
      gitState,
      expectedCommonDir: EXPECTED_COMMON_DIR,
      codeRoot: CODE_ROOT,
      window: { intended: intendedWindow(thePolicy, { issue: theTask?.number ?? issue }), effective },
      subagentModel: resolved.envValues.CLAUDE_CODE_SUBAGENT_MODEL ?? null,
      hooks: exists ? verifyHooks({ dir: target.path, env: process.env }) : null,
      processes: inspectProcesses({ folder: target?.path ?? "" }),
      self,
      now,
    },
  };
}
